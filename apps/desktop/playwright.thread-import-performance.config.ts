import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
	testDir: "./e2e",
	testMatch: "thread-import-performance-proof.spec.ts",
	workers: 1,
	outputDir: "test-results/thread-import-performance",
	reporter: "list",
	use: {
		baseURL: "http://127.0.0.1:5298",
		...devices["Desktop Chrome"],
		trace: "retain-on-failure",
	},
	webServer: {
		command:
			"bunx vite --config e2e/harness/vite.thread-import-performance-proof.config.ts",
		url: "http://127.0.0.1:5298/thread-import-performance-proof.html",
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
