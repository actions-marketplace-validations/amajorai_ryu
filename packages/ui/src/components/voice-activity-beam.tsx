"use client";

import { cn } from "@ryu/ui/lib/utils.ts";
import { useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import type { BorderBeamTheme } from "./border-beam.tsx";
import { BorderBeam } from "./border-beam.tsx";

const WAVEFORM_BAR_COUNT = 16;
const MIN_BAR_HEIGHT = 3;
const MAX_BAR_HEIGHT = 18;

export interface VoiceActivityBeamProps {
	active?: boolean;
	children?: ReactNode;
	className?: string;
	/** Rolling mic RMS values, oldest-to-newest. */
	levels: readonly number[];
	/** Beam theme, matching the surface behind the visual. */
	theme?: BorderBeamTheme;
}

function clampLevel(level: number): number {
	return Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
}

function visibleLevels(levels: readonly number[]): number[] {
	const recent = levels
		.slice(-WAVEFORM_BAR_COUNT)
		.map((level) => clampLevel(level));
	if (recent.length === WAVEFORM_BAR_COUNT) {
		return recent;
	}
	return [
		...new Array<number>(WAVEFORM_BAR_COUNT - recent.length).fill(0),
		...recent,
	];
}

/** A compact, decorative mic waveform framed by the installed line beam. */
export function VoiceActivityBeam({
	active = true,
	children,
	levels,
	theme = "dark",
	className,
}: VoiceActivityBeamProps) {
	const reducedMotion = useReducedMotion() ?? false;
	const bars = visibleLevels(levels);

	return (
		<BorderBeam
			active={active && !reducedMotion}
			borderRadius={999}
			className={cn("shrink-0", className)}
			colorVariant="ocean"
			duration={2.4}
			size="line"
			strength={0.72}
			theme={theme}
		>
			<div
				className={cn(
					"relative min-h-7 overflow-hidden rounded-full bg-background/55",
					children
						? "min-h-full"
						: "flex h-full items-center justify-center px-3"
				)}
				data-voice-activity-beam="waveform"
			>
				{children}
				<div
					aria-hidden="true"
					className={cn(
						"pointer-events-none flex items-center justify-center gap-1",
						children ? "absolute inset-x-3 bottom-1 h-3 opacity-70" : "h-full"
					)}
				>
					{bars.map((level, index) => {
						const height =
							MIN_BAR_HEIGHT + level * (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT);
						const opacity = 0.35 + level * 0.65;
						return (
							<span
								className="w-0.5 rounded-full bg-current text-sky-300 transition-[height,opacity] duration-100 ease-out motion-reduce:transition-none"
								key={index}
								style={{ height: `${height}px`, opacity }}
							/>
						);
					})}
				</div>
			</div>
		</BorderBeam>
	);
}
