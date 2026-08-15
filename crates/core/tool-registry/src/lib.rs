//! Unified tool-catalog primitive (#474, P1) — extracted from `apps/core`.
//!
//! One searchable catalog across **MCP servers + built-ins + Composio + plugin
//! tools + Agent Skills** — no parallel registry. [`run_search`] ranks descriptors
//! with a
//! **swappable [`ToolRanker`]** (BM25 default, semantic rerank as a second impl
//! seam, selectable via a pref key mirroring `catalog.active_source.{kind}`).
//! [`describe_from_parts`] / [`describe_composio`] return a tool's argument
//! schema.
//!
//! Contract 1 (spec Appendix A, verbatim): [`ToolKind`] / [`ToolDescriptor`] /
//! [`DescribedTool`] / [`DescribedArg`].
//!
//! ## The boundary type is [`ToolDescriptor`], never Core's `RegistryTool`
//!
//! This crate owns the catalog *contract + ranker + describe-shaping* — the
//! portable data layer. What stays Core-side (bound to the `McpRegistry`
//! sidecar object + the built-in server inventory) is the ingest adapter:
//! Core's `descriptor_from(&RegistryTool)` maps its registry rows into
//! [`ToolDescriptor`], `classify_kind` resolves the [`ToolKind`] from the
//! sidecar server inventory, and the Composio live fetch produces the composio
//! descriptors. Core then hands those descriptors to [`run_search`] /
//! [`describe_from_parts`]. So the crate never sees a Core type — zero
//! dependency on `apps/core`.
//!
//! ## The embedder seam ([`ToolEmbedder`])
//!
//! [`ToolRanker::Semantic`] embeds the query + candidates and ranks by cosine
//! similarity. The embedder is injected as a narrow [`ToolEmbedder`] trait
//! object; Core wraps its registry-driven `retrieval::Embedder` behind this in
//! `apps/core/src/tool_registry_host.rs` (the `SearchEmbedder`/`search_host.rs`
//! precedent).
//!
//! Placement (CLAUDE.md §1): discovering *what tools exist* and ranking them is
//! orchestration → Core. The allowlist verdict / budget / audit is Gateway.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A minimal embedder seam for [`ToolRanker::Semantic`]. Core implements this in
/// `tool_registry_host.rs` over its registry-configured `retrieval::Embedder`
/// so this crate never depends on `apps/core`. `embed` returns `None` when the
/// embedder is unreachable, which the ranker treats as a documented BM25
/// fallback (not an error).
#[async_trait]
pub trait ToolEmbedder: Send + Sync {
    /// Embed one text into a vector, or `None` when the embedder is unreachable.
    async fn embed(&self, text: &str) -> Option<Vec<f32>>;
}

/// Source plane of a catalog entry. Serializes lowercase: `mcp|builtin|composio|app`,
/// plus `core-api` for Core's own HTTP endpoints exposed as agent-drivable tools,
/// `command` for a declarative app tool that execs an allowlisted local CLI, and
/// `skill` for an Agent Skill.
///
/// ## `Skill` is the one kind that is not callable
///
/// Every other variant names a *function the model may invoke*. [`ToolKind::Skill`]
/// names **instruction text the model may load** — an Agent Skill discovered through
/// the same catalog so a model faces one search door instead of two, but reached with
/// `skills__load` rather than by calling its id. The kind is the model's (and the
/// gateway's) signal for that distinction: Core's `McpRegistry::describe` points a
/// skill row at `skills__load`, the gateway declines to inject skill rows as function
/// definitions, and Core's `skills` provider refuses a call that names a skill id as
/// a tool. Discovery is unified; execution is not.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ToolKind {
    Mcp,
    Builtin,
    Composio,
    App,
    /// A Core HTTP endpoint (OpenAPI-derived) callable by an agent over loopback.
    /// Explicit rename so the wire value is the hyphenated `core-api`, not the
    /// `rename_all = "lowercase"` default `coreapi`.
    #[serde(rename = "core-api")]
    CoreApi,
    /// A declarative `command` app tool: execs an allowlisted local CLI through
    /// the governed tool-exec path. Surfaced as its own kind so `?kind=command`
    /// selects these; the other app backends (http/inline_deno/alias) stay `App`.
    Command,
    /// An Agent Skill: instruction text loaded with `skills__load`, **not** a
    /// callable function. Ids are namespaced `skills__<slug>` so a skill row lives
    /// in the same id space as the `skills__*` tools that serve it — which is what
    /// makes the allowlist arm below, and Core's refusal path, work without a
    /// bespoke lookup.
    Skill,
    /// A tool **derived** from an app sidecar's OpenAPI document: one row per
    /// operation, generated at ingest from the document's `operationId`s.
    ///
    /// That derivation is the whole distinction from [`ToolKind::App`]. An `App`
    /// row is a runnable the app author hand-declared in `manifest.json` and
    /// chose to expose; an `ExtApi` row exists merely because the sidecar's spec
    /// described an endpoint. Nobody curated the set, so it is typically large,
    /// machine-named (`get_api_users`), and covers every endpoint the sidecar
    /// serves — which is why [`ToolDescriptor::matches_allowlist`] admits these
    /// by fully-qualified id only, and why Core's approval policy treats a
    /// non-GET one as risky on its own.
    ///
    /// Explicit rename so the wire value is the hyphenated `ext-api` (the
    /// `rename_all = "lowercase"` default would be `extapi`), matching the
    /// `core-api` precedent above.
    #[serde(rename = "ext-api")]
    ExtApi,
}

