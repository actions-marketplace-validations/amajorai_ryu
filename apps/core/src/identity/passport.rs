//! Core's Passport adapter. Credentials are selected by the installed agent id;
//! Passport consumes provider credentials and returns fetched content only.

#[derive(Clone)]
struct McpHandle {
    configuration_hash: String,
    agent_id: String,
    binding: ryu_vault::mcp_oauth::McpBinding,
    action: super::ConnectionAction,
    risk_approved: bool,
    force_refresh: bool,
    session_id: Option<String>,
    expires: std::time::Instant,
}
fn mcp_handles() -> &'static tokio::sync::Mutex<std::collections::HashMap<String, McpHandle>> {
    static HANDLES: std::sync::OnceLock<
        tokio::sync::Mutex<std::collections::HashMap<String, McpHandle>>,
    > = std::sync::OnceLock::new();
    HANDLES.get_or_init(Default::default)
}
async fn mcp_runtime<T: serde::de::DeserializeOwned>(
    agent: &str,
    operation: &str,
    body: Value,
) -> Result<T> {
    let base =
        std::env::var("RYU_PASSPORT_URL").context("Passport remote configuration unavailable")?;
    let base = service_origin(&base)?;
    let token = agent_token(agent)?;
    let response = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(35))
        .build()?
        .post(base.join(&format!("/v1/runtime/mcp/{operation}"))?)
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|_| anyhow::anyhow!("Passport MCP runtime unavailable"))?;
    if !response.status().is_success() {
        bail!("Passport MCP runtime denied or unavailable");
    }
    bounded_json_limit(response, 8 * 1024 * 1024).await
}
pub async fn mcp_metadata(
    agent: &str,
    binding: &ryu_vault::mcp_oauth::McpBinding,
) -> Result<Option<Value>> {
    mcp_metadata_configured(
        agent,
        binding,
        &ryu_vault::mcp_transport::McpConfiguration::default(),
    )
    .await
}
pub async fn mcp_metadata_configured(
    agent: &str,
    binding: &ryu_vault::mcp_oauth::McpBinding,
    configuration: &ryu_vault::mcp_transport::McpConfiguration,
) -> Result<Option<Value>> {
    mcp_runtime(
        agent,
        "metadata",
        serde_json::json!({"binding":binding,"configurationHash":configuration.fingerprint()?}),
    )
    .await
}

pub struct McpToolEffect {
    pub action: super::ConnectionAction,
    pub annotations: Value,
    /// Compatibility input to Core's existing lifecycle/effect gate, not an
    /// outbound HTTP verb. It overrides all provider and tool-name heuristics.
    pub http_method: String,
}
pub async fn mcp_tool_effect(
    agent: &str,
    binding: &ryu_vault::mcp_oauth::McpBinding,
    configuration: &ryu_vault::mcp_transport::McpConfiguration,
    tool: &str,
) -> Result<McpToolEffect> {
    let metadata: Value = mcp_runtime(
        agent,
        "policy",
        serde_json::json!({"binding":binding,"configurationHash":configuration.fingerprint()?}),
    )
    .await?;
    let action = match metadata
        .get("toolActions")
        .and_then(|actions| actions.get(tool))
        .and_then(Value::as_str)
    {
        Some("read") => super::ConnectionAction::Read,
        Some("write") => super::ConnectionAction::Write,
        Some("delete") => super::ConnectionAction::Delete,
        _ => bail!("MCP tool has no granted operator action"),
    };
    match crate::sidecar::gateway::check_identity_grant(
        super::IDENTITY_READ_SCOPE,
        &binding.plugin_id,
    )
    .await
    {
        crate::sidecar::gateway::IdentityGrantOutcome::Allow => {}
        crate::sidecar::gateway::IdentityGrantOutcome::Deny(_) => {
            bail!("Passport MCP identity read denied by Gateway")
        }
    }
    let method = match action {
        super::ConnectionAction::Read => "GET",
        super::ConnectionAction::Write => "POST",
        super::ConnectionAction::Delete => "DELETE",
        _ => unreachable!(),
    };
    Ok(McpToolEffect {
        action,
        http_method: method.into(),
        annotations: serde_json::json!({"readOnlyHint":action==super::ConnectionAction::Read,
            "destructiveHint":action==super::ConnectionAction::Delete}),
    })
}
/// Saved agent scope is authoritative; a dispatch scope may narrow it only.
pub fn bound_mcp_profiles(saved: &[String], requested: &[String]) -> Result<Vec<String>> {
    if requested.is_empty() || requested.iter().any(|profile| !saved.contains(profile)) {
        bail!("Passport MCP requires profiles bound to the installed agent");
    }
    Ok(saved
        .iter()
        .filter(|profile| requested.contains(profile))
        .cloned()
        .collect())
}

