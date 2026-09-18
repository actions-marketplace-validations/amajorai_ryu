import { defineConfig } from "@playwright/test";
import base from "./label-layers.playwright.config.ts";
export default defineConfig({
	...base,
	testMatch: /(button-label-overflow-proof|reveal-webkit)\.spec\.ts$/,
	outputDir: "/tmp/ryu-controls-webkit-results",
	use: { ...base.use, browserName: "webkit" },
});
