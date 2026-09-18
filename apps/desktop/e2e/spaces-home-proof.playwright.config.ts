import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: ".",
	testMatch: /spaces-home-proof\.spec\.ts$/,
	workers: 1,
	timeout: 60_000,
	outputDir: "/tmp/ryu-spaces-home-proof-results",
	reporter: "list",
	use: {
		baseURL: "http://127.0.0.1:5222",
		viewport: { width: 1280, height: 1000 },
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	webServer: {
		command:
			"bunx vite build --emptyOutDir --config harness/vite.spaces-home-proof.config.ts --outDir /tmp/ryu-spaces-home-proof-build && bunx vite preview --config harness/vite.spaces-home-proof.config.ts --outDir /tmp/ryu-spaces-home-proof-build --host 127.0.0.1 --strictPort --port 5222",
		url: "http://127.0.0.1:5222/spaces-home-proof.html",
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
