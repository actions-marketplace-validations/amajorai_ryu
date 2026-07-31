//! Core-side binding for the extracted unified tool catalog (#474, P1).
//!
//! The catalog *contract + ranker + describe-shaping* (the portable data layer)
//! now lives in the [`ryu_tool_registry`] crate. This module is the thin kernel
//! glue that binds it to the [`McpRegistry`] sidecar object:
//!
//! - the `RegistryTool` → [`ToolDescriptor`] ingest adapter ([`descriptor_from`]),
//! - the built-in server inventory classification ([`classify_kind`]), which
//!   depends on Core's concrete sidecar server inventory (`SELF_BUILD_SERVER`,
//!   the built-in server list) and so cannot live in the crate,
//! - the live, key-gated Composio fetch ([`composio_candidates`]),
//! - the Agent-Skill merge ([`McpRegistry::skill_candidates`] /
//!   [`McpRegistry::describe_skill`]), which turns two discovery doors into one, and
//! - the two [`McpRegistry`] methods ([`McpRegistry::search_scoped`] /
//!   [`McpRegistry::describe`]) that gather kernel state and delegate the pure
//!   work to [`ryu_tool_registry::run_search`] /
//!   [`ryu_tool_registry::describe_from_parts`] / [`ryu_tool_registry::describe_composio`].
//!
//! The Contract-1 types are re-exported so existing `mcp::catalog::…` call sites
//! (the `/api/tools/{search,describe}` handlers, the mcp_bridge meta-tool) keep
//! resolving unchanged.
//!
//! Placement (CLAUDE.md §1): discovering *what tools exist* and ranking them is
//! orchestration → Core. The allowlist verdict / budget / audit is Gateway.

use serde_json::Value;

pub use ryu_tool_registry::{
    DescribedArg, DescribedTool, ToolDescriptor, ToolKind, ToolRanker, RANKER_PREF_KEY,
};

use super::{AppToolBackendTag, McpRegistry, RegistryTool};

/// Built-in server names — their tools are classified [`ToolKind::Builtin`].
const BUILTIN_SERVERS: &[&str] = &[
    super::sandbox::SERVER_NAME,
    super::notify_tool::SERVER_NAME,
    super::artifact_tool::SERVER_NAME,
    super::channel_tool::SERVER_NAME,
    super::search_conversations::SERVER_NAME,
    super::threads::SERVER_NAME,
    super::delegate::SERVER_NAME,
    super::skills_tool::SERVER_NAME,
    super::ui_tool::SERVER_NAME,
];

/// Classify a fully-qualified tool id (`<server>__<tool>`) into a [`ToolKind`].
///
/// `composio__*` → Composio; a built-in server segment → Builtin; the synthetic
/// `app` server (tool-as-Runnable) → App; the self-build server → Builtin;
/// anything else → Mcp. Bound to Core's sidecar server inventory, so it stays
/// kernel-side rather than in the crate.
pub fn classify_kind(id: &str, server: &str) -> ToolKind {
    if server == super::composio::SERVER_NAME {
        return ToolKind::Composio;
    }
    let _ = id;
    if server == "app" {
        return ToolKind::App;
    }
    if server == super::SELF_BUILD_SERVER || BUILTIN_SERVERS.contains(&server) {
        return ToolKind::Builtin;
    }
    ToolKind::Mcp
}

/// Resolve a registry row's [`ToolKind`], honoring its `app_backend` tag: a
/// `command`-tagged app tool surfaces as [`ToolKind::Command`] (so `?kind=command`
/// selects it); every other row — including http/inline_deno/alias app tools —
/// falls back to inventory-based [`classify_kind`]. This is the ONE place the
/// deliberate command-vs-App asymmetry lives; `classify_kind`'s signature (and its
/// tests) are untouched.
fn kind_for(tool: &RegistryTool) -> ToolKind {
    if tool.app_backend == Some(AppToolBackendTag::Command) {
        return ToolKind::Command;
    }
    classify_kind(&tool.id, &tool.server)
}

