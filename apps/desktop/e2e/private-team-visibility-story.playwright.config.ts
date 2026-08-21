import { defineConfig, devices } from "@playwright/test";

const STORY_URL = "http://127.0.0.1:5203/";

export default defineConfig({
	fullyParallel: false,
	reporter: "list",
	testDir: ".",
	testMatch: /private-team-visibility-story\.spec\.ts/,
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
		command:
			"bunx vite --config harness/vite.private-team-visibility-proof.config.ts",
		reuseExistingServer: false,
		timeout: 120_000,
		url: STORY_URL,
	},
});
