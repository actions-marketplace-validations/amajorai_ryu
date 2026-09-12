import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

export default defineConfig({
	testDir: ".",
	testMatch: /node-billing-access-proof\.spec\.ts$/,
	outputDir: "/tmp/ryu-node-billing-access-proof-results",
	fullyParallel: false,
	retries: 0,
	workers: 1,
	reporter: "list",
	use: {
		...devices["Desktop Chrome"],
		baseURL: "http://localhost:3001",
		trace: "retain-on-failure",
		viewport: { height: 1000, width: 1440 },
	},
	webServer: [
		{
			command: "node e2e/node-billing-access-proof-server.mjs",
			cwd: path.join(repoRoot, "apps/desktop"),
			reuseExistingServer: false,
			timeout: 120_000,
			url: "http://127.0.0.1:3000/proof-health",
		},
		{
			command: "bunx next start -p 3001",
			cwd: path.join(repoRoot, "apps/web"),
			reuseExistingServer: false,
			timeout: 120_000,
			url: "http://127.0.0.1:3001",
		},
	],
});
