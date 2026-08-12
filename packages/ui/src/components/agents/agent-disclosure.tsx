"use client";

// beui.dev/components/agents/agent-disclosure

import { EASE_OUT } from "@ryu/ui/lib/ease";
import { cn } from "@ryu/ui/lib/utils";
import { type HTMLMotionProps, motion, useReducedMotion } from "motion/react";
import type { CSSProperties } from "react";

export interface AgentDisclosureProps
	extends Omit<HTMLMotionProps<"div">, "animate" | "initial"> {
	open: boolean;
	openHeight?: CSSProperties["height"];
}

/**
 * Shared transform-only reveal for collapsible agent content. Animating
 * `clipPath` + `y` rather than `height` keeps the whole reveal on the compositor,
 * so a long tool output does not relayout the thread on every frame.
 */
export function AgentDisclosure({
	open,
	openHeight = "auto",
	className,
	style,
	transition,
	...props
}: AgentDisclosureProps) {
	const reduce = useReducedMotion() ?? false;
	const motionState = reduce
		? { opacity: open ? 1 : 0 }
		: {
				opacity: open ? 1 : 0,
				clipPath: open ? "inset(0 0 0% 0)" : "inset(0 0 100% 0)",
				y: open ? 0 : -4,
			};
	const openDuration = open ? 0.22 : 0.14;

	return (
		<motion.div
			{...props}
			animate={motionState}
			aria-hidden={!open}
			className={cn("overflow-hidden", className)}
			inert={!open}
			initial={false}
			style={{
				...style,
				height: open ? openHeight : 0,
				pointerEvents: open ? undefined : "none",
				transformOrigin: "top",
			}}
			transition={
				transition ?? {
					duration: reduce ? 0 : openDuration,
					ease: EASE_OUT,
				}
			}
		/>
	);
}
