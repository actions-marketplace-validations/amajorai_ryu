import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: ".",
	testMatch: /app-reuse-proof\.spec\.ts$/,
	reporter: "line",
	outputDir: "../../../artifacts/app-reuse-audit/test-results",
	workers: 1,
	use: { baseURL: "http://127.0.0.1:5199" },
	webServer: {
		command: "bun ../../../tools/serve-companion-design-proof.ts",
		url: "http://127.0.0.1:5199/",
		reuseExistingServer: true,
	},
});
