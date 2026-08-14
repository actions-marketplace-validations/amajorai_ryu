//! **App manifest** — the `ryu.json` bundle descriptor for an installable Ryu App.
//!
//! # Scope (M3: type + parse + loader + list endpoint)
//!
//! This module defines the [`PluginManifest`] type, supports serde deserialisation of
//! a `ryu.json` file, and provides [`PluginManifestLoader`] — a scanner that reads
//! `~/.ryu/apps/*/ryu.json` (env-overridable via `RYU_APPS_DIR`), validates semver,
//! rejects duplicate ids, and merges built-in manifests with user-installed ones.
//! There is **no install/enable lifecycle here** — that lands in M3's install units.
//! There is **no permission-grant enforcement here** — grant enforcement belongs to
//! the Gateway (the Gateway decides what is *allowed*; Core decides what *runs*).
//!
//! # Distinction from the sidecar version catalog
//!
//! [`crate::catalog`] is the *sidecar version catalog*: it tracks what binary
//! versions of sidecars (providers, tools, agents) are available for download and
//! installation into `~/.ryu/bin`. It is an internal infrastructure concept.
//!
//! An [`PluginManifest`] is a *user-facing bundle descriptor* — a `ryu.json` file that
//! ships with (or describes) a Ryu App: it names the Runnables the app bundles, the
//! permission grants it needs, and an optional Companion surface. The two concepts
//! are deliberately kept separate and carry distinct names.
//!
//! # Per-kind config and validation
//!
//! Each Runnable entry in a manifest carries a `kind` discriminant
//! ([`crate::runnable::RunnableKind`]) and an optional typed `config` blob.
//! The per-kind config structs and the [`schema::validate_runnable`] function
//! live in the [`schema`] submodule; [`PluginManifestLoader`] runs validation during
//! loading and rejects any manifest whose Runnables fail their per-kind contract.

pub mod agent_plugin;
mod builtin_code;
pub mod schema;

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use schema::validate_runnable;

// The `manifest.json` data model + validation (PluginManifest, Surface, Requires,
// the per-kind schema types, validate_plugin_id, parse_min_version, …) now has a
// single definition in the `ryu-kernel-contracts` crate. Re-export the whole
// surface so every `crate::plugin_manifest::<Type>` call site (hundreds of them)
// resolves unchanged. Only Core-specific, I/O-bearing pieces stay below: the
// `PluginManifestLoader`, `core_version`, the built-in fixtures, and UI consts.
pub use ryu_kernel_contracts::manifest::*;

/// Resolve every path a manifest references into its inline wire form — `code_file`
/// → `code` and `output_styles[].file` → `source` — from the one source that can
/// actually hold the file for this manifest's provenance.
///
/// Two provenances, two sources, and the fork is not cosmetic:
///
/// - **`code_base: None` — a compiled-in built-in.** Its package directory does not
///   exist on the user's machine (Core embeds only the `manifest.json`), so the
///   bodies come from the [`builtin_code`] tables, which embed them with the same
///   `include_str!` mechanism. A path missing from a table is a hard error: the
///   alternative is a hook that loads with an empty body and silently never acts, or
///   a style that silently degrades to "no style".
/// - **`code_base: Some(dir)` — a manifest read off disk** (`~/.ryu/plugins/<id>/`,
///   a satellite checkout, a dev tree). Its files are right there next to it, so
///   they are read directly. [`validate_code_file_path`] /
///   [`validate_output_style_path`] have already constrained the path to
///   `<hooks|adapters>/<name>.js` / `output-styles/<name>.md` with no traversal, so
///   the join stays inside the plugin directory.
///
/// # Why both carriage paths run from ONE function
///
/// Not for brevity — for coverage. This is the single seam every manifest reaches
/// Core through (the loader below, `plugin_host`'s disk read, and `self_build`'s two
/// call sites), so a second sibling function would have to be threaded through all
/// four, and the one that got missed would leave a third-party plugin's styles
/// un-hydrated: `source` empty, `file` still set, and no error anywhere — the plugin
/// installs, enables, and contributes nothing.
pub fn hydrate_manifest_code_files(
    manifest: &mut PluginManifest,
    code_base: Option<&Path>,
) -> Result<(), String> {
    let plugin_id = manifest.id.clone();
    manifest.hydrate_code_files(|rel| match code_base {
        Some(dir) => std::fs::read_to_string(dir.join(rel))
            .map_err(|e| format!("{}: {e}", dir.join(rel).display())),
        None => builtin_code::lookup(&plugin_id, rel)
            .map(str::to_owned)
            .ok_or_else(|| {
                format!(
                "built-in plugin '{plugin_id}' references '{rel}', which is not embedded — add \
                 an include_str! row for it to plugin_manifest::builtin_code::BUILTIN_CODE_FILES"
            )
            }),
    })?;
    manifest.hydrate_output_style_files(|rel| match code_base {
        Some(dir) => std::fs::read_to_string(dir.join(rel))
            .map_err(|e| format!("{}: {e}", dir.join(rel).display())),
        None => builtin_code::lookup_output_style(&plugin_id, rel)
            .map(str::to_owned)
            .ok_or_else(|| {
                format!(
                    "built-in plugin '{plugin_id}' contributes output style file '{rel}', which \
                     is not embedded — add an include_str! row for it to \
                     plugin_manifest::builtin_code::BUILTIN_OUTPUT_STYLES"
                )
            }),
    })
}

/// The compiled-in source of a built-in plugin's `contributes.pi_extensions[].file`,
/// or `None` when nothing embeds that path.
///
/// The pi-extension half of [`hydrate_manifest_code_files`]'s built-in branch,
/// exposed as a lookup rather than a hydration step: a Pi extension is a file the
/// agent opens by path, so its bytes are needed exactly once, at the materializer
/// (`pi_config::app_extensions`), and never inside the manifest. See
/// [`PluginManifest::pi_extension_refs`] for why that asymmetry is deliberate.
pub fn builtin_pi_extension(plugin_id: &str, rel: &str) -> Option<&'static str> {
    builtin_code::lookup_pi_extension(plugin_id, rel)
}

/// The running Core version, as a parsed [`semver::Version`]. Authoritative
/// source for the `engines.ryu` version-pin gate. Derived from the crate version
/// (`CARGO_PKG_VERSION`), which is the single version of record for Core.
pub fn core_version() -> semver::Version {
    // `CARGO_PKG_VERSION` is always valid semver (Cargo enforces it), so this
    // parse never fails in practice; fall back to 0.0.0 defensively.
    semver::Version::parse(env!("CARGO_PKG_VERSION"))
        .unwrap_or_else(|_| semver::Version::new(0, 0, 0))
}

/// File names a plugin manifest may use on disk, in preference order. The new
/// canonical name is `manifest.json`; the previous `plugin.json` and the legacy
/// `ryu.json` are still read so that plugins installed before the rename keep
/// loading. First match wins, so a directory carrying both resolves to
/// `manifest.json`.
///
/// Shared with [`crate::runnable::self_build`] so there is exactly ONE copy of
/// this ordering inside Core.
pub(crate) const MANIFEST_FILE_NAMES: &[&str] = &["manifest.json", "plugin.json", "ryu.json"];

/// Resolve the **native** manifest in a plugin directory, skipping an Agent
/// Plugins spec `plugin.json`.
///
/// `plugin.json` is both the spec's manifest name (§5.1) and a legacy alias for
/// our own, so a plain first-match over [`MANIFEST_FILE_NAMES`] can hand a spec
/// file to a native `serde_json::from_str::<PluginManifest>` — which fails for
/// having no `id`/`runnables`. Every caller that wants a NATIVE manifest and does
/// not go through [`PluginManifestLoader::translate_agent_plugin`] must use this
/// instead of re-spelling the ordering.
///
/// The loader's own directory scan deliberately does NOT use this: it wants the
/// first match either way, and translates a spec file into native form.
#[must_use]
pub fn resolve_native_manifest_path(dir: &Path) -> Option<PathBuf> {
    MANIFEST_FILE_NAMES
        .iter()
        .map(|name| dir.join(name))
        .find(|candidate| {
            if !candidate.exists() {
                return false;
            }
            // Unreadable or unparseable: hand it back so the caller reports the
            // real error against this path rather than silently skipping it.
            std::fs::read_to_string(candidate)
                .map_or(true, |raw| !agent_plugin::is_agent_plugin_manifest(&raw))
        })
}

/// The canonical manifest file name — the ONE name every write/scaffold path
/// emits. Reads accept the legacy names via [`MANIFEST_FILE_NAMES`]; writes must
/// never re-introduce them, or the migration never completes.
pub const MANIFEST_FILE_NAME: &str = MANIFEST_FILE_NAMES[0];

