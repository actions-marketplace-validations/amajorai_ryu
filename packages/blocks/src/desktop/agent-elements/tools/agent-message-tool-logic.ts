import { unwrapMcpOutput } from "../utils/unwrap-mcp-output.ts";

export interface AgentMessageToolPart {
	input?: unknown;
	output?: unknown;
	result?: unknown;
	state?: string;
	type?: string;
}

export interface AgentMessagePayload {
	from?: string;
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
		toolName === "agents__send" ||
		partType === "tool-agents__send" ||
		partType.endsWith("__agents__send")
	);
}

/** Read the send arguments and the host-derived sender from a tool part. */
export function readAgentMessagePayload(
	part: AgentMessageToolPart
): AgentMessagePayload | null {
	const input = unwrapMcpOutput(part.input);
	const inputRecord = isRecord(input) ? input : null;
	const output = readAgentMessageOutput(part);
	const outputRecord = isRecord(output) ? output : null;
	const to = readString(inputRecord, "to") ?? readString(outputRecord, "to");
	const text =
		readString(inputRecord, "text") ?? readString(outputRecord, "text");
	if (!to || !text) {
		return null;
	}
	return {
		from: readString(outputRecord, "from"),
		text,
		to,
	};
}
