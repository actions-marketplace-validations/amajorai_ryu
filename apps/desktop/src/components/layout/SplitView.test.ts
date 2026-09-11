import { describe, expect, it } from "bun:test";
import { makeBranch, makeLeaf } from "@/src/lib/splitTree.ts";
import { computeSplitLayout, paneRectStyle } from "./SplitView.tsx";

describe("split pane motion", () => {
	it("keeps pane geometry animatable without changing its calculated rect", () => {
		const layout = computeSplitLayout(
			makeBranch("columns", [makeLeaf("left"), makeLeaf("right")])
		);
		const leftPane = layout.panes.get("left");

		expect(leftPane).toBeDefined();
		if (!leftPane) {
			throw new Error("left pane was not computed");
		}
		const style = paneRectStyle(leftPane);

		expect(style.left).toBe("calc(0.0000% + 0.00px)");
		expect(style.width).toContain("50.0000%");
		expect(style.transition).toContain("--ryu-split-pane-transition-duration");
	});
});
