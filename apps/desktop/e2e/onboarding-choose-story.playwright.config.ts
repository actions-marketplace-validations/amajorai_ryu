import { defineConfig, devices } from "@playwright/test";

const STORY_URL = "http://127.0.0.1:5177/";

export default defineConfig({
	testDir: ".",
	testMatch: /onboarding-choose-story\.spec\.ts$/,
	fullyParallel: false,
	retries: 0,
	reporter: "list",
	use: {
		baseURL: STORY_URL,
		trace: "retain-on-failure",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	webServer: {
		command: "bunx vite --config harness/vite.harness.config.ts",
		url: `${STORY_URL}onboarding-choose-story.html`,
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
