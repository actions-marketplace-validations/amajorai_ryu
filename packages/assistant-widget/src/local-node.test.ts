import { describe, expect, test } from "bun:test";

import {
	checkLocalNode,
	isLoopbackNodeUrl,
	normalizeNodeUrl,
	runLocalNodeChat,
	validateNodeUrl,
} from "./local-node.ts";

describe("local node bridge validation", () => {
	test("normalizes a loopback Core address", () => {
		expect(normalizeNodeUrl(" http://127.0.0.1:7980/ ")).toBe(
			"http://127.0.0.1:7980"
		);
		expect(isLoopbackNodeUrl("http://localhost:7980")).toBe(true);
	});

	test("rejects embedded credentials and untrusted remote nodes by default", () => {
		expect(() => normalizeNodeUrl("http://user:pass@localhost:7980")).toThrow(
			"embedded credentials"
		);
		expect(() => validateNodeUrl("https://node.example.com", false)).toThrow(
			"limited to this computer"
		);
		expect(validateNodeUrl("https://node.example.com", true)).toBe(
			"https://node.example.com"
		);
	});

	test("streams a non-persistent Core turn without sending cookies", async () => {
		const originalFetch = globalThis.fetch;
		let capturedUrl = "";
		let capturedInit: RequestInit | undefined;
		globalThis.fetch = (async (input, init) => {
			capturedUrl = String(input);
			capturedInit = init;
			return new Response(
				[
					'data: {"type":"text-delta","delta":"local "}\n\n',
					'data: {"type":"text-delta","delta":"answer"}\n\n',
					"data: [DONE]\n\n",
				].join("")
			);
		}) as typeof fetch;
		try {
			const deltas: string[] = [];
			const answer = await runLocalNodeChat(
				{ baseUrl: "http://127.0.0.1:7982", token: "node-token" },
				[{ content: "hello", role: "user" }],
				{ onDelta: (delta) => deltas.push(delta) }
			);
			expect(answer).toBe("local answer");
			expect(deltas).toEqual(["local ", "answer"]);
			expect(capturedUrl).toBe("http://127.0.0.1:7982/api/chat/stream");
			expect(capturedInit?.credentials).toBe("omit");
			expect(capturedInit?.headers).toMatchObject({
				Authorization: "Bearer node-token",
				"Content-Type": "application/json",
			});
			expect(JSON.parse(String(capturedInit?.body))).toMatchObject({
				browser_surface: "website-assistant",
				persist: false,
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("does not report a protected node as connected without its token", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input) => {
			const url = String(input);
			if (url.endsWith("/api/health")) {
				return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
			}
			return new Response("unauthorized", { status: 401 });
		}) as typeof fetch;
		try {
			await expect(
				checkLocalNode({
					baseUrl: "http://127.0.0.1:7980",
					token: null,
				})
			).rejects.toThrow("node rejected");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
