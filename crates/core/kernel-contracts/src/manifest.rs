//! The `manifest.json` **manifest model** — the single, pure-data definition of an
//! installable Ryu App/Plugin descriptor plus its `id`/semver/dependency
//! validation.
//!
//! This is the canonical contract shared by `apps/core` (which re-exports these
//! types and drives them from its I/O-bearing loader) and the Ryu SDK (which
//! re-exports them for manifest authoring/validation across language bindings).
//! It performs no I/O and links no runtime — serde/schemars/semver only.

use std::collections::{BTreeMap, BTreeSet};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::runnable::{RunnableKind, RunnableMeta};
use crate::schema::{self, RunnableEntry};

/// Maximum length of an app `id`. Reverse-domain ids are short; a generous cap
/// prevents pathological filesystem paths and absurdly long directory names.
pub const MAX_PLUGIN_ID_LEN: usize = 128;

/// The ONLY directories a manifest `code_file` may name, one segment deep.
///
/// Deliberately a closed, flat allowlist rather than a free-form relative path.
/// Two things depend on it being provably flat: the path is joined onto a plugin
/// directory (so it is a traversal sink, like [`validate_plugin_id`]), and
/// `tools/mirror-public.sh` vendors these files into the published tree with a
/// literal `plugins-store/*/<dir>/*.js` glob. A nested layout would make that
/// glob *accidentally* rather than provably sufficient, and the miss would first
/// surface as a public-tree compile failure after publication.
pub const CODE_FILE_DIRS: &[&str] = &["hooks", "adapters"];

/// Largest sandboxed-JS file a manifest may reference, in bytes. Generous for a
/// hook body (the largest first-party one is ~6 KB) and small enough that a
/// resolver cannot be pointed at something enormous.
pub const MAX_CODE_FILE_BYTES: usize = 256 * 1024;

/// Validate a manifest `code_file` path: exactly `<dir>/<name>.js`, where `<dir>`
/// is one of [`CODE_FILE_DIRS`].
///
/// The path is resolved against a plugin's own directory, so this is the
/// load-time gate that keeps a malicious manifest from reading outside it. Same
/// posture as [`validate_plugin_id`]: an ASCII allowlist, not an escape blocklist,
/// because `\` is a path separator on Windows and a drive-qualified or absolute
/// component silently replaces the base in `PathBuf::join`.
pub fn validate_code_file_path(rel: &str) -> Result<(), String> {
    if rel.is_empty() {
        return Err("code_file must not be empty".to_string());
    }
    let mut segments = rel.split('/');
    let (Some(dir), Some(file), None) = (segments.next(), segments.next(), segments.next()) else {
        return Err(format!(
            "code_file '{rel}' must be exactly '<dir>/<name>.js' (allowed dirs: {})",
            CODE_FILE_DIRS.join(", ")
        ));
    };
    if !CODE_FILE_DIRS.contains(&dir) {
        return Err(format!(
            "code_file '{rel}' must live under one of: {}",
            CODE_FILE_DIRS.join(", ")
        ));
    }
    if !(file.ends_with(".js") || file.ends_with(".mjs")) {
        return Err(format!("code_file '{rel}' must name a .js or .mjs file"));
    }
    let stem_ok = file
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_');
    if !stem_ok {
        return Err(format!(
            "code_file '{rel}' contains illegal characters (allowed: a-z A-Z 0-9 . - _)"
        ));
    }
    if file.contains("..") || file.starts_with('.') {
        return Err(format!(
            "code_file '{rel}' must not traverse or start with '.'"
        ));
    }
    Ok(())
}

/// Hydrate one code-bearing node: enforce exactly-one-of `code`/`code_file`,
/// resolve the path, move the contents into `code`, and clear `code_file` so the
/// hydrated manifest is byte-indistinguishable from an inline one.
fn hydrate_one(
    label: &str,
    code: &mut String,
    code_file: &mut Option<String>,
    resolve: &mut impl FnMut(&str) -> Result<String, String>,
) -> Result<(), String> {
    let has_inline = !code.trim().is_empty();
    let Some(rel) = code_file.clone() else {
        if has_inline {
            return Ok(());
        }
        return Err(format!("{label} declares neither 'code' nor 'code_file'"));
    };
    if has_inline {
        return Err(format!(
            "{label} declares both 'code' and 'code_file' ('{rel}') — exactly one is allowed"
        ));
    }
    validate_code_file_path(&rel).map_err(|e| format!("{label}: {e}"))?;
    let body = resolve(&rel).map_err(|e| format!("{label}: cannot resolve code_file: {e}"))?;
    if body.len() > MAX_CODE_FILE_BYTES {
        return Err(format!(
            "{label}: code_file '{rel}' is {} bytes (max {MAX_CODE_FILE_BYTES})",
            body.len()
        ));
    }
    if body.trim().is_empty() {
        return Err(format!("{label}: code_file '{rel}' is empty"));
    }
    *code = body;
    *code_file = None;
    Ok(())
}

/// Validate an app `id`.
///
/// Two shapes are legal, and they are matched as **exact shapes** — never by
/// widening one permissive character allowlist to cover both:
///
/// 1. **Scoped** (`@scope/name`, e.g. `@ryu/meetings`) — the current form.
/// 2. **Legacy flat** (`ghost`, `@example/research-assistant`) — every id
///    predating the scoped scheme. Still legal *forever*, because the alias map
///    ([`canonical_plugin_id`]) lets a third-party manifest that was never updated
///    keep loading.
///
/// # Why exact shapes and not one wider alphabet
///
/// The id reaches filesystem-path contexts (`apps_dir().join(...)`), so an
/// unvalidated id is a path-traversal / arbitrary-write sink, and the original
/// allowlist rejected `/`, `\`, `:` and a leading `.` deliberately — the project is
/// Windows-first, where `PathBuf::join` with an absolute or drive-qualified
/// component silently **replaces** the base. A scoped id contains a `/`, so simply
/// adding `/` and `@` to that alphabet would make `@a/../../etc` a legal id and
/// reopen exactly that hole. Instead the scoped branch splits on the single `/` and
/// holds each half to the strict legacy alphabet, so no traversal segment can
/// survive in either half.
///
/// Note the disk never sees this `/` regardless: [`plugin_dir_name`] flattens a
/// scoped id before it is ever joined onto a path.
///
/// Both halves:
/// - non-empty, whole id at most [`MAX_PLUGIN_ID_LEN`] bytes
/// - characters limited to ASCII `[a-zA-Z0-9.-_]`
/// - no `..` sequence, no leading/trailing `.`, no leading `-`
///
/// Returns `Ok(())` when the id is safe, else a descriptive `Err(String)`.
pub fn validate_plugin_id(id: &str) -> Result<(), String> {
    // Scoped form: `@scope/name`. Exactly one `/`, `@` only as the first byte.
    if let Some(rest) = id.strip_prefix('@') {
        if id.len() > MAX_PLUGIN_ID_LEN {
            return Err(format!(
                "app id is too long ({} bytes, max {MAX_PLUGIN_ID_LEN})",
                id.len()
            ));
        }
        let Some((scope, name)) = rest.split_once('/') else {
            return Err(format!(
                "scoped app id '{id}' must be '@scope/name' (missing '/')"
            ));
        };
        if name.contains('/') {
            return Err(format!("scoped app id '{id}' must contain exactly one '/'"));
        }
        // Each half must itself be a legal flat id — this is what keeps `..`,
        // leading `.`/`-`, `\`, `:` and `@` out of BOTH halves.
        validate_flat_plugin_id(scope).map_err(|e| format!("scope of '{id}': {e}"))?;
        validate_flat_plugin_id(name).map_err(|e| format!("name of '{id}': {e}"))?;
        return Ok(());
    }
    validate_flat_plugin_id(id)
}

/// The strict legacy alphabet, applied to a whole flat id or to one half of a
/// scoped one. See [`validate_plugin_id`] for why this stays narrow.
fn validate_flat_plugin_id(id: &str) -> Result<(), String> {
    if id.is_empty() {
        return Err("app id must not be empty".to_string());
    }
    if id.len() > MAX_PLUGIN_ID_LEN {
        return Err(format!(
            "app id is too long ({} bytes, max {MAX_PLUGIN_ID_LEN})",
            id.len()
        ));
    }
    let valid_chars = id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_');
    if !valid_chars {
        return Err(format!(
            "app id '{id}' contains illegal characters (allowed: a-z A-Z 0-9 . - _)"
        ));
    }
    if id.contains("..") {
        return Err(format!("app id '{id}' must not contain '..'"));
    }
    if id.starts_with('.') || id.ends_with('.') {
        return Err(format!("app id '{id}' must not start or end with '.'"));
    }
    if id.starts_with('-') {
        return Err(format!("app id '{id}' must not start with '-'"));
    }
    Ok(())
}

/// The **on-disk directory name** for a plugin id.
///
/// A scoped id contains a `/` (`@ryu/meetings`), and the id is used as a directory
/// name under the plugins/apps dir. Joining the raw id would create a NESTED path —
/// and the manifest scanner uses a single-level `read_dir`, so a nested plugin would
/// be silently invisible rather than loudly broken. It would also put a path
/// separator into a value that reaches `PathBuf::join`, which is precisely the
/// surface [`validate_plugin_id`] exists to keep closed.
///
/// So the disk name is a FLATTENED derivation: `@ryu/meetings` → `@ryu+meetings`.
/// `+` is not legal in an id ([`validate_plugin_id`]'s alphabet excludes it), so the
/// mapping is unambiguous and cannot collide with a legacy flat id.
///
/// Every site that joins a plugin id onto a path must call this. The id itself stays
/// scoped everywhere else — this is a storage detail, not a rename.
#[must_use]
pub fn plugin_dir_name(id: &str) -> String {
    id.replace('/', "+")
}

/// Canonicalize a possibly-legacy plugin id to its current form.
///
/// The scoped rename (`@ryu/meetings` → `@ryu/meetings`) would otherwise orphan
/// real user state — the id is the `app_store` record key (carrying enabled-state and
/// Gateway-approved grants), the `plugin_storage` KV prefix, and the hash input for
/// every sidecar's minted ext token. This map is what lets the old id keep resolving
/// forever, so a third-party manifest that was never updated still loads.
///
/// Applied at the manifest-load chokepoint so everything downstream — `app_store`
/// lookups, hook dispatch, `may_emit_event` — only ever sees canonical ids and needs
/// no alias awareness of its own. The one caller that must apply it explicitly is the
/// sidecar callback authenticator, because the ext token is a hash over the raw id
/// string a sidecar presents.
#[must_use]
pub fn canonical_plugin_id(id: &str) -> &str {
    LEGACY_PLUGIN_ID_ALIASES
        .iter()
        .find(|(old, _)| *old == id)
        .map_or(id, |(_, new)| *new)
}

/// Old id → current id. Generated from the rename; append-only.
///
/// Deliberately a plain sorted slice rather than a map: it is read rarely (load and
/// sidecar auth), it must be greppable, and a static map would need a dependency to
/// buy nothing at this size.
pub const LEGACY_PLUGIN_ID_ALIASES: &[(&str, &str)] = &[
    ("agentbrowser", "@ryu/agentbrowser"),
    ("brave", "@ryu/brave"),
    ("bytebot", "@ryu/bytebot"),
    ("chat-title", "@ryu/chat-title"),
    (
        "com.example.research-assistant",
        "@example/research-assistant",
    ),
    ("com.ryu.activity", "@ryu/activity"),
    ("com.ryu.agents", "@ryu/agents"),
    ("com.ryu.approvals", "@ryu/approvals"),
    ("com.ryu.browser", "@ryu/browser"),
    ("com.ryu.calendar", "@ryu/calendar"),
    ("com.ryu.canvas", "@ryu/canvas"),
    ("com.ryu.clips", "@ryu/clips"),
    ("com.ryu.dashboards", "@ryu/dashboards"),
    ("com.ryu.docling", "@ryu/docling"),
    ("com.ryu.finetune", "@ryu/finetune"),
    ("com.ryu.hardware", "@ryu/hardware"),
    ("com.ryu.healing", "@ryu/healing"),
    ("com.ryu.layers", "@ryu/layers"),
    ("com.ryu.learning", "@ryu/learning"),
    ("com.ryu.mail", "@ryu/mail"),
    ("com.ryu.markitdown", "@ryu/markitdown"),
    ("com.ryu.media", "@ryu/media"),
    ("com.ryu.meetings", "@ryu/meetings"),
    ("com.ryu.memory", "@ryu/memory"),
    ("com.ryu.mineru", "@ryu/mineru"),
    ("com.ryu.monitors", "@ryu/monitors"),
    ("com.ryu.quests", "@ryu/quests"),
    ("com.ryu.rag", "@ryu/rag"),
    ("com.ryu.recipes", "@ryu/recipes"),
    ("com.ryu.research", "@ryu/research"),
    ("com.ryu.simulator", "@ryu/simulator"),
    ("com.ryu.skill-editor", "@ryu/skill-editor"),
    ("com.ryu.skills", "@ryu/skills"),
    ("com.ryu.spaces", "@ryu/spaces"),
    ("com.ryu.teams", "@ryu/teams"),
    ("com.ryu.timeline", "@ryu/timeline"),
    ("com.ryu.unstructured", "@ryu/unstructured"),
    ("com.ryu.voice", "@ryu/voice"),
    ("com.ryu.warmup", "@ryu/warmup"),
    ("com.ryu.webhooks", "@ryu/webhooks"),
    ("com.ryu.whiteboard", "@ryu/whiteboard"),
    ("com.ryu.workflows", "@ryu/workflows"),
    ("com.ryuhq.advisor", "@ryu/advisor"),
    ("com.ryuhq.auto-expand", "@ryu/auto-expand"),
    ("com.ryuhq.hook-observers", "@ryu/hook-observers"),
    ("com.ryuhq.session-context", "@ryu/session-context"),
    ("com.ryuhq.tool-firewall", "@ryu/tool-firewall"),
    ("dictation", "@ryu/dictation"),
    ("double-check", "@ryu/double-check"),
    ("durable", "@ryu/durable"),
    ("engines", "@ryu/engines"),
    ("exa", "@ryu/exa"),
    ("firecrawl", "@ryu/firecrawl"),
    ("firewall", "@ryu/firewall"),
    ("ghost", "@ryu/ghost"),
    ("goal", "@ryu/goal"),
    ("headroom", "@ryu/headroom"),
    ("honcho", "@ryu/honcho"),
    ("mem0", "@ryu/mem0"),
    ("predict", "@ryu/predict"),
    ("proof", "@ryu/proof"),
    ("routing", "@ryu/routing"),
    ("rtk", "@ryu/rtk"),
    ("sample-widget", "@ryu/sample-widget"),
    ("sandbox", "@ryu/sandbox"),
    ("scrapling", "@ryu/scrapling"),
    ("security-guidance", "@ryu/security-guidance"),
    ("serper", "@ryu/serper"),
    ("shadow", "@ryu/shadow"),
    ("spider", "@ryu/spider"),
    ("spidercloud", "@ryu/spidercloud"),
    ("tavily", "@ryu/tavily"),
];

/// An installable Ryu App manifest (`manifest.json`).
///
/// Modelled on Codex's `manifest.json` pattern: a thin descriptor that bundles one or
/// more [`RunnableEntry`] items (agents, workflows, tools, skills, companions,
/// channels, engines, policies), lists the permission grants the app requires, and
/// optionally declares a Companion surface (an in-desktop overlay or sidebar panel).
///
/// # Per-kind config
///
/// Each Runnable entry carries an optional `config` blob whose schema is
/// determined by its `kind`. See [`crate::schema`] for the per-kind structs and the
/// [`crate::schema::validate_runnable`] function.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, JsonSchema)]
pub struct PluginManifest {
    /// Reverse-domain unique identifier for the app (e.g. `"com.example.my-app"`).
    pub id: String,

    /// Human-readable display name shown in the app store / launcher.
    pub name: String,

    /// Semver version string (e.g. `"1.0.0"`).
    pub version: String,

    /// Lower-case hex `sha256(utf8_bytes(ui_code))` binding the plugin's bundled
    /// sandboxed-UI code to this manifest. Because the Gateway signs the manifest
    /// verbatim (canonical key-sorted encoding), this hash is INSIDE the signed
    /// surface while the `ui_code` blob itself rides OUTSIDE it as payload; the
    /// install path recomputes the hash over the fetched code and rejects a
    /// mismatch fail-closed. Absent for a manifest-only plugin (no bundled UI) and
    /// for unsigned seed items. Written by `ryu pack`/`ryu publish`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ui_code_sha256: Option<String>,

    /// The plugin's **backend bundle** — the JavaScript source of the extension-host
    /// entry module a [`crate::schema::SidecarProcess::Node`] sidecar runs (RFC Option
    /// B). This is the backend analogue of `ui_code`: a payload blob that Core writes
    /// to the plugin dir at the node sidecar's declared `entry` path at spawn, then
    /// loads via the embedded host bootstrap. Unlike `ui_code` (which the install path
    /// splits into a DB column so the on-disk manifest stays small), the backend blob
    /// rides **inline** in the manifest so the spawn path is self-contained (it reads
    /// the reconstituted manifest, no separate carriage channel) AND, for a
    /// marketplace plugin, the code is INSIDE the Gateway-signed surface — the whole
    /// backend is signed, not merely hash-bound. Absent for a plugin with no node
    /// backend. Written by `ryu pack`/`ryu publish`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backend_code: Option<String>,

    /// Lower-case hex `sha256(utf8_bytes(backend_code))` — the integrity gate for the
    /// node backend, mirroring [`ui_code_sha256`]. When present, Core recomputes the
    /// hash over the on-disk entry file at spawn and **refuses to start** the node
    /// sidecar on mismatch (fail-closed), so an entry file swapped on disk between
    /// install and spawn can never run. Absent = trust the bundle as written (the same
    /// posture `ui_code_sha256` uses when omitted).
    ///
    /// [`ui_code_sha256`]: PluginManifest::ui_code_sha256
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backend_sha256: Option<String>,

    /// The Runnables this app bundles. Each entry uses [`RunnableEntry`] from the
    /// [`crate::schema`] module so heterogeneous Runnables (agents, workflows,
    /// tools, skills, companions, channels, engines, policies) can be listed
    /// together with their per-kind config.
    pub runnables: Vec<RunnableEntry>,

    /// Permission grants this app declares it needs (e.g. `"mcp:web_search"`).
    /// These are *declarations only* at this layer — no enforcement happens here;
    /// the Gateway owns grant enforcement.
    #[serde(default)]
    pub permission_grants: Vec<String>,

    /// **Unified, deny-by-default runtime permission set** — the single typed
    /// grammar (`{fs, child_process, network, tool}`) Core lowers to every sandbox
    /// backend (wasmtime WASI preopens, Docker `--mount`/`--network` flags, Deno
    /// `--allow-*` flags). Absent = **deny-all** (the default for every manifest
    /// predating this field), so an app that declares nothing keeps today's exact
    /// zero-permission sandbox posture.
    ///
    /// # Relationship to [`permission_grants`]
    ///
    /// These are **two distinct lanes** that must not be conflated:
    /// - [`permission_grants`] are opaque strings the **Gateway** approves at
    ///   install/enable time — the *approval* lane (who is allowed to ask).
    /// - `permissions` is the typed set **Core** lowers into the actual sandbox at
    ///   spawn/exec time — the *runtime-enforcement* lane (what the code can touch).
    ///
    /// A grant says "this app may use the filesystem capability"; `permissions.fs`
    /// says "…and here are the exact read/write paths the sandbox is opened with."
    ///
    /// # Altitude (manifest-level, per-runnable override is a followup)
    ///
    /// Declared at the manifest root because **both** current enforcement sites
    /// resolve their config from the owning manifest, not from a sub-entry: an
    /// `inline_deno` tool's backend is resolved from the manifest by
    /// `McpRegistry::resolve_app_tool_backend`, and a managed sidecar is spawned
    /// from the manifest by `ManifestSidecar`. A per-[`crate::schema::ToolConfig`] /
    /// per-[`crate::schema::SidecarSpec`] override is a clean future extension (the
    /// resolver would fall back to this manifest-level set) but is intentionally not
    /// in v1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permissions: Option<PermissionSet>,

    /// Optional Companion surface descriptor: an in-desktop overlay or sidebar panel
    /// the app may register. Absent when the app has no Companion surface.
    #[serde(default)]
    pub companion: Option<CompanionSurface>,

    /// VS-Code-style **contribution points**: a declare-by-id block naming which
    /// of the manifest's `runnables` the plugin contributes to each extensible
    /// surface. Every id referenced here MUST exist in `runnables` (the loader
    /// cross-validates). Absent when the plugin contributes nothing extra
    /// (the common case — a plugin's `runnables` are already its contributions).
    #[serde(default)]
    pub contributes: Option<Contributes>,

    /// Activation events that lazily wake the plugin — VS-Code `activationEvents`.
    /// Recognised tokens: `"*"` (always active / eager), `"onStartup"`, `"onChat"`,
    /// `"onCommand:<id>"`, `"onRoute"` (fired the first time a lazy sidecar is woken
    /// by an inbound proxy hit), and `"onCapabilityCall"` (the broker analogue —
    /// fired when a lazy provider sidecar is woken by a capability-broker hit). An
    /// **empty** list means *eager* activation (back-compat: every existing manifest
    /// keeps activating on enable). The activation runtime firing these events lives
    /// in Core's `RunnableRegistry::register_active` + `fire_activation_event`;
    /// `onStartup`/`onChat`/`onRoute`/`onCapabilityCall` fire from Core, while
    /// `onCommand:<id>` fires from the desktop command palette.
    #[serde(default)]
    pub activation_events: Vec<String>,

    /// Required Ryu engine version (VS-Code `engines.vscode` analogue). When
    /// present, `engines.ryu` is a semver **requirement** (e.g. `">=0.3.0"`) and
    /// the loader rejects the manifest if the running Core version does not
    /// satisfy it. Absent = compatible with any Core version.
    #[serde(default)]
    pub engines: Option<EnginesReq>,

    /// **Plugin-to-plugin dependencies** — the other plugins this one needs (the
    /// npm-shaped edge that lets the app decompose into a kernel + features).
    /// Resolved into a topological enable order by Core's `plugins::graph`.
    ///
    /// Absent = **no dependencies** (every manifest predating this field).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requires: Option<Requires>,

    /// Host surfaces this plugin runs on (desktop / island / mobile / …).
    ///
    /// **Empty or absent = runs on EVERY surface.** This is the backward-compatible
    /// default and must never be read as "runs nowhere" — every manifest that
    /// predates this field declares no targets and must keep surfacing everywhere.
    /// Filtering happens ONLY when this list is explicitly non-empty, and only at
    /// the read/surface boundary (see [`PluginManifest::supports_surface`]) — never
    /// in the storage layer, so an unsupported-target plugin stays installable and
    /// inspectable.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub targets: Vec<Surface>,

    /// Per-surface support + UI declaration — the richer successor to [`targets`].
    ///
    /// When **present**, this map is authoritative and [`targets`] is ignored: a
    /// surface is supported iff it has an entry whose [`SurfaceSupport`] is not
    /// [`SurfaceSupport::None`], and an **absent key means the surface is not
    /// supported** (see [`PluginManifest::supports_surface`]). When **absent**, the
    /// predicate falls back to the legacy [`targets`] semantics (empty/absent =
    /// every surface) — so every manifest that predates this field keeps its exact
    /// behaviour. Never make an absent `surfaces` mean "no surfaces".
    ///
    /// [`targets`]: PluginManifest::targets
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surfaces: Option<BTreeMap<Surface, SurfaceEntry>>,

    /// **Capabilities this plugin provides** — the inverse of
    /// [`Requires::capabilities`]. Each entry names a capability the plugin's
    /// sidecar can serve for other plugins through the capability broker, binding
    /// the capability to one of this manifest's declared `sidecars` + a proxied
    /// route. Absent/empty for the common case (a plugin that consumes but does not
    /// provide capabilities). The loader cross-validates that every referenced
    /// `sidecar`/`route` exists (like `contributes`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub provides: Vec<ProvidesEntry>,

    /// Optional declarative **external runtime** the plugin needs (e.g. a Python
    /// venv + pip deps + assets, like the TTS sidecar). The provisioner lives in
    /// Core (`crate::sidecar::external_runtime`); this is the declaration (#449).
    /// Absent for the common case (no external interpreter needed).
    #[serde(default)]
    pub runtime: Option<schema::ExternalRuntimeConfig>,

    /// Declarative **managed sidecars** the plugin ships (the app ⇄ sidecar
    /// bridge): each is a long-running child process Core downloads/provisions,
    /// spawns, and health-monitors via the Core `SidecarManager` on enable,
    /// exactly like a built-in sidecar. Gated at enable by the `sidecar:process`
    /// grant (Core-tier auto; Community needs the approved grant). Empty for the
    /// common case (no bundled process).
    #[serde(default)]
    pub sidecars: Vec<schema::SidecarSpec>,

    /// Declarative **stdio MCP servers** this plugin registers into Core's MCP
    /// registry on enable and deregisters on disable/uninstall. Each entry is a
    /// [`McpServerDecl`] keyed by the server name the registry uses (the same key a
    /// user's `mcp.json` would use). This is the manifest-owned successor to Core's
    /// hardcoded built-in MCP servers: a plugin declares its server here instead of
    /// Core baking a `com.ryu.<app>` server into `builtin_servers()`. Empty for the
    /// common case (a plugin that ships no MCP server). A user `mcp.json` entry with
    /// the same name still wins (user-overrides-builtin precedence is preserved by
    /// the registry).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub mcp_servers: BTreeMap<String, McpServerDecl>,

    // ── Rich marketplace metadata (Phase 1.5) ─────────────────────────────────
    //
    // All optional/additive so older manifests still load and render. These feed
    // the marketplace **detail** contract the desktop dialog consumes; where a
    // field aligns with the Claude `.claude-plugin/marketplace.json` plugin-entry
    // standard it keeps that JSON key (`author`, `homepage`, `category`,
    // `license`, `keywords`), and the Ryu extensions use their contract key.
    /// Long plaintext/markdown description. Empty when absent (the built-in card
    /// historically emitted `""` for this; preserved).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    /// Short one-line tagline shown under the name (Ryu extension).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tagline: Option<String>,

