import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	testMatch: /provider-account-switch-proof\.spec\.ts/,
	fullyParallel: false,
	use: {
		baseURL: "http://127.0.0.1:5179/",
		trace: "on-first-retry",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	webServer: {
		command:
			"bunx vite --config e2e/harness/vite.provider-account-switch-proof.config.ts",
		url: "http://127.0.0.1:5179/",
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
