import { defineConfig, devices } from "@playwright/test";

const proofUrl = "http://127.0.0.1:5182/";

export default defineConfig({
	testDir: "./e2e",
	testMatch: /mouse-navigation-proof\.spec\.ts$/,
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? "github" : "list",
	use: {
		baseURL: proofUrl,
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
			"bunx vite --config e2e/harness/vite.mouse-navigation-proof.config.ts --host 127.0.0.1 --port 5182",
		url: proofUrl,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
