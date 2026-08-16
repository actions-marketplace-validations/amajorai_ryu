import type { UIMessage } from "ai";

export interface WorkflowNodeProgress {
	error?: string | null;
	id: string;
	kind?: string | null;
	output?: string | null;
	status: "pending" | "running" | "completed" | "failed" | "skipped";
}

export interface WorkflowRunProgress {
	/** Stable part id — every frame re-emits this so the SDK reconciles in place. */
	id: string;
	nodes: WorkflowNodeProgress[];
	runId: string;
	status: "running" | "completed" | "failed" | "awaiting_input";
	workflowId: string;
	workflowName: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isWorkflowNodeProgress(value: unknown): value is WorkflowNodeProgress {
	if (!isRecord(value)) {
		return false;
	}
	return (
		typeof value.id === "string" &&
		(value.status === "pending" ||
			value.status === "running" ||
			value.status === "completed" ||
			value.status === "failed" ||
			value.status === "skipped")
	);
}

export function isWorkflowRunProgress(
	value: unknown
): value is WorkflowRunProgress {
	if (!isRecord(value)) {
		return false;
	}
	return (
		typeof value.id === "string" &&
		typeof value.runId === "string" &&
		typeof value.workflowId === "string" &&
		typeof value.workflowName === "string" &&
		(value.status === "running" ||
			value.status === "completed" ||
			value.status === "failed" ||
			value.status === "awaiting_input") &&
		Array.isArray(value.nodes) &&
		value.nodes.every(isWorkflowNodeProgress)
	);
}

/** The latest `data-ryu-workflow` snapshot on a message, or null. */
export function extractWorkflowRun(
	msg: Pick<UIMessage, "parts">
): WorkflowRunProgress | null {
	const parts = msg.parts ?? [];
	for (const part of parts) {
		if (part.type !== "data-ryu-workflow" || !part.data) {
			continue;
		}
		const data = Array.isArray(part.data) ? part.data.at(-1) : part.data;
		if (isWorkflowRunProgress(data)) {
			return data;
		}
	}
	return null;
}
