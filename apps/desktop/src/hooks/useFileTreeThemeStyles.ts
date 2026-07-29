// apps/desktop/src/hooks/useFileTreeThemeStyles.ts
//
// Turns the file-tree theme prefs into the inline `--trees-theme-*` CSS
// variables `@pierre/trees` reads off its host element.
//
// Unlike `@pierre/diffs` — which takes a light/dark theme PAIR and lets
// `light-dark()` pick — `@pierre/trees` has no notion of modes: it consumes one
// already-resolved theme. So the active mode is resolved here from next-themes'
// `resolvedTheme` (the same signal that drives `color-scheme` on <html>, which
// is what the diff viewer's "Auto" follows — the two panels can't disagree).
//
// Theme resolution is async on first use (Shiki lazily imports the theme JSON)
// and cached afterwards, so `getResolvedOrResolveTheme` returns synchronously on
// every later mount — no flash of unthemed tree once a theme has been loaded.

import { getResolvedOrResolveTheme } from "@pierre/diffs";
import { themeToTreeStyles } from "@pierre/trees";
import { useTheme } from "next-themes";
import type { CSSProperties } from "react";
import { useLayoutEffect, useState } from "react";
import type { FileTreePrefs } from "@/src/hooks/useFileTreePrefs.ts";
import { TREE_THEME_INHERIT } from "@/src/lib/pierre-themes.ts";

// `themeToTreeStyles` returns custom properties (`--trees-theme-*`), which
// aren't in React's CSSProperties keys — the cast is the standard escape.
function toStyle(styles: Record<string, string>): CSSProperties {
	return styles as CSSProperties;
}

/**
 * Inline styles for the `<FileTree>` host, or `undefined` when the tree should
 * inherit the app's own surface colors.
 */
export function useFileTreeThemeStyles(
	prefs: FileTreePrefs
): CSSProperties | undefined {
	const { resolvedTheme } = useTheme();
	const themeName =
		resolvedTheme === "dark" ? prefs.darkTheme : prefs.lightTheme;
	const [styles, setStyles] = useState<CSSProperties | undefined>(undefined);

	useLayoutEffect(() => {
		if (themeName === TREE_THEME_INHERIT) {
			setStyles(undefined);
			return;
		}
		const resolved = getResolvedOrResolveTheme(themeName);
		if (!(resolved instanceof Promise)) {
			setStyles(toStyle(themeToTreeStyles(resolved)));
			return;
		}
		// Async path: drop the result if the pref changed (or we unmounted)
		// while the theme JSON was loading, and fall back to inheriting if the
		// name turns out to be unknown to Shiki.
		let cancelled = false;
		setStyles(undefined);
		resolved
			.then((theme) => {
				if (!cancelled) {
					setStyles(toStyle(themeToTreeStyles(theme)));
				}
			})
			.catch(() => {
				if (!cancelled) {
					setStyles(undefined);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [themeName]);

	return styles;
}
