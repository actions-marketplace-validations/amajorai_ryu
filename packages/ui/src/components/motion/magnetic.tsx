"use client";

import { useHoverCapable } from "@ryu/ui/hooks/use-hover-capable";
import { SPRING_MOUSE } from "@ryu/ui/lib/ease";
import { cn } from "@ryu/ui/lib/utils";
import {
	motion,
	useMotionValue,
	useReducedMotion,
	useSpring,
} from "motion/react";
import { type ReactNode, useRef } from "react";

export interface MagneticProps {
	children: ReactNode;
	className?: string;
	strength?: number;
}

export function Magnetic({
	children,
	strength = 0.35,
	className,
}: MagneticProps) {
	const ref = useRef<HTMLDivElement>(null);
	const reduce = useReducedMotion();
	const canHover = useHoverCapable();
	// Decorative cursor-follow: skip on touch (phantom hover) and reduced motion.
	const enabled = !reduce && canHover;
	const x = useMotionValue(0);
	const y = useMotionValue(0);
	const sx = useSpring(x, SPRING_MOUSE);
	const sy = useSpring(y, SPRING_MOUSE);

	const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
		const el = ref.current;
		if (!(el && enabled)) {
			return;
		}
		const rect = el.getBoundingClientRect();
		x.set((e.clientX - rect.left - rect.width / 2) * strength);
		y.set((e.clientY - rect.top - rect.height / 2) * strength);
	};

	const onLeave = () => {
		x.set(0);
		y.set(0);
	};

	return (
		<motion.div
			className={cn("inline-block", className)}
			onMouseLeave={onLeave}
			onMouseMove={onMove}
			ref={ref}
			style={{ x: sx, y: sy }}
		>
			{children}
		</motion.div>
	);
}
