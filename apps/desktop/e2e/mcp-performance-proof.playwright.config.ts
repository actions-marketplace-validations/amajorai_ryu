import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: ".",
	testMatch: /mcp-performance-proof.spec.ts$/,
	workers: 1,
	timeout: 60_000,
	outputDir: "/tmp/ryu-mcp-proof-results",
	reporter: "list",
	use: {
		baseURL: "http://127.0.0.1:5211",
		viewport: { width: 1300, height: 900 },
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	webServer: {
		command: "bunx vite --config harness/vite.mcp-performance-proof.config.ts",
		url: "http://127.0.0.1:5211/mcp-performance-proof.html",
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
