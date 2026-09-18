import { defineConfig } from "@playwright/test";
import base from "./navigation-performance-proof.playwright.config.ts";
export default defineConfig({
	...base,
	workers: 1,
	outputDir: "/tmp/ryu-navigation-webkit-results",
	projects: [
		{
			name: "webkit",
			use: { browserName: "webkit", viewport: { height: 900, width: 1440 } },
		},
	],
	webServer: {
		command:
			"bunx vite --config harness/vite.navigation-performance-proof.config.ts",
		url: "http://127.0.0.1:5197/navigation-performance-proof.html",
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
