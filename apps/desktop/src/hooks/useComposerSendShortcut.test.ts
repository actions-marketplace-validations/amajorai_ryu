import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) {
	GlobalRegistrator.register();
}

import { beforeEach, describe, expect, test } from "bun:test";
import { listSettings } from "@/src/lib/settings-registry.ts";
import {
	COMPOSER_SEND_SHORTCUT_KEY,
	DEFAULT_COMPOSER_SEND_SHORTCUT,
	readComposerSendShortcut,
	setComposerSendShortcut,
	subscribeComposerSendShortcut,
} from "./useComposerSendShortcut.ts";

beforeEach(() => {
	localStorage.clear();
});

describe("composer send shortcut preference", () => {
	test("falls back to enter when storage is missing", () => {
		localStorage.removeItem(COMPOSER_SEND_SHORTCUT_KEY);

		expect(readComposerSendShortcut()).toBe(DEFAULT_COMPOSER_SEND_SHORTCUT);
	});

	test("reads all supported values", () => {
		for (const mode of ["enter", "shift-enter", "command-enter"] as const) {
			localStorage.setItem(COMPOSER_SEND_SHORTCUT_KEY, mode);
			expect(readComposerSendShortcut()).toBe(mode);
		}
	});

	test("falls back to enter for invalid values", () => {
		localStorage.setItem(COMPOSER_SEND_SHORTCUT_KEY, "not-a-mode");

		expect(readComposerSendShortcut()).toBe(DEFAULT_COMPOSER_SEND_SHORTCUT);
	});

	test("writes, notifies same-document listeners, and persists the mode", () => {
		let notifications = 0;
		const unsubscribe = subscribeComposerSendShortcut(() => {
			notifications += 1;
		});

		setComposerSendShortcut("shift-enter");
		unsubscribe();

		expect(localStorage.getItem(COMPOSER_SEND_SHORTCUT_KEY)).toBe(
			"shift-enter"
		);
		expect(notifications).toBe(1);
	});

	test("notifies an active subscription from a matching storage event", () => {
		let notifications = 0;
		const unsubscribe = subscribeComposerSendShortcut(() => {
			notifications += 1;
		});

		window.dispatchEvent(
			new StorageEvent("storage", {
				key: COMPOSER_SEND_SHORTCUT_KEY,
				newValue: "command-enter",
			})
		);

		unsubscribe();

		expect(notifications).toBe(1);
	});

	test("registers a general chats reset entry that restores enter", () => {
		const entry = listSettings().find(
			(setting) => setting.id === "general.chats.send-shortcut"
		);

		expect(entry).toBeDefined();
		expect(entry?.category).toBe("general");

		localStorage.setItem(COMPOSER_SEND_SHORTCUT_KEY, "command-enter");
		entry?.reset();

		expect(localStorage.getItem(COMPOSER_SEND_SHORTCUT_KEY)).toBe(
			DEFAULT_COMPOSER_SEND_SHORTCUT
		);
	});
});