    /// Logo URL (contract key `iconUrl`; Ryu extension).
    #[serde(default, rename = "iconUrl", skip_serializing_if = "Option::is_none")]
    pub icon_url: Option<String>,

    /// Icon-primitive id for the listing card (Ryu extension: `icon`). An
    /// Iconify/icons0 `prefix:name`, a bare Hugeicons name, or a URL — resolved by
    /// the shared `Icon` primitive. Distinct from `icon_url`: this is a GLYPH id the
    /// card masks with `currentColor`, `icon_url` is a raster logo. When absent the
    /// card falls back to `icon_url`, then a default glyph.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,

    /// Dithered-gradient background for the card's icon square (Ryu extension:
    /// `iconDither`). Opaque passthrough `{ from, to?, direction? }` mirroring
    /// dither-kit's `DitherGradient` props (`from`/`to` are a palette-colour name or
    /// a hue number, `direction` is up|down|left|right). Kept as raw JSON like
    /// `banner` so an untrusted/typo'd value never fails the manifest parse — the
    /// render layer validates and falls back before painting.
    #[serde(
        default,
        rename = "iconDither",
        skip_serializing_if = "Option::is_none"
    )]
    pub icon_dither: Option<serde_json::Value>,

    /// CSS background for the icon square (Ryu extension: `iconBackground`).
    #[serde(
        default,
        rename = "iconBackground",
        skip_serializing_if = "Option::is_none"
    )]
    pub icon_background: Option<String>,

    /// Primary brand accent color, hex (Ryu extension: `accentColor`).
    #[serde(
        default,
        rename = "accentColor",
        skip_serializing_if = "Option::is_none"
    )]
    pub accent_color: Option<String>,

    /// Detail-page hero banner spec ({colors,style,seed}); opaque passthrough (Ryu ext).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub banner: Option<serde_json::Value>,

    /// App-Store gallery screenshot URLs (Ryu extension).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub screenshots: Vec<String>,

    /// Publisher/author. Claude `author` — a bare string or an object with a
    /// `name` field; the detail builder extracts the display string into
    /// `developer`. Kept as a raw value so both shapes round-trip.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<serde_json::Value>,

    /// Free-text category (Claude `category`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,

    /// Homepage/website URL (Claude `homepage`; emitted as `website`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,

    /// SPDX license identifier (Claude `license`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,

    /// Search keywords / tags (Claude `keywords`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub keywords: Vec<String>,

    /// Privacy policy URL (contract key `privacyPolicyUrl`; Ryu extension).
    #[serde(
        default,
        rename = "privacyPolicyUrl",
        skip_serializing_if = "Option::is_none"
    )]
    pub privacy_policy_url: Option<String>,

    /// Terms-of-service URL (contract key `termsOfServiceUrl`; Ryu extension).
    #[serde(
        default,
        rename = "termsOfServiceUrl",
        skip_serializing_if = "Option::is_none"
    )]
    pub terms_of_service_url: Option<String>,

    /// Human-readable capability strings (Ryu extension). When absent the detail
    /// builder DERIVES these from `permission_grants` via
    /// [`crate::schema::capabilities_from_grants`]; declared values are used verbatim.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub capabilities: Vec<String>,

    /// Prompt-chip examples (contract key `examplePrompts`; Ryu extension).
    #[serde(
        default,
        rename = "examplePrompts",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub example_prompts: Vec<String>,

    /// Optional companion/config setup card, or an array of such steps (Ryu
    /// extension). Opaque to Core — passed through to the detail payload verbatim.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setup: Option<serde_json::Value>,

    /// Provenance hint for the marketplace index: `"builtin"`, an `owner/repo`
    /// slug, or a git/raw URL an external plugin ships from. Absent ⇒ `"builtin"`.
    /// This is an index HINT only — Core derives the real trust tier from
    /// `plugins::builtins` membership at runtime, NOT from this field. Consumed by
    /// the marketplace generator (`tools/mirror-plugins.sh`) to populate each
    /// entry's `source`/`builtin` pair.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

impl PluginManifest {
    /// The `developer` display string for the detail contract, extracted from the
    /// Claude `author` field: a bare string is used directly, an object's `name`
    /// field is read, any other shape yields `None`.
    pub fn developer(&self) -> Option<String> {
        match self.author.as_ref()? {
            serde_json::Value::String(s) if !s.trim().is_empty() => Some(s.trim().to_string()),
            serde_json::Value::Object(map) => map
                .get("name")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string),
            _ => None,
        }
    }

    /// Resolve the `capabilities` label list for the detail contract: declared
    /// values verbatim, else derived from `permission_grants`.
    pub fn resolved_capabilities(&self) -> Vec<String> {
        if self.capabilities.is_empty() {
            schema::capabilities_from_grants(&self.permission_grants)
        } else {
            self.capabilities.clone()
        }
    }

    /// The plugin-to-plugin dependency edges this manifest declares. Empty when
    /// `requires` is absent (no dependencies) — the common case.
    pub fn dependencies(&self) -> &[AppDependency] {
        self.requires.as_ref().map_or(&[], |r| r.apps.as_slice())
    }

    /// Whether this plugin should be surfaced on `surface`.
    ///
    /// Two eras, in precedence order:
    /// 1. If [`surfaces`] is **present**, it is authoritative and [`targets`] is
    ///    ignored: supported iff the surface has an entry whose [`SurfaceSupport`]
    ///    is not [`SurfaceSupport::None`]. An **absent key means unsupported**.
    /// 2. Otherwise fall back to the legacy [`targets`] rule — **an empty/absent
    ///    `targets` list means every surface** (the backward-compatible default);
    ///    a non-empty list filters to its members.
    ///
    /// Never read an absent `surfaces` as "no surfaces" — that would vanish every
    /// manifest predating the field.
    ///
    /// [`surfaces`]: PluginManifest::surfaces
    /// [`targets`]: PluginManifest::targets
    pub fn supports_surface(&self, surface: Surface) -> bool {
        if let Some(surfaces) = &self.surfaces {
            return surfaces
                .get(&surface)
                .is_some_and(|e| e.support != SurfaceSupport::None);
        }
        self.targets.is_empty() || self.targets.contains(&surface)
    }

    /// The capability edges this manifest requires (empty when `requires` is absent
    /// or declares no capabilities). Consumed by the capability binding registry.
    pub fn required_capabilities(&self) -> &[CapabilityReq] {
        self.requires
            .as_ref()
            .map_or(&[], |r| r.capabilities.as_slice())
    }

    /// The capabilities this manifest provides (empty for a pure consumer).
    pub fn provided_capabilities(&self) -> &[ProvidesEntry] {
        &self.provides
    }

    /// Returns the list of [`RunnableEntry`] items bundled by this manifest.
    ///
    /// Each entry carries `id`, `name`, [`RunnableKind`], and an optional per-kind
    /// `config` blob so callers can distinguish all eight Runnable kinds in a single
    /// heterogeneous list without downcasting.
    pub fn runnables(&self) -> &[RunnableEntry] {
        &self.runnables
    }

    /// Returns only the bundled Runnables of a specific [`RunnableKind`].
    pub fn runnables_of_kind(&self, kind: RunnableKind) -> Vec<&RunnableEntry> {
        self.runnables.iter().filter(|r| r.kind == kind).collect()
    }

    /// Returns a [`RunnableMeta`] view of each bundled Runnable (id + name + kind,
    /// no per-kind config). Useful when callers only need identity metadata.
    pub fn runnable_metas(&self) -> Vec<RunnableMeta> {
        self.runnables
            .iter()
            .map(|e| RunnableMeta {
                id: e.id.clone(),
                name: e.name.clone(),
                kind: e.kind,
            })
            .collect()
    }

    /// Parse a manifest from JSON and fully validate it (id, semver, per-kind
    /// Runnable contracts). The single entry point a binding/SDK should use when
    /// loading an untrusted manifest.
    ///
    /// Note: this is the *portable* validation surface (id + semver + runnable
    /// contracts). Core's own loader runs a stricter superset (engines pin,
    /// sidecar specs, contribution cross-checks, duplicate-id detection).
    pub fn parse_and_validate(raw: &str) -> Result<Self, String> {
        let manifest: Self =
            serde_json::from_str(raw).map_err(|e| format!("JSON parse error: {e}"))?;
        manifest.validate()?;
        Ok(manifest)
    }

    /// [`Self::parse_and_validate`] for a manifest that may declare its sandboxed
    /// JS as `code_file` paths instead of inline `code` — the form every
    /// first-party plugin under `plugins-store/` uses.
    ///
    /// `resolve` maps one plugin-root-relative path to that file's contents; the
    /// caller owns the I/O (this crate is pure data), so a built-in plugin can
    /// resolve from a compiled-in table while an on-disk plugin reads its own
    /// directory. Hydration runs BEFORE validation, so the manifest a caller gets
    /// back is always in the runtime-ready form: `code` populated, `code_file`
    /// cleared.
    pub fn parse_and_validate_with_code(
        raw: &str,
        resolve: impl FnMut(&str) -> Result<String, String>,
    ) -> Result<Self, String> {
        let mut manifest: Self =
            serde_json::from_str(raw).map_err(|e| format!("JSON parse error: {e}"))?;
        manifest.hydrate_code_files(resolve)?;
        manifest.validate()?;
        Ok(manifest)
    }

    /// Every plugin-root-relative `code_file` path this manifest declares, in walk
    /// order. Empty once the manifest has been hydrated.
    ///
    /// Exists so a packaging/mirroring step can enumerate the files a plugin's
    /// manifest depends on without duplicating the walk.
    pub fn code_file_refs(&self) -> Vec<String> {
        let mut out = Vec::new();
        if let Some(contributes) = &self.contributes {
            for hook in &contributes.turn_hooks {
                if let Some(rel) = hook.code_file.as_deref() {
                    out.push(rel.to_string());
                }
            }
        }
        for entry in &self.provides {
            for binding in entry.tools.values() {
                if let Some(rel) = binding
                    .adapter
                    .as_ref()
                    .and_then(|a| a.code_file.as_deref())
                {
                    out.push(rel.to_string());
                }
            }
        }
        out
    }

    /// Replace every `code_file` reference with the file's contents, in place.
    ///
    /// # The invariant this encodes
    ///
    /// `code_file` is the **source** form and `code` is the **wire** form. A plugin
    /// is authored with its sandboxed JS in real `.js` files — readable, lintable,
    /// diffable, and auditable for malware — while everything downstream of parsing
    /// (Core's `plugin_host`, the capability facade, the Gateway-signed marketplace
    /// bundle `ryu pack` emits) keeps seeing the single inline `code` string it
    /// always saw. That is deliberate and must not be "helpfully" relaxed: inlining
    /// at pack time is what keeps the whole hook/adapter body INSIDE the signed
    /// surface, so no new unsigned-code carriage channel is introduced by letting
    /// authors use files.
    ///
    /// # Fail-closed
    ///
    /// A code-bearing node must declare **exactly one** of `code` / `code_file`,
    /// and an unresolvable `code_file` is a hard error. Neither ever degrades to an
    /// empty body: a hook that silently becomes a no-op is the exact failure this
    /// whole seam has to avoid, since nothing downstream can tell an empty hook
    /// from a hook that chose to do nothing.
    pub fn hydrate_code_files(
        &mut self,
        mut resolve: impl FnMut(&str) -> Result<String, String>,
    ) -> Result<(), String> {
        let plugin = self.id.clone();
        if let Some(contributes) = &mut self.contributes {
            for hook in &mut contributes.turn_hooks {
                let label = format!("plugin '{plugin}' turn hook '{}'", hook.id);
                hydrate_one(&label, &mut hook.code, &mut hook.code_file, &mut resolve)?;
            }
        }
        for entry in &mut self.provides {
            let capability = entry.capability.clone();
            for (verb, binding) in &mut entry.tools {
                let Some(adapter) = binding.adapter.as_mut() else {
                    continue;
                };
                let label = format!("plugin '{plugin}' capability '{capability}' adapter '{verb}'");
                hydrate_one(
                    &label,
                    &mut adapter.code,
                    &mut adapter.code_file,
                    &mut resolve,
                )?;
            }
        }
        Ok(())
    }

    /// Reject a manifest that is not in the runtime-ready code form: a residual
    /// `code_file` (parsed without a resolver — see
    /// [`Self::parse_and_validate_with_code`]) or an empty `code` body.
    ///
    /// Both are loud failures on purpose. The alternative — parse, leave `code`
    /// empty, and let the sandbox run nothing — is indistinguishable at every read
    /// site from a hook that legitimately did nothing.
    ///
    /// Called by [`Self::validate`], and separately by the **install ingest** paths
    /// (install-from-URL, install-from-local-bundle, install-from-marketplace).
    /// Those deserialize a `PluginManifest` straight off the wire without running
    /// the full [`Self::validate`] superset, and they persist ONLY the manifest —
    /// no sibling `.js` files — so a `code_file` arriving there could never be
    /// resolved afterwards. `ryu pack` inlines it before publishing precisely so it
    /// never does; this is the gate that makes that a contract instead of a habit.
    pub fn validate_code_sources(&self) -> Result<(), String> {
        let check = |label: &str, code: &str, code_file: Option<&str>| -> Result<(), String> {
            if let Some(rel) = code_file {
                return Err(format!(
                    "{label} still declares code_file '{rel}' — the manifest was parsed \
                     without a code resolver (use PluginManifest::parse_and_validate_with_code)"
                ));
            }
            if code.trim().is_empty() {
                return Err(format!("{label} declares neither 'code' nor 'code_file'"));
            }
            Ok(())
        };
        if let Some(contributes) = &self.contributes {
            for hook in &contributes.turn_hooks {
                check(
                    &format!("plugin '{}' turn hook '{}'", self.id, hook.id),
                    &hook.code,
                    hook.code_file.as_deref(),
                )?;
            }
        }
        for entry in &self.provides {
            for (verb, binding) in &entry.tools {
                if let Some(adapter) = binding.adapter.as_ref() {
                    check(
                        &format!(
                            "plugin '{}' capability '{}' adapter '{verb}'",
                            self.id, entry.capability
                        ),
                        &adapter.code,
                        adapter.code_file.as_deref(),
                    )?;
                }
            }
        }
        Ok(())
    }

    /// Validate this manifest's id, version, and every Runnable entry.
    pub fn validate(&self) -> Result<(), String> {
        validate_plugin_id(&self.id)?;
        if semver::Version::parse(&self.version).is_err() {
            return Err(format!(
                "plugin '{}' has invalid semver version '{}'",
                self.id, self.version
            ));
        }
        for entry in &self.runnables {
            schema::validate_runnable(entry).map_err(|e| format!("plugin '{}': {e}", self.id))?;
        }
        self.validate_capabilities()?;
        self.validate_surface_commands()?;
        self.validate_code_sources()?;
        if let Some(contributes) = &self.contributes {
            contributes
                .validate_settings_contributions()
                .map_err(|e| format!("plugin '{}': {e}", self.id))?;
            contributes
                .validate_hook_events(&self.id)
                .map_err(|e| format!("plugin '{}': {e}", self.id))?;
        }
        if let Some(permissions) = &self.permissions {
            permissions
                .validate()
                .map_err(|e| format!("plugin '{}': {e}", self.id))?;
        }
        Ok(())
    }

    /// Validate every contributed CLI subcommand path in the `surfaces` map.
    ///
    /// A `surfaces.cli.commands[].path` is appended to `/api/ext/<plugin_id>` by the
    /// TUI and fetched, so an unvalidated `path` is a **client-side path-traversal /
    /// SSRF sink**: a WHATWG URL parser resolves `..` segments (and their
    /// percent-encoded `%2e` and backslash-separated forms — `\` is a path separator
    /// for http URLs) BEFORE the request is sent, escaping the `/api/ext/<id>/` scope
    /// so the request reaches an arbitrary internal Core/Gateway route carrying the
    /// full node bearer. This is the **load-time** gate that makes a malicious
    /// manifest fail to install rather than fail at call — see
    /// [`validate_cli_command_path`].
    fn validate_surface_commands(&self) -> Result<(), String> {
        let Some(surfaces) = &self.surfaces else {
            return Ok(());
        };
        for entry in surfaces.values() {
            for cmd in &entry.commands {
                validate_cli_command_path(&cmd.path).map_err(|e| {
                    format!(
                        "plugin '{}': cli command '{}' has an invalid path '{}': {e}",
                        self.id, cmd.name, cmd.path
                    )
                })?;
            }
        }
        Ok(())
    }

    /// Cross-validate the capability edges (`requires.capabilities` + `provides`):
    /// version floors/strings parse, and every provided capability's referenced
    /// `sidecar`/`route` actually exists on this manifest — the same declare-by-id
    /// integrity `contributes` enforces, so a typo fails at load, not at bind.
    fn validate_capabilities(&self) -> Result<(), String> {
        for req in self.required_capabilities() {
            if req.capability.trim().is_empty() {
                return Err(format!(
                    "plugin '{}': a required capability has an empty name",
                    self.id
                ));
            }
            if let Some(min) = &req.min_version {
                parse_min_version(min).map_err(|e| {
                    format!(
                        "plugin '{}': required capability '{}' has invalid min_version: {e}",
                        self.id, req.capability
                    )
                })?;
            }
        }
        for prov in &self.provides {
            if prov.capability.trim().is_empty() {
                return Err(format!(
                    "plugin '{}': a provided capability has an empty name",
                    self.id
                ));
            }
            if semver::Version::parse(&prov.version).is_err() {
                return Err(format!(
                    "plugin '{}': provided capability '{}' has invalid version '{}'",
                    self.id, prov.capability, prov.version
                ));
            }
            match (&prov.sidecar, &prov.route) {
                (Some(sc_name), route) => {
                    let Some(sidecar) = self.sidecars.iter().find(|s| &s.name == sc_name) else {
                        return Err(format!(
                            "plugin '{}': provided capability '{}' names sidecar '{}' which is not declared",
                            self.id, prov.capability, sc_name
                        ));
                    };
                    if let Some(route) = route {
                        let declared = sidecar
                            .http
                            .as_ref()
                            .is_some_and(|h| h.routes.iter().any(|r| &r.path == route));
                        if !declared {
                            return Err(format!(
                                "plugin '{}': provided capability '{}' route '{}' is not declared on sidecar '{}'",
                                self.id, prov.capability, route, sc_name
                            ));
                        }
                    }
                }
                (None, Some(_)) => {
                    return Err(format!(
                        "plugin '{}': provided capability '{}' declares a route but no sidecar",
                        self.id, prov.capability
                    ));
                }
                (None, None) => {}
            }
        }
        Ok(())
    }
}

/// One declarative **stdio MCP server** a plugin registers (see
/// [`PluginManifest::mcp_servers`]).
///
/// This is the manifest-side, dependency-free mirror of Core's runtime
/// `McpServerConfig`: pure data (schemars/serde only) so it can live in
/// kernel-contracts, with Core lowering it into its registry type on enable. A
/// server is spawned per request as `command args…` (stdio); `command_env` lets
/// the manifest name an env var Core resolves to an absolute binary path
/// (e.g. `RYU_GHOST_BIN`) so a downloaded `~/.ryu/bin` binary can override the
/// bare `command`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct McpServerDecl {
    /// Executable to spawn (e.g. `npx`, an absolute path, or a `~/.ryu/bin` name).
    pub command: String,

    /// Optional env var whose value, when set, OVERRIDES [`command`] with an
    /// absolute binary path. Lets a plugin ship a bare `command` that Core repoints
    /// at a profile-specific downloaded binary. Absent ⇒ use `command` verbatim.
    ///
    /// [`command`]: McpServerDecl::command
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command_env: Option<String>,

    /// Arguments passed to the command.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,

    /// Extra environment variables for the server process.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub env: BTreeMap<String, String>,

    /// Optional human description for the MCP listing endpoint.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    /// When false, the server is registered but skipped by list/call. Defaults to
    /// true so a bare `{ command }` entry just works.
    #[serde(default = "default_mcp_server_enabled")]
    pub enabled: bool,
}

const fn default_mcp_server_enabled() -> bool {
    true
}

/// Companion surface descriptor — an optional in-desktop overlay or sidebar panel
/// an App may register. Fields mirror the UX primitives a Companion widget needs;
/// all are optional except `label`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct CompanionSurface {
    /// Display label for the companion panel tab or tooltip.
    pub label: String,

    /// Icon identifier (resolved by the desktop shell).
    #[serde(default)]
    pub icon: Option<String>,

    /// Keyboard shortcut string (e.g. `"ctrl+shift+r"`).
    #[serde(default)]
    pub shortcut: Option<String>,
}

/// VS-Code-style **contribution points** (`contributes` in `package.json`).
///
/// The original five surfaces (`commands`/`tools`/`agents`/`workflows`/`policies`)
/// are lists of [`ContributionId`] references into the manifest's `runnables`: the
/// plugin *declares* that runnable `X` contributes to that surface. This is
/// declare-by-id, not a second copy of the runnable — the loader cross-validates
/// that every referenced id exists in `runnables`, so a typo is caught at load.
///
/// Most surfaces added since are **self-contained**: they carry their own payload
/// and reference no runnable at all (`widgets`, `views`, `dock_panels`,
/// `sidebar_sections`, `sidebar_buttons`, `settings_tabs`, `composer_controls`,
/// `slash_commands`, `turn_hooks`, `tool_filters`, `lsp_servers`).
///
/// # Extending
///
/// Adding a surface is two decisions, and getting either wrong is silent:
///
/// 1. **Id-reference or self-contained?** An id-reference surface is a
///    `Vec<ContributionId>` and MUST be chained into [`Contributes::referenced_ids`]
///    so the loader can catch a typo. A self-contained surface must be left OUT of
///    it — every id in it names something other than a runnable (a PATH binary, a
///    route, a tool namespace), so including it would reject every valid manifest.
///    `referenced_ids` therefore covers exactly the five original surfaces and
///    nothing else; that omission is deliberate, not an oversight to be tidied up.
/// 2. **Core-interpreted or client-rendered?** If Core acts on the payload
///    (`tool_filters`, `turn_hooks`, `widgets`, `lsp_servers`) it gets a fully typed
///    struct, because a key Core does not know is by construction a key Core cannot
///    act on. If a client shell renders it (`views`, `dock_panels`,
///    `sidebar_sections`, `settings_tabs`, `composer_controls`) it stays opaque
///    JSON, because deserializing into a struct here would DROP any key this Core
///    build does not know about and a newer desktop would lose exactly the fields it
///    was shipped to render.
///
/// Client-rendered surfaces are then served, tagged with the owning plugin id, from
/// `GET /api/plugins/contributions`. Core-interpreted ones deliberately are not —
/// they are gathered at their own consumption site instead.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, JsonSchema)]
pub struct Contributes {
    /// Command-palette commands the plugin contributes (referenced by runnable id).
    #[serde(default)]
    pub commands: Vec<ContributionId>,

    /// Callable tools the plugin contributes (referenced by runnable id).
    #[serde(default)]
    pub tools: Vec<ContributionId>,

    /// Agents the plugin contributes (referenced by runnable id).
    #[serde(default)]
    pub agents: Vec<ContributionId>,

    /// Workflows the plugin contributes (referenced by runnable id).
    #[serde(default)]
    pub workflows: Vec<ContributionId>,

    /// Gateway policies the plugin contributes (referenced by runnable id).
    #[serde(default)]
    pub policies: Vec<ContributionId>,

    /// Hooks the plugin contributes — server-side logic that runs at a hook
    /// boundary and returns a directive. These are **self-contained** (they carry
    /// their own inline `code`), so they are NOT cross-validated against
    /// `runnables` like the id-reference surfaces above; the Core `plugin_host`
    /// runtime executes them in the sandbox.
    ///
    /// The field name is historical. It originally held only *chat* turn
    /// boundaries (`post_assistant_turn`, `pre_user_turn`); a hook's `on` is now
    /// any hook phase, including an **app event** another plugin declared in its
    /// [`Contributes::hook_events`] (`@example/meetings#meeting.ended`). It is
    /// deliberately NOT renamed: `turn_hooks` is load-bearing in every packaged
    /// manifest, the published JSON Schema, the SDK's TS mirror and the loader's
    /// invariant tests, and the rename would buy nothing but churn.
    #[serde(default)]
    pub turn_hooks: Vec<TurnHookContribution>,

    /// **App events this plugin emits** — the *provider* half of the hook system,
    /// and the mirror image of [`Contributes::turn_hooks`] (the *consumer* half).
    ///
    /// Core's own hook phases (`post_assistant_turn`, `pre_tool_use`, `context`, …)
    /// are a closed set built into `plugin_host`, so before this surface existed a
    /// plugin could only react to things happening *in a chat turn*. An app that
    /// owns a real-world lifecycle — a meeting ending, a workflow run failing, an
    /// alert firing — had no way to let anything else react to it. That forced the
    /// classic anti-pattern: every consumer polls the producer's HTTP routes, and
    /// every new integration is bespoke wiring between two apps that must both be
    /// changed.
    ///
    /// Declaring an event here makes it a first-class hook phase. Any other plugin
    /// consumes it by naming it in a `turn_hooks[].on`, and any workflow consumes it
    /// with an `event` trigger — neither the producer nor Core learns anything about
    /// the consumer. Apps therefore both **provide** and **consume** over one
    /// mechanism.
    ///
    /// # Ids are namespaced, and that is what makes collisions impossible
    ///
    /// Every id MUST be `<owning plugin id>#<event name>` — the owning half is
    /// checked against the manifest's own `id` at load, and the name half is
    /// `[a-z0-9][a-z0-9._-]*`. Because a Core phase name never contains `/`, an app
    /// literally cannot declare an event that shadows one, no reserved-word list
    /// required. It is also why the emit path can authorize purely from the
    /// manifest: the caller's authenticated plugin id must be the id in the event
    /// name, so an app can only ever emit its **own** events.
    ///
    /// # Core-interpreted, so a typed struct
    ///
    /// Core reads this table to authorize emits and to serve the event catalog, so
    /// per this type's own doc comment it gets a typed struct rather than opaque
    /// JSON. It names event strings rather than runnable ids, so it is
    /// **self-contained** and stays out of [`Contributes::referenced_ids`].
    #[serde(default)]
    pub hook_events: Vec<HookEventContribution>,

