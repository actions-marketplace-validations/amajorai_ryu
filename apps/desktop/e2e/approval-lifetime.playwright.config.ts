import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: ".",
	testMatch: /approval-lifetime\.spec\.ts$/,
	workers: 1,
	timeout: 30_000,
	outputDir: "/tmp/ryu-approval-lifetime-results",
	reporter: "list",
	use: {
		baseURL: "http://127.0.0.1:5237",
		viewport: { width: 1200, height: 900 },
		trace: "retain-on-failure",
	},
	webServer: {
		command: "bunx vite --config harness/vite.approval-lifetime.config.ts",
		url: "http://127.0.0.1:5237/approval-lifetime-proof.html",
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
