import path from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const harnessDir = path.resolve(import.meta.dirname);
const desktopRoot = path.resolve(harnessDir, "../..");

export default defineConfig({
	plugins: [react()],
	css: {
		postcss: {
			plugins: [tailwindcss()],
		},
	},
	root: harnessDir,
	clearScreen: false,
	define: { "process.env": {} },
	assetsInclude: ["**/*.glb"],
	resolve: {
		alias: {
			"@": desktopRoot,
		},
	},
	server: {
		port: 5189,
		strictPort: true,
	},
	build: {
		outDir: path.resolve(harnessDir, "dist-ghost-avatar-proof"),
		target: "chrome105",
		emptyOutDir: true,
		rollupOptions: {
			input: path.resolve(harnessDir, "ghost-avatar-proof.html"),
		},
	},
});
