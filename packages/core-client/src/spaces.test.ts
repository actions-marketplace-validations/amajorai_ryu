// packages/core-client/src/spaces.test.ts
//
// Drift guard for the ONE sentence in this package that a language model reads.
//
// `searchSpace` here is what `apps/mcp/src/tools.ts` calls for the
// `ryu_search_space` MCP tool, so its doc block is not internal prose — it is the
// text a maintainer copies into a tool description, and therefore the text an
// agent uses to decide whether this tool can answer a multi-hop question. It said
// "Run a KNN similarity search within a Space" for the whole life of the graph
// retrieval mode: a model told KNN concludes the tool cannot follow a chain of
// entities, and stops asking. An under-claiming doc is a capability that ships
// dark.
//
// The same prose exists in three independently published places — here, in
// `@ryuhq/client` (`packages/client/src/spaces.ts`, a class API with its own
// bundled `dist/`), and in `apps/desktop/src/lib/api/spaces.ts` (coupled to the
// desktop's `ApiTarget`/`GlyphValue`). There is no way to source them from one
// module without adding a dependency edge between separately published packages
// or generating code — both build-system changes. So each copy carries this
// guard instead, and the guard has TWO halves on purpose:
//
//  1. A doc assertion. Fails if the copy regresses to calling this a KNN search.
//  2. A Rust anchor. Fails if Core stops branching on the mode — at which point
//     the *new* wording becomes the overclaim, and a doc-only test would happily
//     keep passing while the docs lied in the other direction.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// src → packages/core-client → packages → repo root.
const REPO_ROOT = join(import.meta.dir, "../../..");

/**
 * Read a file for a mirror assertion, throwing with the resolved path when it is
 * missing. Never returns "" on failure: a silent empty string passes every
 * `not.toContain` below, which would turn this whole file into a no-op the day
 * someone moves a file or gets the `..` depth wrong.
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

const SPACES_TS = "packages/core-client/src/spaces.ts";
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

/** The doc block immediately above `export async function searchSpace(`. */
function searchSpaceDoc(source: string): string {
	const decl = source.indexOf("export async function searchSpace(");
	if (decl === -1) {
		throw new Error(
			`${SPACES_TS} no longer exports searchSpace — this guard lost its target`
		);
	}
	const open = source.lastIndexOf("/**", decl);
	const close = source.lastIndexOf("*/", decl);
	if (open === -1 || close === -1 || close < open) {
		throw new Error(
			`searchSpace in ${SPACES_TS} has no JSDoc block — the description an agent reads is gone`
		);
	}
	return source.slice(open, close);
}

describe("the searchSpace description an MCP client reads", () => {
	const doc = searchSpaceDoc(sourceFile(SPACES_TS));

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
		// The bound is lossy: `graph_search` truncates each hop's frontier, and a
		// chunk reachable only through a truncated entity drops out. A caller that
		// reads an empty result as "nothing about X" is wrong, and only this doc
		// says so.
		expect(doc.toLowerCase()).toContain("bounded");
		expect(doc.toLowerCase()).toContain("exhaustive");
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
		// `SpaceMatch.distance` is documented here as un-rankable because graph hits
		// and link-expanded chunks carry placeholders. If Core ever starts writing a
		// real score in those paths, that warning becomes the false statement.
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
