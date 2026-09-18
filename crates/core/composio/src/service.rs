//! Remote execution handoff to the independently running Connect service.
//! The verified Core user selects an operator-configured tenant credential.
//! Neither tool arguments nor the selected account can change that tenant.
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::collections::HashMap;

pub fn is_configured() -> bool {
    std::env::var_os("RYU_CONNECT_URL").is_some()
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedTrigger {
    pub id: String,
    pub trigger_id: Option<String>,
    pub trigger_slug: String,
    pub connected_account_id: String,
    pub user_id: String,
    pub auth_config_id: String,
    pub status: String,
}

fn managed_trigger(value: Value) -> Result<ManagedTrigger> {
    let record: ManagedTrigger = serde_json::from_value(value)
        .map_err(|_| anyhow::anyhow!("Invalid Connect trigger metadata"))?;
    uuid::Uuid::parse_str(&record.id).context("Invalid Connect trigger ID")?;
    for field in [
        &record.trigger_slug,
        &record.connected_account_id,
        &record.user_id,
        &record.auth_config_id,
    ] {
        if field.is_empty()
            || field.len() > 256
            || field.chars().any(|c| c.is_whitespace() || c.is_control())
        {
            bail!("Invalid Connect trigger identity");
        }
    }
    if !matches!(
        record.status.as_str(),
        "pending" | "active" | "deleting" | "deleted"
    ) || record.trigger_id.as_ref().is_some_and(|id| {
        id.is_empty() || id.len() > 256 || id.chars().any(|c| c.is_whitespace() || c.is_control())
    }) || (record.status == "active" && record.trigger_id.is_none())
    {
        bail!("Invalid Connect trigger state");
    }
    Ok(record)
}

async fn trigger_request(
    method: reqwest::Method,
    id: Option<&str>,
    body: Option<Value>,
    user_id: Option<&str>,
) -> Result<Value> {
    let (base, token) = configuration_from(user_id, "RYU_CONNECT_USER_MANAGEMENT_TOKENS")?;
    let mut endpoint = origin(&base)?;
    endpoint.set_path("/v1/composio/triggers");
    if let Some(id) = id {
        uuid::Uuid::parse_str(id).context("Invalid Connect trigger ID")?;
        endpoint
            .path_segments_mut()
            .map_err(|_| anyhow::anyhow!("Invalid Connect endpoint"))?
            .push(id);
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(95))
        .build()?;
    let mut request = client.request(method, endpoint).bearer_auth(token);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request
        .send()
        .await
        .map_err(|_| anyhow::anyhow!("Connect trigger management unavailable"))?;
    response_json(response).await
}

pub async fn create_trigger(
    slug: &str,
    account_id: &str,
    config: &Value,
    user_id: Option<&str>,
) -> Option<Result<ManagedTrigger>> {
    if !is_configured() {
        return None;
    }
    Some(async {
        if slug.is_empty() || slug.len() > 128 || account_id.is_empty() || account_id.len() > 256 || !config.is_object() || serde_json::to_vec(config)?.len() > 16_384 { bail!("Invalid Connect trigger request"); }
        let record = managed_trigger(trigger_request(reqwest::Method::POST, None, Some(json!({"triggerSlug":slug,"triggerConfig":config,"expectedAccountId":account_id})), user_id).await?)?;
        if record.trigger_slug != slug || record.connected_account_id != account_id {
            bail!("Connect returned a different trigger binding");
        }
        Ok(record)
    }.await)
}

pub async fn list_triggers(user_id: Option<&str>) -> Option<Result<Vec<ManagedTrigger>>> {
    if !is_configured() {
        return None;
    }
    Some(
        async {
            let value = trigger_request(reqwest::Method::GET, None, None, user_id).await?;
            let rows = value
                .get("triggers")
                .and_then(Value::as_array)
                .filter(|rows| rows.len() <= 256)
                .context("Invalid Connect trigger list")?;
            rows.iter().cloned().map(managed_trigger).collect()
        }
        .await,
    )
}

pub async fn delete_trigger(id: &str, user_id: Option<&str>) -> Option<Result<ManagedTrigger>> {
    if !is_configured() {
        return None;
    }
    Some(
        async {
            let record = managed_trigger(
                trigger_request(reqwest::Method::DELETE, Some(id), None, user_id).await?,
            )?;
            if record.id != id || record.status != "deleted" {
                bail!("Connect did not confirm trigger deletion");
            }
            Ok(record)
        }
        .await,
    )
}

/// Configuration metadata only: do not expose the service origin or credentials.
/// This is not a readiness probe or proof of an active provider account.
pub fn configuration_status(user_id: Option<&str>) -> Option<Value> {
    if !is_configured() {
        return None;
    }
    let configured = configuration(user_id)
        .and_then(|(base, _)| origin(&base))
        .is_ok();
    Some(json!({ "configured": configured, "base_url": "", "execution_owner": "connect" }))
}

fn configuration(user_id: Option<&str>) -> Result<(String, String)> {
    configuration_from(user_id, "RYU_CONNECT_USER_TOKENS")
}

/// The lease token stays private to the transport. Never put it in an agent
/// prompt or derive Debug for this type; payloads are untrusted event data.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventLease {
    pub delivery_id: String,
    lease_token: String,
    pub payload: Value,
}

