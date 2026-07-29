// Standalone browser story for the file-tree THEME path: the real
// `useFileTreeThemeStyles` hook feeding a real `@pierre/trees` `<FileTree>`.
//
// This is the one part of the Pierre theming work that isn't a library-provided
// option — trees has no light/dark mode of its own, so the hook resolves the
// theme through `@pierre/diffs`' Shiki cache and pushes `--trees-theme-*` custom
// properties onto the host element. Shiki's theme JSON only loads in a real
// browser (async `import()`), so a real Chromium is the only place this can be
// proven.

import { getResolvedOrResolveTheme } from "@pierre/diffs";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { ThemeProvider } from "next-themes";
import { createRoot } from "react-dom/client";
import {
	fileTreePrefsToOptions,
	setFileTreePrefs,
	useFileTreePrefs,
} from "../../src/hooks/useFileTreePrefs.ts";
import { useFileTreeThemeStyles } from "../../src/hooks/useFileTreeThemeStyles.ts";
import {
	PIERRE_DARK_THEMES,
	PIERRE_LIGHT_THEMES,
	TREE_THEME_INHERIT,
} from "../../src/lib/pierre-themes.ts";
import "../../src/index.css";

// Exposed for the spec: resolve EVERY catalog id against Shiki's bundle. The
// catalog is hand-transcribed strings and `resolveTheme` throws "No valid loader
// for X" on a miss, so a single typo is a runtime crash in the diff viewer that
// no type-check can catch. Returns the ids that failed.
async function resolveEveryCatalogTheme(): Promise<string[]> {
	const failed: string[] = [];
	for (const option of [...PIERRE_LIGHT_THEMES, ...PIERRE_DARK_THEMES]) {
		try {
			await getResolvedOrResolveTheme(option.value);
		} catch {
			failed.push(option.value);
		}
	}
	return failed;
}

(
	window as unknown as { __resolveEveryCatalogTheme?: () => Promise<string[]> }
).__resolveEveryCatalogTheme = resolveEveryCatalogTheme;

const PATHS = [
	"src/components/Button.tsx",
	"src/hooks/useTheme.ts",
	"README.md",
];

function ThemedTree() {
	const prefs = useFileTreePrefs();
	const style = useFileTreeThemeStyles(prefs);
	const { model } = useFileTree({
		...fileTreePrefsToOptions(prefs),
		paths: PATHS,
	});
	return (
		<FileTree
			className="h-full w-full"
			data-testid="tree"
			model={model}
			style={style}
		/>
	);
}

function Story() {
	const prefs = useFileTreePrefs();
	return (
		<div style={{ padding: 24 }}>
			<div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
				<button
					data-testid="set-github-light"
					onClick={() => setFileTreePrefs({ lightTheme: "github-light" })}
					type="button"
				>
					GitHub Light
				</button>
				<button
					data-testid="set-inherit"
					onClick={() => setFileTreePrefs({ lightTheme: TREE_THEME_INHERIT })}
					type="button"
				>
					Match app theme
				</button>
			</div>
			<div data-testid="pref">{prefs.lightTheme}</div>
			{/* Keyed on the constructor-time options only — the same invariant the
			    app relies on: a theme switch must NOT remount the tree. */}
			<div style={{ height: 200 }}>
				<ThemedTree key={JSON.stringify(fileTreePrefsToOptions(prefs))} />
			</div>
		</div>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(
		<ThemeProvider attribute="class" defaultTheme="light" enableSystem>
			<Story />
		</ThemeProvider>
	);
}
