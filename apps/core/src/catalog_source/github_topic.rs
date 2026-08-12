//! GitHub-topic discovery source (Plugin kind, **descriptor-only**).
//!
//! Anyone can publish a Ryu app or plugin by pushing a public GitHub repo and
//! tagging it with the `ryu-app` / `ryu-plugin` topic. This source turns those
//! two topics into a browsable catalog. It is deliberately the *least trusted*
//! Plugin source in the registry, and its shape encodes that:
//!
//! - **No `raw.manifest` in the install descriptor.** `resolve_plugin_from_catalog`
//!   parses `descriptor.raw["manifest"]` into a `PluginManifest` and skips a source
//!   that can't produce one — so omitting it keeps install-by-id *fail-closed*. If a
//!   future refactor "helpfully" carried the repo's `plugin.json` here, every
//!   topic-squatting repo would become an unsigned install path. The unit test
//!   `install_descriptor_never_carries_a_manifest` is the regression guard.
//! - **Every card is stamped `origin:"community"` + `reviewed:false`.** That is the
//!   one discriminator the store's trust notice keys on; see
//!   `packages/marketplace/src/catalog/apps-catalog-section.tsx` (`isCommunityEntry`).
//! - **Never lift runnable code.** Manifest enrichment in `detail` copies an
//!   allowlist of display fields only — `ui_code` / `backend_code` / `*_sha256`
//!   are dropped, mirroring the trust ladder in `gate_plugin_ui_code`.
//! - **Ids are namespaced `gh:<owner>/<repo>`.** Core's install path probes *every*
//!   registered Plugin source for *every* install-by-id, so a foreign id must be
//!   rejected in O(1), before any network call, or an unrelated install burns the
//!   GitHub Search rate-limit budget.
//!
//! "Nothing hardcoded": the API base, both topic strings, and the cache TTL are all
//! env-overridable. The BYOK personal access token is host-scoped — it is only ever
//! attached to the *default* `api.github.com` base, never to a custom one.

use anyhow::Result;
use serde_json::Value;
use std::sync::OnceLock;

use super::{CatalogKind, CatalogQuery, CatalogSource, InstallDescriptor};

/// Default GitHub REST base. Overridable for a mirror/enterprise host — which
/// **suppresses the token** (see [`GithubTopicSource::resolve_token`]).
const GITHUB_API_BASE: &str = "https://api.github.com";
const GITHUB_API_BASE_ENV: &str = "RYU_GITHUB_API_URL";

/// The two discovery topics. A repo carrying `ryu-app` is classified as an app
/// (it ships a companion UI surface); `ryu-plugin` is everything else.
const GITHUB_TOPIC_APP: &str = "ryu-app";
const GITHUB_TOPIC_PLUGIN: &str = "ryu-plugin";
const GITHUB_TOPIC_APP_ENV: &str = "RYU_GITHUB_TOPIC_APP";
const GITHUB_TOPIC_PLUGIN_ENV: &str = "RYU_GITHUB_TOPIC_PLUGIN";

const GITHUB_TOPIC_TTL_ENV: &str = "RYU_GITHUB_TOPIC_CACHE_TTL_SECS";
/// 6h. One refresh costs 2 Search API calls; the unauthenticated Search budget is
/// 10 req/min (30 authenticated) in a bucket separate from the 60/hr core limit, so
/// this plus stale-serve keeps discovery far inside budget however often the store
/// is opened.
const GITHUB_TOPIC_DEFAULT_TTL_SECS: u64 = 6 * 60 * 60;

/// GitHub's `per_page` ceiling for the Search API.
const GITHUB_TOPIC_PER_PAGE: usize = 100;

/// Preferences key holding the BYOK GitHub personal access token. Mirrors
/// `SMITHERY_API_KEY_PREF`: the route reads the pref and rewrites the source
/// before use, so the token never lives in the persisted registry.
pub const GITHUB_TOKEN_PREF: &str = "github-api-token";

/// Env fallbacks for the token, in order. `RYU_GITHUB_TOKEN` is the documented
/// primary so an ambient CI `GITHUB_TOKEN` is never the surprising default.
const GITHUB_TOKEN_ENVS: [&str; 2] = ["RYU_GITHUB_TOKEN", "GITHUB_TOKEN"];

/// The `origin` discriminator stamped on every card. The store's trust notice and
/// its "Community" section filter both key on this exact string — it must stay in
/// sync with `isCommunityEntry` in `@ryu/marketplace`.
pub const COMMUNITY_ORIGIN: &str = "community";

/// Stable source id, also the `?origin=community` browse dispatch target.
pub const GITHUB_TOPIC_SOURCE_ID: &str = "github-topic";

/// `gh:` id namespace. Guarantees no collision with a real plugin id in
/// `merge_plugin_catalog_entries` and makes foreign-id rejection free.
const GH_ID_PREFIX: &str = "gh:";

/// Manifest paths tried (in order) when enriching a detail view. First hit wins;
/// all missing is NOT an error.
const REPO_MANIFEST_PATHS: [&str; 5] = [
    // `manifest.json` is the canonical name (MANIFEST_FILE_NAMES[0]); the older
    // `plugin.json` / `ryu.json` stay for third-party repos that predate the
    // rename, matching the loader's own back-compat order.
    "manifest.json",
    "plugin.json",
    "ryu.json",
    ".ryu-plugin/manifest.json",
    ".ryu-plugin/plugin.json",
];

/// Display fields lifted from a third-party manifest. Everything outside this
/// allowlist is dropped — in particular `ui_code`, `backend_code`, and any
/// `*_sha256`, which must never travel from an unsigned source.
const MANIFEST_DISPLAY_KEYS: [&str; 4] = ["version", "description", "category", "icon"];

/// How long a repo's manifest probe result stays authoritative before it is
/// re-checked. This is the **negative** cache that makes list-time hydration
/// affordable: most `ryu-plugin` repos carry no manifest at any of the five
/// [`REPO_MANIFEST_PATHS`], and without a remembered miss every 6h refresh would
/// re-pay five raw fetches per manifest-less repo, forever. A repo that later
/// adds a manifest is picked up on the next re-probe.
const MANIFEST_PROBE_TTL_SECS: u64 = 7 * 24 * 60 * 60;

/// In-flight raw fetches while hydrating a refreshed record set.
const MANIFEST_HYDRATE_CONCURRENCY: usize = 8;

/// Wall-clock ceiling on one hydration pass. `search()` awaits `records()`, so an
/// unbounded pass would turn "the store is slow" into a regression of this
/// source's whole degradation story (an unreachable GitHub must cost a note, not
/// the page). Records the deadline cuts short keep `manifest_probed_at: 0` and are
/// retried on the next refresh — never silently marked as "no manifest".
const MANIFEST_HYDRATE_DEADLINE: std::time::Duration = std::time::Duration::from_secs(15);

// Bounds on every manifest-declared string that reaches a card. A community
// manifest is attacker-controlled free text — the same posture
// `truncate_description` already applies to the repo description.
const MAX_NAME_CHARS: usize = 80;
const MAX_TAGLINE_CHARS: usize = 140;
const MAX_CATEGORY_CHARS: usize = 40;
const MAX_VERSION_CHARS: usize = 32;
const MAX_ICON_ID_CHARS: usize = 64;

static GITHUB_TOPIC_CACHE: OnceLock<tokio::sync::Mutex<Option<GithubTopicCache>>> = OnceLock::new();

#[derive(Clone)]
struct GithubTopicCache {
    fetched_at: std::time::Instant,
    records: Vec<GithubTopicRecord>,
    source_url: String,
    /// True when this copy was served past its TTL because the refresh failed
    /// (offline, or a 403/429 rate limit). The note explains it to the user.
    stale: bool,
    note: Option<String>,
}

/// Disk envelope so a cold start while offline or rate-limited is not blank.
/// (`Instant` doesn't survive a restart; this does.)
#[derive(serde::Serialize, serde::Deserialize)]
struct DiskCacheEnvelope {
    fetched_at: u64,
    records: Vec<GithubTopicRecord>,
    source_url: String,
}

