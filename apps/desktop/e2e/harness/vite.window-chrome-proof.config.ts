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
	resolve: {
		alias: {
			"@": desktopRoot,
		},
		dedupe: ["react", "react-dom"],
	},
	optimizeDeps: {
		entries: [path.resolve(harnessDir, "window-chrome-proof.html")],
	},
	server: {
		host: "127.0.0.1",
		port: 5189,
		strictPort: true,
	},
	build: {
		emptyOutDir: true,
		outDir: path.resolve(harnessDir, "dist-window-chrome-proof"),
		rollupOptions: {
			input: path.resolve(harnessDir, "window-chrome-proof.html"),
		},
	},
});
