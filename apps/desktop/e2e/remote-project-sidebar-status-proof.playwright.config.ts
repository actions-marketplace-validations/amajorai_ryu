import path from "node:path";
import { defineConfig } from "@playwright/test";

const proofUrl = "http://127.0.0.1:5201";

export default defineConfig({
	testDir: path.dirname(import.meta.filename),
	testMatch: /remote-project-sidebar-status-proof\.spec\.ts$/,
	fullyParallel: false,
	use: {
		baseURL: proofUrl,
		viewport: { height: 720, width: 420 },
		trace: "off",
	},
	webServer: {
		command:
			"bunx vite --config harness/vite.remote-project-sidebar-status-proof.config.ts",
		cwd: path.resolve(import.meta.dirname),
		url: `${proofUrl}/remote-project-sidebar-status-proof.html`,
		reuseExistingServer: true,
		timeout: 120_000,
	},
});