/// A normalized topic hit. Deliberately much smaller than GitHub's repo payload so
/// the cache is cheap and stable across upstream schema drift.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) struct GithubTopicRecord {
    /// `gh:<owner>/<repo>`.
    id: String,
    owner: String,
    repo: String,
    full_name: String,
    #[serde(default)]
    description: Option<String>,
    stars: u64,
    html_url: String,
    #[serde(default)]
    avatar_url: Option<String>,
    #[serde(default)]
    topics: Vec<String>,
    #[serde(default)]
    license: Option<String>,
    #[serde(default)]
    pushed_at: Option<String>,
    #[serde(default)]
    homepage: Option<String>,
    #[serde(default)]
    is_fork: bool,
    /// Which topic query produced this row — the ground truth for app-vs-plugin.
    /// The repo's own `topics` array is publisher-controlled and is NOT trusted here.
    is_app: bool,
    /// What the repo's own `manifest.json` declares about how it should be
    /// presented. `None` = probed and absent, or not probed yet — the two are
    /// distinguished by [`manifest_probed_at`](GithubTopicRecord::manifest_probed_at).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    manifest: Option<RepoManifestDisplay>,
    /// Unix seconds of the last manifest probe; `0` = never probed. Persisted in
    /// the disk cache so a restart does not re-pay the whole hydration pass, and so
    /// a manifest-less repo is remembered as such (see [`MANIFEST_PROBE_TTL_SECS`]).
    #[serde(default)]
    manifest_probed_at: u64,
}

/// The presentation a community repo DECLARES for itself, lifted from its own
/// `manifest.json` at list-refresh time.
///
/// Why this exists: a card used to be titled `<repo>` and iconed with the repo
/// OWNER's GitHub avatar, so every listing from one org looked identical and none
/// of them matched the name the plugin actually ships under. A listing's name and
/// icon are declared by its manifest — the rule every other catalog source already
/// follows — and `detail` was ALREADY lifting `icon` from the manifest
/// ([`MANIFEST_DISPLAY_KEYS`]), so the list path was simply not doing what the
/// detail path did.
///
/// Three constraints shape what is in here:
///
/// - **Display only.** No `ui_code`, `backend_code`, `*_sha256`,
///   `permission_grants` or `mcp_servers`. Nothing runnable, and nothing that
///   reads as a permission claim, travels from an unsigned source; the install
///   descriptor stays manifest-free (`install_descriptor_never_carries_a_manifest`).
/// - **Never identity.** The manifest's `id` is not lifted at all, and the card's
///   `id` / `developer` / `owner` stay GitHub's own namespace. The manifest
///   supplies the *title*; GitHub supplies *who published it*; the card keeps its
///   `origin:"community"` + `reviewed:false` stamps. Attributed, not laundered — a
///   topic-squatting repo may title itself anything and still renders as
///   `<owner>`'s unreviewed listing under the community trust notice.
/// - **Bounded and scrubbed.** Every string is control-char-stripped and length
///   capped, `iconUrl` goes through [`sanitize_url`], and `icon` must look like a
///   glyph id ([`scrub_icon_id`]) — a card renders whatever it is handed.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) struct RepoManifestDisplay {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    icon_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    tagline: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    category: Option<String>,
}

impl RepoManifestDisplay {
    /// Lift the display allowlist off a loosely-parsed third-party manifest.
    /// `None` when the manifest declares nothing worth showing, so an empty `{}`
    /// at the repo root is remembered as "probed, nothing there" rather than as a
    /// hydrated record whose every field is empty.
    pub(crate) fn from_manifest(manifest: &Value) -> Option<Self> {
        let obj = manifest.as_object()?;
        let text = |key: &str, max: usize| {
            obj.get(key)
                .and_then(|v| v.as_str())
                .and_then(|s| scrub_text(s, max))
        };
        // `icon` falls back to the Companion surface's glyph, which is how an app
        // authors its icon — the same fallback `plugin_manifest_to_entry` applies.
        let icon = obj
            .get("icon")
            .and_then(|v| v.as_str())
            .or_else(|| {
                obj.get("companion")
                    .and_then(|c| c.get("icon"))
                    .and_then(|v| v.as_str())
            })
            .and_then(scrub_icon_id);
        let out = Self {
            name: text("name", MAX_NAME_CHARS),
            icon,
            icon_url: obj
                .get("iconUrl")
                .or_else(|| obj.get("icon_url"))
                .and_then(|v| v.as_str())
                .and_then(sanitize_url),
            description: text("description", MAX_DESCRIPTION_CHARS),
            version: obj
                .get("version")
                .and_then(|v| v.as_str())
                .and_then(scrub_version),
            tagline: text("tagline", MAX_TAGLINE_CHARS),
            category: text("category", MAX_CATEGORY_CHARS),
        };
        (out != Self::default()).then_some(out)
    }
}

/// Strip control characters (a newline in a card title reflows the whole row) and
/// bound the length. `None` for a string that is empty once scrubbed.
pub(crate) fn scrub_text(value: &str, max_chars: usize) -> Option<String> {
    let cleaned: String = value.chars().filter(|c| !c.is_control()).collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.chars().take(max_chars).collect())
}

/// An Icon-primitive glyph id from an untrusted manifest.
///
/// The client's `iconToUrl` interpolates this id into an Iconify URL path, and
/// returns a `data:` / `http(s):` id UNCHANGED — so an unconstrained string from a
/// community repo would reach a CSS `mask-image` verbatim. Restricting the
/// alphabet to what a real id uses (`lucide:heart`, `activity-03`,
/// `svgl:brave|dark`) rejects every URL and `data:` payload before it leaves Core,
/// and costs a publisher nothing: a raster logo belongs in `iconUrl`, which
/// [`sanitize_url`] already allowlists to http(s).
pub(crate) fn scrub_icon_id(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.chars().count() > MAX_ICON_ID_CHARS {
        return None;
    }
    trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, ':' | '-' | '_' | '.' | '|'))
        .then(|| trimmed.to_string())
}

/// A version string from an untrusted manifest — semver's alphabet only, so the
/// version field cannot smuggle markup or a URL onto the card.
pub(crate) fn scrub_version(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.chars().count() > MAX_VERSION_CHARS {
        return None;
    }
    trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+'))
        .then(|| trimmed.to_string())
}

#[derive(Debug, Default, serde::Deserialize)]
struct GithubSearchEnvelope {
    #[serde(default)]
    items: Vec<GithubRepoItem>,
}

#[derive(Debug, Default, serde::Deserialize)]
struct GithubRepoItem {
    #[serde(default)]
    full_name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    html_url: String,
    #[serde(default)]
    stargazers_count: u64,
    #[serde(default)]
    owner: GithubOwner,
    #[serde(default)]
    topics: Vec<String>,
    #[serde(default)]
    license: Option<GithubLicense>,
    #[serde(default)]
    archived: bool,
    #[serde(default)]
    fork: bool,
    #[serde(default)]
    pushed_at: Option<String>,
    #[serde(default)]
    homepage: Option<String>,
}

#[derive(Debug, Default, serde::Deserialize)]
struct GithubOwner {
    #[serde(default)]
    login: String,
    #[serde(default)]
    avatar_url: Option<String>,
}

#[derive(Debug, Default, serde::Deserialize)]
struct GithubLicense {
    #[serde(default)]
    spdx_id: Option<String>,
    #[serde(default)]
    name: Option<String>,
}

/// Built-in GitHub-topic discovery source for the Plugin/App catalog.
///
/// Not `#[derive(Debug)]` on purpose: it holds a bearer token, and a derived
/// `Debug` would leak it through any `tracing` line that prints the enclosing
/// `Source`. See the hand-written redacting impl below.
#[derive(Clone)]
pub struct GithubTopicSource {
    pub id: String,
    pub display_name: String,
    /// API base override. `None` = the builtin `api.github.com`.
    pub api_base: Option<String>,
    /// BYOK personal access token. Seeded from env in [`Self::builtin`]; the route
    /// overrides it from the preferences store. Never logged, and only ever sent to
    /// the default host.
    pub token: Option<String>,
}

