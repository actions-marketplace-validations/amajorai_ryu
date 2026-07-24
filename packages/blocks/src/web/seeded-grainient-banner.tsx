"use client";

import { fnv1a, xorshift32 } from "@ryu/ui/components/dither-kit/pixel";
import { useMemo } from "react";
import Grainient from "./grainient.jsx";

const MESH_COLORS = [
	"#FF9FFC", // soft pink
	"#5227FF", // deep purple
	"#B497CF", // lavender
	"#FF6B6B", // coral
	"#4ECDC4", // teal
	"#45B7D1", // sky blue
	"#96CEB4", // sage green
	"#FFEAA7", // soft yellow
	"#DDA0DD", // plum
	"#98D8C8", // mint
	"#F7DC6F", // gold
	"#BB8FCE", // soft purple
];

function pickColors(seed: string): [string, string, string] {
	const hash = fnv1a(seed);
	const rand = xorshift32(hash);
	const i1 = Math.floor(rand() * MESH_COLORS.length);
	let i2 = Math.floor(rand() * (MESH_COLORS.length - 1));
	if (i2 >= i1) {
		i2 += 1;
	}
	let i3 = Math.floor(rand() * (MESH_COLORS.length - 2));
	const used = new Set([i1, i2]);
	for (const idx of used) {
		if (i3 >= idx) {
			i3 += 1;
		}
	}
	return [MESH_COLORS[i1], MESH_COLORS[i2], MESH_COLORS[i3]];
}

export function SeededGrainientBanner({
	seed,
	className,
}: {
	seed: string;
	className?: string;
}) {
	const [color1, color2, color3] = useMemo(() => pickColors(seed), [seed]);

	return (
		<Grainient
			blendAngle={30}
			blendSoftness={0.3}
			className={className}
			color1={color1}
			color2={color2}
			color3={color3}
			contrast={1}
			gamma={1}
			grainAmount={0}
			grainAnimated={false}
			noiseScale={0}
			rotationAmount={200}
			saturation={1.1}
			timeSpeed={0.15}
			warpAmplitude={60}
			warpFrequency={3}
			warpSpeed={1}
			warpStrength={1}
			zoom={0.8}
		/>
	);
}
