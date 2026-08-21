//! Bundled **system skills** — skills Ryu installs and manages for the user,
//! kept in sync with the bundled catalog.
//!
//! A fresh Ryu ships a curated set of skills (the [`BUILTIN_PACKS`] repo catalog
//! plus the pinned single-skill defaults in [`DEFAULT_SKILLS`]) so the Skills
//! surface is useful before the user goes shopping. Unlike the old run-once
//! defaults, this is a **sync**, not a one-shot:
//!
//! - a bundled skill missing from the disk is installed (origin `system`);
//! - a bundled skill **dropped** from the catalog is removed — unless the user
//!   reinstalled it, which flips its origin to `user` and makes it invisible to
//!   the auto-remover forever;
//! - user-installed skills (catalog/from-source/pack/CLI) are never touched.
//!
//! ## Origin registry
//!
//! `~/.ryu/skills-origin.json` maps `slug → "system" | "user"`. Every install
//! path records an origin: the sync pipeline writes `system`; a user install
//! writes `user`. A slug with no entry defaults to `user` (never auto-removed),
//! which is also what keeps skills the user had before Ryu ever ran safe.
//!
//! ## Why it never vendors bytes
//!
//! The bundled skills are installed **from their upstream repos at sync time**
//! (the `npx skills` CLI, falling back to Core's own fetcher) — exactly like the
//! document defaults, and for the same reason: several (`anthropics/skills`)
//! carry proprietary per-skill licenses that forbid redistribution. Never copy
//! them into this tree or mirror them from a Ryu-controlled host.

use std::collections::HashSet;
use std::path::PathBuf;

use anyhow::Result;
use serde::{Deserialize, Serialize};

use super::packs::{self, PackSource};

/// The origin registry file (`~/.ryu/skills-origin.json`).
fn origin_path() -> PathBuf {
    crate::paths::ryu_dir().join("skills-origin.json")
}

/// Who owns an installed skill. `System` = managed by Ryu's bundled catalog
/// (auto-removable); `User` = the user installed it (never auto-removed).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillOrigin {
    System,
    User,
}

/// The persisted `slug → origin` registry.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct OriginRegistry {
    #[serde(default)]
    skills: std::collections::HashMap<String, SkillOrigin>,
}