async fn authorize_mcp(handle: &McpHandle) -> Result<super::ConnectionAccessLevel> {
    let metadata: Option<Value> = mcp_runtime(
        &handle.agent_id,
        "metadata",
        serde_json::json!({"binding":handle.binding,"configurationHash":handle.configuration_hash}),
    )
    .await?;
    let metadata = metadata.context("MCP authentication required")?;
    if metadata["status"] != "connected" {
        bail!("MCP authentication required");
    }
    let level = super::ConnectionAccessLevel::from_str(
        metadata["access_level"]
            .as_str()
            .context("Missing MCP access level")?,
    );
    if !level.allows_with_approval(handle.action, handle.risk_approved) {
        bail!("MCP connection access level denied this action");
    }
    match crate::sidecar::gateway::check_identity_grant(
        super::IDENTITY_READ_SCOPE,
        &handle.binding.plugin_id,
    )
    .await
    {
        crate::sidecar::gateway::IdentityGrantOutcome::Allow => Ok(level),
        crate::sidecar::gateway::IdentityGrantOutcome::Deny(_) => {
            bail!("Passport MCP identity read denied by Gateway")
        }
    }
}
/// Opaque process-local handle, minted only after Core authorization. Never a URL
/// supplied by a model or manifest, and never contains a Passport/provider token.
pub async fn mcp_target(
    agent_id: &str,
    binding: ryu_vault::mcp_oauth::McpBinding,
    action: super::ConnectionAction,
    risk_approved: bool,
    force_refresh: bool,
    session_id: Option<String>,
) -> Result<crate::sidecar::mcp::client::McpTarget> {
    mcp_target_configured(
        agent_id,
        binding,
        action,
        risk_approved,
        force_refresh,
        session_id,
        &ryu_vault::mcp_transport::McpConfiguration::default(),
    )
    .await
}
pub async fn mcp_target_configured(
    agent_id: &str,
    binding: ryu_vault::mcp_oauth::McpBinding,
    action: super::ConnectionAction,
    risk_approved: bool,
    force_refresh: bool,
    session_id: Option<String>,
    configuration: &ryu_vault::mcp_transport::McpConfiguration,
) -> Result<crate::sidecar::mcp::client::McpTarget> {
    let handle = McpHandle {
        configuration_hash: configuration.fingerprint()?,
        agent_id: agent_id.into(),
        binding,
        action,
        risk_approved,
        force_refresh,
        session_id,
        expires: std::time::Instant::now() + std::time::Duration::from_secs(300),
    };
    authorize_mcp(&handle).await?;
    let mut handles = mcp_handles().lock().await;
    handles.retain(|_, v| v.expires > std::time::Instant::now());
    if handles.len() >= 4096 {
        bail!("Passport MCP handle capacity exceeded");
    }
    let id = format!("ryu-passport-mcp://{}", uuid::Uuid::new_v4());
    handles.insert(id.clone(), handle);
    let endpoint = crate::sidecar::mcp::client::McpHttpEndpoint {
        url: id,
        headers: Default::default(),
    };
    Ok(match configuration.transport {
        ryu_vault::mcp_transport::TransportMode::StreamableHttp => {
            crate::sidecar::mcp::client::McpTarget::Http(endpoint)
        }
        ryu_vault::mcp_transport::TransportMode::Sse => {
            crate::sidecar::mcp::client::McpTarget::Sse(endpoint)
        }
    })
}
#[derive(Deserialize)]
struct McpTransportResponse {
    status: u16,
    headers: Vec<(String, String)>,
    body: String,
}
pub async fn mcp_close(handle_url: &str) {
    let Some(handle) = mcp_handles().lock().await.remove(handle_url) else {
        return;
    };
    let _: Result<Value> = mcp_runtime(&handle.agent_id,"close",serde_json::json!({
        "binding":handle.binding,"configurationHash":handle.configuration_hash,"clientHandle":handle_url
    })).await;
}
pub async fn mcp_post(
    handle_url: &str,
    headers: &[(String, String)],
    body: &str,
) -> Result<(reqwest::StatusCode, reqwest::header::HeaderMap, String)> {
    let handle = {
        let mut handles = mcp_handles().lock().await;
        let current = handles
            .get_mut(handle_url)
            .filter(|h| h.expires > std::time::Instant::now())
            .context("Invalid or expired Passport MCP handle")?;
        let handle = current.clone();
        current.force_refresh = false;
        handle
    };
    let level = authorize_mcp(&handle).await?;
    let frame: Value = serde_json::from_str(body)?;
    let is_tool_call = frame["method"] == "tools/call";
    // Protocol setup/listing is always a read. A read never needs an approval
    // assertion, even if the enclosing Core operation was already approved.
    let classified = if is_tool_call {
        handle.action
    } else {
        super::ConnectionAction::Read
    };
    let action = match classified {
        super::ConnectionAction::Read => "read",
        super::ConnectionAction::Write => "write",
        super::ConnectionAction::Delete => "delete",
        super::ConnectionAction::Unknown => bail!("Unknown MCP action denied"),
    };
    let risk_approved = is_tool_call
        && classified != super::ConnectionAction::Read
        && level == super::ConnectionAccessLevel::RiskBased
        && handle.risk_approved;
    let response: McpTransportResponse = mcp_runtime(&handle.agent_id,"transport",serde_json::json!({
        "binding":handle.binding,"configurationHash":handle.configuration_hash,"clientHandle":handle_url,
        "frame":frame,"headers":headers,"action":action,"riskApproved":risk_approved,"forceRefresh":handle.force_refresh
    })).await?;
    let mut response_headers = reqwest::header::HeaderMap::new();
    for (name, value) in response.headers {
        if !matches!(
            name.to_ascii_lowercase().as_str(),
            "content-type" | "mcp-session-id" | "mcp-protocol-version" | "www-authenticate"
        ) || value.len() > 16384
        {
            bail!("Invalid Passport MCP response header");
        }
        response_headers.append(
            reqwest::header::HeaderName::from_bytes(name.as_bytes())?,
            reqwest::header::HeaderValue::from_str(&value)?,
        );
    }
    crate::sidecar::gateway::report_credential_read_audit_with_attribution(
        "mcp-oauth",
        &handle.binding.resource_url,
        handle.session_id,
        None,
        crate::sidecar::gateway::ExecAuditAttribution {
            agent_id: Some(handle.agent_id),
            feature: Some("agent".into()),
            ..Default::default()
        },
    )
    .await;
    Ok((
        reqwest::StatusCode::from_u16(response.status)?,
        response_headers,
        response.body,
    ))
}

