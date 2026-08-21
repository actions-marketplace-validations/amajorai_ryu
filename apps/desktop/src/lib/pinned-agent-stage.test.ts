import { describe, expect, test } from "bun:test";
import { pinnedAgentLayout } from "@/src/components/layout/pinned-agent-stage.tsx";

describe("pinned agent stage density", () => {
	test("uses the hero layout for one or fewer pinned agents", () => {
		expect(pinnedAgentLayout(0)).toBe("hero");
		expect(pinnedAgentLayout(1)).toBe("hero");
	});

	test("uses a balanced pair for two pinned agents", () => {
		expect(pinnedAgentLayout(2)).toBe("pair");
	});

	test("uses a three-up grid from three pinned agents onward", () => {
		expect(pinnedAgentLayout(3)).toBe("grid");
		expect(pinnedAgentLayout(8)).toBe("grid");
	});
});
