// Hand-rolled streaming client for Core's chat endpoint, the TS port of
// apps/cli/src/chat.rs (stream_chat, ~112-244). core-client/chat only exposes the
// endpoint URL + auth headers (the desktop drives it through the AI SDK transport),
// so the TUI owns the SSE read loop. The wire frames are AI SDK v6 UI Message
// Stream SSE: newline-delimited `data: {json}` with a `type` discriminator
//   text-delta            -> delta text chunk
//   tool-input-available  -> a typed tool call
//   tool-output-available -> a typed tool result
//   reasoning-delta      -> a typed thinking block
//   tool-TodoWrite input  -> a typed todo snapshot
//   error                 -> stream error
//   finish / [DONE]       -> end of stream
//   data-ryu-permission   -> an ACP permission request; .data is surfaced to
//                            the existing permission handler
//   data-plugin_note      -> out-of-band note from a Core server-side plugin
//                            turn-hook (goal/proof/double-check); .data.text is
//                            surfaced separately, NOT appended to the transcript
// Request body mirrors the Rust exactly: messages carry content as an array of
// {type:"text", text} parts, plus optional agent_id / conversation_id / acp_model
// / team_id / plugin_flags.

import { chatHeaders, chatStreamUrl } from "@ryuhq/core-client/chat";
import type { ApiTarget } from "@ryuhq/core-client/client";

export type ChatRole = "user" | "assistant";

export interface ChatTurn {
	content: string;
	role: ChatRole;
}

/** Per-turn routing options (mirrors apps/cli's ChatOptions). */
export interface ChatStreamOptions {
	/** ACP config-option selections, such as reasoning effort. */
	acpConfig?: Record<string, string>;
	/** ACP permission/session mode advertised by the selected agent. */
	acpMode?: string;
	/** ACP session model override for this turn (/model <id>). */
	acpModel?: string;
	/** Agent to route to; omit to let Core pick its default. */
	agentId?: string;
	/** Stable per-chat id sent on every turn so Core persists the conversation;
	 * the server-side plugin turn-hooks (goal/proof/double-check) and sessions all
	 * key off it. */
	conversationId?: string;
	/** Per-turn plugin toggles forwarded as `plugin_flags`; Core's turn-hooks read
	 * them (e.g. `{ "io.ryu.double-check": true }` to arm the review hook). */
	pluginFlags?: Record<string, boolean>;
	/** Route the turn to a group instead of a single agent (/group <id>). */
	teamId?: string;
}

export interface ChatStreamHandlers {
	/** The stream finished (finish frame or [DONE] or body end). */
	onDone: () => void;
	/** A stream-level error. After this the stream is finished. */
	onError: (message: string) => void;
	/** An ACP tool-permission request that must be answered to unblock the turn. */
	onPermission?: (permission: unknown) => void;
	/** An out-of-band note from a Core plugin turn-hook (goal/proof/double-check). */
	onPluginNote?: (text: string) => void;
	/** A reasoning/thinking text delta. */
	onReasoningDelta?: (delta: string) => void;
	/** A text delta from the assistant. */
	onTextDelta: (delta: string) => void;
	/** A TodoWrite plan snapshot. */
	onTodo?: (input: unknown) => void;
	/** A tool call started (the agent's tool loop). */
	onToolInput?: (
		toolName: string,
		input?: unknown,
		toolCallId?: string
	) => void;
	/** A tool result arrived (status string when present). */
	onToolOutput?: (
		status: string,
		output?: unknown,
		toolCallId?: string
	) => void;
}

const TRAILING_CR = /\r$/;