/// Build a descriptor from a registry tool (`Option<String>` → `String`). The
/// `RegistryTool`→[`ToolDescriptor`] ingest adapter — bound to Core's registry
/// row type, so it stays kernel-side; the arg extraction reuses the crate's
/// [`ryu_tool_registry::arg_summary`].
fn descriptor_from(tool: &RegistryTool) -> ToolDescriptor {
    let (arg_names, arg_descriptions) = ryu_tool_registry::arg_summary(tool.input_schema.as_ref());
    ToolDescriptor {
        id: tool.id.clone(),
        name: tool.name.clone(),
        description: tool.description.clone().unwrap_or_default(),
        kind: kind_for(tool),
        arg_names,
        arg_descriptions,
        score: None,
        meta: tool.meta.clone(),
        widget_accessible: tool.widget_accessible,
        output_template: tool.output_template.clone(),
    }
}

impl McpRegistry {
    // There is deliberately no three-argument `search(query, kind, limit)`
    // convenience any more. It existed as "the unscoped, agent-less default" and
    // forwarded to `search_scoped(.., &[])` — and the one production caller that
    // used it, `GET /api/tools/search`, was the plane whose missing skill scoping
    // this method's own doc comment used to describe as an open hole. A shorter
    // name that silently means "show every skill on the node" is how that hole got
    // there; every caller now names its scope, and `&[]` still means "every enabled
    // skill" for the agent-less callers (workflows, monitors, the approval engine)
    // that genuinely want it.

    /// Search the unified catalog: MCP + built-ins + Composio + plugin tools + Core
    /// self-API + **Agent Skills**. `kind` filters by source plane (`None` = any).
    /// Composio is pulled in **live** (capped at 50) only when a key is configured
    /// and `kind` includes Composio; it is never in `list_all_tools`.
    ///
    /// Gathers kernel state (registry rows + live Composio + enabled skills) and
    /// delegates the filter/merge/rank to [`ryu_tool_registry::run_search`]. Ranking
    /// uses the pref-selected [`ToolRanker`] (BM25 default); the Semantic ranker's
    /// embedder is built lazily via [`crate::tool_registry_host`].
    ///
    /// ## `skills_allowlist` — where every plane gets its value
    ///
    /// This is the calling agent's **skill** allowlist (`AgentRecord.skills`), the
    /// same list `skills__search` / `skills__load` scope on; empty = every enabled
    /// skill. It is a different list from the tool allowlist, so it has to be
    /// threaded here rather than applied afterwards. Every caller today:
    ///
    /// - agent-less callers → empty → identical to `skills__search`'s own default;
    /// - the ACP plane → resolved from the bound agent in
    ///   `mcp_bridge::dispatch_tool_search` (and, so the two cannot be played against
    ///   each other, in `dispatch_describe` via [`Self::describe_scoped`]) from the
    ///   same agent id and the same `AgentRecord.skills` field the `skills` provider
    ///   reads at dispatch. So on that plane `tool_search` and `skills__search` show
    ///   the same skills;
    /// - **`GET /api/tools/search?agent=X`** → resolved from the same store and the
    ///   same field, in `server::agent_skill_allowlist`. This is also what scopes the
    ///   openai-compat chat plane, whose tool loop reaches this method through that
    ///   route (`apps/gateway/src/tools/catalog_client.rs`).
    ///
    ///   The chat plane's id is the same one Core resolves the *injection* allowlist
    ///   from for the same turn — `adapters::resolve_binding(effective_agent_id,
    ///   &agent_store)` calls `store.get(id)` and reads `.skills`, and that same
    ///   `effective_agent_id` is what leaves as the `x-ryu-agent-id` header. So the
    ///   id is known to live in `AgentStore`'s space; this is traced, not assumed.
    ///   **But** the gateway only honors that header when the API key is a
    ///   `trusted_forwarder` (`pipeline::mod`, `eff_agent_id`); otherwise `agent_id`
    ///   is `None`, no `?agent=` is sent, and the search is unscoped — every enabled
    ///   skill, as for any agent-less caller. That is the pre-existing identity
    ///   posture, not something this scoping introduced: a request that cannot prove
    ///   which agent it is has no allowlist to be narrowed to.
    ///
    /// That handler ALSO narrows afterwards with `ToolDescriptor::matches_allowlist`
    /// against the env-derived MCP *tool* allowlist (`AcpAgentRegistry::allowlist_for`
    /// — `RYU_MCP_ALLOWLIST_<AGENT>` then `RYU_MCP_ALLOWLIST`, `None` when neither is
    /// set). That second filter is not a skill gate and never was: its `Skill` arm
    /// gates reaching the `skills` *server*, not an individual skill, and on a stock
    /// node with no such variable it narrows nothing at all. Which is why the skill
    /// list had to be threaded in here — before it was, an agent scoped to two skills
    /// got every enabled skill on the node back as an L1 row (id/name/description),
    /// though `skills__load` still refused the bodies.
    pub async fn search_scoped(
        &self,
        query: &str,
        kind: Option<ToolKind>,
        limit: usize,
        skills_allowlist: &[String],
    ) -> Vec<ToolDescriptor> {
        let mut builtins: Vec<ToolDescriptor> = self
            .list_all_tools()
            .await
            .iter()
            .map(descriptor_from)
            .collect();
        // Core self-API tools (agents driving Ryu itself): OpenAPI-derived, always
        // present, merged HERE so they rank through the same BM25/semantic pass as
        // everything else rather than being appended after truncation. Kind-filtered
        // by `run_search` like any other descriptor.
        builtins.extend(crate::self_api::descriptors());

        // Agent Skills, merged for the same reason and on the same terms: one search
        // door, one ranking pass, `kind`-filtered by `run_search` like anything else.
        // Merged at search time only — skills stay out of `list_all_tools`, so
        // nothing ever offers one as a callable function def.
        let skill_rows = self.skill_candidates(skills_allowlist, &builtins);
        builtins.extend(skill_rows);

        // Composio: searchable-not-listed. Pull live, capped, key-gated.
        let want_composio = matches!(kind, None | Some(ToolKind::Composio));
        let composio = if want_composio && super::composio::is_configured() {
            composio_candidates(&self.http, query).await
        } else {
            Vec::new()
        };

        let ranker = self.resolve_ranker().await;
        let embedder = matches!(ranker, ToolRanker::Semantic)
            .then(crate::tool_registry_host::CoreToolEmbedder::from_registry);
        ryu_tool_registry::run_search(
            query,
            builtins,
            composio,
            kind,
            limit,
            ranker,
            embedder
                .as_ref()
                .map(|e| e as &dyn ryu_tool_registry::ToolEmbedder),
        )
        .await
    }

