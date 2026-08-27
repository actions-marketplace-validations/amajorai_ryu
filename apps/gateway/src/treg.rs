//! Treg's provider-neutral HTTP client for the Gateway tool plane.
//!
//! Discovery is public catalog metadata; execution is authenticated with the
//! fleet's vaulted Treg token. The client preserves the provider response cost
//! and transaction headers so the billing path can charge the exact call.

use std::fmt;

use anyhow::{Context, Result};
use reqwest::{Client, Method, StatusCode};
use serde_json::Value;

use crate::config::TregConfig;

const TOKEN_HEADER: &str = "X-Treg-Token";
const COST_HEADER: &str = "X-Treg-Cost-Micro";
const CALL_ID_HEADER: &str = "X-Treg-Call-Id";

#[derive(Clone)]
pub struct TregClient {
    http: Client,
    token: String,
    base_url: String,
}

impl fmt::Debug for TregClient {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TregClient")
            .field("token", &"***")
            .field("base_url", &self.base_url)
            .finish()
    }
}

#[derive(Debug, Clone)]
pub struct TregCallResponse {
    pub status: StatusCode,
    pub body: Value,
    pub cost_micro_usd: Option<u64>,
    pub call_id: Option<String>,
}

impl TregClient {
    pub fn from_config(config: &TregConfig, http: Client) -> Option<Self> {
        let token = config
            .token
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())?;
        Some(Self {
            http,
            token: token.to_owned(),
            base_url: config.base_url.trim_end_matches('/').to_owned(),
        })
    }

    pub fn is_configured(&self) -> bool {
        !self.token.is_empty() && !self.base_url.is_empty()
    }

    pub async fn discover(&self, _platform: &str) -> Result<Value> {
        // Treg exposes the public platform catalog as one collection. Callers may
        // filter the returned `platforms` array by slug; there is no per-platform
        // `/catalog/platforms/<slug>` route.
        self.get_json("/catalog/platforms").await
    }

    pub async fn describe(&self, endpoint_id: &str) -> Result<Value> {
        self.get_json(&format!("/catalog/endpoints/{}", segment(endpoint_id)?))
            .await
    }

    pub async fn call(
        &self,
        endpoint_id: &str,
        method: Method,
        query: &[(String, String)],
        body: Option<&Value>,
        idempotency_key: Option<&str>,
        customer_id: Option<&str>,
    ) -> Result<TregCallResponse> {
        let url = format!("{}/call/{}", self.base_url, segment(endpoint_id)?);
        let mut request = self
            .http
            .request(method, url)
            .header(TOKEN_HEADER, &self.token)
            .header("X-Treg-Client", "ryu-gateway")
            .query(query);
        if let Some(idempotency_key) = idempotency_key.filter(|value| !value.is_empty()) {
            request = request.header("Idempotency-Key", idempotency_key);
        }
        if let Some(customer_id) = customer_id.and_then(treg_customer_tag) {
            request = request.header("X-Treg-Meta", format!("customer={customer_id}"));
        }
        if let Some(body) = body {
            request = request.json(body);
        }

        let response = request.send().await.context("Treg call request failed")?;
        let status = response.status();
        let cost_micro_usd = response
            .headers()
            .get(COST_HEADER)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.trim().parse::<u64>().ok());
        let call_id = response
            .headers()
            .get(CALL_ID_HEADER)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let bytes = response
            .bytes()
            .await
            .context("Treg call response could not be read")?;
        let body = serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).into_owned()));
        Ok(TregCallResponse {
            status,
            body,
            cost_micro_usd,
            call_id,
        })
    }

    async fn get_json(&self, path: &str) -> Result<Value> {
        let url = format!("{}{}", self.base_url, path);
        let response = self
            .http
            .get(url)
            .header(TOKEN_HEADER, &self.token)
            .header("X-Treg-Client", "ryu-gateway")
            .send()
            .await
            .context("Treg catalog request failed")?;
        let status = response.status();
        if !status.is_success() {
            anyhow::bail!("Treg catalog failed: HTTP {status}");
        }
        response
            .json()
            .await
            .context("Treg catalog response was not JSON")
    }
}

fn treg_customer_tag(value: &str) -> Option<&str> {
    let value = value.trim();
    (!value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b':')))
    .then_some(value)
}

fn segment(value: &str) -> Result<&str> {
    let value = value.trim();
    if value.is_empty()
        || value.contains('/')
        || value.contains('\\')
        || value.chars().any(char::is_control)
    {
        anyhow::bail!("Treg path segment is invalid");
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::TregConfig;

    #[test]
    fn client_debug_redacts_token() {
        let client = TregClient::from_config(
            &TregConfig {
                enabled: true,
                base_url: "https://treg.to".to_owned(),
                token: Some("secret-treg-token".to_owned()),
            },
            Client::new(),
        )
        .expect("configured client");
        let debug = format!("{client:?}");
        assert!(!debug.contains("secret-treg-token"));
        assert!(debug.contains("***"));
    }

    #[test]
    fn path_segments_reject_traversal_and_control_characters() {
        assert!(segment("x.post.create").is_ok());
        assert!(segment("../private").is_err());
        assert!(segment("x\\npost").is_err());
    }
}
