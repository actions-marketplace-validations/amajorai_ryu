// apps/desktop/src/live/adapters/approvals.ts
//
// Built-in live-activity adapter for PENDING APPROVALS — the "needs your input"
// card. Reads the existing approvals react-query cache (invalidated live by
// `useApprovalEvents`, mounted app-wide) and publishes one card per pending
// request. A decided request is removed by the reconcile pass. Tapping the card
// opens the approval inbox.

import { useEffect } from "react";
import type { LiveActivity } from "@ryu/app-host/live-activity";
import type { ApprovalRequest } from "@/src/lib/api/approvals.ts";
import { useApprovals } from "@/src/hooks/useApprovals.ts";
import { useLiveActivityStore } from "@/src/store/useLiveActivityStore.ts";

const KIND_LABELS: Record<string, string> = {
	tool_call: "Tool call",
	workflow_gate: "Workflow gate",
	scheduled_run: "Scheduled run",
	trigger_run: "Trigger run",
	skill_synthesis: "Skill synthesis",
	heal_fix: "Heal fix",
};

function approvalToActivity(request: ApprovalRequest): LiveActivity {
	const kindLabel = KIND_LABELS[request.kind] ?? request.kind;
	const detail = request.summary || (request.title !== kindLabel ? request.title : "");
	return {
		id: `approval:${request.id}`,
		appId: "shell",
		kind: "approval",
		title: `${kindLabel} · ${request.title}`,
		detail: detail || "Waiting for your decision",
		status: "waiting",
		icon: "message-circle-question",
		startedAt: new Date(request.created_at).getTime(),
		updatedAt: new Date(request.created_at).getTime(),
		action: { kind: "route", path: "/inbox" },
	};
}

/** Reconcile the pending approval set against the registry. */
function reconcile(approvals: ApprovalRequest[]) {
	const store = useLiveActivityStore.getState();
	const pending = approvals.filter((a) => a.status === "pending");
	const desired = pending.map(approvalToActivity);
	const desiredIds = new Set(desired.map((a) => a.id));
	const existing = Object.keys(store.activities);
	for (const id of existing) {
		if (id.startsWith("approval:") && !desiredIds.has(id)) {
			store.remove(id);
		}
	}
	for (const activity of desired) {
		store.upsert(activity);
	}
}

/** Mount ONE app-wide reconciliation of pending approvals → live activities. The
 *  approvals query is invalidated by the approval-event stream, so this stays
 *  live without its own subscription. */
export function useApprovalLiveActivities(): void {
	const { approvals } = useApprovals();

	useEffect(() => {
		reconcile(approvals);
	}, [approvals]);
}