/// Built-in plugin manifests compiled into the binary, always present regardless of
/// whether the user has a `~/.ryu/plugins/` directory.
///
/// (`sample.manifest.json` — the Research Assistant demo — is kept as a test-only
/// fixture and is deliberately NOT shipped as a built-in.)
/// - `spider.manifest.json` — Spider web crawler tool. A fully declarative
///   `command` plugin (Core-tier, default-on): its single runnable IS the crawl
///   tool, backed by a BYO `spider` CLI reached through the command-tool
///   allowlist. The native `sidecar/mcp/spider.rs` provider was deleted, so the
///   fixture is the SOLE owner of the tool (see the exception note below).
/// - `scrapling.manifest.json` — Scrapling adaptive page extraction (BYO local
///   install, no API key). The THIRD `web.extract` provider, `selectable` and
///   claiming no `default` (`spider` keeps it). Three things about it are
///   deliberate and each is silent if reverted:
///   1. It is **MCP-backed with empty `runnables`** — its tools come from
///      `scrapling mcp`, so the verb binds `web__extract` to `scrapling__get`
///      exactly as `agentbrowser` binds `browser__*`. Capability providers are not
///      required to be manifest runnables; nothing in `resolve_verbs` reads them.
///   2. It is **Core-tier but NOT in `CORE_DEFAULT_ON`**. Core-tier is a
///      requirement, not a promotion: `may_register_mcp_servers` auto-allows
///      manifest `mcp_servers` only for compiled-in fixtures, while a Community-tier
///      plugin needs the approved `mcp:server` grant — off the Gateway's default
///      allowlist and in a reserved namespace, so operator-only. A Community-tier
///      Scrapling would register nothing and be dead on arrival. It stays opt-in
///      because it needs a `pip install "scrapling[ai]"` the user must perform,
///      the same reason the BYOK search providers are opt-in.
///   3. It maps the verb through an **adapter, not a `response` map**, for two
///      shape facts verified against a live server rather than the docs: an MCP
///      `tools/call` answer is the transport envelope (`{content, structuredContent,
///      isError}`), and `ResponseModel.content` is an ARRAY of chunks with empty
///      entries. The canonical `content` is a string and `map_item` copies a located
///      value verbatim — it has no join — so the flattening lives in the one provider
///      whose quirk it is, exactly as `firecrawl` collapses its `metadata.title`
///      array. The adapter also passes an `isError`/untyped answer through under
///      `raw`, which is what keeps a broken install visible: Scrapling declares
///      `mcp>=1.27.0` unbounded and `mcp` 2.x renamed `mcp.server.fastmcp`, so
///      `scrapling mcp` crashing on import is reachable, not hypothetical.
///   It deliberately does NOT provide `web.crawl`: only Scrapling's Python `Spider`
///   class follows links and MCP does not expose it (the `bulk_*` tools fetch a URL
///   list you already have). Same reasoning as `firecrawl`'s absent crawl entry — a
///   partial `tools` map would join resolution and could win the pick away from
///   `spider`, silently killing a layer that works. Absent, not empty.
/// - `agentbrowser.manifest.json` — Agent Browser web-browsing tool (system plugin, npx MCP-backed).
/// - `exa.manifest.json` — Exa neural search tool plugin (U040, BYOK). Provides the
///   selectable `web.search` capability and is its declared default.
/// - `layers.manifest.json` — settings for the swappable capability layers. Owns the
///   `layer.<capability>.default.<arg>` preferences the capability tool facade merges
///   under every verb call. Deliberately NOT attached to any one provider: the
///   defaults apply whichever provider is selected, so hanging them off `exa` would
///   make them vanish the moment the user swapped to `tavily`.
/// - `tavily.manifest.json` — Tavily search+extract tool plugin (BYOK). The second
///   provider of `web.search`, which is what makes the layer demonstrably swappable:
///   selecting it re-points the stable `web__search` tool without changing the id or
///   schema an agent sees.
/// - `brave.manifest.json` — Brave Search tool plugin (BYOK). A third `web.search`
///   provider, and the one that proves the capability SPLIT was right: Brave's API is
///   search-only, so it declares `web.search` and neither `web.extract` nor
///   `web.crawl`. Its single tool is a GET whose arguments become query parameters,
///   so the verb binding renames the canonical `query`/`limit` onto Brave's real
///   query params `q`/`count`.
/// - `serper.manifest.json` — Serper Google-results tool plugin (BYOK, paid/credit-metered).
///   A `web.search` provider whose value is that the results are Google's own, and a
///   `web.extract` provider through a SEPARATE host: search is `POST
///   google.serper.dev/search`, scraping is `POST scrape.serper.dev` with no path at
///   all, so the manifest carries two egress grants rather than one. Neither of
///   Serper's argument names is canonical — the query is `q` and the result count is
///   `num` — so both are renamed in the verb binding. The extract binding declares
///   `response.fields` but NO `results` path on purpose: a scrape answers with a
///   single record (`text` / `markdown`), not an array, which the contract reads as
///   "the response itself is the record".
/// - `parallel.manifest.json` — Parallel search+extract tool plugin (BYOK, but see
///   below). A fourth `web.search` provider, and the second one after `exa` that
///   works with NO credential: Parallel publishes a PUBLIC Search MCP endpoint
///   (`search.parallel.ai/mcp`) alongside the keyed REST API, so the manifest
///   carries two egress grants and the verb goes through an ADAPTER that falls
///   back keyed → keyless, exactly as `exa` does. Unlike exa's, that endpoint is
///   stateless plain JSON-RPC — no `initialize`, no session, no SSE and no
///   `Accept` header — so the adapter reads `result.structuredContent` instead of
///   parsing an event-stream frame. Three further things force the adapter:
///   Parallel search takes an `objective` AND `search_queries`, so ONE canonical
///   `query` has to fan out to two args; its request bodies are
///   `additionalProperties: false` and expose NO result-count knob, so `limit` is
///   applied client-side; and each result's `excerpts` is an ARRAY of markdown
///   blocks where the canonical `snippet` is a string. `web.extract` needs none of
///   that and binds declaratively, asking for `advanced_settings.full_content` so
///   the per-URL record carries one markdown string.
/// - `ghost.manifest.json` — Ghost desktop-automation MCP tool (system plugin, Windows-first).
/// - `shadow.manifest.json` — Shadow screen/audio capture + semantic memory (system plugin, Windows-first).
///
/// The two sidecar-backed system tools (`agentbrowser`, `ghost`) declare an
/// **empty** `runnables` list on purpose: their tools are owned by the stdio MCP
/// server each declares under `mcp_servers` in its own fixture (`ghost` → the
/// `~/.ryu/bin/ghost mcp` binary; `agentbrowser` → `npx -y agentbrowser`),
/// registered into the MCP registry on activation by
/// `sidecar/mcp/register_manifest_mcp_servers` (they moved off the former
/// hardcoded `sidecar/mcp/mod.rs::builtin_servers`). `scrapling` shares that
/// empty-runnables shape for the same reason — its tools come from `scrapling mcp` —
/// but it is NOT a system plugin: there is no sidecar and no Core-managed process,
/// only a BYO binary Core launches on demand. The plugin record is the
/// install/enable/tier **governance shell** around that provider; declaring the
/// tools again here would double-list every one as an `app__<slug>` alias
/// (`fire_activation_event` → the Tool handler in `server/mod.rs`). Do not
/// re-add tool runnables to these fixtures.
///
/// EXCEPTION: `spider`, `rtk`, `advisor` and `shadow` CARRY their tool runnables,
/// because their Rust providers were deleted — the fixture is the only owner, so
/// there is nothing to double-list. The "no runnables" rule above exists solely to
/// avoid double-listing a provider-owned tool; it does not apply once the provider
/// is gone. `spider`/`rtk` are declarative `command`-backend tools; `advisor`
/// (`advisor__consult`) and `shadow` (`shadow__search`/`semantic_search`/`timeline`/
/// `recent_context`) are declarative `http`-backend tools reaching Core loopback
/// bridges (`/api/advisor/consult` and the `/api/shadow/*` proxy). `spider`/`rtk`
/// are reached through the
/// command-tool allowlist.
/// - `headroom.manifest.json` — Headroom gateway egress compression (a `compression` Policy runnable, #425).
/// - `firewall.manifest.json` — Gateway firewall on/off Policy plugin (#447, Core-tier, opt-in).
/// - `routing.manifest.json` — Smart (classifier) routing on/off Policy plugin (#447, Core-tier, opt-in).
/// - `sandbox.manifest.json` — Wasmtime ephemeral sandbox on/off Policy plugin (#448, Core-tier, opt-in).
/// - `engines.manifest.json` — Local engine bindings (llama.cpp + embeddings) as a default-on Core plugin (#448).
/// - `durable.manifest.json` — Durable workflow execution engine as a default-on Core plugin (#448 dogfood).
/// - `predict.manifest.json` — System-wide predictive typing on/off (a `predict` Policy runnable; Core-tier, opt-in). The plugin is the single switch for the `/api/predict/*` brain.
/// - `firecrawl.manifest.json` — Firecrawl search+scrape tool plugin (BYOK, v2 API).
///   A third provider of `web.search` and `web.extract`, claiming `default` on
///   neither (`exa` owns the former, `spider` the latter). It deliberately does NOT
///   provide `web.crawl`, even though Firecrawl has a crawl endpoint: `POST
///   /v2/crawl` is ASYNCHRONOUS — it answers `{success, id, url}` and the pages only
///   arrive from a second `GET /v2/crawl/{id}` poll. A declarative `http` tool is one
///   request with no polling loop, so binding `web__crawl` to it would hand the model
///   a job id where the verb promises page content. Declaring the capability with a
///   partial `tools` map would be worse still: the entry would join resolution for
///   `web.crawl` and could win the pick away from `spider`, silently killing a layer
///   that currently works. Hence the entry is absent rather than empty.
/// - `mem0.manifest.json` — Mem0 hosted memory tool plugin (BYOK, Platform REST API).
///   The SECOND provider of the `memory` capability, and the one that makes that layer
///   swappable at all — until it shipped, `@ryu/memory` was the only provider, so
///   `memory_provider.rs`'s four kernel bridges (each guarded by `if !is_external()`)
///   were unreachable by construction. It is `selectable` and claims NO `default`:
///   `@ryu/memory` keeps that, so the built-in stays the zero-config pick.
///   It binds `memory__search`, `memory__forget`, `memory__store` and `memory__sync`.
///   The two WRITE verbs became bindable only with `CapabilityToolBinding.arg_template`:
///   Mem0's write endpoint is `POST /v3/memories/add/`, whose `messages` field is an
///   array of `{role, content}` OBJECTS, and the flat rename table's one shape
///   transform — the `[]` suffix — produces an array of the SCALAR it was given,
///   i.e. `["fact"]`, which is not the documented item type. The template builds the
///   documented shape directly, so `memory_provider`'s `mirror` and `sync` bridges are
///   now reachable. Both verbs post to the SAME endpoint and differ in one documented
///   field: `memory__store` sends `infer: false` (the caller already decided the fact,
///   so Mem0 stores the text as-is) while `memory__sync` leaves Mem0's default
///   inference on and lets it mine the raw turn. That endpoint is ASYNCHRONOUS —
///   it answers `{message, status: "PENDING", event_id}` — so neither verb returns a
///   fact id and `event_id` must never be fed to `memory__forget`; both bridges are
///   fire-and-forget and never read the response, which is why this is acceptable.
///   `memory__context` stays UNBOUND because Mem0 publishes no standing-summary
///   endpoint (see the memory section of https://docs.mem0.ai/llms.txt), so while Mem0
///   is selected the facade serves four of the five memory verbs.
///   The entity id is pinned from ONE `mem0.user-id` preference through `arg_defaults`
///   but sits in two different places, because Mem0's own API does: INSIDE `filters`
///   for search (a top-level `user_id` is rejected with 400) and TOP-LEVEL for add.
///   Copying the search shape onto add would drop the entity and the write would be
///   rejected — see `plugins-store/mem0/README.md`.
/// - `honcho.manifest.json` — Honcho hosted memory tool plugin (BYOK, `api.honcho.dev`
///   v3 REST API). The FIRST provider of `memory__context`, which is why it exists:
///   `memory_provider::context` and the `memory.provider-context` setting had no
///   provider that declared the verb, so that kernel bridge was unreachable by
///   construction. `selectable`, claiming NO `default` — `@ryu/memory` keeps it.
///   `memory__context` binds Honcho's Dialectic endpoint,
///   `POST /v3/workspaces/{workspace_id}/peers/{peer_id}/chat`, whose documented
///   response is `{content}` — one of the four keys `memory_provider::summary_text`
///   reads. That is why the binding declares NO `response` map: the facade's
///   un-normalized `{provider, raw}` passthrough puts `content` exactly one level in,
///   where `summary_text` finds it, whereas ANY `response` map would rewrite the
///   payload into `{provider, results:[…]}` — a shape that function cannot read, so
///   mapping it "properly" would silently produce no context at all.
///   `memory__search` binds `POST .../peers/{peer_id}/search`, which searches that
///   peer's MESSAGES (conversation text) rather than Honcho's derived conclusions;
///   worth knowing because the `prefetch` bridge is on by default. Honcho's `limit`
///   maxes at 100 against the canonical 50, so it NARROWS nothing and no `arg_clamp`
///   is declared.
///   Both WRITE verbs (`memory__sync`, `memory__store`) are bound through an
///   ADAPTER, and the reason they need one is the cleanest example of why adapters
///   exist. Honcho's only documented write is
///   `POST /v3/workspaces/{workspace_id}/sessions/{session_id}/messages`, whose
///   `messages[]` items each require a `peer_id`. `arg_template` can build an array of
///   objects, but `map_args_with_defaults` expands the template from the CALLER's
///   arguments only — `arg_defaults`, and therefore `pref:` tokens, are merged after
///   and cannot reach inside it — so the per-install peer id had nowhere to go and
///   both verbs went unbound, which is what made `memory.mirror-builtin` (default ON)
///   inert while Honcho was selected. An adapter receives those defaults ALREADY
///   RESOLVED, so the peer lands inside `messages[]` without hardcoding one bucket
///   for every install. Session and peers are caller-named and the adapter upserts
///   them on first write (optimistically: one request in the steady state, two extra
///   only when the write reports the resource missing), so nothing has to be created
///   by hand. Ryu's own replies are written as a SEPARATE peer — attributing an
///   assistant turn to the user's peer would poison the representation Honcho derives
///   about them. `memory__forget` is still unbound: Honcho documents no
///   message-delete endpoint, which no adapter can invent.
///   Workspace and peer are pinned per install from `honcho.workspace-id` /
///   `honcho.peer-id` through `arg_defaults`, filling the two URL path placeholders;
///   unset, the token drops and the call fails loudly with a missing path parameter
///   rather than quietly reading somebody else's bucket. `reasoning_level` is layered:
///   the tool's `body_defaults` pin `minimal` (the kernel abandons a memory provider
///   after `PROVIDER_TIMEOUT`, 4s, and a deeper Dialectic pass routinely costs more),
///   and the optional `honcho.reasoning-level` preference overrides it because
///   `body_defaults` merge UNDER the args — see `plugins-store/honcho/README.md`.
/// - `bytebot.manifest.json` — the SECOND provider of `computer.control`, which until
///   now had only `ghost` and so could not be swapped at all. It binds Bytebot's
///   `bytebotd` daemon (https://github.com/bytebot-ai/bytebot), a documented local
///   HTTP surface: every action is `POST /computer-use` with `{action, …}`, so the
///   six runnables differ only in an `action` constant in `body_defaults` and each
///   verb binding stays a pure rename. `selectable`, claiming NO `default` — ghost
///   keeps it. THE TARGET IS NOT THIS MACHINE: bytebotd drives the desktop it runs
///   on, a containerized Linux desktop in the shipped product, the same
///   local-vs-remote relationship `browser.control` has between the Chromium sidecar
///   and a hosted browser. The daemon has NO authentication, hence no BYOK secret
///   field and a loopback-only URL (grant `tool:http-egress:127.0.0.1`, already in
///   the Gateway allowlist); its port is fixed at Bytebot's documented 9990.
///   That port is fixed by CHOICE, not by the grammar. A `pref:` token cannot be
///   written into a `url` string, but a resolved `arg_defaults` value lands in the
///   args map and the args map is exactly what fills `{placeholder}` path segments
///   — which is how honcho pins its workspace and peer ids into a URL today (see
///   the honcho note above). The blocker is behavioural: an unresolved `pref:`
///   DROPS its argument, and a missing path parameter is a hard error, so a
///   `{port}` placeholder would turn a fresh install from "works at 9990" into
///   "fails until you open settings" (a settings field's `default` is UI-only and
///   is never seeded into the preferences store).
///   FIVE of the six verbs are served, and the three exclusions are each a rule, not
///   an omission:
///   * `computer__focus_app` is UNBOUND. Bytebot's `application` action validates a
///     closed seven-value enum (firefox/1password/thunderbird/vscode/terminal/
///     desktop/directory) while the canonical verb takes a free-form app name, so
///     `focus_app("Safari")` would be a schema-legal call that 400s. The action is
///     still reachable natively as `bytebot__application`, whose own `input_schema`
///     carries that enum so an illegal call cannot be composed.
///   * `computer__scroll` DROPS the canonical `x`/`y` instead of templating them.
///     `arg_template` builds an object shape unconditionally, and Bytebot's
///     `coordinates` is `@IsOptional @ValidateNested` over a `{x, y}` both
///     `@IsNumber` — so a scroll with no coordinates (legal: they are optional in the
///     canonical schema) would send `coordinates: {}` and be rejected. Dropping them
///     scrolls at the pointer's current position, exactly the fallback the canonical
///     schema's own `x` description warns about.
///   * `amount` is CLAMPED to 1..=10 onto `scrollCount`. Bytebot counts WHEEL TICKS
///     and sleeps 150ms between them, so an `amount` a model intends as pixels (500)
///     would wedge the desktop for over a minute. `count` gets no clamp: the
///     canonical max is 3 and Bytebot has no upper bound, so it would narrow nothing.
///   `computer__key` binds `type_keys` (nut.js `pressKey`-all then `releaseKey`-all =
///   one chord), NOT the similarly-named `press_keys`, which is a half-action taking
///   a required `press: up|down` and would leave modifiers physically held down.
///   Only `bytebot__screenshot` sets `unwrap_body` (its `{image}` base64 payload is
///   the result); the five action tools return an EMPTY body on success, which
///   unwrapped reaches the caller as a bare empty string that reads like a failure —
///   the same trap `mem0`'s 204 DELETE documents. Nothing is `fail_open`: for a tool
///   that MOVES A POINTER, converting a dead daemon into `{available:false}` would
///   report "nothing happened" in the one place a caller must be told it failed.
const BUILTIN_MANIFESTS: &[&str] = &[
    include_str!("../../../../plugins-store/spider/manifest.json"),
    include_str!("../../../../plugins-store/scrapling/manifest.json"),
    include_str!("../../../../plugins-store/agentbrowser/manifest.json"),
    include_str!("../../../../plugins-store/exa/manifest.json"),
    include_str!("../../../../plugins-store/tavily/manifest.json"),
    include_str!("../../../../plugins-store/brave/manifest.json"),
    include_str!("../../../../plugins-store/serper/manifest.json"),
    include_str!("../../../../plugins-store/parallel/manifest.json"),
    include_str!("fixtures/layers.manifest.json"),
    include_str!("../../../../plugins-store/ghost/manifest.json"),
    include_str!("../../../../plugins-store/shadow/manifest.json"),
    include_str!("../../../../plugins-store/headroom/manifest.json"),
    // The other cost-reduction plugin, and the other shape: `headroom` compresses
    // gateway-routed messages through a Core-hosted transform, while `pxpipe` is a
    // loopback proxy the user points a provider at, imaging the static half of a
    // request so it bills as vision tokens. Core-tier (its managed sidecar would be
    // refused at Community — see the plugin's README), never default-on: it needs
    // Node on PATH and a hand-configured provider before it does anything.
    include_str!("../../../../plugins-store/pxpipe/manifest.json"),
    include_str!("../../../../plugins-store/firewall/manifest.json"),
    include_str!("fixtures/routing.manifest.json"),
    include_str!("fixtures/sandbox.manifest.json"),
    include_str!("fixtures/engines.manifest.json"),
    include_str!("fixtures/durable.manifest.json"),
    // System-wide predictive typing on/off (Policy-gated, Core-local). Opt-in like
    // firewall/routing/sandbox: enabling the plugin is the single switch for the
    // /api/predict/* brain — there is no separate config toggle.
    include_str!("../../../../apps-store/predict/manifest.json"),
    // System-wide dictation + agent-ask (Policy-gated, Core-local). Default-on:
    // Island hosts the OS surface; enabling the plugin is the single switch.
    // Formerly hardcoded into Island — extracted as an apps-store app so settings
    // register via contributes.settings_tabs like predict.
    include_str!("../../../../apps-store/dictation/manifest.json"),
    // The Island companion overlay itself — a desktop-owned Electron sidecar the
    // shell installs and launches (never a Core sidecar), so its record is a pure
    // settings governance shell: opt-in and NOT pre-seeded (`CORE_PLUGINS` only),
    // and its Island settings tab registers via contributes.settings_tabs the same
    // way every other app does, appearing only once the record is installed.
    include_str!("../../../../apps/island/manifest.json"),
    // Turn-hook plugins (the migrated, formerly-hardcoded features). These ship
    // as built-in fixtures but are built exactly like a third-party plugin would
    // be: a manifest + an inline JS hook reaching Core only through the
    // capability-gated plugin host. `goal`/`proof`/`double-check`/`chat-title`
    // are Core-tier and default-on (see `plugins::builtins::CORE_DEFAULT_ON`) so
    // their features work on every surface with zero setup, gated cheaply by each
    // hook's `match` block (or preference read for chat-title); `advisor` stays
    // Community (install-then-enable).
    include_str!("../../../../plugins-store/double-check/manifest.json"),
    include_str!("../../../../plugins-store/goal/manifest.json"),
    include_str!("../../../../plugins-store/chat-title/manifest.json"),
    include_str!("../../../../plugins-store/advisor/manifest.json"),
    // `proof` is `goal`'s stronger sibling: instead of a one-line transcript
    // judge, each round spawns an INDEPENDENT verifier sub-agent (grant
    // `hook:run-agent`) that gathers real evidence with tools before deciding.
    include_str!("../../../../plugins-store/proof/manifest.json"),
    // `receipts` is `proof`'s VISUAL sibling: the verifier sub-agent judges a
    // captured screenshot or screen recording instead of re-reading the workspace,
    // so a round leaves behind an artifact a human can look at afterwards. The hook
    // has no capture capability of its own (no HTTP, no callTool in the sandbox),
    // so the artifact arrives as an absolute path printed in the turn text.
    include_str!("../../../../plugins-store/receipts/manifest.json"),
    // `recap` is the read-side counterpart to those three: instead of steering the
    // turn, it summarizes the one that just finished (`post_assistant_turn` → a
    // `note`), and owns `/recap` on the `pre_user_turn` phase — returning `handled`,
    // so the command is answered by the side model without a main-model turn. Not in
    // `CORE_DEFAULT_ON`: unlike the `match`-gated hooks above, a recap is a real
    // model call per long turn, so it has to be a thing the user asked for.
    include_str!("../../../../plugins-store/recap/manifest.json"),
    // `no-more-mistakes` is the memory counterpart to those: instead of steering or
    // summarizing a turn, it mines the moment the user CORRECTS one. A `pre_user_turn`
    // hook turns the correction into one durable rule and files it as a document in a
    // Space (`spaces:docs` — this is the first turn hook to use that grant, and the
    // reason `host.spaces.ensureSpace` exists: every other Space method needs a uuid a
    // sandboxed hook has no way to learn). A `session_start` hook reads the ledger back
    // at the top of every later conversation, because a rule that only surfaces when
    // the wording happens to retrieve it is not a rule. Community-tier and opt-in: the
    // capture hook cannot be `match`-gated — the pre-gate grammar has no "this message
    // reads like a complaint" — so it costs a sandbox spawn per user turn, `recap`'s
    // reason exactly.
    include_str!("../../../../plugins-store/no-more-mistakes/manifest.json"),
    // `no-ai-slop` bundles the editing skill of the same name and runs it on the
    // turn that just finished. It is the one turn hook here with NO `match` gate:
    // "every completed answer" is the feature, so it cannot pre-gate on a flag or a
    // command. The composer toggle is a manual override for when the automatic pass
    // count is 0, not the arming switch. Its `continue` loop is bounded three ways —
    // a transcript-derived pass counter (the injected turn's own header is the
    // marker), a clean verdict from the reviewer, and Core's `MAX_CONTINUE_TURNS` —
    // and the hook clamps its pass setting well under that cap so a large value
    // degrades to fewer passes instead of a loop that stops mid-rewrite. Not in
    // `CORE_DEFAULT_ON` for `recap`'s reason, doubled: a sandbox spawn per turn AND
    // a sub-agent per reviewed answer, on the user's budget.
    include_str!("../../../../plugins-store/no-ai-slop/manifest.json"),
    // `agent-comms` is the agent-to-agent mailbox: `agents__directory` /
    // `agents__send` / `agents__ask` / `agents__thread`, shipped as ordinary
    // registry tools so EVERY agent gets them (Pi through its MCP extension, an
    // ACP agent through the in-process `mcp_bridge`, the gateway plane through
    // the tool loop) rather than one runtime's private feature.
    //
    // Reads and writes are deliberately split across the two seams. A tool WRITES
    // (`caller.agent_id`, host-derived, is the sender — a model naming someone
    // else in its arguments cannot forge it), and the `pre_user_turn` hook is the
    // only READER of an inbox, because `ctx.agent_id` is the one place "whose mail
    // is this" is answered by Core. A tool that took a `for_agent` argument would
    // be a spoofable read of another agent's mailbox.
    //
    // Three independent stops keep a chain finite: a hop counter carried on the
    // message and re-read from the conversation (or, inside a delegated run, the
    // agent) that received it; a `busy` marker on BOTH ends of an `ask` so A→B→A
    // is refused rather than deadlocked; and the refusal that an agent cannot
    // address itself. Not in `CORE_DEFAULT_ON` for `no-ai-slop`'s reason: the
    // delivery hook has no `match` gate (the inbox is keyed by agent, and
    // `stateful` matches on the conversation), so it costs a sandbox spawn per
    // turn, and `agents__ask` spends a whole agent run per call.
    include_str!("../../../../plugins-store/agent-comms/manifest.json"),
    // `plan-continue` keeps a plan moving while the composer's plan-mode pill is
    // on, by injecting its own follow-up turn when one finishes. Community and
    // NOT in `CORE_DEFAULT_ON` for the reason the others are on: this one spends
    // the user's tokens unattended, so it has to be a thing they asked for. Its
    // hook still pre-gates on `match.flag`, and the flag is the completeness
    // signal too — an approved `ExitPlanMode` writes it back off.
    include_str!("../../../../plugins-store/plan-continue/manifest.json"),
    // The two Pi capabilities Core used to hardcode into every managed-Pi spawn,
    // now plugins the user can turn off: `pi-shell` (background bash) and
    // `pi-subagent` (the `Task` tool). Each ships ONE `contributes.pi_extensions`
    // row pointing at the TypeScript in its own package; `pi_config::app_extensions`
    // materializes it into `~/.ryu/pi-agent/extensions/` for the next Pi process.
    //
    // Core-tier is a REQUIREMENT here, not a promotion, and for the same reason
    // `scrapling`'s note above gives: `may_ship_pi_extensions` auto-allows a
    // manifest's `pi_extensions` only for compiled-in manifests, while a
    // Community-tier plugin needs the approved `pi:extension` grant — off the
    // Gateway's default allowlist and in a reserved namespace, so operator-only. A
    // Community-tier version of either would materialize nothing and be dead on
    // arrival. Both are also in `CORE_DEFAULT_ON`, because they were unconditional
    // before this move and default-off would silently strip background bash and
    // sub-agents from the flagship agent on every fresh install.
    include_str!("../../../../plugins-store/pi-shell/manifest.json"),
    include_str!("../../../../plugins-store/pi-subagent/manifest.json"),
    // `rtk` surfaces the built-in RTK (Rust Token Killer) command-wrapping tool
    // (`rtk__run`) as an installable plugin. Like `spider`, it is a fully
    // declarative `command`-backend tool: the fixture CARRIES its runnable (the
    // native `sidecar/mcp/rtk.rs` provider was deleted, so there is nothing to
    // double-list — same EXCEPTION as spider). The `rtk` binary is BYO, reached
    // through the command-tool allowlist. The fixture also contributes the Phase-2
    // auto-wrap settings that drive `crate::rtk_config` (NOT a tool). Community-tier,
    // opt-in.
    include_str!("../../../../plugins-store/rtk/manifest.json"),
    // `security-guidance` ports Anthropic's security-guidance Claude Code plugin
    // onto Ryu's turn-hook substrate: a flag-gated `post_assistant_turn` hook that
    // (1) runs a ~22-rule regex pattern scan over the last answer and (2) does a
    // second-model diff review via `host.sideModel` (grant `hook:side-model`),
    // surfacing findings as an out-of-band note. Toggle + `/security` command +
    // reviewer-model picker mirror `double-check`. Community-tier, opt-in.
    include_str!("../../../../plugins-store/security-guidance/manifest.json"),
    // `auto-expand` is the first `pre_user_turn` hook: before a message is sent it
    // calls a configurable model (`hook:side-model`) to rewrite the prompt into a
    // clearer form and returns a `replace` directive, so the improved prompt is
    // what gets sent and persisted. Composer toggle (auto-expand every message) +
    // `/expand` command (one-off). Core-tier, default-on; the flag/command `match`
    // keeps it free when idle.
    include_str!("fixtures/auto-expand.manifest.json"),
    // `session-context` is a reference `session_start` hook: on the first turn of a
    // conversation it injects the current date/time (a common blind spot for local
    // models) via a `replace`/`inject` directive. Community-tier, opt-in; the
    // reference a third party forks for richer setup-context injection. The other
    // new phases (pre/post_tool_use, subagent_stop, session_end, notification) fire
    // from off-chat-path sites through the process-global dispatcher; their
    // reference fixtures (`tool-firewall`, `hook-observers`) are deliberately NOT
    // registered here so those hot paths (esp. per tool call) stay lookup-free
    // until a user installs a plugin that actually uses them.
    include_str!("../../../../plugins-store/hook-session-context/manifest.json"),
    // RAG capability: the default in-process embeddings+retrieval provider. Declares
    // `provides: [rag]` + `requires: [engines]` so the capability graph resolves
    // rag→engines for real (disable-safety: engines can't be disabled out from under
    // an enabled rag). A GraphRAG/third-party provider app can bind `rag` to swap it.
    include_str!("fixtures/rag.manifest.json"),
    // Mail (Agent Inboxes): a built-in app whose out-of-process `ryu-mail` sidecar
    // Core spawns (local sibling binary) and proxies `/api/mail/*` to via the
    // generic ext-proxy `public_mount` mechanism — the acceptance test proving the
    // generic loader replaces the retired hand-coded `sidecar/mail.rs`. Default-on,
    // so the externally-committed inbound-webhook URL resolves out of the box.
    include_str!("../../../../apps-store/mail/manifest.json"),
    // Browser (W9): a real-Chromium Electron browser Core runs as a `local` sidecar
    // and exposes as the grant-gated `browser.control` capability (list/open/navigate
    // tabs, screenshot, read titles, privileged JS eval). CORE built-in — listed in
    // `SYSTEM_PLUGINS` + `CORE_DEFAULT_ON`, so it is seeded enabled on a fresh install
    // and uninstall-protected (the workspace "Browser" tab uses this sidecar instead of
    // the fallback iframe). `lazy` + idle-stop keep the Electron GUI cold until the
    // desktop Browser panel first calls it through the ext-proxy — it does not spawn on
    // boot, only on first use.
    include_str!("../../../../apps-store/browser/manifest.json"),
    // Simulators: iOS Simulator (`simctl`, macOS + Xcode) + Android Emulator (`adb`)
    // control Core runs as a dependency-free `local` sidecar, exposing the grant-gated
    // `simulator.control` capability. OPT-IN like the browser — NOT in `CORE_DEFAULT_ON`,
    // so the toolchain-wrapping sidecar never spawns unless a user enables it. `lazy` +
    // idle-stop keep it cold until the desktop Simulator panel calls it through the
    // ext-proxy. Availability is a RUNTIME probe (`/capabilities`): iOS shows only on a
    // Mac with Xcode; Android wherever the SDK is present.
    include_str!("../../../../apps-store/simulator/manifest.json"),
    // UGC: a creator-marketing campaign tracker (campaign briefs + budgets, a creator
    // roster, post submissions with approve/reject review, per-post metric snapshots
    // refreshed through a curated Composio action map, and CPM/flat payouts accrued,
    // approved and marked paid). Fully manifest-driven like Mail: the whole surface is
    // out-of-process in the `ryu-ugc` sidecar (a `local` sibling binary) and Core reaches
    // `/api/ugc/*` through the generic ext-proxy `public_mount` — there is no hand-coded
    // Rust proxy and no Core-side UGC code. OPT-IN like the browser/simulator — NOT in
    // `CORE_DEFAULT_ON`, so the sidecar binary a normal install does not carry is never
    // spawned unless a user enables the app. Its client surface is a desktop DOCK PANEL
    // (`contributes.dock_panels`, `panel: "native"`), not a companion, so it ships no UI
    // bundle and needs no `plugins::seed` row.
    include_str!("../../../../apps-store/ugc/manifest.json"),
    // Outpost — social scheduling + publishing. Manifest-driven exactly like Mail and
    // UGC: the whole surface (workspaces, accounts, drafts, the durable retrying publish
    // queue, the reply inbox, engagement history, templates) lives out-of-process in the
    // `ryu-social` sidecar (a `local` sibling binary on 8005 — 8004 was already claimed
    // by `@ryu/ugc`), and Core reaches `/api/social/*` through the generic ext-proxy
    // `public_mount`. There is no hand-coded Rust proxy and no Core-side social code; the
    // crate does not even path-depend on `apps/core`. Unlike UGC its client surface IS a
    // full-page Companion (`ui_format:"html"`, Path B) driving the sidecar through the
    // `social:crud` bridge forwarder, so it ships a UI bundle and DOES need a
    // `plugins::seed` row. OPT-IN: not in `CORE_DEFAULT_ON`, so a normal install never
    // spawns the sidecar unless a user enables the app.
    include_str!("../../../../apps-store/social/manifest.json"),
    // Harbor — an object-first CRM over the `ryu-crm` sidecar (a `local` sibling binary
    // on 8009; 8007 was contested by three concurrently built apps and 8008 taken by
    // `@ryu/news`). Same zero-coupling posture as Outpost above — Core links no CRM code
    // and the crate does not path-depend on `apps/core` — but its client surface is a
    // NATIVE DOCK PANEL, not a Companion. That is the whole difference and it removes
    // work rather than adding it: a dock panel fetches `/api/ext/@ryu/crm/*` over the
    // generic ext-proxy directly, so there is no `ui_code` bundle, no `plugins::seed`
    // row, and none of the per-app bridge rows in `rpc.ts`/`host_api.rs` that a
    // CSP-sandboxed companion would have forced. OPT-IN: not in `CORE_DEFAULT_ON`.
    include_str!("../../../../apps-store/crm/manifest.json"),
    // Deep Read — Recursive Language Models over the `ryu-rlm` sidecar (a `local`
    // sibling binary on 8014). Same zero-coupling posture as Outpost: Core links no
    // RLM code, the crate does not path-depend on `apps/core`, and the one line back
    // is the generic `/api/host/model/complete` callback gated on `hook:side-model`.
    // Its client surface IS a full-page Companion (`ui_format:"html"`, Path B) driving
    // the sidecar through the `rlm:query` bridge forwarder, so it ships a UI bundle
    // and DOES need a `plugins::seed` row. It also contributes a `post_assistant_turn`
    // hook, so it has a `builtin_code` row. OPT-IN: not in `CORE_DEFAULT_ON`, so a
    // normal install never spawns the sidecar unless a user enables the app.
    include_str!("../../../../apps-store/rlm/manifest.json"),
    // The Whiteboard app — a full-page Companion (`ui_format:"html"`, Path B) that
    // OWNS its Space documents via `spaces:docs`. Ships default-on with a UI bundle
    // + host-bridge grants seeded in `main.rs` (the generic CORE_DEFAULT_ON loop
    // seeds neither, so it has a dedicated seed block). Replaces the built-in
    // whiteboard editor.
    include_str!("../../../../apps-store/whiteboard/manifest.json"),
    // The Canvas app — a full-page Companion (`ui_format:"html"`, Path B) that owns
    // its Space documents via `spaces:docs` and runs generation nodes through the
    // window.ryu media/agent bridge (`media:generate` / `media:transcribe` /
    // `hook:run-agent` / `hook:side-model`) + reads catalogs via `core:list_agents`.
    // Ships default-on with a UI bundle + those grants seeded in `main.rs`. Replaces
    // the built-in creative-canvas board.
    include_str!("../../../../apps-store/canvas/manifest.json"),
    // The Fine-tuning app — a full-page Companion (`ui_format:"html"`, Path B) that
    // drives Core's fine-tune orchestration + durable job store via the
    // `finetune:runs` bridge and OWNS its Unsloth training sidecar (a
    // manifest-declared Python process spawned on the Core-tier auto-run path, so it
    // declares no `sidecar:process` grant — the Gateway denies that grant at enable).
    // Ships default-on with a UI bundle + those grants seeded in `main.rs`. Replaces
    // the built-in fine-tuning page.
    include_str!("../../../../apps-store/finetune/manifest.json"),
    // Spaces + Meetings — the first REAL plugin→plugin dependency edge.
    //
    // Both have zero runnables (like ghost/shadow), so the record governs them —
    // install/enable/disable. They differ in where the impl lives: `spaces` stays
    // IN-PROCESS (`server/spaces.rs`, no `public_mount`); `meetings` was moved
    // OUT-OF-PROCESS (2026-07-18) and now serves `/api/meetings/*` via a `public_mount`
    // sidecar (`apps-store/meetings/backend`, reached over loopback via
    // `meetings_client.rs`) — the old in-crate `server/meetings_api.rs` is gone.
    // Declaring a runnable here would register a PHANTOM tool with no implementation.
    //
    // Order matters only for readability: `plugins::seed` resolves the topological
    // order from `requires`, so the dependency is seeded before its dependent no
    // matter how these are listed.
    include_str!("fixtures/spaces.manifest.json"),
    // Meetings `requires` Spaces because it genuinely writes its notes into the
    // "Meetings" Space (the sidecar's note-save path lands in `state.spaces` via the
    // Core-side `MeetingIngest`/spaces seam). Disabling Spaces under it would leave that
    // write path pointing at a disabled capability, which is exactly what
    // `plugins::graph` now refuses.
    include_str!("../../../../apps-store/meetings/manifest.json"),
    // Five clean LEAF features turned into out-of-process sidecar Apps (2026-07-18).
    // Each serves its own `/api/<feature>/*` surface OUT-OF-PROCESS via a `public_mount`
    // sidecar bin + the generic ext-proxy loader; no in-process routes remain. The
    // plugin record governs install/enable/disable (toggle via the plugin lifecycle).
    // All five are default-on (see `plugins::builtins`) so the surface is reachable on a
    // fresh install — the routes were always-on before, so only a default-on seed keeps
    // them reachable (identical to the Meetings/Spaces edge).
    //
    // `research`/`dashboards`/`teams` declare NO `requires`. `clips` requires the
    // `shadow` capture app (it is a Core→Shadow proxy) and `recipes` requires the
    // `ghost` automation app (Ghost owns the RecipeStore) — both real, satisfiable
    // edges (shadow/ghost are default-on), so the graph refuses to disable the
    // dependency out from under them.
    include_str!("../../../../apps-store/research/manifest.json"),
    include_str!("../../../../apps-store/dashboards/manifest.json"),
    include_str!("../../../../apps-store/teams/manifest.json"),
    include_str!("../../../../apps-store/clips/manifest.json"),
    include_str!("../../../../apps-store/recipes/manifest.json"),
    // Wave-2: five more leaf features turned into Apps (toggle via the plugin lifecycle).
    // Of these `quests` + `healing` now serve `/api/<feature>/*` OUT-OF-PROCESS via a
    // `public_mount` sidecar + the generic ext-proxy loader; `approvals`/`skills`/`learning`
    // remain IN-PROCESS governance shells that gate their own route surface via
    // `require_app_enabled` (`learning` is the Outcome-B in-process exception). All
    // default-on so the surface is reachable on a fresh install (the routes were always-on
    // before).
    //
    // `quests`/`approvals`/`skills` declare NO `requires`. `learning` requires the
    // `skills` app (it writes synthesized skills) and `healing` requires the
    // `approvals` app (it delivers proposed fixes into that inbox) — both real,
    // satisfiable edges (skills/approvals are default-on), so the graph refuses to
    // disable the dependency out from under them.
    //
    // These manifests are registered UNCONDITIONALLY (no cfg). Only `healing`'s HTTP
    // surface compiles out behind the `healing` cargo feature; its manifest + id must
    // always be present so the default-on seed never references a missing manifest —
    // exactly like `research`/clips/recipes (feature-gated module, always-on fixture).
    include_str!("../../../../apps-store/quests/manifest.json"),
    include_str!("../../../../apps-store/approvals/manifest.json"),
    include_str!("fixtures/skills.manifest.json"),
    include_str!("../../../../apps-store/learning/manifest.json"),
    include_str!("../../../../apps-store/healing/manifest.json"),
    // Wave-3: two more leaf features turned into Apps (toggle via the plugin lifecycle).
    // `monitors` now serves `/api/monitors/*` OUT-OF-PROCESS via a `public_mount` sidecar
    // + the generic ext-proxy loader; `hardware` stays IN-PROCESS and gates its route
    // surface via `require_app_enabled`. Both default-on so the surface is reachable on a
    // fresh install (the routes were always-on before).
    //
    // Both declare NO `requires`. `monitors` owns ONLY its `/api/monitors/*` surface
    // (the interleaved `/api/activity/*`, `/api/events/*`, and
    // `/api/notifications/*` streams are separate concerns and stay Core-side, ungated).
    // `hardware` gates ONLY the PROTECTED `/api/hardware/devices*` device-registry
    // CRUD; the PUBLIC device channel (`/api/hardware/{ws,pair,display}`) stays ungated
    // because physical ESP32 devices connect there and gating it would break pairing.
    include_str!("../../../../apps-store/monitors/manifest.json"),
    include_str!("fixtures/hardware.manifest.json"),
    // Wave-4: two more leaf features turned into governance-shell Apps (toggle via
    // the plugin lifecycle + route gate; impl stays in-crate). Both default-on so the
    // gate is transparent on a fresh install (the routes were always-on before).
    //
    // Both declare NO `requires`. `workflows` gates ONLY the PROTECTED workflow
    // surface (`/workflows/*` DAG CRUD + `/api/workflows/catalog/*` templates); the
    // PUBLIC per-workflow webhook (`/api/workflows/:id/webhook`) stays on the public
    // router, ungated, so external systems can POST triggers regardless of the app's
    // enabled bit. Neither is behind a cargo feature — the workflow executor is used
    // by the scheduler/durable/healing/approvals and must always compile.
    //
    // `agents` gates ONLY the `/api/agents/*` catalog/CRUD surface and is additionally
    // LOAD-BEARING (see `plugins::builtins::LOAD_BEARING_PLUGINS`): the composer fetches
    // the agent list on boot, so a disabled Agents app would break chat. The ACP
    // routing/execution substrate that serves a chat turn is kernel and stays untouched.
    include_str!("../../../../apps-store/workflows/manifest.json"),
    include_str!("fixtures/agents.manifest.json"),
    // W0 honest-gating baseline: three data-path governance shells whose
    // `/api/{voice,images+video+gifs,memory}/*` routes were mounted RAW before this
    // wave. Each gates its own protected route surface via `require_app_enabled`; the
    // impl stays in-crate (no cargo feature). All three default-on (see
    // `plugins::builtins`) so the gate is transparent on a fresh install.
    //
    // `voice` gates ONLY the protected voice data path; the PUBLIC realtime voice WS
    // (`/api/voice/ws`) stays on the public router (browser WS, auth-in-handler).
    // `media` gates ONLY the generative producers; the shared no-cloud blob store
    // (`/api/media/:file` + `/api/media/upload`) stays ungated kernel storage (it also
    // serves TTS audio + chat uploads). `memory` gates ONLY the HTTP CRUD surface; the
    // in-process chat auto-recall path is kernel. None declares `requires`.
    include_str!("../../../../apps-store/voice/manifest.json"),
    include_str!("fixtures/media.manifest.json"),
    include_str!("fixtures/memory.manifest.json"),
    // W7 frontend extraction: the webhooks page moved to a sandboxed companion app
    // (`apps-store/webhooks/ui`). Default-on, no `requires` — its `/api/webhooks` +
    // `/api/webhook-ingress/status` reads stay ungated on the main router (the host
    // calls them directly, monitors pattern), so this manifest exists only to seed
    // the companion's UI bundle + `webhooks:crud` grant, not to gate a route surface.
    include_str!("../../../../apps-store/webhooks/manifest.json"),
    // W7 frontend extraction: the activity-feed page moved to a sandboxed companion
    // app (`apps-store/activity/ui`). Default-on, no `requires` — its read-only
    // `/api/activity` stays ungated on the main router (the host calls it directly,
    // monitors pattern), so this manifest exists only to seed the companion's UI
    // bundle + `activity:read` grant, not to gate a route surface.
    include_str!("../../../../apps-store/activity/manifest.json"),
    // W7 frontend extraction: the timeline page moved to a sandboxed companion app
    // (`apps-store/timeline/ui`). Default-on, no `requires` — Shadow's device-local
    // `/timeline` + `/journal` + `/frame` live on the Shadow sidecar (:3030), not the
    // Core router, and the desktop host calls them directly (monitors pattern), so this
    // manifest exists only to seed the companion's UI bundle + `timeline:read` grant,
    // not to gate a route surface.
    include_str!("../../../../apps-store/timeline/manifest.json"),
    // The Calendar app — a sandboxed companion (`ui_format:"html"`). It was already
    // in the default-on seed set (`plugins::seed` maps CALENDAR_UI_HTML) and routed
    // in the desktop (`/calendar`), but its MANIFEST was never registered here, so
    // the record seeded with no manifest and calendar could not appear in
    // `/api/plugins`, plugin contributions, or the marketplace Apps catalog. Register
    // it so it loads like every other companion.
    include_str!("../../../../apps-store/calendar/manifest.json"),
    // The Warmup app — a sandboxed companion (`ui_format:"html"`) that schedules a
    // keep-alive ping to each subscription agent so its rolling usage window is
    // already open when the user starts work. Opt-in (seeded DISABLED): it spends
    // subscription usage on the user's behalf, which is not something to switch on
    // for someone. No `requires` and no route surface of its own — the desktop host
    // drives `/api/agents` + `/heartbeat/jobs` for it (the monitors pattern), so this
    // manifest exists to seed the companion's UI bundle + `warmup:crud` grant.
    include_str!("../../../../apps-store/warmup/manifest.json"),
    // W7 frontend extraction: the SKILL.md authoring editor moved to a sandboxed
    // companion app (`apps-store/skill-editor/ui`). Default-on, no `requires` — the
    // `/api/skills` authoring endpoints stay ungated on the Core router (the desktop host
    // calls them directly, monitors pattern), so this manifest exists only to seed the
    // companion's UI bundle + `skills:crud` grant, not to gate a route surface.
    include_str!("../../../../apps-store/skill-editor/manifest.json"),
    // The Agent Status app — three sidebar sections (Working / Needs input / Done)
    // over runs and pending approvals. Opt-in, and the leanest shape an app can
    // have: PURE MANIFEST. No runnables, no sidecar, no UI bundle and no route
    // surface of its own — every row is a declarative `sidebar_sections[].spec`
    // the desktop shell fetches through its own authenticated seam, so nothing
    // about it exists in Core beyond this registration. It is the reference for
    // "an app that only rearranges what the shell already knows".
    include_str!("../../../../apps-store/agent-status/manifest.json"),
    // The Drafts app — a durable outbox. Owns one `sidebar_sections` entry over its
    // own store and one app-shell page, and its state lives OUT-OF-PROCESS in the
    // `ryu-drafts` sidecar (`public_mount` at `/api/drafts`, App-gated via the ext
    // proxy), which is why — unlike `agent-status` directly above — it is Core-tier:
    // a managed sidecar only spawns for a `CORE_PLUGINS` member. Opt-in (absent from
    // `CORE_DEFAULT_ON`) because a default-on sidecar app spawns a binary a normal
    // install does not have. Nothing about drafts exists in Core beyond this
    // registration: the shell's dispatcher does the sending, because a manifest
    // sidecar is deliberately spawned without `RYU_TOKEN`.
    include_str!("../../../../apps-store/drafts/manifest.json"),
    // `sample-widget` — the REFERENCE third-party MCP widget plugin (a dev
    // template; source lives at `plugins-store/sample-widget/`). It declares a
    // local Node MCP server (`node server.mjs`) whose `render` tool advertises
    // `_meta.openai/outputTemplate = ui://widget/sample.html` and serves that
    // resource, plus a `contributes.widgets` entry binding `sample_widget__render`
    // to it and the `widget:render` grant. Registered so it parses/loads like every
    // built-in and shows up as an installable example, but deliberately OPT-IN — it
    // is NOT in `plugins::builtins::CORE_DEFAULT_ON`, so it never seeds enabled and
    // its `node` server is never spawned unless a developer installs it. The
    // canonical copy under `plugins-store/` and this fixture are byte-identical.
    include_str!("../../../../plugins-store/sample-widget/manifest.json"),
    // The six built-in output styles (ELI5, I have ADHD, Explanatory, Learning,
    // Proactive, Plain text). Zero runnables and zero `permission_grants`: a style
    // body is inert prose appended to (or replacing) the agent's base instructions
    // for a turn, so nothing evaluates it — the same argument `ThemeContribution`
    // makes for themes, and the reason a style is a plugin CONTRIBUTION rather than
    // its own `CatalogKind` (it inherits install/enable, versioning, signing, the
    // Store detail page and the trust scorecard for free). See
    // `docs/output-styles.md` §4.
    //
    // Each entry's `file` is hydrated into an inline `source` at load time from
    // `builtin_code::BUILTIN_OUTPUT_STYLES` — a built-in ships only this manifest,
    // so an un-embedded style file would resolve to nothing.
    //
    // Pre-installed but INERT: the node default is "no style" and none of the six
    // sets `force-for-plugin`, so registering it changes no prompt until a user
    // picks one in the composer or the Store's Output Styles tab.
    include_str!("../../../../plugins-store/output-styles/manifest.json"),
    include_str!("../../../../plugins-store/firecrawl/manifest.json"),
    include_str!("../../../../plugins-store/mem0/manifest.json"),
    // `spidercloud` is the SECOND `web.crawl` provider, which is what finally makes
    // that layer swappable rather than merely marked selectable: the local `spider`
    // CLI stays the declared default, and this one runs the same engine hosted, so a
    // node with no `spider` binary can still serve `web__crawl`. Bound only because
    // Spider Cloud's crawl is SYNCHRONOUS (`run_in_background` defaults to false) —
    // `firecrawl` is deliberately still not a crawl provider because its `/v2/crawl`
    // hands back a job id, and a declarative http tool is one request with no polling
    // loop, so the verb would return a UUID where it promises page content. The
    // canonical `depth` argument is dropped rather than clamped: upstream documents
    // `depth: 0` as "no limit will be applied", the inverse of the canonical "0 = the
    // start page only", and a clamp would hide a semantic inversion instead of
    // declaring the argument unsupported.
    include_str!("../../../../plugins-store/spidercloud/manifest.json"),
    include_str!("../../../../plugins-store/honcho/manifest.json"),
    include_str!("../../../../plugins-store/bytebot/manifest.json"),
    // The four `document.parse` providers. Each is an apps-store satellite
    // (`apps-store/{markitdown,unstructured,docling,mineru}/`) wrapping a different
    // extraction library in its own Python sidecar, registered exactly like
    // `finetune`: Core-tier so each is governed and disable-able, and each with an
    // EMPTY `permission_grants` — a Core-tier built-in that asked for
    // `sidecar:process` would be DENIED at enable and the enable itself would fail
    // (`plugins::lifecycle`). The contract every provider copies — provides block,
    // ports (8093-8096, dev-shifted to 9093-9096), wire format — is
    // `docs/document-parsing.md` §3-§4.
    //
    // **Exactly one carries `"default": true`, and it is `markitdown`** (see its
    // `provides` block). That is not decoration: with several providers ENABLED and
    // no default, `plugins::binding` falls through to the lexicographically-lowest
    // plugin id, which elects `@ryu/docling` — an alphabetical accident, not a
    // product decision. Adding a second `"default": true` does not make that provider
    // win; it re-runs the same tiebreak and lands on docling again. So: never add a
    // second default, and never drop markitdown's.
    //
    // The flag is dormant on a stock install. Only `markitdown` is in
    // `plugins::builtins::CORE_DEFAULT_ON`, so it is the sole ENABLED provider and
    // binding resolves it by "single provider" without ever consulting the flag; the
    // default only decides anything once a user enables a second backend from the
    // Store. The other three are deliberately default-OFF because they are heavy —
    // `unstructured[all-docs]` is a 1-2 GB pip install whose native helpers
    // (poppler/tesseract/libreoffice/pandoc) pip cannot supply, and `docling`/`mineru`
    // download ML models on first parse. markitdown is the one small pure-Python
    // install with no native toolchain, which is why it is the shipped default.
    //
    // The consumer is `crate::document_parse` — the single extraction facade behind
    // `/api/documents/parse`. It names no plugin id: the provider is resolved through
    // `plugins::binding` exactly like `web.search`, so a fifth backend stays pure
    // manifest data. Do not add a second call site; route new surfaces through the
    // facade.
    include_str!("../../../../apps-store/unstructured/manifest.json"),
    include_str!("../../../../apps-store/markitdown/manifest.json"),
    include_str!("../../../../apps-store/docling/manifest.json"),
    include_str!("../../../../apps-store/mineru/manifest.json"),
    // Automated Reasoning — the app that decides whether an answer FOLLOWS from a
    // written policy, using a decision procedure rather than a second model's
    // opinion (`apps-store/reasoning/backend`: exact rational arithmetic, a
    // finite-domain search over booleans/enums, Fourier–Motzkin over linear
    // arithmetic, branch-and-bound for integers). Opt-in and NOT pre-installed: it
    // is a leaf feature that does nothing until someone writes a policy.
    //
    // Three seams, all generic, none of them Core knowing this app exists beyond
    // this line: the `/api/reasoning/*` surface is a `public_mount` sidecar behind
    // the ext-proxy; the agent/workflow surface is the manifest's own `mcp_servers`
    // entry (`reasoning__solve` is the id a workflow `mcp` node takes), auto-allowed
    // because a compiled-in built-in is Core-tier; and the per-turn guardrail is an
    // ordinary `contributes.turn_hooks` entry whose body is embedded in
    // `builtin_code::BUILTIN_CODE_FILES` — the first apps-store row in that table,
    // which the bijection test already covered because it walks BOTH store roots.
    //
    // `hook:side-model` appears in BOTH the sidecar's `host_api.grants` and the
    // top-level `permission_grants`: the host callback authorizes on declared ∩
    // Gateway-approved, so a manifest carrying only one of the two 403s at runtime
    // with nothing at parse time to say why.
    include_str!("../../../../apps-store/reasoning/manifest.json"),
    // Mission Control: the project-level view over many chats — recent sessions and
    // what each accomplished, per-day activity, the files several chats keep returning
    // to, and the to-dos left outstanding in threads nobody reopened. Fully
    // manifest-driven like UGC: the whole surface is out-of-process in the
    // `ryu-mission-control` sidecar (a `local` sibling binary) and Core reaches
    // `/api/mission-control/*` through the generic ext-proxy `public_mount`. OPT-IN —
    // NOT in `CORE_DEFAULT_ON`, so the sidecar binary a normal install does not carry
    // is never spawned unless a user enables the app.
    //
    // The app stores digests it does not compute, and that inversion is forced rather
    // than chosen: a manifest sidecar's callbacks into Core are `model/complete`, `rpc`
    // and `capability/:cap` (`sidecar/ext_proxy.rs`), none of which reads a
    // conversation, and `messages.parts` is sealed at rest. The desktop derives each
    // digest from the parts it already holds and PUTs it — the same function that
    // renders the shell's in-chat `mission` dock panel, so the two surfaces cannot
    // disagree about a chat.
    //
    // `hook:side-model` appears in BOTH the sidecar's `host_api.grants` and the
    // top-level `permission_grants`, for the reason spelled out on Reasoning above. It
    // buys only the optional narrative summary: every number the dashboard shows is an
    // indexed fact, so a node with no model still gets a working page.
    include_str!("../../../../apps-store/mission-control/manifest.json"),
    // Blueprint — visual plan review. An agent publishes its plan over the app's own
    // MCP server (`blueprint__plan_publish`), a human reads it as rendered markdown
    // blocks plus a dependency graph derived from `steps[].depends_on`, annotates it,
    // and approves or requests changes; the agent reads the verdict back as
    // deterministic text (`blueprint__plan_status`). Opt-in — outside `CORE_DEFAULT_ON`,
    // like Reasoning, because it owns an out-of-process binary a normal install does
    // not have, and because it is inert until an agent publishes something.
    //
    // The seams are the same generic three, and again none of them is Core knowing
    // this app exists beyond this line: `/api/blueprint/*` is a `public_mount` sidecar
    // behind the ext-proxy, the agent/workflow surface is the manifest's own
    // `mcp_servers` entry, and there are deliberately NO `turn_hooks` — the plugin
    // sandbox has no HTTP, so a hook could not reach the sidecar that owns the plans.
    // What drives the agent instead is `contributes.output_styles`
    // (`output-styles/visual-planning.md`, embedded in
    // `builtin_code::BUILTIN_OUTPUT_STYLES`): without a style telling the agent to
    // publish before it edits, nothing ever calls the tool and the app is inert.
    include_str!("../../../../apps-store/blueprint/manifest.json"),
    // Tuition — a tutor for one learner. Turns the learner's own syllabus and notes
    // into a prerequisite graph of skills, each carrying a Bayesian Knowledge Tracing
    // posterior, and drills the weakest thing they are ready for. The interesting
    // property, and the reason it earns a row here: four of the five item kinds are
    // graded by ARITHMETIC with no model in the loop at all (`apps-store/tuition/
    // backend/src/grade.rs`, with a hand-rolled fixed-point decimal so an item
    // expecting 0.3 does not mark a correct 0.3 wrong), and the one kind a model does
    // mark shows the rubric it was marked against.
    //
    // Every seam is generic: `/api/tuition/*` is a `public_mount` sidecar behind the
    // ext-proxy, the agent/workflow surface is the manifest's own `mcp_servers` entry,
    // and the Study-mode capture is an ordinary `contributes.turn_hooks` entry whose
    // body is embedded in `builtin_code::BUILTIN_CODE_FILES`.
    //
    // `storage:kv` appears in BOTH the sidecar's `host_api.grants` and the top-level
    // `permission_grants`, and it is load-bearing rather than incidental: the turn
    // hook runs in a sandbox with no HTTP and cannot call the sidecar, so the two hand
    // work to each other through Core's own KV. One grant without the other 403s at
    // runtime with nothing at parse time to say why.
    include_str!("../../../../apps-store/tuition/manifest.json"),
    // Wire — a personal newsroom. Pulls feeds in on a schedule, collapses the same
    // story across every outlet covering it, writes a brief from those clusters, and
    // fires watches on a burst it can explain. Ingest, dedupe (URL canonicalization
    // plus a banded 64-bit SimHash), clustering, the hour-of-day burst test, the
    // boolean topic grammar and the ranking are all deterministic and offline; a model
    // writes only the brief prose and a neutral cluster title.
    //
    // Its `news__search` MCP tool is the reason this is more than a reader: it queries
    // the user's OWN vetted corpus with no web request at all, so an agent can ground
    // an answer in the sources they chose rather than in whatever a fresh search
    // returns. Same generic seams as `tuition` above, with the KV handoff running the
    // other way — the sidecar publishes a ranked snapshot the `pre_user_turn` hook
    // reads.
    include_str!("../../../../apps-store/news/manifest.json"),
    // Subtitles — pick a video on this machine, transcribe it, translate the
    // transcript, and write a timed `.srt`/`.vtt` beside the file. Same zero-coupling
    // posture as Outpost: the whole pipeline (container demux, the 16 kHz downmix,
    // the windowed whisper pass, the translation call, cue layout, the job queue)
    // lives out-of-process in the `ryu-subtitles` sidecar on 8013, and Core reaches
    // `/api/subtitles/*` through the generic ext-proxy `public_mount`. Core links no
    // subtitle code and the crate does not path-depend on `apps/core`.
    //
    // Both model hops are LOCAL by default and that is the point of the app: the
    // transcription goes through the extracted `ryu-stt` crate to local whisper.cpp,
    // and the translation goes to the local gateway's on-device model — so a node
    // with no provider configured still subtitles a film, and a file the user has not
    // shared with anyone stays that way.
    //
    // Its client surface IS a full-page Companion (`ui_format:"html"`, Path B)
    // driving the sidecar through the `subtitles:crud` bridge forwarder, so it ships
    // a UI bundle and DOES need a `plugins::seed` row. OPT-IN: not in
    // `CORE_DEFAULT_ON`, so a normal install never spawns the sidecar unless a user
    // enables the app.
    include_str!("../../../../apps-store/subtitles/manifest.json"),
];

