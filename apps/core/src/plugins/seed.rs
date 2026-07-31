//! Default-on plugin seeding — the ONE definition of "what is enabled on a fresh
//! install".
//!
//! # Why this is not `lifecycle::enable_app`
//!
//! Seeding runs during startup, **before the Gateway sidecar is spawned**
//! (`main.rs` starts it well after this; the gateway-policy seed comment says the
//! same). `enable_app` fails **closed** on an unreachable Gateway, so routing the
//! seed through it would leave every default-on plugin disabled on every fresh
//! install — a hard regression. The seed is a trusted first-party bootstrap that
//! writes the store directly, with explicit, hardcoded grants.
//!
//! That bypass is safe for *policy* (these are our own plugins, with grants we
//! chose) but it MUST NOT bypass the **dependency graph** — otherwise the very
//! first first-party plugin to declare `requires` would be seeded enabled while
//! its dependency stayed disabled, i.e. exactly the half-enabled state the graph
//! exists to prevent, on the path every user hits. So this module keeps the
//! store-only write and adds the two things the graph gives `enable_app`:
//!
//! 1. **Topological order** — a dependency is always seeded before its dependent
//!    (the declaration order of [`crate::plugins::builtins::CORE_DEFAULT_ON`] is
//!    NOT topological, and must not have to be).
//! 2. **Fail-closed satisfiability** — a default-on plugin whose `requires` cannot
//!    be satisfied *from within the default-on set* is SKIPPED (logged loudly),
//!    never seeded enabled with a missing dependency.
//!
//! # The default-on set is the universe
//!
//! [`seed_order`] resolves each plugin against the default-on manifests **only**.
//! A default-on plugin that depends on an opt-in plugin therefore reports
//! `MissingDependency` and is skipped, rather than silently auto-installing
//! something the user never asked for. `enable_app` would report the same error
//! for an uninstalled dependency; a seed must not be more permissive than an
//! explicit enable.
//!
//! # Core-vs-Gateway boundary
//!
//! Pure Core: this decides *what runs* on a fresh install. No policy is enforced
//! here — the grants below are the fixed, first-party set the Gateway is asked to
//! honour, and every *call-time* capability check still goes through the Gateway.

use crate::plugin_manifest::PluginManifest;
use crate::plugins::{builtins::CORE_DEFAULT_ON, graph, PluginStore};

/// One default-on plugin and everything the seed must write for it.
#[derive(Debug, Clone, Copy)]
pub struct SeedSpec {
    /// Manifest id.
    pub id: &'static str,
    /// Grants to persist as approved. The Gateway is not reachable at seed time,
    /// so these are the fixed first-party set (empty for most Core plugins; the
    /// companions need theirs to drive Spaces/media/finetune from their frames).
    pub grants: &'static [&'static str],
    /// Prebuilt companion UI bundle, when the plugin ships one.
    ///
    /// Seeded for EVERY companion in this table, default-on or not: the default-on
    /// loop writes it alongside the enable, and [`seed_companion_ui`] writes it onto
    /// a disabled record for the opt-in ones (nothing else in the system sources a
    /// built-in's bundle — see that function's docs).
    pub ui_code: Option<&'static str>,
}

/// Plugins that need more than `insert + set_enabled(&[])`: explicit grants and/or
/// a prebuilt `ui_code` bundle. Everything else in [`CORE_DEFAULT_ON`] seeds with
/// empty grants and no UI code (unchanged from the pre-graph behaviour).
///
/// The companions need a UI bundle + the grants their sandboxed frames use.
/// A row that ships no frame (`ui_code: None`, e.g. `recipes`) is here purely for
/// its grants: it really does drive the host over a kernel capability, so its
/// approved grants must match the `permission_grants` its manifest declares —
/// otherwise the record would claim less than the app does.
///
/// # This table is the ONE list of compiled-in companion bundles
///
/// Most rows are default-on (`default_on_specs` looks them up by
/// [`CORE_DEFAULT_ON`] id), but membership here is deliberately NOT limited to the
/// default-on set: [`seed_companion_ui`] derives the opt-in companions from this
/// same table, so a row is all it takes for a companion — default-on or opt-in — to
/// receive its bundle. Adding a 16th companion to a second list is what caused the
/// bug that function's docs describe; there is no second list.
fn seed_overrides() -> [SeedSpec; 17] {
    use crate::plugin_manifest::{
        ACTIVITY_UI_HTML, APPROVALS_UI_HTML, CALENDAR_UI_HTML, CANVAS_PLUGIN_ID, CANVAS_UI_HTML,
        FINETUNE_PLUGIN_ID, FINETUNE_UI_HTML, LEARNING_UI_HTML, MAIL_UI_HTML, MEETINGS_UI_HTML,
        MONITORS_UI_HTML, QUESTS_UI_HTML, SKILL_EDITOR_UI_HTML, TIMELINE_UI_HTML, WARMUP_UI_HTML,
        WEBHOOKS_UI_HTML, WHITEBOARD_PLUGIN_ID, WHITEBOARD_UI_HTML, WORKFLOWS_UI_HTML,
    };
    [
        SeedSpec {
            id: WHITEBOARD_PLUGIN_ID,
            // Its sandboxed frame owns Space documents + AI-generates.
            grants: &["spaces:docs", "hook:side-model"],
            ui_code: Some(WHITEBOARD_UI_HTML),
        },
        SeedSpec {
            id: CANVAS_PLUGIN_ID,
            // Space documents + catalog listing + the media/agent bridge.
            grants: &[
                "spaces:docs",
                "core:list_agents",
                "media:generate",
                "media:transcribe",
                "hook:run-agent",
                "hook:side-model",
            ],
            ui_code: Some(CANVAS_UI_HTML),
        },
        SeedSpec {
            id: FINETUNE_PLUGIN_ID,
            // Core's fine-tune orchestration. Its Unsloth training sidecar spawns on the
            // Core-tier auto-run path (`may_run_sidecar` is unconditional for Core), so it
            // must NOT declare `sidecar:process` — the Gateway validates + denies that
            // grant at enable (same fix as mail, commit 9faf67be). Grants mirror the
            // manifest's `permission_grants` exactly.
            grants: &["finetune:runs"],
            ui_code: Some(FINETUNE_UI_HTML),
        },
        SeedSpec {
            id: crate::plugins::builtins::MEETINGS_PLUGIN_ID,
            // It saves finalized notes into the "Meetings" Space (`spaces:docs`). Its
            // sandboxed frame ALSO drives Core's `/api/meetings/*` orchestration (list/
            // transcript + start/finalize/delete/rename + audio import) via the
            // `meetings:crud` bridge capability (host-direct, monitors pattern). `com.ryu
            // .meetings` was a wave-2 route-gate governance shell (gating `/api/meetings/*`)
            // that `requires` the `spaces` app; the W7 frontend extraction upgrades it in
            // place to ALSO carry the companion runnable + ship a prebuilt UI bundle.
            // Core-tier, so it must NOT declare `sidecar:process` (the Gateway denies that
            // grant at enable).
            grants: &["spaces:docs", "meetings:crud"],
            ui_code: Some(MEETINGS_UI_HTML),
        },
        SeedSpec {
            id: crate::plugins::builtins::MONITORS_PLUGIN_ID,
            // Its sandboxed frame drives Core's `/api/monitors/*` orchestration via
            // the `monitors:crud` bridge capability. Ships a prebuilt companion UI.
            // `tools.invoke` is what its OUT-OF-PROCESS sidecar needs: the Spider fetch
            // backend reaches Core's `McpRegistry` through the `mcp.callTool` kernel
            // capability, which is gated on the declared∩approved intersection — so a
            // seeded record missing this grant would 403 every crawl.
            grants: &["monitors:crud", "tools.invoke"],
            ui_code: Some(MONITORS_UI_HTML),
        },
        SeedSpec {
            id: crate::plugins::builtins::WORKFLOWS_PLUGIN_ID,
            // Its sandboxed frame drives Core's DAG workflow engine (CRUD + versions +
            // run/run-state/resume), the workflow-template catalog, node-config catalog
            // reads (agents/apps/mcp/skills/recipes/schedules/composio), and ghost
            // record→replay — via the workflows:crud/runstate/catalogs + ghost:record
            // bridge capabilities. Ships a prebuilt companion UI. Like the other
            // Core-tier companions it must NOT declare `sidecar:process` (the Gateway
            // denies that grant at enable; Core auto-runs any sidecar).
            grants: &[
                "workflows:crud",
                "workflows:runstate",
                "workflows:catalogs",
                "ghost:record",
            ],
            ui_code: Some(WORKFLOWS_UI_HTML),
        },
        SeedSpec {
            id: crate::plugins::builtins::WEBHOOKS_PLUGIN_ID,
            // Its sandboxed frame renders Core's read-only webhook endpoint registry
            // (`/api/webhooks` + `/api/webhook-ingress/status`) via the `webhooks:crud`
            // bridge capability (host-direct, monitors pattern). Ships a prebuilt
            // companion UI. Core-tier, so it must NOT declare `sidecar:process`.
            grants: &["webhooks:crud"],
            ui_code: Some(WEBHOOKS_UI_HTML),
        },
        SeedSpec {
            id: crate::plugins::builtins::QUESTS_PLUGIN_ID,
            // Its sandboxed frame drives Core's `/api/quests/*` auto-detecting-todo
            // orchestration (list/create/update/delete + complete/dismiss + suggestion
            // accept/dismiss + judge) via the `quests:crud` bridge capability (host-direct,
            // monitors pattern). Ships a prebuilt companion UI. Core-tier, so it must NOT
            // declare `sidecar:process` (the Gateway denies that grant at enable).
            grants: &["quests:crud"],
            ui_code: Some(QUESTS_UI_HTML),
        },
        SeedSpec {
            id: crate::plugins::builtins::ACTIVITY_PLUGIN_ID,
            // Its sandboxed frame renders Core's read-only unified activity feed
            // (`GET /api/activity`) via the `activity:read` bridge capability (host-direct,
            // monitors pattern). It ALSO holds `shell:integrate` — the generic shell-primitive
            // lane (`docs/renderer-host-slice-1.md`): the feed's clickable rows open the chat
            // tab through the route-allowlisted `shell.openTab` (replacing the old bespoke
            // `activity.openSession` verb). Ships a prebuilt companion UI. Core-tier, so it
            // must NOT declare `sidecar:process` (the Gateway denies that grant at enable).
            grants: &["activity:read", "shell:integrate"],
            ui_code: Some(ACTIVITY_UI_HTML),
        },
        SeedSpec {
            id: crate::plugins::builtins::CALENDAR_PLUGIN_ID,
            // Its sandboxed frame renders the scheduled-runs calendar (agent/workflow
            // jobs projected onto Month/Week/Day/Agenda) and schedules an agent, via the
            // `calendar:crud` bridge capability (host-direct, monitors pattern): the host
            // calls the existing `/heartbeat/jobs` + `/workflows` + `/api/agents` reads +
            // the `createScheduledAgentWorkflow` composite. Ships a prebuilt companion UI.
            // Core-tier, so it must NOT declare `sidecar:process` (the Gateway denies that
            // grant at enable).
            grants: &["calendar:crud"],
            ui_code: Some(CALENDAR_UI_HTML),
        },
        SeedSpec {
            id: crate::plugins::builtins::LEARNING_PLUGIN_ID,
            // Its sandboxed frame renders the read-only continual-learning surface
            // (the two opt-in levels + models, the experience buffer, and the read-only
            // self-healing attempt history) via the `learning:crud` bridge capability
            // (host-direct, monitors pattern): the host calls the existing
            // `/api/learn/config` + `/api/experience/list` + `/api/healing/status`
            // reads. Ships a prebuilt companion UI. `com.ryu.learning` was a wave-2
            // route-gate governance shell (gating `/api/learn/*` + `/api/experience/*`)
            // that `requires` the `skills` app; the W7 frontend extraction upgrades it
            // in place to ALSO carry the companion runnable — the `requires` edge stays
            // (skills is default-on, so `seed_order` seeds it first). Core-tier, so it
            // must NOT declare `sidecar:process` (the Gateway denies that grant at
            // enable).
            grants: &["learning:crud"],
            ui_code: Some(LEARNING_UI_HTML),
        },
        SeedSpec {
            id: crate::plugins::builtins::APPROVALS_PLUGIN_ID,
            // Its sandboxed frame renders the unified Inbox — pending HITL approvals
            // (approve/reject), the per-user notification feed (read + the workflow-resume
            // ack gate), the quest task check-offs, and Shadow's proactive suggestions —
            // via the `approvals:crud` bridge capability (host-direct, monitors pattern):
            // the host calls the existing `/api/approvals/*`, `/api/notifications/*`
            // (host-resolved user id), and Shadow's `/proactive` + `/api/feedback`. The
            // quest section reuses the `quests:crud` verbs, so the app declares BOTH
            // grants. Ships a prebuilt companion UI. `com.ryu.approvals` was a wave-2
            // gate-only governance shell (gating `/api/approvals/*`); the W7 frontend
            // extraction upgrades it in place to ALSO carry the companion runnable.
            // It ALSO holds `shell:integrate` — the generic shell-primitive lane
            // (`docs/renderer-host-slice-1.md`): the "open in chat" action opens a new
            // chat tab through the route-allowlisted `shell.openTab` (replacing the old
            // bespoke `suggestions.openInChat` verb), and the frame subscribes to the
            // live host theme. Core-tier, so it must NOT declare `sidecar:process` (the
            // Gateway denies that grant at enable).
            grants: &["approvals:crud", "quests:crud", "shell:integrate"],
            ui_code: Some(APPROVALS_UI_HTML),
        },
        SeedSpec {
            id: crate::plugins::builtins::TIMELINE_PLUGIN_ID,
            // Its sandboxed frame renders the CapCut-style activity replay scrubber
            // (Shadow's captured lanes + keyframe preview + Dayflow work journal) via
            // the `timeline:read` bridge capability. Host-direct (the monitors pattern),
            // but device-LOCAL: the host calls Shadow (:3030) WITHOUT a node token (the
            // `shadow.ts` INVARIANT — captured screen/input is machine-pinned), the same
            // host-direct-to-Shadow shape the approvals inbox uses for `/proactive`.
            // It ALSO holds `shell:integrate` — the generic shell-primitive lane
            // (docs/renderer-host-slice-1.md) its Weekly-Review + Settings opens now
            // route through (`shell.openTab`, replacing the bespoke
            // `timeline.openReview`/`timeline.openSettings` verbs). Ships a prebuilt
            // companion UI. Core-tier, so it must NOT declare `sidecar:process` (the
            // Gateway denies that grant at enable).
            grants: &["timeline:read", "shell:integrate"],
            ui_code: Some(TIMELINE_UI_HTML),
        },
        SeedSpec {
            id: crate::plugins::builtins::SKILL_EDITOR_PLUGIN_ID,
            // Its sandboxed frame authors a user-owned Agent Skill (`SKILL.md`) — the
            // front-matter form fields + a markdown body + server-backed version history —
            // via the `skills:crud` bridge capability (host-direct, monitors pattern): the
            // host calls the existing `/api/skills` authoring endpoints (the desktop
            // `skills.ts` client). It ALSO holds `shell:integrate` — the generic
            // shell-primitive lane (`docs/renderer-host-slice-1.md`): the decoupled frame
            // subscribes to the live host theme (`shell.subscribeTheme`), so it re-themes
            // on a light/dark toggle instead of holding a mount-time snapshot. It has no
            // navigation verb to move onto `shell.openTab` (its `setTitle` renames the
            // current owning tab, which no slice-1 primitive covers, so that stays on the
            // `skills:crud` bridge). Ships a prebuilt companion UI. Core-tier, so it must
            // NOT declare `sidecar:process` (the Gateway denies that grant at enable).
            grants: &["skills:crud", "shell:integrate"],
            ui_code: Some(SKILL_EDITOR_UI_HTML),
        },
        SeedSpec {
            id: crate::plugins::builtins::RECIPES_PLUGIN_ID,
            // Recipes ships NO frame (no `ui_code`) — it is here purely for the grant.
            // Its out-of-process sidecar proxies replay + the recording session back to
            // Core over the `ghost.{replay,recordStart,recordStatus,recordStop}` kernel
            // capabilities, which are gated on `ghost:record` (declared ∩ approved). It
            // is default-on, and the default-on seed writes the record directly, so
            // without this override it would seed with `grants: &[]` and every
            // replay/record call would 403 on a fresh install. Mirrors the
            // `permission_grants` its manifest declares, per the rule above.
            grants: &["ghost:record"],
            ui_code: None,
        },
        SeedSpec {
            id: crate::plugins::builtins::MAIL_PLUGIN_ID,
            // Mail is OPT-IN by product choice (an unconfigured inbox should not
            // surface on a fresh install — see `CORE_DEFAULT_ON`), so this row's
            // `grants` are inert today: `default_on_specs` never looks it up (mail is
            // not in `CORE_DEFAULT_ON`) and the opt-in pass writes only `ui_code`,
            // leaving `enable_app` to persist the Gateway-approved set. They are
            // recorded anyway, and mirror the manifest's `permission_grants` exactly,
            // so a future promotion into the default-on set is correct by
            // construction rather than by remembering to fill this in.
            grants: &["mail:crud"],
            ui_code: Some(MAIL_UI_HTML),
        },
        SeedSpec {
            id: crate::plugins::builtins::WARMUP_PLUGIN_ID,
            // Warmup is OPT-IN by product choice: it spends the user's subscription
            // usage on their behalf, on a schedule, which is not a thing to switch on
            // for someone. Like mail's row above, `grants` is inert while the app is
            // outside `CORE_DEFAULT_ON` (the opt-in pass writes only `ui_code`), but
            // mirrors the manifest's `permission_grants` so a promotion would be
            // correct by construction.
            grants: &["warmup:crud"],
            ui_code: Some(WARMUP_UI_HTML),
        },
    ]
}

