import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
	testDir: "./e2e",
	testMatch: "app-reuse.spec.ts",
	outputDir: "test-results/app-reuse",
	workers: 1,
	retries: 0,
	reporter: "list",
	timeout: 90_000,
	use: {
		baseURL: "http://127.0.0.1:5280",
		...devices["Desktop Chrome"],
		trace: "retain-on-failure",
	},
	webServer: {
		command:
			"bun run vite build --config e2e/harness/vite.app-reuse-proof.config.ts && python3 -m http.server 5280 --bind 127.0.0.1 --directory /tmp/ryu-app-reuse-proof",
		url: "http://127.0.0.1:5280/app-reuse-proof.html",
		reuseExistingServer: true,
		timeout: 180_000,
	},
});