impl std::fmt::Debug for GithubTopicSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GithubTopicSource")
            .field("id", &self.id)
            .field("api_base", &self.api_base)
            .field("token", &self.token.as_ref().map(|_| "<redacted>"))
            .finish()
    }
}

impl GithubTopicSource {
    pub fn builtin() -> Self {
        Self {
            id: GITHUB_TOPIC_SOURCE_ID.to_string(),
            display_name: "GitHub (community)".to_string(),
            api_base: None,
            token: GITHUB_TOKEN_ENVS.iter().find_map(|key| {
                std::env::var(key)
                    .ok()
                    .map(|v| v.trim().to_string())
                    .filter(|v| !v.is_empty())
            }),
        }
    }

    fn resolve_api_base(&self) -> String {
        let base = self
            .api_base
            .clone()
            .filter(|u| !u.trim().is_empty())
            .or_else(|| {
                std::env::var(GITHUB_API_BASE_ENV)
                    .ok()
                    .map(|u| u.trim().to_string())
                    .filter(|u| !u.is_empty())
            })
            .unwrap_or_else(|| GITHUB_API_BASE.to_string());
        base.trim_end_matches('/').to_string()
    }

    /// The token, **only** when talking to the default host. A custom base (a
    /// mirror, an enterprise host, an attacker-supplied env value) must never
    /// receive the user's PAT — the same strict-host rule Smithery's key follows.
    fn resolve_token(&self) -> Option<&str> {
        if self.resolve_api_base() != GITHUB_API_BASE {
            return None;
        }
        self.token
            .as_deref()
            .map(str::trim)
            .filter(|t| !t.is_empty())
    }

    fn topic(is_app: bool) -> String {
        let (env_key, default) = if is_app {
            (GITHUB_TOPIC_APP_ENV, GITHUB_TOPIC_APP)
        } else {
            (GITHUB_TOPIC_PLUGIN_ENV, GITHUB_TOPIC_PLUGIN)
        };
        std::env::var(env_key)
            .ok()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| default.to_string())
    }

    fn cache_ttl() -> std::time::Duration {
        let secs = std::env::var(GITHUB_TOPIC_TTL_ENV)
            .ok()
            .and_then(|s| s.parse::<u64>().ok())
            .filter(|s| *s > 0)
            .unwrap_or(GITHUB_TOPIC_DEFAULT_TTL_SECS);
        std::time::Duration::from_secs(secs)
    }

    fn search_url(&self, topic: &str) -> String {
        format!(
            "{}/search/repositories?q={}&sort=stars&order=desc&per_page={}",
            self.resolve_api_base(),
            urlencoding::encode(&format!("topic:{topic}")),
            GITHUB_TOPIC_PER_PAGE,
        )
    }

    fn request_headers(&self) -> Vec<(String, String)> {
        let mut headers = vec![
            (
                "Accept".to_string(),
                "application/vnd.github+json".to_string(),
            ),
            ("X-GitHub-Api-Version".to_string(), "2022-11-28".to_string()),
        ];
        if let Some(token) = self.resolve_token() {
            headers.push(("Authorization".to_string(), format!("Bearer {token}")));
        }
        headers
    }

    async fn fetch_topic(&self, is_app: bool) -> Result<Vec<GithubTopicRecord>> {
        let topic = Self::topic(is_app);
        let url = self.search_url(&topic);
        let bytes = crate::server::guarded_get_bytes_with_headers(&url, &self.request_headers())
            .await
            .map_err(|e| anyhow::anyhow!("fetching GitHub topic `{topic}`: {e}"))?;
        let envelope: GithubSearchEnvelope = serde_json::from_slice(&bytes)
            .map_err(|e| anyhow::anyhow!("parsing GitHub topic `{topic}` results: {e}"))?;
        Ok(envelope
            .items
            .iter()
            .filter_map(|item| repo_item_to_record(item, is_app))
            .collect())
    }

    async fn fetch_records(&self, previous: Option<&GithubTopicCache>) -> Result<GithubTopicCache> {
        // Apps first, then plugins, so a repo carrying BOTH topics is classified as
        // an app by the first-writer-wins dedupe below.
        let apps = self.fetch_topic(true).await?;
        let plugins = self.fetch_topic(false).await?;
        let mut records = dedupe_records(vec![apps, plugins]);
        carry_manifests(&mut records, previous.map(|c| c.records.as_slice()));
        self.hydrate_manifests(&mut records).await;
        Ok(GithubTopicCache {
            fetched_at: std::time::Instant::now(),
            records,
            source_url: self.resolve_api_base(),
            stale: false,
            note: None,
        })
    }

    /// Fill in each record's [`RepoManifestDisplay`] from the repo's own
    /// `manifest.json`, so a card is titled and iconed the way its author declared
    /// rather than by GitHub's repo slug and owner avatar.
    ///
    /// This is affordable only because of three properties, all load-bearing:
    ///
    /// 1. **`raw.githubusercontent.com` is a CDN**, not the Search API — these
    ///    fetches spend none of the 10 req/min search budget the rest of this
    ///    source is careful with.
    /// 2. **Results are remembered across refreshes**, positive AND negative
    ///    ([`carry_manifests`] + [`MANIFEST_PROBE_TTL_SECS`]). Most listings carry
    ///    no manifest, and a miss costs five fetches; without the negative cache
    ///    the steady-state cost would never amortize.
    /// 3. **The pass is deadline-bounded** ([`MANIFEST_HYDRATE_DEADLINE`]). What it
    ///    does not reach keeps its repo-derived presentation and `manifest_probed_at:
    ///    0`, so the next refresh retries it — a slow GitHub degrades the *cards*,
    ///    never the page.
    async fn hydrate_manifests(&self, records: &mut [GithubTopicRecord]) {
        let now = unix_now();
        let pending: Vec<usize> = records
            .iter()
            .enumerate()
            .filter(|(_, r)| r.manifest_probe_is_due(now))
            .map(|(i, _)| i)
            .collect();
        if pending.is_empty() {
            return;
        }
        let probe = async {
            for chunk in pending.chunks(MANIFEST_HYDRATE_CONCURRENCY) {
                // Cloned up front so the borrow of `records` ends before the await —
                // the write-back below needs it mutably.
                let batch: Vec<(usize, GithubTopicRecord)> =
                    chunk.iter().map(|&i| (i, records[i].clone())).collect();
                let probed = futures_util::future::join_all(batch.into_iter().map(
                    |(i, record)| async move { (i, self.fetch_repo_manifest(&record).await) },
                ))
                .await;
                for (i, hit) in probed {
                    records[i].manifest = hit
                        .as_ref()
                        .and_then(|(manifest, _)| RepoManifestDisplay::from_manifest(manifest));
                    // Stamped on a MISS too — that is the negative cache.
                    records[i].manifest_probed_at = now;
                }
            }
        };
        if tokio::time::timeout(MANIFEST_HYDRATE_DEADLINE, probe)
            .await
            .is_err()
        {
            tracing::debug!(
                pending = pending.len(),
                "github-topic: manifest hydration hit its deadline; unhydrated listings retry on the next refresh"
            );
        }
    }

    fn disk_cache_path() -> std::path::PathBuf {
        crate::paths::ryu_dir()
            .join("cache")
            .join("github-topic")
            .join("topics.json")
    }

    fn read_disk_cache() -> Option<GithubTopicCache> {
        let raw = std::fs::read_to_string(Self::disk_cache_path()).ok()?;
        let envelope: DiskCacheEnvelope = serde_json::from_str(&raw).ok()?;
        if envelope.records.is_empty() {
            return None;
        }
        Some(GithubTopicCache {
            fetched_at: std::time::Instant::now(),
            records: envelope.records,
            source_url: envelope.source_url,
            stale: true,
            note: Some(OFFLINE_NOTE.to_string()),
        })
    }

    fn write_disk_cache(cache: &GithubTopicCache) {
        let path = Self::disk_cache_path();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let envelope = DiskCacheEnvelope {
            fetched_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0),
            records: cache.records.clone(),
            source_url: cache.source_url.clone(),
        };
        if let Ok(json) = serde_json::to_string(&envelope) {
            let _ = std::fs::write(path, json);
        }
    }

    /// Cached records with **graceful degradation**: inside the TTL the warm copy is
    /// returned; on a refresh failure the last-good copy is served past its TTL
    /// (flagged `stale`, with a human note) rather than blanking the section. Only a
    /// process that has never fetched successfully — and has no disk copy — errors.
    async fn records(&self) -> Result<GithubTopicCache> {
        let lock = GITHUB_TOPIC_CACHE.get_or_init(|| tokio::sync::Mutex::new(None));
        let mut guard = lock.lock().await;
        if let Some(cache) = guard.as_ref() {
            if !cache.stale && cache.fetched_at.elapsed() < Self::cache_ttl() {
                return Ok(cache.clone());
            }
        }
        // The warm copy is handed to the refresh so its already-probed manifests
        // (hits AND misses) carry over instead of being re-fetched.
        match self.fetch_records(guard.as_ref()).await {
            Ok(cache) => {
                Self::write_disk_cache(&cache);
                *guard = Some(cache.clone());
                Ok(cache)
            }
            Err(err) => {
                // Last-good wins over an error: an unreachable/rate-limited GitHub
                // must degrade to a slightly-stale list, never to an empty store.
                if let Some(cache) = guard.as_ref() {
                    let mut stale = cache.clone();
                    stale.stale = true;
                    stale.note = Some(stale_note(&err.to_string()));
                    return Ok(stale);
                }
                if let Some(mut cache) = Self::read_disk_cache() {
                    cache.note = Some(stale_note(&err.to_string()));
                    *guard = Some(cache.clone());
                    return Ok(cache);
                }
                Err(err)
            }
        }
    }

    fn wrap_items(
        &self,
        items: Vec<Value>,
        source_url: &str,
        note: Option<&str>,
        next_cursor: Option<String>,
    ) -> Value {
        let mut obj = serde_json::Map::new();
        obj.insert("items".to_string(), Value::Array(items));
        obj.insert(
            "next_cursor".to_string(),
            next_cursor.map_or(Value::Null, Value::String),
        );
        obj.insert(
            "source_url".to_string(),
            Value::String(source_url.to_string()),
        );
        obj.insert(
            "cache_ttl_seconds".to_string(),
            Value::Number(Self::cache_ttl().as_secs().into()),
        );
        if let Some(note) = note {
            obj.insert("note".to_string(), Value::String(note.to_string()));
        }
        Value::Object(obj)
    }

    /// Best-effort manifest enrichment over `raw.githubusercontent.com` (a CDN — not
    /// on the Search API's rate-limit budget). Returns `(manifest_value, raw_url)`.
    async fn fetch_repo_manifest(&self, record: &GithubTopicRecord) -> Option<(Value, String)> {
        for path in REPO_MANIFEST_PATHS {
            let url = format!(
                "https://raw.githubusercontent.com/{}/{}/HEAD/{}",
                record.owner, record.repo, path
            );
            let Ok(bytes) = crate::server::guarded_get_bytes(&url).await else {
                continue;
            };
            // Parsed as a loose `Value`, never as `PluginManifest`: a strict parse
            // would reject a slightly-off third-party manifest and lose the card.
            if let Ok(value) = serde_json::from_slice::<Value>(&bytes) {
                if value.is_object() {
                    return Some((value, url));
                }
            }
        }
        None
    }
}

