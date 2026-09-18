import { defineConfig } from "@playwright/test";
import base from "./mcp-performance-proof.playwright.config.ts";
export default defineConfig({
	...base,
	testMatch: /populated-agent-proof\.spec\.ts$/,
	outputDir: "/tmp/ryu-populated-agent-proof-results",
});
