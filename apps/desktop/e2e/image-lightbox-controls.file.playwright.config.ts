import path from "node:path";
import { pathToFileURL } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const proofDist = path.resolve(
	import.meta.dirname,
	"harness/media-lightbox-proof-dist"
);

export default defineConfig({
	testDir: import.meta.dirname,
	testMatch: /image-lightbox-controls\.spec\.ts/,
	use: {
		baseURL: pathToFileURL(`${proofDist}${path.sep}`).href,
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
});