use anyhow::{bail, Context, Result};
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
struct Connections {
    connections: Vec<ryu_vault::ConnectionRecord>,
}

fn bound_connection<'a>(
    connections: &'a [ryu_vault::ConnectionRecord],
    profiles: &[String],
    domain: &str,
) -> Option<&'a ryu_vault::ConnectionRecord> {
    profiles.iter().find_map(|profile| {
        connections.iter().find(|connection| {
            &connection.profile_id == profile && connection.domain.eq_ignore_ascii_case(domain)
        })
    })
}

fn agent_token(agent_id: &str) -> Result<String> {
    let raw = std::env::var("RYU_PASSPORT_AGENT_TOKENS")
        .context("Passport agent credentials are not configured")?;
    let tokens: std::collections::HashMap<String, String> = serde_json::from_str(&raw)
        .map_err(|_| anyhow::anyhow!("Invalid Passport agent credential configuration"))?;
    tokens
        .get(agent_id)
        .filter(|token| !token.trim().is_empty())
        .cloned()
        .context("No Passport runtime credential for the calling agent")
}

/// Consult metadata using the calling agent's runtime credential and bound profiles.
pub async fn runtime_needs_auth(
    base: &str,
    agent_id: &str,
    profiles: &[String],
    domain: &str,
) -> Result<bool> {
    let base = service_origin(base)?;
    let token = agent_token(agent_id)?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(35))
        .build()?;
    let response = client
        .get(base.join("/v1/runtime/connections")?)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| anyhow::anyhow!("Passport runtime metadata unavailable"))?;
    if !response.status().is_success() {
        bail!("Passport runtime metadata denied");
    }
    let records: Connections = bounded_json(response).await?;
    Ok(bound_connection(&records.connections, profiles, domain)
        .is_some_and(|connection| connection.status == ryu_vault::ConnectionStatus::NeedsAuth))
}

