import { describe, expect, test } from "bun:test";
import {
	dropdownMotionClassNames,
	dropdownOriginFor,
} from "./dropdown-menu-motion.tsx";

describe("dropdown menu motion", () => {
	test("chooses the popup edge that faces the trigger", () => {
		const cases = [
			["bottom", "start", "top-left"],
			["bottom", "center", "top-center"],
			["bottom", "end", "top-right"],
			["top", "start", "bottom-left"],
			["top", "end", "bottom-right"],
			["right", "start", "top-left"],
			["left", "end", "bottom-right"],
		] as const;

		for (const [side, align, expected] of cases) {
			expect(dropdownOriginFor(side, align)).toBe(expected);
		}
	});

	test("keeps the popup hidden until the opening frame is ready", () => {
		expect(dropdownMotionClassNames(true, false)).toBe("t-dropdown");
		expect(dropdownMotionClassNames(true, true)).toBe("t-dropdown is-open");
	});

	test("uses the closing state for Base UI's exit lifecycle", () => {
		expect(dropdownMotionClassNames(false, true)).toBe("t-dropdown is-closing");
	});
});
