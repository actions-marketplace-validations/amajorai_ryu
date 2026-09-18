import path from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const harnessDir = path.resolve(import.meta.dirname);
const desktopRoot = path.resolve(harnessDir, "../..");

export default defineConfig({
	base: "./",
	clearScreen: false,
	css: {
		postcss: {
			plugins: [tailwindcss()],
		},
	},
	plugins: [react()],
	resolve: {
		alias: {
			"@": desktopRoot,
		},
	},
	root: harnessDir,
	server: {
		host: "127.0.0.1",
		port: 5198,
		strictPort: true,
	},
	build: {
		emptyOutDir: true,
		outDir: path.resolve(harnessDir, "dist-agent-reaction-proof"),
		target: "chrome105",
		rollupOptions: {
			input: path.resolve(harnessDir, "agent-reaction-proof.html"),
		},
	},
});
