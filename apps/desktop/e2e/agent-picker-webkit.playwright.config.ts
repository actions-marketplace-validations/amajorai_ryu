import { defineConfig } from "@playwright/test";
import base from "./agent-picker-timing.playwright.config.ts";
export default defineConfig({
	...base,
	outputDir: "/tmp/ryu-agent-picker-webkit-results",
	use: { ...base.use, browserName: "webkit" },
});
