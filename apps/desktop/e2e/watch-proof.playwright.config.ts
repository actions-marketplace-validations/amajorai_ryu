import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: ".",
	testMatch: /watch-proof\.spec\.ts/,
	workers: 1,
	reporter: "list",
	use: { baseURL: "http://127.0.0.1:5199", ...devices["Desktop Chrome"] },
	webServer: {
		command: "bunx vite --config harness/vite.watch-proof.config.ts",
		url: "http://127.0.0.1:5199/watch-proof.html",
		reuseExistingServer: process.env.RYU_WATCH_REUSE_PROOF === "true",
		timeout: 120_000,
	},
});
