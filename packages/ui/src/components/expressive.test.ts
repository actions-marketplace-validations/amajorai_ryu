import { describe, expect, test } from "bun:test";
import {
	blendExpressiveFrames,
	EXPRESSIVE_EXPRESSION_IDS,
	EXPRESSIVE_EXPRESSION_OPTIONS,
	expressiveFrame,
	isExpressiveExpressionSelection,
	randomExpressiveExpression,
} from "./expressive.ts";
import {
	EXPRESSIVE_ANIMATION_IDS,
	EXPRESSIVE_ANIMATION_OPTIONS,
	EXPRESSIVE_ANIMATIONS,
	expressiveAnimationPreviewTime,
	isExpressiveAnimationSelection,
	sampleExpressiveAnimation,
} from "./expressive-animation.ts";

describe("expressive Ryu eye language", () => {
	test("exposes every named mood plus the random selection", () => {
		expect(EXPRESSIVE_EXPRESSION_OPTIONS.map((option) => option.value)).toEqual(
			["random", ...EXPRESSIVE_EXPRESSION_IDS]
		);
		expect(isExpressiveExpressionSelection("laughing")).toBe(true);
		expect(isExpressiveExpressionSelection("random")).toBe(true);
		expect(isExpressiveExpressionSelection("not-a-mood")).toBe(false);
	});

	test("blends independent eye controls and clamps progress", () => {
		const from = expressiveFrame("neutral");
		const to = expressiveFrame("skeptical");
		const halfway = blendExpressiveFrames(from, to, 0.5);

		expect(halfway.id).toBe("skeptical");
		expect(halfway.eyes[0].width).toBe(
			(from.eyes[0].width + to.eyes[0].width) / 2
		);
		const clampedStart = blendExpressiveFrames(from, to, -1);
		expect(clampedStart.eyes).toEqual(from.eyes);
		expect(clampedStart.gaze).toEqual(from.gaze);
		expect(blendExpressiveFrames(from, to, 2)).toEqual(to);
	});

	test("random animation always selects a supported mood", () => {
		for (let index = 0; index < 32; index += 1) {
			expect(EXPRESSIVE_EXPRESSION_IDS).toContain(randomExpressiveExpression());
		}
	});

	test("exposes the complete Bloub animation catalogue", () => {
		expect(EXPRESSIVE_ANIMATION_OPTIONS.map((option) => option.value)).toEqual([
			"random",
			...EXPRESSIVE_ANIMATION_IDS,
		]);
		expect(isExpressiveAnimationSelection("orbit")).toBe(true);
		expect(isExpressiveAnimationSelection("random")).toBe(true);
		expect(isExpressiveAnimationSelection("swirl")).toBe(false);
	});

	test("samples named animations with their signature decorations", () => {
		for (const animation of EXPRESSIVE_ANIMATION_IDS) {
			const frame = sampleExpressiveAnimation(
				expressiveAnimationPreviewTime(animation),
				animation,
				"happy"
			);
			expect(frame.animation).toBe(animation);
			expect(frame.totalDuration).toBe(
				EXPRESSIVE_ANIMATIONS[animation].duration
			);
		}

		expect(
			sampleExpressiveAnimation(1, "thinking").decorations.every(
				(decoration) => decoration.kind === "dot"
			)
		).toBe(true);
		expect(
			sampleExpressiveAnimation(1, "orbit").decorations.some(
				(decoration) => decoration.kind === "ring"
			)
		).toBe(true);
		expect(
			sampleExpressiveAnimation(1, "burst").decorations.some(
				(decoration) => decoration.kind === "ray"
			)
		).toBe(true);
		expect(
			sampleExpressiveAnimation(1, "comet").decorations.some(
				(decoration) => decoration.kind === "comet"
			)
		).toBe(true);
	});

	test("random uses the full timed sequence and remains deterministic", () => {
		const idleDuration = EXPRESSIVE_ANIMATIONS.idle.duration;
		const first = sampleExpressiveAnimation(idleDuration + 0.1, "random");
		const second = sampleExpressiveAnimation(idleDuration + 0.1, "random");

		expect(first.animation).toBe("thinking");
		expect(first).toEqual(second);
		expect(first.totalDuration).toBe(
			EXPRESSIVE_ANIMATION_IDS.reduce(
				(total, animation) => total + EXPRESSIVE_ANIMATIONS[animation].duration,
				0
			)
		);
	});
});
