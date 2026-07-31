// packages/core-client/src/spaces.ts
//
// Typed client for Core's Spaces / RAG endpoints (`/api/spaces`). A Space is a
// named document collection backed by a sqlite-vec vector store; documents are
// ingested (chunked + embedded) and searched by whichever retrieval algorithm
// the Space is set to — vector KNN or entity-graph traversal — after which hits
// are link-expanded and neurally reranked. See {@link searchSpace}. Wire shapes
// mirror the Core handlers in `apps/core/src/server/{mod,spaces}.rs`
// (snake_case on the wire).

import { type ApiTarget, request } from "./client.ts";

/** A named document collection. `documentCount` is computed by Core. */
export interface Space {
	/** Unix milliseconds. */
	createdAt: number;
	description: string | null;
	documentCount: number;
	/** Notion-style glyph JSON (GlyphValue), when set. */
	icon: unknown | null;
	id: string;
	name: string;
	/** Unix milliseconds. */
	updatedAt: number;
}

/** A document inside a Space, with its chunk count. */
export interface SpaceDocument {
	chunkCount: number;
	/** Unix milliseconds. */
	createdAt: number;
	/** Notion-style glyph JSON (GlyphValue), when set. */
	icon: unknown | null;
	id: string;
	spaceId: string;
	title: string;
}

/** A single ranked chunk returned from a Space search. */
export interface SpaceMatch {
	chunkId: string;
	content: string;
	/**
	 * **Do not rank on this field, and do not read magnitudes off it.** It used to
	 * be documented as "squared L2 distance from the query vector", which is only
	 * ever true of one of the three ways a chunk can end up in this array:
	 *
	 * - a vector-mode KNN hit carries its real `vec0` distance (smaller is closer);
	 * - a graph-mode traversal hit is assigned the constant `0.0`;
	 * - a chunk pulled in by `[[page]]`-link expansion (which runs in **both**
	 *   modes) is assigned the constant `1.0`.
	 *
	 * The last two are placeholders, not measurements. On top of that Core's bge
	 * reranker re-orders the survivors **without rewriting `distance`**, so array
	 * order — not this number — is the ranking. Sorting by `distance` un-does the
	 * rerank; averaging or thresholding it mixes a metric with two constants.
	 */
	distance: number;
	documentId: string;
}

interface SpaceWire {
	created_at: number;
	description?: string | null;
	document_count: number;
	icon?: unknown | null;
	id: string;
	name: string;
	updated_at: number;
}

interface DocumentWire {
	chunk_count: number;
	created_at: number;
	icon?: unknown | null;
	id: string;
	space_id: string;
	title: string;
}

interface MatchWire {
	chunk_id: string;
	content: string;
	distance: number;
	document_id: string;
}

function toSpace(s: SpaceWire): Space {
	return {
		id: s.id,
		name: s.name,
		description: s.description ?? null,
		createdAt: s.created_at,
		updatedAt: s.updated_at,
		documentCount: s.document_count,
		icon: s.icon ?? null,
	};
}

function toDocument(d: DocumentWire): SpaceDocument {
	return {
		id: d.id,
		spaceId: d.space_id,
		title: d.title,
		createdAt: d.created_at,
		chunkCount: d.chunk_count,
		icon: d.icon ?? null,
	};
}

function toMatch(m: MatchWire): SpaceMatch {
	return {
		chunkId: m.chunk_id,
		documentId: m.document_id,
		content: m.content,
		distance: m.distance,
	};
}

/** List all Spaces, most-recently-updated first. */
export async function fetchSpaces(target: ApiTarget): Promise<Space[]> {
	const json = await request<{ spaces?: SpaceWire[] }>(target, "/api/spaces");
	return (json.spaces ?? []).map(toSpace);
}

/** Create a new Space and return its id. */
export async function createSpace(
	target: ApiTarget,
	name: string,
	description: string | null
): Promise<string> {
	const json = await request<{ id: string }>(target, "/api/spaces", {
		method: "POST",
		body: { name, description },
	});
	return json.id;
}

