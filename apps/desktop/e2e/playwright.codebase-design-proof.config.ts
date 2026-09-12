import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: ".",
	testMatch: /codebase-design-proof\.spec\.ts$/,
	reporter: "line",
	workers: 1,
	use: {
		baseURL: "http://127.0.0.1:5198",
		viewport: { width: 1280, height: 800 },
	},
	webServer: {
		command: "bunx vite --config harness/vite.codebase-design-proof.config.ts",
		url: "http://127.0.0.1:5198/codebase-design-proof.html",
		reuseExistingServer: true,
	},
});
