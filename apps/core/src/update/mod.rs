//! Unified update service — the single source of truth for "what version is
//! installed, what is the latest, and is an update available" across every Ryu
//! surface (desktop, cli, gateway, extension, island, mobile).
//!
//! Placement note (Core vs Gateway, per CLAUDE.md §1): deciding *what runs* —
//! including which build of the binaries runs — is a Core responsibility. The
//! Gateway governs what is *allowed/measured/paid*, not the install lifecycle.
//! So the version/update verdict lives here, and every client reads Core's
//! verdict instead of each re-implementing GitHub-release polling.
//!
//! Versioning model: **single release train**. One Ryu release tag bundles all
//! binaries, so `core`, `gateway`, `cli`, and `desktop` ship the same version.
//! `current_version()` is Core's own `CARGO_PKG_VERSION`, which is the canonical
//! Ryu version because the whole workspace is released together. `/api/version`
//! reports the release plus the per-component build list; `/api/update/check`
//! compares that tag against the latest GitHub release.
//!
//! The install *mechanism* is necessarily each platform's native updater
//! (tauri-plugin-updater, electron-updater, expo-updates) — Core owns the
//! *verdict, the toggle, and the binary self-update* for the headless surfaces
//! (core/gateway/cli) that have no native updater of their own.

use serde::{Deserialize, Serialize};

pub mod apply;

/// The canonical Ryu GitHub repository releases are published to.
pub const RYU_REPO: &str = "amajorai/ryu";

/// Preference key (in the cross-surface KV store) holding the auto-update
/// toggle. Every client reads/writes this so the setting is shared across
/// desktop, island, cli, etc. Value is the JSON blob `{ "enabled": bool }`.
pub const AUTO_UPDATE_PREF_KEY: &str = "auto-updates";

/// One built component in the release train.
#[derive(Clone, Serialize)]
pub struct ComponentVersion {
    pub name: String,
    pub version: String,
}

/// Response for `GET /api/version`.
#[derive(Clone, Serialize)]
pub struct VersionInfo {
    /// The canonical Ryu release version (single release train).
    pub ryu_version: String,
    /// Per-component builds. In the single release train these match
    /// `ryu_version`, but the field is kept explicit so a future per-component
    /// model is a data change, not an API change.
    pub components: Vec<ComponentVersion>,
    /// `os-arch` of the running Core (e.g. `windows-x86_64`). Clients use this
    /// to pick the right release asset.
    pub platform: String,
}

/// A downloadable release asset matched to the running platform.
#[derive(Clone, Serialize, Deserialize)]
pub struct ReleaseAsset {
    pub name: String,
    pub url: String,
    /// Best-effort installer kind inferred from the file extension
    /// (`msi`/`exe`/`dmg`/`appimage`/`deb`/`archive`/`unknown`).
    pub kind: String,
    pub size: u64,
}

/// Response for `GET /api/update/check`.
#[derive(Clone, Serialize)]
pub struct UpdateCheck {
    /// Currently installed Ryu version.
    pub current: String,
    /// Latest published release tag (normalised, leading `v` stripped).
    pub latest: String,
    /// The release channel this verdict was computed on (`stable` / `beta` /
    /// `nightly` / `canary`). Defaults to the channel the running build is on,
    /// derived from its own version. Comparisons are scoped WITHIN this channel.
    pub channel: String,
    /// `true` when `latest` is strictly newer than `current` by semver.
    pub update_available: bool,
    /// Release notes (the GitHub release body), if any.
    pub notes: Option<String>,
    /// Link to the human-readable release page.
    pub html_url: Option<String>,
    /// The asset matching the running platform, when one could be resolved.
    pub asset: Option<ReleaseAsset>,
}

/// The current Ryu version (single release train = Core's own crate version).
pub fn current_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// `os-arch` string for the running Core.
pub fn platform_tag() -> String {
    format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)
}

/// Build the `/api/version` payload. The component list is the single release
/// train: every binary ships at `current_version()`.
pub fn version_info() -> VersionInfo {
    let v = current_version();
    let components = ["core", "gateway", "cli", "desktop"]
        .iter()
        .map(|name| ComponentVersion {
            name: (*name).to_string(),
            version: v.clone(),
        })
        .collect();
    VersionInfo {
        ryu_version: v,
        components,
        platform: platform_tag(),
    }
}

