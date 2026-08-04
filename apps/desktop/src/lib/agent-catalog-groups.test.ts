// apps/desktop/src/lib/agent-catalog-groups.test.ts
//
// Tests for the Store Agents tab's shelving. The property that matters most is
// totality: `groupAgents` must place every catalog entry in exactly one group.
// The tab has no filter of its own, so a gap here would look to a user exactly
// like the bug this shelving shipped alongside — agents "disappearing" from the
// Store — while the catalog endpoint was returning them all along.

import { describe, expect, it } from "bun:test";
import type { AgentCatalogEntry } from "@/src/lib/api/agents.ts";
import {
	AGENT_GROUPS,
	groupAgents,
	groupOf,
	POPULAR_AGENT_IDS,
} from "./agent-catalog-groups.ts";

function entry(over: Partial<AgentCatalogEntry> = {}): AgentCatalogEntry {
	return {
		added: false,
		available: true,
		bridgeVersionStatus: null,
		description: null,
		detected: null,
		engine: null,
		gatewayBypass: false,
		iconUrl: null,
		id: "acp:example",
		installedBridgeVersion: null,
		installedVersion: null,
		installHint: null,
		latestBridgeVersion: null,
		latestVersion: null,
		name: "Example",
		recommended: false,
		registryId: null,
		transport: "acp",
		versionStatus: null,
		...over,
	};
}

describe("groupOf", () => {
	it("files an installed agent under Installed even when it is also detected", () => {
		expect(groupOf(entry({ added: true, detected: true }))).toBe("installed");
	});

	it("files a detected-but-not-added agent under On this machine", () => {
		expect(groupOf(entry({ detected: true }))).toBe("detected");
	});

	it("does not read a null detected flag as 'not detected'", () => {
		// Managed sidecars have no binary to probe. They belong on a browsable
		// shelf, not one whose heading claims we looked and came up empty.
		expect(groupOf(entry({ id: "zeroclaw", detected: null }))).toBe("popular");
	});

	it("shelves well-known agents under Popular and the rest under More agents", () => {
		expect(groupOf(entry({ id: "acp:claude" }))).toBe("popular");
		expect(groupOf(entry({ id: "acp:some-newcomer" }))).toBe("available");
	});

	it("segregates agents with no spawn plan rather than scattering dead cards", () => {
		expect(groupOf(entry({ available: false }))).toBe("unavailable");
	});

	it("keeps an installed agent visible even if it is unavailable on this platform", () => {
		expect(groupOf(entry({ added: true, available: false }))).toBe("installed");
	});
});

describe("groupAgents", () => {
	const catalog = [
		entry({ id: "ryu", added: true }),
		entry({ id: "acp:codex", detected: true }),
		entry({ id: "acp:gemini" }),
		entry({ id: "acp:kilo" }),
		entry({ id: "acp:poolside", available: false }),
	];

	it("places every entry in exactly one group", () => {
		const groups = groupAgents(catalog);
		const ids = groups.flatMap((g) => g.items.map((i) => i.id));
		expect(ids.length).toBe(catalog.length);
		expect(new Set(ids).size).toBe(catalog.length);
	});

	it("emits groups in display order and drops empty ones", () => {
		const groups = groupAgents(catalog);
		expect(groups.map((g) => g.key)).toEqual([
			"installed",
			"detected",
			"popular",
			"available",
			"unavailable",
		]);

		const onlyPopular = groupAgents([entry({ id: "acp:claude" })]);
		expect(onlyPopular.map((g) => g.key)).toEqual(["popular"]);
	});

	it("preserves the caller's ordering inside a group", () => {
		const groups = groupAgents([
			entry({ id: "acp:b", detected: true, name: "B" }),
			entry({ id: "acp:a", detected: true, name: "A" }),
		]);
		expect(groups[0]?.items.map((i) => i.name)).toEqual(["B", "A"]);
	});

	it("returns no groups for an empty catalog", () => {
		expect(groupAgents([])).toEqual([]);
	});
});

describe("group metadata", () => {
	it("labels every group key exactly once", () => {
		const keys = AGENT_GROUPS.map((g) => g.key);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it("includes the flagship in the popular set so it never lands in More agents", () => {
		expect(POPULAR_AGENT_IDS.has("ryu")).toBe(true);
	});
});
