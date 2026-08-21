import { realpathSync } from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const harnessDir = path.resolve(import.meta.dirname);
const emailPackagesDir = path.dirname(
	realpathSync(
		path.resolve(
			harnessDir,
			"../../../../packages/email/node_modules/@react-email/components"
		)
	)
);

export default defineConfig({
	plugins: [react()],
	root: harnessDir,
	base: "./",
	clearScreen: false,
	resolve: {
		alias: [
			{
				find: /^@react-email\//,
				replacement: `${emailPackagesDir}/`,
			},
		],
	},
	define: {
		"process.env.FRONTEND_URL": JSON.stringify("https://ryuhq.com"),
	},
	server: {
		host: "127.0.0.1",
		port: 5181,
		strictPort: true,
	},
	build: {
		outDir: path.resolve(harnessDir, "dist-email-template-proof"),
		emptyOutDir: true,
		target: "chrome105",
		rollupOptions: {
			input: path.resolve(harnessDir, "email-template-proof.html"),
		},
	},
});
