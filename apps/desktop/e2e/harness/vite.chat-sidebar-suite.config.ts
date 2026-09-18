import path from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const harnessDir = path.resolve(import.meta.dirname);
const desktopRoot = path.resolve(harnessDir, "../..");

export default defineConfig({
	plugins: [react()],
	base: "./",
	css: {
		postcss: {
			plugins: [tailwindcss()],
		},
	},
	define: {
		"process.env": {},
	},
	root: harnessDir,
	publicDir: path.resolve(desktopRoot, "public"),
	clearScreen: false,
	resolve: {
		alias: {
			"@": desktopRoot,
			"@ryu/app-host/third-party-plugin": path.resolve(
				harnessDir,
				"quick-reply-app-host-stub.ts"
			),
		},
	},
	server: {
		host: "127.0.0.1",
		port: Number(process.env.RYU_E2E_PORT ?? "5182"),
		strictPort: true,
	},
});