/// The Canvas app's plugin id (its Space documents are `kind = app:<this>`). Shared
/// by the default-on seed (`main.rs`), the legacy file-store migration
/// (`server/canvas_migrate.rs`), and the desktop create/route flow.
pub const CANVAS_PLUGIN_ID: &str = "@ryu/canvas";

/// The Canvas app's prebuilt, self-contained UI bundle (a `vite-plugin-singlefile`
/// build of `packages/canvas-app`, all JS/CSS inlined). Seeded as the plugin's
/// `ui_code` on a fresh install. Rebuild with `bun run --cwd packages/canvas-app
/// build` and copy `dist/index.html` to `fixtures/canvas.ui.html` to refresh it.
pub const CANVAS_UI_HTML: &str = include_str!("fixtures/canvas.ui.html");

/// The Whiteboard app's plugin id (its Space documents are `kind = app:<this>`).
/// Shared by the default-on seed (`main.rs`), the legacy-kind migration
/// (`server/spaces.rs`), and the desktop create/route flow.
pub const WHITEBOARD_PLUGIN_ID: &str = "@ryu/whiteboard";

/// The Whiteboard app's prebuilt, self-contained UI bundle (a
/// `vite-plugin-singlefile` build of `packages/whiteboard-app`, all JS/CSS/fonts
/// inlined). Seeded as the plugin's `ui_code` on a fresh install so the default-on
/// companion has a UI without going through `ryu pack` / install-bundle. Rebuild
/// with `bun run --cwd packages/whiteboard-app build` and copy `dist/index.html`
/// to `fixtures/whiteboard.ui.html` to refresh it.
pub const WHITEBOARD_UI_HTML: &str = include_str!("fixtures/whiteboard.ui.html");

/// The Fine-tuning app's plugin id. Shared by the default-on seed (`main.rs`), the
/// manifest-sidecar ensure in `server/finetune.rs`, and the desktop "Fine-tune this
/// model" open path.
pub const FINETUNE_PLUGIN_ID: &str = "@ryu/finetune";

/// The Fine-tuning app's prebuilt, self-contained UI bundle (a
/// `vite-plugin-singlefile` build of `packages/finetune-app`, all JS/CSS inlined).
/// Seeded as the plugin's `ui_code` on a fresh install so the default-on companion
/// has a UI without going through `ryu pack`. Rebuild with `bun run --cwd
/// packages/finetune-app build` and copy `dist/index.html` to
/// `fixtures/finetune.ui.html` to refresh it.
pub const FINETUNE_UI_HTML: &str = include_str!("fixtures/finetune.ui.html");

/// The Monitors app's prebuilt, self-contained UI bundle (a
/// `vite-plugin-singlefile` build of `packages/monitors-app`, all JS/CSS inlined).
/// Seeded as the plugin's `ui_code` on a fresh install so the default-on companion
/// has a UI without going through `ryu pack`. Rebuild with `bun run --cwd
/// packages/monitors-app build` and copy `dist/index.html` to
/// `fixtures/monitors.ui.html` to refresh it.
pub const MONITORS_UI_HTML: &str = include_str!("fixtures/monitors.ui.html");

/// The Automated Reasoning app's plugin id. Shared by the seed table and the
/// not-pre-installed list.
pub const REASONING_PLUGIN_ID: &str = "@ryu/reasoning";

/// The Automated Reasoning app's prebuilt, self-contained UI bundle (a
/// `vite-plugin-singlefile` build of `apps-store/reasoning/ui`, all JS/CSS inlined).
/// A built-in ships only its manifest, so this is the ONLY place its frame exists:
/// `plugins::lifecycle::install_app` sources it at install time via
/// `compiled_in_ui_code`. Rebuild with `bun run --cwd apps-store/reasoning/ui build`
/// and copy `dist/index.html` here to refresh it.
pub const REASONING_UI_HTML: &str = include_str!("fixtures/reasoning.ui.html");

/// The Tuition app's prebuilt, self-contained UI bundle (a `vite-plugin-singlefile`
/// build of `apps-store/tuition/ui`, all JS/CSS inlined). A built-in ships only its
/// manifest, so this is the ONLY place its frame exists: `plugins::lifecycle::
/// install_app` sources it at install time via `compiled_in_ui_code`. Refresh with
/// `scripts/sync-app-fixtures.sh tuition`.
pub const TUITION_UI_HTML: &str = include_str!("fixtures/tuition.ui.html");

/// The Wire app's prebuilt, self-contained UI bundle. Same carriage as
/// [`TUITION_UI_HTML`]; refresh with `scripts/sync-app-fixtures.sh news`.
pub const NEWS_UI_HTML: &str = include_str!("fixtures/news.ui.html");

/// The Blueprint app's prebuilt, self-contained UI bundle (a
/// `vite-plugin-singlefile` build of `apps-store/blueprint/ui`, all JS/CSS inlined —
/// including `@xyflow/react`, which is what makes this bundle bigger than a
/// text-only companion's). Same rule as Reasoning above: a built-in ships only its
/// manifest, so this is the ONLY place its frame exists and
/// `plugins::lifecycle::install_app` sources it at install time via
/// `compiled_in_ui_code`. Refresh it with `scripts/sync-app-fixtures.sh blueprint`
/// rather than by hand — that script runs the vite build and copies
/// `dist/index.html` here, and its `--check` mode is what catches a stale copy.
///
/// The plugin id deliberately lives elsewhere (`plugins::builtins::BLUEPRINT_PLUGIN_ID`)
/// next to the `CORE_PLUGINS` row that actually decides whether the sidecar spawns,
/// which is where a reader looking for "why is this app Core-tier" will be.
pub const BLUEPRINT_UI_HTML: &str = include_str!("fixtures/blueprint.ui.html");

/// The Workflows app's plugin id (its sandboxed companion drives Core's DAG
/// workflow engine + ghost record→replay). Re-exported from `plugins::builtins`
/// so the seed table and desktop route flow share one definition.
pub const WORKFLOWS_PLUGIN_ID: &str = crate::plugins::builtins::WORKFLOWS_PLUGIN_ID;

