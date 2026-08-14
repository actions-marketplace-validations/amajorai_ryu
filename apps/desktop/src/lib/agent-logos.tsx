import type { GradientDirection } from "@ryu/ui/components/dither-kit/gradient";
import { isDitherColor } from "@ryu/ui/components/dither-kit/palette";
import type { GlyphDitherValue, GlyphValue } from "@ryu/ui/components/glyph.ts";
import { GlyphDisplay } from "@ryu/ui/components/glyph-display.tsx";
import { Logo as RyuLogo } from "@ryu/ui/components/logo";
import { cn } from "@ryu/ui/lib/utils";
import type { ComponentType } from "react";

type LogoConfig =
	| { kind: "single"; src: string; invert: boolean }
	| { kind: "themed"; light: string; dark: string };

/**
 * Brand marks for REGISTRY agents — the ones a user installs from the catalog
 * rather than the engines Ryu ships with. Slugs, resolved to
 * `/assets/logos/<slug>.svg` by {@link registryLogoConfig}.
 *
 * This is the same table the catalog row renders from (`REGISTRY_SVGL` in
 * `agent-catalog-logo.tsx`, which now re-exports this one). It lives HERE
 * because the catalog is not the only place these agents appear: installing
 * Cursor auto-creates a Cursor agent, and every surface that then draws it —
 * sidebar row, composer picker, agent editor — goes through {@link AgentLogo},
 * which knew only about `ENGINE_LOGOS` and so drew the Ryu ghost for all of them.
 *
 * Keys are registry agent ids, which is also what `normalizeEngine` yields for
 * an `acp:<id>` engine string.
 *
 * A `{light, dark}` pair is only for marks with achromatic parts that vanish
 * against the opposite surface (kimi's panel, mistral's unfilled squares). Solid
 * brand colours (amp's blue, jetbrains' gradient) stay single-asset — a dark
 * variant would only mis-colour them.
 */
export const REGISTRY_LOGO_SLUGS: Record<
	string,
	string | { light: string; dark: string }
> = {
	"amp-acp": "amp",
	cursor: { light: "cursor_light", dark: "cursor_dark" },
	"github-copilot-cli": { light: "copilot", dark: "copilot_dark" },
	"grok-build": { light: "grok-light", dark: "grok-dark" },
	junie: "jetbrains",
	kilo: { light: "kilocode-light", dark: "kilocode-dark" },
	kimi: { light: "kimi-icon", dark: "kimi-icon-dark" },
	"mistral-vibe": { light: "mistral-ai_logo", dark: "mistral-ai_logo_dark" },
	opencode: { light: "opencode", dark: "opencode-dark" },
	"qwen-code": { light: "qwen_light", dark: "qwen_dark" },
};

/** The registry brand mark for an agent id, as a {@link LogoConfig}. */
function registryLogoConfig(key: string): LogoConfig | undefined {
	const slug = REGISTRY_LOGO_SLUGS[key];
	if (!slug) {
		return undefined;
	}
	const url = (s: string) => `/assets/logos/${s}.svg`;
	return typeof slug === "string"
		? { kind: "single", src: url(slug), invert: false }
		: { kind: "themed", light: url(slug.light), dark: url(slug.dark) };
}

/** Registry agents that ship a brand mark of their own. */
export function hasRegistryLogo(key: string | null | undefined): boolean {
	return key != null && key in REGISTRY_LOGO_SLUGS;
}

const ENGINE_LOGOS: Record<string, LogoConfig> = {
	claude: {
		kind: "single",
		src: "/assets/logos/claude.svg",
		invert: false,
	},
	anthropic: {
		kind: "themed",
		light: "/assets/logos/anthropic_black.svg",
		dark: "/assets/logos/anthropic_white.svg",
	},
	codex: {
		kind: "themed",
		light: "/assets/logos/openai_light.svg",
		dark: "/assets/logos/openai_dark.svg",
	},
	openai: {
		kind: "themed",
		light: "/assets/logos/openai_light.svg",
		dark: "/assets/logos/openai_dark.svg",
	},
	gemini: {
		kind: "themed",
		light: "/assets/logos/gemini_light.svg",
		dark: "/assets/logos/gemini_dark.svg",
	},
	mistral: {
		kind: "single",
		src: "/assets/logos/mistral.svg",
		invert: false,
	},
	pi: {
		// pi.dev (the coding agent, `pi-acp`), NOT Inflection AI's Pi assistant. The
		// mark is a monochrome `currentColor` glyph → `invert` flips it white on dark.
		kind: "single",
		src: "/assets/logos/pi.svg",
		invert: true,
	},
	inflection: {
		kind: "themed",
		light: "/assets/logos/inflectionai_light.svg",
		dark: "/assets/logos/inflectionai_dark.svg",
	},
	ollama: {
		kind: "themed",
		light: "/assets/logos/ollama_light.svg",
		dark: "/assets/logos/ollama_dark.svg",
	},
	local: {
		kind: "themed",
		light: "/assets/logos/ollama_light.svg",
		dark: "/assets/logos/ollama_dark.svg",
	},
	ryu: {
		kind: "themed",
		light: "/assets/logos/ryu_light.svg",
		dark: "/assets/logos/ryu_dark.svg",
	},
	openclaw: {
		// The lobster mark from openclaw.ai/favicon.svg. Solid brand red on both
		// themes, so it stays single-asset — the old themed pair was a generic
		// circle glyph with nothing OpenClaw about it.
		kind: "single",
		src: "/assets/logos/openclaw.svg",
		invert: false,
	},
	hermes: {
		kind: "themed",
		light: "/assets/logos/hermes_light.svg",
		dark: "/assets/logos/hermes_dark.svg",
	},
};

