import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) {
	GlobalRegistrator.register();
}

import { beforeEach, describe, expect, test } from "bun:test";
import {
	applyWindowTransparencyPreferences,
	DEFAULT_SIDEBAR_TRANSPARENCY,
	DEFAULT_WINDOW_TRANSPARENCY,
	SIDEBAR_TRANSPARENCY_KEY,
	setSidebarTransparency,
	setWindowTransparency,
	WINDOW_TRANSPARENCY_KEY,
} from "./useWindowTransparency.ts";

beforeEach(() => {
	localStorage.clear();
	document.documentElement.removeAttribute("data-ryu-sidebar-transparency");
	document.documentElement.removeAttribute("data-ryu-window-transparency");
});

describe("window surface transparency", () => {
	test("ships both surface choices disabled", () => {
		expect(DEFAULT_SIDEBAR_TRANSPARENCY).toBe(false);
		expect(DEFAULT_WINDOW_TRANSPARENCY).toBe(false);
	});

	test("applies the sidebar choice without enabling the whole window", () => {
		applyWindowTransparencyPreferences(true, false);

		expect(
			document.documentElement.getAttribute("data-ryu-sidebar-transparency")
		).toBe("true");
		expect(
			document.documentElement.getAttribute("data-ryu-window-transparency")
		).toBeNull();
	});

	test("applies the whole-window choice without enabling the sidebar", () => {
		applyWindowTransparencyPreferences(false, true);

		expect(
			document.documentElement.getAttribute("data-ryu-sidebar-transparency")
		).toBeNull();
		expect(
			document.documentElement.getAttribute("data-ryu-window-transparency")
		).toBe("true");
	});

	test("reads persisted values independently", () => {
		localStorage.setItem(SIDEBAR_TRANSPARENCY_KEY, "true");
		localStorage.setItem(WINDOW_TRANSPARENCY_KEY, "false");

		applyWindowTransparencyPreferences();

		expect(
			document.documentElement.getAttribute("data-ryu-sidebar-transparency")
		).toBe("true");
		expect(
			document.documentElement.getAttribute("data-ryu-window-transparency")
		).toBeNull();
	});

	test("persists and applies each setter immediately", () => {
		setSidebarTransparency(true);
		setWindowTransparency(true);

		expect(localStorage.getItem(SIDEBAR_TRANSPARENCY_KEY)).toBe("true");
		expect(localStorage.getItem(WINDOW_TRANSPARENCY_KEY)).toBe("true");
		expect(
			document.documentElement.getAttribute("data-ryu-sidebar-transparency")
		).toBe("true");
		expect(
			document.documentElement.getAttribute("data-ryu-window-transparency")
		).toBe("true");
	});
});
