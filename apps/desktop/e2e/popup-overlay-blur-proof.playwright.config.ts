import { defineConfig, devices } from "@playwright/test";

const STORY_URL = "http://127.0.0.1:5181/";

export default defineConfig({
	testDir: ".",
	testMatch: /popup-overlay-blur-proof\.spec\.ts$/,
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? "github" : "list",
	use: {
		baseURL: STORY_URL,
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
			"bunx vite --config harness/vite.popup-overlay-blur-proof.config.ts",
		url: STORY_URL,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
