import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: path.resolve(import.meta.dirname),
	testMatch: "bot-profile-card-proof.spec.ts",
	use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:5191" },
	webServer: {
		command:
			"bunx vite --config e2e/harness/vite.bot-profile-card-proof.config.ts",
		cwd: path.resolve(import.meta.dirname, ".."),
		reuseExistingServer: true,
		url: "http://127.0.0.1:5191/bot-profile-card-proof.html",
	},
});
