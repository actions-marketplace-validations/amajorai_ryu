"use client";

// beui.dev/components/motion/loader
// Frame-based loader variants (spinner, dots, terminal ASCII sets). The canvas
// variants (dither, metaballs, newton, helix, percent) are omitted — this is the
// compact port the agent loading states use.

import { EASE_IN_OUT } from "@ryu/ui/lib/ease";
import { cn } from "@ryu/ui/lib/utils";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

export type LoaderVariant =
	| "spinner"
	| "dots"
	| "bars"
	| "ascii"
	| "ascii-line"
	| "ascii-braille"
	| "ascii-blocks"
	| "ascii-bounce";

// Terminal-style frame sets — the loaders CLI AI agents cycle through.
const ASCII_SETS: Record<string, string[]> = {
	ascii: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
	"ascii-line": ["|", "/", "-", "\\"],
	"ascii-braille": ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"],
	"ascii-blocks": [
		"▁",
		"▂",
		"▃",
		"▄",
		"▅",
		"▆",
		"▇",
		"█",
		"▇",
		"▆",
		"▅",
		"▄",
		"▃",
		"▂",
	],
	"ascii-bounce": ["⠁", "⠂", "⠄", "⡀", "⢀", "⠠", "⠐", "⠈"],
};

export interface LoaderProps {
	/** Which animation to render. */
	variant?: LoaderVariant;
	/** Base square size in px. Everything scales from this. */
	size?: number;
	/** Seconds per animation cycle. */
	speed?: number;
	/** Accessible label announced to screen readers. */
	label?: string;
	className?: string;
}

// Reduced motion keeps a calm opacity pulse and drops every transform.
const REDUCED = {
	animate: { opacity: [1, 0.4, 1] },
	transition: { duration: 1.4, ease: EASE_IN_OUT, repeat: Infinity },
};

interface PartProps {
	size: number;
	speed: number;
	reduce: boolean;
}

function Spinner({ size, speed, reduce }: PartProps) {
	const stroke = Math.max(2, size * 0.09);
	const r = (size - stroke) / 2;
	return (
		<motion.svg
			animate={reduce ? REDUCED.animate : { rotate: 360 }}
			height={size}
			transition={
				reduce
					? REDUCED.transition
					: { duration: speed, ease: "linear", repeat: Infinity }
			}
			viewBox={`0 0 ${size} ${size}`}
			width={size}
		>
			<circle
				cx={size / 2}
				cy={size / 2}
				fill="none"
				r={r}
				stroke="currentColor"
				strokeOpacity={0.2}
				strokeWidth={stroke}
			/>
			<path
				d={`M ${size / 2} ${size / 2 - r} A ${r} ${r} 0 0 1 ${size / 2 + r} ${size / 2}`}
				fill="none"
				stroke="currentColor"
				strokeLinecap="round"
				strokeWidth={stroke}
			/>
		</motion.svg>
	);
}

function Dots({ size, speed, reduce }: PartProps) {
	const dot = size * 0.24;
	return (
		<span className="flex items-center" style={{ gap: size * 0.14 }}>
			{[0, 1, 2].map((i) => (
				<motion.span
					animate={
						reduce
							? { opacity: [0.4, 1, 0.4] }
							: { y: [0, -size * 0.3, 0], opacity: [0.5, 1, 0.5] }
					}
					className="rounded-full bg-current"
					key={i}
					style={{ width: dot, height: dot }}
					transition={{
						duration: speed,
						ease: EASE_IN_OUT,
						repeat: Infinity,
						delay: i * speed * 0.16,
					}}
				/>
			))}
		</span>
	);
}

function Bars({ size, speed, reduce }: PartProps) {
	const bar = Math.max(2, size * 0.12);
	return (
		<span className="flex items-end" style={{ gap: Math.max(1, size * 0.08) }}>
			{[0, 1, 2, 3].map((i) => (
				<motion.span
					animate={
						reduce
							? { opacity: [0.4, 1, 0.4] }
							: { scaleY: [0.35, 1, 0.35] }
					}
					className="w-1 origin-bottom rounded-full bg-current"
					key={i}
					style={{ width: bar, height: size * 0.55 }}
					transition={{
						duration: speed,
						ease: EASE_IN_OUT,
						repeat: Infinity,
						delay: i * speed * 0.12,
					}}
				/>
			))}
		</span>
	);
}

function Ascii({
	frames,
	size,
	speed,
	reduce,
}: PartProps & { frames: string[] }) {
	const [frame, setFrame] = useState(0);
	useEffect(() => {
		// Reduced motion slows the cycle rather than stopping it — it's a glyph
		// swap, not on-screen movement.
		const step = ((reduce ? speed * 2.5 : speed) / frames.length) * 1000;
		const id = setInterval(
			() => setFrame((f) => (f + 1) % frames.length),
			step
		);
		return () => clearInterval(id);
	}, [frames.length, speed, reduce]);

	return (
		<span
			className="font-mono tabular-nums leading-none"
			style={{ fontSize: size, lineHeight: 1 }}
		>
			{frames[frame % frames.length]}
		</span>
	);
}

export function Loader({
	variant = "spinner",
	size = 32,
	speed = 1,
	label = "Loading",
	className,
}: LoaderProps) {
	const reduce = useReducedMotion() ?? false;

	return (
		<span
			aria-label={label}
			className={cn(
				"inline-flex items-center justify-center text-foreground",
				className
			)}
			role="status"
		>
			{variant === "spinner" && <Spinner size={size} speed={speed} reduce={reduce} />}
			{variant === "dots" && <Dots size={size} speed={speed} reduce={reduce} />}
			{variant === "bars" && <Bars size={size} speed={speed} reduce={reduce} />}
			{ASCII_SETS[variant] && (
				<Ascii
					frames={ASCII_SETS[variant]}
					size={size}
					speed={speed}
					reduce={reduce}
				/>
			)}
			<span className="sr-only">{label}</span>
		</span>
	);
}
