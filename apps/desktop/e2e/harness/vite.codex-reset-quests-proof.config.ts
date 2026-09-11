import path from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	root: import.meta.dirname,
	plugins: [react()],
	css: { postcss: { plugins: [tailwindcss()] } },
	define: { "process.env": {} },
	optimizeDeps: { entries: ["codex-reset-quests-proof.html"] },
	resolve: { alias: { "@": path.resolve(import.meta.dirname, "../..") } },
	server: {
		host: "127.0.0.1",
		port: 5196,
		strictPort: true,
		proxy: {
			"/api/quests": {
				target: "http://127.0.0.1:17991",
				headers: { Authorization: "Bearer reset-watch-proof-local" },
			},
		},
	},
});
