import { defineConfig, devices } from "@playwright/test";

const PROOF_URL = "http://127.0.0.1:5200/";

export default defineConfig({
	testDir: ".",
	testMatch: /assistant-widget\.spec\.ts$/,
	fullyParallel: false,
	retries: 0,
	reporter: "list",
	use: {
		...devices["Desktop Chrome"],
		baseURL: PROOF_URL,
		trace: "retain-on-failure",
	},
	webServer: {
		command: "bunx vite --config harness/vite.assistant-widget.config.ts",
		url: `${PROOF_URL}assistant-widget-story.html`,
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