/// The full default-on seed table, in declaration order.
///
/// One list, derived from [`CORE_DEFAULT_ON`] — the overridden plugins are the same
/// ids with richer specs, so a plugin can never be default-on in one list and absent
/// from the other.
pub fn default_on_specs() -> Vec<SeedSpec> {
    let overrides = seed_overrides();
    CORE_DEFAULT_ON
        .iter()
        .map(|id| {
            overrides
                .iter()
                .find(|o| o.id == *id)
                .copied()
                .unwrap_or(SeedSpec {
                    id,
                    grants: &[],
                    ui_code: None,
                })
        })
        .collect()
}

/// A default-on plugin that could not be seeded, and why.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkippedSeed {
    pub id: String,
    pub error: graph::DependencyError,
}

/// Order the default-on set so every dependency precedes its dependents, and
/// separate out the plugins whose `requires` cannot be satisfied.
///
/// Pure: no store, no I/O. `manifests` is the loaded manifest set; specs with no
/// loaded manifest are dropped (nothing to seed), exactly as before.
///
/// Returns `(ordered_ids, skipped)`. `ordered_ids` is a valid topological order of
/// the seedable default-on plugins; `skipped` names the ones whose dependency graph
/// is unsatisfiable *within the default-on set* — they are NOT enabled (fail-closed).
pub fn seed_order(
    specs: &[SeedSpec],
    manifests: &[PluginManifest],
) -> (Vec<String>, Vec<SkippedSeed>) {
    // Lower capability edges (`requires.capabilities`) to concrete app-id edges
    // FIRST, resolving providers against the FULL installed set, so a `requires:[rag]`
    // consumer's provider is materialized as an ordinary dependency the graph honors.
    // The universe for resolution stays the default-on set (see module docs) — so a
    // default-on consumer whose capability provider is NOT default-on becomes an edge
    // to a plugin absent from the universe, which `resolve_enable_order` reports as a
    // MissingDependency and the loop below SKIPS (fail-closed) — matching the posture
    // for an un-installed app dependency, and preserving the enabled-set binding
    // invariant at seed time.
    let binding_cfg = crate::plugins::binding::active_config();
    let lowered = crate::plugins::binding::lower_manifests(manifests, &binding_cfg);
    let universe: Vec<PluginManifest> = specs
        .iter()
        .filter_map(|s| lowered.iter().find(|m| m.id == s.id))
        .cloned()
        .collect();

    let mut ordered: Vec<String> = Vec::new();
    let mut skipped: Vec<SkippedSeed> = Vec::new();

    for spec in specs {
        // No loaded manifest ⇒ nothing to seed (unchanged: the old code looked up
        // the version and silently did nothing when absent).
        if !universe.iter().any(|m| m.id == spec.id) {
            continue;
        }
        match graph::resolve_enable_order(spec.id, &universe) {
            // deps-first, target-last. Appending in that order keeps `ordered`
            // topologically valid; a plugin already placed by an earlier spec's
            // closure is not re-added.
            Ok(order) => {
                for id in order {
                    if !ordered.contains(&id) {
                        ordered.push(id);
                    }
                }
            }
            Err(error) => skipped.push(SkippedSeed {
                id: spec.id.to_owned(),
                error,
            }),
        }
    }

    (ordered, skipped)
}

