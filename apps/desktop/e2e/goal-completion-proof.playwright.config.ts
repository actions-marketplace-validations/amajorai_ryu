import { defineConfig, devices } from "@playwright/test";

const STORY_URL = "http://127.0.0.1:5183/";

export default defineConfig({
	testDir: ".",
	testMatch: /goal-completion-proof\.spec\.ts$/,
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? "github" : "list",
	use: {
		baseURL: STORY_URL,
		trace: "on-first-retry",
		viewport: { height: 900, width: 1280 },
	},
	projects: [
		{
			name: "chromium",
			use: {
				...devices["Desktop Chrome"],
				viewport: { height: 900, width: 1280 },
			},
		},
	],
	webServer: {
		command: "bunx vite --config harness/vite.goal-completion-proof.config.ts",
		url: STORY_URL,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