interface WireFrame {
	data?: unknown;
	delta?: unknown;
	error?: unknown;
	errorText?: unknown;
	input?: unknown;
	output?: unknown;
	reasoning?: unknown;
	status?: unknown;
	toolCallId?: unknown;
	toolName?: unknown;
	type: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

const asString = (value: unknown): string | undefined =>
	typeof value === "string" ? value : undefined;

const asNonEmptyString = (value: unknown): string | undefined => {
	const string = asString(value);
	return string && string.length > 0 ? string : undefined;
};

const parseWireFrame = (payload: string): WireFrame | null => {
	let parsed: unknown;
	try {
		parsed = JSON.parse(payload);
	} catch {
		return null;
	}
	if (!isRecord(parsed) || typeof parsed.type !== "string") {
		return null;
	}
	return parsed as unknown as WireFrame;
};

const normalizeQuestionInput = (
	toolName: string,
	input: unknown,
	toolCallId: string | undefined
): unknown => {
	if (toolName !== "Question" || !toolCallId || !isRecord(input)) {
		return input;
	}
	if (typeof input.toolCallId === "string") {
		return input;
	}
	// Core normally includes this in the normalized Question input. Reattach the
	// stable frame id when an agent sends a late/partial tool-input update so the
	// existing ChatTab question parser can still answer the right waiter.
	return { ...input, toolCallId };
};

const toolOutputPayload = (
	frame: WireFrame
): { body: unknown; status: string } => {
	const rawOutput = frame.output;
	const frameStatus = asNonEmptyString(frame.status);
	if (frameStatus) {
		return { body: rawOutput, status: frameStatus };
	}

	const outputRecord = isRecord(rawOutput) ? rawOutput : null;
	const outputStatus = asNonEmptyString(outputRecord?.status);
	if (outputRecord && outputStatus) {
		return {
			body: Object.hasOwn(outputRecord, "output")
				? outputRecord.output
				: rawOutput,
			status: outputStatus,
		};
	}

	return {
		body: rawOutput,
		status: outputRecord?.isError === true ? "error" : "completed",
	};
};

const buildBody = (
	turns: ChatTurn[],
	options: ChatStreamOptions
): Record<string, unknown> => {
	const body: Record<string, unknown> = {
		messages: turns.map((turn) => ({
			role: turn.role,
			content: [{ type: "text", text: turn.content }],
		})),
	};
	if (options.agentId) {
		body.agent_id = options.agentId;
	}
	if (options.conversationId) {
		body.conversation_id = options.conversationId;
	}
	if (options.acpModel) {
		body.acp_model = options.acpModel;
	}
	if (options.teamId) {
		body.team_id = options.teamId;
	}
	if (options.acpMode) {
		body.acp_mode = options.acpMode;
	}
	if (options.acpConfig && Object.keys(options.acpConfig).length > 0) {
		body.acp_config = options.acpConfig;
	}
	if (options.pluginFlags && Object.keys(options.pluginFlags).length > 0) {
		body.plugin_flags = options.pluginFlags;
	}
	return body;
};

// Dispatch one already-parsed frame. Returns true when the stream is finished.
const dispatchFrame = (
	frame: WireFrame,
	handlers: ChatStreamHandlers
): boolean => {
	switch (frame.type) {
		case "text-delta": {
			const delta = asString(frame.delta);
			if (delta !== undefined) {
				handlers.onTextDelta(delta);
			}
			return false;
		}
		case "tool-input-available": {
			const toolName = asString(frame.toolName) || "tool";
			const toolCallId = asString(frame.toolCallId);
			const input = normalizeQuestionInput(toolName, frame.input, toolCallId);
			handlers.onToolInput?.(toolName, input, toolCallId);
			if (toolName === "TodoWrite" && input !== undefined) {
				handlers.onTodo?.(input);
			}
			return false;
		}
		case "tool-output-available": {
			const { body, status } = toolOutputPayload(frame);
			handlers.onToolOutput?.(status, body, asString(frame.toolCallId));
			return false;
		}
		case "reasoning-delta": {
			const delta = asString(frame.delta) ?? asString(frame.reasoning);
			if (delta !== undefined) {
				handlers.onReasoningDelta?.(delta);
			}
			return false;
		}
		case "data-todo": {
			if (isRecord(frame.data)) {
				handlers.onTodo?.(frame.data);
			}
			return false;
		}
		case "data-plugin_note": {
			const data = isRecord(frame.data) ? frame.data : null;
			const text = asNonEmptyString(data?.text) ?? asNonEmptyString(frame.data);
			if (text !== undefined) {
				handlers.onPluginNote?.(text);
			}
			return false;
		}
		case "data-ryu-permission": {
			if (isRecord(frame.data)) {
				handlers.onPermission?.(frame.data);
			}
			return false;
		}
		case "data-ryu-question": {
			const data = isRecord(frame.data) ? frame.data : null;
			if (data && Array.isArray(data.questions)) {
				const toolCallId =
					asString(frame.toolCallId) ?? asString(data.toolCallId);
				handlers.onToolInput?.(
					"Question",
					normalizeQuestionInput("Question", data, toolCallId),
					toolCallId
				);
			}
			return false;
		}
		case "error": {
			handlers.onError(
				asNonEmptyString(frame.errorText) ??
					asNonEmptyString(frame.error) ??
					"stream error"
			);
			return true;
		}
		case "finish": {
			handlers.onDone();
			return true;
		}
		default: {
			// start, text-start, text-end, tool-input-start, etc. - ignored.
			return false;
		}
	}
};

const dispatchDataLine = (
	line: string,
	handlers: ChatStreamHandlers
): boolean => {
	if (!line.startsWith("data:")) {
		return false;
	}
	const data = line.slice("data:".length).trim();
	if (data.length === 0) {
		return false;
	}
	if (data === "[DONE]") {
		handlers.onDone();
		return true;
	}
	const frame = parseWireFrame(data);
	return frame ? dispatchFrame(frame, handlers) : false;
};

// Parse complete `\n`-terminated lines out of `buffer`, dispatching each data
// frame. Returns { rest, done } where rest is the unconsumed tail.
const drainBuffer = (
	buffer: string,
	handlers: ChatStreamHandlers,
	flush = false
): { rest: string; done: boolean } => {
	let start = 0;
	let newline = buffer.indexOf("\n", start);
	while (newline !== -1) {
		const line = buffer.slice(start, newline).replace(TRAILING_CR, "");
		start = newline + 1;
		if (dispatchDataLine(line, handlers)) {
			return { rest: "", done: true };
		}
		newline = buffer.indexOf("\n", start);
	}

	const rest = buffer.slice(start);
	if (!flush || rest.length === 0) {
		return { rest, done: false };
	}
	if (dispatchDataLine(rest.replace(TRAILING_CR, ""), handlers)) {
		return { rest: "", done: true };
	}
	return { rest: "", done: false };
};

/** Stream one assistant turn. Resolves when the stream finishes (the handlers
 * have already received every event). Honors `signal` for cancellation. */
export async function streamChat(
	target: ApiTarget,
	turns: ChatTurn[],
	options: ChatStreamOptions,
	handlers: ChatStreamHandlers,
	signal?: AbortSignal
): Promise<void> {
	let response: Response;
	try {
		response = await fetch(chatStreamUrl(target), {
			method: "POST",
			headers: { "Content-Type": "application/json", ...chatHeaders(target) },
			body: JSON.stringify(buildBody(turns, options)),
			signal,
		});
	} catch (err) {
		if (signal?.aborted) {
			return;
		}
		handlers.onError(err instanceof Error ? err.message : String(err));
		return;
	}

	if (!response.ok) {
		handlers.onError(`HTTP ${response.status}`);
		return;
	}
	if (!response.body) {
		handlers.onDone();
		return;
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			buffer += decoder.decode(value, { stream: true });
			const result = drainBuffer(buffer, handlers);
			buffer = result.rest;
			if (result.done) {
				return;
			}
		}
		buffer += decoder.decode();
		const result = drainBuffer(buffer, handlers, true);
		if (result.done) {
			return;
		}
	} catch (err) {
		if (signal?.aborted) {
			return;
		}
		handlers.onError(err instanceof Error ? err.message : String(err));
		return;
	}

	handlers.onDone();
}
