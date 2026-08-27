import { defineConfig, devices } from "@playwright/test";

const PROOF_URL = "http://127.0.0.1:5193/";

export default defineConfig({
	testDir: ".",
	testMatch: /office-workspace-proof\.spec\.ts/,
	fullyParallel: false,
	retries: 0,
	reporter: "list",
	use: {
		baseURL: PROOF_URL,
		trace: "retain-on-failure",
		viewport: { height: 900, width: 1440 },
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	webServer: {
		command: "bunx vite --config harness/vite.office-workspace-proof.config.ts",
		url: `${PROOF_URL}office-workspace-proof.html`,
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