    /// Declarative **native** UI widgets the plugin contributes to the desktop
    /// composer. Core stores these verbatim and serves them via
    /// `GET /api/plugins/contributions` (tagged with the owning `plugin` id); the
    /// desktop renders the known control types. Opaque to Core (the renderer owns
    /// interpretation) so a new control type needs no Core change — an entry Core has
    /// never heard of is forwarded byte-for-byte, so a desktop newer than the node it
    /// talks to still gets everything it was shipped to render.
    ///
    /// # The control vocabulary
    ///
    /// Every entry is an object carrying `id`, a `type` discriminant, a `label` and a
    /// `flag`; the remaining keys belong to that type. `flag` is universal because the
    /// per-request `plugin_flags` map is the composer's ONLY channel to the turn — a
    /// control the turn hook cannot observe would do nothing. `type` is deliberately NOT
    /// an enum (same reasoning as [`ViewContribution::view`]): an unknown member must
    /// reach a newer shell intact rather than being rejected at load by an older Core.
    /// The vocabulary the desktop composer understands today:
    ///
    /// - `"toggle"` — a switch row in the composer "+" menu, with an optional
    ///   `description`. Flipping it puts `flag: true` into `plugin_flags`. This is the
    ///   original — and until now the ONLY — rendered type.
    /// - `"select"` — a menu/segmented picker. Carries an `options` array of
    ///   `{ value, label, description?, icon? }` plus an optional `default`. The chosen
    ///   `value` (a string, not a bool) lands in `plugin_flags[flag]`, so a plugin can
    ///   offer modes ("fast" / "thorough") instead of on/off.
    /// - `"chip"` — an inline pill in the composer bar showing a LIVE value rather than
    ///   a menu row. Carries an optional `icon` and a `source` (the same
    ///   `@ryu/app-host/views` `ViewSource` a declarative view uses) the shell polls for
    ///   the displayed text, and exposes/clears its value through `flag`. This is what a
    ///   rich bespoke control (a recording indicator, a selected-clip pill) needs in
    ///   order to stop being hand-written host code.
    /// - `"action"` — a button that DISPATCHES rather than holding state. Carries an
    ///   optional `icon` and a `capability` (+ optional `args`) the shell invokes
    ///   through the plugin's granted capability seam — never inline code, and never a
    ///   capability the owning plugin was not granted — then marks `flag` so the turn
    ///   hook sees that it fired.
    ///
    /// A control may also carry `placement` (`"menu"`, the default, or `"bar"`) and
    /// `order`; the renderer, not Core, decides what to do with an unknown key.
    ///
    /// Renderers MUST ignore an entry whose `type` they do not know (the desktop
    /// filters by `type`), so shipping a new control type degrades to "not shown on
    /// older shells" instead of breaking the composer.
    #[serde(default)]
    pub composer_controls: Vec<serde_json::Value>,

    /// Declarative settings tabs the plugin contributes (model pickers, text
    /// fields bound to preference keys). Served + rendered the same way.
    ///
    /// The **contract** for each entry is [`SettingsTabContribution`] — that is what
    /// the published JSON Schema advertises (`schemars(with = …)`) and what the
    /// loader holds every manifest to at import (see `validate_settings_tab`), so a
    /// malformed tab is rejected with a diagnostic instead of reaching the desktop
    /// and being silently dropped by the renderer's defensive parser.
    ///
    /// The *stored* type stays `serde_json::Value` on purpose. `GET
    /// /api/plugins/contributions` tags each entry in place with its owning `plugin`
    /// id and forwards it verbatim; deserializing into the struct here would silently
    /// DROP any key this Core build does not know about, so a desktop newer than the
    /// node it talks to would lose exactly the fields it was shipped to render. Parse
    /// once at the validation chokepoint, forward the original bytes.
    #[serde(default)]
    #[schemars(with = "Vec<SettingsTabContribution>")]
    pub settings_tabs: Vec<serde_json::Value>,

    /// Tools this plugin wants **hidden** from the model's offered tool list —
    /// the declarative half of a tool firewall (see [`ToolFilterContribution`]).
    ///
    /// Purely declarative here: this contract defines and validates the shape, and
    /// the filter is applied where tools are offered to the model. Like
    /// [`Contributes::turn_hooks`] this is self-contained (the ids name tools from
    /// *other* plugins/servers by design — hiding your own tool is just not
    /// declaring it), so it is NOT cross-validated against `runnables`.
    #[serde(default)]
    pub tool_filters: Vec<ToolFilterContribution>,

    /// Slash commands the plugin contributes (e.g. `/goal`). The desktop maps the
    /// command to a `plugin_flags`/message action; the plugin's turn hook reads
    /// the resulting message. Served + rendered the same way.
    #[serde(default)]
    pub slash_commands: Vec<serde_json::Value>,

    /// App widgets the plugin contributes (Ryu Apps). Each binds a tool id to a
    /// `ui://widget/<slug>.html` template the tool renders inline in chat. The
    /// field is shape-identical to the SDK `manifest.ts` `WidgetContribution`.
    #[serde(default)]
    pub widgets: Vec<WidgetContribution>,

    /// **Declarative views** the plugin contributes (the Raycast tier). Each entry
    /// is a [`ViewContribution`]: a typed envelope (`id`/`view`) around an **opaque**
    /// `spec` payload the host renderer interprets. The app returns DATA
    /// (`items`/`columns`/`actions`/`fields`) — never code — and the shell renders it
    /// with the host's own `@ryu/ui` components (desktop) or the compact command-bar
    /// idiom (island), so one spec renders natively on every surface and cannot be
    /// made ugly. Like [`composer_controls`]/[`settings_tabs`] this is **self-contained**
    /// (not cross-validated against `runnables`), and the `view` discriminant + `spec`
    /// stay opaque to Core so a new view kind needs no Core change — the renderer owns
    /// the vocabulary (`list-detail`, `data-table`, `form`, `action-panel`,
    /// `filter-bar`, `empty-state`, `stat-card-row`).
    ///
    /// [`composer_controls`]: Contributes::composer_controls
    /// [`settings_tabs`]: Contributes::settings_tabs
    #[serde(default)]
    pub views: Vec<ViewContribution>,

    /// App-registered sidebar **sections** — a header plus a live list of rows the
    /// shell fetches from a declared Core `/api/` path. Lets an app own its sidebar
    /// section (Canvas/Whiteboard/Meetings recent-doc lists) instead of the shell
    /// hardcoding it. Self-contained + opaque `spec` (see [`SidebarSectionContribution`]),
    /// so a new section capability needs no Core change; served + tagged with the
    /// owning `plugin` id at `GET /api/plugins/contributions`.
    #[serde(default)]
    pub sidebar_sections: Vec<SidebarSectionContribution>,

    /// App-registered sidebar **buttons** — a single nav row (e.g. Memory →
    /// `/library/memory`). The button-shaped sibling of [`Contributes::sidebar_sections`]
    /// (no live list, just a label/icon + a client route). See [`SidebarButtonContribution`].
    #[serde(default)]
    pub sidebar_buttons: Vec<SidebarButtonContribution>,

    /// App-registered **workspace dock panels** — a tab in the desktop's bottom or
    /// right dock (Terminal / Code Review / Browser / Simulator live there today).
    /// This is the seam that lets an app OWN its dock tab instead of the shell
    /// welding the app into a closed `TabKind` union: `@ryu/browser` and
    /// `@ryu/simulator` are apps, and their tabs are contributions, not enum
    /// variants. Self-contained + opaque `spec` (see [`DockPanelContribution`]), so a
    /// new panel capability needs no Core change; served + tagged with the owning
    /// `plugin` id at `GET /api/plugins/contributions`.
    #[serde(default)]
    pub dock_panels: Vec<DockPanelContribution>,

    /// **Language servers** the plugin declares, keyed by server name — the
    /// agent-neutral mirror of Claude Code's `.lsp.json` / `lspServers`, so a config
    /// written for either host loads in the other:
    ///
    /// ```json
    /// "lsp_servers": {
    ///   "go": { "command": "gopls", "args": ["serve"], "extensionToLanguage": { ".go": "go" } }
    /// }
    /// ```
    ///
    /// Only the container key is Ryu's (`lsp_servers`, snake_case like every sibling
    /// here); every key INSIDE a server entry is Claude's own camelCase spelling
    /// verbatim, because that body is what actually travels between the two hosts.
    /// No `lspServers` alias is accepted on purpose. `lsp_servers` — this exact
    /// spelling — is registered in the SDK's zod mirror (`ContributesSchema` in
    /// `packages/sdk/src/manifest.ts`), and that mirror STRIPS every key it does not
    /// list. An alias would therefore parse here and be silently deleted at
    /// `ryu pack` time, before the manifest is signed, which is a worse failure than
    /// a key that never parsed at all. One spelling, registered in both places.
    ///
    /// The plugin ships CONFIG ONLY, never the server binary — `command` is resolved
    /// from `PATH` at spawn time and a missing binary is a visible skip, not a load
    /// error. Core spawns and supervises these processes itself, so unlike the
    /// client-rendered surfaces above this one is fully typed
    /// ([`LspServerContribution`]) and is NOT served from
    /// `GET /api/plugins/contributions`; it is gathered at the spawn site, the same
    /// disposition as [`Contributes::tool_filters`].
    ///
    /// # Ordering is part of the contract
    ///
    /// Registration is **first-registration-wins per file extension**: if two enabled
    /// servers both claim `.go`, the first one registered owns it, the others never
    /// start for that extension, and the spawn site warns naming the owner. That rule
    /// is only reproducible if iteration order is, so this is a [`BTreeMap`] — it
    /// iterates lexicographically by server key, never in hash order and never in
    /// JSON authoring order. The full resolved invariant across a node is
    /// **(plugin enable order, then server key ascending)**.
    ///
    /// Note this makes the tie-break deterministic, not byte-identical to Claude
    /// Code's, which falls out of JS object insertion order. Two servers fighting
    /// over one extension is a misconfiguration in either host; what matters is that
    /// the same node always resolves it the same way and says who won.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub lsp_servers: BTreeMap<String, LspServerContribution>,
}

/// One **declarative view** contribution (the Raycast tier — see [`Contributes::views`]).
///
/// A typed envelope around an opaque `spec`: Core stores it verbatim, tags it with
/// the owning `plugin` id at `GET /api/plugins/contributions`, and forwards it to the
/// surface shell, which maps `view` + `spec` to native components. The `spec` shape is
/// owned by the shared TS vocabulary (`@ryu/app-host/views`), NOT by this contract, so
/// adding a view kind is a renderer change, never a Core change.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ViewContribution {
    /// Stable id for this view within the plugin (route/anchor key, unique per plugin).
    pub id: String,

    /// Optional human-facing title (tab label / palette entry). Absent = the shell
    /// derives one from the view kind or the plugin name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,

    /// The vocabulary member this view renders as — the discriminant the per-surface
    /// renderer switches on (`"list-detail"`, `"data-table"`, `"form"`,
    /// `"action-panel"`, `"filter-bar"`, `"empty-state"`, `"stat-card-row"`). Opaque
    /// to Core; an unknown kind is passed through so a newer shell can render it.
    pub view: String,

    /// The DATA payload for the view (items/columns/actions/fields/…). Opaque to Core
    /// — the shared renderer interprets it per the `view` kind. Absent = an empty view.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spec: Option<serde_json::Value>,
}

/// Which of the desktop shell's workspace docks a [`DockPanelContribution`] opens in.
///
/// Unlike the `panel` discriminant this is a CLOSED enum on purpose: the docks are
/// shell geometry, not app vocabulary — there are exactly two of them (the bottom
/// drawer and the right rail), and an app cannot conjure a third. Adding a dock is a
/// shell change, so it is correct for it to also be a contract change here.
///
/// Closed does NOT mean "fails the load", though: see
/// [`deserialize_dock_panel_placement`]. The set of valid values being fixed and the
/// blast radius of an unrecognised one are separate decisions, and the second answer
/// has to match every sibling vocabulary field in this file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum DockPanelPlacement {
    /// The bottom drawer (Terminal / Code Review sit here).
    #[default]
    Bottom,
    /// The right rail (Files / Changes sit here).
    Right,
    /// Offered in BOTH docks — the user picks where to open it. This is what the
    /// Browser and Simulator tabs do today.
    Both,
}

impl DockPanelPlacement {
    /// The concrete docks this placement offers the panel in. `Both` fans out to the
    /// two real docks so a renderer never has to special-case the fan-out itself.
    pub fn docks(self) -> &'static [DockPanelPlacement] {
        match self {
            Self::Bottom => &[Self::Bottom],
            Self::Right => &[Self::Right],
            Self::Both => &[Self::Bottom, Self::Right],
        }
    }
}

/// Coerce a raw `placement` value to a known [`DockPanelPlacement`]: anything that is
/// not `"right"` or `"both"` — including a null, a number, or a dock name from a
/// future shell — resolves to [`DockPanelPlacement::Bottom`], the same value a missing
/// key gets.
///
/// Same reasoning as [`deserialize_settings_scope`], and it is what keeps the closed
/// enum honest. `placement` is closed because the docks are shell geometry, but that
/// only fixes the *set of valid values* — it says nothing about what an unrecognised
/// one should COST. Serde's derived enum deserializer makes it a hard parse error,
/// which takes the entire manifest down (every runnable, sidecar and tool the plugin
/// ships) over one cosmetic geometry hint. And the hazard is live by the enum's own
/// admission that "adding a dock is a shell change": the moment a newer shell grows a
/// third dock, every older Core would refuse to load an app that opts into it, rather
/// than merely opening its panel in the drawer. That would also contradict the sibling
/// `panel` field two lines away, whose whole point is that an unknown member must
/// reach a newer shell intact instead of being rejected at load by an older Core.
///
/// The verbatim string survives on the wire regardless — `GET
/// /api/plugins/contributions` re-serializes this struct, so a shell that understands
/// the newer dock reads it from a manifest its own Core parsed leniently.
fn deserialize_dock_panel_placement<'de, D>(deserializer: D) -> Result<DockPanelPlacement, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = serde_json::Value::deserialize(deserializer)?;
    Ok(match raw.as_str() {
        Some("right") => DockPanelPlacement::Right,
        Some("both") => DockPanelPlacement::Both,
        _ => DockPanelPlacement::Bottom,
    })
}

/// One app-registered **workspace dock panel** — a tab in the desktop's bottom or
/// right dock (see [`Contributes::dock_panels`]).
///
/// The dock sibling of [`ViewContribution`] / [`SidebarSectionContribution`]: a typed
/// envelope (`id` / `title` / `icon` / `placement`) around an OPAQUE description of
/// what the tab renders. Core stores it verbatim, tags it with the owning `plugin` id
/// at `GET /api/plugins/contributions`, and never interprets `panel` or `spec` — so a
/// new panel capability is a renderer change, never a Core change.
///
/// # The `panel` vocabulary
///
/// `panel` is the render-mode discriminant the desktop's dock renderer switches on.
/// It is a plain `String` (not an enum) for the same reason [`ViewContribution::view`]
/// is: an unknown member must reach a newer shell intact rather than being rejected at
/// load by an older Core. The vocabulary the desktop understands today:
///
/// - `"companion"` — mount the app's sandboxed companion surface in the dock. The
///   `spec` names it: `{ "companion": "<runnable id>" }`. This is the third-party
///   path: an app ships one companion UI and can surface it in the dock, the sidebar,
///   or a full tab without any host code.
/// - `"view"` — render one of the plugin's own [`Contributes::views`] entries inside
///   the dock chrome: `{ "view": "<view id>" }`. Data-only, drawn with the host's own
///   `@ryu/ui` components, so a dock panel gets the Raycast tier for free.
/// - `"native"` — the shell's OWN component, registered under `<plugin>/<id>`. This is
///   the migration seam for first-party apps whose panel is hand-written React driving
///   their sidecar through the ext-proxy (`@ryu/browser`, `@ryu/simulator`): the
///   *component* stays in the shell, but its existence, label, icon and placement stop
///   being a hardcoded `TabKind` variant and become the app's own declaration, so
///   disabling the app removes the tab. An unknown `<plugin>/<id>` simply renders
///   nothing — a native panel is never a code channel.
///
/// The full `spec` shape is owned by the shared TS vocabulary (`@ryu/app-host/views`
/// `DockPanelSpec`), NOT by this contract.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct DockPanelContribution {
    /// Stable id for this panel within the plugin (the dock's tab key, namespaced by
    /// the shell as `plugin:<pluginId>:<id>` so two apps can reuse an id).
    pub id: String,

    /// Tab label shown on the dock tab strip and in the "new tab" menu.
    pub title: String,

    /// Optional glyph id resolved by the shell's Icon primitive (Iconify/Hugeicons).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,

    /// Which dock the panel opens in. Defaults to [`DockPanelPlacement::Bottom`], the
    /// drawer a terminal-shaped panel belongs in — and falls back to it for an
    /// unrecognised dock too, rather than failing the whole manifest
    /// (see [`deserialize_dock_panel_placement`]).
    #[serde(default, deserialize_with = "deserialize_dock_panel_placement")]
    pub placement: DockPanelPlacement,

    /// Optional ordering hint within the dock's tab-type menu (lower = earlier).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<i64>,

    /// The render-mode discriminant (`"companion"`, `"view"`, `"native"`, …). Opaque
    /// to Core; an unknown member is passed through so a newer shell can render it.
    pub panel: String,

    /// The payload for the render mode (`{ "companion": … }` / `{ "view": … }` / any
    /// future panel capability). Opaque to Core — the desktop dock renderer interprets
    /// it per `panel`. Absent = the mode needs no payload (the `"native"` case).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spec: Option<serde_json::Value>,
}

/// One **language server** a plugin declares (see [`Contributes::lsp_servers`]).
///
/// Field-for-field Claude Code's language-server config, camelCase on the wire, so
/// the same JSON body loads in either host. Required by Claude's spec: `command`
/// and `extensionToLanguage`. Everything else is optional and defaulted here to
/// Claude's documented default.
///
/// # Why `command` and `extensionToLanguage` are `#[serde(default)]` anyway
///
/// They are required by the SPEC, not by serde, and that is deliberate. Claude Code
/// **skips** a server whose config is invalid and starts the rest; making either
/// field a non-defaulted serde field would instead turn a missing one into a parse
/// error on the entire [`PluginManifest`], costing the plugin every runnable,
/// sidecar and tool it ships over one broken language-server entry. Defaulting them
/// is what makes the per-server skip reachable at all: the manifest parses, and
/// [`LspServerContribution::validate`] reports the reason at the spawn site.
///
/// Unknown keys are dropped rather than rejected (no `deny_unknown_fields`
/// anywhere in this file), so a field from a newer Claude release costs a plugin
/// nothing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LspServerContribution {
    /// The server executable, resolved from `PATH` at spawn time (`gopls`,
    /// `rust-analyzer`, `typescript-language-server`, …).
    ///
    /// The plugin ships the CONFIG, never the binary. A `command` that is not on
    /// `PATH` is a graceful skip with a visible reason — the user is told which
    /// server did not start and why, and the rest of the node is unaffected.
    /// Defaulted to `""` so a missing one is a skipped server, not a dead manifest
    /// (see the type doc).
    #[serde(default)]
    pub command: String,

    /// Arguments passed to [`command`](LspServerContribution::command)
    /// (e.g. `["serve"]` for `gopls`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,

    /// File extension → LSP language id (`{ ".go": "go" }`) — the map that decides
    /// which files this server handles, and the thing two servers can collide on.
    ///
    /// Claude Code authors keys with a leading dot and in lowercase; a hand-written
    /// manifest will not always. Compare through
    /// [`normalize_lsp_extension_key`] (or read
    /// [`normalized_extensions`](LspServerContribution::normalized_extensions))
    /// rather than indexing this map directly, so `go`, `.go` and `.GO` all resolve
    /// to the same entry. Empty ⇒ the server claims nothing and is skipped.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub extension_to_language: BTreeMap<String, String>,

    /// How the host talks to the server: `"stdio"` (the default, and the only
    /// transport Core implements today) or `"socket"`.
    ///
    /// A plain `String` and not an enum, matching this file's other discriminants
    /// ([`ViewContribution::view`], [`DockPanelContribution::panel`]). The reason is
    /// sharper here than for those: [`DockPanelPlacement`] can afford to coerce an
    /// unrecognised value to its default because a panel opening in the wrong dock is
    /// cosmetic, whereas coercing an unrecognised transport to `stdio` would spawn a
    /// process and then speak a protocol it does not understand. The verbatim string
    /// survives instead, and the spawn site refuses what it cannot drive — see
    /// [`LspTransport`] and [`LspServerContribution::transport_kind`].
    #[serde(default = "default_lsp_transport")]
    pub transport: String,

    /// Extra environment variables for the server process, merged over the inherited
    /// environment.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub env: BTreeMap<String, String>,

    /// Sent verbatim as `initializationOptions` in the LSP `initialize` request.
    /// Opaque JSON on purpose: the shape is the individual language server's, and
    /// Ryu is a courier for it, not an interpreter. Absent = send none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub initialization_options: Option<serde_json::Value>,

    /// Sent verbatim as the payload of `workspace/didChangeConfiguration` once the
    /// server is initialized. Opaque for the same reason as
    /// [`initialization_options`](LspServerContribution::initialization_options).
    /// Absent = send nothing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub settings: Option<serde_json::Value>,

    /// Root directory the server is rooted at. Absent (the common case) = the
    /// session's workspace root, which is why this is an `Option` rather than a
    /// defaulted `String`: "unset, inherit the workspace" and "explicitly rooted
    /// somewhere" are different instructions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_folder: Option<String>,

    /// Milliseconds to wait for `initialize` to come back before giving up on the
    /// server. Absent = the spawn site's own default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub startup_timeout: Option<u64>,

    /// Milliseconds to wait for a clean `shutdown`/`exit` before killing the
    /// process. Absent = the spawn site's own default.
    ///
    /// That default is the one place this type knowingly parts company with Claude
    /// Code, whose reference says an unset `shutdownTimeout` means **no timeout
    /// applies** — it waits on a wedged server indefinitely. Ryu's spawn sites
    /// impose a finite one (5s in `assets/pi-extensions/ryu-lsp.ts`, documented at
    /// the constant), because Pi is spawned per session and an unbounded wait would
    /// hold every teardown open behind one unresponsive server. An explicitly
    /// declared value is honoured verbatim, so a config written for either host
    /// still behaves identically; only the *unset* case differs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shutdown_timeout: Option<u64>,

    /// Restart the server when it exits unexpectedly. Defaults to **true** (Claude
    /// Code parity).
    ///
    /// Note this needs an explicit default fn: a bare `#[serde(default)]` on a
    /// `bool` yields `false` and would silently invert the documented behaviour.
    /// Like [`McpServerDecl::enabled`] it carries no `skip_serializing_if`, so the
    /// value always ships and a reader never has to know the default.
    #[serde(default = "default_lsp_restart_on_crash")]
    pub restart_on_crash: bool,

    /// Cap on automatic restarts before the server is left down. Absent = the spawn
    /// site's own default; meaningless when
    /// [`restart_on_crash`](LspServerContribution::restart_on_crash) is false.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_restarts: Option<u32>,

    /// Push this server's diagnostics into the model's context after edits. Defaults
    /// to **true** (Claude Code parity); same `default` caveat as
    /// [`restart_on_crash`](LspServerContribution::restart_on_crash).
    #[serde(default = "default_lsp_diagnostics")]
    pub diagnostics: bool,
}

fn default_lsp_transport() -> String {
    LspTransport::STDIO.to_owned()
}

const fn default_lsp_restart_on_crash() -> bool {
    true
}

const fn default_lsp_diagnostics() -> bool {
    true
}

/// The transports a [`LspServerContribution::transport`] string can resolve to.
///
/// A classification of the wire string, NOT the serialized form of it — the
/// manifest keeps the author's verbatim value (see the field doc). `Unsupported`
/// exists so the spawn site has a name for "parsed fine, cannot be driven", which
/// is the honest status of `"socket"` today: nothing in Claude Code's documented
/// field set carries a host or a port, so a socket server would validate and then
/// have nowhere to connect. Until that gap is resolved upstream, a socket server is
/// skipped with a visible reason — the same treatment as a `command` that is not on
/// `PATH`, and strictly better than a config that looks live and silently is not.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LspTransport {
    /// Spawn the server as a child process and speak LSP over its stdin/stdout.
    Stdio,
    /// Connect to an already-listening server over a socket. Parsed, not implemented.
    Socket,
    /// A transport this build does not know. Never guessed at.
    Unsupported,
}

impl LspTransport {
    /// The wire spelling of [`LspTransport::Stdio`], and the value a manifest that
    /// omits `transport` is given.
    pub const STDIO: &'static str = "stdio";

    /// The wire spelling of [`LspTransport::Socket`].
    pub const SOCKET: &'static str = "socket";
}

/// Normalise a file-extension key to the form used for server lookup: trimmed,
/// lowercased, with exactly one leading dot. `go`, `.go`, `.GO` and ` .Go ` all
/// become `.go`.
///
/// Claude Code writes `".go"`, but a hand-written manifest reasonably writes `"go"`,
/// and a file on disk is `main.GO` on a case-insensitive volume. Routing on the raw
/// key would make those three different languages.
///
/// Takes an EXTENSION, not a filename: `"main.go"` normalises to `".main.go"` and
/// matches nothing. A caller holding a path must split the extension off first.
pub fn normalize_lsp_extension_key(raw: &str) -> String {
    let trimmed = raw.trim().to_lowercase();
    if trimmed.is_empty() || trimmed.starts_with('.') {
        trimmed
    } else {
        format!(".{trimmed}")
    }
}

