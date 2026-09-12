//! Core's Passport adapter. Credentials are selected by the installed agent id;
//! Passport consumes provider credentials and returns fetched content only.
use anyhow::{bail, Context, Result};
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
struct Connections {
    connections: Vec<ryu_vault::ConnectionRecord>,
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

async fn bounded_json<T: serde::de::DeserializeOwned>(
    mut response: reqwest::Response,
) -> Result<T> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| anyhow::anyhow!("Passport response interrupted"))?
    {
        if bytes.len() + chunk.len() > 1024 * 1024 {
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
    let base = service_origin(base)?;
    // Runtime tokens are bootstrap secrets held by Core, never tool arguments.
    let raw = std::env::var("RYU_PASSPORT_AGENT_TOKENS")
        .context("Passport agent credentials are not configured")?;
    let tokens: std::collections::HashMap<String, String> = serde_json::from_str(&raw)
        .map_err(|_| anyhow::anyhow!("Invalid Passport agent credential configuration"))?;
    let token = tokens
        .get(agent_id)
        .filter(|token| !token.trim().is_empty())
        .context("No Passport runtime credential for the calling agent")?;
    let target = arguments
        .get("url")
        .and_then(Value::as_str)
        .context("Missing fetch URL")?;
    let target_url = url::Url::parse(target).context("Invalid fetch URL")?;
    let domain = target_url.host_str().context("Fetch URL has no domain")?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(35))
        .build()?;
    let response = client
        .get(base.join("/v1/runtime/connections")?)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| anyhow::anyhow!("Passport connection lookup unavailable"))?;
    if !response.status().is_success() {
        bail!("Passport connection lookup denied");
    }
    let connections: Connections = bounded_json(response).await?;
    let connection = connections
        .connections
        .iter()
        .find(|connection| {
            profile_ids.contains(&connection.profile_id)
                && connection.domain.eq_ignore_ascii_case(domain)
        })
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
        .bearer_auth(token)
        .json(&serde_json::json!({ "url": target }))
        .send()
        .await
        .map_err(|_| anyhow::anyhow!("Passport fetch unavailable"))?;
    if !response.status().is_success() {
        bail!(
            "Passport fetch denied or unavailable (HTTP {})",
            response.status()
        );
    }
    let result: Value = bounded_json(response).await?;
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
