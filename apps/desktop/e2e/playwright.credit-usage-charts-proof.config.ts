import { defineConfig, devices } from "@playwright/test";

const PROOF_URL = "http://127.0.0.1:5204/";

export default defineConfig({
	testDir: ".",
	testMatch: /credit-usage-charts-proof\.spec\.ts$/,
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	testTimeout: 60_000,
	reporter: process.env.CI ? "github" : "list",
	use: {
		baseURL: PROOF_URL,
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
			"bunx vite --config harness/vite.credit-usage-charts-proof.config.ts --host 127.0.0.1 --port 5204 --strictPort",
		url: PROOF_URL,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