/// Normalise a release tag to a bare semver string (`v1.2.3` → `1.2.3`).
fn normalise_tag(tag: &str) -> &str {
    tag.trim().trim_start_matches(['v', 'V'])
}

/// Parse a version with FULL semver 2.0 precedence, including the prerelease
/// suffix. `None` for anything unparseable.
///
/// WHY THE PRERELEASE MUST BE KEPT: this function used to return only the
/// `(major, minor, patch)` triple, discarding `-beta.1` / `-nightly.20260728.932`
/// entirely. That silently disabled the entire rolling-channel train in two ways:
///
///   * two nightlies (`0.0.13-nightly.20260728.932` and `…20260729.940`) both
///     parsed to `(0,0,13)`, compared EQUAL, so the updater could never move a
///     user from one nightly to the next; and
///   * a nightly compared EQUAL to its own stable `0.0.13`, so a prerelease user
///     was never offered the finished release.
///
/// `semver::Version` implements §11 precedence (numeric identifiers compare
/// numerically, numeric ranks below alphanumeric, a shorter identifier list ranks
/// lower, and any prerelease ranks below its stable). Build metadata is ignored
/// for ordering per §10, which is why the release version carries the commit in
/// its title rather than as `+sha`.
///
/// Leniency: a two-component version (`1.2`) is padded to `1.2.0` so this stays
/// compatible with the looser parser it replaces.
fn parse_version(version: &str) -> Option<semver::Version> {
    let raw = normalise_tag(version);
    if let Ok(v) = semver::Version::parse(raw) {
        return Some(v);
    }
    // Lenient pad: `1` → `1.0.0`, `1.2` → `1.2.0`. Only the numeric core is
    // padded; anything with a suffix that strict parsing rejected stays rejected.
    let core_len = raw.split(['-', '+']).next().unwrap_or(raw).split('.').count();
    if (1..3).contains(&core_len) {
        let padded = match core_len {
            1 => format!("{raw}.0.0"),
            _ => format!("{raw}.0"),
        };
        return semver::Version::parse(&padded).ok();
    }
    None
}

/// The release channel a version belongs to: its first prerelease identifier, or
/// `"stable"` when it has none.
///
/// This makes a build SELF-DESCRIBING — a Core running `0.0.13-nightly.20260728.932`
/// knows it is on the nightly channel without any stored preference. That is what
/// lets `/api/update/check` return the right verdict by default; the desktop's
/// user-chosen channel is an explicit override on top (`?channel=`).
pub fn channel_of(version: &str) -> String {
    match parse_version(version) {
        Some(v) if !v.pre.is_empty() => v
            .pre
            .as_str()
            .split('.')
            .next()
            .unwrap_or(STABLE_CHANNEL)
            .to_string(),
        _ => STABLE_CHANNEL.to_string(),
    }
}

/// The channel name for a build with no prerelease suffix.
pub const STABLE_CHANNEL: &str = "stable";

/// `true` when `latest` is strictly newer than `current` by semver precedence.
///
/// Fail-safe preserved from the original: an unparseable `latest` NEVER claims to
/// be newer, so a malformed or hand-edited tag cannot trigger an update. The
/// converse is allowed — a real release IS newer than an unparseable installed
/// version, so a corrupt install can still recover onto a good build.
pub fn is_newer(current: &str, latest: &str) -> bool {
    // Build metadata MUST NOT affect precedence (semver §10), but the `semver`
    // crate's `Ord` compares it anyway — so two builds differing only by a `+sha`
    // would falsely read as an update. Clear it before comparing. (Parsing keeps
    // it, so the version can still be DISPLAYED in full.)
    let strip_build = |mut v: semver::Version| {
        v.build = semver::BuildMetadata::EMPTY;
        v
    };
    match (
        parse_version(current).map(strip_build),
        parse_version(latest).map(strip_build),
    ) {
        (Some(current), Some(latest)) => latest > current,
        // Malformed `latest` never wins.
        (_, None) => false,
        // Malformed `current` — any real release is an upgrade.
        (None, Some(_)) => true,
    }
}

