//! llama-swap is externally managed: Ryu adopts its loopback API, while
//! llama-swap owns its YAML configuration, backend commands, and model swapping.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use anyhow::Context;
use serde::Deserialize;

use crate::sidecar::{BoxFuture, HealthStatus, Sidecar};

pub const ENGINE_NAME: &str = "llama-swap";
/// Dedicated external endpoint, avoiding llama.cpp's :8080. Not profile-shifted.
pub const BASE_URL: &str = "http://127.0.0.1:9292";
const SETUP_HINT: &str = "Install and configure llama-swap from https://github.com/mostlygeek/llama-swap, then start it with --listen 127.0.0.1:9292 --config /path/to/config.yaml and try Add again. Models and backend commands stay in llama-swap. For another address or an API key, use an OpenAI-compatible provider in Settings.";

#[derive(Deserialize)]
struct ModelList {
    data: Vec<Model>,
}

#[derive(Deserialize, Default)]
struct Architecture {
    #[serde(default)]
    input_modalities: Vec<String>,
    #[serde(default)]
    output_modalities: Vec<String>,
}

#[derive(Deserialize, Default)]
struct Capabilities {
    #[serde(default)]
    reranker: bool,
}

#[derive(Deserialize)]
struct Model {
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    architecture: Architecture,
    #[serde(default)]
    capabilities: Capabilities,
}

impl Model {
    fn is_chat(&self) -> bool {
        // Older configurations omit capabilities entirely. Keep their IDs usable,
        // but do not offer explicitly image/audio-only or reranking models as chat.
        !self.capabilities.reranker
            && (self.architecture.input_modalities.is_empty()
                || self
                    .architecture
                    .input_modalities
                    .iter()
                    .any(|m| m == "text"))
            && (self.architecture.output_modalities.is_empty()
                || self
                    .architecture
                    .output_modalities
                    .iter()
                    .any(|m| m == "text"))
    }
}

pub struct LlamaSwapManager {
    adopted: Arc<AtomicBool>,
    client: reqwest::Client,
    base_url: String,
}

impl LlamaSwapManager {
    pub fn new() -> Self {
        Self {
            adopted: Arc::new(AtomicBool::new(false)),
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(3))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .expect("llama-swap HTTP client"),
            base_url: BASE_URL.to_owned(),
        }
    }

    async fn probe(client: &reqwest::Client, base_url: &str) -> anyhow::Result<()> {
        let health = client
            .get(format!("{base_url}/health"))
            .send()
            .await?
            .error_for_status()?
            .text()
            .await?;
        anyhow::ensure!(health.trim() == "OK", "llama-swap is not healthy");
        // Health alone can succeed while inference endpoints require an API key.
        client
            .get(format!("{base_url}/v1/models"))
            .send()
            .await?
            .error_for_status()?
            .json::<ModelList>()
            .await?;
        Ok(())
    }

    pub async fn ensure_available(&self) -> anyhow::Result<()> {
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
        let response = self
            .client
            .get(format!("{}/v1/models", self.base_url))
            .send()
            .await?
            .error_for_status()?
            .json::<ModelList>()
            .await?;
        let mut seen = std::collections::HashSet::new();
        Ok(response
            .data
            .into_iter()
            .filter_map(|entry| {
                let id = entry.id.trim();
                if id.is_empty() || !entry.is_chat() || !seen.insert(id.to_owned()) {
                    return None;
                }
                Some(crate::sidecar::adapters::EngineModel {
                    id: id.to_owned(),
                    name: if entry.name.trim().is_empty() {
                        id.to_owned()
                    } else {
                        entry.name.trim().to_owned()
                    },
                })
            })
            .collect())
    }
}

impl Default for LlamaSwapManager {
    fn default() -> Self {
        Self::new()
    }
}

impl Sidecar for LlamaSwapManager {
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
        Box::pin(async move {
            let result = Self::probe(&client, &base_url).await.context(SETUP_HINT);
            adopted.store(result.is_ok(), Ordering::Relaxed);
            result?;
            tracing::info!("llama-swap adopted for local inference");
            Ok(())
        })
    }

    fn stop(&self) -> BoxFuture<anyhow::Result<()>> {
        let adopted = Arc::clone(&self.adopted);
        Box::pin(async move {
            adopted.store(false, Ordering::Relaxed);
            tracing::info!("llama-swap detached; externally managed server left running");
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
                return HealthStatus::Unhealthy("llama-swap is not active in Ryu".to_owned());
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
