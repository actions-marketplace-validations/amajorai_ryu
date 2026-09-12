import { defineConfig, devices } from "@playwright/test";

const PROOF_URL = "http://127.0.0.1:5205/";

export default defineConfig({
	testDir: ".",
	outputDir: "/tmp/ryu-chat-performance-results",
	testMatch:
		/\/(?:chat-scroll-story|chat-grouping-story|chat-search-story|chat-performance-proof)\.spec\.ts$/,
	fullyParallel: false,
	retries: 0,
	reporter: "list",
	use: {
		baseURL: PROOF_URL,
		trace: "retain-on-failure",
	},
	projects: [
		{
			name: "chromium",
			use: {
				...devices["Desktop Chrome"],
				viewport: { height: 900, width: 1440 },
			},
		},
	],
	webServer: {
		command: "bunx vite --config harness/vite.chat-performance-proof.config.ts",
		url: `${PROOF_URL}chat-scroll-story.html`,
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
