import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: ".",
	testMatch: /gift-settlement\.spec\.ts$/,
	workers: 1,
	timeout: 30_000,
	outputDir: "/tmp/ryu-gift-settlement-results",
	reporter: "list",
	use: {
		baseURL: "http://127.0.0.1:5239",
		viewport: { width: 1200, height: 1000 },
		trace: "retain-on-failure",
	},
	webServer: {
		command: "bunx vite --config harness/vite.gift-settlement.config.ts",
		url: "http://127.0.0.1:5239/gift-settlement-proof.html",
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
