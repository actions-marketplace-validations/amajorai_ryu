import { defineConfig, devices } from "@playwright/test";

const PROOF_URL = "http://127.0.0.1:5181/";

export default defineConfig({
	testDir: ".",
	testMatch: /welcome-step-story\.spec\.ts$/,
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
			"bun run build:harness:welcome && bunx vite preview --config harness/vite.welcome.config.ts --host 127.0.0.1 --port 5181 --strictPort",
		url: `${PROOF_URL}welcome-step-story.html`,
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