impl LspServerContribution {
    /// Can this server be started as declared? `Ok(())`, or a human-facing reason
    /// naming `server_name`.
    ///
    /// The two conditions are Claude Code's: an empty `command`, or an empty
    /// `extensionToLanguage`. A server that fails either is **skipped** — the other
    /// servers still start and it does NOT claim its extensions, so a sibling server
    /// declaring the same extension gets it.
    ///
    /// Deliberately NOT wired into [`Contributes::validate_settings_contributions`],
    /// even though [`validate_tool_filter`] is called from there and this looks like
    /// the same shape. The loader `?`s that function, so one `Err` skips the WHOLE
    /// manifest with a warning — the precise outcome Claude's "skip the server, start
    /// the others" rule exists to avoid. This stays a pure helper the spawn site
    /// calls per server, turning `Err` into a skip plus a visible warning.
    ///
    /// Transport support is a SEPARATE gate: a `"socket"` server is valid config and
    /// passes here, but cannot be driven today. The spawn site must check
    /// [`transport_kind`](LspServerContribution::transport_kind) as well.
    pub fn validate(&self, server_name: &str) -> Result<(), String> {
        if self.command.trim().is_empty() {
            return Err(format!(
                "lsp server '{server_name}' declares no 'command' and cannot be started"
            ));
        }
        if self.extension_to_language.is_empty() {
            return Err(format!(
                "lsp server '{server_name}' declares an empty 'extensionToLanguage' and would handle no files"
            ));
        }
        Ok(())
    }

    /// Classify [`transport`](LspServerContribution::transport). Absent/empty and any
    /// casing of `"stdio"` are [`LspTransport::Stdio`]; `"socket"` is
    /// [`LspTransport::Socket`]; anything else is [`LspTransport::Unsupported`] and
    /// is never guessed into a transport that would spawn a process.
    pub fn transport_kind(&self) -> LspTransport {
        let t = self.transport.trim().to_lowercase();
        match t.as_str() {
            "" | LspTransport::STDIO => LspTransport::Stdio,
            LspTransport::SOCKET => LspTransport::Socket,
            _ => LspTransport::Unsupported,
        }
    }

    /// This server's `extensionToLanguage` map with every key run through
    /// [`normalize_lsp_extension_key`] — the form an extension→server registry
    /// should index on.
    ///
    /// Two raw keys that normalise to the same extension (`"go"` and `".GO"`) keep
    /// the FIRST by the source map's ascending key order, mirroring the
    /// first-registration-wins rule that resolves the same collision between two
    /// servers.
    pub fn normalized_extensions(&self) -> BTreeMap<String, String> {
        let mut out = BTreeMap::new();
        for (ext, language) in &self.extension_to_language {
            let key = normalize_lsp_extension_key(ext);
            if key.is_empty() {
                continue;
            }
            out.entry(key).or_insert_with(|| language.clone());
        }
        out
    }

    /// The LSP language id this server declares for `extension`, comparing through
    /// [`normalize_lsp_extension_key`] on both sides so the author's spelling and the
    /// caller's need not match. Takes an extension, not a filename.
    pub fn language_for_extension(&self, extension: &str) -> Option<String> {
        let wanted = normalize_lsp_extension_key(extension);
        if wanted.is_empty() {
            return None;
        }
        self.extension_to_language
            .iter()
            .find(|(ext, _)| normalize_lsp_extension_key(ext) == wanted)
            .map(|(_, language)| language.clone())
    }
}

/// One app-registered **sidebar section** — a header plus a live list of rows the
/// desktop's compact sidebar renderer draws (the app-owned replacement for the
/// hardcoded Canvas/Whiteboard/Meetings sections). A typed envelope around an opaque
/// `spec` (the `SidebarSectionSpec` in `@ryu/app-host/views`: a `ViewSource` for the
/// rows, an `itemTarget` route template for `openTab`, optional `itemActions` and a
/// `create` action). Core stores it verbatim and tags it with the owning `plugin` id;
/// the `spec` stays opaque so a new section capability is a renderer change, not a
/// Core change.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct SidebarSectionContribution {
    /// Stable id for this section within the plugin (namespaced into the shell's
    /// section key as `plugin:<pluginId>:<id>`).
    pub id: String,

    /// Header label shown in the sidebar and the Customize dialog.
    pub title: String,

    /// Optional glyph id resolved by the shell's Icon primitive (Iconify/Hugeicons).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,

    /// Optional placement hint among the sidebar sections (lower = higher up).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<i64>,

    /// The opaque section spec (source/itemTarget/itemActions/create). Interpreted by
    /// the desktop renderer, never by Core. Absent = a header with no rows.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spec: Option<serde_json::Value>,
}

/// One app-registered **sidebar button** — a single nav row (the button-shaped
/// sibling of [`SidebarSectionContribution`]). No live list: just a label/icon and a
/// client route the shell opens with `openTab`. Migrates hardcoded header-chrome
/// buttons (e.g. Memory) to the owning app.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct SidebarButtonContribution {
    /// Stable id for this button within the plugin.
    pub id: String,

    /// Button label.
    pub title: String,

    /// Optional glyph id resolved by the shell's Icon primitive.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,

    /// The client route this button opens (e.g. `"/library/memory"`).
    pub target: String,

    /// Optional placement hint among the sidebar buttons.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<i64>,
}

/// One app-widget contribution (Ryu Apps). Binds the tool that renders the widget
/// to its HTML template. `ui_entry` is the source entry the SDK `ryu pack` builds
/// into the self-contained HTML for third-party apps; built-in apps serve HTML
/// from the in-process provider and leave it unset.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct WidgetContribution {
    /// The fully-qualified tool id whose result renders this widget.
    pub tool_id: String,
    /// `ui://widget/<slug>.html` — the widget resource uri.
    pub uri: String,
    /// Source entry (e.g. `src/apps/checklist/index.tsx`) for `ryu pack`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ui_entry: Option<String>,
    /// Widget MIME dialect (default `text/html+skybridge`).
    #[serde(default = "default_widget_mime")]
    pub mime: String,
    /// Default display mode (`inline` | `fullscreen` | `pip`).
    #[serde(default = "default_widget_display_mode")]
    pub default_display_mode: String,
}

fn default_widget_mime() -> String {
    "text/html+skybridge".to_owned()
}

fn default_widget_display_mode() -> String {
    "inline".to_owned()
}

/// A server-side chat turn hook contributed by a plugin. The `code` is a JS body
/// run in the plugin sandbox with `ctx` (the turn context) and `host` (the
/// capability bridge: `host.sideModel`, `host.storage`, `host.log`) in scope; it
/// returns a directive (`{kind:"none"}` | `{kind:"note",text}` |
/// `{kind:"continue",text}`). See Core's `plugin_host`.
///
/// The body is authored as a **file** ([`code_file`]) and hydrated into [`code`]
/// at parse time — see [`PluginManifest::hydrate_code_files`] for why the two
/// fields are a source-form/wire-form pair rather than alternatives.
///
/// [`code`]: Self::code
/// [`code_file`]: Self::code_file
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct TurnHookContribution {
    /// Stable id for this hook (for logging/audit), unique within the plugin.
    pub id: String,
    /// The turn boundary this hook fires on. Today only `"post_assistant_turn"`.
    pub on: String,
    /// The JS hook body executed in the sandbox (returns a directive).
    ///
    /// Empty in a **source** manifest that declares [`Self::code_file`] instead;
    /// [`PluginManifest::hydrate_code_files`] fills it in before any consumer sees
    /// the manifest, and [`PluginManifest::validate`] refuses a manifest where it
    /// is still empty. Every read site therefore keeps reading exactly this field.
    #[serde(default)]
    pub code: String,
    /// Path to the file holding the hook body, relative to the plugin root
    /// (`hooks/<name>.js`) — the authoring form. Mutually exclusive with
    /// [`Self::code`]; see [`PluginManifest::hydrate_code_files`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code_file: Option<String>,
    /// Optional cheap pre-gate. When present, Core's `plugin_host` evaluates it
    /// in Rust **before** spawning the sandbox, so an idle hook (e.g. double-check
    /// with its toggle off, or goal with no active condition) costs a flag/prefix
    /// check or one KV read instead of a Deno process. This is what makes it safe
    /// to ship these hooks **enabled by default** on every surface. Absent (or all
    /// fields empty) → the hook always runs, preserving prior behaviour.
    #[serde(default, rename = "match")]
    pub run_when: Option<HookMatch>,
}

/// A declarative pre-gate for a [`TurnHookContribution`]. The conditions are
/// OR-ed: the hook runs if **any** present condition matches. An empty match
/// (every field default) means "always run". Kept intentionally small — richer
/// matching belongs inside the hook JS, this only exists to skip the sandbox
/// spawn on turns where the hook provably cannot act.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, JsonSchema)]
pub struct HookMatch {
    /// Run only if the request set this composer flag true (`ctx.flags[flag]`),
    /// e.g. `"io.ryu.double-check"`.
    #[serde(default)]
    pub flag: Option<String>,
    /// Run if the last user message (trimmed) starts with any of these prefixes,
    /// e.g. `["/goal"]`. This is how a slash-command hook wakes up.
    #[serde(default)]
    pub commands: Vec<String>,
    /// Run if the plugin has stored state for this conversation (its default KV
    /// namespace has a value keyed by `conversation_id`), e.g. an active goal.
    #[serde(default)]
    pub stateful: bool,
    /// Run if the tool being called (`ctx.tool_name`) matches any of these
    /// patterns — for `pre_tool_use` / `post_tool_use` hooks. A pattern is a tool
    /// id with optional leading/trailing `*` wildcards (`"*"` = every tool,
    /// `"bash*"` = ids starting with `bash`). This keeps a tool-firewall hook from
    /// spawning the sandbox on every unrelated tool call.
    #[serde(default)]
    pub tools: Vec<String>,
}

/// One **app event** a plugin declares it emits (a [`Contributes::hook_events`]
/// row). This is a *declaration*, not code: the event is raised at runtime by the
/// plugin's own sidecar calling the `events.emit` kernel capability, and Core
/// checks the emit against this table.
///
/// The payload the emitter sends is delivered to every consumer as `ctx.event`, so
/// [`Self::payload_example`] is the contract a consumer author reads. Keep it
/// honest — it is the only description of the payload anyone gets.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct HookEventContribution {
    /// The fully-qualified event id: `<owning plugin id>#<event name>`, e.g.
    /// `@example/meetings#meeting.ended`. Validated at load against the owning
    /// manifest's `id`; see [`Contributes::hook_events`] for why the namespace is
    /// mandatory rather than conventional.
    ///
    /// Name the event after **what happened**, in the past tense, never after who
    /// should react to it: a consumer that renames the producer's event to suit
    /// itself is exactly the coupling this surface removes. The house patterns are
    /// `x.started` / `x.ended` / `x.failed` for a lifecycle, `x.ready` for a
    /// produced artifact, and `x.created` / `x.updated` / `x.deleted` for state.
    pub id: String,
    /// Human-readable title for the event picker (workflow trigger UI, docs).
    pub title: String,
    /// What the event means and, critically, *when* it fires — including whether it
    /// can fire more than once for the same subject.
    #[serde(default)]
    pub description: Option<String>,
    /// An example of the payload delivered as `ctx.event`. Documentation, not a
    /// schema: Core forwards whatever the emitter sends verbatim and validates
    /// nothing beyond the size cap, so this exists for the human writing a consumer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload_example: Option<serde_json::Value>,
}

/// The separator between the owning plugin id and the event name in a
/// [`HookEventContribution::id`].
///
/// `#` and not `/`, because a **scoped plugin id contains a slash**
/// (`@ryu/meetings`) — a `/` separator would make `@ryu/meetings/meeting.ended`
/// ambiguous between "scope `@ryu`, plugin `meetings`" and any other split. `#` also
/// cannot appear in an id at all (see [`validate_plugin_id`]), and no Core hook phase
/// name contains it (they are bare `[a-z_]+` words), so the two namespaces still
/// cannot collide — which is the property this separator exists to guarantee.
///
/// Safe in every context an event id actually travels through: manifest JSON, the
/// workflow `event` trigger field, and the picker. Event ids never appear in a URL
/// path or query, where `#` would truncate.
pub const HOOK_EVENT_SEPARATOR: char = '#';

/// Split a fully-qualified app-event id into `(owning plugin id, event name)`, or
/// `None` when it is not app-event shaped (i.e. it is a Core phase name).
///
/// The owner half may itself contain a `/` (a scoped id like `@ryu/meetings`); only
/// the [`HOOK_EVENT_SEPARATOR`] delimits owner from event name.
///
/// The one place the namespace rule is implemented. Load-time validation, the emit
/// authorization check and the consumer catalog all route through it, so they cannot
/// drift into three subtly different parsers.
#[must_use]
pub fn split_hook_event_id(id: &str) -> Option<(&str, &str)> {
    let (owner, name) = id.split_once(HOOK_EVENT_SEPARATOR)?;
    if owner.is_empty() || name.is_empty() || name.contains(HOOK_EVENT_SEPARATOR) {
        return None;
    }
    Some((owner, name))
}

/// Whether `on` names an **app event** rather than one of Core's built-in hook
/// phases. Purely structural: app events are namespaced, Core phases are bare words.
#[must_use]
pub fn is_app_event(on: &str) -> bool {
    split_hook_event_id(on).is_some()
}

/// Validate one [`HookEventContribution`] against the manifest that declares it.
/// Returns a diagnostic string on rejection.
///
/// Fail-closed at load rather than at emit: a malformed id would otherwise become an
/// event that can be declared and consumed but never successfully emitted — a
/// silently dead subscription, which is the worst failure mode this surface has.
///
/// # Errors
/// Returns `Err` when the id is not `<plugin_id>/<name>` shaped, is namespaced to a
/// different plugin, or the name half is not `[a-z0-9][a-z0-9._-]*`.
pub fn validate_hook_event(event: &HookEventContribution, plugin_id: &str) -> Result<(), String> {
    let Some((owner, name)) = split_hook_event_id(&event.id) else {
        return Err(format!(
            "hook_events[{}]: id must be `<plugin id>#<event name>` (e.g. `{plugin_id}#thing.ended`)",
            event.id
        ));
    };
    if owner != plugin_id {
        return Err(format!(
            "hook_events[{}]: namespaced to `{owner}` but declared by `{plugin_id}` — a plugin may only declare events in its own namespace",
            event.id
        ));
    }
    let valid_name = name
        .chars()
        .next()
        .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-'));
    if !valid_name {
        return Err(format!(
            "hook_events[{}]: event name `{name}` must match [a-z0-9][a-z0-9._-]*",
            event.id
        ));
    }
    if event.title.trim().is_empty() {
        return Err(format!(
            "hook_events[{}]: title must not be empty",
            event.id
        ));
    }
    Ok(())
}

/// Which settings dialog a [`SettingsTabContribution`] belongs in.
///
/// The two dialogs are not cosmetic: a `node` preference is stored on the node and
/// is therefore shared by **every** user of that node, while a `user` preference is
/// client-local. Defaulting to `node` preserves the historical behaviour (tabs
/// always wrote node-scoped preferences through the active node); a plugin that
/// wants a per-user knob has to say so.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SettingsScope {
    /// Affects the whole node/gateway — shared by every user on it. The default.
    #[default]
    Node,
    /// Per-user / client-local, like appearance. Rendered in App Settings.
    User,
}

/// Coerce a raw `scope` value to a known [`SettingsScope`]: anything that is not
/// the literal string `"user"` — including a null, a number, or a scope name from a
/// future Core — resolves to [`SettingsScope::Node`].
///
/// This mirrors the desktop's `parseScope` byte for byte, and deliberately does NOT
/// use serde's derived enum deserializer: that would make an unrecognised scope a
/// hard parse error and take the *entire manifest* down (every runnable, sidecar and
/// tool the plugin ships) over one cosmetic routing hint. Falling back to the
/// safer-to-render dialog keeps the plugin working.
fn deserialize_settings_scope<'de, D>(deserializer: D) -> Result<SettingsScope, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = serde_json::Value::deserialize(deserializer)?;
    Ok(if raw.as_str() == Some("user") {
        SettingsScope::User
    } else {
        SettingsScope::Node
    })
}

/// The control one [`SettingsFieldContribution`] renders as.
///
/// This list is the desktop renderer's `FieldControl` switch, transcribed: every
/// variant here has a real control behind it, and there is nothing the renderer
/// handles that is missing. Adding a variant means teaching the renderer first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SettingsFieldType {
    /// Single-line text input. The default for a field that omits `type`.
    #[default]
    Text,
    /// Multi-line text input.
    Textarea,
    /// Numeric input (still persisted as a bare string, like every preference).
    Number,
    /// On/off switch, persisted as `"true"`/`"false"`.
    Toggle,
    /// Dropdown over the field's declared `options` (which are then REQUIRED).
    Select,
    /// The composer's provider/model picker, so "which model runs this" is a
    /// catalog pick rather than a typo-prone free-text string. Persists a bare
    /// model id.
    ModelPicker,
    /// The composer's FULL target picker — agent, provider, model, thinking
    /// level, reasoning effort, and ACP access mode — persisted as one
    /// `AgentSelection` JSON object.
    ///
    /// Prefer this over [`ModelPicker`](Self::ModelPicker) when the plugin can
    /// be served by an *agent* and not only a raw model call; a field left
    /// unset inherits the node-wide default selection either way, since the
    /// resolver reads both forms from the same key.
    AgentPicker,
    /// A **write-only masked** credential input — the BYOK control.
    ///
    /// Unlike every other variant, this one does NOT persist to preferences. The
    /// value is submitted to `PUT /api/plugins/{id}/secrets/{key}` and stored
    /// **encrypted at rest** in the per-plugin secret store, keyed by
    /// `(plugin_id, pref_key)`. It is never read back: the renderer can ask
    /// whether a secret is set (`GET /api/plugins/{id}/secrets` returns names and
    /// timestamps, never values) and shows "Set" or "Not set" beside an empty
    /// input. Submitting a blank value CLEARS the secret.
    ///
    /// The stored value is what a manifest's `secret_headers` `env:VARNAME` token
    /// falls back to when the process environment has no such var, so `pref_key`
    /// must be the ENV VAR NAME the manifest already names (e.g.
    /// `RYU_TAVILY_API_KEY`), not a preference-style dotted key. Process env still
    /// wins when both are set, and the same namespace gate that restricts which
    /// vars a plugin may read applies to the stored value.
    Secret,
}

/// Coerce a raw field `type` to a known [`SettingsFieldType`], falling back to
/// [`SettingsFieldType::Text`] for anything unrecognised.
///
/// Same reasoning as [`deserialize_settings_scope`], plus one more: the renderer's
/// `default:` branch *already* draws an unknown type as a text input, so a plugin
/// that declares a control a newer desktop understands still renders usefully on an
/// older one. Rejecting the manifest instead would make the plugin unusable rather
/// than merely plain-looking. The verbatim string survives on the wire regardless —
/// [`Contributes::settings_tabs`] forwards the original JSON, not this struct.
fn deserialize_settings_field_type<'de, D>(deserializer: D) -> Result<SettingsFieldType, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = serde_json::Value::deserialize(deserializer)?;
    Ok(match raw.as_str() {
        Some("textarea") => SettingsFieldType::Textarea,
        Some("number") => SettingsFieldType::Number,
        Some("toggle") => SettingsFieldType::Toggle,
        Some("select") => SettingsFieldType::Select,
        Some("model_picker") => SettingsFieldType::ModelPicker,
        Some("agent_picker") => SettingsFieldType::AgentPicker,
        // NOTE the asymmetry with every arm above: an older desktop that does not
        // know `secret` falls back to a plain TEXT input, which would persist the
        // typed credential to preferences in the clear. That is a renderer
        // obligation, not a parser one — the fallback here only decides what this
        // Core believes the field is, and Core reads `Secret` to route the write to
        // the encrypted store instead of the preference KV.
        Some("secret") => SettingsFieldType::Secret,
        _ => SettingsFieldType::Text,
    })
}

/// One selectable option for a [`SettingsFieldType::Select`] field.
///
/// Accepts both spellings the desktop's `parseOptions` accepts: a bare string
/// (value and label are the same) or an object with an explicit `label`. Keeping
/// both is not indulgence — the bare-string form is what every hand-written
/// manifest reaches for, and rejecting it would push authors into boilerplate for
/// the common case.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum SettingsFieldOption {
    /// `"fast"` — the stored value doubles as the label.
    Value(String),
    /// `{ "value": "fast", "label": "Fast" }`.
    Labeled {
        /// The value persisted to the preference key.
        value: String,
        /// Display label. Absent = show the raw `value`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        label: Option<String>,
    },
}

impl SettingsFieldOption {
    /// The value this option persists.
    pub fn value(&self) -> &str {
        match self {
            Self::Value(value) | Self::Labeled { value, .. } => value,
        }
    }

    /// The label this option displays (the value itself when none was given).
    pub fn label(&self) -> &str {
        match self {
            Self::Value(value) => value,
            Self::Labeled { value, label } => label.as_deref().unwrap_or(value),
        }
    }
}

/// One configurable field inside a [`SettingsTabContribution`], bound to exactly
/// one preference key.
///
/// `pref_key` is both the storage binding (`GET/PUT /api/preferences/:key`) **and**
/// the field's identity — the renderer keys its React elements by it — so two
/// fields sharing one `pref_key` inside a tab is a bug, not a shorthand, and the
/// loader rejects it.
///
/// The `default`/`required`/`min`/`max`/`min_length`/`max_length` block is
/// validation metadata: declaring it is how a plugin gets its settings checked at
/// *import* instead of discovering at runtime that a user typed `"maybe"` into what
/// the hook reads as a number. It is cross-checked against `type` at load, because
/// validation metadata that is silently ignored (a `min` on a toggle) is worse than
/// none — it reads as a guarantee that was never enforced.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct SettingsFieldContribution {
    /// The control to render. Absent or unrecognised = a plain text input.
    #[serde(
        default,
        rename = "type",
        deserialize_with = "deserialize_settings_field_type"
    )]
    pub field_type: SettingsFieldType,

    /// The preference key this field reads/writes. Required, non-empty, and
    /// restricted to a path-safe alphabet (it becomes a URL path segment).
    #[serde(alias = "prefKey")]
    pub pref_key: String,

    /// Display label. Absent = the renderer shows the `pref_key`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,

    /// Helper caption shown under the field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    /// Placeholder for text / model-picker inputs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<String>,

    /// Choices for a [`SettingsFieldType::Select`]; required for that type and
    /// inert for every other one.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<SettingsFieldOption>,

    /// Default value, in the field's own JSON type (bool for a toggle, number for
    /// a number, string elsewhere) — NOT the stringified form preferences are
    /// stored in, so a manifest stays readable and the type is checkable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<serde_json::Value>,

    /// Whether the user must supply a value (advisory: enforced by the renderer,
    /// declared here so the contract is one place).
    #[serde(default)]
    pub required: bool,

    /// Inclusive lower bound for a [`SettingsFieldType::Number`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,

    /// Inclusive upper bound for a [`SettingsFieldType::Number`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,

    /// Granularity for a [`SettingsFieldType::Number`] — the increment its stepper
    /// moves by, and the grid a typed value must land on.
    ///
    /// Distinct from [`Self::min`]/[`Self::max`], which bound the range: a value can
    /// sit inside the range and still be meaningless at this field's resolution
    /// (`0.5` where the setting counts whole pages). The renderer enforces it, so a
    /// field that declares it rejects an off-grid value rather than persisting one
    /// the plugin cannot use.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step: Option<f64>,

    /// Minimum length for a text/textarea value.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_length: Option<u64>,

    /// Maximum length for a text/textarea value.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_length: Option<u64>,
}

/// One **settings tab** a plugin contributes (see [`Contributes::settings_tabs`]).
///
/// A tab is EITHER declarative (`fields`, rendered by the shared plugin-settings
/// renderer against Core's preference store) OR a named `view` the shell resolves to
/// a bespoke component — for an app whose settings genuinely cannot be expressed as
/// a list of fields. A tab with neither renders as an empty section, which the
/// desktop's defensive parser drops on the floor; the loader rejects it instead so
/// the author gets told.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct SettingsTabContribution {
    /// Stable id for this tab within the plugin — the settings nav routes to it and
    /// the renderer keys by it. Required: the desktop's fallback (`<plugin>.settings`)
    /// collides the moment a plugin declares a second tab.
    pub id: String,

    /// Header label for the section. Absent = `"Settings"`, matching the renderer.
    #[serde(default = "default_settings_tab_title")]
    pub title: String,

    /// Which settings dialog this tab lands in. Absent/unrecognised = `node`.
    #[serde(default, deserialize_with = "deserialize_settings_scope")]
    pub scope: SettingsScope,

    /// A rich settings view this app ships instead of declarative `fields`. Opaque
    /// here — the settings renderer owns the vocabulary and resolves the name to a
    /// component (first-party) or a sandboxed UI (third-party).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view: Option<String>,

    /// The declarative fields this tab renders. Empty is only legal alongside a
    /// `view`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fields: Vec<SettingsFieldContribution>,
}

fn default_settings_tab_title() -> String {
    "Settings".to_owned()
}

