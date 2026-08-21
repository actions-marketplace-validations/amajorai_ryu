import { describe, expect, test } from "bun:test";
import {
	getChatTabBusySpeed,
	isFastModeSelected,
} from "./chat-tab-busy-speed.ts";

describe("chat tab busy speed", () => {
	test("keeps ordinary thinking slow", () => {
		expect(getChatTabBusySpeed("submitted", null, {})).toBe("slow");
	});

	test("uses fast while thinking in a fast ACP mode", () => {
		expect(getChatTabBusySpeed("submitted", "fast", {})).toBe("fast");
		expect(
			getChatTabBusySpeed("submitted", null, { "fast-mode": "true" })
		).toBe("fast");
		expect(isFastModeSelected(null, { fast_mode: "enabled" })).toBe(true);
	});

	test("keeps working at normal speed, including fast mode", () => {
		expect(getChatTabBusySpeed("streaming", "fast", {})).toBe("normal");
	});

	test("does not treat disabled or unrelated options as fast mode", () => {
		expect(isFastModeSelected(null, { "fast-mode": "false" })).toBe(false);
		expect(isFastModeSelected(null, { reasoning: "high" })).toBe(false);
		expect(getChatTabBusySpeed("submitted", null, { fast: "off" })).toBe(
			"slow"
		);
	});
});