const OFFLINE_NOTE: &str = "Showing cached community listings — GitHub is unreachable.";

fn stale_note(err: &str) -> String {
    let lower = err.to_ascii_lowercase();
    if lower.contains("403") || lower.contains("429") {
        "GitHub rate limit reached — showing cached community listings.".to_string()
    } else {
        OFFLINE_NOTE.to_string()
    }
}

/// Normalize one GitHub repo hit. Archived repos are dropped (a dead listing is
/// worse than no listing); forks are kept but flagged, since topic discovery gets
/// noisy fast.
fn repo_item_to_record(item: &GithubRepoItem, is_app: bool) -> Option<GithubTopicRecord> {
    if item.archived {
        return None;
    }
    let full_name = item.full_name.trim();
    let (owner, repo) = match full_name.split_once('/') {
        Some((o, r)) if !o.is_empty() && !r.is_empty() => (o.to_string(), r.to_string()),
        _ => return None,
    };
    Some(GithubTopicRecord {
        id: format!("{GH_ID_PREFIX}{owner}/{repo}"),
        owner: owner.clone(),
        repo: repo.clone(),
        full_name: full_name.to_string(),
        description: item
            .description
            .as_deref()
            .map(str::trim)
            .filter(|d| !d.is_empty())
            .map(truncate_description),
        stars: item.stargazers_count,
        html_url: sanitize_url(&item.html_url)
            .unwrap_or_else(|| format!("https://github.com/{full_name}")),
        avatar_url: item.owner.avatar_url.as_deref().and_then(sanitize_url),
        topics: item.topics.clone(),
        license: item
            .license
            .as_ref()
            .and_then(|l| l.spdx_id.clone().or_else(|| l.name.clone()))
            .filter(|l| !l.is_empty() && l != "NOASSERTION"),
        pushed_at: item.pushed_at.clone(),
        // Homepage is publisher-controlled, so it goes through the http(s)
        // allowlist before it can ever reach an `<a href>`.
        homepage: item.homepage.as_deref().and_then(sanitize_url),
        is_fork: item.fork,
        is_app,
        // Hydrated separately: a Search hit carries repo metadata only, never the
        // repo's manifest. See `hydrate_manifests`.
        manifest: None,
        manifest_probed_at: 0,
    })
}

/// Repo descriptions are attacker-controlled free text; bound them before they
/// reach a card.
const MAX_DESCRIPTION_CHARS: usize = 300;

fn truncate_description(value: &str) -> String {
    if value.chars().count() <= MAX_DESCRIPTION_CHARS {
        return value.to_string();
    }
    let mut out: String = value.chars().take(MAX_DESCRIPTION_CHARS).collect();
    out.push('…');
    out
}

/// http(s)-only allowlist, so a `javascript:` / `data:` homepage from an untrusted
/// repo can never reach an href. Mirrors `sources::http_url`.
pub(crate) fn sanitize_url(value: &str) -> Option<String> {
    let trimmed = value.trim();
    let lower = trimmed.to_ascii_lowercase();
    (lower.starts_with("https://") || lower.starts_with("http://")).then(|| trimmed.to_string())
}

/// Unix seconds, saturating to `0` on a pre-epoch clock.
pub(crate) fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

impl GithubTopicRecord {
    /// Whether this record's manifest should be (re-)probed. Never probed, or the
    /// last probe is older than [`MANIFEST_PROBE_TTL_SECS`] — the second arm is
    /// what lets a repo that ADDS a manifest later still be picked up, rather than
    /// being cached as manifest-less forever.
    fn manifest_probe_is_due(&self, now: u64) -> bool {
        self.manifest_probed_at == 0
            || now.saturating_sub(self.manifest_probed_at) >= MANIFEST_PROBE_TTL_SECS
    }
}

/// Carry already-probed manifests from the previous record set onto a freshly
/// fetched one, matched by lowercased `full_name`.
///
/// This is what makes hydration cost ~nothing in steady state: a 6h refresh
/// re-fetches the two Search pages, but the manifests it already knows about
/// (including the *misses*) come along for free, so only genuinely new listings
/// and expired probes cost a raw fetch.
pub(crate) fn carry_manifests(
    records: &mut [GithubTopicRecord],
    previous: Option<&[GithubTopicRecord]>,
) {
    let Some(previous) = previous else {
        return;
    };
    let known: std::collections::HashMap<String, &GithubTopicRecord> = previous
        .iter()
        .map(|r| (r.full_name.to_ascii_lowercase(), r))
        .collect();
    for record in records.iter_mut() {
        if let Some(prior) = known.get(&record.full_name.to_ascii_lowercase()) {
            record.manifest = prior.manifest.clone();
            record.manifest_probed_at = prior.manifest_probed_at;
        }
    }
}