/// One **tool filter**: a fully-qualified tool id a plugin wants withheld from the
/// model's offered tool list.
///
/// Tools are namespaced `<server>__<tool>` (e.g. `browser__navigate`), so `tool`
/// must carry the namespace — a bare `navigate` would be ambiguous across servers
/// and is rejected at load. A **trailing** `*` is a prefix wildcard, which is how a
/// plugin withholds a whole server (`shadow__*`); it is the only wildcard position
/// allowed, because an interior or leading `*` invites a pattern that silently
/// matches far more than the author pictured.
///
/// This type is declaration + validation only. The filter is **applied** where the
/// tool list is assembled for the model (the MCP offer site in
/// `apps/core/src/sidecar/mcp`), which calls [`ToolFilterContribution::matches`] so
/// the wildcard rule has exactly one implementation. Hiding a tool from the model
/// is not a security boundary — it does not revoke the capability, it only stops the
/// tool being advertised; enforcement stays with permissions and grants.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ToolFilterContribution {
    /// Fully-qualified tool id (`<server>__<tool>`), optionally ending in `*` to
    /// hide every tool whose id starts with the preceding prefix.
    pub tool: String,

    /// Why the plugin hides it — surfaced in the plugin's listing so a user can see
    /// what a plugin is removing from the model's view before installing it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl ToolFilterContribution {
    /// Does this filter hide `tool_id`? Exact match, or prefix match when the
    /// pattern ends in `*`. The single implementation of the wildcard rule — the
    /// offer site calls this rather than re-deriving it.
    pub fn matches(&self, tool_id: &str) -> bool {
        self.tool.strip_suffix('*').map_or_else(
            || self.tool == tool_id,
            |prefix| tool_id.starts_with(prefix),
        )
    }
}

/// Validate one [`ToolFilterContribution`] pattern.
///
/// Returns `Ok(())` when the pattern is well-formed, else a descriptive `Err`.
pub fn validate_tool_filter(filter: &ToolFilterContribution) -> Result<(), String> {
    let tool = filter.tool.trim();
    if tool.is_empty() {
        return Err("tool_filters entry has an empty 'tool' pattern".to_string());
    }
    if tool != filter.tool {
        return Err(format!(
            "tool_filters pattern '{}' has leading/trailing whitespace",
            filter.tool
        ));
    }
    if tool.chars().any(char::is_whitespace) {
        return Err(format!(
            "tool_filters pattern '{tool}' must not contain whitespace"
        ));
    }
    // Only a TRAILING `*` is a wildcard. An interior one (`br*ser__nav`) would look
    // like a glob and behave like a literal, which is the worst of both.
    let body = tool.strip_suffix('*').unwrap_or(tool);
    if body.contains('*') {
        return Err(format!(
            "tool_filters pattern '{tool}' may only use '*' as its final character"
        ));
    }
    // `*` alone (or any pattern that does not name a server) would hide every tool
    // on the node from the model — a plugin that wants that is almost certainly a
    // mistake or hostile, and either way the user should not learn about it by
    // watching the agent lose its hands.
    if !body.contains("__") {
        return Err(format!(
            "tool_filters pattern '{tool}' must be a fully-qualified '<server>__<tool>' id (a bare name or '*' would match across every server)"
        ));
    }
    Ok(())
}

/// Validate one [`SettingsTabContribution`] and every field it declares.
///
/// This is the Rust twin of the schema an SDK author gets from `manifest.ts`: the
/// same rules, enforced on the Core side so a hand-written manifest (or one from a
/// language with no SDK) cannot skip them. Returns `Ok(())` when the tab is
/// well-formed, else a descriptive `Err` naming the tab and field at fault.
pub fn validate_settings_tab(tab: &SettingsTabContribution) -> Result<(), String> {
    if tab.id.trim().is_empty() {
        return Err("settings tab has an empty 'id'".to_string());
    }
    if tab.title.trim().is_empty() {
        return Err(format!("settings tab '{}' has an empty 'title'", tab.id));
    }

    let has_view = tab.view.as_ref().is_some_and(|v| !v.trim().is_empty());
    if tab.fields.is_empty() && !has_view {
        return Err(format!(
            "settings tab '{}' declares neither 'fields' nor a 'view' and would render as an empty section",
            tab.id
        ));
    }

    let mut seen_keys: BTreeSet<&str> = BTreeSet::new();
    for field in &tab.fields {
        validate_settings_field(&tab.id, field)?;
        if !seen_keys.insert(field.pref_key.as_str()) {
            return Err(format!(
                "settings tab '{}' declares two fields bound to '{}'; a preference key is a field's identity, so the second would overwrite the first",
                tab.id, field.pref_key
            ));
        }
    }
    Ok(())
}

/// Characters a `pref_key` may contain. It is interpolated into the preference
/// route (`/api/preferences/<key>`), so a `/`, a backslash or a `..` segment would
/// escape the key space and address an unrelated route; a strict allowlist (not a
/// blocklist) is the only form of this check that stays correct as the route table
/// grows.
fn pref_key_char_is_legal(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':')
}

/// Longest accepted [`SettingsFieldType::Secret`] `pref_key`.
pub const MAX_SECRET_KEY_LEN: usize = 128;

/// Whether `name` is shaped like a POSIX environment variable
/// (`[A-Za-z_][A-Za-z0-9_]*`, at most [`MAX_SECRET_KEY_LEN`] chars).
///
/// THE ONE DEFINITION of a legal [`SettingsFieldType::Secret`] key, shared by the
/// manifest validator (which rejects a bad one at import) and Core's
/// `PUT /api/plugins/{id}/secrets/{key}` handler (which rejects a bad one at
/// write). Two copies would drift, and drift here means a field that validates on
/// load and 400s on save — a failure the plugin author never sees because it only
/// happens in the user's browser.
///
/// This is STRICTER than [`pref_key_char_is_legal`], which also admits `.`, `-`
/// and `:`. It has to be: a secret's `pref_key` is not a preference key at all, it
/// is the env var name the plugin's own `secret_headers` `env:` token names, and a
/// name that could not be an env var can never be read back.
pub fn is_env_var_name(name: &str) -> bool {
    if name.is_empty() || name.len() > MAX_SECRET_KEY_LEN {
        return false;
    }
    let mut chars = name.chars();
    let first_ok = chars
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_');
    first_ok && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn validate_settings_field(tab_id: &str, field: &SettingsFieldContribution) -> Result<(), String> {
    let key = field.pref_key.trim();
    if key.is_empty() {
        return Err(format!(
            "settings tab '{tab_id}' has a field with an empty 'pref_key'; a field with nothing to persist is an inert control"
        ));
    }
    if key != field.pref_key {
        return Err(format!(
            "settings tab '{tab_id}' field pref_key '{}' has leading/trailing whitespace",
            field.pref_key
        ));
    }
    if !key.chars().all(pref_key_char_is_legal) {
        return Err(format!(
            "settings tab '{tab_id}' field pref_key '{key}' contains illegal characters (allowed: a-z A-Z 0-9 . - _ :)"
        ));
    }
    if key.contains("..") {
        return Err(format!(
            "settings tab '{tab_id}' field pref_key '{key}' must not contain '..'"
        ));
    }
    // A `secret` field's key is NOT a preference key: it is the environment
    // variable name the plugin's own `secret_headers` `env:` token names, and it is
    // what Core stores the credential under. The general `pref_key` alphabet admits
    // `.`, `-` and `:`, none of which can appear in an env var — so a field
    // declared as `"pref_key": "tavily.api-key"` would validate here, render
    // normally, and then fail only when a user pressed Save. Rejecting at import
    // puts the error in front of the author instead of the user.
    if field.field_type == SettingsFieldType::Secret && !is_env_var_name(key) {
        return Err(format!(
            "settings tab '{tab_id}' field pref_key '{key}' is type 'secret', so it must be the \
             environment variable name the manifest's secret_headers reads (a letter or \
             underscore followed by letters, digits or underscores, e.g. 'RYU_TAVILY_API_KEY')"
        ));
    }

    let is_select = field.field_type == SettingsFieldType::Select;
    if is_select {
        // The renderer silently degrades an optionless select to a free-text box, so
        // the user gets a control that looks nothing like what the author declared.
        if field.options.is_empty() {
            return Err(format!(
                "settings tab '{tab_id}' field '{key}' is type 'select' but declares no options"
            ));
        }
        let mut seen_values: BTreeSet<&str> = BTreeSet::new();
        for option in &field.options {
            if option.value().trim().is_empty() {
                return Err(format!(
                    "settings tab '{tab_id}' field '{key}' has a select option with an empty value"
                ));
            }
            if !seen_values.insert(option.value()) {
                return Err(format!(
                    "settings tab '{tab_id}' field '{key}' declares duplicate select option '{}'",
                    option.value()
                ));
            }
        }
    }

    validate_settings_field_bounds(tab_id, key, field)?;
    validate_settings_field_default(tab_id, key, field)
}

/// Cross-check the numeric / length bounds against the field's declared `type`.
/// Bounds attached to a type that cannot use them are rejected rather than ignored:
/// an author who writes `min` on a toggle believes something is being enforced.
fn validate_settings_field_bounds(
    tab_id: &str,
    key: &str,
    field: &SettingsFieldContribution,
) -> Result<(), String> {
    let is_number = field.field_type == SettingsFieldType::Number;
    if (field.min.is_some() || field.max.is_some() || field.step.is_some()) && !is_number {
        return Err(format!(
            "settings tab '{tab_id}' field '{key}' declares min/max/step but is not type 'number'"
        ));
    }
    // A non-positive step is not a granularity — the renderer would either reject
    // every value or divide by zero, so refuse it at import where the author can see
    // it rather than at the first blur.
    if let Some(step) = field.step {
        if !(step.is_finite() && step > 0.0) {
            return Err(format!(
                "settings tab '{tab_id}' field '{key}' has step {step}, which must be a finite positive number"
            ));
        }
    }
    if let (Some(min), Some(max)) = (field.min, field.max) {
        if min > max {
            return Err(format!(
                "settings tab '{tab_id}' field '{key}' has min {min} greater than max {max}"
            ));
        }
    }

    let is_textual = matches!(
        field.field_type,
        SettingsFieldType::Text | SettingsFieldType::Textarea
    );
    if (field.min_length.is_some() || field.max_length.is_some()) && !is_textual {
        return Err(format!(
            "settings tab '{tab_id}' field '{key}' declares min_length/max_length but is not type 'text' or 'textarea'"
        ));
    }
    if let (Some(min), Some(max)) = (field.min_length, field.max_length) {
        if min > max {
            return Err(format!(
                "settings tab '{tab_id}' field '{key}' has min_length {min} greater than max_length {max}"
            ));
        }
    }
    Ok(())
}

/// Check that a declared `default` is of the field's own type and inside its own
/// bounds. A default that violates either would be written straight into the
/// preference store the first time the tab renders, so catching it at import is the
/// difference between a load-time warning and a runtime value nothing can parse.
fn validate_settings_field_default(
    tab_id: &str,
    key: &str,
    field: &SettingsFieldContribution,
) -> Result<(), String> {
    let Some(default) = &field.default else {
        return Ok(());
    };
    let mismatch = |expected: &str| {
        format!("settings tab '{tab_id}' field '{key}' is type '{expected}' but its default is {default}")
    };

    match field.field_type {
        SettingsFieldType::Toggle => {
            if !default.is_boolean() {
                return Err(mismatch("toggle"));
            }
        }
        SettingsFieldType::Number => {
            let Some(value) = default.as_f64() else {
                return Err(mismatch("number"));
            };
            let below_min = field.min.is_some_and(|min| value < min);
            let above_max = field.max.is_some_and(|max| value > max);
            if below_min || above_max {
                return Err(format!(
                    "settings tab '{tab_id}' field '{key}' default {value} is outside its declared min/max"
                ));
            }
        }
        SettingsFieldType::Select => {
            let Some(value) = default.as_str() else {
                return Err(mismatch("select"));
            };
            if !field.options.iter().any(|o| o.value() == value) {
                return Err(format!(
                    "settings tab '{tab_id}' field '{key}' default '{value}' is not one of its declared options"
                ));
            }
        }
        SettingsFieldType::Text | SettingsFieldType::Textarea => {
            let Some(value) = default.as_str() else {
                return Err(mismatch("text"));
            };
            let len = value.chars().count() as u64;
            let too_short = field.min_length.is_some_and(|min| len < min);
            let too_long = field.max_length.is_some_and(|max| len > max);
            if too_short || too_long {
                return Err(format!(
                    "settings tab '{tab_id}' field '{key}' default is outside its declared min_length/max_length"
                ));
            }
        }
        SettingsFieldType::ModelPicker => {
            if !default.is_string() {
                return Err(mismatch("model_picker"));
            }
        }
        // A selection is stored as JSON, but a manifest may equally declare its
        // default as a bare model id (the legacy form the resolver still reads),
        // so both spellings are valid here.
        SettingsFieldType::AgentPicker => {
            if !(default.is_string() || default.is_object()) {
                return Err(mismatch("agent_picker"));
            }
        }
        // A secret field has NO valid default. Whatever a manifest put there would
        // be a credential shipped in a file that travels with the plugin — the
        // exact thing this field type exists to stop — and it could never be
        // honoured anyway, since the value lives in the encrypted store, not in
        // preferences. Rejecting at import makes the mistake loud at the moment it
        // is committed rather than silently ignored forever.
        SettingsFieldType::Secret => {
            return Err(format!(
                "settings tab '{tab_id}' field '{key}' is type 'secret' and must not declare a \
                 default (a credential must never ship inside a manifest)"
            ));
        }
    }
    Ok(())
}

impl Contributes {
    /// Every runnable id referenced across all contribution surfaces. Used by the
    /// loader to verify each one resolves to a `runnables` entry.
    pub fn referenced_ids(&self) -> Vec<&str> {
        self.commands
            .iter()
            .chain(self.tools.iter())
            .chain(self.agents.iter())
            .chain(self.workflows.iter())
            .chain(self.policies.iter())
            .map(|c| c.id.as_str())
            .collect()
    }

    /// Hold `settings_tabs` and `tool_filters` to their typed contracts.
    ///
    /// `settings_tabs` is stored as raw JSON (see [`Contributes::settings_tabs`]),
    /// so this is where it is actually parsed as [`SettingsTabContribution`] — the
    /// ONE implementation, called from both [`PluginManifest::validate`] (the SDK /
    /// FFI path) and Core's manifest loader, so an author cannot get a different
    /// answer depending on which door they came through.
    ///
    /// Errors are unprefixed; each caller wraps them in its own house style.
    ///
    /// [`Contributes::lsp_servers`] is intentionally NOT checked here. An `Err` from
    /// this function skips the whole manifest, but an invalid language server must
    /// cost only itself — see [`LspServerContribution::validate`], which the spawn
    /// site calls per server instead.
    pub fn validate_settings_contributions(&self) -> Result<(), String> {
        let mut seen_tab_ids: BTreeSet<&str> = BTreeSet::new();
        let mut tabs: Vec<SettingsTabContribution> = Vec::with_capacity(self.settings_tabs.len());
        for (index, raw) in self.settings_tabs.iter().enumerate() {
            let tab: SettingsTabContribution = serde_json::from_value(raw.clone())
                .map_err(|e| format!("settings tab #{index} is not a valid settings tab: {e}"))?;
            validate_settings_tab(&tab)?;
            tabs.push(tab);
        }
        // Two tabs sharing an id collide in the settings nav (which routes by id) and
        // in the renderer's element keys, so the second silently shadows the first.
        for tab in &tabs {
            if !seen_tab_ids.insert(tab.id.as_str()) {
                return Err(format!("duplicate settings tab id '{}'", tab.id));
            }
        }

        for filter in &self.tool_filters {
            validate_tool_filter(filter)?;
        }
        Ok(())
    }

    /// Hold `hook_events` to the namespace rule, and reject duplicate ids.
    ///
    /// Takes the owning `plugin_id` because a [`Contributes`] does not know which
    /// manifest holds it, and the whole point of the check is that an event's
    /// namespace half must *be* that id (see [`Contributes::hook_events`]).
    ///
    /// Deliberately does NOT validate `turn_hooks[].on` against any known event.
    /// A consumer naming an event no installed plugin declares is normal and must
    /// keep working: it is how you install a consumer before its provider, and how a
    /// consumer survives its provider being temporarily disabled. An unmatched `on`
    /// simply never fires — the same posture `tool_filters` takes toward naming
    /// another plugin's tools.
    ///
    /// # Errors
    /// Returns `Err` on a malformed or foreign-namespaced event id, or a duplicate.
    pub fn validate_hook_events(&self, plugin_id: &str) -> Result<(), String> {
        let mut seen: BTreeSet<&str> = BTreeSet::new();
        for event in &self.hook_events {
            validate_hook_event(event, plugin_id)?;
            if !seen.insert(event.id.as_str()) {
                return Err(format!("duplicate hook event id '{}'", event.id));
            }
        }
        Ok(())
    }
}

/// A single contribution: a reference (by `id`) to a runnable declared in the
/// manifest's `runnables` list, optionally with a human-facing title (e.g. the
/// label a command shows in the palette).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ContributionId {
    /// The runnable id this contribution points at. Must exist in `runnables`.
    pub id: String,

    /// Optional display title (e.g. the palette label for a command).
    #[serde(default)]
    pub title: Option<String>,
}

/// `engines` block — the required Ryu version, mirroring VS-Code's
/// `engines.vscode`. `ryu` is a semver **requirement** string.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct EnginesReq {
    /// Semver requirement the running Core version must satisfy (e.g. `">=0.3.0"`,
    /// `"^1.2"`). Parsed as a [`semver::VersionReq`]; an unparseable value or an
    /// unsatisfied requirement causes the loader to reject the manifest.
    pub ryu: String,
}

/// `requires` block — the plugin's **plugin-to-plugin** dependencies.
///
/// This is the npm-shaped edge that lets the app decompose into a minimal kernel
/// plus features: a plugin declares the other plugins it needs, and the lifecycle
/// (Core's `plugins::graph`) resolves them into a topological enable order.
///
/// Distinct from [`EnginesReq`], which constrains plugin→**Core** (the engine
/// version). `requires` constrains plugin→**plugin**.
///
/// Absent (the default, and the case for every manifest that predates this field)
/// means *no dependencies* — the plugin enables standalone exactly as before.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, JsonSchema)]
pub struct Requires {
    /// Other plugins that must be installed (and are auto-enabled, in dependency
    /// order) before this one can enable.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub apps: Vec<AppDependency>,

    /// **Capabilities** this plugin requires — the layered, provider-agnostic edge
    /// (`requires: [rag]`) that the capability broker resolves to a concrete
    /// provider app at bind time. Distinct from [`apps`]: an `apps` edge names a
    /// specific plugin id; a `capabilities` edge names an abstract capability and
    /// lets the binding registry pick (or the user override) which enabled provider
    /// serves it. Each is lowered to an app-id graph edge once bound, so the
    /// topological enable/disable/cycle machinery is shared. Empty for the common
    /// case.
    ///
    /// [`apps`]: Requires::apps
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub capabilities: Vec<CapabilityReq>,

    /// Permission grants implied by the dependencies. Declaration only — the
    /// Gateway remains the sole authority on what a grant *allows* (Core decides
    /// what runs; the Gateway decides what is permitted).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub grants: Vec<String>,
}

/// One **required capability** edge (in [`Requires::capabilities`]).
///
/// Names an abstract capability plus an optional minimum *capability* version. The
/// version floor is checked at bind time against the bound provider's
/// [`ProvidesEntry::version`] — NOT against the provider plugin's own semver — so a
/// lowered graph edge carries no `min_version` (the app-version gate would compare
/// the wrong number). See the capability broker in Core.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct CapabilityReq {
    /// The capability name (e.g. `"rag"`, `"tts"`). Matched against a provider's
    /// [`ProvidesEntry::capability`].
    pub capability: String,

    /// Optional minimum **capability** version the bound provider must satisfy
    /// (bare `"1.2.0"` = `">=1.2.0"`, via [`parse_min_version`]). Absent = any
    /// version of the capability is acceptable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_version: Option<String>,
}

/// One **provided capability** entry (in [`PluginManifest::provides`]).
///
/// Binds an abstract capability name to a concrete serving surface on THIS
/// manifest: the local `sidecar` name whose declared HTTP `route` implements the
/// capability, plus the `grant` a consumer must hold to invoke it. The broker
/// routes a consumer's `/api/host/capability/<cap>` call to this sidecar's route
/// using the *provider's* minted token — the consumer never sees it.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
pub struct ProvidesEntry {
    /// The capability name this plugin serves (e.g. `"rag"`). Consumers match on
    /// this against their [`Requires::capabilities`].
    pub capability: String,

    /// The capability's own semver version (independent of the plugin version), so
    /// a consumer's [`CapabilityReq::min_version`] floor can be checked against the
    /// capability contract rather than the app release.
    pub version: String,

    /// The local `name` of one of this manifest's declared `sidecars` that serves
    /// the capability. The loader cross-validates it exists. Absent = an in-process
    /// capability with no dedicated sidecar (the broker declines to proxy it).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sidecar: Option<String>,

    /// The proxied sub-path (on the named sidecar's [`crate::schema::HttpProxySpec`])
    /// the broker forwards capability calls to (e.g. `"/rag/query"`). The loader
    /// cross-validates that the named sidecar declares a matching route.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub route: Option<String>,

    /// The grant a consumer must hold (Gateway-approved) to invoke this capability
    /// via the broker. Absent = no extra grant beyond declaring the edge.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grant: Option<String>,

    /// Opt in to the **selectable** flavour: many providers of this capability may
    /// be enabled at once and the user *picks* one, exactly like a local engine.
    ///
    /// A non-selectable capability (the original, strict flavour used by `rag` /
    /// `engines`) treats a second enabled provider as an explicit
    /// `BindingError::Ambiguous` refusal. A selectable one resolves deterministically
    /// instead: user override > sole provider > the provider declaring
    /// [`Self::default_provider`] > lexicographically-lowest provider id. The pick is
    /// a pure function of the candidate set, so the disable-safety reconstruction
    /// argument in Core's binding registry is unchanged.
    ///
    /// Selectability is a property of the *capability*, so every provider of a given
    /// capability must agree on the flag; the loader rejects a mixed declaration.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub selectable: bool,

    /// Preferred pick among the providers of a [`Self::selectable`] capability when
    /// the user has set no override. At most one provider per capability may declare
    /// it. Meaningless (and ignored) on a non-selectable capability.
    #[serde(
        default,
        rename = "default",
        skip_serializing_if = "std::ops::Not::not"
    )]
    pub default_provider: bool,

    /// WHAT this provider acts on, when the capability controls a machine or an
    /// environment rather than answering a query.
    ///
    /// Exists because "swap the provider" quietly means two different things.
    /// Swapping `web.search` from exa to tavily changes who answers; the question is
    /// the same. Swapping `computer.control` from ghost to bytebot changes **which
    /// computer gets typed on** — ghost drives the machine Ryu runs on, bytebot
    /// drives the desktop `bytebotd` runs on (a containerized Linux desktop in the
    /// shipped product). A picker that renders those two swaps identically is
    /// telling the user something false, and until this field existed the
    /// distinction lived only in a prose `description` that nothing structured
    /// could read.
    ///
    /// Absent = not applicable or unspecified. That is the honest default for the
    /// capabilities where locality is meaningless (`web.search`, `memory`, `rag`),
    /// and it is deliberately NOT [`ProviderTarget::LocalMachine`]: defaulting to
    /// "this machine" would silently mislabel every future hosted provider that
    /// forgets to declare it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<ProviderTarget>,

    /// Capability **verb → this provider's tool** bindings, the seam that keeps the
    /// model-visible tool surface stable across a swap.
    ///
    /// The key is a canonical verb from the host's capability verb table (e.g.
    /// `"web__search"`); the value names the provider's own registered tool plus the
    /// argument/response mapping into the canonical shape. A provider that omits a
    /// verb simply does not serve it — the facade reports the verb unavailable
    /// rather than guessing.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub tools: BTreeMap<String, CapabilityToolBinding>,
}

/// What a capability provider acts on — see [`ProvidesEntry::target`].
///
/// Deliberately two coarse values rather than a taxonomy. The only question a user
/// needs answered before swapping is "will this act on the machine in front of me,
/// or somewhere else?", and a finer vocabulary (container / VM / cloud / another
/// host) would be guesswork the manifests cannot honestly support.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderTarget {
    /// Acts on the machine Ryu itself is running on: `ghost` types on this
    /// keyboard, the Chromium sidecar opens a window on this display.
    LocalMachine,
    /// Acts on a SEPARATE machine or virtual desktop — a container, a VM, a hosted
    /// browser. Selecting it is not another way to drive your own computer, and the
    /// picker must say so.
    RemoteDesktop,
}

/// How one capability **verb** maps onto a concrete provider tool.
///
/// The facade tool (`web__search`, `browser__navigate`, …) is registered by the host
/// from its canonical verb table; at call time it resolves the capability's bound
/// provider, reads this binding, renames the arguments, re-enters tool dispatch on
/// [`Self::tool`], and maps the response back. Swapping the provider therefore
/// changes neither the tool id nor its schema.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
pub struct CapabilityToolBinding {
    /// The provider's own fully-qualified tool id (e.g. `"exa__search"`,
    /// `"app__firecrawl_scrape"`) that implements this verb.
    pub tool: String,

    /// Canonical argument name → this provider's argument name. A canonical argument
    /// with no entry is passed through under its own name; map it to the empty string
    /// to drop it (the provider cannot express it).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub args: BTreeMap<String, String>,

    /// Constant arguments merged into every call (provider-specific knobs the
    /// canonical schema does not expose, e.g. `{"search_depth": "advanced"}`).
    #[serde(default, skip_serializing_if = "serde_json::Map::is_empty")]
    pub arg_defaults: serde_json::Map<String, serde_json::Value>,

    /// A request-body TEMPLATE this provider needs, with `{canonical_arg}`
    /// placeholders substituted from the call.
    ///
    /// `args` renames flat keys and `[]` wraps a scalar in an array; neither can build
    /// a NESTED shape. Real APIs need them: Mem0's write endpoint takes
    /// `messages: [{role, content}]`, so without a template the whole write half of
    /// that provider is unbindable — which is precisely the gap that made Ryu's
    /// memory bridges inert while Hermes, which writes per-provider adapter CODE, had
    /// none. This closes it declaratively instead of admitting code per provider.
    ///
    /// A string that is EXACTLY `"{arg}"` is replaced by that argument's value with
    /// its JSON type preserved (`5` stays a number); a string merely CONTAINING
    /// `{arg}` interpolates as text. An argument consumed by the template is not also
    /// passed through, so it cannot appear twice under two names.
    #[serde(default, skip_serializing_if = "serde_json::Map::is_empty")]
    pub arg_template: serde_json::Map<String, serde_json::Value>,

