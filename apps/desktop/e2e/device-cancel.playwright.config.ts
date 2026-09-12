import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: ".",
	testMatch: /device-cancel.spec.ts$/,
	workers: 1,
	timeout: 60_000,
	outputDir: "/tmp/ryu-device-cancel-results",
	reporter: "list",
	use: {
		baseURL: "http://127.0.0.1:5222",
		viewport: { width: 1300, height: 900 },
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	webServer: {
		command:
			"bunx vite build --emptyOutDir --config harness/vite.device-cancel.config.ts --outDir /tmp/ryu-device-cancel-build && bunx vite preview --config harness/vite.device-cancel.config.ts --outDir /tmp/ryu-device-cancel-build --host 127.0.0.1 --strictPort --port 5222",
		url: "http://127.0.0.1:5222/device-cancel-proof.html",
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
