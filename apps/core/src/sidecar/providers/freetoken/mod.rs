//! freetoken is externally managed: Ryu adopts its loopback API, while
//! FreeToken owns its CUDA runtime, loaded model, and model files.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use anyhow::Context;
use serde::Deserialize;

use crate::sidecar::{BoxFuture, HealthStatus, Sidecar};

pub const ENGINE_NAME: &str = "freetoken";
/// FreeToken's external API default. Not profile-shifted because Ryu does not spawn it.
pub const BASE_URL: &str = "http://127.0.0.1:1919";
const SETUP_HINT: &str = "Install FreeToken on a supported Windows/Linux x86_64 NVIDIA node, load a model, and enable its local API at http://127.0.0.1:1919. For the CLI, use ft serve --model /path/to/model --host 127.0.0.1 --port 1919. Then try Add again. For a remote URL or API key, configure an OpenAI-compatible provider in Settings.";
const PLATFORM_HINT: &str = "FreeToken requires a Windows/Linux x86_64 node with a supported NVIDIA GPU; there is no native macOS runtime. Connect Ryu to a supported node or use a remote OpenAI-compatible provider.";

#[derive(Deserialize)]
struct ServerHealth {
    status: String,
    #[serde(default)]
    maintenance: Option<String>,
}

#[derive(Deserialize)]
struct ModelList {
    data: Vec<Model>,
}

#[derive(Deserialize)]
struct Model {
    id: String,
    #[serde(default)]
    owned_by: String,
}

pub struct FreeTokenManager {
    adopted: Arc<AtomicBool>,
    client: reqwest::Client,
    base_url: String,
    supported: bool,
}

impl FreeTokenManager {
    pub fn new() -> Self {
        Self {
            adopted: Arc::new(AtomicBool::new(false)),
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(3))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .expect("freetoken HTTP client"),
            base_url: BASE_URL.to_owned(),
            supported: crate::catalog::registry::supported_on_node(ENGINE_NAME),
        }
    }

    async fn probe(client: &reqwest::Client, base_url: &str) -> anyhow::Result<()> {
        let response = client.get(format!("{base_url}/health")).send().await?;
        anyhow::ensure!(
            response.status().is_success(),
            "FreeToken health endpoint is unavailable"
        );
        let health = response.json::<ServerHealth>().await?;
        anyhow::ensure!(
            health.status == "ok",
            "FreeToken has not finished loading or reported an error"
        );
        anyhow::ensure!(
            health
                .maintenance
                .as_deref()
                .is_none_or(|state| state == "serving"),
            "FreeToken is undergoing maintenance and cannot serve chat yet"
        );
        let models = Self::fetch_models(client, base_url).await?;
        anyhow::ensure!(!models.is_empty(), "FreeToken has no served model");
        Ok(())
    }

    async fn fetch_models(
        client: &reqwest::Client,
        base_url: &str,
    ) -> anyhow::Result<Vec<crate::sidecar::adapters::EngineModel>> {
        let response = client.get(format!("{base_url}/v1/models")).send().await?;
        anyhow::ensure!(
            response.status().is_success(),
            "FreeToken models endpoint is unavailable or requires authentication"
        );
        let list = response.json::<ModelList>().await?;
        let mut seen = std::collections::HashSet::new();
        Ok(list
            .data
            .into_iter()
            .filter_map(|model| {
                let id = model.id.trim();
                if id.is_empty()
                    || !model.owned_by.eq_ignore_ascii_case("freetoken")
                    || !seen.insert(id.to_owned())
                {
                    return None;
                }
                Some(crate::sidecar::adapters::EngineModel {
                    id: id.to_owned(),
                    name: id.to_owned(),
                })
            })
            .collect())
    }

    pub async fn ensure_available(&self) -> anyhow::Result<()> {
        anyhow::ensure!(self.supported, PLATFORM_HINT);
        Self::probe(&self.client, &self.base_url)
            .await
            .context(SETUP_HINT)
    }

    pub async fn install(&self) -> anyhow::Result<String> {
        self.ensure_available().await?;
        crate::sidecar::download_manager::VersionStore::set_version_persisted(
            ENGINE_NAME,
            "adopted",
        )?;
        Ok("adopted".to_owned())
    }

    pub async fn chat_models(&self) -> anyhow::Result<Vec<crate::sidecar::adapters::EngineModel>> {
        anyhow::ensure!(self.supported, PLATFORM_HINT);
        Self::fetch_models(&self.client, &self.base_url).await
    }
}

impl Default for FreeTokenManager {
    fn default() -> Self {
        Self::new()
    }
}

impl Sidecar for FreeTokenManager {
    fn name(&self) -> &str {
        ENGINE_NAME
    }
    fn is_required(&self) -> bool {
        false
    }

    fn start(&self) -> BoxFuture<anyhow::Result<()>> {
        let adopted = Arc::clone(&self.adopted);
        let client = self.client.clone();
        let base_url = self.base_url.clone();
        let supported = self.supported;
        Box::pin(async move {
            anyhow::ensure!(supported, PLATFORM_HINT);
            let result = Self::probe(&client, &base_url).await.context(SETUP_HINT);
            adopted.store(result.is_ok(), Ordering::Relaxed);
            result?;
            tracing::info!("freetoken adopted for local inference");
            Ok(())
        })
    }

    fn stop(&self) -> BoxFuture<anyhow::Result<()>> {
        let adopted = Arc::clone(&self.adopted);
        Box::pin(async move {
            adopted.store(false, Ordering::Relaxed);
            tracing::info!("freetoken detached; externally managed server left running");
            Ok(())
        })
    }

    fn health_check(&self) -> BoxFuture<HealthStatus> {
        let adopted = Arc::clone(&self.adopted);
        let client = self.client.clone();
        let base_url = self.base_url.clone();
        Box::pin(async move {
            // A stopped engine must not be re-adopted by the health monitor.
            if !adopted.load(Ordering::Relaxed) {
                return HealthStatus::Unhealthy("freetoken is not active in Ryu".to_owned());
            }
            match Self::probe(&client, &base_url).await {
                Ok(()) => HealthStatus::Healthy,
                Err(_) => {
                    adopted.store(false, Ordering::Relaxed);
                    HealthStatus::Unhealthy(SETUP_HINT.to_owned())
                }
            }
        })
    }

    fn is_running(&self) -> bool {
        self.adopted.load(Ordering::Relaxed)
    }

    fn uninstall(&self, _delete_data: bool) -> BoxFuture<anyhow::Result<()>> {
        let adopted = Arc::clone(&self.adopted);
        Box::pin(async move {
            adopted.store(false, Ordering::Relaxed);
            crate::sidecar::remove_from_version_store(ENGINE_NAME);
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests;
