import {
	type ExpressiveExpressionSelection,
	isExpressiveExpressionSelection,
} from "./expressive.ts";
import {
	type ExpressiveAnimationSelection,
	isExpressiveAnimationSelection,
} from "./expressive-animation.ts";
import type { LogoColors } from "./logo-colors.ts";

export const GHOST_AVATAR_VARIANTS = [
	"3d",
	"outline",
	"outline-muted",
	"default",
	"expressive",
] as const;
export interface GhostAvatarAppearance {
	animated?: boolean;
	animationDuration?: number;
	behavior?: "custom" | "conversation";
	bodyStyle?: "solid" | "orb";
	colors?: LogoColors;
	eyeScale?: number;
	variant?: (typeof GHOST_AVATAR_VARIANTS)[number];
}
export interface GhostAvatarSpec extends GhostAvatarAppearance {
	animation?: ExpressiveAnimationSelection;
	expression: ExpressiveExpressionSelection;
}

/** Normalize persisted settings at the shared UI boundary; legacy faces stay valid. */
export function parseGhostAvatar(data: unknown): GhostAvatarSpec | undefined {
	if (
		!data ||
		typeof data !== "object" ||
		!("expression" in data) ||
		!isExpressiveExpressionSelection(data.expression)
	) {
		return;
	}
	const result: GhostAvatarSpec = { expression: data.expression };
	if ("animation" in data && isExpressiveAnimationSelection(data.animation)) {
		result.animation = data.animation;
	}
	if ("variant" in data) {
		result.variant = GHOST_AVATAR_VARIANTS.find(
			(value) => value === data.variant
		);
	}
	if (
		"bodyStyle" in data &&
		(data.bodyStyle === "solid" || data.bodyStyle === "orb")
	) {
		result.bodyStyle = data.bodyStyle;
	}
	if (
		"behavior" in data &&
		(data.behavior === "custom" || data.behavior === "conversation")
	) {
		result.behavior = data.behavior;
	}
	if ("animated" in data && typeof data.animated === "boolean") {
		result.animated = data.animated;
	}
	if (
		"eyeScale" in data &&
		typeof data.eyeScale === "number" &&
		Number.isFinite(data.eyeScale)
	) {
		result.eyeScale = Math.min(3, Math.max(0.25, data.eyeScale));
	}
	if (
		"animationDuration" in data &&
		typeof data.animationDuration === "number" &&
		Number.isFinite(data.animationDuration)
	) {
		result.animationDuration = Math.min(
			120,
			Math.max(1, data.animationDuration)
		);
	}
	if ("colors" in data && data.colors && typeof data.colors === "object") {
		const colors: LogoColors = {};
		for (const key of ["bg", "c1", "c2", "c3"] as const) {
			const value = Reflect.get(data.colors, key);
			if (typeof value === "string" && value.trim() && value.length <= 128) {
				colors[key] = value.trim();
			}
		}
		if (Object.keys(colors).length) {
			result.colors = colors;
		}
	}
	return result;
}
