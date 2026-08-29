import type React from "react";
import { memo } from "react";
import { AgentUI } from "../agent-ui/agent-ui.tsx";
import { useChatDisplayPrefs } from "../chat-display-prefs.tsx";
import { QuestionTool } from "../question/question-tool.tsx";
import type {
	AgentMessageContext,
	CustomToolRendererProps,
	WidgetAvailablePart,
} from "../types.ts";
import { getToolStatus } from "../utils/format-tool.ts";
import { unwrapMcpOutput } from "../utils/unwrap-mcp-output.ts";
import { useWidgetHost } from "../widget-host-context.tsx";
import { AgentMessageTool } from "./agent-message-tool.tsx";
import { isAgentMessageToolPart } from "./agent-message-tool-logic.ts";
import {
	ArtifactTool,
	artifactIdForPart,
	isArtifactPart,
} from "./artifact-tool.tsx";
import { BashTool } from "./bash-tool.tsx";
import { EditTool } from "./edit-tool.tsx";
import { GenericTool } from "./generic-tool.tsx";
import { McpTool } from "./mcp-tool.tsx";
import { PlanTool } from "./plan-tool.tsx";
import { SandboxTool } from "./sandbox-tool.tsx";
import { SearchTool } from "./search-tool.tsx";
import { looksLikeStackTrace, StackTrace } from "./stack-trace.tsx";
import { SubagentTool } from "./subagent-tool.tsx";
import { ThinkingTool } from "./thinking-tool.tsx";
import { TodoTool } from "./todo-tool.tsx";
import {
	type McpToolInfo,
	parseMcpToolType,
	toolRegistry,
} from "./tool-registry.ts";
import { ToolTimingProvider } from "./tool-timing.tsx";

export interface ToolRendererProps {
	agentMessageContext?: AgentMessageContext;
	chatStatus?: string;
	nestedTools?: any[];
	onAgentUiSubmit?: (value: unknown) => void | Promise<void>;
	part: any;
	toolRenderers?: Record<string, React.ComponentType<CustomToolRendererProps>>;
}

/**
 * Compact "path:line, path2" summary of an ACP tool call's `locations` (the
 * files/lines it touched), which Core folds into the part input under the
 * namespaced `_ryuLocations` key. Returns undefined when there are none, so it
 * can be used as a subtitle fallback on generic tool rows.
 */
function formatLocations(part: any): string | undefined {
	const locations = part?.input?._ryuLocations as
		| { path?: string; line?: number }[]
		| undefined;
	if (!Array.isArray(locations) || locations.length === 0) {
		return undefined;
	}
	const labels = locations
		.map((loc) => {
			const path = (loc?.path ?? "").split(/[/\\]/).pop() || loc?.path;
			if (!path) {
				return null;
			}
			return typeof loc.line === "number" ? `${path}:${loc.line}` : path;
		})
		.filter((v): v is string => Boolean(v));
	return labels.length > 0 ? labels.join(", ") : undefined;
}

function deriveToolStatus(
	part: any,
	chatStatus?: string
): CustomToolRendererProps["status"] {
	if (part.state === "input-streaming") {
		return "streaming";
	}
	if (part.state === "output-available") {
		return "success";
	}
	if (part.state === "output-error") {
		return "error";
	}
	const { isPending } = getToolStatus(part, chatStatus);
	return isPending ? "pending" : "success";
}

// A tool part that runs an AI-generated program: Core's programmatic tool
// calling exposes it as the MCP tool `execute` (required `code` input), which
// Core surfaces as a `dynamic-tool`. Any dynamic tool carrying `input.code`
// counts too, so BYO code-runners render in the sandbox card, not a bare row.
function isCodeExecPart(part: any): boolean {
	const partType = part.type as string;
	if (partType === "tool-execute") {
		return true;
	}
	if (partType !== "dynamic-tool") {
		return false;
	}
	return part.toolName === "execute" || typeof part.input?.code === "string";
}