async fn event_request(path: &str, body: Value, user_id: Option<&str>) -> Result<Value> {
    let (base, token) = configuration(user_id)?;
    let mut endpoint = origin(&base)?;
    endpoint.set_path(path);
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(10))
        .build()?;
    let response = client
        .post(endpoint)
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|_| anyhow::anyhow!("Connect event inbox unavailable"))?;
    response_json(response).await
}

/// Claim one event so its bounded payload fits the adapter response budget.
/// None means remote mode is not configured; an empty inbox is Ok(None).
pub async fn claim_event(user_id: Option<&str>) -> Option<Result<Option<EventLease>>> {
    if !is_configured() {
        return None;
    }
    Some(
        async {
            let value = event_request("/v1/events/claim", json!({"limit":1}), user_id).await?;
            let events = value
                .get("events")
                .and_then(Value::as_array)
                .context("Invalid Connect event claim")?;
            if events.len() > 1 {
                bail!("Connect returned too many event leases");
            }
            let Some(value) = events.first() else {
                return Ok(None);
            };
            let lease: EventLease = serde_json::from_value(value.clone())
                .map_err(|_| anyhow::anyhow!("Invalid Connect event lease"))?;
            if lease.delivery_id.is_empty()
                || lease.delivery_id.len() > 256
                || lease.delivery_id.chars().any(char::is_whitespace)
                || uuid::Uuid::parse_str(&lease.lease_token)
                    .map(|token| token.to_string() != lease.lease_token)
                    .unwrap_or(true)
            {
                bail!("Invalid Connect event lease identity");
            }
            Ok(Some(lease))
        }
        .await,
    )
}

/// Renew before expiry while handling an event. Failure must not be treated as
/// continued ownership; an expired lease cannot be revived by this request.
pub async fn renew_event(lease: &EventLease, user_id: Option<&str>) -> Option<Result<bool>> {
    if !is_configured() {
        return None;
    }
    Some(
        async {
            let value = event_request(
                "/v1/events/renew",
                json!({"deliveryId":lease.delivery_id,"leaseToken":lease.lease_token}),
                user_id,
            )
            .await?;
            value
                .get("renewed")
                .and_then(Value::as_bool)
                .context("Invalid Connect event renewal")
        }
        .await,
    )
}

/// Call only after successful durable processing. A stale or foreign lease
/// returns false; it must not be treated as a successful acknowledgment.
pub async fn acknowledge_event(lease: &EventLease, user_id: Option<&str>) -> Option<Result<bool>> {
    if !is_configured() {
        return None;
    }
    Some(
        async {
            let value = event_request(
                "/v1/events/ack",
                json!({"deliveryId":lease.delivery_id,"leaseToken":lease.lease_token}),
                user_id,
            )
            .await?;
            value
                .get("acknowledged")
                .and_then(Value::as_bool)
                .context("Invalid Connect event acknowledgment")
        }
        .await,
    )
}