/// Merge topic result groups, deduping by lowercased `full_name`, first writer
/// wins. Called with `[apps, plugins]`, so a repo carrying both topics lands as
/// an app.
pub(crate) fn dedupe_records(groups: Vec<Vec<GithubTopicRecord>>) -> Vec<GithubTopicRecord> {
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut out: Vec<GithubTopicRecord> = Vec::new();
    for group in groups {
        for record in group {
            if seen.insert(record.full_name.to_ascii_lowercase()) {
                out.push(record);
            }
        }
    }
    out
}

/// Split a `gh:<owner>/<repo>` id. Returns `None` for any foreign id — checked
/// before any network call, so the install-by-id probe loop never touches GitHub
/// for an unrelated plugin.
pub(crate) fn parse_gh_id(id: &str) -> Option<(String, String)> {
    let rest = id.trim().strip_prefix(GH_ID_PREFIX)?;
    let (owner, repo) = rest.split_once('/')?;
    let (owner, repo) = (owner.trim(), repo.trim());
    if owner.is_empty() || repo.is_empty() || repo.contains('/') {
        return None;
    }
    Some((owner.to_string(), repo.to_string()))
}

/// Project one record onto the Plugin-kind card shape that
/// `plugin_marketplace_item_to_entry` reads.
///
/// **Presentation comes from the repo's manifest, identity from GitHub.** The
/// manifest supplies `name` / `icon` / `description` / `version` / `tagline` /
/// `category` — what the publisher declared this thing is called and looks like.
/// GitHub keeps `id`, `developer`, `owner`, and the trust triple, because those
/// answer "who published this and has anyone vetted it", which a repo must not be
/// able to author about itself. See [`RepoManifestDisplay`].
pub(crate) fn record_to_item(record: &GithubTopicRecord) -> Value {
    let mut topics = record.topics.clone();
    if record.is_fork {
        topics.push("fork".to_string());
    }
    let manifest = record.manifest.as_ref();
    let manifest_str = |pick: fn(&RepoManifestDisplay) -> Option<&String>| {
        manifest.and_then(pick).cloned()
    };
    let name = manifest_str(|m| m.name.as_ref()).unwrap_or_else(|| record.repo.clone());
    let description = manifest_str(|m| m.description.as_ref())
        .or_else(|| record.description.clone())
        .unwrap_or_default();
    serde_json::json!({
        "id": record.id,
        "name": name,
        "description": description,
        // Empty until the repo's manifest declares one — a GitHub repo has no
        // version of its own.
        "version": manifest_str(|m| m.version.as_ref()).unwrap_or_default(),
        "install_source": record.html_url,
        "url": record.html_url,
        "repo_url": record.html_url,
        "installed": false,
        "type": if record.is_app { "app" } else { "plugin" },
        "has_companion": record.is_app,
        "developer": record.owner,
        "owner": record.owner,
        // The manifest's glyph id, when it declares one. The owner AVATAR stays the
        // raster fallback: without a declared icon it is still the only thing that
        // distinguishes one community card from another.
        "icon": manifest_str(|m| m.icon.as_ref()),
        "icon_url": manifest_str(|m| m.icon_url.as_ref()).or_else(|| record.avatar_url.clone()),
        // "Community" stays the default shelf: it is the provenance disclosure, and
        // a self-declared category only refines it.
        "category": manifest_str(|m| m.category.as_ref()).unwrap_or_else(|| "Community".to_string()),
        "tagline": manifest_str(|m| m.tagline.as_ref()).or_else(|| record.description.clone()),
        "stars": record.stars,
        "license": record.license,
        "pushed_at": record.pushed_at,
        "topics": topics,
        // The trust triple. `origin` drives the store's Community section + notice;
        // `reviewed:false` says nobody vetted this; `descriptor_only` collapses the
        // Install CTA to a link-out.
        "origin": COMMUNITY_ORIGIN,
        "reviewed": false,
        "provenance": GITHUB_TOPIC_SOURCE_ID,
        "descriptor_only": true,
    })
}

/// Lift the display-only allowlist off a third-party manifest. **Never** copies
/// `ui_code`, `backend_code`, or any `*_sha256`: an unsigned source must not be
/// able to move runnable code, and the manifest's own `id` is surfaced as
/// `manifest_id` (never as the entry id) so an id-squatting repo cannot
/// masquerade as an installed plugin.
///
/// Every lifted string goes through the same scrubbers the card path uses
/// ([`scrub_text`] / [`scrub_icon_id`] / [`scrub_version`]). This merge lands on
/// top of the values [`record_to_item`]'s counterpart already sanitized, so an
/// unscrubbed copy here would quietly re-open exactly what those close.
pub(crate) fn manifest_display_fields(manifest: &Value) -> serde_json::Map<String, Value> {
    let mut out = serde_json::Map::new();
    let Some(obj) = manifest.as_object() else {
        return out;
    };
    if let Some(id) = obj
        .get("id")
        .and_then(|v| v.as_str())
        .and_then(|s| scrub_text(s, MAX_NAME_CHARS))
    {
        out.insert("manifestId".to_string(), Value::String(id));
    }
    if let Some(name) = obj
        .get("name")
        .and_then(|v| v.as_str())
        .and_then(|s| scrub_text(s, MAX_NAME_CHARS))
    {
        out.insert("manifestName".to_string(), Value::String(name));
    }
    for key in MANIFEST_DISPLAY_KEYS {
        let raw = obj.get(key).and_then(|v| v.as_str());
        let scrubbed = match key {
            "icon" => raw.and_then(scrub_icon_id),
            "version" => raw.and_then(scrub_version),
            "category" => raw.and_then(|s| scrub_text(s, MAX_CATEGORY_CHARS)),
            _ => raw.and_then(|s| scrub_text(s, MAX_DESCRIPTION_CHARS)),
        };
        if let Some(v) = scrubbed {
            out.insert(key.to_string(), Value::String(v));
        }
    }
    if let Some(url) = obj
        .get("homepage")
        .or_else(|| obj.get("icon_url"))
        .and_then(|v| v.as_str())
        .and_then(sanitize_url)
    {
        let key = if obj.get("homepage").is_some() {
            "homepage"
        } else {
            "iconUrl"
        };
        out.insert(key.to_string(), Value::String(url));
    }
    for key in ["requires", "targets"] {
        if let Some(v) = obj.get(key).filter(|v| !v.is_null()) {
            out.insert(key.to_string(), v.clone());
        }
    }
    // Runnable *kinds* only — the shapes, never their code.
    if let Some(runnables) = obj.get("runnables").and_then(|v| v.as_array()) {
        let kinds: Vec<Value> = runnables
            .iter()
            .filter_map(|r| r.get("kind").and_then(|v| v.as_str()))
            .map(|k| Value::String(k.to_string()))
            .collect();
        if !kinds.is_empty() {
            out.insert("runnableKinds".to_string(), Value::Array(kinds));
        }
    }
    out
}

impl CatalogSource for GithubTopicSource {
    fn id(&self) -> &str {
        &self.id
    }
    fn display_name(&self) -> &str {
        &self.display_name
    }
    fn kind(&self) -> CatalogKind {
        CatalogKind::Plugin
    }

