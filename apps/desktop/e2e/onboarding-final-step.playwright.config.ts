import { defineConfig, devices } from "@playwright/test";

const PROOF_URL = "http://127.0.0.1:5184/";

export default defineConfig({
	testDir: ".",
	testMatch: /onboarding-final-step\.spec\.ts$/,
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
			"bun run build:harness:onboarding-final && bunx vite preview --config harness/vite.onboarding-final-step.config.ts --host 127.0.0.1 --port 5184 --strictPort",
		url: `${PROOF_URL}onboarding-final-step-story.html`,
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
