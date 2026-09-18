//! Operator-pinned MCP configuration and sealed legacy transport.
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, time::Duration};
use url::Url;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn static_configuration_is_canonical_and_rejects_protocol_overrides() {
        let mut cfg = McpConfiguration::default();
        cfg.static_headers
            .insert("X-Workspace".into(), "synthetic-header-secret".into());
        let hash = cfg.fingerprint().unwrap();
        assert!(!hash.contains("synthetic-header-secret"));
        let mut same = McpConfiguration::default();
        same.static_headers
            .insert("x-workspace".into(), "synthetic-header-secret".into());
        assert_eq!(hash, same.fingerprint().unwrap());
        same.transport = TransportMode::Sse;
        assert_ne!(hash, same.fingerprint().unwrap());
        for name in [
            "Authorization",
            "Cookie",
            "Proxy-Authorization",
            "Host",
            "Content-Length",
            "Transfer-Encoding",
            "Connection",
            "Accept",
            "Content-Type",
            "Mcp-Session-Id",
            "Mcp-Method",
            "Origin",
            "X-Forwarded-Host",
            "X-HTTP-Method-Override",
            "X-Original-URL",
        ] {
            let mut invalid = cfg.clone();
            invalid.static_headers.insert(name.into(), "value".into());
            assert!(invalid.fingerprint().is_err(), "{name}");
        }
        cfg.static_headers
            .insert("x-workspace".into(), "duplicate".into());
        assert!(cfg.fingerprint().is_err());
        let unknown = serde_json::json!({"staticHeaders":{},"tenantId":"other"});
        assert!(serde_json::from_value::<McpConfiguration>(unknown).is_err());
    }
    #[tokio::test]
    async fn streaming_egress_rejects_private_destinations_and_redirects() {
        assert!(stream("https://127.0.0.1/sse", &[]).await.is_err());
        assert!(stream("https://metadata.google.internal/sse", &[])
            .await
            .is_err());
        assert!(stream("https://user:pass@example.com/sse", &[])
            .await
            .is_err());
    }
}

#[derive(Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TransportMode {
    #[default]
    StreamableHttp,
    Sse,
}

/// Bootstrap configuration only. No Debug: additional header values may be secrets.
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpConfiguration {
    #[serde(default)]
    pub transport: TransportMode,
    #[serde(default)]
    pub static_headers: BTreeMap<String, String>,
}
impl McpConfiguration {
    pub fn normalized_headers(&self) -> Result<BTreeMap<String, String>> {
        if self.static_headers.len() > 32
            || self
                .static_headers
                .iter()
                .map(|(k, v)| k.len() + v.len())
                .sum::<usize>()
                > 16384
        {
            bail!("MCP static header budget exceeded");
        }
        let mut headers = BTreeMap::new();
        for (name, value) in &self.static_headers {
            let name = reqwest::header::HeaderName::from_bytes(name.as_bytes())
                .map_err(|_| anyhow::anyhow!("Invalid MCP static header name"))?
                .to_string();
            if matches!(
                name.as_str(),
                "authorization"
                    | "proxy-authorization"
                    | "cookie"
                    | "set-cookie"
                    | "host"
                    | "connection"
                    | "content-length"
                    | "transfer-encoding"
                    | "te"
                    | "trailer"
                    | "upgrade"
                    | "expect"
                    | "accept"
                    | "content-type"
                    | "origin"
                    | "referer"
                    | "forwarded"
            ) || name.starts_with("proxy-")
                || name.starts_with("sec-")
                || name.starts_with("mcp-")
                || name.starts_with("x-forwarded-")
                || name.contains("method-override")
                || name.contains("http-method")
                || name.contains("rewrite-url")
                || name.contains("original-url")
                || value.chars().any(char::is_control)
                || reqwest::header::HeaderValue::from_str(value).is_err()
                || headers.insert(name, value.clone()).is_some()
            {
                bail!("MCP static header override denied");
            }
        }
        Ok(headers)
    }
    /// Digest binds trusted Core configuration to operator-pinned Passport configuration.
    /// Runtime frames transmit neither the literal header values nor a replacement map.
    pub fn fingerprint(&self) -> Result<String> {
        let bytes = serde_json::to_vec(&(self.transport, self.normalized_headers()?))?;
        Ok(format!("{:x}", Sha256::digest(bytes)))
    }
}
pub fn default_configuration_hash() -> String {
    McpConfiguration::default()
        .fingerprint()
        .expect("empty static configuration is valid")
}

