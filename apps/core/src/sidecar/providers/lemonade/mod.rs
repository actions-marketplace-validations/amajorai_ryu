//! Lemonade Server is externally managed: Ryu adopts its loopback API, while
//! Lemonade owns installation, acceleration backends, and model storage.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use anyhow::Context;
use serde::Deserialize;

use crate::sidecar::{BoxFuture, HealthStatus, Sidecar};

pub const ENGINE_NAME: &str = "lemonade";
/// External service port, intentionally not shifted by the Ryu profile.
pub const BASE_URL: &str = "http://127.0.0.1:13305";
const SETUP_HINT: &str = "Install and start Lemonade Server from https://lemonade-server.ai/ on this node, with its local API at http://127.0.0.1:13305, then try Add again. Manage model downloads in Lemonade. For a custom address or API key, use an OpenAI-compatible provider in Settings.";

#[derive(Deserialize)]
struct ServerHealth {
    status: String,
    version: String,
}

#[derive(Deserialize)]
struct ModelList {
    data: Vec<Model>,
}

#[derive(Deserialize)]
struct Model {
    id: String,
    #[serde(default)]
    recipe: String,
    #[serde(default)]
    labels: Vec<String>,
    downloaded: Option<bool>,
    #[serde(default)]
    embedding: bool,
    #[serde(default)]
    reranking: bool,
}

impl Model {
    fn is_chat(&self) -> bool {
        if self.downloaded == Some(false) || self.embedding || self.reranking {
            return false;
        }
        if self.labels.iter().any(|label| {
            matches!(
                label.as_str(),
                "transcription"
                    | "embeddings"
                    | "embedding"
                    | "reranking"
                    | "image"
                    | "tts"
                    | "audio-generation"
                    | "classification"
                    | "classifier"
                    | "3d"
            )
        }) {
            return false;
        }
        self.labels.iter().any(|label| label == "chat")
            || matches!(
                self.recipe.as_str(),
                "llamacpp" | "flm" | "ryzenai-llm" | "oga" | "vllm" | "collection.omni"
            )
    }
}

pub struct LemonadeManager {
    adopted: Arc<AtomicBool>,
    client: reqwest::Client,
    base_url: String,
}

impl LemonadeManager {
    pub fn new() -> Self {
        Self {
            adopted: Arc::new(AtomicBool::new(false)),
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(3))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .expect("Lemonade HTTP client"),
            base_url: BASE_URL.to_owned(),
        }
    }

    async fn probe(client: &reqwest::Client, base_url: &str) -> anyhow::Result<()> {
        let health = client
            .get(format!("{base_url}/v1/health"))
            .send()
            .await?
            .error_for_status()?
            .json::<ServerHealth>()
            .await?;
        anyhow::ensure!(
            health.status == "ok" && !health.version.trim().is_empty(),
            "Lemonade is not healthy"
        );
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
                    name: id.to_owned(),
                })
            })
            .collect())
    }
}

impl Default for LemonadeManager {
    fn default() -> Self {
        Self::new()
    }
}

impl Sidecar for LemonadeManager {
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
            tracing::info!("Lemonade Server adopted for local inference");
            Ok(())
        })
    }

    fn stop(&self) -> BoxFuture<anyhow::Result<()>> {
        let adopted = Arc::clone(&self.adopted);
        Box::pin(async move {
            adopted.store(false, Ordering::Relaxed);
            tracing::info!("Lemonade detached; externally managed server left running");
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
                return HealthStatus::Unhealthy("Lemonade is not active in Ryu".to_owned());
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
