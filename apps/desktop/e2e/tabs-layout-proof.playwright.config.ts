import { defineConfig, devices } from "@playwright/test";

const PROOF_URL = "http://127.0.0.1:5178/";

export default defineConfig({
	testDir: ".",
	testMatch: /tabs-layout-proof\.spec\.ts/,
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
			use: { ...devices["Desktop Chrome"] },
		},
	],
	webServer: {
		command: "bunx vite --config harness/vite.tabs-layout-proof.config.ts",
		url: `${PROOF_URL}tabs-layout-proof.html`,
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
