import { defineConfig, devices } from "@playwright/test";

const PROOF_URL = "http://127.0.0.1:5231/";

export default defineConfig({
	testDir: ".",
	testMatch: /scoped-pairing-proof\.spec\.ts$/,
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 60_000,
	expect: { timeout: 10_000 },
	reporter: "list",
	use: {
		baseURL: PROOF_URL,
		locale: "en-US",
		timezoneId: "UTC",
		trace: "retain-on-failure",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	webServer: {
		command:
			"node ../node_modules/vite/bin/vite.js --config harness/vite.scoped-pairing-proof.config.ts",
		url: PROOF_URL,
		reuseExistingServer: true,
		timeout: 120_000,
	},
});