fn configuration_from(user_id: Option<&str>, token_env: &str) -> Result<(String, String)> {
    let base = std::env::var("RYU_CONNECT_URL").context("Invalid Connect URL configuration")?;
    let raw = std::env::var(token_env).context("Connect user credentials are not configured")?;
    let tokens: HashMap<String, String> = serde_json::from_str(&raw)
        .map_err(|_| anyhow::anyhow!("Invalid Connect user credential configuration"))?;
    let token = tokens
        .get(user_id.unwrap_or("local"))
        .filter(|token| !token.trim().is_empty() && token.trim() == token.as_str())
        .context("No Connect credential for the calling user")?;
    Ok((base, token.clone()))
}

/// User-authorized login creation uses a separate tenant management credential.
pub async fn initiate(toolkit: &str, user_id: Option<&str>) -> Option<Result<Value>> {
    if !is_configured() {
        return None;
    }
    Some(
        async {
            let (base, token) = configuration_from(user_id, "RYU_CONNECT_USER_MANAGEMENT_TOKENS")?;
            let mut endpoint = origin(&base)?;
            endpoint.set_path("/v1/composio/link");
            let client = reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(std::time::Duration::from_secs(35))
                .build()?;
            let response = client
                .post(endpoint)
                .bearer_auth(token)
                .json(&json!({"expectedToolkit":toolkit.trim()}))
                .send()
                .await
                .map_err(|_| anyhow::anyhow!("Connect login initiation unavailable"))?;
            let value = response_json(response).await?;
            let id = value
                .get("connectedAccountId")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty())
                .context("Invalid Connect login account")?;
            let redirect = value
                .get("redirectUrl")
                .and_then(Value::as_str)
                .context("Invalid Connect login URL")?;
            let parsed = url::Url::parse(redirect)
                .map_err(|_| anyhow::anyhow!("Invalid Connect login URL"))?;
            if parsed.scheme() != "https"
                || !parsed.username().is_empty()
                || parsed.password().is_some()
            {
                bail!("Invalid Connect login URL");
            }
            if value.get("status").and_then(Value::as_str) != Some("pending") {
                bail!("Invalid Connect login state");
            }
            Ok(json!({"connection_id":id, "redirect_url":redirect, "status":"INITIATED"}))
        }
        .await,
    )
}

/// Complete a pending login without accepting a caller-selected account or user.
pub async fn complete(session_uri: &str, user_id: Option<&str>) -> Option<Result<Value>> {
    if !is_configured() {
        return None;
    }
    Some(async {
        if session_uri.is_empty() || session_uri.len() > 4096 { bail!("Invalid callback session URI"); }
        let (base, token) = configuration_from(user_id, "RYU_CONNECT_USER_MANAGEMENT_TOKENS")?;
        let mut endpoint = origin(&base)?;
        endpoint.set_path("/v1/composio/complete");
        let client = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(35)).build()?;
        let response = client.post(endpoint).bearer_auth(token).json(&json!({"sessionUri":session_uri}))
            .send().await.map_err(|_| anyhow::anyhow!("Connect login completion unavailable"))?;
        let value = response_json(response).await?;
        let id = value.get("connectedAccountId").and_then(Value::as_str).filter(|id| !id.is_empty()).context("Invalid completed account")?;
        if value.get("active").and_then(Value::as_bool) != Some(true) || value.get("status").and_then(Value::as_str) != Some("ACTIVE") {
            bail!("Connect did not confirm an active account");
        }
        Ok(json!({"id":id,"active":true,"status":"ACTIVE", "toolkit":value.get("toolkit").and_then(Value::as_str).unwrap_or("")}))
    }.await)
}

