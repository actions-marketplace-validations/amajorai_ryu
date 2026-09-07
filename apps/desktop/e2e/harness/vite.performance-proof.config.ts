import path from "node:path";
import { defineConfig } from "vite";
import harness from "./vite.harness.config.ts";

export default defineConfig({
	...harness,
	cacheDir: path.resolve(
		import.meta.dirname,
		"../../node_modules/.vite-performance-proof"
	),
	optimizeDeps: {
		entries: ["chat-search-story.html", "agent-conversation-branch-proof.html"],
	},
	server: { host: "127.0.0.1", port: 5209, strictPort: true },
});
