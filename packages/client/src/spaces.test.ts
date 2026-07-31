// packages/client/src/spaces.test.ts
//
// Tests for SpacesAPI: the SpaceWire/MatchWire mappers via mocked list/search,
// the search request body (query always sent; limit only when provided), and a
// drift guard over the two doc blocks this package PUBLISHES.
//
// The doc guard is not style policing. `SpacesAPI.search` said "Run a KNN
// similarity search within a Space" for the whole life of Core's graph retrieval
// mode, and `SpaceMatch.distance` said "squared L2 distance from the query
// vector" for results that are frequently a hard-coded `0.0` or `1.0`. Both ship
// to npm inside `dist/index.d.ts`, so they are what a consumer's editor shows —
// a wrong sentence there is a wrong sentence in someone else's codebase.
//
// Three copies of this prose exist (here, `@ryuhq/core-client`, and the desktop's
// own `apps/desktop/src/lib/api/spaces.ts`) and they cannot be sourced from one
// module without a dependency edge between separately published packages or
// codegen. So each copy carries its own guard, and each guard also anchors the
// Rust it now describes — a doc-only assertion would keep passing if Core dropped
// the branch, at which point the corrected wording becomes the overclaim.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SpacesAPI } from "./spaces.ts";
import type { RyuClientOptions } from "./types.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

const OPTIONS: RyuClientOptions = { baseUrl: "http://localhost:7980" };

describe("SpacesAPI.list", () => {
	test("maps snake_case spaces including document_count", async () => {
		globalThis.fetch = (() =>
			Promise.resolve(
				Response.json({
					spaces: [
						{
							id: "s1",
							name: "Docs",
							created_at: 100,
							updated_at: 200,
							document_count: 5,
						},
					],
				})
			)) as typeof fetch;
		const list = await new SpacesAPI(OPTIONS).list();
		expect(list[0]).toEqual({
			id: "s1",
			name: "Docs",
			description: null,
			createdAt: 100,
			updatedAt: 200,
			documentCount: 5,
		});
	});

	test("returns [] when spaces is absent", async () => {
		globalThis.fetch = (() =>
			Promise.resolve(new Response("{}"))) as typeof fetch;
		expect(await new SpacesAPI(OPTIONS).list()).toEqual([]);
	});
});

describe("SpacesAPI.search", () => {
	test("maps matches and sends only query when limit is omitted", async () => {
		let capturedBody: string | undefined;
		globalThis.fetch = ((_url: string, init: RequestInit) => {
			capturedBody = init.body as string;
			return Promise.resolve(
				Response.json({
					matches: [
						{
							chunk_id: "ch1",
							document_id: "d1",
							content: "text",
							distance: 0.42,
						},
					],
				})
			);
		}) as typeof fetch;
		const matches = await new SpacesAPI(OPTIONS).search("s1", "hello");
		expect(matches[0]).toEqual({
			chunkId: "ch1",
			documentId: "d1",
			content: "text",
			distance: 0.42,
		});
		expect(JSON.parse(capturedBody ?? "{}")).toEqual({ query: "hello" });
	});

	test("includes limit in the body when provided", async () => {
		let capturedBody: string | undefined;
		globalThis.fetch = ((_url: string, init: RequestInit) => {
			capturedBody = init.body as string;
			return Promise.resolve(Response.json({ matches: [] }));
		}) as typeof fetch;
		await new SpacesAPI(OPTIONS).search("s1", "hi", 3);
		expect(JSON.parse(capturedBody ?? "{}")).toEqual({ query: "hi", limit: 3 });
	});

	test("returns [] when matches is absent", async () => {
		globalThis.fetch = (() =>
			Promise.resolve(new Response("{}"))) as typeof fetch;
		expect(await new SpacesAPI(OPTIONS).search("s1", "q")).toEqual([]);
	});
});

// ── Drift guard over the published prose ─────────────────────────────────────

// src → packages/client → packages → repo root.
const REPO_ROOT = join(import.meta.dir, "../../..");

/**
 * Read a file for a mirror assertion, throwing with the resolved path when it is
 * missing. Never returns "" on failure: a silent empty string passes every
 * `not.toContain` below, which would turn this guard into a no-op the day someone
 * moves a file or gets the `..` depth wrong.
 */
function sourceFile(relative: string): string {
	const path = join(REPO_ROOT, relative);
	try {
		return readFileSync(path, "utf8");
	} catch (e) {
		throw new Error(
			`spaces drift test cannot read ${relative} (resolved ${path}): ${
				e instanceof Error ? e.message : e
			}`
		);
	}
}

const SPACES_TS = "packages/client/src/spaces.ts";
const TYPES_TS = "packages/client/src/types.ts";
const SPACES_RS = "crates/core/spaces/src/lib.rs";

