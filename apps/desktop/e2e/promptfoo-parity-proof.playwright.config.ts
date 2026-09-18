import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: path.resolve(import.meta.dirname),
	testMatch: "promptfoo-parity-proof.spec.ts",
	fullyParallel: false,
	use: { baseURL: "http://127.0.0.1:5190/", ...devices["Desktop Chrome"] },
	webServer: {
		command:
			"bunx vite --config e2e/harness/vite.promptfoo-parity-proof.config.ts",
		cwd: path.resolve(import.meta.dirname, ".."),
		url: "http://127.0.0.1:5190/prompt-studio-proof.html",
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
