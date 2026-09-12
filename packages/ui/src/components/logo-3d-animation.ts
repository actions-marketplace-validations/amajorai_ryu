import type { ResolvedExpressiveFrame } from "./expressive.ts";
import {
	type ExpressiveAnimationSelection,
	sampleExpressiveAnimation,
} from "./expressive-animation.ts";

/** Natural close/reopen blink; kept separate from wink and sleepy eye poses. */
export function ghostBlinkOpenness(seconds: number) {
	const phase = ((seconds % 4.6) + 4.6) % 4.6;
	if (phase < 3.7 || phase > 3.92) {
		return 1;
	}
	return 1 - 0.96 * Math.sin(((phase - 3.7) / 0.22) * Math.PI);
}

export function sampleGhostAnimation(
	time: number,
	animation: ExpressiveAnimationSelection,
	expression: ResolvedExpressiveFrame,
	blinking: boolean
) {
	const sample = sampleExpressiveAnimation(time, animation, expression);
	const blink =
		blinking && sample.animation !== "wink" && sample.animation !== "sleep"
			? ghostBlinkOpenness(time)
			: 1;
	const eye = (control: (typeof sample.eyes.eyes)[0]) => ({
		...control,
		open: control.shape === "x" ? control.open : control.open * blink,
	});
	return {
		...sample,
		eyes: {
			...sample.eyes,
			eyes: [eye(sample.eyes.eyes[0]), eye(sample.eyes.eyes[1])] as const,
		},
	};
}
