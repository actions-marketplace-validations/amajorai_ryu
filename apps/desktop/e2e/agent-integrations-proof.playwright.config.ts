import { defineConfig, devices } from "@playwright/test";

const PROOF_URL = "http://localhost:5184/";

export default defineConfig({
	testDir: ".",
	testMatch: /agent-integrations-proof\.spec\.ts$/,
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? "github" : "list",
	use: {
		baseURL: PROOF_URL,
		permissions: ["clipboard-read", "clipboard-write"],
		trace: "on-first-retry",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	webServer: {
		command:
			"bunx vite --config harness/vite.agent-integrations-proof.config.ts",
		url: PROOF_URL,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
