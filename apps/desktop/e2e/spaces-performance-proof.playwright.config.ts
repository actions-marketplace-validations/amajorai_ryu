import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: ".",
	testMatch: /spaces-performance-proof.spec.ts$/,
	workers: 1,
	timeout: 60_000,
	outputDir: "/tmp/ryu-spaces-proof-results",
	reporter: "list",
	use: {
		baseURL: "http://127.0.0.1:5212",
		viewport: { width: 1300, height: 900 },
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	webServer: {
		command:
			"bunx vite build --emptyOutDir --config harness/vite.spaces-performance-proof.config.ts --outDir /tmp/ryu-spaces-preview-build && bunx vite preview --config harness/vite.spaces-performance-proof.config.ts --outDir /tmp/ryu-spaces-preview-build --host 127.0.0.1 --strictPort --port 5212",
		url: "http://127.0.0.1:5212/spaces-performance-proof.html",
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