export function hasBrandedEngineLogo(
	engine: string | null | undefined
): boolean {
	const key = normalizeEngine(engine);
	// Registry marks count as branded now that `AgentLogo` can draw them —
	// otherwise callers that use this to decide "does it need a fallback?" would
	// still route a Cursor agent to a generic mark.
	return key != null && (key in ENGINE_LOGOS || hasRegistryLogo(key));
}

/** Strip the "acp:" transport prefix and lowercase so "acp:Claude" → "claude". */
export function normalizeEngine(
	engine: string | null | undefined
): string | null {
	if (!engine) {
		return null;
	}
	const raw = engine.startsWith("acp:") ? engine.slice(4) : engine;
	return raw.toLowerCase();
}

/**
 * The engine key to brand an agent by. Prefers the agent's declared engine,
 * then falls back to the agent id for built-ins (so the flagship "ryu" brands
 * as Ryu). Mirrors the derivation used by the composer agent picker.
 */
export function engineForAgent(agent: {
	engine?: string | null;
	builtIn?: boolean | null;
	id: string;
}): string | null {
	return agent.engine ?? (agent.builtIn ? agent.id : null);
}

/**
 * Renders the provider logo for a given engine id. Unknown / unbranded engines
 * (custom agents, Factory droid, etc.) fall back to the Ryu logo — Ryu is the
 * car around any engine, so its own mark is the sensible default.
 */
export function AgentLogo({
	engine,
	className,
	size,
}: {
	engine?: string | null;
	className?: string;
	/** Explicit pixel size (e.g. "48px"). Required for the Ryu component path. */
	size?: string;
}) {
	const key = normalizeEngine(engine);
	// `ENGINE_LOGOS` first, then the CATALOG's brand marks. Both are needed: the
	// catalog's marks are keyed by registry agent id (`cursor`, `opencode`,
	// `qwen-code`, …) and were only ever consulted while rendering a catalog ROW,
	// so an agent auto-created by installing one of those — which is what happens
	// when you install Cursor — resolved through this function, missed, and fell
	// back to the Ryu ghost. The logo was set the whole time; nothing downstream of
	// the catalog looked at it. `normalizeEngine` strips the `acp:` prefix, so an
	// agent whose engine is `acp:cursor` matches the `cursor` entry directly.
	const known =
		(key ? ENGINE_LOGOS[key] : undefined) ??
		(key ? registryLogoConfig(key) : undefined);

	// Ryu (and any unbranded engine that falls back to it) renders via the logo
	// component's `outline` variant on sized surfaces: the static SVG's tight
	// `0 0 24 24` viewBox clips the stroked ghost's right edge, while the
	// component sets overflow:visible.
	if ((!known || key === "ryu") && size) {
		return <RyuLogo className={className} size={size} variant="outline" />;
	}

	const config = known ?? ENGINE_LOGOS.ryu;
	const alt = key ?? "ryu";
	const style = size ? { width: size, height: size } : undefined;

	if (config.kind === "themed") {
		return (
			<>
				{/* biome-ignore lint/performance/noImgElement lint/correctness/useImageSize: bundled engine logo */}
				<img
					alt={alt}
					className={cn(className, "block dark:hidden")}
					draggable={false}
					src={config.light}
					style={style}
				/>
				{/* biome-ignore lint/performance/noImgElement lint/correctness/useImageSize: bundled engine logo */}
				<img
					alt={alt}
					className={cn(className, "hidden dark:block")}
					draggable={false}
					src={config.dark}
					style={style}
				/>
			</>
		);
	}

	return (
		// biome-ignore lint/performance/noImgElement lint/correctness/useImageSize: bundled engine logo
		<img
			alt={alt}
			className={cn(className, config.invert && "dark:invert")}
			draggable={false}
			src={config.src}
			style={style}
		/>
	);
}

