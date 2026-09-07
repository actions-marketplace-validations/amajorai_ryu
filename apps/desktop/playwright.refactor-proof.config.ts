import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	testMatch: "refactor-composer-proof.spec.ts",
	outputDir: "test-results/refactor-proof",
	workers: 1,
	forbidOnly: !!process.env.CI,
	retries: 0,
	reporter: "list",
	use: {
		baseURL: "http://127.0.0.1:5217",
		trace: "retain-on-failure",
		...devices["Desktop Chrome"],
	},
	webServer: {
		command:
			"bunx vite --config e2e/harness/vite.refactor-composer-proof.config.ts",
		url: "http://127.0.0.1:5217/refactor-composer-proof.html",
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