/// Seed the default-on plugins on a fresh install: install + enable each, in
/// dependency order.
///
/// One-time and user-respecting: a plugin with ANY existing record (enabled OR
/// disabled) is left alone, so a user who disables a default-on plugin keeps it
/// disabled across restarts.
///
/// Then runs [`seed_companion_ui`], which carries the compiled-in companion bundles
/// the loop below cannot reach: the opt-in companions (no default-on record at all)
/// and any existing record whose `ui_code` is missing.
pub async fn seed_default_on(store: &PluginStore, manifests: &[PluginManifest]) {
    let specs = default_on_specs();
    let (ordered, skipped) = seed_order(&specs, manifests);

    for s in &skipped {
        tracing::error!(
            "default-on seed: SKIPPING '{}' — its dependencies cannot be satisfied from the \
             default-on set: {}. It stays disabled (fail-closed); enabling it by hand will \
             report the same error until the dependency is installed.",
            s.id,
            s.error
        );
    }

    for id in &ordered {
        let Some(spec) = specs.iter().find(|s| s.id == id) else {
            continue;
        };

        match store.get(id).await {
            // A record exists (enabled or disabled) — the user's choice wins.
            Ok(Some(_)) => continue,
            Ok(None) => {}
            Err(e) => {
                tracing::warn!("default-on seed: lookup '{id}' failed: {e}");
                continue;
            }
        }

        let Some(version) = manifests
            .iter()
            .find(|m| m.id == *id)
            .map(|m| m.version.clone())
        else {
            continue;
        };

        if let Err(e) = store.insert(id, &version).await {
            tracing::warn!("default-on seed: insert '{id}' failed: {e}");
            continue;
        }
        if let Some(ui_code) = spec.ui_code {
            if let Err(e) = store.set_ui_code(id, Some(ui_code)).await {
                tracing::warn!("default-on seed: set_ui_code '{id}' failed: {e}");
                continue;
            }
        }
        let grants: Vec<String> = spec.grants.iter().map(|g| (*g).to_owned()).collect();
        if let Err(e) = store.set_enabled(id, &grants).await {
            tracing::warn!("default-on seed: enable '{id}' failed: {e}");
        } else {
            tracing::info!("default-on seed: enabled '{id}'");
        }
    }

    seed_companion_ui(store, manifests).await;
}

/// Every built-in companion that ships a compiled-in `ui_code` bundle, derived from
/// [`seed_overrides`] — the ONE table — so a newly added companion cannot be
/// forgotten here. See [`seed_companion_ui`] for what is done with them.
///
/// `pub(crate)` for one more reader: `plugin_manifest`'s
/// `companion_ui_fixtures_exist_and_are_nontrivial` size guard drives its loop off
/// this list instead of a hand-copied one, which is how `SKILL_EDITOR_UI_HTML` had
/// gone unguarded — the const existed, the table carried it, the guard's 14-row copy
/// did not.
pub(crate) fn companion_ui_specs() -> Vec<SeedSpec> {
    seed_overrides()
        .into_iter()
        .filter(|s| s.ui_code.is_some())
        .collect()
}

/// The compiled-in companion bundle for a built-in id, or `None` if it ships none.
///
/// The lookup that decouples "a built-in's bundle exists" from "the seed wrote a
/// record for it". [`seed_companion_ui`] used to be the ONLY reader of
/// [`companion_ui_specs`], which is why a built-in had to be pre-seeded to be
/// enable-able at all; [`crate::plugins::lifecycle::install_app`] now reads it too,
/// so the Store's own Install carries the bundle and pre-seeding becomes optional
/// per app (see [`NOT_PRE_INSTALLED`]).
pub(crate) fn compiled_in_ui_code(id: &str) -> Option<&'static str> {
    companion_ui_specs()
        .into_iter()
        .find(|s| s.id == id)
        .and_then(|s| s.ui_code)
}

/// Built-in companions that ship a compiled-in bundle but must NOT be pre-seeded
/// into the store at all — not installed, not disabled-and-installed, absent.
///
/// # Why this list exists (and why it is not just "default-off")
///
/// Default-off already meant "nothing spawns". It did NOT mean "absent": every
/// opt-in companion still got a DISABLED record from [`seed_companion_ui`], purely
/// so its bundle had somewhere to live, and the Store therefore listed it under
/// *Installed* on a fresh machine with an uninstall that the next boot silently
/// undid. For a leaf feature nobody asked for, "Installed (off)" is still
/// pre-loaded surface — which is the posture `CORE_DEFAULT_ON`'s default-off note
/// set out to avoid.
///
/// The reason it could not simply be dropped before is now gone:
/// [`crate::plugins::lifecycle::install_app`] sources the compiled-in bundle at
/// INSTALL time via [`compiled_in_ui_code`], so `Install` → `Enable` from the Store
/// mounts a real UI with no seeded record. Grants follow the ordinary path too —
/// `enable_app` validates each app's own `permission_grants` through the Gateway and
/// persists the approved set, which for these two is byte-identical to the `grants`
/// their [`seed_overrides`] rows hardcode (the Gateway's capability grammar allows
/// `spaces:docs` / `media:*` / `hook:*` / `core:list_agents` for their owners).
///
/// Membership is a PRODUCT decision — "should a fresh install list this app as
/// installed?" — so it stays a hand-maintained list, not a derived one. Uninstall
/// protection is unaffected: `is_uninstall_protected` keys off `SYSTEM_PLUGINS` /
/// default-on, and neither id is in either, so the Store could already uninstall
/// them; this is what makes that uninstall STICK across a reboot.
pub(crate) const NOT_PRE_INSTALLED: &[&str] = &[
    // Two Space-document boards. Both are pure leaf features (a Space owns the
    // documents; nothing in Core reads their records), so an install that never
    // opens one has no reason to carry them.
    crate::plugin_manifest::WHITEBOARD_PLUGIN_ID,
    crate::plugin_manifest::CANVAS_PLUGIN_ID,
];

/// Make sure every built-in companion's compiled-in `ui_code` bundle actually
/// reaches its record: seeded onto a **disabled** record for the opt-in ones, and
/// back-filled onto any existing record that is missing it.
///
/// # Why this exists — nothing else sources a built-in's bundle
///
/// The `*_UI_HTML` consts are wired ONLY into [`seed_overrides`]. `enable_app` only
/// flips the enabled bit and persists grants; `update_app` does call `set_ui_code`,
/// but it is reached only from the update handler, which sources the bundle from a
/// *verified marketplace descriptor* — a built-in has none. And
/// `GET /api/plugins/:id/ui-bundle` has no compiled-in fallback (404 "plugin has no
/// UI bundle"). So a companion whose record carries no `ui_code` reports
/// `has_ui: false` in the contributions payload and mounts as "this app has no
/// interface" — for the opt-in companions there is nothing behind it either, because
/// the native pages they replaced were deleted in the W7 extraction.
///
/// `install_app` USED to be part of that list (a semver check plus `store.insert`,
/// no `ui_code`), which is why every opt-in companion had to be pre-seeded here to
/// be enable-able at all. It now reads [`compiled_in_ui_code`], so the Store's own
/// Install carries the bundle — that is what makes [`NOT_PRE_INSTALLED`] possible.
/// This pass remains the carriage for every OTHER opt-in companion (they are still
/// pre-seeded, so their Enable never routes through an install).
///
/// The default-on loop above covers the default-on companions on a fresh install.
/// This pass covers the two cases it cannot:
///
/// 1. **Opt-in companions** (`ui_code` row NOT in [`CORE_DEFAULT_ON`] and NOT in
///    [`NOT_PRE_INSTALLED`] — mail plus finetune/meetings/monitors/workflows/quests/
///    approvals/activity/timeline/skill-editor). The bundle is written onto a
///    **disabled** record: the app stays opt-in (nothing spawns on a fresh install)
///    yet its UI is already present the moment the user enables it from the Store.
///    For these ids that is still the ONLY thing that makes Enable work, because
///    their Enable path is `enable_app` (they are already installed, so it never
///    routes through `install_app`, which is where the bundle would otherwise come
///    from).
/// 2. **Any existing record with no bundle** — the upgrade case. The seed loop leaves
///    every existing record alone (`Ok(Some(_)) => continue`, so the user's choice
///    wins), which means a record written BEFORE its app carried a companion runnable
///    — every wave-2 governance shell that the W7 extraction later upgraded in place
///    — never receives one. Filling it is not a policy decision the user can have an
///    opinion about: `ui_code` is build content, not user state, and no user-facing
///    path ever sets it to NULL (`set_ui_code(_, None)` has no caller outside tests).
///    So this runs on every boot rather than behind a schema-version gate, and it
///    only ever FILLS a gap — an existing bundle is never overwritten, and `enabled`
///    / `approved_grants` are never touched.
///
/// # What it deliberately does NOT do
///
/// - Nothing is enabled. `set_enabled` is never called here.
/// - A default-on companion with NO record is skipped: either the loop above just
///   created it (so we take the fill branch instead), or [`seed_order`] fail-closed
///   SKIPPED it because its `requires` is unsatisfiable — and conjuring a record for
///   a plugin the graph refused would undo that refusal.
///
/// One known cosmetic consequence, unchanged from the mail-only version this
/// generalizes: uninstalling an opt-in companion removes its record, and the next
/// boot re-seeds a **disabled** one, so the Store shows it installed-but-off again.
/// Nothing runs, and the record is what the ui-bundle carriage hangs off. The
/// [`NOT_PRE_INSTALLED`] ids are the exception — their uninstall sticks, which is
/// half the reason that list exists.
async fn seed_companion_ui(store: &PluginStore, manifests: &[PluginManifest]) {
    for spec in companion_ui_specs() {
        let Some(ui_code) = spec.ui_code else {
            continue;
        };
        let id = spec.id;

        let existing = match store.get(id).await {
            Ok(existing) => existing,
            Err(e) => {
                tracing::warn!("companion ui seed: lookup '{id}' failed: {e}");
                continue;
            }
        };

        if existing.is_some() {
            // Case 2: fill a missing bundle, never overwrite one, never touch the
            // enabled bit or the approved grants.
            match store.has_ui_code(id).await {
                Ok(false) => match store.set_ui_code(id, Some(ui_code)).await {
                    Ok(_) => tracing::info!(
                        "companion ui seed: back-filled the compiled-in ui_code for '{id}' \
                         (its record predates the companion bundle, so it would have mounted \
                         as \"no interface\"); enabled state and grants untouched"
                    ),
                    Err(e) => tracing::warn!("companion ui seed: set_ui_code '{id}' failed: {e}"),
                },
                Ok(true) => {}
                Err(e) => tracing::warn!("companion ui seed: ui_code lookup '{id}' failed: {e}"),
            }
            continue;
        }

        // No record. The default-on loop owns those ids (including its fail-closed
        // skip), so only an opt-in companion is seeded from here.
        if CORE_DEFAULT_ON.contains(&id) {
            continue;
        }

        // …and not even every opt-in companion: the ids in `NOT_PRE_INSTALLED` must
        // stay ABSENT on a fresh install (and stay absent after an uninstall). This
        // is safe only because `lifecycle::install_app` now sources the same
        // compiled-in bundle at install time — the Store's Install → Enable carries
        // it. Reached only on the no-record path, so the case-2 back-fill above
        // still repairs an EXISTING record for a user who already enabled one.
        if NOT_PRE_INSTALLED.contains(&id) {
            continue;
        }

        let Some(version) = manifests
            .iter()
            .find(|m| m.id == id)
            .map(|m| m.version.clone())
        else {
            continue;
        };

        if let Err(e) = store.insert(id, &version).await {
            tracing::warn!("companion ui seed: insert '{id}' failed: {e}");
            continue;
        }
        if let Err(e) = store.set_ui_code(id, Some(ui_code)).await {
            tracing::warn!("companion ui seed: set_ui_code '{id}' failed: {e}");
            continue;
        }
        // Deliberately NOT enabled — the app stays opt-in (no sidecar spawn on a
        // fresh install); the seeded `ui_code` makes `enable_app` mount the
        // companion whenever the user turns it on.
        tracing::info!("companion ui seed: seeded ui_code for '{id}' (disabled, opt-in)");
    }
}