/// Tenant-filtered native catalog. The dedicated route never proxies to Core.
pub async fn catalog(user_id: Option<&str>) -> Option<Result<Value>> {
    read_catalog("/v1/composio/tools", user_id, &[]).await
}

pub async fn toolkits(user_id: Option<&str>) -> Option<Result<Value>> {
    read_catalog("/v1/composio/toolkits", user_id, &[]).await
}

pub async fn trigger_types(toolkit: &str, user_id: Option<&str>) -> Option<Result<Value>> {
    read_catalog(
        "/v1/composio/trigger-types",
        user_id,
        &[("toolkit", toolkit)],
    )
    .await
}

pub async fn actions(
    toolkit: &str,
    query: &str,
    limit: usize,
    tags: &[&str],
    user_id: Option<&str>,
) -> Option<Result<Value>> {
    let limit = limit.clamp(1, 100).to_string();
    let mut filters = vec![
        ("toolkit", toolkit),
        ("q", query),
        ("limit", limit.as_str()),
    ];
    filters.extend(tags.iter().map(|tag| ("tags", *tag)));
    read_catalog("/v1/composio/actions", user_id, &filters).await
}

pub async fn describe(tool: &str, user_id: Option<&str>) -> Option<Result<Value>> {
    if !is_configured() {
        return None;
    }
    Some(async {
        let (base, token) = configuration(user_id)?;
        let mut endpoint = origin(&base)?;
        endpoint.path_segments_mut().map_err(|_| anyhow::anyhow!("Invalid Connect endpoint"))?.clear().extend(["v1", "composio", "actions", tool]);
        let client = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(35)).build()?;
        let response = client.get(endpoint).bearer_auth(token).send().await
            .map_err(|_| anyhow::anyhow!("Connect schema lookup unavailable"))?;
        let value = response_json(response).await?;
        let schema = value.get("input_schema").filter(|schema| schema.is_object() && schema.get("type").and_then(Value::as_str) == Some("object")).context("Invalid Connect tool schema")?;
        if value.get("name").and_then(Value::as_str) != Some(tool) { bail!("Connect tool does not match the requested action"); }
        Ok(json!({"name":tool,"description":value.get("description").and_then(Value::as_str).unwrap_or(""),"input_schema":schema}))
    }.await)
}

async fn read_catalog(
    path: &str,
    user_id: Option<&str>,
    query: &[(&str, &str)],
) -> Option<Result<Value>> {
    if !is_configured() {
        return None;
    }
    Some(
        async {
            let (base, token) = configuration(user_id)?;
            let mut endpoint = origin(&base)?;
            endpoint.set_path(path);
            endpoint
                .query_pairs_mut()
                .extend_pairs(query.iter().copied());
            let client = reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(std::time::Duration::from_secs(35))
                .build()?;
            let response = client
                .get(endpoint)
                .bearer_auth(token)
                .send()
                .await
                .map_err(|_| anyhow::anyhow!("Connect catalog unavailable"))?;
            let value = response_json(response).await?;
            if !value.get("data").is_some_and(Value::is_array) {
                bail!("Invalid Connect catalog envelope");
            }
            Ok(value)
        }
        .await,
    )
}

/// None is returned only in embedded mode. Configuration, transport, and remote
/// failures must never cause an execution using Core's old provider credential.
pub async fn dispatch(
    tool: &str,
    arguments: &Value,
    user_id: Option<&str>,
    expected_account: Option<&str>,
) -> Option<Result<Value>> {
    if !is_configured() {
        return None;
    }
    Some(
        async {
            let (base, token) = configuration(user_id)?;
            execute(&base, &token, tool, arguments, expected_account).await
        }
        .await,
    )
}