/** A dither-gradient avatar spec as stored on `persona.dither`. Kept structural
 * (not the `AgentPersona` type) so this leaf module stays free of the API layer. */
export interface AvatarDitherSpec {
	direction?: string | null;
	from?: string | null;
	to?: string | null;
}

const DITHER_DIRECTIONS: GradientDirection[] = ["up", "down", "left", "right"];

/** A DiceBear avatar spec as stored on `persona.dicebear`. */
export interface AvatarDicebearSpec {
	seed?: string | null;
	style?: string | null;
}

/**
 * Fold persona avatar fields into a {@link GlyphValue} for {@link GlyphDisplay}.
 * Priority: avatar_url → emoji (+ optional dither bg) → icon (+ optional dither
 * bg) → dicebear → dither-only.
 */
export function personaToGlyph(persona: {
	avatarUrl?: string | null;
	dicebear?: AvatarDicebearSpec | null;
	dither?: AvatarDitherSpec | null;
	emoji?: string | null;
	icon?: string | null;
	iconColor?: string | null;
}): GlyphValue {
	if (persona.avatarUrl) {
		return { kind: "avatar", dataUrl: persona.avatarUrl };
	}
	const ditherLayer: GlyphDitherValue | undefined =
		persona.dither && isDitherColor(persona.dither.from)
			? {
					from: persona.dither.from,
					to: isDitherColor(persona.dither.to) ? persona.dither.to : null,
					direction:
						DITHER_DIRECTIONS.find((d) => d === persona.dither?.direction) ??
						"up",
				}
			: undefined;
	if (persona.emoji) {
		return {
			kind: "emoji",
			emoji: persona.emoji,
			...(ditherLayer ? { dither: ditherLayer } : {}),
		};
	}
	if (persona.icon) {
		return {
			kind: "icon",
			id: persona.icon,
			...(persona.iconColor ? { color: persona.iconColor } : {}),
			...(ditherLayer ? { dither: ditherLayer } : {}),
		};
	}
	if (persona.dicebear?.style && persona.dicebear.seed) {
		return {
			kind: "dicebear",
			style: persona.dicebear.style,
			seed: persona.dicebear.seed,
		};
	}
	if (ditherLayer) {
		return { kind: "dither", dither: ditherLayer };
	}
	return null;
}

/**
 * Renders an agent's avatar, resolving the persona's avatar source in priority
 * order: uploaded image → emoji → icon → DiceBear → dither → engine logo.
 * Use this at every call site that shows "an agent" so a custom avatar wins
 * over the engine default consistently.
 */
export function AgentAvatar({
	avatarUrl,
	emoji,
	icon,
	iconColor,
	dicebear,
	dither,
	engine,
	className,
	size,
}: {
	avatarUrl?: string | null;
	className?: string;
	dicebear?: AvatarDicebearSpec | null;
	dither?: AvatarDitherSpec | null;
	emoji?: string | null;
	engine?: string | null;
	icon?: string | null;
	iconColor?: string | null;
	size?: string;
}) {
	const parsed = size ? Number.parseInt(size, 10) : Number.NaN;
	const px = Number.isNaN(parsed) ? 16 : parsed;
	const glyph = personaToGlyph({
		avatarUrl,
		emoji,
		icon,
		iconColor,
		dicebear,
		dither,
	});
	if (glyph) {
		return (
			<GlyphDisplay
				alt="agent avatar"
				className={cn(className, "rounded-[inherit] object-cover")}
				size={px}
				value={glyph}
			/>
		);
	}
	return <AgentLogo className={className} engine={engine} size={size} />;
}

// Stable icon cache for AgentAvatar, keyed by avatar+engine so ModeOption.icon
// keeps a stable reference across renders (see getEngineIcon).
const agentIconCache = new Map<string, ComponentType<{ className?: string }>>();

/**
 * Stable ComponentType<{ className? }> for use in ModeOption.icon that honors a
 * custom avatar (image, icon, or dither gradient), falling back to the engine
 * logo. Mirrors getEngineIcon.
 */
export function getAgentIcon(
	avatarUrl: string | null | undefined,
	engine: string | null | undefined,
	icon?: string | null,
	dither?: AvatarDitherSpec | null
): ComponentType<{ className?: string }> {
	if (!(avatarUrl || icon || dither)) {
		return getEngineIcon(engine);
	}
	const ditherKey = dither
		? `${dither.from ?? ""}:${dither.to ?? ""}:${dither.direction ?? ""}`
		: "";
	const cacheKey = `avatar:${avatarUrl ?? ""}|icon:${icon ?? ""}|dither:${ditherKey}`;
	if (!agentIconCache.has(cacheKey)) {
		const url = avatarUrl;
		const iconId = icon;
		const ditherSpec = dither;
		const eng = engine;
		const AvatarIcon = ({ className }: { className?: string }) => (
			<AgentAvatar
				avatarUrl={url}
				className={className}
				dither={ditherSpec}
				engine={eng}
				icon={iconId}
				size="16px"
			/>
		);
		agentIconCache.set(cacheKey, AvatarIcon);
	}
	// biome-ignore lint/style/noNonNullAssertion: just set above when missing
	return agentIconCache.get(cacheKey)!;
}