    /// Enabled, loadable Agent Skills as catalog descriptors (`skills__<slug>`,
    /// [`ToolKind::Skill`]), scoped by `skills_allowlist` (empty = all enabled).
    ///
    /// `already_listed` is the tool half of the candidate set, used to drop the one
    /// genuine collision this namespace has: the `skills` server's own tools are
    /// `skills__search` / `skills__load` / `skills__author`, so a skill whose slug is
    /// literally `search`, `load` or `author` would mint a duplicate id. The **tool**
    /// wins — it is the callable thing, `describe` resolves it first, and a duplicate
    /// id in a ranked list the model picks from by id is worse than a shadowed skill.
    /// The shadowed skill is still reachable through `skills__search` (which returns
    /// bare slugs and so cannot collide) and through `skills__load`. Three slugs, and
    /// this drops them by comparing ids rather than by hardcoding the three names, so
    /// a fourth `skills__*` tool cannot reintroduce the duplicate.
    ///
    /// Returns empty when no skill registry is wired (test/CLI contexts).
    fn skill_candidates(
        &self,
        skills_allowlist: &[String],
        already_listed: &[ToolDescriptor],
    ) -> Vec<ToolDescriptor> {
        let Some(skills) = self.skills.as_ref() else {
            return Vec::new();
        };
        skills
            .enabled_for(skills_allowlist)
            .iter()
            // A body-less record (a plugin skill registered but not materialised on
            // disk) is excluded: `skills__load` has nothing to return for it. See
            // `skills_tool::is_loadable`.
            .filter(|s| super::skills_tool::is_loadable(s))
            .map(super::skills_tool::descriptor_for)
            .filter(|d| !already_listed.iter().any(|t| t.id == d.id))
            .collect()
    }

