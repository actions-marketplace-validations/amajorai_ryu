import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: ".",
	testMatch: /dom-localizer\.spec\.ts$/,
	workers: 1,
	timeout: 30_000,
	outputDir: "/tmp/ryu-dom-localizer-results",
	reporter: "list",
	projects: [
		{ name: "chromium", use: { browserName: "chromium" } },
		{ name: "webkit", use: { browserName: "webkit" } },
	],
	use: {
		baseURL: "http://127.0.0.1:5240",
		viewport: { width: 1200, height: 900 },
		trace: "retain-on-failure",
	},
	webServer: {
		command: "bunx vite --config harness/vite.dom-localizer.config.ts",
		url: "http://127.0.0.1:5240/dom-localizer-proof.html",
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
