// apps/desktop/src/lib/agent-catalog-groups.ts
//
// Shelving for the Store's Agents tab. Core's `GET /api/agents/catalog` returns
// every agent it knows about, annotated with three independent flags (`added`,
// `detected`, `available`); this module turns those flags into the ordered,
// mutually exclusive groups the tab renders.
//
// It is a *presentation* of the catalog, never a filter: `groupAgents` is total
// over its input, so every entry Core sends lands in exactly one group and no
// agent can silently vanish from the tab.

import type { AgentCatalogEntry } from "@/src/lib/api/agents.ts";

/**
 * Agents most people arrive looking for. A local list on purpose: "popular" here
 * means well-known, not measured — Core publishes no popularity signal, and
 * inventing one server-side to drive a store shelf would be a much bigger change
 * than the shelf deserves. Ids are Core's canonical catalog ids (`canonical_agent_id`
 * in `acp_registry.rs` maps the ACP registry's own ids onto these).
 */
export const POPULAR_AGENT_IDS: ReadonlySet<string> = new Set([
	"ryu",
	"acp:claude",
	"acp:codex",
	"acp:gemini",
	"acp:pi",
	"openclaw",
	"zeroclaw",
	"hermes",
	"acp:cursor",
	"acp:copilot",
	"acp:qwen",
	"acp:goose",
	"acp:opencode",
	"acp:devin",
	"acp:openhands",
	"acp:prime",
	"acp:blackbox",
	"acp:code-assistant",
	"acp:construct",
]);

export type AgentGroupKey =
	| "installed"
	| "detected"
	| "popular"
	| "available"
	| "unavailable";

export interface AgentGroup {
	items: AgentCatalogEntry[];
	key: AgentGroupKey;
	label: string;
}

/** Display order of the shelves. Also the precedence order used by `groupOf`. */
export const AGENT_GROUPS: { key: AgentGroupKey; label: string }[] = [
	{ key: "installed", label: "Installed" },
	{ key: "detected", label: "On this machine" },
	{ key: "popular", label: "Popular" },
	{ key: "available", label: "More agents" },
	{ key: "unavailable", label: "Needs manual install" },
];

/**
 * The one group an entry belongs to. First match wins, which is what makes the
 * groups mutually exclusive — an installed agent that is also on PATH appears
 * once, under Installed.
 *
 * `detected` is a tri-state: `true` (CLI found on PATH), `false` (we looked and
 * did not find it), and `null` for agents with nothing to look for (managed
 * sidecars, and `ryu` itself). Only an explicit `true` earns the "On this machine"
 * shelf — treating `null` as "not detected" would file every managed agent under a
 * heading that claims a check we never ran.
 */
export function groupOf(entry: AgentCatalogEntry): AgentGroupKey {
	if (entry.added) {
		return "installed";
	}
	if (entry.detected === true) {
		return "detected";
	}
	// An entry Core can't spawn (empty ACP spawn command) is still listed — it is
	// discoverable and installable by hand — but it gets its own shelf rather than
	// scattering disabled "Unavailable" cards through the browsable groups.
	if (!entry.available) {
		return "unavailable";
	}
	return POPULAR_AGENT_IDS.has(entry.id) ? "popular" : "available";
}

/** Bucket agents into the display groups in `AGENT_GROUPS` order, dropping empties. */
export function groupAgents(agents: AgentCatalogEntry[]): AgentGroup[] {
	const buckets = new Map<AgentGroupKey, AgentCatalogEntry[]>();
	for (const entry of agents) {
		const key = groupOf(entry);
		const bucket = buckets.get(key);
		if (bucket) {
			bucket.push(entry);
		} else {
			buckets.set(key, [entry]);
		}
	}
	return AGENT_GROUPS.map(({ key, label }) => ({
		key,
		label,
		items: buckets.get(key) ?? [],
	})).filter((group) => group.items.length > 0);
}
