import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: ".",
	testMatch: /campaign-performance.spec.ts$/,
	workers: 1,
	timeout: 60_000,
	outputDir: "/tmp/ryu-campaign-results",
	reporter: "list",
	use: {
		baseURL: "http://127.0.0.1:5218",
		viewport: { width: 1300, height: 900 },
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	webServer: {
		command:
			"bunx vite build --emptyOutDir --config harness/vite.campaign-performance.config.ts --outDir /tmp/ryu-campaign-build && bunx vite preview --config harness/vite.campaign-performance.config.ts --outDir /tmp/ryu-campaign-build --host 127.0.0.1 --strictPort --port 5218",
		url: "http://127.0.0.1:5218/campaign-performance-proof.html",
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
