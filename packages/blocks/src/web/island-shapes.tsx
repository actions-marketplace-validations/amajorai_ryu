"use client";

/*
 * The Island's shape vocabulary — sizes, springs, glass skins, the Siri-border
 * CSS and the mini-island action pills — factored out of `global-island.tsx` so
 * more than one surface can draw a 1:1 island without re-typing the constants.
 *
 * Two surfaces use it today:
 *   - `global-island.tsx` — the draggable, persistent site chrome.
 *   - `hero-workflow-loop.tsx` — the scripted landing-page demo island.
 *
 * Everything here is copied verbatim from the real desktop Island
 * (apps/island `Island.tsx` + `island-config.ts`); keep it that way, since the
 * whole point of these blocks is that the marketing site shows the real thing.
 */

import { cn } from "@ryu/ui/lib/utils";
import { motion } from "motion/react";
import type { IslandState } from "./island-store.ts";

/* ── island-config (inlined from apps/island/.../island-config.ts) ─────────── */

export const LOGO_CIRCLE = { width: 40, height: 40, radius: 20 } as const;
export const SPLIT_GAP = 8;
export const DETAIL_SIZES: Partial<
	Record<IslandState, { width: number; height: number; radius: number }>
> = {
	idle: { width: 96, height: 40, radius: 20 },
	suggestion: { width: 300, height: 62, radius: 20 },
	expanded: { width: 400, height: 480, radius: 28 },
	promo: { width: 400, height: 440, radius: 28 },
};
export const ACTION_PILL_WIDTH = 72;
export const ACTION_PILL_HEIGHT = 30;
export const SUGGESTION_STACK_GAP = 8;
export const ISLAND_SPRING = {
	type: "spring",
	bounce: 0.16,
	duration: 0.5,
} as const;
export const CONTENT_SPRING = {
	type: "spring",
	bounce: 0.12,
	duration: 0.35,
} as const;

/* ── shape skins (verbatim from Island.tsx — the "latest" Siri-border look) ── */

export const SHAPE_BASE =
	"island-siri-border relative shrink-0 overflow-hidden shadow-2xl";
export const TRANSLUCENT_SKIN =
	"bg-gradient-to-b from-neutral-950/85 via-neutral-950/65 to-neutral-900/35 text-neutral-100 backdrop-blur-2xl";
export const ACTION_PILL_BASE =
	"island-siri-border relative flex shrink-0 items-center justify-center overflow-hidden whitespace-nowrap rounded-full font-medium text-xs shadow-xl backdrop-blur-2xl";
export const ACTION_PILL_PRIMARY =
	"bg-amber-400/25 text-amber-50 hover:bg-amber-400/40";
export const ACTION_PILL_DEFAULT =
	"bg-neutral-900/70 text-neutral-200 hover:bg-neutral-800/85";

/* ── the Siri border + snap-zone overlay CSS, mirrored from the real app ────── */

export const ISLAND_CSS = `
.island-siri-border::after {
	content: "";
	position: absolute;
	inset: 0;
	z-index: 2;
	border-radius: inherit;
	padding: 1.5px;
	background: radial-gradient(
		130% 150% at 50% 118%,
		rgba(255, 255, 255, 0.9) 0%,
		rgba(255, 255, 255, 0.45) 28%,
		rgba(255, 255, 255, 0.12) 48%,
		transparent 64%
	);
	-webkit-mask:
		linear-gradient(#000 0 0) content-box,
		linear-gradient(#000 0 0);
	-webkit-mask-composite: xor;
	mask-composite: exclude;
	pointer-events: none;
}
.island-zone-overlay {
	opacity: 0;
	transition: opacity 0.14s ease;
}
.island-zone-overlay[data-shown="true"] {
	opacity: 1;
}
.island-zone-backdrop {
	position: absolute;
	inset: 0;
	background: rgba(0, 0, 0, 0.4);
}
.island-zone-ghost {
	position: absolute;
	box-sizing: border-box;
	border: 1.5px dashed rgba(255, 255, 255, 0.35);
	background: rgba(255, 255, 255, 0.04);
	transition: border-color 0.12s ease, background 0.12s ease, box-shadow 0.12s ease;
}
.island-zone-ghost.active {
	border: 2px solid rgba(255, 255, 255, 0.95);
	background: rgba(130, 175, 255, 0.18);
	box-shadow:
		0 0 0 1px rgba(8, 10, 16, 0.3),
		0 10px 44px rgba(60, 110, 220, 0.5);
}
`;

/* ── action mini-islands (verbatim morph from Island.tsx) ──────────────────── */

export interface IslandAction {
	key: string;
	label: string;
	onClick?: () => void;
	primary?: boolean;
	width?: number;
}

/**
 * The row of mini-islands that morphs out from under a suggestion. `pressedKey`
 * is for scripted demos: it draws the pointer-down state of one pill without a
 * real pointer being over it.
 */
export function IslandActionPills({
	actions,
	pressedKey,
}: {
	actions: IslandAction[];
	pressedKey?: string | null;
}) {
	return (
		<div
			className="flex"
			style={{
				gap: SPLIT_GAP,
				marginLeft: LOGO_CIRCLE.width + SPLIT_GAP,
				marginTop: SUGGESTION_STACK_GAP,
			}}
		>
			{actions.map((action, index) => (
				<motion.button
					animate={{
						width: action.width ?? ACTION_PILL_WIDTH,
						opacity: 1,
						scale: pressedKey === action.key ? 0.92 : 1,
					}}
					className={cn(
						ACTION_PILL_BASE,
						action.primary ? ACTION_PILL_PRIMARY : ACTION_PILL_DEFAULT,
						pressedKey === action.key && "ring-2 ring-amber-200/70"
					)}
					initial={{ width: 0, opacity: 0 }}
					key={action.key}
					onClick={action.onClick}
					style={{ height: ACTION_PILL_HEIGHT }}
					transition={{ ...ISLAND_SPRING, delay: index * 0.05 }}
					type="button"
				>
					{action.label}
				</motion.button>
			))}
		</div>
	);
}