/** Delete a Space and everything in it. Returns whether a row was removed. */
export async function deleteSpace(
	target: ApiTarget,
	id: string
): Promise<boolean> {
	const json = await request<{ removed?: boolean }>(
		target,
		`/api/spaces/${id}`,
		{
			method: "DELETE",
		}
	);
	return json?.removed ?? false;
}

/** Set or clear a Space glyph (`POST /api/spaces/:id/icon`). */
export async function setSpaceIcon(
	target: ApiTarget,
	id: string,
	icon: unknown | null
): Promise<void> {
	await request(target, `/api/spaces/${id}/icon`, {
		method: "POST",
		body: { icon },
	});
}

/** Set or clear a document glyph without re-embedding. */
export async function setDocumentIcon(
	target: ApiTarget,
	spaceId: string,
	documentId: string,
	icon: unknown | null
): Promise<void> {
	await request(target, `/api/spaces/${spaceId}/documents/${documentId}/icon`, {
		method: "POST",
		body: { icon },
	});
}

/** List the documents in a Space. */
export async function fetchDocuments(
	target: ApiTarget,
	spaceId: string
): Promise<SpaceDocument[]> {
	const json = await request<{ documents?: DocumentWire[] }>(
		target,
		`/api/spaces/${spaceId}/documents`
	);
	return (json.documents ?? []).map(toDocument);
}

/** Ingest a document into a Space. Returns the new document id. */
export async function ingestDocument(
	target: ApiTarget,
	spaceId: string,
	title: string,
	content: string
): Promise<string> {
	const json = await request<{ document_id: string }>(
		target,
		`/api/spaces/${spaceId}/documents`,
		{
			method: "POST",
			body: { title, content },
		}
	);
	return json.document_id;
}

/** Full editable content of a document (Notion-like page). */
export interface SpaceDocumentContent {
	chunkCount: number;
	/** Unix milliseconds. */
	createdAt: number;
	/** Notion-style glyph JSON (GlyphValue), when set. */
	icon: unknown | null;
	id: string;
	/** Canonical markdown source of the page. */
	source: string;
	spaceId: string;
	title: string;
	/** Unix milliseconds. */
	updatedAt: number;
}

interface DocumentContentWire {
	chunk_count: number;
	created_at: number;
	icon?: unknown | null;
	id: string;
	source: string;
	space_id: string;
	title: string;
	updated_at: number;
}

function toDocumentContent(d: DocumentContentWire): SpaceDocumentContent {
	return {
		id: d.id,
		spaceId: d.space_id,
		title: d.title,
		source: d.source,
		createdAt: d.created_at,
		updatedAt: d.updated_at,
		chunkCount: d.chunk_count,
		icon: d.icon ?? null,
	};
}

/** Create a new blank markdown page in a Space. Returns the new document id. */
export async function createPage(
	target: ApiTarget,
	spaceId: string,
	title: string
): Promise<string> {
	const json = await request<{ id: string }>(
		target,
		`/api/spaces/${spaceId}/pages`,
		{ method: "POST", body: { title } }
	);
	return json.id;
}

/** Fetch a single document's full markdown source for editing. */
export async function fetchDocument(
	target: ApiTarget,
	spaceId: string,
	documentId: string
): Promise<SpaceDocumentContent> {
	const json = await request<DocumentContentWire>(
		target,
		`/api/spaces/${spaceId}/documents/${documentId}`
	);
	return toDocumentContent(json);
}

/**
 * Save a document's markdown source. Core re-chunks + re-embeds on save, so this
 * is the persistence + index trigger. Callers should debounce.
 */
export async function updateDocument(
	target: ApiTarget,
	spaceId: string,
	documentId: string,
	title: string,
	source: string
): Promise<void> {
	await request(target, `/api/spaces/${spaceId}/documents/${documentId}`, {
		method: "PUT",
		body: { title, source },
	});
}

/** Delete a single document (page) and its chunks/vectors. */
export async function deleteDocument(
	target: ApiTarget,
	spaceId: string,
	documentId: string
): Promise<boolean> {
	const json = await request<{ removed?: boolean }>(
		target,
		`/api/spaces/${spaceId}/documents/${documentId}`,
		{ method: "DELETE" }
	);
	return json?.removed ?? false;
}

