import { AgentActivity } from "@ryu/ui/components/agents/agent-activity";
import { memo, useMemo } from "react";
import { getToolStatus } from "../utils/format-tool.ts";
import { toolRegistry } from "./tool-registry.ts";

export interface ToolGroupProps {
	chatStatus?: string;
	completeLabel: string;
	defaultOpen?: boolean;
	interruptedLabel: string;
	maxVisibleTools?: number;
	nestedTools?: any[];
	part: any;
	shimmerLabel?: string;
	showElapsed?: boolean;
}

function formatCount(value: number, label: string): string {
	return `${value} ${value === 1 ? label : `${label}s`}`;
}

function summarizeNestedTools(nestedTools: any[]): string {
	if (nestedTools.length === 0) {
		return "";
	}
	const fileTypes = new Set(["tool-Read", "tool-Edit", "tool-Write"]);
	const searchTypes = new Set([
		"tool-Search",
		"tool-Grep",
		"tool-Glob",
		"tool-WebSearch",
	]);
	const commandTypes = new Set(["tool-Bash"]);

	let fileCount = 0;
	let searchCount = 0;
	let commandCount = 0;

	for (const tool of nestedTools) {
		if (fileTypes.has(tool.type)) {
			fileCount += 1;
		} else if (searchTypes.has(tool.type)) {
			searchCount += 1;
		} else if (commandTypes.has(tool.type)) {
			commandCount += 1;
		}
	}

	const parts: string[] = [];
	if (fileCount > 0) {
		parts.push(formatCount(fileCount, "file"));
	}
	if (searchCount > 0) {
		parts.push(`${searchCount} ${searchCount === 1 ? "search" : "searches"}`);
	}
	if (commandCount > 0) {
		parts.push(formatCount(commandCount, "command"));
	}

	if (parts.length === 0) {
		return "";
	}
	if (parts.length === 1) {
		return parts[0];
	}
	if (parts.length === 2) {
		return `${parts[0]} and ${parts[1]}`;
	}
	return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

/** Map a nested ACP tool part onto a beUI AgentActivity trace item. */
function toTraceItem(part: any, index: number) {
	const meta = toolRegistry[part.type];
	const label = meta?.title(part) ?? part.type?.replace("tool-", "") ?? "Tool";
	const detail = meta?.subtitle?.(part);
	return {
		id: part.toolCallId ?? `${part.type}-${index}`,
		type: "trace" as const,
		kind: "message" as const,
		label,
		detail,
	};
}

export const ToolGroup = memo(function ToolGroup({
	part,
	nestedTools = [],
	chatStatus,
	completeLabel,
	shimmerLabel,
	interruptedLabel,
	maxVisibleTools = 5,
	defaultOpen,
}: ToolGroupProps) {
	const { isPending, isInterrupted } = getToolStatus(part, chatStatus);
	const description = part.input?.description || "";
	const hasNestedTools = nestedTools.length > 0;

	const subtitle = (() => {
		if (hasNestedTools) {
			return summarizeNestedTools(nestedTools);
		}
		if (!description) {
			return "";
		}
		return description.length > 60
			? `${description.slice(0, 57)}...`
			: description;
	})();

	const items = useMemo(
		() => nestedTools.slice(0, maxVisibleTools).map((nestedPart, idx) => toTraceItem(nestedPart, idx)),
		[nestedTools, maxVisibleTools]
	);

	if (isInterrupted && !part.output) {
		return (
			<span className="text-muted-foreground text-sm">{interruptedLabel}</span>
		);
	}

	const summary = subtitle
		? `${completeLabel} · ${subtitle}`
		: completeLabel;

	return (
		<AgentActivity
			activeLabel={shimmerLabel ?? "Working"}
			collapseOnComplete={false}
			contentType="trace"
			defaultOpen={defaultOpen}
			items={items}
			status={isPending ? "working" : "complete"}
			summary={summary}
		/>
	);
});
