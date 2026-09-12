import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: ".",
	testMatch: /companion-design-proof\.spec\.ts$/,
	reporter: "line",
	workers: 2,
	use: {
		baseURL: "http://127.0.0.1:5199",
		viewport: { width: 1280, height: 800 },
	},
	webServer: {
		command: "bun ../../../tools/serve-companion-design-proof.ts",
		url: "http://127.0.0.1:5199/",
		reuseExistingServer: true,
	},
});