/// Infer an installer kind from an asset filename.
fn asset_kind(name: &str) -> &'static str {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".msi") {
        "msi"
    } else if lower.ends_with(".exe") {
        "exe"
    } else if lower.ends_with(".dmg") {
        "dmg"
    } else if lower.ends_with(".appimage") {
        "appimage"
    } else if lower.ends_with(".deb") {
        "deb"
    } else if lower.ends_with(".tar.gz") || lower.ends_with(".zip") {
        "archive"
    } else {
        "unknown"
    }
}

/// Score how well an asset name matches the running platform. Higher is better;
/// `None` means the asset is for a different OS and should be skipped.
fn platform_match_score(name: &str) -> Option<u32> {
    let lower = name.to_ascii_lowercase();
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;

    // OS gate: the asset must be plausibly for this OS.
    let os_ok = match os {
        "windows" => {
            lower.contains("windows")
                || lower.contains("win")
                || lower.ends_with(".msi")
                || lower.ends_with(".exe")
        }
        "macos" => {
            lower.contains("darwin")
                || lower.contains("macos")
                || lower.contains("mac")
                || lower.ends_with(".dmg")
        }
        "linux" => {
            lower.contains("linux") || lower.ends_with(".appimage") || lower.ends_with(".deb")
        }
        _ => false,
    };
    if !os_ok {
        return None;
    }

    let mut score = 1;
    // Arch bonus — prefer an exact arch match, also accept common aliases.
    let arch_aliases: &[&str] = match arch {
        "x86_64" => &["x86_64", "amd64", "x64"],
        "aarch64" => &["aarch64", "arm64"],
        _ => &[],
    };
    if arch_aliases.iter().any(|a| lower.contains(a)) {
        score += 2;
    }
    Some(score)
}

/// A single GitHub release asset as returned by the releases API.
#[derive(Clone, Deserialize)]
struct GhAsset {
    name: String,
    browser_download_url: String,
    #[serde(default)]
    size: u64,
}

/// The subset of the GitHub release payload we consume.
#[derive(Clone, Deserialize)]
struct GhRelease {
    tag_name: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    html_url: Option<String>,
    #[serde(default)]
    assets: Vec<GhAsset>,
}

/// The version a release advertises.
///
/// Two shapes exist, because the channels are tagged differently ON PURPOSE:
///
///   * **Versioned tags** (`v0.0.13`, `v0.0.13-beta.1`) — the tag IS the version.
///   * **Rolling tags** (`nightly`, `canary`) — the tag is a fixed pointer that
///     rolls forward each run, so users can always fetch `/releases/tag/nightly`
///     without a year's worth of dead tags accumulating. The real version lives in
///     the release TITLE, which the workflow writes as
///     `Nightly 0.0.13-nightly.20260728.932 (f1a68ac9b05c)`.
///
/// So: try the tag, then scan the title for the first semver-shaped token. Both
/// sources are workflow-controlled. `None` when neither yields a version.
fn release_version(release: &GhRelease) -> Option<String> {
    if let Some(v) = parse_version(&release.tag_name) {
        return Some(v.to_string());
    }
    // STRICT parse for the title scan — deliberately not the lenient `parse_version`.
    // Lenient parsing pads short versions (`2` -> `2.0.0`), so a human-edited title
    // like "Nightly build 2 — 0.0.13-nightly.20260728.932" would match the bare `2`
    // first and report the version as `2.0.0`. Requiring a full major.minor.patch
    // means only a real version token can win.
    release.name.as_deref()?.split_whitespace().find_map(|token| {
        semver::Version::parse(normalise_tag(token.trim_matches(['(', ')', ',', ';'])))
            .ok()
            .map(|v| v.to_string())
    })
}

/// An optional GitHub token used only to raise the release-API rate limit.
///
/// Read from the usual env names so a CI runner or a self-hosted node picks one
/// up without extra configuration. Never required: the update check works
/// unauthenticated, it just shares the 60/hr per-IP budget with everything else
/// on that address.
fn github_token() -> Option<String> {
    ["RYU_GITHUB_TOKEN", "GITHUB_TOKEN", "GH_TOKEN"]
        .iter()
        .find_map(|key| {
            std::env::var(key)
                .ok()
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
        })
}

/// How long a fetched release stays fresh.
///
/// Without this every `/api/update/check` was a live GitHub call, so N surfaces
/// × M launches burned the unauthenticated budget and then failed open to "no
/// update" for the rest of the hour. Releases change on the order of days;
/// minutes of staleness costs nothing.
const RELEASE_CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(15 * 60);