/// The Workflows app's prebuilt, self-contained UI bundle (a
/// `vite-plugin-singlefile` build of `packages/workflows-app`, React Flow + all
/// JS/CSS inlined). Seeded as the plugin's `ui_code` on a fresh install so the
/// default-on companion has a UI without going through `ryu pack`. Rebuild with
/// `bun run --cwd packages/workflows-app build` and copy `dist/index.html` to
/// `fixtures/workflows.ui.html` to refresh it.
pub const WORKFLOWS_UI_HTML: &str = include_str!("fixtures/workflows.ui.html");

/// The Webhooks app's prebuilt, self-contained UI bundle (a `vite-plugin-singlefile`
/// build of `apps-store/webhooks/ui`, all JS/CSS — incl. the tree-shaken `@ryu/ui`
/// components — inlined). Seeded as the plugin's `ui_code` on a fresh install so the
/// default-on companion has a UI without going through `ryu pack`. Rebuild with
/// `bun run --cwd apps-store/webhooks/ui build` (or `scripts/sync-app-fixtures.sh
/// webhooks`) and copy `dist/index.html` to `fixtures/webhooks.ui.html` to refresh it.
pub const WEBHOOKS_UI_HTML: &str = include_str!("fixtures/webhooks.ui.html");

/// The Quests app's prebuilt, self-contained UI bundle (a `vite-plugin-singlefile`
/// build of `apps-store/quests/ui`, all JS/CSS — incl. the tree-shaken `@ryu/ui`
/// components — inlined). Seeded as the plugin's `ui_code` on a fresh install so the
/// default-on companion has a UI without going through `ryu pack`. Rebuild with
/// `bun run --cwd apps-store/quests/ui build` (or `scripts/sync-app-fixtures.sh
/// quests`) and copy `dist/index.html` to `fixtures/quests.ui.html` to refresh it.
pub const QUESTS_UI_HTML: &str = include_str!("fixtures/quests.ui.html");

/// The Activity app's prebuilt, self-contained UI bundle (a `vite-plugin-singlefile`
/// build of `apps-store/activity/ui`, all JS/CSS — incl. the tree-shaken `@ryu/ui`
/// components — inlined). Seeded as the plugin's `ui_code` on a fresh install so the
/// default-on companion has a UI without going through `ryu pack`. Rebuild with
/// `bun run --cwd apps-store/activity/ui build` (or `scripts/sync-app-fixtures.sh
/// activity`) and copy `dist/index.html` to `fixtures/activity.ui.html` to refresh it.
pub const ACTIVITY_UI_HTML: &str = include_str!("fixtures/activity.ui.html");

/// The Timeline app's prebuilt, self-contained UI bundle (a `vite-plugin-singlefile`
/// build of `apps-store/timeline/ui`, all JS/CSS — incl. the tree-shaken `@ryu/ui`
/// components — inlined). Seeded as the plugin's `ui_code` on a fresh install so the
/// default-on companion has a UI without going through `ryu pack`. Rebuild with
/// `bun run --cwd apps-store/timeline/ui build` (or `scripts/sync-app-fixtures.sh
/// timeline`) and copy `dist/index.html` to `fixtures/timeline.ui.html` to refresh it.
pub const TIMELINE_UI_HTML: &str = include_str!("fixtures/timeline.ui.html");

/// The Skill Editor app's prebuilt, self-contained UI bundle (a `vite-plugin-singlefile`
/// build of `apps-store/skill-editor/ui`, all JS/CSS — incl. the tree-shaken `@ryu/ui`
/// components — inlined). Seeded as the plugin's `ui_code` on a fresh install so the
/// default-on companion has a UI without going through `ryu pack`. Rebuild with
/// `bun run --cwd apps-store/skill-editor/ui build` (or `scripts/sync-app-fixtures.sh
/// skill-editor`) and copy `dist/index.html` to `fixtures/skill-editor.ui.html` to
/// refresh it.
pub const SKILL_EDITOR_UI_HTML: &str = include_str!("fixtures/skill-editor.ui.html");

/// The Mail (Agent Inboxes) app's prebuilt, self-contained UI bundle (a
/// `vite-plugin-singlefile` build of `apps-store/mail/ui`, all JS/CSS — incl. the
/// tree-shaken `@ryu/ui` components — inlined). Seeded as the plugin's `ui_code`
/// onto a DISABLED record so enabling the opt-in `@ryu/mail` app (from the store)
/// mounts the sandboxed companion. Rebuild with `bun run --cwd apps-store/mail/ui
/// build` (or `scripts/sync-app-fixtures.sh mail`) and copy `dist/index.html` to
/// `fixtures/mail.ui.html` to refresh it.
pub const MAIL_UI_HTML: &str = include_str!("fixtures/mail.ui.html");

/// The Calendar app's prebuilt, self-contained UI bundle (a
/// `vite-plugin-singlefile` build of `apps-store/calendar/ui`, all JS/CSS — incl.
/// the tree-shaken `@ryu/ui` components — inlined). Seeded as the plugin's `ui_code`
/// (default-on companion) so the `/calendar` route mounts the sandboxed companion.
/// Rebuild with `bun run --cwd apps-store/calendar/ui build` (or
/// `scripts/sync-app-fixtures.sh calendar`) and copy `dist/index.html` to
/// `fixtures/calendar.ui.html` to refresh it.
pub const CALENDAR_UI_HTML: &str = include_str!("fixtures/calendar.ui.html");

/// The Warmup app's prebuilt, self-contained UI bundle (a `vite-plugin-singlefile`
/// build of `apps-store/warmup/ui`, all JS/CSS — incl. the tree-shaken `@ryu/ui`
/// components — inlined). Seeded as the plugin's `ui_code` onto a DISABLED record,
/// so enabling the opt-in `@ryu/warmup` app from the store mounts the sandboxed
/// companion. Rebuild with `bun run --cwd apps-store/warmup/ui build` (or
/// `scripts/sync-app-fixtures.sh warmup`) and copy `dist/index.html` to
/// `fixtures/warmup.ui.html` to refresh it.
pub const WARMUP_UI_HTML: &str = include_str!("fixtures/warmup.ui.html");

/// The Learning app's prebuilt, self-contained UI bundle (a `vite-plugin-singlefile`
/// build of `apps-store/learning/ui`, all JS/CSS — incl. the tree-shaken `@ryu/ui`
/// components — inlined). Seeded as the plugin's `ui_code` (default-on companion) so
/// the `/learning` route mounts the sandboxed companion. The `@ryu/learning`
/// manifest was a wave-2 route-gate governance shell (gating `/api/learn/*` +
/// `/api/experience/*`); the W7 frontend extraction upgrades it in place to ALSO
/// carry the companion runnable. Rebuild with `bun run --cwd apps-store/learning/ui
/// build` (or `scripts/sync-app-fixtures.sh learning`) and copy `dist/index.html` to
/// `fixtures/learning.ui.html` to refresh it.
pub const LEARNING_UI_HTML: &str = include_str!("fixtures/learning.ui.html");

/// The Meetings app's prebuilt, self-contained UI bundle (a `vite-plugin-singlefile`
/// build of `apps-store/meetings/ui`, all JS/CSS — incl. the tree-shaken `@ryu/ui`
/// components — inlined). Seeded as the plugin's `ui_code` (default-on companion) so
/// the `/meetings` + `/meetings/:id` routes mount the sandboxed companion (record →
/// live transcript → AI notes + audio import). The `@ryu/meetings` manifest was a
/// wave-2 route-gate governance shell (gating `/api/meetings/*`) that `requires` the
/// `spaces` app; the W7 frontend extraction upgrades it in place to ALSO carry the
/// companion runnable. Rebuild with `bun run --cwd apps-store/meetings/ui build` (or
/// `scripts/sync-app-fixtures.sh meetings`) and copy `dist/index.html` to
/// `fixtures/meetings.ui.html` to refresh it.
pub const MEETINGS_UI_HTML: &str = include_str!("fixtures/meetings.ui.html");

/// The Outpost (social) app's prebuilt, self-contained UI bundle (a
/// `vite-plugin-singlefile` build of `apps-store/social/ui`, all JS/CSS — incl. the
/// tree-shaken `@ryu/ui` components — inlined). Seeded as the plugin's `ui_code` onto
/// a DISABLED record, so enabling the opt-in `@ryu/social` app from the store mounts
/// the sandboxed companion on `/social` + `/social/:id` (compose → calendar → queue →
/// inbox). The frame reaches its own `ryu-social` sidecar ONLY through the
/// `social:crud` bridge forwarder — its CSP is `connect-src 'none'` and it declares no
/// `csp` widening, so it has no network of its own. Rebuild with
/// `bun run --cwd apps-store/social/ui build` (or `scripts/sync-app-fixtures.sh
/// social`) and copy `dist/index.html` to `fixtures/social.ui.html` to refresh it.
pub const SOCIAL_UI_HTML: &str = include_str!("fixtures/social.ui.html");

/// The Deep Read (`@ryu/rlm`) app's prebuilt, self-contained UI bundle (a
/// `vite-plugin-singlefile` build of `apps-store/rlm/ui`, all JS/CSS inlined).
/// Seeded as the plugin's `ui_code` onto a DISABLED record, so enabling the opt-in
/// `@ryu/rlm` app from the store mounts the sandboxed companion (load a corpus →
/// outline → ask → trace). The frame reaches its own `ryu-rlm` sidecar ONLY through
/// the `rlm:query` bridge forwarder — its CSP is `connect-src 'none'` and it
/// declares no `csp` widening, so it has no network of its own. Rebuild with
/// `bun run --cwd apps-store/rlm/ui build` (or `scripts/sync-app-fixtures.sh rlm`)
/// and copy `dist/index.html` to `fixtures/rlm.ui.html` to refresh it.
pub const RLM_UI_HTML: &str = include_str!("fixtures/rlm.ui.html");

/// The Subtitles app's prebuilt, self-contained UI bundle (a
/// `vite-plugin-singlefile` build of `apps-store/subtitles/ui`, all JS/CSS — incl.
/// the tree-shaken `@ryu/ui` components — inlined). Seeded as the plugin's `ui_code`
/// onto a DISABLED record, so enabling the opt-in `@ryu/subtitles` app from the store
/// mounts the sandboxed companion on `/subtitles` + `/subtitles/:id` (pick a video →
/// watch the job → read the transcript). The frame reaches its own `ryu-subtitles`
/// sidecar ONLY through the `subtitles:crud` bridge forwarder — its CSP is
/// `connect-src 'none'` and it declares no `csp` widening, so it has no network of its
/// own, and the video it names is opened by the SIDECAR rather than uploaded through
/// the frame. Rebuild with `bun run --cwd apps-store/subtitles/ui build` (or
/// `scripts/sync-app-fixtures.sh subtitles`) and copy `dist/index.html` to
/// `fixtures/subtitles.ui.html` to refresh it.
pub const SUBTITLES_UI_HTML: &str = include_str!("fixtures/subtitles.ui.html");

/// The Inbox (Approvals) app's prebuilt, self-contained UI bundle (a
/// `vite-plugin-singlefile` build of `apps-store/approvals/ui`, all JS/CSS — incl. the
/// tree-shaken `@ryu/ui` components — inlined). Seeded as the plugin's `ui_code`
/// (default-on companion) so the `/inbox` + `/approvals` routes mount the sandboxed
/// companion. The `@ryu/approvals` manifest was a wave-2 gate-only governance shell
/// (gating `/api/approvals/*`); the W7 frontend extraction upgrades it in place to ALSO
/// carry the companion runnable — the unified Inbox page (approvals + notifications +
/// quest check-offs + Shadow suggestions). Rebuild with
/// `bun run --cwd apps-store/approvals/ui build` (or `scripts/sync-app-fixtures.sh
/// approvals`) and copy `dist/index.html` to `fixtures/approvals.ui.html` to refresh it.
pub const APPROVALS_UI_HTML: &str = include_str!("fixtures/approvals.ui.html");

/// Loader that merges built-in manifests with user-installed ones from
/// `~/.ryu/plugins/*/manifest.json` (the path is overridable via `RYU_PLUGINS_DIR`,
/// or the legacy `RYU_APPS_DIR`; the legacy `plugin.json` and `ryu.json` file names
/// are also read).
///
/// # Validation
/// - A manifest whose `version` field is not valid semver is rejected with a logged
///   warning; all other manifests continue loading.
/// - A duplicate `id` (across built-ins and user manifests) is rejected with a
///   logged warning; the *first* manifest with that id wins.
/// - Any manifest that fails JSON parsing is skipped with a warning.
pub struct PluginManifestLoader;

/// A manifest that parsed and validated cleanly but whose declared **host floors**
/// (`engines`) this node does not satisfy.
///
/// ## Why the manifest is private
///
/// An incompatible plugin has to be VISIBLE (the marketplace must show it, greyed,
/// saying what it needs) without being LIVE. Those pull in opposite directions: the
/// moment an incompatible manifest reaches the runtime manifest list, every
/// consumer that iterates it picks the plugin up — hook dispatch, `app_contrib`,
/// `may_emit_event`, the contributions endpoint, sidecar spawn, `http.public_mount`,
/// `AppGate` registration. Auditing all of them to skip one flag is exactly the kind
/// of "one site missed it" bug this codebase already learned about with legacy id
/// canonicalization.
///
/// So the manifest is not exposed as a field. [`PluginManifestLoader::load`] still
/// returns `Vec<PluginManifest>` containing ONLY compatible manifests — every
/// existing runtime caller is unchanged and cannot see an incompatible plugin even
/// in principle. The catalog projection is the one consumer that wants it, and it
/// asks by name via [`IncompatibleManifest::for_catalog`].
#[derive(Debug, Clone)]
pub struct IncompatibleManifest {
    /// PRIVATE by design — see the type doc. Reach it via
    /// [`IncompatibleManifest::for_catalog`], which names its one legitimate use.
    manifest: PluginManifest,
    /// Which floors are unsatisfied, and what is actually running.
    verdict: CompatibilityVerdict,
    /// Where this manifest came from (`<built-in>` or a path), for diagnostics.
    source: String,
}

impl IncompatibleManifest {
    /// The plugin id.
    pub fn id(&self) -> &str {
        &self.manifest.id
    }

    /// Why it is incompatible.
    pub fn verdict(&self) -> &CompatibilityVerdict {
        &self.verdict
    }

    /// Where it was loaded from.
    pub fn source(&self) -> &str {
        &self.source
    }

    /// The manifest, **for building a marketplace card only**.
    ///
    /// Named for its one legitimate caller so that any other use is obvious in
    /// review. Do NOT register hooks, routes, sidecars, contributions or public
    /// mounts from this — the plugin is not installable on this node, and anything
    /// it registers is a capability the user cannot see or govern.
    pub fn for_catalog(&self) -> &PluginManifest {
        &self.manifest
    }
}

/// The outcome of a load pass: the manifests that may run, and the ones that may
/// only be shown.
#[derive(Debug, Clone, Default)]
pub struct LoadedManifests {
    /// Manifests that passed every gate. This is what the runtime uses.
    pub compatible: Vec<PluginManifest>,
    /// Manifests held back by an unsatisfied host floor. Catalog-only.
    pub incompatible: Vec<IncompatibleManifest>,
}

/// Why a manifest did not make it into the runtime set.
///
/// Split so the loader can tell "this file is broken, drop it" (the historical
/// behaviour, still a warning) apart from "this plugin is fine but needs a newer
/// host", which is a first-class, user-facing state rather than a log line.
#[derive(Debug, Clone)]
pub enum ManifestRejection {
    /// Malformed, unparseable, duplicate, or otherwise invalid. Dropped entirely.
    Invalid(String),
    /// Well-formed, but this node does not meet its declared host floors.
    Incompatible(Box<IncompatibleManifest>),
}

/// Every pre-existing gate in `parse_and_validate` reports a `String`, and all of
/// them mean the same thing: this manifest is not usable. Converting here keeps
/// those call sites (and their `?`) untouched, so the only gate that had to learn
/// the new outcome is the host-floor one.
impl From<String> for ManifestRejection {
    fn from(msg: String) -> Self {
        ManifestRejection::Invalid(msg)
    }
}

impl std::fmt::Display for ManifestRejection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ManifestRejection::Invalid(msg) => f.write_str(msg),
            ManifestRejection::Incompatible(inc) => {
                let unmet: Vec<String> = inc
                    .verdict
                    .unmet
                    .iter()
                    .filter(|u| u.is_blocking())
                    .map(|u| match u {
                        UnmetRequirement::TooOld {
                            surface,
                            required,
                            present,
                        } => format!("{} requires {required} but this node has {present}", surface.engines_key()),
                        UnmetRequirement::InvalidRequirement {
                            surface, required, ..
                        } => format!("{} has an invalid requirement '{required}'", surface.engines_key()),
                        UnmetRequirement::Unknown { surface, required } => {
                            format!("{} requires {required} (version unknown)", surface.engines_key())
                        }
                    })
                    .collect();
                write!(
                    f,
                    "app '{}' is not compatible with this node: {} (source: {})",
                    inc.manifest.id,
                    unmet.join("; "),
                    inc.source
                )
            }
        }
    }
}

/// The host versions this node can actually vouch for.
///
/// Core knows its own version, and the Gateway's when it has been observed via
/// `/health`. Everything else — desktop, island, mobile, extension, web, and a
/// separately-installed CLI — is a distinct install that never reports in, so it is
/// deliberately absent rather than guessed. Absent means UNKNOWN, which
/// [`HostVersions::evaluate`] treats as advisory: see
/// [`UnmetRequirement::Unknown`].
///
/// Guessing here would be the dangerous choice. Core, Gateway, CLI and desktop do
/// ship from one release train, so stamping Core's version onto all four would
/// usually be right — and silently wrong exactly when it matters, for the stale
/// binary left behind by a partial update, which is the case a floor exists to
/// catch.
pub fn node_host_versions() -> HostVersions {
    let mut hosts = HostVersions::default().with(Surface::Core, core_version().to_string());
    if let Some(gw) = crate::sidecar::gateway::observed_gateway_version() {
        hosts = hosts.with(Surface::Gateway, gw);
    }
    hosts
}

impl PluginManifestLoader {
    /// Resolve the plugins scan directory.
    ///
    /// Resolution order:
    /// 1. `RYU_PLUGINS_DIR` if set.
    /// 2. `RYU_APPS_DIR` if set (legacy env var, still honoured).
    /// 3. `~/.ryu/plugins` if it exists, or if the legacy `~/.ryu/apps` does not.
    /// 4. `~/.ryu/apps` only as a fallback when the new dir is absent but the
    ///    legacy one exists (so pre-rename installs are not orphaned).
    pub fn plugins_dir() -> PathBuf {
        if let Some(p) = std::env::var_os("RYU_PLUGINS_DIR") {
            return PathBuf::from(p);
        }
        if let Some(p) = std::env::var_os("RYU_APPS_DIR") {
            return PathBuf::from(p);
        }
        let ryu = crate::paths::ryu_dir();
        let new_dir = ryu.join("plugins");
        let legacy_dir = ryu.join("apps");
        if !new_dir.exists() && legacy_dir.exists() {
            return legacy_dir;
        }
        new_dir
    }

    /// Load all manifests: built-ins first, then user-installed. Returns only
    /// the manifests that pass semver and duplicate-id validation.
    ///
    /// **Compatible manifests only.** A plugin whose host floors this node does not
    /// meet is not in this list — which is precisely how the runtime is kept from
    /// ever activating one. Callers that need to SHOW those (the catalog) use
    /// [`Self::load_all`] and read the [`LoadedManifests::incompatible`] lane.
    pub fn load() -> Vec<PluginManifest> {
        Self::load_all().compatible
    }

