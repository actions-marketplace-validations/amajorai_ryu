// The theme-preferences blob: the cross-app contract persisted in Core under
// the `theme` preference key. Desktop writes it whenever appearance changes;
// island (and any future surface) reads it to render identically. Custom theme
// definitions travel inline so a user-saved preset id resolves anywhere, not
// just on the machine/process that created it.

import { DEFAULT_TIMEZONE } from "../lib/timezone.ts";
import { DEFAULT_CONTRAST, DEFAULT_RADIUS } from "./apply.ts";
import {
	DEFAULT_DARK_ID,
	DEFAULT_LIGHT_ID,
	type ThemeVariant,
} from "./presets.ts";

export const THEME_PREF_KEY = "theme";
export const THEME_PREFS_VERSION = 1;

/** Same-document signal for appearance stores that need to publish the theme blob. */
export const THEME_APPEARANCE_CHANGE_EVENT = "ryu:theme-appearance-change";

/** Defaults for the appearance values that are meaningful on every Ryu UI surface. */
export const DEFAULT_SPACING = 0.24;
export const DEFAULT_SCALE = 1;
export const DEFAULT_CARD_SPACING = 0.96;
export const DEFAULT_UI_FONT = '"Inter Variable", "Inter", sans-serif';
export const DEFAULT_HEADING_FONT = '"Geist Variable", "Geist", sans-serif';
export const DEFAULT_CODE_FONT =
	'"Geist Mono Variable", "Geist Mono", monospace';

export type ThemeMode = "light" | "dark" | "system";

// The mode a surface renders in before the user has ever picked one: follow the
// OS. EVERY reader of the persisted mode must fall back to this — a surface that
// defaults to "system" while its provider defaults to "light" (or vice versa)
// renders a fresh install with light-mode component variants over dark-preset
// tokens, and the mismatch only clears once the user toggles the theme by hand.
//
// "system" is only safe because every resolver consults `prefers-color-scheme`:
// next-themes is mounted with `enableSystem` on both windows, the desktop's
// `initTheme()`/`storedIsDark()` read the media query, and the island's
// `use-island-theme` watches DARK_QUERY. Adding a resolver that cannot follow
// the OS means picking a concrete default again, not special-casing it there.
export const DEFAULT_THEME_MODE: ThemeMode = "system";

export interface ThemePrefs {
	/** Whether the host replaces the shared motion path with a static one. */
	animationsEnabled?: boolean;
	/** Explicit card padding, or null to derive it from spacing. */
	cardSpacing?: number | null;
	/** Whether the host shows the optional navigation/sidebar shadows. */
	chromeShadows?: boolean;
	codeFont?: string;
	contrast: number;
	/** User-saved custom variants, shipped inline so ids resolve cross-app. */
	customThemes: ThemeVariant[];
	darkPreset: string;
	/** Whether dialogs use the optional dimmed/blurred backdrop. */
	dialogOverlayBlur?: boolean;
	headingFont?: string;
	/** Whether the host uses the page background for popup surfaces. */
	invertedBackgrounds?: boolean;
	lightPreset: string;
	/** Locale used for date/time and localized number display in other processes. */
	locale?: string;
	mode: ThemeMode;
	/** Whether interactive controls use a pointer cursor. */
	pointerCursor?: boolean;
	/** Whether anchored popup surfaces use a backdrop. */
	popupOverlayBlur?: boolean;
	radius: number;
	scale?: number;
	spacing?: number;
	/** Effective IANA display zone projected to other Ryu processes. */
	timezone?: string;
	uiFont?: string;
	version: number;
}

export function defaultThemePrefs(): ThemePrefs {
	return {
		version: THEME_PREFS_VERSION,
		mode: DEFAULT_THEME_MODE,
		lightPreset: DEFAULT_LIGHT_ID,
		darkPreset: DEFAULT_DARK_ID,
		contrast: DEFAULT_CONTRAST,
		radius: DEFAULT_RADIUS,
		spacing: DEFAULT_SPACING,
		scale: DEFAULT_SCALE,
		cardSpacing: null,
		pointerCursor: false,
		chromeShadows: true,
		dialogOverlayBlur: false,
		popupOverlayBlur: false,
		invertedBackgrounds: false,
		animationsEnabled: true,
		timezone: DEFAULT_TIMEZONE,
		customThemes: [],
	};
}

/** Tolerantly coerce an unknown payload (parsed JSON from Core) into ThemePrefs. */
export function normalizeThemePrefs(input: unknown): ThemePrefs {
	const base = defaultThemePrefs();
	if (!input || typeof input !== "object") {
		return base;
	}
	const raw = input as Record<string, unknown>;
	const mode = raw.mode;
	const cardSpacing = raw.cardSpacing;
	return {
		version: typeof raw.version === "number" ? raw.version : base.version,
		mode:
			mode === "light" || mode === "dark" || mode === "system"
				? mode
				: base.mode,
		lightPreset:
			typeof raw.lightPreset === "string" ? raw.lightPreset : base.lightPreset,
		darkPreset:
			typeof raw.darkPreset === "string" ? raw.darkPreset : base.darkPreset,
		contrast: typeof raw.contrast === "number" ? raw.contrast : base.contrast,
		radius: typeof raw.radius === "number" ? raw.radius : base.radius,
		spacing: typeof raw.spacing === "number" ? raw.spacing : base.spacing,
		scale: typeof raw.scale === "number" ? raw.scale : base.scale,
		cardSpacing:
			cardSpacing === null
				? null
				: typeof cardSpacing === "number"
					? cardSpacing
					: base.cardSpacing,
		pointerCursor:
			typeof raw.pointerCursor === "boolean"
				? raw.pointerCursor
				: base.pointerCursor,
		chromeShadows:
			typeof raw.chromeShadows === "boolean"
				? raw.chromeShadows
				: base.chromeShadows,
		dialogOverlayBlur:
			typeof raw.dialogOverlayBlur === "boolean"
				? raw.dialogOverlayBlur
				: base.dialogOverlayBlur,
		popupOverlayBlur:
			typeof raw.popupOverlayBlur === "boolean"
				? raw.popupOverlayBlur
				: base.popupOverlayBlur,
		invertedBackgrounds:
			typeof raw.invertedBackgrounds === "boolean"
				? raw.invertedBackgrounds
				: base.invertedBackgrounds,
		animationsEnabled:
			typeof raw.animationsEnabled === "boolean"
				? raw.animationsEnabled
				: base.animationsEnabled,
		locale: typeof raw.locale === "string" ? raw.locale : base.locale,
		timezone: typeof raw.timezone === "string" ? raw.timezone : base.timezone,
		customThemes: Array.isArray(raw.customThemes)
			? (raw.customThemes as ThemeVariant[])
			: base.customThemes,
		uiFont: typeof raw.uiFont === "string" ? raw.uiFont : undefined,
		headingFont:
			typeof raw.headingFont === "string" ? raw.headingFont : undefined,
		codeFont: typeof raw.codeFont === "string" ? raw.codeFont : undefined,
	};
}

/** Resolve the active variant id for a prefs blob given the effective dark/light. */
export function activePresetId(prefs: ThemePrefs, isDark: boolean): string {
	return isDark ? prefs.darkPreset : prefs.lightPreset;
}
