import { CodeBlock } from "@ryu/ui/components/agents/code-block";
import {
	ToolResult,
	ToolResultOutput,
} from "@ryu/ui/components/agents/tool-result";
import { memo, useMemo } from "react";
import { unwrapMcpOutput } from "../utils/unwrap-mcp-output.ts";

type SandboxStatus = "running" | "completed" | "error";

function deriveStatus(part: any, chatStatus?: string): SandboxStatus {
	if (part.state === "output-error") {
		return "error";
	}
	if (part.state === "output-available") {
		return "completed";
	}
	if (chatStatus === "streaming" || part.state === "input-streaming") {
		return "running";
	}
	return part.output ? "completed" : "running";
}

function extractCode(part: any): string {
	const input = (part.input ?? part.args ?? {}) as Record<string, unknown>;
	const raw = input.code ?? input.command ?? input.script ?? input.source;
	return typeof raw === "string" ? raw : "";
}

function extractLogs(output: unknown): string {
	if (output == null) {
		return "";
	}
	const unwrapped = unwrapMcpOutput(output);
	if (typeof unwrapped === "string") {
		return unwrapped;
	}
	if (typeof unwrapped === "object") {
		const record = unwrapped as Record<string, unknown>;
		const logs = Array.isArray(record.logs)
			? record.logs.join("\n")
			: typeof record.logs === "string"
				? record.logs
				: "";
		const result = record.result ?? record.value ?? record.returnValue;
		const segments: string[] = [];
		if (logs) {
			segments.push(logs);
		}
		if (result !== undefined && result !== null) {
			segments.push(
				typeof result === "string" ? result : JSON.stringify(result, null, 2)
			);
		}
		if (segments.length > 0) {
			return segments.join("\n");
		}
		return JSON.stringify(unwrapped, null, 2);
	}
	return String(unwrapped);
}

const MAX_DISPLAY_CHARS = 6000;

function clampCode(code: string): string {
	return code.length > MAX_DISPLAY_CHARS
		? `${code.slice(0, MAX_DISPLAY_CHARS)}\n…`
		: code;
}

export interface SandboxToolProps {
	chatStatus?: string;
	language?: string;
	part: any;
	title?: string;
}

/**
 * Renders an AI-generated code program alongside its execution output, mirroring
 * the AI SDK "Sandbox" element. The producer is a code-execution tool part —
 * Core's programmatic-tool-calling `execute` (input.code + logs) or any tool
 * carrying `input.code`/`input.command` and an output. Code renders through the
 * beUI CodeBlock, output through the beUI ToolResult disclosure.
 */
export const SandboxTool = memo(function SandboxTool({
	part,
	chatStatus,
	title,
	language = "typescript",
}: SandboxToolProps) {
	const status = deriveStatus(part, chatStatus);
	const code = useMemo(() => clampCode(extractCode(part)), [part]);
	const logs = useMemo(() => extractLogs(part.output), [part.output]);
	const hasLogs = logs.trim().length > 0;

	const headerTitle =
		title ?? ((part.input?.filename as string | undefined) || "Code sandbox");

	return (
		<div className="an-tool-sandbox">
			<ToolResult
				collapseOnComplete={false}
				kind="terminal"
				status={
					status === "error"
						? "error"
						: status === "running"
							? "running"
							: "success"
				}
				title={headerTitle}
				tool="sandbox"
			>
				<div className="flex flex-col gap-2">
					{code ? (
						<CodeBlock
							code={code}
							filename={headerTitle}
							language={
								language as
									| "typescript"
									| "bash"
									| "json"
									| "text"
									| "tsx"
									| "diff"
							}
							maxHeight={360}
							status={status === "running" ? "streaming" : "complete"}
							wrap
						/>
					) : null}
					{hasLogs ? (
						<div className="overflow-hidden rounded-xl bg-muted/80">
							<div className="p-3">
								<ToolResultOutput language="text">{logs}</ToolResultOutput>
							</div>
						</div>
					) : status === "running" ? (
						<p className="py-1 text-muted-foreground text-xs">
							Waiting for output…
						</p>
					) : null}
				</div>
			</ToolResult>
		</div>
	);
});
