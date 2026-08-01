//! Spaces: named document collections with a sqlite-vec vector store (spec unit U16).
//!
//! A *Space* is a named collection of documents. Each ingested document is split
//! into chunks; every chunk is embedded into a fixed-dimension vector and stored
//! in a [sqlite-vec](https://github.com/asg017/sqlite-vec) `vec0` virtual table so
//! that future retrieval (U17) can run KNN queries over it. The plain `spaces`,
//! `documents`, and `chunks` tables hold the human-readable rows; the `vec0` table
//! holds only the vector, keyed by the chunk rowid.
//!
//! ## GraphRAG retrieval mode (spec unit U046)
//!
//! A Space can carry a `retrieval_mode` of `"vector"` (default) or `"graph"`.
//! When set to `"graph"`, ingestion additionally extracts entities and relations
//! from each chunk and stores them in `graph_nodes` / `graph_edges` tables.
//! `SpaceStore::search` then branches on the mode: vector mode runs the existing
//! KNN query; graph mode runs entity-matching + BFS traversal and returns the
//! grounded chunks reachable from the query's entities.
//!
//! The extraction strategy and model id are registry-configurable via
//! `RYU_GRAPH_EXTRACTION_MODEL` / `registry.json` `graph_extraction_model`. The
//! built-in local extractor is deterministic and offline (co-occurrence of
//! normalized noun-like tokens within a chunk).
//!
//! ## Migration
//!
//! The `retrieval_mode` column and the `graph_nodes`/`graph_edges` tables are added
//! with idempotent DDL (`ALTER TABLE … IF NOT EXISTS` / `CREATE TABLE IF NOT
//! EXISTS`), so existing Spaces databases are upgraded in-place on first open
//! without losing data.
//!
//! Placement rationale (Core vs Gateway, see CLAUDE.md §1): a document collection
//! and its embeddings are part of *what runs* (orchestration / RAG inputs), not
//! *what is allowed/measured/paid*, so Spaces belong in Core. This mirrors the
//! U10 `ConversationStore` shape exactly.
//!
//! Encryption-at-rest direction: when `RYU_SPACES_KEY` is set we issue a
//! `PRAGMA key`. On a stock (non-SQLCipher) SQLite build this pragma is silently
//! ignored, so it compiles and runs cleanly today; flipping rusqlite to
//! `bundled-sqlcipher` later turns it into real at-rest encryption with no code
//! change. We also restrict the db file permissions on Unix. See `apply_encryption`.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use anyhow::{Context, Result};
use rusqlite::{named_params, params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

// Spaces reuse the async `Embedder` from the RAG primitive (Local hashing +
// Remote OpenAI-compatible `/v1/embeddings`). Sharing one embedder type means a
// Space's markdown pages get the same real semantic embeddings (the local
// `llamacpp-embed` nomic server by default) the retrieval store uses, and a
// single swap changes the model everywhere.
use ryu_kernel_contracts::ResourceKey;
use ryu_rag::{Embedder, Reranker};

/// Default embedding dimensionality for the in-memory/test store when the caller
/// does not resolve a model registry. Production stores are opened through the
/// Core-side `spaces` shim, which passes the registry-configured dims — this
/// constant only parameterizes the crate's own test/in-memory constructor and is
/// self-consistent with the `Embedder::Local { dims }` it pairs with, so it never
/// interacts with the Core registry value.
pub const DEFAULT_EMBED_DIMS: usize = 768;

/// Default graph-extraction model id (the offline local co-occurrence extractor)
/// used by the in-memory/test store. Production stores receive the registry value
/// through the Core-side shim.
pub const DEFAULT_GRAPH_EXTRACTION_MODEL: &str = "local-cooccurrence";

/// Owner attribution for a Spaces/documents row — the extracted, apps/core-free
/// twin of Core's `conversations::Tenancy`. It is a plain data record (NOT a
/// parallel enum with `owned_by`-style logic), so it cannot drift from the
/// conversation plane's semantics: `(None, None)` is byte-identical to
/// `Tenancy::Unattributed`, and `Some(user)` is `Tenancy::Owned`. The Core-side
/// `spaces` shim lowers a `Tenancy` into this at the boundary
/// (`spaces::owner_of` / `background_owner` / `caller_owner`), keeping the
/// choke-point contract (a mandatory argument, never an `Option`) intact.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DocOwner {
    /// The owning user id, or `None` for an unattributed row (unbound personal
    /// node, or a write into an already-existing row whose owner is preserved).
    pub user_id: Option<String>,
    /// The owning org id, if any.
    pub org_id: Option<String>,
}

impl DocOwner {
    /// The unattributed owner — byte-identical to `Tenancy::Unattributed`.
    pub fn unattributed() -> Self {
        Self::default()
    }

    /// Attribute to `user_id` (with optional `org_id`) unless it is absent, in
    /// which case the row is unattributed.
    pub fn owned(user_id: Option<&str>, org_id: Option<&str>) -> Self {
        match user_id {
            Some(uid) => Self {
                user_id: Some(uid.to_owned()),
                org_id: org_id.map(str::to_owned),
            },
            None => Self::unattributed(),
        }
    }

    /// The `(owner_user_id, org_id)` column pair this owner writes.
    fn parts(&self) -> (Option<&str>, Option<&str>) {
        (self.user_id.as_deref(), self.org_id.as_deref())
    }

    /// Derive a `DocOwner` from the shared [`ResourceKey`] composition layer. The
    /// key's compound `node`/`project`/`session` fields live at the layer above and
    /// never affect this collapse: a `DocOwner` is exactly the key's
    /// `(owner_user_id, org_id)` pair, byte-identical to [`Self::owned`] fed the
    /// same pair. This is the "constructors accept-or-derive a ResourceKey
    /// internally" seam — the [`upsert_document_row`] / [`upsert_space_row`] choke
    /// points still call [`Self::parts`], unchanged.
    pub fn from_resource_key(key: &ResourceKey) -> Self {
        let (user_id, org_id) = key.to_tenancy_parts();
        Self::owned(user_id, org_id)
    }

    /// Lift this owner into the shared [`ResourceKey`] so a caller can compose the
    /// fuller address (session/project/node) before lowering it back. Round-trips
    /// through the `(user, org)` pair, so it never invents attribution.
    pub fn to_resource_key(&self) -> ResourceKey {
        ResourceKey::from_tenancy_parts(self.user_id.as_deref(), self.org_id.as_deref())
    }
}

/// Access metadata for a document row — the extracted, apps/core-free twin of
/// Core's `identity_verify::ResourceTenancy`. The Core-side `spaces` shim
/// (`spaces::doc_access_meta`) maps this into `ResourceTenancy` so the shared
/// `resource_access` row-gate keeps receiving one type from both the conversation
/// and the Spaces stores.
#[derive(Debug, Clone)]
pub struct DocAccessMeta {
    /// The owning user id, or `None` for an unattributed row.
    pub owner_user_id: Option<String>,
    /// The owning org id, if any.
    pub org_id: Option<String>,
    /// The row's visibility (`NOT NULL DEFAULT 'private'`, so always present).
    pub visibility: String,
    /// The team the row is shared with, if any.
    pub team_id: Option<String>,
}

/// Access metadata for a Space row — the twin of [`DocAccessMeta`] for the
/// `spaces` table, so the Core-side `spaces::space_access_meta` shim can map it
/// into `ResourceTenancy` for the per-resource `resource_access` row-gate (the
/// `delete_space` write gate). Carries `system` so a caller can distinguish a
/// node-singleton system space (`system = 1`, NULL owner) from a user space.
#[derive(Debug, Clone)]
pub struct SpaceAccessMeta {
    /// The owning user id, or `None` for a system / unattributed space.
    pub owner_user_id: Option<String>,
    /// The owning org id, if any.
    pub org_id: Option<String>,
    /// The row's visibility (`NOT NULL DEFAULT 'private'`, so always present).
    pub visibility: String,
    /// The team the row is shared with, if any.
    pub team_id: Option<String>,
    /// Whether this is a Ryu-created system space (Artifacts / Meetings / Canvas /
    /// Clips) — a node singleton with no owner, kept shared to every member.
    pub system: bool,
}

/// Maximum characters per chunk before the ingestion pipeline splits.
///
/// Also the reason entity fan-out per chunk is bounded by a constant: a chunk this
/// size holds ≲ 250 tokens of ≥ 3 characters, so [`extract_entities`] can return at
/// most ~250 entities and [`build_graph_for_chunks`] at most ~62,250 edges for it.
/// That is the worst case; measured on English prose it is **≈57 distinct entities
/// ⇒ ≈3,200 edges per chunk**. Raising this raises the graph's per-chunk cost
/// **quadratically** — and the per-Space cost with it (see the measured table on
/// [`build_graph_for_chunks`]).
const CHUNK_CHAR_SIZE: usize = 1_000;

/// Maximum entities carried from one [`SpaceStore::graph_search`] BFS hop into the
/// next.
///
/// Not a tuning knob so much as the thing that makes the traversal terminate in
/// bounded work: co-occurrence edges join every entity pair within a chunk, so an
/// entity's out-degree grows with the size of the Space, and an unbounded hop-2
/// frontier is "every entity in the Space". 512 is far above what any fixture or
/// realistic query needs to reach its `limit` chunks (the multi-hop fixture walks
/// frontiers of size ≤ 3), and far below the point where a hop's SQL cost is
/// noticeable.
///
/// # Exact semantics, because "a cap" underspecifies three things
///
/// - **Per hop, not cumulative.** `next_frontier` is rebuilt each iteration, so the
///   ceiling on entities expanded by a whole search is `seeds + max_hops × 512`, not
///   512.
/// - **It keeps the lexicographically smallest neighbours**, because the edge query
///   carries `ORDER BY e.dst_entity` (that `ORDER BY` is there for determinism, and
///   this is its second, unadvertised job). Which entities survive is therefore
///   arbitrary with respect to relevance — it is alphabetical.
/// - **It bounds frontier growth only, not the hop's work.** The check sits *after*
///   chunk collection, so a saturated hop still issues one chunk query per frontier
///   entity; what it stops is the *next* hop exploding.
///
/// Retuning this **changes retrieval**, it does not merely change speed: a chunk
/// whose only path runs through a truncated frontier entity stops being reachable —
/// and in a sparse Space it stays unreachable, since nothing rediscovers the dropped
/// entity on a later hop. That is not a theory; it is asserted by
/// `graph_search_frontier_truncation_can_drop_a_reachable_chunk`, which fails (finds
/// the chunk) the moment the cap is lifted. Three tests hold the bound, sized from
/// this constant so changing it cannot leave them vacuous:
/// `graph_search_truncates_an_oversized_frontier` (the branch runs, over stored
/// edges), `graph_search_reaches_a_two_hop_chunk_through_a_truncated_frontier` (a
/// truncated search still returns the grounded chunk), and the lossiness test above.
const MAX_FRONTIER_ENTITIES: usize = 512;

/// **The graph seed floor.** A query entity present in more than this fraction of a
/// Space's chunks does not discriminate between them, so it is not allowed to seed
/// the traversal when a rarer query entity can.
///
/// # Why a floor exists at all
///
/// [`extract_entities`] admits every token ≥ 3 chars that is capitalised **or**
/// longer than 4 — i.e. most words of ordinary prose. Seeding a BFS from all of them
/// makes graph recall approximately "any chunk sharing a long word with the query",
/// and since [`fuse_ranked_lists`](ryu_rag::fuse_ranked_lists) merges by *rank*, that
/// list's first element lands next to the best cosine hit in **every** chat turn for
/// an allowlisted graph Space. Worse, the seed loop stops the moment `limit` chunks
/// are collected, so a Space-wide-common entity that happens to sort first in the
/// query crowds the rare, discriminating one out entirely — the chunk the user was
/// actually asking about is never even visited.
/// `graph_seed_floor_keeps_a_common_word_from_crowding_out_a_rare_one` is that case,
/// and it fails without this floor.
///
/// # Why *this* floor, and what it deliberately does not do
///
/// It is classic inverse-document-frequency pruning, computed from the Space's own
/// `graph_nodes` rows: deterministic, offline, no model, one `COUNT` per query
/// entity. It filters **seeds only** — a common entity reached as a *neighbour* is
/// still expanded, so no multi-hop path is cut. That is what keeps
/// `graphrag_multi_hop_finds_connected_chunk_that_vector_misses` (the only proof the
/// feature works) answering exactly as before.
///
/// The cost of that restraint, stated rather than left to be discovered: this is
/// **not** a filter over the result. When the flooding word and the rare one share a
/// chunk — the normal case, since that is usually why the user typed both — the
/// flooding entity comes back as a hop-1 neighbour and its chunks are collected a hop
/// later. What the floor changes is which chunk is visited *first*, and therefore
/// what occupies rank 0, which is the position the chat path injects.
///
/// Two escape hatches keep it from ever emptying a result set that works today:
///
/// - **Small Spaces are exempt** ([`SEED_FLOOR_MIN_CHUNKS`]): below that many chunks
///   the fraction is noise, not a statistic.
/// - **If every query entity floods, none is dropped.** A single-entity query, and a
///   query made only of Space-wide words, seed exactly as they did before — there is
///   no rarer alternative to prefer, and returning nothing would be strictly worse
///   than returning something weakly grounded.
///
/// 0.5 is a judgement, not a measurement, and is stated as one: an entity in more
/// than half a Space's chunks cannot partition it. Retuning it **changes which
/// chunks a graph query returns**, so it belongs in the same commit as the test
/// above.
const SEED_MAX_CHUNK_FRACTION: f64 = 0.5;

/// Minimum Space size (in chunks) before [`SEED_MAX_CHUNK_FRACTION`] is applied at
/// all. In a three-chunk Space "appears in more than half the chunks" describes two
/// chunks, which says nothing about a term's specificity — so the floor would be
/// filtering on noise. Kept deliberately small: it exists to exempt fixtures and
/// brand-new Spaces, not to disable the floor in practice.
const SEED_FLOOR_MIN_CHUNKS: i64 = 8;

/// Name of the auto-created, hidden Space that backs meeting notes. Kept in sync
/// with `meetings_api::MEETINGS_SPACE_NAME` and the desktop's spaces hide-filter.
/// The danger-zone "delete all spaces" preserves and ignores this Space.
const MEETINGS_SPACE_NAME: &str = "Meetings";

/// Name of the default, undeletable system Space that holds **user**-initiated
/// file uploads (chat attachments, page/editor media, `ui.uploadFile`). Twin of
/// the Artifacts space (agent-created files). Seeded at Core boot; callers resolve
/// it via [`SpaceStore::ensure_system_space`].
pub const UPLOADS_SPACE_NAME: &str = "Uploads";

// ── Per-resource tenancy (twin of conversations.rs) ──────────────────────────
//
// Spaces/documents mirror the conversation plane exactly (`conversations.rs`):
//   - CREATE stamps an owner via the ONE choke point (`upsert_document_row` /
//     `upsert_space_row`), which always emits the tenancy clause, so a future
//     creation path cannot silently forget (the mandatory [`Tenancy`] enum, not an
//     `Option`, is what makes "forgot to stamp" a compile error).
//   - LIST/SEARCH visibility is expressed by ONE SQL predicate below, so the row
//     gate (`server/mod.rs` `resource_access`, via `get_access_meta`) and the list
//     gate can never drift.
//   - a one-shot backfill (`SpaceStore::backfill_tenancy`) attributes pre-ACL
//     NULL rows to the local owner once the node binds — WITHOUT it, the by-id ACL
//     denies every untenanted document on a bound node (a lockout, not a leak).

/// Document visibility filter — the SQL twin of `resource_access` for the
/// `documents` table (alias `d`). Mirrors `conversations.rs::TENANCY_VISIBLE_PREDICATE`:
///   - `:bound = 0` (node UNBOUND / personal): no restriction — one principal, the
///     node token is the boundary. Byte-identical to the pre-ACL behaviour.
///   - node ORG-BOUND: a document is visible iff the caller OWNS it, or it is
///     explicitly shared (`visibility` in `org`/`team`) within the caller's org. An
///     untenanted (NULL-owner) document is INVISIBLE on a bound node — matching the
///     by-id ACL's fail-closed reading of an unattributable legacy row.
const DOC_TENANCY_VISIBLE_PREDICATE: &str = "(
        :bound = 0
        OR (:uid IS NOT NULL AND d.owner_user_id = :uid)
        OR (:uid IS NOT NULL AND :org IS NOT NULL AND d.org_id = :org
            AND d.visibility IN ('org', 'team'))
     )";

/// Space visibility filter — the SQL twin for the `spaces` table (alias `s`).
/// Identical to [`DOC_TENANCY_VISIBLE_PREDICATE`] PLUS `OR s.system = 1`: system
/// spaces (Artifacts / Uploads / Meetings / Canvas / Clips) are node singletons with
/// no owner and MUST stay visible to every member, or the whole node loses them.
const SPACE_TENANCY_VISIBLE_PREDICATE: &str = "(
        s.system = 1
        OR :bound = 0
        OR (:uid IS NOT NULL AND s.owner_user_id = :uid)
        OR (:uid IS NOT NULL AND :org IS NOT NULL AND s.org_id = :org
            AND s.visibility IN ('org', 'team'))
     )";

/// The caller context a tenancy-filtered Spaces query is evaluated against. Cheap
/// `Copy`; construct via [`DocFilter::unrestricted`] (in-process, full-trust) or
/// [`DocFilter::for_caller`] (an HTTP request narrowed to this node's org).
#[derive(Clone, Copy)]
pub struct DocFilter<'a> {
    /// Whether THIS node is bound to an org. Unbound → no filtering at all.
    node_bound: bool,
    /// The verified caller's user id, or `None` for an anonymous caller.
    owner_user_id: Option<&'a str>,
    /// The caller's org (already narrowed to this node's org by identity verify).
    org_id: Option<&'a str>,
}

impl<'a> DocFilter<'a> {
    /// The in-process, full-trust filter: every row on the node (used by internal
    /// callers and by the unbound single-user path).
    pub fn unrestricted() -> Self {
        Self {
            node_bound: false,
            owner_user_id: None,
            org_id: None,
        }
    }

    /// The filter for an HTTP caller. `node_bound = false` collapses to
    /// [`Self::unrestricted`] regardless of the ids, keeping the personal-node path
    /// byte-identical.
    pub fn for_caller(
        owner_user_id: Option<&'a str>,
        org_id: Option<&'a str>,
        node_bound: bool,
    ) -> Self {
        Self {
            node_bound,
            owner_user_id,
            org_id,
        }
    }

    fn bound_flag(&self) -> i64 {
        i64::from(self.node_bound)
    }
}

/// **CHOKE POINT** — the one and only `INSERT INTO documents` in Core.
///
/// Every path that brings a document row into existence (`ingest_document`,
/// `create_document_of_kind` and its `create_page`/`create_database`/
/// `create_whiteboard`/`create_child_page`/`app_create_doc` callers, `create_file`)
/// funnels through here, and this statement ALWAYS emits the tenancy clause. The
/// mandatory [`Tenancy`] argument (no default) is what makes "a new creation path
/// forgot to stamp its owner" a compile error rather than a silent lockout.
///
/// `ON CONFLICT` = COALESCE preserve-never-clobber + first-writer-wins, matching
/// `conversations::upsert_conversation_row`. The caller has already inserted the
/// document's non-tenancy columns in the same statement; this fn owns only the
/// full row insert so the tenancy clause lives in exactly one place.
fn upsert_document_row(
    conn: &Connection,
    document_id: &str,
    space_id: &str,
    title: &str,
    now: i64,
    source: &str,
    kind: &str,
    parent_id: Option<&str>,
    mime: Option<&str>,
    blob_sha256: Option<&str>,
    byte_size: Option<i64>,
    tenancy: &DocOwner,
) -> Result<()> {
    let (owner_user_id, org_id) = tenancy.parts();
    conn.execute(
        "INSERT INTO documents
            (id, space_id, title, created_at, source, updated_at, kind, parent_id,
             mime, blob_sha256, byte_size, owner_user_id, org_id)
         VALUES (:id, :space_id, :title, :now, :source, :now, :kind, :parent_id,
             :mime, :blob_sha256, :byte_size, :owner, :org)
         ON CONFLICT(id) DO UPDATE SET
             owner_user_id = COALESCE(documents.owner_user_id, excluded.owner_user_id),
             org_id        = COALESCE(documents.org_id, excluded.org_id)",
        named_params! {
            ":id": document_id,
            ":space_id": space_id,
            ":title": title,
            ":now": now,
            ":source": source,
            ":kind": kind,
            ":parent_id": parent_id,
            ":mime": mime,
            ":blob_sha256": blob_sha256,
            ":byte_size": byte_size,
            ":owner": owner_user_id,
            ":org": org_id,
        },
    )
    .context("inserting document (choke point)")?;
    Ok(())
}

/// **CHOKE POINT** — the one and only `INSERT INTO spaces` in Core. Twin of
/// [`upsert_document_row`]; a system space passes [`Tenancy::Unattributed`] and sets
/// `system = 1` so the visibility predicate keeps it shared.
fn upsert_space_row(
    conn: &Connection,
    space_id: &str,
    name: &str,
    description: Option<&str>,
    now: i64,
    retrieval_mode: &str,
    system: i64,
    tenancy: &DocOwner,
) -> Result<()> {
    let (owner_user_id, org_id) = tenancy.parts();
    conn.execute(
        "INSERT INTO spaces
            (id, name, description, created_at, updated_at, retrieval_mode, system,
             owner_user_id, org_id)
         VALUES (:id, :name, :description, :now, :now, :mode, :system, :owner, :org)
         ON CONFLICT(id) DO UPDATE SET
             owner_user_id = COALESCE(spaces.owner_user_id, excluded.owner_user_id),
             org_id        = COALESCE(spaces.org_id, excluded.org_id)",
        named_params! {
            ":id": space_id,
            ":name": name,
            ":description": description,
            ":now": now,
            ":mode": retrieval_mode,
            ":system": system,
            ":owner": owner_user_id,
            ":org": org_id,
        },
    )
    .context("inserting space (choke point)")?;
    Ok(())
}

// ── Retrieval mode ─────────────────────────────────────────────────────────────

/// Which retrieval algorithm a Space uses.
///
/// `Vector` is the default and is backward-compatible: it runs the existing
/// KNN cosine-similarity search over the `vec0` virtual table.
///
/// `Graph` additionally builds an entity/relation graph during ingestion and
/// answers queries via BFS traversal instead of (or in addition to) KNN.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum RetrievalMode {
    /// Cosine KNN over the `chunk_vectors` vec0 table (default, unchanged).
    #[default]
    Vector,
    /// Entity/relation graph traversal over the `graph_nodes`/`graph_edges` tables.
    Graph,
}

impl RetrievalMode {
    /// The wire + column spelling. This is the ONE spelling: it is what the
    /// `retrieval_mode` column stores, what `Serialize` emits (the `snake_case`
    /// rename above produces the same two strings), and what [`Self::parse`]
    /// accepts. Keep the three in lockstep — a wire form that does not round-trip
    /// through `parse`/`as_str` silently degrades to `Vector`, which is exactly the
    /// "settable value that cannot take effect" defect this API exists to remove.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Vector => "vector",
            Self::Graph => "graph",
        }
    }

    /// **Strict** parse for values that arrive from a *caller* (HTTP body, env var,
    /// `registry.json`). Returns `None` for an unknown or empty spelling so the
    /// caller can reject it loudly instead of quietly retrieving with the wrong
    /// algorithm. Use this everywhere a human typed the value.
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "vector" => Some(Self::Vector),
            "graph" => Some(Self::Graph),
            _ => None,
        }
    }

    /// **Lenient** parse for values read back out of the `retrieval_mode` column.
    ///
    /// Deliberately different from [`Self::parse`]: a DB row is not a caller. The
    /// column is `NOT NULL DEFAULT 'vector'`, so the only way an unknown spelling
    /// gets there is a hand-edited sqlite file or a downgrade from a future build
    /// that added a third mode. Degrading such a row to `Vector` keeps its Space
    /// searchable; erroring would make every query on it fail. Writes are guarded
    /// by `parse` at the boundary, so this can never mask a live typo.
    fn from_str(s: &str) -> Self {
        match s {
            "graph" => Self::Graph,
            _ => Self::Vector,
        }
    }
}

/// What a [`SpaceStore::set_retrieval_mode`] call actually did.
///
/// Every field exists so the HTTP response can *state the consequence* rather than
/// just returning 200. Switching a populated Space to `Graph` is not a metadata
/// edit: graph extraction is gated on mode inside `insert_chunks`, so a Space that
/// was ingested in `Vector` mode has **no** `graph_nodes`/`graph_edges` rows at all,
/// and flipping only the column would route its searches at an empty graph — a
/// Space that answers nothing. So the switch rebuilds the graph from the chunks
/// already on disk, in the same transaction, and reports what it built.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct RetrievalModeChange {
    /// The mode the Space had before this call.
    pub previous: RetrievalMode,
    /// The mode the Space has now.
    pub mode: RetrievalMode,
    /// Whether `previous != mode`. A no-op re-assert still rebuilds a graph (see
    /// `graph_rebuilt`), because that is the *only* repair path for a Space whose
    /// graph was dropped or never built — there is no incremental "top up the
    /// missing rows" mode, so re-asserting `Graph` is how an operator fixes one.
    ///
    /// This used to read "the cheap repair path", which was wrong in the same way
    /// [`SpaceStore::set_retrieval_mode`]'s doc was before it was measured: a
    /// re-assert is a *full* rebuild and costs exactly what a first build costs
    /// (~16 s on a 1,566-chunk Space, and it was tens of seconds to minutes before
    /// [`graph_row_id`] — see the table on
    /// [`build_graph_for_chunks`]). `changed: false` therefore does **not** mean
    /// "this call did nothing"; it is often the most expensive call the endpoint
    /// makes, and a caller that renders it as a cheap no-op is lying to the user.
    pub changed: bool,
    /// Whether the entity graph was (re)built by this call. True whenever the new
    /// mode is `Graph`; false when switching to `Vector` (which instead *drops* the
    /// now-unmaintained graph rows).
    pub graph_rebuilt: bool,
    /// How many chunks the rebuild walked. `0` when switching to `Vector`.
    pub chunks_scanned: usize,
    /// Entity nodes written by the rebuild.
    pub graph_nodes: usize,
    /// Co-occurrence edges written by the rebuild.
    pub graph_edges: usize,
}

// ── Domain types ───────────────────────────────────────────────────────────────

/// A persisted Space (named document collection).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Space {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    /// Unix milliseconds.
    pub created_at: i64,
    /// Unix milliseconds.
    pub updated_at: i64,
    pub document_count: i64,
    /// Retrieval algorithm for this Space.
    pub retrieval_mode: RetrievalMode,
    /// True for Ryu-owned system Spaces (Artifacts, Meetings) — undeletable and
    /// skipped by the danger-zone bulk clear. Drives the desktop's delete-action
    /// suppression + the "Artifacts" resolver.
    #[serde(default)]
    pub system: bool,
    /// Optional Notion-style glyph (`GlyphValue` JSON from `@ryu/ui`). Null =
    /// use the surface fallback icon.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<serde_json::Value>,
}

/// A document belonging to a Space.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Document {
    pub id: String,
    pub space_id: String,
    pub title: String,
    /// Unix milliseconds.
    pub created_at: i64,
    pub chunk_count: i64,
    /// `"page"` (markdown) or `"database"` (data-grid JSON in `source`).
    pub kind: String,
    /// Parent document id when this is a database "row page"; `None` for
    /// top-level documents.
    pub parent_id: Option<String>,
    /// MIME type for `kind='file'` documents (`None` for page/database/whiteboard).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mime: Option<String>,
    /// Byte size for `kind='file'` documents (`None` otherwise).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub byte_size: Option<i64>,
    /// Optional Notion-style glyph (`GlyphValue` JSON). Null = kind default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<serde_json::Value>,
}

/// A document with its full editable markdown source (Notion-style page).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentContent {
    pub id: String,
    pub space_id: String,
    pub title: String,
    /// The canonical markdown source the editor reads/writes. Chunks are derived
    /// from this on every save.
    pub source: String,
    /// Unix milliseconds.
    pub created_at: i64,
    /// Unix milliseconds.
    pub updated_at: i64,
    pub chunk_count: i64,
    /// `"page"` (markdown) or `"database"` (data-grid JSON in `source`).
    pub kind: String,
    /// Parent document id when this is a database "row page"; `None` otherwise.
    pub parent_id: Option<String>,
    /// Optional Notion-style glyph (`GlyphValue` JSON). Null = kind default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<serde_json::Value>,
}

/// One app-owned document as returned to a full-page Companion app (grant
/// `spaces:docs`). This is the kind-isolated view: an app only ever sees a doc
/// whose `kind == "app:<its plugin id>"`, never another app's or a built-in
/// page/database/whiteboard/file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppDoc {
    pub id: String,
    pub title: String,
    /// The document's raw source (an app's own JSON/text — the app owns the shape).
    pub source: String,
    /// Always `app:<plugin_id>` for a doc an app can see.
    pub kind: String,
}

/// A lightweight listing row for an app's own documents in a Space.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppDocSummary {
    pub id: String,
    pub title: String,
    /// Unix milliseconds.
    pub updated_at: i64,
}

/// Metadata for a binary file document (`kind = 'file'`). The bytes live in the
/// content-addressed blob store keyed by `sha256`; this is the row-level pointer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileMeta {
    pub id: String,
    pub space_id: String,
    pub title: String,
    pub mime: String,
    pub sha256: String,
    pub byte_size: i64,
    /// Unix milliseconds.
    pub created_at: i64,
}

/// Metadata for one saved version of a document (no `source`, so version lists
/// stay light). The full snapshot is fetched per-version via `get_document_version`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentVersionMeta {
    pub id: String,
    pub document_id: String,
    pub title: String,
    /// Optional user-supplied label for a manual snapshot (`None` for auto ones).
    pub label: Option<String>,
    /// `"page"` or `"database"` — the doc kind captured at snapshot time.
    pub kind: String,
    /// Unix milliseconds.
    pub created_at: i64,
}

/// A full saved version of a document, including the captured `source`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentVersion {
    pub id: String,
    pub document_id: String,
    pub title: String,
    pub source: String,
    pub label: Option<String>,
    pub kind: String,
    /// Unix milliseconds.
    pub created_at: i64,
}

/// An inter-document link (wiki `[[Title]]` or mention `[[@Title]]`). Used for the
/// outgoing-links list and, with `src_title`/`snippet` populated, for backlinks.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocLink {
    pub src_doc_id: String,
    /// `None` when the target page does not exist yet (a *pending* link).
    pub dst_doc_id: Option<String>,
    pub dst_title: String,
    /// `"wiki"` or `"mention"`.
    pub kind: String,
    /// Title of the source document (populated for backlinks).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub src_title: Option<String>,
    /// A short context line around the link (populated for backlinks).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snippet: Option<String>,
}

/// A node in the document-link graph. `id` is a document id, or a synthetic
/// `pending:<lowercased-title>` id for a not-yet-created target.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocGraphNode {
    pub id: String,
    pub title: String,
    /// `"page"`, `"database"`, or `"pending"`.
    pub kind: String,
    pub space_id: String,
    pub pending: bool,
}

/// An edge in the document-link graph. `kind` is `"wiki"`, `"mention"`, or
/// `"parent"` (the `parent_id` database→row-page hierarchy).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocGraphEdge {
    pub src: String,
    pub dst: String,
    pub kind: String,
}

/// The document-link graph for a Space (or, globally, across all Spaces).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DocGraph {
    pub nodes: Vec<DocGraphNode>,
    pub edges: Vec<DocGraphEdge>,
}

/// A parsed link occurrence extracted from a document's markdown source.
#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedLink {
    title: String,
    kind: &'static str,
}

/// Current embedding model identity for a Space store.
#[derive(Debug, Clone, Serialize)]
pub struct EmbeddingModelInfo {
    pub model_id: String,
    pub dims: usize,
}

/// Progress/state of a background re-index pass.
#[derive(Debug, Clone, Serialize)]
pub struct ReindexStatus {
    pub current_model: String,
    pub current_dims: usize,
    pub total_chunks: i64,
    /// Chunks whose stored embedding was produced by a different model/dims and
    /// therefore must be re-embedded before they can be matched.
    pub pending_chunks: i64,
    pub running: bool,
    pub errored: Option<String>,
}

/// Preference payload (`embedding-model` key) describing the user's chosen default
/// embedding model. Persisted in the KV preferences store so it survives restarts.
///
/// Building a concrete [`Embedder`] from this preference (the per-space embedder
/// gotcha — a Space picks its own model) is done Core-side by the `spaces` shim
/// (`spaces::embedder_for_pref`), which funnels it through the single RAG resolver
/// so a per-space embedder still follows an embed-provider swap. The struct itself
/// is plain config so the crate never touches the model registry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbeddingModelPref {
    pub model_id: String,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub dims: Option<usize>,
}

/// Preferences KV key for the user-chosen default embedding model.
pub const EMBEDDING_MODEL_PREF_KEY: &str = "embedding-model";

/// A single chunk returned from a similarity search (used by U17 retrieval).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkMatch {
    pub chunk_id: String,
    pub document_id: String,
    pub content: String,
    /// Squared L2 distance from the query vector (smaller is closer).
    /// For graph-mode results this is set to a synthetic value of `0.0`
    /// (exact match via graph traversal — distance is not meaningful).
    pub distance: f32,
}

// ── Embedder ───────────────────────────────────────────────────────────────────
//
// The embedder type lives in the `ryu_rag` crate (imported above). It is an async
// enum with a deterministic `Local` hashing variant (headless/offline default for
// tests) and a `Remote` OpenAI-compatible variant that points at the local
// `llamacpp-embed` nomic server by default. `SpaceStore` holds it behind a Mutex
// so the default embedding model can be swapped at runtime (which triggers a
// background re-index — see `reindex_all`).

// ── Graph entity extraction ────────────────────────────────────────────────────

