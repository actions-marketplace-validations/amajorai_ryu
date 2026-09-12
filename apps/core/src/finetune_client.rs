//! Core-side typed HTTP client for the out-of-process `ryu-finetune` sidecar.
//!
//! Fine-tuning used to live in an in-process surface (`server/finetune.rs`) that
//! read Core's `ryu_finetune::FinetuneStore` field on `ServerState` and drove the
//! Python `unsloth` worker directly. Fine-tuning is now an out-of-process app
//! (`@ryu/finetune`): the `ryu-finetune` sidecar owns `finetune.db`, gates local
//! training on the GPU, drives the Python worker over `RYU_UNSLOTH_URL`, and serves
//! `/api/finetune/*` — which Core exposes verbatim through the generic ext-proxy
//! `public_mount`. Core's remaining reverse-coupling is the plugin-host bridge
//! (`host.finetune_*`, how the sandboxed `@ryu/finetune` companion drives runs):
//! it reaches the sidecar over loopback HTTP through this client instead of touching
//! an in-process store, so the sidecar is the single owner of `finetune.db`.
//!
//! Security mirrors the ext-proxy hop exactly: loopback target on the sidecar's
//! live manager-owned port, with the
//! per-plugin minted bearer ([`crate::sidecar::ext_proxy::ext_token`]) the sidecar
//! was spawned with — nothing hardcoded.

use axum::{
    body::Body,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};

use crate::plugin_manifest::FINETUNE_PLUGIN_ID;
use crate::sidecar::ext_proxy::{ext_token, node_token};

/// The `ryu-finetune` sidecar's name inside the Fine-tuning manifest — the other half
/// of the `(plugin id, sidecar name)` key the port resolves through. Note the manifest
/// ALSO declares the Python `unsloth` worker; keying on the name is what keeps this
/// pointed at the Rust sidecar rather than the worker.
const FINETUNE_SIDECAR: &str = "ryu-finetune";

/// Typed loopback client for the `ryu-finetune` sidecar. Cheap to clone (holds only
/// the manager); the bearer is minted per call so it always tracks the current
/// node token.
#[derive(Clone)]
pub struct FinetuneClient {
    manager: std::sync::Arc<crate::sidecar::SidecarManager>,
}

impl FinetuneClient {
    /// Build a client that resolves the manager's live target before each request.
    pub fn new(manager: std::sync::Arc<crate::sidecar::SidecarManager>) -> Self {
        Self { manager }
    }

    fn base_url(&self) -> std::result::Result<String, String> {
        self.manager
            .sidecar_base_url(FINETUNE_PLUGIN_ID, FINETUNE_SIDECAR)
            .map(|url| format!("{url}/api/finetune"))
            .map_err(|denied| denied.reason())
    }

    /// The per-plugin minted bearer the sidecar was spawned with — the same value
    /// the ext-proxy stamps on its hop, so a hand-rolled local request without it is
    /// rejected fail-closed.
    fn bearer(&self) -> String {
        ext_token(node_token().as_deref(), FINETUNE_PLUGIN_ID)
    }

    /// Issue a GET and return the parsed JSON body, mapping any transport error or
    /// non-2xx status to an `Err(String)` carrying the sidecar's error text — the
    /// shape the plugin-host bridge expects.
    async fn get_json(&self, path: &str) -> Result<Value, String> {
        let resp = reqwest::Client::new()
            .get(format!("{}{path}", self.base_url()?))
            .bearer_auth(self.bearer())
            .send()
            .await
            .map_err(|e| format!("finetune sidecar not reachable: {e}"))?;
        Self::decode(resp).await
    }

    /// Issue a POST with a JSON body and return the parsed JSON body (same error
    /// mapping as [`Self::get_json`]).
    async fn post_json(&self, path: &str, body: Value) -> Result<Value, String> {
        let resp = reqwest::Client::new()
            .post(format!("{}{path}", self.base_url()?))
            .bearer_auth(self.bearer())
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("finetune sidecar not reachable: {e}"))?;
        Self::decode(resp).await
    }

    /// Issue a DELETE and return the parsed JSON body (same error mapping).
    async fn delete_json(&self, path: &str) -> Result<Value, String> {
        let resp = reqwest::Client::new()
            .delete(format!("{}{path}", self.base_url()?))
            .bearer_auth(self.bearer())
            .send()
            .await
            .map_err(|e| format!("finetune sidecar not reachable: {e}"))?;
        Self::decode(resp).await
    }

    /// Turn a response into `Ok(body)` on 2xx or `Err(error_text)` otherwise,
    /// preferring the sidecar's `{"error": ...}` field when present.
    async fn decode(resp: reqwest::Response) -> Result<Value, String> {
        let status = resp.status();
        let body: Value = resp.json().await.unwrap_or(Value::Null);
        if status.is_success() {
            return Ok(body);
        }
        let msg = body
            .get("error")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .unwrap_or_else(|| format!("finetune sidecar returned {status}"));
        Err(msg)
    }

    /// `GET /capability` — local-training capability verdict (GPU gate).
    pub async fn capability(&self) -> Result<Value, String> {
        self.get_json("/capability").await
    }

    /// `GET /list` — the durable job list.
    pub async fn list(&self) -> Result<Value, String> {
        self.get_json("/list").await
    }

    /// `GET /adapters` — installed merged-adapter GGUFs.
    pub async fn adapters(&self) -> Result<Value, String> {
        self.get_json("/adapters").await
    }

    /// `POST /start` — start a fine-tune job (local GPU or remote node).
    pub async fn start(&self, body: Value) -> Result<Value, String> {
        self.post_json("/start", body).await
    }

    /// `POST /merge` — merge a trained adapter into a base model + register the GGUF.
    pub async fn merge(&self, body: Value) -> Result<Value, String> {
        self.post_json("/merge", body).await
    }

    /// `GET /:id` — one job's durable record.
    pub async fn get(&self, id: &str) -> Result<Value, String> {
        self.get_json(&format!("/{id}")).await
    }

    /// `DELETE /:id` — cancel a running/pending job.
    pub async fn cancel(&self, id: &str) -> Result<Value, String> {
        self.delete_json(&format!("/{id}")).await
    }

    /// `GET /:id/stream` — proxy the sidecar's `text/event-stream` progress frames
    /// through verbatim as an axum response. Used by the plugin-host streaming
    /// bridge (`finetune.stream`) and the equivalent HTTP surface. The sidecar owns
    /// the local-vs-remote source decision, so this is a straight passthrough.
    pub async fn stream(&self, id: &str) -> Response {
        let base_url = match self.base_url() {
            Ok(url) => url,
            Err(error) => {
                return (
                    StatusCode::SERVICE_UNAVAILABLE,
                    Json(json!({ "error": error })),
                )
                    .into_response()
            }
        };
        let url = format!("{base_url}/{id}/stream");
        let resp = reqwest::Client::new()
            .get(&url)
            .bearer_auth(self.bearer())
            .send()
            .await;
        match resp {
            Ok(r) if r.status().is_success() => Response::builder()
                .header(header::CONTENT_TYPE, "text/event-stream")
                .header(header::CACHE_CONTROL, "no-cache")
                .body(Body::from_stream(r.bytes_stream()))
                .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response()),
            Ok(r) => (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "error": format!("finetune stream returned {}", r.status()) })),
            )
                .into_response(),
            Err(e) => (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "error": format!("finetune source not reachable: {e}") })),
            )
                .into_response(),
        }
    }
}
