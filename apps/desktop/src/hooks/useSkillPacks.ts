// apps/desktop/src/hooks/useSkillPacks.ts
//
// Core-backed hook for the shared Skills catalog's Packs shelf. Feeds the
// `@ryu/marketplace` `SkillPacksState` shape with live data from the active
// node's `/api/skills/packs*` surface: the pack list, the opened pack's members,
// and install-pack. TanStack Query caches the list per node; the opened pack is
// a per-id query, and install is a mutation that invalidates the list + the
// catalog list (a pack install changes which skills show as installed).

import {
	keepPreviousData,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import {
	fetchSkillPackDetail,
	fetchSkillPacks,
	installSkillPack,
} from "@/src/lib/api/skills.ts";
import { useActiveNode } from "./useActiveNode.ts";

/** Query descriptors shared with the Store's warm-up path (`useStorePrefetch`),
 *  so a prefetch can never land under a key no hook reads. */
export function skillPacksQuery(target: ApiTarget) {
	return {
		queryKey: ["skills", "packs", target.url],
		queryFn: () => fetchSkillPacks(target),
	};
}

export function skillPackDetailQuery(target: ApiTarget, id: string) {
	return {
		queryKey: ["skills", "packs", "detail", target.url, id],
		queryFn: () => fetchSkillPackDetail(target, id),
	};
}

export function useSkillPacks() {
	const activeNode = useActiveNode();
	const target: ApiTarget = {
		url: activeNode.url,
		token: activeNode.token ?? null,
	};
	const { url, token } = target;
	const qc = useQueryClient();

	const [opening, setOpening] = useState<string | null>(null);

	const listQuery = useQuery({
		...skillPacksQuery(target),
		placeholderData: keepPreviousData,
	});

	const openedId = opening;

	const detailQuery = useQuery({
		queryKey: ["skills", "packs", "detail", url, openedId],
		queryFn: () => fetchSkillPackDetail({ url, token }, openedId as string),
		enabled: openedId !== null,
	});

	// A pack's members install through the same per-skill paths the catalog uses,
	// so installing a pack invalidates the pack list (counts) AND the catalog list
	// (installed flags) — one mutation, both caches.
	const installMutation = useMutation({
		mutationFn: (id: string) => installSkillPack({ url, token }, id),
		onSettled: () => {
			Promise.resolve(
				qc.invalidateQueries({ queryKey: ["skills", "packs", url] })
			).catch(() => undefined);
			Promise.resolve(
				qc.invalidateQueries({ queryKey: ["skills", "list", url] })
			).catch(() => undefined);
			Promise.resolve(
				qc.invalidateQueries({ queryKey: ["skills", "detail", url] })
			).catch(() => undefined);
			Promise.resolve(
				qc.invalidateQueries({ queryKey: ["skills", "installed", url] })
			).catch(() => undefined);
		},
	});

	const install = useCallback(
		(id: string) => installMutation.mutateAsync(id),
		[installMutation]
	);

	const open = useCallback((id: string) => {
		setOpening(id || null);
	}, []);

	// An empty id means "back to the shelf" — the opened pack's query is disabled
	// on null, so this both closes the view and drops the detail fetch.
	useEffect(() => {
		if (openedId === null) {
			return;
		}
	}, [openedId]);

	return {
		packs: listQuery.data ?? [],
		loading: listQuery.isLoading,
		error: listQuery.error instanceof Error ? listQuery.error.message : null,
		open,
		opened: detailQuery.data ?? null,
		opening,
		installing: installMutation.isPending ? openedId : null,
		install,
		refresh: () => {
			Promise.resolve(
				qc.invalidateQueries({ queryKey: ["skills", "packs", url] })
			).catch(() => undefined);
		},
	};
}