    /// Per-argument numeric limits this provider can actually honour, keyed by the
    /// **canonical** argument name (before any rename).
    ///
    /// Exists because canonical schemas describe what agents may ask for, while
    /// providers differ in what they accept: `web__search.limit` allows up to 100,
    /// but Brave's `count` maxes at 20. Without this, selecting Brave turns a
    /// perfectly valid `limit: 50` into an upstream 4xx — the swap stops being
    /// transparent, which is the entire point of the facade. Clamping is the right
    /// resolution rather than erroring: the caller asked for "up to N", and fewer
    /// results is a normal outcome, whereas a failed search is not.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub arg_clamp: BTreeMap<String, ArgBounds>,

    /// Optional response normalization into the canonical result shape. Absent = the
    /// provider's output is returned verbatim under `{ provider, raw }`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub response: Option<CapabilityResponseMap>,

    /// Optional provider-shipped ADAPTER: JavaScript that maps this verb onto the
    /// provider's tool when the shapes are too far apart for the declarative fields
    /// above to bridge.
    ///
    /// The declarative path ([`Self::args`] … [`Self::response`]) stays the default
    /// and covers the ~80% of providers that are a rename plus a field map: no code
    /// review, no sandbox, no supply-chain surface, and a third party ships one file.
    /// But some provider shapes no amount of JSON can express — an async job API that
    /// must be polled (`POST /crawl` → job id → `GET /crawl/{id}`), a token vocabulary
    /// that needs per-provider normalization, a body that must read a `pref:` value.
    /// Growing the grammar one vendor quirk at a time pushed provider-specific logic
    /// into shared kernel code; an adapter puts it back in the provider's own manifest.
    ///
    /// Present = the adapter REPLACES the declarative mapping for this verb: it
    /// receives the canonical arguments and returns the canonical result, and
    /// [`Self::args`] / [`Self::arg_template`] / [`Self::arg_clamp`] / [`Self::response`]
    /// are not applied (the adapter is doing that job). [`Self::tool`] still names the
    /// target and is still the ONLY tool the adapter can reach.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub adapter: Option<CapabilityAdapter>,
}

/// Provider-shipped JavaScript that maps one capability verb onto one provider tool.
///
/// Runs in the SAME Deno sandbox as an `inline_deno` plugin tool, under the same
/// [`crate`-level] grant model: the providing plugin must hold `tool:execute`, so
/// shipping code is a visible, approvable act rather than a silent one.
///
/// The program is handed:
/// - `input` — the canonical verb arguments, after layer defaults are applied.
/// - `defaults` — the provider's resolved `arg_defaults`, including any `pref:`
///   tokens already looked up. This is what lets an adapter read per-install
///   configuration a template could not (`arg_template` expands from the CALLER's
///   arguments, so it can never see a resolved preference).
/// - `callTool(args)` — invokes the provider's own [`CapabilityToolBinding::tool`]
///   and resolves to its raw response. It takes NO tool id: the target is fixed by
///   the manifest, so sandboxed code cannot redirect the call at another tool. An
///   adapter therefore grants no authority the declarative path did not already
///   grant — it is strictly the same single re-entry, expressed as code.
///
/// It returns the canonical result shape, which the facade passes through unchanged.
///
/// **Bounded by the sandbox wall-clock.** A run gets `DEFAULT_DEADLINE_SECS` of
/// active compute, and time spent awaiting a tool call counts against it. An
/// adapter that polls an async job must therefore treat "still running" as a normal
/// outcome to report, not something to wait out.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
pub struct CapabilityAdapter {
    /// The adapter body. Evaluated as the tail of a sandbox program that has already
    /// bound `input`, `defaults`, `callTool` and `callNamed`; it `return`s the
    /// canonical result.
    ///
    /// Empty in a **source** manifest that declares [`Self::code_file`] instead;
    /// [`PluginManifest::hydrate_code_files`] fills it in at parse time and
    /// [`PluginManifest::validate`] refuses a manifest where it is still empty.
    #[serde(default)]
    pub code: String,

    /// Path to the file holding the adapter body, relative to the plugin root
    /// (`adapters/<verb>.js`) — the authoring form. Mutually exclusive with
    /// [`Self::code`]; see [`PluginManifest::hydrate_code_files`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code_file: Option<String>,

    /// ADDITIONAL provider tool ids this adapter may call, beyond
    /// [`CapabilityToolBinding::tool`], reachable from the body as
    /// `callNamed(id, args)`.
    ///
    /// Exists because a whole class of real APIs is two calls, not one: an async job
    /// API starts work at one endpoint and reads the result from another
    /// (`POST /crawl` → job id → `GET /crawl/{id}`). A single-tool adapter cannot
    /// express that, so those providers would stay unbindable — the gap that
    /// excluded every async API from every layer.
    ///
    /// This is an ALLOWLIST fixed by the manifest and checked host-side: a name not
    /// listed here (and not [`CapabilityToolBinding::tool`]) is refused. Sandboxed
    /// code chooses only *among* tools the provider declared, never a tool of its
    /// own — which is what keeps the id-taking form from becoming an escalation seam.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tools: Vec<String>,
}

/// Inclusive numeric bounds a provider can honour for one canonical argument.
/// Integers, not floats. Every clampable canonical argument is a COUNT — result
/// limits, crawl depth, page caps — so `i64` is the honest type, and it keeps the
/// whole manifest tree `Eq` (a float would force `PartialEq`-only all the way up
/// through `ProvidesEntry` and `PluginManifest`) while avoiding float comparison.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
pub struct ArgBounds {
    /// Smallest value the provider accepts. Absent = no lower bound.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<i64>,
    /// Largest value the provider accepts. Absent = no upper bound.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<i64>,
}

/// Normalizes one provider's response into the capability's canonical shape.
///
/// Deliberately a flat rename table rather than a general transform language: the
/// canonical shapes are small and list-of-records shaped, and a manifest that can
/// run arbitrary extraction logic is a much larger trust surface.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
pub struct CapabilityResponseMap {
    /// Dotted path to the provider's result array within its response (e.g.
    /// `"results"`, `"data.items"`). Absent = the response itself is the array, or —
    /// when it is not an array — a single record.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub results: Option<String>,

    /// Canonical per-item field name → the provider's field name (dotted paths
    /// allowed). Fields with no entry are dropped from the canonical item but remain
    /// available under the item's `raw` key.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub fields: BTreeMap<String, String>,
}

/// Per-surface support level a plugin declares for a [`Surface`] in the
/// [`PluginManifest::surfaces`] map. Governs both whether the plugin appears on the
/// surface and how much of its UI that surface renders.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum SurfaceSupport {
    /// Full first-class UI + backend on this surface.
    Full,
    /// A reduced/limited UI (e.g. a read-only or single-pane view).
    Limited,
    /// A list/index entry only (no dedicated page).
    List,
    /// Command-palette / CLI commands only (no rendered UI) — e.g. the TUI tier.
    Commands,
    /// Explicitly unsupported on this surface. Equivalent to omitting the key, made
    /// explicit so a manifest can document intent.
    #[default]
    None,
}

/// One [`PluginManifest::surfaces`] entry: the support level plus an optional UI
/// descriptor the surface shell resolves (opaque here — pure data).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, JsonSchema)]
pub struct SurfaceEntry {
    /// How much of the plugin this surface supports.
    #[serde(default)]
    pub support: SurfaceSupport,

    /// Optional surface-specific UI descriptor (bundle id, mount point, …),
    /// interpreted by the surface's app host. Opaque to the contract.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ui: Option<serde_json::Value>,

    /// Terminal subcommands this app contributes to the `cli` surface (the TUI's
    /// `ryu <app> <cmd>` dispatcher). Only meaningful on the `cli` surface entry;
    /// ignored on other surfaces. Empty/absent = the app contributes no commands.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub commands: Vec<CliCommandSpec>,
}

/// One terminal subcommand an app contributes to the `cli` surface (the TUI's
/// `ryu <app> <cmd>` dispatcher). Routed through Core's `ext_proxy` to the app's
/// sidecar: Core forwards `<method> /api/ext/<plugin_id><path>`. `path` MUST be a
/// route the app's sidecar declares in `http.routes`, or the proxy 404s.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
pub struct CliCommandSpec {
    /// Subcommand token, e.g. `status` in `ryu mail status`.
    pub name: String,

    /// One-line help shown in `ryu <app>` / `ryu <app> --help`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,

    /// HTTP method for the `ext_proxy` call. Absent = `POST`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,

    /// Sub-path appended after `/api/ext/<plugin_id>`. Validated by
    /// [`validate_cli_command_path`] at manifest load: it MUST be an absolute
    /// (`/`-leading), traversal-free sub-path — no `..` segment in any form — so it
    /// cannot escape the plugin's proxy scope when a URL parser normalizes it.
    pub path: String,
}

/// Validate one [`CliCommandSpec::path`] as a safe `ext_proxy` sub-path.
///
/// The path is concatenated onto `/api/ext/<plugin_id>` on the client and fetched.
/// A WHATWG URL parser resolves `..` path segments — including their percent-encoded
/// (`%2e`) and backslash-separated forms (`\` is a path separator for special/http
/// schemes) — BEFORE the request leaves the process, so a traversal path escapes the
/// `/api/ext/<id>/` scope and reaches an arbitrary internal route with the node
/// bearer. Rejecting these at manifest load is the authoritative gate; the TUI also
/// re-checks defensively (`isSafeCommandPath` in `packages/core-client`).
///
/// Accepts only an absolute, single-origin sub-path: leading `/`, no backslash, no
/// literal or percent-encoded `..`, and no percent-encoded path separators.
pub fn validate_cli_command_path(path: &str) -> Result<(), String> {
    if !path.starts_with('/') {
        return Err("path must start with '/'".to_string());
    }
    // `\` is normalized to `/` by the WHATWG URL parser for special (http) schemes,
    // so a backslash can smuggle a `..` traversal segment past a naive `/`-only scan.
    if path.contains('\\') {
        return Err("path must not contain a backslash".to_string());
    }
    let lower = path.to_ascii_lowercase();
    // A literal `..` and its percent-encoded dot forms (`%2e%2e`, `.%2e`, `%2e.`) are
    // all recognized as double-dot path segments and normalized away by the parser.
    if path.contains("..") || lower.contains("%2e") {
        return Err("path must not contain a '..' path-traversal segment".to_string());
    }
    // Percent-encoded separators have no legitimate use in a static route path and
    // could smuggle extra segments past route matching; reject them defensively.
    if lower.contains("%2f") || lower.contains("%5c") {
        return Err("path must not contain percent-encoded path separators".to_string());
    }
    Ok(())
}

/// A single plugin-to-plugin dependency edge.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct AppDependency {
    /// The `id` of the plugin this one depends on.
    pub id: String,

    /// Optional **minimum** version the dependency must satisfy.
    ///
    /// A bare version (`"1.2.0"`) is a *minimum*, i.e. `">=1.2.0"` — deliberately
    /// NOT semver's default caret (`^1.2.0`), which would reject `2.0.0`. Explicit
    /// comparator syntax (`">=1.2, <2"`, `"^1.2"`, `"~1.2"`) is honoured verbatim.
    /// See [`parse_min_version`], the single parser both validation and resolution
    /// use.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_version: Option<String>,
}

/// A host surface a plugin can declare support for via `targets`.
///
/// `core` is the headless node (a Core running with no UI at all).
///
/// An **empty/absent** `targets` list means the plugin runs on *every* surface —
/// that is the backward-compatible default and MUST NOT be read as "hidden".
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "kebab-case")]
pub enum Surface {
    /// The Ryu Gateway.
    Gateway,
    /// A headless Core node (no UI).
    Core,
    /// The Tauri desktop app.
    Desktop,
    /// The Electron dynamic-island companion.
    Island,
    /// The Expo/React-Native mobile app.
    Mobile,
    /// The browser extension.
    Extension,
    /// The Next.js web app.
    Web,
    /// The terminal client.
    Cli,
}

impl Surface {
    /// Stable kebab-case identifier — the exact token used on the wire (in a
    /// manifest's `targets` and in the `x-ryu-surface` request header).
    pub const fn as_str(self) -> &'static str {
        match self {
            Surface::Gateway => "gateway",
            Surface::Core => "core",
            Surface::Desktop => "desktop",
            Surface::Island => "island",
            Surface::Mobile => "mobile",
            Surface::Extension => "extension",
            Surface::Web => "web",
            Surface::Cli => "cli",
        }
    }

    /// Parse a surface token (e.g. the `x-ryu-surface` header). Case-insensitive.
    /// Returns `None` for an unknown surface, which callers MUST treat as
    /// "unknown caller → do not filter" rather than "filter everything out".
    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "gateway" => Some(Surface::Gateway),
            "core" => Some(Surface::Core),
            "desktop" => Some(Surface::Desktop),
            "island" => Some(Surface::Island),
            "mobile" => Some(Surface::Mobile),
            "extension" => Some(Surface::Extension),
            "web" => Some(Surface::Web),
            "cli" => Some(Surface::Cli),
            _ => None,
        }
    }
}

/// Parse a dependency `min_version` into a [`semver::VersionReq`].
///
/// **The single definition** of the min-version semantics, used by both the
/// manifest shape-validation (which rejects a malformed requirement at load) and
/// the graph resolver (which checks satisfiability against the installed set).
///
/// A bare version is a **minimum**, not a caret range:
/// `"1.2.0"` → `">=1.2.0"` (so an installed `2.0.0` satisfies it). This differs
/// from [`semver::VersionReq::parse`], whose bare form means `^1.2.0` and would
/// reject `2.0.0`. Anything that is not a bare version (`"^1.2"`, `">=1.0, <2"`,
/// `"*"`) is passed through to `VersionReq` verbatim.
pub fn parse_min_version(raw: &str) -> Result<semver::VersionReq, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("min_version must not be empty".to_string());
    }
    // A bare, fully-qualified version means ">= that version".
    if let Ok(v) = semver::Version::parse(trimmed) {
        return semver::VersionReq::parse(&format!(">={v}"))
            .map_err(|e| format!("invalid min_version '{raw}': {e}"));
    }
    // Otherwise it is comparator syntax — honour it as written.
    semver::VersionReq::parse(trimmed).map_err(|e| format!("invalid min_version '{raw}': {e}"))
}

/// The trust/distribution tier of a plugin.
///
/// - [`PluginTier::Core`] — a first-party, default-on plugin shipped with Ryu
///   (ghost/shadow/headroom/engines/sandbox/…). Seeded enabled at startup.
/// - [`PluginTier::Community`] — a third-party / user-installed plugin. Always
///   install-then-enable opt-in; never auto-enabled.
///
/// Tier is **derived from membership** (see Core's `plugins::builtins`), not a
/// field a manifest can self-assert — a plugin cannot promote itself to Core.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PluginTier {
    /// First-party, default-on.
    Core,
    /// Third-party / user-installed, opt-in.
    Community,
}

impl PluginTier {
    /// Stable lowercase identifier for the tier (for the `GET /api/plugins` JSON).
    pub const fn as_str(self) -> &'static str {
        match self {
            PluginTier::Core => "core",
            PluginTier::Community => "community",
        }
    }
}

// ── Unified permission grammar (one deny-by-default set) ──────────────────────

/// The single, typed, **deny-by-default** permission set a plugin manifest
/// declares, lowered by Core to every sandbox backend.
///
/// This is the one grammar that replaces three historically-disjoint ones:
/// the wasmtime/Docker [`crate`]-external `SandboxCapabilities` (typed but
/// unreachable from a manifest), the Deno PTC's hardcoded zero-allow-flag spawn,
/// and the opaque grant strings. A manifest declares ONE `permissions` block and
/// Core lowers it to WASI preopens, Docker mount/network flags, or Deno
/// `--allow-*` flags as appropriate.
///
/// **Every field defaults to empty/false — the zero value is deny-all.** A missing
/// `permissions` block (or an explicit `{}`) is byte-for-byte the same posture as
/// today's zero-permission sandbox, which is what preserves the existing live
/// deny-all tests.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
pub struct PermissionSet {
    /// Filesystem read/write path allowlists. Empty = no FS access.
    #[serde(default, skip_serializing_if = "FsPermissions::is_empty")]
    pub fs: FsPermissions,

    /// Whether the sandboxed code may spawn child processes. `false` (default) =
    /// no subprocess execution. Lowers to Deno's `--allow-run`; the wasmtime/Docker
    /// lowering has no subprocess channel to open, so this is a no-op there (a WASI
    /// module cannot fork, and the Docker exec is a single fixed argv).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub child_process: bool,

    /// Outbound network permission. `false`/absent (default) = no network; `true` =
    /// all hosts; a list of `host[:port]` entries = only those hosts (the shape
    /// Deno's `--allow-net` supports). See [`NetworkPermission`].
    #[serde(default, skip_serializing_if = "NetworkPermission::is_deny")]
    pub network: NetworkPermission,

    /// **Declaration-only** in v1: the registry tool ids this plugin's sandboxed
    /// code may call through the stdio `tools.*` bridge. Tools are brokered over
    /// stdout/stdin by Core (never an OS capability), so this does NOT lower to any
    /// `--allow-*` flag; it records intent and is a clean future extension for the
    /// `SandboxToolInvoker` allowlist. Empty (default) records no extra tool intent.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tool: Vec<String>,
}

impl PermissionSet {
    /// Validate the declared paths and hosts. Each FS path and each network host
    /// must be **non-empty** and must not contain a `..` traversal segment (a path
    /// that could escape its intended root once lowered to a real preopen/mount).
    pub fn validate(&self) -> Result<(), String> {
        for (label, paths) in [("fs.read", &self.fs.read), ("fs.write", &self.fs.write)] {
            for path in paths {
                if path.trim().is_empty() {
                    return Err(format!("permissions.{label} contains an empty path"));
                }
                if path.contains("..") {
                    return Err(format!(
                        "permissions.{label} path '{path}' must not contain a '..' traversal segment"
                    ));
                }
            }
        }
        if let NetworkPermission::Hosts(hosts) = &self.network {
            for host in hosts {
                if host.trim().is_empty() {
                    return Err("permissions.network contains an empty host entry".to_string());
                }
            }
        }
        for tool in &self.tool {
            if tool.trim().is_empty() {
                return Err("permissions.tool contains an empty tool id".to_string());
            }
        }
        Ok(())
    }
}

/// Filesystem read/write path allowlists. Empty sets = no filesystem access, which
/// is the deny-all default.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
pub struct FsPermissions {
    /// Absolute paths the sandbox may **read**. Empty = no read access.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub read: Vec<String>,
    /// Absolute paths the sandbox may **write**. Empty = no write access.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub write: Vec<String>,
}

impl FsPermissions {
    /// Whether both path sets are empty (the deny-all default) — the
    /// `skip_serializing_if` predicate that keeps a bare permission set lean.
    pub fn is_empty(&self) -> bool {
        self.read.is_empty() && self.write.is_empty()
    }
}

/// Outbound network permission, in the shape Deno's `--allow-net` supports: a bare
/// boolean (`false` = deny all, `true` = allow all) or an explicit `host[:port]`
/// allowlist.
///
/// Untagged so the wire form is natural: `false` / `true` deserialize to
/// [`NetworkPermission::All`]; a JSON array deserializes to
/// [`NetworkPermission::Hosts`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum NetworkPermission {
    /// Allow all hosts (`true`) or none (`false`).
    All(bool),
    /// Allow only these `host[:port]` entries.
    Hosts(Vec<String>),
}

impl Default for NetworkPermission {
    /// Deny-all: `All(false)`.
    fn default() -> Self {
        NetworkPermission::All(false)
    }
}

impl NetworkPermission {
    /// Whether this permission denies **all** network access — `All(false)` or an
    /// empty host list. The deny-all default and the `skip_serializing_if`
    /// predicate that keeps a bare permission set lean.
    pub fn is_deny(&self) -> bool {
        match self {
            NetworkPermission::All(allowed) => !*allowed,
            NetworkPermission::Hosts(hosts) => hosts.is_empty(),
        }
    }

