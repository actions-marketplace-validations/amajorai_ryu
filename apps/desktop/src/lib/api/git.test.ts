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
import {
	applyWorktree,
	checkoutBranch,
	commitPush,
	createPullRequest,
	fetchGitFileDiff,
	initializeGit,
	isPullRequestBranch,
	pullGit,
	reverseGitEdits,
	syncGit,
} from "./git.ts";
import { createProjectFolder } from "./workspace.ts";

const TARGET = { url: "http://127.0.0.1:7980", token: "node-token" };

/** The exact 415 axum returns when the content type is not `application/json`. */
const AXUM_415 = "Expected request with `Content-Type: application/json`";

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

describe("pull-request branch eligibility", () => {
	it("excludes both default branch spellings", () => {
		expect(isPullRequestBranch("main")).toBe(false);
		expect(isPullRequestBranch("MASTER")).toBe(false);
	});

	it("allows a feature branch", () => {
		expect(isPullRequestBranch("codex/simple-chat")).toBe(true);
		expect(isPullRequestBranch(null)).toBe(false);
	});
});

/** Stub `fetch` with a fixed response, capturing the request init it received. */

function stubFetch(response: Response): {
	init: RequestInit | undefined;
	url: string | undefined;
} {
	const captured: { init: RequestInit | undefined; url: string | undefined } = {
		init: undefined,
		url: undefined,
	};
	globalThis.fetch = ((url: string, init?: RequestInit) => {
		captured.url = url;
		captured.init = init;
		return Promise.resolve(response);
	}) as typeof fetch;
	return captured;
}

describe("git remote actions", () => {
	it("pulls the current workspace from its upstream", async () => {
		const captured = stubFetch(
			new Response(
				JSON.stringify({ commit: "abc123", pulled: true, success: true }),
				{ status: 200, headers: { "content-type": "application/json" } }
			)
		);
		const result = await pullGit(TARGET, "/repo");

		expect(captured.url).toBe("http://127.0.0.1:7980/api/git/pull");
		expect(JSON.parse(String(captured.init?.body))).toEqual({ cwd: "/repo" });
		expect(result).toMatchObject({
			commit: "abc123",
			pulled: true,
			success: true,
		});
		expect(headerEntries(captured.init, "content-type")).toEqual([
			"application/json",
		]);
	});

	it("syncs the workspace and preserves the push result", async () => {
		const captured = stubFetch(
			new Response(
				JSON.stringify({
					commit: "def456",
					pulled: true,
					pushed: true,
					success: true,
				}),
				{ status: 200, headers: { "content-type": "application/json" } }
			)
		);
		const result = await syncGit(TARGET, "/repo");

		expect(captured.url).toBe("http://127.0.0.1:7980/api/git/sync");
		expect(result).toMatchObject({
			commit: "def456",
			pulled: true,
			pushed: true,
			success: true,
		});
	});
});

describe("turn file review and reversal", () => {
	it("requests a diff scoped to the selected files", async () => {
		const captured = stubFetch(
			new Response(
				JSON.stringify({ patch: "diff --git a/a.ts b/a.ts", paths: ["a.ts"] }),
				{ headers: { "content-type": "application/json" }, status: 200 }
			)
		);

		const result = await fetchGitFileDiff(TARGET, "/repo", ["a.ts"]);

		expect(captured.url).toBe("http://127.0.0.1:7980/api/git/file-diff");
		expect(JSON.parse(String(captured.init?.body))).toEqual({
			cwd: "/repo",
			paths: ["a.ts"],
		});
		expect(result).toEqual({
			patch: "diff --git a/a.ts b/a.ts",
			paths: ["a.ts"],
		});
	});

	it("returns applied and structured conflict reverse-edit results", async () => {
		const plan = {
			edits: [
				{
					after: "new",
					before: "old",
					kind: "replace" as const,
					path: "a.ts",
				},
			],
			kind: "text-replacements" as const,
		};
		const appliedRequest = stubFetch(
			new Response(JSON.stringify({ kind: "applied", paths: ["a.ts"] }), {
				headers: { "content-type": "application/json" },
				status: 200,
			})
		);
		expect(await reverseGitEdits(TARGET, "/repo", plan)).toEqual({
			kind: "applied",
			paths: ["a.ts"],
		});
		expect(JSON.parse(String(appliedRequest.init?.body))).toEqual({
			cwd: "/repo",
			plan,
		});

		stubFetch(
			new Response(
				JSON.stringify({
					kind: "conflict",
					paths: ["a.ts"],
					reason: "changed_since_turn",
				}),
				{ headers: { "content-type": "application/json" }, status: 409 }
			)
		);
		expect(await reverseGitEdits(TARGET, "/repo", plan)).toEqual({
			kind: "conflict",
			paths: ["a.ts"],
			reason: "changed_since_turn",
		});
	});

	it("rejects malformed success responses", async () => {
		stubFetch(
			new Response(JSON.stringify({ patch: 42, paths: ["a.ts"] }), {
				headers: { "content-type": "application/json" },
				status: 200,
			})
		);
		await expect(fetchGitFileDiff(TARGET, "/repo", ["a.ts"])).rejects.toThrow(
			"invalid file diff response"
		);
	});
});

/** How many times a header name appears once `fetch` has normalized the init. */
function headerEntries(init: RequestInit | undefined, name: string): string[] {
	const headers = new Headers(init?.headers);
	// `Headers` joins duplicate entries with ", " — the doubled value is visible
	// as a comma in the single combined entry, which is what broke the server.
	const value = headers.get(name);
	return value === null ? [] : value.split(",").map((part) => part.trim());
}

describe("git client request headers", () => {
	it("initializes a local repository without staging files", async () => {
		const captured = stubFetch(
			new Response(
				JSON.stringify({ branch: "main", initialized: true, success: true }),
				{
					headers: { "content-type": "application/json" },
					status: 200,
				}
			)
		);
		const result = await initializeGit(TARGET, "/repo");

		expect(captured.url).toBe("http://127.0.0.1:7980/api/git/init");
		expect(JSON.parse(String(captured.init?.body))).toEqual({ cwd: "/repo" });
		expect(result).toEqual({
			branch: "main",
			initialized: true,
			success: true,
		});
		expect(headerEntries(captured.init, "content-type")).toEqual([
			"application/json",
		]);
	});

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

	it("sends pull-request title, base, draft, and staging choices", async () => {
		const captured = stubFetch(
			new Response(
				JSON.stringify({
					already_exists: true,
					comments_count: 3,
					number: 1,
					pr_url: "https://github.com/pr/1",
					title: "Ship it",
					success: true,
				}),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				}
			)
		);
		const result = await createPullRequest(TARGET, "/repo", {
			base: "main",
			body: "Details",
			draft: true,
			includeUnstaged: false,
			title: "Ship it",
		});
		expect(result).toMatchObject({
			already_exists: true,
			comments_count: 3,
			number: 1,
			title: "Ship it",
		});
		expect(JSON.parse(String(captured.init?.body))).toEqual({
			base: "main",
			body: "Details",
			cwd: "/repo",
			draft: true,
			include_unstaged: false,
			title: "Ship it",
		});
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
