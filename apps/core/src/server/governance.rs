use std::collections::BTreeMap;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::governance::{
    merge_governance_layers, validate_governance_values, GatewayGovernanceValues, GitSettings,
    GovernanceScope, HookPolicyOverride, WorktreeSettings,
};
use crate::identity_verify::VerifiedCaller;

const LOCAL_GOVERNANCE_KEY: &str = "gateway-governance-local-v1";
pub const MANAGED_GOVERNANCE_KEY: &str = "gateway-governance-managed-v1";

const fn schema_version() -> u8 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalGovernanceDocument {
    #[serde(default = "schema_version")]
    schema_version: u8,
    #[serde(default)]
    revision: u64,
    #[serde(default)]
    node: GatewayGovernanceValues,
    #[serde(default)]
    user: GatewayGovernanceValues,
}

impl Default for LocalGovernanceDocument {
    fn default() -> Self {
        Self {
            schema_version: schema_version(),
            revision: 0,
            node: GatewayGovernanceValues::default(),
            user: GatewayGovernanceValues::default(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManagedGovernanceDocument {
    #[serde(default)]
    revision: u64,
    #[serde(default)]
    organization: GatewayGovernanceValues,
    #[serde(default)]
    team: GatewayGovernanceValues,
    #[serde(default)]
    user: GatewayGovernanceValues,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GovernanceLayerResponse {
    pub revision: u64,
    pub scope: GovernanceScope,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unavailable_reason: Option<String>,
    pub values: GatewayGovernanceValues,
    pub writable: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayGovernanceSnapshot {
    pub schema_version: u8,
    pub layers: Vec<GovernanceLayerResponse>,
}

pub fn snapshot_from_documents(
    local_json: Option<&str>,
    managed_json: Option<&str>,
    managed_available: bool,
) -> Result<GatewayGovernanceSnapshot, String> {
    let local = local_json
        .and_then(|value| serde_json::from_str::<LocalGovernanceDocument>(value).ok())
        .unwrap_or_default();
    let managed = managed_json
        .and_then(|value| serde_json::from_str::<ManagedGovernanceDocument>(value).ok())
        .unwrap_or_default();
    let unavailable_reason = (!managed_available).then(|| "This node is not managed.".to_owned());
    let user_values = merge_governance_layers(&managed.user, None, None, Some(&local.user));
    Ok(GatewayGovernanceSnapshot {
        schema_version: schema_version(),
        layers: vec![
            GovernanceLayerResponse {
                revision: local.revision,
                scope: GovernanceScope::Node,
                unavailable_reason: None,
                values: local.node,
                writable: true,
            },
            GovernanceLayerResponse {
                revision: managed.revision,
                scope: GovernanceScope::Organization,
                unavailable_reason: unavailable_reason.clone(),
                values: managed.organization,
                writable: false,
            },
            GovernanceLayerResponse {
                revision: managed.revision,
                scope: GovernanceScope::Team,
                unavailable_reason,
                values: managed.team,
                writable: false,
            },
            GovernanceLayerResponse {
                revision: local.revision.max(managed.revision),
                scope: GovernanceScope::User,
                unavailable_reason: None,
                values: user_values,
                writable: true,
            },
        ],
    })
}

async fn read_snapshot(
    state: &crate::server::ServerState,
) -> Result<GatewayGovernanceSnapshot, String> {
    let local = state
        .preferences
        .get(LOCAL_GOVERNANCE_KEY)
        .await
        .map_err(|error| error.to_string())?;
    let managed = state
        .preferences
        .get(MANAGED_GOVERNANCE_KEY)
        .await
        .map_err(|error| error.to_string())?;
    snapshot_from_documents(
        local.as_deref(),
        managed.as_deref(),
        crate::sidecar::control_plane::gateway_key().is_some(),
    )
}

pub async fn get_gateway_governance(State(state): State<crate::server::ServerState>) -> Response {
    match read_snapshot(&state).await {
        Ok(snapshot) => Json(snapshot).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error })),
        )
            .into_response(),
    }
}

#[derive(Debug, Deserialize)]
pub(crate) struct GovernanceUpdate {
    scope: GovernanceScope,
    values: Value,
}

fn apply_kind(
    target: &mut GatewayGovernanceValues,
    kind: &str,
    values: Value,
) -> Result<(), String> {
    match kind {
        "git" => {
            target.git = serde_json::from_value::<GitSettings>(values)
                .map_err(|error| format!("invalid git settings: {error}"))?;
        }
        "hooks" => {
            target.hooks = serde_json::from_value::<BTreeMap<String, HookPolicyOverride>>(values)
                .map_err(|error| format!("invalid hook settings: {error}"))?;
        }
        "worktrees" => {
            target.worktrees = serde_json::from_value::<WorktreeSettings>(values)
                .map_err(|error| format!("invalid worktree settings: {error}"))?;
        }
        _ => return Err("unknown governance kind".to_owned()),
    }
    Ok(())
}

pub async fn put_gateway_governance(
    State(state): State<crate::server::ServerState>,
    Extension(caller): Extension<Option<VerifiedCaller>>,
    Path(kind): Path<String>,
    Json(update): Json<GovernanceUpdate>,
) -> Response {
    if !matches!(update.scope, GovernanceScope::Node | GovernanceScope::User) {
        return (
            StatusCode::BAD_REQUEST,
            Json(
                json!({ "error": "organization and team policy are managed by the control plane" }),
            ),
        )
            .into_response();
    }
    if update.scope == GovernanceScope::Node
        && super::enforce_permission(
            &state,
            &caller,
            crate::identity_verify::permissions::GATEWAY_CONFIGURE,
        )
        .await
        .is_err()
    {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "insufficient permissions: gateway.configure" })),
        )
            .into_response();
    }

    let stored = state
        .preferences
        .get(LOCAL_GOVERNANCE_KEY)
        .await
        .ok()
        .flatten();
    let mut document = stored
        .as_deref()
        .and_then(|value| serde_json::from_str::<LocalGovernanceDocument>(value).ok())
        .unwrap_or_default();
    let target = match update.scope {
        GovernanceScope::Node => &mut document.node,
        GovernanceScope::User => &mut document.user,
        GovernanceScope::Organization | GovernanceScope::Team => unreachable!(),
    };
    if let Err(error) = apply_kind(target, &kind, update.values)
        .and_then(|()| validate_governance_values(update.scope, target))
    {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": error }))).into_response();
    }
    document.revision = document.revision.saturating_add(1);
    let encoded = match serde_json::to_string(&document) {
        Ok(value) => value,
        Err(error) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": error.to_string() })),
            )
                .into_response();
        }
    };
    if let Err(error) = state.preferences.set(LOCAL_GOVERNANCE_KEY, &encoded).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response();
    }
    get_gateway_governance(State(state)).await
}

