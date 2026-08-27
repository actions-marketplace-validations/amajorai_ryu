import path from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const harnessDir = path.resolve(import.meta.dirname);
const buildDir = path.resolve(
	harnessDir,
	"../../../../tmp/ryu-node-organization-binding-proof"
);

export default defineConfig({
	base: "./",
	build: {
		emptyOutDir: true,
		outDir: buildDir,
		target: "chrome105",
		rollupOptions: {
			input: path.resolve(harnessDir, "node-organization-binding-proof.html"),
		},
	},
	clearScreen: false,
	css: {
		postcss: {
			plugins: [tailwindcss()],
		},
	},
	plugins: [react()],
	publicDir: path.resolve(harnessDir, "../../public"),
	resolve: {
		alias: {
			"@": path.resolve(harnessDir, "../.."),
		},
	},
	root: harnessDir,
});
