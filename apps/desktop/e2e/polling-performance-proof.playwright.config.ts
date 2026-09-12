import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: ".",
	testMatch: /polling-performance-proof.spec.ts$/,
	workers: 1,
	timeout: 120_000,
	outputDir: "/tmp/ryu-polling-results",
	reporter: "list",
	use: {
		baseURL: "http://127.0.0.1:5208",
		viewport: { width: 1100, height: 900 },
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	webServer: {
		command:
			"bunx vite --config harness/vite.polling-performance-proof.config.ts",
		url: "http://127.0.0.1:5208/polling-performance-proof.html",
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
