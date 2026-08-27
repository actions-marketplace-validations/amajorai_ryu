import path from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	css: {
		postcss: {
			plugins: [tailwindcss()],
		},
	},
	clearScreen: false,
	// The Lanyard component (@ryu/ui) imports a binary .glb model as a URL asset.
	assetsInclude: ["**/*.glb"],
	optimizeDeps: {
		esbuildOptions: {
			target: "chrome105",
		},
	},
	server: {
		port: 5173,
		strictPort: true,
	},
	// SECURITY: never expose the bare `TAURI_` prefix here. Vite inlines every
	// matching env var into the frontend bundle, and the release build sets
	// TAURI_SIGNING_PRIVATE_KEY / _PASSWORD (release.yml) — so the updater's
	// minisign PRIVATE KEY gets shipped to users. This is CVE-2023-46115 /
	// GHSA-2rcp-jvr4-r259, and it was confirmed present in a local build here.
	// Only the non-sensitive platform vars are safe, so allow-list them.
	// Nothing in the desktop tree reads `import.meta.env.TAURI_*`, so the prefix
	// bought nothing and cost everything. `VITE_` only, same as apps/webapp.
	envPrefix: ["VITE_"],
	// The stats plugin has one deliberate, non-secret numeric tuning knob. Define
	// only this key instead of widening `envPrefix` and exposing arbitrary
	// `CCSTATUSLINE_*` values to the renderer bundle.
	define: {
		// A few shared web blocks are imported by desktop pages and read
		// `process.env` for server-only defaults. Vite does not polyfill Node's
		// process object in a Tauri webview; make that server-only namespace an
		// inert browser value so a standalone app cannot fail before React mounts.
		"process.env": {},
		"import.meta.env.CCSTATUSLINE_CONTEXT_SIZE_FALLBACK": JSON.stringify(
			process.env.CCSTATUSLINE_CONTEXT_SIZE_FALLBACK ?? ""
		),
	},
	build: {
		outDir: "dist",
		target: "chrome105",
		sourcemap: true,
	},
	resolve: {
		alias: {
			"@": path.resolve(import.meta.dirname, "."),
		},
	},
});
