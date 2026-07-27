// apps/desktop/src/store/useProjectDockStore.test.ts

import { beforeEach, describe, expect, test } from "bun:test";
import {
	useProjectDockStore,
	visibleProjectDockTabs,
} from "./useProjectDockStore.ts";

beforeEach(() => {
	useProjectDockStore.setState({ byFolder: {} });
	try {
		localStorage.removeItem("ryu_pinned_dock_tabs");
	} catch {
		// ignore
	}
});

describe("useProjectDockStore", () => {
	test("pinning makes a tab visible to every chat in the folder", () => {
		const folder = "/tmp/proj";
		const entry = useProjectDockStore.getState().addTab(folder, {
			kind: "terminal",
			label: "Terminal",
			side: "bottom",
			pinned: false,
			ownerTabId: "chat-a",
		});

		expect(
			visibleProjectDockTabs(
				useProjectDockStore.getState().byFolder[folder] ?? [],
				"bottom",
				"chat-b"
			)
		).toEqual([]);

		useProjectDockStore.getState().togglePin(folder, entry.uid);

		const visible = visibleProjectDockTabs(
			useProjectDockStore.getState().byFolder[folder] ?? [],
			"bottom",
			"chat-b"
		);
		expect(visible).toHaveLength(1);
		expect(visible[0]?.uid).toBe(entry.uid);
		expect(visible[0]?.pinned).toBe(true);
	});

	test("clearOwner drops unpinned tabs but keeps pinned ones", () => {
		const folder = "/tmp/proj";
		const unpinned = useProjectDockStore.getState().addTab(folder, {
			kind: "terminal",
			label: "Terminal",
			side: "bottom",
			pinned: false,
			ownerTabId: "chat-a",
		});
		const pinned = useProjectDockStore.getState().addTab(folder, {
			kind: "files",
			label: "Files",
			side: "right",
			pinned: true,
			ownerTabId: "chat-a",
		});

		useProjectDockStore.getState().clearOwner(folder, "chat-a");
		const left = useProjectDockStore.getState().byFolder[folder] ?? [];
		expect(left.map((t) => t.uid)).toEqual([pinned.uid]);
		expect(left.some((t) => t.uid === unpinned.uid)).toBe(false);
	});
});
