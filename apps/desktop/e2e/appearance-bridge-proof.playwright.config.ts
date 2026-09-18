import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.RYU_APPEARANCE_E2E_PORT ?? "5194");
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
	testDir: ".",
	testMatch: /appearance-bridge-proof\.spec\.ts/,
	workers: 1,
	reporter: "list",
	use: {
		baseURL,
		...devices["Desktop Chrome"],
	},
	webServer: {
		command:
			"bunx vite --config harness/vite.appearance-bridge.config.ts --host 127.0.0.1 --strictPort",
		url: `${baseURL}/appearance-bridge-story.html`,
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
