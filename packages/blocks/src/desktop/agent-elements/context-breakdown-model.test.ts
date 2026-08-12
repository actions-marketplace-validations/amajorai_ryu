import { describe, expect, test } from "bun:test";
import {
	type ContextBreakdownData,
	contextBands,
	contextPct,
	formatContextPct,
	OTHER_STYLE,
	SEGMENT_STYLES,
	segmentStyle,
} from "./context-breakdown-model.ts";

function breakdown(
	segments: ContextBreakdownData["segments"],
	overrides: Partial<ContextBreakdownData> = {}
): ContextBreakdownData {
	return {
		attributed: segments.reduce((a, s) => a + s.tokens, 0),
		plane: "acp",
		reserveOutput: 0,
		segments,
		window: 0,
		...overrides,
	};
}

describe("contextBands", () => {
	test("keeps Core's order and colours each category by its kind", () => {
		const bands = contextBands(
			breakdown([
				{ kind: "messages", label: "Conversation history", tokens: 900 },
				{ kind: "skills", label: "Skills", tokens: 400 },
			])
		);
		expect(bands.map((b) => b.key)).toEqual(["messages", "skills"]);
		expect(bands[0]?.className).toBe(SEGMENT_STYLES.messages);
		expect(bands[1]?.className).toBe(SEGMENT_STYLES.skills);
	});

	test("adds an Unattributed band for what the provider billed beyond Core's estimate", () => {
		const bands = contextBands(
			breakdown([{ kind: "skills", label: "Skills", tokens: 1000 }]),
			1500
		);
		expect(bands.at(-1)).toMatchObject({
			key: "unattributed",
			tokens: 500,
		});
	});

	// The ACP plane over-estimates as often as it under-estimates (`len / 3.5` on
	// dense text). A negative band would render as an inverted bar, so the panel
	// must surface the delta numerically instead — see `ContextBreakdownPanel`.
	test("never produces a negative band when Core over-estimates", () => {
		const bands = contextBands(
			breakdown([{ kind: "skills", label: "Skills", tokens: 1000 }]),
			600
		);
		expect(bands).toHaveLength(1);
		expect(bands.every((b) => b.tokens >= 0)).toBe(true);
	});

	test("omits the Unattributed band when nothing is reported", () => {
		const bands = contextBands(
			breakdown([{ kind: "skills", label: "Skills", tokens: 10 }])
		);
		expect(bands.map((b) => b.key)).toEqual(["skills"]);
	});

	test("carries the detail line through", () => {
		const bands = contextBands(
			breakdown([
				{
					detail: "24 tools across 5 servers",
					kind: "tools",
					label: "Tool definitions",
					tokens: 100,
				},
			])
		);
		expect(bands[0]?.detail).toBe("24 tools across 5 servers");
	});
});

describe("segmentStyle", () => {
	test("falls back to muted ink rather than inventing a ninth hue", () => {
		expect(segmentStyle("persona")).toBe(OTHER_STYLE);
		expect(segmentStyle("compact")).toBe(OTHER_STYLE);
	});

	test("gives each of the eight slots a distinct fill", () => {
		const fills = new Set(Object.values(SEGMENT_STYLES));
		expect(fills.size).toBe(Object.keys(SEGMENT_STYLES).length);
	});
});

describe("contextPct", () => {
	test("is zero when the window is unknown", () => {
		expect(contextPct(500, 0)).toBe(0);
	});

	test("floors a tiny share instead of rendering 0.0%", () => {
		expect(formatContextPct(contextPct(1, 100_000))).toBe("<0.1%");
		expect(formatContextPct(0)).toBe("0.0%");
		expect(formatContextPct(contextPct(250, 1000))).toBe("25.0%");
	});
});
