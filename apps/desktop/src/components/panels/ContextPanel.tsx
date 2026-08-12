// apps/desktop/src/components/panels/ContextPanel.tsx
//
// The data half of the Context dock tab: fetches Core's per-category token
// attribution for the open conversation and hands it to the presentational
// `ContextBreakdownPanel` in `@ryu/blocks`. Opened by clicking the composer's
// context ring (see `ChatPage` → `WorkspacePanels`).
//
// Attribution is computed per turn and cached in Core's memory, so this refetches
// whenever the live usage changes — a completed turn moves the ring AND replaces
// the breakdown, and those must not drift apart on screen.

import type { ContextBreakdownData } from "@ryu/blocks/desktop/agent-elements/context-breakdown.tsx";
import { ContextBreakdownPanel } from "@ryu/blocks/desktop/agent-elements/context-breakdown.tsx";
import type { ContextUsage } from "@ryu/blocks/desktop/agent-elements/context-usage.tsx";
import { useEffect, useState } from "react";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import { getContextBreakdown } from "@/src/lib/api/context-breakdown.ts";

/** Everything the tab needs to render the open chat's context, passed live (not
 *  snapshotted at open time) so the panel tracks the conversation it is in. */
export interface ContextPanelView {
	conversationId?: string | null;
	target: ApiTarget;
	/** The same usage the composer ring shows; supplies the reported token count. */
	usage?: ContextUsage | null;
}

export function ContextPanel({ view }: { view?: ContextPanelView | null }) {
	const [breakdown, setBreakdown] = useState<ContextBreakdownData | null>(null);
	const conversationId = view?.conversationId ?? null;
	const target = view?.target;
	// Refetch key: the reported token count changes exactly when a turn completes,
	// which is also when Core records a new breakdown.
	const used = view?.usage?.used ?? 0;

	useEffect(() => {
		if (!(conversationId && target)) {
			setBreakdown(null);
			return;
		}
		let cancelled = false;
		getContextBreakdown(target, conversationId).then((next) => {
			if (!cancelled) {
				setBreakdown(next);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [conversationId, target, used]);

	if (!conversationId) {
		return (
			<div className="flex h-full items-center justify-center p-4 text-center text-muted-foreground text-xs">
				Open a chat to see its context breakdown.
			</div>
		);
	}
	return (
		<ContextBreakdownPanel breakdown={breakdown} usage={view?.usage ?? null} />
	);
}