    /// [`Self::load`] plus the manifests held back by an unsatisfied host floor.
    ///
    /// Only the catalog projection should call this. Everything that RUNS a plugin
    /// wants `load()`, whose type makes the incompatible lane unreachable.
    pub fn load_all() -> LoadedManifests {
        let mut manifests: Vec<PluginManifest> = Vec::new();
        let mut incompatible: Vec<IncompatibleManifest> = Vec::new();
        let mut seen_ids: HashSet<String> = HashSet::new();

        // 1. Built-in manifests (compiled in).
        for &raw in BUILTIN_MANIFESTS {
            match Self::parse_and_validate(raw, "<built-in>", None, &mut seen_ids) {
                Ok(m) => manifests.push(m),
                Err(ManifestRejection::Incompatible(inc)) => {
                    tracing::info!(
                        plugin = %inc.id(),
                        "built-in held back: {}",
                        ManifestRejection::Incompatible(inc.clone())
                    );
                    incompatible.push(*inc);
                }
                Err(e) => tracing::warn!("built-in manifest skipped: {e}"),
            }
        }

        // 2. User-installed manifests from the plugins directory. Each plugin dir
        //    may carry `manifest.json` (preferred) or the legacy `plugin.json` /
        //    `ryu.json`.
        let dir = Self::plugins_dir();
        match std::fs::read_dir(&dir) {
            Ok(entries) => {
                for entry in entries.flatten() {
                    let Some(manifest_path) = MANIFEST_FILE_NAMES
                        .iter()
                        .map(|name| entry.path().join(name))
                        .find(|p| p.exists())
                    else {
                        continue;
                    };
                    match std::fs::read_to_string(&manifest_path) {
                        Ok(raw) => {
                            // `plugin.json` is BOTH a legacy alias for our own
                            // manifest and the Agent Plugins spec's manifest name.
                            // A spec file declares the canonical agent-plugins.org
                            // `$schema`, which no native manifest has ever carried;
                            // translate it before the native parser sees a file with
                            // no `id`/`runnables` and rejects the plugin.
                            let raw = match Self::translate_agent_plugin(
                                &raw,
                                &manifest_path,
                            ) {
                                Ok(translated) => translated,
                                Err(e) => {
                                    tracing::warn!(
                                        "agent plugin at {} skipped: {e}",
                                        manifest_path.display()
                                    );
                                    continue;
                                }
                            };
                            match Self::parse_and_validate(
                                &raw,
                                &manifest_path.to_string_lossy(),
                                manifest_path.parent(),
                                &mut seen_ids,
                            ) {
                                Ok(m) => manifests.push(m),
                                Err(ManifestRejection::Incompatible(inc)) => {
                                    tracing::info!(
                                        plugin = %inc.id(),
                                        "installed plugin held back: {}",
                                        ManifestRejection::Incompatible(inc.clone())
                                    );
                                    incompatible.push(*inc);
                                }
                                Err(e) => {
                                    tracing::warn!(
                                        "plugin manifest at {} skipped: {e}",
                                        manifest_path.display()
                                    );
                                }
                            }
                        }
                        Err(e) => {
                            tracing::warn!(
                                "could not read plugin manifest at {}: {e}",
                                manifest_path.display()
                            );
                        }
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                tracing::debug!(
                    "plugins directory {} does not exist; no user plugins loaded",
                    dir.display()
                );
            }
            Err(e) => {
                tracing::warn!("could not scan plugins directory {}: {e}", dir.display());
            }
        }

        LoadedManifests {
            compatible: manifests,
            incompatible,
        }
    }

    /// Parse ONLY the compiled-in built-in manifests, ignoring `~/.ryu/plugins`.
    ///
    /// Parse ONLY the compiled-in built-in manifests, synchronously and with no disk
    /// scan (unlike [`Self::load`], which also reads the user plugins directory). Two
    /// callers: hermetic built-in tests (a `load()`-based assertion would also depend
    /// on whatever the developer has installed locally), and router-build-time
    /// public-mount registration (which is built-in-only by design and must be sync).
    pub(crate) fn load_builtins() -> Vec<PluginManifest> {
        let mut seen_ids: HashSet<String> = HashSet::new();
        BUILTIN_MANIFESTS
            .iter()
            .filter_map(|raw| Self::parse_and_validate(raw, "<built-in>", None, &mut seen_ids).ok())
            .collect()
    }

    /// Translate an Agent Plugins v1 manifest into the native form, or pass a
    /// native manifest through untouched.
    ///
    /// Import is deliberately a translation in FRONT of the normal loader rather
    /// than a second loader: everything Core enforces on a manifest — id
    /// validation, legacy-id canonicalization, semver, duplicate-id rejection —
    /// then applies to an imported plugin too, because it takes the identical
    /// path. See [`agent_plugin`] for the spec rules and the security posture.
    fn translate_agent_plugin(raw: &str, path: &Path) -> Result<String, String> {
        if !agent_plugin::is_agent_plugin_manifest(raw) {
            return Ok(raw.to_string());
        }
        let dir = path
            .parent()
            .ok_or_else(|| "manifest has no parent directory".to_string())?;
        let imported = agent_plugin::import_manifest(dir, raw)?;
        for note in &imported.notes {
            // The spec requires a client to REPORT what it skipped or ignored
            // (§6.2, §7.2.2) rather than fail, so these are warnings by contract.
            tracing::warn!("agent plugin {}: {note}", path.display());
        }
        serde_json::to_string(&imported.manifest)
            .map_err(|e| format!("could not serialize translated manifest: {e}"))
    }

    /// Parse one manifest and run Core's full load-time gate over it.
    ///
    /// `code_base` is where this manifest's `code_file` references resolve from:
    /// `None` for a compiled-in built-in (they come from the embedded
    /// [`builtin_code`] table) and `Some(plugin_dir)` for a manifest read off disk.
    /// Hydration runs FIRST, before any other gate, so every later check — and every
    /// consumer — sees the runtime-ready form with `code` populated.
    fn parse_and_validate(
        raw: &str,
        source: &str,
        code_base: Option<&Path>,
        seen_ids: &mut HashSet<String>,
    ) -> Result<PluginManifest, ManifestRejection> {
        let mut manifest: PluginManifest =
            serde_json::from_str(raw).map_err(|e| format!("JSON parse error: {e}"))?;

        validate_plugin_id(&manifest.id).map_err(|e| format!("{e} (source: {source})"))?;

        // Canonicalize a legacy id to its scoped form HERE — the single load
        // chokepoint — so nothing downstream needs alias awareness. `app_store`
        // lookups, hook dispatch, `may_emit_event`, the contributions endpoint and
        // every `manifests.iter().find(|m| m.id == ...)` then only ever compare
        // canonical ids. Sprinkling `canonical_plugin_id` at read sites instead is
        // how one site ends up missing it and silently resolving nothing.
        //
        // Deliberately AFTER validation: an id is validated in the exact form the
        // author wrote, so a malformed legacy id cannot be laundered by an alias.
        let canonical = canonical_plugin_id(&manifest.id);
        if canonical != manifest.id {
            tracing::debug!(
                legacy = %manifest.id,
                canonical,
                "plugin_manifest: canonicalized a legacy plugin id"
            );
            manifest.id = canonical.to_owned();
        }

        // Dependency edges name OTHER plugins, so they need the same treatment: a
        // manifest that says `requires.apps: [{ id: "@ryu/ghost" }]` must still resolve
        // after ghost became `@ryu/ghost`, or the dependency graph reports a missing
        // dependency and refuses to enable the plugin. Applies to third-party
        // manifests that will never be updated, which is the whole point of the map.
        if let Some(requires) = manifest.requires.as_mut() {
            for dep in &mut requires.apps {
                let canonical = canonical_plugin_id(&dep.id);
                if canonical != dep.id {
                    dep.id = canonical.to_owned();
                }
            }
        }

        hydrate_manifest_code_files(&mut manifest, code_base)
            .map_err(|e| format!("{e} (source: {source})"))?;

        if semver::Version::parse(&manifest.version).is_err() {
            return Err(format!(
                "app '{}' has invalid semver version '{}' (source: {source})",
                manifest.id, manifest.version
            ).into());
        }

        if !seen_ids.insert(manifest.id.clone()) {
            return Err(format!(
                "duplicate app id '{}' (source: {source}); first occurrence wins",
                manifest.id
            ).into());
        }

        // Host-floor gate: every requirement in `engines` must parse as semver, and
        // every floor for a surface whose version this node KNOWS must be satisfied.
        //
        // The two failures are deliberately different outcomes:
        //
        //   * an UNPARSEABLE requirement is a broken manifest — a hard `Invalid`,
        //     dropped exactly as before. There is nothing to show a user, and a
        //     requirement nobody can evaluate must never be treated as satisfied.
        //   * an UNSATISFIED floor is a well-formed plugin that this node is too old
        //     to run. That used to be a hard reject too, which made the plugin
        //     VANISH: no card, no explanation, no way for a user to learn that
        //     updating would bring it back. It now goes to the incompatible lane —
        //     shown in the marketplace with what it needs, refused at install.
        //
        // Only floors for OBSERVABLE surfaces can block; see `node_host_versions`.
        if let Some(engines) = &manifest.engines {
            let verdict = node_host_versions().evaluate(Some(engines));
            if let Some(bad) = verdict.unmet.iter().find_map(|u| match u {
                UnmetRequirement::InvalidRequirement {
                    surface,
                    required,
                    reason,
                } => Some((surface, required, reason)),
                _ => None,
            }) {
                let (surface, required, reason) = bad;
                return Err(ManifestRejection::Invalid(format!(
                    "app '{}' has an invalid engines.{} requirement '{required}': {reason} \
                     (source: {source})",
                    manifest.id,
                    surface.engines_key(),
                )));
            }
            if !verdict.compatible {
                return Err(ManifestRejection::Incompatible(Box::new(
                    IncompatibleManifest {
                        manifest,
                        verdict,
                        source: source.to_owned(),
                    },
                )));
            }
        }

        // Dependency SHAPE gate (`requires.apps`). This is deliberately per-manifest
        // only — self-dependency, a malformed `min_version`, and duplicate edges are
        // all decidable from this manifest alone. Whether a declared dependency
        // EXISTS, is version-SATISFIABLE, and is ACYCLIC are cross-manifest
        // questions that this function structurally cannot answer (it sees one
        // manifest and a `seen_ids` set, never the other 36); those resolve later
        // against the full installed set in `crate::plugins::graph`.
        {
            let mut seen_deps: HashSet<&str> = HashSet::new();
            for dep in manifest.dependencies() {
                validate_plugin_id(&dep.id).map_err(|e| {
                    format!(
                        "app '{}' declares dependency with invalid id: {e} (source: {source})",
                        manifest.id
                    )
                })?;
                if dep.id == manifest.id {
                    return Err(format!(
                        "app '{}' cannot depend on itself (source: {source})",
                        manifest.id
                    ).into());
                }
                if !seen_deps.insert(dep.id.as_str()) {
                    return Err(format!(
                        "app '{}' declares duplicate dependency '{}' (source: {source})",
                        manifest.id, dep.id
                    ).into());
                }
                if let Some(min) = &dep.min_version {
                    parse_min_version(min).map_err(|e| {
                        format!(
                            "app '{}' dependency '{}': {e} (source: {source})",
                            manifest.id, dep.id
                        )
                    })?;
                }
            }
        }

        // Validate each Runnable's per-kind config contract.
        for entry in &manifest.runnables {
            validate_runnable(entry)
                .map_err(|e| format!("app '{}' (source: {source}): {e}", manifest.id))?;
        }

        // Validate each declared managed sidecar (name safety, health path, and
        // per-process-kind required fields). Duplicate local names would collide on
        // the same `<plugin_id>/<name>` manager key, so reject them at load.
        {
            let mut seen: HashSet<&str> = HashSet::new();
            for spec in &manifest.sidecars {
                crate::plugin_manifest::schema::validate_sidecar_spec(spec)
                    .map_err(|e| format!("app '{}' (source: {source}): {e}", manifest.id))?;
                if !seen.insert(spec.name.as_str()) {
                    return Err(format!(
                        "app '{}' declares duplicate sidecar name '{}' (source: {source})",
                        manifest.id, spec.name
                    ).into());
                }
            }
        }

        // Manifest-level companion surface: anti-impersonation on the visible label
        // (same rule as the companion *runnable* config and the desktop route-title
        // gate) so a plugin's panel can never pose as first-party Ryu/system chrome.
        if let Some(companion) = &manifest.companion {
            if companion.label.trim().is_empty() {
                return Err(format!(
                    "app '{}' companion label must not be empty (source: {source})",
                    manifest.id
                ).into());
            }
            if crate::plugin_manifest::schema::label_impersonates_system_chrome(&companion.label) {
                return Err(format!(
                    "app '{}' companion label '{}' must not impersonate system chrome (must not contain 'ryu' or 'system') (source: {source})",
                    manifest.id, companion.label
                ).into());
            }
        }

        // Contribution cross-validation: every id referenced in `contributes`
        // must resolve to a runnable declared in this manifest (declare-by-id).
        if let Some(contributes) = &manifest.contributes {
            let runnable_ids: HashSet<&str> =
                manifest.runnables.iter().map(|r| r.id.as_str()).collect();
            for referenced in contributes.referenced_ids() {
                if !runnable_ids.contains(referenced) {
                    return Err(format!(
                        "app '{}' contributes unknown runnable id '{referenced}' (no matching entry in 'runnables') (source: {source})",
                        manifest.id
                    ).into());
                }
            }
        }

        // Settings + tool-filter schema gate — the manifest equivalent of parsing a
        // config through a schema at import instead of trusting it at use.
        //
        // `settings_tabs` is stored as raw JSON so the contributions endpoint can tag
        // and forward each entry verbatim (see `Contributes::settings_tabs`), so it is
        // only ever held to `SettingsTabContribution` at a validation chokepoint —
        // and this is Core's, covering compiled-in built-ins and disk-loaded
        // third-party manifests alike because every manifest reaches Core through
        // this function. Without it a malformed tab travels all the way to the
        // desktop and is dropped by the renderer's defensive parser: the author sees
        // a settings screen with a missing row and no diagnostic anywhere. The rules
        // themselves live in the contract crate so the SDK/FFI path
        // (`PluginManifest::validate`) enforces exactly the same ones. A failure here
        // is a skipped manifest with a warn, same as every other gate above.
        if let Some(contributes) = &manifest.contributes {
            contributes
                .validate_settings_contributions()
                .map_err(|e| format!("app '{}': {e} (source: {source})", manifest.id))?;

            // Output styles need their own line here for the reason this loader
            // re-runs individual gates rather than `PluginManifest::validate`:
            // hydration above already enforced exactly-one-of `source`/`file`, the
            // path allowlist and the size cap, but NOT the id alphabet or id
            // uniqueness. A duplicate id is the one that has to be caught at load —
            // two rows sharing one id collapse to a single entry in the merged
            // registry, so a persisted selection silently resolves to whichever
            // happened to load last. Runs AFTER hydration on purpose: by now every
            // row is in the `source`-only wire form the check's second arm accepts.
            contributes
                .validate_output_styles()
                .map_err(|e| format!("app '{}': {e} (source: {source})", manifest.id))?;
        }

        // User-facing permission vocabulary gate. Repeated here rather than inherited
        // from `PluginManifest::validate` because this loader deliberately re-runs the
        // individual gates instead of the whole superset — the ids become grant
        // strings and API path segments, so a malformed one must never reach storage.
        validate_permission_levels(&manifest.permission_levels)
            .map_err(|e| format!("app '{}': {e} (source: {source})", manifest.id))?;

        // And the routes that CONSUME that vocabulary. Load-time rather than
        // call-time because a route naming an undeclared level is unsatisfiable: the
        // ext-proxy would refuse it on every request with the cause visible only in
        // whatever the resolver logs.
        validate_route_permissions(&manifest.sidecars, &manifest.permission_levels)
            .map_err(|e| format!("app '{}': {e} (source: {source})", manifest.id))?;

        Ok(manifest)
    }
}

#[cfg(test)]
mod tests {
    use super::schema::validate_runnable;
    use super::*;
    use crate::runnable::RunnableKind;

    const SAMPLE_JSON: &str = include_str!("../../../../plugins-store/sample/manifest.json");

    /// The multi-kind fixture lives in `apps/core/tests/manifest_fixtures/` so it
    /// doubles as the integration-test input and the in-module round-trip fixture.
    const MULTI_KIND_JSON: &str = include_str!("../../tests/manifest_fixtures/multi_kind.ryu.json");

    /// Core-owned port bases — the ports Core's own substrate binds (llama.cpp and
    /// friends, whisper, TTS, sd.cpp, restate, the SDK adapter). A manifest sidecar
    /// landing on one fights a Core process for the socket and whoever starts second
    /// loses. A literal list rather than imports of each provider's const, so this is a
    /// second independent record of the map: if a provider const moves, the mismatch
    /// surfaces here as a review question instead of silently agreeing with itself.
    const CORE_RESERVED_PORTS: &[u16] = &[
        3200,  // sidecar::adapters::sdk DEFAULT_SDK_APP_PORT
        7980,  // tool_exec CORE_BASE_PORT
        8000,  // vllm / omlx DEFAULT_PORT
        8080,  // restate http + ingress (and llama.cpp)
        8081,  // llamacpp embed
        8082,  // llamacpp rerank
        8083,  // sd.cpp SD_PORT_BASE + llamacpp CLASSIFY_PORT_BASE
        8084,  // mlx_vlm
        8085,  // ryutts TTS_PORT
        8086,  // mlx DEFAULT_PORT_BASE
        8087,  // research ENGINE_PORT
        8090,  // whisper.cpp WHISPER_PORT_BASE
        9070,  // restate admin
        30000, // sglang
    ];

    /// Known, pre-existing overlaps with [`CORE_RESERVED_PORTS`]. Real debt, frozen so
    /// it cannot grow — a NEW overlap fails the test, these do not. Fixing one means
    /// moving the app's port and deleting its row.
    const KNOWN_CORE_OVERLAPS: &[(&str, u16)] = &[
        // finetune's Unsloth trainer vs mlx's DEFAULT_PORT_BASE. Latent: both are
        // opt-in and rarely resident at the same time.
        ("@ryu/finetune", 8086),
    ];

    /// Two built-in manifests must never declare the same sidecar port, and a built-in
    /// must never squat a port Core itself binds.
    ///
    /// This guard did not exist until 2026-08-11, and by then `simulator` + `teams`
    /// were both on 7994 and `tuition` had been authored pre-collided with
    /// `mission-control` on 8007 (that one was resolved the same day by moving
    /// mission-control). The port map lived in prose — `BUILTIN_MANIFESTS`
    /// still records that "8007 was contested by three concurrently built apps" —
    /// which is a comment doing a registry's job. Nothing catches a collision until
    /// `SidecarManager::claim_port` refuses at runtime, and the symptom there is an app
    /// that will not start rather than anything naming a port.
    ///
    /// A test only works for the set we own; a third-party app cannot be told to pick
    /// differently. The allocator that fixes that case is designed in
    /// `docs/port-allocation.md` and is not built.
    #[test]
    fn builtin_sidecar_ports_are_unique() {
        let mut owners: std::collections::HashMap<u16, String> = std::collections::HashMap::new();
        for manifest in PluginManifestLoader::load_builtins() {
            for spec in &manifest.sidecars {
                let owner = format!("{}/{}", manifest.id, spec.name);
                if let Some(prev) = owners.insert(spec.port, owner.clone()) {
                    panic!(
                        "port {} is declared by BOTH '{prev}' and '{owner}' — pick a free \
                         port (band map: docs/port-allocation.md)",
                        spec.port
                    );
                }
                if CORE_RESERVED_PORTS.contains(&spec.port)
                    && !KNOWN_CORE_OVERLAPS.contains(&(manifest.id.as_str(), spec.port))
                {
                    panic!(
                        "'{owner}' declares port {}, which Core's own substrate binds — pick \
                         a port outside CORE_RESERVED_PORTS",
                        spec.port
                    );
                }
            }
        }
    }

    /// Every packaged app/plugin manifest has exactly ONE home — its package
    /// directory (`<root>/<x>/manifest.json`, what the owning team edits) — and Core
    /// compiles it in straight from there via
    /// `include_str!("../../../../<root>/<x>/manifest.json")`.
    ///
    /// It used to be duplicated as a byte-identical fixture copy under
    /// `src/plugin_manifest/fixtures/<x>.manifest.json`, purely so `apps/core` would
    /// build in the OSS mirror, which ships neither package root. That copy is gone:
    /// `tools/mirror-public.sh` step 1c now vendors the `manifest.json` files into the
    /// published tree instead (and its step 3b refuses to emit a tree where any
    /// `include_str!` path fails to resolve). So there is nothing left to keep in sync
    /// and no dead-edit trap — this guard's job changed from "the two copies match" to
    /// "there is still only one copy, and Core really compiles it in".
    ///
    /// Deliberately a DIRECTORY WALK, not a hand-maintained table. The table this
    /// replaced had to be edited (and a hardcoded count bumped) for every new app,
    /// which is a second list to maintain and the exact thing that drifts — a forgotten
    /// row meant a manifest with NO guard at all, silently.
    ///
    /// Read at runtime (not `include_str!`) and skipped per-root when that root is
    /// absent, so the OSS Core mirror still builds and tests green.
    #[test]
    fn packaged_manifests_are_compiled_in_from_their_package_home() {
        let core = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let repo_root = core.join("..").join("..");
        let fixtures = core.join("src").join("plugin_manifest").join("fixtures");

        // Reference-only plugins: they exist for a third party to fork but are
        // deliberately NOT in `BUILTIN_MANIFESTS`, so the off-chat-path hook phases
        // they demonstrate (esp. per-tool-call) stay lookup-free until a user installs
        // a plugin that actually uses them. See the `BUILTIN_MANIFESTS` comment above
        // `hook-session-context`.
        // `toolsmith-example` joins them for a different reason: it is the worked
        // example `tools/toolsmith` ships, a real verified `inline_deno` tool that
        // exists so the scaffold → verify pipeline has an end-to-end regression
        // test. Registering it would put a demo in every user's catalog.
        const UNREGISTERED_BY_DESIGN: &[&str] =
            &["tool-firewall", "hook-observers", "toolsmith-example"];

        let sources: String = ["src/plugin_manifest/mod.rs", "src/sidecar/ext_proxy.rs"]
            .iter()
            .map(|rel| {
                std::fs::read_to_string(core.join(rel))
                    .unwrap_or_else(|e| panic!("{rel} must be readable to check registration: {e}"))
            })
            .collect();

        let mut checked = 0;
        for root in ["apps-store", "plugins-store"] {
            let root_dir = repo_root.join(root);
            let Ok(entries) = std::fs::read_dir(&root_dir) else {
                continue; // OSS mirror: this root is not shipped.
            };
            // `read_dir` order is arbitrary; sort so a failure names the same package
            // every run.
            let mut names: Vec<String> = entries
                .filter_map(|e| e.ok())
                .filter(|e| e.path().join("manifest.json").is_file())
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect();
            names.sort();

            for name in names {
                // A resurrected duplicate is the regression this guards against: two
                // copies again means a dead-edit trap, and the fixture one would WIN
                // for any `include_str!` still pointing at `fixtures/`.
                let stale = fixtures.join(format!("{name}.manifest.json"));
                assert!(
                    !stale.exists(),
                    "{} is a duplicate of {}/{name}/manifest.json. Packaged manifests have ONE \
                     home — the package directory — and Core includes them from there. Delete \
                     the fixture copy.",
                    stale.display(),
                    root
                );

                // The manifest must parse where it lives; `include_str!` embeds bytes
                // without validating them, so a malformed package manifest would
                // otherwise compile and only fail at runtime.
                let pkg_path = root_dir.join(&name).join("manifest.json");
                let pkg_json = std::fs::read_to_string(&pkg_path)
                    .unwrap_or_else(|e| panic!("{} unreadable: {e}", pkg_path.display()));
                serde_json::from_str::<PluginManifest>(&pkg_json).unwrap_or_else(|e| {
                    panic!("{} is not a valid manifest: {e}", pkg_path.display())
                });

                if !UNREGISTERED_BY_DESIGN.contains(&name.as_str()) {
                    // The exact relative path, not just the file name: a wrong number of
                    // `..` segments is a compile error, but a path pointing at the WRONG
                    // package root would silently compile in someone else's manifest.
                    let expected =
                        format!("include_str!(\"../../../../{root}/{name}/manifest.json\")");
                    let multiline = format!("\"../../../../{root}/{name}/manifest.json\"");
                    assert!(
                        sources.contains(&expected) || sources.contains(&multiline),
                        "{root}/{name} is not compiled into Core — no `include_str!` names \
                         `../../../../{root}/{name}/manifest.json`, so it does not exist at \
                         runtime. Add it to BUILTIN_MANIFESTS, or to UNREGISTERED_BY_DESIGN if \
                         that is intended."
                    );
                }
                checked += 1;
            }
        }

        // Gate the zero-escape on the DIRECTORIES being absent, not on reads failing:
        // otherwise a tree where every package vanished is indistinguishable from the
        // mirror, and this guard passes having checked nothing.
        if repo_root.join("apps-store").is_dir() || repo_root.join("plugins-store").is_dir() {
            assert!(
                checked > 0,
                "a package root is present, so at least one manifest must have been checked"
            );
        } else {
            assert_eq!(
                checked, 0,
                "both package roots are absent (OSS mirror), so nothing should have been checked"
            );
        }
    }

    /// Walk `plugins-store` and `apps-store`, returning `(plugin id, ROOT-qualified
    /// package dir, code_file)` for every sandboxed-JS file a package manifest
    /// references.
    ///
    /// The dir is root-qualified (`plugins-store/advisor`, `apps-store/reasoning`)
    /// because both roots may carry `code_file` refs, and the failure message below
    /// hands the author an `include_str!` line to paste — one naming the wrong root
    /// would not resolve.
    ///
    /// Read at runtime (not `include_str!`) and empty when neither root is shipped,
    /// so the OSS Core mirror still builds and tests green — the same posture as
    /// [`packaged_manifests_are_compiled_in_from_their_package_home`].
    fn packaged_code_file_refs() -> Vec<(String, String, String)> {
        let repo_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..");
        let mut refs = Vec::new();
        for root in ["apps-store", "plugins-store"] {
            let Ok(entries) = std::fs::read_dir(repo_root.join(root)) else {
                continue; // OSS mirror: this root is not shipped.
            };
            let mut dirs: Vec<PathBuf> = entries
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.join("manifest.json").is_file())
                .collect();
            dirs.sort();
            for dir in dirs {
                let path = dir.join("manifest.json");
                let raw = std::fs::read_to_string(&path)
                    .unwrap_or_else(|e| panic!("{} unreadable: {e}", path.display()));
                let manifest: PluginManifest = serde_json::from_str(&raw)
                    .unwrap_or_else(|e| panic!("{} is not a valid manifest: {e}", path.display()));
                let name = format!(
                    "{root}/{}",
                    dir.file_name()
                        .expect("package dir has a name")
                        .to_string_lossy()
                );
                for rel in manifest.code_file_refs() {
                    refs.push((manifest.id.clone(), name.clone(), rel));
                }
            }
        }
        refs
    }

    /// [`builtin_code::BUILTIN_CODE_FILES`] and the `code_file` references in the
    /// package manifests must be a BIJECTION.
    ///
    /// A missing row is the failure that matters: a built-in plugin's package
    /// directory does not exist on the user's machine, so a `code_file` with no
    /// embedded row cannot be resolved and the plugin fails to load. An orphan row is
    /// the milder half — dead embedded code, and the signal that a hook was renamed
    /// or deleted without cleaning up.
    ///
    /// This is the check that keeps the table from becoming what the old
    /// `fixtures/<x>.manifest.json` copies were: a second list nobody remembers to
    /// edit. Both directions, so neither kind of drift can ship.
    #[test]
    fn builtin_code_table_matches_package_manifests() {
        let refs = packaged_code_file_refs();
        if refs.is_empty() {
            // OSS mirror, or genuinely no manifest uses `code_file`. Either way the
            // table must then be empty too, or it embeds code nothing references.
            assert!(
                builtin_code::BUILTIN_CODE_FILES.is_empty()
                    || !std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                        .join("../../plugins-store")
                        .is_dir(),
                "no package manifest references a code_file, but BUILTIN_CODE_FILES has {} \
                 row(s) — they embed code nothing can reach",
                builtin_code::BUILTIN_CODE_FILES.len()
            );
            return;
        }

        let declared: HashSet<(&str, &str)> = builtin_code::BUILTIN_CODE_FILES
            .iter()
            .map(|(id, rel, _)| (*id, *rel))
            .collect();

        for (id, dir, rel) in &refs {
            assert!(
                declared.contains(&(id.as_str(), rel.as_str())),
                "{dir}/manifest.json references '{rel}' but plugin_manifest::builtin_code has no \
                 row for ('{id}', '{rel}'). A built-in ships only its manifest — its package \
                 directory is NOT on the user's machine — so without an include_str! row this \
                 code does not exist at runtime. Add:\n    (\n        \"{id}\",\n        \
                 \"{rel}\",\n        include_str!(\"../../../../{dir}/{rel}\"),\n    ),"
            );
        }

        let referenced: HashSet<(&str, &str)> = refs
            .iter()
            .map(|(id, _, rel)| (id.as_str(), rel.as_str()))
            .collect();
        for (id, rel, _) in builtin_code::BUILTIN_CODE_FILES {
            assert!(
                referenced.contains(&(*id, *rel)),
                "plugin_manifest::builtin_code embeds ('{id}', '{rel}'), which no package \
                 manifest references any more. Remove the row (and the file, if it is dead)."
            );
        }
    }

    /// Walk `plugins-store` and `apps-store`, returning `(plugin id, package dir,
    /// pi extension file)` for every `contributes.pi_extensions[].file` a package
    /// manifest references. Same runtime-read, empty-in-the-OSS-mirror posture as
    /// [`packaged_code_file_refs`].
    fn packaged_pi_extension_refs() -> Vec<(String, String, String)> {
        let repo_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..");
        let mut refs = Vec::new();
        for root in ["apps-store", "plugins-store"] {
            let Ok(entries) = std::fs::read_dir(repo_root.join(root)) else {
                continue; // OSS mirror: this root is not shipped.
            };
            let mut dirs: Vec<PathBuf> = entries
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.join("manifest.json").is_file())
                .collect();
            dirs.sort();
            for dir in dirs {
                let path = dir.join("manifest.json");
                let raw = std::fs::read_to_string(&path)
                    .unwrap_or_else(|e| panic!("{} unreadable: {e}", path.display()));
                let manifest: PluginManifest = serde_json::from_str(&raw)
                    .unwrap_or_else(|e| panic!("{} is not a valid manifest: {e}", path.display()));
                let name = dir
                    .file_name()
                    .expect("package dir has a name")
                    .to_string_lossy()
                    .into_owned();
                for rel in manifest.pi_extension_refs() {
                    refs.push((manifest.id.clone(), name.clone(), rel));
                }
            }
        }
        refs
    }

