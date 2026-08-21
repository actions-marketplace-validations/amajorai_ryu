import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	testMatch: /mention-composer-proof\.spec\.ts$/,
	fullyParallel: false,
	forbidOnly: true,
	retries: 0,
	reporter: "list",
	use: {
		baseURL: "http://127.0.0.1:5179",
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
			"bunx vite --config e2e/harness/vite.mention-composer-proof.config.ts --host 127.0.0.1",
		url: "http://127.0.0.1:5179/mention-composer-proof.html",
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