/// Metadata-only connection signal. Remote errors never authorize local fallback.
pub async fn needs_auth(domain: &str) -> Option<Result<bool>> {
    manage(reqwest::Method::GET, &["connections"], None)
        .await
        .map(|response| {
            let (status, value) = response?;
            if status != 200 {
                bail!("Passport connection lookup failed");
            }
            let records: Connections = serde_json::from_value(value)
                .map_err(|_| anyhow::anyhow!("Invalid Passport connection metadata"))?;
            Ok(records.connections.iter().any(|connection| {
                connection.domain.eq_ignore_ascii_case(domain)
                    && connection.status == ryu_vault::ConnectionStatus::NeedsAuth
            }))
        })
}

/// A retained Core scheduler job must check the configured Passport tenant,
/// never a stale local copy. None means embedded mode; failures remain failures.
pub async fn health_sweep() -> Option<Result<()>> {
    manage(reqwest::Method::POST, &["health", "sweep"], None)
        .await
        .map(|response| {
            let (status, _) = response?;
            if !(200..300).contains(&status) {
                bail!("Passport health sweep failed with HTTP {status}");
            }
            Ok(())
        })
}

/// Forward a node-authorized management operation to the configured Passport
/// tenant. Returns None only when remote mode is not configured.
pub async fn manage(
    method: reqwest::Method,
    segments: &[&str],
    body: Option<Value>,
) -> Option<Result<(u16, Value)>> {
    let base = match std::env::var("RYU_PASSPORT_URL") {
        Ok(base) => base,
        Err(std::env::VarError::NotPresent) => return None,
        Err(_) => return Some(Err(anyhow::anyhow!("Invalid Passport URL configuration"))),
    };
    Some(manage_remote(&base, method, segments, body).await)
}

async fn manage_remote(
    base: &str,
    method: reqwest::Method,
    segments: &[&str],
    body: Option<Value>,
) -> Result<(u16, Value)> {
    let mut endpoint = service_origin(base)?;
    endpoint
        .path_segments_mut()
        .map_err(|_| anyhow::anyhow!("Invalid Passport origin"))?
        .clear()
        .push("v1")
        .extend(segments.iter().copied());
    let token = std::env::var("RYU_PASSPORT_ADMIN_TOKEN")
        .ok()
        .filter(|token| !token.trim().is_empty())
        .context("Passport management credential is not configured")?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(35))
        .build()?;
    let mut request = client.request(method, endpoint).bearer_auth(token);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request
        .send()
        .await
        .map_err(|_| anyhow::anyhow!("Passport management request unavailable"))?;
    let status = response.status().as_u16();
    let value = bounded_json(response).await?;
    Ok((status, value))
}

async fn bounded_json<T: serde::de::DeserializeOwned>(response: reqwest::Response) -> Result<T> {
    bounded_json_limit(response, 1024 * 1024).await
}

