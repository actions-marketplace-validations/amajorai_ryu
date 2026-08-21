import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: ".",
	testMatch: /multi-folder-project-proof\.spec\.ts/,
	workers: 1,
	use: {
		baseURL: "http://127.0.0.1:5187",
		...devices["Desktop Chrome"],
	},
	webServer: {
		command:
			"bunx vite --config harness/vite.multi-folder-project-proof.config.ts",
		url: "http://127.0.0.1:5187",
		timeout: 120_000,
	},
});
