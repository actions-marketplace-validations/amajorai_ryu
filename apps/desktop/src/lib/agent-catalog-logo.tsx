import { cn } from "@ryu/ui/lib/utils";
import { useState } from "react";
import {
	AgentLogo,
	engineForAgent,
	hasBrandedEngineLogo,
	REGISTRY_LOGO_SLUGS,
} from "@/src/lib/agent-logos.tsx";
import type { AgentCatalogEntry } from "@/src/lib/api/agents.ts";

type SvglSpec = string | { light: string; dark: string };

// Bundled brand marks (originally svgl.app) served from the desktop public dir.
const svglUrl = (slug: string) => `/assets/logos/${slug}.svg`;

/**
 * SVGL slug overrides for registry agents where svgl.app has a polished brand
 * mark. Curated agents with bundled local logos (claude, codex, gemini, pi,
 * ryu, openclaw, hermes) are handled by {@link AgentLogo} instead.
 *
 * A `{ light, dark }` spec is only needed for marks with achromatic parts that
 * disappear against the opposite surface (kimi's panel, mistral's unfilled
 * squares). Solid brand colours (amp's blue, jetbrains' gradient) read on both
 * themes, so they stay single-asset — a dark variant would only mis-colour them.
 */
// Re-exported from `agent-logos`, NOT declared here. It used to live in this file
// alone, which meant the marks existed only while a CATALOG ROW was on screen: the
// Cursor agent that installing Cursor creates rendered through `AgentLogo`
// everywhere else and fell back to the Ryu ghost. One table, both paths.
const REGISTRY_SVGL: Record<string, SvglSpec> = REGISTRY_LOGO_SLUGS;

function SvglLogo({
	spec,
	alt,
	className,
	size,
}: {
	spec: SvglSpec;
	alt: string;
	className?: string;
	size: string;
}) {
	const style = { width: size, height: size };
	if (typeof spec === "string") {
		return (
			// biome-ignore lint/performance/noImgElement lint/correctness/useImageSize: bundled logo asset
			<img
				alt={alt}
				className={cn(className, "shrink-0 object-contain")}
				draggable={false}
				src={svglUrl(spec)}
				style={style}
			/>
		);
	}
	return (
		<>
			{/* biome-ignore lint/performance/noImgElement lint/correctness/useImageSize: bundled logo asset */}
			<img
				alt={alt}
				className={cn(className, "block shrink-0 object-contain dark:hidden")}
				draggable={false}
				src={svglUrl(spec.light)}
				style={style}
			/>
			{/* biome-ignore lint/performance/noImgElement lint/correctness/useImageSize: bundled logo asset */}
			<img
				alt={alt}
				className={cn(className, "hidden shrink-0 object-contain dark:block")}
				draggable={false}
				src={svglUrl(spec.dark)}
				style={style}
			/>
		</>
	);
}

/** Logo for an agent catalog row: local engine assets → bundled SVGL → Ryu. */
export function AgentCatalogLogo({
	entry,
	className,
	size = "16px",
}: {
	/** Only four fields are ever read — `id`, `name`, `engine`, `registryId` — so
	 *  the parameter is typed as that subset rather than the whole catalog entry.
	 *  The Store's Home shelf has a normalized `HomeCard`, not an
	 *  `AgentCatalogEntry`, and widening here is honest where a cast at the call
	 *  site would have claimed fields that are simply absent. */
	entry: Pick<AgentCatalogEntry, "engine" | "id" | "name" | "registryId">;
	className?: string;
	size?: string;
}) {
	const engine = engineForAgent({
		id: entry.id,
		engine: entry.engine,
		builtIn: true,
	});

	if (hasBrandedEngineLogo(engine)) {
		return <AgentLogo className={className} engine={engine} size={size} />;
	}

	const svgl = entry.registryId ? REGISTRY_SVGL[entry.registryId] : undefined;
	if (svgl) {
		return (
			<SvglLogo
				alt={entry.name}
				className={className}
				size={size}
				spec={svgl}
			/>
		);
	}

	// Uncurated registry agents fall back to their bundled ACP brand mark
	// (downloaded from the ACP registry CDN into `/assets/logos/acp/`, never
	// fetched at runtime). These marks are monochrome `currentColor` glyphs, so
	// `dark:invert` flips the rendered-black mark to white on dark surfaces. Any
	// id without a bundled file degrades to the Ryu ghost via `onError`.
	if (entry.registryId) {
		return (
			<AcpBrandLogo
				alt={entry.name}
				className={className}
				engine={engine}
				registryId={entry.registryId}
				size={size}
			/>
		);
	}

	// No engine brand, no registry id — the Ryu ghost is the sensible default.
	return <AgentLogo className={className} engine={engine} size={size} />;
}

/**
 * Bundled ACP registry brand mark for `registryId`, tinted for the theme. Falls
 * back to the Ryu ghost when no local `/assets/logos/acp/<id>.svg` was bundled.
 */
function AcpBrandLogo({
	registryId,
	engine,
	alt,
	className,
	size,
}: {
	registryId: string;
	engine: string | null;
	alt: string;
	className?: string;
	size: string;
}) {
	const [failed, setFailed] = useState(false);
	if (failed) {
		return <AgentLogo className={className} engine={engine} size={size} />;
	}
	return (
		// biome-ignore lint/performance/noImgElement lint/correctness/useImageSize: bundled logo asset
		<img
			alt={alt}
			className={cn(className, "shrink-0 object-contain dark:invert")}
			draggable={false}
			onError={() => setFailed(true)}
			src={`/assets/logos/acp/${registryId}.svg`}
			style={{ width: size, height: size }}
		/>
	);
}
