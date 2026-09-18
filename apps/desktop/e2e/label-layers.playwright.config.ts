import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: ".",
	testMatch: /(label-layers|button-label-overflow-proof)\.spec\.ts$/,
	workers: 1,
	timeout: 60_000,
	outputDir: "/tmp/ryu-label-layers-results",
	reporter: "list",
	use: {
		baseURL: "http://127.0.0.1:5221",
		viewport: { width: 1200, height: 1000 },
		trace: "retain-on-failure",
	},
	webServer: {
		command: "bunx vite --config harness/vite.label-layers.config.ts",
		url: "http://127.0.0.1:5221/button-label-overflow-proof.html",
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