impl ToolKind {
    /// Every variant, in wire order — the single list both gateway mirrors and
    /// Core's ACP bridge enumerate when asserting that their advertised
    /// `tool_search.kind` enum covers every plane Core can filter on.
    ///
    /// **Adding a variant means adding it here.** [`ToolKind::wire_name`] below is a
    /// wildcard-free `match`, so a new variant is a compile error there first; this
    /// constant is two lines above it precisely so the same edit updates both. A
    /// variant present in the enum but missing from `ALL` would make those mirror
    /// tests pass vacuously — the exact failure mode that let `core-api` and
    /// `command` stay invisible to every model for two releases.
    pub const ALL: &'static [ToolKind] = &[
        ToolKind::Mcp,
        ToolKind::Builtin,
        ToolKind::Composio,
        ToolKind::App,
        ToolKind::CoreApi,
        ToolKind::Command,
        ToolKind::Skill,
        ToolKind::ExtApi,
    ];

    /// The canonical wire spelling — the value [`ToolKind::parse_filter`] round-trips
    /// and the one a `?kind=` / `tool_search.kind` filter must use.
    ///
    /// Exhaustive with no wildcard arm on purpose: that is the drift alarm. See
    /// [`ToolKind::ALL`].
    pub const fn wire_name(self) -> &'static str {
        match self {
            ToolKind::Mcp => "mcp",
            ToolKind::Builtin => "builtin",
            ToolKind::Composio => "composio",
            ToolKind::App => "app",
            ToolKind::CoreApi => "core-api",
            ToolKind::Command => "command",
            ToolKind::Skill => "skill",
            ToolKind::ExtApi => "ext-api",
        }
    }

    /// Parse the `?kind=` / `tool_search.kind` value. `any` → `None` (no filter);
    /// an unknown value also yields `None` so callers can treat it as "any".
    pub fn parse_filter(s: &str) -> Option<ToolKind> {
        match s.trim().to_ascii_lowercase().as_str() {
            "mcp" => Some(ToolKind::Mcp),
            "builtin" => Some(ToolKind::Builtin),
            "composio" => Some(ToolKind::Composio),
            "app" => Some(ToolKind::App),
            // Accept both the canonical hyphenated form and the underscore/no-sep
            // variants callers may send.
            "core-api" | "core_api" | "coreapi" => Some(ToolKind::CoreApi),
            "command" => Some(ToolKind::Command),
            "skill" | "skills" => Some(ToolKind::Skill),
            // Same hyphen/underscore/no-sep tolerance as `core-api`, for the same
            // reason: the canonical spelling is hyphenated but callers reach for
            // whichever separator their own code uses.
            "ext-api" | "ext_api" | "extapi" => Some(ToolKind::ExtApi),
            _ => None, // "any" or unknown
        }
    }
}

/// A ranked tool descriptor (Contract 1).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDescriptor {
    /// `<server>__<tool>` | `composio__<slug>`.
    pub id: String,
    pub name: String,
    /// Never null — `""` when absent.
    #[serde(default)]
    pub description: String,
    pub kind: ToolKind,
    #[serde(default)]
    pub arg_names: Vec<String>,
    #[serde(default)]
    pub arg_descriptions: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub score: Option<f32>,
    /// The tool's `_meta`, verbatim (widget keys), when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<Value>,
    /// Whether a widget originating from this tool may `callTool` (companion).
    #[serde(default)]
    pub widget_accessible: bool,
    /// The `ui://widget/<slug>.html` template uri when this tool renders a widget.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_template: Option<String>,
}

