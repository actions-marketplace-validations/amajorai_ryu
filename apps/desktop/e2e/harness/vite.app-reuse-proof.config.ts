import path from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
export default defineConfig({
	root: import.meta.dirname,
	build: {
		target: "esnext",
		outDir: "/tmp/ryu-app-reuse-proof",
		emptyOutDir: true,
		rollupOptions: {
			input: path.resolve(import.meta.dirname, "app-reuse-proof.html"),
		},
	},
	plugins: [react()],
	define: { "process.env": {} },
	css: { postcss: { plugins: [tailwindcss()] } },
	resolve: {
		alias: {
			"@": path.resolve(import.meta.dirname, "../.."),
			"@ryu/blocks/desktop/agent-elements/input-bar": path.resolve(
				import.meta.dirname,
				"app-reuse-composer-stub.tsx"
			),
		},
	},
	optimizeDeps: { entries: ["app-reuse-proof.html"] },
	server: {
		host: "127.0.0.1",
		port: 5278,
		strictPort: true,
		watch: { ignored: ["**/dist/**", "**/.next/**"] },
	},
});