    async fn search(&self, _client: &reqwest::Client, q: &CatalogQuery) -> Result<Value> {
        let limit = if q.limit == 0 { 40 } else { q.limit };
        let offset = q
            .cursor
            .as_deref()
            .and_then(|c| c.trim().parse::<usize>().ok())
            .unwrap_or(0);
        match self.records().await {
            Ok(cache) => {
                let needle = q.query.trim().to_ascii_lowercase();
                let type_filter = q.extra_str("github_topic_type").to_ascii_lowercase();
                let filtered: Vec<Value> = cache
                    .records
                    .iter()
                    .filter(|record| match type_filter.as_str() {
                        "app" => record.is_app,
                        "plugin" => !record.is_app,
                        _ => true,
                    })
                    .filter(|record| {
                        needle.is_empty()
                            || record.full_name.to_ascii_lowercase().contains(&needle)
                            || record
                                .description
                                .as_deref()
                                .is_some_and(|d| d.to_ascii_lowercase().contains(&needle))
                            || record
                                .topics
                                .iter()
                                .any(|t| t.to_ascii_lowercase().contains(&needle))
                    })
                    .map(record_to_item)
                    .collect();
                let total = filtered.len();
                let next_cursor = (offset + limit < total).then(|| (offset + limit).to_string());
                let items: Vec<Value> = filtered.into_iter().skip(offset).take(limit).collect();
                Ok(self.wrap_items(items, &cache.source_url, cache.note.as_deref(), next_cursor))
            }
            // `search` never propagates: an offline store shows an empty section
            // with a note, not an error page.
            Err(e) => Ok(self.wrap_items(
                Vec::new(),
                &self.resolve_api_base(),
                Some(&e.to_string()),
                None,
            )),
        }
    }

    async fn detail(&self, _client: &reqwest::Client, id: &str) -> Result<Value> {
        // Foreign ids are rejected before any egress (the install probe loop).
        if parse_gh_id(id).is_none() {
            anyhow::bail!("`{id}` is not a GitHub-topic catalog id");
        }
        let cache = self.records().await?;
        let record = cache
            .records
            .iter()
            .find(|r| r.id == id)
            .ok_or_else(|| anyhow::anyhow!("community listing `{id}` not found"))?;

        // Same rule the card uses: the manifest names and icons the listing, GitHub
        // owns its identity. Kept in lockstep with `record_to_item` so opening a
        // card never renames the thing you clicked on.
        let declared = record.manifest.as_ref();
        let mut detail = serde_json::json!({
            "id": record.id,
            "name": declared
                .and_then(|m| m.name.clone())
                .unwrap_or_else(|| record.repo.clone()),
            "description": declared
                .and_then(|m| m.description.clone())
                .or_else(|| record.description.clone()),
            "icon": declared.and_then(|m| m.icon.clone()),
            "iconUrl": declared
                .and_then(|m| m.icon_url.clone())
                .or_else(|| record.avatar_url.clone()),
            "developer": record.owner,
            "homepage": record.homepage,
            "repositoryUrl": record.html_url,
            "license": record.license,
            "stars": record.stars,
            "topics": record.topics,
            "updatedAt": record.pushed_at,
            "type": if record.is_app { "app" } else { "plugin" },
            "source": self.display_name,
            "sourceUrl": cache.source_url,
            "origin": COMMUNITY_ORIGIN,
            "reviewed": false,
            "provenance": GITHUB_TOPIC_SOURCE_ID,
            "descriptorOnly": true,
            "discoveredFrom": {
                "topic": Self::topic(record.is_app),
                "repositoryUrl": record.html_url,
            },
        });

        // Repository enrichment (README, releases, timestamps, download counts) —
        // best-effort and cached, so a rate-limited GitHub costs a few tabs, not
        // the page. Merged BEFORE the manifest so a manifest-declared value (the
        // publisher's own claim) still wins where the two overlap.
        if let Some(obj) = detail.as_object_mut() {
            let enrichment = super::github_enrich::enrich_repo(
                &record.id,
                &self.resolve_api_base(),
                &self.request_headers(),
                &record.owner,
                &record.repo,
            )
            .await;
            if let Some(fields) = enrichment.as_object() {
                for (k, v) in fields {
                    obj.insert(k.clone(), v.clone());
                }
            }
        }

        match self.fetch_repo_manifest(record).await {
            Some((manifest, url)) => {
                if let Some(obj) = detail.as_object_mut() {
                    for (k, v) in manifest_display_fields(&manifest) {
                        obj.insert(k, v);
                    }
                    for (k, v) in super::manifest_surface::project_manifest(&manifest) {
                        obj.insert(k, v);
                    }
                    obj.insert("manifestUrl".to_string(), Value::String(url));
                }
            }
            None => {
                if let Some(obj) = detail.as_object_mut() {
                    obj.insert(
                        "enrichmentError".to_string(),
                        Value::String(
                            "No plugin manifest found at the repository root.".to_string(),
                        ),
                    );
                }
            }
        }
        Ok(detail)
    }

