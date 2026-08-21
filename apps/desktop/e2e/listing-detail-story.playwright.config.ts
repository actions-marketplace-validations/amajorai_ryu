import { defineConfig, devices } from "@playwright/test";

const PROOF_URL = "http://127.0.0.1:5198/";

export default defineConfig({
	testDir: ".",
	testMatch: /listing-detail-story\.spec\.ts$/,
	fullyParallel: false,
	retries: 0,
	reporter: "list",
	use: {
		...devices["Desktop Chrome"],
		baseURL: PROOF_URL,
		trace: "retain-on-failure",
	},
	webServer: {
		command: "bunx vite --config harness/vite.listing-detail-story.config.ts",
		url: `${PROOF_URL}listing-detail-story.html`,
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
