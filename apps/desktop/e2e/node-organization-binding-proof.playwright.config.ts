import { defineConfig, devices } from "@playwright/test";

const PROOF_URL = "http://127.0.0.1:5191/";

export default defineConfig({
	fullyParallel: false,
	forbidOnly: Boolean(process.env.CI),
	projects: [
		{
			name: "chromium",
			use: {
				...devices["Desktop Chrome"],
				viewport: { height: 900, width: 1280 },
			},
		},
	],
	reporter: process.env.CI ? "github" : "list",
	retries: process.env.CI ? 1 : 0,
	testDir: ".",
	testMatch: /node-organization-binding-proof\.spec\.ts$/,
	use: {
		actionTimeout: 15_000,
		baseURL: PROOF_URL,
		trace: "on-first-retry",
	},
	webServer: {
		command:
			"bunx vite build --config harness/vite.node-organization-binding-proof.config.ts && bunx vite preview --config harness/vite.node-organization-binding-proof.config.ts --host 127.0.0.1 --port 5191 --strictPort",
		reuseExistingServer: false,
		timeout: 120_000,
		url: `${PROOF_URL}node-organization-binding-proof.html`,
	},
});
