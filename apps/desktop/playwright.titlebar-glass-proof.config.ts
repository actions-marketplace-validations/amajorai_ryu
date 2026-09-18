import { defineConfig } from "@playwright/test";
export default defineConfig({
	timeout: 90_000,
	testDir: "./e2e",
	testMatch: "titlebar-glass-proof.spec.ts",
	workers: 1,
	reporter: "list",
	use: {
		baseURL: "http://127.0.0.1:5197",
		viewport: { width: 1280, height: 820 },
	},
	webServer: {
		command:
			"bun x vite --config e2e/harness/vite.titlebar-glass-proof.config.ts",
		url: "http://127.0.0.1:5197/titlebar-glass-proof.html",
		reuseExistingServer: true,
	},
});
