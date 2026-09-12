import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: ".",
	testMatch: /content-lifetime.spec.ts$/,
	workers: 1,
	timeout: 60_000,
	outputDir: "/tmp/ryu-content-lifetime-results",
	reporter: "list",
	use: {
		baseURL: "http://127.0.0.1:5221",
		viewport: { width: 1300, height: 900 },
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	webServer: {
		command:
			"bunx vite build --emptyOutDir --config harness/vite.content-lifetime.config.ts --outDir /tmp/ryu-content-lifetime-build && bunx vite preview --config harness/vite.content-lifetime.config.ts --outDir /tmp/ryu-content-lifetime-build --host 127.0.0.1 --strictPort --port 5221",
		url: "http://127.0.0.1:5221/content-lifetime-proof.html",
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
