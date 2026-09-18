import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: ".",
	testMatch: /(keep-awake|acp-settings-scope)\.spec\.ts$/,
	workers: 1,
	timeout: 60_000,
	outputDir: "/tmp/ryu-keep-awake-results",
	reporter: "list",
	use: {
		baseURL: "http://127.0.0.1:5236",
		viewport: { width: 1200, height: 900 },
		trace: "retain-on-failure",
	},
	webServer: {
		command: "bunx vite --config harness/vite.keep-awake.config.ts",
		url: "http://127.0.0.1:5236/keep-awake-proof.html",
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