/// The store schema version this build expects. Bump when adding a migration below.
///
/// Each step below is gated on its OWN version (`current < N`), not just on this
/// total. Re-running an earlier step at a later bump would re-assert a value the
/// user is entitled to have changed since — e.g. bumping to 2 and letting v1 stores
/// re-run the v1 grant backfill would re-grant `ghost:record` to everyone who
/// revoked it between v1 and v2, which is exactly what
/// `a_later_revocation_is_never_undone_by_a_second_run` forbids (that test cannot
/// see it, because it only ever runs against one const value).
///
/// - v1: backfill host-api grants onto pre-existing records ([`backfill_host_api_grants`]).
/// - v2: re-enable the Learning app's record so its consent switches are reachable
///   again ([`restore_learning_consent_surface`]).
/// - v3: drop the seed-artifact records for the [`NOT_PRE_INSTALLED`] apps, but only
///   where they were never enabled ([`unseed_not_pre_installed`]).
const STORE_SCHEMA_VERSION: i64 = 3;

/// One-time data migrations for ALREADY-INSTALLED stores.
///
/// # Why this exists (and why it is not part of the seed loop)
///
/// [`seed_default_on`] deliberately short-circuits on `Ok(Some(_)) => continue`: a
/// plugin with any existing record is left alone, because the user's choice wins.
/// That is right for enable/disable, but it means a built-in that starts REQUIRING a
/// grant it never needed before is broken on every pre-existing install — the record
/// was written when the grant did not exist, and nothing else rewrites
/// `approved_grants` (`set_enabled` is its only writer; `update_app` explicitly
/// leaves it untouched).
///
/// That is exactly what happened when the per-app `/api/host/<app>/*` reverse
/// callbacks moved onto the generic `/api/host/capability/<cap>` seam: those routes
/// previously required NO grant (the gate was the minted sidecar token plus a
/// hardcoded app-id pin), and the generic seam correctly requires the capability
/// grant the manifest declares. Fresh installs are fine. `recipes` — default-on, and
/// the only default-on caller — would 403 on `ghost.*` on every existing install
/// until the user manually disabled and re-enabled it.
///
/// # Why a one-time migration rather than a boot reconcile
///
/// A reconcile that ran on EVERY boot would re-grant a capability the user had
/// deliberately revoked, silently overriding them forever. Gating on the store's
/// `PRAGMA user_version` runs the backfill exactly once per install, so it repairs
/// the upgrade and then never fights the user again.
///
/// # Scope (deliberately narrow)
///
/// Only COMPILED-IN built-ins (`is_compiled_in_manifest`) — a disk manifest under
/// `~/.ryu/plugins` must never self-approve, which is the whole point of the Gateway
/// gate. Only grants the built-in's own fixture declares, and only ADDITIVE
/// (`add_approved_grants` can never revoke).
///
/// # Steps
///
/// One fn per schema version, each gated on `current < N` so a store that already ran
/// an earlier step never re-runs it (see [`STORE_SCHEMA_VERSION`]):
///
/// - v1 [`backfill_host_api_grants`] — the host-callback grant repair described above.
/// - v2 [`restore_learning_consent_surface`] — re-enable `com.ryu.learning`, whose
///   record now owns the consent switches for a capture path the kernel runs anyway.
/// - v3 [`unseed_not_pre_installed`] — remove the never-enabled records that the old
///   unconditional companion-ui pre-seed wrote for the [`NOT_PRE_INSTALLED`] apps.
///   The seed change alone only fixes FRESH installs (the loop leaves every existing
///   record alone), so without this step every current machine keeps listing
///   Whiteboard/Canvas as installed forever.
pub async fn run_one_time_migrations(store: &PluginStore, manifests: &[PluginManifest]) {
    let current = match store.schema_version().await {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("store migration: reading schema version failed: {e}");
            return;
        }
    };
    if current >= STORE_SCHEMA_VERSION {
        return;
    }

    if current < 1 {
        backfill_host_api_grants(store, manifests).await;
    }
    if current < 2 {
        restore_learning_consent_surface(store).await;
    }
    if current < 3 {
        unseed_not_pre_installed(store).await;
    }

    if let Err(e) = store.set_schema_version(STORE_SCHEMA_VERSION).await {
        // Not fatal, but not free either: a failed version write means every step is
        // attempted again next boot, and re-running a step RE-ASSERTS its value. If
        // the user changed that value in between, the re-run silently overrides them
        // — v1 would re-grant a revoked `ghost:record`, v2 would re-enable a Learning
        // record the user just disabled. That is the same class of bug the version
        // gate exists to prevent, narrowed to the window between a failed PRAGMA
        // write and the next restart. Only a store that cannot be written to at all
        // reaches here, so the narrow exposure is accepted rather than retried.
        tracing::warn!("store migration: recording schema version failed: {e}");
    }
}

/// **v1** — see [`run_one_time_migrations`] for the why.
async fn backfill_host_api_grants(store: &PluginStore, manifests: &[PluginManifest]) {
    for manifest in manifests {
        if !crate::plugins::builtins::is_compiled_in_manifest(&manifest.id) {
            continue;
        }
        // The grants a sidecar needs for its host callbacks, which is the set the
        // capability seam now enforces. `permission_grants` is the manifest-level
        // declaration the Gateway validates; the intersection is what a fresh
        // install would have ended up with.
        let needed: Vec<String> = manifest
            .sidecars
            .iter()
            .flat_map(|s| s.host_api.iter())
            .flat_map(|h| h.grants.iter())
            .filter(|g| manifest.permission_grants.iter().any(|p| p == *g))
            .cloned()
            .collect();
        if needed.is_empty() {
            continue;
        }
        match store.get(&manifest.id).await {
            // No record = nothing installed yet; the seed will do the right thing.
            Ok(None) | Err(_) => continue,
            Ok(Some(record)) => {
                let missing: Vec<String> = needed
                    .iter()
                    .filter(|g| !record.approved_grants.iter().any(|a| a == *g))
                    .cloned()
                    .collect();
                if missing.is_empty() {
                    continue;
                }
                match store.add_approved_grants(&manifest.id, &missing).await {
                    Ok(_) => tracing::info!(
                        "store migration v1: backfilled host-api grant(s) {missing:?} for \
                         built-in '{}' (its host callbacks became capability-gated; a \
                         pre-existing record predates the grant)",
                        manifest.id
                    ),
                    Err(e) => tracing::warn!(
                        "store migration: backfilling grants for '{}' failed: {e}",
                        manifest.id
                    ),
                }
            }
        }
    }
}

