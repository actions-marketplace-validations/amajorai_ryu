import { defineConfig, devices } from "@playwright/test";

const STORY_URL = "http://127.0.0.1:5217/";

export default defineConfig({
	fullyParallel: false,
	outputDir: "test-results/spaces-import-proof-run",
	reporter: "list",
	testDir: ".",
	testMatch: /spaces-import-proof\.spec\.ts/,
	use: {
		baseURL: STORY_URL,
		trace: "off",
	},
	projects: [
		{
			name: "chromium",
			use: {
				...devices["Desktop Chrome"],
				viewport: { height: 1200, width: 1440 },
			},
		},
	],
	webServer: {
		command:
			"bunx vite build --config harness/vite.spaces-import-proof.config.ts && bunx vite preview --config harness/vite.spaces-import-proof.config.ts --host 127.0.0.1 --port 5217 --strictPort",
		reuseExistingServer: !process.env.CI,
		timeout: 360_000,
		url: `${STORY_URL}spaces-import-proof.html`,
	},
});
