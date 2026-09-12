import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: ".",
	testMatch: /extension-health-performance.spec.ts$/,
	workers: 1,
	timeout: 60_000,
	outputDir: "/tmp/ryu-extension-health-results",
	reporter: "list",
	use: {
		baseURL: "http://127.0.0.1:5215",
		viewport: { width: 1300, height: 900 },
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	webServer: {
		command:
			"bunx vite build --emptyOutDir --config harness/vite.extension-health-performance.config.ts --outDir /tmp/ryu-extension-health-build && bunx vite preview --config harness/vite.extension-health-performance.config.ts --outDir /tmp/ryu-extension-health-build --host 127.0.0.1 --strictPort --port 5215",
		url: "http://127.0.0.1:5215/extension-health-performance-proof.html",
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
