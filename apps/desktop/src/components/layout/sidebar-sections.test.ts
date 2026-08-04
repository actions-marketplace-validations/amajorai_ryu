import { describe, expect, it } from "bun:test";
import {
	BUILTIN_SECTIONS,
	DEFAULT_SECTION_ORDER,
	isSectionKey,
	reconcileSectionOrder,
	SECTION_ICONS,
	SECTION_LABELS,
	type SectionKey,
} from "./sidebar-sections.ts";

// The order reconciliation is the load-bearing bit: it runs against whatever a
// user persisted on an older build, and losing their layout is a silent, per-user
// regression nobody reports. These cover the three ways a stored order drifts —
// it IS an old default (migrate), it is customised (preserve), or it names a
// section this build has never heard of (an app's, or a retired built-in).

describe("section vocabulary", () => {
	it("derives label + icon for every section in the default order", () => {
		expect(DEFAULT_SECTION_ORDER).toHaveLength(BUILTIN_SECTIONS.length);
		for (const key of DEFAULT_SECTION_ORDER) {
			expect(SECTION_LABELS[key]).toBeTruthy();
			expect(SECTION_ICONS[key]).toBeTruthy();
		}
	});

	it("accepts built-in and app-registered keys, rejects anything else", () => {
		expect(isSectionKey("chats")).toBe(true);
		expect(isSectionKey("plugin:@ryu/meetings:meetings")).toBe(true);
		expect(isSectionKey("definitely-not-a-section")).toBe(false);
	});
});

describe("reconcileSectionOrder", () => {
	it("migrates a stored order that is exactly a legacy default", () => {
		// Verbatim copy of the first legacy snapshot (pinned still at the bottom,
		// no `companions`) — a user who never customised anything on that build.
		const legacy = [
			"tabs",
			"agents",
			"teams",
			"projects",
			"chats",
			"spaces",
			"channels",
			"integrations",
			"plugins",
			"identities",
			"workflows",
			"skills",
			"mcp",
			"tools",
			"engines",
			"pinned",
			"archived",
		];
		expect(reconcileSectionOrder(legacy)).toEqual(DEFAULT_SECTION_ORDER);
	});

	it("migrates the pre-bottom-apps default (plugins/apps still in the middle)", () => {
		// The default persisted before `plugins`/`companions` moved to the bottom —
		// a user who never customised anything on that build.
		const legacy = [
			"tabs",
			"agents",
			"teams",
			"projects",
			"pinned",
			"chats",
			"spaces",
			"channels",
			"integrations",
			"plugins",
			"companions",
			"identities",
			"workflows",
			"skills",
			"mcp",
			"tools",
			"engines",
			"archived",
		];
		expect(reconcileSectionOrder(legacy)).toEqual(DEFAULT_SECTION_ORDER);
	});

	it("preserves a customised order verbatim", () => {
		// Archived dragged to the top — nothing missing, nothing unknown.
		const customised: SectionKey[] = [
			"archived",
			...DEFAULT_SECTION_ORDER.filter((k) => k !== "archived"),
		];
		expect(reconcileSectionOrder(customised)).toEqual(customised);
	});

	it("splices a never-seen built-in beside its default neighbour", () => {
		// A layout persisted before `companions` existed, but customised (pinned was
		// already promoted), so it must NOT take the legacy-migration path.
		const stored = DEFAULT_SECTION_ORDER.filter((k) => k !== "companions");
		const result = reconcileSectionOrder(stored);
		expect(result).toEqual(DEFAULT_SECTION_ORDER);
		// Specifically: right after its default predecessor, not appended at the end.
		expect(result.indexOf("companions")).toBe(result.indexOf("plugins") + 1);
	});

	it("keeps an app-registered section in its stored position", () => {
		const appKey = "plugin:@ryu/meetings:meetings";
		const stored = ["tabs", appKey, ...DEFAULT_SECTION_ORDER.slice(1)];
		const result = reconcileSectionOrder(stored);
		expect(result[1]).toBe(appKey);
		// The app's section survives even though the shell has no built-in entry for
		// it — that is the whole point of the `plugin:` seam.
		expect(result).toHaveLength(DEFAULT_SECTION_ORDER.length + 1);
	});

	it("drops unknown keys and de-duplicates", () => {
		const stored = [
			"tabs",
			"retired-section",
			"tabs",
			...DEFAULT_SECTION_ORDER.slice(1),
		];
		const result = reconcileSectionOrder(stored);
		expect(result).toEqual(DEFAULT_SECTION_ORDER);
	});
});
