//! Sandboxed JS a built-in plugin's manifest references by `code_file`, embedded
//! at compile time.
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