export interface AgentAvatarMember {
	avatarUrl?: string | null;
	dither?: AvatarDitherSpec | null;
	engine?: string | null;
	icon?: string | null;
	id: string;
}

/** Overlapping agent avatars (custom image when set, else engine logo). */
export function AgentAvatarStack({
	members,
	className,
	size = "sm",
}: {
	members: AgentAvatarMember[];
	className?: string;
	/** `sm` fits sidebar rows (16px slot); `xs` for nested member rows. */
	size?: "sm" | "xs";
}) {
	const shown = members.slice(0, 3);
	if (shown.length === 0) {
		return (
			<AgentAvatar
				className={cn("shrink-0 object-contain", className)}
				engine={null}
				size={size === "xs" ? "12px" : "16px"}
			/>
		);
	}
	const outer = size === "xs" ? "size-3" : "size-4";
	const logo = size === "xs" ? "10px" : "12px";
	const overlap = size === "xs" ? "-ml-1" : "-ml-1.5";
	return (
		<span className={cn("inline-flex shrink-0 items-center", className)}>
			{shown.map((member, i) => (
				<span
					className={cn(
						"flex items-center justify-center rounded-full bg-background ring-1 ring-border",
						outer,
						i > 0 && overlap
					)}
					key={member.id}
					style={{ zIndex: shown.length - i }}
				>
					<AgentAvatar
						avatarUrl={member.avatarUrl}
						className="object-contain"
						dither={member.dither}
						engine={member.engine}
						icon={member.icon}
						size={shown.length === 1 && size === "sm" ? "16px" : logo}
					/>
				</span>
			))}
		</span>
	);
}

/** An overlapping row of member engine logos for a team — no card chrome. */
export function AgentLogoStack({
	engines,
	className,
}: {
	engines: (string | null)[];
	className?: string;
}) {
	const shown = engines.slice(0, 3);
	if (shown.length === 0) {
		return <AgentLogo className={className} engine={null} />;
	}
	// Disambiguate repeated engines (a team can have two Ryu members) so keys are
	// stable without falling back to the array index.
	const counts = new Map<string, number>();
	const items = shown.map((eng) => {
		const base = normalizeEngine(eng) ?? "ryu";
		const n = (counts.get(base) ?? 0) + 1;
		counts.set(base, n);
		return { engine: eng, key: `${base}-${n}` };
	});
	return (
		<span className={cn("inline-flex shrink-0 items-center", className)}>
			{items.map((item, i) => (
				<AgentLogo
					className={cn("size-4 shrink-0", i > 0 && "-ml-1.5")}
					engine={item.engine}
					key={item.key}
					size="16px"
				/>
			))}
		</span>
	);
}

const teamIconCache = new Map<string, ComponentType<{ className?: string }>>();

/** Stable ModeOption.icon rendering a team's members as an overlapping stack. */
export function getTeamStackIcon(
	engines: (string | null)[]
): ComponentType<{ className?: string }> {
	const cacheKey = engines.map((e) => normalizeEngine(e) ?? "ryu").join(",");
	if (!teamIconCache.has(cacheKey)) {
		const list = engines;
		const Icon = () => <AgentLogoStack className="mt-0.5" engines={list} />;
		teamIconCache.set(cacheKey, Icon);
	}
	// biome-ignore lint/style/noNonNullAssertion: just set above when missing
	return teamIconCache.get(cacheKey)!;
}

// Stable icon component cache — prevents ModeOption.icon from being a new
// function reference on every render, which would cause ModeSelector to
// unmount/remount the icon on each parent re-render.
const engineIconCache = new Map<
	string,
	ComponentType<{ className?: string }>
>();

/**
 * Returns a stable ComponentType<{ className? }> for use in ModeOption.icon.
 * Cached by engine key so the reference is stable across renders.
 */
export function getEngineIcon(
	engine: string | null | undefined
): ComponentType<{ className?: string }> {
	const cacheKey = normalizeEngine(engine) ?? "__fallback__";
	if (!engineIconCache.has(cacheKey)) {
		const eng = engine;
		const Icon = ({ className }: { className?: string }) => (
			<AgentLogo className={className} engine={eng} size="16px" />
		);
		engineIconCache.set(cacheKey, Icon);
		return Icon;
	}
	return engineIconCache.get(cacheKey) as ComponentType<{ className?: string }>;
}