#[cfg(test)]
mod tests {
    use super::snapshot_from_documents;
    use crate::governance::GovernanceScope;

    #[test]
    fn unmanaged_snapshot_keeps_local_layers_and_marks_managed_layers_unavailable() {
        let local = r#"{
            "schemaVersion": 1,
            "revision": 3,
            "node": { "git": { "branchPrefix": "node/" } },
            "user": { "git": { "createDraftPullRequests": false } }
        }"#;

        let snapshot = snapshot_from_documents(Some(local), None, false)
            .expect("valid local governance document");

        assert_eq!(snapshot.schema_version, 1);
        assert_eq!(snapshot.layers.len(), 4);
        assert_eq!(snapshot.layers[0].scope, GovernanceScope::Node);
        assert!(snapshot.layers[0].writable);
        assert_eq!(snapshot.layers[1].scope, GovernanceScope::Organization);
        assert_eq!(
            snapshot.layers[1].unavailable_reason.as_deref(),
            Some("This node is not managed.")
        );
        assert_eq!(snapshot.layers[3].scope, GovernanceScope::User);
        assert_eq!(
            snapshot.layers[3].values.git.create_draft_pull_requests,
            Some(false)
        );
    }

    #[test]
    fn malformed_stored_documents_fail_soft_to_empty_layers() {
        let snapshot = snapshot_from_documents(Some("not-json"), Some("[]"), true)
            .expect("stored corruption is isolated from the management read");

        assert_eq!(snapshot.layers.len(), 4);
        assert!(snapshot
            .layers
            .iter()
            .all(|layer| layer.values.hooks.is_empty()));
    }
}
