import { defineConfig, devices } from "@playwright/test";

const proofUrl = "http://127.0.0.1:5211/";

export default defineConfig({
	testDir: ".",
	testMatch: /extension-local-search-proof\.spec\.ts$/,
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? "github" : "list",
	use: {
		baseURL: proofUrl,
		trace: "on-first-retry",
		...devices["Desktop Chrome"],
	},
	webServer: {
		command:
			"bunx vite --config harness/vite.extension-local-search-proof.config.ts",
		url: `${proofUrl}extension-local-search-proof.html`,
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
