//! The **app→inbox notification** kernel capability (`notify.deliver`).
//!
//! The generic seam that lets ANY enabled app (not just `@ryu/monitors`, which
//! owns the `notify.fanout` external fan-out) deliver a user-targeted
//! notification into the app-inbox feed — the same feed a workflow `notify_user`
//! step writes to. The desktop renders it in the Inbox; the icon/name shown for
//! each row is resolved from the row's `source_app_id`, which is derived HERE from
//! the authenticated sidecar token, never accepted from the body.
//!
//! Security posture matches the other `grant: None` kernel capabilities
//! (`notify.fanout`'s external fan-out, `events.emit`): the gate is a minted
//! ext token for an ENABLED app. Writing to the user's own inbox is the intended
//! use of the seam, so "any enabled app" is the design, not a gap — the Gateway
//! vocabulary has no reviewed scope for "raise a notification", and minting one
//! is a Gateway governance change outside this surface.

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::json;

use super::ServerState;
use crate::sidecar::ext_proxy::authenticate_sidecar;

const MAX_NOTIFY_TITLE_BYTES: usize = 256;
const MAX_NOTIFY_BODY_BYTES: usize = 16 * 1024;
const MAX_NOTIFY_TARGET_BYTES: usize = 256;

/// Request body for `POST /api/host/capability/notify.deliver`.
#[derive(Debug, Deserialize)]
pub struct DeliverBody {
    /// The notification title (shown as the row's headline).
    pub title: String,
    /// Optional body text.
    #[serde(default)]
    pub body: Option<String>,
    /// One of `info` | `success` | `warning` | `error`. Defaults to `info`.
    #[serde(default)]
    pub level: Option<String>,
    /// The member to deliver to. Optional on an unbound local (single-user) node,
    /// where delivery falls back to the active account; on an org-bound node the
    /// caller should name its target explicitly.
    #[serde(default)]
    pub target_user_id: Option<String>,
}

/// `POST /api/host/capability/notify.deliver` — raise a user-targeted
/// notification on behalf of the authenticated app. The row is persisted to the
/// app-inbox feed (with `source_app_id` = the caller), mirrored to the desktop
/// toast stream, and pushed to the target member's registered devices.
///
/// The handler authenticates the caller and resolves the recipient itself, so an
/// app cannot spoof whose notification this is or target an arbitrary member on a
/// shared node without naming them in a body the host still controls.
pub(crate) async fn host_notify_deliver(
    State(state): State<ServerState>,
    headers: HeaderMap,
    Json(body): Json<DeliverBody>,
) -> Response {
    let plugin_id = match authenticate_sidecar(&state, &headers).await {
        Ok((id, _grants)) => id,
        Err((status, msg)) => return (status, Json(json!({ "error": msg }))).into_response(),
    };

    match deliver_for_app(
        &state.client,
        &plugin_id,
        body.target_user_id.as_deref(),
        &body.title,
        body.body.as_deref().unwrap_or(""),
        body.level.as_deref(),
    )
    .await
    {
        Ok((notification_id, user_id)) => (
            StatusCode::OK,
            Json(json!({ "ok": true, "notification_id": notification_id, "source_app_id": plugin_id, "target_user_id": user_id })),
        )
            .into_response(),
        Err((status, message)) => (status, Json(json!({ "error": message }))).into_response(),
    }
}

