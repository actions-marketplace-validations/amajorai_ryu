"use client";

import {
	DitherGradient,
	type GradientDirection,
} from "@ryu/ui/components/dither-kit/gradient";
import type { DitherColor } from "@ryu/ui/components/dither-kit/palette";
import { fnv1a, xorshift32 } from "@ryu/ui/components/dither-kit/pixel";
import { cn } from "@ryu/ui/lib/utils";
import { useMemo } from "react";

const BANNER_COLORS: DitherColor[] = [
	"purple",
	"blue",
	"green",
	"pink",
	"orange",
	"red",
];

const BANNER_DIRECTIONS: GradientDirection[] = ["up", "down", "left", "right"];

export function SeededGrainientBanner({
	seed,
	className,
}: {
	seed: string;
	className?: string;
}) {
	const seedData = useMemo(() => {
		const hash = fnv1a(seed);
		const rand = xorshift32(hash);
		const color = BANNER_COLORS[Math.floor(rand() * BANNER_COLORS.length)];
		const direction =
			BANNER_DIRECTIONS[Math.floor(rand() * BANNER_DIRECTIONS.length)];
		return { color, direction };
	}, [seed]);

	return (
		<div className={cn("relative overflow-hidden", className)}>
			<DitherGradient
				bloom="low"
				direction={seedData.direction}
				from={seedData.color}
				opacity={0.85}
			/>
		</div>
	);
}