    /// Describe a single catalog entry by its fully-qualified id. Returns `None`
    /// when the id is not found. A `composio__*` id is `shallow:true` with a single
    /// freeform `arguments` row (the action's full schema is not listed).
    ///
    /// A `skills__<slug>` id that is not one of the `skills` server's own tools
    /// describes the **Agent Skill** — see [`Self::describe_skill`]. Real tools are
    /// resolved first, so `skills__search` / `skills__load` / `skills__author` always
    /// describe as the tools they are.
    ///
    /// Unscoped, like the `?agent=`-less HTTP route it backs. A caller that knows the
    /// agent should use [`Self::describe_scoped`] instead, or the skill rows a scoped
    /// search just withheld become readable by guessing the id.
    pub async fn describe(&self, id: &str) -> Option<DescribedTool> {
        self.describe_scoped(id, &[]).await
    }

    /// [`Self::describe`], with the calling agent's **skill** allowlist applied to
    /// the skill branch (empty = every enabled skill).
    ///
    /// Only the skill branch is scoped, because only skills have a second, per-agent
    /// list; tool descriptions are governed by the tool allowlist at *call* time, as
    /// they always were. Pairing this with [`Self::search_scoped`] is what makes the
    /// ACP plane's discovery genuinely equal to `skills__search`'s scope: scoping the
    /// search alone would have left `describe` handing back the `name` and
    /// `description` of any skill whose id an agent could guess.
    pub async fn describe_scoped(
        &self,
        id: &str,
        skills_allowlist: &[String],
    ) -> Option<DescribedTool> {
        // Composio: not in list_all_tools — describe shallowly.
        if id.starts_with("composio__") {
            return Some(ryu_tool_registry::describe_composio(id));
        }

        // Core self-API: not in list_all_tools — described from the OpenAPI route.
        if crate::self_api::is_core_api(id) {
            return crate::self_api::describe(id);
        }

        if let Some(tool) = self.list_all_tools().await.into_iter().find(|t| t.id == id) {
            return Some(ryu_tool_registry::describe_from_parts(
                &tool.id,
                &tool.name,
                tool.description.as_deref().unwrap_or_default(),
                kind_for(&tool),
                tool.input_schema.as_ref(),
            ));
        }

        // Skills: merged into search, absent from `list_all_tools` — so this is the
        // fallback, reached only after every real tool id has failed to match.
        self.describe_skill(id, skills_allowlist)
    }

    /// Describe a `skills__<slug>` id as the Agent Skill it names.
    ///
    /// The result is deliberately **not tool-shaped**: `kind` is [`ToolKind::Skill`]
    /// and `args` is empty, because there is no call to make against this id. The
    /// description carries the literal `skills__load` invocation, so a model that
    /// followed the search → describe path lands on the loader instead of trying to
    /// call the skill. (If it tries anyway, `skills_tool::dispatch` refuses; see that
    /// module's "Discovery is unified, execution is not".)
    ///
    /// Scoped by `skills_allowlist` exactly as `skills__load` is, so an out-of-scope
    /// id is indistinguishable from one that names no skill: both return `None`, which
    /// the HTTP route renders as the same 404 and the ACP bridge as the same
    /// `unknown tool id` error.
    fn describe_skill(&self, id: &str, skills_allowlist: &[String]) -> Option<DescribedTool> {
        let slug = super::skills_tool::slug_from_catalog_id(id)?;
        let skills = self.skills.as_ref()?;
        let record = skills
            .enabled_for(skills_allowlist)
            .into_iter()
            .find(|s| s.id == slug && super::skills_tool::is_loadable(s))?;
        let summary = record.description.unwrap_or_default();
        let lead = if summary.is_empty() {
            String::new()
        } else {
            format!("{summary} ")
        };
        Some(DescribedTool {
            id: id.to_string(),
            name: record.name,
            description: format!(
                "{lead}[Agent Skill — instruction text, not a callable tool.] Do not call \
                 '{id}'. Call {load} with {{\"id\": \"{slug}\"}}, then follow the \
                 instructions it returns for the rest of this turn.",
                load = super::skills_tool::LOAD_TOOL_ID,
            ),
            kind: ToolKind::Skill,
            args: Vec::new(),
            // Not `shallow`: there is no hidden argument schema to warn a caller
            // about. There are no arguments, because there is no call.
            shallow: false,
            parameters: None,
        })
    }

