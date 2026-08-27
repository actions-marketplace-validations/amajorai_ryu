import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:5187/";

export default defineConfig({
	testDir: ".",
	testMatch: /memory-citations-proof\.spec\.ts/,
	fullyParallel: false,
	workers: 1,
	use: {
		baseURL,
		...devices["Desktop Chrome"],
	},
	webServer: {
		command: "bunx vite --config harness/vite.memory-citations-proof.config.ts",
		url: `${baseURL}memory-citations-proof.html`,
		reuseExistingServer: true,
		timeout: 120_000,
	},
});