/// List only Connect's bound account metadata, optionally filtered by toolkit.
pub async fn list_connections(toolkit: &str, user_id: Option<&str>) -> Option<Result<Value>> {
    if !is_configured() {
        return None;
    }
    Some(async {
        let (base, token) = configuration(user_id)?;
        let mut endpoint = origin(&base)?;
        endpoint.set_path("/v1/composio/accounts");
        if !toolkit.trim().is_empty() { endpoint.query_pairs_mut().append_pair("toolkit", toolkit.trim()); }
        let client = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(35)).build()?;
        let response = client.get(endpoint).bearer_auth(token).send().await
            .map_err(|_| anyhow::anyhow!("Connect account list unavailable"))?;
        let value = response_json(response).await?;
        let records = value.get("data").and_then(Value::as_array).context("Invalid Connect account list")?;
        let mut data = Vec::new();
        for record in records {
            let id = record.get("id").and_then(Value::as_str).context("Invalid Connect account id")?;
            let toolkit = record.get("toolkit").and_then(Value::as_str).context("Invalid Connect toolkit")?;
            let status = record.get("status").and_then(Value::as_str).context("Invalid Connect account status")?;
            let active = record.get("active").and_then(Value::as_bool).context("Invalid Connect account status")?;
            data.push(json!({"id":id, "toolkit":toolkit, "status":status, "active":active}));
        }
        Ok(json!({"object":"list", "data":data, "configured":value.get("configured").and_then(Value::as_bool).unwrap_or(true)}))
    }.await)
}

/// Metadata-only polling for exactly the account selected by the caller's tenant.
pub async fn connection_status(id: &str, user_id: Option<&str>) -> Option<Result<Value>> {
    if !is_configured() {
        return None;
    }
    Some(
        async {
            if id.trim().is_empty() {
                bail!("Connection id is required");
            }
            let (base, token) = configuration(user_id)?;
            let mut endpoint = origin(&base)?;
            endpoint.set_path("/v1/composio/connection");
            endpoint
                .query_pairs_mut()
                .append_pair("expectedAccountId", id);
            let client = reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(std::time::Duration::from_secs(35))
                .build()?;
            let response = client
                .get(endpoint)
                .bearer_auth(token)
                .send()
                .await
                .map_err(|_| anyhow::anyhow!("Connect account lookup unavailable"))?;
            let value = response_json(response).await?;
            if value.get("connectedAccountId").and_then(Value::as_str) != Some(id) {
                bail!("Connect account does not match requested connection");
            }
            let status = value
                .get("status")
                .and_then(Value::as_str)
                .context("Invalid Connect account status")?;
            let active = value
                .get("active")
                .and_then(Value::as_bool)
                .context("Invalid Connect account status")?;
            Ok(json!({ "id": id, "status": status, "active": active, "toolkit": "" }))
        }
        .await,
    )
}

fn origin(base: &str) -> Result<url::Url> {
    let url = url::Url::parse(base).map_err(|_| anyhow::anyhow!("Invalid Connect origin"))?;
    let loopback = match url.host() {
        Some(url::Host::Domain(host)) => host == "localhost",
        Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
        Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
        None => false,
    };
    if !(url.scheme() == "https" && url.has_host() || url.scheme() == "http" && loopback)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        bail!("Connect URL must be an HTTPS origin or loopback HTTP origin");
    }
    Ok(url)
}

async fn execute(
    base: &str,
    token: &str,
    tool: &str,
    arguments: &Value,
    expected_account: Option<&str>,
) -> Result<Value> {
    let mut endpoint = origin(base)?;
    endpoint.set_path("/v1/composio/execute");
    let mut body = json!({ "operation": "execute", "toolId": tool, "body": arguments });
    if let Some(account) = expected_account {
        body["expectedAccountId"] = Value::String(account.to_owned());
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(35))
        .build()?;
    let response = client
        .post(endpoint)
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|_| anyhow::anyhow!("Connect execution unavailable"))?;
    let value = response_json(response).await?;
    if value.get("successful").and_then(Value::as_bool) != Some(true) {
        bail!("Connect tool execution failed");
    }
    value
        .get("data")
        .cloned()
        .context("Invalid Connect execution envelope")
}