    /// Resolve the active ranker from preferences (BM25 default).
    async fn resolve_ranker(&self) -> ToolRanker {
        let pref = match crate::server::preferences::PreferencesStore::open_default() {
            Ok(p) => p.get(RANKER_PREF_KEY).await.ok().flatten(),
            Err(_) => None,
        };
        ToolRanker::from_pref(pref.as_deref())
    }
}

/// Fetch a capped slice of Composio actions as descriptors. Toolkit-agnostic
/// (empty toolkit → catalog drops the empty filter), capped at 50/search. Bound
/// to Core's Composio client, so it stays kernel-side.
async fn composio_candidates(http: &reqwest::Client, query: &str) -> Vec<ToolDescriptor> {
    const CAP: usize = 50;
    let raw = match crate::composio_catalog::list_actions(http, "", query, CAP).await {
        Ok(v) => v,
        Err(e) => {
            tracing::debug!("composio search skipped: {e}");
            return Vec::new();
        }
    };
    raw.get("data")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|a| {
                    let slug = a.get("name").and_then(Value::as_str)?;
                    if slug.is_empty() {
                        return None;
                    }
                    let name = a
                        .get("display_name")
                        .and_then(Value::as_str)
                        .filter(|s| !s.is_empty())
                        .unwrap_or(slug)
                        .to_string();
                    Some(ToolDescriptor {
                        id: format!("composio__{slug}"),
                        name,
                        description: a
                            .get("description")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                        kind: ToolKind::Composio,
                        arg_names: Vec::new(),
                        arg_descriptions: Vec::new(),
                        score: None,
                        meta: None,
                        widget_accessible: false,
                        output_template: None,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_kind_by_server() {
        assert_eq!(
            classify_kind("sandbox__run", super::super::sandbox::SERVER_NAME),
            ToolKind::Builtin
        );
        assert_eq!(classify_kind("foo__bar", "foo"), ToolKind::Mcp);
        assert_eq!(
            classify_kind("composio__slack", "composio"),
            ToolKind::Composio
        );
        // `shadow`/`advisor` are now declarative `app`-registered plugin tools
        // (server "app"), not built-in servers — they classify as App like exa.
        assert_eq!(classify_kind("app__thing", "app"), ToolKind::App);
        assert_eq!(
            classify_kind("skills__load", super::super::skills_tool::SERVER_NAME),
            ToolKind::Builtin
        );
    }

    #[test]
    fn description_option_maps_to_empty_string() {
        let tool = RegistryTool::candidate("foo__bar", "foo", "bar");
        let d = descriptor_from(&tool);
        assert_eq!(d.description, "");
        assert_eq!(d.kind, ToolKind::Mcp);
    }

    #[tokio::test]
    async fn command_tagged_tool_classifies_and_searches_as_command() {
        let reg = McpRegistry::empty();
        // A command-tagged app tool …
        reg.register_app_tool_tagged(
            "app__exa_search".into(),
            "exa_search".into(),
            Some("Search the web".into()),
            Some(AppToolBackendTag::Command),
        );
        // … and an http-tagged one (which must stay classified as App).
        reg.register_app_tool_tagged(
            "app__other".into(),
            "other".into(),
            None,
            Some(AppToolBackendTag::Http),
        );

        // descriptor_from → Command, and search(kind=Command) selects it.
        let results = reg
            .search_scoped("exa_search", Some(ToolKind::Command), 25, &[])
            .await;
        assert!(
            results
                .iter()
                .any(|d| d.id == "app__exa_search" && d.kind == ToolKind::Command),
            "command tool must be surfaced + selected by kind=command"
        );
        // The http app tool is NOT a command (asymmetry) — absent from kind=Command.
        assert!(
            results.iter().all(|d| d.id != "app__other"),
            "http app tool must not appear under kind=command"
        );

        // describe honors the tag on both sites.
        let described = reg.describe("app__exa_search").await.expect("described");
        assert_eq!(described.kind, ToolKind::Command);
        let http_desc = reg.describe("app__other").await.expect("described");
        assert_eq!(http_desc.kind, ToolKind::App);
    }

    // ── Agent Skills in the one catalog ──────────────────────────────────────

    fn skill(id: &str, name: &str, desc: &str, body: &str) -> ryu_skills::SkillRecord {
        ryu_skills::SkillRecord {
            id: id.to_owned(),
            name: name.to_owned(),
            description: Some(desc.to_owned()),
            instructions: body.to_owned(),
            allowed_tools: vec![],
            enabled: true,
            always_on: false,
        }
    }

    fn registry_with_skills(skills: Vec<ryu_skills::SkillRecord>) -> McpRegistry {
        let reg = ryu_skills::SkillRegistry::empty();
        reg.replace_for_test(skills);
        McpRegistry::empty().with_skills(reg)
    }

    /// The point of the whole change: one query ranks tools and skills together,
    /// and the row says which it got.
    #[tokio::test]
    async fn search_returns_tools_and_skills_from_one_query() {
        let reg = registry_with_skills(vec![skill(
            "merge-conflicts",
            "Resolve merge conflicts",
            "resolve a git merge conflict safely",
            "## Purpose\nresolve conflicts",
        )]);
        reg.register_app_tool_tagged(
            "app__git_status".into(),
            "git_status".into(),
            Some("show the git working tree status".into()),
            Some(AppToolBackendTag::Http),
        );

        let results = reg
            .search_scoped("git conflict status", None, 25, &[])
            .await;
        let skill_row = results
            .iter()
            .find(|d| d.id == "skills__merge-conflicts")
            .expect("the skill is in the merged catalog");
        assert_eq!(skill_row.kind, ToolKind::Skill, "the row names its plane");
        assert_eq!(skill_row.name, "Resolve merge conflicts");
        let tool_row = results
            .iter()
            .find(|d| d.id == "app__git_status")
            .expect("the tool is still in the merged catalog");
        assert_eq!(tool_row.kind, ToolKind::App);
    }

    /// `?kind=skill` is the filtered view of the one catalog, and every other
    /// filter still excludes skills.
    #[tokio::test]
    async fn kind_filter_selects_and_excludes_skills() {
        let reg = registry_with_skills(vec![skill(
            "web-research",
            "Web research",
            "search the web methodically",
            "## Purpose\nresearch",
        )]);
        reg.register_app_tool_tagged(
            "app__web_search".into(),
            "web_search".into(),
            Some("search the web".into()),
            Some(AppToolBackendTag::Http),
        );

        let only_skills = reg
            .search_scoped("web search", Some(ToolKind::Skill), 25, &[])
            .await;
        assert!(!only_skills.is_empty());
        assert!(
            only_skills.iter().all(|d| d.kind == ToolKind::Skill),
            "kind=skill must return skills only: {only_skills:?}"
        );

        let only_apps = reg
            .search_scoped("web search", Some(ToolKind::App), 25, &[])
            .await;
        assert!(
            only_apps.iter().all(|d| d.kind != ToolKind::Skill),
            "a non-skill filter must not leak skill rows"
        );
    }

    /// The one genuine id collision in this namespace: a skill slugged `search`
    /// would mint `skills__search`, which is the search TOOL's id. The tool wins,
    /// and the skill row is dropped rather than duplicating an id the model picks
    /// from.
    #[tokio::test]
    async fn a_skill_slug_colliding_with_a_skills_tool_is_dropped_from_the_catalog() {
        let reg = registry_with_skills(vec![skill(
            "search",
            "A skill called search",
            "this collides with skills__search",
            "## Purpose\ncollide",
        )]);
        let results = reg.search_scoped("search", None, 25, &[]).await;
        let rows: Vec<&ToolDescriptor> = results
            .iter()
            .filter(|d| d.id == "skills__search")
            .collect();
        assert_eq!(rows.len(), 1, "exactly one row may own an id: {rows:?}");
        assert_eq!(
            rows[0].kind,
            ToolKind::Builtin,
            "the callable tool wins the id, not the skill"
        );
        // …and `describe` agrees with `search` about who owns it.
        let described = reg.describe("skills__search").await.expect("described");
        assert_eq!(described.kind, ToolKind::Builtin);
        assert!(
            !described.args.is_empty(),
            "the search tool keeps its real argument schema"
        );
    }

    /// `describe` on a skill leads the model to `skills__load` and gives it nothing
    /// to call.
    #[tokio::test]
    async fn describe_on_a_skill_points_at_the_loader() {
        let reg = registry_with_skills(vec![skill(
            "pdf-processing",
            "Process PDFs",
            "extract text from a PDF",
            "## Purpose\npdf",
        )]);
        let d = reg
            .describe("skills__pdf-processing")
            .await
            .expect("a merged skill must be describable");
        assert_eq!(d.kind, ToolKind::Skill);
        assert!(
            d.args.is_empty(),
            "there are no arguments, there is no call"
        );
        assert!(d.parameters.is_none());
        assert!(
            d.description
                .contains(super::super::skills_tool::LOAD_TOOL_ID),
            "describe must name the loader: {}",
            d.description
        );
        assert!(
            d.description.contains("\"id\": \"pdf-processing\""),
            "describe must spell out the bare id skills__load takes: {}",
            d.description
        );
        // An id in the namespace that names no skill is simply unknown.
        assert!(reg.describe("skills__nope").await.is_none());
    }

    /// A plugin-registered skill with no instruction body has nothing to load, so
    /// it must not be advertised. `register_app_skill` creates exactly this record
    /// on plugin enable.
    #[tokio::test]
    async fn a_registered_but_unmaterialised_plugin_skill_is_not_advertised() {
        let skills = ryu_skills::SkillRegistry::empty();
        skills.register_app_skill(
            "app__summarize".into(),
            "Summarize".into(),
            Some("App-registered skill (skill_id: summarize)".into()),
        );
        let reg = McpRegistry::empty().with_skills(skills);

        let results = reg.search_scoped("summarize", None, 25, &[]).await;
        assert!(
            results.iter().all(|d| d.id != "skills__app__summarize"),
            "a body-less skill must not be offered: {results:?}"
        );
        assert!(reg.describe("skills__app__summarize").await.is_none());
    }

    /// `search_scoped` applies the calling agent's SKILL allowlist — the same
    /// predicate `skills__search` / `skills__load` use — while the plain `search`
    /// entry point stays unscoped (agent-less callers see every enabled skill).
    #[tokio::test]
    async fn search_scoped_narrows_skills_to_the_agents_skill_allowlist() {
        let reg = registry_with_skills(vec![
            skill("mine", "Mine", "a skill I may load", "## Purpose\nmine"),
            skill(
                "theirs",
                "Theirs",
                "a skill I may not load",
                "## Purpose\ntheirs",
            ),
        ]);

        let scoped = reg
            .search_scoped("skill", None, 25, &["mine".to_string()])
            .await;
        assert!(scoped.iter().any(|d| d.id == "skills__mine"));
        assert!(
            scoped.iter().all(|d| d.id != "skills__theirs"),
            "an out-of-allowlist skill must not appear: {scoped:?}"
        );

        // Empty allowlist = every enabled skill (enabled_for's back-compat default),
        // which is what the unscoped `search` entry point passes.
        let unscoped = reg.search_scoped("skill", None, 25, &[]).await;
        assert!(unscoped.iter().any(|d| d.id == "skills__mine"));
        assert!(unscoped.iter().any(|d| d.id == "skills__theirs"));
    }

    /// **The end-to-end execution boundary.** A model handed `skills__<slug>` by the
    /// merged catalog may try to call it. This exercises the real routing —
    /// `call_tool` → `split_tool_id` → the `skills` provider → `skills_tool::dispatch`
    /// — and asserts it refuses and names the loader, rather than dispatching or
    /// dying with an opaque "malformed tool id".
    ///
    /// Both allowlist postures are covered: an unrestricted caller (`None`, which is
    /// what a `"*"` tool-policy request lowers to) and a caller explicitly granted
    /// the `skills` server. Neither may turn a skill into a function call.
    #[tokio::test]
    async fn calling_a_skill_catalog_id_as_a_tool_is_refused_end_to_end() {
        let reg = registry_with_skills(vec![skill(
            "pdf-processing",
            "Process PDFs",
            "extract text",
            "## Purpose\npdf",
        )]);
        // It really is in the catalog — otherwise this test would pass vacuously.
        assert!(reg
            .search_scoped("pdf", None, 25, &[])
            .await
            .iter()
            .any(|d| d.id == "skills__pdf-processing"));

        for allowlist in [
            None,
            Some(vec!["skills".to_string()]),
            Some(vec!["skills__pdf-processing".to_string()]),
        ] {
            let err = reg
                .call_tool(
                    "skills__pdf-processing",
                    serde_json::json!({}),
                    allowlist.as_deref(),
                )
                .await
                .expect_err("a skill id must never execute as a tool");
            let msg = err.to_string();
            assert!(
                msg.contains("not a callable tool")
                    || msg.contains("not in this agent's allowlist"),
                "unexpected refusal for {allowlist:?}: {msg}"
            );
        }

        // The refusal is specifically the skill-aware one for a caller that IS
        // allowed to reach the skills server (the allowlist branch cannot mask it).
        let msg = reg
            .call_tool(
                "skills__pdf-processing",
                serde_json::json!({}),
                Some(&["skills".to_string()]),
            )
            .await
            .expect_err("refused")
            .to_string();
        assert!(
            msg.contains(super::super::skills_tool::LOAD_TOOL_ID),
            "{msg}"
        );

        // …while the real `skills__load` tool still works through the same path.
        let loaded = reg
            .call_tool(
                super::super::skills_tool::LOAD_TOOL_ID,
                serde_json::json!({ "id": "pdf-processing" }),
                Some(&["skills".to_string()]),
            )
            .await
            .expect("skills__load is a real tool");
        assert_eq!(loaded["ok"], serde_json::json!(true), "{loaded}");
        assert_eq!(loaded["instructions"], serde_json::json!("## Purpose\npdf"));
    }

    /// Scoping the search but not `describe` would have let an agent recover, by
    /// guessing `skills__<slug>`, the exact L1 metadata the scoped search withheld.
    /// An out-of-scope id must be indistinguishable from a nonexistent one.
    #[tokio::test]
    async fn describe_scoped_hides_skills_outside_the_agents_allowlist() {
        let reg = registry_with_skills(vec![
            skill("mine", "Mine", "a skill I may load", "## Purpose\nmine"),
            skill(
                "theirs",
                "Theirs",
                "a skill I may not load",
                "## Purpose\ntheirs",
            ),
        ]);
        let allow = ["mine".to_string()];

        assert!(reg.describe_scoped("skills__mine", &allow).await.is_some());
        assert!(
            reg.describe_scoped("skills__theirs", &allow)
                .await
                .is_none(),
            "an out-of-allowlist skill must describe as unknown"
        );
        // Same verdict as an id that names nothing at all.
        assert!(reg.describe_scoped("skills__nope", &allow).await.is_none());

        // Tool descriptions are untouched by the skill allowlist — only the skill
        // branch is scoped.
        assert!(reg
            .describe_scoped(super::super::skills_tool::LOAD_TOOL_ID, &allow)
            .await
            .is_some());

        // The unscoped entry point (the `?agent=`-less HTTP route) is unchanged.
        assert!(reg.describe("skills__theirs").await.is_some());
    }

    /// No skill registry wired (test/CLI contexts) ⇒ no skill rows, no panic.
    #[tokio::test]
    async fn search_without_a_skill_registry_yields_no_skill_rows() {
        let reg = McpRegistry::empty();
        let results = reg.search_scoped("anything", None, 25, &[]).await;
        assert!(results.iter().all(|d| d.kind != ToolKind::Skill));
        assert!(reg.describe("skills__whatever").await.is_none());
    }

    #[tokio::test]
    async fn search_excludes_composio_without_key() {
        // Serialize against every test that mutates the composio auth cache /
        // key env (process-global), so the "no key" state holds for this body.
        let _lock = crate::sidecar::gateway::lock_managed_node_env();
        crate::composio_auth::set_key("");
        std::env::remove_var("RYU_COMPOSIO_API_KEY");
        std::env::remove_var("COMPOSIO_API_KEY");
        let reg = McpRegistry::empty();
        let results = reg.search_scoped("anything", None, 25, &[]).await;
        assert!(
            results.iter().all(|d| d.kind != ToolKind::Composio),
            "no Composio results when no key configured"
        );
    }
}
