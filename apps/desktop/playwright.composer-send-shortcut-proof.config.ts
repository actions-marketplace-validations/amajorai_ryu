import { defineConfig, devices } from "@playwright/test";

const proofUrl = "http://127.0.0.1:5184/";

export default defineConfig({
	testDir: "./e2e",
	testMatch: /composer-send-shortcut-proof\.spec\.ts$/,
	fullyParallel: false,
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
			"bunx vite --config e2e/harness/vite.composer-send-shortcut-proof.config.ts --host 127.0.0.1 --port 5184",
		url: `${proofUrl}composer-send-shortcut-proof.html`,
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
