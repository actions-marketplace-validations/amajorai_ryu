import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) {
	GlobalRegistrator.register();
}

import { beforeEach, describe, expect, test } from "bun:test";
import {
	parseTabLayout,
	setTabLayout,
	TAB_LAYOUT_OPTIONS,
	TAB_LAYOUT_VALUES,
} from "./useTabLayout.ts";

beforeEach(() => {
	localStorage.clear();
});

describe("tab layout preference", () => {
	test("accepts every supported layout", () => {
		expect(TAB_LAYOUT_VALUES).toEqual([
			"horizontal",
			"vertical",
			"scroll",
			"canvas",
		]);
		expect(parseTabLayout("horizontal")).toBe("horizontal");
		expect(parseTabLayout("vertical")).toBe("vertical");
		expect(parseTabLayout("scroll")).toBe("scroll");
		expect(parseTabLayout("canvas")).toBe("canvas");
	});

	test("falls back to horizontal for unknown or missing values", () => {
		expect(parseTabLayout("unknown")).toBe("horizontal");
		expect(parseTabLayout(null)).toBe("horizontal");
	});

	test("exposes the user-facing labels in mode order", () => {
		expect(TAB_LAYOUT_OPTIONS).toEqual([
			{ label: "Horizontal tabs", value: "horizontal" },
			{ label: "Vertical tabs", value: "vertical" },
			{ label: "Scrollable tabs", value: "scroll" },
			{ label: "Infinite canvas", value: "canvas" },
		]);
	});

	test("writes the selected layout and notifies same-document listeners", () => {
		let notifications = 0;
		const listener = () => {
			notifications += 1;
		};
		window.addEventListener("storage", listener);

		setTabLayout("canvas");

		window.removeEventListener("storage", listener);
		expect(localStorage.getItem("ryu_tab_layout")).toBe("canvas");
		expect(notifications).toBe(1);
	});
});