/// **v2** — restore the Learning app's record (enabled) on installs that already
/// had one, so its consent switches are reachable again.
///
/// # The regression this repairs
///
/// The two learning consent switches moved out of Privacy settings and into an
/// app-registered settings tab (`contributes.settings_tabs` in the `com.ryu.learning`
/// manifest, rendered by the desktop's `LearningSettings.tsx`). An app-registered tab
/// only renders while its owning app is ENABLED. Adding the id to [`CORE_DEFAULT_ON`]
/// fixes fresh installs only: [`seed_default_on`] short-circuits on
/// `Ok(Some(_)) => continue`, and Learning was default-OFF until now, so essentially
/// every pre-existing install carries a `com.ryu.learning` record at `enabled = false`.
/// Those users would see NO consent switches at all.
///
/// # Why enabling the record is safe — the whole justification
///
/// **The app record is not the consent.** The consent is the two preferences, and this
/// migration does not touch either: `learning.enabled` (the training/PRM opt-in) stays
/// OFF, and `learning.skills-enabled` keeps whatever the user set. Enabling the record
/// only makes the settings SURFACE and the `/api/learn/*` routes reachable again — it
/// restores a control the user lost, it does not turn anything on.
///
/// Nothing about what actually RUNS changes, because the capture and the cycle were
/// never gated on the record in the first place: the scheduler keeps running its
/// `JobTarget::LearningCycle` job and the in-process `ExperienceStore` keeps capturing
/// `(user, assistant)` turns whether the app is enabled or not (see the
/// `learning_routes` doc — "Only the HTTP surface is gated"). Nor does any boot path
/// seed global state from this record, the way `main.rs` seeds `dictation::set_enabled
/// (rec.enabled)` and `predict::set_enabled(rec.enabled)`; and the manifest declares no
/// sidecar and no `mcp_servers`, so flipping the bit spawns nothing. That asymmetry —
/// still running, but no longer switchable off — is precisely why the surface must be
/// restored.
///
/// # Scope
///
/// Exactly one id, looked up through [`default_on_specs`], which is derived from
/// [`CORE_DEFAULT_ON`] ⊂ `CORE_PLUGINS` ⊂ compiled-in built-ins — a tighter scope than
/// the v1 step's `is_compiled_in_manifest` guard, and self-limiting: if Learning ever
/// leaves the default-on set again, this step stops asserting anything. No other app
/// is touched, and a record that is already enabled (or absent — an install that never
/// had Learning is a fresh-seed case, not an upgrade case) is left alone.
///
/// # Why this does not re-derive the dependency graph
///
/// The module header promises the store-only write never bypasses the graph, and
/// Learning is the plugin that made that promise concrete — it `requires` the `skills`
/// app. This step still calls `set_enabled` directly, deliberately: a satisfiability
/// guard would turn a ONE-SHOT migration into a permanent no-op for anyone who has
/// `skills` disabled, stranding exactly the users the repair exists for, with no second
/// bump to save them. The exposure is small and recoverable in a way the alternative is
/// not: `skills` is default-on (so a disabled dependency is rare), enabling Learning is
/// one bit with no sidecar and no spawn, and a half-enabled pair is re-derived by the
/// ordinary enable/disable path the moment either app is toggled — whereas a silently
/// skipped one-shot migration is not recoverable at all.
///
/// # Why once, not every boot
///
/// The version gate is the entire safety property: a user who disables Learning AFTER
/// this migration must stay disabled across every subsequent restart. A reconcile that
/// re-enabled it on every boot would take the off-switch away permanently, which is the
/// same class of bug as the one being repaired.
async fn restore_learning_consent_surface(store: &PluginStore) {
    let id = crate::plugins::builtins::LEARNING_PLUGIN_ID;
    let Some(spec) = default_on_specs().into_iter().find(|s| s.id == id) else {
        return;
    };

    let record = match store.get(id).await {
        // Already enabled, or never installed — nothing to repair. (The absent case
        // belongs to `seed_default_on`, which conjures no record it did not create.)
        Ok(Some(record)) if record.enabled => return,
        Ok(None) => return,
        Ok(Some(record)) => record,
        Err(e) => {
            tracing::warn!("store migration v2: lookup '{id}' failed: {e}");
            return;
        }
    };

    // A record written during the default-OFF era has NO `ui_code`: nothing but
    // `seed_overrides` sources a built-in's companion bundle (neither `install_app`
    // nor `enable_app` does — that is the whole reason [`seed_companion_ui`] exists),
    // and the default-on seed loop skipped this record. Enabling without it would
    // trade a missing switch for a companion that mounts as "no runnable UI".
    // Only ever FILLS a gap; a record that already has a bundle is left alone.
    //
    // Kept even though `seed_companion_ui` now back-fills every companion record on
    // every boot: `main.rs` runs the seed BEFORE the migrations, so in practice this
    // finds the bundle already there and no-ops — but the repair this migration owes
    // its user must not depend on the ORDER of two independent boot steps.
    if let Some(ui_code) = spec.ui_code {
        match store.has_ui_code(id).await {
            Ok(false) => {
                if let Err(e) = store.set_ui_code(id, Some(ui_code)).await {
                    tracing::warn!("store migration v2: set_ui_code '{id}' failed: {e}");
                }
            }
            Ok(true) => {}
            Err(e) => tracing::warn!("store migration v2: ui_code lookup '{id}' failed: {e}"),
        }
    }

    // Union, never replace: the v1 step above adds grants WITHOUT touching `enabled`,
    // so a record can reach here already carrying grants that a bare
    // `set_enabled(id, &spec.grants)` would silently drop.
    let mut grants = record.approved_grants.clone();
    for g in spec.grants {
        if !grants.iter().any(|have| have == *g) {
            grants.push((*g).to_owned());
        }
    }

    match store.set_enabled(id, &grants).await {
        Ok(_) => tracing::info!(
            "store migration v2: re-enabled '{id}' so its consent switches are reachable \
             again (the record is not the consent — `learning.enabled` stays OFF and \
             `learning.skills-enabled` is untouched; capture + the learning cycle were \
             never gated on this record)"
        ),
        Err(e) => tracing::warn!("store migration v2: enabling '{id}' failed: {e}"),
    }
}

/// **v3** — un-seed the [`NOT_PRE_INSTALLED`] apps on stores that already carry the
/// record the old unconditional pre-seed wrote.
///
/// # Why the seed change is not enough on its own
///
/// [`seed_default_on`] / [`seed_companion_ui`] leave every EXISTING record alone —
/// that is the "user's choice wins" rule, and it is right. But it means dropping the
/// pre-seed only ever fixes machines that have not booted yet: every current install
/// keeps a `com.ryu.whiteboard` / `com.ryu.canvas` row forever, and the Store keeps
/// listing them as installed. This step is what makes the change reach them.
///
/// # Why removing the record loses nothing
///
/// The record holds no user state: `ui_code` is build content (re-attached by
/// `lifecycle::install_app` from the compiled-in const), `approved_grants` is
/// re-derived by `enable_app` from the manifest, and the app's actual content — the
/// Space documents its board renders — lives in Spaces and is never touched here. So
/// the worst case for a user who WANTED it is one click in the Store, and the app
/// re-installs with an identical record.
///
/// # The one line it will not cross
///
/// **An ENABLED record is never removed.** Enabled is the one bit that can only have
/// come from a deliberate act (nothing ever seeded these two enabled — see
/// `the_real_seed_enables_spaces_and_leaves_its_space_owning_apps_optin`), and
/// removing it would delete a working app out from under someone mid-use. Same shape
/// as v1/v2's refusal to override a later user decision.
///
/// Once per install, like every step here: a user who installs Whiteboard AFTER this
/// migration keeps it, because the version gate has already passed.
async fn unseed_not_pre_installed(store: &PluginStore) {
    for id in NOT_PRE_INSTALLED {
        match store.get(id).await {
            // Never installed — the fresh-install case, already correct.
            Ok(None) => continue,
            // The user turned it on. Their choice, and the app is in use.
            Ok(Some(record)) if record.enabled => {
                tracing::info!(
                    "store migration v3: keeping '{id}' — it is ENABLED, so the record is a \
                     deliberate choice, not the pre-seed artifact this step removes"
                );
            }
            Ok(Some(_)) => match store.remove(id).await {
                Ok(_) => tracing::info!(
                    "store migration v3: removed the never-enabled '{id}' record (the old \
                     companion-ui pre-seed wrote it so the app's compiled-in bundle had a home; \
                     `lifecycle::install_app` now attaches that bundle at install time, so the \
                     app is fully available from the Store without being pre-installed)"
                ),
                Err(e) => tracing::warn!("store migration v3: removing '{id}' failed: {e}"),
            },
            Err(e) => tracing::warn!("store migration v3: lookup '{id}' failed: {e}"),
        }
    }
}

#[cfg(test)]
mod migration_tests {
    use super::*;

    const RECIPES: &str = "com.ryu.recipes";

    /// Reproduces the actual upgrade: a store seeded BEFORE the per-app
    /// `/api/host/recipes/*` callbacks moved onto the capability seam. Its record is
    /// enabled with NO grants, because those routes required none. After the move,
    /// `ghost.*` needs `ghost:record`, so without this migration every pre-existing
    /// install 403s on recipe replay/record until the user toggles the app off and on.
    #[tokio::test]
    async fn backfills_a_host_api_grant_onto_a_pre_existing_record() {
        let manifests = crate::plugin_manifest::PluginManifestLoader::load_builtins();
        let store = PluginStore::open_in_memory().unwrap();

        // The pre-upgrade state: installed + enabled, empty approved_grants.
        store.insert(RECIPES, "1.0.0").await.unwrap();
        store.set_enabled(RECIPES, &[]).await.unwrap();

        run_one_time_migrations(&store, &manifests).await;

        let record = store.get(RECIPES).await.unwrap().unwrap();
        assert!(
            record.approved_grants.iter().any(|g| g == "ghost:record"),
            "recipes must regain the grant its host callbacks now require, got {:?}",
            record.approved_grants
        );
        assert!(
            record.enabled,
            "the backfill must not disturb enabled state"
        );
    }

    /// The property that makes running this at boot safe: it happens ONCE. A user who
    /// revokes a grant afterwards must keep it revoked across every later restart —
    /// a reconcile that re-asserted the grant on every boot would silently override
    /// them forever, which is why this is version-gated rather than unconditional.
    #[tokio::test]
    async fn a_later_revocation_is_never_undone_by_a_second_run() {
        let manifests = crate::plugin_manifest::PluginManifestLoader::load_builtins();
        let store = PluginStore::open_in_memory().unwrap();
        store.insert(RECIPES, "1.0.0").await.unwrap();
        store.set_enabled(RECIPES, &[]).await.unwrap();

        run_one_time_migrations(&store, &manifests).await;
        // The user revokes it.
        store.set_enabled(RECIPES, &[]).await.unwrap();
        // Every subsequent boot.
        run_one_time_migrations(&store, &manifests).await;
        run_one_time_migrations(&store, &manifests).await;

        let record = store.get(RECIPES).await.unwrap().unwrap();
        assert!(
            record.approved_grants.is_empty(),
            "a revoked grant must stay revoked, got {:?}",
            record.approved_grants
        );
    }

    /// A disk manifest must never self-approve — that is the entire point of the
    /// Gateway grant gate, and a migration that ignored it would be a way to bypass
    /// the capability grammar by shipping a manifest that declares its own host_api.
    #[tokio::test]
    async fn a_non_compiled_in_plugin_is_never_backfilled() {
        let store = PluginStore::open_in_memory().unwrap();
        let evil = "com.evil.app";
        assert!(
            !crate::plugins::builtins::is_compiled_in_manifest(evil),
            "'{evil}' must not be a built-in for this test to mean anything"
        );
        store.insert(evil, "1.0.0").await.unwrap();
        store.set_enabled(evil, &[]).await.unwrap();

        // A manifest that declares a sidecar host_api grant AND the matching
        // permission_grant — i.e. it has done everything a built-in does.
        let mut manifest = crate::plugin_manifest::PluginManifestLoader::load_builtins()
            .into_iter()
            .find(|m| m.id == RECIPES)
            .expect("recipes fixture");
        manifest.id = evil.to_owned();

        run_one_time_migrations(&store, &[manifest]).await;

        let record = store.get(evil).await.unwrap().unwrap();
        assert!(
            record.approved_grants.is_empty(),
            "a disk manifest must never self-approve a host-api grant, got {:?}",
            record.approved_grants
        );
    }

    const LEARNING: &str = crate::plugins::builtins::LEARNING_PLUGIN_ID;
    const QUESTS: &str = crate::plugins::builtins::QUESTS_PLUGIN_ID;

