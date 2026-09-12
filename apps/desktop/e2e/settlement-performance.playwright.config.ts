import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: ".",
	testMatch: /settlement-performance.spec.ts$/,
	workers: 1,
	timeout: 60_000,
	outputDir: "/tmp/ryu-settlement-results",
	reporter: "list",
	use: {
		baseURL: "http://127.0.0.1:5220",
		viewport: { width: 1300, height: 900 },
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	webServer: {
		command:
			"bunx vite build --emptyOutDir --config harness/vite.settlement-performance.config.ts --outDir /tmp/ryu-settlement-build && bunx vite preview --config harness/vite.settlement-performance.config.ts --outDir /tmp/ryu-settlement-build --host 127.0.0.1 --strictPort --port 5220",
		url: "http://127.0.0.1:5220/settlement-performance-proof.html",
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
