import { useCallback, useMemo, useSyncExternalStore } from "react";
import { toTarget } from "@/src/lib/api/client.ts";
import { getRunsSnapshot, subscribeRuns } from "@/src/lib/api/run-store.ts";
import { useActiveNode } from "./useActiveNode.ts";

export interface RunSummary {
	agent_id: string | null;
	branch: string | null;
	created_at: number;
	folder_path: string | null;
	id: string;
	message_count: number;
	run_status: string | null;
	title: string | null;
	updated_at: number;
	worktree_path: string | null;
}

/** One credential-scoped feed shared by Layout and all run-history views. */
export function useRuns() {
	const { url, token, userJwt } = useActiveNode();
	const target = useMemo(
		() => toTarget({ url, token, userJwt }),
		[url, token, userJwt]
	);
	const subscribe = useCallback(
		(listener: () => void) => subscribeRuns(target, listener),
		[target]
	);
	const snapshot = useCallback(() => getRunsSnapshot(target), [target]);
	const runs = useSyncExternalStore(subscribe, snapshot, snapshot);
	return { runs };
}
