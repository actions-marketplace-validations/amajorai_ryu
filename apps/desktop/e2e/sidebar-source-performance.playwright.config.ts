import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: ".",
	testMatch: /app-sidebar-sections-proof.spec.ts$/,
	workers: 1,
	timeout: 60_000,
	outputDir: "/tmp/ryu-sidebar-source-proof-results",
	reporter: "list",
	use: {
		baseURL: "http://127.0.0.1:5214",
		viewport: { width: 1300, height: 900 },
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	webServer: {
		command:
			"bunx vite build --emptyOutDir --config harness/vite.sidebar-source-performance.config.ts --outDir /tmp/ryu-sidebar-source-preview-build && bunx vite preview --config harness/vite.sidebar-source-performance.config.ts --outDir /tmp/ryu-sidebar-source-preview-build --host 127.0.0.1 --strictPort --port 5214",
		url: "http://127.0.0.1:5214/app-sidebar-sections-proof.html",
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
