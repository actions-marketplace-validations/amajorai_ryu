import { describe, expect, it } from "bun:test";
import {
	DEFAULT_QUICK_REPLY_MODIFIER,
	quickReplyModifierMatches,
	setQuickReplyModifier,
} from "./useQuickReplyModifier.ts";

describe("quick reply click modifier", () => {
	it("defaults to Alt", () => {
		setQuickReplyModifier(DEFAULT_QUICK_REPLY_MODIFIER);
		expect(
			quickReplyModifierMatches({
				altKey: true,
				ctrlKey: false,
				metaKey: false,
				shiftKey: false,
			})
		).toBe(true);
	});

	it("matches the configured modifier and supports disabling the gesture", () => {
		setQuickReplyModifier("meta");
		expect(
			quickReplyModifierMatches({
				altKey: false,
				ctrlKey: false,
				metaKey: true,
				shiftKey: false,
			})
		).toBe(true);
		expect(
			quickReplyModifierMatches({
				altKey: true,
				ctrlKey: false,
				metaKey: false,
				shiftKey: false,
			})
		).toBe(false);

		setQuickReplyModifier("none");
		expect(
			quickReplyModifierMatches({
				altKey: true,
				ctrlKey: true,
				metaKey: true,
				shiftKey: true,
			})
		).toBe(false);

		setQuickReplyModifier(DEFAULT_QUICK_REPLY_MODIFIER);
	});
});