impl ToolDescriptor {
    /// Whether this descriptor is reachable under an agent's tool `allowlist`,
    /// matching the *execution* gate ([`super::tool_allowed`]) so a `?agent=`
    /// search view does not under-report tools the agent can actually call:
    /// for MCP/built-in/app tools an entry may be the fully-qualified id, the
    /// bare tool name, **or** the server segment; for Composio it is matched on
    /// the fully-qualified id only (Composio ids have no name/server grant form,
    /// and id-only is the cross-plane-bypass guard on the call path).
    ///
    /// ## [`ToolKind::Skill`]: id or server segment, never the bare name
    ///
    /// A skill row's id is `skills__<slug>`, so its server segment is the `skills`
    /// provider — the grant that lets an agent call `skills__load` at all. Matching
    /// on id-or-server therefore mirrors the execution gate's *tool-allowlist half*
    /// exactly: an agent with no grant on the `skills` server cannot load any skill,
    /// so surfacing skill rows to it would advertise nothing reachable.
    ///
    /// The bare `name` is deliberately excluded. A skill's `name` is human prose
    /// ("Resolve merge conflicts"), and the default arm's `e == name` would let an
    /// allowlist entry written for a tool (`search`, meant for `exa__search`) match
    /// a skill that happens to be *called* "search" — the same cross-plane
    /// bare-name match the gateway's `is_allowed` doc records as security fix #1.
    ///
    /// **What this does NOT check** is the agent's per-agent *skill* allowlist
    /// (`AgentRecord.skills`), which is a different list this crate never sees; it
    /// is what `skills__search` / `skills__load` scope on. So under a tool
    /// allowlist that grants `skills`, this returns `true` for every enabled skill,
    /// including ones outside that agent's skill allowlist — which `skills__load`
    /// will still refuse. See `McpRegistry::search_scoped` for where the skill
    /// allowlist *is* applied and which plane still misses it.
    ///
    /// ## [`ToolKind::ExtApi`]: the fully-qualified id and nothing else
    ///
    /// Derived rows get the strictest form of all — never the bare name, and
    /// (unlike skills) never the leading id segment either.
    ///
    /// The bare `name` is excluded for the same reason as a skill's, but the
    /// collision is far likelier: a derived tool's name is a slug generated from
    /// somebody else's OpenAPI `operationId`, so ordinary words (`search`,
    /// `send`, `get_api_users`) fall out of a document nobody on this node
    /// reviewed. An allowlist entry a user wrote for an entirely different plane
    /// (`search`, meant for `exa__search`) would then admit a derived endpoint —
    /// the cross-plane bare-name match recorded above as security fix #1, over a
    /// much larger name space.
    ///
    /// The leading **segment** is excluded on top of that, which is where this
    /// arm deliberately differs from the Skill arm. `skills` is a real
    /// per-provider grant: one entry means "this agent may load skills", and
    /// nothing more. The derived plane's leading segment is a prefix that every
    /// installed app's derived tools share, so honouring it would turn a single
    /// allowlist entry into a grant over every endpoint of every app's OpenAPI
    /// surface. There is no segment here that means less than that, so there is
    /// no segment grant here at all.
    pub fn matches_allowlist(&self, allowlist: &[String]) -> bool {
        if self.kind == ToolKind::Composio || self.kind == ToolKind::ExtApi {
            return allowlist.iter().any(|e| e == &self.id);
        }
        let (server, name) = self
            .id
            .split_once("__")
            .map_or((self.id.as_str(), self.name.as_str()), |(s, t)| (s, t));
        if self.kind == ToolKind::Skill {
            return allowlist.iter().any(|e| e == &self.id || e == server);
        }
        allowlist
            .iter()
            .any(|e| e == &self.id || e == name || e == server)
    }
}

/// A fully-described tool with its argument schema (Contract 1).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DescribedTool {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub kind: ToolKind,
    pub args: Vec<DescribedArg>,
    /// True when the schema could not be fully resolved (e.g. a Composio action
    /// whose only known argument is the freeform `arguments` object).
    #[serde(default)]
    pub shallow: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parameters: Option<Value>,
}

/// One argument of a [`DescribedTool`] (Contract 1).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DescribedArg {
    pub name: String,
    pub r#type: String,
    #[serde(default)]
    pub description: String,
    pub required: bool,
}

/// Extract `(arg_names, arg_descriptions)` from a JSON-schema `input_schema`.
/// The `RegistryTool`→[`ToolDescriptor`] ingest adapter lives Core-side; this is
/// exported so that adapter can reuse the same arg-name extraction.
pub fn arg_summary(schema: Option<&Value>) -> (Vec<String>, Vec<String>) {
    let mut names = Vec::new();
    let mut descs = Vec::new();
    if let Some(props) = schema
        .and_then(|s| s.get("properties"))
        .and_then(Value::as_object)
    {
        for (name, def) in props {
            names.push(name.clone());
            descs.push(
                def.get("description")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
            );
        }
    }
    (names, descs)
}

