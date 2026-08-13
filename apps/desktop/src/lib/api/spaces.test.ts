// apps/desktop/src/lib/api/spaces.test.ts
//
// The Spaces retrieval-mode control, pinned to the Core contract it drives.
//
// This file exists because of a specific failure: a client control and a server
// gate built in the same wave, neither side checking the other, shipping a picker
// that wrote a field nothing read. `CreateSpaceBody` in Core is a plain
// `#[derive(serde::Deserialize)]` with NO `deny_unknown_fields`, so a create body
// carrying `retrievalMode` (camelCase), or `retrieval-mode`, or a mode spelled
// `"graphrag"`, is not a 400 — serde discards the unknown key and Core cheerfully
// creates a vector Space and returns 200. The user picks Graph, sees success, and
// gets a Space that never builds an entity graph. Nothing surfaces, ever.
//
// So the tests below are of two kinds, following `preferences.test.ts` doctrine:
//
//  1. MIRROR tests. Every wire spelling this client sends or reads has its real
//     definition in Rust, in this repo. Each anchor is scoped to a NAMED Rust item
//     and THROWS when that item is gone, so a Core-side rename reads as "this
//     mirror lost its target" rather than as a silently-passing assertion.
//
//  2. BEHAVIOUR tests over the pure functions (`toRetrievalMode`,
//     `describeRetrievalModeChange`). These are about the read path and the copy,
//     where the risk is not drift but a wrong claim shown to the user.
//
// ── The coupling, stated so nobody has to discover it ────────────────────────
//
// The anchors read `apps/core/src/server/mod.rs` and
// `crates/core/spaces/src/lib.rs`, neither of which is owned by whoever owns this
// file. A Core author who renames `set_retrieval_mode` or re-spells a JSON key
// gets a failure in a desktop test they have never opened — which is the point,
// and why each failure names the file, the item, and what to do about it.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	describeRetrievalModeChange,
	FILE_DOCUMENT_KIND,
	formatBytes,
	isFileDocument,
	NODE_UPLOAD_MAX_BYTES,
	NOT_CONTENT_SEARCHABLE_STATES,
	type RetrievalMode,
	type RetrievalModeChange,
	SPACE_UPLOAD_MAX_BYTES,
	type SpaceFileIndexState,
	toFileIndexState,
	toRetrievalMode,
} from "./spaces.ts";

// src/lib/api → src/lib → src → apps/desktop → apps → repo root.
const REPO_ROOT = join(import.meta.dir, "../../../../..");

function rustSource(relative: string): string {
	const path = join(REPO_ROOT, relative);
	try {
		return readFileSync(path, "utf8");
	} catch (e) {
		throw new Error(
			`mirror test cannot read ${relative} (resolved ${path}): ${e instanceof Error ? e.message : e}`
		);
	}
}

/**
 * Extract the body of one Rust item by its header line, brace-matched so a method
 * inside an `impl` yields the method and not the rest of the `impl`.
 *
 * Throws — never returns `""` — when the header is absent, because an anchor whose
 * host item was renamed must read as "go look at this test", not as a bare false.
 */
function rustItemBody(source: string, file: string, header: string): string {
	const start = source.indexOf(header);
	if (start < 0) {
		throw new Error(
			`mirror test anchor lost its target: \`${header}\` is no longer in ${file}. ` +
				"The Spaces retrieval-mode client (apps/desktop/src/lib/api/spaces.ts) " +
				"claims to speak that item's wire contract; re-point this anchor " +
				"(apps/desktop/src/lib/api/spaces.test.ts) and re-check the client " +
				"against whatever replaced it."
		);
	}
	const open = source.indexOf("{", start);
	if (open < 0) {
		throw new Error(`mirror test found \`${header}\` in ${file} but no body`);
	}
	let depth = 0;
	for (let i = open; i < source.length; i++) {
		if (source[i] === "{") {
			depth++;
		} else if (source[i] === "}") {
			depth--;
			if (depth === 0) {
				return source.slice(open, i + 1);
			}
		}
	}
	throw new Error(
		`mirror test found \`${header}\` in ${file} but its body never closes`
	);
}

/** Collapse every whitespace run to one space, so formatting is not the claim. */
const squeeze = (s: string): string => s.replaceAll(/\s+/g, " ").trim();

/** The mirror under test; named in every anchor diagnostic. */
const SPACES_TS = "apps/desktop/src/lib/api/spaces.ts";

/** What {@link rustAnchor} returns when the expression is still there. */
const ANCHOR_PRESENT = "present";

/**
 * Probe a named Rust item for the literal this client mirrors,
 * whitespace-insensitively. Returns {@link ANCHOR_PRESENT}, or a diagnostic
 * naming the file, the item and the expression.
 *
 * A probe rather than an assertion helper on purpose (twice over): Biome's
 * `noMisplacedAssertion` rejects an `expect` outside an `it`, and returning the
 * diagnostic puts it on the FAILURE LINE — the person who breaks this is a Core
 * author who has never opened this file and must know what to do without reading
 * it. Same shape as `preferences.test.ts`, deliberately.
 */
