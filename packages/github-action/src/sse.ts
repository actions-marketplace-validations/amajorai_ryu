import type { ChatResult, ToolEvent } from "./types.ts";

interface JsonRecord {
	[key: string]: unknown;
}

export interface StreamCallbacks {
	onFrame?: (frame: JsonRecord) => void;
}

function isRecord(value: unknown): value is JsonRecord {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function nestedString(record: JsonRecord, ...keys: string[]): string | null {
	for (const key of keys) {
		const value = stringValue(record[key]);
		if (value !== null) {
			return value;
		}
	}
	return null;
}

function frameRunId(frame: JsonRecord): string | null {
	const direct = nestedString(frame, "run_id", "runId");
	if (direct !== null) {
		return direct;
	}
	const data = frame.data;
	if (isRecord(data)) {
		return nestedString(data, "run_id", "runId");
	}
	return null;
}

function parseFrame(payload: string): JsonRecord | null {
	try {
		const parsed: unknown = JSON.parse(payload);
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function consumeFrame(
	frame: JsonRecord,
	state: {
		finished: boolean;
		runId: string | null;
		text: string;
		toolEvents: ToolEvent[];
		workflowEvents: unknown[];
	},
	callbacks?: StreamCallbacks
): void {
	callbacks?.onFrame?.(frame);
	const type = stringValue(frame.type);
	const frameRun = frameRunId(frame);
	if (state.runId === null && frameRun !== null) {
		state.runId = frameRun;
	}

	switch (type) {
		case "text-delta": {
			const delta = stringValue(frame.delta);
			if (delta !== null) {
				state.text += delta;
			}
			return;
		}
		case "tool-input-available":
			state.toolEvents.push({
				type: "input",
				toolCallId: nestedString(frame, "toolCallId", "tool_call_id"),
				toolName: nestedString(frame, "toolName", "tool_name"),
				input: frame.input,
			});
			return;
		case "tool-output-available": {
			const rawOutput = frame.output;
			const outputRecord = isRecord(rawOutput) ? rawOutput : null;
			state.toolEvents.push({
				type: "output",
				toolCallId: nestedString(frame, "toolCallId", "tool_call_id"),
				toolName: nestedString(frame, "toolName", "tool_name"),
				output: rawOutput,
				status:
					nestedString(frame, "status") ??
					(outputRecord ? nestedString(outputRecord, "status") : null),
			});
			return;
		}
		case "error": {
			const detail =
				nestedString(frame, "errorText", "error", "message") ??
				"Ryu chat stream failed.";
			throw new Error(detail);
		}
		case "finish":
			state.finished = true;
			return;
		default:
			if (type?.startsWith("data-ryu-workflow") || type === "workflow") {
				state.workflowEvents.push(frame.data ?? frame);
			}
	}
}

function consumeDataLine(
	line: string,
	state: {
		finished: boolean;
		runId: string | null;
		text: string;
		toolEvents: ToolEvent[];
		workflowEvents: unknown[];
	},
	callbacks?: StreamCallbacks
): void {
	const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
	if (!normalized.startsWith("data:")) {
		return;
	}
	const payload = normalized.slice("data:".length).trim();
	if (payload.length === 0) {
		return;
	}
	if (payload === "[DONE]") {
		state.finished = true;
		return;
	}
	const frame = parseFrame(payload);
	if (frame !== null) {
		consumeFrame(frame, state, callbacks);
	}
}

export async function parseCoreChatStream(
	body: ReadableStream<Uint8Array>,
	conversationId: string,
	callbacks?: StreamCallbacks
): Promise<ChatResult> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	const state = {
		finished: false,
		runId: null as string | null,
		text: "",
		toolEvents: [] as ToolEvent[],
		workflowEvents: [] as unknown[],
	};
	let buffer = "";

	const consumeBuffer = (flush: boolean): void => {
		const lines = buffer.split(/\n/);
		buffer = flush ? "" : (lines.pop() ?? "");
		for (const line of lines) {
			consumeDataLine(line, state, callbacks);
		}
	};

	while (true) {
		const chunk = await reader.read();
		if (chunk.done) {
			buffer += decoder.decode();
			consumeBuffer(true);
			break;
		}
		buffer += decoder.decode(chunk.value, { stream: true });
		consumeBuffer(false);
	}

	return {
		conversationId,
		finished: state.finished,
		runId: state.runId,
		text: state.text,
		toolEvents: state.toolEvents,
		workflowEvents: state.workflowEvents,
	};
}
