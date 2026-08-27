import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:5181/";

export default defineConfig({
	testDir: ".",
	testMatch: /selection-actions-proof\.spec\.ts/,
	fullyParallel: false,
	workers: 1,
	use: {
		baseURL,
		...devices["Desktop Chrome"],
	},
	webServer: {
		command:
			"bunx vite --config harness/vite.selection-actions-proof.config.ts",
		url: baseURL,
		reuseExistingServer: true,
		timeout: 120_000,
	},
});
