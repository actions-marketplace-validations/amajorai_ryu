// apps/core/src/catalog/mod.rs

pub mod cache;
pub mod github;
pub mod npm;
pub mod registry;

use crate::sidecar::download_manager::VersionStore;
use crate::sidecar::install_state::{InstallState, InstallStatusStore};
use cache::VersionCache;
use registry::{required_platforms, static_registry, supported_on_node, SidecarSource};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Serialize)]
pub struct CatalogItem {
    pub name: String,
    pub display_name: String,
    pub description: String,
    pub category: String,
    pub deprecated: bool,
    pub recommended: bool,
    pub latest_version: Option<String>,
    pub installed_version: Option<String>,
    pub install_state: String,
    /// OS families this entry can run on (e.g. `["macos"]`). Empty = every
    /// platform. Display hint for clients (e.g. a "macOS only" badge).
    pub platforms: Vec<String>,
    /// Whether THIS Core node can actually run/install the entry given its own OS
    /// and CPU arch. Authoritative: a client (which may be a remote desktop) must
    /// disable install/enable when this is `false`, regardless of its own OS.
    pub supported: bool,
    /// Whether a reinstall would actually move this entry to a newer build.
    ///
    /// Computed HERE rather than client-side (`installed != latest`) because only
    /// the node knows what its installers can deliver: a pinned downloader can
    /// never reach upstream's newest tag, and several installers record a
    /// sentinel ("latest", "adopted") that is not a version at all. Both cases
    /// used to render an Update button that could not work. Clients render this
    /// flag; they do not re-derive it.
    pub update_available: bool,
}

pub struct CatalogManager {
    client: reqwest::Client,
    cache: Arc<Mutex<VersionCache>>,
}

impl CatalogManager {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
            cache: Arc::new(Mutex::new(VersionCache::load())),
        }
    }

    pub async fn get_catalog(&self, install_status: &InstallStatusStore) -> Vec<CatalogItem> {
        let versions = self.resolve_versions().await;
        let install_states = install_status.get_all().await;
        let version_store = VersionStore::load();

        self.get_catalog_from_parts(versions, install_states, &version_store)
    }

    fn get_catalog_from_parts(
        &self,
        versions: HashMap<String, String>,
        install_states: HashMap<String, InstallState>,
        version_store: &VersionStore,
    ) -> Vec<CatalogItem> {
        static_registry()
            .into_iter()
            .map(|entry| {
                // A pinned installer can only ever deliver its pin, so that — not
                // upstream's newest tag — is this entry's latest version.
                let latest_version = registry::installer_pin(entry.name)
                    .map(str::to_string)
                    .or_else(|| versions.get(entry.name).cloned());
                let raw_state = install_states
                    .get(entry.name)
                    .cloned()
                    .unwrap_or(InstallState::NotInstalled);

                let (install_state, installed_version) = match &raw_state {
                    InstallState::Installing { .. } => ("installing".to_string(), None),
                    InstallState::Failed { .. } => ("failed".to_string(), None),
                    InstallState::Installed { version, .. } => {
                        // Several install arms have no version to report and hand
                        // back a marker like "installed". Taking that literally made
                        // the row read `installed → b10218` and claim an update
                        // forever after a same-session install. `versions.json` is
                        // the durable record and holds the real tag, so prefer it
                        // whenever the in-session value isn't a version.
                        let resolved = if registry::is_comparable_version(version) {
                            Some(version.clone())
                        } else {
                            version_store.versions.get(entry.name).cloned()
                        };
                        ("installed".to_string(), resolved)
                    }
                    InstallState::NotInstalled => {
                        // Installed in a previous core session — check versions.json
                        if let Some(v) = version_store.versions.get(entry.name) {
                            ("installed".to_string(), Some(v.clone()))
                        } else {
                            ("not_installed".to_string(), None)
                        }
                    }
                };

                let supported = supported_on_node(entry.name);
                // Only claim an update when a reinstall could actually deliver a
                // different build: both versions must be real (not a sentinel a
                // PATH-adopting installer wrote), the entry must be installed on a
                // node that can install it, and it must not be deprecated.
                let update_available = install_state == "installed"
                    && !entry.deprecated
                    && supported
                    && match (installed_version.as_deref(), latest_version.as_deref()) {
                        (Some(installed), Some(latest)) => {
                            registry::is_comparable_version(installed)
                                && registry::is_comparable_version(latest)
                                && installed != latest
                        }
                        _ => false,
                    };

                CatalogItem {
                    name: entry.name.to_string(),
                    display_name: entry.display_name.to_string(),
                    description: entry.description.to_string(),
                    category: entry.category.as_str().to_string(),
                    deprecated: entry.deprecated,
                    recommended: entry.recommended,
                    latest_version,
                    installed_version,
                    install_state,
                    platforms: required_platforms(entry.name)
                        .iter()
                        .map(|p| (*p).to_string())
                        .collect(),
                    supported,
                    update_available,
                }
            })
            .collect()
    }

    /// Returns latest versions from cache, fetching from remote if stale.
    async fn resolve_versions(&self) -> HashMap<String, String> {
        let mut cache = self.cache.lock().await;
        if cache.is_fresh() {
            return cache.versions.clone();
        }

        // Fetch versions for github and npm sources concurrently
        let entries = static_registry();
        let mut tasks = Vec::new();

        for entry in &entries {
            let client = self.client.clone();
            let name = entry.name.to_string();
            let source = entry.source.clone();
            tasks.push(tokio::spawn(async move {
                let version = match source {
                    SidecarSource::Github { repo } => {
                        github::fetch_latest_version(&client, repo).await.ok()
                    }
                    SidecarSource::Npm { package } => {
                        npm::fetch_latest_version(&client, package).await.ok()
                    }
                    // Docker and Pip version resolution not yet implemented
                    _ => None,
                };
                (name, version)
            }));
        }

        let mut versions = cache.versions.clone();
        for task in tasks {
            if let Ok((name, Some(version))) = task.await {
                versions.insert(name, version);
            }
        }

        cache.versions = versions.clone();
        cache.mark_fresh();
        let _ = cache.save();

        versions
    }
}