    /// [`builtin_code::BUILTIN_PI_EXTENSIONS`] and the `contributes.pi_extensions`
    /// references in the package manifests must be a BIJECTION.
    ///
    /// The unsandboxed-carriage twin of
    /// [`builtin_code_table_matches_package_manifests`], and it exists for the same
    /// reason: a built-in plugin's package directory is not on the user's machine,
    /// so a declared extension with no embedded row resolves to nothing and the
    /// capability is silently absent — the feature looks landed and is not there.
    /// An orphan row is the milder half (dead embedded code, and the signal that an
    /// extension was renamed or deleted without cleaning up).
    #[test]
    fn builtin_pi_extension_table_matches_package_manifests() {
        let refs = packaged_pi_extension_refs();
        if refs.is_empty() {
            assert!(
                builtin_code::BUILTIN_PI_EXTENSIONS.is_empty()
                    || !std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                        .join("../../plugins-store")
                        .is_dir(),
                "no package manifest declares a pi extension, but BUILTIN_PI_EXTENSIONS has \
                 {} row(s) — they embed code nothing can reach",
                builtin_code::BUILTIN_PI_EXTENSIONS.len()
            );
            return;
        }

        let declared: HashSet<(&str, &str)> = builtin_code::BUILTIN_PI_EXTENSIONS
            .iter()
            .map(|(id, rel, _)| (*id, *rel))
            .collect();

        for (id, dir, rel) in &refs {
            assert!(
                declared.contains(&(id.as_str(), rel.as_str())),
                "{dir}/manifest.json declares pi extension '{rel}' but \
                 plugin_manifest::builtin_code has no row for ('{id}', '{rel}'). A built-in \
                 ships only its manifest — its package directory is NOT on the user's machine \
                 — so without an include_str! row the extension does not exist at runtime. \
                 Add:\n    (\n        \"{id}\",\n        \"{rel}\",\n        \
                 include_str!(\"../../../../plugins-store/{dir}/{rel}\"),\n    ),"
            );
        }

        let referenced: HashSet<(&str, &str)> = refs
            .iter()
            .map(|(id, _, rel)| (id.as_str(), rel.as_str()))
            .collect();
        for (id, rel, _) in builtin_code::BUILTIN_PI_EXTENSIONS {
            assert!(
                referenced.contains(&(*id, *rel)),
                "plugin_manifest::builtin_code embeds pi extension ('{id}', '{rel}'), which no \
                 package manifest declares any more. Remove the row (and the file, if it is dead)."
            );
        }
    }

