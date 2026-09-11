//! Core-owned durable recursive-improvement records.
//!
//! Learning and Research may attach an opaque `improvementRunId`, but neither
//! app owns promotion. These handlers are the node-local lifecycle authority:
//! create a draft, read bounded history, and apply one guarded contract
//! transition at a time. They inherit the protected Core router's node bearer.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use ryu_improvement::StoreError;
use ryu_improvement_contracts::{
    ArtifactKind, ArtifactRef, EvaluationSummary, GuardrailSummary, ImprovementDecision,
    ImprovementProvenance, ImprovementRun, ImprovementStatus,
};
use serde::Deserialize;
use serde_json::json;

use super::ServerState;

const DEFAULT_LIST_LIMIT: u32 = 50;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateImprovementRequest {
    id: String,
    objective: String,
    artifact_kind: ArtifactKind,
    baseline: ArtifactRef,
    #[serde(default)]
    provenance: ImprovementProvenance,
    #[serde(default)]
    created_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TransitionRequest {
    to: ImprovementStatus,
    #[serde(default)]
    candidate: Option<ArtifactRef>,
    #[serde(default)]
    evaluation: Option<EvaluationSummary>,
    #[serde(default)]
    guardrails: Option<GuardrailSummary>,
    #[serde(default)]
    decision: Option<ImprovementDecision>,
    #[serde(default)]
    rollback: Option<ArtifactRef>,
}

#[derive(Debug, Deserialize)]
struct ListQuery {
    limit: Option<u32>,
}

/// Build the protected `/api/improvements/*` surface.
pub fn routes() -> Router<ServerState> {
    Router::new()
        .route(
            "/api/improvements",
            get(list_improvements).post(create_improvement),
        )
        .route("/api/improvements/:id", get(get_improvement))
        .route(
            "/api/improvements/:id/transition",
            post(transition_improvement),
        )
}

/// `GET /api/improvements` — bounded newest-first improvement history.
#[utoipa::path(
    get,
    path = "/api/improvements",
    tag = "Improvement",
    params(("limit" = Option<u32>, Query, description = "Maximum records to return, capped at 100.")),
    responses((status = 200, description = "Improvement runs", body = serde_json::Value))
)]
pub async fn list_improvements(
    State(state): State<ServerState>,
    Query(query): Query<ListQuery>,
) -> Response {
    let limit = query.limit.unwrap_or(DEFAULT_LIST_LIMIT).clamp(1, 100);
    match state.improvements.list(limit).await {
        Ok(improvements) => {
            Json(json!({ "improvements": improvements, "limit": limit })).into_response()
        }
        Err(error) => store_error(error),
    }
}

/// `POST /api/improvements` — create a draft improvement record.
#[utoipa::path(
    post,
    path = "/api/improvements",
    tag = "Improvement",
    request_body = serde_json::Value,
    responses((status = 201, description = "Draft improvement run", body = serde_json::Value))
)]
pub async fn create_improvement(
    State(state): State<ServerState>,
    Json(request): Json<CreateImprovementRequest>,
) -> Response {
    let created_at = request
        .created_at
        .unwrap_or_else(|| Utc::now().to_rfc3339());
    let run = match ImprovementRun::new(
        request.id,
        request.objective,
        request.artifact_kind,
        request.baseline,
        request.provenance,
        created_at,
    ) {
        Ok(run) => run,
        Err(error) => return store_error(StoreError::from(error)),
    };
    match state.improvements.create(&run).await {
        Ok(()) => (StatusCode::CREATED, Json(json!({ "improvement": run }))).into_response(),
        Err(error) => store_error(error),
    }
}

/// `GET /api/improvements/:id` — read one durable improvement record.
#[utoipa::path(
    get,
    path = "/api/improvements/{id}",
    tag = "Improvement",
    params(("id" = String, Path)),
    responses((status = 200, description = "Improvement run", body = serde_json::Value))
)]
pub async fn get_improvement(State(state): State<ServerState>, Path(id): Path<String>) -> Response {
    match state.improvements.get(&id).await {
        Ok(Some(improvement)) => Json(json!({ "improvement": improvement })).into_response(),
        Ok(None) => store_error(StoreError::NotFound(format!(
            "improvement run `{id}` does not exist"
        ))),
        Err(error) => store_error(error),
    }
}

/// `POST /api/improvements/:id/transition` — atomically apply one contract
/// transition plus any candidate/evidence/decision fields needed by it.
#[utoipa::path(
    post,
    path = "/api/improvements/{id}/transition",
    tag = "Improvement",
    params(("id" = String, Path)),
    request_body = serde_json::Value,
    responses((status = 200, description = "Updated improvement run", body = serde_json::Value))
)]
pub async fn transition_improvement(
    State(state): State<ServerState>,
    Path(id): Path<String>,
    Json(request): Json<TransitionRequest>,
) -> Response {
    let TransitionRequest {
        to,
        candidate,
        evaluation,
        guardrails,
        decision,
        rollback,
    } = request;
    let has_evaluation = evaluation.is_some();
    let has_guardrails = guardrails.is_some();
    if has_evaluation != has_guardrails {
        return bad_request(
            "evaluation and guardrails must be supplied together",
            "invalid_improvement_evaluation",
        );
    }
    let result = state
        .improvements
        .mutate(&id, |run| {
            if let Some(candidate) = candidate {
                run.set_candidate(candidate).map_err(StoreError::from)?;
            }
            if let (Some(evaluation), Some(guardrails)) = (evaluation, guardrails) {
                run.set_evaluation(evaluation, guardrails)
                    .map_err(StoreError::from)?;
            }
            if let Some(decision) = decision {
                run.set_decision(decision).map_err(StoreError::from)?;
            }
            if let Some(rollback) = rollback {
                run.set_rollback(rollback).map_err(StoreError::from)?;
            }
            run.transition_to(to).map_err(StoreError::from)?;
            run.updated_at = Utc::now().to_rfc3339();
            Ok(())
        })
        .await;
    match result {
        Ok(run) => Json(json!({ "improvement": run })).into_response(),
        Err(error) => store_error(error),
    }
}

fn bad_request(message: &str, code: &str) -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({ "error": message, "code": code })),
    )
        .into_response()
}

fn store_error(error: StoreError) -> Response {
    let (status, code) = match &error {
        StoreError::Contract(_) => (StatusCode::BAD_REQUEST, "invalid_improvement"),
        StoreError::Conflict(_) => (StatusCode::CONFLICT, "improvement_conflict"),
        StoreError::NotFound(_) => (StatusCode::NOT_FOUND, "improvement_not_found"),
        StoreError::Database(_) => (StatusCode::INTERNAL_SERVER_ERROR, "improvement_store_error"),
    };
    (
        status,
        Json(json!({
            "error": error.to_string(),
            "code": code,
        })),
    )
        .into_response()
}
