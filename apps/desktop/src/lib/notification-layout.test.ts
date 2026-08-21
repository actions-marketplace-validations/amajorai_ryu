import { describe, expect, it } from "bun:test";
import {
	DEFAULT_NOTIFICATION_LAYOUT,
	NOTIFICATION_LAYOUT_STEPS,
	notificationLayoutStepIndex,
} from "./notification-layout.ts";

describe("notification layout preference", () => {
	it("offers the split, grouped, and unified display modes in slider order", () => {
		expect(NOTIFICATION_LAYOUT_STEPS.map((step) => step.id)).toEqual([
			"split",
			"grouped",
			"unified",
		]);
	});

	it("defaults to the unified tray", () => {
		expect(DEFAULT_NOTIFICATION_LAYOUT).toBe("unified");
		expect(notificationLayoutStepIndex(DEFAULT_NOTIFICATION_LAYOUT)).toBe(2);
	});

	it("maps every mode to its stable slider detent", () => {
		expect(notificationLayoutStepIndex("split")).toBe(0);
		expect(notificationLayoutStepIndex("grouped")).toBe(1);
		expect(notificationLayoutStepIndex("unified")).toBe(2);
	});
});
