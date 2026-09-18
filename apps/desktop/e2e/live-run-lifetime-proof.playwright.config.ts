import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: ".",
	testMatch: /live-run-lifetime-proof\.spec\.ts$/,
	workers: 1,
	timeout: 60_000,
	outputDir: "/tmp/ryu-live-run-lifetime-results",
	reporter: "list",
	use: {
		baseURL: "http://127.0.0.1:5216",
		viewport: { width: 1100, height: 800 },
		trace: "retain-on-failure",
	},
	webServer: {
		command:
			"bunx vite --config harness/vite.live-run-lifetime-proof.config.ts",
		url: "http://127.0.0.1:5216/live-run-lifetime-proof.html",
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
