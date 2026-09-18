import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: ".",
	testMatch: "standalone-app-install-proof.spec.ts",
	outputDir: "../../../docs/proof/standalone-app-install/test-results",
	workers: 1,
	use: {
		...devices["Desktop Chrome"],
		baseURL: "http://127.0.0.1:5199",
	},
	webServer: {
		command:
			"bun x vite --config harness/vite.standalone-app-proof.config.ts --host 127.0.0.1 --port 5199 --strictPort",
		url: "http://127.0.0.1:5199/app-launchpad-story.html",
		reuseExistingServer: false,
	},
});
