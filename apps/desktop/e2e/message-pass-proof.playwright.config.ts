import { defineConfig, devices } from "@playwright/test";

const PROOF_URL = "http://127.0.0.1:5187/";

export default defineConfig({
	testDir: ".",
	testMatch: /message-pass-proof\.spec\.ts$/,
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? "github" : "list",
	use: {
		baseURL: PROOF_URL,
		trace: "retain-on-failure",
		viewport: { height: 980, width: 1440 },
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	webServer: {
		command: "bunx vite --config harness/vite.message-pass-proof.config.ts",
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
		url: PROOF_URL,
	},
});
