// Renders the `data-ryu-workflow` part a workflow-as-chat-turn produces — a
// live per-node checklist of the DAG as it executes (planner → implementer →
// verifier …). Core emits repeated frames sharing `"id":"workflow-run"` so the
// AI SDK reconciles them into one part carrying the LATEST snapshot; the card
// therefore updates in place rather than stacking. See
// `apps/core/src/sidecar/adapters/mod.rs` (`route_workflow_chat_stream`).

import { TodoList } from "@ryu/ui/components/agents/todo-list";
import type { UIMessage } from "ai";

const WORKFLOW_PART_TYPE = "data-ryu-workflow";

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

/** The latest `data-ryu-workflow` snapshot on a message, or null. A repeated
 *  frame of the same type can arrive as a single object (in-place reconcile) or
 *  an array of frames (older merge behaviour); both are handled by taking the
 *  newest. */
export function extractWorkflowRun(msg: UIMessage): WorkflowRunProgress | null {
	const parts = (msg.parts ?? []) as Array<{ type?: string; data?: unknown }>;
	for (const part of parts) {
		if (part?.type !== WORKFLOW_PART_TYPE || !part.data) {
			continue;
		}
		const data = Array.isArray(part.data) ? part.data.at(-1) : part.data;
		if (data && typeof data === "object") {
			return data as WorkflowRunProgress;
		}
	}
	return null;
}

/** Map a workflow node status onto the TodoList vocabulary. "running" and
 *  "failed" have no TodoList twin, so they borrow "in-progress" / "cancelled"
 *  (the red X surface) — the animated ring of in-progress reads as "doing this
 *  step now", which is exactly what a running node means. */
const NODE_STATUS_TO_TODO = {
	pending: "pending",
	running: "in-progress",
	completed: "completed",
	failed: "cancelled",
	skipped: "cancelled",
} as const;

/** A workflow run rendered as a collapsible checklist: workflow name as the
 *  title, one row per node with a status ring/check. `collapseOnComplete` is
 *  off so the finished "planner → implementer → verifier" chain stays visible
 *  under the streamed answer instead of folding away the moment it finishes. */
export function WorkflowRunProgressCard({ msg }: { msg: UIMessage }) {
	const run = extractWorkflowRun(msg);
	if (!run) {
		return null;
	}
	const items = run.nodes.map((node) => ({
		id: node.id,
		title:
			node.kind && node.kind !== node.id
				? `${node.kind} · ${node.id}`
				: node.id,
		status: NODE_STATUS_TO_TODO[node.status] ?? "pending",
		detail: node.status === "failed" && node.error ? node.error : undefined,
	}));
	return (
		<TodoList
			collapseOnComplete={false}
			defaultOpen
			items={items}
			maxHeight={320}
			title={`Workflow: ${run.workflowName}`}
		/>
	);
}
