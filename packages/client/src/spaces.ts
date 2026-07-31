// packages/client/src/spaces.ts
//
// SpacesAPI: typed client for Core's Spaces / RAG endpoints (/api/spaces).
// A Space is a named document collection backed by sqlite-vec; documents are
// ingested (chunked + embedded) and searched by whichever retrieval algorithm
// the Space is set to — vector KNN or entity-graph traversal — after which hits
// are link-expanded and neurally reranked. See `SpacesAPI.search`.

import { request } from "./request.ts";
import type { RyuClientOptions, Space, SpaceMatch } from "./types.ts";

// ---------------------------------------------------------------------------
// Wire shapes (snake_case from Core)
// ---------------------------------------------------------------------------

interface SpaceWire {
	created_at: number;
	description?: string | null;
	document_count: number;
	id: string;
	name: string;
	updated_at: number;
}

interface MatchWire {
	chunk_id: string;
	content: string;
	distance: number;
	document_id: string;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function toSpace(s: SpaceWire): Space {
	return {
		id: s.id,
		name: s.name,
		description: s.description ?? null,
		createdAt: s.created_at,
		updatedAt: s.updated_at,
		documentCount: s.document_count,
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

// ---------------------------------------------------------------------------
// API class
// ---------------------------------------------------------------------------

export class SpacesAPI {
	private readonly options: RyuClientOptions;

	constructor(options: RyuClientOptions) {
		this.options = options;
	}

	/** List all Spaces, most-recently-updated first. */
	async list(): Promise<Space[]> {
		const data = await request<{ spaces?: SpaceWire[] }>(
			this.options,
			"/api/spaces"
		);
		return (data.spaces ?? []).map(toSpace);
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
	 * `SpaceMatch.distance` for what that does to the score field.
	 *
	 * This client cannot read or set the mode; it is a per-Space server-side
	 * setting (`POST /api/spaces/:id/retrieval-mode`), so the same call can behave
	 * either way depending on the Space it is pointed at.
	 *
	 * @param id - Space id to search
	 * @param query - Natural language query string
	 * @param limit - Maximum number of chunks to return (default: Core decides)
	 */
	async search(
		id: string,
		query: string,
		limit?: number
	): Promise<SpaceMatch[]> {
		const body: Record<string, unknown> = { query };
		if (limit !== undefined) {
			body.limit = limit;
		}
		const data = await request<{ matches?: MatchWire[] }>(
			this.options,
			`/api/spaces/${id}/search`,
			{
				method: "POST",
				body: JSON.stringify(body),
			}
		);
		return (data.matches ?? []).map(toMatch);
	}
}