impl Default for CatalogManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sidecar::install_state::InstallStatusStore;

    #[tokio::test]
    async fn get_catalog_returns_all_entries() {
        let manager = CatalogManager::new();
        let store = InstallStatusStore::new();
        let items = manager.get_catalog_from_parts(
            manager.resolve_versions().await,
            store.get_all().await,
            &VersionStore::default(),
        );
        // get_catalog is a 1:1 map of the static registry (no filtering), so the
        // counts must stay in lock-step — assert against the registry length
        // rather than a magic number that drifts when entries are added.
        assert_eq!(items.len(), super::registry::static_registry().len());
    }

    #[tokio::test]
    async fn mlx_is_platform_gated() {
        let manager = CatalogManager::new();
        let store = InstallStatusStore::new();
        let items = manager.get_catalog(&store).await;
        let mlx = items.iter().find(|i| i.name == "mlx").unwrap();
        // Display hint always present; the node-computed `supported` flag matches
        // whether this build targets Apple Silicon.
        assert_eq!(mlx.platforms, vec!["macos".to_string()]);
        let apple_silicon = cfg!(target_os = "macos") && cfg!(target_arch = "aarch64");
        assert_eq!(mlx.supported, apple_silicon);

        // Unconstrained engines are supported on every node.
        let llamacpp = items.iter().find(|i| i.name == "llamacpp").unwrap();
        assert!(llamacpp.platforms.is_empty());
        assert!(llamacpp.supported);
    }

    #[tokio::test]
    async fn not_installed_sidecar_has_correct_state() {
        let manager = CatalogManager::new();
        let store = InstallStatusStore::new();
        let items = manager.get_catalog(&store).await;
        let zeroclaw = items.iter().find(|i| i.name == "zeroclaw").unwrap();
        // In test environment, nothing is installed via InstallStatusStore
        assert!(zeroclaw.install_state == "not_installed" || zeroclaw.install_state == "installed");
    }

    #[tokio::test]
    async fn installing_state_propagates() {
        let manager = CatalogManager::new();
        let store = InstallStatusStore::new();
        store.set_installing("ghost").await;
        let items = manager.get_catalog(&store).await;
        let ghost = items.iter().find(|i| i.name == "ghost").unwrap();
        assert_eq!(ghost.install_state, "installing");
    }

    #[tokio::test]
    async fn pinned_engines_report_the_version_they_can_deliver() {
        let manager = CatalogManager::new();
        let store = InstallStatusStore::new();
        let items = manager.get_catalog(&store).await;
        // llama.cpp's download URL is built from the compile-time pin, so the
        // catalog must advertise the pin — never GitHub's newest tag, which the
        // installer cannot reach. Advertising upstream produced a permanent
        // "update available" row whose Update button was a no-op.
        let llamacpp = items.iter().find(|i| i.name == "llamacpp").unwrap();
        assert_eq!(
            llamacpp.latest_version.as_deref(),
            Some(crate::sidecar::providers::llamacpp::downloader::TARGET_VERSION)
        );
    }

    #[tokio::test]
    async fn pinned_engine_at_its_pin_has_no_update() {
        let manager = CatalogManager::new();
        let store = InstallStatusStore::new();
        store
            .set_installed(
                "llamacpp",
                crate::sidecar::providers::llamacpp::downloader::TARGET_VERSION.to_string(),
            )
            .await;
        let items = manager.get_catalog(&store).await;
        let llamacpp = items.iter().find(|i| i.name == "llamacpp").unwrap();
        assert_eq!(llamacpp.install_state, "installed");
        assert!(
            !llamacpp.update_available,
            "an engine already at the only version its installer can deliver must not \
             advertise an update"
        );
    }

    #[tokio::test]
    async fn pinned_engine_behind_its_pin_has_an_update() {
        let manager = CatalogManager::new();
        let store = InstallStatusStore::new();
        // An older pin from a previous Ryu build: a reinstall genuinely moves it.
        store.set_installed("llamacpp", "b0001".to_string()).await;
        let items = manager.get_catalog(&store).await;
        let llamacpp = items.iter().find(|i| i.name == "llamacpp").unwrap();
        assert!(llamacpp.update_available);
    }

    #[tokio::test]
    async fn sentinel_installed_version_never_advertises_an_update() {
        let manager = CatalogManager::new();
        let store = InstallStatusStore::new();
        // Installers that PATH-adopt or brew-install record a sentinel rather than
        // a version. Comparing it to anything always "differs", which used to
        // advertise an update that no reinstall could clear.
        store.set_installed("ghost", "latest".to_string()).await;
        let items = manager.get_catalog(&store).await;
        let ghost = items.iter().find(|i| i.name == "ghost").unwrap();
        // The sentinel is never presented as a version — it resolves to the
        // durable record, or to nothing when there isn't one.
        assert_ne!(ghost.installed_version.as_deref(), Some("latest"));
        assert!(!ghost.update_available);
    }

    #[tokio::test]
    async fn a_marker_install_status_falls_back_to_the_durable_version() {
        let manager = CatalogManager::new();
        let store = InstallStatusStore::new();
        // What a same-session llama.cpp install actually records: its downloader
        // returns no version, so the status carries the marker "installed". Taken
        // literally that reads as a version and permanently claims an update.
        store
            .set_installed("llamacpp", "installed".to_string())
            .await;
        // This test is about the marker fallback, not the user's persisted
        // profile. Keep it hermetic when the suite runs on a developer machine
        // that already has a llamacpp entry in versions.json.
        let items = manager.get_catalog_from_parts(
            manager.resolve_versions().await,
            store.get_all().await,
            &VersionStore::default(),
        );
        let llamacpp = items.iter().find(|i| i.name == "llamacpp").unwrap();
        assert_ne!(llamacpp.installed_version.as_deref(), Some("installed"));
        assert!(!llamacpp.update_available);
    }

    #[test]
    fn sentinels_are_not_comparable_versions() {
        for sentinel in ["latest", "adopted", "brew", "pip-git", "unknown", ""] {
            assert!(!super::registry::is_comparable_version(sentinel));
        }
        for version in ["b10218", "v1.8.6", "0.0.5"] {
            assert!(super::registry::is_comparable_version(version));
        }
    }

    #[tokio::test]
    async fn installed_state_propagates_with_version() {
        let manager = CatalogManager::new();
        let store = InstallStatusStore::new();
        store.set_installed("ghost", "1.5.0".to_string()).await;
        let items = manager.get_catalog(&store).await;
        let ghost = items.iter().find(|i| i.name == "ghost").unwrap();
        assert_eq!(ghost.install_state, "installed");
        assert_eq!(ghost.installed_version, Some("1.5.0".to_string()));
    }
}
