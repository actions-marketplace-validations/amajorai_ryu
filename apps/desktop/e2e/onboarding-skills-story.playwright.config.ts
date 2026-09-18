import { defineConfig, devices } from "@playwright/test";

const PROOF_URL = "http://127.0.0.1:5192/";

export default defineConfig({
	testDir: ".",
	testMatch: /onboarding-skills-story\.spec\.ts$/,
	fullyParallel: false,
	retries: 0,
	reporter: "list",
	use: {
		baseURL: PROOF_URL,
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
			"bunx vite build --config harness/vite.onboarding-skills-story.config.ts && bunx vite preview --config harness/vite.onboarding-skills-story.config.ts --host 127.0.0.1 --port 5192 --strictPort",
		url: `${PROOF_URL}onboarding-skills-story.html`,
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
