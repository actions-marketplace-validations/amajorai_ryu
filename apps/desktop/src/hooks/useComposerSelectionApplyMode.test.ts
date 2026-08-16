import { describe, expect, it } from "vitest";
import {
	composerSelectionToastDescription,
	shouldShowComposerSelectionToast,
} from "./useComposerSelectionApplyMode.ts";

describe("composer selection apply mode", () => {
	it("only shows the selection toast while a turn is in flight", () => {
		expect(shouldShowComposerSelectionToast(false)).toBe(false);
		expect(shouldShowComposerSelectionToast(true)).toBe(true);
	});

	it("describes both supported apply timings", () => {
		expect(composerSelectionToastDescription("next-turn")).toBe(
			"Applies on the next turn."
		);
		expect(composerSelectionToastDescription("next-user-message")).toBe(
			"Applies from your next message."
		);
	});
});
