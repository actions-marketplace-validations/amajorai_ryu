import { defineConfig, devices } from "@playwright/test";

const PROOF_URL = "http://127.0.0.1:5201/";

export default defineConfig({
	testDir: ".",
	testMatch: /private-package-share-story\.spec\.ts/,
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
			"bunx vite --config harness/vite.private-package-share-story.config.ts",
		url: PROOF_URL,
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
