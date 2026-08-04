//! Files a built-in plugin's manifest references by path, embedded at compile time.
//!
//! Two tables, because a built-in plugin carries two kinds of code with very
//! different privilege: [`BUILTIN_CODE_FILES`] holds the **sandboxed** JS a
//! `code_file` names, and [`BUILTIN_PI_EXTENSIONS`] holds the **unsandboxed**
//! TypeScript a `contributes.pi_extensions[].file` names. They must not be merged;
//! see the second table's own doc.
//!
//! # Why a table and not a directory read
//!
//! A built-in plugin ships ONLY its manifest: Core `include_str!`s
//! `plugins-store/<dir>/manifest.json` (see [`super::BUILTIN_MANIFESTS`]) and the
//! package directory is not on the user's machine — the same reason
//! `skills_catalog::plugin_skills` returns `None` for a built-in. So a manifest that
//! moved its hook/adapter bodies into real `.js` files needs those files compiled in
//! too, or the hook would resolve to nothing at runtime.
//!
//! # Why hand-written `include_str!` and not a `build.rs` generator
//!
//! `tools/mirror-public.sh` step 3b greps **literal** `include_str!` paths out of the
//! mirrored `apps/core/src/**.rs` and refuses to publish a tree in which one does not
//! resolve. A hand-written table is therefore self-verifying in the mirror. A
//! generated one would live in `OUT_DIR`, bypass that gate silently, and the missing
//! file would first surface in public release CI — i.e. after publication.
//!
//! # Keeping it honest
//!
//! Every `code_file` in every `plugins-store/*/manifest.json` has a row here and
//! every row is referenced by some manifest — a bijection asserted by
//! `builtin_code_table_matches_package_manifests` in [`super`]. Unregistered-by-design
//! plugins are included too: they are loaded from disk today, but the total invariant
//! is what makes promoting one to a built-in a one-line change instead of a silent
//! no-op.

/// `(plugin id, plugin-root-relative path, file contents)` for every `code_file` a
/// `plugins-store` manifest references. Sorted by plugin dir then path.
pub(crate) const BUILTIN_CODE_FILES: &[(&str, &str, &str)] = &[
    // advisor
    (
        "@ryu/advisor",
        "hooks/review.js",
        include_str!("../../../../plugins-store/advisor/hooks/review.js"),
    ),
    // agentbrowser
    (
        "@ryu/agentbrowser",
        "adapters/browser__screenshot.js",
        include_str!("../../../../plugins-store/agentbrowser/adapters/browser__screenshot.js"),
    ),
    (
        "@ryu/agentbrowser",
        "adapters/browser__snapshot.js",
        include_str!("../../../../plugins-store/agentbrowser/adapters/browser__snapshot.js"),
    ),
    (
        "@ryu/agentbrowser",
        "adapters/browser__type.js",
        include_str!("../../../../plugins-store/agentbrowser/adapters/browser__type.js"),
    ),
    // chat-title
    (
        "@ryu/chat-title",
        "hooks/rename.js",
        include_str!("../../../../plugins-store/chat-title/hooks/rename.js"),
    ),
    // double-check
    (
        "@ryu/double-check",
        "hooks/review.js",
        include_str!("../../../../plugins-store/double-check/hooks/review.js"),
    ),
    // exa
    (
        "@ryu/exa",
        "adapters/web__search.js",
        include_str!("../../../../plugins-store/exa/adapters/web__search.js"),
    ),
    // firecrawl
    (
        "@ryu/firecrawl",
        "adapters/web__crawl.js",
        include_str!("../../../../plugins-store/firecrawl/adapters/web__crawl.js"),
    ),
    (
        "@ryu/firecrawl",
        "adapters/web__extract.js",
        include_str!("../../../../plugins-store/firecrawl/adapters/web__extract.js"),
    ),
    // goal
    (
        "@ryu/goal",
        "hooks/loop.js",
        include_str!("../../../../plugins-store/goal/hooks/loop.js"),
    ),
    // honcho
    (
        "@ryu/honcho",
        "adapters/memory__store.js",
        include_str!("../../../../plugins-store/honcho/adapters/memory__store.js"),
    ),
    (
        "@ryu/honcho",
        "adapters/memory__sync.js",
        include_str!("../../../../plugins-store/honcho/adapters/memory__sync.js"),
    ),
    // hook-observers
    (
        "@ryu/hook-observers",
        "hooks/notification.js",
        include_str!("../../../../plugins-store/hook-observers/hooks/notification.js"),
    ),
    (
        "@ryu/hook-observers",
        "hooks/session-end.js",
        include_str!("../../../../plugins-store/hook-observers/hooks/session-end.js"),
    ),
    (
        "@ryu/hook-observers",
        "hooks/subagent-stop.js",
        include_str!("../../../../plugins-store/hook-observers/hooks/subagent-stop.js"),
    ),
    (
        "@ryu/hook-observers",
        "hooks/workflow-run-failed.js",
        include_str!("../../../../plugins-store/hook-observers/hooks/workflow-run-failed.js"),
    ),
    (
        "@ryu/hook-observers",
        "hooks/app-event-meeting-ended.js",
        include_str!("../../../../plugins-store/hook-observers/hooks/app-event-meeting-ended.js"),
    ),
    // hook-session-context
    (
        "@ryu/session-context",
        "hooks/start.js",
        include_str!("../../../../plugins-store/hook-session-context/hooks/start.js"),
    ),
    // parallel
    (
        "@ryu/parallel",
        "adapters/web__search.js",
        include_str!("../../../../plugins-store/parallel/adapters/web__search.js"),
    ),
    // plan-continue
    (
        "@ryu/plan-continue",
        "hooks/loop.js",
        include_str!("../../../../plugins-store/plan-continue/hooks/loop.js"),
    ),
    // proof
    (
        "@ryu/proof",
        "hooks/loop.js",
        include_str!("../../../../plugins-store/proof/hooks/loop.js"),
    ),
    // scrapling
    (
        "@ryu/scrapling",
        "adapters/web__extract.js",
        include_str!("../../../../plugins-store/scrapling/adapters/web__extract.js"),
    ),
    // security-guidance
    (
        "@ryu/security-guidance",
        "hooks/review.js",
        include_str!("../../../../plugins-store/security-guidance/hooks/review.js"),
    ),
    // tool-firewall
    (
        "@ryu/tool-firewall",
        "hooks/post.js",
        include_str!("../../../../plugins-store/tool-firewall/hooks/post.js"),
    ),
    (
        "@ryu/tool-firewall",
        "hooks/pre.js",
        include_str!("../../../../plugins-store/tool-firewall/hooks/pre.js"),
    ),
];

