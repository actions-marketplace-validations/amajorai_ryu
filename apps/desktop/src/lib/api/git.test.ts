// Regression tests for the two halves of the "Commit & push" failure:
//
//   Unexpected token 'E', "Expected r"... is not valid JSON
//
// 1. The request sent TWO `Content-Type` entries (`makeHeaders` sets one, the
//    call site re-added a lowercase one). `fetch` combines same-name entries, so
//    Core saw `application/json, application/json` and axum's `Json` extractor
//    answered 415 with a text/plain body.
// 2. The client called `resp.json()` BEFORE checking `resp.ok`, so that body
//    became a `SyntaxError` whose message is what the panel rendered.
//
// Both are asserted here against a stubbed `fetch` — no Core required.

import { afterEach, describe, expect, it } from "bun:test";
import { applyWorktree, checkoutBranch, commitPush } from "./git.ts";
import { createProjectFolder } from "./workspace.ts";

const TARGET = { url: "http://127.0.0.1:7980", token: "node-token" };

/** The exact 415 axum returns when the content type is not `application/json`. */
const AXUM_415 = "Expected request with `Content-Type: application/json`";

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

/** Stub `fetch` with a fixed response, capturing the request init it received. */
function stubFetch(response: Response): { init: RequestInit | undefined } {
	const captured: { init: RequestInit | undefined } = { init: undefined };
	globalThis.fetch = ((_url: string, init?: RequestInit) => {
		captured.init = init;
		return Promise.resolve(response);
	}) as typeof fetch;
	return captured;
}

/** How many times a header name appears once `fetch` has normalized the init. */
function headerEntries(init: RequestInit | undefined, name: string): string[] {
	const headers = new Headers(init?.headers);
	// `Headers` joins duplicate entries with ", " — the doubled value is visible
	// as a comma in the single combined entry, which is what broke the server.
	const value = headers.get(name);
	return value === null ? [] : value.split(",").map((part) => part.trim());
}

describe("git client request headers", () => {
	it("sends exactly one application/json content type on commit/push", async () => {
		const captured = stubFetch(
			new Response(JSON.stringify({ success: true }), {
				status: 200,
				headers: { "content-type": "application/json" },
			})
		);
		await commitPush(TARGET, "/repo", "msg");
		expect(headerEntries(captured.init, "content-type")).toEqual([
			"application/json",
		]);
	});

	it("sends exactly one application/json content type on checkout", async () => {
		const captured = stubFetch(
			new Response(JSON.stringify({ success: true, branch: "main" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			})
		);
		await checkoutBranch(TARGET, "/repo", "main");
		expect(headerEntries(captured.init, "content-type")).toEqual([
			"application/json",
		]);
	});

	it("sends exactly one application/json content type on new-folder", async () => {
		const captured = stubFetch(
			new Response(JSON.stringify({ path: "/tmp/x" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			})
		);
		await createProjectFolder(TARGET, "x");
		expect(headerEntries(captured.init, "content-type")).toEqual([
			"application/json",
		]);
	});

	it("still attaches the node bearer token", async () => {
		const captured = stubFetch(
			new Response(JSON.stringify({ success: true }), { status: 200 })
		);
		await commitPush(TARGET, "/repo");
		expect(new Headers(captured.init?.headers).get("authorization")).toBe(
			"Bearer node-token"
		);
	});
});

describe("git client error bodies", () => {
	it("reports a plain-text 415 instead of throwing a JSON parse error", async () => {
		stubFetch(
			new Response(AXUM_415, {
				status: 415,
				headers: { "content-type": "text/plain; charset=utf-8" },
			})
		);
		const result = await commitPush(TARGET, "/repo", "msg");
		expect(result.success).toBe(false);
		expect(result.error).toContain("415");
		expect(result.error).toContain("Expected request");
		expect(result.error).not.toContain("not valid JSON");
	});

	it("prefers the server's JSON error message when there is one", async () => {
		stubFetch(
			new Response(
				JSON.stringify({ success: false, error: "no upstream configured" }),
				{ status: 409, headers: { "content-type": "application/json" } }
			)
		);
		const result = await commitPush(TARGET, "/repo");
		expect(result.error).toBe("no upstream configured");
	});

	it("truncates a long non-JSON error body", async () => {
		stubFetch(
			new Response(`<html>${"x".repeat(5000)}</html>`, {
				status: 502,
				headers: { "content-type": "text/html" },
			})
		);
		const result = await checkoutBranch(TARGET, "/repo", "main");
		expect(result.success).toBe(false);
		// "checkout failed: 502 — " plus at most a 200-char snippet.
		expect((result.error ?? "").length).toBeLessThanOrEqual(230);
	});

	it("flags a 200 that is not JSON (SPA/proxy fallback) as a failure", async () => {
		stubFetch(
			new Response("<!doctype html><title>app</title>", {
				status: 200,
				headers: { "content-type": "text/html" },
			})
		);
		const result = await commitPush(TARGET, "/repo");
		expect(result.success).toBe(false);
		expect(result.error).toContain("not JSON");
	});

	it("throws a readable error from applyWorktree, not a SyntaxError", async () => {
		stubFetch(
			new Response(AXUM_415, {
				status: 415,
				headers: { "content-type": "text/plain" },
			})
		);
		let thrown: unknown;
		try {
			await applyWorktree(TARGET, "run-1", { mode: "merge", message: "m" });
		} catch (e) {
			thrown = e;
		}
		expect(thrown).toBeInstanceOf(Error);
		expect((thrown as Error).name).toBe("Error");
		expect((thrown as Error).message).toContain("Expected request");
	});

	it("keeps the 409 conflicted-file list applyWorktree's caller needs", async () => {
		stubFetch(
			new Response(
				JSON.stringify({
					error: "merge_conflict",
					conflicted_files: ["a.ts", "b.ts"],
				}),
				{ status: 409, headers: { "content-type": "application/json" } }
			)
		);
		const result = await applyWorktree(TARGET, "run-1", {
			mode: "merge",
			message: "m",
		});
		expect(result.success).toBe(false);
		if (result.success === false) {
			expect(result.conflicted_files).toEqual(["a.ts", "b.ts"]);
		}
	});
});
