import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:5202/";

export default defineConfig({
	testDir: ".",
	testMatch: /availability-prompt-policy-proof\.spec\.ts$/,
	fullyParallel: false,
	retries: 0,
	use: {
		baseURL,
		...devices["Desktop Chrome"],
	},
	webServer: {
		command:
			"bunx vite --config harness/vite.availability-prompt-policy-proof.config.ts",
		url: baseURL,
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
