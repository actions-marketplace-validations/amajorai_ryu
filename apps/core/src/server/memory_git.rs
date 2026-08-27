//! Read-only Git history for the explicitly configured Memory Markdown source.
//!
//! The desktop chooses and persists the repository path. Agents never receive a
//! free-form `cwd` through this route: they can only ask Core for a bounded trace
//! of that configured `memory/` subtree.

use axum::{extract::Query, http::StatusCode, response::IntoResponse, Json};
use serde::Deserialize;
use serde_json::json;

pub const MEMORY_GIT_ROOT_PREF_KEY: &str = "memory.git-root";

#[derive(Debug, Deserialize)]
pub struct MemoryGitTraceQuery {
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    limit: Option<usize>,
}

/// `GET /api/memory/git/trace?path=memory&limit=20`
///
/// Returns recent commits and changed Markdown paths for the repository selected
/// in the Memory Library. It is intentionally history-only: no arbitrary file
/// traversal or Git mutation is exposed to an agent through this route. The binding is
/// node-global, so the trace is available only on an unbound personal node; shared
/// nodes refuse it rather than exposing one user's repository metadata to another.
#[utoipa::path(
    get,
    path = "/api/memory/git/trace",
    tag = "Memory",
    summary = "Trace configured memory Git history",
    params(
        ("path" = Option<String>, Query, description = "memory or a path below memory/"),
        ("limit" = Option<usize>, Query, description = "Maximum commits, capped at 50")
    ),
    responses(
        (status = 200, description = "OK", body = serde_json::Value),
        (status = 403, description = "Unavailable on organization-bound nodes", body = serde_json::Value)
    )
)]
pub async fn trace(
    axum::extract::State(state): axum::extract::State<super::ServerState>,
    Query(query): Query<MemoryGitTraceQuery>,
) -> axum::response::Response {
    let path = query.path.unwrap_or_else(|| "memory".to_string());
    if super::node_org_id().is_some() {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({
                "configured": false,
                "commits": [],
                "path": path,
                "error": "Memory Git trace is unavailable on organization-bound nodes"
            })),
        )
            .into_response();
    }
    let root = match state.preferences.get(MEMORY_GIT_ROOT_PREF_KEY).await {
        Ok(Some(root)) if !root.trim().is_empty() => root,
        Ok(_) => {
            return Json(json!({
                "configured": false,
                "commits": [],
                "path": path,
            }))
            .into_response();
        }
        Err(error) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": error.to_string() })),
            )
                .into_response();
        }
    };
    let limit = query.limit.unwrap_or(20).min(50);
    let response_path = path.clone();
    let result = tokio::task::spawn_blocking(move || {
        ryu_workspace::git::query_memory_trace(&root, &path, limit)
    })
    .await;
    match result {
        Ok(Ok(commits)) => Json(json!({
            "configured": true,
            "commits": commits,
            "path": response_path,
        }))
        .into_response(),
        Ok(Err(error)) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "configured": true, "commits": [], "error": error })),
        )
            .into_response(),
        Err(error) => {
            tracing::error!("memory Git trace task failed: {error}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "memory Git trace failed" })),
            )
                .into_response()
        }
    }
}