    /// THE consent-surface regression (v2). Learning was default-OFF until its two
    /// consent switches moved onto its app-registered settings tab, so essentially
    /// every pre-existing install has a `com.ryu.learning` record at `enabled = false`
    /// — and an app-registered tab only renders while its app is enabled. The seed
    /// loop cannot fix it (`Ok(Some(_)) => continue`), so those users lose the
    /// off-switch for a capture path the kernel keeps running regardless of the record.
    #[tokio::test]
    async fn the_learning_consent_surface_is_restored_on_a_pre_existing_disabled_record() {
        let manifests = crate::plugin_manifest::PluginManifestLoader::load_builtins();
        let store = PluginStore::open_in_memory().unwrap();

        // The pre-upgrade state: installed, and the user (or the old default-OFF
        // posture) left it disabled.
        store.insert(LEARNING, "1.0.0").await.unwrap();
        store.set_disabled(LEARNING).await.unwrap();

        run_one_time_migrations(&store, &manifests).await;

        let record = store.get(LEARNING).await.unwrap().unwrap();
        let ui = store
            .get_ui_code(LEARNING)
            .await
            .unwrap()
            .expect("a re-enabled record must carry its companion bundle, not mount empty");
        assert!(
            ui.len() > 10_000 && ui.contains('<'),
            "learning ui_code must be the real inlined companion bundle, got {} bytes",
            ui.len()
        );
        assert!(
            record.enabled,
            "learning must be re-enabled so its settings tab (and /api/learn/*) is \
             reachable again"
        );
        assert!(
            record.approved_grants.iter().any(|g| g == "learning:crud"),
            "a re-enabled record must carry the grants a fresh install would have, got {:?}",
            record.approved_grants
        );
    }

    /// The property that makes v2 safe, mirroring
    /// `a_later_revocation_is_never_undone_by_a_second_run`: the version gate. A user
    /// who disables Learning AFTER the migration must stay disabled across every later
    /// restart — a boot reconcile would take the off-switch away permanently, the same
    /// class of bug the migration repairs.
    ///
    /// This FAILS if the version gating is removed — but note it takes BOTH gates to
    /// turn it red, because they are redundant for v2: dropping only the
    /// `current >= STORE_SCHEMA_VERSION` early return still leaves `current < 2` false
    /// on the second run, and dropping only `current < 2` still hits the early return.
    /// So this test pins the PROPERTY (run-once, never a reconcile), not either gate in
    /// isolation. `a_v1_store_gets_only_the_v2_step` is what pins the per-step gate.
    /// The first assert below is load-bearing in the other direction: it fails if the
    /// v2 step is removed outright, which keeps the tail assert from passing vacuously.
    #[tokio::test]
    async fn a_later_learning_disable_is_never_undone_by_a_second_run() {
        let manifests = crate::plugin_manifest::PluginManifestLoader::load_builtins();
        let store = PluginStore::open_in_memory().unwrap();
        store.insert(LEARNING, "1.0.0").await.unwrap();
        store.set_disabled(LEARNING).await.unwrap();

        run_one_time_migrations(&store, &manifests).await;
        assert!(store.get(LEARNING).await.unwrap().unwrap().enabled);

        // The user turns Learning off again.
        store.set_disabled(LEARNING).await.unwrap();
        // Every subsequent boot.
        run_one_time_migrations(&store, &manifests).await;
        run_one_time_migrations(&store, &manifests).await;

        assert!(
            !store.get(LEARNING).await.unwrap().unwrap().enabled,
            "a deliberate disable must survive every later boot"
        );
    }

    /// v2 is exactly one id. It must not become a general "re-enable the default-on
    /// set" reconcile: another app the user disabled stays disabled, and a default-OFF
    /// built-in is never enabled at all.
    #[tokio::test]
    async fn the_learning_migration_enables_no_other_app() {
        assert!(
            crate::plugins::builtins::CORE_PLUGINS.contains(&QUESTS)
                && !CORE_DEFAULT_ON.contains(&QUESTS),
            "'{QUESTS}' must be a built-in that is NOT default-on for this test to mean \
             anything"
        );
        let manifests = crate::plugin_manifest::PluginManifestLoader::load_builtins();
        let store = PluginStore::open_in_memory().unwrap();

        store.insert(LEARNING, "1.0.0").await.unwrap();
        store.set_disabled(LEARNING).await.unwrap();
        // A default-ON app the user deliberately turned off.
        store.insert(RECIPES, "1.0.0").await.unwrap();
        store.set_disabled(RECIPES).await.unwrap();
        // A default-OFF built-in, never enabled.
        store.insert(QUESTS, "1.0.0").await.unwrap();

        run_one_time_migrations(&store, &manifests).await;

        assert!(store.get(LEARNING).await.unwrap().unwrap().enabled);
        assert!(
            !store.get(RECIPES).await.unwrap().unwrap().enabled,
            "another default-on app the user disabled must stay disabled"
        );
        assert!(
            !store.get(QUESTS).await.unwrap().unwrap().enabled,
            "a default-off built-in must never be enabled by this migration"
        );
    }

    /// Each step is gated on its OWN version, so bumping the schema for v2 must NOT
    /// drag the v1 grant backfill along for a store that already ran it: re-running it
    /// would re-grant `ghost:record` to everyone who revoked it between v1 and v2 —
    /// the same "a reconcile silently overrides the user" bug the version gate exists
    /// to prevent, invisible to the single-version revocation test above.
    #[tokio::test]
    async fn a_v1_store_gets_only_the_v2_step() {
        let manifests = crate::plugin_manifest::PluginManifestLoader::load_builtins();
        let store = PluginStore::open_in_memory().unwrap();
        store.set_schema_version(1).await.unwrap();

        // Enabled, and the user revoked the grant the v1 backfill had given it.
        store.insert(RECIPES, "1.0.0").await.unwrap();
        store.set_enabled(RECIPES, &[]).await.unwrap();
        store.insert(LEARNING, "1.0.0").await.unwrap();
        store.set_disabled(LEARNING).await.unwrap();

        run_one_time_migrations(&store, &manifests).await;

        assert!(
            store
                .get(RECIPES)
                .await
                .unwrap()
                .unwrap()
                .approved_grants
                .is_empty(),
            "the v1 backfill must not re-run for a store already at v1"
        );
        assert!(
            store.get(LEARNING).await.unwrap().unwrap().enabled,
            "the v2 step must still run for a store at v1"
        );
    }

    /// An app the user never installed must not be conjured into existence.
    #[tokio::test]
    async fn an_absent_record_is_left_absent() {
        let manifests = crate::plugin_manifest::PluginManifestLoader::load_builtins();
        let store = PluginStore::open_in_memory().unwrap();

        run_one_time_migrations(&store, &manifests).await;

        assert!(store.get(RECIPES).await.unwrap().is_none());
    }

    /// **v3** — the upgrade case the seed change cannot reach on its own: every
    /// existing install carries the disabled `com.ryu.whiteboard` / `com.ryu.canvas`
    /// record the old pre-seed wrote, and `seed_default_on` leaves existing records
    /// alone by design. Without this step the change ships as fresh-installs-only.
    #[tokio::test]
    async fn v3_removes_the_never_enabled_pre_seed_records() {
        let manifests = crate::plugin_manifest::PluginManifestLoader::load_builtins();
        let store = PluginStore::open_in_memory().unwrap();

        // The pre-upgrade state the old `seed_companion_ui` produced: installed,
        // disabled, carrying the compiled-in bundle.
        for id in NOT_PRE_INSTALLED {
            store.insert(id, "1.0.0").await.unwrap();
            store
                .set_ui_code(id, Some("<html>bundle</html>"))
                .await
                .unwrap();
        }

        run_one_time_migrations(&store, &manifests).await;

        for id in NOT_PRE_INSTALLED {
            assert!(
                store.get(id).await.unwrap().is_none(),
                "'{id}' was a never-enabled pre-seed artifact — v3 must remove it"
            );
        }
    }

    /// The line v3 will not cross. `enabled` can only have come from a deliberate act
    /// (nothing ever seeded these two enabled), so removing the record would delete a
    /// working app out from under someone mid-use — the same "never override a later
    /// user decision" rule v1 and v2 are built on.
    #[tokio::test]
    async fn v3_never_removes_an_enabled_record() {
        let manifests = crate::plugin_manifest::PluginManifestLoader::load_builtins();
        let store = PluginStore::open_in_memory().unwrap();

        let id = NOT_PRE_INSTALLED[0];
        store.insert(id, "1.0.0").await.unwrap();
        store
            .set_enabled(id, &["spaces:docs".to_owned()])
            .await
            .unwrap();

        run_one_time_migrations(&store, &manifests).await;

        let record = store
            .get(id)
            .await
            .unwrap()
            .expect("an ENABLED record must survive v3");
        assert!(record.enabled, "and must stay enabled");
        assert_eq!(
            record.approved_grants,
            vec!["spaces:docs".to_owned()],
            "its grants must be untouched"
        );
    }

