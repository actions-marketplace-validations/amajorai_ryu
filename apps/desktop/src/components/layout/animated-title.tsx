import { useChatDisplayPrefs } from "@ryu/blocks/desktop/agent-elements/chat-display-prefs.tsx";
import { motion } from "framer-motion";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils.ts";
import { usePrefersReducedMotion } from "@/src/hooks/usePrefersReducedMotion.ts";

const ENTER_DURATION = 0.38;
const EXIT_DURATION = 0.34;
const CHARACTER_DELAY = 0.024;
const MAX_CHARACTER_DELAY = 0.26;
const TRANSITION_MS = 760;

interface TitleTransition {
	from: string;
	id: number;
}

function characterDelay(index: number): number {
	return Math.min(index * CHARACTER_DELAY, MAX_CHARACTER_DELAY);
}

function renderCharacters(
	text: string,
	phase: "enter" | "exit",
	transitionId: number
): ReactNode[] {
	return Array.from(text).map((character, index) => (
		<motion.span
			animate={phase === "enter" ? { opacity: 1, y: 0 } : { opacity: 0, y: -1 }}
			aria-hidden
			className="inline-block"
			initial={phase === "enter" ? { opacity: 0, y: 2 } : { opacity: 1, y: 0 }}
			key={`${transitionId}-${phase}-${index}`}
			transition={{
				delay: characterDelay(index),
				duration: phase === "enter" ? ENTER_DURATION : EXIT_DURATION,
				ease: "easeOut",
			}}
		>
			{character === " " ? "\u00a0" : character}
		</motion.span>
	));
}

/**
 * Desktop title transition inspired by Motion-Primitives' per-character text
 * effect. The current text owns the layout width; the previous text is layered
 * over it so a rename reads as one title consuming the other instead of a
 * replacement that makes the row jump.
 */
export function AnimatedTitle({
	className,
	text,
}: {
	className?: string;
	text: string;
}) {
	const { animationsEnabled } = useChatDisplayPrefs();
	const prefersReducedMotion = usePrefersReducedMotion();
	const motionEnabled = animationsEnabled && !prefersReducedMotion;
	const previousTextRef = useRef(text);
	const transitionIdRef = useRef(0);
	const [transition, setTransition] = useState<TitleTransition | null>(null);

	useLayoutEffect(() => {
		const previous = previousTextRef.current;
		if (previous === text) {
			return;
		}
		previousTextRef.current = text;

		if (!motionEnabled) {
			setTransition(null);
			return;
		}

		transitionIdRef.current += 1;
		const id = transitionIdRef.current;
		setTransition({ from: previous, id });
		const timeout = window.setTimeout(() => {
			setTransition((current) => (current?.id === id ? null : current));
		}, TRANSITION_MS);

		return () => window.clearTimeout(timeout);
	}, [motionEnabled, text]);

	const activeTransition = motionEnabled ? transition : null;

	return (
		<span
			className={cn(
				"relative inline-block whitespace-pre align-bottom",
				className
			)}
			data-animated-title
			data-animated-title-state={activeTransition ? "transitioning" : "settled"}
		>
			{activeTransition ? (
				<>
					{/* The current text is the sole layout contributor, so old/new titles can
					    overlap without changing the tab or sidebar row width mid-animation. */}
					<span aria-hidden className="invisible whitespace-pre">
						{text}
					</span>
					<span
						aria-hidden
						className="pointer-events-none absolute inset-0 whitespace-pre"
					>
						{renderCharacters(
							activeTransition.from,
							"exit",
							activeTransition.id
						)}
					</span>
					<span
						aria-hidden
						className="pointer-events-none absolute inset-0 whitespace-pre"
					>
						{renderCharacters(text, "enter", activeTransition.id)}
					</span>
					<span className="sr-only">{text}</span>
				</>
			) : (
				<span className="whitespace-pre">{text}</span>
			)}
		</span>
	);
}