/**
 * Body of one Rust fn, brace-matched from its header line. Brace-matched rather
 * than sliced by character count so an assertion can never silently read a
 * NEIGHBOURING function's code and pass on it.
 */
function rustFnBody(source: string, file: string, header: string): string {
	const start = source.indexOf(header);
	if (start === -1) {
		throw new Error(`${file} no longer contains \`${header}\` — anchor lost`);
	}
	const open = source.indexOf("{", start);
	if (open === -1) {
		throw new Error(`${file}: \`${header}\` has no body`);
	}
	let depth = 0;
	for (let i = open; i < source.length; i++) {
		if (source[i] === "{") {
			depth++;
		} else if (source[i] === "}") {
			depth--;
			if (depth === 0) {
				return source.slice(start, i + 1);
			}
		}
	}
	throw new Error(`${file}: unbalanced braces after \`${header}\``);
}

/** The doc block immediately above a declaration, by its exact header line. */
function docAbove(source: string, file: string, declaration: string): string {
	const decl = source.indexOf(declaration);
	if (decl === -1) {
		throw new Error(
			`${file} no longer contains \`${declaration}\` — this guard lost its target`
		);
	}
	const open = source.lastIndexOf("/**", decl);
	const close = source.lastIndexOf("*/", decl);
	if (open === -1 || close === -1 || close < open) {
		throw new Error(
			`\`${declaration}\` in ${file} has no JSDoc block — the published description is gone`
		);
	}
	return source.slice(open, close);
}

describe("the search description this package publishes", () => {
	const doc = docAbove(sourceFile(SPACES_TS), SPACES_TS, "async search(");

	test("names the graph branch, not just vector search", () => {
		expect(doc).toContain("retrieval_mode");
		expect(doc).toContain("graph");
		expect(doc.toLowerCase()).toContain("traversal");
	});

	test("does not describe the call as a KNN search", () => {
		// The word may appear (the vector branch really is a KNN), but not as the
		// unqualified description of the whole call. Both historic spellings.
		expect(doc).not.toContain("Run a KNN similarity search");
		expect(doc).not.toContain("Run a KNN search");
	});

	test("warns that graph results are bounded rather than exhaustive", () => {
		expect(doc.toLowerCase()).toContain("bounded");
		expect(doc.toLowerCase()).toContain("exhaustive");
	});
});

describe("the SpaceMatch.distance description this package publishes", () => {
	const doc = docAbove(sourceFile(TYPES_TS), TYPES_TS, "distance: number;");

	test("no longer claims every distance is a query-vector metric", () => {
		expect(doc).not.toContain("Squared L2 distance from the query vector");
	});

	test("names the two synthetic values and the rerank reorder", () => {
		expect(doc).toContain("0.0");
		expect(doc).toContain("1.0");
		expect(doc.toLowerCase()).toContain("rerank");
	});
});

describe("the Core behaviour those docs now claim", () => {
	const spacesRs = sourceFile(SPACES_RS);

	test("search_ext still branches on the Space's retrieval mode", () => {
		// Without this half the doc tests are a spellcheck: someone could collapse
		// Core back to a single branch and every assertion above would still pass
		// while the published description promised a capability that was gone.
		const body = rustFnBody(spacesRs, SPACES_RS, "pub async fn search_ext(");
		expect(body).toContain("let mode = self.space_mode(space_id).await?;");
		expect(body).toContain("RetrievalMode::Graph => self.graph_search(");
		expect(body).toContain("RetrievalMode::Vector => self.vector_search(");
	});

	test("distance is still a metric in one branch and a constant in the others", () => {
		expect(spacesRs).toContain(
			"// Synthetic distance: 0.0 = direct entity hit."
		);
		expect(spacesRs).toContain(
			"// Synthetic: link-reached chunks re-scored by the reranker."
		);
	});

	test("the reranker reorders without rewriting distance", () => {
		// The doc tells callers that array order, not `distance`, is the ranking.
		// That is only true while `apply_reranking` clones candidates through
		// unchanged; a version that stamped the cross-encoder score onto `distance`
		// would make sorting by it correct again.
		const body = rustFnBody(spacesRs, SPACES_RS, "async fn apply_reranking(");
		// The proof is positive and specific: the cross-encoder score is bound to
		// `_score` and thrown away, and the surviving chunk is pushed through as a
		// clone. A `not.toContain("distance =")` here would be theatre — the
		// realistic mutation is a struct literal (`ChunkMatch { .., distance: score
		// }`), which that string never matches.
		expect(body).toContain(
			"for (idx, _score) in ranked.into_iter().take(limit)"
		);
		expect(body).toContain("reordered.push(chunk.clone());");
	});
});
