import { describe, expect, it } from "bun:test";
import { resolveDefaultCoreUrl } from "./core-url.ts";

describe("default Core URL", () => {
	it("uses the standalone app namespace before the normal Vite URL", () => {
		expect(
			resolveDefaultCoreUrl("http://127.0.0.1:7980", "@ryu/expenses")
		).toBe("http://127.0.0.1:32571");
	});

	it("keeps the configured URL for the ordinary Desktop product", () => {
		expect(resolveDefaultCoreUrl("http://127.0.0.1:8980", "")).toBe(
			"http://127.0.0.1:8980"
		);
	});
});