async fn response_json(mut response: reqwest::Response) -> Result<Value> {
    if !response.status().is_success() {
        bail!(
            "Connect execution rejected with HTTP {}",
            response.status().as_u16()
        );
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| anyhow::anyhow!("Connect response interrupted"))?
    {
        if bytes.len() + chunk.len() > 1024 * 1024 {
            bail!("Connect response exceeded size limit");
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| anyhow::anyhow!("Invalid Connect response"))?;
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn configured_errors_never_select_embedded_execution() {
        std::env::set_var("RYU_CONNECT_URL", "http://remote.example.com");
        std::env::set_var("RYU_CONNECT_USER_TOKENS", r#"{"user-a":"tenant-token"}"#);
        assert_eq!(
            configuration_status(Some("user-a")).unwrap()["configured"],
            false
        );
        assert!(dispatch("TOOL", &json!({}), Some("user-a"), None)
            .await
            .unwrap()
            .is_err());
        assert!(dispatch("TOOL", &json!({}), Some("user-b"), None)
            .await
            .unwrap()
            .is_err());
        assert!(dispatch("TOOL", &json!({}), None, None)
            .await
            .unwrap()
            .is_err());
        std::env::set_var("RYU_CONNECT_URL", "http://127.0.0.1:8094");
        assert_eq!(
            configuration_status(Some("user-a")).unwrap(),
            json!({"configured":true,"base_url":"","execution_owner":"connect"})
        );
        assert_eq!(
            configuration_status(Some("user-b")).unwrap()["configured"],
            false
        );
        assert_eq!(configuration_status(None).unwrap()["configured"], false);
        std::env::remove_var("RYU_CONNECT_USER_TOKENS");
        assert!(dispatch("TOOL", &json!({}), Some("user-a"), None)
            .await
            .unwrap()
            .is_err());
        std::env::remove_var("RYU_CONNECT_URL");
        assert!(configuration_status(Some("user-a")).is_none());
        assert!(dispatch("TOOL", &json!({}), Some("user-a"), None)
            .await
            .is_none());
    }
    #[test]
    fn rejects_credential_bearing_and_nonlocal_cleartext_origins() {
        for value in [
            "http://example.com",
            "https://u:p@example.com",
            "https://example.com/path",
            "https://example.com?q=1",
            "https://example.com#x",
        ] {
            assert!(origin(value).is_err());
        }
        for value in [
            "https://connect.example.com",
            "http://127.0.0.1:8094",
            "http://[::1]:8094",
        ] {
            assert!(origin(value).is_ok());
        }
    }

    #[tokio::test]
    async fn forwards_only_tenant_token_and_account_constraint() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0; 4096];
            loop {
                let read = stream.read(&mut buffer).unwrap();
                assert!(read > 0);
                bytes.extend_from_slice(&buffer[..read]);
                if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&bytes[..end]).to_ascii_lowercase();
                    let length: usize = headers
                        .lines()
                        .find_map(|line| line.strip_prefix("content-length: "))
                        .unwrap()
                        .parse()
                        .unwrap();
                    if bytes.len() < end + 4 + length {
                        continue;
                    }
                    assert!(headers.starts_with("post /v1/composio/execute "));
                    assert!(headers.contains("authorization: bearer tenant-token"));
                    assert!(!headers.contains("x-api-key"));
                    let body: Value = serde_json::from_slice(&bytes[end + 4..]).unwrap();
                    assert_eq!(
                        body,
                        json!({"operation":"execute", "toolId":"GMAIL_GET_PROFILE", "body":{}, "expectedAccountId":"ca-a"})
                    );
                    break;
                }
            }
            let body = r#"{"successful":true,"data":{"ok":true}}"#;
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
        });
        let result = execute(
            &base,
            "tenant-token",
            "GMAIL_GET_PROFILE",
            &json!({}),
            Some("ca-a"),
        )
        .await
        .unwrap();
        assert_eq!(result, json!({"ok":true}));
        server.join().unwrap();
    }
}