    /// Whether **any** outbound network is permitted (the inverse of
    /// [`Self::is_deny`]). Used by the wasmtime/Docker lowering, whose network knob
    /// is a single boolean (host-scoping only lowers to Deno's `--allow-net=…`).
    pub fn is_allowed(&self) -> bool {
        !self.is_deny()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runnable::RunnableKind;

    #[test]
    fn validate_plugin_id_accepts_bare_and_dotted_rejects_traversal() {
        assert!(validate_plugin_id("ghost").is_ok());
        assert!(validate_plugin_id("data-grid-explorer").is_ok());
        assert!(validate_plugin_id("@example/research-assistant").is_ok());
        for bad in [
            "../../etc/x",
            "..",
            "a/../b",
            ".hidden",
            "app.",
            "-lead",
            "",
        ] {
            assert!(validate_plugin_id(bad).is_err(), "'{bad}' must be rejected");
        }
    }

    // ── scoped plugin ids ────────────────────────────────────────────────────

    /// The scoped form is matched as an exact SHAPE. The traversal cases matter most:
    /// a wider character allowlist covering `@` and `/` would make `@a/../../etc`
    /// legal, and the id reaches `PathBuf::join`.
    #[test]
    fn scoped_plugin_ids_are_shape_matched_and_reject_traversal() {
        for ok in [
            "@ryu/meetings",
            "@ryu/skill-editor",
            "@example/research-assistant",
        ] {
            assert!(validate_plugin_id(ok).is_ok(), "'{ok}' must be accepted");
        }
        for bad in [
            "@a/../../etc",   // traversal in the name half
            "@../x/y",        // traversal in the scope half
            "@ryu/a/b",       // more than one slash
            "@ryu/",          // empty name
            "@/meetings",     // empty scope
            "@ryu/.hidden",   // leading dot in name
            "@ryu/-lead",     // leading dash in name
            "@ryu/C:drive",   // Windows drive-qualified component
            "@ryu/a\\b",      // backslash separator
            "ryu/meetings",   // slash without the @ marker
            "@@ryu/meetings", // '@' inside a half
        ] {
            assert!(validate_plugin_id(bad).is_err(), "'{bad}' must be rejected");
        }
    }

    /// Legacy flat ids stay legal forever — the alias map means a third-party
    /// manifest that was never updated must keep loading.
    #[test]
    fn legacy_flat_ids_remain_valid_alongside_scoped_ones() {
        for ok in ["ghost", "data-grid-explorer", "com.acme.research-assistant"] {
            assert!(
                validate_plugin_id(ok).is_ok(),
                "'{ok}' must still be accepted"
            );
        }
    }

    /// A scoped id must never reach a path with its `/` intact: the manifest scanner
    /// is a single-level `read_dir`, so a nested dir is INVISIBLE rather than broken.
    #[test]
    fn scoped_ids_flatten_to_a_single_disk_component() {
        assert_eq!(plugin_dir_name("@ryu/meetings"), "@ryu+meetings");
        assert!(!plugin_dir_name("@ryu/meetings").contains('/'));
        // A legacy id is its own disk name, so nothing on disk moves for them.
        assert_eq!(plugin_dir_name("ghost"), "ghost");
        assert_eq!(
            plugin_dir_name("com.acme.research-assistant"),
            "com.acme.research-assistant"
        );
        // `+` is outside the id alphabet, so the flattened form can never collide
        // with a real id.
        assert!(validate_plugin_id("@ryu+meetings").is_err());
    }

    /// An unknown id passes through unchanged — canonicalization must never invent
    /// a mapping.
    #[test]
    fn canonicalizing_an_unaliased_id_is_identity() {
        assert_eq!(canonical_plugin_id("@ryu/meetings"), "@ryu/meetings");
        assert_eq!(canonical_plugin_id("totally-unknown"), "totally-unknown");
        for (old, new) in LEGACY_PLUGIN_ID_ALIASES {
            assert_eq!(canonical_plugin_id(old), *new, "alias '{old}' must resolve");
            assert_eq!(
                canonical_plugin_id(new),
                *new,
                "canonicalization must be idempotent for '{new}'"
            );
        }
    }

    // ── hook events (the provider half of the hook system) ───────────────────

    fn event(id: &str) -> HookEventContribution {
        HookEventContribution {
            id: id.to_owned(),
            title: "Something happened".to_owned(),
            description: None,
            payload_example: None,
        }
    }

    /// The namespace rule is what makes an app event unable to shadow a Core hook
    /// phase, so it is checked at load rather than trusted at emit.
    #[test]
    fn hook_event_id_must_be_namespaced_to_its_own_plugin() {
        assert!(
            validate_hook_event(&event("com.acme.meet#meeting.ended"), "com.acme.meet").is_ok()
        );

        // Bare (un-namespaced) — this is the shape that could collide with a Core
        // phase, and the exact thing the separator rule exists to reject.
        assert!(validate_hook_event(&event("meeting.ended"), "com.acme.meet").is_err());
        assert!(validate_hook_event(&event("post_assistant_turn"), "com.acme.meet").is_err());

        // Namespaced to somebody ELSE — declaring this would let an app publish a
        // contract in a namespace it cannot emit into.
        assert!(validate_hook_event(&event("com.other.app#thing.done"), "com.acme.meet").is_err());

        // Malformed halves.
        assert!(validate_hook_event(&event("#meeting.ended"), "com.acme.meet").is_err());
        assert!(validate_hook_event(&event("com.acme.meet#"), "com.acme.meet").is_err());
        assert!(validate_hook_event(&event("com.acme.meet#a#b"), "com.acme.meet").is_err());
        assert!(
            validate_hook_event(&event("com.acme.meet#Meeting.Ended"), "com.acme.meet").is_err()
        );
        assert!(validate_hook_event(&event("com.acme.meet#.leading"), "com.acme.meet").is_err());
    }

    /// A titleless event is invisible in the picker, so it is rejected rather than
    /// shipped as a blank row.
    #[test]
    fn hook_event_requires_a_title() {
        let mut e = event("com.acme.meet#meeting.ended");
        e.title = "  ".to_owned();
        assert!(validate_hook_event(&e, "com.acme.meet").is_err());
    }

    /// No Core hook phase may be app-event shaped, and no app event may be
    /// Core-phase shaped. This is the whole collision argument, asserted directly
    /// rather than left as a comment.
    #[test]
    fn core_phase_names_and_app_events_occupy_disjoint_namespaces() {
        for phase in [
            "post_assistant_turn",
            "pre_user_turn",
            "session_start",
            "stop",
            "pre_tool_use",
            "post_tool_use",
            "tool_result",
            "subagent_stop",
            "session_end",
            "notification",
            "context",
            "message_end",
            "session_before_compact",
            "session_compact",
            "model_select",
            "session_tree",
        ] {
            assert!(
                !is_app_event(phase),
                "'{phase}' must not parse as an app event"
            );
        }
        assert!(is_app_event("com.acme.meet#meeting.ended"));
        assert_eq!(
            split_hook_event_id("com.acme.meet#meeting.ended"),
            Some(("com.acme.meet", "meeting.ended"))
        );
    }

    /// Two rows with the same id mean the second silently shadows the first in the
    /// catalog, so the duplicate is a load error.
    #[test]
    fn duplicate_hook_event_ids_are_rejected() {
        let contributes = Contributes {
            hook_events: vec![
                event("com.acme.meet#meeting.ended"),
                event("com.acme.meet#meeting.ended"),
            ],
            ..Default::default()
        };
        assert!(contributes.validate_hook_events("com.acme.meet").is_err());
    }

    /// A consumer may subscribe to an event nothing declares — that is how a
    /// consumer gets installed before its provider, and it must not be a load error.
    #[test]
    fn consuming_an_undeclared_event_is_not_a_load_error() {
        let contributes = Contributes {
            turn_hooks: vec![TurnHookContribution {
                id: "on-meeting-end".to_owned(),
                on: "com.not.installed#meeting.ended".to_owned(),
                code: "return {kind:'none'}".to_owned(),
                code_file: None,
                run_when: None,
            }],
            ..Default::default()
        };
        assert!(contributes
            .validate_hook_events("com.acme.consumer")
            .is_ok());
    }

    // ── code_file hydration ──────────────────────────────────────────────────

    /// A manifest with one turn hook and one capability adapter, both declaring
    /// their body by `code_file`.
    fn code_file_manifest() -> &'static str {
        r#"{
            "id": "com.example.hooks",
            "name": "Hooks",
            "version": "1.0.0",
            "runnables": [],
            "contributes": {
                "turn_hooks": [
                    { "id": "h.one", "on": "post_assistant_turn", "code_file": "hooks/one.js" }
                ]
            },
            "provides": [
                {
                    "capability": "web.search",
                    "version": "1.0.0",
                    "tools": {
                        "web__search": {
                            "tool": "x__search",
                            "adapter": { "code_file": "adapters/web__search.js" }
                        }
                    }
                }
            ]
        }"#
    }

    #[test]
    fn hydration_fills_code_and_clears_code_file() {
        let m = PluginManifest::parse_and_validate_with_code(code_file_manifest(), |rel| {
            Ok(format!("// {rel}\nreturn null;\n"))
        })
        .expect("hydrates");

        let hook = &m.contributes.as_ref().unwrap().turn_hooks[0];
        assert_eq!(hook.code, "// hooks/one.js\nreturn null;\n");
        assert!(
            hook.code_file.is_none(),
            "code_file must be cleared so the hydrated manifest is indistinguishable from an \
             inline one and every read site keeps reading `code`"
        );
        let adapter = m.provides[0].tools["web__search"].adapter.as_ref().unwrap();
        assert_eq!(adapter.code, "// adapters/web__search.js\nreturn null;\n");
        assert!(adapter.code_file.is_none());
    }

    #[test]
    fn code_file_refs_lists_both_nodes_then_empties_after_hydration() {
        let mut m: PluginManifest = serde_json::from_str(code_file_manifest()).unwrap();
        assert_eq!(
            m.code_file_refs(),
            vec![
                "hooks/one.js".to_string(),
                "adapters/web__search.js".to_string()
            ]
        );
        m.hydrate_code_files(|_| Ok("return null;".to_string()))
            .expect("hydrates");
        assert!(m.code_file_refs().is_empty());
    }

    /// Parsing a `code_file` manifest WITHOUT a resolver must fail loudly. The
    /// alternative — `code` left empty and the sandbox running nothing — is
    /// indistinguishable at every read site from a hook that chose to do nothing.
    #[test]
    fn parse_without_a_resolver_rejects_a_code_file_manifest() {
        let err = PluginManifest::parse_and_validate(code_file_manifest()).unwrap_err();
        assert!(
            err.contains("code_file") && err.contains("parse_and_validate_with_code"),
            "error must name the missing resolver: {err}"
        );
    }

    #[test]
    fn declaring_both_code_and_code_file_is_rejected() {
        let raw = r#"{
            "id": "com.example.both",
            "name": "Both",
            "version": "1.0.0",
            "runnables": [],
            "contributes": {
                "turn_hooks": [{
                    "id": "h.one", "on": "post_assistant_turn",
                    "code": "return null;", "code_file": "hooks/one.js"
                }]
            }
        }"#;
        let err =
            PluginManifest::parse_and_validate_with_code(raw, |_| Ok("return null;".to_string()))
                .unwrap_err();
        assert!(err.contains("exactly one is allowed"), "got: {err}");
    }

    #[test]
    fn declaring_neither_code_nor_code_file_is_rejected() {
        let raw = r#"{
            "id": "com.example.neither",
            "name": "Neither",
            "version": "1.0.0",
            "runnables": [],
            "contributes": {
                "turn_hooks": [{ "id": "h.one", "on": "post_assistant_turn" }]
            }
        }"#;
        let err =
            PluginManifest::parse_and_validate_with_code(raw, |_| Ok("return null;".to_string()))
                .unwrap_err();
        assert!(err.contains("declares neither"), "got: {err}");
    }

    #[test]
    fn an_unresolvable_code_file_is_an_error_not_an_empty_body() {
        let err = PluginManifest::parse_and_validate_with_code(code_file_manifest(), |rel| {
            Err(format!("no such file: {rel}"))
        })
        .unwrap_err();
        assert!(err.contains("cannot resolve code_file"), "got: {err}");
    }

    #[test]
    fn an_empty_code_file_is_an_error() {
        let err = PluginManifest::parse_and_validate_with_code(code_file_manifest(), |_| {
            Ok("   \n".to_string())
        })
        .unwrap_err();
        assert!(err.contains("is empty"), "got: {err}");
    }

    /// The path is joined onto a plugin's own directory, so it is a traversal sink.
    /// Windows matters here: `\` is a separator and a drive-qualified component
    /// silently replaces the base in `PathBuf::join`.
    #[test]
    fn code_file_path_allowlist_rejects_traversal_and_stray_dirs() {
        assert!(validate_code_file_path("hooks/one.js").is_ok());
        assert!(validate_code_file_path("adapters/web__search.mjs").is_ok());
        for bad in [
            "",
            "one.js",              // no dir segment
            "hooks/nested/one.js", // not flat: breaks the mirror's glob
            "src/one.js",          // dir not in CODE_FILE_DIRS
            "hooks/../../../etc/passwd",
            "../hooks/one.js",
            "/etc/passwd",
            "hooks\\one.js", // Windows separator
            "C:/hooks/one.js",
            "hooks/one.txt", // not JS
            "hooks/.hidden.js",
            "hooks/one.js.js/../x.js",
        ] {
            assert!(
                validate_code_file_path(bad).is_err(),
                "'{bad}' must be rejected"
            );
        }
    }

    #[test]
    fn an_oversized_code_file_is_rejected() {
        let big = "x".repeat(MAX_CODE_FILE_BYTES + 1);
        let err =
            PluginManifest::parse_and_validate_with_code(code_file_manifest(), |_| Ok(big.clone()))
                .unwrap_err();
        assert!(err.contains("max"), "got: {err}");
    }

    #[test]
    fn an_inline_only_manifest_still_parses_without_a_resolver() {
        let raw = r#"{
            "id": "com.example.inline",
            "name": "Inline",
            "version": "1.0.0",
            "runnables": [],
            "contributes": {
                "turn_hooks": [{
                    "id": "h.one", "on": "post_assistant_turn", "code": "return null;"
                }]
            }
        }"#;
        let m = PluginManifest::parse_and_validate(raw).expect("inline form is still valid");
        assert_eq!(m.contributes.unwrap().turn_hooks[0].code, "return null;");
    }

    #[test]
    fn parse_and_validate_minimal_manifest() {
        let raw = r#"{
            "id": "com.example.minimal",
            "name": "Minimal",
            "version": "0.1.0",
            "runnables": [ { "id": "agent-x", "name": "Agent X", "kind": "agent" } ]
        }"#;
        let m = PluginManifest::parse_and_validate(raw).expect("validate");
        assert_eq!(m.runnables().len(), 1);
        assert_eq!(m.runnable_metas()[0].kind, RunnableKind::Agent);
        assert!(m.supports_surface(Surface::Desktop));
    }

    #[test]
    fn full_manifest_round_trips_through_json() {
        let raw = r#"{
            "id": "com.example.meetings",
            "name": "Meetings",
            "version": "1.0.0",
            "runnables": [],
            "requires": { "apps": [{ "id": "@ryu/spaces", "min_version": "1.0.0" }] },
            "targets": ["core", "desktop"]
        }"#;
        let m = PluginManifest::parse_and_validate(raw).expect("parse");
        assert_eq!(m.dependencies().len(), 1);
        assert!(!m.supports_surface(Surface::Gateway));
        let round =
            PluginManifest::parse_and_validate(&serde_json::to_string(&m).unwrap()).unwrap();
        assert_eq!(m, round);
    }

    #[test]
    fn parse_min_version_bare_is_minimum() {
        let req = parse_min_version("1.2.0").unwrap();
        assert!(req.matches(&semver::Version::parse("2.0.0").unwrap()));
    }

    // ── surfaces map: present is authoritative, absent delegates to targets ──────

    #[test]
    fn surfaces_present_is_authoritative_and_targets_ignored() {
        // `surfaces` present ⇒ only listed non-none surfaces supported; `targets`
        // (which would say gateway too) is ignored.
        let raw = r#"{
            "id": "com.example.surf",
            "name": "Surf",
            "version": "1.0.0",
            "runnables": [],
            "targets": ["gateway"],
            "surfaces": {
                "desktop": { "support": "full" },
                "web": { "support": "list" },
                "mobile": { "support": "none" }
            }
        }"#;
        let m = PluginManifest::parse_and_validate(raw).expect("parse");
        assert!(m.supports_surface(Surface::Desktop), "declared full");
        assert!(m.supports_surface(Surface::Web), "declared list");
        assert!(!m.supports_surface(Surface::Mobile), "explicit none");
        assert!(
            !m.supports_surface(Surface::Island),
            "absent key ⇒ unsupported"
        );
        assert!(
            !m.supports_surface(Surface::Gateway),
            "targets ignored when surfaces present"
        );
        // Round-trips.
        let round =
            PluginManifest::parse_and_validate(&serde_json::to_string(&m).unwrap()).unwrap();
        assert_eq!(m, round);
    }

    #[test]
    fn surfaces_absent_falls_back_to_targets_all_surfaces() {
        // The tripwire: no surfaces + no targets ⇒ every surface (back-compat).
        let raw = r#"{
            "id": "com.example.legacy",
            "name": "Legacy",
            "version": "1.0.0",
            "runnables": []
        }"#;
        let m = PluginManifest::parse_and_validate(raw).expect("parse");
        assert!(m.surfaces.is_none());
        for s in [
            Surface::Desktop,
            Surface::Gateway,
            Surface::Mobile,
            Surface::Cli,
        ] {
            assert!(m.supports_surface(s), "absent surfaces ⇒ all surfaces");
        }
    }

    #[test]
    fn surfaces_cli_commands_parse_round_trip_and_skip_when_empty() {
        // A cli-only app declaring `ryu <app> <cmd>` subcommands.
        let raw = r#"{
            "id": "com.example.mail",
            "name": "Mail",
            "version": "1.0.0",
            "runnables": [],
            "surfaces": {
                "cli": {
                    "support": "commands",
                    "commands": [
                        { "name": "status", "summary": "Show inbox status", "method": "GET", "path": "/status" },
                        { "name": "send", "path": "/send" }
                    ]
                }
            }
        }"#;
        let m = PluginManifest::parse_and_validate(raw).expect("parse");
        // (a) the cli surface is supported (support != None).
        assert!(m.supports_surface(Surface::Cli), "commands ⇒ cli supported");
        assert!(!m.supports_surface(Surface::Desktop), "only cli declared");
        // (b) the commands are carried through, method/summary optional.
        let cli = m.surfaces.as_ref().unwrap().get(&Surface::Cli).unwrap();
        assert_eq!(cli.commands.len(), 2);
        assert_eq!(cli.commands[0].name, "status");
        assert_eq!(cli.commands[0].method.as_deref(), Some("GET"));
        assert_eq!(
            cli.commands[0].summary.as_deref(),
            Some("Show inbox status")
        );
        assert_eq!(cli.commands[1].name, "send");
        assert_eq!(cli.commands[1].method, None);
        assert_eq!(cli.commands[1].summary, None);
        // (c) round-trips through serde_json preserving commands.
        let value = serde_json::to_value(&m).unwrap();
        assert_eq!(
            value["surfaces"]["cli"]["commands"][0]["name"],
            serde_json::json!("status")
        );
        let round =
            PluginManifest::parse_and_validate(&serde_json::to_string(&m).unwrap()).unwrap();
        assert_eq!(m, round);
    }

    #[test]
    fn cli_command_path_rejects_traversal_and_accepts_plain_subpaths() {
        // Safe, plain absolute sub-paths pass.
        for ok in ["/status", "/inboxes/send", "/a-b_c/1", "/x?y=1"] {
            assert!(
                validate_cli_command_path(ok).is_ok(),
                "'{ok}' must be allowed"
            );
        }
        // Every traversal / escape form is rejected — literal `..`, percent-encoded
        // `%2e`, backslash separators, encoded separators, and a non-absolute path.
        for bad in [
            "/../../../v1/chat/completions",
            "/../api/plugins/@ryu/mail/uninstall",
            "/foo/../../bar",
            "/%2e%2e/%2e%2e/v1",
            "/foo/%2E%2E/bar",
            "/..\\..\\v1",
            "/foo%2fbar",
            "status", // not absolute
            "",       // empty
        ] {
            assert!(
                validate_cli_command_path(bad).is_err(),
                "'{bad}' must be rejected"
            );
        }
    }

    #[test]
    fn manifest_with_traversal_cli_command_fails_to_validate() {
        // The load-time gate: a malicious app shipping a `..` command path is
        // rejected at parse_and_validate, so it never installs.
        let raw = r#"{
            "id": "com.evil.app",
            "name": "Evil",
            "version": "1.0.0",
            "runnables": [],
            "surfaces": {
                "cli": {
                    "support": "commands",
                    "commands": [
                        { "name": "pwn", "method": "POST", "path": "/../../../v1/chat/completions" }
                    ]
                }
            }
        }"#;
        let err = PluginManifest::parse_and_validate(raw).unwrap_err();
        assert!(err.contains("path-traversal"), "got: {err}");
        assert!(err.contains("pwn"), "names the offending command: {err}");
    }

    #[test]
    fn surfaces_entry_omits_empty_commands_key() {
        // A surface entry with no commands must NOT serialize a `commands` key
        // (skip_serializing_if), so existing manifests stay byte-stable.
        let entry = SurfaceEntry {
            support: SurfaceSupport::Full,
            ui: None,
            commands: Vec::new(),
        };
        let value = serde_json::to_value(&entry).unwrap();
        assert!(
            value.get("commands").is_none(),
            "empty commands must be omitted"
        );
    }

    // ── provides / requires.capabilities validation ─────────────────────────────

    #[test]
    fn provides_and_requires_capabilities_round_trip() {
        let raw = r#"{
            "id": "com.example.rag",
            "name": "RAG",
            "version": "1.0.0",
            "runnables": [],
            "sidecars": [{
                "name": "rag",
                "process": { "kind": "binary", "url": "https://example.com/rag", "version": "1.0.0", "sha256": "0000000000000000000000000000000000000000000000000000000000000000" },
                "port": 9099,
                "http": { "routes": [{ "path": "/query" }] }
            }],
            "provides": [{ "capability": "rag", "version": "1.5.0", "sidecar": "rag", "route": "/query", "grant": "cap:rag" }]
        }"#;
        let m = PluginManifest::parse_and_validate(raw).expect("valid provides");
        assert_eq!(m.provided_capabilities().len(), 1);
        assert_eq!(m.provided_capabilities()[0].version, "1.5.0");

        let consumer = r#"{
            "id": "com.example.spaces",
            "name": "Spaces",
            "version": "1.0.0",
            "runnables": [],
            "requires": { "capabilities": [{ "capability": "rag", "min_version": "1.0.0" }] }
        }"#;
        let c = PluginManifest::parse_and_validate(consumer).expect("valid consumer");
        assert_eq!(c.required_capabilities().len(), 1);
        assert_eq!(c.required_capabilities()[0].capability, "rag");
    }

    #[test]
    fn provides_referencing_unknown_sidecar_is_rejected() {
        let raw = r#"{
            "id": "com.example.bad",
            "name": "Bad",
            "version": "1.0.0",
            "runnables": [],
            "provides": [{ "capability": "rag", "version": "1.0.0", "sidecar": "nope", "route": "/query" }]
        }"#;
        let err = PluginManifest::parse_and_validate(raw).unwrap_err();
        assert!(err.contains("not declared"), "got: {err}");
    }

    #[test]
    fn provides_route_not_on_sidecar_is_rejected() {
        let raw = r#"{
            "id": "com.example.bad2",
            "name": "Bad2",
            "version": "1.0.0",
            "runnables": [],
            "sidecars": [{
                "name": "rag",
                "process": { "kind": "binary", "url": "https://example.com/rag", "version": "1.0.0", "sha256": "0000000000000000000000000000000000000000000000000000000000000000" },
                "port": 9099,
                "http": { "routes": [{ "path": "/query" }] }
            }],
            "provides": [{ "capability": "rag", "version": "1.0.0", "sidecar": "rag", "route": "/missing" }]
        }"#;
        let err = PluginManifest::parse_and_validate(raw).unwrap_err();
        assert!(err.contains("route '/missing'"), "got: {err}");
    }

    #[test]
    fn python_sidecar_process_parses_despite_the_kind_tag_collision() {
        // Regression: SidecarProcess is `#[serde(tag = "kind")]` and its Python
        // variant wraps ExternalRuntimeConfig which also had a required `kind` — the
        // outer tag consumed `"kind"`, so the inner field was reported missing and a
        // whole default-on app (finetune) silently never loaded. The inner `kind`
        // now defaults to "python".
        let raw = r#"{
            "id": "com.example.py",
            "name": "Py",
            "version": "1.0.0",
            "runnables": [],
            "sidecars": [{
                "name": "worker",
                "process": { "kind": "python", "entry": "my_worker" },
                "port": 8200
            }]
        }"#;
        let m = PluginManifest::parse_and_validate(raw).expect("python sidecar parses");
        match &m.sidecars[0].process {
            crate::schema::SidecarProcess::Python(rt) => {
                assert_eq!(rt.kind, "python");
                assert_eq!(rt.entry, "my_worker");
            }
            other => panic!("expected Python process, got {other:?}"),
        }
    }

    #[test]
    fn views_contribution_round_trips_and_is_self_contained() {
        // A `views` contribution is opaque + self-contained: its `view`/`spec` are
        // NOT cross-validated against `runnables` (like composer_controls), so a
        // manifest that declares only a view still validates and round-trips.
        let raw = r#"{
            "id": "com.example.hello-views",
            "name": "Hello Views",
            "version": "1.0.0",
            "runnables": [],
            "contributes": {
                "views": [
                    {
                        "id": "hello",
                        "title": "Hello",
                        "view": "list-detail",
                        "spec": {
                            "items": [
                                { "id": "a", "title": "Alpha", "detail": "The first letter." }
                            ]
                        }
                    }
                ]
            }
        }"#;
        let m = PluginManifest::parse_and_validate(raw).expect("views manifest validates");
        let views = &m.contributes.as_ref().unwrap().views;
        assert_eq!(views.len(), 1);
        assert_eq!(views[0].id, "hello");
        assert_eq!(views[0].view, "list-detail");
        assert_eq!(views[0].title.as_deref(), Some("Hello"));
        assert!(views[0].spec.is_some(), "opaque spec is carried through");
        // A view id is NOT a runnable reference, so it never appears in referenced_ids.
        assert!(
            m.contributes.as_ref().unwrap().referenced_ids().is_empty(),
            "views must not be cross-validated as runnable references"
        );
        let round =
            PluginManifest::parse_and_validate(&serde_json::to_string(&m).unwrap()).unwrap();
        assert_eq!(m, round);
    }

    #[test]
    fn views_omit_optional_fields_when_absent() {
        // A minimal view (no title, no spec) drops both keys via skip_serializing_if,
        // so the wire stays lean and existing manifests are byte-stable.
        let vc = ViewContribution {
            id: "bare".to_string(),
            title: None,
            view: "empty-state".to_string(),
            spec: None,
        };
        let value = serde_json::to_value(&vc).unwrap();
        assert!(value.get("title").is_none(), "absent title omitted");
        assert!(value.get("spec").is_none(), "absent spec omitted");
        assert_eq!(value["view"], serde_json::json!("empty-state"));
    }

    #[test]
    fn dock_panel_contribution_round_trips_and_is_self_contained() {
        // The dock sibling of `views_contribution_round_trips_and_is_self_contained`:
        // a `dock_panels` entry is opaque + self-contained, so a manifest that declares
        // only a panel (no runnables) still validates and round-trips, and its `panel`
        // discriminant / `spec` are NOT cross-validated against `runnables`.
        let raw = r#"{
            "id": "com.example.dock",
            "name": "Dock",
            "version": "1.0.0",
            "runnables": [],
            "contributes": {
                "dock_panels": [
                    {
                        "id": "preview",
                        "title": "Preview",
                        "icon": "hugeicons:globe-02",
                        "placement": "both",
                        "order": 10,
                        "panel": "companion",
                        "spec": { "companion": "preview-ui" }
                    }
                ]
            }
        }"#;
        let m = PluginManifest::parse_and_validate(raw).expect("dock panel manifest validates");
        let panels = &m.contributes.as_ref().unwrap().dock_panels;
        assert_eq!(panels.len(), 1);
        assert_eq!(panels[0].id, "preview");
        assert_eq!(panels[0].panel, "companion");
        assert_eq!(panels[0].placement, DockPanelPlacement::Both);
        assert_eq!(panels[0].order, Some(10));
        assert!(panels[0].spec.is_some(), "opaque spec is carried through");
        // `spec.companion` names a runnable, but the panel is still not a runnable
        // REFERENCE for cross-validation purposes — same contract as `views`.
        assert!(
            m.contributes.as_ref().unwrap().referenced_ids().is_empty(),
            "dock panels must not be cross-validated as runnable references"
        );
        let round =
            PluginManifest::parse_and_validate(&serde_json::to_string(&m).unwrap()).unwrap();
        assert_eq!(m, round);
    }

    #[test]
    fn dock_panel_omits_optional_fields_and_fans_out_both() {
        // A minimal panel drops icon/order/spec via skip_serializing_if, but `placement`
        // has no skip: it always ships so a renderer never has to know the default.
        let dp = DockPanelContribution {
            id: "bare".to_string(),
            title: "Bare".to_string(),
            icon: None,
            placement: DockPanelPlacement::default(),
            order: None,
            panel: "native".to_string(),
            spec: None,
        };
        let value = serde_json::to_value(&dp).unwrap();
        assert!(value.get("icon").is_none(), "absent icon omitted");
        assert!(value.get("order").is_none(), "absent order omitted");
        assert!(value.get("spec").is_none(), "absent spec omitted");
        assert_eq!(value["placement"], serde_json::json!("bottom"));
        // `Both` fans out to the two REAL docks, never to itself.
        assert_eq!(
            DockPanelPlacement::Both.docks(),
            &[DockPanelPlacement::Bottom, DockPanelPlacement::Right]
        );
        assert_eq!(
            DockPanelPlacement::Right.docks(),
            &[DockPanelPlacement::Right]
        );
    }

    #[test]
    fn unknown_dock_placement_falls_back_instead_of_failing() {
        // A dock name from a newer shell must cost the plugin its PLACEMENT, not its
        // whole manifest: the sidecar/tool/runnable it ships keep loading and the panel
        // simply opens in the drawer. Same contract as an unknown settings field type.
        let raw = r#"{
            "id": "com.example.dock",
            "name": "Dock",
            "version": "1.0.0",
            "runnables": [],
            "contributes": {
                "dock_panels": [
                    { "id": "p", "title": "P", "placement": "left", "panel": "native" }
                ]
            }
        }"#;
        let m = PluginManifest::parse_and_validate(raw)
            .expect("an unrecognised dock must not fail the manifest");
        let panels = &m.contributes.as_ref().unwrap().dock_panels;
        assert_eq!(panels[0].placement, DockPanelPlacement::Bottom);
    }

    // ── language servers ─────────────────────────────────────────────────────────

    #[test]
    fn lsp_server_parses_claude_code_config_verbatim() {
        // The interop claim, tested literally: a Claude Code language-server body
        // pasted under `lsp_servers` must parse with every field landing where it
        // belongs. Only the container key is Ryu's; the entry is Claude's camelCase.
        let raw = r#"{
            "id": "com.example.lsp",
            "name": "LSP",
            "version": "1.0.0",
            "runnables": [],
            "contributes": {
                "lsp_servers": {
                    "go": {
                        "command": "gopls",
                        "args": ["serve"],
                        "extensionToLanguage": { ".go": "go" },
                        "transport": "stdio",
                        "env": { "GOFLAGS": "-mod=mod" },
                        "initializationOptions": { "usePlaceholders": true },
                        "settings": { "gopls": { "staticcheck": true } },
                        "workspaceFolder": "/srv/project",
                        "startupTimeout": 15000,
                        "shutdownTimeout": 2000,
                        "restartOnCrash": false,
                        "maxRestarts": 3,
                        "diagnostics": false
                    }
                }
            }
        }"#;
        let m = PluginManifest::parse_and_validate(raw).expect("lsp manifest validates");
        let servers = &m.contributes.as_ref().unwrap().lsp_servers;
        assert_eq!(servers.len(), 1);
        let go = &servers["go"];
        assert_eq!(go.command, "gopls");
        assert_eq!(go.args, vec!["serve".to_string()]);
        assert_eq!(go.extension_to_language[".go"], "go");
        assert_eq!(go.transport, "stdio");
        assert_eq!(go.transport_kind(), LspTransport::Stdio);
        assert_eq!(go.env["GOFLAGS"], "-mod=mod");
        assert_eq!(
            go.initialization_options,
            Some(serde_json::json!({ "usePlaceholders": true }))
        );
        assert_eq!(
            go.settings,
            Some(serde_json::json!({ "gopls": { "staticcheck": true } }))
        );
        assert_eq!(go.workspace_folder.as_deref(), Some("/srv/project"));
        assert_eq!(go.startup_timeout, Some(15000));
        assert_eq!(go.shutdown_timeout, Some(2000));
        assert!(!go.restart_on_crash, "explicit false is honoured");
        assert_eq!(go.max_restarts, Some(3));
        assert!(!go.diagnostics, "explicit false is honoured");
        // A server name is not a runnable id — it names a PATH binary — so it must
        // never reach the loader's cross-validation.
        assert!(
            m.contributes.as_ref().unwrap().referenced_ids().is_empty(),
            "lsp servers must not be cross-validated as runnable references"
        );
        let round =
            PluginManifest::parse_and_validate(&serde_json::to_string(&m).unwrap()).unwrap();
        assert_eq!(m, round);
    }

    #[test]
    fn lsp_server_accepts_the_documented_claude_code_example_byte_for_byte() {
        // The `.lsp.json` example from Claude Code's plugins reference, pasted
        // verbatim — a whole `.lsp.json` file IS the value of `lsp_servers`, which is
        // the interop claim stated as an equation rather than reasoned about. The
        // test above exercises every field; this one pins the exact bytes a user
        // copies out of the docs, and the defaults they get for the twelve fields
        // that example omits.
        const CLAUDE_CODE_LSP_JSON: &str = r#"{
  "go": {
    "command": "gopls",
    "args": ["serve"],
    "extensionToLanguage": {
      ".go": "go"
    }
  }
}"#;
        let servers: BTreeMap<String, LspServerContribution> =
            serde_json::from_str(CLAUDE_CODE_LSP_JSON).expect("a real .lsp.json parses as-is");
        let go = &servers["go"];
        assert_eq!(go.command, "gopls");
        assert_eq!(go.args, vec!["serve".to_string()]);
        assert_eq!(go.extension_to_language[".go"], "go");
        // The defaults this example leans on, from THIS input rather than a
        // hand-built struct: stdio transport, restart on crash, diagnostics pushed.
        assert_eq!(go.transport, LspTransport::STDIO);
        assert_eq!(go.transport_kind(), LspTransport::Stdio);
        assert!(go.restart_on_crash, "restartOnCrash defaults to true");
        assert!(go.diagnostics, "diagnostics defaults to true");
        go.validate("go")
            .expect("the documented example is startable");

        // Round-trip: what we serialize back is what Claude Code reads, so the same
        // bytes survive a trip through Ryu and land in the other host unchanged.
        let round: BTreeMap<String, LspServerContribution> =
            serde_json::from_str(&serde_json::to_string(&servers).unwrap()).unwrap();
        assert_eq!(servers, round);

        // And the whole file drops into `contributes.lsp_servers` unedited.
        let manifest = format!(
            r#"{{"id":"com.example.lsp","name":"LSP","version":"1.0.0","runnables":[],
                "contributes": {{ "lsp_servers": {CLAUDE_CODE_LSP_JSON} }} }}"#
        );
        let m = PluginManifest::parse_and_validate(&manifest).expect("manifest validates");
        assert_eq!(m.contributes.as_ref().unwrap().lsp_servers, servers);
    }

    #[test]
    fn lsp_server_defaults_match_claude_code() {
        // `restartOnCrash` and `diagnostics` default TRUE in Claude Code. A bare
        // `#[serde(default)]` on a bool would yield false and silently invert both,
        // and nothing else in the suite would notice — this is that guard.
        let raw = r#"{
            "id": "com.example.lsp",
            "name": "LSP",
            "version": "1.0.0",
            "runnables": [],
            "contributes": {
                "lsp_servers": {
                    "rust": { "command": "rust-analyzer", "extensionToLanguage": { ".rs": "rust" } }
                }
            }
        }"#;
        let m = PluginManifest::parse_and_validate(raw).expect("minimal lsp manifest validates");
        let rust = &m.contributes.as_ref().unwrap().lsp_servers["rust"];
        assert!(rust.restart_on_crash, "restartOnCrash defaults to true");
        assert!(rust.diagnostics, "diagnostics defaults to true");
        assert_eq!(rust.transport, LspTransport::STDIO);
        assert_eq!(rust.transport_kind(), LspTransport::Stdio);
        assert!(rust.args.is_empty());
        assert!(rust.env.is_empty());
        assert_eq!(rust.workspace_folder, None);
        assert_eq!(rust.startup_timeout, None);
        assert_eq!(rust.shutdown_timeout, None);
        assert_eq!(rust.max_restarts, None);
    }

    #[test]
    fn lsp_server_serializes_claude_camel_case_keys() {
        // `extensionToLanguage` IS the interop contract with Claude Code; a rename to
        // snake_case would be invisible in Rust and fatal on the wire. The defaulted
        // bools carry no skip_serializing_if, so they always ship.
        let server = LspServerContribution {
            command: "gopls".to_string(),
            args: Vec::new(),
            extension_to_language: BTreeMap::from([(".go".to_string(), "go".to_string())]),
            transport: LspTransport::STDIO.to_string(),
            env: BTreeMap::new(),
            initialization_options: None,
            settings: None,
            workspace_folder: None,
            startup_timeout: None,
            shutdown_timeout: None,
            restart_on_crash: true,
            max_restarts: None,
            diagnostics: true,
        };
        let value = serde_json::to_value(&server).unwrap();
        assert_eq!(value["extensionToLanguage"][".go"], serde_json::json!("go"));
        assert!(
            value.get("extension_to_language").is_none(),
            "the Rust field name must never reach the wire"
        );
        assert_eq!(value["restartOnCrash"], serde_json::json!(true));
        assert_eq!(value["diagnostics"], serde_json::json!(true));
        assert_eq!(value["transport"], serde_json::json!("stdio"));
        assert!(value.get("args").is_none(), "absent args omitted");
        assert!(value.get("env").is_none(), "absent env omitted");
        assert!(
            value.get("workspaceFolder").is_none(),
            "absent workspaceFolder omitted"
        );
        assert!(
            value.get("startupTimeout").is_none(),
            "absent startupTimeout omitted"
        );
        assert!(
            value.get("maxRestarts").is_none(),
            "absent maxRestarts omitted"
        );
    }

    #[test]
    fn invalid_lsp_server_skips_itself_not_the_manifest() {
        // Claude Code skips a server with invalid config and starts the rest. That is
        // only reachable because `command`/`extensionToLanguage` are serde-defaulted:
        // the manifest PARSES, and validate() supplies the per-server reason.
        let raw = r#"{
            "id": "com.example.lsp",
            "name": "LSP",
            "version": "1.0.0",
            "runnables": [],
            "contributes": {
                "lsp_servers": {
                    "broken": { "extensionToLanguage": { ".go": "go" } },
                    "claimless": { "command": "gopls" },
                    "fine": { "command": "rust-analyzer", "extensionToLanguage": { ".rs": "rust" } }
                }
            }
        }"#;
        let m = PluginManifest::parse_and_validate(raw)
            .expect("a broken lsp server must not fail the whole manifest");
        let servers = &m.contributes.as_ref().unwrap().lsp_servers;

        let missing_command = servers["broken"].validate("broken").unwrap_err();
        assert!(
            missing_command.contains("broken") && missing_command.contains("command"),
            "reason names the server and the missing field: {missing_command}"
        );
        let no_extensions = servers["claimless"].validate("claimless").unwrap_err();
        assert!(
            no_extensions.contains("claimless") && no_extensions.contains("extensionToLanguage"),
            "reason names the server and the empty map: {no_extensions}"
        );
        // A whitespace-only command is as unstartable as an absent one.
        let blank = LspServerContribution {
            command: "   ".to_string(),
            ..servers["fine"].clone()
        };
        assert!(blank.validate("blank").is_err());
        // The valid sibling is untouched by either.
        servers["fine"]
            .validate("fine")
            .expect("valid server passes");
    }

    #[test]
    fn unknown_lsp_transport_parses_but_is_not_guessed_at() {
        // An unrecognised transport must not fail the manifest (the plugin's runnables
        // and sidecars are unaffected) and must not be coerced to stdio either, which
        // would spawn a process that cannot speak the protocol. It stays verbatim and
        // classifies as Unsupported so the spawn site skips it with a reason.
        let raw = r#"{
            "id": "com.example.lsp",
            "name": "LSP",
            "version": "1.0.0",
            "runnables": [],
            "contributes": {
                "lsp_servers": {
                    "future": { "command": "x", "extensionToLanguage": { ".x": "x" }, "transport": "quic" },
                    "sock": { "command": "y", "extensionToLanguage": { ".y": "y" }, "transport": "Socket" }
                }
            }
        }"#;
        let m = PluginManifest::parse_and_validate(raw)
            .expect("an unrecognised transport must not fail the manifest");
        let servers = &m.contributes.as_ref().unwrap().lsp_servers;
        assert_eq!(servers["future"].transport, "quic", "value kept verbatim");
        assert_eq!(
            servers["future"].transport_kind(),
            LspTransport::Unsupported
        );
        // Socket is valid config Core cannot drive yet, so it passes validate() and is
        // gated by the separate transport check instead.
        assert_eq!(servers["sock"].transport_kind(), LspTransport::Socket);
        servers["sock"]
            .validate("sock")
            .expect("socket config is valid, just unimplemented");
    }

    #[test]
    fn lsp_extension_keys_normalise_for_lookup() {
        // `.GO`, `go` and `.go` are one extension. Routing on the raw key would make
        // them three, so lookup normalises both sides.
        assert_eq!(normalize_lsp_extension_key("go"), ".go");
        assert_eq!(normalize_lsp_extension_key(".GO"), ".go");
        assert_eq!(normalize_lsp_extension_key("  .Go "), ".go");
        assert_eq!(normalize_lsp_extension_key(""), "");
        // It takes an EXTENSION, not a filename — documented, and asserted so the
        // contract is not discovered by a caller passing a path.
        assert_eq!(normalize_lsp_extension_key("main.go"), ".main.go");

        let server = LspServerContribution {
            command: "gopls".to_string(),
            args: Vec::new(),
            extension_to_language: BTreeMap::from([
                ("GO".to_string(), "go".to_string()),
                (".tmpl".to_string(), "gotmpl".to_string()),
            ]),
            transport: LspTransport::STDIO.to_string(),
            env: BTreeMap::new(),
            initialization_options: None,
            settings: None,
            workspace_folder: None,
            startup_timeout: None,
            shutdown_timeout: None,
            restart_on_crash: true,
            max_restarts: None,
            diagnostics: true,
        };
        assert_eq!(server.language_for_extension(".go").as_deref(), Some("go"));
        assert_eq!(server.language_for_extension("go").as_deref(), Some("go"));
        assert_eq!(server.language_for_extension(".GO").as_deref(), Some("go"));
        assert_eq!(server.language_for_extension(".rs"), None);
        assert_eq!(server.language_for_extension(""), None);

        let normalized = server.normalized_extensions();
        assert_eq!(normalized[".go"], "go");
        assert_eq!(normalized[".tmpl"], "gotmpl");

        // Two raw keys in ONE server that normalise to the same extension resolve
        // first-wins by ascending source-key order — the per-server twin of the
        // first-registration-wins rule between servers. `.` (0x2E) sorts before `G`
        // (0x47), so the dotted spelling is the one that survives. Without this the
        // helper could quietly become last-wins and nothing would notice.
        let colliding = LspServerContribution {
            extension_to_language: BTreeMap::from([
                (".go".to_string(), "go-dotted".to_string()),
                ("GO".to_string(), "go-bare".to_string()),
            ]),
            ..server
        };
        assert_eq!(colliding.normalized_extensions()[".go"], "go-dotted");
        assert_eq!(
            colliding.language_for_extension("go").as_deref(),
            Some("go-dotted")
        );
    }

    #[test]
    fn lsp_servers_iterate_in_deterministic_key_order() {
        // First-registration-wins per extension is only reproducible if iteration is.
        // BTreeMap fixes it to ascending key order — NOT the JSON authoring order the
        // raw below deliberately scrambles, and never hash order.
        let raw = r#"{
            "id": "com.example.lsp",
            "name": "LSP",
            "version": "1.0.0",
            "runnables": [],
            "contributes": {
                "lsp_servers": {
                    "zed": { "command": "z", "extensionToLanguage": { ".go": "go" } },
                    "alpha": { "command": "a", "extensionToLanguage": { ".go": "go" } },
                    "mid": { "command": "m", "extensionToLanguage": { ".go": "go" } }
                }
            }
        }"#;
        let m = PluginManifest::parse_and_validate(raw).unwrap();
        let names: Vec<&str> = m
            .contributes
            .as_ref()
            .unwrap()
            .lsp_servers
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(names, vec!["alpha", "mid", "zed"]);
    }

    // ── unified permission grammar ───────────────────────────────────────────────

    #[test]
    fn permission_set_default_is_deny_all() {
        let p = PermissionSet::default();
        assert!(p.fs.read.is_empty());
        assert!(p.fs.write.is_empty());
        assert!(!p.child_process);
        assert!(p.network.is_deny(), "default network denies all");
        assert!(!p.network.is_allowed());
        assert!(p.tool.is_empty());
        // An empty set validates (deny-all is always valid).
        assert!(p.validate().is_ok());
    }

    #[test]
    fn manifest_without_permissions_omits_the_key() {
        // Back-compat tripwire: a manifest that declares no permissions must NOT
        // serialize a `permissions` key, so existing manifests stay byte-stable and
        // `permissions: None` reads as deny-all.
        let raw = r#"{
            "id": "com.example.noperm",
            "name": "NoPerm",
            "version": "1.0.0",
            "runnables": []
        }"#;
        let m = PluginManifest::parse_and_validate(raw).expect("parse");
        assert!(m.permissions.is_none());
        let value = serde_json::to_value(&m).unwrap();
        assert!(
            value.get("permissions").is_none(),
            "absent permissions omitted"
        );
    }

    #[test]
    fn permission_set_full_round_trips_and_network_untagged_dispatch() {
        // A rich set with both fs sets, child_process, host-scoped net, and tools.
        let raw = r#"{
            "id": "com.example.perm",
            "name": "Perm",
            "version": "1.0.0",
            "runnables": [],
            "permissions": {
                "fs": { "read": ["/data/in"], "write": ["/data/out"] },
                "child_process": true,
                "network": ["api.example.com:443", "cdn.example.com"],
                "tool": ["web_search"]
            }
        }"#;
        let m = PluginManifest::parse_and_validate(raw).expect("valid permissions");
        let p = m.permissions.as_ref().unwrap();
        assert_eq!(p.fs.read, vec!["/data/in".to_string()]);
        assert_eq!(p.fs.write, vec!["/data/out".to_string()]);
        assert!(p.child_process);
        assert!(matches!(&p.network, NetworkPermission::Hosts(h) if h.len() == 2));
        assert!(p.network.is_allowed());
        assert_eq!(p.tool, vec!["web_search".to_string()]);
        // Round-trips byte-identically.
        let round =
            PluginManifest::parse_and_validate(&serde_json::to_string(&m).unwrap()).unwrap();
        assert_eq!(m, round);
    }

    #[test]
    fn network_permission_untagged_both_arms() {
        // Untagged dispatch is by JSON type: bool → All, array → Hosts.
        let all_true: NetworkPermission = serde_json::from_str("true").unwrap();
        assert_eq!(all_true, NetworkPermission::All(true));
        assert!(all_true.is_allowed());
        let all_false: NetworkPermission = serde_json::from_str("false").unwrap();
        assert_eq!(all_false, NetworkPermission::All(false));
        assert!(all_false.is_deny());
        let hosts: NetworkPermission = serde_json::from_str(r#"["h:443"]"#).unwrap();
        assert_eq!(hosts, NetworkPermission::Hosts(vec!["h:443".to_string()]));
        // An empty host list denies (a list with no reachable host is not "allow").
        assert!(NetworkPermission::Hosts(vec![]).is_deny());
        // Serialize round-trips the type: All(bool) → bool, Hosts → array.
        assert_eq!(
            serde_json::to_string(&NetworkPermission::All(true)).unwrap(),
            "true"
        );
        assert_eq!(
            serde_json::to_string(&NetworkPermission::Hosts(vec!["h".to_string()])).unwrap(),
            r#"["h"]"#
        );
    }

    #[test]
    fn permission_traversal_path_is_rejected_at_validate() {
        // The gate must actually run inside validate(): a `..` path fails to parse.
        let raw = r#"{
            "id": "com.evil.perm",
            "name": "EvilPerm",
            "version": "1.0.0",
            "runnables": [],
            "permissions": { "fs": { "read": ["../../etc/passwd"], "write": [] } }
        }"#;
        let err = PluginManifest::parse_and_validate(raw).unwrap_err();
        assert!(err.contains("traversal"), "got: {err}");
        // An empty path is also rejected.
        let mut bad = PermissionSet::default();
        bad.fs.write.push(String::new());
        assert!(bad.validate().is_err(), "empty path must be rejected");
    }

    #[test]
    fn provides_bad_version_is_rejected() {
        let raw = r#"{
            "id": "com.example.bad3",
            "name": "Bad3",
            "version": "1.0.0",
            "runnables": [],
            "provides": [{ "capability": "rag", "version": "not-semver" }]
        }"#;
        let err = PluginManifest::parse_and_validate(raw).unwrap_err();
        assert!(err.contains("invalid version"), "got: {err}");
    }

    /// The two tab shapes every shipped built-in uses — a `model_picker` field tab
    /// (advisor/double-check/goal/proof/…) and a `view`-only tab (meetings/memory/
    /// quests/predict) — must keep validating, and must survive as raw JSON.
    #[test]
    fn builtin_settings_tab_shapes_still_validate_and_round_trip_verbatim() {
        let raw = r#"{
            "id": "com.example.settings",
            "name": "Settings",
            "version": "1.0.0",
            "runnables": [],
            "contributes": { "settings_tabs": [
                {
                    "id": "advisor.settings",
                    "title": "Advisor",
                    "fields": [
                        { "type": "model_picker", "pref_key": "advisor-model", "label": "Advisor model" }
                    ]
                },
                { "id": "meetings.settings", "title": "Meetings", "scope": "node", "view": "meetings" }
            ] }
        }"#;
        let manifest = PluginManifest::parse_and_validate(raw).expect("built-in shapes validate");
        let tabs = manifest.contributes.expect("contributes").settings_tabs;
        assert_eq!(tabs.len(), 2);
        // Stored verbatim (not re-serialized from the struct), so a desktop newer
        // than this Core still receives every key it was shipped to render.
        assert_eq!(tabs[0]["fields"][0]["type"], "model_picker");
        assert_eq!(tabs[1]["view"], "meetings");
    }

    /// Each of these used to reach the desktop and be dropped by the renderer's
    /// defensive parser, leaving the author with a missing row and no diagnostic.
    #[test]
    fn settings_tab_rules_reject_the_silently_broken_shapes() {
        let with_fields = |fields: &str| {
            format!(
                r#"{{
                    "id": "com.example.bad-settings",
                    "name": "Bad",
                    "version": "1.0.0",
                    "runnables": [],
                    "contributes": {{ "settings_tabs": [
                        {{ "id": "t", "title": "T", "fields": {fields} }}
                    ] }}
                }}"#
            )
        };
        let reject = |fields: &str, needle: &str| {
            let err = PluginManifest::parse_and_validate(&with_fields(fields))
                .expect_err("must be rejected");
            assert!(err.contains(needle), "expected '{needle}', got: {err}");
        };

        // Two fields on one preference key: the second silently overwrites the first.
        reject(r#"[{"pref_key":"k"},{"pref_key":"k"}]"#, "identity");
        // A select with no options degrades into a free-text box.
        reject(r#"[{"type":"select","pref_key":"k"}]"#, "no options");
        // A default of the wrong type is written straight into the preference store.
        reject(
            r#"[{"type":"toggle","pref_key":"k","default":"yes"}]"#,
            "toggle",
        );
        // Bounds on a type that cannot enforce them read as a guarantee and are not one.
        reject(r#"[{"type":"toggle","pref_key":"k","min":1}]"#, "min/max");
        // A pref_key that would escape the `/api/preferences/<key>` route.
        reject(r#"[{"pref_key":"../secrets"}]"#, "illegal characters");
        // Neither fields nor a view = an empty section.
        reject("[]", "empty section");
    }

    /// A `secret` field's `pref_key` is the ENV VAR NAME the plugin's own
    /// `secret_headers` `env:` token reads, so it must be env-var-shaped even though
    /// the general `pref_key` alphabet also admits `.`, `-` and `:`. Without this,
    /// `"pref_key": "tavily.api-key"` validates at import, renders normally, and
    /// then 400s the first time a user presses Save — a failure the author never
    /// sees. And a `default` on a secret field is a credential committed to a file
    /// that travels with the plugin.
    #[test]
    fn a_secret_field_must_name_an_env_var_and_carry_no_default() {
        let with_field = |field: &str| {
            format!(
                r#"{{
                    "id": "com.example.byok",
                    "name": "BYOK",
                    "version": "1.0.0",
                    "runnables": [],
                    "contributes": {{ "settings_tabs": [
                        {{ "id": "t", "title": "T", "fields": [{field}] }}
                    ] }}
                }}"#
            )
        };
        let reject = |field: &str, needle: &str| {
            let err = PluginManifest::parse_and_validate(&with_field(field))
                .expect_err("must be rejected");
            assert!(err.contains(needle), "expected '{needle}', got: {err}");
        };

        // Every spelling the general pref_key alphabet allows but an env var cannot.
        for bad_key in ["tavily.api_key", "tavily-api-key", "ryu:tavily", "1KEY"] {
            reject(
                &format!(r#"{{"type":"secret","pref_key":"{bad_key}"}}"#),
                "environment variable name",
            );
        }
        // A credential must never ship inside a manifest.
        reject(
            r#"{"type":"secret","pref_key":"RYU_TAVILY_API_KEY","default":"tvly-live-abc"}"#,
            "must not declare a default",
        );

        // The shape a real BYOK provider declares loads cleanly.
        let ok = PluginManifest::parse_and_validate(&with_field(
            r#"{"type":"secret","pref_key":"RYU_TAVILY_API_KEY","label":"Tavily API key"}"#,
        ))
        .expect("an env-var-shaped secret field validates");
        let tabs = ok.contributes.expect("contributes").settings_tabs;
        assert_eq!(tabs[0]["fields"][0]["type"], "secret");
        // The SAME predicate Core's PUT handler applies, so the two cannot drift.
        assert!(is_env_var_name("RYU_TAVILY_API_KEY"));
        assert!(!is_env_var_name("tavily.api_key"));
    }

    /// A control a NEWER desktop understands must not sink the whole manifest — the
    /// renderer already draws an unknown type as a text input.
    #[test]
    fn unknown_settings_field_type_falls_back_instead_of_failing() {
        let raw = r#"{
            "id": "com.example.future",
            "name": "Future",
            "version": "1.0.0",
            "runnables": [],
            "contributes": { "settings_tabs": [
                { "id": "t", "title": "T", "fields": [ { "type": "color_picker", "pref_key": "k" } ] }
            ] }
        }"#;
        let manifest =
            PluginManifest::parse_and_validate(raw).expect("a future control must still load");
        let tabs = manifest.contributes.expect("contributes").settings_tabs;
        assert_eq!(tabs[0]["fields"][0]["type"], "color_picker");
    }

    #[test]
    fn tool_filter_matches_exactly_or_by_trailing_wildcard() {
        let exact = ToolFilterContribution {
            tool: "browser__navigate".to_owned(),
            reason: None,
        };
        assert!(exact.matches("browser__navigate"));
        assert!(!exact.matches("browser__navigate_back"));
        assert!(validate_tool_filter(&exact).is_ok());

        let wildcard = ToolFilterContribution {
            tool: "shadow__*".to_owned(),
            reason: Some("replaced by this plugin's own search".to_owned()),
        };
        assert!(wildcard.matches("shadow__search"));
        assert!(!wildcard.matches("browser__search"));
        assert!(validate_tool_filter(&wildcard).is_ok());

        // `*` alone or an unqualified name would strip tools across every server;
        // an interior `*` looks like a glob and behaves like a literal.
        for bad in ["", "*", "navigate", "br*ser__nav", "browser__nav "] {
            let filter = ToolFilterContribution {
                tool: bad.to_owned(),
                reason: None,
            };
            assert!(
                validate_tool_filter(&filter).is_err(),
                "must reject pattern '{bad}'"
            );
        }
    }
}
