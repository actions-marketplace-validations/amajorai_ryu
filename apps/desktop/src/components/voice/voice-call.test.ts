import { describe, expect, test } from "bun:test";
import {
	formatVoiceCallDuration,
	getVoiceCallInitials,
} from "./voice-call.ts";

describe("voice call display helpers", () => {
	test("formats elapsed time as a stable call timer", () => {
		expect(formatVoiceCallDuration(0)).toBe("00:00");
		expect(formatVoiceCallDuration(83)).toBe("01:23");
		expect(formatVoiceCallDuration(Number.NaN)).toBe("00:00");
	});

	test("creates compact initials for the call avatar", () => {
		expect(getVoiceCallInitials("Ryu")).toBe("RY");
		expect(getVoiceCallInitials("Ryu Assistant")).toBe("RA");
		expect(getVoiceCallInitials("  ")).toBe("R");
	});
});