/** Reindex progress reported by Core. */
export interface ReindexStatus {
	currentDims: number;
	currentModel: string;
	pendingChunks: number;
	running: boolean;
	totalChunks: number;
}

interface ReindexStatusWire {
	current_dims: number;
	current_model: string;
	pending_chunks: number;
	running: boolean;
	total_chunks: number;
}

/** Get the current embedding-reindex status (how many chunks are stale). */
export async function fetchReindexStatus(
	target: ApiTarget
): Promise<ReindexStatus> {
	const json = await request<ReindexStatusWire>(
		target,
		"/api/embeddings/reindex/status"
	);
	return {
		currentModel: json.current_model,
		currentDims: json.current_dims,
		totalChunks: json.total_chunks,
		pendingChunks: json.pending_chunks,
		running: json.running,
	};
}

/** Kick off a background reindex of all stale chunks. Returns immediately. */
export async function triggerReindex(target: ApiTarget): Promise<void> {
	await request(target, "/api/embeddings/reindex", { method: "POST" });
}

/** The embedding model Spaces currently uses. */
export interface EmbeddingModel {
	baseUrl: string;
	dims: number;
	modelId: string;
}

interface EmbeddingModelWire {
	base_url: string;
	dims: number;
	model_id: string;
}

/** Read the active embedding model. */
export async function fetchEmbeddingModel(
	target: ApiTarget
): Promise<EmbeddingModel> {
	const json = await request<EmbeddingModelWire>(
		target,
		"/api/embeddings/model"
	);
	return { modelId: json.model_id, baseUrl: json.base_url, dims: json.dims };
}

/**
 * Change the default embedding model. Core persists it and auto-triggers a
 * background reindex of every existing chunk (old vectors live in an
 * incomparable space and must be re-embedded).
 */
export async function setEmbeddingModel(
	target: ApiTarget,
	modelId: string,
	baseUrl?: string,
	dims?: number
): Promise<void> {
	const body: Record<string, unknown> = { model_id: modelId };
	if (baseUrl !== undefined) {
		body.base_url = baseUrl;
	}
	if (dims !== undefined) {
		body.dims = dims;
	}
	await request(target, "/api/embeddings/model", { method: "POST", body });
}

/**
 * Search a single Space, returning ranked chunk matches.
 *
 * **Not necessarily a KNN search** — as this comment used to say. Core's
 * `search_ext` (`crates/core/spaces/src/lib.rs`) reads the Space's stored
 * `retrieval_mode` and branches: `vector` runs a nearest-neighbour search over
 * the `vec0` index, `graph` runs entity-matching plus a BFS traversal of the
 * Space's co-occurrence graph. A graph Space can therefore answer a multi-hop
 * question ("who at Acme is in Paris") that no single nearest-neighbour lookup
 * answers. Anything that describes this call to a user — or to a model, via an
 * MCP tool description — must not promise vector semantics.
 *
 * **The graph branch is bounded, and the bounds are lossy.** It walks at most 3
 * hops and caps each hop's frontier at 512 entities, because the edges are
 * co-occurrence (every pair of entities in a chunk is joined), so an unbounded
 * hop-2 frontier is most of the Space. Core's own doc states that a chunk whose
 * only path runs through a truncated frontier entity stops being reachable, and
 * traversal also stops as soon as `limit` chunks are collected. Graph results
 * are therefore neither a superset of vector results nor exhaustive: never
 * present an empty result as "this Space contains nothing about X".
 *
 * **Both branches are then post-processed**, so the returned chunks are not only
 * the retrieval hits: `[[page]]`-link expansion pulls in chunks from linked
 * documents (fail-open), a tenancy filter drops documents the caller may not
 * read, and a bge cross-encoder reranker re-orders what survives. See
 * {@link SpaceMatch.distance} for what that does to the score field.
 */
export async function searchSpace(
	target: ApiTarget,
	spaceId: string,
	query: string,
	limit?: number
): Promise<SpaceMatch[]> {
	const body: Record<string, unknown> = { query };
	if (limit !== undefined) {
		body.limit = limit;
	}
	const json = await request<{ matches?: MatchWire[] }>(
		target,
		`/api/spaces/${spaceId}/search`,
		{ method: "POST", body }
	);
	return (json.matches ?? []).map(toMatch);
}
