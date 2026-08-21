import { defineConfig, devices } from "@playwright/test";

const PROOF_URL = "http://127.0.0.1:5180/";

export default defineConfig({
	testDir: ".",
	testMatch: /node-lifecycle-capability-proof\.spec\.ts/,
	fullyParallel: true,
	reporter: "line",
	use: {
		...devices["Desktop Chrome"],
		baseURL: PROOF_URL,
	},
	webServer: {
		command:
			"bunx vite --config harness/vite.node-lifecycle-capability-proof.config.ts --host 127.0.0.1 --port 5180",
		url: PROOF_URL,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