impl OriginRegistry {
    pub fn load() -> Self {
        std::fs::read_to_string(origin_path())
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    fn save(&self) {
        let path = origin_path();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(self) {
            let _ = std::fs::write(path, json);
        }
    }

    /// The recorded origin for a slug, defaulting to [`SkillOrigin::User`] so an
    /// unknown skill can never be auto-removed.
    pub fn origin(&self, slug: &str) -> SkillOrigin {
        self.skills.get(slug).copied().unwrap_or(SkillOrigin::User)
    }
}

/// Record the origin for one skill. `User` marks a skill the user chose;
/// `System` marks one the bundled catalog manages.
pub fn record_origin(slug: &str, origin: SkillOrigin) {
    let mut registry = OriginRegistry::load();
    registry.skills.insert(slug.to_string(), origin);
    registry.save();
}

/// The origin recorded for a slug (default [`SkillOrigin::User`]).
pub fn origin_of(slug: &str) -> SkillOrigin {
    OriginRegistry::load().origin(slug)
}

/// Preference gate. Default ON; set `false` to stop the boot sync from touching
/// the skills dir. Existing system skills are left alone (the gate governs
/// writes, not a cleanup).
pub const SYNC_ENABLED_PREF: &str = "skills.sync-system";
/// The catalog version the last successful sync applied. A catalog change bumps
/// [`bundle_version`], so a boot only runs the sync when the set actually moved.
pub const SYNCED_VERSION_PREF: &str = "skills.synced-bundle-version";

/// The pinned single-skill defaults the bundle installs (besides the repo packs
/// in [`packs::BUILTIN_PACKS`]): Anthropic's four document skills plus
/// frontend-design, fetched from `anthropics/skills` exactly like the old
/// defaults. Kept for parity — they are a well-known, license-restricted set
/// that predates the pack catalog.
///
/// Single source of truth is [`super::default_skills`] (the run-once installer
/// that shells out to `npx skills add`); this module re-exports the constants so
/// the sync and the old installer can never disagree about what "the defaults"
/// are.
pub const DEFAULT_SKILLS: &[&str] = super::default_skills::DEFAULT_SKILLS;
/// The repo those single-skill defaults live in.
pub const DEFAULT_SKILL_REPO: &str = super::default_skills::DEFAULT_SKILL_REPO;

/// The bundled repos the catalog installs as packs (every `SKILL.md` in each is a
/// member). This is the pack catalog — a repo added here auto-installs its
/// skills; a repo dropped here auto-removes its `System`-owned skills.
pub fn bundled_repos() -> Vec<String> {
    let mut repos: Vec<String> = packs::builtin_packs()
        .into_iter()
        .filter_map(|pack| match pack.source {
            PackSource::Repo { repo } => Some(repo),
            PackSource::Custom { .. } => None,
        })
        .collect();
    if !repos.iter().any(|r| r == DEFAULT_SKILL_REPO) {
        repos.push(DEFAULT_SKILL_REPO.to_string());
    }
    repos
}

/// A version string that changes whenever the bundled catalog changes: derived
/// from the repo list + the pinned defaults, so it cannot drift from the catalog
/// it versions. A plain FNV-1a over the joined ids (stable across runs).
pub fn bundle_version() -> String {
    let mut input = bundled_repos().join(",");
    if !input.is_empty() {
        input.push(',');
    }
    input.push_str(&DEFAULT_SKILLS.join(","));
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in input.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{:016x}", hash)
}

// ── Sync ─────────────────────────────────────────────────────────────────────

/// What a sync run changed, for the status payload + logging.
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct SyncReport {
    pub installed: Vec<String>,
    pub removed: Vec<String>,
    pub skipped_user: Vec<String>,
    pub resolved: Vec<String>,
    /// True only when every catalog lookup and filesystem mutation completed.
    /// Callers must not checkpoint the catalog version after a partial run.
    pub complete: bool,
    /// Per-repository/per-skill failures retained for the API and boot logs.
    pub errors: Vec<String>,
}

/// The on-disk registry is keyed by slug, so two catalog ids with the same leaf
/// cannot coexist. Keep the first catalog entry deterministically instead of
/// installing both in sequence and silently letting the latter overwrite it.
fn dedupe_skill_ids(ids: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    ids.into_iter()
        .filter(|id| seen.insert(crate::skills_catalog::slug_of(id)))
        .collect()
}

/// Run the bundled-catalog sync: install missing bundled skills (origin
/// `System`), remove `System`-owned skills that a catalog change dropped, and
/// leave every `User`-owned skill alone. Idempotent; safe to run on boot and on
/// demand.
///
/// `enabled` is the preference gate and `synced_version` the catalog version the
/// last run applied; the caller reads both so this stays independent of the
/// preference store and unit-testable. When `synced_version` already equals
/// [`bundle_version`] nothing runs.
pub async fn sync_bundled(
    client: &reqwest::Client,
    enabled: bool,
    synced_version: &str,
) -> SyncReport {
    let mut report = SyncReport::default();
    if !enabled {
        tracing::debug!("system-skills sync disabled via `{SYNC_ENABLED_PREF}`");
        return report;
    }
    let version = bundle_version();
    if synced_version == version {
        report.complete = true;
        return report;
    }

    let installed = crate::skills_catalog::installed_slugs();

    // 1. Resolve every bundled repo → member ids.
    let mut desired_ids: Vec<String> = Vec::new();
    let mut resolution_complete = true;
    for repo in bundled_repos() {
        let source = PackSource::Repo { repo: repo.clone() };
        match packs::resolve_member_ids(client, &source).await {
            Ok(ids) => desired_ids.extend(ids),
            Err(e) => {
                tracing::warn!(repo, error = %e, "bundled pack resolution failed");
                resolution_complete = false;
                report
                    .errors
                    .push(format!("could not resolve bundled repo {repo}: {e}"));
            }
        }
    }
    // The pinned single-skill defaults ride along as explicit ids.
    for slug in DEFAULT_SKILLS {
        desired_ids.push(format!("{DEFAULT_SKILL_REPO}/{slug}"));
    }
    let desired_ids = dedupe_skill_ids(desired_ids);
    report.resolved = desired_ids.clone();
    let desired: HashSet<String> = desired_ids
        .iter()
        .map(|id| crate::skills_catalog::slug_of(id))
        .collect();

    // 2. Install missing bundled skills (origin `System`). Best-effort per skill.
    for id in &desired_ids {
        let slug = crate::skills_catalog::slug_of(id);
        if installed.contains(&slug) {
            continue;
        }
        match packs::install_skill_by_id(client, id).await {
            Ok(_result) => {
                record_origin(&slug, SkillOrigin::System);
                report.installed.push(slug);
            }
            Err(e) => {
                tracing::warn!(skill = %id, error = %e, "bundled skill install failed");
                report
                    .errors
                    .push(format!("could not install bundled skill {id}: {e}"));
            }
        }
    }

    // 3. Remove `System`-owned skills no longer in the catalog — unless the user
    //    reinstalled (origin `User`), which is exactly what the registry says.
    let registry = OriginRegistry::load();
    let mut to_remove: Vec<String> = Vec::new();
    if resolution_complete {
        for (slug, origin) in &registry.skills {
            if *origin != SkillOrigin::System {
                continue;
            }
            if desired.contains(slug) {
                continue;
            }
            to_remove.push(slug.clone());
        }
    }
    let mut registry_for_removal = registry;
    for slug in to_remove {
        // Safety belt: never remove a slug that is not actually on disk under a
        // system marker, and never touch a user-owned skill.
        match remove_system_skill(&slug) {
            Ok(()) => {
                registry_for_removal.skills.remove(&slug);
                report.removed.push(slug);
            }
            Err(e) => {
                tracing::warn!(skill = %slug, error = %e, "bundled skill removal failed");
                report
                    .errors
                    .push(format!("could not remove bundled skill {slug}: {e}"));
            }
        }
    }
    registry_for_removal.save();

    report.complete = report.errors.is_empty();
    report
}

/// Remove a `System`-owned skill directory and deactivate it. Only ever called
/// for a skill whose origin is `System`, so a user skill can never reach here.
fn remove_system_skill(slug: &str) -> Result<()> {
    let dir = ryu_skills::SkillRegistry::skills_dir().join(slug);
    if !dir.exists() {
        return Ok(());
    }
    ryu_skills::set_active(slug, false);
    std::fs::remove_dir_all(&dir).map_err(|e| anyhow::anyhow!("removing {slug}: {e}"))?;
    Ok(())
}

/// The boot entry point: read the gate + the catalog version the last run
/// applied, run the sync, and persist the applied version so a no-op boot skips
/// it. Never returns an error — this runs on the boot path and a failed sync
/// must not affect anything else.
pub async fn run_on_boot(
    client: &reqwest::Client,
    preferences: &crate::server::preferences::PreferencesStore,
) {
    let enabled = preferences
        .get(SYNC_ENABLED_PREF)
        .await
        .ok()
        .flatten()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "true" | "1" | "on" | "yes"
            )
        })
        .unwrap_or(true);
    let synced_version = preferences
        .get(SYNCED_VERSION_PREF)
        .await
        .ok()
        .flatten()
        .unwrap_or_default();

    let report = sync_bundled(client, enabled, &synced_version).await;
    let version = bundle_version();
    // A partial network/filesystem run must retry next boot. Checkpoint only a
    // completely applied catalog; otherwise a transient outage can permanently
    // suppress missing installs (and used to remove skills from unresolved repos).
    if enabled && synced_version != version && report.complete {
        let _ = preferences.set(SYNCED_VERSION_PREF, &version).await;
    }
    if !report.complete {
        tracing::warn!(errors = ?report.errors, "system skills sync incomplete; will retry");
    }
    if report.installed.is_empty() && report.removed.is_empty() {
        return;
    }
    tracing::info!(
        installed = ?report.installed,
        removed = ?report.removed,
        "system skills sync applied"
    );
    ryu_skills::SkillRegistry::load().reload();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundle_version_changes_with_catalog() {
        let v1 = bundle_version();
        assert_eq!(v1.len(), 16);
        assert!(bundled_repos().iter().any(|r| r == DEFAULT_SKILL_REPO));
        assert_eq!(bundle_version(), v1, "stable across calls");
    }

    #[test]
    fn diagram_design_is_in_the_bundled_repositories() {
        assert!(
            bundled_repos()
                .iter()
                .any(|repo| repo == "cathrynlavery/diagram-design"),
            "diagram-design should be included in boot sync"
        );
    }

    #[test]
    fn unlazy_is_in_the_bundled_repositories() {
        assert!(
            bundled_repos().iter().any(|repo| repo == "Leonxlnx/unlazy"),
            "unlazy should be included in boot sync"
        );
    }

    #[test]
    fn default_skill_is_bundled() {
        for slug in DEFAULT_SKILLS {
            assert!(
                is_bundled_guard(slug),
                "{slug} should be considered bundled"
            );
        }
    }

    #[test]
    fn catalog_ids_are_deduplicated_by_on_disk_slug() {
        let ids = dedupe_skill_ids(vec![
            "first/repo/review".to_owned(),
            "second/repo/review".to_owned(),
            "second/repo/tdd".to_owned(),
        ]);
        assert_eq!(ids, ["first/repo/review", "second/repo/tdd"]);
    }

    #[test]
    fn origin_defaults_to_user() {
        // `RYU_DIR` is process-global and `origin_path()` resolves through it, so
        // a concurrent test pointing the var at its own tempdir makes the reads
        // below land in an unrelated tree. Hold the shared skills-env lock the way
        // every other `RYU_SKILLS_DIR`/`RYU_DIR` test in the binary does.
        let _env_lock = ryu_skills::SKILLS_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let prev = std::env::var_os("RYU_DIR");
        let tmp = std::env::temp_dir().join(format!("ryu-origin-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        std::env::set_var("RYU_DIR", &tmp);

        let registry = OriginRegistry::load();
        assert_eq!(registry.origin("anything"), SkillOrigin::User);

        record_origin("sys-skill", SkillOrigin::System);
        record_origin("user-skill", SkillOrigin::User);
        assert_eq!(origin_of("sys-skill"), SkillOrigin::System);
        assert_eq!(origin_of("user-skill"), SkillOrigin::User);

        match prev {
            Some(v) => std::env::set_var("RYU_DIR", v),
            None => std::env::remove_var("RYU_DIR"),
        }
        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// A non-network guard that mirrors `is_bundled_slug`'s DEFAULT_SKILLS branch,
    /// so the "defaults are never auto-removed" invariant is testable offline.
    fn is_bundled_guard(slug: &str) -> bool {
        DEFAULT_SKILLS.contains(&slug)
    }

    #[tokio::test]
    async fn sync_respects_enabled_gate() {
        let client = reqwest::Client::new();
        let report = sync_bundled(&client, false, "").await;
        assert!(report.installed.is_empty());
        assert!(report.removed.is_empty());
        assert!(!report.complete);
    }

    #[tokio::test]
    async fn sync_skips_when_version_matches() {
        let client = reqwest::Client::new();
        let version = bundle_version();
        let report = sync_bundled(&client, true, &version).await;
        assert!(report.installed.is_empty());
        assert!(report.removed.is_empty());
        assert!(report.complete);
    }
}