/// Opens a pinned GET without buffering its long-lived body. Screening primitives
/// are shared with ryu-egress; the exact resolved addresses are pinned on the client.
pub async fn stream(url: &str, headers: &[(String, String)]) -> Result<reqwest::Response> {
    let parsed = Url::parse(url).context("Invalid MCP SSE URL")?;
    if !parsed.username().is_empty() || parsed.password().is_some() || parsed.fragment().is_some() {
        bail!("MCP SSE URL contains credentials or fragment");
    }
    let host = parsed.host_str().context("MCP SSE URL has no host")?;
    let fixture_loopback = cfg!(any(test, feature = "proof-loopback"))
        && parsed.scheme() == "http"
        && host
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback());
    if !fixture_loopback && (parsed.scheme() != "https" || ryu_egress::is_blocked_hostname(host)) {
        bail!("MCP SSE destination denied");
    }
    let port = parsed
        .port_or_known_default()
        .context("Invalid MCP SSE port")?;
    let addresses: Vec<_> = tokio::time::timeout(
        Duration::from_secs(10),
        tokio::net::lookup_host((host, port)),
    )
    .await
    .map_err(|_| anyhow::anyhow!("MCP SSE DNS timed out"))?
    .map_err(|_| anyhow::anyhow!("MCP SSE DNS failed"))?
    .collect();
    if addresses.is_empty()
        || (!fixture_loopback && addresses.iter().any(|a| ryu_egress::is_blocked_ip(a.ip())))
    {
        bail!("MCP SSE destination denied");
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .connect_timeout(Duration::from_secs(10))
        .resolve_to_addrs(host, &addresses)
        .build()?;
    let mut request = client.get(parsed);
    for (k, v) in headers {
        request = request.header(k, v);
    }
    tokio::time::timeout(Duration::from_secs(30), request.send())
        .await
        .map_err(|_| anyhow::anyhow!("MCP SSE connect timed out"))?
        .map_err(|_| anyhow::anyhow!("MCP SSE connect failed"))
}
pub struct LegacySession {
    reader: crate::mcp_sse::SseReader,
    endpoint: String,
    /// Includes credentials used for the long-lived GET, even after token refresh.
    pub(crate) redaction_values: Vec<String>,
}
pub struct LegacyHttpFailure(pub ryu_egress::GuardedResponse);
impl std::fmt::Debug for LegacyHttpFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("LegacyHttpFailure(<redacted>)")
    }
}
impl std::fmt::Display for LegacyHttpFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "MCP SSE upstream returned HTTP {}", self.0.status)
    }
}
impl std::error::Error for LegacyHttpFailure {}
impl LegacySession {
    pub async fn connect(
        resource: &str,
        headers: Vec<(String, String)>,
        redaction_values: Vec<String>,
    ) -> Result<Self> {
        let response = stream(resource, &headers).await?;
        if !response.status().is_success() {
            let status = response.status().as_u16();
            let headers = response
                .headers()
                .iter()
                .filter_map(|(k, v)| v.to_str().ok().map(|v| (k.to_string(), v.to_owned())))
                .collect();
            let mut response = response;
            let mut body = Vec::new();
            tokio::time::timeout(Duration::from_secs(30), async {
                while let Some(chunk) = response.chunk().await? {
                    if body.len() + chunk.len() > 1024 * 1024 {
                        bail!("MCP SSE error response too large");
                    }
                    body.extend_from_slice(&chunk);
                }
                Ok::<_, anyhow::Error>(())
            })
            .await
            .map_err(|_| anyhow::anyhow!("MCP SSE error response timed out"))??;
            return Err(LegacyHttpFailure(ryu_egress::GuardedResponse {
                status,
                headers,
                body,
            })
            .into());
        }
        if !response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.to_ascii_lowercase().contains("text/event-stream"))
        {
            bail!("MCP SSE upstream did not return an event stream");
        }
        let base = Url::parse(resource)?;
        let mut reader = crate::mcp_sse::SseReader::with_limit(response, 1024 * 1024);
        let endpoint = tokio::time::timeout(Duration::from_secs(30), async {
            let mut bytes = 0usize;
            loop {
                let event = reader
                    .next_event()
                    .await?
                    .context("MCP SSE stream closed before endpoint")?;
                bytes = bytes.saturating_add(event.data.len());
                if bytes > 1024 * 1024 {
                    bail!("MCP SSE setup exceeded byte budget");
                }
                if event.event.as_deref() != Some("endpoint")
                    && !(event.event.is_none()
                        && (event.data.starts_with('/')
                            || event.data.starts_with("http://")
                            || event.data.starts_with("https://")))
                {
                    continue;
                }
                let endpoint = base
                    .join(event.data.trim())
                    .context("Invalid MCP SSE endpoint")?;
                if endpoint.origin() != base.origin()
                    || !endpoint.username().is_empty()
                    || endpoint.password().is_some()
                    || endpoint.fragment().is_some()
                {
                    bail!("MCP SSE message endpoint changed the bound origin");
                }
                return Ok::<_, anyhow::Error>(endpoint.to_string());
            }
        })
        .await
        .map_err(|_| anyhow::anyhow!("MCP SSE endpoint timed out"))??;
        Ok(Self {
            reader,
            endpoint,
            redaction_values,
        })
    }
    pub async fn exchange(
        &mut self,
        headers: Vec<(String, String)>,
        body: Vec<u8>,
    ) -> Result<ryu_egress::GuardedResponse> {
        let frame: serde_json::Value = serde_json::from_slice(&body)?;
        let response =
            crate::mcp_oauth::request("POST", &self.endpoint, headers, Some(body)).await?;
        if !(200..300).contains(&response.status) || frame.get("id").is_none() {
            return Ok(response);
        }
        let wanted = frame["id"].clone();
        let matches_request = |raw: &str| {
            serde_json::from_str::<serde_json::Value>(raw)
                .ok()
                .is_some_and(|value| {
                    value.get("id") == Some(&wanted)
                        && (value.get("result").is_some() || value.get("error").is_some())
                })
        };
        let post_body = String::from_utf8_lossy(&response.body);
        let post_frames = if response.headers.iter().any(|(name, value)| {
            name.eq_ignore_ascii_case("content-type")
                && value.to_ascii_lowercase().contains("text/event-stream")
        }) {
            crate::mcp_sse::data_frames(&post_body)
        } else if post_body.trim().is_empty() {
            Vec::new()
        } else {
            vec![post_body.into_owned()]
        };
        if post_frames.iter().any(|frame| matches_request(frame)) {
            return Ok(response);
        }
        tokio::time::timeout(Duration::from_secs(30), async {
            let mut body = String::new();
            for frame in post_frames {
                for line in frame.lines() {
                    body.push_str("data: ");
                    body.push_str(line);
                    body.push('\n');
                }
                body.push('\n');
            }
            if body.len() > 1024 * 1024 {
                bail!("MCP SSE response exceeded byte budget");
            }
            loop {
                let event = self
                    .reader
                    .next_event()
                    .await?
                    .context("MCP SSE stream ended")?;
                if event.event.as_deref() == Some("endpoint") {
                    continue;
                }
                let matched = matches_request(&event.data);
                for line in event.data.lines() {
                    body.push_str("data: ");
                    body.push_str(line);
                    body.push('\n');
                }
                body.push('\n');
                if body.len() > 1024 * 1024 {
                    bail!("MCP SSE response exceeded byte budget");
                }
                if matched {
                    return Ok(ryu_egress::GuardedResponse {
                        status: 200,
                        headers: vec![("content-type".into(), "text/event-stream".into())],
                        body: body.into_bytes(),
                    });
                }
            }
        })
        .await
        .map_err(|_| anyhow::anyhow!("MCP SSE response timed out"))?
    }
}
