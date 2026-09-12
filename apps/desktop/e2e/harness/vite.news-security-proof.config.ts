import path from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const harnessDir = import.meta.dirname;
const repositoryRoot = path.resolve(harnessDir, "../../../..");
const token = process.env.RYU_SECURITY_PROOF_NEWS_TOKEN;
if (!token) {
	throw new Error("RYU_SECURITY_PROOF_NEWS_TOKEN is required");
}

export default defineConfig({
	root: harnessDir,
	plugins: [react()],
	css: { postcss: { plugins: [tailwindcss()] } },
	optimizeDeps: {
		entries: [path.resolve(harnessDir, "news-security-proof.html")],
	},
	server: {
		host: "127.0.0.1",
		port: 5473,
		strictPort: true,
		fs: { allow: [repositoryRoot] },
		proxy: {
			"/api/news": {
				target: "http://127.0.0.1:19738",
				headers: { Authorization: `Bearer ${token}` },
			},
		},
	},
});
