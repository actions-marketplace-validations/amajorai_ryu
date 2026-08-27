import { defineConfig, devices } from "@playwright/test";

const PROOF_URL = "http://127.0.0.1:5182/";

export default defineConfig({
	testDir: ".",
	testMatch: /onboarding-activation-proof\.spec\.ts$/,
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
		command:
			"bunx vite build --config harness/vite.onboarding-activation.config.ts && bunx vite preview --config harness/vite.onboarding-activation.config.ts --host 127.0.0.1 --port 5182 --strictPort",
		url: `${PROOF_URL}onboarding-activation-proof.html`,
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