// Pull a JS/Node stack trace out of a tool part's error surface, if any. Checks
// the AI SDK v5 `errorText`, a string output, and common `{error|stack|message}`
// shapes. `looksLikeStackTrace` gates on real `at …` frames so ordinary error
// strings never render as a full trace.
function extractStackTrace(part: any): string | null {
	const candidates: unknown[] = [
		part.errorText,
		typeof part.output === "string" ? part.output : undefined,
		part.output?.error,
		part.output?.stack,
		part.output?.message,
	];
	for (const candidate of candidates) {
		if (looksLikeStackTrace(candidate)) {
			return candidate;
		}
	}
	return null;
}

export const ToolRenderer = memo(function ToolRenderer(
	props: ToolRendererProps
) {
	// Every row below reads its timing from context rather than a prop: a dozen
	// tool components sit between here and `ToolRowBase`, and none of them would
	// otherwise use the value they had to forward.
	return (
		<ToolTimingProvider part={props.part}>
			<ToolRendererInner {...props} />
		</ToolTimingProvider>
	);
});

const ToolRendererInner = memo(function ToolRendererInner({
	part,
	nestedTools,
	chatStatus,
	toolRenderers,
	onAgentUiSubmit,
	agentMessageContext,
}: ToolRendererProps) {
	const partType = part.type as string;
	const { groupToolUses, expandFileEdits, expandCommands } =
		useChatDisplayPrefs();
	const widgetHost = useWidgetHost();

	// Built-in artifact surface (artifact.render inline, or artifact.create's
	// created file): render the agent's artifact as a live card with an "Open in
	// panel / tab" affordance. Rendered through the desktop-injected host, so it
	// degrades to a plain tool row on surfaces without one.
	if (isArtifactPart(partType, part.toolName)) {
		return <ArtifactTool id={artifactIdForPart(part.toolCallId)} part={part} />;
	}

	// Generative UI (ui.render): render the agent's spec inline as the app's own
	// @ryu/ui components instead of a tool row. Core surfaces it either as a typed
	// `tool-ui.render` part or as a `dynamic-tool` whose toolName is `ui.render`.
	const isUiRender =
		partType === "tool-ui.render" ||
		(partType === "dynamic-tool" && part.toolName === "ui.render");
	if (isUiRender) {
		const status = deriveToolStatus(part, chatStatus);
		const input = (part.input ?? {}) as {
			format?: "json-render" | "a2ui";
			spec?: unknown;
			title?: string;
		};
		// Wait for the spec to finish streaming before rendering, so a partial spec
		// doesn't flash the fallback. Core's dispatch is a near-instant no-op echo.
		if (status === "streaming" || status === "pending" || input.spec == null) {
			return <GenericTool isPending title="Rendering UI" />;
		}
		return (
			<AgentUI
				format={input.format}
				onSubmit={onAgentUiSubmit}
				spec={input.spec}
				title={input.title}
			/>
		);
	}

	// App widget (Ryu Apps): a `data-tool-widget-available` data part carries the
	// live, sandboxed widget minted for a completed tool call (D6: payload under
	// `.data`). The concrete renderer lives in apps/desktop and is injected via
	// WidgetHostContext, since blocks cannot import it. Without a host the widget
	// degrades to a plain tool row.
	if (partType === "data-tool-widget-available") {
		if (!widgetHost) {
			// The widget part is only minted for a COMPLETED call, so the
			// degraded row is never in flight.
			return <GenericTool isPending={false} title="App widget" />;
		}
		const WidgetRenderer = widgetHost.Renderer;
		return <WidgetRenderer part={part as WidgetAvailablePart} />;
	}

	// Code-execution programs render as a sandbox card (code + output tabs)
	// instead of a bare tool row, mirroring the AI SDK "Sandbox" element.
	if (isCodeExecPart(part)) {
		return <SandboxTool chatStatus={chatStatus} part={part} />;
	}

	// Switchboard's send call is a transcript event, not generic tool detail:
	// keep the sender/recipient visible and show the actual message as a bubble.
	if (isAgentMessageToolPart(partType, part.toolName)) {
		return (
			<AgentMessageTool
				chatStatus={chatStatus}
				context={agentMessageContext}
				part={part}
			/>
		);
	}

	// Specialized tool components with variant dispatch
	switch (partType) {
		case "tool-Bash":
			return <BashTool expandOutput={expandCommands} part={part} />;
		case "tool-Edit":
		case "tool-Write":
			return <EditTool expandByDefault={expandFileEdits} part={part} />;
		case "tool-WebSearch":
			return <SearchTool part={part} />;
		case "tool-PlanWrite":
			return <PlanTool chatStatus={chatStatus} part={part} />;
		case "tool-TodoWrite":
			return <TodoTool chatStatus={chatStatus} part={part} />;
		case "tool-Question":
			return <QuestionTool chatStatus={chatStatus} part={part} />;
		case "tool-Task":
		case "tool-Agent": {
			const labelBase = part.type === "tool-Agent" ? "Agent" : "Task";
			if (!groupToolUses) {
				// When grouping is disabled, render the parent as a simple generic row
				// and let the nested tools render individually (they're rendered by
				// AssistantParts as siblings when grouping is off — see message-list).
				const { isPending } = getToolStatus(part, chatStatus);
				return (
					<GenericTool
						isPending={isPending}
						title={
							isPending
								? `Running ${labelBase.toLowerCase()}`
								: `${labelBase} completed`
						}
					/>
				);
			}
			return (
				<SubagentTool
					chatStatus={chatStatus}
					nestedTools={nestedTools}
					part={part}
				/>
			);
		}
		case "tool-Thinking":
			// chatStatus is what stops the "Thinking" shimmer + elapsed counter on a
			// turn that ended without its closing frame.
			return <ThinkingTool chatStatus={chatStatus} part={part} />;
	}

	// A failed tool whose error is a real JS/Node stack trace renders as the
	// StackTrace element (parsed frames, dimmed internals) rather than a plain
	// red row. Specialized tools above keep their own cards; this catches the
	// dynamic/MCP/generic tools that fall through here.
	const stack = extractStackTrace(part);
	if (stack) {
		return <StackTrace defaultOpen trace={stack} />;
	}

	// Dynamic tools (AI SDK `dynamic-tool` parts) carry their name in `toolName`
	// rather than the part type. Core emits MCP/agent tool calls this way (see
	// `ui_tool_input` in apps/core), so route them through the MCP renderer which
	// also surfaces the approval footer when the chat tool loop attaches one.
	if (partType === "dynamic-tool") {
		const dynName = (part.toolName as string | undefined) ?? "tool";
		const mcpInfo: McpToolInfo = {
			serverName: "mcp",
			toolName: dynName,
			displayName: dynName,
			category: "mcp",
		};
		return <McpTool chatStatus={chatStatus} mcpInfo={mcpInfo} part={part} />;
	}

	// MCP tools
	const mcpInfo = parseMcpToolType(partType);
	if (mcpInfo) {
		// Custom renderer for user-defined tools
		if (toolRenderers && mcpInfo.serverName === "user-tools") {
			const CustomRenderer = toolRenderers[mcpInfo.toolName];
			if (CustomRenderer) {
				return (
					<CustomRenderer
						input={(part.input ?? {}) as Record<string, unknown>}
						name={mcpInfo.toolName}
						output={part.output ? unwrapMcpOutput(part.output) : undefined}
						status={deriveToolStatus(part, chatStatus)}
					/>
				);
			}
		}
		return <McpTool chatStatus={chatStatus} mcpInfo={mcpInfo} part={part} />;
	}

	// Registry-based generic tools (Read, Grep, Glob, WebFetch, etc.)
	const meta = toolRegistry[partType];
	if (meta) {
		const { isPending, isError } = getToolStatus(part, chatStatus);
		return (
			<GenericTool
				isError={isError}
				isPending={isPending}
				subtitle={meta.subtitle?.(part) ?? formatLocations(part)}
				title={meta.title(part)}
			/>
		);
	}

	// Fallback: show tool name (+ the ACP locations it touched, when present).
	const toolName = partType.startsWith("tool-") ? partType.slice(5) : partType;
	const { isPending, isError } = getToolStatus(part, chatStatus);
	return (
		<GenericTool
			isError={isError}
			isPending={isPending}
			subtitle={formatLocations(part)}
			title={isPending ? `Running ${toolName}` : toolName}
		/>
	);
});
