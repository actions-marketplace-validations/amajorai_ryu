import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
	testDir: "./e2e",
	testMatch: /(gateway-polling|settings-dialog-shortcuts)-proof\.spec\.ts$/,
	workers: 1,
	forbidOnly: !!process.env.CI,
	retries: 0,
	reporter: "list",
	use: {
		baseURL: "http://127.0.0.1:5198",
		trace: "retain-on-failure",
		...devices["Desktop Chrome"],
	},
	webServer: {
		command:
			"bunx vite --config e2e/harness/vite.settings-dialog-shortcuts-proof.config.ts",
		url: "http://127.0.0.1:5198/settings-dialog-shortcuts-proof.html",
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
