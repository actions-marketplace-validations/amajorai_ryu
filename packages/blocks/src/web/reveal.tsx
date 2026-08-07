"use client";

import { motion, useInView, useReducedMotion } from "motion/react";
import { type ReactNode, useRef } from "react";

// The same motion the `.t-stagger` reveal uses in globals.css — 12px of travel,
// a 3px blur that sharpens, 500ms on the transitions.dev easing. Marketing
// sections and the staggered headings they sit under therefore share one
// vocabulary; before this, sections slid 16px with no blur on `easeOut` while
// their own headings rose 12px and sharpened, and the mismatch was visible when
// both ran on the same screen. Values are duplicated as literals rather than
// read from the CSS custom properties because Motion animates JS values, not
// `var()` references.
const DISTANCE = 12;
const BLUR = 3;
const DURATION = 0.5;
const EASE = [0.22, 1, 0.36, 1] as const;

export function Reveal({
	children,
	delay = 0,
	className,
}: {
	children: ReactNode;
	delay?: number;
	className?: string;
}) {
	const ref = useRef(null);
	const inView = useInView(ref, { once: true, margin: "-80px" });
	// Matches the `prefers-reduced-motion` guard the CSS reveals carry: the
	// content rests visible rather than waiting on a transition that never runs.
	const reduceMotion = useReducedMotion();

	if (reduceMotion) {
		return <div className={className}>{children}</div>;
	}

	const hidden = {
		opacity: 0,
		y: DISTANCE,
		filter: `blur(${BLUR}px)`,
	};
	const shown = { opacity: 1, y: 0, filter: "blur(0px)" };

	return (
		<motion.div
			animate={inView ? shown : hidden}
			className={className}
			initial={hidden}
			ref={ref}
			transition={{ duration: DURATION, delay, ease: EASE }}
		>
			{children}
		</motion.div>
	);
}
