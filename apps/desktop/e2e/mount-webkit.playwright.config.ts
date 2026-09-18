import { defineConfig } from "@playwright/test";
import base from "./mount-performance-proof.playwright.config.ts";
export default defineConfig({
	...base,
	// Chromium DOM/GC counters are verified by the original configuration.
	grep: /real companion bridge|records cold and repeat|closing or replacing|completed plugin host stream/,
	outputDir: "/tmp/ryu-mount-webkit-results",
	use: { ...base.use, browserName: "webkit" },
});
