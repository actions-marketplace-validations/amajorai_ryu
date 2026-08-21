import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const harnessDir = path.resolve(import.meta.dirname);

export default defineConfig({
	plugins: [react()],
	root: harnessDir,
	clearScreen: false,
	build: {
		outDir: "dist-control-audit-proof",
		emptyOutDir: true,
		rollupOptions: {
			input: path.resolve(harnessDir, "control-audit-proof.html"),
		},
	},
});
