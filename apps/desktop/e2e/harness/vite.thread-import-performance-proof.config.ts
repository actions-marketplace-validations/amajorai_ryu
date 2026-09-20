import path from "node:path";
import { defineConfig } from "vite";
import harness from "./vite.harness.config.ts";
export default defineConfig({
	...harness,
	cacheDir: path.resolve(
		import.meta.dirname,
		"../../node_modules/.vite-thread-import-performance"
	),
	optimizeDeps: { entries: ["thread-import-performance-proof.html"] },
	server: { host: "127.0.0.1", port: 5298, strictPort: true },
});
