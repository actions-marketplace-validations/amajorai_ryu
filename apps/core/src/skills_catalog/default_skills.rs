//! First-run install of the default skill set.
//!
//! A fresh Ryu has an empty skills dir, so the Skills surface starts useless
//! until the user goes shopping. This installs a small, high-utility default set
//! — Anthropic's document skills plus `frontend-design` — once, in the
//! background, on first boot.
//!
//! ## It installs *from Anthropic's repo*, and never ships their bytes
//!
//! `anthropics/skills` has **no root LICENSE** and each skill carries a
//! proprietary `LICENSE.txt` ("© 2025 Anthropic, PBC. All rights reserved")
//! forbidding reproduction, derivative works and redistribution. So Ryu must
//! never vendor these into its own tree or mirror them from a Ryu-controlled
//! host: every byte is fetched from Anthropic's public repo at install time, and
//! the per-skill `LICENSE.txt` is copied in alongside the skill so the terms
//! travel with the files. Do not "optimize" this into a bundled copy, an
//! `include_dir!`, or a Ryu-hosted tarball.
//!
//! ## Two installers, deliberately
//!
//! The primary path shells out to Vercel's `skills` CLI (`npx skills add`),
//! which is the ecosystem-standard installer. But Core is a Rust binary that
//! cannot assume Node exists on the machine, so when `npx` is missing or the CLI
//! fails, this falls back to Core's own [`from_source`] fetcher against the same
//! repo. Both produce the same on-disk result — verified: the CLI copies the
//! full skill directory (`scripts/`, `reference.md`, `LICENSE.txt`), not just
//! `SKILL.md`.
//!
//! ## Three things the CLI invocation must keep
//!
//! - **`-a claude-code`** — without an agent filter the CLI fans out to *every*
//!   agent directory it knows (54 of them on a bare machine: `~/.iflow`,
//!   `~/.trae`, `~/.openclaw`, …). Ryu must only ever write its own skills dir.
//! - **`DO_NOT_TRACK` / `DISABLE_TELEMETRY`** — the CLI posts an install event to
//!   `https://add-skill.vercel.sh/t`. Running it automatically on every Ryu boot
//!   would report our whole install base to a third party without the user ever
//!   choosing that tool. Both vars are honored by the CLI; set both.
//! - **repeated `-s` flags** — `-s a,b` is NOT parsed as a list (the CLI treats it
//!   as one unknown skill name and installs nothing); each skill needs its own
//!   `-s`.
//!
//! ## Run-once semantics
//!
//! Guarded by a preference marker, so a user who deletes a default skill does not
//! get it silently reinstalled on the next boot — that would make the delete
//! button appear broken. Turning the whole behavior off ahead of first boot is
//! `skills.install-defaults = false`.

use std::path::PathBuf;
use std::process::Stdio;

use anyhow::{Context, Result};

/// The repo the default skills come from.
pub const DEFAULT_SKILL_REPO: &str = "anthropics/skills";

/// The default skill set: Anthropic's four document skills plus frontend-design.
pub const DEFAULT_SKILLS: &[&str] = &["pdf", "xlsx", "pptx", "docx", "frontend-design"];

/// Preference gate. Default ON; set to `false` to skip first-run install.
pub const INSTALL_DEFAULTS_PREF: &str = "skills.install-defaults";

/// Run-once marker preference.
pub const DEFAULTS_MARKER_PREF: &str = "skills.defaults-installed";

/// The agent id the CLI uses for `~/.claude/skills` (its id is `claude-code`,
/// NOT `claude` — the CLI rejects `claude` as an invalid agent).
const CLI_AGENT: &str = "claude-code";

/// How long the CLI gets before we give up and fall back.
const CLI_TIMEOUT_SECS: u64 = 180;

/// Which defaults are not already present in the skills dir.
///
/// Reads every scan root (not just the write root) so a skill the user already
/// has via `~/.agents/skills` is not installed a second time.
pub fn missing_defaults() -> Vec<&'static str> {
    let installed = super::installed_slugs();
    DEFAULT_SKILLS
        .iter()
        .filter(|slug| !installed.contains(**slug))
        .copied()
        .collect()
}

/// Locate an `npx` binary.
///
/// `PATH` is not enough: a macOS app launched from Finder inherits a minimal
/// `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`) that contains no Node install, so a
/// bare `Command::new("npx")` fails in the GUI case while working perfectly in a
/// terminal. The common install prefixes are probed explicitly.
fn resolve_npx() -> Option<PathBuf> {
    // 1. Anything already on PATH wins.
    if let Ok(path) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path) {
            let candidate = dir.join("npx");
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    // 2. The prefixes a GUI-launched process does not inherit.
    let mut roots: Vec<PathBuf> = vec![
        PathBuf::from("/opt/homebrew/bin/npx"),
        PathBuf::from("/usr/local/bin/npx"),
        PathBuf::from("/usr/bin/npx"),
    ];
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join(".bun/bin/npx"));
        roots.push(home.join(".volta/bin/npx"));
        roots.push(home.join(".local/bin/npx"));
        // nvm keeps one bin dir per installed Node version.
        let nvm = home.join(".nvm/versions/node");
        if let Ok(entries) = std::fs::read_dir(&nvm) {
            for entry in entries.flatten() {
                roots.push(entry.path().join("bin/npx"));
            }
        }
    }
    roots.into_iter().find(|p| p.is_file())
}