/// Deliver a notification on behalf of an authenticated app, resolving the
/// recipient (an explicit target wins; otherwise the node's active account) and
/// stamping `source_app_id` with the caller. Shared by `notify.deliver` and the
/// optional `notify` hint on `events.emit`, so the two seams deliver identically.
pub(crate) async fn deliver_for_app(
    client: &reqwest::Client,
    plugin_id: &str,
    target_user_id: Option<&str>,
    title: &str,
    body: &str,
    level: Option<&str>,
) -> Result<(String, String), (StatusCode, String)> {
    let title = title.trim();
    if let Err(message) = validate_notify_input(title, body, target_user_id) {
        return Err((StatusCode::BAD_REQUEST, message.to_owned()));
    }
    let Some(store) = crate::notify::global_store() else {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            "notify store not ready".to_string(),
        ));
    };

    // Resolve the recipient: an explicit target wins; otherwise the node's active
    // account (the local single-user case that most apps run in).
    let user_id = match target_user_id.filter(|s| !s.trim().is_empty()) {
        Some(target) => target.to_owned(),
        None => match crate::auth::load_accounts().active_user_id {
            Some(active) => active,
            None => {
                return Err((
                    StatusCode::BAD_REQUEST,
                    "no recipient: pass target_user_id or have an active account".to_string(),
                ))
            }
        },
    };

    // On a managed node the control plane is the source of truth for tenancy.
    // A valid sidecar token identifies the app, not an arbitrary member, so
    // explicit and fallback recipients must both be present in the current
    // org roster. Any roster lookup failure rejects delivery rather than
    // silently turning an unavailable policy check into allow-all.
    if crate::sidecar::control_plane::registered_org().is_some() {
        let members = crate::sidecar::control_plane::resolve_notify_targets(client, None)
            .await
            .map_err(|e| {
                (
                    StatusCode::SERVICE_UNAVAILABLE,
                    format!("cannot verify notification recipient membership: {e}"),
                )
            })?;
        if !target_is_org_member(&user_id, &members) {
            return Err((
                StatusCode::FORBIDDEN,
                "notification recipient is not a member of this organization".to_owned(),
            ));
        }
    }

    let level = level.filter(|l| !l.trim().is_empty()).unwrap_or("info");
    let level = match level {
        "success" | "warning" | "error" => level,
        _ => "info",
    };

    match crate::notify::deliver_app_notification(&store, plugin_id, &user_id, title, body, level)
        .await
    {
        Ok(notification_id) => Ok((notification_id, user_id)),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e)),
    }
}

fn validate_notify_input(
    title: &str,
    body: &str,
    target_user_id: Option<&str>,
) -> Result<(), &'static str> {
    if title.trim().is_empty() {
        return Err("notification title must not be empty");
    }
    if title.len() > MAX_NOTIFY_TITLE_BYTES {
        return Err("notification title is too long");
    }
    if body.len() > MAX_NOTIFY_BODY_BYTES {
        return Err("notification body is too long");
    }
    if target_user_id
        .filter(|target| !target.trim().is_empty())
        .is_some_and(|target| target.len() > MAX_NOTIFY_TARGET_BYTES)
    {
        return Err("notification target is too long");
    }
    Ok(())
}

fn target_is_org_member(
    user_id: &str,
    members: &[crate::sidecar::control_plane::NotifyTargetUser],
) -> bool {
    members.iter().any(|member| member.user_id == user_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn member(user_id: &str) -> crate::sidecar::control_plane::NotifyTargetUser {
        crate::sidecar::control_plane::NotifyTargetUser {
            user_id: user_id.to_owned(),
            email: None,
            role: None,
            name: None,
        }
    }

    #[test]
    fn notification_membership_is_fail_closed() {
        let members = vec![member("alice")];
        assert!(target_is_org_member("alice", &members));
        assert!(!target_is_org_member("bob", &members));
        assert!(!target_is_org_member("alice", &[]));
    }

    #[test]
    fn notification_input_has_bounded_fields() {
        assert!(validate_notify_input("Title", "body", Some("alice")).is_ok());
        assert!(validate_notify_input("   ", "body", None).is_err());
        assert!(validate_notify_input(&"x".repeat(MAX_NOTIFY_TITLE_BYTES + 1), "", None).is_err());
        assert!(
            validate_notify_input("Title", &"x".repeat(MAX_NOTIFY_BODY_BYTES + 1), None).is_err()
        );
        assert!(
            validate_notify_input("Title", "", Some(&"x".repeat(MAX_NOTIFY_TARGET_BYTES + 1)))
                .is_err()
        );
    }
}
