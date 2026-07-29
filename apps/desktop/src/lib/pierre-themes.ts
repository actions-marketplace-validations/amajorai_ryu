// apps/desktop/src/lib/pierre-themes.ts
//
// The syntax-theme catalog shared by the two Pierre surfaces: `@pierre/diffs`
// (workspace Changes tab) and `@pierre/trees` (workspace Files tab). Both render
// through the same Shiki bundle that `@pierre/diffs` ships — diffs consumes the
// theme name directly, trees consumes the *resolved* theme through
// `themeToTreeStyles()` — so one list feeds both pickers, and each surface keeps
// its own light/dark pair.
//
// The ids MUST match Shiki's bundled ids exactly: `resolveTheme` looks the name
// up in `bundledThemes` and THROWS ("No valid loader for X") on a miss, so a
// typo here is a runtime crash, not a type error. This list is a dump of
// `bundledThemesInfo` from the Shiki version `@pierre/diffs` resolves (3.x),
// plus the two `pierre-*` themes the library registers on import.

export interface PierreThemeOption {
	label: string;
	value: string;
}

/** Light-mode themes, in the order they appear in the pickers. */
export const PIERRE_LIGHT_THEMES: readonly PierreThemeOption[] = [
	{ value: "pierre-light", label: "Pierre Light" },
	{ value: "ayu-light", label: "Ayu Light" },
	{ value: "catppuccin-latte", label: "Catppuccin Latte" },
	{ value: "everforest-light", label: "Everforest Light" },
	{ value: "github-light", label: "GitHub Light" },
	{ value: "github-light-default", label: "GitHub Light Default" },
	{ value: "github-light-high-contrast", label: "GitHub Light High Contrast" },
	{ value: "gruvbox-light-hard", label: "Gruvbox Light Hard" },
	{ value: "gruvbox-light-medium", label: "Gruvbox Light Medium" },
	{ value: "gruvbox-light-soft", label: "Gruvbox Light Soft" },
	{ value: "kanagawa-lotus", label: "Kanagawa Lotus" },
	{ value: "light-plus", label: "Light Plus" },
	{ value: "material-theme-lighter", label: "Material Theme Lighter" },
	{ value: "min-light", label: "Min Light" },
	{ value: "night-owl-light", label: "Night Owl Light" },
	{ value: "one-light", label: "One Light" },
	{ value: "rose-pine-dawn", label: "Rosé Pine Dawn" },
	{ value: "slack-ochin", label: "Slack Ochin" },
	{ value: "snazzy-light", label: "Snazzy Light" },
	{ value: "solarized-light", label: "Solarized Light" },
	{ value: "vitesse-light", label: "Vitesse Light" },
] as const;

/** Dark-mode themes, in the order they appear in the pickers. */
export const PIERRE_DARK_THEMES: readonly PierreThemeOption[] = [
	{ value: "pierre-dark", label: "Pierre Dark" },
	{ value: "andromeeda", label: "Andromeeda" },
	{ value: "aurora-x", label: "Aurora X" },
	{ value: "ayu-dark", label: "Ayu Dark" },
	{ value: "ayu-mirage", label: "Ayu Mirage" },
	{ value: "catppuccin-frappe", label: "Catppuccin Frappé" },
	{ value: "catppuccin-macchiato", label: "Catppuccin Macchiato" },
	{ value: "catppuccin-mocha", label: "Catppuccin Mocha" },
	{ value: "dark-plus", label: "Dark Plus" },
	{ value: "dracula", label: "Dracula" },
	{ value: "dracula-soft", label: "Dracula Soft" },
	{ value: "everforest-dark", label: "Everforest Dark" },
	{ value: "github-dark", label: "GitHub Dark" },
	{ value: "github-dark-default", label: "GitHub Dark Default" },
	{ value: "github-dark-dimmed", label: "GitHub Dark Dimmed" },
	{ value: "github-dark-high-contrast", label: "GitHub Dark High Contrast" },
	{ value: "gruvbox-dark-hard", label: "Gruvbox Dark Hard" },
	{ value: "gruvbox-dark-medium", label: "Gruvbox Dark Medium" },
	{ value: "gruvbox-dark-soft", label: "Gruvbox Dark Soft" },
	{ value: "horizon", label: "Horizon" },
	{ value: "horizon-bright", label: "Horizon Bright" },
	{ value: "houston", label: "Houston" },
	{ value: "kanagawa-dragon", label: "Kanagawa Dragon" },
	{ value: "kanagawa-wave", label: "Kanagawa Wave" },
	{ value: "laserwave", label: "LaserWave" },
	{ value: "material-theme", label: "Material Theme" },
	{ value: "material-theme-darker", label: "Material Theme Darker" },
	{ value: "material-theme-ocean", label: "Material Theme Ocean" },
	{ value: "material-theme-palenight", label: "Material Theme Palenight" },
	{ value: "min-dark", label: "Min Dark" },
	{ value: "monokai", label: "Monokai" },
	{ value: "night-owl", label: "Night Owl" },
	{ value: "nord", label: "Nord" },
	{ value: "one-dark-pro", label: "One Dark Pro" },
	{ value: "plastic", label: "Plastic" },
	{ value: "poimandres", label: "Poimandres" },
	{ value: "red", label: "Red" },
	{ value: "rose-pine", label: "Rosé Pine" },
	{ value: "rose-pine-moon", label: "Rosé Pine Moon" },
	{ value: "slack-dark", label: "Slack Dark" },
	{ value: "solarized-dark", label: "Solarized Dark" },
	{ value: "synthwave-84", label: "Synthwave '84" },
	{ value: "tokyo-night", label: "Tokyo Night" },
	{ value: "vesper", label: "Vesper" },
	{ value: "vitesse-black", label: "Vitesse Black" },
	{ value: "vitesse-dark", label: "Vitesse Dark" },
] as const;

/** `@pierre/diffs`' own defaults — picking these renders exactly as before. */
export const DEFAULT_DIFF_LIGHT_THEME = "pierre-light";
export const DEFAULT_DIFF_DARK_THEME = "pierre-dark";

/**
 * File-tree sentinel: don't push any `--trees-theme-*` variables, so the tree
 * keeps inheriting the app's own surface colors. This is the tree default —
 * unlike diffs, the tree has no syntax tokens to color, so blending with the
 * app chrome is the sane baseline.
 *
 * Deliberately NOT a plausible theme id: it shares a value space with Shiki
 * ids and `registerCustomTheme` names, and it's what gets persisted in
 * localStorage, so it must stay un-claimable by any future theme.
 */
export const TREE_THEME_INHERIT = "__inherit__";

const INHERIT_OPTION: PierreThemeOption = {
	value: TREE_THEME_INHERIT,
	label: "Match app theme",
};

export const TREE_LIGHT_THEMES: readonly PierreThemeOption[] = [
	INHERIT_OPTION,
	...PIERRE_LIGHT_THEMES,
];

export const TREE_DARK_THEMES: readonly PierreThemeOption[] = [
	INHERIT_OPTION,
	...PIERRE_DARK_THEMES,
];