    /// Walk `plugins-store` and `apps-store`, returning `(plugin id, package dir,
    /// output style file)` for every `contributes.output_styles[].file` a package
    /// manifest references. Same runtime-read, empty-in-the-OSS-mirror posture as
    /// [`packaged_code_file_refs`].
    fn packaged_output_style_refs() -> Vec<(String, String, String)> {
        let repo_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..");
        let mut refs = Vec::new();
        for root in ["apps-store", "plugins-store"] {
            let Ok(entries) = std::fs::read_dir(repo_root.join(root)) else {
                continue; // OSS mirror: this root is not shipped.
            };
            let mut dirs: Vec<PathBuf> = entries
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.join("manifest.json").is_file())
                .collect();
            dirs.sort();
            for dir in dirs {
                let path = dir.join("manifest.json");
                let raw = std::fs::read_to_string(&path)
                    .unwrap_or_else(|e| panic!("{} unreadable: {e}", path.display()));
                let manifest: PluginManifest = serde_json::from_str(&raw)
                    .unwrap_or_else(|e| panic!("{} is not a valid manifest: {e}", path.display()));
                let name = dir
                    .file_name()
                    .expect("package dir has a name")
                    .to_string_lossy()
                    .into_owned();
                for rel in manifest.output_style_refs() {
                    refs.push((manifest.id.clone(), name.clone(), rel));
                }
            }
        }
        refs
    }

    /// [`builtin_code::BUILTIN_OUTPUT_STYLES`] and the `contributes.output_styles`
    /// references in the package manifests must be a BIJECTION.
    ///
    /// The inert-prose twin of [`builtin_code_table_matches_package_manifests`], and
    /// it exists for the same reason both siblings do: a built-in plugin's package
    /// directory is not on the user's machine, so a declared style with no embedded
    /// row cannot be resolved. That one at least fails loudly — hydration treats a
    /// missing row as a hard error rather than an empty body, precisely because an
    /// empty style is indistinguishable at every read site from the user having
    /// picked none — but the failure takes the WHOLE manifest down at load, so the
    /// plugin's other contributions vanish with it. An orphan row is the milder half
    /// (dead embedded prose, and the signal that a style was renamed or deleted
    /// without cleaning up).
    #[test]
    fn builtin_output_style_table_matches_package_manifests() {
        let refs = packaged_output_style_refs();
        if refs.is_empty() {
            assert!(
                builtin_code::BUILTIN_OUTPUT_STYLES.is_empty()
                    || !std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                        .join("../../plugins-store")
                        .is_dir(),
                "no package manifest contributes an output style, but BUILTIN_OUTPUT_STYLES has \
                 {} row(s) — they embed prose nothing can reach",
                builtin_code::BUILTIN_OUTPUT_STYLES.len()
            );
            return;
        }

        let declared: HashSet<(&str, &str)> = builtin_code::BUILTIN_OUTPUT_STYLES
            .iter()
            .map(|(id, rel, _)| (*id, *rel))
            .collect();

        for (id, dir, rel) in &refs {
            assert!(
                declared.contains(&(id.as_str(), rel.as_str())),
                "{dir}/manifest.json contributes output style file '{rel}' but \
                 plugin_manifest::builtin_code has no row for ('{id}', '{rel}'). A built-in ships \
                 only its manifest — its package directory is NOT on the user's machine — so \
                 without an include_str! row the style cannot be hydrated and the whole manifest \
                 fails to load. Add:\n    (\n        \"{id}\",\n        \"{rel}\",\n        \
                 include_str!(\"../../../../plugins-store/{dir}/{rel}\"),\n    ),"
            );
        }

        let referenced: HashSet<(&str, &str)> = refs
            .iter()
            .map(|(id, _, rel)| (id.as_str(), rel.as_str()))
            .collect();
        for (id, rel, _) in builtin_code::BUILTIN_OUTPUT_STYLES {
            assert!(
                referenced.contains(&(*id, *rel)),
                "plugin_manifest::builtin_code embeds output style ('{id}', '{rel}'), which no \
                 package manifest contributes any more. Remove the row (and the file, if it is \
                 dead)."
            );
        }
    }

    /// No package manifest may carry an output style's body INLINE.
    ///
    /// The prose half of [`packaged_plugin_manifests_declare_no_inline_sandbox_code`],
    /// and separate from it because the argument is different. Inline sandboxed JS is
    /// banned because a `\n`-escaped blob is unauditable and that is where malicious
    /// code hides; a style body is inert, so the reason here is authorship: the file
    /// form is the SAME format a user's own `<claude-dir>/output-styles/*.md` uses, so
    /// a style moves between a plugin package and a user root by plain copy. Inlined,
    /// it stops being diffable, stops being copyable, and the frontmatter — which is
    /// the single source of truth for the style's `name`, `description` and
    /// `keep-coding-instructions` — becomes a JSON string nobody reads.
    ///
    /// Checked against the raw JSON, not a parsed [`PluginManifest`]: hydration moves
    /// the body INTO `source` and clears `file`, so a typed parse would inspect the
    /// wire form and pass unconditionally. This is about the on-disk form.
    #[test]
    fn packaged_plugin_manifests_declare_no_inline_output_style_source() {
        let repo_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..");
        let mut checked = 0;
        let mut offenders: Vec<String> = Vec::new();

        for root in ["apps-store", "plugins-store"] {
            let Ok(entries) = std::fs::read_dir(repo_root.join(root)) else {
                continue; // OSS mirror: this root is not shipped.
            };
            let mut dirs: Vec<PathBuf> = entries
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.join("manifest.json").is_file())
                .collect();
            dirs.sort();
            for dir in dirs {
                let path = dir.join("manifest.json");
                let raw = std::fs::read_to_string(&path)
                    .unwrap_or_else(|e| panic!("{} unreadable: {e}", path.display()));
                let json: serde_json::Value = serde_json::from_str(&raw)
                    .unwrap_or_else(|e| panic!("{} is not valid JSON: {e}", path.display()));
                let name = dir
                    .file_name()
                    .expect("dir name")
                    .to_string_lossy()
                    .into_owned();

                let styles = json
                    .get("contributes")
                    .and_then(|c| c.get("output_styles"))
                    .and_then(serde_json::Value::as_array)
                    .map(Vec::as_slice)
                    .unwrap_or_default();
                for style in styles {
                    if style.get("source").is_some() {
                        let id = style
                            .get("id")
                            .and_then(serde_json::Value::as_str)
                            .unwrap_or("?");
                        offenders.push(format!("{root}/{name}: output style '{id}'"));
                    }
                }
                checked += 1;
            }
        }

        assert!(
            offenders.is_empty(),
            "these package manifests inline an output style body instead of pointing at a file \
             with `file`:\n  {}\nMove each body to {OUTPUT_STYLE_DIR}/<name>.md, replace `source` \
             with `file`, and add an include_str! row to \
             plugin_manifest::builtin_code::BUILTIN_OUTPUT_STYLES.",
            offenders.join("\n  ")
        );

        if repo_root.join("apps-store").is_dir() || repo_root.join("plugins-store").is_dir() {
            assert!(
                checked > 0,
                "a package root is present but nothing was checked"
            );
        }
    }

    /// Every `.md` sitting in a package's `output-styles/` folder must be DECLARED
    /// by that package's own manifest.
    ///
    /// The reference-keyed bijection above cannot see a file nobody references, so
    /// this is the same guard [`packaged_pi_extension_files_are_all_declared`] gives
    /// the extension road: an undeclared `output-styles/foo.md` is committed,
    /// reviewed, mirrored into the published tree — and never reaches a prompt.
    #[test]
    fn packaged_output_style_files_are_all_declared() {
        let repo_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..");
        let declared: HashSet<(String, String)> = packaged_output_style_refs()
            .into_iter()
            .map(|(_, dir, rel)| (dir, rel))
            .collect();

        for root in ["apps-store", "plugins-store"] {
            let Ok(entries) = std::fs::read_dir(repo_root.join(root)) else {
                continue; // OSS mirror: this root is not shipped.
            };
            for entry in entries.filter_map(Result::ok) {
                let pkg = entry.path();
                let Ok(files) = std::fs::read_dir(pkg.join(OUTPUT_STYLE_DIR)) else {
                    continue;
                };
                let dir_name = pkg
                    .file_name()
                    .expect("package dir has a name")
                    .to_string_lossy()
                    .into_owned();
                for file in files.filter_map(Result::ok) {
                    let name = file.file_name().to_string_lossy().into_owned();
                    if !name.ends_with(".md") {
                        continue;
                    }
                    let rel = format!("{OUTPUT_STYLE_DIR}/{name}");
                    assert!(
                        declared.contains(&(dir_name.clone(), rel.clone())),
                        "{root}/{dir_name}/{rel} exists but {dir_name}/manifest.json declares no \
                         contributes.output_styles entry for it — it would never reach a prompt"
                    );
                }
            }
        }
    }

    /// Every `.ts` sitting in a package's `pi-extensions/` folder must be DECLARED
    /// by that package's own manifest.
    ///
    /// The bijection above is keyed on references, so it cannot see a file nobody
    /// references — and an undeclared `pi-extensions/foo.ts` is exactly the silent
    /// failure `every_pi_extension_asset_is_shipped` guards against on the
    /// compiled-in road: the file is committed, reviewed, and never reaches an
    /// agent. This is that guard, ported to the plugin road.
    #[test]
    fn packaged_pi_extension_files_are_all_declared() {
        let repo_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..");
        let declared: HashSet<(String, String)> = packaged_pi_extension_refs()
            .into_iter()
            .map(|(_, dir, rel)| (dir, rel))
            .collect();

        for root in ["apps-store", "plugins-store"] {
            let Ok(entries) = std::fs::read_dir(repo_root.join(root)) else {
                continue; // OSS mirror: this root is not shipped.
            };
            for entry in entries.filter_map(Result::ok) {
                let pkg = entry.path();
                let Ok(files) = std::fs::read_dir(pkg.join(PI_EXTENSION_DIR)) else {
                    continue;
                };
                let dir_name = pkg
                    .file_name()
                    .expect("package dir has a name")
                    .to_string_lossy()
                    .into_owned();
                for file in files.filter_map(Result::ok) {
                    let name = file.file_name().to_string_lossy().into_owned();
                    if !name.ends_with(".ts") {
                        continue;
                    }
                    let rel = format!("{PI_EXTENSION_DIR}/{name}");
                    assert!(
                        declared.contains(&(dir_name.clone(), rel.clone())),
                        "{root}/{dir_name}/{rel} exists but {dir_name}/manifest.json declares \
                         no contributes.pi_extensions entry for it — it would never reach the \
                         managed Pi agent"
                    );
                }
            }
        }
    }

    /// No package manifest may carry sandboxed JS INLINE.
    ///
    /// A hook or capability adapter body belongs in `hooks/<name>.js` /
    /// `adapters/<verb>.js`, referenced by `code_file`. A multi-kilobyte JS program
    /// escaped into a one-line JSON string is unreadable, undiffable, unlintable and
    /// — the reason this guard exists rather than a style note — effectively
    /// unauditable: nobody reviews a 5 KB `\n`-escaped blob for what it actually
    /// does, which is precisely where malicious code hides.
    ///
    /// Without this check the extraction decays one convenient inline hook at a time.
    /// Note `code`/`code_file` are mutually exclusive at the contract layer
    /// ([`PluginManifest::hydrate_code_files`]), so this is about WHICH form the
    /// checked-in source uses, not about a manifest being invalid.
    #[test]
    fn packaged_plugin_manifests_declare_no_inline_sandbox_code() {
        let repo_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..");
        let mut checked = 0;
        let mut offenders: Vec<String> = Vec::new();

        for root in ["apps-store", "plugins-store"] {
            let Ok(entries) = std::fs::read_dir(repo_root.join(root)) else {
                continue; // OSS mirror: this root is not shipped.
            };
            let mut dirs: Vec<PathBuf> = entries
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.join("manifest.json").is_file())
                .collect();
            dirs.sort();
            for dir in dirs {
                let path = dir.join("manifest.json");
                let raw = std::fs::read_to_string(&path)
                    .unwrap_or_else(|e| panic!("{} unreadable: {e}", path.display()));
                // Deserialise into the RAW json, not `PluginManifest`: hydration
                // clears `code_file`, and this check is about the on-disk form.
                let json: serde_json::Value = serde_json::from_str(&raw)
                    .unwrap_or_else(|e| panic!("{} is not valid JSON: {e}", path.display()));
                let name = dir
                    .file_name()
                    .expect("dir name")
                    .to_string_lossy()
                    .into_owned();

                let hooks = json
                    .get("contributes")
                    .and_then(|c| c.get("turn_hooks"))
                    .and_then(serde_json::Value::as_array)
                    .map(Vec::as_slice)
                    .unwrap_or_default();
                for hook in hooks {
                    if hook.get("code").is_some() {
                        let id = hook
                            .get("id")
                            .and_then(serde_json::Value::as_str)
                            .unwrap_or("?");
                        offenders.push(format!("{root}/{name}: turn hook '{id}'"));
                    }
                }

                let provides = json
                    .get("provides")
                    .and_then(serde_json::Value::as_array)
                    .map(Vec::as_slice)
                    .unwrap_or_default();
                for entry in provides {
                    let tools = entry.get("tools").and_then(serde_json::Value::as_object);
                    for (verb, binding) in tools.into_iter().flatten() {
                        if binding.get("adapter").and_then(|a| a.get("code")).is_some() {
                            offenders.push(format!("{root}/{name}: adapter '{verb}'"));
                        }
                    }
                }
                checked += 1;
            }
        }

        assert!(
            offenders.is_empty(),
            "these package manifests inline sandboxed JS instead of pointing at a file with \
             `code_file`:\n  {}\nMove each body to hooks/<name>.js or adapters/<verb>.js, replace \
             `code` with `code_file`, and add an include_str! row to \
             plugin_manifest::builtin_code.",
            offenders.join("\n  ")
        );

        if repo_root.join("apps-store").is_dir() || repo_root.join("plugins-store").is_dir() {
            assert!(
                checked > 0,
                "a package root is present but nothing was checked"
            );
        }
    }

    /// Each companion app's UI is embedded at compile time via `include_str!`
    /// (the `*_UI_HTML` consts) and seeded as the plugin's `ui_code`. A truncated
    /// or emptied fixture would still compile but ship a broken companion, so this
    /// asserts every bundle is present and non-trivially sized. It is deliberately
    /// **size-only, not byte-identity**: the bundles are `vite`/`esbuild` output,
    /// which is not guaranteed byte-stable across build hosts, so a byte-identity
    /// check on a built asset (whiteboard is ~7.7 MB) would be flaky. The refresh
    /// path is `scripts/sync-app-fixtures.sh`; the `*.manifest.json` manifests (hand
    /// authored) keep their byte-identity guard in
    /// `packaged_manifests_match_their_core_fixtures_and_are_registered`.
    ///
    /// The loop is driven off `plugins::seed::companion_ui_specs()` — the ONE table
    /// that carries these consts — not off a list copied into this test. The copy is
    /// what this fix removed: it listed 14 of the 15 bundles, so `skill-editor`'s was
    /// unguarded, and a truncated skill-editor fixture would have shipped green.
    #[test]
    fn companion_ui_fixtures_exist_and_are_nontrivial() {
        // A real inlined single-file app bundle is always far larger than this;
        // the floor only catches an emptied/truncated fixture.
        const MIN_BYTES: usize = 10_000;

        let specs = crate::plugins::seed::companion_ui_specs();
        assert!(
            specs.len() >= 15,
            "the seed table carries {} companion bundles — a drop means a companion \
             silently stopped being seeded, not that this guard should shrink",
            specs.len()
        );

        for spec in specs {
            let name = spec.id;
            let html = spec
                .ui_code
                .expect("companion_ui_specs filters on ui_code.is_some()");
            assert!(
                html.len() >= MIN_BYTES,
                "the bundle seeded for '{name}' is only {} bytes (< {MIN_BYTES}) — likely \
                 truncated or empty; rebuild with scripts/sync-app-fixtures.sh",
                html.len()
            );
            assert!(
                html.contains('<'),
                "the bundle seeded for '{name}' does not look like HTML"
            );
        }
    }

    #[test]
    fn sample_fixture_deserializes_into_app_manifest() {
        let manifest: PluginManifest =
            serde_json::from_str(SAMPLE_JSON).expect("sample.ryu.json should deserialise");

        assert_eq!(manifest.id, "@example/research-assistant");
        assert_eq!(manifest.name, "Research Assistant");
        assert_eq!(manifest.version, "1.0.0");
        assert_eq!(
            manifest.permission_grants,
            vec!["mcp:web_search", "mcp:file_read"]
        );
        assert!(manifest.companion.is_some());
    }

    #[test]
    fn runnables_helper_returns_all_bundled_runnables() {
        let manifest: PluginManifest =
            serde_json::from_str(SAMPLE_JSON).expect("sample.ryu.json should deserialise");

        let runnables = manifest.runnables();
        assert_eq!(runnables.len(), 4);

        let kinds: Vec<RunnableKind> = runnables.iter().map(|r| r.kind).collect();
        assert!(kinds.contains(&RunnableKind::Agent));
        assert!(kinds.contains(&RunnableKind::Workflow));
        assert!(kinds.contains(&RunnableKind::Tool));
        assert!(kinds.contains(&RunnableKind::Skill));
    }

    #[test]
    fn runnables_of_kind_filters_correctly() {
        let manifest: PluginManifest =
            serde_json::from_str(SAMPLE_JSON).expect("sample.ryu.json should deserialise");

        let agents = manifest.runnables_of_kind(RunnableKind::Agent);
        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0].id, "agent-researcher");

        let workflows = manifest.runnables_of_kind(RunnableKind::Workflow);
        assert_eq!(workflows.len(), 1);
        assert_eq!(workflows[0].id, "wf-summarise");
    }

    #[test]
    fn manifest_without_companion_deserializes() {
        let json = r#"{
            "id": "com.example.minimal",
            "name": "Minimal App",
            "version": "0.1.0",
            "runnables": [
                { "id": "agent-x", "name": "Agent X", "kind": "agent" }
            ]
        }"#;
        let manifest: PluginManifest =
            serde_json::from_str(json).expect("minimal manifest should deserialise");
        assert!(manifest.companion.is_none());
        assert!(manifest.permission_grants.is_empty());
        assert_eq!(manifest.runnables().len(), 1);
    }

    #[test]
    fn manifest_roundtrips_through_json() {
        let manifest: PluginManifest =
            serde_json::from_str(SAMPLE_JSON).expect("sample.ryu.json should deserialise");
        let serialized = serde_json::to_string(&manifest).expect("serialise should succeed");
        let roundtripped: PluginManifest =
            serde_json::from_str(&serialized).expect("roundtrip deserialise should succeed");
        assert_eq!(manifest, roundtripped);
    }

    // ── PluginManifestLoader tests ───────────────────────────────────────────────

    /// Flattens the typed rejection to its rendered message so the existing
    /// `err.contains("…")` assertions keep reading the same way. Tests that need to
    /// distinguish `Invalid` from `Incompatible` call `parse_and_validate` directly.
    fn loader_parse(raw: &str) -> Result<PluginManifest, String> {
        PluginManifestLoader::parse_and_validate(raw, "<test>", None, &mut HashSet::new())
            .map_err(|e| e.to_string())
    }

    // ── companion label anti-impersonation ───────────────────────────────────

    #[test]
    fn loader_rejects_companion_label_impersonating_system_chrome() {
        let raw = r#"{
            "id": "com.example.evil",
            "name": "Evil",
            "version": "1.0.0",
            "runnables": [],
            "companion": { "label": "Ryu Settings" }
        }"#;
        let err = loader_parse(raw).unwrap_err();
        assert!(
            err.contains("impersonate system chrome"),
            "expected impersonation rejection, got: {err}"
        );
    }

    #[test]
    fn loader_accepts_benign_companion_label() {
        let raw = r#"{
            "id": "com.example.good",
            "name": "Good",
            "version": "1.0.0",
            "runnables": [],
            "companion": { "label": "Research Assistant" }
        }"#;
        assert!(loader_parse(raw).is_ok());
    }

    // ── deletable data categories (Settings → Danger Zone) ───────────────────

    /// The danger zone's App-owned rows are built from the manifests, so if these
    /// declarations go missing the rows silently vanish from Settings rather than
    /// failing anywhere a test would otherwise notice.
    #[test]
    fn monitors_and_meetings_declare_their_danger_zone_categories() {
        for (raw, expected) in [
            (
                include_str!("../../../../apps-store/monitors/manifest.json"),
                "monitors",
            ),
            (
                include_str!("../../../../apps-store/meetings/manifest.json"),
                "meetings",
            ),
        ] {
            let manifest = loader_parse(raw).expect("packaged manifest must load");
            let declared = manifest
                .contributes
                .as_ref()
                .expect("manifest declares contributions")
                .data_categories
                .iter()
                .find(|c| c.id == expected)
                .unwrap_or_else(|| {
                    panic!("'{expected}' no longer declares its data category — the Danger Zone row for it is gone")
                });
            // Copy travels with the declaration; a row with no `detail` is a
            // confirm dialog that says nothing before an irreversible delete.
            assert!(!declared.title.trim().is_empty());
            assert!(!declared.detail.trim().is_empty());
        }
    }

    /// The loader is Core's validation chokepoint for the surface — every manifest
    /// reaches Core through `parse_and_validate`, so a category an app must not own
    /// is refused here and not just in the contract crate's unit tests.
    #[test]
    fn loader_rejects_an_app_claiming_a_kernel_data_category() {
        let raw = r#"{
            "id": "com.example.greedy",
            "name": "Greedy",
            "version": "1.0.0",
            "runnables": [],
            "contributes": {
                "data_categories": [{
                    "id": "chats",
                    "title": "Delete all chats",
                    "noun": "chats",
                    "detail": "Everything goes."
                }]
            }
        }"#;
        let err = loader_parse(raw).unwrap_err();
        assert!(
            err.contains("owned by the kernel"),
            "expected the kernel-id claim to be refused, got: {err}"
        );
    }

    #[test]
    fn loader_accepts_an_app_owned_data_category() {
        let raw = r#"{
            "id": "com.example.watcher",
            "name": "Watcher",
            "version": "1.0.0",
            "runnables": [],
            "contributes": {
                "data_categories": [{
                    "id": "watches",
                    "title": "Delete all watches",
                    "noun": "watches",
                    "confirm_word": "Watches",
                    "detail": "Every watch and its history will be permanently deleted."
                }]
            }
        }"#;
        let manifest = loader_parse(raw).expect("a well-formed app category must load");
        let declared = &manifest.contributes.unwrap().data_categories;
        assert_eq!(declared.len(), 1);
        assert_eq!(declared[0].confirm_word(), "Watches");
    }

    // ── app-declared tier quotas (`contributes.quotas`) ──────────────────────

    /// Plan tier limits used to be a closed key set hand-written into the billing
    /// catalog (`packages/auth/src/lib/plans.ts`), so shipping an app with a quota
    /// meant editing core auth code. The key now travels with the app that owns it,
    /// exactly like [`Contributes::data_categories`]: the manifest declares that the
    /// key exists and what its number MEANS (a count vs a retention window), while
    /// the per-tier numbers stay in the catalog — an app that could write its own
    /// tier row would simply grant itself unlimited everything.
    ///
    /// This asserts the raw JSON rather than a parsed field because the typed
    /// `Contributes::quotas` half lives in `ryu-kernel-contracts`, which this unit
    /// does not own; until it lands the loader drops the key (no
    /// `deny_unknown_fields` anywhere in that file). The guard is here anyway
    /// because the declaration is deletable today and nothing else would notice:
    /// `@ryu/monitors` losing its row silently un-caps monitors on every free node.
    #[test]
    fn packaged_apps_declare_the_tier_quotas_they_own() {
        for (raw, id, unit) in [
            (
                include_str!("../../../../apps-store/monitors/manifest.json"),
                "maxMonitors",
                "count",
            ),
            (
                include_str!("../../../../apps-store/meetings/manifest.json"),
                "meetingRetentionDays",
                "days",
            ),
        ] {
            let json: serde_json::Value =
                serde_json::from_str(raw).expect("packaged manifest must be valid JSON");
            let declared = json["contributes"]["quotas"]
                .as_array()
                .and_then(|quotas| quotas.iter().find(|q| q["id"] == id))
                .unwrap_or_else(|| {
                    panic!("'{id}' is no longer declared by its owning app — the tier limit is orphaned")
                });
            // The id is the wire key the client gates on (`guard("maxMonitors", n)`),
            // so it is spelled identically to the catalog's `PlanLimitField`.
            assert_eq!(declared["unit"], unit, "{id} declares the wrong unit");
            assert!(
                declared["label"]
                    .as_str()
                    .is_some_and(|l| !l.trim().is_empty()),
                "{id} needs a label — it is what the upgrade prompt says"
            );
        }
    }

    // ── app id validation (path-traversal hardening) ─────────────────────────

    #[test]
    fn validate_plugin_id_accepts_bare_kebab_and_legacy_dotted() {
        // Bare-kebab ids (the new built-in convention) must pass.
        assert!(validate_plugin_id("@ryu/ghost").is_ok());
        assert!(validate_plugin_id("data-grid-explorer").is_ok());
        assert!(validate_plugin_id("@ryu/rtk").is_ok());
        // Legacy dotted third-party ids must still pass (back-compat).
        assert!(validate_plugin_id("@example/research-assistant").is_ok());
        assert!(validate_plugin_id("io.ryu.ghost").is_ok());
        assert!(validate_plugin_id("com.example.my_app").is_ok());
    }

    #[test]
    fn validate_plugin_id_rejects_traversal_and_separators() {
        for bad in [
            "../../etc/cron.d/x",
            "..",
            "a/../b",
            "com/example/app",
            "com\\example\\app",
            "C:windows.x",
            "/etc/foo.bar",
            ".hidden.app",
            "app.",
            "-leading.dash",
            "",
        ] {
            assert!(
                validate_plugin_id(bad).is_err(),
                "expected '{bad}' to be rejected"
            );
        }
    }

    #[test]
    fn validate_plugin_id_rejects_overlong() {
        let long = format!("com.example.{}", "a".repeat(200));
        assert!(validate_plugin_id(&long).is_err());
    }

    #[test]
    fn loader_rejects_path_traversal_id() {
        let json = r#"{"id":"../../../../etc/x","name":"Evil","version":"1.0.0","runnables":[]}"#;
        let err = loader_parse(json).unwrap_err();
        assert!(err.contains("..") || err.contains("illegal"), "got: {err}");
    }

    #[test]
    fn loader_accepts_valid_semver() {
        let json = r#"{
            "id": "com.example.app",
            "name": "Test",
            "version": "2.3.1",
            "runnables": []
        }"#;
        let m = loader_parse(json).expect("valid semver should be accepted");
        assert_eq!(m.version, "2.3.1");
    }

    #[test]
    fn loader_rejects_invalid_semver() {
        let json = r#"{
            "id": "com.example.bad-ver",
            "name": "Bad Version",
            "version": "not-semver",
            "runnables": []
        }"#;
        let err = loader_parse(json).unwrap_err();
        assert!(
            err.contains("invalid semver version"),
            "unexpected error: {err}"
        );
    }

    /// The loader is a separate gate from `PluginManifest::validate` — it re-runs
    /// each rule individually rather than calling the superset — so the vocabulary
    /// gate has to be proven HERE, not just in the contract crate. Every built-in
    /// and every disk-installed manifest reaches Core through this function, and a
    /// level id becomes a grant string and an API path segment.
    #[test]
    fn loader_rejects_a_malformed_permission_vocabulary() {
        let dangling = r#"{
            "id": "com.example.levels",
            "name": "Levels",
            "version": "1.0.0",
            "runnables": [],
            "permission_levels": [
                { "id": "edit", "label": "Can edit", "description": "Edit.", "implies": ["read"] }
            ]
        }"#;
        let err = loader_parse(dangling).unwrap_err();
        assert!(err.contains("implies 'read'"), "unexpected error: {err}");

        let uppercase = r#"{
            "id": "com.example.levels",
            "name": "Levels",
            "version": "1.0.0",
            "runnables": [],
            "permission_levels": [
                { "id": "Read", "label": "Can view", "description": "View." }
            ]
        }"#;
        let err = loader_parse(uppercase).unwrap_err();
        assert!(err.contains("illegal characters"), "unexpected error: {err}");
    }

    /// The companion case: a well-formed vocabulary must survive the loader intact,
    /// or the gate above would be indistinguishable from "reject everything".
    #[test]
    fn loader_keeps_a_well_formed_permission_vocabulary() {
        let json = r#"{
            "id": "com.example.levels-ok",
            "name": "Levels",
            "version": "1.0.0",
            "runnables": [],
            "permission_levels": [
                { "id": "read", "label": "Can view", "description": "View." },
                { "id": "edit", "label": "Can edit", "description": "Edit.", "implies": ["read"] }
            ]
        }"#;
        let manifest = loader_parse(json).expect("a valid vocabulary must load");
        assert_eq!(manifest.permission_levels.len(), 2);
        assert_eq!(manifest.permission_levels[1].implies, ["read"]);
    }

    /// Same argument as `loader_rejects_a_malformed_permission_vocabulary`, for the
    /// routes that CONSUME the vocabulary: the ext-proxy gates on this annotation,
    /// so a route naming a level nobody declared must fail to load rather than 403
    /// on every request for a reason visible in no manifest.
    #[test]
    fn loader_rejects_a_route_requiring_an_undeclared_permission() {
        let sidecar = |extra: &str| {
            format!(
                r#"{{
                    "id": "com.example.gated",
                    "name": "Gated",
                    "version": "1.0.0",
                    "runnables": [],
                    "permission_levels": [
                        {{ "id": "tabs.close", "label": "Can close", "description": "Close." }}
                    ],
                    "sidecars": [{{
                        "name": "api",
                        "process": {{ "kind": "local", "command": "gated-api" }},
                        "port": 9111,
                        "http": {{ "routes": [{{ "path": "/tabs/:id/close"{extra} }}] }}
                    }}]
                }}"#
            )
        };

        let err = loader_parse(&sidecar(r#", "permission": "tabs.destroy""#)).unwrap_err();
        assert!(err.contains("'tabs.destroy'"), "unexpected error: {err}");

        // The declared one loads, so the gate above is not "reject every route".
        let manifest = loader_parse(&sidecar(
            r#", "permission": "tabs.close", "resource_param": "id""#,
        ))
        .expect("a declared level must load");
        let route = &manifest.sidecars[0].http.as_ref().expect("http").routes[0];
        assert_eq!(route.permission.as_deref(), Some("tabs.close"));
    }

    #[test]
    fn loader_rejects_duplicate_ids() {
        let json = r#"{"id":"com.example.dup","name":"A","version":"1.0.0","runnables":[]}"#;
        let mut seen = HashSet::new();
        PluginManifestLoader::parse_and_validate(json, "<t1>", None, &mut seen)
            .expect("first occurrence should succeed");
        let err = PluginManifestLoader::parse_and_validate(json, "<t2>", None, &mut seen)
            .unwrap_err()
            .to_string();
        assert!(err.contains("duplicate app id"), "unexpected error: {err}");
    }

    #[test]
    fn loader_builtins_returns_all_built_in_manifests() {
        // Every built-in manifest must always load — including the #447/#448
        // policy/engine fixtures (whose `engines.ryu` must be satisfiable, or they
        // would be dropped here). The count grows as fixtures are added; assert the
        // floor plus each id below.
        let manifests = PluginManifestLoader::load();
        assert!(
            manifests.len() >= 5,
            "loader must return at least the built-in manifests, got {}",
            manifests.len()
        );
        // The new Core-tier policy/engine plugins must load (their engines.ryu
        // requirement is satisfied by this Core version).
        for id in [
            "@ryu/firewall",
            "@ryu/routing",
            "@ryu/sandbox",
            "@ryu/engines",
            "@ryu/durable",
        ] {
            assert!(
                manifests.iter().any(|m| m.id == id),
                "built-in '{id}' must load (engines.ryu must be satisfiable)"
            );
        }
        // The Research Assistant demo is no longer a shipped built-in (it was a
        // first-run sample); it must NOT appear in the catalog.
        assert!(
            !manifests
                .iter()
                .any(|m| m.id == "@example/research-assistant"),
            "sample research assistant manifest must not be a built-in"
        );
        assert!(
            manifests.iter().any(|m| m.id == "@ryu/spider"),
            "built-in Spider manifest should be loaded"
        );
        assert!(
            manifests.iter().any(|m| m.id == "@ryu/exa"),
            "built-in Exa manifest should be loaded"
        );
        assert!(
            manifests.iter().any(|m| m.id == "@ryu/ghost"),
            "built-in Ghost manifest should be loaded"
        );
        assert!(
            manifests.iter().any(|m| m.id == "@ryu/shadow"),
            "built-in Shadow manifest should be loaded"
        );
        assert!(
            manifests.iter().any(|m| m.id == "@ryu/proof"),
            "built-in Proof of Work manifest should be loaded"
        );
        assert!(
            manifests.iter().any(|m| m.id == "@ryu/security-guidance"),
            "built-in Security Guidance manifest should be loaded"
        );
        // The Whiteboard app (the FIRST companion runnable in BUILTIN_MANIFESTS) must
        // load AND validate as a companion whose config carries `ui_entry` + the
        // Path B `ui_format:"html"` discriminator. `cargo check` compiles the
        // `include_str!` but never RUNS this loader, so without this a fixture that
        // fails `parse_and_validate` would be silently dropped → the default-on seed
        // finds no version → the whole feature is inert while every check stays green.
        let whiteboard = manifests
            .iter()
            .find(|m| m.id == WHITEBOARD_PLUGIN_ID)
            .expect("whiteboard app manifest must load and validate");
        let companion = whiteboard
            .runnables()
            .iter()
            .find(|r| r.kind == RunnableKind::Companion)
            .expect("whiteboard must expose a companion runnable");
        let cfg = companion
            .config
            .as_ref()
            .expect("whiteboard companion must carry a config");
        assert!(
            cfg.get("ui_entry").and_then(|v| v.as_str()).is_some(),
            "whiteboard companion config must set ui_entry (so has_ui is true)"
        );
        assert_eq!(
            cfg.get("ui_format").and_then(|v| v.as_str()),
            Some("html"),
            "whiteboard companion must declare ui_format:\"html\" (Path B)"
        );
    }

    #[test]
    fn sample_widget_fixture_loads_and_binds_its_widget() {
        // The reference third-party widget plugin must parse+register (a malformed
        // fixture is silently WARN-skipped by `load()`, staying green under
        // `cargo check`, so assert the loaded shape here). It carries no runnables:
        // its tool is owned by the declared MCP server, and the widget is wired by
        // `contributes.widgets` joined to the `widget:render` grant.
        let manifests = PluginManifestLoader::load();
        let m = manifests
            .iter()
            .find(|m| m.id == "@ryu/sample-widget")
            .expect("sample-widget fixture must load and validate");
        assert!(
            m.permission_grants.iter().any(|g| g == "widget:render"),
            "sample-widget must declare the widget:render grant"
        );
        assert!(
            m.mcp_servers.contains_key("sample_widget"),
            "sample-widget must declare the sample_widget MCP server"
        );
        let widgets = m
            .contributes
            .as_ref()
            .map(|c| c.widgets.as_slice())
            .unwrap_or_default();
        let widget = widgets
            .iter()
            .find(|w| w.tool_id == "sample_widget__render")
            .expect("sample-widget must contribute the sample_widget__render widget");
        // tool_id MUST be `<mcp_servers-key>__<toolName>` and the uri must match the
        // resource the server serves (and the tool _meta.outputTemplate).
        assert_eq!(widget.uri, "ui://widget/sample.html");
        assert_eq!(widget.mime, "text/html+skybridge");
    }

    #[test]
    fn security_guidance_fixture_has_gated_turn_hook() {
        // The ported security-guidance plugin must contribute a flag-gated
        // `post_assistant_turn` hook with the side-model grant, so it is free on
        // the hot path (skipped unless the toggle/command is set) and can review.
        let manifests = PluginManifestLoader::load();
        let m = manifests
            .iter()
            .find(|m| m.id == "@ryu/security-guidance")
            .expect("security-guidance must load");
        assert!(
            m.permission_grants.iter().any(|g| g == "hook:side-model"),
            "must declare the side-model grant"
        );
        let hooks = &m.contributes.as_ref().expect("contributes").turn_hooks;
        assert_eq!(hooks.len(), 1, "one turn hook");
        assert_eq!(hooks[0].on, "post_assistant_turn");
        let gate = hooks[0].run_when.as_ref().expect("a match gate");
        assert_eq!(gate.flag.as_deref(), Some("io.ryu.security-guidance"));
        assert!(gate.commands.iter().any(|c| c == "/security"));
    }

    // ── Per-kind validation via loader ────────────────────────────────────────

    #[test]
    fn loader_rejects_unknown_kind() {
        // An unknown `kind` string must be rejected with a descriptive error (serde
        // will produce a parse error since `RunnableKind` is exhaustive).
        let json = r#"{
            "id": "com.example.bad-kind",
            "name": "Bad Kind",
            "version": "1.0.0",
            "runnables": [
                { "id": "r1", "name": "R1", "kind": "not_a_real_kind" }
            ]
        }"#;
        let err = loader_parse(json).unwrap_err();
        assert!(
            err.contains("JSON parse error"),
            "expected parse error, got: {err}"
        );
    }

    #[test]
    fn loader_rejects_runnable_missing_required_config() {
        // A `tool` Runnable without `config` must be rejected with a descriptive error.
        let json = r#"{
            "id": "com.example.bad-tool",
            "name": "Bad Tool",
            "version": "1.0.0",
            "runnables": [
                { "id": "tool-x", "name": "Tool X", "kind": "tool" }
            ]
        }"#;
        let err = loader_parse(json).unwrap_err();
        assert!(
            err.contains("kind=tool") || err.contains("missing required"),
            "expected per-kind validation error, got: {err}"
        );
    }

    #[test]
    fn loader_rejects_policy_missing_required_config() {
        let json = r#"{
            "id": "com.example.bad-policy",
            "name": "Bad Policy",
            "version": "1.0.0",
            "runnables": [
                { "id": "policy-x", "name": "Policy X", "kind": "policy" }
            ]
        }"#;
        let err = loader_parse(json).unwrap_err();
        assert!(
            err.contains("kind=policy") || err.contains("missing required"),
            "expected per-kind validation error, got: {err}"
        );
    }

    // ── Multi-kind fixture round-trip (acceptance criteria for #167) ──────────

    #[test]
    fn multi_kind_fixture_deserializes_all_eight_kinds() {
        let manifest: PluginManifest =
            serde_json::from_str(MULTI_KIND_JSON).expect("multi_kind.ryu.json should deserialise");

        assert_eq!(manifest.id, "com.example.multi-kind");
        assert_eq!(manifest.runnables().len(), 8);

        let kinds: Vec<RunnableKind> = manifest.runnables().iter().map(|r| r.kind).collect();
        assert!(kinds.contains(&RunnableKind::Agent), "missing agent");
        assert!(kinds.contains(&RunnableKind::Workflow), "missing workflow");
        assert!(kinds.contains(&RunnableKind::Tool), "missing tool");
        assert!(kinds.contains(&RunnableKind::Skill), "missing skill");
        assert!(
            kinds.contains(&RunnableKind::Companion),
            "missing companion"
        );
        assert!(kinds.contains(&RunnableKind::Channel), "missing channel");
        assert!(kinds.contains(&RunnableKind::Engine), "missing engine");
        assert!(kinds.contains(&RunnableKind::Policy), "missing policy");
    }

    #[test]
    fn multi_kind_fixture_roundtrips_with_zero_data_loss() {
        let manifest: PluginManifest = serde_json::from_str(MULTI_KIND_JSON).expect("deserialise");
        let serialized = serde_json::to_string(&manifest).expect("serialise");
        let roundtripped: PluginManifest =
            serde_json::from_str(&serialized).expect("roundtrip deserialise");
        assert_eq!(
            manifest, roundtripped,
            "round-trip must produce identical data"
        );
    }

    #[test]
    fn multi_kind_fixture_all_runnables_pass_validation() {
        let manifest: PluginManifest = serde_json::from_str(MULTI_KIND_JSON).expect("deserialise");
        for entry in manifest.runnables() {
            validate_runnable(entry)
                .unwrap_or_else(|e| panic!("runnable '{}' failed validation: {e}", entry.id));
        }
    }

    // ── contributes / engines / activation_events (#443) ─────────────────────

    #[test]
    fn activation_events_default_empty_roundtrips() {
        let json = r#"{
            "id": "com.example.lazy",
            "name": "Lazy",
            "version": "1.0.0",
            "runnables": []
        }"#;
        let m = loader_parse(json).expect("manifest without activation_events should load");
        assert!(
            m.activation_events.is_empty(),
            "activation_events defaults to empty (eager)"
        );
        assert!(m.contributes.is_none());
        assert!(m.engines.is_none());

        // Round-trip preserves the empty default.
        let serialized = serde_json::to_string(&m).expect("serialise");
        let back: PluginManifest = serde_json::from_str(&serialized).expect("deserialise");
        assert_eq!(m, back);
    }

    #[test]
    fn activation_events_parse_and_roundtrip() {
        let json = r#"{
            "id": "com.example.events",
            "name": "Events",
            "version": "1.0.0",
            "runnables": [],
            "activation_events": ["onStartup", "onCommand:do-thing"]
        }"#;
        let m = loader_parse(json).expect("manifest with activation_events should load");
        assert_eq!(m.activation_events, vec!["onStartup", "onCommand:do-thing"]);
    }

    #[test]
    fn engines_satisfied_loads() {
        // A requirement the running Core always satisfies (any version >= 0.0.1).
        let json = r#"{
            "id": "com.example.engok",
            "name": "Eng OK",
            "version": "1.0.0",
            "runnables": [],
            "engines": { "ryu": ">=0.0.1" }
        }"#;
        let m = loader_parse(json).expect("satisfied engines.ryu should load");
        assert_eq!(m.engines.as_ref().unwrap().ryu, ">=0.0.1");
    }

    /// An unsatisfiable floor used to be a hard reject, which made the plugin
    /// VANISH — no card, no explanation, no way to learn that updating would bring
    /// it back. It is now a typed `Incompatible`, which the catalog can render and
    /// the runtime still never sees.
    #[test]
    fn engines_unsatisfied_is_held_back_not_dropped() {
        // An impossibly-high requirement no real Core version satisfies.
        let json = r#"{
            "id": "com.example.engbad",
            "name": "Eng Bad",
            "version": "1.0.0",
            "runnables": [],
            "engines": { "ryu": ">=9999.0.0" }
        }"#;
        let err = PluginManifestLoader::parse_and_validate(
            json,
            "<test>",
            None,
            &mut HashSet::new(),
        )
        .unwrap_err();

        let ManifestRejection::Incompatible(inc) = err else {
            panic!("an unsatisfied floor must be Incompatible, not Invalid: {err}");
        };
        assert_eq!(inc.id(), "com.example.engbad");
        assert!(!inc.verdict().compatible);
        assert!(matches!(
            inc.verdict().unmet.as_slice(),
            [UnmetRequirement::TooOld {
                surface: Surface::Core,
                ..
            }]
        ));
        // The card still has everything it needs to render.
        assert_eq!(inc.for_catalog().name, "Eng Bad");
    }

    /// An UNPARSEABLE requirement stays a hard drop: there is nothing coherent to
    /// show a user, and a requirement nobody can evaluate must never be treated as
    /// satisfied.
    #[test]
    fn engines_invalid_requirement_is_still_dropped() {
        let json = r#"{
            "id": "com.example.engsyntax",
            "name": "Eng Syntax",
            "version": "1.0.0",
            "runnables": [],
            "engines": { "ryu": "not-a-req" }
        }"#;
        let err = PluginManifestLoader::parse_and_validate(
            json,
            "<test>",
            None,
            &mut HashSet::new(),
        )
        .unwrap_err();

        assert!(
            matches!(err, ManifestRejection::Invalid(_)),
            "an unparseable requirement must be Invalid, not Incompatible"
        );
        // Named by the key an author actually wrote (`ryu`), never `engines.core`.
        assert!(
            err.to_string().contains("invalid engines.ryu"),
            "expected invalid-requirement rejection, got: {err}"
        );
    }

    /// THE CONTAINMENT PROPERTY. An incompatible manifest must be visible to the
    /// catalog and invisible to the runtime — and the type system, not an audit of
    /// every consumer, is what guarantees the second half: `load()` returns
    /// `Vec<PluginManifest>` and the incompatible lane is a different type that
    /// only `load_all()` hands out.
    #[test]
    fn an_incompatible_manifest_never_reaches_the_runtime_manifest_list() {
        let json = r#"{
            "id": "com.example.contained",
            "name": "Contained",
            "version": "1.0.0",
            "runnables": [],
            "engines": { "ryu": ">=9999.0.0" },
            "contributes": {
                "turn_hooks": [
                    { "id": "h1", "on": "pre_user_turn", "code": "return ctx;" }
                ]
            }
        }"#;
        let mut seen = HashSet::new();
        let rejected =
            PluginManifestLoader::parse_and_validate(json, "<test>", None, &mut seen).unwrap_err();

        let ManifestRejection::Incompatible(inc) = rejected else {
            panic!("expected the incompatible lane");
        };

        // It DOES declare a turn hook...
        assert_eq!(
            inc.for_catalog()
                .contributes
                .as_ref()
                .map(|c| c.turn_hooks.len()),
            Some(1),
            "the fixture must actually contribute something, or this proves nothing"
        );

        // ...and it is NOT in the list every runtime consumer iterates. `load()`
        // cannot return it: its type has no incompatible lane at all.
        let runtime: Vec<PluginManifest> = PluginManifestLoader::load();
        assert!(
            !runtime.iter().any(|m| m.id == "com.example.contained"),
            "an incompatible plugin must never enter the runtime manifest list"
        );
    }

    #[test]
    fn contributes_referencing_existing_runnable_loads() {
        let json = r#"{
            "id": "com.example.contrib",
            "name": "Contrib",
            "version": "1.0.0",
            "runnables": [
                { "id": "tool-x", "name": "Tool X", "kind": "tool", "config": { "slug": "web_search" } }
            ],
            "contributes": { "tools": [ { "id": "tool-x", "title": "Search the web" } ] }
        }"#;
        let m = loader_parse(json).expect("contributes referencing a real runnable should load");
        let c = m.contributes.as_ref().unwrap();
        assert_eq!(c.tools.len(), 1);
        assert_eq!(c.tools[0].id, "tool-x");
        assert_eq!(c.tools[0].title.as_deref(), Some("Search the web"));
    }

    #[test]
    fn contributes_referencing_missing_runnable_is_rejected() {
        let json = r#"{
            "id": "com.example.contribbad",
            "name": "Contrib Bad",
            "version": "1.0.0",
            "runnables": [
                { "id": "tool-x", "name": "Tool X", "kind": "tool", "config": { "slug": "web_search" } }
            ],
            "contributes": { "commands": [ { "id": "does-not-exist" } ] }
        }"#;
        let err = loader_parse(json).unwrap_err();
        assert!(
            err.contains("unknown runnable id"),
            "expected unknown-id rejection, got: {err}"
        );
    }

    #[test]
    fn core_version_is_parseable() {
        // core_version() must always return a valid semver (never 0.0.0 in a real
        // build), so the engines gate has a meaningful version to match against.
        let v = core_version();
        assert!(v >= semver::Version::new(0, 0, 0));
    }

    #[test]
    fn loader_scans_user_dir() {
        // Point RYU_PLUGINS_DIR at a temp dir with a canonical `manifest.json`
        // plugin, a legacy `plugin.json` plugin, a legacy `ryu.json` plugin
        // (proving the triple-read fallback), a plugin carrying BOTH
        // `manifest.json` and `plugin.json` (proving first-match-wins
        // precedence), and one malformed plugin.
        let tmp = std::env::temp_dir().join(format!(
            "ryu-plugin-manifest-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .subsec_nanos()
        ));
        let canonical_dir = tmp.join("canonical-plugin");
        std::fs::create_dir_all(&canonical_dir).unwrap();
        std::fs::write(
            canonical_dir.join("manifest.json"),
            r#"{"id":"com.test.canonical-plugin","name":"Canonical Plugin","version":"0.1.0","runnables":[]}"#,
        )
        .unwrap();
        let plugin_dir = tmp.join("my-plugin");
        std::fs::create_dir_all(&plugin_dir).unwrap();
        std::fs::write(
            plugin_dir.join("plugin.json"),
            r#"{"id":"com.test.my-plugin","name":"My Plugin","version":"0.1.0","runnables":[]}"#,
        )
        .unwrap();
        // Carries BOTH names: `manifest.json` must win, so the `plugin.json` id
        // must NOT appear in the loaded set.
        let both_dir = tmp.join("both-plugin");
        std::fs::create_dir_all(&both_dir).unwrap();
        std::fs::write(
            both_dir.join("manifest.json"),
            r#"{"id":"com.test.both-new","name":"Both New","version":"0.1.0","runnables":[]}"#,
        )
        .unwrap();
        std::fs::write(
            both_dir.join("plugin.json"),
            r#"{"id":"com.test.both-old","name":"Both Old","version":"0.1.0","runnables":[]}"#,
        )
        .unwrap();
        let legacy_dir = tmp.join("legacy-plugin");
        std::fs::create_dir_all(&legacy_dir).unwrap();
        std::fs::write(
            legacy_dir.join("ryu.json"),
            r#"{"id":"com.test.legacy-plugin","name":"Legacy Plugin","version":"0.1.0","runnables":[]}"#,
        )
        .unwrap();
        let bad_dir = tmp.join("bad-plugin");
        std::fs::create_dir_all(&bad_dir).unwrap();
        std::fs::write(bad_dir.join("plugin.json"), b"not json").unwrap();
        // An Agent Plugins v1 package: `plugin.json` here is the SPEC manifest,
        // not our legacy alias, so it must be translated rather than rejected for
        // having no `id`/`runnables`. Its `mcp.json` server must survive the
        // translation as a declared `mcp_servers` entry (registration itself stays
        // gated on the Gateway-approved `mcp:server` grant).
        // The reverse collision: a native plugin that ALSO carries the exported
        // spec `plugin.json` (which every packaged app and plugin now does).
        // `manifest.json` must still win, and the spec sibling must not be read.
        let exported_dir = tmp.join("exported-plugin");
        std::fs::create_dir_all(&exported_dir).unwrap();
        std::fs::write(
            exported_dir.join("manifest.json"),
            r#"{"id":"com.test.exported","name":"Exported","version":"0.1.0","runnables":[]}"#,
        )
        .unwrap();
        std::fs::write(
            exported_dir.join("plugin.json"),
            format!(
                r#"{{"$schema":"{}","name":"exported"}}"#,
                agent_plugin::PLUGIN_SCHEMA_URL
            ),
        )
        .unwrap();
        let spec_dir = tmp.join("summarize");
        std::fs::create_dir_all(&spec_dir).unwrap();
        std::fs::write(
            spec_dir.join("plugin.json"),
            format!(
                r#"{{"$schema":"{}","name":"summarize","version":"2.1.0"}}"#,
                agent_plugin::PLUGIN_SCHEMA_URL
            ),
        )
        .unwrap();
        std::fs::write(
            spec_dir.join("mcp.json"),
            format!(
                r#"{{"$schema":"{}","mcpServers":{{"sum":{{"type":"stdio","command":"npx","args":["-y","summarize-mcp"]}}}}}}"#,
                agent_plugin::MCP_SCHEMA_URL
            ),
        )
        .unwrap();

        std::env::set_var("RYU_PLUGINS_DIR", &tmp);
        let manifests = PluginManifestLoader::load();
        std::env::remove_var("RYU_PLUGINS_DIR");

        assert!(
            manifests
                .iter()
                .any(|m| m.id == "com.test.canonical-plugin"),
            "canonical manifest.json plugin should be loaded"
        );
        assert!(
            manifests.iter().any(|m| m.id == "com.test.my-plugin"),
            "legacy plugin.json plugin should still be loaded"
        );
        assert!(
            manifests.iter().any(|m| m.id == "com.test.legacy-plugin"),
            "legacy ryu.json plugin should still be loaded"
        );
        // Precedence: `manifest.json` is first in MANIFEST_FILE_NAMES, so a dir
        // carrying both resolves to it deterministically.
        assert!(
            manifests.iter().any(|m| m.id == "com.test.both-new"),
            "manifest.json must win over plugin.json when both are present"
        );
        assert!(
            !manifests.iter().any(|m| m.id == "com.test.both-old"),
            "plugin.json must NOT be read when manifest.json is present"
        );

        assert!(
            manifests.iter().any(|m| m.id == "com.test.exported"),
            "manifest.json must win over an exported spec plugin.json sibling"
        );
        assert!(
            !manifests.iter().any(|m| m.id == "@agent-plugins/exported"),
            "the spec sibling must NOT be imported when a native manifest exists"
        );

        let imported = manifests
            .iter()
            .find(|m| m.id == "@agent-plugins/summarize")
            .expect("an Agent Plugins v1 package should load through translation");
        assert_eq!(imported.version, "2.1.0");
        assert_eq!(
            imported
                .mcp_servers
                .get("sum")
                .map(|s| s.command.as_str()),
            Some("npx"),
            "the spec mcp.json server should survive translation"
        );
        assert!(
            imported
                .permission_grants
                .iter()
                .any(|g| g == crate::sidecar::mcp::GRANT_MCP_SERVER),
            "an imported plugin must DECLARE the mcp grant (approval stays with the Gateway)"
        );

        // The legacy `RYU_APPS_DIR` must still be honoured when `RYU_PLUGINS_DIR`
        // is unset, so pre-rename setups are not orphaned. Reuse the same temp
        // dir (it holds a legacy `ryu.json` plugin) to keep env mutation in this
        // single test, avoiding cross-test env races under parallel runs.
        std::env::set_var("RYU_APPS_DIR", &tmp);
        let legacy_manifests = PluginManifestLoader::load();
        std::env::remove_var("RYU_APPS_DIR");

        std::fs::remove_dir_all(&tmp).ok();

        assert!(
            legacy_manifests
                .iter()
                .any(|m| m.id == "com.test.legacy-plugin"),
            "legacy RYU_APPS_DIR should still be honoured"
        );
    }

    // ── requires / targets ────────────────────────────────────────────────────

    /// Parse a manifest through the real validation funnel (the same one the
    /// loader uses for built-ins and disk manifests).
    fn parse(raw: &str) -> Result<PluginManifest, String> {
        let mut seen = HashSet::new();
        PluginManifestLoader::parse_and_validate(raw, "<test>", None, &mut seen)
            .map_err(|e| e.to_string())
    }

    const NO_DEPS: &str = r#"{
        "id": "legacy.plugin",
        "name": "Legacy Plugin",
        "version": "1.0.0",
        "runnables": []
    }"#;

    /// BACKWARD COMPAT — the single most important test here. A manifest with
    /// neither `requires` nor `targets` (i.e. all 37 shipped fixtures) must still
    /// parse, and must mean "no dependencies, runs on EVERY surface". An absent
    /// `targets` must never be read as "hidden", or every existing plugin vanishes.
    #[test]
    fn manifest_without_requires_or_targets_means_no_deps_all_surfaces() {
        let m = parse(NO_DEPS).expect("a manifest with no requires/targets must parse");

        assert!(m.requires.is_none());
        assert!(m.dependencies().is_empty(), "absent requires = no deps");

        assert!(m.targets.is_empty());
        for surface in [
            Surface::Gateway,
            Surface::Core,
            Surface::Desktop,
            Surface::Island,
            Surface::Mobile,
            Surface::Extension,
            Surface::Web,
            Surface::Cli,
        ] {
            assert!(
                m.supports_surface(surface),
                "empty targets must mean EVERY surface, not none ({surface:?})"
            );
        }
    }

    /// Every shipped built-in must still load with the new fields present on the
    /// struct — the concrete guarantee that these fields break no existing plugin.
    ///
    /// The guarantee is precisely about manifests that declare **nothing**: absent
    /// `requires` = no dependencies, absent/empty `targets` = every surface. It is
    /// NOT "no built-in may ever declare them" — a built-in that *does* (Meetings
    /// requires Spaces; anything with explicit `targets`) is the feature working as
    /// designed. So each assertion is scoped to the undeclared case, which is the
    /// one that must never change behaviour.
    /// EVERY compiled-in manifest must parse. `load_builtins` is a
    /// `filter_map(...ok())` and `load` only `warn!`s, so a manifest that fails
    /// validation does not fail loudly — the app simply CEASES TO EXIST at runtime,
    /// with its sidecars, MCP servers and contributions along with it. That silent
    /// mode is the reason this is asserted rather than trusted.
    ///
    /// The count check is the load-bearing half: iterating the survivors can never
    /// notice the one that did not survive.
    #[test]
    fn every_compiled_in_manifest_parses_and_none_is_silently_dropped() {
        let manifests = PluginManifestLoader::load_builtins();
        assert_eq!(
            manifests.len(),
            BUILTIN_MANIFESTS.len(),
            "{} of {} built-in manifests were dropped by parse/validate — run \
             `PluginManifestLoader::load()` with tracing on to see which",
            BUILTIN_MANIFESTS.len() - manifests.len(),
            BUILTIN_MANIFESTS.len()
        );

        // A declared MCP server whose `command` is blank clears no gate and spawns
        // nothing: `mcp_command_is_present` rejects empty, so the declaration is
        // dead weight that looks live in the manifest. Generic over all built-ins —
        // no app is named here.
        for m in &manifests {
            for (name, decl) in &m.mcp_servers {
                assert!(
                    !decl.command.trim().is_empty(),
                    "built-in '{}' declares MCP server '{name}' with a blank command",
                    m.id
                );
            }
        }
    }

    #[test]
    fn builtins_that_declare_nothing_keep_their_old_permissive_behaviour() {
        // `load_builtins`, not `load`: the latter also scans the developer's real
        // ~/.ryu/plugins, which would make this assertion depend on what they
        // happen to have installed.
        let manifests = PluginManifestLoader::load_builtins();
        assert!(!manifests.is_empty(), "built-ins must load");
        for m in &manifests {
            if m.requires.is_none() {
                assert!(
                    m.dependencies().is_empty(),
                    "built-in '{}' declares no `requires`, so it must have no dependencies",
                    m.id
                );
            }
            // Scoped on BOTH forms being absent. `surfaces` supersedes `targets`
            // and inverts its default, so a manifest that declares a `surfaces`
            // map has an empty `targets` list while being anything but permissive
            // — checking `targets` alone would demand every declared app surface
            // everywhere, which is the opposite of what declaring means.
            if m.surfaces.is_none() && m.targets.is_empty() {
                for surface in [
                    Surface::Gateway,
                    Surface::Core,
                    Surface::Desktop,
                    Surface::Island,
                    Surface::Mobile,
                    Surface::Extension,
                    Surface::Web,
                    Surface::Cli,
                ] {
                    assert!(
                        m.supports_surface(surface),
                        "built-in '{}' declares neither `surfaces` nor `targets`, so \
                         it must surface on EVERY host ({surface:?})",
                        m.id
                    );
                }
            }
        }
    }

    /// The sharp edge of the `surfaces` map: it INVERTS the `targets` default, so
    /// an absent key means *unsupported*. A map that forgets a surface — or marks
    /// every surface `none` — silently delists the app with no error anywhere.
    ///
    /// This is the guard for that. A built-in that declares a map must be reachable
    /// somewhere, and must be reachable on at least one surface a human can
    /// actually use (`core` alone is a headless node, not a place anyone browses).
    #[test]
    fn a_declared_surfaces_map_never_delists_a_builtin_everywhere() {
        let manifests = PluginManifestLoader::load_builtins();
        assert!(!manifests.is_empty(), "built-ins must load");

        // Surfaces a person actually interacts with. `gateway` and `core` are
        // headless hosts, so support there does not make an app reachable.
        const HUMAN_SURFACES: [Surface; 6] = [
            Surface::Desktop,
            Surface::Island,
            Surface::Mobile,
            Surface::Extension,
            Surface::Web,
            Surface::Cli,
        ];

        for m in &manifests {
            if m.surfaces.is_none() {
                continue;
            }
            assert!(
                HUMAN_SURFACES.iter().any(|s| m.supports_surface(*s)),
                "built-in '{}' declares a `surfaces` map that supports no \
                 human-facing surface — it would vanish from every client",
                m.id
            );
        }
    }

    #[test]
    fn requires_and_targets_round_trip() {
        let raw = r#"{
            "id": "meetings",
            "name": "Meetings",
            "version": "1.0.0",
            "runnables": [],
            "requires": {
                "apps": [
                    { "id": "spaces", "min_version": "1.2.0" },
                    { "id": "voice" }
                ],
                "grants": ["spaces:docs"]
            },
            "targets": ["desktop", "island"]
        }"#;
        let m = parse(raw).expect("requires/targets must parse");

        let deps = m.dependencies();
        assert_eq!(deps.len(), 2);
        assert_eq!(deps[0].id, "spaces");
        assert_eq!(deps[0].min_version.as_deref(), Some("1.2.0"));
        assert_eq!(deps[1].id, "voice");
        assert!(deps[1].min_version.is_none(), "min_version is optional");
        assert_eq!(
            m.requires.as_ref().unwrap().grants,
            vec!["spaces:docs".to_owned()]
        );

        assert_eq!(m.targets, vec![Surface::Desktop, Surface::Island]);

        // Serialising and re-parsing preserves both (the manifest is signed
        // verbatim, so the round-trip must be lossless).
        let json = serde_json::to_string(&m).unwrap();
        let back: PluginManifest = serde_json::from_str(&json).unwrap();
        assert_eq!(back, m);
    }

    /// The omitted fields must not appear in the serialised form — an existing
    /// manifest must re-serialise byte-identically, so its signature still verifies.
    #[test]
    fn absent_requires_and_targets_are_not_serialised() {
        let m = parse(NO_DEPS).unwrap();
        let json = serde_json::to_value(&m).unwrap();
        assert!(
            json.get("requires").is_none(),
            "absent requires must be omitted"
        );
        assert!(
            json.get("targets").is_none(),
            "empty targets must be omitted"
        );
    }

    // ── explicit targets: filtering ───────────────────────────────────────────

    #[test]
    fn explicit_targets_are_respected() {
        let raw = r#"{
            "id": "desktop.only",
            "name": "Desktop Only",
            "version": "1.0.0",
            "runnables": [],
            "targets": ["desktop"]
        }"#;
        let m = parse(raw).unwrap();
        assert!(m.supports_surface(Surface::Desktop));
        assert!(!m.supports_surface(Surface::Mobile));
        assert!(!m.supports_surface(Surface::Cli));
        assert!(!m.supports_surface(Surface::Core));
    }

    /// Replaces `unknown_surface_is_rejected`, which pinned the behaviour this
    /// deliberately removes.
    ///
    /// A surface token an older build has never heard of used to fail
    /// deserialization and take the WHOLE manifest with it — so the first release
    /// that added a surface would break every plugin naming it on every older
    /// client. It now lands on [`Surface::Unknown`] and simply reads as "not that
    /// surface", which is what an older client should conclude.
    #[test]
    fn unknown_surface_degrades_instead_of_killing_the_manifest() {
        let raw = r#"{
            "id": "future.surface",
            "name": "Future Surface",
            "version": "1.0.0",
            "runnables": [],
            "targets": ["desktop", "toaster"]
        }"#;
        let m = parse(raw).expect("an unknown surface must NOT fail the manifest");

        // The surfaces we do understand still work exactly as declared.
        assert!(m.supports_surface(Surface::Desktop));
        // The unknown one narrows, never widens: it cannot match a real surface,
        // and an explicit target list still excludes everything not named.
        assert!(!m.supports_surface(Surface::Web));
        assert!(!m.supports_surface(Surface::Mobile));
        // And asking about Unknown itself is always false — a manifest must never be
        // able to claim support for a surface this build cannot verify.
        assert!(!m.supports_surface(Surface::Unknown));
    }

    /// A manifest aimed ONLY at surfaces we do not know must render nowhere, not
    /// everywhere. Dropping unknown entries and falling back to "empty targets means
    /// all surfaces" would invert the author's intent completely.
    #[test]
    fn a_manifest_targeting_only_future_surfaces_appears_nowhere() {
        let raw = r#"{
            "id": "future.only",
            "name": "Future Only",
            "version": "1.0.0",
            "runnables": [],
            "targets": ["toaster", "fridge"]
        }"#;
        let m = parse(raw).expect("unknown surfaces must not fail the manifest");
        for s in [
            Surface::Desktop,
            Surface::Web,
            Surface::Mobile,
            Surface::Cli,
            Surface::Island,
            Surface::Extension,
        ] {
            assert!(
                !m.supports_surface(s),
                "a future-only manifest must not appear on {s:?}"
            );
        }
    }

    /// The `surfaces` map equivalent, plus the support-level landing pad: an
    /// unrecognised LEVEL counts as supported (the author said it works here, just in
    /// a way we cannot describe), while an explicit `none` still excludes.
    #[test]
    fn unknown_surface_support_level_counts_as_supported() {
        let raw = r#"{
            "id": "future.level",
            "name": "Future Level",
            "version": "1.0.0",
            "runnables": [],
            "surfaces": {
                "desktop": { "support": "read-only" },
                "web": { "support": "full" },
                "mobile": { "support": "none" }
            }
        }"#;
        let m = parse(raw).expect("an unknown support level must NOT fail the manifest");
        assert!(
            m.supports_surface(Surface::Desktop),
            "an unknown level must not delist a surface the author explicitly listed"
        );
        assert!(m.supports_surface(Surface::Web));
        assert!(
            !m.supports_surface(Surface::Mobile),
            "explicit none excludes"
        );
        // Absent key = unsupported (the `surfaces` map inverts the `targets` default).
        assert!(!m.supports_surface(Surface::Cli));
    }

    #[test]
    fn surface_tokens_round_trip_through_parse() {
        for s in [
            Surface::Gateway,
            Surface::Core,
            Surface::Desktop,
            Surface::Island,
            Surface::Mobile,
            Surface::Extension,
            Surface::Web,
            Surface::Cli,
        ] {
            assert_eq!(Surface::parse(s.as_str()), Some(s));
            // The wire token must match the serde (kebab-case) encoding exactly.
            let json = serde_json::to_string(&s).unwrap();
            assert_eq!(json, format!("\"{}\"", s.as_str()));
        }
        assert_eq!(Surface::parse("DESKTOP"), Some(Surface::Desktop));
        assert_eq!(Surface::parse("nonsense"), None);
    }

    // ── requires: shape validation ────────────────────────────────────────────

    #[test]
    fn self_dependency_is_rejected_at_load() {
        let raw = r#"{
            "id": "narcissus",
            "name": "Narcissus",
            "version": "1.0.0",
            "runnables": [],
            "requires": { "apps": [{ "id": "narcissus" }] }
        }"#;
        let err = parse(raw).expect_err("a self-dependency must be rejected");
        assert!(err.contains("cannot depend on itself"), "got: {err}");
    }

    #[test]
    fn malformed_min_version_is_rejected_at_load() {
        let raw = r#"{
            "id": "app",
            "name": "App",
            "version": "1.0.0",
            "runnables": [],
            "requires": { "apps": [{ "id": "lib", "min_version": "not-a-version" }] }
        }"#;
        let err = parse(raw).expect_err("a malformed min_version must be rejected");
        assert!(err.contains("min_version"), "got: {err}");
    }

    #[test]
    fn duplicate_dependency_is_rejected_at_load() {
        let raw = r#"{
            "id": "app",
            "name": "App",
            "version": "1.0.0",
            "runnables": [],
            "requires": { "apps": [{ "id": "lib" }, { "id": "lib" }] }
        }"#;
        let err = parse(raw).expect_err("a duplicate dependency must be rejected");
        assert!(err.contains("duplicate dependency"), "got: {err}");
    }

    // ── min_version semantics ─────────────────────────────────────────────────

    /// The load-bearing semver decision: a bare `min_version` is a MINIMUM, not
    /// semver's default caret range. `VersionReq::parse("1.2.0")` means `^1.2.0`
    /// and would REJECT 2.0.0; `parse_min_version` must accept it.
    #[test]
    fn bare_min_version_is_a_minimum_not_a_caret() {
        let req = parse_min_version("1.2.0").unwrap();
        assert!(
            req.matches(&semver::Version::parse("1.2.0").unwrap()),
            "exact"
        );
        assert!(
            req.matches(&semver::Version::parse("1.9.9").unwrap()),
            "minor"
        );
        assert!(
            req.matches(&semver::Version::parse("2.0.0").unwrap()),
            "a bare min_version must accept a NEWER MAJOR — this is the whole point"
        );
        assert!(
            !req.matches(&semver::Version::parse("1.1.0").unwrap()),
            "below the minimum is still rejected"
        );
    }

    #[test]
    fn explicit_comparators_are_honoured_verbatim() {
        // The caret escape hatch still pins the major when asked for explicitly.
        let caret = parse_min_version("^1.2.0").unwrap();
        assert!(caret.matches(&semver::Version::parse("1.9.0").unwrap()));
        assert!(!caret.matches(&semver::Version::parse("2.0.0").unwrap()));

        let range = parse_min_version(">=1.0, <2").unwrap();
        assert!(range.matches(&semver::Version::parse("1.5.0").unwrap()));
        assert!(!range.matches(&semver::Version::parse("2.0.0").unwrap()));
    }

    #[test]
    fn invalid_min_version_strings_are_errors() {
        assert!(parse_min_version("not-a-version").is_err());
        assert!(parse_min_version("").is_err());
    }

    // ── Every fixture in `fixtures/*.manifest.json` must be well-formed ───────
    //
    // `BUILTIN_MANIFESTS` only `include_str!`s the SHIPPED subset, so `load()` never
    // touches the reference/sample fixtures (`sample`, `tool-firewall`,
    // `hook-observers`, `agents`, …). A truncated or malformed one of those would
    // compile fine and slip past every existing test. This reads the directory at
    // runtime (like `packaged_manifests_match_their_core_fixtures_and_are_registered`) so ALL of
    // them are exercised, and is skipped on any tree that ships without the folder.

    /// Every built-in manifest in this tree, from BOTH homes.
    ///
    /// Manifests used to live only in `plugin_manifest/fixtures/`. The packaged ones
    /// now live in `apps-store/<x>/manifest.json` / `plugins-store/<x>/manifest.json`
    /// and Core `include_str!`s them directly — the duplicate fixture copies are gone.
    /// Only the ~13 Core-only manifests (no package home: `layers`, `memory`, `rag`,
    /// …) still sit in `fixtures/`.
    ///
    /// So this MUST read both roots. Reading only `fixtures/` would still return a
    /// non-empty list and every caller below would still pass — while silently
    /// covering 13 manifests instead of 71. That is the exact failure mode this
    /// helper exists to prevent, so the shrink must not be possible: each root is
    /// skipped only when its directory is absent (mirror/satellite trees).
    fn fixture_plugin_json_paths() -> Vec<std::path::PathBuf> {
        let core = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let repo_root = core.join("..").join("..");
        let mut paths: Vec<std::path::PathBuf> = Vec::new();

        // 1. Core-only manifests still living beside the crate.
        if let Ok(entries) = std::fs::read_dir(core.join("src/plugin_manifest/fixtures")) {
            paths.extend(entries.flatten().map(|e| e.path()).filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.ends_with(".manifest.json"))
            }));
        }

        // 2. The packaged manifests Core compiles in from the package roots.
        for root in ["apps-store", "plugins-store"] {
            let Ok(entries) = std::fs::read_dir(repo_root.join(root)) else {
                continue; // not shipped in this tree
            };
            paths.extend(
                entries
                    .flatten()
                    .map(|e| e.path().join("manifest.json"))
                    .filter(|p| p.is_file()),
            );
        }

        paths.sort();
        paths
    }

    #[test]
    fn every_fixture_deserializes_into_a_plugin_manifest() {
        let paths = fixture_plugin_json_paths();
        assert!(
            !paths.is_empty(),
            "fixtures/*.manifest.json must be present in this tree"
        );
        for path in &paths {
            let raw = std::fs::read_to_string(path)
                .unwrap_or_else(|e| panic!("{} unreadable: {e}", path.display()));
            let manifest: PluginManifest = serde_json::from_str(&raw)
                .unwrap_or_else(|e| panic!("{} failed to deserialise: {e}", path.display()));
            assert!(
                !manifest.id.trim().is_empty(),
                "{} has an empty id",
                path.display()
            );
            assert!(
                !manifest.name.trim().is_empty(),
                "{} has an empty name",
                path.display()
            );
        }
    }

    #[test]
    fn every_fixture_has_a_valid_id_and_semver_version() {
        for path in &fixture_plugin_json_paths() {
            let raw = std::fs::read_to_string(path).expect("read fixture");
            let manifest: PluginManifest = serde_json::from_str(&raw).expect("deserialise fixture");
            validate_plugin_id(&manifest.id)
                .unwrap_or_else(|e| panic!("{} has an invalid plugin id: {e}", path.display()));
            semver::Version::parse(&manifest.version).unwrap_or_else(|e| {
                panic!(
                    "{} version '{}' is not semver: {e}",
                    path.display(),
                    manifest.version
                )
            });
        }
    }

    #[test]
    fn every_fixture_passes_parse_and_validate_independently() {
        // Each fixture, validated in isolation (a fresh `seen_ids`), must clear the
        // full loader contract — per-kind config, sidecar/companion/contributes
        // cross-checks — even the ones `load()` never reaches. `engines`-gated
        // fixtures are exempt: their `engines.ryu` is version-pinned and is a
        // deliberate load-time rejection, not a malformed manifest.
        for path in &fixture_plugin_json_paths() {
            let raw = std::fs::read_to_string(path).expect("read fixture");
            let manifest: PluginManifest = serde_json::from_str(&raw).expect("deserialise fixture");
            if manifest.engines.is_some() {
                continue;
            }
            let mut seen = HashSet::new();
            PluginManifestLoader::parse_and_validate(&raw, "<fixture>", None, &mut seen)
                .unwrap_or_else(|e| panic!("{} failed parse_and_validate: {e}", path.display()));
        }
    }

    #[test]
    fn fixture_ids_are_unique_across_the_directory() {
        let mut seen: HashSet<String> = HashSet::new();
        for path in &fixture_plugin_json_paths() {
            let raw = std::fs::read_to_string(path).expect("read fixture");
            let manifest: PluginManifest = serde_json::from_str(&raw).expect("deserialise fixture");
            assert!(
                seen.insert(manifest.id.clone()),
                "duplicate fixture id '{}' at {}",
                manifest.id,
                path.display()
            );
        }
    }
}
