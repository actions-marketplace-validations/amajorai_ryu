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
	},
	build: {
		outDir: "/private/tmp/ryu-notification-layout-proof",
		emptyOutDir: true,
		rollupOptions: {
			input: path.resolve(harnessDir, "notification-layout-proof.html"),
		},
	},
});
