import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: ".",
	testMatch: /announcement-clock.spec.ts$/,
	workers: 1,
	timeout: 60_000,
	outputDir: "/tmp/ryu-announcement-clock-results",
	reporter: "list",
	use: {
		baseURL: "http://127.0.0.1:5219",
		viewport: { width: 1300, height: 900 },
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	webServer: {
		command:
			"bunx vite build --emptyOutDir --config harness/vite.announcement-clock.config.ts --outDir /tmp/ryu-announcement-clock-build && bunx vite preview --config harness/vite.announcement-clock.config.ts --outDir /tmp/ryu-announcement-clock-build --host 127.0.0.1 --strictPort --port 5219",
		url: "http://127.0.0.1:5219/announcement-clock-proof.html",
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
