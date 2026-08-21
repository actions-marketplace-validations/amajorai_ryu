/**
 * Shared glyph value model for entity icons / avatars across the product
 * (agents, project folders, spaces, pages, meetings, …).
 *
 * The canonical kinds are `avatar` | `icon` | `emoji` | `dicebear`. Agents also
 * allow the `expressive` ghost avatar and legacy `dither` gradient. Hosts pick
 * an allowlist via
 * {@link GLYPH_PRESETS} so every surface offers the same options consistently.
 */

import type { GradientDirection } from "@ryu/ui/components/dither-kit/gradient.tsx";
import type { DitherColor } from "@ryu/ui/components/dither-kit/palette.ts";
import type { ExpressiveExpressionSelection } from "@ryu/ui/components/expressive.ts";
import type { ExpressiveAnimationSelection } from "@ryu/ui/components/expressive-animation.ts";

/** Every glyph kind the primitive understands. */
export type GlyphKind =
	| "avatar"
	| "icon"
	| "emoji"
	| "dicebear"
	| "expressive"
	| "dither";

/** Dither-gradient payload (agent-only / legacy). */
export interface GlyphDitherValue {
	direction: GradientDirection;
	from: DitherColor;
	/** Second palette colour, or null for a fade to transparent. */
	to: DitherColor | null;
}

/**
 * Discriminated glyph value. Primary kinds are mutually exclusive. Icons and
 * emojis may optionally carry a {@link GlyphDitherValue} as a background layer
 * (DiceBear and uploaded avatars do not mix with dither). `null` means "no
 * custom glyph; use the surface fallback".
 */
export type GlyphValue =
	| { kind: "avatar"; dataUrl: string }
	| { kind: "icon"; id: string; color?: string; dither?: GlyphDitherValue }
	| { kind: "emoji"; emoji: string; dither?: GlyphDitherValue }
	| { kind: "dicebear"; style: string; seed: string }
	| {
			animation?: ExpressiveAnimationSelection;
			expression: ExpressiveExpressionSelection;
			kind: "expressive";
	  }
	| { kind: "dither"; dither: GlyphDitherValue }
	| null;

/** Dither payload when present — standalone dither, or icon/emoji background. */
export function glyphDitherOf(value: GlyphValue): GlyphDitherValue | undefined {
	if (!value) {
		return undefined;
	}
	if (value.kind === "dither") {
		return value.dither;
	}
	if (value.kind === "icon" || value.kind === "emoji") {
		return value.dither;
	}
	return undefined;
}

/** Preset allowlists so hosts don't invent their own subsets. */
export const GLYPH_PRESETS = {
	/**
	 * Notion-style entity icons: spaces, pages, meetings, project folders, etc.
	 * Exactly: avatar, icon, emoji, dicebear.
	 */
	entity: [
		"avatar",
		"icon",
		"emoji",
		"dicebear",
	] as const satisfies readonly GlyphKind[],
	/**
	 * Agent persona avatars — the shared four plus expressive ghost faces and
	 * the legacy dither gradient so existing agent personas remain editable.
	 */
	agent: [
		"avatar",
		"icon",
		"emoji",
		"dicebear",
		"expressive",
		"dither",
	] as const satisfies readonly GlyphKind[],
} as const;

export type GlyphPresetName = keyof typeof GLYPH_PRESETS;

/** Resolve a preset name or explicit allowlist into a kind array. */
export function resolveGlyphKinds(
	allowed: readonly GlyphKind[] | GlyphPresetName
): readonly GlyphKind[] {
	if (typeof allowed === "string") {
		return GLYPH_PRESETS[allowed];
	}
	return allowed;
}

/** Which picker tab a stored value opens on (falls back to first allowed). */
export function tabForGlyphValue(
	value: GlyphValue,
	allowed: readonly GlyphKind[]
): GlyphKind {
	if (value && allowed.includes(value.kind)) {
		return value.kind;
	}
	return allowed[0] ?? "avatar";
}

/**
 * All DiceBear styles from https://www.dicebear.com/styles/ (API kebab-case ids).
 * Kept as a const list so the picker never depends on a network catalog fetch.
 */
export const DICEBEAR_STYLES = [
	// Minimalist
	"disco",
	"glass",
	"glyphs",
	"icons",
	"identicon",
	"initial-face",
	"initials",
	"rings",
	"shapes",
	"shape-grid",
	"stripes",
	"thumbs",
	"triangles",
	// Characters
	"adventurer",
	"adventurer-neutral",
	"avataaars",
	"avataaars-neutral",
	"big-ears",
	"big-ears-neutral",
	"big-smile",
	"bottts",
	"bottts-neutral",
	"croodles",
	"croodles-neutral",
	"dylan",
	"fun-emoji",
	"lorelei",
	"lorelei-neutral",
	"micah",
	"miniavs",
	"notionists",
	"notionists-neutral",
	"open-peeps",
	"personas",
	"pixel-art",
	"pixel-art-neutral",
	"toon-head",
] as const;