/// Per-channel cache of the last successfully fetched release.
static RELEASE_CACHE: std::sync::OnceLock<
    std::sync::Mutex<std::collections::HashMap<String, (std::time::Instant, GhRelease)>>,
> = std::sync::OnceLock::new();

fn cached_release(channel: &str, allow_stale: bool) -> Option<GhRelease> {
    let cache = RELEASE_CACHE.get()?;
    let guard = cache
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let (fetched_at, release) = guard.get(channel)?;
    (allow_stale || fetched_at.elapsed() < RELEASE_CACHE_TTL).then(|| release.clone())
}

fn cache_release(channel: &str, release: &GhRelease) {
    let cache = RELEASE_CACHE.get_or_init(Default::default);
    let mut guard = cache
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    guard.insert(
        channel.to_string(),
        (std::time::Instant::now(), release.clone()),
    );
}

/// Fetch the release that represents the newest build on `channel`.
///
/// Stable uses `/releases/latest`, which GitHub defines to EXCLUDE prereleases —
/// exactly the semantics stable wants, and the reason a stable node can never
/// auto-update onto a nightly.
///
/// Every other channel MUST NOT use that endpoint, for the same reason: a nightly
/// or beta release is a prerelease and is therefore invisible there. This was the
/// second half of why the channel picker was inert. Instead, list releases and pick
/// the highest-precedence one whose version belongs to `channel`.
async fn fetch_channel_release(
    client: &reqwest::Client,
    channel: &str,
) -> anyhow::Result<GhRelease> {
    if let Some(release) = cached_release(channel, false) {
        return Ok(release);
    }
    match fetch_channel_release_remote(client, channel).await {
        Ok(release) => {
            cache_release(channel, &release);
            Ok(release)
        }
        // A release we saw earlier beats failing open to "no update" for the
        // rest of the hour — GitHub's unauthenticated budget is 60/hr per IP,
        // and every surface checks on launch.
        Err(err) => cached_release(channel, true).ok_or(err),
    }
}

async fn fetch_channel_release_remote(
    client: &reqwest::Client,
    channel: &str,
) -> anyhow::Result<GhRelease> {
    let get = |url: String| {
        let mut req = client
            .get(url)
            .header("User-Agent", "ryu-core/1.0")
            .header("Accept", "application/vnd.github+json");
        // GitHub allows 60 unauthenticated calls per hour PER IP. Every surface
        // checks on launch, so a shared IP (or a dev machine running the stack a
        // few times) exhausts that and every check fails open to "no update" —
        // the app-update row then silently never appears. A token, when the host
        // has one, raises the ceiling to 5000/hr. Optional by design: no token
        // still works, it is just rate-limited.
        if let Some(token) = github_token() {
            req = req.bearer_auth(token);
        }
        req.send()
    };

    if channel == STABLE_CHANNEL {
        let url = format!("https://api.github.com/repos/{RYU_REPO}/releases/latest");
        return Ok(get(url).await?.error_for_status()?.json().await?);
    }

    // One page is ample: rolling channels keep a single release, and betas are
    // few. Sorted newest-first by GitHub, but we order by semver precedence
    // ourselves rather than trusting publish order.
    let url = format!("https://api.github.com/repos/{RYU_REPO}/releases?per_page=100");
    let releases: Vec<GhRelease> = get(url).await?.error_for_status()?.json().await?;

    releases
        .into_iter()
        .filter_map(|release| {
            let version = release_version(&release)?;
            (channel_of(&version) == channel).then_some((parse_version(&version)?, release))
        })
        .max_by(|(a, _), (b, _)| a.cmp(b))
        .map(|(_, release)| release)
        .ok_or_else(|| anyhow::anyhow!("no release found on the '{channel}' channel"))
}

/// Query the latest release on the channel this build belongs to and produce an
/// [`UpdateCheck`] verdict.
///
/// Fails open at the call site: callers treat a network/API error as "no update
/// known" rather than blocking launch.
pub async fn check_for_update(client: &reqwest::Client) -> anyhow::Result<UpdateCheck> {
    check_for_update_on_channel(client, None).await
}

