import { describe, expect, it } from "bun:test";
import {
	DEFAULT_QUICK_PREVIEW_MODIFIER,
	quickPreviewModifierMatches,
	setQuickPreviewModifier,
} from "./useQuickPreviewModifier.ts";

describe("quick preview click modifier", () => {
	it("defaults to Shift", () => {
		setQuickPreviewModifier(DEFAULT_QUICK_PREVIEW_MODIFIER);
		expect(
			quickPreviewModifierMatches({
				altKey: false,
				ctrlKey: false,
				metaKey: false,
				shiftKey: true,
			})
		).toBe(true);
	});

	it("matches the configured modifier and supports disabling the gesture", () => {
		setQuickPreviewModifier("ctrl");
		expect(
			quickPreviewModifierMatches({
				altKey: false,
				ctrlKey: true,
				metaKey: false,
				shiftKey: false,
			})
		).toBe(true);
		expect(
			quickPreviewModifierMatches({
				altKey: false,
				ctrlKey: false,
				metaKey: false,
				shiftKey: true,
			})
		).toBe(false);

		setQuickPreviewModifier("none");
		expect(
			quickPreviewModifierMatches({
				altKey: true,
				ctrlKey: true,
				metaKey: true,
				shiftKey: true,
			})
		).toBe(false);

		setQuickPreviewModifier(DEFAULT_QUICK_PREVIEW_MODIFIER);
	});
});