/// Extract the full `DescribedArg` list from an `input_schema`.
pub fn described_args(schema: Option<&Value>) -> Vec<DescribedArg> {
    let Some(schema) = schema else {
        return Vec::new();
    };
    let required: Vec<String> = schema
        .get("required")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    let Some(props) = schema.get("properties").and_then(Value::as_object) else {
        return Vec::new();
    };
    props
        .iter()
        .map(|(name, def)| DescribedArg {
            name: name.clone(),
            r#type: def
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("string")
                .to_string(),
            description: def
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            required: required.iter().any(|r| r == name),
        })
        .collect()
}

// ── Ranker (swappable; nothing hardcoded) ────────────────────────────────────

/// Pref key selecting the active ranker, mirroring `catalog.active_source.{kind}`.
pub const RANKER_PREF_KEY: &str = "tools.active_ranker";

/// A swappable tool ranking strategy. BM25 is the default; `Semantic` is a real
/// embedder-backed second strategy (enum-dispatch in [`ToolRanker::rank`]), not a
/// placeholder — it embeds the query + candidates and ranks by cosine similarity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolRanker {
    /// Classic BM25 lexical ranking over name + description + arg names.
    Bm25,
    /// Embedding-based semantic ranking via the registry [`Embedder`]
    /// (cosine over `doc_text`). Falls back to BM25 ordering when the embedder is
    /// unreachable (documented graceful fallback, not a stub error).
    Semantic,
}

impl ToolRanker {
    /// Resolve the ranker from a pref string; defaults to BM25.
    pub fn from_pref(s: Option<&str>) -> ToolRanker {
        match s.map(|v| v.trim().to_ascii_lowercase()).as_deref() {
            Some("semantic") => ToolRanker::Semantic,
            _ => ToolRanker::Bm25,
        }
    }

