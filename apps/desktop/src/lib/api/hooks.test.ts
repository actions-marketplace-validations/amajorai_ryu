import { describe, expect, it } from "bun:test";
import { parseHookInventory, updateHookOverride } from "./hooks.ts";

describe("parseHookInventory", () => {
	it("keeps safe handler metadata and drops executable code", () => {
		const parsed = parseHookInventory({
			hooks: [
				{
					code: "return fetch('https://example.com')",
					effectiveEnabled: false,
					enabled: true,
					handler: {
						display: "Sandboxed JavaScript",
						kind: "sandbox_js",
						path: "hooks/review.js",
					},
					hookKey: "com.example.reviewer::review",
					id: "review",
					matcher: { flag: "review" },
					ownerId: "com.example.reviewer",
					ownerName: "Reviewer",
					phase: "post_assistant_turn",
					pluginEnabled: true,
					priority: 4,
					reviewRequired: true,
					source: "plugin",
					trusted: false,
				},
			],
		});

		expect(parsed.hooks[0]?.handler.path).toBe("hooks/review.js");
		expect("code" in (parsed.hooks[0] ?? {})).toBe(false);
	});

	it("rejects malformed handler kinds", () => {
		expect(() =>
			parseHookInventory({
				hooks: [
					{
						effectiveEnabled: true,
						enabled: true,
						handler: { display: "Native", kind: "native" },
						hookKey: "bad::bad",
						id: "bad",
						ownerId: "bad",
						ownerName: "Bad",
						phase: "stop",
						pluginEnabled: true,
						priority: 0,
						reviewRequired: false,
						source: "plugin",
						trusted: true,
					},
				],
			})
		).toThrow("invalid hook handler");
	});
});

describe("updateHookOverride", () => {
	it("writes one hook at one local scope", async () => {
		const originalFetch = globalThis.fetch;
		let body = "";
		const fakeFetch = Object.assign(
			async (...args: Parameters<typeof fetch>) => {
				const init = args[1];
				body = typeof init?.body === "string" ? init.body : "";
				return new Response(JSON.stringify({ hooks: [] }), {
					headers: { "content-type": "application/json" },
					status: 200,
				});
			},
			{ preconnect: originalFetch.preconnect }
		);
		globalThis.fetch = fakeFetch;

		try {
			await updateHookOverride(
				{ token: null, url: "http://127.0.0.1:7980" },
				{
					hookKey: "com.example.reviewer::review",
					policy: { enabled: false, trusted: true },
					scope: "user",
				}
			);
			expect(JSON.parse(body)).toEqual({
				hookKey: "com.example.reviewer::review",
				policy: { enabled: false, trusted: true },
				scope: "user",
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
