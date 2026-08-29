"use client";
// beui.dev/components/motion/shader-background

import {
	ColorPanels,
	type ColorPanelsProps,
	Dithering,
	type DitheringProps,
	DotGrid,
	type DotGridProps,
	DotOrbit,
	type DotOrbitProps,
	GodRays,
	type GodRaysProps,
	GrainGradient,
	type GrainGradientProps,
	MeshGradient,
	type MeshGradientProps,
	Metaballs,
	type MetaballsProps,
	NeuroNoise,
	type NeuroNoiseProps,
	PerlinNoise,
	type PerlinNoiseProps,
	PulsingBorder,
	type PulsingBorderProps,
	SimplexNoise,
	type SimplexNoiseProps,
	SmokeRing,
	type SmokeRingProps,
	Spiral,
	type SpiralProps,
	StaticMeshGradient,
	type StaticMeshGradientProps,
	StaticRadialGradient,
	type StaticRadialGradientProps,
	Swirl,
	type SwirlProps,
	Voronoi,
	type VoronoiProps,
	Warp,
	type WarpProps,
	Water,
	type WaterProps,
	Waves,
	type WavesProps,
} from "@paper-design/shaders-react";
import { cn } from "@ryu/ui/lib/utils";
import { useReducedMotion } from "motion/react";
import type { ComponentType } from "react";

interface ShaderVariantProps {
	"color-panels": ColorPanelsProps;
	dithering: DitheringProps;
	"dot-grid": DotGridProps;
	"dot-orbit": DotOrbitProps;
	"god-rays": GodRaysProps;
	"grain-gradient": GrainGradientProps;
	"mesh-gradient": MeshGradientProps;
	metaballs: MetaballsProps;
	"neuro-noise": NeuroNoiseProps;
	"perlin-noise": PerlinNoiseProps;
	"pulsing-border": PulsingBorderProps;
	"simplex-noise": SimplexNoiseProps;
	"smoke-ring": SmokeRingProps;
	spiral: SpiralProps;
	"static-mesh-gradient": StaticMeshGradientProps;
	"static-radial-gradient": StaticRadialGradientProps;
	swirl: SwirlProps;
	voronoi: VoronoiProps;
	warp: WarpProps;
	water: WaterProps;
	waves: WavesProps;
}

export type ShaderBackgroundVariant = keyof ShaderVariantProps;

export type ShaderBackgroundProps = {
	[K in ShaderBackgroundVariant]: { variant: K } & ShaderVariantProps[K];
}[ShaderBackgroundVariant];

const VARIANT_COMPONENTS: {
	[K in ShaderBackgroundVariant]: ComponentType<ShaderVariantProps[K]>;
} = {
	"mesh-gradient": MeshGradient,
	"grain-gradient": GrainGradient,
	"dot-grid": DotGrid,
	"dot-orbit": DotOrbit,
	warp: Warp,
	waves: Waves,
	water: Water,
	voronoi: Voronoi,
	swirl: Swirl,
	"smoke-ring": SmokeRing,
	"static-radial-gradient": StaticRadialGradient,
	"neuro-noise": NeuroNoise,
	metaballs: Metaballs,
	"god-rays": GodRays,
	spiral: Spiral,
	dithering: Dithering,
	"pulsing-border": PulsingBorder,
	"color-panels": ColorPanels,
	"static-mesh-gradient": StaticMeshGradient,
	"simplex-noise": SimplexNoise,
	"perlin-noise": PerlinNoise,
};

export const SHADER_BACKGROUND_VARIANTS = Object.keys(
	VARIANT_COMPONENTS
) as ShaderBackgroundVariant[];

/**
 * Not every variant animates (e.g. dot-grid is a static pattern), so `speed`
 * is only frozen for reduced motion when the variant actually exposes it.
 */
export function ShaderBackground({
	variant,
	className,
	...rest
}: ShaderBackgroundProps) {
	const reducedMotion = useReducedMotion();
	const Shader = VARIANT_COMPONENTS[variant] as ComponentType<
		Record<string, unknown>
	>;
	const props = rest as Record<string, unknown>;
	const speedProps = reducedMotion && "speed" in props ? { speed: 0 } : {};

	return (
		<Shader
			{...props}
			{...speedProps}
			className={cn("h-full w-full", className)}
		/>
	);
}
