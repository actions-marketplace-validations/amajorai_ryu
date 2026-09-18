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
const MAX_FINETUNE_ID_CHARS: usize = 128;
const MAX_FINETUNE_RESPONSE_BYTES: usize = 1024 * 1024;

fn valid_finetune_id(id: &str) -> bool {
    !id.is_empty()
        && id.chars().count() <= MAX_FINETUNE_ID_CHARS
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

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

    fn caller_headers(
        request: reqwest::RequestBuilder,
        caller: Option<&crate::identity_verify::VerifiedCaller>,
    ) -> reqwest::RequestBuilder {
        let Some(caller) = caller else {
            return request;
        };
        let request = request.header("x-ryu-caller-user-id", &caller.user_id);
        match caller.org_id.as_deref() {
            Some(org_id) => request.header("x-ryu-caller-org-id", org_id),
            None => request,
        }
    }

    fn client() -> Result<reqwest::Client, String> {
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| format!("finetune HTTP client unavailable: {error}"))
    }

    /// Issue a GET and return the parsed JSON body, mapping any transport error or
    /// non-2xx status to an `Err(String)` carrying the sidecar's error text — the
    /// shape the plugin-host bridge expects.
    async fn get_json(&self, path: &str) -> Result<Value, String> {
        self.get_json_for(path, None).await
    }

    async fn get_json_for(
        &self,
        path: &str,
        caller: Option<&crate::identity_verify::VerifiedCaller>,
    ) -> Result<Value, String> {
        let request = Self::client()?.get(format!("{}{path}", self.base_url()?));
        let resp = Self::caller_headers(request, caller)
            .bearer_auth(self.bearer())
            .send()
            .await
            .map_err(|e| format!("finetune sidecar not reachable: {e}"))?;
        Self::decode(resp).await
    }

    /// Issue a POST with a JSON body and return the parsed JSON body (same error
    /// mapping as [`Self::get_json`]).
    async fn post_json(&self, path: &str, body: Value) -> Result<Value, String> {
        self.post_json_for(path, body, None).await
    }

    async fn post_json_for(
        &self,
        path: &str,
        body: Value,
        caller: Option<&crate::identity_verify::VerifiedCaller>,
    ) -> Result<Value, String> {
        let request = Self::client()?.post(format!("{}{path}", self.base_url()?));
        let resp = Self::caller_headers(request, caller)
            .bearer_auth(self.bearer())
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("finetune sidecar not reachable: {e}"))?;
        Self::decode(resp).await
    }

    /// Issue a DELETE and return the parsed JSON body (same error mapping).
    async fn delete_json(&self, path: &str) -> Result<Value, String> {
        self.delete_json_for(path, None).await
    }

    async fn delete_json_for(
        &self,
        path: &str,
        caller: Option<&crate::identity_verify::VerifiedCaller>,
    ) -> Result<Value, String> {
        let request = Self::client()?.delete(format!("{}{path}", self.base_url()?));
        let resp = Self::caller_headers(request, caller)
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
        if resp
            .content_length()
            .is_some_and(|length| length > MAX_FINETUNE_RESPONSE_BYTES as u64)
        {
            return Err(format!(
                "finetune sidecar response exceeds {MAX_FINETUNE_RESPONSE_BYTES} bytes"
            ));
        }
        let bytes = resp
            .bytes()
            .await
            .map_err(|error| format!("finetune sidecar response could not be read: {error}"))?;
        if bytes.len() > MAX_FINETUNE_RESPONSE_BYTES {
            return Err(format!(
                "finetune sidecar response exceeds {MAX_FINETUNE_RESPONSE_BYTES} bytes"
            ));
        }
        let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
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

    pub async fn list_for(
        &self,
        caller: Option<&crate::identity_verify::VerifiedCaller>,
    ) -> Result<Value, String> {
        self.get_json_for("/list", caller).await
    }

    /// `GET /adapters` — installed merged-adapter GGUFs.
    pub async fn adapters(&self) -> Result<Value, String> {
        self.get_json("/adapters").await
    }

    pub async fn adapters_for(
        &self,
        caller: Option<&crate::identity_verify::VerifiedCaller>,
    ) -> Result<Value, String> {
        self.get_json_for("/adapters", caller).await
    }

    /// `POST /start` — start a fine-tune job (local GPU or remote node).
    pub async fn start(&self, body: Value) -> Result<Value, String> {
        self.post_json("/start", body).await
    }

    pub async fn start_for(
        &self,
        body: Value,
        caller: Option<&crate::identity_verify::VerifiedCaller>,
    ) -> Result<Value, String> {
        self.post_json_for("/start", body, caller).await
    }

    /// `POST /merge` — merge a trained adapter into a base model + register the GGUF.
    pub async fn merge(&self, body: Value) -> Result<Value, String> {
        self.post_json("/merge", body).await
    }

    pub async fn merge_for(
        &self,
        body: Value,
        caller: Option<&crate::identity_verify::VerifiedCaller>,
    ) -> Result<Value, String> {
        self.post_json_for("/merge", body, caller).await
    }

    /// `GET /:id` — one job's durable record.
    pub async fn get(&self, id: &str) -> Result<Value, String> {
        self.get_for(id, None).await
    }

    pub async fn get_for(
        &self,
        id: &str,
        caller: Option<&crate::identity_verify::VerifiedCaller>,
    ) -> Result<Value, String> {
        let id = id.trim();
        if !valid_finetune_id(id) {
            return Err("finetune job id contains invalid characters".to_owned());
        }
        self.get_json_for(&format!("/{id}"), caller).await
    }

    /// `DELETE /:id` — cancel a running/pending job.
    pub async fn cancel(&self, id: &str) -> Result<Value, String> {
        self.cancel_for(id, None).await
    }

    pub async fn cancel_for(
        &self,
        id: &str,
        caller: Option<&crate::identity_verify::VerifiedCaller>,
    ) -> Result<Value, String> {
        let id = id.trim();
        if !valid_finetune_id(id) {
            return Err("finetune job id contains invalid characters".to_owned());
        }
        self.delete_json_for(&format!("/{id}"), caller).await
    }

    /// `GET /:id/stream` — proxy the sidecar's `text/event-stream` progress frames
    /// through verbatim as an axum response. Used by the plugin-host streaming
    /// bridge (`finetune.stream`) and the equivalent HTTP surface. The sidecar owns
    /// the local-vs-remote source decision, so this is a straight passthrough.
    pub async fn stream(&self, id: &str) -> Response {
        self.stream_for(id, None).await
    }

    pub async fn stream_for(
        &self,
        id: &str,
        caller: Option<&crate::identity_verify::VerifiedCaller>,
    ) -> Response {
        let id = id.trim();
        if !valid_finetune_id(id) {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "finetune job id contains invalid characters" })),
            )
                .into_response();
        }
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
        let client = match Self::client() {
            Ok(client) => client,
            Err(error) => {
                return (
                    StatusCode::SERVICE_UNAVAILABLE,
                    Json(json!({ "error": error })),
                )
                    .into_response();
            }
        };
        let request = Self::caller_headers(client.get(&url), caller);
        let resp = request.bearer_auth(self.bearer()).send().await;
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
