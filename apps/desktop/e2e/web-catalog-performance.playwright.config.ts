import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: ".",
	testMatch: /web-catalog-performance.spec.ts$/,
	workers: 1,
	timeout: 60_000,
	outputDir: "/tmp/ryu-web-catalog-results",
	reporter: "list",
	use: {
		baseURL: "http://127.0.0.1:5216",
		viewport: { width: 1300, height: 900 },
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	webServer: {
		command:
			"bunx vite build --emptyOutDir --config harness/vite.web-catalog-performance.config.ts --outDir /tmp/ryu-web-catalog-build && bunx vite preview --config harness/vite.web-catalog-performance.config.ts --outDir /tmp/ryu-web-catalog-build --host 127.0.0.1 --strictPort --port 5216",
		url: "http://127.0.0.1:5216/web-catalog-performance-proof.html",
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