export type DicebearStyle = (typeof DICEBEAR_STYLES)[number];

export const DEFAULT_DICEBEAR_STYLE: DicebearStyle = "notionists";

/** DiceBear HTTP API major version (matches existing discussion-kit mocks). */
export const DICEBEAR_API_VERSION = "9.x";

/** Build a DiceBear SVG URL for an `<img src>`. */
export function dicebearUrl(
	style: string,
	seed: string,
	opts: { size?: number } = {}
): string {
	const params = new URLSearchParams({ seed: seed || "ryu" });
	if (opts.size) {
		params.set("size", String(opts.size));
	}
	return `https://api.dicebear.com/${DICEBEAR_API_VERSION}/${style}/svg?${params}`;
}

/** Human label for a DiceBear style id (`notionists-neutral` → `Notionists Neutral`). */
export function dicebearStyleLabel(style: string): string {
	return style
		.split("-")
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

/** Curated icon tint swatches; `undefined` = inherit `currentColor` (theme-aware). */
export const GLYPH_ICON_COLORS: { label: string; value: string | undefined }[] =
	[
		{ label: "Default", value: undefined },
		{ label: "Red", value: "#ef4444" },
		{ label: "Orange", value: "#f97316" },
		{ label: "Amber", value: "#f59e0b" },
		{ label: "Green", value: "#22c55e" },
		{ label: "Teal", value: "#14b8a6" },
		{ label: "Blue", value: "#3b82f6" },
		{ label: "Indigo", value: "#6366f1" },
		{ label: "Purple", value: "#a855f7" },
		{ label: "Pink", value: "#ec4899" },
		{ label: "Gray", value: "#6b7280" },
		{ label: "Black", value: "#111827" },
	];

const ICONIFY_API = "https://api.iconify.design";

/** A single Iconify search hit. */
export interface GlyphIconHit {
	id: string;
	previewUrl: string;
}

/** Build an Iconify SVG URL, optionally tinted. */
export function glyphIconSvgUrl(
	id: string,
	opts: { color?: string; size?: number } = {}
): string {
	const path = id.replace(":", "/");
	const params = new URLSearchParams();
	if (opts.color) {
		params.set("color", opts.color);
	}
	if (opts.size) {
		params.set("width", String(opts.size));
		params.set("height", String(opts.size));
	}
	const qs = params.toString();
	return `${ICONIFY_API}/${path}.svg${qs ? `?${qs}` : ""}`;
}

/**
 * Search Iconify across all collections. Empty query returns a Lucide starter
 * set so the grid isn't blank on first open.
 */
export async function searchGlyphIcons(
	query: string,
	limit = 64
): Promise<GlyphIconHit[]> {
	const q = query.trim();
	const url = q
		? `${ICONIFY_API}/search?query=${encodeURIComponent(q)}&limit=${limit}`
		: `${ICONIFY_API}/collection?prefix=lucide`;
	const resp = await fetch(url);
	if (!resp.ok) {
		throw new Error(`icon search failed: ${resp.status}`);
	}
	const data = (await resp.json()) as {
		icons?: string[];
		uncategorized?: string[];
		categories?: Record<string, string[]>;
	};
	let ids: string[];
	if (q) {
		ids = data.icons ?? [];
	} else {
		const names = [
			...(data.uncategorized ?? []),
			...Object.values(data.categories ?? {}).flat(),
		].slice(0, limit);
		ids = names.map((n) => `lucide:${n}`);
	}
	return ids.map((id) => ({
		id,
		previewUrl: glyphIconSvgUrl(id, { color: "#888888" }),
	}));
}

/** Random seed for a fresh DiceBear avatar. */
export function randomDicebearSeed(): string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
	let out = "";
	for (let i = 0; i < 10; i++) {
		out += alphabet[Math.floor(Math.random() * alphabet.length)];
	}
	return out;
}

const GLYPH_KINDS = new Set<GlyphKind>([
	"avatar",
	"icon",
	"emoji",
	"dicebear",
	"expressive",
	"dither",
]);

/**
 * Narrow unknown JSON (sidebar `row.raw.icon`, `shell.openTab` opts, …) to a
 * {@link GlyphValue}. Returns `undefined` when the value is missing or not a
 * recognisable glyph shape so callers can leave an existing tab icon untouched.
 * Explicit `null` means "no custom glyph" and is a valid {@link GlyphValue}.
 */
export function asGlyphValue(data: unknown): GlyphValue | undefined {
	if (data === undefined) {
		return undefined;
	}
	if (data === null) {
		return null;
	}
	if (typeof data !== "object" || !("kind" in data)) {
		return undefined;
	}
	const kind = (data as { kind: unknown }).kind;
	if (typeof kind !== "string" || !GLYPH_KINDS.has(kind as GlyphKind)) {
		return undefined;
	}
	return data as GlyphValue;
}
