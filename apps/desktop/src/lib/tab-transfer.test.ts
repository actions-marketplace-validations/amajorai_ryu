import { describe, expect, test } from "bun:test";
import type { Tab } from "@/src/contexts/TabsContext.tsx";
import {
	canTearOutTab,
	registerTabSnapshot,
	snapshotTab,
} from "./tab-transfer.ts";

describe("tab transfer", () => {
	test("moves only one pane, preserving identity and tab-owned state", () => {
		const tab: Tab = {
			id: "pane-a",
			path: "/chat",
			title: "Research",
			conversationId: "conv-a",
			splitId: "split",
			groupId: "group",
			pinned: true,
			unloaded: true,
			busy: true,
			initialSubmit: true,
			initialProactiveOpening: true,
			initialPrompt: "Unsent text",
			initialProject: "/project",
			worktreeMode: true,
			mountContext: { documentId: "doc-a" },
		};
		const moved = snapshotTab(tab);
		expect(moved).toMatchObject({
			id: "pane-a",
			path: "/chat",
			conversationId: "conv-a",
			pinned: true,
			initialPrompt: "Unsent text",
			initialProject: "/project",
			worktreeMode: true,
			mountContext: { documentId: "doc-a" },
			unloaded: false,
		});
		expect(moved.splitId).toBeUndefined();
		expect(moved.groupId).toBeUndefined();
		expect(moved.busy).toBeUndefined();
		expect(moved.initialSubmit).toBeUndefined();
		expect(moved.initialProactiveOpening).toBeUndefined();
		expect(tab.splitId).toBe("split");
	});

	test("reads live unsaved state at transfer time and releases unmounted readers", () => {
		const tab = {
			id: "draft",
			path: "/chat",
			title: "Draft",
			initialPrompt: "Old seed",
		};
		let draft = "First edit";
		const cleanup = registerTabSnapshot(tab.id, () => ({
			initialPrompt: draft,
			initialModel: "chosen-model",
		}));
		draft = "Latest unsent edit";
		expect(snapshotTab(tab).initialPrompt).toBe(draft);
		const replace = registerTabSnapshot(tab.id, () => ({
			initialPrompt: "New mount",
		}));
		cleanup();
		expect(snapshotTab(tab).initialPrompt).toBe("New mount");
		replace();
		expect(snapshotTab(tab).initialPrompt).toBe("Old seed");
	});

	test("failed serialization does not mutate the source", () => {
		const tab = { id: "unsaved", path: "/chat", title: "Temporary chat" };
		const cleanup = registerTabSnapshot(tab.id, () => {
			throw new Error("Cannot resume temporary history");
		});
		expect(() => snapshotTab(tab)).toThrow("Cannot resume temporary history");
		expect(tab.id).toBe("unsaved");
		cleanup();
	});

	test("accepted drops, reference copies, held buttons, and Escape never tear out", () => {
		expect(canTearOutTab("none", 0, false)).toBe(true);
		expect(canTearOutTab("move", 0, false)).toBe(false);
		expect(canTearOutTab("copy", 0, false)).toBe(false);
		expect(canTearOutTab("none", 1, false)).toBe(false);
		expect(canTearOutTab("none", 0, true)).toBe(false);
	});
});
