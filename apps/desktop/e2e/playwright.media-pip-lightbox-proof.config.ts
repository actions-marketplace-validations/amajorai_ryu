import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: ".",
	testMatch: /media-pip-lightbox-proof\.spec\.ts$/,
	reporter: "line",
	workers: 1,
	use: {
		baseURL: "http://127.0.0.1:5217",
		viewport: { width: 1280, height: 800 },
	},
	webServer: {
		command:
			"bunx vite --config harness/vite.media-pip-lightbox-proof.config.ts --host 127.0.0.1 --port 5217 --strictPort",
		url: "http://127.0.0.1:5217/media-pip-lightbox-proof.html",
		reuseExistingServer: true,
	},
});
