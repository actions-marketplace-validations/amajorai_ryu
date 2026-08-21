import { unwrapMcpOutput } from "../utils/unwrap-mcp-output.ts";

export interface AgentMessageToolPart {
	input?: unknown;
	output?: unknown;
	result?: unknown;
	state?: string;
	toolName?: string;
	type?: string;
}

export type AgentMessageKind = "ask" | "send";

export interface AgentMessagePayload {
	from?: string;
	kind: AgentMessageKind;
	reply?: string;
	text: string;
	to: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function readString(record: Record<string, unknown> | null, key: string) {
	const value = record?.[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function readAgentMessageOutput(part: AgentMessageToolPart): unknown {
	if (part.output !== undefined && part.output !== null) {
		return unwrapMcpOutput(part.output);
	}
	return part.result === undefined ? undefined : unwrapMcpOutput(part.result);
}

/** Recognize both MCP wire parts and the AI SDK's dynamic-tool form. */
export function isAgentMessageToolPart(
	partType: string,
	toolName?: string
): boolean {
	return (
		toolName === "agents.send" ||
		toolName === "agents.ask" ||
		partType === "tool-agents.send" ||
		partType === "tool-agents.ask" ||
		partType.endsWith(".agents.send") ||
		partType.endsWith(".agents.ask")
	);
}

function messageKind(part: AgentMessageToolPart): AgentMessageKind {
	const type = part.type ?? "";
	return part.toolName === "agents.ask" ||
		type === "tool-agents.ask" ||
		type.endsWith(".agents.ask")
		? "ask"
		: "send";
}

/** Read send/ask arguments and the host-derived sender from a tool part. */
export function readAgentMessagePayload(
	part: AgentMessageToolPart
): AgentMessagePayload | null {
	const kind = messageKind(part);
	const input = unwrapMcpOutput(part.input);
	const inputRecord = isRecord(input) ? input : null;
	const output = readAgentMessageOutput(part);
	const outputRecord = isRecord(output) ? output : null;
	const to = readString(inputRecord, "to") ?? readString(outputRecord, "to");
	const text =
		(kind === "ask"
			? (readString(inputRecord, "question") ??
				readString(outputRecord, "question"))
			: (readString(inputRecord, "text") ??
				readString(outputRecord, "text"))) ??
		readString(inputRecord, "text") ??
		readString(outputRecord, "text");
	if (!(to && text)) {
		return null;
	}
	return {
		from: readString(outputRecord, "from"),
		kind,
		reply: kind === "ask" ? readString(outputRecord, "reply") : undefined,
		text,
		to,
	};
}
