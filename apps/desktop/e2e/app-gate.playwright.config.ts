import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: ".",
	testMatch: /app-gate\.spec\.ts$/,
	workers: 1,
	timeout: 30_000,
	outputDir: "/tmp/ryu-app-gate-results",
	reporter: "list",
	use: {
		baseURL: "http://127.0.0.1:5238",
		viewport: { width: 1200, height: 900 },
		trace: "retain-on-failure",
	},
	webServer: {
		command: "bunx vite --config harness/vite.app-gate.config.ts",
		url: "http://127.0.0.1:5238/app-gate-proof.html",
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
