import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: ".",
	testMatch: /billing-transactional-emails-proof\.spec\.ts$/,
	use: {
		...devices["Desktop Chrome"],
		baseURL: "http://localhost:5183/",
	},
	webServer: {
		command:
			"bunx vite --config harness/vite.billing-transactional-emails-proof.config.ts",
		reuseExistingServer: false,
		timeout: 120_000,
		url: "http://localhost:5183/billing-transactional-emails-proof.html",
	},
});