async fn bounded_json_limit<T: serde::de::DeserializeOwned>(
    mut response: reqwest::Response,
    limit: usize,
) -> Result<T> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| anyhow::anyhow!("Passport response interrupted"))?
    {
        if bytes.len() + chunk.len() > limit {
            bail!("Passport response exceeded size limit");
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| anyhow::anyhow!("Invalid Passport response"))
}

fn service_origin(base: &str) -> Result<url::Url> {
    let base = url::Url::parse(base).context("Invalid Passport URL")?;
    let loopback = base.host_str().is_some_and(|host| {
        host == "localhost"
            || host
                .parse::<std::net::IpAddr>()
                .is_ok_and(|ip| ip.is_loopback())
    });
    if !(base.scheme() == "https" || base.scheme() == "http" && loopback)
        || !base.username().is_empty()
        || base.password().is_some()
        || base.query().is_some()
        || base.fragment().is_some()
        || base.path() != "/"
    {
        bail!("Passport URL must be an HTTPS origin or loopback HTTP origin");
    }
    Ok(base)
}

pub async fn fetch(
    base: &str,
    agent_id: &str,
    profile_ids: &[String],
    arguments: &Value,
    session_id: Option<String>,
) -> Result<Value> {
    let url = arguments
        .get("url")
        .and_then(Value::as_str)
        .context("Missing fetch URL")?;
    execute_bound(
        base,
        agent_id,
        profile_ids,
        &serde_json::json!({"url":url}),
        session_id,
        1024 * 1024,
    )
    .await
}

/// Host-constructed request. Never derive Debug: header literals may be sensitive.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequest {
    pub url: String,
    pub method: String,
    pub headers: std::collections::BTreeMap<String, String>,
    pub credential_headers: std::collections::BTreeMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header_templates:
        Option<std::collections::BTreeMap<String, Vec<ryu_vault::passport::HeaderPart>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<Value>,
}

pub struct HttpResponse {
    pub status: u16,
    pub body: Value,
    pub payment_challenges: Vec<String>,
}

pub async fn execute_http(
    base: &str,
    agent_id: &str,
    profiles: &[String],
    request: HttpRequest,
    session_id: Option<String>,
) -> Result<HttpResponse> {
    let mut operation = serde_json::to_value(request)?;
    operation["maxContentChars"] = serde_json::json!(1024 * 1024);
    // A 1 MiB upstream body may expand when represented as a JSON string.
    let response = execute_bound(
        base,
        agent_id,
        profiles,
        &operation,
        session_id,
        8 * 1024 * 1024,
    )
    .await?;
    parse_http_response(response)
}

fn parse_http_response(response: Value) -> Result<HttpResponse> {
    if response.get("truncated").and_then(Value::as_bool) != Some(false) {
        bail!("Passport HTTP response was truncated");
    }
    let status = response
        .get("status")
        .and_then(Value::as_u64)
        .filter(|status| (100..=599).contains(status))
        .context("Invalid Passport HTTP status")?;
    let content = response
        .get("content")
        .and_then(Value::as_str)
        .context("Invalid Passport HTTP content")?;
    let body: Value =
        serde_json::from_str(content).unwrap_or_else(|_| Value::String(content.to_owned()));
    let payment_challenges: Vec<String> = response
        .get("wwwAuthenticate")
        .map(|value| serde_json::from_value(value.clone()))
        .transpose()
        .map_err(|_| anyhow::anyhow!("Invalid Passport payment challenges"))?
        .unwrap_or_default();
    if (!payment_challenges.is_empty() && status != 402)
        || payment_challenges.len() > 8
        || payment_challenges.iter().map(String::len).sum::<usize>() > 16 * 1024
        || payment_challenges
            .iter()
            .any(|value| value.chars().any(char::is_control))
    {
        bail!("Invalid Passport payment challenges");
    }
    Ok(HttpResponse {
        status: status as u16,
        body,
        payment_challenges,
    })
}

#[cfg(test)]
mod response_tests {
    use super::*;

