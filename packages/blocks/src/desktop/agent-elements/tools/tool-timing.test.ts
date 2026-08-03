import { describe, expect, test } from "bun:test";
import { formatToolDuration } from "./tool-timing.tsx";

describe("formatToolDuration", () => {
	// The whole reason this exists instead of reusing message-stats'
	// `formatDuration`: that one rounds to whole seconds, so every sub-second
	// tool call — which is most of them — renders as "0s".
	test("keeps sub-second calls readable", () => {
		expect(formatToolDuration(0)).toBe("0ms");
		expect(formatToolDuration(7)).toBe("7ms");
		expect(formatToolDuration(420)).toBe("420ms");
		expect(formatToolDuration(999)).toBe("999ms");
	});

	test("switches to one decimal at a second", () => {
		expect(formatToolDuration(1000)).toBe("1.0s");
		expect(formatToolDuration(3240)).toBe("3.2s");
		expect(formatToolDuration(9949)).toBe("9.9s");
	});

	test("drops the decimal past ten seconds so the column stays narrow", () => {
		expect(formatToolDuration(10_000)).toBe("10s");
		expect(formatToolDuration(45_400)).toBe("45s");
	});

	test("uses minutes past a minute", () => {
		expect(formatToolDuration(60_000)).toBe("1m 0s");
		expect(formatToolDuration(83_000)).toBe("1m 23s");
	});

	test("renders nothing for a value that cannot be a duration", () => {
		expect(formatToolDuration(-1)).toBe("");
		expect(formatToolDuration(Number.NaN)).toBe("");
		expect(formatToolDuration(Number.POSITIVE_INFINITY)).toBe("");
	});
});