/// As [`check_for_update`], for an explicit channel.
///
/// `None` means "the channel this build is already on", derived from the running
/// version itself ([`channel_of`]) — a nightly build checks the nightly channel
/// without any stored preference. The desktop passes its user-chosen channel
/// explicitly so the picker can move a user between channels.
///
/// NOTE ON CROSS-CHANNEL COMPARISON: verdicts are scoped WITHIN a channel by
/// design. Semver orders prerelease identifiers alphabetically, which would rank
/// `beta < canary < nightly` — not a risk ordering, and meaningless as an update
/// path. Moving between channels is a channel switch, not an update.
pub async fn check_for_update_on_channel(
    client: &reqwest::Client,
    channel: Option<&str>,
) -> anyhow::Result<UpdateCheck> {
    let current = current_version();
    let channel = channel
        .map(str::to_string)
        .unwrap_or_else(|| channel_of(&current));

    // Verification / dev hook: force a "latest" version without a published
    // release. Lets the desktop/cli update flow be exercised end-to-end before
    // the release CI has produced real assets. Never set in production.
    if let Ok(fake) = std::env::var("RYU_UPDATE_FAKE_LATEST") {
        let latest = normalise_tag(&fake).to_string();
        return Ok(UpdateCheck {
            update_available: is_newer(&current, &latest),
            current,
            latest: latest.clone(),
            channel,
            notes: Some(format!(
                "Simulated release {latest} (RYU_UPDATE_FAKE_LATEST)."
            )),
            html_url: Some(format!("https://github.com/{RYU_REPO}/releases")),
            asset: None,
        });
    }
    let release = fetch_channel_release(client, &channel).await?;

    let latest = release_version(&release)
        .unwrap_or_else(|| normalise_tag(&release.tag_name).to_string());
    let update_available = is_newer(&current, &latest);

    // Pick the best-matching asset for this platform.
    let asset = release
        .assets
        .into_iter()
        .filter_map(|a| platform_match_score(&a.name).map(|score| (score, a)))
        .max_by_key(|(score, _)| *score)
        .map(|(_, a)| ReleaseAsset {
            kind: asset_kind(&a.name).to_string(),
            name: a.name,
            url: a.browser_download_url,
            size: a.size,
        });

    Ok(UpdateCheck {
        current,
        latest,
        channel,
        update_available,
        notes: release.body,
        html_url: release.html_url,
        asset,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalises_tags() {
        assert_eq!(normalise_tag("v1.2.3"), "1.2.3");
        assert_eq!(normalise_tag("V0.1.0"), "0.1.0");
        assert_eq!(normalise_tag(" 2.0.0 "), "2.0.0");
    }

    #[test]
    fn parses_semver_with_suffixes() {
        let v = parse_version("1.2.3").expect("plain semver parses");
        assert_eq!((v.major, v.minor, v.patch), (1, 2, 3));
        assert!(v.pre.is_empty());

        // The prerelease is now RETAINED (it used to be discarded).
        let pre = parse_version("1.2.3-beta.1").expect("prerelease parses");
        assert_eq!(pre.pre.as_str(), "beta.1");

        // Build metadata parses and is kept out of ordering.
        assert!(parse_version("1.2.3+build5").is_some());

        // Lenient padding for short versions, strict rejection of junk.
        let short = parse_version("1.2").expect("two-component version pads");
        assert_eq!((short.major, short.minor, short.patch), (1, 2, 0));
        assert!(parse_version("garbage").is_none());
    }

    #[test]
    fn channel_of_reads_the_first_prerelease_identifier() {
        // A build is self-describing: its own version names its channel.
        assert_eq!(channel_of("0.0.13"), "stable");
        assert_eq!(channel_of("v0.0.13"), "stable");
        assert_eq!(channel_of("0.0.13-beta.1"), "beta");
        assert_eq!(channel_of("0.0.13-nightly.20260728.932"), "nightly");
        assert_eq!(channel_of("0.0.13-canary.20260728.932"), "canary");
        // Unparseable falls back to stable rather than inventing a channel.
        assert_eq!(channel_of("garbage"), "stable");
    }

    #[test]
    fn detects_newer_versions() {
        assert!(is_newer("0.1.0", "0.2.0"));
        assert!(is_newer("0.1.0", "v0.1.1"));
        assert!(is_newer("1.0.0", "2.0.0"));
        assert!(!is_newer("0.2.0", "0.1.0"));
        assert!(!is_newer("1.0.0", "1.0.0"));
        // Malformed latest never claims to be newer.
        assert!(!is_newer("0.1.0", "garbage"));
        // ...but a real release still rescues a corrupt installed version.
        assert!(is_newer("garbage", "0.1.0"));
    }

    // ── Prerelease precedence ────────────────────────────────────────────────
    //
    // These mirror `scripts/release/next-version.test.mjs`. The generator and this
    // comparator MUST agree: the script decides what version a build carries, this
    // decides whether that build is an update. A divergence ships a wrong verdict.

    #[test]
    fn prerelease_ranks_below_its_own_stable() {
        // The bug this replaced: the suffix was discarded, so these compared EQUAL
        // and a nightly user was never offered the finished 0.0.13.
        assert!(is_newer("0.0.13-nightly.20260728.932", "0.0.13"));
        assert!(is_newer("0.0.13-beta.1", "0.0.13"));
        assert!(!is_newer("0.0.13", "0.0.13-nightly.20260728.932"));
    }

    #[test]
    fn nightlies_order_by_date_then_build_number() {
        // The other half of the bug: every nightly parsed identically, so the
        // channel could never advance.
        assert!(is_newer(
            "0.0.13-nightly.20260728.932",
            "0.0.13-nightly.20260729.940"
        ));
        assert!(!is_newer(
            "0.0.13-nightly.20260729.940",
            "0.0.13-nightly.20260728.932"
        ));
        // Same day, later run number.
        assert!(is_newer(
            "0.0.13-nightly.20260728.932",
            "0.0.13-nightly.20260728.933"
        ));
    }

    #[test]
    fn numeric_identifiers_compare_numerically_not_lexically() {
        // Lexically "10" < "9"; numerically 10 > 9. Getting this wrong stalls the
        // beta channel at beta.9.
        assert!(is_newer("0.0.13-beta.9", "0.0.13-beta.10"));
        assert!(is_newer(
            "0.0.13-nightly.20260728.99",
            "0.0.13-nightly.20260728.100"
        ));
    }

    #[test]
    fn canonical_semver_precedence_chain_holds() {
        let ascending = [
            "1.0.0-alpha",
            "1.0.0-alpha.1",
            "1.0.0-alpha.beta",
            "1.0.0-beta",
            "1.0.0-beta.2",
            "1.0.0-beta.11",
            "1.0.0-rc.1",
            "1.0.0",
        ];
        for pair in ascending.windows(2) {
            assert!(
                is_newer(pair[0], pair[1]),
                "{} should precede {}",
                pair[0],
                pair[1]
            );
        }
    }

    #[test]
    fn build_metadata_is_ignored_for_precedence() {
        assert!(!is_newer("1.0.0+aaa", "1.0.0+zzz"));
        assert!(!is_newer("1.0.0+zzz", "1.0.0+aaa"));
    }

    #[test]
    fn core_triple_dominates_the_prerelease() {
        assert!(is_newer("0.0.12", "0.0.13-nightly.20260728.1"));
        assert!(!is_newer("0.2.0-beta.1", "0.1.0"));
    }

    #[test]
    fn release_version_prefers_the_tag_then_the_title() {
        // Versioned tag: the tag IS the version.
        let tagged = GhRelease {
            tag_name: "v0.0.13-beta.1".to_string(),
            name: Some("Ryu v0.0.13-beta.1".to_string()),
            body: None,
            html_url: None,
            assets: vec![],
        };
        assert_eq!(release_version(&tagged).as_deref(), Some("0.0.13-beta.1"));

        // Rolling tag: the tag is a pointer, so the version comes from the title
        // the workflow writes. The trailing `(sha)` must not be mistaken for it.
        let rolling = GhRelease {
            tag_name: "nightly".to_string(),
            name: Some("Nightly 0.0.13-nightly.20260728.932 (f1a68ac9b05c)".to_string()),
            body: None,
            html_url: None,
            assets: vec![],
        };
        assert_eq!(
            release_version(&rolling).as_deref(),
            Some("0.0.13-nightly.20260728.932")
        );

        // Neither source carries a version.
        let bare = GhRelease {
            tag_name: "nightly".to_string(),
            name: Some("Nightly build".to_string()),
            body: None,
            html_url: None,
            assets: vec![],
        };
        assert_eq!(release_version(&bare), None);

        // A bare number earlier in a human-edited title must NOT be mistaken for the
        // version. The lenient parser pads `2` to `2.0.0`; the title scan is strict
        // precisely so that cannot happen.
        let edited = GhRelease {
            tag_name: "nightly".to_string(),
            name: Some("Nightly build 2 — 0.0.13-nightly.20260728.932".to_string()),
            body: None,
            html_url: None,
            assets: vec![],
        };
        assert_eq!(
            release_version(&edited).as_deref(),
            Some("0.0.13-nightly.20260728.932")
        );
    }

    #[test]
    fn infers_asset_kind() {
        assert_eq!(asset_kind("Ryu_0.2.0_x64.msi"), "msi");
        assert_eq!(asset_kind("ryu-cli-windows.exe"), "exe");
        assert_eq!(asset_kind("Ryu_0.2.0_aarch64.dmg"), "dmg");
        assert_eq!(asset_kind("ryu-0.2.0.AppImage"), "appimage");
        assert_eq!(asset_kind("ryu-core-linux-x86_64.tar.gz"), "archive");
    }

    #[test]
    fn version_info_is_single_release_train() {
        let info = version_info();
        assert_eq!(info.components.len(), 4);
        for c in &info.components {
            assert_eq!(c.version, info.ryu_version);
        }
    }

    // ── extra coverage ───────────────────────────────────────────────────────

    /// Serialize the RYU_UPDATE_FAKE_LATEST env mutation across tests here.
    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn asset_kind_covers_deb_zip_and_unknown() {
        assert_eq!(asset_kind("ryu_0.2.0_amd64.deb"), "deb");
        assert_eq!(asset_kind("ryu-core-windows-x86_64.zip"), "archive");
        assert_eq!(asset_kind("checksums.txt"), "unknown");
        // Case-insensitive extension match.
        assert_eq!(asset_kind("Ryu.DMG"), "dmg");
    }

    #[test]
    fn platform_match_score_prefers_this_os_and_arch() {
        let os = std::env::consts::OS;
        let arch = std::env::consts::ARCH;

        // An asset built for a definitely-different OS is rejected (None).
        let foreign = match os {
            "windows" => "ryu-core-linux-x86_64.tar.gz",
            _ => "ryu-core-windows-x86_64.zip",
        };
        assert!(platform_match_score(foreign).is_none());

        // An asset naming THIS os + THIS arch scores above one naming only the OS.
        let arch_token = match arch {
            "x86_64" => "x86_64",
            "aarch64" => "aarch64",
            _ => return, // unusual arch: skip the arch-bonus assertion
        };
        let os_token = match os {
            "windows" => "windows",
            "macos" => "macos",
            "linux" => "linux",
            _ => return,
        };
        let with_arch = format!("ryu-core-{os_token}-{arch_token}.tar.gz");
        let os_only = format!("ryu-core-{os_token}.tar.gz");
        let s_arch = platform_match_score(&with_arch).expect("this-os asset matches");
        let s_os = platform_match_score(&os_only).expect("this-os asset matches");
        assert!(
            s_arch > s_os,
            "arch match ({s_arch}) should outrank os-only ({s_os})"
        );
    }

    #[tokio::test]
    async fn check_for_update_honours_fake_latest_env() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        // A far-future fake version is reported as an available update, no network.
        std::env::set_var("RYU_UPDATE_FAKE_LATEST", "v999.0.0");
        let client = reqwest::Client::new();
        let check = check_for_update(&client).await.unwrap();
        assert_eq!(check.latest, "999.0.0");
        assert!(check.update_available);
        assert!(check.notes.unwrap().contains("999.0.0"));
        std::env::remove_var("RYU_UPDATE_FAKE_LATEST");
    }

    #[tokio::test]
    async fn check_for_update_fake_latest_not_newer_when_equal() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        // Faking the CURRENT version must not claim an update is available.
        std::env::set_var("RYU_UPDATE_FAKE_LATEST", current_version());
        let client = reqwest::Client::new();
        let check = check_for_update(&client).await.unwrap();
        assert!(!check.update_available);
        std::env::remove_var("RYU_UPDATE_FAKE_LATEST");
    }
}
