import { defineConfig, devices } from "@playwright/test";

const PROOF_URL = "http://127.0.0.1:5204/";

export default defineConfig({
	testDir: ".",
	outputDir: "/tmp/ryu-catalog-performance-results",
	testMatch: process.env.RYU_PERF_BASELINE
		? /catalog-performance-metrics\.spec\.ts$/
		: /catalog-performance-(?:proof|metrics)\.spec\.ts$/,
	fullyParallel: false,
	workers: 1,
	retries: 0,
	reporter: "list",
	use: {
		baseURL: PROOF_URL,
		trace: "retain-on-failure",
	},
	projects: [
		{
			name: "chromium",
			use: {
				...devices["Desktop Chrome"],
				viewport: { height: 900, width: 1440 },
			},
		},
	],
	webServer: {
		command:
			"bunx vite --config harness/vite.catalog-performance-proof.config.ts",
		url: `${PROOF_URL}catalog-performance-proof.html`,
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
