import path from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const harnessDir = path.resolve(import.meta.dirname);

export default defineConfig({
	plugins: [react()],
	css: {
		postcss: {
			plugins: [tailwindcss()],
		},
	},
	root: harnessDir,
	clearScreen: false,
	server: {
		port: 5178,
		strictPort: true,
	},
	build: {
		outDir: path.resolve(harnessDir, "dist-report-dialog-dropdown-proof"),
		emptyOutDir: true,
		rollupOptions: {
			input: path.resolve(harnessDir, "report-dialog-dropdown-proof.html"),
		},
	},
});
