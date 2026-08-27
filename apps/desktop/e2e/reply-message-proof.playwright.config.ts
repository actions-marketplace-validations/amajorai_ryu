import path from "node:path";
import { pathToFileURL } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const proofDist = path.resolve(import.meta.dirname, "harness/dist");

export default defineConfig({
	testDir: ".",
	testMatch: /reply-message-proof\.spec\.ts/,
	fullyParallel: false,
	reporter: "list",
	use: {
		baseURL: pathToFileURL(`${proofDist}${path.sep}`).href,
		trace: "on-first-retry",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
});