/// The embedded contents of `rel` for built-in plugin `plugin_id`, or `None` when
/// the manifest names a file that was never added to [`BUILTIN_CODE_FILES`].
///
/// `None` is a hard load error at the call site, never an empty hook body.
pub(crate) fn lookup(plugin_id: &str, rel: &str) -> Option<&'static str> {
    BUILTIN_CODE_FILES
        .iter()
        .find(|(id, path, _)| *id == plugin_id && *path == rel)
        .map(|(_, _, code)| *code)
}

/// `(plugin id, plugin-root-relative path, file contents)` for every
/// `contributes.pi_extensions[].file` a `plugins-store` manifest references.
///
/// # Why a SECOND table and not more rows in [`BUILTIN_CODE_FILES`]
///
/// Same embedding problem, different privilege — and the separation is the point:
///
/// - A `code_file` is **sandboxed** JS. Core splices it into a deny-by-default Deno
///   IIFE where every side effect goes through a capability-gated `host.*` call.
/// - A `pi_extensions[].file` is **unsandboxed** TypeScript loaded by the managed Pi
///   process itself, with that process's full privilege. It is gated like a manifest
///   `mcp_servers` entry (`pi_config::app_extensions::may_ship_pi_extensions`), not
///   like a hook.
///
/// One table would also break the other one's guard: `builtin_code_table_matches_package_manifests`
/// asserts a bijection over [`super::PluginManifest::code_file_refs`], which by
/// construction never yields a `.ts`. Each table therefore has its own bijection
/// test. Everything else about the mechanism — hand-written `include_str!` so
/// `tools/mirror-public.sh` step 3b can grep the literal paths, and a `None` lookup
/// being a visible skip rather than an empty file — is identical.
pub(crate) const BUILTIN_PI_EXTENSIONS: &[(&str, &str, &str)] = &[
    // pi-shell
    (
        "@ryu/pi-shell",
        "pi-extensions/ryu-shell.ts",
        include_str!("../../../../plugins-store/pi-shell/pi-extensions/ryu-shell.ts"),
    ),
    // pi-subagent
    (
        "@ryu/pi-subagent",
        "pi-extensions/ryu-subagent.ts",
        include_str!("../../../../plugins-store/pi-subagent/pi-extensions/ryu-subagent.ts"),
    ),
];

/// The embedded contents of `rel` for built-in plugin `plugin_id`, or `None` when
/// nothing in [`BUILTIN_PI_EXTENSIONS`] matches.
///
/// `None` sends the resolver to the plugin's on-disk directory, which is the right
/// answer for a Community plugin and a visible skip for a built-in (whose package
/// dir is not on the user's machine).
pub(crate) fn lookup_pi_extension(plugin_id: &str, rel: &str) -> Option<&'static str> {
    BUILTIN_PI_EXTENSIONS
        .iter()
        .find(|(id, path, _)| *id == plugin_id && *path == rel)
        .map(|(_, _, source)| *source)
}
