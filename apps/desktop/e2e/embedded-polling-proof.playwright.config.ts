import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: ".",
	testMatch: /embedded-polling-proof.spec.ts$/,
	workers: 1,
	timeout: 60_000,
	outputDir: "/tmp/ryu-embedded-polling-results",
	reporter: "list",
	use: {
		baseURL: "http://127.0.0.1:5209",
		viewport: { width: 1100, height: 1000 },
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	webServer: {
		command:
			"bunx vite build --config ../../../apps-store/warmup/ui/vite.config.ts --outDir /tmp/ryu-warmup-performance-build && bunx vite build --config ../../../apps-store/approvals/ui/vite.config.ts --outDir /tmp/ryu-approvals-performance-build && bunx vite --config harness/vite.embedded-polling-proof.config.ts",
		url: "http://127.0.0.1:5209/embedded-polling-proof.html",
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
