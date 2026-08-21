import { defineConfig, devices } from "@playwright/test";

const PROOF_URL = "http://127.0.0.1:5197/";

export default defineConfig({
	testDir: ".",
	testMatch: /worktree-handoff-proof\.spec\.ts$/,
	fullyParallel: false,
	retries: 0,
	reporter: "line",
	use: {
		...devices["Desktop Chrome"],
		baseURL: PROOF_URL,
		trace: "retain-on-failure",
	},
	webServer: {
		command: "bunx vite --config harness/vite.worktree-handoff-proof.config.ts",
		url: `${PROOF_URL}worktree-handoff-proof.html`,
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