    /// Once per install, like every other step: a user who installs Whiteboard AFTER
    /// the migration ran must keep it. A v3 that re-ran on every boot would make the
    /// app un-installable-by-Store, which is strictly worse than the pre-install it
    /// replaces.
    #[tokio::test]
    async fn v3_does_not_re_run_and_uninstall_a_later_install() {
        let manifests = crate::plugin_manifest::PluginManifestLoader::load_builtins();
        let store = PluginStore::open_in_memory().unwrap();

        run_one_time_migrations(&store, &manifests).await;

        // The user installs it afterwards, from the Store, and leaves it off.
        let id = NOT_PRE_INSTALLED[0];
        store.insert(id, "1.0.0").await.unwrap();

        run_one_time_migrations(&store, &manifests).await;

        assert!(
            store.get(id).await.unwrap().is_some(),
            "'{id}' was installed AFTER v3 ran — the version gate must stop v3 from removing it"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_manifest::{AppDependency, Requires};

    fn manifest(id: &str, version: &str, deps: &[&str]) -> PluginManifest {
        PluginManifest {
            id: id.to_owned(),
            name: id.to_owned(),
            version: version.to_owned(),
            requires: (!deps.is_empty()).then(|| Requires {
                apps: deps
                    .iter()
                    .map(|d| AppDependency {
                        id: (*d).to_owned(),
                        min_version: None,
                    })
                    .collect(),
                capabilities: vec![],
                grants: vec![],
            }),
            ..Default::default()
        }
    }

    fn spec(id: &'static str) -> SeedSpec {
        SeedSpec {
            id,
            grants: &[],
            ui_code: None,
        }
    }

    /// Capability edges (`requires.capabilities`) are lowered at seed time, so the
    /// seed order respects them: with the REAL built-ins, spaces requires the `rag`
    /// capability and rag requires `engines`, so the order is engines → rag → spaces
    /// even though those are capability edges, not app deps.
    #[test]
    fn seed_order_respects_capability_edges() {
        let specs = default_on_specs();
        let manifests = crate::plugin_manifest::PluginManifestLoader::load_builtins();
        let (order, skipped) = seed_order(&specs, &manifests);
        let pos = |id: &str| order.iter().position(|x| x == id);
        let (e, r, s) = (pos("engines"), pos("com.ryu.rag"), pos("com.ryu.spaces"));
        assert!(
            e.is_some() && r.is_some() && s.is_some(),
            "engines/rag/spaces all seeded (order: {order:?})"
        );
        assert!(e < r && r < s, "engines → rag → spaces (order: {order:?})");
        assert!(
            !skipped
                .iter()
                .any(|sk| sk.id == "com.ryu.spaces" || sk.id == "com.ryu.rag"),
            "no capability-related seed skip (skipped: {skipped:?})"
        );
    }

    /// THE regression this module exists for: the seed list is written by hand and
    /// is NOT topological. A dependent declared BEFORE its dependency must still be
    /// seeded AFTER it.
    #[test]
    fn seed_order_is_topological_even_when_declaration_order_is_not() {
        // "meetings" is declared first but requires "spaces".
        let specs = [spec("meetings"), spec("spaces")];
        let manifests = vec![
            manifest("meetings", "1.0.0", &["spaces"]),
            manifest("spaces", "1.0.0", &[]),
        ];

        let (ordered, skipped) = seed_order(&specs, &manifests);

        assert!(skipped.is_empty());
        assert_eq!(ordered, vec!["spaces".to_owned(), "meetings".to_owned()]);
    }

    /// FAIL-CLOSED: a default-on plugin whose dependency is NOT default-on is not
    /// seeded at all — never enabled with a dependency that was never enabled.
    #[test]
    fn a_dependency_outside_the_default_on_set_skips_the_plugin() {
        let specs = [spec("meetings")];
        let manifests = vec![
            manifest("meetings", "1.0.0", &["spaces"]),
            // `spaces` is loaded, but it is NOT in the default-on set.
            manifest("spaces", "1.0.0", &[]),
        ];

        let (ordered, skipped) = seed_order(&specs, &manifests);

        assert!(ordered.is_empty(), "nothing may be seeded: {ordered:?}");
        assert_eq!(skipped.len(), 1);
        assert_eq!(skipped[0].id, "meetings");
        assert!(matches!(
            skipped[0].error,
            graph::DependencyError::MissingDependency { .. }
        ));
    }

    /// A cycle among default-on plugins is skipped, not seeded (and never hangs).
    #[test]
    fn a_cycle_is_skipped() {
        let specs = [spec("a"), spec("b")];
        let manifests = vec![
            manifest("a", "1.0.0", &["b"]),
            manifest("b", "1.0.0", &["a"]),
        ];

        let (ordered, skipped) = seed_order(&specs, &manifests);

        assert!(ordered.is_empty());
        assert_eq!(skipped.len(), 2, "both ends of the cycle are unsatisfiable");
    }

    /// BACKWARD COMPAT: today NO built-in declares `requires`, so the order must be
    /// exactly the declaration order and nothing may be skipped.
    #[test]
    fn without_requires_the_order_is_the_declaration_order() {
        let specs = [spec("engines"), spec("durable"), spec("goal")];
        let manifests = vec![
            manifest("engines", "1.0.0", &[]),
            manifest("durable", "1.0.0", &[]),
            manifest("goal", "1.0.0", &[]),
        ];

        let (ordered, skipped) = seed_order(&specs, &manifests);

        assert!(skipped.is_empty());
        assert_eq!(ordered, vec!["engines", "durable", "goal"]);
    }

    /// A spec with no loaded manifest is silently dropped (the pre-graph behaviour:
    /// the version lookup returned `None` and the block did nothing).
    #[test]
    fn a_spec_without_a_manifest_is_dropped() {
        let specs = [spec("engines"), spec("not-loaded")];
        let manifests = vec![manifest("engines", "1.0.0", &[])];

        let (ordered, skipped) = seed_order(&specs, &manifests);

        assert_eq!(ordered, vec!["engines"]);
        assert!(skipped.is_empty(), "absent != unsatisfiable");
    }

    /// The seed table stays in lockstep with `CORE_DEFAULT_ON`: every default-on id
    /// gets exactly one spec, and the three companions carry their grants + UI code.
    #[test]
    fn default_on_specs_cover_core_default_on_exactly() {
        let specs = default_on_specs();
        assert_eq!(specs.len(), CORE_DEFAULT_ON.len());
        for id in CORE_DEFAULT_ON {
            assert_eq!(
                specs.iter().filter(|s| s.id == *id).count(),
                1,
                "'{id}' must have exactly one seed spec"
            );
        }
        let with_ui: Vec<&str> = specs
            .iter()
            .filter(|s| s.ui_code.is_some())
            .map(|s| s.id)
            .collect();
        assert_eq!(
            with_ui,
            vec![
                crate::plugins::builtins::LEARNING_PLUGIN_ID,
                crate::plugins::builtins::WEBHOOKS_PLUGIN_ID,
                crate::plugins::builtins::CALENDAR_PLUGIN_ID,
            ],
            "only the companions that STAY default-on ship their prebuilt UI bundle via \
             the default-on seed, in CORE_DEFAULT_ON order. The other companion apps \
             (whiteboard/canvas/finetune/meetings/quests/approvals/monitors/workflows/ \
             activity/timeline/skill-editor, plus mail) are opt-in (default-off), so they \
             leave the default-on seed — their SeedSpec `ui_code` is carried by \
             `seed_companion_ui` instead, onto a DISABLED record, which is what makes \
             enabling one from the Store mount a real UI. `learning` is back in the set: \
             it owns the consent switches for a capture path the kernel runs regardless \
             of the record (see CORE_DEFAULT_ON)"
        );
        // Non-companion Core plugins seed with EMPTY grants, exactly as the generic
        // loop did before this module existed.
        let engines = specs.iter().find(|s| s.id == "engines").unwrap();
        assert!(engines.grants.is_empty());
    }

    /// End-to-end over the real store: a fresh install seeds every default-on
    /// plugin enabled, and a second run never re-seeds (a user's disable sticks).
    #[tokio::test]
    async fn seeding_is_one_time_and_respects_a_user_disable() {
        let store = PluginStore::open_in_memory().unwrap();
        let manifests = vec![
            manifest("engines", "1.0.0", &[]),
            manifest("durable", "1.0.0", &[]),
        ];
        let specs = [spec("engines"), spec("durable")];
        let (ordered, _) = seed_order(&specs, &manifests);
        assert_eq!(ordered.len(), 2);

        // Simulate the seed for this synthetic set (seed_default_on drives the real
        // CORE_DEFAULT_ON table; the store behaviour under test is identical).
        for id in &ordered {
            store.insert(id, "1.0.0").await.unwrap();
            store.set_enabled(id, &[]).await.unwrap();
        }
        // The user disables one.
        store.set_disabled("durable").await.unwrap();

        // A re-seed must leave it disabled: a present record always wins.
        for id in &ordered {
            if store.get(id).await.unwrap().is_some() {
                continue;
            }
            store.set_enabled(id, &[]).await.unwrap();
        }
        assert!(store.get("engines").await.unwrap().unwrap().enabled);
        assert!(!store.get("durable").await.unwrap().unwrap().enabled);
    }

    /// The W7 Mail-companion extraction rests on this: mail is the first OPT-IN
    /// built-in companion, so the default-on seed loop never touches it, yet its
    /// `ui_code` MUST be present when the user enables it (nothing else — not
    /// `install_app`, not `enable_app` — seeds a built-in's `ui_code`). This drives
    /// the REAL `seed_default_on` over the REAL manifest set and asserts the end
    /// state: mail has a record with `ui_code` set, but stays DISABLED (opt-in, no
    /// sidecar spawn on fresh install). If this fails, enabling mail mounts a broken
    /// "no runnable UI" companion.
    #[tokio::test]
    async fn the_real_seed_seeds_mail_ui_code_but_leaves_it_disabled() {
        let manifests = crate::plugin_manifest::PluginManifestLoader::load_builtins();
        let store = PluginStore::open_in_memory().unwrap();

        seed_default_on(&store, &manifests).await;

        let mail_id = crate::plugins::builtins::MAIL_PLUGIN_ID;
        let mail = store
            .get(mail_id)
            .await
            .unwrap()
            .expect("the seed must install a mail record (disabled)");
        assert!(
            !mail.enabled,
            "mail must stay opt-in (DISABLED) — it must not be auto-enabled / its \
             sidecar auto-spawned on a fresh install"
        );
        let ui = store
            .get_ui_code(mail_id)
            .await
            .unwrap()
            .expect("mail's companion ui_code must be seeded so enable mounts the UI");
        assert!(
            ui.len() > 10_000 && ui.contains('<'),
            "mail ui_code must be the real inlined companion bundle, got {} bytes",
            ui.len()
        );
    }

    /// THE A3 regression, generalized from the mail case above: ELEVEN default-off
    /// built-in companions carried a real, size-guarded `ui_code` in `seed_overrides`
    /// that NOTHING ever wrote — the only opt-in carriage was a hardcoded
    /// one-element array holding mail, and neither `install_app` nor `enable_app`
    /// sources a bundle. Enabling any of them from the Store therefore mounted
    /// "this app has no interface" (the contributions payload's `has_ui` reads
    /// `has_ui_code`), with the native pages they replaced already deleted.
    ///
    /// Drives the REAL `seed_default_on` over the REAL manifest set and asserts the
    /// end state for EVERY pre-seeded opt-in companion: a record, DISABLED (still
    /// opt-in, no spawn on a fresh install), carrying its bundle — which is exactly
    /// what makes the Store's Enable (`enable_app`, which only flips the bit) mount a
    /// real UI.
    ///
    /// The [`NOT_PRE_INSTALLED`] ids are deliberately excluded: they get NO record at
    /// all now, and their bundle arrives from `lifecycle::install_app` instead. The
    /// sibling `not_pre_installed_apps_get_no_record_but_stay_fully_installable` owns
    /// that end state, so the A3 guard here is not weakened — it is re-pointed.
    #[tokio::test]
    async fn the_real_seed_seeds_every_optin_companion_ui_code_but_leaves_them_disabled() {
        use crate::plugins::builtins::{
            ACTIVITY_PLUGIN_ID, APPROVALS_PLUGIN_ID, MAIL_PLUGIN_ID, MEETINGS_PLUGIN_ID,
            MONITORS_PLUGIN_ID, QUESTS_PLUGIN_ID, SKILL_EDITOR_PLUGIN_ID, TIMELINE_PLUGIN_ID,
            WORKFLOWS_PLUGIN_ID,
        };

        let manifests = crate::plugin_manifest::PluginManifestLoader::load_builtins();
        let store = PluginStore::open_in_memory().unwrap();

        seed_default_on(&store, &manifests).await;

        let optin: Vec<&str> = companion_ui_specs()
            .into_iter()
            .map(|s| s.id)
            .filter(|id| !CORE_DEFAULT_ON.contains(id) && !NOT_PRE_INSTALLED.contains(id))
            .collect();

        // Non-vacuous, and named: the nine still-pre-seeded default-off companions
        // plus mail. If a companion legitimately moves into CORE_DEFAULT_ON it leaves
        // this list — and then the default-on loop carries its bundle, which the
        // sibling `default_on_specs_cover_core_default_on_exactly` pins. Whiteboard and
        // Canvas are absent BY DESIGN (`NOT_PRE_INSTALLED`).
        for id in [
            MAIL_PLUGIN_ID,
            crate::plugin_manifest::FINETUNE_PLUGIN_ID,
            MEETINGS_PLUGIN_ID,
            MONITORS_PLUGIN_ID,
            WORKFLOWS_PLUGIN_ID,
            QUESTS_PLUGIN_ID,
            APPROVALS_PLUGIN_ID,
            ACTIVITY_PLUGIN_ID,
            TIMELINE_PLUGIN_ID,
            SKILL_EDITOR_PLUGIN_ID,
        ] {
            assert!(
                optin.contains(&id),
                "'{id}' ships a compiled-in companion bundle and is default-off, so it must \
                 be in the opt-in carriage list, got {optin:?}"
            );
        }

        for id in optin {
            let record = store
                .get(id)
                .await
                .unwrap()
                .unwrap_or_else(|| panic!("the seed must install a '{id}' record (disabled)"));
            assert!(
                !record.enabled,
                "'{id}' must stay opt-in (DISABLED) — seeding its UI must not turn it on"
            );
            assert!(
                record.approved_grants.is_empty(),
                "'{id}' is not enabled, so no grants may be persisted (the Gateway approves \
                 them at enable), got {:?}",
                record.approved_grants
            );
            let ui = store.get_ui_code(id).await.unwrap().unwrap_or_else(|| {
                panic!(
                    "'{id}' must carry its compiled-in ui_code so enabling it from the Store \
                     mounts a real UI instead of \"this app has no interface\""
                )
            });
            assert!(
                ui.len() > 10_000 && ui.contains('<'),
                "'{id}' ui_code must be the real inlined companion bundle, got {} bytes",
                ui.len()
            );
        }
    }

    /// The end state for the [`NOT_PRE_INSTALLED`] apps, and the reason dropping the
    /// pre-seed is safe rather than a regression: a fresh store has NO record for
    /// them (so the Store lists them as available, not "Installed (off)"), and the
    /// ordinary `install_app` carries the compiled-in bundle so a one-click Install
    /// lands the exact record the pre-seed used to write.
    ///
    /// Both halves matter. Asserting only the absence would pass just as well for the
    /// broken version of this change — the one where the pre-seed is gone, nothing
    /// replaces it, and enabling the app from the Store mounts "this app has no
    /// interface" (the A3 regression the sibling test above exists for). The install
    /// leg is what proves the carriage moved instead of disappearing.
    #[tokio::test]
    async fn not_pre_installed_apps_get_no_record_but_stay_fully_installable() {
        use crate::plugin_manifest::{CANVAS_PLUGIN_ID, WHITEBOARD_PLUGIN_ID};

        // Non-vacuous, and pinned by name: this is a product decision, so a silent
        // emptying of the list must fail here rather than quietly re-pre-install.
        for id in [WHITEBOARD_PLUGIN_ID, CANVAS_PLUGIN_ID] {
            assert!(
                NOT_PRE_INSTALLED.contains(&id),
                "'{id}' must be in NOT_PRE_INSTALLED"
            );
            assert!(
                !CORE_DEFAULT_ON.contains(&id),
                "'{id}' cannot be default-on AND not-pre-installed"
            );
        }

        let manifests = crate::plugin_manifest::PluginManifestLoader::load_builtins();
        let store = PluginStore::open_in_memory().unwrap();

        seed_default_on(&store, &manifests).await;

        for id in NOT_PRE_INSTALLED {
            assert!(
                store.get(id).await.unwrap().is_none(),
                "'{id}' must NOT be pre-installed by the seed — a fresh install must carry no \
                 record for it at all"
            );

            // …and the Store's Install must still deliver a mountable app.
            let manifest = manifests
                .iter()
                .find(|m| m.id == *id)
                .unwrap_or_else(|| panic!("'{id}' must be a compiled-in built-in manifest"));
            crate::plugins::lifecycle::install_app(&store, manifest)
                .await
                .unwrap();

            let record = store.get(id).await.unwrap().expect("installed");
            assert!(
                !record.enabled,
                "install must leave '{id}' DISABLED — Enable is a separate, Gateway-validated \
                 step"
            );
            let ui = store.get_ui_code(id).await.unwrap().unwrap_or_else(|| {
                panic!(
                    "installing '{id}' must attach its compiled-in companion bundle, or enabling \
                     it mounts \"this app has no interface\""
                )
            });
            assert!(
                ui.len() > 10_000 && ui.contains('<'),
                "'{id}' ui_code must be the real inlined companion bundle, got {} bytes",
                ui.len()
            );
        }
    }

    /// A second boot must not undo the first: `seed_companion_ui` runs on EVERY boot
    /// (it is the case-2 back-fill path), so the skip has to hold for a store that
    /// already exists, not just an empty one. The bug this forbids is the same one the
    /// old code's own doc note describes — uninstall, reboot, and it is back.
    #[tokio::test]
    async fn a_reboot_never_re_pre_installs_a_not_pre_installed_app() {
        let manifests = crate::plugin_manifest::PluginManifestLoader::load_builtins();
        let store = PluginStore::open_in_memory().unwrap();

        seed_default_on(&store, &manifests).await;
        seed_default_on(&store, &manifests).await;
        seed_default_on(&store, &manifests).await;

        for id in NOT_PRE_INSTALLED {
            assert!(
                store.get(id).await.unwrap().is_none(),
                "'{id}' came back on a later boot — an uninstall must survive a restart"
            );
        }
    }

    /// The case-2 back-fill must keep working for a user who DID enable one of these:
    /// the skip is only on the record-CREATION branch, so an existing record whose
    /// bundle is missing is still repaired. Getting this wrong would strand exactly
    /// the users who use the feature.
    #[tokio::test]
    async fn an_existing_record_for_a_not_pre_installed_app_still_gets_its_bundle() {
        let manifests = crate::plugin_manifest::PluginManifestLoader::load_builtins();
        let store = PluginStore::open_in_memory().unwrap();

        let id = NOT_PRE_INSTALLED[0];
        // A pre-upgrade record with no bundle (`store.insert` writes none).
        store.insert(id, "1.0.0").await.unwrap();
        store
            .set_enabled(id, &["spaces:docs".to_owned()])
            .await
            .unwrap();

        seed_default_on(&store, &manifests).await;

        assert!(
            store.has_ui_code(id).await.unwrap(),
            "'{id}' has an existing record, so the companion-ui back-fill must still fill its \
             missing bundle"
        );
        assert!(
            store.get(id).await.unwrap().unwrap().enabled,
            "the back-fill must never touch the enabled bit"
        );
    }

    /// The carriage list is DERIVED from `seed_overrides`, never a second hardcoded
    /// array — that duplication is what left eleven companions with an unreachable
    /// bundle. A 17th companion row therefore needs no second edit: it is picked up
    /// by the default-on loop (if default-on) or by `seed_companion_ui` (if not), and
    /// this asserts both halves are non-empty so neither branch can rot unnoticed.
    #[test]
    fn the_companion_bundle_carriage_is_derived_from_the_one_table() {
        let with_ui: Vec<&str> = seed_overrides()
            .iter()
            .filter(|s| s.ui_code.is_some())
            .map(|s| s.id)
            .collect();
        assert!(
            !with_ui.is_empty(),
            "seed_overrides must carry compiled-in companion bundles"
        );
        let carried: Vec<&str> = companion_ui_specs().into_iter().map(|s| s.id).collect();
        assert_eq!(
            carried, with_ui,
            "every seed_overrides row with a ui_code must be carried, in table order"
        );
        assert!(
            carried.iter().any(|id| CORE_DEFAULT_ON.contains(id)),
            "some companions are default-on (their bundle rides the enable loop)"
        );
        assert!(
            carried.iter().any(|id| !CORE_DEFAULT_ON.contains(id)),
            "some companions are opt-in (their bundle rides seed_companion_ui)"
        );
    }

    /// The UPGRADE half of the repair. Several of these apps began life as wave-2
    /// route-gate governance shells and only gained a companion runnable in the W7
    /// extraction, so a pre-existing install carries a record written before any
    /// bundle existed — and the seed loop leaves every existing record alone
    /// (`Ok(Some(_)) => continue`), which is right for enable/disable and wrong for
    /// build content. Filling it must not disturb one bit of user state.
    #[tokio::test]
    async fn a_pre_existing_record_without_a_bundle_is_filled_without_touching_user_state() {
        let manifests = crate::plugin_manifest::PluginManifestLoader::load_builtins();
        let store = PluginStore::open_in_memory().unwrap();
        let id = crate::plugins::builtins::QUESTS_PLUGIN_ID;

        // The pre-upgrade state: installed + enabled with its grant, no ui_code.
        store.insert(id, "1.0.0").await.unwrap();
        store
            .set_enabled(id, &["quests:crud".to_owned()])
            .await
            .unwrap();
        assert!(!store.has_ui_code(id).await.unwrap());

        seed_default_on(&store, &manifests).await;

        let ui =
            store.get_ui_code(id).await.unwrap().expect(
                "a record predating the bundle must be back-filled, not left mounting empty",
            );
        assert!(ui.len() > 10_000 && ui.contains('<'));
        let record = store.get(id).await.unwrap().unwrap();
        assert!(record.enabled, "the fill must not disturb enabled state");
        assert_eq!(
            record.approved_grants,
            vec!["quests:crud".to_owned()],
            "the fill must not rewrite approved grants"
        );
        assert_eq!(
            record.version, "1.0.0",
            "the fill must not silently re-version the record"
        );
    }

    /// Only ever FILLS a gap. A record that already carries a bundle keeps it —
    /// otherwise every boot would clobber whatever the update lifecycle installed
    /// (`update_app` is the one other `set_ui_code` writer) with the compiled-in
    /// build, which is a downgrade dressed up as a repair.
    #[tokio::test]
    async fn an_existing_companion_bundle_is_never_overwritten() {
        let manifests = crate::plugin_manifest::PluginManifestLoader::load_builtins();
        let store = PluginStore::open_in_memory().unwrap();
        let id = crate::plugins::builtins::QUESTS_PLUGIN_ID;
        const SENTINEL: &str = "<!-- installed by the update lifecycle -->";

        store.insert(id, "1.0.0").await.unwrap();
        store.set_ui_code(id, Some(SENTINEL)).await.unwrap();

        seed_default_on(&store, &manifests).await;

        assert_eq!(
            store.get_ui_code(id).await.unwrap().as_deref(),
            Some(SENTINEL),
            "a stored bundle must never be overwritten by the compiled-in one"
        );
    }
}