function rustAnchor(
	source: string,
	file: string,
	header: string,
	anchor: string
): string {
	const body = rustItemBody(source, file, header);
	return squeeze(body).includes(squeeze(anchor))
		? ANCHOR_PRESENT
		: `MISSING from ${file} :: ${header} — the TS client in ${SPACES_TS} claims Core still does: ${anchor}`;
}

/** Probe a Rust item for a bare substring (a JSON key), same contract. */
function rustContains(
	source: string,
	file: string,
	header: string,
	needle: string
): string {
	return rustItemBody(source, file, header).includes(needle)
		? ANCHOR_PRESENT
		: `MISSING from ${file} :: ${header} — the TS client in ${SPACES_TS} reads: ${needle}`;
}

const SERVER_RS = "apps/core/src/server/mod.rs";
const SPACES_RS = "crates/core/spaces/src/lib.rs";
const RAG_RS = "crates/core/rag/src/lib.rs";
/** Core's RAG wiring module — home of the ONE `SpaceRecall` implementation. */
const RAG_HOST_RS = "apps/core/src/rag_host.rs";

const serverRs = rustSource(SERVER_RS);
const spacesRs = rustSource(SPACES_RS);
const ragRs = rustSource(RAG_RS);

describe("retrieval-mode wire spellings mirror Core", () => {
	it("uses exactly the two spellings RetrievalMode::as_str emits", () => {
		const asStr = rustItemBody(spacesRs, SPACES_RS, "pub fn as_str(self)");
		// Every `"…"` inside `as_str`, which is the ONE place the column/wire form
		// is defined. A third mode added in Rust fails here until this client and
		// the `RetrievalMode` union learn about it — which is the desired outcome:
		// a mode the UI cannot name is a mode the UI must not silently mis-send.
		const spellings = [...asStr.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
		const clientModes: RetrievalMode[] = ["graph", "vector"];
		expect(spellings).toEqual([...clientModes].sort());
	});

	it("sends the field name Core's create body actually deserializes", () => {
		// `CreateSpaceBody` has no `deny_unknown_fields`, so a mis-spelled key here
		// would be DISCARDED with a 200 rather than rejected — the silent failure
		// this whole file exists to prevent.
		expect(
			rustAnchor(
				serverRs,
				SERVER_RS,
				"struct CreateSpaceBody",
				"retrieval_mode: Option<String>"
			)
		).toBe(ANCHOR_PRESENT);
	});

	it("reads the mode Core echoes back from the create response", () => {
		expect(
			rustAnchor(
				serverRs,
				SERVER_RS,
				"async fn create_space(",
				'"retrieval_mode": mode.as_str()'
			)
		).toBe(ANCHOR_PRESENT);
	});

	it("posts to the route Core actually mounts for a mode change", () => {
		// The path built in `setSpaceRetrievalMode`, with the id segment as Core
		// declares it. A route renamed to e.g. `/retrieval_mode` would 404 into the
		// generic error path, which reads as "network problem", not "wrong URL".
		expect(
			rustAnchor(
				serverRs,
				SERVER_RS,
				"fn spaces_routes(",
				'.route("/api/spaces/:id/retrieval-mode", post(set_retrieval_mode))'
			)
		).toBe(ANCHOR_PRESENT);
	});

	it("sends the body key the change route requires", () => {
		expect(
			rustAnchor(
				serverRs,
				SERVER_RS,
				"struct SetRetrievalModeBody",
				"retrieval_mode: Option<String>"
			)
		).toBe(ANCHOR_PRESENT);
	});

	it("reads every field the change response reports", () => {
		// Each of these maps to a field of `RetrievalModeChange` in spaces.ts. A key
		// renamed in Core would arrive as `undefined` and fall through this client's
		// `??` defaults — reporting "0 entities" for a rebuild that mapped hundreds.
		const keys = [
			'"retrieval_mode"',
			'"previous_retrieval_mode"',
			'"changed"',
			'"graph_rebuilt"',
			'"chunks_scanned"',
			'"graph_nodes"',
			'"graph_edges"',
			'"note"',
		];
		expect(
			keys.map((key) =>
				rustContains(serverRs, SERVER_RS, "async fn set_retrieval_mode(", key)
			)
		).toEqual(keys.map(() => ANCHOR_PRESENT));
	});

	it("still receives retrieval_mode on every listed Space", () => {
		// The read path depends on `spaces::Space` serializing the field
		// unconditionally. A `skip_serializing_if` added here would make the
		// Retrieval card show "Vector" for every graph Space.
		const spaceStruct = rustItemBody(spacesRs, SPACES_RS, "pub struct Space {");
		expect(spaceStruct).toContain("pub retrieval_mode: RetrievalMode");
		const modeField = spaceStruct.slice(
			0,
			spaceStruct.indexOf("pub retrieval_mode: RetrievalMode")
		);
		// The attribute, if any, would sit immediately above the field.
		expect(modeField.split("///").at(-1) ?? "").not.toContain(
			"skip_serializing_if"
		);
	});

	it("mirrors Core's LENIENT read-path coercion, not its strict parse", () => {
		// Two different Rust functions with different strictness. `parse` guards
		// WRITES (unknown → 400); `from_str` guards READS off the column (unknown →
		// Vector, so one odd row cannot blank the Spaces list). `toRetrievalMode`
		// is a read-path mapper and must match `from_str`.
		const fromStr = rustItemBody(spacesRs, SPACES_RS, "fn from_str(s: &str)");
		expect(squeeze(fromStr)).toContain('"graph" => Self::Graph');
		expect(squeeze(fromStr)).toContain("_ => Self::Vector");
	});
});

// ── `system`: the flag the sidebar greys "Delete space" out on ───────────────
//
// The Spaces sidebar disables its Delete item for `space.system` and explains
// why in a tooltip (`SpaceSidebarRow`, apps/desktop/src/components/layout/
// AppSidebar.tsx). That is a claim about Core, and an unusually load-bearing
// one: get it wrong in the "false" direction and the user gets the action back
// plus the failure toast it always produced; get it wrong in the "true"
// direction and a perfectly deletable Space becomes undeletable from the UI.
//
// Two Rust facts hold the claim up, and they live in different crates:
//
//   1. `spaces::Space` still SERIALIZES `system` on every listed Space — with
//      `#[serde(default)]`, which is what lets the client treat an absent field
//      as `false` against an older node instead of greying out everything.
//   2. `SpaceStore::delete_space` still REFUSES a system Space. The moment that
//      bail goes away the disable is a lie and should be deleted with it.
//
// Note the org-bound path is deliberately NOT pinned here: on a bound node the
// `require_resource_write` gate in `delete_space` (server/mod.rs) 403s an
// owner-less system row before the store is ever reached, so the two paths fail
// differently. The client reads the flag precisely so it does not have to
// predict which of the two it would have hit.
describe("the system-Space flag the delete action is gated on", () => {
	it("is still serialized on every listed Space, with serde(default)", () => {
		const spaceStruct = rustItemBody(spacesRs, SPACES_RS, "pub struct Space {");
		expect(spaceStruct).toContain("pub system: bool");
		// The attribute sits immediately above the field; `default` is what the
		// client's `s.system ?? false` older-Core tolerance rests on, and a
		// `skip_serializing_if` would make a system Space indistinguishable from a
		// user one on the wire.
		const beforeField = spaceStruct.slice(
			0,
			spaceStruct.indexOf("pub system: bool")
		);
		const attrs = beforeField.split("///").at(-1) ?? "";
		expect(attrs).toContain("serde(default)");
		expect(attrs).not.toContain("skip_serializing_if");
	});

	it("is still listed off the spaces table, so the wire value is the column", () => {
		expect(
			rustAnchor(
				spacesRs,
				SPACES_RS,
				"pub async fn list_spaces(",
				"s.retrieval_mode, s.system, s.icon"
			)
		).toBe(ANCHOR_PRESENT);
	});

	it("still makes Core REFUSE to delete a system Space", () => {
		// Without this bail the disabled item is inventing a restriction. With it,
		// an ENABLED item could only ever produce the "Couldn't delete this space"
		// toast — which is the bug the disable exists to remove.
		const del = rustItemBody(
			spacesRs,
			SPACES_RS,
			"pub async fn delete_space(&self, space_id: &str)"
		);
		expect(squeeze(del)).toContain("if is_system == Some(1)");
		expect(del).toContain("is a system space and cannot be deleted");
	});
});

// ── The SCOPE of the mode, pinned in both directions ─────────────────────────
//
// The UI copy (`RETRIEVAL_MODE_SCOPE` in packages/blocks/src/desktop/spaces.tsx,
// and the `Space.retrievalMode` doc in spaces.ts) makes a claim about Core that
// no type checks. It has now been wrong in BOTH directions, which is why the
// anchors below are two-sided:
//
//  1. OVERclaim (shipped): the card said the setting decided "how this space finds
//     answers when an agent searches it", while an agent's automatic recall on a
//     chat turn went through a code path that had never heard of the column.
//  2. UNDERclaim (caught here, by this file's own negative anchor): the copy was
//     narrowed to "direct search only" — and then Core grew
//     `ryu_rag::SpaceRecall`, a delegate that answers `RetrievalOptions::space_ids`
//     out of `SpaceStore::search_ext`, which is precisely the function that reads
//     the column. The chat turn started honouring the mode, and copy telling the
//     user it does not is as wrong as the copy that overpromised.
//
// So the anchors pin the CHAIN, not one endpoint: the column is read in exactly
// one place (`search_ext`), and both the direct-search route and the chat-turn
// recall path must be shown to reach it. If either link goes, the picker is again
// a control that writes a field somebody's path ignores.
describe("what the retrieval mode is claimed to govern", () => {
	it("is still read in exactly one place — search_ext", () => {
		// `search_ext` → `space_mode()` is the single branch point between
		// `vector_search` and `graph_search`. Every claim below is a claim that some
		// caller reaches THIS function; if the read moves, they all need re-pointing.
		expect(
			rustAnchor(
				spacesRs,
				SPACES_RS,
				"pub async fn search_ext(",
				"let mode = self.space_mode(space_id).await?;"
			)
		).toBe(ANCHOR_PRESENT);
	});

	it("still reaches search_ext from the route the client posts to", () => {
		expect(
			rustAnchor(serverRs, SERVER_RS, "async fn search_space(", ".search_ext(")
		).toBe(ANCHOR_PRESENT);
	});

	it("also reaches search_ext from the chat-turn recall path", () => {
		// The chain the copy now promises, one link at a time. `retrieve` is what
		// `sidecar/adapters` calls to build a turn's context from memory + the
		// agent's Spaces; it delegates the Spaces half rather than scanning
		// `retrieval.db` for them (a Space's documents are never indexed there).
		// The `pub` in the header is deliberate: this file also declares a trait
		// method and a trait impl with the same name, and anchoring the wrong one
		// would pass while proving nothing.
		const retrieve = rustItemBody(
			ragRs,
			RAG_RS,
			"pub async fn retrieve(&self, query: &str, opts: &RetrievalOptions)"
		);
		// Positive control: assert we extracted the ranker before asserting what it
		// delegates to.
		expect(retrieve).toContain(
			"cosine_similarity(&query_embedding, &embedding)"
		);
		expect(retrieve).toContain("self.recall_spaces(query, opts)");

		// …which calls the delegate…
		expect(
			rustAnchor(
				ragRs,
				RAG_RS,
				"async fn recall_spaces(",
				"delegate.recall(query, opts, opts.top_k)"
			)
		).toBe(ANCHOR_PRESENT);

		// …whose ONE production implementation calls `search_ext`, closing the chain
		// back onto the column read pinned above.
		const ragHostRs = rustSource(RAG_HOST_RS);
		expect(
			rustAnchor(
				ragHostRs,
				RAG_HOST_RS,
				"impl SpaceRecall for SpacesRecall",
				".search_ext(&space_id, query, per_space_limit, None, filter)"
			)
		).toBe(ANCHOR_PRESENT);
	});

	it("keeps ONE entity graph, in the Spaces store, not a copy in the RAG crate", () => {
		// The invariant that survives the delegation, and the reason delegation was
		// chosen over mirroring: two entity graphs that can disagree would be a worse
		// defect than the one the delegate closed. The RAG crate must therefore never
		// grow graph tables or a traversal of its own — it asks `spaces.db`.
		//
		// Comments are stripped first because the crate's docs legitimately NAME
		// these tables to explain where the graph lives; scanning raw source would
		// force the explanation out to keep the guard green.
		const ragCode = ragRs
			.replaceAll(/^\s*\/\/.*$/gm, "")
			.replaceAll(/\/\*[\s\S]*?\*\//g, "");
		for (const name of ["graph_nodes", "graph_edges", "fn graph_search"]) {
			expect(ragCode).not.toContain(name);
		}
	});
});

describe("toRetrievalMode", () => {
	it("passes through the two known spellings", () => {
		expect(toRetrievalMode("graph")).toBe("graph");
		expect(toRetrievalMode("vector")).toBe("vector");
	});

	it("degrades anything else to vector instead of throwing", () => {
		// Matches Rust `from_str`'s `_ => Self::Vector`, including case sensitivity:
		// `"Graph"` is NOT graph on either side.
		for (const value of ["Graph", "GRAPH", "graphrag", "", "hybrid"]) {
			expect(toRetrievalMode(value)).toBe("vector");
		}
	});

	it("treats an absent field as vector (older Core, no column serialized)", () => {
		expect(toRetrievalMode(undefined)).toBe("vector");
		expect(toRetrievalMode(null)).toBe("vector");
	});
});

/** A change payload with the fields a test does not care about filled in. */
function change(partial: Partial<RetrievalModeChange>): RetrievalModeChange {
	return {
		mode: "graph",
		previous: "vector",
		changed: true,
		graphRebuilt: true,
		chunksScanned: 0,
		graphNodes: 0,
		graphEdges: 0,
		note: "",
		...partial,
	};
}

describe("describeRetrievalModeChange", () => {
	it("reports what the graph rebuild covered", () => {
		const text = describeRetrievalModeChange(
			change({ chunksScanned: 12, graphNodes: 30, graphEdges: 45 })
		);
		expect(text).toContain("30 entities");
		expect(text).toContain("45 connections");
		expect(text).toContain("12 chunks");
	});

	it("singularizes counts of one", () => {
		const text = describeRetrievalModeChange(
			change({ chunksScanned: 1, graphNodes: 1, graphEdges: 1 })
		);
		expect(text).toContain("1 entity");
		expect(text).toContain("1 connection");
		expect(text).toContain("1 chunk");
		expect(text).not.toContain("entities");
	});

	it("does not read an empty space as a failed rebuild", () => {
		// "Mapped 0 entities across 0 chunks" is a correct outcome for a space with
		// no documents, but it reads as breakage. This case gets its own sentence.
		const text = describeRetrievalModeChange(change({ chunksScanned: 0 }));
		expect(text).toContain("no documents yet");
		expect(text).not.toContain("0 entities");
	});

	it("says the graph was discarded when switching back to vector", () => {
		const text = describeRetrievalModeChange(
			change({ mode: "vector", previous: "graph", graphRebuilt: false })
		);
		expect(text).toContain("discarded");
		expect(text).toContain("Vector retrieval is on");
	});

	it("never claims anything was re-embedded, in either direction", () => {
		// Core never re-embeds on a mode switch. Copy that implied it would send
		// users looking for a cost/wait that does not exist.
		for (const outcome of [
			change({ chunksScanned: 3, graphNodes: 4, graphEdges: 5 }),
			change({ chunksScanned: 0 }),
			change({ mode: "vector", graphRebuilt: false }),
		]) {
			expect(describeRetrievalModeChange(outcome)).not.toMatch(
				/re-?embedding|will be re-?embedded/i
			);
		}
	});
});

// ── The two client docs that describe things OUTSIDE this file ───────────────
//
// `RetrievalModeChange.changed` and the `searchSpace` block both explain state a
// reader cannot see from the type alone, and both were wrong at some point in
// exactly the way this file exists to catch:
//
//  - `searchSpace` called the route "a KNN search" for the whole life of graph
//    mode. The header comment at the top of `spaces.ts` then kept saying it for a
//    round after the function's own doc was fixed.
//  - `changed` documents a repair path — re-asserting `graph` on a graph Space to
//    rebuild a dropped graph — that `SpacesPage.tsx` deliberately refuses to
//    issue, returning early when the picked mode equals the current one. The doc
//    now says so. If that guard is ever removed the doc becomes false in the
//    other direction, so the guard is pinned here rather than described.

describe("what the client docs claim about code they do not contain", () => {
	const spacesTs = rustSource("apps/desktop/src/lib/api/spaces.ts");

	it("never calls a Space search a KNN search, header included", () => {
		// Scoped to the two historic sentences rather than the word "KNN", which
		// legitimately names the vector branch inside the corrected prose.
		expect(spacesTs).not.toContain("searched via KNN");
		expect(spacesTs).not.toContain("Run a KNN similarity search");
	});

	it("still has the early return that makes changed:false API-only", () => {
		// The doc on `changed` tells a reader the repair is reachable through the
		// endpoint but not through this UI, and says why (an uncancellable rebuild
		// holding the one SQLite connection). Delete the guard and that becomes a
		// false statement — plus a stray click on the already-selected mode becomes
		// a node-wide stall.
		const page = rustSource("apps/desktop/src/pages/SpacesPage.tsx");
		expect(page).toContain("selected.retrievalMode === mode");
		expect(spacesTs).toContain("API-only");
	});

	it("still describes graph-mode distances as placeholders Core really writes", () => {
		// `SpaceMatch.distance` warns that graph hits and link-expanded chunks carry
		// constants, so array order is the ranking. Both constants are single
		// assignment sites in Core; if either starts carrying a real score the
		// warning over-claims.
		const spacesRs = rustSource(SPACES_RS);
		expect(spacesRs).toContain(
			"// Synthetic distance: 0.0 = direct entity hit."
		);
		expect(spacesRs).toContain(
			"// Synthetic: link-reached chunks re-scored by the reranker."
		);
		expect(spacesTs).not.toContain(
			"/** Squared L2 distance from the query vector (smaller is closer). */"
		);
	});

	it("still reranks by reordering rather than by rewriting distance", () => {
		// The other half of that doc: it tells callers array order, not `distance`,
		// is the ranking. True only while `apply_reranking` binds the cross-encoder
		// score to `_score`, discards it, and pushes the chunk through as a clone.
		// Asserted positively — a `not.toContain("distance =")` would miss the
		// realistic mutation, which is a struct literal carrying `distance: score`.
		const body = rustItemBody(
			rustSource(SPACES_RS),
			SPACES_RS,
			"async fn apply_reranking("
		);
		expect(body).toContain(
			"for (idx, _score) in ranked.into_iter().take(limit)"
		);
		expect(body).toContain("reordered.push(chunk.clone());");
	});
});

// ── Whether an uploaded file's CONTENTS are searchable ───────────────────────
//
// The claim this client makes on screen — "this file is stored and opens, but a
// search will not find the text inside it" — is a claim about Core's
// `document.parse` capability, which the client cannot observe. So it is anchored
// where the behaviour lives, and every anchor below is written to fail LOUDLY, with
// instructions, when Core moves.
//
// This block has already been rewritten once, mid-task, and the reason is worth
// keeping because it is the exact hazard this file's header describes. The first
// version keyed the badge on `rawKind === 'file'` and pinned that to
// `SpaceStore::create_file` still embedding only its `{title}\n{mime}` descriptor.
// Core then landed `space_file_index.rs`, which *wraps* `create_file` — leaving the
// descriptor line untouched, so the anchor kept passing — and started extracting
// text. `.txt`/`.md`/`.csv` go through the in-process floor and are `indexed` before
// the upload returns, so the badge would have libelled them while its test stayed
// green. An anchor on the WRAPPED function cannot see a change made in the WRAPPER;
// the anchors below therefore point at the caller.

const CORE_SPACE_FILE_INDEX_RS = "apps/core/src/space_file_index.rs";
const spaceFileIndexRs = rustSource(CORE_SPACE_FILE_INDEX_RS);

describe("file index state mirrors Core's document.parse status", () => {
	it("uses exactly the four spellings IndexState::as_str emits, plus unattempted", () => {
		// `as_str` is the ONE definition of the stored wire strings, and its own doc
		// says "The stable wire string. Clients branch on this." `unattempted` is not
		// a stored variant — it is synthesised by `unknown_json` for a document with
		// no status row — so it is asserted separately rather than expected here.
		const asStr = rustItemBody(
			spaceFileIndexRs,
			CORE_SPACE_FILE_INDEX_RS,
			"pub const fn as_str(self)"
		);
		const stored = [...asStr.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
		expect(stored).toEqual(["failed", "indexed", "pending", "skipped"]);
		expect(
			rustContains(
				spaceFileIndexRs,
				CORE_SPACE_FILE_INDEX_RS,
				"pub fn unknown_json(",
				'"state": "unattempted"'
			)
		).toBe(ANCHOR_PRESENT);
		// Every one of the five round-trips through the client's coercion.
		for (const state of [
			"failed",
			"indexed",
			"pending",
			"skipped",
			"unattempted",
		] satisfies SpaceFileIndexState[]) {
			expect(toFileIndexState(state)).toBe(state);
		}
	});

	it("says NOTHING rather than 'not searchable' for an unknown or absent state", () => {
		// The load-bearing default. A sixth state added in Core must make this UI go
		// quiet, not make it accuse an indexed file. Same for the field being absent,
		// which is every row today.
		expect(toFileIndexState(undefined)).toBeNull();
		expect(toFileIndexState(null)).toBeNull();
		expect(toFileIndexState("")).toBeNull();
		expect(toFileIndexState("Indexed")).toBeNull();
		expect(toFileIndexState("extracted")).toBeNull();
	});

	it("treats pending as on-its-way, not as not-searchable", () => {
		// Telling a user their file is unsearchable while a reader is mid-parse would
		// be wrong within seconds, and `pending` is written BEFORE the parse starts —
		// Core's comment: "so a client that reads immediately after upload sees
		// 'running', not an absent row it would have to guess about."
		expect(NOT_CONTENT_SEARCHABLE_STATES).toEqual([
			"failed",
			"skipped",
			"unattempted",
		]);
		expect(NOT_CONTENT_SEARCHABLE_STATES).not.toContain("pending");
		expect(NOT_CONTENT_SEARCHABLE_STATES).not.toContain("indexed");
	});

	it("reads the key Core actually serializes the record under", () => {
		// `index` is taken from the CREATE response, which is the only response that
		// carries the record today. Re-spelled there, the client's list reader must
		// be re-pointed too — `toDocument` is its only reader.
		expect(
			rustAnchor(
				serverRs,
				SERVER_RS,
				"async fn create_file(",
				'"index": created.index.to_json(),'
			)
		).toBe(ANCHOR_PRESENT);
		expect(
			rustAnchor(
				spaceFileIndexRs,
				CORE_SPACE_FILE_INDEX_RS,
				"pub fn to_json(&self)",
				'"state": self.state.as_str(),'
			)
		).toBe(ANCHOR_PRESENT);
	});

	it("only renders `message`, which Core promises is never the contents", () => {
		// A `failed` row shows this string to the user. Core's field doc is what
		// makes that safe; if the guarantee goes, so must the rendering.
		expect(spaceFileIndexRs).toContain(
			"/// Human-readable detail. Never the document's contents."
		);
	});
});

describe("the client does not guess a file's index state", () => {
	it("no longer derives 'not searchable' from the file kind", () => {
		// THE regression this block was rewritten for. `create_file_indexed` awaits
		// the builtin floor inline, so a `.txt`/`.md`/`.csv` is `indexed` by the time
		// the upload response is written and a kind-based rule would be wrong about
		// it. `isFileDocument` survives (routing and icons still need it) but must
		// not be the source of a searchability claim.
		expect(
			rustAnchor(
				spaceFileIndexRs,
				CORE_SPACE_FILE_INDEX_RS,
				"pub async fn create_file_indexed(",
				"if document_parse::is_builtin_readable(title) {"
			)
		).toBe(ANCHOR_PRESENT);
		const spacesTs = rustSource(SPACES_TS);
		expect(spacesTs).not.toContain("isFileDocument(doc) ? false");
		expect(isFileDocument({ rawKind: FILE_DOCUMENT_KIND })).toBe(true);
		expect(isFileDocument({ rawKind: "page" })).toBe(false);
	});

	it("no longer derives it from the chunk count either", () => {
		// `chunkCount === 1` held for every file before extraction and is a
		// coincidence after it (a short extracted document also yields one chunk), so
		// it would degrade into a silent lie rather than a failing test.
		const spacesTs = rustSource(SPACES_TS);
		const map = rustItemBody(spacesTs, SPACES_TS, "function toDocument(");
		expect(map).toContain("withFileIndex(toFileIndex(d.index))");
		expect(map).not.toContain("chunkCount ===");
		// One reader for both sources: the (future) inline list field and the
		// per-document status route must not be able to fill these three fields
		// differently, which is what `withFileIndex` exists to prevent.
		const coerce = rustItemBody(spacesTs, SPACES_TS, "function toFileIndex(");
		expect(coerce).toContain("toFileIndexState(w?.state)");
	});

	it("every upload path goes through the one indexed-create seam", () => {
		// Two wired and one not is the state a later reader cannot tell apart from
		// "this file type just isn't extractable" — Core's own words. If a fourth
		// caller appears that skips it, its files get no status row and read as
		// `unattempted` forever, which the UI would then report as fact.
		expect(serverRs).toContain("crate::space_file_index::create_file_indexed(");
		expect(rustSource("apps/core/src/server/uploads.rs")).toContain(
			"crate::space_file_index::create_file_indexed("
		);
		expect(rustSource("apps/core/src/sidecar/mcp/artifact_tool.rs")).toContain(
			"crate::space_file_index::create_file_indexed_detached("
		);
	});
});

describe("the list route carries index state, so the client asks once", () => {
	// This block replaces "the gap this client cannot close from its own side",
	// which asserted the opposite. The gap is closed: Core joins its per-document
	// extraction record onto the list rows. What has to be pinned now is the shape
	// of that join and the two rules that keep it honest.

	it("still keeps the state OUT of the spaces crate's own schema", () => {
		// The join is Core-side because `ryu-spaces` has zero dependency on
		// `apps/core` and must keep none — teaching its `documents` table a
		// parser-provenance vocabulary would invert that layering. So `Document`
		// gains no column and `list_documents` gains no join; Core decorates the
		// serialized rows afterwards.
		const doc = rustItemBody(spacesRs, SPACES_RS, "pub struct Document {");
		expect(doc).not.toContain("index");
		const list = rustItemBody(
			spacesRs,
			SPACES_RS,
			"pub async fn list_documents("
		);
		expect(list).not.toContain("index_state");
	});

	it("joins the record onto the LIST response in one pass", () => {
		// One store read for the whole list. The client used to fan out one HTTP
		// request per file row (batched eight at a time) against a Space — Uploads —
		// whose length is bounded by nothing.
		expect(
			rustAnchor(
				serverRs,
				SERVER_RS,
				"async fn list_documents(",
				"crate::space_file_index::attach_index_states(&mut rows).await;"
			)
		).toBe(ANCHOR_PRESENT);
		// Bulk, not N calls to `get`.
		expect(spaceFileIndexRs).toContain("pub async fn get_many(");
		expect(
			rustAnchor(
				spaceFileIndexRs,
				CORE_SPACE_FILE_INDEX_RS,
				"pub async fn attach_index_states(",
				"store.get_many(&file_ids).await"
			)
		).toBe(ANCHOR_PRESENT);
	});

	it("answers every file row and stays silent about every other kind", () => {
		// The two rules the desktop reader depends on. A page/database/whiteboard is
		// re-chunked from its own source on every save, so `index` must be ABSENT for
		// it — stamping `unattempted` there would badge every page "Name only". A
		// file with no status row must still get `unknown_json`, because "nobody
		// looked" is a real answer and a dropped key is not.
		const merge = rustItemBody(
			spaceFileIndexRs,
			CORE_SPACE_FILE_INDEX_RS,
			"pub fn merge_index_into_documents("
		);
		expect(merge).toContain("Some(FILE_DOCUMENT_KIND)");
		expect(merge).toContain("unknown_json(&doc_id)");
	});

	it("uses the SAME key and object the create responses already send", () => {
		// One wire shape for three routes, so `toFileIndex` is the only reader the
		// client needs. `LIST_INDEX_KEY` is that key, spelled once in Core.
		expect(spaceFileIndexRs).toContain(
			'pub const LIST_INDEX_KEY: &str = "index";'
		);
		expect(
			rustAnchor(
				serverRs,
				SERVER_RS,
				"async fn create_file(",
				'"index": created.index.to_json(),'
			)
		).toBe(ANCHOR_PRESENT);
	});

	it("has no per-document fan-out left in the client", () => {
		// Two writers for the same three document fields is how they drift apart.
		// The per-document route stays mounted in Core (it is a documented
		// single-document read) but this app no longer calls it.
		const spacesTs = rustSource(SPACES_TS);
		expect(spacesTs).not.toContain(
			"export async function fetchDocumentIndexStatus"
		);
		const page = rustSource("apps/desktop/src/pages/SpacesPage.tsx");
		expect(page).not.toContain("fetchDocumentIndexStatus");
		expect(page).not.toContain("INDEX_STATUS_BATCH");
		const routes = rustItemBody(serverRs, SERVER_RS, "fn spaces_routes(");
		expect(squeeze(routes)).toContain(
			squeeze(
				'"/api/spaces/:id/documents/:doc_id/index", get(get_document_index_status),'
			)
		);
	});
});

describe("the upload ceiling this client reports", () => {
	it("is the one every upload from this app actually hits", () => {
		// `/api/uploads` is where chat attachments, editor pastes and
		// `ui.uploadFile` all land, and 32 MiB is where they stop. This is the only
		// ceiling `StorageSettings` may print.
		expect(rustSource("apps/core/src/server/uploads.rs")).toContain(
			"pub const MAX_UPLOAD_BYTES: usize = super::media::MAX_MEDIA_BYTES;"
		);
		expect(rustSource("apps/core/src/server/media.rs")).toContain(
			"pub const MAX_MEDIA_BYTES: usize = 32 * 1024 * 1024;"
		);
		expect(NODE_UPLOAD_MAX_BYTES).toBe(32 * 1024 * 1024);
	});

	it("declares the ceiling it actually enforces, defined from one source", () => {
		// The 200 MiB figure is gone from Core. `MAX_FILE_BYTES` is now DEFINED AS
		// `uploads::MAX_UPLOAD_BYTES` rather than a second literal, which is the part
		// worth pinning: two literals can drift, a definition cannot. Anchoring on the
		// literal `32 * 1024 * 1024` here would reintroduce exactly that drift.
		expect(serverRs).toContain(
			"const MAX_FILE_BYTES: usize = uploads::MAX_UPLOAD_BYTES;"
		);
		expect(SPACE_UPLOAD_MAX_BYTES).toBe(NODE_UPLOAD_MAX_BYTES);
		expect(
			rustAnchor(
				serverRs,
				SERVER_RS,
				"async fn create_file(",
				"if bytes.len() > MAX_FILE_BYTES"
			)
		).toBe(ANCHOR_PRESENT);
		// The row lives on the Storage tab. It used to be a card on a separate
		// "Document parsing" section, which also carried a duplicate of the
		// `document.parse` provider picker that the node dropdown's Toolkits row
		// already owns; that section is gone and this row moved with the ceiling.
		const panel = rustSource(
			"apps/desktop/src/components/settings/StorageSettings.tsx"
		);
		// It may still be NAMED in the panel's prose (that is where the discrepancy is
		// explained); what it must not be is rendered.
		expect(panel).not.toContain("formatBytes(SPACE_UPLOAD_MAX_BYTES)");
		expect(panel).not.toContain(
			"import { formatBytes, SPACE_UPLOAD_MAX_BYTES }"
		);
		// The panel prefers the ceiling the NODE reports over any client mirror,
		// falling back to the constant only when the node did not answer. That is the
		// stronger shape: a hardcoded figure is what produced the 200 MiB bug, so this
		// pins "fetched, with a labelled fallback" rather than a specific literal.
		expect(panel).toContain("capability?.maxInputBytes");
		expect(panel).toContain("formatBytes(limit)");
		expect(panel).toContain("NODE_UPLOAD_MAX_BYTES");
		expect(panel).toContain('title="Maximum file you can upload"');
	});

	it("pins the axum default that made the old 200 MiB figure unreachable", () => {
		// The experiment, not the inference. This is why the ceiling had to be
		// aligned rather than merely re-documented: without an explicit layer the
		// route caps at axum's implicit 2 MiB, i.e. ~1.5 MiB of base64-encoded file.
		// If this Rust test disappears, the history in `SPACE_UPLOAD_MAX_BYTES`'s doc
		// comment is unsupported.
		expect(rustSource("apps/core/src/server/uploads.rs")).toContain(
			"async fn a_route_without_an_explicit_limit_caps_at_axums_default()"
		);
		// Both upload routes now DECLARE their limit through a `BodyLimit`, which
		// carries the wire ceiling and the sentence a rejection prints together — so
		// the enforced number and the explanation cannot drift apart. A bare
		// `DefaultBodyLimit::max(...)` enforced the right number and answered with an
		// unexplained 413; anchoring on that older form is what this pins against.
		expect(
			rustAnchor(
				serverRs,
				SERVER_RS,
				"pub fn create_router(",
				"uploads::UPLOADS_BODY_LIMIT.apply("
			)
		).toBe(ANCHOR_PRESENT);
		// `/api/spaces/:id/files` is registered in `spaces_routes()`, not
		// `create_router()` — the Spaces surface is a sub-router mounted behind its
		// own AppGate. Anchoring it to the wrong function would pass vacuously the day
		// someone moved it, which is the failure mode these mirrors exist to catch.
		expect(
			rustAnchor(
				serverRs,
				SERVER_RS,
				"fn spaces_routes(",
				"uploads::SPACE_FILE_BODY_LIMIT.apply("
			)
		).toBe(ANCHOR_PRESENT);
	});

	it("formats byte counts the way the limits panel renders them", () => {
		expect(formatBytes(NODE_UPLOAD_MAX_BYTES)).toBe("32 MB");
		expect(formatBytes(SPACE_UPLOAD_MAX_BYTES)).toBe("32 MB");
		// A three-digit MB figure is what the old 200 MiB bug looked like on screen.
		expect(formatBytes(200 * 1024 * 1024)).toBe("200 MB");
		expect(formatBytes(1536)).toBe("1.5 KB");
		expect(formatBytes(999)).toBe("999 B");
		// Never renders "NaN undefined" into a settings row.
		expect(formatBytes(0)).toBe("0 B");
		expect(formatBytes(Number.NaN)).toBe("0 B");
	});
});