    async fn install_descriptor(
        &self,
        _client: &reqwest::Client,
        id: &str,
    ) -> Result<InstallDescriptor> {
        let (owner, repo) =
            parse_gh_id(id).ok_or_else(|| anyhow::anyhow!("`{id}` is not a GitHub-topic id"))?;
        // DESCRIPTOR-ONLY, and deliberately so: no `raw.manifest` key. That is what
        // makes `resolve_plugin_from_catalog` skip this source fail-closed instead of
        // treating an unsigned third-party repo as an install path. A user who
        // genuinely wants one installs it explicitly via `POST /api/plugins/install`
        // against the repo URL — a per-repo act, not a catalog-wide trust grant.
        Ok(InstallDescriptor {
            kind: CatalogKind::Plugin,
            source_id: self.id.clone(),
            repo_id: id.to_string(),
            files: Vec::new(),
            raw: serde_json::json!({
                "install_source": format!("https://github.com/{owner}/{repo}"),
                "repo_url": format!("https://github.com/{owner}/{repo}"),
                "origin": COMMUNITY_ORIGIN,
                "reviewed": false,
                "provenance": GITHUB_TOPIC_SOURCE_ID,
            }),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo(full_name: &str, stars: u64) -> GithubRepoItem {
        GithubRepoItem {
            full_name: full_name.to_string(),
            description: Some("a thing".to_string()),
            html_url: format!("https://github.com/{full_name}"),
            stargazers_count: stars,
            owner: GithubOwner {
                login: full_name.split('/').next().unwrap_or("").to_string(),
                avatar_url: Some("https://avatars.githubusercontent.com/u/1".to_string()),
            },
            topics: vec!["ryu-plugin".to_string()],
            license: Some(GithubLicense {
                spdx_id: Some("MIT".to_string()),
                name: Some("MIT License".to_string()),
            }),
            archived: false,
            fork: false,
            pushed_at: Some("2026-07-01T00:00:00Z".to_string()),
            homepage: None,
        }
    }

    #[test]
    fn search_envelope_parses_and_normalizes() {
        let raw = br#"{
            "total_count": 1,
            "incomplete_results": false,
            "items": [{
                "full_name": "acme/ryu-thing",
                "name": "ryu-thing",
                "description": "does a thing",
                "html_url": "https://github.com/acme/ryu-thing",
                "stargazers_count": 128,
                "owner": { "login": "acme", "avatar_url": "https://avatars.githubusercontent.com/u/9" },
                "topics": ["ryu-plugin", "ai"],
                "license": { "spdx_id": "Apache-2.0" },
                "archived": false,
                "fork": false,
                "pushed_at": "2026-07-20T10:00:00Z",
                "unknown_future_field": 42
            }]
        }"#;
        let envelope: GithubSearchEnvelope = serde_json::from_slice(raw).unwrap();
        let records: Vec<GithubTopicRecord> = envelope
            .items
            .iter()
            .filter_map(|i| repo_item_to_record(i, false))
            .collect();
        assert_eq!(records.len(), 1);
        let r = &records[0];
        assert_eq!(r.id, "gh:acme/ryu-thing");
        assert_eq!(r.owner, "acme");
        assert_eq!(r.repo, "ryu-thing");
        assert_eq!(r.stars, 128);
        assert_eq!(r.license.as_deref(), Some("Apache-2.0"));
        assert!(!r.is_app);
    }

    #[test]
    fn archived_repos_are_dropped_forks_are_kept_and_flagged() {
        let mut archived = repo("dead/repo", 3);
        archived.archived = true;
        assert!(repo_item_to_record(&archived, false).is_none());

        let mut forked = repo("acme/fork", 1);
        forked.fork = true;
        let record = repo_item_to_record(&forked, false).unwrap();
        assert!(record.is_fork);
        let item = record_to_item(&record);
        let topics: Vec<&str> = item["topics"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|v| v.as_str())
            .collect();
        assert!(topics.contains(&"fork"));
    }

    #[test]
    fn both_topics_classify_as_app_and_dedupe_by_full_name() {
        let as_app = repo_item_to_record(&repo("acme/dual", 5), true).unwrap();
        let as_plugin = repo_item_to_record(&repo("ACME/Dual", 5), false).unwrap();
        let other = repo_item_to_record(&repo("other/one", 1), false).unwrap();
        // Apps group first — the same repo discovered under both topics collapses
        // to ONE app row.
        let merged = dedupe_records(vec![vec![as_app], vec![as_plugin, other]]);
        assert_eq!(merged.len(), 2);
        assert!(merged[0].is_app, "the app-topic hit must win the dedupe");
        assert_eq!(merged[0].full_name, "acme/dual");
    }

    #[test]
    fn app_vs_plugin_comes_from_the_matched_query_not_the_topics_array() {
        // The repo's own `topics` say "ryu-plugin", but it was found under the
        // app topic — the query is the ground truth (topics are publisher-controlled).
        let record = repo_item_to_record(&repo("acme/claims-plugin", 2), true).unwrap();
        let item = record_to_item(&record);
        assert_eq!(item["type"], "app");
        assert_eq!(item["has_companion"], true);
    }

    #[test]
    fn card_carries_the_unreviewed_trust_triple() {
        let record = repo_item_to_record(&repo("acme/thing", 7), false).unwrap();
        let item = record_to_item(&record);
        assert_eq!(item["origin"], COMMUNITY_ORIGIN);
        assert_eq!(item["reviewed"], false);
        assert_eq!(item["provenance"], GITHUB_TOPIC_SOURCE_ID);
        assert_eq!(item["descriptor_only"], true);
        assert_eq!(item["stars"], 7);
        // A repo has no version until its manifest is read in `detail`.
        assert_eq!(item["version"], "");
        // And a card is never a manifest carrier.
        assert!(item.get("manifest").is_none());
    }

    #[test]
    fn gh_ids_parse_and_foreign_ids_are_rejected() {
        assert_eq!(
            parse_gh_id("gh:acme/ryu-thing"),
            Some(("acme".to_string(), "ryu-thing".to_string()))
        );
        for foreign in [
            "@ryu/mail",
            "acme/ryu-thing",
            "gh:acme",
            "gh:/thing",
            "gh:acme/",
            "gh:acme/a/b",
            "",
        ] {
            assert!(
                parse_gh_id(foreign).is_none(),
                "`{foreign}` must not parse as a github-topic id"
            );
        }
    }

    #[tokio::test]
    async fn install_descriptor_never_carries_a_manifest() {
        // REGRESSION GUARD. `resolve_plugin_from_catalog` reads `raw["manifest"]`;
        // an absent one is what keeps install-by-id fail-closed for this unsigned
        // source. Do not "helpfully" add it.
        let source = GithubTopicSource::builtin();
        let client = reqwest::Client::new();
        let descriptor = source
            .install_descriptor(&client, "gh:acme/ryu-thing")
            .await
            .unwrap();
        assert!(descriptor.raw.get("manifest").is_none());
        assert!(descriptor.files.is_empty());
        assert_eq!(descriptor.raw["reviewed"], false);
        assert_eq!(descriptor.raw["origin"], COMMUNITY_ORIGIN);
        // A foreign id is refused without touching the network.
        assert!(source
            .install_descriptor(&client, "@ryu/mail")
            .await
            .is_err());
    }

    #[test]
    fn manifest_enrichment_lifts_the_allowlist_and_drops_runnable_code() {
        let manifest = serde_json::json!({
            "id": "com.acme.thing",
            "name": "Thing",
            "version": "1.2.3",
            "description": "a thing",
            "category": "Productivity",
            "ui_code": "<script>alert(1)</script>",
            "ui_code_sha256": "deadbeef",
            "backend_code": "require('child_process').exec('rm -rf /')",
            "backend_sha256": "cafebabe",
            "artifact_url": "https://evil.example/x.tgz",
            "runnables": [{ "kind": "companion", "id": "ui", "name": "UI" }],
        });
        let lifted = manifest_display_fields(&manifest);
        assert_eq!(lifted["version"], "1.2.3");
        assert_eq!(lifted["category"], "Productivity");
        // The manifest's claimed id is disclosed SEPARATELY, never as the entry id.
        assert_eq!(lifted["manifestId"], "com.acme.thing");
        assert!(lifted.get("id").is_none());
        for forbidden in [
            "ui_code",
            "ui_code_sha256",
            "backend_code",
            "backend_sha256",
            "artifact_url",
        ] {
            assert!(
                lifted.get(forbidden).is_none(),
                "`{forbidden}` must never travel from an unsigned source"
            );
        }
        // Runnable KINDS only — the shapes, never their code.
        assert_eq!(lifted["runnableKinds"], serde_json::json!(["companion"]));
    }

    #[test]
    fn hostile_urls_are_rejected_before_they_reach_an_href() {
        let mut hostile = repo("acme/evil", 0);
        hostile.homepage = Some("javascript:alert(1)".to_string());
        hostile.html_url = "data:text/html,pwned".to_string();
        let record = repo_item_to_record(&hostile, false).unwrap();
        assert!(record.homepage.is_none());
        // A non-http html_url falls back to the canonical github URL.
        assert_eq!(record.html_url, "https://github.com/acme/evil");
    }

    #[test]
    fn descriptions_are_bounded() {
        let mut wordy = repo("acme/wordy", 0);
        wordy.description = Some("x".repeat(5000));
        let record = repo_item_to_record(&wordy, false).unwrap();
        let description = record.description.unwrap();
        assert!(description.chars().count() <= MAX_DESCRIPTION_CHARS + 1);
    }

    #[test]
    fn a_custom_api_base_suppresses_the_byok_token() {
        let default_host = GithubTopicSource {
            id: GITHUB_TOPIC_SOURCE_ID.to_string(),
            display_name: "GitHub (community)".to_string(),
            api_base: None,
            token: Some("ghp_secret".to_string()),
        };
        assert_eq!(default_host.resolve_token(), Some("ghp_secret"));

        let mirror = GithubTopicSource {
            api_base: Some("https://ghe.example.com/api/v3".to_string()),
            ..default_host.clone()
        };
        assert!(
            mirror.resolve_token().is_none(),
            "the user's PAT must never be sent to a non-default host"
        );
        assert!(!mirror
            .request_headers()
            .iter()
            .any(|(name, _)| name.eq_ignore_ascii_case("authorization")));
    }

    #[test]
    fn debug_redacts_the_token() {
        let source = GithubTopicSource {
            id: GITHUB_TOPIC_SOURCE_ID.to_string(),
            display_name: "GitHub (community)".to_string(),
            api_base: None,
            token: Some("ghp_supersecret".to_string()),
        };
        let rendered = format!("{source:?}");
        assert!(!rendered.contains("ghp_supersecret"), "{rendered}");
        assert!(rendered.contains("redacted"), "{rendered}");
    }

    #[test]
    fn stale_note_names_the_rate_limit() {
        assert!(
            stale_note("https://api.github.com/... returned HTTP 403 Forbidden")
                .contains("rate limit")
        );
        assert!(stale_note("dns error").contains("cached"));
    }

    #[test]
    fn search_url_encodes_the_topic_qualifier() {
        let source = GithubTopicSource::builtin();
        let url = source.search_url("ryu-app");
        assert!(url.starts_with("https://api.github.com/search/repositories?q="));
        assert!(url.contains("topic%3Aryu-app"), "{url}");
        assert!(url.contains("per_page=100"));
    }

    /// A record whose manifest has already been probed, for the card-projection
    /// tests below.
    fn hydrated(full_name: &str, manifest: serde_json::Value) -> GithubTopicRecord {
        let mut record = repo_item_to_record(&repo(full_name, 4), false).unwrap();
        record.manifest = RepoManifestDisplay::from_manifest(&manifest);
        record.manifest_probed_at = unix_now();
        record
    }

    #[test]
    fn card_name_and_icon_come_from_the_manifest_not_the_repo_slug() {
        // The bug this closes: every community card was titled `<repo>` and iconed
        // with the OWNER's avatar, so an org's listings were indistinguishable and
        // none matched the name the plugin actually ships under.
        let record = hydrated(
            "acme/ryu-thing-plugin",
            serde_json::json!({
                "id": "@acme/thing",
                "name": "Thing",
                "icon": "lucide:brain",
                "iconUrl": "https://cdn.example.com/thing.png",
                "description": "Does the thing.",
                "version": "2.1.0",
                "tagline": "the thing, done",
                "category": "Productivity",
            }),
        );
        let item = record_to_item(&record);
        assert_eq!(item["name"], "Thing");
        assert_eq!(item["icon"], "lucide:brain");
        assert_eq!(item["icon_url"], "https://cdn.example.com/thing.png");
        assert_eq!(item["description"], "Does the thing.");
        assert_eq!(item["version"], "2.1.0");
        assert_eq!(item["tagline"], "the thing, done");
        assert_eq!(item["category"], "Productivity");
    }

    #[test]
    fn an_unhydrated_card_still_falls_back_to_the_repo_slug_and_owner_avatar() {
        // Hydration is best-effort and deadline-bounded: a listing it has not
        // reached must still render, not blank out.
        let record = repo_item_to_record(&repo("acme/ryu-thing", 4), false).unwrap();
        assert!(record.manifest.is_none());
        let item = record_to_item(&record);
        assert_eq!(item["name"], "ryu-thing");
        assert_eq!(item["icon"], Value::Null);
        assert_eq!(item["icon_url"], "https://avatars.githubusercontent.com/u/1");
        assert_eq!(item["category"], "Community");
    }

    #[test]
    fn a_manifest_can_supply_presentation_but_never_identity_or_trust() {
        // A topic-squatting repo may title itself anything; it must not be able to
        // claim someone else's id, publisher, or a reviewed status.
        let record = hydrated(
            "squatter/evil",
            serde_json::json!({
                "id": "@ryu/mail",
                "name": "Ryu Official Mail",
                "developer": "Ryu",
                "origin": "builtin",
                "reviewed": true,
                "descriptor_only": false,
                "built_in": true,
            }),
        );
        let item = record_to_item(&record);
        assert_eq!(item["name"], "Ryu Official Mail");
        // …and every identity/trust key is still GitHub's and Core's.
        assert_eq!(item["id"], "gh:squatter/evil");
        assert_eq!(item["developer"], "squatter");
        assert_eq!(item["owner"], "squatter");
        assert_eq!(item["origin"], COMMUNITY_ORIGIN);
        assert_eq!(item["reviewed"], false);
        assert_eq!(item["descriptor_only"], true);
    }

    #[test]
    fn a_companion_icon_is_the_glyph_fallback() {
        // How an app authors its icon — same fallback `plugin_manifest_to_entry` uses.
        let record = hydrated(
            "acme/app",
            serde_json::json!({ "name": "App", "companion": { "icon": "ai-image" } }),
        );
        assert_eq!(record_to_item(&record)["icon"], "ai-image");
    }

    #[test]
    fn an_icon_id_is_a_glyph_id_never_a_url_or_data_uri() {
        // `iconToUrl` returns a `data:`/`http(s):` id UNCHANGED and drops it into a
        // CSS `mask-image`, so the alphabet is constrained here, at the boundary.
        for good in ["lucide:brain", "activity-03", "svgl:brave|dark", "mic_01.x"] {
            assert_eq!(scrub_icon_id(good).as_deref(), Some(good), "{good}");
        }
        for bad in [
            "https://evil.example/x.svg",
            "data:image/svg+xml;base64,PHN2Zz4=",
            "javascript:alert(1)",
            "lucide:brain\"); background:url(https://evil.example",
            "a b",
            "",
            "   ",
        ] {
            assert!(scrub_icon_id(bad).is_none(), "{bad}");
        }
        // And over-long ids are refused rather than truncated into a different id.
        assert!(scrub_icon_id(&"a".repeat(MAX_ICON_ID_CHARS + 1)).is_none());
    }

    #[test]
    fn manifest_strings_are_control_stripped_and_bounded() {
        let record = hydrated(
            "acme/wordy",
            serde_json::json!({
                "name": format!("Line\nBreak\u{0}{}", "x".repeat(500)),
                "version": "1.0.0; rm -rf /",
                "description": "y".repeat(5000),
            }),
        );
        let manifest = record.manifest.as_ref().unwrap();
        let name = manifest.name.as_deref().unwrap();
        assert!(!name.contains('\n') && !name.contains('\u{0}'), "{name}");
        assert_eq!(name.chars().count(), MAX_NAME_CHARS);
        // A version outside semver's alphabet is dropped, not sanitized into a lie.
        assert!(manifest.version.is_none());
        assert_eq!(
            manifest.description.as_deref().unwrap().chars().count(),
            MAX_DESCRIPTION_CHARS
        );
    }

    #[test]
    fn an_empty_manifest_hydrates_to_nothing_rather_than_blank_fields() {
        assert!(RepoManifestDisplay::from_manifest(&serde_json::json!({})).is_none());
        assert!(RepoManifestDisplay::from_manifest(&serde_json::json!([])).is_none());
        // A manifest with only non-display keys is equally "nothing to show".
        assert!(
            RepoManifestDisplay::from_manifest(&serde_json::json!({ "ui_code": "x" })).is_none()
        );
    }

    #[test]
    fn carry_manifests_preserves_probed_hits_and_misses() {
        // The negative cache. Without carrying a MISS, every refresh would re-pay
        // five raw fetches for each of the (many) manifest-less listings, forever.
        let hit = hydrated("acme/has-manifest", serde_json::json!({ "name": "Has" }));
        let mut miss = repo_item_to_record(&repo("acme/no-manifest", 1), false).unwrap();
        miss.manifest_probed_at = unix_now();
        let previous = vec![hit, miss];

        let mut fresh = vec![
            repo_item_to_record(&repo("ACME/Has-Manifest", 9), false).unwrap(),
            repo_item_to_record(&repo("acme/no-manifest", 2), false).unwrap(),
            repo_item_to_record(&repo("acme/brand-new", 0), false).unwrap(),
        ];
        carry_manifests(&mut fresh, Some(&previous));

        assert_eq!(
            fresh[0].manifest.as_ref().and_then(|m| m.name.as_deref()),
            Some("Has"),
            "a known hit carries over (match is case-insensitive on full_name)"
        );
        assert!(fresh[1].manifest.is_none());
        assert!(
            !fresh[1].manifest_probe_is_due(unix_now()),
            "a known MISS must stay remembered, or the probe never amortizes"
        );
        assert!(
            fresh[2].manifest_probe_is_due(unix_now()),
            "a listing never seen before is due"
        );
    }

    #[test]
    fn a_remembered_probe_expires_so_a_later_manifest_is_picked_up() {
        let now = unix_now();
        let mut record = repo_item_to_record(&repo("acme/thing", 1), false).unwrap();
        record.manifest_probed_at = now;
        assert!(!record.manifest_probe_is_due(now));
        assert!(record.manifest_probe_is_due(now + MANIFEST_PROBE_TTL_SECS));
    }

    #[test]
    fn the_detail_view_lift_scrubs_the_same_fields_the_card_does() {
        let lifted = manifest_display_fields(&serde_json::json!({
            "id": "com.acme.thing",
            "name": "Thing\nInjected",
            "icon": "https://evil.example/x.svg",
            "version": "1.0.0 && curl evil",
        }));
        assert_eq!(lifted["manifestName"], "ThingInjected");
        // A URL in the glyph slot is dropped here exactly as it is on the card —
        // this merge lands ON TOP of the card's sanitized values.
        assert!(lifted.get("icon").is_none());
        assert!(lifted.get("version").is_none());
    }
}