/// Extract entities from a text chunk using deterministic co-occurrence.
///
/// Strategy: every normalized alphanumeric token of length ≥ 3 that starts with
/// an uppercase letter (or, for the purposes of this local extractor, any token
/// that the heuristic selects as "noun-like") is treated as an entity. The
/// normalization step lowercases and trims so that "Alice" and "alice" map to the
/// same node key, guaranteeing bridge-entity consistency across chunks.
///
/// This is intentionally simple so the spike works offline with no model. A
/// production deployment can swap in an LLM-based extractor by setting
/// `RYU_GRAPH_EXTRACTION_MODEL` to a non-local id and wiring a remote call here.
fn extract_entities(text: &str) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut entities = Vec::new();
    for token in text.split(|c: char| !c.is_alphanumeric()) {
        if token.len() < 3 {
            continue;
        }
        // Heuristic: starts with an uppercase letter OR is longer than 4 chars
        // (catches common nouns that might bridge chunks).
        let first_upper = token.chars().next().is_some_and(|c| c.is_uppercase());
        if first_upper || token.len() > 4 {
            let normalized = token.to_lowercase();
            if seen.insert(normalized.clone()) {
                entities.push(normalized);
            }
        }
    }
    entities
}

/// Drop query entities that are too common in `space_id` to discriminate between
/// its chunks, so [`SpaceStore::graph_search`] seeds from the informative ones.
/// See [`SEED_MAX_CHUNK_FRACTION`] for the policy and its two escape hatches.
///
/// Reads document frequency from `graph_nodes` (one indexed `COUNT` per query
/// entity — queries are a handful of words, so this is a constant-ish cost paid
/// once per search, against the per-entity chunk+edge queries the traversal itself
/// issues).
///
/// Entities with **zero** stored nodes are dropped unconditionally, and that is
/// behaviour-preserving rather than a second policy: [`build_graph_for_chunks`]
/// writes a chunk's nodes and its edges from the same entity set, so an entity with
/// no `graph_nodes` row has no `graph_edges` row either — it can contribute neither
/// a chunk nor a neighbour. It is excluded from the "did everything flood?" test for
/// the same reason: falling back to a word the Space has never seen would answer
/// nothing at all.
fn seed_entities_above_floor(
    conn: &Connection,
    space_id: &str,
    entities: Vec<String>,
) -> Result<Vec<String>> {
    // One entity: there is no rarer alternative to prefer, so the floor could only
    // turn a working query into an empty one. Skips two queries on the common path.
    if entities.len() < 2 {
        return Ok(entities);
    }
    let total_chunks: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM chunks WHERE space_id = ?1",
            params![space_id],
            |row| row.get(0),
        )
        .context("counting space chunks for the graph seed floor")?;
    if total_chunks < SEED_FLOOR_MIN_CHUNKS {
        return Ok(entities);
    }
    let cutoff = total_chunks as f64 * SEED_MAX_CHUNK_FRACTION;

    let mut stmt = conn
        .prepare(
            "SELECT COUNT(DISTINCT chunk_id) FROM graph_nodes
             WHERE space_id = ?1 AND entity = ?2",
        )
        .context("preparing seed-entity document frequency query")?;
    let mut kept = Vec::with_capacity(entities.len());
    for entity in &entities {
        let df: i64 = stmt
            .query_row(params![space_id, entity], |row| row.get(0))
            .context("reading seed-entity document frequency")?;
        if df > 0 && (df as f64) <= cutoff {
            kept.push(entity.clone());
        }
    }
    // Nothing survived: either every entity the Space holds floods it, or the Space
    // holds none of them. Seed exactly as before — returning the original list is
    // "no floor applied" in the first case and inert in the second.
    if kept.is_empty() {
        return Ok(entities);
    }
    Ok(kept)
}

// ── Wiki page-link extraction ───────────────────────────────────────────────────

/// Extract inter-document links from a markdown `source`.
///
/// Three forms are recognized, all emitted by (or accepted into) Ryu's editor so
/// the round-trip is deterministic:
/// - Raw wiki syntax `[[Title]]` / `[[Title|Alias]]` → a **wiki** link, and
///   `[[@Title]]` → a **mention** link (Obsidian-style, e.g. pasted markdown).
/// - The editor's canonical markdown-link serialization `[display](<wikilink:Title>)`
///   → **wiki**, and `[display](<mention:Title>)` → **mention** (angle brackets and
///   percent-encoding both tolerated; the target title is url-decoded).
///
/// The alias / display text is ignored for resolution; only the target title
/// matters. Duplicate (title, kind) pairs within one document are collapsed.
fn extract_doc_links(source: &str) -> Vec<ParsedLink> {
    // Built once per call (called once per document save, never in a hot loop).
    let raw_re = regex::Regex::new(r"\[\[\s*(@)?\s*([^\[\]|]+?)\s*(?:\|[^\[\]]*)?\]\]")
        .expect("static wikilink regex is valid");
    // `[text](<wikilink:Title>)` or `[text](mention:Title)` — angle brackets optional.
    let link_re = regex::Regex::new(r"\]\(\s*<?\s*(wikilink|mention):([^)>]+?)\s*>?\s*\)")
        .expect("static doc-link regex is valid");

    let mut seen: std::collections::HashSet<(String, &'static str)> =
        std::collections::HashSet::new();
    let mut out = Vec::new();
    let mut push = |title: String, kind: &'static str, out: &mut Vec<ParsedLink>| {
        if title.is_empty() {
            return;
        }
        if seen.insert((title.to_lowercase(), kind)) {
            out.push(ParsedLink { title, kind });
        }
    };

    for caps in raw_re.captures_iter(source) {
        let kind = if caps.get(1).is_some() {
            "mention"
        } else {
            "wiki"
        };
        let title = caps.get(2).map(|m| m.as_str().trim().to_string());
        if let Some(title) = title {
            push(title, kind, &mut out);
        }
    }
    for caps in link_re.captures_iter(source) {
        let kind = if &caps[1] == "mention" {
            "mention"
        } else {
            "wiki"
        };
        let raw = caps[2].trim();
        let title = urlencoding::decode(raw)
            .map(|c| c.into_owned())
            .unwrap_or_else(|_| raw.to_string());
        push(title.trim().to_string(), kind, &mut out);
    }
    out
}

/// Return a short one-line snippet of `source` containing `title`, for backlink
/// context. Falls back to the first non-empty line when no direct hit is found.
fn link_snippet(source: &str, title: &str) -> Option<String> {
    let needle = title.to_lowercase();
    for line in source.lines() {
        if line.to_lowercase().contains(&needle) {
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                return Some(truncate_snippet(trimmed));
            }
        }
    }
    source
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .map(truncate_snippet)
}

fn truncate_snippet(line: &str) -> String {
    const MAX: usize = 160;
    if line.chars().count() <= MAX {
        return line.to_string();
    }
    let truncated: String = line.chars().take(MAX).collect();
    format!("{truncated}…")
}

/// Synthetic node id for a pending (not-yet-created) link target, scoped by space
/// so it never collides across Spaces in the global graph.
fn pending_node_id(space_id: &str, title: &str) -> String {
    format!("pending:{space_id}:{}", title.to_lowercase())
}

/// Whether link-expansion retrieval is on by default. Swappable via the
/// `RYU_SPACES_LINK_EXPANSION` env var (set to `0`/`false`/`off` to disable),
/// per the "nothing hardcoded, everything a swappable default" rule.
fn link_expansion_default() -> bool {
    !matches!(
        std::env::var("RYU_SPACES_LINK_EXPANSION").ok().as_deref(),
        Some("0") | Some("false") | Some("off")
    )
}

/// Replace `src_doc_id`'s outgoing document links, parsed from its markdown
/// `source`, resolving each target title to a document id in the same space
/// (case-insensitive, excluding the source itself). Unmatched targets are stored
/// with `dst_doc_id = NULL` (a pending link). Idempotent: existing links for this
/// source are deleted first, so re-saving re-derives the full set.
fn store_doc_links(
    conn: &Connection,
    space_id: &str,
    src_doc_id: &str,
    source: &str,
    now: i64,
) -> Result<()> {
    conn.execute(
        "DELETE FROM document_links WHERE src_doc_id = ?1",
        params![src_doc_id],
    )
    .context("clearing old document links")?;
    for link in extract_doc_links(source) {
        let dst_doc_id: Option<String> = conn
            .query_row(
                "SELECT id FROM documents
                 WHERE space_id = ?1 AND title = ?2 COLLATE NOCASE AND id != ?3
                 LIMIT 1",
                params![space_id, link.title, src_doc_id],
                |row| row.get(0),
            )
            .optional()
            .context("resolving link target")?;
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO document_links
                 (id, space_id, src_doc_id, dst_doc_id, dst_title, link_kind, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, space_id, src_doc_id, dst_doc_id, link.title, link.kind, now],
        )
        .context("inserting document link")?;
    }
    Ok(())
}

/// Back-fill pending links whose target title now matches a document. Called when
/// a document is created or renamed so inbound `[[Title]]` links resolve
/// automatically (Obsidian's pending-page-becomes-real behaviour).
fn reresolve_pending_links(
    conn: &Connection,
    space_id: &str,
    doc_id: &str,
    doc_title: &str,
) -> Result<()> {
    conn.execute(
        "UPDATE document_links SET dst_doc_id = ?1
         WHERE space_id = ?2 AND dst_doc_id IS NULL AND dst_title = ?3 COLLATE NOCASE",
        params![doc_id, space_id, doc_title],
    )
    .context("re-resolving pending links")?;
    Ok(())
}

// ── Insertion-ordered set (used in graph_search BFS) ──────────────────────────
// We use a simple Vec + HashSet pair rather than the `linked-hash-set` crate to
// avoid a new dependency.

/// Insertion-ordered set. `insert` is a no-op for duplicate keys.
struct LinkedHashSet<T> {
    order: Vec<T>,
    seen: std::collections::HashSet<T>,
}

impl<T: std::hash::Hash + Eq + Clone> LinkedHashSet<T> {
    fn new() -> Self {
        Self {
            order: Vec::new(),
            seen: std::collections::HashSet::new(),
        }
    }

    fn insert(&mut self, val: T) -> bool {
        if self.seen.insert(val.clone()) {
            self.order.push(val);
            true
        } else {
            false
        }
    }

    fn len(&self) -> usize {
        self.order.len()
    }

    fn iter(&self) -> std::slice::Iter<'_, T> {
        self.order.iter()
    }
}

// ── SpaceStore ─────────────────────────────────────────────────────────────────

/// SQLite + sqlite-vec backed Space store. Cheap to clone (wraps an
/// `Arc<Mutex<Connection>>` and an `Arc<dyn Embedder>`).
///
/// `embed_dims` is stored separately so `init_schema` can declare the `vec0`
/// virtual table with the correct width without downcasting the embedder trait
/// object. Both must agree: the embedder produces vectors of `embed_dims` length,
/// and the vec0 table is declared with the same value.
#[derive(Clone)]
pub struct SpaceStore {
    conn: Arc<Mutex<Connection>>,
    /// Active embedder. Held behind a Mutex so the default embedding model can be
    /// swapped at runtime; cloned (cheap) for each embed call so the lock is never
    /// held across network I/O.
    embedder: Arc<Mutex<Embedder>>,
    /// Current width of the `chunk_vectors` vec0 table. Equals the active
    /// embedder's dims; updated when a model change recreates the table.
    vec_dims: Arc<AtomicUsize>,
    /// Graph extraction model id (from registry; informational — the local
    /// extractor always runs offline; a remote id here is a future hook).
    graph_extraction_model: String,
    /// Neural reranker for Spaces RAG (the bge cross-encoder served by the
    /// lazily-started `llamacpp-rerank` server). `search` over-fetches candidates
    /// and re-scores them with this before truncating to the requested limit;
    /// reranking fails open to the vector order whenever the server is unreachable.
    reranker: Reranker,
    /// Root of the content-addressed blob store for file-kind documents. Injected
    /// at construction by the Core-side shim (`~/.ryu/blobs`) so the crate never
    /// reads Core's `paths` module; the in-memory/test store uses a temp dir.
    blob_root: PathBuf,
    /// Background re-index coordination (single-run guard + last error).
    reindex: Arc<Mutex<ReindexInner>>,
}

/// Internal re-index run state.
#[derive(Default)]
struct ReindexInner {
    running: bool,
    errored: Option<String>,
}

fn now_millis() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// On-disk path for a blob given its lowercase hex sha256 (`blobs/ab/abcd…`),
/// under the store's injected `blob_root`. Sharded by the first two hex chars of
/// the sha256 so a single directory never holds unbounded entries.
fn blob_path(blob_root: &Path, sha256: &str) -> PathBuf {
    let shard = sha256.get(0..2).unwrap_or("00");
    blob_root.join(shard).join(sha256)
}

/// Lowercase hex sha256 of `bytes`.
fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    let mut out = String::with_capacity(digest.len() * 2);
    for b in digest {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

/// Write `bytes` into the content-addressed blob store under `blob_root` and
/// return its sha256. Content-addressed, so writing identical bytes twice is a
/// no-op (dedupe).
fn write_blob(blob_root: &Path, bytes: &[u8]) -> Result<String> {
    let sha = sha256_hex(bytes);
    let path = blob_path(blob_root, &sha);
    if path.exists() {
        return Ok(sha);
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("creating blob dir {}", parent.display()))?;
    }
    // Write to a temp sibling then rename so a reader never sees a partial blob.
    let tmp = path.with_extension("part");
    std::fs::write(&tmp, bytes).with_context(|| format!("writing blob {sha}"))?;
    std::fs::rename(&tmp, &path).with_context(|| format!("finalizing blob {sha}"))?;
    Ok(sha)
}

/// Read a blob's bytes back by its sha256 under `blob_root`. Returns `Ok(None)`
/// when absent.
fn read_blob(blob_root: &Path, sha256: &str) -> Result<Option<Vec<u8>>> {
    let path = blob_path(blob_root, sha256);
    match std::fs::read(&path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e).with_context(|| format!("reading blob {sha256}")),
    }
}