    /// Rank descriptors against a query, mutating `score` and sorting descending.
    /// Returns the top `limit`.
    ///
    /// `Semantic` embeds the query + each candidate's [`doc_text`] via the
    /// injected [`ToolEmbedder`] and ranks by cosine similarity; it falls back to
    /// BM25 ordering when the embedder is absent/unreachable (or the query is
    /// empty), so it degrades gracefully rather than erroring. `Bm25` is the pure
    /// lexical path and ignores `embedder`.
    pub async fn rank(
        self,
        query: &str,
        mut items: Vec<ToolDescriptor>,
        limit: usize,
        embedder: Option<&dyn ToolEmbedder>,
    ) -> Vec<ToolDescriptor> {
        let scored = match (self, embedder) {
            (ToolRanker::Semantic, Some(embedder)) => {
                semantic_score(query, &mut items, embedder).await
            }
            _ => false,
        };
        if !scored {
            // BM25 path (also the Semantic fallback when no embedder is reachable).
            bm25_score(query, &mut items);
        }
        items.sort_by(|a, b| {
            b.score
                .unwrap_or(0.0)
                .partial_cmp(&a.score.unwrap_or(0.0))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        items.truncate(limit);
        items
    }
}

/// Cosine similarity of two equal-length vectors; `0.0` on length mismatch.
fn cosine(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() {
        return 0.0;
    }
    let mut dot = 0.0_f32;
    let mut na = 0.0_f32;
    let mut nb = 0.0_f32;
    for (x, y) in a.iter().zip(b.iter()) {
        dot += x * y;
        na += x * x;
        nb += y * y;
    }
    let denom = na.sqrt() * nb.sqrt();
    if denom > f32::EPSILON {
        dot / denom
    } else {
        0.0
    }
}

/// Score `items` in place by embedding cosine similarity. Returns `true` when the
/// semantic path ran (every item scored), `false` to signal the caller to fall
/// back to BM25 (empty query, or the query embedding failed → embedder
/// unreachable). A single per-item embedding failure scores that item `0.0`.
async fn semantic_score(
    query: &str,
    items: &mut [ToolDescriptor],
    embedder: &dyn ToolEmbedder,
) -> bool {
    if query.trim().is_empty() || items.is_empty() {
        return false;
    }
    let Some(q_vec) = embedder.embed(query).await else {
        // Embedder unreachable → documented BM25 fallback.
        return false;
    };
    for d in items.iter_mut() {
        let score = match embedder.embed(&doc_text(d)).await {
            Some(doc_vec) => cosine(&q_vec, &doc_vec),
            None => 0.0,
        };
        d.score = Some(score);
    }
    true
}

/// Tokenize on non-alphanumeric boundaries, lowercased.
fn tokenize(s: &str) -> Vec<String> {
    s.split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| t.to_ascii_lowercase())
        .collect()
}

/// The searchable text of a descriptor (id + name + description + arg names).
fn doc_text(d: &ToolDescriptor) -> String {
    let mut s = format!("{} {} {}", d.id, d.name, d.description);
    for a in &d.arg_names {
        s.push(' ');
        s.push_str(a);
    }
    s
}

/// Score `items` in place with BM25; an exact id/name match gets a strong boost
/// so it ranks first (acceptance: BM25 ranks exact match first).
fn bm25_score(query: &str, items: &mut [ToolDescriptor]) {
    const K1: f32 = 1.5;
    const B: f32 = 0.75;
    let q_terms = tokenize(query);
    if q_terms.is_empty() {
        for d in items.iter_mut() {
            d.score = Some(0.0);
        }
        return;
    }

    let docs: Vec<Vec<String>> = items.iter().map(|d| tokenize(&doc_text(d))).collect();
    let n = docs.len().max(1) as f32;
    let avg_dl = docs.iter().map(|d| d.len() as f32).sum::<f32>() / n;
    let avg_dl = if avg_dl == 0.0 { 1.0 } else { avg_dl };

    let q_lower = query.trim().to_ascii_lowercase();

    for (i, d) in items.iter_mut().enumerate() {
        let doc = &docs[i];
        let dl = doc.len() as f32;
        let mut score = 0.0_f32;
        for term in &q_terms {
            let tf = doc.iter().filter(|w| *w == term).count() as f32;
            if tf == 0.0 {
                continue;
            }
            // Document frequency across the candidate set.
            let df = docs.iter().filter(|dd| dd.contains(term)).count() as f32;
            let idf = (((n - df + 0.5) / (df + 0.5)) + 1.0).ln();
            let denom = tf + K1 * (1.0 - B + B * dl / avg_dl);
            score += idf * (tf * (K1 + 1.0)) / denom;
        }
        // Exact id / name match boost so it sorts first.
        if d.id.eq_ignore_ascii_case(&q_lower) || d.name.eq_ignore_ascii_case(&q_lower) {
            score += 1000.0;
        }
        d.score = Some(score);
    }
}

/// Run the unified tool-catalog search over already-gathered descriptors — the
/// pure body of Core's `McpRegistry::search`.
///
/// `builtin_candidates` are the `list_all_tools()` rows Core mapped via its
/// `descriptor_from` ingest adapter; they are filtered by `kind` (`None` = any).
/// `composio_candidates` are the live, key-gated Composio descriptors Core
/// already fetched (empty when Composio is not wanted/configured); they are
/// **searchable-not-listed** and bypass the `kind` filter (Core only fetches
/// them when `kind` includes Composio), matching the pre-extraction ordering.
/// The merged set is ranked by `ranker` (BM25 default; Semantic uses `embedder`).
pub async fn run_search(
    query: &str,
    builtin_candidates: Vec<ToolDescriptor>,
    composio_candidates: Vec<ToolDescriptor>,
    kind: Option<ToolKind>,
    limit: usize,
    ranker: ToolRanker,
    embedder: Option<&dyn ToolEmbedder>,
) -> Vec<ToolDescriptor> {
    let mut candidates: Vec<ToolDescriptor> = builtin_candidates
        .into_iter()
        .filter(|d| kind.is_none() || kind == Some(d.kind))
        .collect();
    candidates.extend(composio_candidates);
    ranker.rank(query, candidates, limit, embedder).await
}

/// Describe a `composio__<slug>` id shallowly: a single freeform `arguments`
/// object row (the action's full schema is not listed). The pure body of the
/// Composio branch of Core's `McpRegistry::describe`.
pub fn describe_composio(id: &str) -> DescribedTool {
    let slug = id.strip_prefix("composio__").unwrap_or(id);
    DescribedTool {
        id: id.to_string(),
        name: slug.to_string(),
        description: String::new(),
        kind: ToolKind::Composio,
        args: vec![DescribedArg {
            name: "arguments".to_string(),
            r#type: "object".to_string(),
            description: "Action-specific parameters for this Composio action.".to_string(),
            required: false,
        }],
        shallow: true,
        parameters: None,
    }
}

/// Build a fully-described tool from its parts — the pure body of the non-Composio
/// branch of Core's `McpRegistry::describe`. Core resolves `kind` via its
/// inventory-bound `classify_kind` and passes the located tool's fields; the
/// crate owns the arg-schema parsing and the `shallow`/`parameters` shaping.
pub fn describe_from_parts(
    id: &str,
    name: &str,
    description: &str,
    kind: ToolKind,
    input_schema: Option<&Value>,
) -> DescribedTool {
    DescribedTool {
        id: id.to_string(),
        name: name.to_string(),
        description: description.to_string(),
        kind,
        args: described_args(input_schema),
        shallow: input_schema.is_none(),
        parameters: input_schema.cloned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn desc(id: &str, name: &str, description: &str, kind: ToolKind) -> ToolDescriptor {
        ToolDescriptor {
            id: id.to_string(),
            name: name.to_string(),
            description: description.to_string(),
            kind,
            arg_names: Vec::new(),
            arg_descriptions: Vec::new(),
            score: None,
            meta: None,
            widget_accessible: false,
            output_template: None,
        }
    }

    #[test]
    fn kind_serializes_lowercase() {
        assert_eq!(serde_json::to_string(&ToolKind::Mcp).unwrap(), "\"mcp\"");
        assert_eq!(
            serde_json::to_string(&ToolKind::Builtin).unwrap(),
            "\"builtin\""
        );
        assert_eq!(
            serde_json::to_string(&ToolKind::Composio).unwrap(),
            "\"composio\""
        );
        assert_eq!(serde_json::to_string(&ToolKind::App).unwrap(), "\"app\"");
        // CoreApi carries an explicit hyphenated wire value, not `coreapi`.
        assert_eq!(
            serde_json::to_string(&ToolKind::CoreApi).unwrap(),
            "\"core-api\""
        );
        // Command serializes to the lowercase `command` and round-trips.
        assert_eq!(
            serde_json::to_string(&ToolKind::Command).unwrap(),
            "\"command\""
        );
        assert_eq!(
            serde_json::from_str::<ToolKind>("\"command\"").unwrap(),
            ToolKind::Command
        );
        // Skill is the seventh plane; singular on the wire.
        assert_eq!(
            serde_json::to_string(&ToolKind::Skill).unwrap(),
            "\"skill\""
        );
        assert_eq!(
            serde_json::from_str::<ToolKind>("\"skill\"").unwrap(),
            ToolKind::Skill
        );
    }

    /// [`ToolKind::ALL`] is what both gateway mirrors and the ACP bridge enumerate,
    /// so a variant missing from it makes those parity tests pass vacuously. Assert
    /// the two properties that would let that happen: every entry round-trips
    /// through its own wire spelling, and no entry is listed twice.
    #[test]
    fn all_round_trips_through_wire_name_without_duplicates() {
        for k in ToolKind::ALL {
            assert_eq!(
                ToolKind::parse_filter(k.wire_name()),
                Some(*k),
                "{k:?}'s wire_name is not what parse_filter maps back to it"
            );
            // The wire spelling and the serde spelling must be the same string, or
            // a caller round-tripping a *serialized* descriptor's kind back into
            // `?kind=` would silently get "no filter".
            assert_eq!(
                serde_json::to_string(k).unwrap(),
                format!("\"{}\"", k.wire_name()),
                "{k:?} serializes differently from its filter spelling"
            );
        }
        let mut seen: Vec<&str> = ToolKind::ALL.iter().map(|k| k.wire_name()).collect();
        let before = seen.len();
        seen.sort_unstable();
        seen.dedup();
        assert_eq!(before, seen.len(), "ToolKind::ALL lists a kind twice");
    }

    /// The generic `all_round_trips…` test above already walks every variant, but
    /// only through `wire_name`. This pins the two things that would still be
    /// wrong-but-silent for [`ToolKind::ExtApi`] specifically: the serde rename
    /// (without it the wire value is `extapi`, which `parse_filter` would map to
    /// "no filter"), and the separator aliases a caller may actually send.
    #[test]
    fn ext_api_kind_round_trips_through_wire_name_and_parse_filter() {
        assert_eq!(ToolKind::ExtApi.wire_name(), "ext-api");
        assert_eq!(
            serde_json::to_string(&ToolKind::ExtApi).unwrap(),
            "\"ext-api\""
        );
        assert_eq!(
            serde_json::from_str::<ToolKind>("\"ext-api\"").unwrap(),
            ToolKind::ExtApi
        );
        assert_eq!(ToolKind::parse_filter("ext-api"), Some(ToolKind::ExtApi));
        assert_eq!(ToolKind::parse_filter("ext_api"), Some(ToolKind::ExtApi));
        assert_eq!(ToolKind::parse_filter("EXTAPI"), Some(ToolKind::ExtApi));
        // Present in `ALL`, or every mirror-parity test passes vacuously for it.
        assert!(ToolKind::ALL.contains(&ToolKind::ExtApi));
    }

    /// A derived row is reachable **only** by its fully-qualified id — not by the
    /// `operationId`-derived bare name, and not by the leading segment its whole
    /// plane shares.
    #[test]
    fn ext_api_allowlist_matches_by_id_only() {
        let d = desc(
            "ryu_ext__crm_get_api_users",
            "get_api_users",
            "list users",
            ToolKind::ExtApi,
        );
        assert!(d.matches_allowlist(&["ryu_ext__crm_get_api_users".to_string()]));
        // The bare name comes out of an OpenAPI document nobody reviewed; an
        // allowlist entry written for another plane must not admit it.
        assert!(!d.matches_allowlist(&["get_api_users".to_string()]));
        // The leading segment is shared by every app's derived tools, so honouring
        // it would be a grant over every installed app's whole API surface.
        assert!(!d.matches_allowlist(&["ryu_ext".to_string()]));
        assert!(!d.matches_allowlist(&[]));
        // The other planes are unchanged: the same bare name on a real MCP tool
        // still matches — only the derived row refuses it.
        let m = desc("exa__get_api_users", "get_api_users", "", ToolKind::Mcp);
        assert!(m.matches_allowlist(&["get_api_users".to_string()]));
    }

    #[test]
    fn parse_filter_maps_any_to_none() {
        assert_eq!(ToolKind::parse_filter("any"), None);
        assert_eq!(ToolKind::parse_filter("nonsense"), None);
        assert_eq!(ToolKind::parse_filter("mcp"), Some(ToolKind::Mcp));
        assert_eq!(ToolKind::parse_filter("COMPOSIO"), Some(ToolKind::Composio));
        // Every accepted spelling of the core-api filter round-trips to CoreApi.
        assert_eq!(ToolKind::parse_filter("core-api"), Some(ToolKind::CoreApi));
        assert_eq!(ToolKind::parse_filter("core_api"), Some(ToolKind::CoreApi));
        assert_eq!(ToolKind::parse_filter("CoreApi"), Some(ToolKind::CoreApi));
        assert_eq!(ToolKind::parse_filter("command"), Some(ToolKind::Command));
        assert_eq!(ToolKind::parse_filter("COMMAND"), Some(ToolKind::Command));
        // `skill` is canonical; `skills` (the provider's name) is accepted as an
        // alias because that is what a model that just read `skills__search` will
        // reach for.
        assert_eq!(ToolKind::parse_filter("skill"), Some(ToolKind::Skill));
        assert_eq!(ToolKind::parse_filter("Skills"), Some(ToolKind::Skill));
    }

    /// A skill row is reachable via its id or the `skills` server segment (the grant
    /// that lets an agent call `skills__load` at all), and **never** via its bare
    /// human-readable name — which would let a tool-shaped allowlist entry match a
    /// skill across planes.
    #[test]
    fn skill_rows_match_on_id_or_server_but_never_on_name() {
        let s = desc(
            "skills__merge-conflicts",
            "search",
            "resolve conflicts",
            ToolKind::Skill,
        );
        assert!(s.matches_allowlist(&["skills__merge-conflicts".to_string()]));
        assert!(s.matches_allowlist(&["skills".to_string()]));
        // The name is "search" — an allowlist entry meant for `exa__search` must
        // not reach this skill.
        assert!(!s.matches_allowlist(&["search".to_string()]));
        assert!(!s.matches_allowlist(&["merge-conflicts".to_string()]));
        assert!(!s.matches_allowlist(&[]));
        // The non-skill arm is unchanged: a bare name still matches a real tool.
        let t = desc("exa__search", "search", "web search", ToolKind::Mcp);
        assert!(t.matches_allowlist(&["search".to_string()]));
    }

    /// `kind=skill` selects only skill rows out of a mixed candidate set — the
    /// property that makes `skills__search` a filtered view of the one catalog
    /// rather than a second registry.
    #[tokio::test]
    async fn run_search_kind_skill_selects_only_skill_rows() {
        let candidates = vec![
            desc("exa__search", "search", "search the web", ToolKind::Mcp),
            desc(
                "skills__web-research",
                "Web research",
                "search the web methodically",
                ToolKind::Skill,
            ),
        ];
        let out = run_search(
            "search",
            candidates,
            Vec::new(),
            Some(ToolKind::Skill),
            25,
            ToolRanker::Bm25,
            None,
        )
        .await;
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, "skills__web-research");
    }

    #[test]
    fn matches_allowlist_matches_id_name_or_server() {
        let d = desc("spider__crawl", "crawl", "crawl a site", ToolKind::Mcp);
        assert!(d.matches_allowlist(&["spider__crawl".to_string()])); // id
        assert!(d.matches_allowlist(&["crawl".to_string()])); // bare name
        assert!(d.matches_allowlist(&["spider".to_string()])); // server segment
        assert!(!d.matches_allowlist(&["other".to_string()]));
        // Composio is id-only (no name/server grant form).
        let c = desc("composio__slack", "Slack", "", ToolKind::Composio);
        assert!(c.matches_allowlist(&["composio__slack".to_string()]));
        assert!(!c.matches_allowlist(&["Slack".to_string()]));
    }

    #[tokio::test]
    async fn bm25_ranks_exact_match_first() {
        let items = vec![
            desc("foo__search", "search", "search the web", ToolKind::Mcp),
            desc(
                "foo__send",
                "send_message",
                "send a search-related message",
                ToolKind::Mcp,
            ),
            desc("foo__noise", "noise", "totally unrelated", ToolKind::Mcp),
        ];
        let ranked = ToolRanker::Bm25.rank("search", items, 8, None).await;
        assert_eq!(ranked[0].name, "search", "exact name match ranks first");
        assert!(ranked.iter().all(|d| d.score.is_some()));
        // The unrelated tool should rank last (zero score).
        assert_eq!(ranked.last().unwrap().name, "noise");
    }

    #[tokio::test]
    async fn ranker_selectable_from_pref() {
        assert_eq!(ToolRanker::from_pref(None), ToolRanker::Bm25);
        assert_eq!(ToolRanker::from_pref(Some("bm25")), ToolRanker::Bm25);
        assert_eq!(
            ToolRanker::from_pref(Some("semantic")),
            ToolRanker::Semantic
        );
        // BM25 path produces a deterministic exact-match-first ordering. (The
        // Semantic path needs a reachable embedder, which is not asserted here.)
        let items = vec![
            desc("foo__search", "search", "find things", ToolKind::Mcp),
            desc("foo__x", "x", "nothing", ToolKind::Mcp),
        ];
        let ranked = ToolRanker::Bm25.rank("search", items, 8, None).await;
        assert_eq!(ranked[0].name, "search");
    }

    #[test]
    fn described_args_extracts_required_flag() {
        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "url": { "type": "string", "description": "page url" },
                "depth": { "type": "integer" }
            },
            "required": ["url"]
        });
        let mut args = described_args(Some(&schema));
        args.sort_by(|a, b| a.name.cmp(&b.name));
        assert_eq!(args.len(), 2);
        let url = args.iter().find(|a| a.name == "url").unwrap();
        assert_eq!(url.r#type, "string");
        assert_eq!(url.description, "page url");
        assert!(url.required);
        let depth = args.iter().find(|a| a.name == "depth").unwrap();
        assert_eq!(depth.r#type, "integer");
        assert!(!depth.required);
    }

    #[test]
    fn describe_composio_id_is_shallow() {
        let d = describe_composio("composio__GITHUB_CREATE_ISSUE");
        assert!(d.shallow);
        assert_eq!(d.kind, ToolKind::Composio);
        assert_eq!(d.name, "GITHUB_CREATE_ISSUE");
        assert_eq!(d.args.len(), 1);
        assert_eq!(d.args[0].name, "arguments");
        assert_eq!(d.args[0].r#type, "object");
    }

    #[test]
    fn describe_from_parts_shapes_schema_and_shallow_flag() {
        let schema = serde_json::json!({
            "type": "object",
            "properties": { "url": { "type": "string" } },
            "required": ["url"]
        });
        let d = describe_from_parts(
            "spider__crawl",
            "crawl",
            "",
            ToolKind::Builtin,
            Some(&schema),
        );
        assert!(!d.shallow);
        assert_eq!(d.kind, ToolKind::Builtin);
        assert_eq!(d.args.len(), 1);
        assert_eq!(d.parameters.as_ref(), Some(&schema));
        // No schema → shallow, no args.
        let bare = describe_from_parts("foo__bar", "bar", "", ToolKind::Mcp, None);
        assert!(bare.shallow);
        assert!(bare.args.is_empty());
    }

    #[tokio::test]
    async fn run_search_filters_builtins_by_kind_but_appends_composio() {
        // `kind = Composio`: built-ins filtered out, the caller-fetched Composio
        // candidates (searchable-not-listed) still appear.
        let builtins = vec![
            desc("foo__search", "search", "search the web", ToolKind::Mcp),
            desc("bar__do", "do", "do a thing", ToolKind::Builtin),
        ];
        let composio = vec![desc("composio__slack", "Slack", "send", ToolKind::Composio)];
        let out = run_search(
            "search",
            builtins,
            composio,
            Some(ToolKind::Composio),
            25,
            ToolRanker::Bm25,
            None,
        )
        .await;
        assert!(out.iter().all(|d| d.kind == ToolKind::Composio));
        assert!(out.iter().any(|d| d.id == "composio__slack"));

        // `kind = None`: everything is ranked; no Composio unless the caller
        // passed candidates (mirrors Core's key-gated fetch — empty here).
        let builtins = vec![desc("foo__search", "search", "the web", ToolKind::Mcp)];
        let out = run_search(
            "search",
            builtins,
            Vec::new(),
            None,
            25,
            ToolRanker::Bm25,
            None,
        )
        .await;
        assert_eq!(out.len(), 1);
        assert!(out.iter().all(|d| d.kind != ToolKind::Composio));
    }
}
