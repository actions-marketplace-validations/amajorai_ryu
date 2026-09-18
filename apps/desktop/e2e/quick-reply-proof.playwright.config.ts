import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: import.meta.dirname,
	testMatch: "quick-reply-proof.spec.ts",
	fullyParallel: false,
	reporter: [["list"]],
	use: {
		baseURL: "http://127.0.0.1:5181",
		...devices["Desktop Chrome"],
		video: "off",
	},
	webServer: {
		command:
			"bunx vite --config harness/vite.quick-reply-proof.config.ts --host 127.0.0.1 --port 5181",
		url: "http://127.0.0.1:5181/quick-reply-proof.html",
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
