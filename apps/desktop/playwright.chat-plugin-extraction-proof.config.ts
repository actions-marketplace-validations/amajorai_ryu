import { defineConfig, devices } from "@playwright/test";

const HARNESS_URL = "http://localhost:5179/";

export default defineConfig({
	testDir: "./e2e",
	testMatch: /chat-plugin-extraction-proof\.spec\.ts/,
	fullyParallel: true,
	workers: 1,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? "github" : "list",
	use: {
		baseURL: HARNESS_URL,
		trace: "on-first-retry",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	webServer: {
		command:
			"bunx vite --config e2e/harness/vite.chat-plugin-extraction-proof.config.ts",
		url: HARNESS_URL,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
