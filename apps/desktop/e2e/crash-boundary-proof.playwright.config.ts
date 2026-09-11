import { defineConfig, devices } from "@playwright/test";

const proofUrl = "http://127.0.0.1:5183/";

export default defineConfig({
	forbidOnly: true,
	reporter: "list",
	testDir: ".",
	testMatch: /crash-boundary-proof\.spec\.ts$/,
	use: {
		baseURL: proofUrl,
		trace: "retain-on-failure",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	webServer: {
		command:
			"bunx vite build --config harness/vite.crash-boundary-proof.config.ts && bunx vite preview --config harness/vite.crash-boundary-proof.config.ts --host 127.0.0.1 --port 5183 --strictPort",
		reuseExistingServer: false,
		timeout: 120_000,
		url: `${proofUrl}crash-boundary-proof.html`,
	},
});
