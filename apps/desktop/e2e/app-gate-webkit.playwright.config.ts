import { defineConfig } from "@playwright/test";
import base from "./app-gate.playwright.config.ts";
export default defineConfig({
	...base,
	grep: /app gates reuse/,
	outputDir: "/tmp/ryu-app-gate-webkit-results",
	use: { ...base.use, browserName: "webkit" },
});