impl SpaceStore {
    /// Open (or create) the store at `path` with a fully-resolved embedder,
    /// reranker, graph-extraction model, blob root, and one-shot backfill owner.
    ///
    /// This is the crate's single real constructor: every model/provider/path
    /// choice is resolved Core-side (the `spaces` shim: registry-configured
    /// embedder via the single RAG resolver, `~/.ryu` paths, and the injected
    /// backfill owner) and passed in, so the crate has ZERO dependency on
    /// apps/core. `embed_dims` must equal the output length of
    /// `embedder.embed(...)`; a mismatch causes vec0 insert failures.
    #[allow(clippy::too_many_arguments)]
    pub fn open_at(
        path: PathBuf,
        embedder: Embedder,
        embed_dims: usize,
        graph_extraction_model: String,
        reranker: Reranker,
        blob_root: PathBuf,
        backfill_owner: Option<(String, String)>,
    ) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("creating db dir {}", parent.display()))?;
        }
        let conn = open_vec_connection(&path)?;
        apply_encryption(&conn, Some(&path))?;
        Self::init_schema(&conn, embed_dims)?;
        // One-shot tenancy backfill for spaces/documents that pre-date the ACL.
        // Deliberately NOT in `init_schema` (the in-memory test store runs that and
        // must never read the real account vault) and best-effort: a failure here
        // must never stop the node from opening its Spaces db.
        if let Err(e) = Self::backfill_tenancy(&conn, backfill_owner) {
            tracing::warn!("spaces tenancy backfill skipped: {e:#}");
        }
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            embedder: Arc::new(Mutex::new(embedder)),
            vec_dims: Arc::new(AtomicUsize::new(embed_dims)),
            graph_extraction_model,
            reranker,
            blob_root,
            reindex: Arc::new(Mutex::new(ReindexInner::default())),
        })
    }

    /// Open an in-memory store using the crate default dims (used by tests and by
    /// Core's own in-memory test constructors). A plain `pub fn` — NOT
    /// `#[cfg(test)]` — because it is called from apps/core test code across the
    /// crate boundary, where this crate is compiled without `--cfg test`. Uses a
    /// per-store temp blob root so file-document tests never touch `~/.ryu`.
    pub fn open_in_memory() -> Result<Self> {
        let dims = DEFAULT_EMBED_DIMS;
        let conn = open_vec_connection(std::path::Path::new(":memory:"))?;
        Self::init_schema(&conn, dims)?;
        let blob_root =
            std::env::temp_dir().join(format!("ryu-spaces-mem-{}", uuid::Uuid::new_v4()));
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            embedder: Arc::new(Mutex::new(Embedder::Local { dims })),
            vec_dims: Arc::new(AtomicUsize::new(dims)),
            graph_extraction_model: DEFAULT_GRAPH_EXTRACTION_MODEL.to_owned(),
            // Test helper: the local (server-backed, fail-open) reranker needs no
            // registry — mirrors `Embedder::Local` above.
            reranker: Reranker::Local,
            blob_root,
            reindex: Arc::new(Mutex::new(ReindexInner::default())),
        })
    }

    /// Snapshot the active embedder (cheap clone) so embedding I/O happens without
    /// holding the embedder lock.
    async fn embedder_snapshot(&self) -> Embedder {
        self.embedder.lock().await.clone()
    }

    /// Current embedding model id + dims.
    pub async fn embedding_model(&self) -> EmbeddingModelInfo {
        let emb = self.embedder.lock().await;
        EmbeddingModelInfo {
            model_id: emb.model_id().to_string(),
            dims: emb.dims(),
        }
    }

    fn init_schema(conn: &Connection, embed_dims: usize) -> Result<()> {
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;
             CREATE TABLE IF NOT EXISTS spaces (
                 id             TEXT PRIMARY KEY,
                 name           TEXT NOT NULL,
                 description    TEXT,
                 created_at     INTEGER NOT NULL,
                 updated_at     INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS documents (
                 id          TEXT PRIMARY KEY,
                 space_id    TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
                 title       TEXT NOT NULL,
                 created_at  INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_documents_space
                 ON documents(space_id, created_at);
             CREATE TABLE IF NOT EXISTS chunks (
                 id          TEXT PRIMARY KEY,
                 document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                 space_id    TEXT NOT NULL,
                 ordinal     INTEGER NOT NULL,
                 content     TEXT NOT NULL,
                 created_at  INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_chunks_document
                 ON chunks(document_id, ordinal);
             CREATE TABLE IF NOT EXISTS graph_nodes (
                 id          TEXT PRIMARY KEY,
                 space_id    TEXT NOT NULL,
                 entity      TEXT NOT NULL,
                 chunk_id    TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE
             );
             CREATE INDEX IF NOT EXISTS idx_graph_nodes_space_entity
                 ON graph_nodes(space_id, entity);
             CREATE INDEX IF NOT EXISTS idx_graph_nodes_chunk
                 ON graph_nodes(chunk_id);
             CREATE TABLE IF NOT EXISTS graph_edges (
                 id          TEXT PRIMARY KEY,
                 space_id    TEXT NOT NULL,
                 src_entity  TEXT NOT NULL,
                 dst_entity  TEXT NOT NULL,
                 chunk_id    TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE
             );
             CREATE INDEX IF NOT EXISTS idx_graph_edges_space_src
                 ON graph_edges(space_id, src_entity);
             CREATE INDEX IF NOT EXISTS idx_graph_edges_space_dst
                 ON graph_edges(space_id, dst_entity);",
        )
        .context("initializing spaces schema")?;

        // vec0 virtual table holds only the vector, keyed by the chunk's rowid.
        // Declared with the embedder's configured dims so inserts and queries are
        // always consistent.
        conn.execute_batch(&format!(
            "CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vectors
                 USING vec0(rowid INTEGER PRIMARY KEY, embedding float[{embed_dims}]);"
        ))
        .context("initializing vec0 virtual table")?;

        // Idempotent migration: add retrieval_mode column to spaces if absent.
        // ALTER TABLE … ADD COLUMN fails with "duplicate column name" on SQLite
        // when the column already exists, so we swallow that specific error.
        let _ = conn.execute_batch(
            "ALTER TABLE spaces ADD COLUMN retrieval_mode TEXT NOT NULL DEFAULT 'vector';",
        );

        // Idempotent migrations for editable markdown pages (Notion-style docs):
        // the full markdown `source` + an `updated_at` on documents, and the
        // embedder identity on each chunk so a model change can mark stale vectors.
        let _ =
            conn.execute_batch("ALTER TABLE documents ADD COLUMN source TEXT NOT NULL DEFAULT '';");
        let _ = conn.execute_batch(
            "ALTER TABLE documents ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;",
        );
        let _ = conn
            .execute_batch("ALTER TABLE chunks ADD COLUMN embed_model TEXT NOT NULL DEFAULT '';");
        let _ = conn
            .execute_batch("ALTER TABLE chunks ADD COLUMN embed_dims INTEGER NOT NULL DEFAULT 0;");

        // Idempotent migration: documents can be a Notion-style markdown "page"
        // (default) or a "database" (an editable data grid persisted as JSON in
        // `source`). The `kind` discriminates which editor opens it; embedding
        // treats a database's flattened text so it stays searchable like a page.
        let _ = conn
            .execute_batch("ALTER TABLE documents ADD COLUMN kind TEXT NOT NULL DEFAULT 'page';");

        // Idempotent migration: the built-in whiteboard editor was ported to the
        // Whiteboard Ryu App, which OWNS its documents under `kind = app:<plugin_id>`
        // (so the app's sandboxed frame can load/save them via `spaces:docs`). Re-key
        // every legacy `kind='whiteboard'` document to the app's kind so existing
        // boards open in the app instead of the removed built-in renderer. Naturally
        // idempotent: after the first run no rows match, so re-running each startup is
        // a no-op. `flatten_app_source` handles the reflattened text on next re-embed.
        let _ = conn.execute_batch(
            "UPDATE documents SET kind = 'app:@ryu/whiteboard' WHERE kind = 'whiteboard';",
        );

        // Idempotent migration: a document may belong to a parent document — used by
        // database "row pages" (a row's body is a child `kind='page'` doc whose
        // `parent_id` is the database). Top-level listings filter `parent_id IS NULL`
        // so row-body pages never show as loose documents; deleting the parent
        // cascades to children (handled explicitly in `delete_document`).
        let _ = conn.execute_batch("ALTER TABLE documents ADD COLUMN parent_id TEXT;");
        let _ = conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_documents_parent ON documents(parent_id, created_at);",
        );

        // Wiki page-link graph (Obsidian/Notion-style backlinks + graph view).
        // A `document_links` row records that `src_doc_id` links to a target. When
        // the target title matches an existing document in the same space,
        // `dst_doc_id` is set; otherwise it is NULL — a *pending* link to a page
        // that does not exist yet (created on click). This is distinct from the
        // chunk-level `graph_nodes`/`graph_edges` entity graph: this graph is
        // document-to-document and drives backlinks, the graph view, and
        // link-expansion in retrieval. `link_kind` is `'wiki'` (`[[Title]]`) or
        // `'mention'` (`[[@Title]]`). Titles are matched case-insensitively.
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS document_links (
                 id          TEXT PRIMARY KEY,
                 space_id    TEXT NOT NULL,
                 src_doc_id  TEXT NOT NULL,
                 dst_doc_id  TEXT,
                 dst_title   TEXT NOT NULL,
                 link_kind   TEXT NOT NULL DEFAULT 'wiki',
                 created_at  INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_document_links_src
                 ON document_links(space_id, src_doc_id);
             CREATE INDEX IF NOT EXISTS idx_document_links_dst
                 ON document_links(space_id, dst_doc_id);
             CREATE INDEX IF NOT EXISTS idx_document_links_title
                 ON document_links(space_id, dst_title COLLATE NOCASE);",
        )
        .context("initializing document_links schema")?;

        // Page version history (Notion/Prompt-Studio-style snapshots). Each row is
        // an immutable full copy of a document's `title` + `source` at snapshot
        // time. Versions are created manually ("Save version") or captured
        // automatically just before a restore so a restore is itself undoable.
        // Rows are FK-less plain-text ids (like `document_links`); `delete_document`
        // removes them explicitly. Oldest rows past a per-document cap are pruned.
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS document_versions (
                 id          TEXT PRIMARY KEY,
                 document_id TEXT NOT NULL,
                 space_id    TEXT NOT NULL,
                 title       TEXT NOT NULL,
                 source      TEXT NOT NULL,
                 label       TEXT,
                 kind        TEXT NOT NULL DEFAULT 'page',
                 created_at  INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_document_versions_doc
                 ON document_versions(document_id, created_at DESC);",
        )
        .context("initializing document_versions schema")?;

        // Multi-user tenancy (collaboration epic, Phase 0): the verified human
        // owner of the document, the org it belongs to, its sharing visibility,
        // and an optional owning team. Guarded by a PRAGMA table_info existence
        // check (mirroring the conversations migration) so each ALTER is a no-op
        // when the column already exists and a real error surfaces otherwise.
        // ACL enforcement is wired in a later stage; schema-only for now.
        let existing_doc_columns: std::collections::HashSet<String> = {
            let mut stmt = conn.prepare("PRAGMA table_info(documents)")?;
            let names = stmt.query_map([], |row| row.get::<_, String>(1))?;
            names.filter_map(|r| r.ok()).collect()
        };
        for (col, ddl) in [
            (
                "owner_user_id",
                "ALTER TABLE documents ADD COLUMN owner_user_id TEXT",
            ),
            ("org_id", "ALTER TABLE documents ADD COLUMN org_id TEXT"),
            (
                "visibility",
                "ALTER TABLE documents ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'",
            ),
            ("team_id", "ALTER TABLE documents ADD COLUMN team_id TEXT"),
        ] {
            if !existing_doc_columns.contains(col) {
                conn.execute_batch(ddl)
                    .with_context(|| format!("adding column {col} to documents"))?;
            }
        }

        // Idempotent migration: binary "file" documents (kind = 'file'). Unlike
        // page/database/whiteboard docs, a file's bytes live in the content-
        // addressed blob store (`~/.ryu/blobs/<sha256>`), not in `source`. These
        // columns carry the pointer + metadata; `source` holds a short text
        // descriptor (title + mime) so the file stays findable in RAG. Additive
        // columns only, so existing dbs upgrade in place.
        let _ = conn.execute_batch("ALTER TABLE documents ADD COLUMN mime TEXT;");
        let _ = conn.execute_batch("ALTER TABLE documents ADD COLUMN blob_sha256 TEXT;");
        let _ = conn.execute_batch("ALTER TABLE documents ADD COLUMN byte_size INTEGER;");

        // Idempotent migration: system Spaces. A system Space (e.g. the default
        // "Artifacts" and "Meetings" spaces) is created by Ryu itself, cannot be
        // deleted individually, and is skipped by the danger-zone bulk clear. This
        // generalizes the old name-matched "Meetings" special-case into a flag.
        let _ =
            conn.execute_batch("ALTER TABLE spaces ADD COLUMN system INTEGER NOT NULL DEFAULT 0;");

        // Notion-style entity glyphs (GlyphValue JSON from the shared GlyphPicker).
        let _ = conn.execute_batch("ALTER TABLE spaces ADD COLUMN icon TEXT;");
        let _ = conn.execute_batch("ALTER TABLE documents ADD COLUMN icon TEXT;");

        // Multi-user tenancy for SPACES (collaboration epic). `documents` already
        // carries this quartet (above); spaces did not. Guarded by a PRAGMA
        // table_info existence check (mirroring the documents block) so each ALTER
        // is a no-op when the column already exists and a real error surfaces
        // otherwise. Enforcement is the visibility predicate + the choke point +
        // the backfill; system spaces (`system = 1`) stay shared regardless.
        let existing_space_columns: std::collections::HashSet<String> = {
            let mut stmt = conn.prepare("PRAGMA table_info(spaces)")?;
            let names = stmt.query_map([], |row| row.get::<_, String>(1))?;
            names.filter_map(|r| r.ok()).collect()
        };
        for (col, ddl) in [
            (
                "owner_user_id",
                "ALTER TABLE spaces ADD COLUMN owner_user_id TEXT",
            ),
            ("org_id", "ALTER TABLE spaces ADD COLUMN org_id TEXT"),
            (
                "visibility",
                "ALTER TABLE spaces ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'",
            ),
            ("team_id", "ALTER TABLE spaces ADD COLUMN team_id TEXT"),
        ] {
            if !existing_space_columns.contains(col) {
                conn.execute_batch(ddl)
                    .with_context(|| format!("adding column {col} to spaces"))?;
            }
        }

        Ok(())
    }

    /// Decide, once, what a pre-existing NULL-tenancy space/document row MEANS —
    /// the exact twin of `ConversationStore::backfill_tenancy`.
    ///
    /// Before the per-resource ACL was populated, every space/document was created
    /// with `owner_user_id`/`org_id` NULL. On an org-bound node the by-id ACL
    /// (`resource_access`) reads an untenanted row as unattributable → DENIED to
    /// EVERYONE, including the owner (a lockout). This attributes those rows to the
    /// local owner so the owner keeps reaching their own data.
    ///
    ///   - **Node UNBOUND**: return immediately, stamp nothing (one principal; the
    ///     node token is the boundary). The marker is NOT written, so this reruns
    ///     if the node later joins an org.
    ///   - **Node ORG-BOUND**: attribute every untenanted, NON-system space +
    ///     document to the LOCAL OWNER (the signed-in vault account). System spaces
    ///     (`system = 1`) are SKIPPED — they must stay shared, and the predicate's
    ///     `OR s.system = 1` branch already keeps them (and their documents, via the
    ///     document backfill leaving system-space docs owned by whoever created
    ///     them) reachable. Idempotent via a `space_meta` marker.
    ///   - **Node ORG-BOUND with no local account**: nobody to attribute to; leave
    ///     NULL + warn. Fail closed (the ACL denies them).
    ///
    /// The owner is INJECTED by the Core-side `spaces` shim
    /// (`spaces::open_default` resolves it from `control_plane` + the account
    /// vault) so the crate never reads Core's identity plane: `None` = an unbound
    /// personal node (rows stay untenanted, by design), `Some((user, org))` = an
    /// org-bound node with a signed-in account.
    fn backfill_tenancy(conn: &Connection, owner: Option<(String, String)>) -> Result<()> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS space_meta (key TEXT PRIMARY KEY, value TEXT)",
        )
        .context("creating space_meta")?;
        let done: Option<String> = conn
            .query_row(
                "SELECT value FROM space_meta WHERE key = 'tenancy_backfill_v1'",
                [],
                |r| r.get(0),
            )
            .optional()?;
        if done.is_some() {
            return Ok(());
        }

        // Unbound (personal) node, or org-bound node with no signed-in local
        // account: rows stay untenanted (fail closed — the ACL denies them until
        // an owner signs in and restarts). Not marked done, so a later bind can
        // still claim them.
        let Some((owner, org_id)) = owner else {
            return Ok(());
        };

        // Documents: attribute every untenanted document (system-space docs
        // included — they belong to whoever created them, not "shared").
        let docs = conn
            .execute(
                "UPDATE documents SET owner_user_id = ?1, org_id = ?2
                 WHERE owner_user_id IS NULL AND org_id IS NULL",
                params![owner, org_id],
            )
            .context("backfilling document tenancy")?;
        // Spaces: attribute every untenanted NON-system space; system spaces stay
        // shared via the predicate's `OR s.system = 1`.
        let spaces = conn
            .execute(
                "UPDATE spaces SET owner_user_id = ?1, org_id = ?2
                 WHERE owner_user_id IS NULL AND org_id IS NULL AND system = 0",
                params![owner, org_id],
            )
            .context("backfilling space tenancy")?;
        conn.execute(
            "INSERT OR REPLACE INTO space_meta (key, value) VALUES ('tenancy_backfill_v1', ?1)",
            params![owner],
        )?;
        tracing::info!(
            "spaces tenancy backfill: attributed {docs} document(s) + {spaces} space(s) to the local owner"
        );
        Ok(())
    }

    /// Create a new Space and return its id, hard-defaulting `retrieval_mode` to
    /// `"vector"`.
    ///
    /// This is the *literal* default (`DEFAULT_RAG_STRATEGY`'s twin), not the
    /// operator-configurable one. The node-wide default from `registry.json` /
    /// `RYU_RAG_STRATEGY` is applied one layer up, at the HTTP creator
    /// (`server::create_space` → `ModelRegistry::resolve_rag_strategy`), because
    /// this crate deliberately has no dependency on Core's model registry. In-crate
    /// and system-space callers (`ensure_system_space`) intentionally stay on the
    /// literal `Vector`: an Artifacts/Clips/Uploads singleton is a filing drawer,
    /// not a knowledge base, and flipping it to graph on an operator's global knob
    /// would change retrieval for surfaces that never asked for it.
    ///
    /// Use [`Self::create_space_with_mode`] to opt a Space into graph retrieval, or
    /// [`Self::set_retrieval_mode`] to change one after the fact.
    pub async fn create_space(
        &self,
        name: &str,
        description: Option<&str>,
        tenancy: &DocOwner,
    ) -> Result<String> {
        self.create_space_with_mode(name, description, RetrievalMode::Vector, tenancy)
            .await
    }

    /// Create a new Space with an explicit retrieval mode, owned by `tenancy`.
    pub async fn create_space_with_mode(
        &self,
        name: &str,
        description: Option<&str>,
        mode: RetrievalMode,
        tenancy: &DocOwner,
    ) -> Result<String> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_millis();
        let conn = self.conn.lock().await;
        upsert_space_row(
            &conn,
            &id,
            name,
            description,
            now,
            mode.as_str(),
            0,
            tenancy,
        )?;
        Ok(id)
    }

    /// List the Spaces the caller may READ, most-recently-updated first, with
    /// document counts. The `filter` is the SQL twin of `resource_access`
    /// ([`SPACE_TENANCY_VISIBLE_PREDICATE`]); pass [`DocFilter::unrestricted`] for
    /// the in-process / unbound-node full-trust listing.
    pub async fn list_spaces(&self, filter: DocFilter<'_>) -> Result<Vec<Space>> {
        let conn = self.conn.lock().await;
        let sql = format!(
            "SELECT s.id, s.name, s.description, s.created_at, s.updated_at,
                    (SELECT COUNT(*) FROM documents d
                        WHERE d.space_id = s.id AND d.parent_id IS NULL),
                    s.retrieval_mode, s.system, s.icon
             FROM spaces s
             WHERE {SPACE_TENANCY_VISIBLE_PREDICATE}
             ORDER BY s.updated_at DESC"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(
            named_params! {
                ":bound": filter.bound_flag(),
                ":uid": filter.owner_user_id,
                ":org": filter.org_id,
            },
            |row| {
                let mode_str: String = row.get(6)?;
                let icon_raw: Option<String> = row.get(8)?;
                Ok(Space {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                    document_count: row.get(5)?,
                    retrieval_mode: RetrievalMode::from_str(&mode_str),
                    system: row.get(7)?,
                    icon: icon_raw.and_then(|s| serde_json::from_str(&s).ok()),
                })
            },
        )?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    /// List the documents in a Space the caller may READ, with chunk counts. The
    /// `filter` applies [`DOC_TENANCY_VISIBLE_PREDICATE`] so a member holding only
    /// coarse `space.read` never sees another member's private document metadata;
    /// pass [`DocFilter::unrestricted`] for the in-process / unbound full listing.
    pub async fn list_documents(
        &self,
        space_id: &str,
        filter: DocFilter<'_>,
    ) -> Result<Vec<Document>> {
        let conn = self.conn.lock().await;
        let sql = format!(
            "SELECT d.id, d.space_id, d.title, d.created_at,
                    (SELECT COUNT(*) FROM chunks c WHERE c.document_id = d.id),
                    d.kind, d.parent_id, d.mime, d.byte_size, d.icon
             FROM documents d
             WHERE d.space_id = :space_id AND d.parent_id IS NULL
               AND {DOC_TENANCY_VISIBLE_PREDICATE}
             ORDER BY d.created_at ASC"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(
            named_params! {
                ":space_id": space_id,
                ":bound": filter.bound_flag(),
                ":uid": filter.owner_user_id,
                ":org": filter.org_id,
            },
            |row| {
                let icon_raw: Option<String> = row.get(9)?;
                Ok(Document {
                    id: row.get(0)?,
                    space_id: row.get(1)?,
                    title: row.get(2)?,
                    created_at: row.get(3)?,
                    chunk_count: row.get(4)?,
                    kind: row.get(5)?,
                    parent_id: row.get(6)?,
                    mime: row.get(7)?,
                    byte_size: row.get(8)?,
                    icon: icon_raw.and_then(|s| serde_json::from_str(&s).ok()),
                })
            },
        )?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    /// Ingest a document into a Space: chunk the text, embed each chunk, and store
    /// the rows plus their vectors. In graph mode also extracts entities/relations.
    /// Returns the new document id. Errors if the Space does not exist.
    ///
    /// # Why the write half runs on `spawn_blocking`
    ///
    /// In **graph** mode this transaction reaches [`build_graph_for_chunks`], whose
    /// cost is `O(chunks × entities²)`: measured on English prose, ≈57 distinct
    /// entities per ~990-char chunk ⇒ ≈3,200 edge INSERTs **per chunk**, and ~20–55
    /// ms per chunk on an on-disk db (see the table on [`build_graph_for_chunks`]).
    /// A large upload is therefore seconds-to-minutes of uninterruptible SQLite
    /// work, and it used to run inline on the tokio worker that polled this future —
    /// the same defect that [`Self::set_retrieval_mode`] was moved off the worker
    /// for, differing only in that the input is one document rather than a whole
    /// Space. "One document" is not a bound: a single uploaded book is one document.
    /// `graph_ingest_does_not_occupy_the_async_worker` is the regression guard, and
    /// it counted 0 scheduler ticks against the inline shape.
    ///
    /// Be precise about what moving it does and does not buy — the same three points
    /// as [`Self::set_retrieval_mode`], because it is the same connection and the
    /// same one-transaction guarantee:
    ///
    /// - **Fixed:** no runtime worker is parked for the duration. Embedding still
    ///   happens *before* the lock (it may do network I/O), so only the SQL runs on
    ///   the blocking pool.
    /// - **NOT fixed:** the connection mutex is held for the whole transaction, so
    ///   every other `SpaceStore` call — including every *other* Space — still
    ///   queues behind it. Moving the work changes *who* waits, not *whether*.
    /// - **Behaviour change, stated rather than discovered:** the write is now
    ///   detached from the caller's future. Dropping that future (client disconnect,
    ///   request timeout) after the blocking task is spawned no longer even
    ///   *appears* to abandon the ingest — it runs to completion and **commits**,
    ///   and the caller never learns the new id. Inline, the same commit happened
    ///   (the body had no await point, so it could not be interrupted either), so
    ///   nothing became less cancellable; what changed is that the result can now be
    ///   dropped on the floor. A panic inside the body likewise surfaces as
    ///   `Err(… task panicked)` instead of unwinding into the caller's task.
    pub async fn ingest_document(
        &self,
        space_id: &str,
        title: &str,
        content: &str,
        tenancy: &DocOwner,
    ) -> Result<String> {
        let chunks = chunk_text(content);
        // Embed outside the lock — the embedder may do network I/O.
        let emb = self.embedder_snapshot().await;
        let model_id = emb.model_id().to_string();
        let dims = emb.dims();
        let mut embedded: Vec<(String, Vec<f32>)> = Vec::with_capacity(chunks.len());
        for chunk in &chunks {
            embedded.push((chunk.clone(), emb.embed(chunk).await?));
        }

        let document_id = uuid::Uuid::new_v4().to_string();
        let now = now_millis();
        // `spawn_blocking` demands `'static`, so the borrowed arguments are cloned
        // and the guard is taken as an *owned* one. Acquiring the lock HERE rather
        // than inside the closure keeps the wait asynchronous: callers queue on the
        // tokio mutex instead of occupying a blocking-pool thread while they wait.
        let space_id = space_id.to_owned();
        let title = title.to_owned();
        let content = content.to_owned();
        let tenancy = tenancy.clone();
        let guard = self.conn.clone().lock_owned().await;
        tokio::task::spawn_blocking(move || {
            Self::ingest_document_blocking(
                guard,
                &document_id,
                &space_id,
                &title,
                &content,
                now,
                &model_id,
                dims,
                &embedded,
                &tenancy,
            )
        })
        .await
        .context("document ingest task panicked")?
    }

    /// The blocking body of [`SpaceStore::ingest_document`]. Split out only so the
    /// `spawn_blocking` closure stays a one-liner; all the reasoning about *why* it
    /// is shaped this way lives on the public method.
    ///
    /// Takes the guard **by value** so the connection is released exactly when the
    /// transaction ends, on the blocking thread, whether it commits or unwinds.
    #[allow(clippy::too_many_arguments)]
    fn ingest_document_blocking(
        mut guard: tokio::sync::OwnedMutexGuard<Connection>,
        document_id: &str,
        space_id: &str,
        title: &str,
        content: &str,
        now: i64,
        model_id: &str,
        dims: usize,
        embedded: &[(String, Vec<f32>)],
        tenancy: &DocOwner,
    ) -> Result<String> {
        let conn = &mut *guard;
        let tx = conn.transaction().context("starting ingest transaction")?;

        // Verify the Space exists and read its retrieval mode.
        let mode_str: Option<String> = tx
            .query_row(
                "SELECT retrieval_mode FROM spaces WHERE id = ?1",
                params![space_id],
                |row| row.get(0),
            )
            .optional()
            .context("querying space retrieval_mode")?;
        let mode_str = mode_str.ok_or_else(|| anyhow::anyhow!("space '{space_id}' not found"))?;
        let mode = RetrievalMode::from_str(&mode_str);

        upsert_document_row(
            &tx,
            document_id,
            space_id,
            title,
            now,
            content,
            "page",
            None,
            None,
            None,
            None,
            tenancy,
        )?;

        insert_chunks(
            &tx,
            document_id,
            space_id,
            embedded,
            now,
            model_id,
            dims,
            mode,
        )?;

        tx.execute(
            "UPDATE spaces SET updated_at = ?1 WHERE id = ?2",
            params![now, space_id],
        )
        .context("bumping space updated_at")?;

        // Wiki page-links: store this document's outgoing links, and resolve any
        // pending inbound links now that this title exists.
        store_doc_links(&tx, space_id, document_id, content, now)?;
        reresolve_pending_links(&tx, space_id, document_id, title)?;

        tx.commit().context("committing ingest transaction")?;
        Ok(document_id.to_owned())
    }

    /// Create an empty Notion-style page (document with no content yet) in a Space.
    /// Returns the new document id. The editor fills it in via `update_document`,
    /// which is what produces chunks + embeddings.
    pub async fn create_page(
        &self,
        space_id: &str,
        title: &str,
        tenancy: &DocOwner,
    ) -> Result<String> {
        self.create_document_of_kind(space_id, title, "page", None, tenancy)
            .await
    }

    /// Create an empty page whose `parent_id` is `parent` — a database "row page".
    /// It embeds like any page but is hidden from top-level document listings.
    pub async fn create_child_page(
        &self,
        space_id: &str,
        title: &str,
        parent: &str,
        tenancy: &DocOwner,
    ) -> Result<String> {
        self.create_document_of_kind(space_id, title, "page", Some(parent), tenancy)
            .await
    }

    /// Create an empty database (data-grid) document in a Space. Same lifecycle as
    /// a page — the editor fills its grid JSON in via `update_document`, which
    /// chunks + embeds the flattened cell text so the database stays searchable.
    pub async fn create_database(
        &self,
        space_id: &str,
        title: &str,
        tenancy: &DocOwner,
    ) -> Result<String> {
        self.create_document_of_kind(space_id, title, "database", None, tenancy)
            .await
    }

    /// Create an empty whiteboard (Excalidraw scene) document in a Space. Same
    /// lifecycle as a page/database — the editor saves the Excalidraw scene JSON
    /// via `update_document`, which chunks + embeds the flattened element text so
    /// the board stays searchable.
    pub async fn create_whiteboard(
        &self,
        space_id: &str,
        title: &str,
        tenancy: &DocOwner,
    ) -> Result<String> {
        self.create_document_of_kind(space_id, title, "whiteboard", None, tenancy)
            .await
    }

    // ── App-owned documents (grant `spaces:docs`) ───────────────────────────────
    //
    // Full-page Companion apps OWN Space documents through these methods, so a
    // whiteboard-as-app (or any app) gets the full Spaces integration: persisted in
    // the `documents` table, search-embedded, `[[backlinked]]`, versioned, and
    // Space-routed. Isolation is by `kind`: every app doc carries
    // `kind = "app:<plugin_id>"`, and every read/update/delete verifies that kind
    // FIRST — one app can never see or mutate another app's docs, nor any built-in
    // page/database/whiteboard/file. The owning `plugin_id` comes from the bridge's
    // path-bound id (never the body), so it cannot be spoofed.

    /// The isolation `kind` for a given app's documents.
    fn app_kind(plugin_id: &str) -> String {
        format!("app:{plugin_id}")
    }

    /// Create an app-owned document in a Space (`kind = app:<plugin_id>`). Returns
    /// the new document id. Same lifecycle as a page/database/whiteboard — empty
    /// until the app fills it via [`app_update_doc`](Self::app_update_doc).
    pub async fn app_create_doc(
        &self,
        plugin_id: &str,
        space_id: &str,
        title: &str,
        tenancy: &DocOwner,
    ) -> Result<String> {
        let kind = Self::app_kind(plugin_id);
        // App-owned docs are created by the plugin bridge / migrations — no HTTP
        // caller — so they attribute to the local owner on a bound node (else they
        // would be stranded and vanish from `list_documents`). The Core-side shim
        // resolves that owner (`spaces::background_owner`) and injects it here.
        self.create_document_of_kind(space_id, title, &kind, None, tenancy)
            .await
    }

    /// Fetch one app-owned document. Returns `Ok(None)` unless the document exists
    /// AND its `kind` is exactly `app:<plugin_id>` — so it never exposes another
    /// app's doc or a built-in page/database/whiteboard/file.
    pub async fn app_get_doc(&self, plugin_id: &str, doc_id: &str) -> Result<Option<AppDoc>> {
        let want = Self::app_kind(plugin_id);
        let Some(doc) = self.get_document(doc_id).await? else {
            return Ok(None);
        };
        if doc.kind != want {
            return Ok(None);
        }
        Ok(Some(AppDoc {
            id: doc.id,
            title: doc.title,
            source: doc.source,
            kind: doc.kind,
        }))
    }

    /// Update an app-owned document. The kind is verified FIRST (an app may only
    /// touch its own `app:<plugin_id>` docs), then the write reuses the normal
    /// [`update_document`](Self::update_document) path so flatten + search
    /// re-embedding + `[[backlink]]` re-resolution all run. `title = None` keeps
    /// the current title.
    pub async fn app_update_doc(
        &self,
        plugin_id: &str,
        doc_id: &str,
        title: Option<&str>,
        source: &str,
    ) -> Result<()> {
        let want = Self::app_kind(plugin_id);
        let doc = self
            .get_document(doc_id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("document '{doc_id}' not found"))?;
        if doc.kind != want {
            anyhow::bail!("document '{doc_id}' is not owned by app '{plugin_id}'");
        }
        let title = title.unwrap_or(&doc.title);
        self.update_document(doc_id, title, source).await
    }

    /// List an app's own documents in a Space (only `kind = app:<plugin_id>`),
    /// most-recently-updated first.
    pub async fn app_list_docs(
        &self,
        plugin_id: &str,
        space_id: &str,
    ) -> Result<Vec<AppDocSummary>> {
        let want = Self::app_kind(plugin_id);
        let conn = self.conn.lock().await;
        let mut stmt = conn
            .prepare(
                "SELECT id, title, updated_at FROM documents
                 WHERE space_id = ?1 AND kind = ?2
                 ORDER BY updated_at DESC, id DESC",
            )
            .context("preparing app doc list")?;
        let rows = stmt
            .query_map(params![space_id, want], |row| {
                Ok(AppDocSummary {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    updated_at: row.get(2)?,
                })
            })
            .context("querying app docs")?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    /// Delete an app-owned document (kind-verified FIRST). Reuses
    /// [`delete_document`](Self::delete_document), which also removes the doc's
    /// links and version history.
    pub async fn app_delete_doc(&self, plugin_id: &str, doc_id: &str) -> Result<()> {
        let want = Self::app_kind(plugin_id);
        let doc = self
            .get_document(doc_id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("document '{doc_id}' not found"))?;
        if doc.kind != want {
            anyhow::bail!("document '{doc_id}' is not owned by app '{plugin_id}'");
        }
        self.delete_document(doc_id).await?;
        Ok(())
    }

    /// Shared constructor for an empty document of a given `kind`
    /// (`"page"` | `"database"`), optionally parented to another document.
    async fn create_document_of_kind(
        &self,
        space_id: &str,
        title: &str,
        kind: &str,
        parent_id: Option<&str>,
        tenancy: &DocOwner,
    ) -> Result<String> {
        let document_id = uuid::Uuid::new_v4().to_string();
        let now = now_millis();
        let conn = self.conn.lock().await;
        let exists: Option<i64> = conn
            .query_row(
                "SELECT 1 FROM spaces WHERE id = ?1",
                params![space_id],
                |row| row.get(0),
            )
            .optional()
            .context("verifying space exists")?;
        if exists.is_none() {
            anyhow::bail!("space '{space_id}' not found");
        }
        upsert_document_row(
            &conn,
            &document_id,
            space_id,
            title,
            now,
            "",
            kind,
            parent_id,
            None,
            None,
            None,
            tenancy,
        )?;
        conn.execute(
            "UPDATE spaces SET updated_at = ?1 WHERE id = ?2",
            params![now, space_id],
        )
        .context("bumping space updated_at")?;
        // A new page may satisfy pending `[[Title]]` links from other documents.
        reresolve_pending_links(&conn, space_id, &document_id, title)?;
        Ok(document_id)
    }

    /// Get-or-create a **system** Space by name. System spaces (e.g. the default
    /// "Artifacts", "Uploads", and "Meetings" collections) are Ryu-owned: they cannot
    /// be deleted individually and are skipped by the danger-zone bulk clear. Called
    /// idempotently at startup, so a matching row is reused and its `system` flag
    /// is (re-)asserted. Returns the space id.
    pub async fn ensure_system_space(
        &self,
        name: &str,
        description: Option<&str>,
    ) -> Result<String> {
        let conn = self.conn.lock().await;
        let existing: Option<String> = conn
            .query_row(
                "SELECT id FROM spaces WHERE name = ?1",
                params![name],
                |row| row.get(0),
            )
            .optional()
            .context("looking up system space")?;
        if let Some(id) = existing {
            conn.execute("UPDATE spaces SET system = 1 WHERE id = ?1", params![id])
                .context("asserting system flag")?;
            return Ok(id);
        }
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_millis();
        // System spaces are node singletons with no owner — Unattributed + system=1.
        // The visibility predicate's `OR s.system = 1` keeps them shared to every
        // member, and the backfill deliberately skips them.
        upsert_space_row(
            &conn,
            &id,
            name,
            description,
            now,
            "vector",
            1,
            &DocOwner::unattributed(),
        )?;
        Ok(id)
    }

    /// Create a binary **file** document in a Space. Writes `bytes` to the content-
    /// addressed blob store, inserts a `kind = 'file'` document pointing at the
    /// blob, and embeds a short text descriptor (`title` + `mime`) so the file is
    /// discoverable via RAG search. Returns the new document id.
    ///
    /// This is the substrate the `create_artifact` tool and chat auto-filing sit
    /// on: a generated pptx/xlsx/csv/pdf/png lands here as a first-class Space doc.
    ///
    /// # The descriptor chunk obeys the Space's `retrieval_mode`, like every other
    /// # chunk
    ///
    /// This used to pass a hardcoded [`RetrievalMode::Vector`] to [`insert_chunks`],
    /// so a file added to a **graph**-mode Space got a chunk with no
    /// `graph_nodes`/`graph_edges` row. That is not a missing optimisation, it is an
    /// inconsistency with a user-visible edge: [`Self::set_retrieval_mode`] rebuilds
    /// from `SELECT id, content FROM chunks`, which **does** include file chunks. So
    /// the same file in the same Space was retrievable or not depending on the order
    /// the user happened to do things — upload-then-flip worked, create-Graph-Space-
    /// then-upload did not — and the natural flow was the broken one. The mode is now
    /// read from the Space row inside the same transaction that writes the document,
    /// exactly as [`Self::ingest_document`] and [`Self::update_document`] do.
    ///
    /// **What that does and does not make findable.** The only chunk a file has is
    /// the descriptor (`title` + `mime`) — a file's *bytes* are never chunked, in
    /// either mode. So the graph rows this now writes are entities of the filename
    /// and mime type, which is precisely what the rebuild would have written for the
    /// same row. Closing this makes ingest and rebuild agree; it does not make a
    /// PDF's prose reachable. Text extraction is the `document.parse` facade's job,
    /// and its output reaches a Space through [`Self::ingest_document`].
    ///
    /// # Why the transaction runs on the blocking pool
    ///
    /// It is the **fourth** `SpaceStore` write path that can now reach
    /// [`build_graph_for_chunks`], and it joins its three siblings on
    /// [`tokio::task::spawn_blocking`] for the same reason. "It is only one chunk" is
    /// true but is not a bound: the descriptor is never split by [`chunk_text`], and
    /// `title` is caller-supplied with no length cap at any HTTP or MCP entry point,
    /// so its entity count — and therefore the `n·(n−1)` edge fan-out — is bounded by
    /// nothing this crate controls. That hazard already existed on the rebuild path
    /// (which scans this same row); what changes here is only that the *cheap* path
    /// no longer differs from it.
    pub async fn create_file(
        &self,
        space_id: &str,
        title: &str,
        bytes: &[u8],
        mime: &str,
        tenancy: &DocOwner,
    ) -> Result<String> {
        // Persist the bytes first (content-addressed, deduped). Done outside the
        // db lock — filesystem I/O should not hold the sqlite mutex.
        let sha = write_blob(&self.blob_root, bytes)?;
        let byte_size = bytes.len() as i64;

        // A file has no editable markdown, but a short descriptor keeps it findable
        // in RAG (title + mime). Embed it like a tiny page.
        let descriptor = format!("{title}\n{mime}");
        let emb = self.embedder_snapshot().await;
        let model_id = emb.model_id().to_string();
        let dims = emb.dims();
        let vector = emb.embed(&descriptor).await?;

        let document_id = uuid::Uuid::new_v4().to_string();
        let now = now_millis();
        // Same ownership shape as `ingest_document`: the guard is acquired HERE (so
        // callers queue on the async mutex, not on a blocking-pool thread) and moved
        // into the closure, which releases it when the transaction ends.
        let space_id = space_id.to_owned();
        let title = title.to_owned();
        let mime = mime.to_owned();
        let tenancy = tenancy.clone();
        let guard = self.conn.clone().lock_owned().await;
        tokio::task::spawn_blocking(move || {
            Self::create_file_blocking(
                guard,
                &document_id,
                &space_id,
                &title,
                &mime,
                &sha,
                byte_size,
                &descriptor,
                vector,
                now,
                &model_id,
                dims,
                &tenancy,
            )
        })
        .await
        .context("file insert task panicked")?
    }

    /// The blocking body of [`SpaceStore::create_file`]. Split out only so the
    /// `spawn_blocking` closure stays a one-liner; the reasoning lives on the public
    /// method. Takes the guard by value so the connection is released exactly when
    /// the transaction ends, on the blocking thread.
    #[allow(clippy::too_many_arguments)]
    fn create_file_blocking(
        mut guard: tokio::sync::OwnedMutexGuard<Connection>,
        document_id: &str,
        space_id: &str,
        title: &str,
        mime: &str,
        sha: &str,
        byte_size: i64,
        descriptor: &str,
        vector: Vec<f32>,
        now: i64,
        model_id: &str,
        dims: usize,
        tenancy: &DocOwner,
    ) -> Result<String> {
        let conn = &mut *guard;
        let tx = conn.transaction().context("starting file insert")?;

        // Verify the Space exists and read its retrieval mode — one query, inside the
        // transaction, so the mode cannot change between the check and the write. The
        // "not found" wording is load-bearing: `POST /api/spaces/:id/files` maps it to
        // a 404 by substring.
        let mode_str: Option<String> = tx
            .query_row(
                "SELECT retrieval_mode FROM spaces WHERE id = ?1",
                params![space_id],
                |row| row.get(0),
            )
            .optional()
            .context("verifying space exists")?;
        let mode_str = mode_str.ok_or_else(|| anyhow::anyhow!("space '{space_id}' not found"))?;
        let mode = RetrievalMode::from_str(&mode_str);

        upsert_document_row(
            &tx,
            document_id,
            space_id,
            title,
            now,
            descriptor,
            "file",
            None,
            Some(mime),
            Some(sha),
            Some(byte_size),
            tenancy,
        )?;
        // Store the single descriptor chunk + its vector so the file is retrievable,
        // and (in graph mode) its entity rows so graph traversal can reach it too.
        insert_chunks(
            &tx,
            document_id,
            space_id,
            &[(descriptor.to_owned(), vector)],
            now,
            model_id,
            dims,
            mode,
        )?;
        tx.execute(
            "UPDATE spaces SET updated_at = ?1 WHERE id = ?2",
            params![now, space_id],
        )
        .context("bumping space updated_at")?;
        tx.commit().context("committing file insert")?;
        Ok(document_id.to_owned())
    }

    /// Replace a **file** document's chunk set from extracted text, leaving every
    /// other column on the row alone. Returns the number of chunks written.
    ///
    /// # Why this exists rather than reusing `update_document`
    ///
    /// [`Self::create_file`] stores exactly one chunk — the `{title}\n{mime}`
    /// descriptor — so a PDF was findable by its *filename* and by nothing else. The
    /// bytes are extracted Core-side by the `document.parse` facade (which is
    /// apps/core code and must stay there: this crate has zero dependency on
    /// apps/core), and the result has to land as chunks on the document that already
    /// exists. [`Self::update_document`] is the obvious-looking seam and is the wrong
    /// one, for three reasons that are all invisible until they have already
    /// happened:
    ///
    /// 1. It writes `documents.source`. For `kind = 'file'` that column is the
    ///    descriptor, [`Self::create_file`] is its only writer, and `get_document`
    ///    hands it to clients. Repointing it at 400 KB of extracted markdown changes
    ///    what every file document returns, irreversibly — the descriptor is not
    ///    recoverable afterwards.
    /// 2. It runs [`store_doc_links`] over the new source, so `[[…]]`-shaped text
    ///    inside an *uploaded PDF* would mint wiki links, then unresolve and
    ///    re-resolve inbound links as if the page had been renamed.
    /// 3. It has nowhere to express "these chunks came from extraction" versus
    ///    "these chunks are the descriptor" — the distinction the caller's index
    ///    status is built on.
    ///
    /// So this is deliberately the *middle third* of [`Self::update_document_blocking`]
    /// and nothing else: drop the old chunk/vector/graph rows, insert the new ones,
    /// bump the Space. Title, `source`, and the link graph are untouched.
    ///
    /// # `kind = 'file'` is enforced, not assumed
    ///
    /// Skipping the `source` write is only *safe* for a file. For a page, `source`
    /// IS the text the chunks were derived from, and rewriting chunks without it
    /// would leave the row silently desynchronised from its own index — the exact
    /// class of bug this method was written to close. A non-file id is an error.
    ///
    /// # Chunking is this crate's, on purpose
    ///
    /// `text` arrives whole and is split here by [`chunk_text`], the same function
    /// [`Self::ingest_document`] and [`Self::update_document`] use. Chunking Core-side
    /// and passing a `&[String]` would put a second definition of "what a chunk is"
    /// one crate boundary away from the first, and the two would drift the moment
    /// [`CHUNK_CHAR_SIZE`] moved. The caller controls only *what text* is indexed
    /// (it prepends the descriptor as its own paragraph so filename retrieval
    /// survives), never *how it is cut*.
    ///
    /// Empty/whitespace `text` is refused rather than accepted: [`chunk_text`] maps
    /// it to a single empty chunk, which would replace a working descriptor chunk
    /// with an unretrievable blank and make the document *less* findable than
    /// before. The caller must keep the descriptor-only state instead.
    ///
    /// Runs the transaction on [`tokio::task::spawn_blocking`] with the guard taken
    /// outside the closure, for the same reasons — and with the same three caveats —
    /// as [`Self::ingest_document`]: in graph mode this reaches
    /// [`build_graph_for_chunks`], whose cost is quadratic in entities per chunk, and
    /// an extracted document is exactly the large input that makes that bite.
    pub async fn replace_file_chunks(&self, doc_id: &str, text: &str) -> Result<usize> {
        if text.trim().is_empty() {
            anyhow::bail!("refusing to replace file chunks with empty text");
        }
        let chunks = chunk_text(text);

        // Embed outside the lock — the embedder may do network I/O.
        let emb = self.embedder_snapshot().await;
        let model_id = emb.model_id().to_string();
        let dims = emb.dims();
        let mut embedded: Vec<(String, Vec<f32>)> = Vec::with_capacity(chunks.len());
        for chunk in &chunks {
            embedded.push((chunk.clone(), emb.embed(chunk).await?));
        }

        let written = embedded.len();
        let doc_id = doc_id.to_owned();
        let now = now_millis();
        let guard = self.conn.clone().lock_owned().await;
        tokio::task::spawn_blocking(move || {
            Self::replace_file_chunks_blocking(guard, &doc_id, now, &model_id, dims, &embedded)
        })
        .await
        .context("file re-chunk task panicked")??;
        Ok(written)
    }

    /// The blocking body of [`SpaceStore::replace_file_chunks`]. Split out only so the
    /// `spawn_blocking` closure stays a one-liner; the reasoning lives on the public
    /// method. Takes the guard by value so the connection is released exactly when the
    /// transaction ends, on the blocking thread.
    fn replace_file_chunks_blocking(
        mut guard: tokio::sync::OwnedMutexGuard<Connection>,
        doc_id: &str,
        now: i64,
        model_id: &str,
        dims: usize,
        embedded: &[(String, Vec<f32>)],
    ) -> Result<()> {
        let conn = &mut *guard;
        let tx = conn.transaction().context("starting file re-chunk")?;

        // Resolve the document's space + kind + the Space's retrieval mode in ONE
        // query inside the transaction, so the mode cannot change between the read
        // and the write — the same guarantee `create_file_blocking` relies on, and
        // the reason a file added to a graph-mode Space gets graph rows.
        let row: Option<(String, String, String)> = tx
            .query_row(
                "SELECT d.space_id, d.kind, s.retrieval_mode
                 FROM documents d JOIN spaces s ON s.id = d.space_id
                 WHERE d.id = ?1",
                params![doc_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .context("resolving document for re-chunk")?;
        let (space_id, kind, mode_str) =
            row.ok_or_else(|| anyhow::anyhow!("document '{doc_id}' not found"))?;
        if kind != "file" {
            anyhow::bail!("document '{doc_id}' is kind '{kind}', not 'file'");
        }
        let mode = RetrievalMode::from_str(&mode_str);

        // Drop the old chunk set — vectors and graph rows first, since both are keyed
        // off the chunk rows this is about to delete.
        tx.execute(
            "DELETE FROM chunk_vectors WHERE rowid IN
                 (SELECT rowid FROM chunks WHERE document_id = ?1)",
            params![doc_id],
        )
        .context("deleting old file chunk vectors")?;
        tx.execute(
            "DELETE FROM graph_nodes WHERE chunk_id IN
                 (SELECT id FROM chunks WHERE document_id = ?1)",
            params![doc_id],
        )?;
        tx.execute(
            "DELETE FROM graph_edges WHERE chunk_id IN
                 (SELECT id FROM chunks WHERE document_id = ?1)",
            params![doc_id],
        )?;
        tx.execute("DELETE FROM chunks WHERE document_id = ?1", params![doc_id])
            .context("deleting old file chunks")?;

        insert_chunks(&tx, doc_id, &space_id, embedded, now, model_id, dims, mode)?;

        // The row's own `updated_at` moves (its index changed) but `source`, `title`
        // and the link graph deliberately do NOT — see the method doc.
        tx.execute(
            "UPDATE documents SET updated_at = ?1 WHERE id = ?2",
            params![now, doc_id],
        )
        .context("bumping document updated_at")?;
        tx.execute(
            "UPDATE spaces SET updated_at = ?1 WHERE id = ?2",
            params![now, space_id],
        )
        .context("bumping space updated_at")?;
        tx.commit().context("committing file re-chunk")?;
        Ok(())
    }

    /// Fetch a file document's blob metadata (mime, sha256, size). Returns
    /// `Ok(None)` when the id is not a `kind = 'file'` document.
    pub async fn get_file_meta(&self, doc_id: &str) -> Result<Option<FileMeta>> {
        let conn = self.conn.lock().await;
        let meta = conn
            .query_row(
                "SELECT id, space_id, title,
                        COALESCE(mime, 'application/octet-stream'),
                        blob_sha256, COALESCE(byte_size, 0), created_at
                 FROM documents WHERE id = ?1 AND kind = 'file'",
                params![doc_id],
                |row| {
                    let sha: Option<String> = row.get(4)?;
                    Ok(FileMeta {
                        id: row.get(0)?,
                        space_id: row.get(1)?,
                        title: row.get(2)?,
                        mime: row.get(3)?,
                        sha256: sha.unwrap_or_default(),
                        byte_size: row.get(5)?,
                        created_at: row.get(6)?,
                    })
                },
            )
            .optional()
            .context("reading file meta")?;
        Ok(meta)
    }

    /// Read a file document's bytes (mime + blob). Returns `Ok(None)` when the doc
    /// is not a file or its blob is missing from the store.
    pub async fn read_file_blob(&self, doc_id: &str) -> Result<Option<(String, Vec<u8>)>> {
        let Some(meta) = self.get_file_meta(doc_id).await? else {
            return Ok(None);
        };
        if meta.sha256.is_empty() {
            return Ok(None);
        }
        match read_blob(&self.blob_root, &meta.sha256)? {
            Some(bytes) => Ok(Some((meta.mime, bytes))),
            None => Ok(None),
        }
    }

    /// Fetch a single document with its full markdown source.
    /// Load the tenancy quartet (owner / org / visibility / team) for a document,
    /// for the realtime WS gateway's access decision. Returns `Ok(None)` when the
    /// document row does not exist. These columns are plaintext additive Phase 0
    /// tenancy columns, so a raw `SELECT` compares correctly against a verified
    /// caller's id.
    pub async fn get_access_meta(&self, doc_id: &str) -> Result<Option<DocAccessMeta>> {
        let conn = self.conn.lock().await;
        let meta = conn
            .query_row(
                "SELECT owner_user_id, org_id, visibility, team_id
                 FROM documents WHERE id = ?1",
                params![doc_id],
                |row| {
                    Ok(DocAccessMeta {
                        owner_user_id: row.get(0)?,
                        org_id: row.get(1)?,
                        // NOT NULL DEFAULT 'private' in the schema, so always present.
                        visibility: row.get(2)?,
                        team_id: row.get(3)?,
                    })
                },
            )
            .optional()
            .context("reading document access metadata")?;
        Ok(meta)
    }

    /// Load a Space's tenancy quartet (owner / org / visibility / team) plus its
    /// `system` flag, for the by-id `delete_space` ACL gate. Twin of
    /// [`Self::get_access_meta`]. Returns `Ok(None)` when the space row does not
    /// exist. A system space has `system = 1` and NULL owner, which the shared
    /// `resource_access` gate reads as unattributable → denied on a bound node
    /// (system spaces are node singletons, not user-deletable via HTTP).
    pub async fn space_access_meta(&self, space_id: &str) -> Result<Option<SpaceAccessMeta>> {
        let conn = self.conn.lock().await;
        let meta = conn
            .query_row(
                "SELECT owner_user_id, org_id, visibility, team_id, system
                 FROM spaces WHERE id = ?1",
                params![space_id],
                |row| {
                    Ok(SpaceAccessMeta {
                        owner_user_id: row.get(0)?,
                        org_id: row.get(1)?,
                        // NOT NULL DEFAULT 'private' in the schema, so always present.
                        visibility: row.get(2)?,
                        team_id: row.get(3)?,
                        system: row.get::<_, i64>(4)? != 0,
                    })
                },
            )
            .optional()
            .context("reading space access metadata")?;
        Ok(meta)
    }

    pub async fn get_document(&self, doc_id: &str) -> Result<Option<DocumentContent>> {
        let conn = self.conn.lock().await;
        let doc = conn
            .query_row(
                "SELECT d.id, d.space_id, d.title, d.source, d.created_at, d.updated_at,
                        (SELECT COUNT(*) FROM chunks c WHERE c.document_id = d.id),
                        d.kind, d.parent_id, d.icon
                 FROM documents d WHERE d.id = ?1",
                params![doc_id],
                |row| {
                    let icon_raw: Option<String> = row.get(9)?;
                    Ok(DocumentContent {
                        id: row.get(0)?,
                        space_id: row.get(1)?,
                        title: row.get(2)?,
                        source: row.get(3)?,
                        created_at: row.get(4)?,
                        updated_at: row.get(5)?,
                        chunk_count: row.get(6)?,
                        kind: row.get(7)?,
                        parent_id: row.get(8)?,
                        icon: icon_raw.and_then(|s| serde_json::from_str(&s).ok()),
                    })
                },
            )
            .optional()
            .context("reading document")?;
        Ok(doc)
    }

    /// Set (or clear) a Space's Notion-style glyph. Does not touch documents.
    /// Returns `false` when no such space exists.
    pub async fn set_space_icon(
        &self,
        space_id: &str,
        icon: Option<&serde_json::Value>,
    ) -> Result<bool> {
        let now = now_millis();
        let icon_str = match icon {
            Some(v) => Some(serde_json::to_string(v).context("serializing space icon")?),
            None => None,
        };
        let conn = self.conn.lock().await;
        let n = conn
            .execute(
                "UPDATE spaces SET icon = ?1, updated_at = ?2 WHERE id = ?3",
                params![icon_str, now, space_id],
            )
            .context("updating space icon")?;
        Ok(n > 0)
    }

    /// Change a Space's [`RetrievalMode`], **rebuilding its entity graph so the new
    /// mode actually takes effect**. Returns `None` when no such space exists.
    ///
    /// Why this is not a one-line `UPDATE`: graph extraction is gated on the mode
    /// *at ingest time* (`insert_chunks`), so a Space ingested in `Vector` mode has
    /// zero `graph_nodes`/`graph_edges` rows. Flipping only the column would point
    /// `search_ext` at `graph_search`, which seeds its BFS from `graph_nodes` — and
    /// an empty graph returns an empty result set. The Space would answer *nothing*
    /// while reporting `retrieval_mode: "graph"`. So:
    ///
    /// - **→ `Graph`**: drop this space's graph rows and rebuild them from every
    ///   chunk currently on disk, via the shared [`build_graph_for_chunks`].
    ///   Re-asserting `Graph` on a Space that is already `Graph` therefore doubles
    ///   as a graph *repair*.
    /// - **→ `Vector`**: drop this space's graph rows. Nothing maintains them in
    ///   vector mode, so keeping them would leave a graph that silently rots as
    ///   documents change, and a later switch back would either double-insert or
    ///   serve stale entities. The switch back rebuilds from scratch, so dropping
    ///   loses nothing.
    ///
    /// The column write and the graph rebuild share ONE transaction: a crash
    /// between them would leave `retrieval_mode = 'graph'` over an empty graph,
    /// which is the precise failure this method exists to prevent.
    ///
    /// Chunk *vectors* are untouched in both directions — switching modes never
    /// re-embeds, so it is safe to toggle back and forth.
    ///
    /// # What this costs, and what running it off the async worker does and does
    /// # not buy
    ///
    /// The rebuild is **not** cheap, and this used to say it was ("pure SQL +
    /// string work and runs inline") on the strength of "no model call". Measured on
    /// an **on-disk** db, which is what a real Space is: a 1,566-chunk Space of
    /// English prose writes 5.1M `graph_edges` rows and takes **46–87 s** across two
    /// runs — 392 chunks takes ~10 s, and per-chunk cost *rises* with size. See
    /// [`build_graph_for_chunks`] for the full table, the reproduction command, and
    /// the `O(chunks × entities²)` shape. The unbounded dimension is the chunk
    /// count, which is whatever the Space happens to hold, so one UI click on a
    /// large Space is **minutes** of uninterruptible SQLite work.
    ///
    /// So the whole transaction runs on [`tokio::task::spawn_blocking`]. Be precise
    /// about what that fixes, because the two are easy to conflate:
    ///
    /// - **Fixed:** the tokio worker thread is no longer occupied for the duration.
    ///   Before, a large rebuild parked a runtime worker in a minutes-long
    ///   `rusqlite` call with no yield point, so unrelated Core requests scheduled
    ///   onto that worker stalled behind a Spaces button.
    /// - **NOT fixed:** the *Space* is still unavailable for the duration, and on
    ///   the numbers above that duration is minutes, not a blink. The connection
    ///   mutex is held across the whole rebuild (it has to be — the column write and
    ///   the graph rebuild are one transaction, which is the crash-consistency
    ///   guarantee above), so every other `SpaceStore` call — search, list, ingest,
    ///   *and every other Space*, since one connection serves all of them — waits.
    ///   Moving the work to a blocking thread changes *who* waits, not *whether*.
    /// - **Also NOT fixed:** the call is uncancellable and reports no progress.
    ///   Dropping the caller's future (client disconnect, request timeout) does not
    ///   stop the blocking task; it runs to completion and only then releases the
    ///   guard. The HTTP caller may time out while the node stays busy.
    ///
    /// Both remaining problems have the same root — one `Connection` behind one
    /// mutex, one transaction — so neither is fixable by tweaking this call. A
    /// rebuild that is concurrent, cancellable, or resumable needs a second
    /// connection (WAL readers) and chunked commits, which trades away the
    /// all-or-nothing guarantee documented above. That trade has not been made;
    /// this doc exists so it is made deliberately rather than discovered.
    pub async fn set_retrieval_mode(
        &self,
        space_id: &str,
        mode: RetrievalMode,
    ) -> Result<Option<RetrievalModeChange>> {
        // `spawn_blocking` demands `'static`, so the borrowed id is cloned and the
        // guard is taken as an *owned* one. Acquiring the lock here rather than
        // inside the closure keeps the wait itself asynchronous: callers queue on
        // the tokio mutex, they do not occupy a blocking-pool thread while waiting.
        let space_id = space_id.to_owned();
        let mut guard = self.conn.clone().lock_owned().await;
        tokio::task::spawn_blocking(move || {
            Self::set_retrieval_mode_blocking(&mut guard, &space_id, mode)
        })
        .await
        .context("retrieval-mode rebuild task panicked")?
    }

    /// The blocking body of [`SpaceStore::set_retrieval_mode`]. Split out only so
    /// the `spawn_blocking` closure stays a one-liner; all the reasoning about
    /// *why* it is shaped this way lives on the public method.
    fn set_retrieval_mode_blocking(
        conn: &mut Connection,
        space_id: &str,
        mode: RetrievalMode,
    ) -> Result<Option<RetrievalModeChange>> {
        let now = now_millis();
        let tx = conn
            .transaction()
            .context("starting retrieval-mode transaction")?;

        let previous: Option<String> = tx
            .query_row(
                "SELECT retrieval_mode FROM spaces WHERE id = ?1",
                params![space_id],
                |row| row.get(0),
            )
            .optional()
            .context("reading current retrieval_mode")?;
        let Some(previous) = previous else {
            return Ok(None);
        };
        let previous = RetrievalMode::from_str(&previous);

        tx.execute(
            "UPDATE spaces SET retrieval_mode = ?1, updated_at = ?2 WHERE id = ?3",
            params![mode.as_str(), now, space_id],
        )
        .context("updating space retrieval_mode")?;

        // Always clear first: in the → `Graph` direction this makes the rebuild
        // idempotent (the tables carry no UNIQUE constraint, so a second pass over
        // the same chunks would duplicate every node and edge); in the → `Vector`
        // direction it is the whole point.
        tx.execute(
            "DELETE FROM graph_edges WHERE space_id = ?1",
            params![space_id],
        )
        .context("clearing graph edges")?;
        tx.execute(
            "DELETE FROM graph_nodes WHERE space_id = ?1",
            params![space_id],
        )
        .context("clearing graph nodes")?;

        let mut chunks_scanned = 0usize;
        let mut graph_nodes = 0usize;
        let mut graph_edges = 0usize;
        if mode == RetrievalMode::Graph {
            let rows: Vec<(String, String)> = {
                let mut stmt = tx
                    .prepare("SELECT id, content FROM chunks WHERE space_id = ?1 ORDER BY rowid")
                    .context("preparing chunk scan for graph rebuild")?;
                let mapped =
                    stmt.query_map(params![space_id], |row| Ok((row.get(0)?, row.get(1)?)))?;
                let mut v = Vec::new();
                for row in mapped {
                    v.push(row?);
                }
                v
            };
            chunks_scanned = rows.len();
            let pairs: Vec<(&str, &str)> = rows
                .iter()
                .map(|(id, content)| (id.as_str(), content.as_str()))
                .collect();
            let (n, e) = build_graph_for_chunks(&tx, space_id, &pairs)?;
            graph_nodes = n;
            graph_edges = e;
        }

        tx.commit().context("committing retrieval-mode change")?;
        Ok(Some(RetrievalModeChange {
            previous,
            mode,
            changed: previous != mode,
            graph_rebuilt: mode == RetrievalMode::Graph,
            chunks_scanned,
            graph_nodes,
            graph_edges,
        }))
    }

    /// Set (or clear) a document's Notion-style glyph without re-embedding.
    /// Returns `false` when no such document exists.
    pub async fn set_document_icon(
        &self,
        doc_id: &str,
        icon: Option<&serde_json::Value>,
    ) -> Result<bool> {
        let now = now_millis();
        let icon_str = match icon {
            Some(v) => Some(serde_json::to_string(v).context("serializing document icon")?),
            None => None,
        };
        let mut conn = self.conn.lock().await;
        let tx = conn
            .transaction()
            .context("starting document icon transaction")?;
        let space_id: Option<String> = tx
            .query_row(
                "SELECT space_id FROM documents WHERE id = ?1",
                params![doc_id],
                |row| row.get(0),
            )
            .optional()
            .context("looking up document for icon update")?;
        let Some(space_id) = space_id else {
            return Ok(false);
        };
        tx.execute(
            "UPDATE documents SET icon = ?1, updated_at = ?2 WHERE id = ?3",
            params![icon_str, now, doc_id],
        )
        .context("updating document icon")?;
        tx.execute(
            "UPDATE spaces SET updated_at = ?1 WHERE id = ?2",
            params![now, space_id],
        )
        .context("bumping space updated_at")?;
        tx.commit().context("committing document icon update")?;
        Ok(true)
    }

    /// Save an edited page: replace the document's chunks + vectors (+ graph) from
    /// the new markdown `source`, re-embedding with the current model. This is the
    /// embed-on-save path; the desktop debounces calls to it.
    pub async fn update_document(&self, doc_id: &str, title: &str, source: &str) -> Result<()> {
        // A database document stores grid JSON in `source`; embed a flattened
        // text rendering of it (column labels + cell values) so it stays
        // searchable like a page. The stored `source` remains the raw JSON.
        // Read `kind` before chunking — chunking/embedding happen outside the lock.
        let kind: Option<String> = {
            let conn = self.conn.lock().await;
            conn.query_row(
                "SELECT kind FROM documents WHERE id = ?1",
                params![doc_id],
                |row| row.get(0),
            )
            .optional()
            .context("reading document kind")?
        };
        let chunk_source = match kind.as_deref() {
            Some("database") => flatten_database_source(source),
            Some("whiteboard") => flatten_whiteboard_source(source),
            // App-owned docs (`kind = app:<plugin_id>`) carry app-defined JSON we
            // can't know the shape of; extract every string value so they stay
            // search-embeddable like a whiteboard/database.
            Some(k) if k.starts_with("app:") => flatten_app_source(source),
            _ => source.to_string(),
        };
        let chunks = chunk_text(&chunk_source);
        // Embed outside the lock — the embedder may do network I/O.
        let emb = self.embedder_snapshot().await;
        let model_id = emb.model_id().to_string();
        let dims = emb.dims();
        let mut embedded: Vec<(String, Vec<f32>)> = Vec::with_capacity(chunks.len());
        for chunk in &chunks {
            embedded.push((chunk.clone(), emb.embed(chunk).await?));
        }

        let now = now_millis();
        // Same reasoning (and the same three caveats) as [`Self::ingest_document`]:
        // in graph mode this transaction re-runs [`build_graph_for_chunks`] over the
        // whole document, so an editor save on a large page is the same quadratic
        // SQLite burst. Guard acquired here, outside the closure, so callers queue on
        // the async mutex rather than on a blocking-pool thread.
        let doc_id = doc_id.to_owned();
        let title = title.to_owned();
        let source = source.to_owned();
        let guard = self.conn.clone().lock_owned().await;
        tokio::task::spawn_blocking(move || {
            Self::update_document_blocking(
                guard, &doc_id, &title, &source, now, &model_id, dims, &embedded,
            )
        })
        .await
        .context("document update task panicked")?
    }

    /// The blocking body of [`SpaceStore::update_document`]. Split out only so the
    /// `spawn_blocking` closure stays a one-liner; the reasoning lives on the public
    /// method. Takes the guard by value so the connection is released exactly when
    /// the transaction ends, on the blocking thread.
    #[allow(clippy::too_many_arguments)]
    fn update_document_blocking(
        mut guard: tokio::sync::OwnedMutexGuard<Connection>,
        doc_id: &str,
        title: &str,
        source: &str,
        now: i64,
        model_id: &str,
        dims: usize,
        embedded: &[(String, Vec<f32>)],
    ) -> Result<()> {
        let conn = &mut *guard;
        let tx = conn.transaction().context("starting update transaction")?;

        // Resolve the document's space + retrieval mode (and prove it exists).
        let row: Option<(String, String)> = tx
            .query_row(
                "SELECT d.space_id, s.retrieval_mode
                 FROM documents d JOIN spaces s ON s.id = d.space_id
                 WHERE d.id = ?1",
                params![doc_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .context("resolving document space")?;
        let (space_id, mode_str) =
            row.ok_or_else(|| anyhow::anyhow!("document '{doc_id}' not found"))?;
        let mode = RetrievalMode::from_str(&mode_str);

        // Drop the document's old chunks, vectors, and graph rows.
        tx.execute(
            "DELETE FROM chunk_vectors WHERE rowid IN
                 (SELECT rowid FROM chunks WHERE document_id = ?1)",
            params![doc_id],
        )
        .context("deleting old chunk vectors")?;
        tx.execute(
            "DELETE FROM graph_nodes WHERE chunk_id IN
                 (SELECT id FROM chunks WHERE document_id = ?1)",
            params![doc_id],
        )?;
        tx.execute(
            "DELETE FROM graph_edges WHERE chunk_id IN
                 (SELECT id FROM chunks WHERE document_id = ?1)",
            params![doc_id],
        )?;
        tx.execute("DELETE FROM chunks WHERE document_id = ?1", params![doc_id])
            .context("deleting old chunks")?;

        insert_chunks(&tx, doc_id, &space_id, embedded, now, model_id, dims, mode)?;

        tx.execute(
            "UPDATE documents SET title = ?1, source = ?2, updated_at = ?3 WHERE id = ?4",
            params![title, source, now, doc_id],
        )
        .context("updating document")?;
        tx.execute(
            "UPDATE spaces SET updated_at = ?1 WHERE id = ?2",
            params![now, space_id],
        )?;

        // Wiki page-links. Re-derive this document's outgoing links from the new
        // source. On a rename, inbound links that were resolved to this doc by its
        // *old* title no longer match → unresolve them (back to pending); then
        // re-resolve any pending links that match the *new* title.
        store_doc_links(&tx, &space_id, doc_id, source, now)?;
        tx.execute(
            "UPDATE document_links SET dst_doc_id = NULL
             WHERE dst_doc_id = ?1 AND dst_title != ?2 COLLATE NOCASE",
            params![doc_id, title],
        )
        .context("unresolving stale inbound links on rename")?;
        reresolve_pending_links(&tx, &space_id, doc_id, title)?;

        tx.commit().context("committing update transaction")?;
        Ok(())
    }

    /// Maximum retained versions per document. Oldest beyond this are pruned on
    /// each new snapshot so history stays bounded (mirrors Prompt Studio's cap).
    const MAX_DOC_VERSIONS: usize = 50;

    /// Capture the document's current `title`/`source`/`kind` as an immutable
    /// version row and return its metadata. Prunes the oldest rows past
    /// [`Self::MAX_DOC_VERSIONS`]. Errors if the document does not exist.
    pub async fn snapshot_document(
        &self,
        doc_id: &str,
        label: Option<&str>,
    ) -> Result<DocumentVersionMeta> {
        let now = now_millis();
        let version_id = format!("dv_{}", uuid::Uuid::new_v4());
        let conn = self.conn.lock().await;

        let (space_id, title, source, kind): (String, String, String, String) = conn
            .query_row(
                "SELECT space_id, title, source, kind FROM documents WHERE id = ?1",
                params![doc_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()
            .context("reading document for snapshot")?
            .ok_or_else(|| anyhow::anyhow!("document '{doc_id}' not found"))?;

        conn.execute(
            "INSERT INTO document_versions
                 (id, document_id, space_id, title, source, label, kind, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![version_id, doc_id, space_id, title, source, label, kind, now],
        )
        .context("inserting document version")?;

        // Prune oldest rows beyond the cap for this document.
        conn.execute(
            "DELETE FROM document_versions
             WHERE document_id = ?1 AND id NOT IN (
                 SELECT id FROM document_versions
                 WHERE document_id = ?1
                 ORDER BY created_at DESC, id DESC
                 LIMIT ?2
             )",
            params![doc_id, Self::MAX_DOC_VERSIONS as i64],
        )
        .context("pruning old document versions")?;

        Ok(DocumentVersionMeta {
            id: version_id,
            document_id: doc_id.to_string(),
            title,
            label: label.map(str::to_string),
            kind,
            created_at: now,
        })
    }

    /// List a document's saved versions, newest first (metadata only).
    pub async fn list_document_versions(&self, doc_id: &str) -> Result<Vec<DocumentVersionMeta>> {
        let conn = self.conn.lock().await;
        let mut stmt = conn
            .prepare(
                "SELECT id, document_id, title, label, kind, created_at
                 FROM document_versions
                 WHERE document_id = ?1
                 ORDER BY created_at DESC, id DESC",
            )
            .context("preparing version list")?;
        let rows = stmt
            .query_map(params![doc_id], |row| {
                Ok(DocumentVersionMeta {
                    id: row.get(0)?,
                    document_id: row.get(1)?,
                    title: row.get(2)?,
                    label: row.get(3)?,
                    kind: row.get(4)?,
                    created_at: row.get(5)?,
                })
            })
            .context("querying document versions")?;
        Ok(rows.filter_map(std::result::Result::ok).collect())
    }

    /// Fetch one saved version in full (including its captured `source`).
    pub async fn get_document_version(&self, version_id: &str) -> Result<Option<DocumentVersion>> {
        let conn = self.conn.lock().await;
        let ver = conn
            .query_row(
                "SELECT id, document_id, title, source, label, kind, created_at
                 FROM document_versions WHERE id = ?1",
                params![version_id],
                |row| {
                    Ok(DocumentVersion {
                        id: row.get(0)?,
                        document_id: row.get(1)?,
                        title: row.get(2)?,
                        source: row.get(3)?,
                        label: row.get(4)?,
                        kind: row.get(5)?,
                        created_at: row.get(6)?,
                    })
                },
            )
            .optional()
            .context("reading document version")?;
        Ok(ver)
    }

    /// Delete a document and all its chunks/vectors/graph rows. If the document
    /// has child documents (e.g. a database's row pages, linked by `parent_id`),
    /// they are removed too — including their vec0 vectors, which no FK cascade
    /// reaches. Returns whether the target document row was removed.
    pub async fn delete_document(&self, doc_id: &str) -> Result<bool> {
        let mut conn = self.conn.lock().await;
        let tx = conn.transaction().context("starting delete transaction")?;

        // Collect child document ids (one level — row pages have no children).
        let child_ids: Vec<String> = {
            let mut stmt = tx
                .prepare("SELECT id FROM documents WHERE parent_id = ?1")
                .context("preparing child lookup")?;
            let ids = stmt.query_map(params![doc_id], |row| row.get::<_, String>(0))?;
            ids.filter_map(std::result::Result::ok).collect()
        };

        // Delete vec0 vectors for the target AND every child (vec0 has no cascade).
        for id in std::iter::once(doc_id.to_string()).chain(child_ids.iter().cloned()) {
            tx.execute(
                "DELETE FROM chunk_vectors WHERE rowid IN
                     (SELECT rowid FROM chunks WHERE document_id = ?1)",
                params![id],
            )
            .context("deleting doc chunk vectors")?;
        }

        // Delete child document rows first (their chunks/graph cascade), then the
        // target document row (its chunks + graph rows cascade via ON DELETE CASCADE).
        for id in &child_ids {
            tx.execute("DELETE FROM documents WHERE id = ?1", params![id])
                .context("deleting child document")?;
        }
        let removed = tx
            .execute("DELETE FROM documents WHERE id = ?1", params![doc_id])
            .context("deleting document")?;

        // Wiki page-links have no FK cascade (plain-text ids): drop each removed
        // document's outgoing links, and turn inbound links back into pending
        // (`dst_doc_id → NULL`) so a re-created page re-resolves them later.
        for id in std::iter::once(doc_id.to_string()).chain(child_ids.iter().cloned()) {
            tx.execute(
                "DELETE FROM document_links WHERE src_doc_id = ?1",
                params![id],
            )
            .context("deleting outbound links")?;
            tx.execute(
                "UPDATE document_links SET dst_doc_id = NULL WHERE dst_doc_id = ?1",
                params![id],
            )
            .context("unresolving inbound links")?;
            // Version history has no FK cascade (plain-text ids) — drop it too.
            tx.execute(
                "DELETE FROM document_versions WHERE document_id = ?1",
                params![id],
            )
            .context("deleting document versions")?;
        }

        tx.commit().context("committing delete transaction")?;
        Ok(removed > 0)
    }

    /// Run a retrieval search across a Space. Branches on the Space's
    /// `retrieval_mode`:
    ///
    /// - `vector`: KNN similarity search (original behaviour, unchanged).
    /// - `graph`: entity-match + BFS traversal, returns grounded chunks.
    ///
    /// Both paths return `Vec<ChunkMatch>`. For graph results `distance` is the
    /// constant `0.0` — a traversal hit has no metric distance, and no
    /// hop-count-derived value is synthesised. Do not rank on `distance` across
    /// modes: it is a real `vec0` distance only on the vector path.
    pub async fn search(
        &self,
        space_id: &str,
        query: &str,
        limit: usize,
    ) -> Result<Vec<ChunkMatch>> {
        self.search_ext(space_id, query, limit, None, DocFilter::unrestricted())
            .await
    }

    /// Like [`search`](Self::search) but with an explicit `link_expansion`
    /// override (`None` = use the `RYU_SPACES_LINK_EXPANSION` default) and a
    /// per-caller tenancy `filter`. On an org-bound node the returned chunks are
    /// restricted to documents the caller may READ (so RAG search never leaks a
    /// colleague's private document text); [`DocFilter::unrestricted`] keeps the
    /// in-process / unbound path unchanged.
    pub async fn search_ext(
        &self,
        space_id: &str,
        query: &str,
        limit: usize,
        link_expansion: Option<bool>,
        filter: DocFilter<'_>,
    ) -> Result<Vec<ChunkMatch>> {
        let mode = self.space_mode(space_id).await?;
        // Over-fetch candidates so the neural reranker (bge cross-encoder, served
        // by the lazily-started `llamacpp-rerank` sidecar) has a fuller set to
        // re-score. Capped so we never balloon the KNN/graph query.
        const RERANK_FANOUT: usize = 4;
        const RERANK_MAX_CANDIDATES: usize = 50;
        let candidate_limit = limit
            .saturating_mul(RERANK_FANOUT)
            .clamp(limit, RERANK_MAX_CANDIDATES);
        let mut candidates = match mode {
            RetrievalMode::Vector => self.vector_search(space_id, query, candidate_limit).await?,
            RetrievalMode::Graph => self.graph_search(space_id, query, candidate_limit).await?,
        };

        // Wiki GraphRAG: expand seed hits along resolved `[[page]]` links so the
        // reranker sees context from documents the hits reference, not only the
        // closest vectors. Applies to both retrieval modes; fail-open.
        if link_expansion.unwrap_or_else(link_expansion_default) {
            const LINK_HOPS: usize = 2;
            const LINK_PER_DOC_CHUNKS: usize = 3;
            let mut seed_doc_ids: Vec<String> = Vec::new();
            let mut seen_docs: std::collections::HashSet<String> = std::collections::HashSet::new();
            for c in &candidates {
                if seen_docs.insert(c.document_id.clone()) {
                    seed_doc_ids.push(c.document_id.clone());
                }
            }
            match self
                .expand_by_links(space_id, &seed_doc_ids, LINK_HOPS, LINK_PER_DOC_CHUNKS)
                .await
            {
                Ok(extra) => {
                    let existing: std::collections::HashSet<String> =
                        candidates.iter().map(|c| c.chunk_id.clone()).collect();
                    for c in extra {
                        if !existing.contains(&c.chunk_id) {
                            candidates.push(c);
                        }
                    }
                }
                Err(e) => tracing::debug!("Spaces link-expansion skipped ({e:#})"),
            }
        }

        // Per-resource tenancy: drop any candidate whose document the caller may not
        // READ. On an unbound node (`filter` unrestricted → `bound = 0`) this loads
        // every doc id and retains everything, so the path is byte-identical.
        if !candidates.is_empty() {
            let visible = self.visible_document_ids(space_id, filter).await?;
            candidates.retain(|c| visible.contains(&c.document_id));
        }

        Ok(self.apply_reranking(query, candidates, limit).await)
    }

    /// The ids of every document in `space_id` the caller may READ, using
    /// [`DOC_TENANCY_VISIBLE_PREDICATE`]. Backs the search post-filter so RAG never
    /// returns a chunk from a document the caller cannot open.
    async fn visible_document_ids(
        &self,
        space_id: &str,
        filter: DocFilter<'_>,
    ) -> Result<std::collections::HashSet<String>> {
        let conn = self.conn.lock().await;
        let sql = format!(
            "SELECT d.id FROM documents d
             WHERE d.space_id = :space_id AND {DOC_TENANCY_VISIBLE_PREDICATE}"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(
            named_params! {
                ":space_id": space_id,
                ":bound": filter.bound_flag(),
                ":uid": filter.owner_user_id,
                ":org": filter.org_id,
            },
            |row| row.get::<_, String>(0),
        )?;
        let mut out = std::collections::HashSet::new();
        for row in rows {
            out.insert(row?);
        }
        Ok(out)
    }

    /// Re-score retrieval `candidates` with the neural reranker and truncate to
    /// `limit`. Fails open: any reranker error (server not started yet, HTTP
    /// failure) preserves the original retrieval order. Neural reranking of Spaces
    /// RAG is the reason the bge cross-encoder is bundled; the `llamacpp-rerank`
    /// server is started lazily by the search HTTP handler, so the first search
    /// after boot may fall open to the vector order before the server warms.
    async fn apply_reranking(
        &self,
        query: &str,
        candidates: Vec<ChunkMatch>,
        limit: usize,
    ) -> Vec<ChunkMatch> {
        if candidates.len() <= 1 {
            return candidates.into_iter().take(limit).collect();
        }
        let docs: Vec<String> = candidates.iter().map(|c| c.content.clone()).collect();
        match self.reranker.rank_documents(query, &docs).await {
            Ok(ranked) => {
                let mut reordered = Vec::with_capacity(limit.min(ranked.len()));
                for (idx, _score) in ranked.into_iter().take(limit) {
                    if let Some(chunk) = candidates.get(idx) {
                        reordered.push(chunk.clone());
                    }
                }
                // Defensive: an empty/degenerate rerank result must not drop all
                // hits — fall back to the original order.
                if reordered.is_empty() {
                    candidates.into_iter().take(limit).collect()
                } else {
                    reordered
                }
            }
            Err(e) => {
                tracing::debug!("Spaces reranking unavailable ({e:#}); using vector order");
                candidates.into_iter().take(limit).collect()
            }
        }
    }

    /// Read the `retrieval_mode` for a Space.
    async fn space_mode(&self, space_id: &str) -> Result<RetrievalMode> {
        let conn = self.conn.lock().await;
        let mode_str: Option<String> = conn
            .query_row(
                "SELECT retrieval_mode FROM spaces WHERE id = ?1",
                params![space_id],
                |row| row.get(0),
            )
            .optional()
            .context("querying space retrieval_mode")?;
        Ok(RetrievalMode::from_str(
            mode_str.as_deref().unwrap_or("vector"),
        ))
    }

    /// KNN cosine-similarity search (vector mode).
    async fn vector_search(
        &self,
        space_id: &str,
        query: &str,
        limit: usize,
    ) -> Result<Vec<ChunkMatch>> {
        let emb = self.embedder_snapshot().await;
        let model_id = emb.model_id().to_string();
        let query_vec = emb.embed(query).await?;
        let bytes = vec_to_bytes(&query_vec);
        let conn = self.conn.lock().await;
        // Filter to chunks embedded by the *current* model: a vector produced by a
        // different embedding model lives in an incomparable space, so matching it
        // would yield meaningless distances. Stale chunks are excluded until a
        // re-index re-embeds them (see `reindex_all`).
        let mut stmt = conn.prepare(
            "SELECT c.id, c.document_id, c.content, v.distance
             FROM chunk_vectors v
             JOIN chunks c ON c.rowid = v.rowid
             WHERE v.embedding MATCH ?1
               AND k = ?2
               AND c.space_id = ?3
               AND c.embed_model = ?4
             ORDER BY v.distance",
        )?;
        let rows = stmt.query_map(params![bytes, limit as i64, space_id, model_id], |row| {
            Ok(ChunkMatch {
                chunk_id: row.get(0)?,
                document_id: row.get(1)?,
                content: row.get(2)?,
                distance: row.get::<_, f64>(3)? as f32,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    /// Graph traversal search (graph mode).
    ///
    /// Algorithm:
    /// 1. Extract query entities (same extractor used at ingest time).
    /// 2. Seed the BFS frontier with all chunks that contain those entities.
    /// 3. For each frontier entity, follow all outgoing edges to neighbour
    ///    entities, then find chunks containing those neighbours.
    /// 4. Continue until `limit` unique chunks are collected or no new frontier.
    /// 5. Return the collected chunks ordered: direct hits first, then 1-hop, etc.
    ///
    /// # Why the traversal is explicitly bounded
    ///
    /// The edges this walks are **co-occurrence**, not semantics: every pair of
    /// entities in a chunk is joined (see [`build_graph_for_chunks`]), so with the
    /// ≈57 entities measured in a 1,000-char chunk of prose each entity has ≈56
    /// neighbours *from one chunk alone*, plus every entity of every other chunk it
    /// appears in. An
    /// unbounded 3-hop BFS over that is not a search, it is a table scan with extra
    /// steps: hop 1 is thousands of entities, hop 2 is most of the Space.
    ///
    /// Three bounds hold it, and all three are load-bearing rather than defensive:
    ///
    /// - `max_hops = 3` — pre-existing, and the reason the multi-hop fixture
    ///   (Alice→Acme→Paris) resolves at all.
    /// - [`MAX_FRONTIER_ENTITIES`] per hop — new. Without it a hop's frontier is
    ///   `Σ out-degree` over the previous hop, which on real prose is unbounded in
    ///   the Space's size.
    /// - `limit` is now checked **inside** the per-entity loop, not only between
    ///   hops. It used to keep walking (and re-preparing SQL) long after the caller
    ///   had all the chunks it asked for.
    ///
    /// # The frontier cap is lossy — this is a retrieval trade, not a speed knob
    ///
    /// When a hop's frontier saturates, the neighbours past the cap are simply not
    /// expanded, and the survivors are whichever sort first (`ORDER BY
    /// e.dst_entity`) — alphabetical order, which has nothing to do with relevance.
    /// A chunk whose *only* path runs through a dropped entity is not returned. In a
    /// dense Space the dropped entity is usually rediscovered a hop later through a
    /// chunk it shares with a survivor, so the loss is often invisible; in a sparse
    /// one it is permanent within `max_hops`.
    /// `graph_search_frontier_truncation_can_drop_a_reachable_chunk` pins exactly
    /// that case, and `graph_search_reaches_a_two_hop_chunk_through_a_truncated_frontier`
    /// pins the other side: truncation alone does not break a two-hop answer. See
    /// [`MAX_FRONTIER_ENTITIES`] for the per-hop-vs-cumulative semantics.
    ///
    /// # Determinism
    ///
    /// The frontier was a `HashSet`, so the traversal visited entities in
    /// randomised order; whenever a Space had more reachable chunks than `limit`,
    /// **which** chunks came back varied run to run. It is now insertion-ordered
    /// (seeded in [`extract_entities`] order) and both queries carry an explicit
    /// `ORDER BY`, so the same query over the same Space returns the same chunks in
    /// the same order. Entities are also expanded at most once across all hops —
    /// re-expanding one can only re-collect chunks already collected, so this drops
    /// work without dropping reachable chunks.
    ///
    /// # The seeds carry a relevance floor; the traversal does not
    ///
    /// Query entities are filtered by [`SEED_MAX_CHUNK_FRACTION`] before the first
    /// hop, so a word that appears in most of the Space cannot seed the walk while a
    /// rarer query word can. Read that constant for why, for the two cases in which
    /// it deliberately does nothing, and for the failing-without-it test.
    ///
    /// **Everything after the seed is still unfiltered**, and that is the accepted
    /// trade rather than an oversight: hop-1..3 chunks come back with no relevance
    /// requirement of their own (a multi-hop answer has none by construction — see
    /// `graphrag_multi_hop_finds_connected_chunk_that_vector_misses`, where the
    /// correct chunk shares no word with the query), carrying a synthetic
    /// `distance` of 0.0. What orders them is BFS depth, then
    /// [`Self::apply_reranking`]'s cross-encoder pass — which reorders but never
    /// drops. The consequence for the chat path is documented on
    /// `ryu_rag::SpaceRecall`.
    async fn graph_search(
        &self,
        space_id: &str,
        query: &str,
        limit: usize,
    ) -> Result<Vec<ChunkMatch>> {
        let query_entities = extract_entities(query);
        if query_entities.is_empty() || limit == 0 {
            return Ok(Vec::new());
        }

        let conn = self.conn.lock().await;
        let query_entities = seed_entities_above_floor(&conn, space_id, query_entities)?;

        // Prepared once for the whole traversal. These used to be re-prepared per
        // entity per hop, i.e. `2 × Σ frontier` SQL parses for one search.
        let mut chunk_stmt = conn.prepare(
            "SELECT DISTINCT n.chunk_id
             FROM graph_nodes n
             WHERE n.space_id = ?1 AND n.entity = ?2
             ORDER BY n.chunk_id",
        )?;
        let mut edge_stmt = conn.prepare(
            "SELECT DISTINCT e.dst_entity
             FROM graph_edges e
             WHERE e.space_id = ?1 AND e.src_entity = ?2
             ORDER BY e.dst_entity",
        )?;

        // Seed: find chunks that directly contain a query entity.
        let mut visited_chunks = LinkedHashSet::<String>::new();
        // Every entity that has been (or is about to be) expanded, so no entity is
        // walked twice across hops.
        let mut expanded = LinkedHashSet::<String>::new();
        let mut frontier: Vec<String> = Vec::new();
        for entity in query_entities {
            if expanded.insert(entity.clone()) {
                frontier.push(entity);
            }
        }

        let max_hops = 3usize;
        'hops: for _ in 0..max_hops {
            if frontier.is_empty() || visited_chunks.len() >= limit {
                break;
            }
            let mut next_frontier: Vec<String> = Vec::new();
            // For each frontier entity, collect the chunks it appears in.
            for entity in &frontier {
                let chunk_rows = chunk_stmt
                    .query_map(params![space_id, entity], |row| row.get::<_, String>(0))?;
                for row in chunk_rows {
                    visited_chunks.insert(row?);
                    // Stop the moment the caller's budget is met: any further
                    // traversal can only produce chunks that would be truncated.
                    if visited_chunks.len() >= limit {
                        break 'hops;
                    }
                }
                // Collect neighbour entities via outgoing edges from this entity,
                // up to the per-hop frontier bound.
                if next_frontier.len() >= MAX_FRONTIER_ENTITIES {
                    continue;
                }
                let edge_rows = edge_stmt
                    .query_map(params![space_id, entity], |row| row.get::<_, String>(0))?;
                for row in edge_rows {
                    let neighbour = row?;
                    if expanded.insert(neighbour.clone()) {
                        next_frontier.push(neighbour);
                        if next_frontier.len() >= MAX_FRONTIER_ENTITIES {
                            break;
                        }
                    }
                }
            }
            frontier = next_frontier;
        }

        // Load the matched chunks.
        let mut results = Vec::new();
        for chunk_id in visited_chunks.iter().take(limit) {
            let row = conn.query_row(
                "SELECT c.id, c.document_id, c.content FROM chunks c WHERE c.id = ?1",
                params![chunk_id],
                |row| {
                    Ok(ChunkMatch {
                        chunk_id: row.get(0)?,
                        document_id: row.get(1)?,
                        content: row.get(2)?,
                        // Synthetic distance: 0.0 = direct entity hit.
                        distance: 0.0,
                    })
                },
            );
            if let Ok(chunk_match) = row {
                results.push(chunk_match);
            }
        }
        Ok(results)
    }

    /// Documents that link **to** `doc_id` (backlinks / "linked references").
    /// Each result carries the source document's title and a context snippet.
    pub async fn get_backlinks(&self, doc_id: &str) -> Result<Vec<DocLink>> {
        let conn = self.conn.lock().await;
        let target_title: String = conn
            .query_row(
                "SELECT title FROM documents WHERE id = ?1",
                params![doc_id],
                |row| row.get(0),
            )
            .optional()
            .context("reading target title")?
            .unwrap_or_default();
        let mut stmt = conn.prepare(
            "SELECT l.src_doc_id, l.dst_title, l.link_kind, d.title, d.source
             FROM document_links l
             JOIN documents d ON d.id = l.src_doc_id
             WHERE l.dst_doc_id = ?1
             ORDER BY d.title ASC",
        )?;
        let rows = stmt.query_map(params![doc_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (src_doc_id, dst_title, kind, src_title, source) = row?;
            let snippet = link_snippet(&source, &target_title);
            out.push(DocLink {
                src_doc_id,
                dst_doc_id: Some(doc_id.to_string()),
                dst_title,
                kind,
                src_title: Some(src_title),
                snippet,
            });
        }
        Ok(out)
    }

    /// Outgoing links **from** `doc_id` (resolved doc refs + pending titles).
    pub async fn get_outgoing_links(&self, doc_id: &str) -> Result<Vec<DocLink>> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare(
            "SELECT dst_doc_id, dst_title, link_kind
             FROM document_links WHERE src_doc_id = ?1
             ORDER BY dst_title ASC",
        )?;
        let rows = stmt.query_map(params![doc_id], |row| {
            Ok(DocLink {
                src_doc_id: doc_id.to_string(),
                dst_doc_id: row.get(0)?,
                dst_title: row.get(1)?,
                kind: row.get(2)?,
                src_title: None,
                snippet: None,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    /// Build the document-link graph. `space_filter = Some(id)` scopes to one
    /// Space; `None` returns the global graph across every Space. Nodes are
    /// documents plus synthetic *pending* nodes for unresolved link targets;
    /// edges are wiki/mention links and the `parent_id` hierarchy.
    ///
    /// `filter` applies [`DOC_TENANCY_VISIBLE_PREDICATE`] so on a bound node a
    /// member never sees another member's private document node — nor its title
    /// or link topology leaking through an edge. An edge (and its resolved dst /
    /// pending title) is surfaced ONLY when the caller can read its `src`
    /// document, because the link and the target title originate from the src's
    /// body; a resolved dst the caller cannot read is dropped too. Pass
    /// [`DocFilter::unrestricted`] for the in-process / unbound-node full graph
    /// (byte-identical to the pre-ACL behaviour).
    async fn build_graph(
        &self,
        space_filter: Option<&str>,
        filter: DocFilter<'_>,
    ) -> Result<DocGraph> {
        let conn = self.conn.lock().await;
        let mut graph = DocGraph::default();

        // Nodes: every document the caller may read (top-level and child row-pages
        // are all real pages).
        let doc_sql = format!(
            "SELECT d.id, d.space_id, d.title, d.kind, d.parent_id FROM documents d
             WHERE (:space IS NULL OR d.space_id = :space)
               AND {DOC_TENANCY_VISIBLE_PREDICATE}"
        );
        let mut doc_stmt = conn.prepare(&doc_sql)?;
        let doc_rows = doc_stmt.query_map(
            named_params! {
                ":space": space_filter,
                ":bound": filter.bound_flag(),
                ":uid": filter.owner_user_id,
                ":org": filter.org_id,
            },
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                ))
            },
        )?;
        // Collect nodes first; defer parent edges until the full visible set is
        // known, so a `parent` the caller cannot read never appears as an edge.
        let mut pending_parent_edges: Vec<(String, String)> = Vec::new();
        for row in doc_rows {
            let (id, space_id, title, kind, parent_id) = row?;
            graph.nodes.push(DocGraphNode {
                id: id.clone(),
                title,
                kind,
                space_id,
                pending: false,
            });
            // parent_id hierarchy edge (database → row page).
            if let Some(parent) = parent_id {
                pending_parent_edges.push((parent, id));
            }
        }
        let visible: std::collections::HashSet<String> =
            graph.nodes.iter().map(|n| n.id.clone()).collect();
        for (parent, id) in pending_parent_edges {
            if visible.contains(&parent) {
                graph.edges.push(DocGraphEdge {
                    src: parent,
                    dst: id,
                    kind: "parent".to_string(),
                });
            }
        }

        // Link edges + pending nodes. The link (and any pending/resolved target
        // title) originates from `src`'s body, so gate on `src` being visible; a
        // resolved dst the caller cannot read is dropped so it never surfaces even
        // as a node.
        let mut seen_pending: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut link_stmt = conn.prepare(
            "SELECT space_id, src_doc_id, dst_doc_id, dst_title, link_kind
             FROM document_links WHERE (?1 IS NULL OR space_id = ?1)",
        )?;
        let link_rows = link_stmt.query_map(params![space_filter], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })?;
        for row in link_rows {
            let (space_id, src, dst_doc_id, dst_title, kind) = row?;
            if !visible.contains(&src) {
                continue;
            }
            let dst = match dst_doc_id {
                Some(id) => {
                    if !visible.contains(&id) {
                        continue;
                    }
                    id
                }
                None => {
                    let pending_id = pending_node_id(&space_id, &dst_title);
                    if seen_pending.insert(pending_id.clone()) {
                        graph.nodes.push(DocGraphNode {
                            id: pending_id.clone(),
                            title: dst_title,
                            kind: "pending".to_string(),
                            space_id,
                            pending: true,
                        });
                    }
                    pending_id
                }
            };
            graph.edges.push(DocGraphEdge { src, dst, kind });
        }
        Ok(graph)
    }

    /// The document-link graph for one Space, filtered to what `filter` may read.
    pub async fn space_graph(&self, space_id: &str, filter: DocFilter<'_>) -> Result<DocGraph> {
        self.build_graph(Some(space_id), filter).await
    }

    /// The global document-link graph across all Spaces, filtered to what `filter`
    /// may read.
    pub async fn global_graph(&self, filter: DocFilter<'_>) -> Result<DocGraph> {
        self.build_graph(None, filter).await
    }

    /// Follow resolved wiki links out from `seed_doc_ids` up to `hops` and return
    /// a capped number of chunks from each newly-reached document. This is the
    /// "wiki GraphRAG" expansion: it surfaces context from pages the seed hits
    /// link to, even when those pages are not the closest vectors. Fail-open:
    /// callers treat an error as "no expansion".
    async fn expand_by_links(
        &self,
        space_id: &str,
        seed_doc_ids: &[String],
        hops: usize,
        per_doc_cap: usize,
    ) -> Result<Vec<ChunkMatch>> {
        if seed_doc_ids.is_empty() {
            return Ok(Vec::new());
        }
        let conn = self.conn.lock().await;
        let mut visited: std::collections::HashSet<String> = seed_doc_ids.iter().cloned().collect();
        let mut frontier: Vec<String> = seed_doc_ids.to_vec();
        let mut reached: Vec<String> = Vec::new();
        for _ in 0..hops {
            if frontier.is_empty() {
                break;
            }
            let mut next = Vec::new();
            for doc in &frontier {
                let mut stmt = conn.prepare(
                    "SELECT DISTINCT dst_doc_id FROM document_links
                     WHERE space_id = ?1 AND src_doc_id = ?2 AND dst_doc_id IS NOT NULL",
                )?;
                let rows = stmt.query_map(params![space_id, doc], |row| row.get::<_, String>(0))?;
                for row in rows {
                    let d = row?;
                    if visited.insert(d.clone()) {
                        next.push(d.clone());
                        reached.push(d);
                    }
                }
            }
            frontier = next;
        }

        let mut out = Vec::new();
        for doc in &reached {
            let mut stmt = conn.prepare(
                "SELECT id, document_id, content FROM chunks
                 WHERE document_id = ?1 ORDER BY ordinal LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![doc, per_doc_cap as i64], |row| {
                Ok(ChunkMatch {
                    chunk_id: row.get(0)?,
                    document_id: row.get(1)?,
                    content: row.get(2)?,
                    // Synthetic: link-reached chunks re-scored by the reranker.
                    distance: 1.0,
                })
            })?;
            for row in rows {
                out.push(row?);
            }
        }
        Ok(out)
    }

    /// Delete a Space, its documents, chunks, and their vectors. Returns true if
    /// a Space row was removed.
    pub async fn delete_space(&self, space_id: &str) -> Result<bool> {
        let mut conn = self.conn.lock().await;
        // System spaces (Artifacts, Meetings) are Ryu-owned and undeletable.
        let is_system: Option<i64> = conn
            .query_row(
                "SELECT system FROM spaces WHERE id = ?1",
                params![space_id],
                |row| row.get(0),
            )
            .optional()
            .context("checking system flag")?;
        if is_system == Some(1) {
            anyhow::bail!("space '{space_id}' is a system space and cannot be deleted");
        }
        let tx = conn.transaction().context("starting delete transaction")?;
        // Remove vectors first (vec0 has no foreign-key cascade).
        tx.execute(
            "DELETE FROM chunk_vectors WHERE rowid IN (
                 SELECT rowid FROM chunks WHERE space_id = ?1
             )",
            params![space_id],
        )
        .context("deleting chunk vectors")?;
        // chunks + documents cascade from the space row via ON DELETE CASCADE.
        let removed = tx
            .execute("DELETE FROM spaces WHERE id = ?1", params![space_id])
            .context("deleting space")?;
        tx.commit().context("committing delete transaction")?;
        Ok(removed > 0)
    }

    /// Total number of user-visible Spaces (for the danger-zone count preview).
    /// Excludes the hidden "Meetings" Space that backs meeting notes — it is not
    /// a user-created Space and the danger-zone "delete all spaces" leaves it
    /// alone, so it must not be counted either.
    pub async fn count_spaces(&self) -> Result<u64> {
        let conn = self.conn.lock().await;
        let n: i64 = conn.query_row(
            "SELECT COUNT(*) FROM spaces WHERE system = 0 AND name != ?1",
            params![MEETINGS_SPACE_NAME],
            |r| r.get(0),
        )?;
        Ok(n.max(0) as u64)
    }

    /// Delete every user-visible Space and all of its documents, chunks, and
    /// vectors in one transaction. Mirrors [`Self::delete_space`]'s teardown order
    /// (vectors first, then the space rows cascade to chunks/documents). Returns
    /// the number of Spaces removed. The hidden "Meetings" Space is **preserved**
    /// so existing meeting notes stay openable; clearing meetings is a separate
    /// action.
    pub async fn clear_all_spaces(&self) -> Result<u64> {
        let mut conn = self.conn.lock().await;
        let tx = conn.transaction().context("starting clear transaction")?;
        // Vectors first (vec0 has no foreign-key cascade) for every chunk whose
        // space is being removed, then the space rows — chunks + documents cascade
        // via ON DELETE CASCADE. The Meetings space (and its chunks/vectors) is
        // skipped on both passes.
        tx.execute(
            "DELETE FROM chunk_vectors WHERE rowid IN (
                 SELECT c.rowid FROM chunks c
                 JOIN spaces s ON s.id = c.space_id
                 WHERE s.system = 0 AND s.name != ?1
             )",
            params![MEETINGS_SPACE_NAME],
        )
        .context("deleting chunk vectors")?;
        let removed = tx
            .execute(
                "DELETE FROM spaces WHERE system = 0 AND name != ?1",
                params![MEETINGS_SPACE_NAME],
            )
            .context("deleting spaces")?;
        tx.commit().context("committing clear transaction")?;
        Ok(removed as u64)
    }

    /// Returns the graph extraction model id this store was configured with.
    pub fn graph_extraction_model_id(&self) -> &str {
        self.graph_extraction_model.as_str()
    }

    // ── Embedding model swap + re-index ──────────────────────────────────────

    /// Replace the active embedder. Does not itself re-index — callers that change
    /// the model should kick `reindex_all` afterwards so existing vectors are
    /// re-embedded into the new space.
    pub async fn set_embedder(&self, embedder: Embedder) {
        let mut guard = self.embedder.lock().await;
        *guard = embedder;
    }

    /// Report re-index progress: how many chunks were embedded by a model/dims
    /// other than the current one (and therefore await re-embedding).
    pub async fn reindex_status(&self) -> Result<ReindexStatus> {
        let (current_model, current_dims) = {
            let emb = self.embedder.lock().await;
            (emb.model_id().to_string(), emb.dims())
        };
        let (running, errored) = {
            let g = self.reindex.lock().await;
            (g.running, g.errored.clone())
        };
        let conn = self.conn.lock().await;
        let total_chunks: i64 = conn.query_row("SELECT COUNT(*) FROM chunks", [], |r| r.get(0))?;
        let pending_chunks: i64 = conn.query_row(
            "SELECT COUNT(*) FROM chunks WHERE embed_model != ?1 OR embed_dims != ?2",
            params![current_model, current_dims as i64],
            |r| r.get(0),
        )?;
        Ok(ReindexStatus {
            current_model,
            current_dims,
            total_chunks,
            pending_chunks,
            running,
            errored,
        })
    }

    /// Re-embed every chunk whose stored embedding was produced by a different
    /// model/dims, into the current model. If the dimensionality changed, the
    /// `chunk_vectors` vec0 table (whose width is fixed at creation) is dropped and
    /// recreated first. Idempotent + resumable: re-running only touches chunks that
    /// are still stale. Guarded so only one pass runs at a time.
    pub async fn reindex_all(&self) -> Result<()> {
        {
            let mut g = self.reindex.lock().await;
            if g.running {
                return Ok(());
            }
            g.running = true;
            g.errored = None;
        }
        let result = self.reindex_inner().await;
        let mut g = self.reindex.lock().await;
        g.running = false;
        if let Err(e) = &result {
            g.errored = Some(format!("{e:#}"));
        }
        result
    }

    async fn reindex_inner(&self) -> Result<()> {
        let emb = self.embedder_snapshot().await;
        let model_id = emb.model_id().to_string();
        let dims = emb.dims();

        // The vec0 table width is fixed at creation; a dims change requires
        // recreating it. All old vectors are then gone, so mark every chunk stale.
        if self.vec_dims.load(Ordering::SeqCst) != dims {
            {
                let conn = self.conn.lock().await;
                conn.execute_batch(&format!(
                    "DROP TABLE IF EXISTS chunk_vectors;
                     CREATE VIRTUAL TABLE chunk_vectors
                         USING vec0(rowid INTEGER PRIMARY KEY, embedding float[{dims}]);"
                ))
                .context("recreating chunk_vectors for new dims")?;
                conn.execute("UPDATE chunks SET embed_model = '', embed_dims = 0", [])?;
            }
            self.vec_dims.store(dims, Ordering::SeqCst);
        }

        // Re-embed stale chunks in batches; embedding happens outside the lock.
        loop {
            let batch: Vec<(String, i64, String)> = {
                let conn = self.conn.lock().await;
                let mut stmt = conn.prepare(
                    "SELECT id, rowid, content FROM chunks
                     WHERE embed_model != ?1 OR embed_dims != ?2
                     LIMIT 64",
                )?;
                let rows = stmt.query_map(params![model_id, dims as i64], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?))
                })?;
                let mut v = Vec::new();
                for row in rows {
                    v.push(row?);
                }
                v
            };
            if batch.is_empty() {
                break;
            }
            let mut embedded = Vec::with_capacity(batch.len());
            for (id, rowid, content) in &batch {
                embedded.push((id.clone(), *rowid, emb.embed(content).await?));
            }
            let mut conn = self.conn.lock().await;
            let tx = conn.transaction()?;
            for (id, rowid, vec) in &embedded {
                tx.execute("DELETE FROM chunk_vectors WHERE rowid = ?1", params![rowid])?;
                tx.execute(
                    "INSERT INTO chunk_vectors (rowid, embedding) VALUES (?1, ?2)",
                    params![rowid, vec_to_bytes(vec)],
                )?;
                tx.execute(
                    "UPDATE chunks SET embed_model = ?1, embed_dims = ?2 WHERE id = ?3",
                    params![model_id, dims as i64, id],
                )?;
            }
            tx.commit()?;
        }
        Ok(())
    }

    /// Apply a resolved default `embedder` and, if it differs from what the store
    /// opened with, kick a background re-index. The Core-side shim
    /// (`spaces::apply_saved_embedding_pref`) reads the saved `EmbeddingModelPref`
    /// and resolves it into an `Embedder` (through the single RAG resolver) before
    /// calling this — keeping the model-registry read out of the crate.
    pub async fn apply_embedder_change(&self, embedder: Embedder) {
        let changed = {
            let g = self.embedder.lock().await;
            g.model_id() != embedder.model_id() || g.dims() != embedder.dims()
        };
        self.set_embedder(embedder).await;
        if changed {
            let store = self.clone();
            tokio::spawn(async move {
                let _ = store.reindex_all().await;
            });
        }
    }
}

// ── SQLite helpers ─────────────────────────────────────────────────────────────

/// Register the sqlite-vec extension exactly once for the whole process. It is
/// installed as a SQLite *auto-extension*, so every connection opened afterwards
/// (in any module) automatically gains the `vec0` virtual table.
///
/// `pub(crate)` so sibling stores that need a `vec0`-capable connection (e.g. the
/// conversation message-embedding index) reuse the single registration rather
/// than transmuting the extension entry-point a second time.
pub(crate) fn register_sqlite_vec() {
    use std::sync::Once;
    static REGISTER: Once = Once::new();
    REGISTER.call_once(|| {
        // SAFETY: `sqlite3_vec_init` has the SQLite extension entry-point ABI and
        // sqlite3_auto_extension stores the pointer for use on connection open.
        // Mirrors sqlite-vec's own documented rusqlite registration.
        unsafe {
            rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute(
                sqlite_vec::sqlite3_vec_init as *const (),
            )));
        }
    });
}

/// Open a rusqlite connection with the sqlite-vec extension registered.
///
/// `pub(crate)` so sibling stores (e.g. the conversation message-embedding index)
/// open `vec0`-capable connections through the same code path.
pub(crate) fn open_vec_connection(path: &std::path::Path) -> Result<Connection> {
    register_sqlite_vec();
    let conn = if path == std::path::Path::new(":memory:") {
        Connection::open_in_memory().context("opening in-memory spaces db")?
    } else {
        Connection::open(path).with_context(|| format!("opening spaces db {}", path.display()))?
    };
    Ok(conn)
}

/// Apply the encryption-at-rest *direction* (see module docs). Issues a
/// `PRAGMA key` when `RYU_SPACES_KEY` is set (a no-op on non-SQLCipher builds),
/// and tightens db file permissions on Unix.
fn apply_encryption(conn: &Connection, path: Option<&std::path::Path>) -> Result<()> {
    if let Ok(key) = std::env::var("RYU_SPACES_KEY") {
        if !key.is_empty() {
            // Escape single quotes to keep the pragma well-formed.
            let escaped = key.replace('\'', "''");
            // Ignored by stock SQLite; activates real encryption under SQLCipher.
            let _ = conn.execute_batch(&format!("PRAGMA key = '{escaped}';"));
        }
    }
    #[cfg(unix)]
    if let Some(path) = path {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(path) {
            let mut perms = meta.permissions();
            perms.set_mode(0o600);
            let _ = std::fs::set_permissions(path, perms);
        }
    }
    let _ = path;
    Ok(())
}

/// Split text into chunks of at most `CHUNK_CHAR_SIZE` characters, breaking on
/// paragraph then word boundaries. Empty input yields a single empty chunk so a
/// document always has at least one searchable unit.
/// Render a database document (data-grid JSON in `source`) as plain text so its
/// cells stay searchable via the same chunk+embed path as a markdown page. The
/// JSON shape is `{ "columns": [{ "id", "label", ... }], "rows": [{ colId: value }] }`.
/// Falls back to the raw source if it isn't the expected grid JSON.
fn flatten_database_source(source: &str) -> String {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(source) else {
        return source.to_string();
    };
    let mut out = String::new();
    if let Some(columns) = value.get("columns").and_then(|c| c.as_array()) {
        let labels: Vec<String> = columns
            .iter()
            .filter_map(|col| {
                col.get("label")
                    .and_then(|l| l.as_str())
                    .or_else(|| col.get("id").and_then(|i| i.as_str()))
                    .map(str::to_string)
            })
            .collect();
        if !labels.is_empty() {
            out.push_str(&labels.join(" | "));
            out.push('\n');
        }
    }
    if let Some(rows) = value.get("rows").and_then(|r| r.as_array()) {
        for row in rows {
            if let Some(obj) = row.as_object() {
                let line = obj
                    .values()
                    .map(json_cell_to_text)
                    .collect::<Vec<_>>()
                    .join(" | ");
                if !line.trim().is_empty() {
                    out.push_str(&line);
                    out.push('\n');
                }
            }
        }
    }
    if out.trim().is_empty() {
        source.to_string()
    } else {
        out
    }
}

/// Flatten an Excalidraw scene's text elements into a plain-text rendering so a
/// whiteboard document stays searchable like a page. The stored `source` remains
/// the raw scene JSON; this is only the embedding text. Returns an empty string
/// if `source` is not valid Excalidraw scene JSON.
fn flatten_whiteboard_source(source: &str) -> String {
    let Ok(scene) = serde_json::from_str::<serde_json::Value>(source) else {
        return String::new();
    };
    let Some(elements) = scene.get("elements").and_then(|e| e.as_array()) else {
        return String::new();
    };
    let mut parts: Vec<String> = Vec::new();
    for el in elements {
        if let Some(text) = el.get("text").and_then(|t| t.as_str()) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                parts.push(trimmed.to_string());
            }
        }
    }
    parts.join("\n")
}

/// Max bytes of flattened text kept from an app document's source. Bounds the
/// embedding work + row size for an arbitrarily large app-defined JSON blob.
const APP_FLATTEN_CAP: usize = 64 * 1024;

/// Flatten an app document's source into searchable text: recursively concatenate
/// every string value in the source JSON (object values + array items, at any
/// depth), newline-joined and capped at [`APP_FLATTEN_CAP`]. App docs carry
/// app-defined JSON whose shape Core can't know, so — unlike the database/
/// whiteboard flatteners — this extracts strings generically. If `source` is not
/// valid JSON it falls back to the raw text (capped) so the doc is still
/// searchable. The stored `source` is never modified; this is only the embedding
/// text.
fn flatten_app_source(source: &str) -> String {
    let mut out = String::new();
    match serde_json::from_str::<serde_json::Value>(source) {
        Ok(value) => collect_json_strings(&value, &mut out),
        // Not JSON — treat the whole source as one text blob.
        Err(_) => out.push_str(source),
    }
    if out.len() > APP_FLATTEN_CAP {
        let mut end = APP_FLATTEN_CAP;
        while end > 0 && !out.is_char_boundary(end) {
            end -= 1;
        }
        out.truncate(end);
    }
    out
}

/// Recursively append every string value found in `value` to `out`, newline-
/// separated. Object keys and non-string scalars (numbers/booleans/null) are
/// skipped — only string *values* are searchable text. Stops descending once
/// `out` has reached [`APP_FLATTEN_CAP`] to bound work on a huge/deeply-nested
/// blob (the final truncation still enforces the exact cap).
fn collect_json_strings(value: &serde_json::Value, out: &mut String) {
    if out.len() >= APP_FLATTEN_CAP {
        return;
    }
    match value {
        serde_json::Value::String(s) => {
            let trimmed = s.trim();
            if !trimmed.is_empty() {
                if !out.is_empty() {
                    out.push('\n');
                }
                out.push_str(trimmed);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                collect_json_strings(item, out);
            }
        }
        serde_json::Value::Object(obj) => {
            for v in obj.values() {
                collect_json_strings(v, out);
            }
        }
        _ => {}
    }
}

/// Flatten one grid cell value to searchable text across all cell variants
/// (text/number/checkbox/select → scalar; multi-select → array; file → `name`).
fn json_cell_to_text(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => String::new(),
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Bool(b) => b.to_string(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::Array(items) => items
            .iter()
            .map(json_cell_to_text)
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join(", "),
        serde_json::Value::Object(obj) => obj
            .get("name")
            .or_else(|| obj.get("label"))
            .and_then(|x| x.as_str())
            .unwrap_or_default()
            .to_string(),
    }
}

fn chunk_text(content: &str) -> Vec<String> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return vec![String::new()];
    }
    let mut chunks = Vec::new();
    let mut current = String::new();
    for paragraph in trimmed.split("\n\n") {
        for word in paragraph.split_whitespace() {
            if current.chars().count() + word.chars().count() + 1 > CHUNK_CHAR_SIZE
                && !current.is_empty()
            {
                chunks.push(std::mem::take(&mut current));
            }
            if !current.is_empty() {
                current.push(' ');
            }
            current.push_str(word);
        }
        if !current.is_empty() {
            chunks.push(std::mem::take(&mut current));
        }
    }
    if chunks.is_empty() {
        chunks.push(trimmed.to_owned());
    }
    chunks
}

/// Insert a document's chunks + their vectors (and, in graph mode, the entity
/// graph). Shared by `ingest_document` and `update_document` so both paths stamp
/// the embedder identity (`embed_model`/`embed_dims`) onto every chunk.
#[allow(clippy::too_many_arguments)]
fn insert_chunks(
    tx: &rusqlite::Transaction<'_>,
    document_id: &str,
    space_id: &str,
    embedded: &[(String, Vec<f32>)],
    now: i64,
    model_id: &str,
    dims: usize,
    mode: RetrievalMode,
) -> Result<()> {
    let mut chunk_ids: Vec<String> = Vec::with_capacity(embedded.len());
    for (ordinal, (content, embedding)) in embedded.iter().enumerate() {
        let chunk_id = uuid::Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO chunks
                 (id, document_id, space_id, ordinal, content, created_at, embed_model, embed_dims)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                chunk_id,
                document_id,
                space_id,
                ordinal as i64,
                content,
                now,
                model_id,
                dims as i64
            ],
        )
        .context("inserting chunk")?;
        let rowid = tx.last_insert_rowid();
        tx.execute(
            "INSERT INTO chunk_vectors (rowid, embedding) VALUES (?1, ?2)",
            params![rowid, vec_to_bytes(embedding)],
        )
        .context("inserting chunk vector")?;
        chunk_ids.push(chunk_id);
    }

    if mode == RetrievalMode::Graph {
        let pairs: Vec<(&str, &str)> = chunk_ids
            .iter()
            .map(String::as_str)
            .zip(embedded.iter().map(|(c, _)| c.as_str()))
            .collect();
        build_graph_for_chunks(tx, space_id, &pairs)?;
    }
    Ok(())
}

/// Monotonic row-id source for `graph_nodes` / `graph_edges`.
///
/// # Why these two tables do not get a `Uuid::new_v4()` like everything else
///
/// Both tables declare `id TEXT PRIMARY KEY`. On a rowid table that is **not** an
/// alias for the rowid (only `INTEGER PRIMARY KEY` is); SQLite materialises it as a
/// separate `sqlite_autoindex_*` b-tree keyed by the text. So every graph row pays
/// an insertion into a second index, and with a v4 UUID that insertion lands at a
/// uniformly random point in the key space — no write locality, a dirty page per
/// row once the index outgrows the page cache, and page splits all the way down.
/// That is a per-row tax on the one table this crate writes *millions* of rows to:
/// [`build_graph_for_chunks`] emits `n·(n−1)` edges per chunk.
///
/// Ids here are also **write-only** — `grep 'FROM graph_nodes\|FROM graph_edges'`
/// returns counts, joins on `chunk_id`, and traversals on `src_entity`/`dst_entity`;
/// nothing anywhere selects, returns, or filters on `id`. It is a uniqueness token
/// and nothing else, so its *shape* is free to change as long as uniqueness holds.
///
/// The shape chosen is `{process-start millis:012x}{process nonce:010x}{seq:010x}`:
/// 32 hex characters, exactly the width of a `Uuid::simple()`, so the index does not
/// grow. It sorts ascending within a process (the counter) and across process
/// restarts (the timestamp), which turns a random-scatter insert into an append at
/// the right-hand edge of the b-tree.
///
/// **Uniqueness is not weakened, which is the constraint that matters.**
/// `INSERT OR IGNORE` on these tables is documented as inert — a colliding id would
/// silently *drop an edge*, i.e. change what the graph contains, which is precisely
/// the thing this work is not allowed to do. Within one process `(millis, nonce)` is
/// fixed and the `AtomicU64` counter makes every id distinct by construction (10 hex
/// = 1.1e12 ids, ~800× the largest graph ever measured here). Two *different*
/// processes collide only if they start in the same millisecond **and** draw the
/// same 40-bit nonce — 2⁻⁴⁰ — and Core runs one `SpaceStore` per process anyway.
/// A backwards clock step costs locality, never uniqueness.
///
/// Measured effect: see the table on [`build_graph_for_chunks`].
fn graph_row_id() -> String {
    static PREFIX: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let prefix = PREFIX.get_or_init(|| {
        let millis = now_millis().max(0) as u64;
        // Low 40 bits of a fresh v4 UUID: same entropy source as the ids this
        // replaces, drawn once instead of once per row.
        let nonce = uuid::Uuid::new_v4().as_u128() as u64 & 0xff_ffff_ffff;
        format!("{millis:012x}{nonce:010x}")
    });
    let seq = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    format!("{prefix}{seq:010x}")
}

/// Counts written by one [`build_graph_for_chunks`] pass: `(nodes, edges)`.
type GraphCounts = (usize, usize);

/// Write the entity/co-occurrence graph for `chunks` (`(chunk_id, content)` pairs).
///
/// **The single definition of "what a Space's graph looks like."** Both writers go
/// through it: `insert_chunks` (ingest / document update, graph mode only) and
/// [`SpaceStore::set_retrieval_mode`] (rebuild when a Space is switched to graph).
/// It exists as one function precisely so those two cannot drift — a rebuilt graph
/// that differed from an ingested one would be invisible until a query returned
/// different chunks depending on *how* the graph happened to be built.
///
/// Extraction is [`extract_entities`]: deterministic, offline co-occurrence over
/// the chunk text. No embedder, no network, no model call.
///
/// # Cost — measured, because "no model call" is not the same as "cheap"
///
/// This used to claim the absence of a model call made the rebuild "affordable
/// enough to run inline". That was never measured, and it is wrong: the expense
/// here is not the extractor, it is the **quadratic edge fan-out** it feeds.
/// [`extract_entities`] keeps every token ≥ 3 chars that is capitalised OR longer
/// than 4 — i.e. most words of ordinary prose — and this function then emits
/// `n·(n−1)` directed edges for a chunk with `n` distinct entities.
///
/// Measured, and **re-measurable** — that matters more than the exact seconds. The
/// numbers below come from `measure_graph_rebuild_cost`, an `#[ignore]`d test in
/// this file that prints them. Re-derive rather than trust:
///
/// ```text
/// cargo test --release -p ryu-spaces measure_graph_rebuild_cost -- --ignored --nocapture --test-threads=1
/// ```
///
/// Release build, English prose, `chunk_text` output averaging ~990 chars/chunk and
/// **≈57 distinct entities/chunk** (see `PROSE`; per-chunk minima of 44 appear only
/// at the short first/last boundary chunks of a small corpus and wash out as it
/// grows — a full 1,000-char prose chunk sits at 57–58):
///
/// Two rows per size, because the interesting quantity is the **difference**: the
/// `v4` line is the original measurement, taken while `graph_nodes.id` /
/// `graph_edges.id` were `Uuid::new_v4()`; the `ordered` line is the same harness
/// after [`graph_row_id`] replaced them. Same code otherwise, same corpus.
///
/// | chunks | nodes  | edge rows | id      | in-memory db | **on-disk db** | on-disk per chunk |
/// |--------|--------|-----------|---------|--------------|----------------|-------------------|
/// |     98 |  5,638 |   318,926 | v4      |       ~0.9 s |        ~2.0 s  |            ~20 ms |
/// |     98 |  5,638 |   318,926 | ordered |       0.56 s |        0.97 s  |            ~10 ms |
/// |    392 | 22,592 | 1,279,718 | v4      |       ~4.1 s |        ~9.6 s  |            ~24 ms |
/// |    392 | 22,592 | 1,279,718 | ordered |       2.39 s |        4.35 s  |            ~11 ms |
/// |  1,566 | 90,306 | 5,117,688 | v4      |      ~18.0 s |  **46 – 87 s** |         29 – 55 ms |
/// |  1,566 | 90,306 | 5,117,688 | ordered |      10.09 s |     **16.3 s** |            ~10 ms |
///
/// The **row counts are exact and reproduce byte for byte** across runs *and across
/// the id change* — 5,638/318,926, 22,592/1,279,718, 90,306/5,117,688 came back
/// identical afterwards, which is the direct evidence that the speed-up did not cost
/// a single graph row. They are a property of the algorithm, and
/// `graph_edge_count_matches_the_quadratic_fan_out` asserts the formula behind them.
///
/// The **wall clocks are not exact**: two runs of the `v4` shape on the same
/// idle-ish laptop put the 1,566-chunk on-disk case at 87 s and 46 s. That ~2× spread
/// is the honest error bar on the old rows — and it is not mere noise, it is the
/// mechanism, since a randomly-addressed index costs whatever happens to be resident.
/// The `ordered` rows vary by ~10 %, and the two sets were taken on the same machine
/// in different sessions, so read the ratio (2.8–5.3× at the bottom row) rather than
/// subtracting seconds.
///
/// **Always compare within a session.** Free disk space moves the absolute figures
/// by roughly 2× on its own: every A/B pair quoted here and on
/// `measure_attachment_stall` was taken back to back on a volume that was ~100 %
/// full, and re-running the ordered shape once the volume had ~56 GB free landed
/// materially lower again (406 KB: 7.46 s → 3.77 s) with no code change whatsoever.
/// That is why the claim made here is a ratio and never a wall clock.
///
/// **Read the on-disk column anyway.** A real Space is a file, so on-disk is the
/// production number, and at 1,566 chunks it is still **~16 s** of uninterruptible
/// SQLite work inside ONE transaction, from one UI click. What changed is the
/// *shape*: per-chunk cost used to grow with the Space (20 → 24 → 29–55 ms) as
/// `graph_edges` and its indexes outgrew the page cache, and is now flat at ~10 ms
/// across a 16× range. A bigger Space is finally a straight multiple rather than
/// worse than one — so extrapolate linearly, which the previous version of this
/// paragraph explicitly told you not to do.
///
/// Order of magnitude — seconds to tens of seconds — is all the precision the "can
/// this block a runtime worker" question needs, and it is the precision these
/// numbers actually support. Concurrent load inflates them further.
///
/// The shape is `O(chunks × entities²)`. Both factors are bounded differently:
/// - **entities per chunk is bounded by a constant.** [`chunk_text`] appends a word
///   only while the running chunk stays under [`CHUNK_CHAR_SIZE`], so a chunk holds
///   ≲ 250 tokens of ≥ 3 chars and therefore ≤ ~250 distinct entities → ≤ ~62,250
///   edges. (`chunk_text` breaks *before* appending, so a single token longer than
///   `CHUNK_CHAR_SIZE` does produce one oversized chunk — but one giant token is
///   one entity, so it cannot inflate the fan-out.)
/// - **chunk count is NOT bounded.** It is whatever the caller hands over. That is
///   the dimension to budget for.
///
/// # Every path that can reach this function runs off the async worker
///
/// That is the checkable claim, and here is the whole set to check it against —
/// **two callers, reached from four public paths, all four of which can carry graph
/// work** (`grep 'build_graph_for_chunks('`; and `grep 'INTO graph_nodes\|INTO
/// graph_edges'` returns only this function's two prepared statements, so nothing
/// writes graph rows around it — `reindex_all` re-embeds vectors and never touches
/// the graph tables):
///
/// - caller 1 — `set_retrieval_mode_blocking`, i.e.
///   [`SpaceStore::set_retrieval_mode`]: passes **every chunk in the Space** from a
///   single UI click, with no upper bound at all.
/// - caller 2 — `insert_chunks`, itself reached from three places:
///   - [`SpaceStore::ingest_document`] and [`SpaceStore::update_document`] pass
///     **one document's** chunks — which is not a bound either, since one uploaded
///     book is one document;
///   - [`SpaceStore::create_file`] passes the file's single descriptor chunk
///     (`title` + `mime`). It used to hardcode `RetrievalMode::Vector` and so never
///     reached this function — which meant a file added to a graph-mode Space got no
///     graph rows, while `set_retrieval_mode`'s rebuild (which scans that same chunk
///     row) *did* give it some. That inconsistency is fixed; the budget note is that
///     the descriptor is **not** split by [`chunk_text`] and `title` is uncapped at
///     the HTTP/MCP entry points, so this path's fan-out is bounded by the caller's
///     filename, not by `CHUNK_CHAR_SIZE`.
///
/// All four graph-carrying paths now wrap their transaction in
/// [`tokio::task::spawn_blocking`]. Ingest used to be inline, on the reasoning that
/// "one document" was a smaller input than "a whole Space" — true, and irrelevant:
/// the per-chunk cost is this same `O(chunks × entities²)` fan-out either way, so a
/// large upload parked a runtime worker for exactly as long as its own chunk count
/// implied. `graph_ingest_does_not_occupy_the_async_worker` is the guard; it counted
/// **0** scheduler ticks against the inline shape.
///
/// (The table above is *not* a measurement of ingest — it times a cold
/// `set_retrieval_mode` rebuild over already-stored chunks, whereas ingest also
/// embeds and writes `chunk_vectors`. Nobody has measured ingest end to end; if you
/// need its real number, measure it rather than reusing these digits.)
///
/// The per-row work is a bound-and-step on ONE prepared statement per table,
/// hoisted out of the loops: `rusqlite`'s `Transaction::execute` re-parses and
/// re-plans its SQL on every call, so the old shape paid one parse per row. A/B'd
/// in a single process over an identical 392-chunk / 1,279,718-edge corpus, run in
/// both orderings so cache warmth cannot explain the gap:
///
/// | ordering       | `execute` per row | one prepared statement |
/// |----------------|-------------------|------------------------|
/// | prepared first |            4.93 s |                 3.75 s |
/// | `execute` first|            5.03 s |                 3.88 s |
///
/// **≈23 % off**, with byte-identical output (22,592 nodes / 1,279,718 edges either
/// way). So the parse was real but never dominant: the remaining ~3.8 s is b-tree
/// insertion into `graph_edges` and its **three** indexes.
///
/// Three, not two — and the third is the interesting one. `idx_graph_edges_space_src`
/// and `idx_graph_edges_space_dst` are declared; the third is the
/// `sqlite_autoindex_*` SQLite materialises for `id TEXT PRIMARY KEY`, because only
/// an `INTEGER PRIMARY KEY` aliases the rowid. That index was invisible in the
/// schema and in the sentence this replaces, which used to end:
///
/// > *Nothing short of writing fewer rows changes the order of magnitude.*
///
/// **That was wrong, and it was wrong for the same reason "affordable enough to run
/// inline" was wrong before it: nobody had looked.** Feeding that hidden index a v4
/// UUID per row meant every insert landed at a uniformly random point in the key
/// space, so once it outgrew the page cache each row dirtied its own page. Replacing
/// the UUID with the ascending [`graph_row_id`] — same rows, same columns, same
/// counts, one fewer random write per row — took the chat-attachment path
/// **2–5× faster**, measured by `measure_attachment_stall`, A/B'd in both orderings
/// (v4 UUID → ordered → v4 UUID) so cache warmth cannot explain it:
///
/// | corpus | chunks | edge rows | v4 UUID id  | ordered id | speed-up |
/// |--------|--------|-----------|-------------|------------|----------|
/// |   8 KB |      8 |    26,106 | 236 / 129ms |  103–114ms |  ~1.2–2× |
/// |  32 KB |     33 |   104,918 | 1.89 / 0.78s|  414–488ms |  ~1.9–4× |
/// | 101 KB |    102 |   333,336 | 6.53 / 3.32s|  1.60–1.86s|  ~2–3.5× |
/// | 406 KB |    409 | 1,336,650 |19.9 / 38.4s |  7.46–7.83s|  ~2.7–5× |
///
/// Two figures in the UUID column because its run-to-run spread is ~2×, and that
/// spread is not noise — it *is* the mechanism, since the cost depends on how much
/// of a randomly-addressed index happens to be resident. The ordered column varies
/// by ~10 %. Note also that per-chunk cost stopped growing with corpus size (v4:
/// 29 → 94 ms/chunk; ordered: 13 → 19 ms/chunk): the super-linearity was the random
/// index outgrowing cache, not the algorithm.
///
/// One caveat on those numbers: they were taken against a **fresh** database. An
/// existing install's graph tables already hold random UUID keys, so ordered ids
/// cluster into one region of that key space rather than appending past its end. The
/// locality win holds — all new ids share a 22-character prefix and so hit one hot
/// region — but the upgrade case was not measured.
///
/// Unlike the table above, that A/B is a **one-off against code that no longer
/// exists** — there is no harness to re-run, because keeping one would mean keeping
/// a second copy of the graph builder in the test module, and "one definition of
/// what a Space's graph looks like" is the property this function exists to hold.
/// Take the 23 % as history explaining why the current shape was chosen, not as a
/// number to re-verify.
///
/// That byte-identical output is exactly why this was the optimisation taken and an
/// entity cap was not. A cap would be far faster — it attacks the `entities²` term
/// rather than the constant — but it changes **which chunks a graph query can
/// reach**, and that is a retrieval-quality decision, not a performance one.
///
/// **If you ever add a cap, say so out loud**: the multi-hop retrieval test
/// (`graphrag_multi_hop_finds_connected_chunk_that_vector_misses`) and
/// `graph_edge_count_matches_the_quadratic_fan_out` both pin today's contents, and
/// a silent cap would change which chunks a graph query can reach.
///
/// Note on `INSERT OR IGNORE`: `graph_nodes`/`graph_edges` have no UNIQUE
/// constraint beyond their `id` primary key, and [`graph_row_id`] cannot collide
/// (see its doc), so the conflict clause never actually fires today — it is inert,
/// not a de-duplicator. Callers that may run over chunks whose rows already exist
/// MUST delete the space's rows first (as `set_retrieval_mode` does), or they will
/// double-insert. **This is the constraint any future id scheme has to satisfy**: a
/// collidable id would make the clause fire and drop an edge with no error anywhere.
///
/// # What this function still does NOT fix: it holds the global connection mutex
///
/// `SpaceStore` is one `Connection` behind one `tokio::Mutex`, and every caller
/// takes that mutex for the whole transaction. So the cost above is not merely the
/// caller's latency — it is a **node-wide stall**: while a graph-mode attachment is
/// indexed, every other Space's search, every sidebar list, every concurrent upload
/// waits. `measure_attachment_stall` measures exactly that, by racing a
/// `count_spaces()` probe against the ingest, and it reports the probe's worst
/// latency as equal to the whole call to the millisecond — i.e. 100 % of the work is
/// lock-held, at every size.
///
/// [`graph_row_id`] shrank that stall by 2–5×; it did not change its shape. Two
/// follow-ups remain, both deliberately out of scope here:
///
/// - **Batch the graph phase across several transactions**, taking the mutex per
///   batch, so the *hold* is bounded by batch size rather than by document size.
///   Cheap to describe, not cheap to land: it moves the graph write out of the chunk
///   write's transaction (a crash between them leaves chunks with a partial graph,
///   repairable only by re-asserting the retrieval mode), and because
///   `graph_nodes.chunk_id`/`graph_edges.chunk_id` are `REFERENCES chunks(id)` under
///   `PRAGMA foreign_keys = ON`, a chunk deleted by a concurrent writer between two
///   batches turns today's benign race into a hard FK failure — each batch would
///   have to re-check that its chunks still exist.
/// - **A second write connection** for ingest, so bulk graph writes stop sharing a
///   mutex with interactive reads at all. That is the structural fix; the mutex, not
///   this function, is the thing that makes one slow write everyone's problem.
///
/// [`SpaceStore::set_retrieval_mode`] is the same stall an order of magnitude worse
/// (a whole-Space rebuild from one UI click) and got the same speed-up for free —
/// 46–87 s down to 16.3 s at 1,566 chunks. Sixteen seconds of node-wide freeze is
/// still a defect; it is just no longer a minute and a half of one.
///
/// The returned counts accumulate each `execute`'s **rows-affected** return value,
/// not the number of statements issued. Those are equal today precisely because the
/// conflict clause is inert — but the counts are surfaced to callers as "how big is
/// this Space's graph", and a reported number that stops matching what is stored is
/// the second defect class this work exists to remove. Reading rows-affected makes
/// them right by construction, so adding the UNIQUE index the note above invites
/// cannot silently turn these into over-reports.
fn build_graph_for_chunks(
    tx: &rusqlite::Transaction<'_>,
    space_id: &str,
    chunks: &[(&str, &str)],
) -> Result<GraphCounts> {
    // Prepared ONCE for the whole pass, not once per row. `Transaction::execute`
    // (what this used to call) parses + plans its SQL string on every invocation
    // and drops the statement afterwards, so a 4.7M-row rebuild paid 4.7M parses.
    let mut node_stmt = tx
        .prepare(
            "INSERT OR IGNORE INTO graph_nodes (id, space_id, entity, chunk_id)
             VALUES (?1, ?2, ?3, ?4)",
        )
        .context("preparing graph node insert")?;
    let mut edge_stmt = tx
        .prepare(
            "INSERT OR IGNORE INTO graph_edges
             (id, space_id, src_entity, dst_entity, chunk_id)
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .context("preparing graph edge insert")?;

    let mut nodes = 0usize;
    let mut edges = 0usize;
    for (chunk_id, chunk_content) in chunks {
        let entities = extract_entities(chunk_content);
        for entity in &entities {
            let node_id = graph_row_id();
            nodes += node_stmt
                .execute(params![node_id, space_id, entity, chunk_id])
                .context("inserting graph node")?;
        }
        for i in 0..entities.len() {
            for j in 0..entities.len() {
                if i == j {
                    continue;
                }
                let edge_id = graph_row_id();
                edges += edge_stmt
                    .execute(params![
                        edge_id,
                        space_id,
                        &entities[i],
                        &entities[j],
                        chunk_id
                    ])
                    .context("inserting graph edge")?;
            }
        }
    }
    Ok((nodes, edges))
}

/// Serialize an `f32` vector to little-endian bytes for the `vec0` BLOB binding.
fn vec_to_bytes(vec: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(vec.len() * 4);
    for value in vec {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes
}

// ── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn owned(uid: &str) -> DocOwner {
        DocOwner {
            user_id: Some(uid.to_owned()),
            org_id: Some("org1".to_owned()),
        }
    }

    /// **ResourceKey regression (task C2, deliverable #1): behavior-preserving.**
    ///
    /// `DocOwner::from_resource_key` must produce the same `(owner_user_id, org_id)`
    /// pair the choke points write today, for every shape — including the collapse
    /// (an org-only or unattributed key yields `(None, None)`, the row an UNBOUND
    /// node stamps, so no lockout regresses). The compound address composes above
    /// the collapse and never alters the emitted pair.
    #[test]
    fn doc_owner_from_resource_key_is_behavior_preserving() {
        for (user, org) in [
            (Some("u1"), Some("acme")),
            (Some("u1"), None),
            (None, None),
            (None, Some("acme")),
        ] {
            let via_key = DocOwner::from_resource_key(&ResourceKey::owned(user, org));
            let direct = DocOwner::owned(user, org);
            assert_eq!(
                via_key.parts(),
                direct.parts(),
                "ResourceKey lowering must match DocOwner::owned for ({user:?}, {org:?})"
            );
        }

        // The UNBOUND-node row: an unattributed key is byte-identical to
        // `DocOwner::unattributed()` and writes `(None, None)`.
        let unbound = DocOwner::from_resource_key(&ResourceKey::unattributed());
        assert_eq!(unbound, DocOwner::unattributed());
        assert_eq!(unbound.parts(), (None, None));

        // Compound address composes but never changes the stamped pair.
        let compound = ResourceKey::owned(Some("u1"), Some("acme"))
            .with_session(Some("conv-9"))
            .with_project(Some("/proj"));
        assert_eq!(
            DocOwner::from_resource_key(&compound).parts(),
            DocOwner::owned(Some("u1"), Some("acme")).parts()
        );

        // Round-trip through the shared key is stable.
        let o = DocOwner::owned(Some("u1"), Some("acme"));
        assert_eq!(DocOwner::from_resource_key(&o.to_resource_key()), o);
    }

    /// Per-caller tenancy for documents (the `DOC_TENANCY_VISIBLE_PREDICATE`): on a
    /// bound node a private document is visible only to its owner in `list_documents`
    /// and in RAG `search`, while its owner keeps full access (no lockout). Driven
    /// with `DocFilter::for_caller(node_bound = true)` so no org registration is
    /// needed — the caller tenancy is passed IN.
    #[tokio::test]
    async fn documents_are_filtered_per_owner_on_bound_node() {
        let store = SpaceStore::open_in_memory().unwrap();
        // Alice owns the space + one document; Bob owns another document in it.
        let space = store
            .create_space("Team", None, &owned("alice"))
            .await
            .unwrap();
        let alice_doc = store
            .ingest_document(
                &space,
                "Alice secret",
                "the launch code is 42",
                &owned("alice"),
            )
            .await
            .unwrap();
        let bob_doc = store
            .ingest_document(&space, "Bob secret", "the launch code is 42", &owned("bob"))
            .await
            .unwrap();

        // list_documents: Bob sees only his own doc; Alice only hers.
        let bob_view = store
            .list_documents(
                &space,
                DocFilter::for_caller(Some("bob"), Some("org1"), true),
            )
            .await
            .unwrap();
        let bob_ids: Vec<&str> = bob_view.iter().map(|d| d.id.as_str()).collect();
        assert!(bob_ids.contains(&bob_doc.as_str()));
        assert!(
            !bob_ids.contains(&alice_doc.as_str()),
            "Bob must not see Alice's private document"
        );

        let alice_view = store
            .list_documents(
                &space,
                DocFilter::for_caller(Some("alice"), Some("org1"), true),
            )
            .await
            .unwrap();
        let alice_ids: Vec<&str> = alice_view.iter().map(|d| d.id.as_str()).collect();
        assert!(
            alice_ids.contains(&alice_doc.as_str()),
            "no lockout: Alice reaches her own document"
        );
        assert!(!alice_ids.contains(&bob_doc.as_str()));

        // Spaces RAG search: a chunk from Alice's doc never surfaces for Bob.
        let bob_hits = store
            .search_ext(
                &space,
                "launch code",
                10,
                Some(false),
                DocFilter::for_caller(Some("bob"), Some("org1"), true),
            )
            .await
            .unwrap();
        assert!(
            bob_hits.iter().all(|c| c.document_id != alice_doc),
            "RAG search must not leak Alice's document chunk to Bob"
        );
        // Unrestricted (unbound / in-process): both documents visible.
        let all = store
            .list_documents(&space, DocFilter::unrestricted())
            .await
            .unwrap();
        assert_eq!(
            all.len(),
            2,
            "unbound/in-process listing sees every document"
        );
    }

    /// By-id ACL link: the document choke point STAMPS the owner, and
    /// `get_access_meta` (what `require_resource_read`/`_write` read) reads it back —
    /// so the pre-tested `resource_access` matrix (mod.rs `resource_acl_tests`)
    /// actually bites on a real document. A system space's document is still owned by
    /// its creator (only the SPACE is shared), and an unattributed create leaves the
    /// row NULL (which the by-id ACL denies on a bound node until backfill).
    #[tokio::test]
    async fn create_stamps_owner_for_the_by_id_acl() {
        let store = SpaceStore::open_in_memory().unwrap();
        let space = store
            .create_space("S", None, &owned("alice"))
            .await
            .unwrap();

        let alice_doc = store
            .create_page(&space, "Owned", &owned("alice"))
            .await
            .unwrap();
        let meta = store.get_access_meta(&alice_doc).await.unwrap().unwrap();
        assert_eq!(meta.owner_user_id.as_deref(), Some("alice"));
        assert_eq!(meta.org_id.as_deref(), Some("org1"));
        assert_eq!(meta.visibility, "private");

        // An unattributed create (unbound / system path) leaves the row NULL-owner —
        // exactly what `resource_access` grants on an unbound node and denies (until
        // backfill) on a bound one.
        let anon_doc = store
            .create_page(&space, "Legacy", &DocOwner::unattributed())
            .await
            .unwrap();
        let anon_meta = store.get_access_meta(&anon_doc).await.unwrap().unwrap();
        assert!(anon_meta.owner_user_id.is_none());
        assert!(anon_meta.org_id.is_none());
    }

    /// list_spaces filters by owner too, but system spaces (`system = 1`) stay
    /// shared to every member (the `OR s.system = 1` predicate branch).
    #[tokio::test]
    async fn list_spaces_filters_owner_but_keeps_system_shared() {
        let store = SpaceStore::open_in_memory().unwrap();
        let alice_space = store
            .create_space("Alice", None, &owned("alice"))
            .await
            .unwrap();
        let _bob_space = store
            .create_space("Bob", None, &owned("bob"))
            .await
            .unwrap();
        let sys = store.ensure_system_space("Artifacts", None).await.unwrap();

        let bob_view = store
            .list_spaces(DocFilter::for_caller(Some("bob"), Some("org1"), true))
            .await
            .unwrap();
        let ids: Vec<&str> = bob_view.iter().map(|s| s.id.as_str()).collect();
        assert!(
            !ids.contains(&alice_space.as_str()),
            "Bob must not see Alice's private space"
        );
        assert!(
            ids.contains(&sys.as_str()),
            "system space stays shared to every member"
        );
    }

    /// The link graph must not leak another member's private document node, title,
    /// or link topology on a bound node — and must be byte-identical (full graph)
    /// on an unbound / unrestricted call. Twin of
    /// `list_spaces_filters_owner_but_keeps_system_shared` for `build_graph`.
    #[tokio::test]
    async fn graph_filters_private_nodes_and_edges_on_bound_node() {
        let store = SpaceStore::open_in_memory().unwrap();
        let space = store
            .create_space("Shared", None, &owned("alice"))
            .await
            .unwrap();
        // Alice's private page links to Bob's private page.
        let alice_doc = store
            .create_page(&space, "AlicePriv", &owned("alice"))
            .await
            .unwrap();
        let bob_doc = store
            .create_page(&space, "BobPriv", &owned("bob"))
            .await
            .unwrap();
        store
            .update_document(&alice_doc, "AlicePriv", "Secret note about [[BobPriv]].")
            .await
            .unwrap();

        // Bound node, viewed as Bob: Alice's node/title and the edge originating
        // from Alice's body must be absent.
        let bob_graph = store
            .space_graph(
                &space,
                DocFilter::for_caller(Some("bob"), Some("org1"), true),
            )
            .await
            .unwrap();
        assert!(
            bob_graph.nodes.iter().all(|n| n.id != alice_doc),
            "Bob must not see Alice's private document node"
        );
        assert!(
            bob_graph.nodes.iter().all(|n| n.title != "AlicePriv"),
            "Bob must not see Alice's private document title"
        );
        assert!(
            bob_graph.edges.iter().all(|e| e.src != alice_doc),
            "no edge may originate from a document Bob cannot read"
        );
        assert!(
            bob_graph.nodes.iter().any(|n| n.id == bob_doc),
            "Bob still sees his own document"
        );

        // Unrestricted (unbound / in-process): the full graph, both nodes + the edge.
        let full = store
            .space_graph(&space, DocFilter::unrestricted())
            .await
            .unwrap();
        assert!(full.nodes.iter().any(|n| n.id == alice_doc));
        assert!(full.nodes.iter().any(|n| n.id == bob_doc));
        assert!(
            full.edges
                .iter()
                .any(|e| e.src == alice_doc && e.dst == bob_doc),
            "unrestricted graph keeps the cross-owner edge"
        );
    }

    /// `space_access_meta` reads back the owner the choke point stamped, and marks a
    /// system space so the `delete_space` gate can fail it closed on a bound node.
    #[tokio::test]
    async fn space_access_meta_reads_owner_and_system_flag() {
        let store = SpaceStore::open_in_memory().unwrap();
        let alice_space = store
            .create_space("Alice", None, &owned("alice"))
            .await
            .unwrap();
        let sys = store.ensure_system_space("Artifacts", None).await.unwrap();

        let meta = store
            .space_access_meta(&alice_space)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(meta.owner_user_id.as_deref(), Some("alice"));
        assert_eq!(meta.org_id.as_deref(), Some("org1"));
        assert!(!meta.system);

        let sys_meta = store.space_access_meta(&sys).await.unwrap().unwrap();
        assert!(sys_meta.system, "system space is flagged");
        assert!(
            sys_meta.owner_user_id.is_none(),
            "system space has no owner"
        );

        assert!(store.space_access_meta("nope").await.unwrap().is_none());
    }

    // De-risk gate: proves the sqlite-vec C extension actually links and the
    // vec0 KNN path works on this platform (cargo check cannot verify linking).
    #[test]
    fn vec0_links_and_knn_round_trips() {
        let conn = open_vec_connection(std::path::Path::new(":memory:")).unwrap();
        conn.execute_batch(
            "CREATE VIRTUAL TABLE v USING vec0(rowid INTEGER PRIMARY KEY, embedding float[4]);",
        )
        .unwrap();
        let a = vec_to_bytes(&[1.0, 0.0, 0.0, 0.0]);
        let b = vec_to_bytes(&[0.0, 1.0, 0.0, 0.0]);
        conn.execute(
            "INSERT INTO v (rowid, embedding) VALUES (1, ?1)",
            params![a],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO v (rowid, embedding) VALUES (2, ?1)",
            params![b],
        )
        .unwrap();
        let query = vec_to_bytes(&[0.9, 0.1, 0.0, 0.0]);
        let mut stmt = conn
            .prepare("SELECT rowid FROM v WHERE embedding MATCH ?1 AND k = 1 ORDER BY distance")
            .unwrap();
        let nearest: i64 = stmt.query_row(params![query], |row| row.get(0)).unwrap();
        assert_eq!(nearest, 1, "row 1 should be the nearest neighbor");
    }

    #[tokio::test]
    async fn clear_all_spaces_preserves_meetings_space() {
        let store = SpaceStore::open_in_memory().unwrap();
        store
            .create_space("Notes", None, &DocOwner::unattributed())
            .await
            .unwrap();
        store
            .create_space("Research", None, &DocOwner::unattributed())
            .await
            .unwrap();
        store
            .create_space(MEETINGS_SPACE_NAME, None, &DocOwner::unattributed())
            .await
            .unwrap();

        // The hidden Meetings space is excluded from the count.
        assert_eq!(store.count_spaces().await.unwrap(), 2);

        // Clear removes only the two user spaces, leaving Meetings intact.
        let removed = store.clear_all_spaces().await.unwrap();
        assert_eq!(removed, 2);
        assert_eq!(store.count_spaces().await.unwrap(), 0);
        let remaining = store.list_spaces(DocFilter::unrestricted()).await.unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].name, MEETINGS_SPACE_NAME);
    }

    #[test]
    fn blob_store_round_trips_and_dedupes() {
        // sha256 is deterministic and content-addressed.
        let root = std::env::temp_dir().join(format!("ryu-spaces-blob-{}", uuid::Uuid::new_v4()));
        let bytes = b"hello artifact";
        let sha1 = write_blob(&root, bytes).unwrap();
        let sha2 = write_blob(&root, bytes).unwrap();
        assert_eq!(sha1, sha2, "identical bytes dedupe to one blob");
        assert_eq!(sha1, sha256_hex(bytes), "returned sha matches content hash");
        let read = read_blob(&root, &sha1).unwrap();
        assert_eq!(read.as_deref(), Some(&bytes[..]));
        // Unknown sha reads as absent, not error.
        assert!(read_blob(&root, "0".repeat(64).as_str()).unwrap().is_none());
    }

    #[tokio::test]
    async fn file_document_and_system_space_are_governed() {
        let store = SpaceStore::open_in_memory().unwrap();

        // A system space is created, flagged, and excluded from the user count.
        let artifacts = store
            .ensure_system_space("Artifacts", Some("Generated files"))
            .await
            .unwrap();
        // ensure_* is idempotent: same name reuses the row.
        let again = store.ensure_system_space("Artifacts", None).await.unwrap();
        assert_eq!(artifacts, again);
        store
            .create_space("Notes", None, &DocOwner::unattributed())
            .await
            .unwrap();
        assert_eq!(
            store.count_spaces().await.unwrap(),
            1,
            "system space uncounted"
        );

        // A file document stores its bytes in the blob store and stays retrievable.
        let png = b"\x89PNG\r\n\x1a\n binary artifact bytes";
        let doc = store
            .create_file(
                &artifacts,
                "chart.png",
                png,
                "image/png",
                &DocOwner::unattributed(),
            )
            .await
            .unwrap();
        let meta = store.get_file_meta(&doc).await.unwrap().unwrap();
        assert_eq!(meta.mime, "image/png");
        assert_eq!(meta.byte_size, png.len() as i64);
        assert!(!meta.sha256.is_empty());
        let (mime, bytes) = store.read_file_blob(&doc).await.unwrap().unwrap();
        assert_eq!(mime, "image/png");
        assert_eq!(bytes, png);

        // A system space cannot be deleted individually.
        assert!(store.delete_space(&artifacts).await.is_err());
        // And bulk-clear leaves it intact.
        store.clear_all_spaces().await.unwrap();
        let remaining = store.list_spaces(DocFilter::unrestricted()).await.unwrap();
        assert!(remaining.iter().any(|s| s.id == artifacts));
    }

    #[tokio::test]
    async fn page_create_edit_search_delete() {
        let store = SpaceStore::open_in_memory().unwrap();
        let space = store
            .create_space("Notes", None, &DocOwner::unattributed())
            .await
            .unwrap();

        // New empty page.
        let doc = store
            .create_page(&space, "Untitled", &DocOwner::unattributed())
            .await
            .unwrap();
        let got = store.get_document(&doc).await.unwrap().unwrap();
        assert_eq!(got.title, "Untitled");
        assert_eq!(got.source, "");
        assert_eq!(got.chunk_count, 0);

        // Edit it: source round-trips and chunks/embeddings are produced.
        store
            .update_document(
                &doc,
                "Rust Notes",
                "Rust is a systems programming language.",
            )
            .await
            .unwrap();
        let got = store.get_document(&doc).await.unwrap().unwrap();
        assert_eq!(got.title, "Rust Notes");
        assert!(got.source.contains("systems"));
        assert!(got.chunk_count >= 1);

        // Embed-on-save makes it searchable.
        let results = store
            .search(&space, "programming language", 5)
            .await
            .unwrap();
        assert!(results.iter().any(|r| r.content.contains("Rust")));

        // Delete removes the document and its chunks.
        assert!(store.delete_document(&doc).await.unwrap());
        assert!(store.get_document(&doc).await.unwrap().is_none());
        assert!(!store.delete_document(&doc).await.unwrap());
    }

    // ── Wiki page-links: extraction, backlinks, graph, link-expansion ───────────

    #[test]
    fn extract_doc_links_parses_wiki_and_mention() {
        let src = "Intro. See [[Design Doc]] and [[Roadmap|our plan]].\n\
                   Ping [[@Alice]] about it. Repeat [[Design Doc]] again.";
        let links = extract_doc_links(src);
        // Dedup by (title, kind): Design Doc appears twice → one entry.
        assert_eq!(links.len(), 3);
        assert!(links
            .iter()
            .any(|l| l.title == "Design Doc" && l.kind == "wiki"));
        assert!(links
            .iter()
            .any(|l| l.title == "Roadmap" && l.kind == "wiki"));
        assert!(links
            .iter()
            .any(|l| l.title == "Alice" && l.kind == "mention"));
    }

    #[test]
    fn extract_doc_links_parses_editor_link_forms() {
        // The editor's canonical serialization: markdown links with a scheme.
        let src = "See [Design Doc](<wikilink:Design Doc>) and \
                   [@Bob](mention:Bob) plus [Encoded](<wikilink:Two%20Words>).";
        let links = extract_doc_links(src);
        assert!(links
            .iter()
            .any(|l| l.title == "Design Doc" && l.kind == "wiki"));
        assert!(links
            .iter()
            .any(|l| l.title == "Bob" && l.kind == "mention"));
        // Percent-encoding is decoded back to the real title.
        assert!(links
            .iter()
            .any(|l| l.title == "Two Words" && l.kind == "wiki"));
    }

    #[tokio::test]
    async fn wiki_links_resolve_and_backlinks_round_trip() {
        let store = SpaceStore::open_in_memory().unwrap();
        let space = store
            .create_space("Wiki", None, &DocOwner::unattributed())
            .await
            .unwrap();
        let a = store
            .create_page(&space, "Alpha", &DocOwner::unattributed())
            .await
            .unwrap();
        let b = store
            .create_page(&space, "Bravo", &DocOwner::unattributed())
            .await
            .unwrap();
        store
            .update_document(&a, "Alpha", "Alpha links to [[Bravo]] here.")
            .await
            .unwrap();

        // Outgoing link from A resolves to B.
        let out = store.get_outgoing_links(&a).await.unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].dst_doc_id.as_deref(), Some(b.as_str()));
        assert_eq!(out[0].dst_title, "Bravo");

        // Backlink on B points to A with a snippet.
        let back = store.get_backlinks(&b).await.unwrap();
        assert_eq!(back.len(), 1);
        assert_eq!(back[0].src_doc_id, a);
        assert_eq!(back[0].src_title.as_deref(), Some("Alpha"));
        assert!(back[0].snippet.as_deref().unwrap_or("").contains("Bravo"));
    }

    #[tokio::test]
    async fn pending_link_resolves_when_target_created() {
        let store = SpaceStore::open_in_memory().unwrap();
        let space = store
            .create_space("Wiki", None, &DocOwner::unattributed())
            .await
            .unwrap();
        let a = store
            .create_page(&space, "Alpha", &DocOwner::unattributed())
            .await
            .unwrap();
        store
            .update_document(&a, "Alpha", "Refers to [[Ghost]] which is missing.")
            .await
            .unwrap();

        // Unresolved → pending link + a pending node in the graph.
        let out = store.get_outgoing_links(&a).await.unwrap();
        assert_eq!(out.len(), 1);
        assert!(out[0].dst_doc_id.is_none());
        let graph = store
            .space_graph(&space, DocFilter::unrestricted())
            .await
            .unwrap();
        assert!(graph.nodes.iter().any(|n| n.pending && n.title == "Ghost"));

        // Creating the target page back-fills the pending link.
        let ghost = store
            .create_page(&space, "Ghost", &DocOwner::unattributed())
            .await
            .unwrap();
        let out = store.get_outgoing_links(&a).await.unwrap();
        assert_eq!(out[0].dst_doc_id.as_deref(), Some(ghost.as_str()));
        let graph = store
            .space_graph(&space, DocFilter::unrestricted())
            .await
            .unwrap();
        assert!(!graph.nodes.iter().any(|n| n.pending));
    }

    #[tokio::test]
    async fn rename_target_unresolves_then_reresolves() {
        let store = SpaceStore::open_in_memory().unwrap();
        let space = store
            .create_space("Wiki", None, &DocOwner::unattributed())
            .await
            .unwrap();
        let a = store
            .create_page(&space, "Alpha", &DocOwner::unattributed())
            .await
            .unwrap();
        let b = store
            .create_page(&space, "Bravo", &DocOwner::unattributed())
            .await
            .unwrap();
        store
            .update_document(&a, "Alpha", "Points at [[Bravo]].")
            .await
            .unwrap();
        assert_eq!(store.get_backlinks(&b).await.unwrap().len(), 1);

        // Rename B → its inbound link (matched by old title) unresolves to pending.
        store.update_document(&b, "Charlie", "").await.unwrap();
        assert!(store.get_backlinks(&b).await.unwrap().is_empty());
        assert!(store.get_outgoing_links(&a).await.unwrap()[0]
            .dst_doc_id
            .is_none());

        // Point A at the new title → re-resolves.
        store
            .update_document(&a, "Alpha", "Points at [[Charlie]].")
            .await
            .unwrap();
        assert_eq!(store.get_backlinks(&b).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn expand_by_links_reaches_linked_document_chunks() {
        let store = SpaceStore::open_in_memory().unwrap();
        let space = store
            .create_space("Wiki", None, &DocOwner::unattributed())
            .await
            .unwrap();
        let a = store
            .create_page(&space, "Alpha", &DocOwner::unattributed())
            .await
            .unwrap();
        let b = store
            .create_page(&space, "Bravo", &DocOwner::unattributed())
            .await
            .unwrap();
        store
            .update_document(&a, "Alpha", "Alpha content links [[Bravo]].")
            .await
            .unwrap();
        store
            .update_document(&b, "Bravo", "Bravo has unique zephyr content.")
            .await
            .unwrap();

        // Seeded at A, expansion reaches B's chunks.
        let reached = store
            .expand_by_links(&space, &[a.clone()], 2, 3)
            .await
            .unwrap();
        assert!(reached.iter().any(|c| c.document_id == b));

        // A document with no outgoing links reaches nothing.
        let none = store.expand_by_links(&space, &[b], 2, 3).await.unwrap();
        assert!(none.is_empty());
    }

    #[tokio::test]
    async fn delete_document_turns_inbound_links_pending() {
        let store = SpaceStore::open_in_memory().unwrap();
        let space = store
            .create_space("Wiki", None, &DocOwner::unattributed())
            .await
            .unwrap();
        let a = store
            .create_page(&space, "Alpha", &DocOwner::unattributed())
            .await
            .unwrap();
        let b = store
            .create_page(&space, "Bravo", &DocOwner::unattributed())
            .await
            .unwrap();
        store
            .update_document(&a, "Alpha", "See [[Bravo]].")
            .await
            .unwrap();
        assert!(store.delete_document(&b).await.unwrap());

        // A's link survives but is now pending (target gone).
        let out = store.get_outgoing_links(&a).await.unwrap();
        assert_eq!(out.len(), 1);
        assert!(out[0].dst_doc_id.is_none());
        let graph = store
            .space_graph(&space, DocFilter::unrestricted())
            .await
            .unwrap();
        assert!(graph.nodes.iter().any(|n| n.pending && n.title == "Bravo"));
    }

    #[tokio::test]
    async fn reindex_clears_pending_and_restamps_model() {
        let store = SpaceStore::open_in_memory().unwrap();
        let space = store
            .create_space("R", None, &DocOwner::unattributed())
            .await
            .unwrap();
        let doc = store
            .create_page(&space, "T", &DocOwner::unattributed())
            .await
            .unwrap();
        store
            .update_document(&doc, "T", "hello world content here")
            .await
            .unwrap();

        // Simulate chunks left behind by a previous embedding model.
        {
            let conn = store.conn.lock().await;
            conn.execute("UPDATE chunks SET embed_model = 'old-model'", [])
                .unwrap();
        }
        let before = store.reindex_status().await.unwrap();
        assert!(before.pending_chunks >= 1);
        // Stale chunks must not surface in search.
        assert!(store
            .search(&space, "hello world", 5)
            .await
            .unwrap()
            .is_empty());

        store.reindex_all().await.unwrap();
        let after = store.reindex_status().await.unwrap();
        assert_eq!(after.pending_chunks, 0);
        assert!(!after.running);
        // Re-embedded chunks are searchable again.
        assert!(!store
            .search(&space, "hello world", 5)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn reindex_recreates_vectors_on_dims_change() {
        let store = SpaceStore::open_in_memory().unwrap();
        let space = store
            .create_space("D", None, &DocOwner::unattributed())
            .await
            .unwrap();
        let doc = store
            .create_page(&space, "T", &DocOwner::unattributed())
            .await
            .unwrap();
        store
            .update_document(&doc, "T", "vectors of a different width")
            .await
            .unwrap();

        // Swap to a Local embedder with a different dimensionality, then reindex.
        let new_dims = DEFAULT_EMBED_DIMS / 2;
        store.set_embedder(Embedder::Local { dims: new_dims }).await;
        store.reindex_all().await.unwrap();

        let status = store.reindex_status().await.unwrap();
        assert_eq!(status.current_dims, new_dims);
        assert_eq!(status.pending_chunks, 0);
        // Search still works against the recreated vec0 table.
        assert!(!store
            .search(&space, "different width", 5)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn create_ingest_list_and_search() {
        let store = SpaceStore::open_in_memory().unwrap();
        let space_id = store
            .create_space("Docs", Some("test space"), &DocOwner::unattributed())
            .await
            .unwrap();

        let spaces = store.list_spaces(DocFilter::unrestricted()).await.unwrap();
        assert_eq!(spaces.len(), 1);
        assert_eq!(spaces[0].name, "Docs");
        assert_eq!(spaces[0].document_count, 0);

        store
            .ingest_document(
                &space_id,
                "Cats",
                "Cats are small carnivorous mammals.",
                &DocOwner::unattributed(),
            )
            .await
            .unwrap();
        store
            .ingest_document(
                &space_id,
                "Rust",
                "Rust is a systems programming language.",
                &DocOwner::unattributed(),
            )
            .await
            .unwrap();

        let docs = store
            .list_documents(&space_id, DocFilter::unrestricted())
            .await
            .unwrap();
        assert_eq!(docs.len(), 2);
        assert!(docs.iter().all(|d| d.chunk_count >= 1));

        let spaces = store.list_spaces(DocFilter::unrestricted()).await.unwrap();
        assert_eq!(spaces[0].document_count, 2);

        let results = store
            .search(&space_id, "programming language", 1)
            .await
            .unwrap();
        assert_eq!(results.len(), 1);
        assert!(results[0].content.contains("Rust"));
    }

    #[tokio::test]
    async fn ingest_into_missing_space_fails() {
        let store = SpaceStore::open_in_memory().unwrap();
        let err = store
            .ingest_document("nope", "t", "body", &DocOwner::unattributed())
            .await
            .unwrap_err();
        assert!(err.to_string().contains("not found"));
    }

    #[tokio::test]
    async fn delete_space_removes_documents() {
        let store = SpaceStore::open_in_memory().unwrap();
        let space_id = store
            .create_space("Temp", None, &DocOwner::unattributed())
            .await
            .unwrap();
        store
            .ingest_document(
                &space_id,
                "Doc",
                "some content here",
                &DocOwner::unattributed(),
            )
            .await
            .unwrap();
        assert!(store.delete_space(&space_id).await.unwrap());
        assert!(store
            .list_spaces(DocFilter::unrestricted())
            .await
            .unwrap()
            .is_empty());
        assert!(!store.delete_space(&space_id).await.unwrap());
    }

    #[test]
    fn chunk_text_splits_large_input() {
        let big = "word ".repeat(500);
        let chunks = chunk_text(&big);
        assert!(chunks.len() > 1);
        assert!(chunks.iter().all(|c| c.chars().count() <= CHUNK_CHAR_SIZE));
    }

    #[test]
    fn flatten_app_source_extracts_nested_strings() {
        let src = r#"{
            "title": "hello",
            "nested": { "deep": "world", "count": 42, "flag": true },
            "items": ["one", "two", null, ["three"]]
        }"#;
        let flat = flatten_app_source(src);
        for want in ["hello", "world", "one", "two", "three"] {
            assert!(
                flat.contains(want),
                "flattened text missing {want:?}: {flat:?}"
            );
        }
        // Non-string scalars (numbers/booleans/null) are not searchable text.
        assert!(!flat.contains("42"));
        assert!(!flat.contains("true"));
        // Non-JSON falls back to the raw source so it stays searchable.
        assert_eq!(flatten_app_source("just plain text"), "just plain text");
    }

    #[test]
    fn flatten_app_source_caps_output() {
        // A huge JSON array of strings is capped at APP_FLATTEN_CAP bytes.
        let big: Vec<String> = (0..20_000).map(|i| format!("token{i}")).collect();
        let src = serde_json::to_string(&big).unwrap();
        let flat = flatten_app_source(&src);
        assert!(flat.len() <= APP_FLATTEN_CAP);
    }

    #[tokio::test]
    async fn app_docs_are_kind_isolated_and_embed() {
        let store = SpaceStore::open_in_memory().unwrap();
        let space = store
            .create_space("AppSpace", None, &DocOwner::unattributed())
            .await
            .unwrap();

        // App A creates and can read its own doc.
        let doc = store
            .app_create_doc("app.a", &space, "Doc A", &DocOwner::unattributed())
            .await
            .unwrap();
        let got = store.app_get_doc("app.a", &doc).await.unwrap();
        assert!(got.is_some());
        assert_eq!(got.unwrap().kind, "app:app.a");

        // App B cannot read app A's doc (foreign kind → None, not an error).
        assert!(store.app_get_doc("app.b", &doc).await.unwrap().is_none());

        // A built-in page is invisible to any app.
        let page = store
            .create_page(&space, "Builtin Page", &DocOwner::unattributed())
            .await
            .unwrap();
        assert!(store.app_get_doc("app.a", &page).await.unwrap().is_none());

        // App B cannot mutate app A's doc (kind-checked FIRST → error).
        assert!(store
            .app_update_doc("app.b", &doc, None, "x")
            .await
            .is_err());
        assert!(store.app_delete_doc("app.b", &doc).await.is_err());

        // App A can update its own doc — this runs the flatten + embed path, so the
        // doc gains chunks and becomes searchable.
        store
            .app_update_doc(
                "app.a",
                &doc,
                Some("Renamed"),
                r#"{"note":"searchable app content here"}"#,
            )
            .await
            .unwrap();

        // Listing is scoped per app: A sees exactly its one doc (not the page); B none.
        let list_a = store.app_list_docs("app.a", &space).await.unwrap();
        assert_eq!(list_a.len(), 1);
        assert_eq!(list_a[0].id, doc);
        assert_eq!(list_a[0].title, "Renamed");
        assert!(store
            .app_list_docs("app.b", &space)
            .await
            .unwrap()
            .is_empty());

        // The flattened app content is embedded and retrievable.
        let hits = store
            .search(&space, "searchable app content", 5)
            .await
            .unwrap();
        assert!(hits
            .iter()
            .any(|c| c.content.contains("searchable app content")));

        // App A can delete its own doc; afterwards its list is empty.
        store.app_delete_doc("app.a", &doc).await.unwrap();
        assert!(store
            .app_list_docs("app.a", &space)
            .await
            .unwrap()
            .is_empty());
    }

    // ── AC1: existing vector-mode Spaces are unchanged ─────────────────────────

    #[tokio::test]
    async fn default_space_uses_vector_mode() {
        let store = SpaceStore::open_in_memory().unwrap();
        let space_id = store
            .create_space("VectorSpace", None, &DocOwner::unattributed())
            .await
            .unwrap();
        let spaces = store.list_spaces(DocFilter::unrestricted()).await.unwrap();
        assert_eq!(spaces[0].retrieval_mode, RetrievalMode::Vector);
        // Confirm vector search works normally.
        store
            .ingest_document(
                &space_id,
                "Doc",
                "Cats are small carnivorous mammals.",
                &DocOwner::unattributed(),
            )
            .await
            .unwrap();
        let results = store.search(&space_id, "small mammals", 5).await.unwrap();
        assert!(!results.is_empty());
    }

    // ── AC2 + AC4: GraphRAG multi-hop integration test ─────────────────────────
    //
    // Fixture design:
    //   Chunk A: "Alice works at Acme."          → entities: alice, works, acme
    //   Chunk B: "Acme is based in Paris."        → entities: acme, based, paris
    //   Chunk C: "Paris has the Eiffel Tower."    → entities: paris, eiffel, tower
    //
    // Query: "Alice"
    //
    // Graph traversal: Alice→Acme (edge from A) → Paris (edge from B) → chunk C.
    // A 2-hop BFS captures chunk C which the direct "Alice" query entity does not
    // touch (chunk C has no "Alice" token).
    //
    // Vector nearest-neighbor (limit=1): Returns chunk A (direct "alice" match).
    // Requesting only 1 result proves that chunk C — which shares zero tokens
    // with the query — is not the nearest neighbor, so graph can surface it
    // while the nearest-neighbor cannot.
    //
    // The test asserts:
    //   (a) graph mode returns chunk C  (multi-hop hit)
    //   (b) vector mode top-1 returns chunk A (direct match), not chunk C

    #[tokio::test]
    async fn graphrag_multi_hop_finds_connected_chunk_that_vector_misses() {
        let store = SpaceStore::open_in_memory().unwrap();

        // Create a GRAPH-mode Space.
        let graph_space = store
            .create_space_with_mode(
                "GraphSpace",
                None,
                RetrievalMode::Graph,
                &DocOwner::unattributed(),
            )
            .await
            .unwrap();

        // Ingest three-chunk fixture.
        store
            .ingest_document(
                &graph_space,
                "ChunkA",
                "Alice works at Acme.",
                &DocOwner::unattributed(),
            )
            .await
            .unwrap();
        store
            .ingest_document(
                &graph_space,
                "ChunkB",
                "Acme is based in Paris.",
                &DocOwner::unattributed(),
            )
            .await
            .unwrap();
        store
            .ingest_document(
                &graph_space,
                "ChunkC",
                "Paris has the Eiffel Tower.",
                &DocOwner::unattributed(),
            )
            .await
            .unwrap();

        // (a) Graph search for "Alice" should find chunk C via multi-hop traversal.
        let graph_results = store.search(&graph_space, "Alice", 10).await.unwrap();
        let graph_contents: Vec<&str> = graph_results.iter().map(|c| c.content.as_str()).collect();
        assert!(
            graph_contents.iter().any(|c| c.contains("Eiffel")),
            "graph mode should find ChunkC (Eiffel Tower) via Alice→Acme→Paris traversal; \
             got: {graph_contents:?}"
        );

        // (b) Vector search with limit=1 returns the NEAREST NEIGHBOR — chunk A
        // (direct "alice" token match). Chunk C has no "Alice" tokens so it is
        // not the nearest neighbor, proving graph traversal found something pure
        // nearest-neighbor search does not return when constrained to 1 result.
        let vector_space = store
            .create_space_with_mode(
                "VectorSpace",
                None,
                RetrievalMode::Vector,
                &DocOwner::unattributed(),
            )
            .await
            .unwrap();
        store
            .ingest_document(
                &vector_space,
                "ChunkA",
                "Alice works at Acme.",
                &DocOwner::unattributed(),
            )
            .await
            .unwrap();
        store
            .ingest_document(
                &vector_space,
                "ChunkB",
                "Acme is based in Paris.",
                &DocOwner::unattributed(),
            )
            .await
            .unwrap();
        store
            .ingest_document(
                &vector_space,
                "ChunkC",
                "Paris has the Eiffel Tower.",
                &DocOwner::unattributed(),
            )
            .await
            .unwrap();

        // Nearest-neighbor only — must be chunk A (direct Alice match).
        let vector_top1 = store.search(&vector_space, "Alice", 1).await.unwrap();
        assert_eq!(
            vector_top1.len(),
            1,
            "vector search limit=1 should return exactly 1 chunk"
        );
        assert!(
            vector_top1[0].content.contains("Alice"),
            "top-1 vector result for 'Alice' should be chunk A (direct entity match); \
             got: {:?}",
            vector_top1[0].content
        );
        assert!(
            !vector_top1[0].content.contains("Eiffel"),
            "top-1 vector result should be chunk A not chunk C; \
             got: {:?}",
            vector_top1[0].content
        );

        // Graph retrieved more than 1 chunk, including the 2-hop chunk C.
        assert!(
            graph_results.len() > vector_top1.len(),
            "graph search (limit=10) should find more chunks than vector top-1; \
             graph={}, vector_top1={}",
            graph_results.len(),
            vector_top1.len()
        );
    }

    /// **A file uploaded to a Graph Space must be as retrievable as the same file
    /// uploaded to a Vector Space that is later flipped to Graph.**
    ///
    /// `create_file` used to hardcode `RetrievalMode::Vector`, so it never reached
    /// [`build_graph_for_chunks`] — while [`SpaceStore::set_retrieval_mode`]'s
    /// rebuild scans `SELECT id, content FROM chunks`, which *does* include the file's
    /// descriptor chunk. The result was that the same file in the same Space was
    /// findable or not depending on the order the user did things, and the natural
    /// order (create a Graph Space → upload → ask) was the broken one.
    ///
    /// The assertion is deliberately an **equality against the rebuild**, not "some
    /// rows exist": the rebuild is the only other definition of what a Space's graph
    /// should contain, so pinning ingest to it is what stops the two drifting again.
    #[tokio::test]
    async fn a_file_added_to_a_graph_space_gets_the_same_graph_rows_as_a_rebuild() {
        const TITLE: &str = "quarterly revenue report.csv";
        const MIME: &str = "text/csv";
        let bytes = b"period,revenue\nQ1,10\n";
        let store = SpaceStore::open_in_memory().unwrap();

        // Path 1 — the natural flow: Graph Space first, then upload.
        let graph_space = store
            .create_space_with_mode(
                "GraphSpace",
                None,
                RetrievalMode::Graph,
                &DocOwner::unattributed(),
            )
            .await
            .unwrap();
        store
            .create_file(&graph_space, TITLE, bytes, MIME, &DocOwner::unattributed())
            .await
            .unwrap();
        let ingested = graph_row_counts(&store, &graph_space).await;
        assert!(
            ingested.0 > 0 && ingested.1 > 0,
            "a file uploaded to a graph-mode Space must carry graph rows; got {ingested:?}"
        );

        // Path 2 — the flow that always worked: upload to a Vector Space, flip after.
        let flipped = store
            .create_space_with_mode(
                "FlippedSpace",
                None,
                RetrievalMode::Vector,
                &DocOwner::unattributed(),
            )
            .await
            .unwrap();
        store
            .create_file(&flipped, TITLE, bytes, MIME, &DocOwner::unattributed())
            .await
            .unwrap();
        assert_eq!(
            graph_row_counts(&store, &flipped).await,
            (0, 0),
            "a vector-mode Space must still write no graph rows"
        );
        store
            .set_retrieval_mode(&flipped, RetrievalMode::Graph)
            .await
            .unwrap()
            .expect("space exists");
        assert_eq!(
            ingested,
            graph_row_counts(&store, &flipped).await,
            "upload-into-graph and upload-then-flip must produce the SAME graph"
        );

        // And the point of all of it: the file answers a graph query. (Only the
        // descriptor — title + mime — is ever chunked for a file, in either mode; the
        // bytes are not extracted here. That is `document.parse`'s job, and its
        // output reaches a Space through `ingest_document`.)
        let hits = store
            .graph_search(&graph_space, "revenue", 5)
            .await
            .unwrap();
        assert!(
            hits.iter().any(|c| c.content.contains(TITLE)),
            "graph traversal must reach the uploaded file's descriptor chunk; got {hits:?}"
        );
    }

    /// **The graph seed floor ([`SEED_MAX_CHUNK_FRACTION`]): a Space-wide-common word
    /// must not crowd out the rare word the user actually asked about.**
    ///
    /// Without the floor this fails outright, and not marginally: `graph_search`
    /// stops collecting the moment `limit` chunks are visited, so seeding on
    /// `platform` (in 12 of 13 chunks, and first in [`extract_entities`] order) fills
    /// the budget with chunks that merely share a common word and the traversal never
    /// reaches `kryptonite` at all. The answer chunk is not ranked low — it is never
    /// visited. That list's head is then merged at rank parity with the best cosine
    /// hit on every chat turn (see `ryu_rag::fuse_ranked_lists`), which is why this is
    /// a retrieval defect rather than a nicety.
    ///
    /// The second half pins the escape hatch: when **every** query entity floods, no
    /// floor is applied, because "weakly grounded" beats "nothing". The third case —
    /// a Space too small for the statistic — is pinned by
    /// `graphrag_multi_hop_finds_connected_chunk_that_vector_misses` (3 chunks, below
    /// [`SEED_FLOOR_MIN_CHUNKS`]), which must keep passing unchanged.
    #[tokio::test]
    async fn graph_seed_floor_keeps_a_common_word_from_crowding_out_a_rare_one() {
        const COMMON_DOCS: usize = 12;
        let store = SpaceStore::open_in_memory().unwrap();
        let space = store
            .create_space_with_mode(
                "Flood",
                None,
                RetrievalMode::Graph,
                &DocOwner::unattributed(),
            )
            .await
            .unwrap();
        // 12 chunks sharing `platform` + `ledger`, and one that shares nothing with
        // them. 13 ≥ SEED_FLOOR_MIN_CHUNKS, so the floor is in force.
        for i in 0..COMMON_DOCS {
            store
                .ingest_document(
                    &space,
                    &format!("D{i}"),
                    &format!("platform ledger entry number{i} routing"),
                    &DocOwner::unattributed(),
                )
                .await
                .unwrap();
        }
        store
            .ingest_document(
                &space,
                "Answer",
                "kryptonite quarantine vault",
                &DocOwner::unattributed(),
            )
            .await
            .unwrap();

        // `platform` sorts first in the query, and appears in 12/13 chunks; the floor
        // is what stops it seeding while `kryptonite` (1/13) can.
        let hits = store
            .graph_search(&space, "platform kryptonite", 3)
            .await
            .unwrap();
        assert!(
            hits.iter().any(|c| c.content.contains("kryptonite")),
            "the rare query entity must seed the traversal; got {hits:?}"
        );
        assert!(
            hits.iter().all(|c| c.content.contains("kryptonite")),
            "chunks that share only a Space-wide-common word must not fill the \
             result; got {hits:?}"
        );

        // Escape hatch: a query whose every entity floods the Space seeds exactly as
        // it did before the floor existed, rather than returning nothing.
        let all_common = store
            .graph_search(&space, "platform ledger", 3)
            .await
            .unwrap();
        assert_eq!(
            all_common.len(),
            3,
            "when every query entity floods, the floor must not apply; got {all_common:?}"
        );
    }

    // ── Changing an existing Space's retrieval mode ────────────────────────────

    /// Count this space's graph rows — the thing that decides whether `graph_search`
    /// can answer anything at all.
    async fn graph_row_counts(store: &SpaceStore, space_id: &str) -> (i64, i64) {
        let conn = store.conn.lock().await;
        let nodes = conn
            .query_row(
                "SELECT COUNT(*) FROM graph_nodes WHERE space_id = ?1",
                params![space_id],
                |r| r.get(0),
            )
            .unwrap();
        let edges = conn
            .query_row(
                "SELECT COUNT(*) FROM graph_edges WHERE space_id = ?1",
                params![space_id],
                |r| r.get(0),
            )
            .unwrap();
        (nodes, edges)
    }

    /// **The defect this method exists to prevent.**
    ///
    /// A Space ingested in vector mode has no entity graph. If switching to graph
    /// only flipped the column, `search_ext` would dispatch to `graph_search`, whose
    /// BFS seeds from `graph_nodes` — and would return nothing. This asserts the
    /// switch rebuilds the graph from the chunks already on disk, and that the
    /// multi-hop traversal then works on content ingested *before* the switch.
    #[tokio::test]
    async fn switching_to_graph_rebuilds_the_graph_so_search_actually_works() {
        let store = SpaceStore::open_in_memory().unwrap();
        let space = store
            .create_space("Later", None, &DocOwner::unattributed())
            .await
            .unwrap();
        for (title, body) in [
            ("ChunkA", "Alice works at Acme."),
            ("ChunkB", "Acme is based in Paris."),
            ("ChunkC", "Paris has the Eiffel Tower."),
        ] {
            store
                .ingest_document(&space, title, body, &DocOwner::unattributed())
                .await
                .unwrap();
        }
        // Ingested in vector mode ⇒ no graph exists yet.
        assert_eq!(graph_row_counts(&store, &space).await, (0, 0));

        let change = store
            .set_retrieval_mode(&space, RetrievalMode::Graph)
            .await
            .unwrap()
            .expect("space exists");
        assert_eq!(change.previous, RetrievalMode::Vector);
        assert_eq!(change.mode, RetrievalMode::Graph);
        assert!(change.changed);
        assert!(change.graph_rebuilt);
        assert_eq!(change.chunks_scanned, 3);
        assert!(change.graph_nodes > 0, "rebuild must write entity nodes");
        assert!(change.graph_edges > 0, "rebuild must write co-occurrences");

        let (nodes, edges) = graph_row_counts(&store, &space).await;
        assert_eq!(nodes as usize, change.graph_nodes);
        assert_eq!(edges as usize, change.graph_edges);

        // The column moved AND retrieval follows it.
        assert_eq!(
            store.space_mode(&space).await.unwrap(),
            RetrievalMode::Graph
        );
        let hits = store.search(&space, "Alice", 10).await.unwrap();
        assert!(
            hits.iter().any(|c| c.content.contains("Eiffel")),
            "after the switch, Alice→Acme→Paris multi-hop must reach ChunkC \
             (this is what an empty graph would silently fail to do); got: {:?}",
            hits.iter().map(|c| &c.content).collect::<Vec<_>>()
        );
    }

    /// Re-asserting `graph` on a Space that is already `graph` must not duplicate
    /// rows. The tables carry no UNIQUE constraint (their `INSERT OR IGNORE` is
    /// inert), so this is only true because the method clears before rebuilding.
    /// It doubles as the graph *repair* path.
    #[tokio::test]
    async fn re_asserting_graph_mode_rebuilds_idempotently() {
        let store = SpaceStore::open_in_memory().unwrap();
        let space = store
            .create_space_with_mode("G", None, RetrievalMode::Graph, &DocOwner::unattributed())
            .await
            .unwrap();
        store
            .ingest_document(
                &space,
                "Doc",
                "Alice works at Acme.",
                &DocOwner::unattributed(),
            )
            .await
            .unwrap();
        let before = graph_row_counts(&store, &space).await;
        assert!(before.0 > 0);

        let change = store
            .set_retrieval_mode(&space, RetrievalMode::Graph)
            .await
            .unwrap()
            .unwrap();
        assert!(!change.changed, "same mode ⇒ changed = false");
        assert!(change.graph_rebuilt, "…but the graph is still repaired");
        assert_eq!(
            graph_row_counts(&store, &space).await,
            before,
            "a second rebuild must not double the rows"
        );

        // And a third pass is still stable.
        store
            .set_retrieval_mode(&space, RetrievalMode::Graph)
            .await
            .unwrap();
        assert_eq!(graph_row_counts(&store, &space).await, before);
    }

    /// Ingest and rebuild must produce the SAME graph — they share
    /// [`build_graph_for_chunks`] precisely so they cannot drift. This pins that:
    /// a Space born in graph mode and a Space converted into graph mode, over
    /// identical content, end up with identical row counts and identical answers.
    #[tokio::test]
    async fn rebuilt_graph_matches_an_ingest_built_graph() {
        let store = SpaceStore::open_in_memory().unwrap();
        let docs = [
            ("ChunkA", "Alice works at Acme."),
            ("ChunkB", "Acme is based in Paris."),
            ("ChunkC", "Paris has the Eiffel Tower."),
        ];

        let born = store
            .create_space_with_mode(
                "Born",
                None,
                RetrievalMode::Graph,
                &DocOwner::unattributed(),
            )
            .await
            .unwrap();
        let converted = store
            .create_space("Converted", None, &DocOwner::unattributed())
            .await
            .unwrap();
        for (title, body) in docs {
            for space in [&born, &converted] {
                store
                    .ingest_document(space, title, body, &DocOwner::unattributed())
                    .await
                    .unwrap();
            }
        }
        store
            .set_retrieval_mode(&converted, RetrievalMode::Graph)
            .await
            .unwrap();

        assert_eq!(
            graph_row_counts(&store, &born).await,
            graph_row_counts(&store, &converted).await,
            "a rebuilt graph must be shaped exactly like an ingested one"
        );
        let born_hits = store.search(&born, "Alice", 10).await.unwrap().len();
        let converted_hits = store.search(&converted, "Alice", 10).await.unwrap().len();
        assert_eq!(born_hits, converted_hits);
    }

    /// Switching back to vector drops the graph (nothing maintains it in vector
    /// mode), restores KNN retrieval, and leaves chunk vectors intact — so the
    /// round trip is lossless and never re-embeds.
    #[tokio::test]
    async fn switching_to_vector_drops_the_graph_and_keeps_vectors() {
        let store = SpaceStore::open_in_memory().unwrap();
        let space = store
            .create_space_with_mode(
                "RoundTrip",
                None,
                RetrievalMode::Graph,
                &DocOwner::unattributed(),
            )
            .await
            .unwrap();
        store
            .ingest_document(
                &space,
                "Doc",
                "Cats are small carnivorous mammals.",
                &DocOwner::unattributed(),
            )
            .await
            .unwrap();
        assert!(graph_row_counts(&store, &space).await.0 > 0);

        let change = store
            .set_retrieval_mode(&space, RetrievalMode::Vector)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(change.previous, RetrievalMode::Graph);
        assert!(change.changed);
        assert!(!change.graph_rebuilt);
        assert_eq!(change.chunks_scanned, 0);
        assert_eq!(graph_row_counts(&store, &space).await, (0, 0));

        // Vector retrieval works without a re-index: the chunk vectors were never
        // touched, so a semantic (non-token-overlapping) query still hits.
        assert_eq!(
            store.space_mode(&space).await.unwrap(),
            RetrievalMode::Vector
        );
        assert!(!store
            .search(&space, "small mammals", 5)
            .await
            .unwrap()
            .is_empty());

        // …and switching back rebuilds from those same chunks.
        let back = store
            .set_retrieval_mode(&space, RetrievalMode::Graph)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(back.chunks_scanned, 1);
        assert!(graph_row_counts(&store, &space).await.0 > 0);
    }

    /// A missing Space is `Ok(None)`, not an error and not a silent success — the
    /// HTTP layer turns it into a 404.
    #[tokio::test]
    async fn setting_mode_on_a_missing_space_reports_not_found() {
        let store = SpaceStore::open_in_memory().unwrap();
        assert!(store
            .set_retrieval_mode("nope", RetrievalMode::Graph)
            .await
            .unwrap()
            .is_none());
    }

    /// Documents ingested *after* a switch to graph must join the same graph — the
    /// ingest path reads the (now updated) column, so the two writers stay coherent.
    #[tokio::test]
    async fn documents_ingested_after_the_switch_extend_the_graph() {
        let store = SpaceStore::open_in_memory().unwrap();
        let space = store
            .create_space("Growing", None, &DocOwner::unattributed())
            .await
            .unwrap();
        store
            .ingest_document(
                &space,
                "ChunkA",
                "Alice works at Acme.",
                &DocOwner::unattributed(),
            )
            .await
            .unwrap();
        store
            .set_retrieval_mode(&space, RetrievalMode::Graph)
            .await
            .unwrap();
        let after_rebuild = graph_row_counts(&store, &space).await;

        store
            .ingest_document(
                &space,
                "ChunkB",
                "Acme is based in Paris.",
                &DocOwner::unattributed(),
            )
            .await
            .unwrap();
        let after_ingest = graph_row_counts(&store, &space).await;
        assert!(
            after_ingest.0 > after_rebuild.0,
            "post-switch ingest must keep extending the graph"
        );
        let hits = store.search(&space, "Alice", 10).await.unwrap();
        assert!(hits.iter().any(|c| c.content.contains("Paris")));
    }

    /// The strict parse used at every caller boundary. Distinct from the lenient
    /// `from_str` used on DB reads — conflating them is how a typo becomes a
    /// silently-vector Space.
    #[test]
    fn retrieval_mode_parse_is_strict() {
        assert_eq!(RetrievalMode::parse("vector"), Some(RetrievalMode::Vector));
        assert_eq!(RetrievalMode::parse("graph"), Some(RetrievalMode::Graph));
        for bad in ["graphrag", "Graph", "GRAPH", "vec", "", " graph"] {
            assert!(
                RetrievalMode::parse(bad).is_none(),
                "{bad:?} must not parse"
            );
        }
        // The wire form round-trips through both directions and matches what serde
        // emits, so the column, the JSON body, and the API response agree.
        for mode in [RetrievalMode::Vector, RetrievalMode::Graph] {
            assert_eq!(RetrievalMode::parse(mode.as_str()), Some(mode));
            assert_eq!(
                serde_json::to_string(&mode).unwrap(),
                format!("\"{}\"", mode.as_str())
            );
        }
        // The DB-read path stays lenient by design: an unknown column value
        // degrades to vector rather than failing every search on that Space.
        assert_eq!(RetrievalMode::from_str("graphrag"), RetrievalMode::Vector);
    }

    // ── AC3: retrieval mode + extraction model are registry-configurable ────────
    // (The `ModelRegistry`-level tests for this live Core-side in the `spaces`
    // shim's test module, since `ModelRegistry` is a Core type.)

    #[test]
    fn space_store_reports_graph_extraction_model() {
        let store = SpaceStore::open_in_memory().unwrap();
        assert_eq!(store.graph_extraction_model_id(), "local-cooccurrence");
    }

    // ── Entity extraction unit tests ───────────────────────────────────────────

    #[test]
    fn extract_entities_normalizes_to_lowercase() {
        let entities = extract_entities("Alice works at Acme.");
        assert!(entities.contains(&"alice".to_owned()));
        assert!(entities.contains(&"acme".to_owned()));
    }

    #[test]
    fn extract_entities_bridge_consistent_across_chunks() {
        // The bridge entity "Acme" must normalize to the same key in both chunks.
        let a = extract_entities("Alice works at Acme.");
        let b = extract_entities("Acme is based in Paris.");
        assert!(a.contains(&"acme".to_owned()));
        assert!(b.contains(&"acme".to_owned()));
    }

    #[test]
    fn retrieval_mode_serializes_and_deserializes() {
        let v = RetrievalMode::Vector;
        let g = RetrievalMode::Graph;
        assert_eq!(v.as_str(), "vector");
        assert_eq!(g.as_str(), "graph");
        assert_eq!(RetrievalMode::from_str("vector"), RetrievalMode::Vector);
        assert_eq!(RetrievalMode::from_str("graph"), RetrievalMode::Graph);
        assert_eq!(RetrievalMode::from_str("unknown"), RetrievalMode::Vector);
    }

    // ── Graph cost / bound regressions (H3) ───────────────────────────────────
    //
    // These exist because the rebuild's cost was *documented* rather than measured,
    // and the documented figure ("pure SQL + string work", "affordable enough to
    // run inline") was wrong by two orders of magnitude on a real Space. The two
    // tests below pin the two things the corrected docs assert: what the graph
    // CONTAINS (so a later speed-up cannot quietly shrink it) and that a query over
    // a dense graph is bounded and deterministic.
    //
    // Ordinary English prose on purpose — `extract_entities` keeps every token ≥ 3
    // chars that is capitalised or longer than 4, so a synthetic fixture of short
    // repeated words would understate the fan-out that makes this expensive.
    const PROSE: &str = "The quarterly revenue report from Acme Corporation shows that \
        European operations delivered stronger margins than the North American division, \
        largely because logistics costs in Rotterdam and Hamburg fell after the shipping \
        contract renegotiation completed in March. Analysts covering the industrial sector \
        expect similar improvements at competing firms, although currency exposure remains \
        a meaningful risk for companies without hedging programs. Management reiterated \
        guidance for the full year and announced additional investment in automation across \
        three manufacturing facilities. ";

    /// Prose that `chunk_text` splits into roughly `target_chunks` chunks near
    /// [`CHUNK_CHAR_SIZE`]. The `marker{i}` tokens keep chunks textually distinct so
    /// nothing collapses into one document-level entity set.
    fn prose_corpus(target_chunks: usize) -> String {
        let reps = (target_chunks * CHUNK_CHAR_SIZE / PROSE.len()).max(1);
        let mut out = String::new();
        for i in 0..reps {
            out.push_str(PROSE);
            out.push_str(&format!("marker{i} "));
        }
        out
    }

    /// **Pins what the graph CONTAINS: `n` entities per chunk ⇒ `n` nodes and
    /// `n·(n−1)` directed edges, exactly.**
    ///
    /// The cost documented on [`build_graph_for_chunks`] is `O(chunks × entities²)`,
    /// and the fix taken for it (hoisting the two INSERTs onto prepared statements)
    /// was chosen *because* it preserves this identity byte for byte. A cap on
    /// entities per chunk, a narrower `extract_entities`, or emitting one direction
    /// instead of two would each be a legitimate optimisation — and each would break
    /// this assertion, which is the point: they change which chunks a graph query
    /// can reach, so they must be argued for, not slipped in.
    ///
    /// **Both properties of [`graph_row_id`] at once: strictly ascending (the
    /// performance property) and all-distinct (the correctness property).**
    ///
    /// They are asserted together because each alone is satisfiable by a broken
    /// generator — a constant is "ascending" if you only check `>=`, and a v4 UUID is
    /// distinct while being the random-scatter insert this replaced. Ascending is
    /// what turns the `TEXT PRIMARY KEY` insert into an append at the right edge of
    /// its b-tree; distinct is what keeps the `INSERT OR IGNORE` on `graph_nodes` /
    /// `graph_edges` inert, and an inert conflict clause is the only reason a
    /// collision cannot silently *drop an edge*.
    ///
    /// String comparison, not numeric, because that is what SQLite's index orders by:
    /// the ids are `TEXT`, so the fixed-width zero-padded hex encoding is doing real
    /// work and a formatting change that dropped the padding would show up here.
    ///
    /// The second, independent guard on the same property is
    /// `graph_edge_count_matches_the_quadratic_fan_out`: it compares reported counts
    /// (accumulated from each `execute`'s rows-affected) against the `n·(n−1)`
    /// formula, so any collision that made the conflict clause fire would under-count
    /// and fail it. This test says the ids are sound; that one says the graph a real
    /// ingest wrote is still the graph it was.
    #[test]
    fn graph_row_ids_are_unique_and_monotonic() {
        const N: usize = 100_000;
        let ids: Vec<String> = (0..N).map(|_| graph_row_id()).collect();
        assert!(
            ids.windows(2).all(|w| w[0] < w[1]),
            "graph row ids must sort strictly ascending as TEXT — that is the whole \
             point of not using a v4 UUID here"
        );
        let distinct: std::collections::HashSet<&String> = ids.iter().collect();
        assert_eq!(
            distinct.len(),
            N,
            "a duplicate id makes INSERT OR IGNORE fire and silently drops a graph row"
        );
        // Fixed width: a variable-length id would sort lexicographically wrong the
        // moment the counter gained a digit, which is exactly how a "monotonic" id
        // scheme regresses into a random one without anything failing.
        assert!(
            ids.iter().all(|id| id.len() == 32),
            "ids must be 32 hex chars"
        );
    }

    /// Asserted on the *rebuild* path (`set_retrieval_mode`) so the reported counts,
    /// the stored rows, and the formula are checked against each other at once.
    #[tokio::test]
    async fn graph_edge_count_matches_the_quadratic_fan_out() {
        let store = SpaceStore::open_in_memory().unwrap();
        let space = store
            .create_space("Dense", None, &DocOwner::unattributed())
            .await
            .unwrap();
        let corpus = prose_corpus(6);
        let per_chunk: Vec<usize> = chunk_text(&corpus)
            .iter()
            .map(|c| extract_entities(c).len())
            .collect();
        // Guard the guard: if the fixture ever degenerated into a couple of tiny
        // chunks this test would pass while proving nothing about fan-out.
        assert!(
            per_chunk.len() >= 4,
            "fixture must span several chunks, got {}",
            per_chunk.len()
        );
        assert!(
            per_chunk.iter().all(|n| *n >= 20),
            "fixture chunks must be entity-dense (this is what makes the graph \
             expensive); got {per_chunk:?}"
        );
        let expected_nodes: usize = per_chunk.iter().sum();
        let expected_edges: usize = per_chunk.iter().map(|n| n * n.saturating_sub(1)).sum();

        store
            .ingest_document(&space, "Dense", &corpus, &DocOwner::unattributed())
            .await
            .unwrap();
        let change = store
            .set_retrieval_mode(&space, RetrievalMode::Graph)
            .await
            .unwrap()
            .expect("space exists");

        assert_eq!(change.chunks_scanned, per_chunk.len());
        assert_eq!(
            change.graph_nodes, expected_nodes,
            "one node per entity occurrence"
        );
        assert_eq!(
            change.graph_edges, expected_edges,
            "n·(n−1) directed edges per chunk — if you meant to change this, change \
             the cost docs on build_graph_for_chunks in the same commit"
        );
        // Reported counts must equal what is actually stored.
        let (nodes, edges) = graph_row_counts(&store, &space).await;
        assert_eq!(nodes as usize, expected_nodes);
        assert_eq!(edges as usize, expected_edges);
    }

    /// **A query over a dense co-occurrence graph must terminate in bounded work and
    /// return the same chunks every time.**
    ///
    /// With ≈57 entities per chunk every entity has ≈56 neighbours, so an
    /// unbounded 3-hop BFS reaches essentially the whole Space. `graph_search` now
    /// stops the moment `limit` chunks are collected (previously it only checked
    /// between hops) and carries at most [`MAX_FRONTIER_ENTITIES`] into the next
    /// hop.
    ///
    /// The determinism half is a real defect, not a nicety: the frontier used to be
    /// a `HashSet`, so on any Space with more reachable chunks than `limit` the
    /// answer to an identical query changed between runs.
    #[tokio::test]
    async fn graph_search_is_bounded_and_deterministic_on_a_dense_space() {
        let store = SpaceStore::open_in_memory().unwrap();
        let space = store
            .create_space_with_mode(
                "Dense",
                None,
                RetrievalMode::Graph,
                &DocOwner::unattributed(),
            )
            .await
            .unwrap();
        let corpus = prose_corpus(12);
        let total_chunks = chunk_text(&corpus).len();
        store
            .ingest_document(&space, "Dense", &corpus, &DocOwner::unattributed())
            .await
            .unwrap();
        assert!(
            total_chunks > 5,
            "fixture must hold more chunks than the limit under test"
        );

        // Bounded: never more than asked for, even though the traversal could reach
        // every chunk in the Space.
        let first = store.graph_search(&space, "logistics", 5).await.unwrap();
        assert!(
            first.len() <= 5,
            "graph_search returned {} chunks for limit=5",
            first.len()
        );
        assert!(
            !first.is_empty(),
            "a query entity present in the corpus must hit"
        );

        // Deterministic: identical query ⇒ identical chunks in identical order.
        for _ in 0..3 {
            let again = store.graph_search(&space, "logistics", 5).await.unwrap();
            assert_eq!(
                again.iter().map(|c| &c.chunk_id).collect::<Vec<_>>(),
                first.iter().map(|c| &c.chunk_id).collect::<Vec<_>>(),
                "graph_search must be stable across runs"
            );
        }

        // A limit larger than the Space cannot invent chunks, and the public
        // `search` entry point honours the limit through reranking too.
        let wide = store
            .graph_search(&space, "logistics", 10_000)
            .await
            .unwrap();
        assert!(wide.len() <= total_chunks);
        let via_search = store.search(&space, "logistics", 3).await.unwrap();
        assert!(via_search.len() <= 3);
    }

    /// `limit = 0` must not walk the graph at all. Cheap, but it is the boundary the
    /// new "check the budget inside the loop" logic is built on.
    #[tokio::test]
    async fn graph_search_with_zero_limit_returns_nothing() {
        let store = SpaceStore::open_in_memory().unwrap();
        let space = store
            .create_space_with_mode("G", None, RetrievalMode::Graph, &DocOwner::unattributed())
            .await
            .unwrap();
        store
            .ingest_document(
                &space,
                "A",
                "Alice works at Acme.",
                &DocOwner::unattributed(),
            )
            .await
            .unwrap();
        assert!(store
            .graph_search(&space, "Alice", 0)
            .await
            .unwrap()
            .is_empty());
    }

    /// **Exercises [`MAX_FRONTIER_ENTITIES`].** A bound whose truncation branch no
    /// test ever executes is a bound that might not take effect — the same defect
    /// family as the mode flag that could not take effect.
    ///
    /// `prose_corpus` cannot reach the cap: it repeats one paragraph, so the whole
    /// corpus has ≈57 shared entities plus one `marker{i}` per chunk, and a frontier
    /// tops out in the dozens. This fixture instead gives every chunk its own 30
    /// unique tokens around one shared hub, so the hub's out-degree is `30 ×
    /// chunks` — asserted below to exceed the cap, so the truncation is provably
    /// reached rather than assumed.
    ///
    /// Be precise about what this does and does not establish, because a bound test
    /// that overstates itself is the same species of defect as the bound it guards:
    ///
    /// - **Does:** prove the truncation branch executes over real stored data (the
    ///   hub's degree is read back from `graph_edges` and asserted to exceed the
    ///   cap), and that a search whose frontier is truncated still terminates,
    ///   obeys `limit`, and returns the same chunks in the same order every run.
    /// - **Does not:** prove the cap is what determines the *result*. Every chunk
    ///   here contains the hub, so hop 1 already collects all of them and this test
    ///   would pass with the cap set to 5 or to 5,000.
    ///
    /// That second half is no longer a gap in the file, only in this test:
    /// `graph_search_frontier_truncation_can_drop_a_reachable_chunk` closes it by
    /// putting a chunk behind a bridge entity that the cap drops, and it fails the
    /// moment the cap is lifted. It stays sized from the constant rather than from
    /// the literal 512, so retuning the cap re-scales the fixture instead of
    /// silently un-testing the bound.
    #[tokio::test]
    async fn graph_search_truncates_an_oversized_frontier() {
        let store = SpaceStore::open_in_memory().unwrap();
        let space = store
            .create_space_with_mode("Hub", None, RetrievalMode::Graph, &DocOwner::unattributed())
            .await
            .unwrap();
        const DOCS: usize = 24;
        const UNIQUE_PER_DOC: usize = 30;
        for doc in 0..DOCS {
            let mut text = String::from("hubentity ");
            for tok in 0..UNIQUE_PER_DOC {
                text.push_str(&format!("satellite{doc}x{tok} "));
            }
            store
                .ingest_document(&space, &format!("D{doc}"), &text, &DocOwner::unattributed())
                .await
                .unwrap();
        }

        // The truncation branch is only reached if the hub really does have more
        // neighbours than the cap. Assert that from the data, not from arithmetic.
        let hub_degree: i64 = {
            let conn = store.conn.lock().await;
            conn.query_row(
                "SELECT COUNT(DISTINCT dst_entity) FROM graph_edges
                 WHERE space_id = ?1 AND src_entity = 'hubentity'",
                params![space],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert!(
            hub_degree as usize > MAX_FRONTIER_ENTITIES,
            "fixture must overflow the frontier cap to exercise it; hub degree was \
             {hub_degree}, cap is {MAX_FRONTIER_ENTITIES}"
        );

        // A limit far above the Space's size means the traversal never short-circuits
        // on `limit`, so the cap is the only thing bounding hop 2.
        let wide = store
            .graph_search(&space, "hubentity", 10_000)
            .await
            .unwrap();
        assert!(
            wide.len() <= DOCS,
            "traversal returned {} chunks for a {DOCS}-chunk Space",
            wide.len()
        );
        assert!(!wide.is_empty(), "the hub entity must hit its own chunks");
        for _ in 0..3 {
            let again = store
                .graph_search(&space, "hubentity", 10_000)
                .await
                .unwrap();
            assert_eq!(
                again.iter().map(|c| &c.chunk_id).collect::<Vec<_>>(),
                wide.iter().map(|c| &c.chunk_id).collect::<Vec<_>>(),
                "a truncated frontier must truncate the SAME way every run"
            );
        }
    }

    /// Builds a Space whose hub entity provably overflows [`MAX_FRONTIER_ENTITIES`],
    /// plus a two-hop path off it: `hubentity → <bridge> → <answer chunk>`.
    ///
    /// Shared by the two traversal-bound tests so they differ in exactly ONE
    /// variable — where the bridge sorts relative to the satellites — which is the
    /// variable the cap keys on (`ORDER BY e.dst_entity`, so truncation keeps the
    /// lexicographically smallest neighbours). Everything else is identical, so a
    /// difference in outcome can only be the cap.
    ///
    /// Layout, all lowercase because [`extract_entities`] normalizes:
    /// - `docs` hub chunks, each `hubentity` + `{satellite_prefix}{d}x{t}`. Sized
    ///   from the constant, never from a literal, so retuning the cap cannot make
    ///   the fixture vacuous.
    /// - one **bridge** chunk: `hubentity {bridge}` — and nothing else, so the
    ///   bridge co-occurs with the hub and with the answer, and with no satellite.
    ///   That is what makes the negative case genuinely unreachable: a dense fixture
    ///   would rediscover a truncated entity one hop later through a shared chunk.
    /// - one **answer** chunk: `{bridge} zzzanswerfact` — no `hubentity`, so it can
    ///   only be reached by traversal, never as a direct hit.
    ///
    /// Returns `(store, space_id, answer_chunk_content)`.
    async fn hub_fixture(
        satellite_prefix: &str,
        bridge: &str,
    ) -> (SpaceStore, String, &'static str) {
        const UNIQUE_PER_DOC: usize = 30;
        // Comfortably past the cap whatever the cap is, so the truncation branch is
        // reached and enough entities are left over to be dropped.
        let docs = (MAX_FRONTIER_ENTITIES + 64).div_ceil(UNIQUE_PER_DOC);

        let store = SpaceStore::open_in_memory().unwrap();
        let space = store
            .create_space_with_mode("Hub", None, RetrievalMode::Graph, &DocOwner::unattributed())
            .await
            .unwrap();
        for doc in 0..docs {
            let mut text = String::from("hubentity");
            for tok in 0..UNIQUE_PER_DOC {
                text.push_str(&format!(" {satellite_prefix}{doc}x{tok}"));
            }
            store
                .ingest_document(&space, &format!("D{doc}"), &text, &DocOwner::unattributed())
                .await
                .unwrap();
        }
        store
            .ingest_document(
                &space,
                "Bridge",
                &format!("hubentity {bridge}"),
                &DocOwner::unattributed(),
            )
            .await
            .unwrap();
        const ANSWER: &str = "zzzanswerfact";
        store
            .ingest_document(
                &space,
                "Answer",
                &format!("{bridge} {ANSWER}"),
                &DocOwner::unattributed(),
            )
            .await
            .unwrap();

        // Non-vacuity, read from the stored graph rather than assumed from
        // arithmetic: if the hub's out-degree did not exceed the cap, neither test
        // below would be exercising the truncation branch at all.
        let hub_degree: i64 = {
            let conn = store.conn.lock().await;
            conn.query_row(
                "SELECT COUNT(DISTINCT dst_entity) FROM graph_edges
                 WHERE space_id = ?1 AND src_entity = 'hubentity'",
                params![space],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert!(
            hub_degree as usize > MAX_FRONTIER_ENTITIES,
            "fixture must overflow the frontier cap; hub degree was {hub_degree}, \
             cap is {MAX_FRONTIER_ENTITIES}"
        );
        (store, space, ANSWER)
    }

    /// **The cap truncates, and the grounded chunk still comes back.**
    ///
    /// The bridge is named so it sorts *before* every satellite, so it survives the
    /// truncation and the two-hop path `hubentity → aaabridge → answer chunk`
    /// resolves. This is the half that proves the cap bounds the traversal without
    /// breaking it: the search terminates and returns the chunk that a full
    /// traversal would have returned — even though hop 1 threw away every neighbour
    /// past the cap.
    ///
    /// Stated plainly, because a test that overstates itself is the defect it
    /// guards: this one would also pass with the cap lifted. Its job is that
    /// truncation (asserted from the hub's stored out-degree in [`hub_fixture`])
    /// does **not** cost the answer. The test whose *outcome* depends on the cap is
    /// the lossiness one below.
    #[tokio::test]
    async fn graph_search_reaches_a_two_hop_chunk_through_a_truncated_frontier() {
        let (store, space, answer) = hub_fixture("sat", "aaabridge").await;
        let hits = store
            .graph_search(&space, "hubentity", 10_000)
            .await
            .unwrap();
        assert!(
            hits.iter().any(|c| c.content.contains(answer)),
            "the two-hop answer chunk must survive frontier truncation when its \
             bridge entity sorts inside the cap"
        );
        // The answer chunk contains no query entity, so a direct hit cannot explain
        // the result — it is genuinely two hops away.
        assert!(
            !hits
                .iter()
                .any(|c| c.content.contains(answer) && c.content.contains("hubentity")),
            "fixture broken: the answer chunk must not contain the query entity"
        );
    }

    /// **The cap is LOSSY, and that is a retrieval claim, not a performance one.**
    ///
    /// Identical fixture to the test above with one change: the bridge sorts *after*
    /// every satellite, so hop 1 fills its [`MAX_FRONTIER_ENTITIES`] budget with
    /// satellites and the bridge is dropped. The chunk behind it then becomes
    /// unreachable — permanently, not just later: the bridge shares a chunk with the
    /// hub and the answer only, so no hop-2 or hop-3 frontier can rediscover it
    /// (in a *dense* Space a truncated entity usually does come back a hop later
    /// through a shared chunk, which is why the fixture is deliberately sparse here).
    ///
    /// This is asserted rather than left as a doc sentence because a silently lossy
    /// bound is exactly the defect class this file has been shedding: a knob whose
    /// stated effect (speed) is not its real effect (which chunks exist, as far as
    /// retrieval is concerned). Retuning `MAX_FRONTIER_ENTITIES` therefore changes
    /// answers, and the fixture is sized from the constant so this stays true at any
    /// value.
    #[tokio::test]
    async fn graph_search_frontier_truncation_can_drop_a_reachable_chunk() {
        let (store, space, answer) = hub_fixture("aaa", "zzzbridge").await;

        // Reachable in principle: seeded directly at the bridge, the traversal finds
        // the answer chunk in one hop. So the fixture is connected, and the miss
        // below is the cap's doing.
        let direct = store
            .graph_search(&space, "zzzbridge", 10_000)
            .await
            .unwrap();
        assert!(
            direct.iter().any(|c| c.content.contains(answer)),
            "fixture broken: the answer chunk must be reachable from its bridge"
        );

        let hits = store
            .graph_search(&space, "hubentity", 10_000)
            .await
            .unwrap();
        assert!(
            hits.iter().any(|c| c.content.contains("zzzbridge")),
            "the bridge's own chunk is a direct hop-1 hit and must still be returned"
        );
        assert!(
            !hits.iter().any(|c| c.content.contains(answer)),
            "the cap is lossy by construction: a chunk whose only path runs through \
             a truncated frontier entity is NOT returned. If this now passes, the \
             traversal's reachability changed — update the docs on graph_search and \
             MAX_FRONTIER_ENTITIES in the same commit"
        );
    }

    /// **The regression guard for "document ingest no longer occupies a runtime
    /// worker."**
    ///
    /// `#[tokio::test]` builds a **current-thread** runtime: exactly one worker. So
    /// a spawned ticker task can only advance while the test's own task is parked at
    /// an await point — which makes "did the ingest yield the worker?" directly
    /// observable as a tick count, with no timing assertion.
    ///
    /// Both halves were run against the pre-fix (inline) shape and both counted
    /// **exactly 0** ticks: the embed loop's awaits are all immediately-ready and an
    /// uncontended `tokio::Mutex::lock().await` does not yield, so nothing between
    /// the call and its return ever returned `Pending`. After the fix, one observed
    /// run on a laptop counted 35,301 (ingest) and 56,473 (update). Those two
    /// figures are a *spin rate* — they say nothing beyond "the worker was free" and
    /// will differ per machine — so the threshold asserted below is 8, chosen to sit
    /// far above the pre-fix 0 and far below any real run, pinning the shape rather
    /// than the scheduler.
    #[tokio::test]
    async fn graph_ingest_does_not_occupy_the_async_worker() {
        use std::sync::atomic::{AtomicBool, AtomicUsize};

        let store = SpaceStore::open_in_memory().unwrap();
        let space = store
            .create_space_with_mode(
                "Dense",
                None,
                RetrievalMode::Graph,
                &DocOwner::unattributed(),
            )
            .await
            .unwrap();
        // Dense enough that the blocking phase is the dominant cost of the call:
        // ≈57 entities/chunk ⇒ ≈3,200 edge rows per chunk (see
        // [`build_graph_for_chunks`]).
        let corpus = prose_corpus(24);

        let stop = Arc::new(AtomicBool::new(false));
        let ticks = Arc::new(AtomicUsize::new(0));
        let ticker = tokio::spawn({
            let stop = Arc::clone(&stop);
            let ticks = Arc::clone(&ticks);
            async move {
                while !stop.load(std::sync::atomic::Ordering::Relaxed) {
                    ticks.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    tokio::task::yield_now().await;
                }
            }
        });
        // Let the ticker reach its loop before the measurement window opens.
        tokio::task::yield_now().await;
        let before = ticks.load(std::sync::atomic::Ordering::Relaxed);

        let doc = store
            .ingest_document(&space, "Dense", &corpus, &DocOwner::unattributed())
            .await
            .unwrap();

        let during_ingest = ticks.load(std::sync::atomic::Ordering::Relaxed) - before;

        // `update_document` (the editor's embed-on-save path) re-runs the same
        // quadratic graph build over the whole document, so it was moved off the
        // worker in the same change and is measured in the same window.
        let before_update = ticks.load(std::sync::atomic::Ordering::Relaxed);
        store.update_document(&doc, "Dense", &corpus).await.unwrap();
        let during_update = ticks.load(std::sync::atomic::Ordering::Relaxed) - before_update;

        stop.store(true, std::sync::atomic::Ordering::Relaxed);
        let _ = ticker.await;

        assert!(
            during_ingest >= 8,
            "the ingest never parked the single runtime worker ({during_ingest} \
             ticks) — the graph build is back on the async worker"
        );
        assert!(
            during_update >= 8,
            "the document update never parked the single runtime worker \
             ({during_update} ticks) — the graph rebuild is back on the async worker"
        );
        // The work must still have happened: an off-worker ingest that wrote no
        // graph is a green test over a broken path. (`update_document` deletes the
        // document's graph rows before re-inserting, so a non-zero count here also
        // says the update's own rebuild ran.)
        let (nodes, edges) = graph_row_counts(&store, &space).await;
        assert!(
            nodes > 0 && edges > 0,
            "graph-mode ingest wrote no graph rows (nodes={nodes}, edges={edges})"
        );
    }

    /// **The reproduction harness for the cost table on [`build_graph_for_chunks`].**
    ///
    /// `#[ignore]`d, not deleted: it takes 1–2 minutes, so it must not run in CI, but
    /// a documented measurement nobody can re-derive decays into folklore — which is
    /// precisely how the "affordable enough to run inline" claim it replaced
    /// survived. It prints; it asserts nothing about wall clock (timings on a shared
    /// machine are not a pass/fail signal), so it cannot rot into a false red or a
    /// false green. Run it with:
    ///
    /// ```text
    /// cargo test --release -p ryu-spaces measure_graph_rebuild_cost -- --ignored --nocapture --test-threads=1
    /// ```
    ///
    /// Both storage shapes are measured because they differ by ~1.6×, and the
    /// production one is the slow one: `open_in_memory` is what every other test in
    /// this file uses, and quoting only that number understates a real Space by
    /// seconds. The row/edge counts it prints are exact and reproduce byte for byte
    /// (they did so across the [`graph_row_id`] change, which is how that change was
    /// shown to cost no graph rows); the seconds are a range and should be read as
    /// one.
    ///
    /// How wide a range depends on which shape you are measuring, and that is itself
    /// the finding: under v4-UUID ids the 1,566-chunk on-disk case came out at 87 s
    /// and 46 s on two runs of the same laptop, because the cost of a
    /// randomly-addressed index is whatever of it happens to be resident. Since
    /// [`graph_row_id`] made the inserts ordered, runs sit within ~10 % of each
    /// other. Free disk space also moves the absolute numbers noticeably — treat
    /// figures from different sessions as ratios, not as differences.
    #[tokio::test]
    #[ignore = "measurement harness: ~35 s, run manually (see doc comment)"]
    async fn measure_graph_rebuild_cost() {
        let dir = std::env::temp_dir().join(format!("ryu-spaces-measure-{}", uuid::Uuid::new_v4()));
        for target in [96usize, 383, 1530] {
            let corpus = prose_corpus(target);
            let chunks = chunk_text(&corpus);
            let per: Vec<usize> = chunks.iter().map(|c| extract_entities(c).len()).collect();
            let avg_chars = chunks.iter().map(|c| c.chars().count()).sum::<usize>() / chunks.len();
            let avg_entities = per.iter().sum::<usize>() / per.len();

            for on_disk in [false, true] {
                let store = if on_disk {
                    SpaceStore::open_at(
                        dir.join(format!("{target}/spaces.db")),
                        Embedder::Local { dims: 8 },
                        8,
                        DEFAULT_GRAPH_EXTRACTION_MODEL.to_owned(),
                        Reranker::Local,
                        dir.join(format!("{target}/blobs")),
                        None,
                    )
                    .unwrap()
                } else {
                    SpaceStore::open_in_memory().unwrap()
                };
                let space = store
                    .create_space("Measure", None, &DocOwner::unattributed())
                    .await
                    .unwrap();
                store
                    .ingest_document(&space, "Measure", &corpus, &DocOwner::unattributed())
                    .await
                    .unwrap();
                // Ingest happened in vector mode, so this is a cold, full rebuild —
                // the exact work one click on the retrieval-mode switch performs.
                let started = std::time::Instant::now();
                let change = store
                    .set_retrieval_mode(&space, RetrievalMode::Graph)
                    .await
                    .unwrap()
                    .expect("space exists");
                let wall = started.elapsed();
                println!(
                    "storage={:9} chunks={:5} chars/chunk={:4} entities/chunk={:3} (min {:3} max {:3}) nodes={:7} edges={:9} wall={:>12?} per-chunk={:?}",
                    if on_disk { "on-disk" } else { "in-memory" },
                    change.chunks_scanned,
                    avg_chars,
                    avg_entities,
                    per.iter().min().unwrap(),
                    per.iter().max().unwrap(),
                    change.graph_nodes,
                    change.graph_edges,
                    wall,
                    wall / (change.chunks_scanned.max(1) as u32),
                );
            }
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// **The reproduction harness for the chat-attachment stall (X2).**
    ///
    /// Measures the thing the defect is actually about, which is *not* how long the
    /// upload takes. `SpaceStore` holds ONE `Connection` behind ONE
    /// `tokio::Mutex`, so the number that matters is the **worst latency a cheap,
    /// unrelated Space operation sees while an attachment is being indexed** — a
    /// sidebar refresh, another Space's search, a second upload. A slow upload is a
    /// slow upload; a slow upload that freezes every Space on the node is the bug.
    ///
    /// Shape of the measurement:
    /// - on-disk store (WAL, the production storage shape — `open_in_memory` is
    ///   2–5× faster and would understate this), graph-mode Space;
    /// - `create_file` then [`SpaceStore::replace_file_chunks`], i.e. exactly the
    ///   path `space_file_index::record_parse_result` takes for a floor-readable
    ///   `.md`/`.csv`/`.txt` attachment;
    /// - a concurrent probe task looping `count_spaces()` (one indexed `COUNT`,
    ///   microseconds uncontended) and recording its **maximum** observed latency.
    ///
    /// Prints; asserts nothing about wall clock, for the same reason
    /// [`measure_graph_rebuild_cost`] does not — timings on a shared machine are a
    /// diagnostic, not a pass/fail signal.
    ///
    /// ```text
    /// cargo test --release -p ryu-spaces measure_attachment_stall -- --ignored --nocapture --test-threads=1
    /// ```
    ///
    /// Current-thread runtime, and that is fine rather than a compromise: the
    /// transaction runs on `spawn_blocking` (a separate pool), the test's own task
    /// is parked awaiting its `JoinHandle`, so the probe is freely schedulable
    /// throughout. What it waits on is therefore the connection **mutex**, not the
    /// executor — which is exactly the quantity under measurement. (This crate's
    /// `tokio` dev-dependency does not enable `rt-multi-thread`, and Cargo.toml is
    /// not this change's to edit.)
    #[tokio::test]
    #[ignore = "measurement harness: minutes, run manually (see doc comment)"]
    async fn measure_attachment_stall() {
        use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

        let dir = std::env::temp_dir().join(format!("ryu-spaces-stall-{}", uuid::Uuid::new_v4()));
        // Sizes chosen to bracket "a file someone drags into a chat": a note, a
        // README, a spec, a long report.
        for target in [8usize, 32, 100, 400] {
            let corpus = prose_corpus(target);
            let case = dir.join(target.to_string());
            let store = SpaceStore::open_at(
                case.join("spaces.db"),
                Embedder::Local { dims: 8 },
                8,
                DEFAULT_GRAPH_EXTRACTION_MODEL.to_owned(),
                Reranker::Local,
                case.join("blobs"),
                None,
            )
            .unwrap();
            let space = store
                .create_space_with_mode(
                    "Attach",
                    None,
                    RetrievalMode::Graph,
                    &DocOwner::unattributed(),
                )
                .await
                .unwrap();
            let doc = store
                .create_file(
                    &space,
                    "attachment.md",
                    corpus.as_bytes(),
                    "text/markdown",
                    &DocOwner::unattributed(),
                )
                .await
                .unwrap();

            let stop = Arc::new(AtomicBool::new(false));
            let worst_us = Arc::new(AtomicU64::new(0));
            let probe = tokio::spawn({
                let store = store.clone();
                let stop = Arc::clone(&stop);
                let worst_us = Arc::clone(&worst_us);
                async move {
                    let mut samples = 0u64;
                    while !stop.load(Ordering::Relaxed) {
                        let t = std::time::Instant::now();
                        let _ = store.count_spaces().await;
                        let us = t.elapsed().as_micros() as u64;
                        worst_us.fetch_max(us, Ordering::Relaxed);
                        samples += 1;
                        tokio::task::yield_now().await;
                    }
                    samples
                }
            });
            tokio::task::yield_now().await;

            let started = std::time::Instant::now();
            let chunks = store.replace_file_chunks(&doc, &corpus).await.unwrap();
            let wall = started.elapsed();

            stop.store(true, Ordering::Relaxed);
            let samples = probe.await.unwrap();
            let (nodes, edges) = graph_row_counts(&store, &space).await;
            println!(
                "bytes={:7} chunks={:4} nodes={:6} edges={:8} call={:>10.3?} \
                 worst-concurrent-op={:>10.3?} probes={}",
                corpus.len(),
                chunks,
                nodes,
                edges,
                wall,
                std::time::Duration::from_micros(worst_us.load(Ordering::Relaxed)),
                samples,
            );
            // Per-case cleanup, not just at the end: the 400-chunk graph is ~1.3M
            // edge rows across two indexes — several hundred MB on disk — and
            // keeping every case alive would make the harness's peak footprint the
            // sum rather than the max.
            drop(store);
            let _ = std::fs::remove_dir_all(&case);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
