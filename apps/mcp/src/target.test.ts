import { afterEach, describe, expect, test } from "bun:test";
import { buildTarget, coreUrlForProfile } from "./target.ts";

const savedEnvironment = { ...process.env };

afterEach(() => {
	for (const key of [
		"RYU_CORE_URL",
		"RYU_CORE_TOKEN",
		"RYU_PROFILE",
		"RYU_DIR",
	]) {
		delete process.env[key];
	}
	Object.assign(process.env, savedEnvironment);
});

describe("MCP target", () => {
	test("uses the matching port for every supported profile", () => {
		expect(coreUrlForProfile("release")).toBe("http://127.0.0.1:7980");
		expect(coreUrlForProfile("dev")).toBe("http://127.0.0.1:8980");
		expect(coreUrlForProfile("nightly")).toBe("http://127.0.0.1:10980");
	});

	test("uses the explicit remote URL and node bearer", () => {
		process.env.RYU_CORE_URL = "https://node.example";
		process.env.RYU_CORE_TOKEN = "node-secret";

		expect(buildTarget()).toEqual({
			url: "https://node.example",
			token: "node-secret",
		});
	});
});
