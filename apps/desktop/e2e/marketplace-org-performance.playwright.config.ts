import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: ".",
	testMatch: /marketplace-org-performance.spec.ts$/,
	workers: 1,
	timeout: 60_000,
	outputDir: "/tmp/ryu-marketplace-org-results",
	reporter: "list",
	use: {
		baseURL: "http://127.0.0.1:5217",
		viewport: { width: 1300, height: 900 },
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	webServer: {
		command:
			"bunx vite build --emptyOutDir --config harness/vite.marketplace-org-performance.config.ts --outDir /tmp/ryu-marketplace-org-build && bunx vite preview --config harness/vite.marketplace-org-performance.config.ts --outDir /tmp/ryu-marketplace-org-build --host 127.0.0.1 --strictPort --port 5217",
		url: "http://127.0.0.1:5217/marketplace-org-performance-proof.html",
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
