// apps/desktop/src/hooks/useCommunityAgents.ts
//
// The community shelf of the Store's Agents tab: agents PUBLISHED by other users
// (instructions + model preference + declared dependencies), as opposed to the
// ACP runtimes (Claude Code, Codex, …) that `useAgentsCatalog` browses.
//
// It reads two different servers, on purpose:
//   • BROWSE goes to the control plane (`fetchCatalog("agent")`, :3000) — that is
//     where published listings, pricing and moderation live, and it is the only
//     surface that sees them. A signed-out user still gets the list.
//   • INSTALL goes to the NODE (`POST /api/agents/published/install`, Core) —
//     Core resolves the listing through its own catalog seam, strips the
//     privilege-bearing bindings, and returns what it removed as `requires`.
//
// Install is never a client-side materialisation of the payload: the trust
// boundary for third-party agent definitions is Core's
// `AgentTemplate::sanitize_for_untrusted_install`, and routing around it (e.g.
// through `POST /api/agents/import`, which is deliberately unsanitised because it
// exists for re-importing your OWN export) would move that decision into the UI
// where it would silently drift.
//
// The money layer being unavailable (signed out, no org, network) must never
// break the Agents tab, so the browse error is reported, not thrown.

import { useCallback, useEffect, useState } from "react";
import {
	installPublishedAgent,
	type PublishedAgentInstallResult,
} from "@/src/lib/api/agents.ts";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import {
	fetchCatalog,
	type MarketplaceCard,
} from "@/src/lib/api/marketplace.ts";
import { triggerAgentsRefresh } from "@/src/lib/core-refresh.ts";
import { useActiveNode } from "./useActiveNode.ts";

export interface UseCommunityAgentsResult {
	/** Published agent listings, newest-first as the server ranks them. */
	agents: MarketplaceCard[];
	/** Why the listing browse failed, or null. Never fatal to the tab. */
	error: string | null;
	/** Install one listing as a new local agent. Resolves with what Core stripped. */
	install: (id: string) => Promise<PublishedAgentInstallResult>;
	loading: boolean;
	/** Listing id whose install is in flight, or null. */
	pendingId: string | null;
	refresh: () => Promise<void>;
}

export function useCommunityAgents(): UseCommunityAgentsResult {
	const activeNode = useActiveNode();
	const target: ApiTarget = {
		url: activeNode.url,
		token: activeNode.token ?? null,
	};
	const { url, token } = target;

	const [agents, setAgents] = useState<MarketplaceCard[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [pendingId, setPendingId] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			setAgents(await fetchCatalog("agent"));
			setError(null);
		} catch (e) {
			setAgents([]);
			setError(
				e instanceof Error ? e.message : "Couldn't load community agents"
			);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		load().catch(() => undefined);
	}, [load]);

	const install = useCallback(
		async (id: string) => {
			setPendingId(id);
			try {
				const result = await installPublishedAgent({ url, token }, id);
				// A published agent lands as a new local agent record, so the roster
				// every always-mounted surface reads (sidebar, picker, Library) is now
				// stale — the same refresh the runtime catalog fires on install.
				triggerAgentsRefresh();
				return result;
			} finally {
				setPendingId(null);
			}
		},
		[url, token]
	);

	return { agents, error, install, loading, pendingId, refresh: load };
}