/// Build the CLI arguments for a set of skills.
///
/// Split out so the invariants (agent scoping, one `-s` per skill, `--copy`) are
/// unit-testable without running Node.
fn cli_args(skills: &[&str]) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-y".to_string(),
        "skills@latest".to_string(),
        "add".to_string(),
        DEFAULT_SKILL_REPO.to_string(),
    ];
    for skill in skills {
        // One `-s` per skill: a comma-joined list is read as a single unknown
        // skill name and silently installs nothing.
        args.push("-s".to_string());
        args.push((*skill).to_string());
    }
    args.push("-a".to_string());
    // Never unscoped: an unfiltered install writes into every agent dir on the
    // machine, not just Ryu's.
    args.push(CLI_AGENT.to_string());
    args.push("-g".to_string());
    args.push("-y".to_string());
    // Copy rather than symlink, so removing the CLI's cache cannot empty the
    // user's skills dir.
    args.push("--copy".to_string());
    args
}

/// Install via Vercel's `skills` CLI. Returns `Ok(false)` when `npx` is absent.
async fn install_via_cli(skills: &[&str]) -> Result<bool> {
    let Some(npx) = resolve_npx() else {
        tracing::info!("npx not found; using Core's own skill fetcher for defaults");
        return Ok(false);
    };

    let args = cli_args(skills);
    tracing::info!(npx = %npx.display(), ?skills, "installing default skills via the skills CLI");

    let mut command = tokio::process::Command::new(&npx);
    command
        .args(&args)
        // Opt out of the CLI's install telemetry: Ryu triggers this run, the user
        // did not choose to use the tool, so it must not be reported.
        .env("DO_NOT_TRACK", "1")
        .env("DISABLE_TELEMETRY", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let child = command.spawn().context("spawning the skills CLI")?;
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(CLI_TIMEOUT_SECS),
        child.wait_with_output(),
    )
    .await
    .map_err(|_| anyhow::anyhow!("skills CLI timed out after {CLI_TIMEOUT_SECS}s"))?
    .context("running the skills CLI")?;

    if !output.status.success() {
        anyhow::bail!(
            "skills CLI exited with {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(true)
}

/// Fallback: fetch each skill's subdirectory straight from the repo with Core's
/// own installer. Per-skill so one failure cannot cost the whole set.
async fn install_via_core(client: &reqwest::Client, skills: &[&str]) -> Vec<String> {
    let mut installed = Vec::new();
    for skill in skills {
        let source = format!("https://github.com/{DEFAULT_SKILL_REPO}/tree/HEAD/skills/{skill}");
        match super::from_source::install_from_source(client, &source).await {
            Ok(result) => installed.push(result.slug),
            Err(e) => tracing::warn!(skill = %skill, error = %e, "default skill install failed"),
        }
    }
    installed
}

/// Install any missing default skills. Best-effort: never returns an error to the
/// caller's boot path, and reports which slugs ended up on disk.
///
/// `already_done` is the persisted run-once marker and `enabled` the preference
/// gate; both are read by the caller so this stays independent of the preference
/// store and unit-testable.
pub async fn install_defaults_if_needed(
    client: &reqwest::Client,
    enabled: bool,
    already_done: bool,
) -> Vec<String> {
    if !enabled {
        tracing::debug!("default skills disabled via `{INSTALL_DEFAULTS_PREF}`");
        return Vec::new();
    }
    if already_done {
        // Deliberately not re-checking for missing skills: a user who removed one
        // must not have it reappear on the next boot.
        return Vec::new();
    }
    let missing = missing_defaults();
    if missing.is_empty() {
        return Vec::new();
    }

    match install_via_cli(&missing).await {
        Ok(true) => {
            // Trust nothing: confirm against the disk rather than the exit code,
            // and fall back for whatever the CLI silently skipped.
            let still_missing = missing_defaults();
            if still_missing.is_empty() {
                return missing.iter().map(|s| (*s).to_string()).collect();
            }
            tracing::warn!(
                ?still_missing,
                "skills CLI reported success but some defaults are absent; falling back"
            );
            install_via_core(client, &still_missing).await
        }
        Ok(false) => install_via_core(client, &missing).await,
        Err(e) => {
            tracing::warn!(error = %e, "skills CLI failed; falling back to Core's fetcher");
            install_via_core(client, &missing).await
        }
    }
}

/// Attempt counter, so a machine that can never install (no Node *and* no
/// network) stops retrying instead of shelling out on every single boot.
const ATTEMPTS_PREF: &str = "skills.defaults-attempts";

/// How many boots may attempt the install before giving up for good.
const MAX_ATTEMPTS: u32 = 3;

/// Accepts the same spellings as the rest of Core's boolean preferences.
fn parse_bool(value: &str, default: bool) -> bool {
    match value.trim().to_ascii_lowercase().as_str() {
        "true" | "1" | "on" | "yes" => true,
        "false" | "0" | "off" | "no" => false,
        _ => default,
    }
}

/// The boot entry point: read the gate, install what is missing, persist the
/// run-once marker, and hot-reload the registry so the skills are usable without
/// a restart.
///
/// Never returns an error — this runs on the boot path and a failed default
/// install must not affect anything else.
pub async fn run_on_boot(
    client: &reqwest::Client,
    preferences: &crate::server::preferences::PreferencesStore,
    skills: &ryu_skills::SkillRegistry,
) {
    // Default ON. Set `skills.install-defaults = false` before first boot to skip.
    let enabled = preferences
        .get(INSTALL_DEFAULTS_PREF)
        .await
        .ok()
        .flatten()
        .map(|value| parse_bool(&value, true))
        .unwrap_or(true);
    let already_done = preferences
        .get(DEFAULTS_MARKER_PREF)
        .await
        .ok()
        .flatten()
        .is_some_and(|value| !value.trim().is_empty());
    if !enabled || already_done {
        return;
    }

    let attempts = preferences
        .get(ATTEMPTS_PREF)
        .await
        .ok()
        .flatten()
        .and_then(|value| value.trim().parse::<u32>().ok())
        .unwrap_or(0);
    if attempts >= MAX_ATTEMPTS {
        tracing::debug!("default skills: giving up after {attempts} attempts");
        return;
    }
    let _ = preferences
        .set(ATTEMPTS_PREF, &(attempts + 1).to_string())
        .await;

    let installed = install_defaults_if_needed(client, enabled, already_done).await;
    if !installed.is_empty() {
        tracing::info!(?installed, "installed default skills");
        // Hot-reload so a freshly installed skill is selectable immediately,
        // matching what the catalog install route does.
        skills.reload();
    }

    // Only latch the run-once marker when the set is actually complete. A first
    // boot that was offline should retry (up to MAX_ATTEMPTS) rather than
    // permanently record "defaults installed" for a machine that has none.
    if missing_defaults().is_empty() {
        let _ = preferences.set(DEFAULTS_MARKER_PREF, "1").await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_set_is_the_documented_five() {
        assert_eq!(
            DEFAULT_SKILLS,
            &["pdf", "xlsx", "pptx", "docx", "frontend-design"]
        );
    }

    /// The CLI fans out to every agent directory on the machine unless an agent
    /// is named, and its id is `claude-code` (it rejects `claude`). If this test
    /// fails, a Ryu boot is writing skills into other tools' config dirs.
    #[test]
    fn cli_args_scope_the_install_to_one_agent() {
        let args = cli_args(&["pdf"]);
        let agent_at = args.iter().position(|a| a == "-a").expect("no -a flag");
        assert_eq!(
            args.get(agent_at + 1).map(String::as_str),
            Some("claude-code")
        );
    }

    /// `-s a,b` is parsed as one unknown skill name and installs nothing, so each
    /// skill must get its own flag.
    #[test]
    fn cli_args_repeat_the_skill_flag_never_comma_join() {
        let args = cli_args(&["pdf", "xlsx", "docx"]);
        let flags = args.iter().filter(|a| *a == "-s").count();
        assert_eq!(flags, 3, "expected one -s per skill: {args:?}");
        assert!(
            !args.iter().any(|a| a.contains(',')),
            "skills must never be comma-joined: {args:?}"
        );
        for want in ["pdf", "xlsx", "docx"] {
            assert!(args.iter().any(|a| a == want), "missing `{want}`");
        }
    }

    #[test]
    fn cli_args_target_the_anthropic_repo_and_copy_files() {
        let args = cli_args(&["pdf"]);
        assert!(args.iter().any(|a| a == DEFAULT_SKILL_REPO));
        assert!(args.iter().any(|a| a == "add"));
        // --copy, so clearing the npx cache cannot empty the user's skills dir.
        assert!(args.iter().any(|a| a == "--copy"));
        assert!(args.iter().any(|a| a == "-g"));
    }

    #[tokio::test]
    async fn disabled_preference_installs_nothing() {
        let client = reqwest::Client::new();
        assert!(install_defaults_if_needed(&client, false, false)
            .await
            .is_empty());
    }

    #[tokio::test]
    async fn completed_marker_installs_nothing() {
        let client = reqwest::Client::new();
        assert!(install_defaults_if_needed(&client, true, true)
            .await
            .is_empty());
    }
}
