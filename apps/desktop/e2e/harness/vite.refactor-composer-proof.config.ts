import path from "node:path";
import { defineConfig } from "vite";
import harness from "./vite.harness.config.ts";

export default defineConfig({
	...harness,
	cacheDir: path.resolve(
		import.meta.dirname,
		"../../node_modules/.vite-refactor-proof"
	),
	optimizeDeps: { entries: ["refactor-composer-proof.html"] },
	server: { host: "127.0.0.1", port: 5217, strictPort: true },
	build: {
		outDir: path.resolve(import.meta.dirname, "dist-refactor-composer-proof"),
		target: "chrome105",
		rollupOptions: {
			input: path.resolve(import.meta.dirname, "refactor-composer-proof.html"),
		},
	},
});
