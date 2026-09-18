//! Short-lived, one-use tickets for browser WebSocket upgrades.
//!
//! Browsers cannot set an `Authorization` header on a WebSocket constructor, but
//! putting a node bearer or user JWT in the URL makes those credentials visible to
//! URI access logs, browser history, and intermediaries. The HTTP issuer below is
//! authenticated with the normal node bearer (or the local loopback boundary),
//! then stores only an opaque ticket and the already-verified caller context.
//! Upgrade handlers consume the ticket before accepting the socket.

use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

use axum::{
    extract::{ConnectInfo, Json},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::identity_verify::VerifiedCaller;

const TICKET_TTL: Duration = Duration::from_secs(60);
const MAX_TICKETS: usize = 4096;
const MAX_BINDING_LENGTH: usize = 512;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WsTicketRoute {
    Realtime,
    Voice,
    Extension,
}

impl WsTicketRoute {
    fn parse(value: &str) -> Option<Self> {
        match value.trim() {
            "realtime" => Some(Self::Realtime),
            "voice" => Some(Self::Voice),
            "ext" => Some(Self::Extension),
            _ => None,
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct IssueWsTicketRequest {
    /// `realtime`, `voice`, or `ext`.
    pub route: String,
    /// Exact resource path for an extension WebSocket, including `/api/ext/ws/`.
    #[serde(default)]
    pub path: Option<String>,
    /// Room/conversation binding for realtime and, when supplied, voice.
    #[serde(default)]
    pub room_id: Option<String>,
    /// Realtime room kind (`conversation`, `document`, or `application`).
    #[serde(default)]
    pub kind: Option<String>,
    /// Application id for application rooms.
    #[serde(default)]
    pub app_id: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct IssueWsTicketResponse {
    /// Opaque single-use value. It is not a node or user credential.
    pub ticket: String,
    pub expires_in: u64,
}

#[derive(Debug, Clone)]
pub struct WsTicketClaims {
    pub app_id: Option<String>,
    pub caller: Option<VerifiedCaller>,
    pub kind: Option<String>,
    pub path: Option<String>,
    pub peer_is_loopback: bool,
    pub room_id: Option<String>,
    pub route: WsTicketRoute,
    /// Validated user-JWT expiry, when this ticket was minted for a user.
    /// `None` is reserved for the local single-user/node-token flow.
    pub jwt_expires_at: Option<i64>,
    /// The node-token generation observed while issuing the ticket. Keeping it
    /// in the returned claims closes the consume-to-upgrade rotation race.
    pub node_generation: u64,
}

#[derive(Debug)]
struct StoredTicket {
    claims: WsTicketClaims,
    expires_at: Instant,
    node_generation: u64,
}

static TICKETS: OnceLock<Mutex<HashMap<String, StoredTicket>>> = OnceLock::new();

fn tickets() -> &'static Mutex<HashMap<String, StoredTicket>> {
    TICKETS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn normalize_binding(
    value: Option<String>,
    field: &'static str,
) -> Result<Option<String>, &'static str> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim().to_owned();
    if value.is_empty() {
        return Ok(None);
    }
    if value.len() > MAX_BINDING_LENGTH || value.contains('\0') {
        return Err(field);
    }
    Ok(Some(value))
}

fn normalize_path(value: Option<String>) -> Result<Option<String>, &'static str> {
    let Some(value) = normalize_binding(value, "path")? else {
        return Ok(None);
    };
    if !value.starts_with('/') || value.contains('?') || value.contains('#') {
        return Err("path");
    }
    // Extension paths may contain an encoded agent id. Compare decoded paths so
    // the HTTP issuer and Axum's route extractor bind the same value.
    let decoded = urlencoding::decode(&value)
        .map(std::borrow::Cow::into_owned)
        .map_err(|_| "path")?;
    if decoded.split('/').any(|segment| segment == "..") {
        return Err("path");
    }
    Ok(Some(decoded))
}

fn normalize_request(
    request: IssueWsTicketRequest,
) -> Result<(WsTicketRoute, WsTicketClaims), &'static str> {
    let route = WsTicketRoute::parse(&request.route).ok_or("route")?;
    let path = normalize_path(request.path)?;
    let room_id = normalize_binding(request.room_id, "roomId")?;
    let kind = normalize_binding(request.kind, "kind")?;
    let app_id = normalize_binding(request.app_id, "appId")?;

    match route {
        WsTicketRoute::Realtime => {
            if path.is_some() || room_id.is_none() {
                return Err("realtime binding");
            }
            let Some(kind_value) = kind.as_deref() else {
                return Err("kind");
            };
            if !matches!(kind_value, "conversation" | "document" | "application") {
                return Err("kind");
            }
            if kind_value == "application" {
                if app_id.is_none() {
                    return Err("appId");
                }
            } else if app_id.is_some() {
                return Err("appId");
            }
        }
        WsTicketRoute::Voice => {
            if path.is_some() || kind.is_some() || app_id.is_some() {
                return Err("voice binding");
            }
        }
        WsTicketRoute::Extension => {
            if path.is_none() || room_id.is_some() || kind.is_some() || app_id.is_some() {
                return Err("extension binding");
            }
        }
    }

    Ok((
        route,
        WsTicketClaims {
            app_id,
            caller: None,
            kind,
            path,
            peer_is_loopback: false,
            room_id,
            route,
            jwt_expires_at: None,
            node_generation: 0,
        },
    ))
}

/// Issue a ticket after authenticating the HTTP request with the node boundary.
/// On a tokenless development node only a genuine local peer may mint one.
#[utoipa::path(
    post,
    path = "/api/ws/ticket",
    tag = "Core",
    request_body = IssueWsTicketRequest,
    responses(
        (status = 200, description = "One-use WebSocket ticket", body = IssueWsTicketResponse),
        (status = 400, description = "Invalid ticket binding"),
        (status = 401, description = "Missing or invalid node authentication"),
        (status = 503, description = "Ticket issuer unavailable")
    )
)]
pub async fn issue(
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(request): Json<IssueWsTicketRequest>,
) -> Response {
    if !authorized_http_request(&headers, peer) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let (_, mut claims) = match normalize_request(request) {
        Ok(value) => value,
        Err(field) => {
            return (
                StatusCode::BAD_REQUEST,
                format!("invalid WebSocket ticket binding: {field}"),
            )
                .into_response();
        }
    };
    if let Some((caller, expires_at)) =
        super::verified_caller_with_expiry_from_headers(&headers).await
    {
        claims.caller = Some(caller);
        claims.jwt_expires_at = Some(expires_at);
    }
    claims.peer_is_loopback =
        super::is_trusted_local_peer(peer.ip(), crate::sidecar::tailcat::proxy_is_active());
    claims.node_generation = crate::node_token::active_generation();

    let token = uuid::Uuid::new_v4().simple().to_string();
    let node_generation = claims.node_generation;
    let stored = StoredTicket {
        claims,
        expires_at: Instant::now() + TICKET_TTL,
        node_generation,
    };
    let Ok(mut store) = tickets().lock() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let now = Instant::now();
    store.retain(|_, item| item.expires_at > now);
    if store.len() >= MAX_TICKETS {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    store.insert(token.clone(), stored);
    Json(IssueWsTicketResponse {
        ticket: token,
        expires_in: TICKET_TTL.as_secs(),
    })
    .into_response()
}

/// Consume a ticket exactly once. Route-specific handlers perform any final
/// frame-level binding (the realtime/voice room is named inside the first frame).
pub fn consume(
    token: Option<&str>,
    expected_route: WsTicketRoute,
    expected_path: Option<&str>,
) -> Option<WsTicketClaims> {
    let token = token?.trim();
    if token.is_empty() || token.len() > MAX_BINDING_LENGTH {
        return None;
    }
    let mut store = tickets().lock().ok()?;
    let stored = store.remove(token)?;
    if stored.expires_at <= Instant::now()
        || stored.node_generation != crate::node_token::active_generation()
        || stored.claims.route != expected_route
    {
        return None;
    }
    if let Some(expected_path) = expected_path {
        let expected_path = normalize_path(Some(expected_path.to_owned()))
            .ok()
            .flatten()?;
        if stored.claims.path.as_deref() != Some(expected_path.as_str()) {
            return None;
        }
    }
    Some(stored.claims)
}

/// A connection-lifetime signal for a validated user JWT. Local node-token-only
/// tickets never expire through this path, so they remain pending until the
/// node-generation signal closes them.
pub async fn wait_for_jwt_expiry(expires_at: Option<i64>) {
    let Some(expires_at) = expires_at else {
        std::future::pending::<()>().await;
        return;
    };
    let now = chrono::Utc::now().timestamp();
    if expires_at <= now {
        return;
    }
    tokio::time::sleep(Duration::from_secs((expires_at - now) as u64)).await;
}

fn authorized_http_request(headers: &HeaderMap, peer: SocketAddr) -> bool {
    let expected = crate::node_token::active_token().filter(|token| !token.trim().is_empty());
    if let Some(expected) = expected {
        let provided = headers
            .get("authorization")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Bearer "))
            .map(str::trim)
            .filter(|value| !value.is_empty());
        return provided.is_some_and(|value| super::ct_eq(value, expected.trim()));
    }
    super::is_trusted_local_peer(peer.ip(), crate::sidecar::tailcat::proxy_is_active())
}

#[cfg(test)]
mod tests {
    use super::{normalize_path, normalize_request, IssueWsTicketRequest, WsTicketRoute};

    #[test]
    fn ticket_bindings_are_route_specific_and_paths_are_decoded() {
        let (route, claims) = normalize_request(IssueWsTicketRequest {
            route: "ext".to_owned(),
            path: Some("/api/ext/ws/@ryu/desktop/bots/acp%3Api/ws".to_owned()),
            room_id: None,
            kind: None,
            app_id: None,
        })
        .unwrap();
        assert_eq!(route, WsTicketRoute::Extension);
        assert_eq!(
            claims.path.as_deref(),
            Some("/api/ext/ws/@ryu/desktop/bots/acp:pi/ws")
        );
        assert!(normalize_path(Some("/api/ext/ws/../secret".to_owned())).is_err());
    }

    #[test]
    fn realtime_tickets_require_room_and_kind() {
        assert!(normalize_request(IssueWsTicketRequest {
            route: "realtime".to_owned(),
            path: None,
            room_id: None,
            kind: Some("conversation".to_owned()),
            app_id: None,
        })
        .is_err());
        assert!(normalize_request(IssueWsTicketRequest {
            route: "realtime".to_owned(),
            path: None,
            room_id: Some("room".to_owned()),
            kind: Some("bogus".to_owned()),
            app_id: None,
        })
        .is_err());
    }
}