    #[test]
    fn http_projection_preserves_payment_challenges_and_rejects_invalid_envelopes() {
        let value = serde_json::json!({"status":402,"content":"payment needed","truncated":false,"wwwAuthenticate":["Payment id=fixture"]});
        let result = parse_http_response(value.clone()).unwrap();
        assert_eq!(result.status, 402);
        assert_eq!(result.body, "payment needed");
        assert_eq!(result.payment_challenges, ["Payment id=fixture"]);
        for (key, replacement) in [
            ("status", serde_json::json!(200)),
            ("truncated", serde_json::json!(true)),
            ("wwwAuthenticate", serde_json::json!([42])),
            ("wwwAuthenticate", serde_json::json!(["bad\r\nheader"])),
            ("wwwAuthenticate", serde_json::json!(["x".repeat(16385)])),
        ] {
            let mut invalid = value.clone();
            invalid[key] = replacement;
            assert!(parse_http_response(invalid).is_err());
        }
    }
}

async fn execute_bound(
    base: &str,
    agent_id: &str,
    profile_ids: &[String],
    arguments: &Value,
    session_id: Option<String>,
    response_limit: usize,
) -> Result<Value> {
    let base = service_origin(base)?;
    // Runtime tokens are bootstrap secrets held by Core, never tool arguments.
    let token = agent_token(agent_id)?;
    let target = arguments
        .get("url")
        .and_then(Value::as_str)
        .context("Missing fetch URL")?;
    let target_url = url::Url::parse(target).context("Invalid fetch URL")?;
    let domain = target_url.host_str().context("Fetch URL has no domain")?;
    // Passport repeats this check before it opens the credential-bearing request,
    // but Core must not hand an untrusted agent URL to a remote service without
    // the same fail-closed egress contract. This also prevents a misconfigured or
    // stale Passport deployment from turning the adapter into an SSRF bypass.
    ryu_egress::screen_url_with_policy(
        target,
        ryu_egress::GuardedFetchPolicy {
            allow_http: false,
            max_redirect_hops: 0,
            ..Default::default()
        },
    )
    .await
    .map_err(|error| anyhow::anyhow!("Passport fetch target denied: {error}"))?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(35))
        .build()?;
    let response = client
        .get(base.join("/v1/runtime/connections")?)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|_| anyhow::anyhow!("Passport connection lookup unavailable"))?;
    if !response.status().is_success() {
        bail!("Passport connection lookup denied");
    }
    let connections: Connections = bounded_json(response).await?;
    let connection = bound_connection(&connections.connections, profile_ids, domain)
        .context("No Passport connection in the agent's bound profiles for this domain")?;
    match crate::sidecar::gateway::check_identity_grant(super::IDENTITY_READ_SCOPE, domain).await {
        crate::sidecar::gateway::IdentityGrantOutcome::Allow => {}
        crate::sidecar::gateway::IdentityGrantOutcome::Deny(_) => {
            bail!("Passport identity read denied by Gateway")
        }
    }
    let mut endpoint = base.join("/v1/connections/")?;
    endpoint
        .path_segments_mut()
        .map_err(|_| anyhow::anyhow!("Invalid Passport endpoint"))?
        .pop_if_empty()
        .push(&connection.id)
        .push("fetch");
    let response = client
        .post(endpoint)
        .bearer_auth(&token)
        .json(arguments)
        .send()
        .await
        .map_err(|_| anyhow::anyhow!("Passport fetch unavailable"))?;
    if !response.status().is_success() {
        bail!(
            "Passport fetch denied or unavailable (HTTP {})",
            response.status()
        );
    }
    let result: Value = bounded_json_limit(response, response_limit).await?;
    crate::sidecar::gateway::report_credential_read_audit_with_attribution(
        &connection.source,
        domain,
        session_id,
        None,
        crate::sidecar::gateway::ExecAuditAttribution {
            agent_id: Some(agent_id.to_owned()),
            feature: Some("agent".to_owned()),
            ..Default::default()
        },
    )
    .await;
    Ok(result)
}
