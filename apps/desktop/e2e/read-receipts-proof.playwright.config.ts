import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: import.meta.dirname,
	testMatch: "read-receipts-proof.spec.ts",
	fullyParallel: false,
	reporter: [["list"]],
	use: {
		baseURL: "http://127.0.0.1:5182",
		...devices["Desktop Chrome"],
		video: "off",
	},
	webServer: {
		command:
			"bunx vite --config harness/vite.read-receipts-proof.config.ts --host 127.0.0.1 --port 5182",
		reuseExistingServer: false,
		timeout: 120_000,
		url: "http://127.0.0.1:5182/read-receipts-proof.html",
	},
});
