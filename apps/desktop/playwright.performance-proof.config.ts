import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	testMatch: [
		"**/chat-search-story.spec.ts",
		"**/agent-conversation-branch-proof.spec.ts",
	],
	outputDir: "test-results/performance-proof",
	workers: 1,
	forbidOnly: !!process.env.CI,
	retries: 0,
	reporter: "list",
	use: {
		baseURL: "http://127.0.0.1:5209",
		trace: "retain-on-failure",
		...devices["Desktop Chrome"],
	},
	webServer: {
		command: "bunx vite --config e2e/harness/vite.performance-proof.config.ts",
		url: "http://127.0.0.1:5209/chat-search-story.html",
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
