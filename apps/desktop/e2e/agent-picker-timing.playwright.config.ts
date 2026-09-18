import { defineConfig } from "@playwright/test";
import base from "./mcp-performance-proof.playwright.config.ts";
export default defineConfig({
	...base,
	testMatch: /agent-picker-timing\.spec\.ts$/,
	outputDir: "/tmp/ryu-agent-picker-timing-results",
});
