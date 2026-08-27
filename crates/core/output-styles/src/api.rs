//! HTTP API for output styles — list, read, and author (plus a legacy selector).
//!
//! **Routing shape (why this differs from `ryu_skills::api`).** The skills router
//! registers *absolute* paths (`/api/skills/...`) because Core owns some leaves under
//! that same prefix and has to `.merge` the two halves into one router. Nothing shares
//! `/api/output-styles`, so [`routes`] returns **relative** paths and Core `nest`s it:
//!
//! ```ignore
//! router.nest("/api/output-styles", ryu_output_styles::routes(ctx))
//! ```
//!
//! The router is a generic, state-agnostic `Router<S>` whose handlers are State-free
//! named fns reading the process-global [`crate::OutputStyleRegistry`] (published by
//! Core at startup, and `Arc`-shared with the chat-turn injection's own handle), so it
//! nests into Core's `ServerState` router without pinning a state type. The OpenAPI
//! annotations keep the full external paths and are merged into Core's spec via
//! [`openapi`].
//!
//! **`/api/output-styles` must stay a Core-relative path** (design §6): the styles
//! plugin's `store_tabs` entry sources this endpoint, and `isCoreApiPath` rejects a
//! `spec.source.http.path` that is not one. It is not proxied through `/api/ext/`.
//!
//! **One naming trap.** [`crate::OutputStyleRecord::source`] is *provenance* (`"user"`,
//! `"plugin"`, …), so this API cannot also call the file text `source` the way
//! `/api/skills/{id}/source` does. Raw file text is `raw` on every response here;
//! `source` is always the tier.

use axum::{
    extract::Path,
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde_json::json;

use crate::{store, OutputStyleRegistry, OutputStyleSummary};

/// Router state for the output-styles HTTP surface. The registry is `Arc`-backed and
/// is published to the process-global handle when [`routes`] is built, so the handlers
/// reach it without a per-request `State` extractor.
#[derive(Clone)]
pub struct OutputStylesCtx {
    pub registry: OutputStyleRegistry,
}

impl OutputStylesCtx {
    pub fn new(registry: OutputStyleRegistry) -> Self {
        Self { registry }
    }
}

/// The live registry the handlers act on. Prod always publishes it (Core, at startup);
/// when unset (a handler exercised before publication) fall back to an empty registry
/// so a read is a graceful no-op rather than a panic.
fn registry() -> &'static OutputStyleRegistry {
    static EMPTY: std::sync::OnceLock<OutputStyleRegistry> = std::sync::OnceLock::new();
    crate::global_registry().unwrap_or_else(|| EMPTY.get_or_init(OutputStyleRegistry::empty))
}

/// Build the output-styles router, publishing `ctx`'s registry as the process-global
/// handle the handlers read. Paths are **relative** — Core mounts them with
/// `nest("/api/output-styles", …)`.
///
/// `/select` is registered before the `:id` routes so matchit resolves the literal
/// segment first, matching the ordering comment on the Meetings templates router (a
/// style could otherwise be named `select` and eat the endpoint).
pub fn routes<S>(ctx: OutputStylesCtx) -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    crate::set_global_registry(ctx.registry);
    Router::new()
        .route("/select", post(select_style))
        .route("/", get(list_styles).post(create_style_handler))
        .route("/:id/source", get(get_style_source))
        .route(
            "/:id",
            get(get_style)
                .put(update_style_handler)
                .delete(delete_style_handler),
        )
}

/// The OpenAPI sub-document for the output-styles surface, merged into Core's spec.
pub fn openapi() -> utoipa::openapi::OpenApi {
    <OutputStylesApiDoc as utoipa::OpenApi>::openapi()
}

#[derive(utoipa::OpenApi)]
#[openapi(paths(
    list_styles,
    get_style,
    get_style_source,
    update_style_handler,
    delete_style_handler,
    select_style,
))]
struct OutputStylesApiDoc;

/// The id currently in force, and whether a plugin is what forces it.
///
/// One helper for older clients that still display node-level metadata. A forced
/// plugin style beats the legacy node selection; normal agent turns resolve their
/// profile from the agent record in Core.
fn effective_selection() -> (Option<String>, Option<String>) {
    let forced = registry().forced_style().map(|r| r.id);
    let active = forced.clone().or_else(crate::load_selection);
    (active, forced)
}

/// `GET /api/output-styles` — every available style, with the active one flagged.
///
/// Each row carries `active`, which is what lets the styles plugin's `store_tabs`
/// entry map `installed: "active"` and render the selected style as installed — the
/// same declarative shape the Meetings note-templates tab uses.
#[utoipa::path(
    get,
    path = "/api/output-styles",
    tag = "Output styles",
    summary = "List available output styles",
    responses((status = 200, description = "OK", body = serde_json::Value))
)]
pub async fn list_styles() -> Json<serde_json::Value> {
    let (active, forced) = effective_selection();
    let styles: Vec<OutputStyleSummary> = registry()
        .all()
        .iter()
        .map(|r| OutputStyleSummary::new(r, active.as_deref(), forced.as_deref()))
        .collect();
    Json(json!({
        "styles": styles,
        "selected": active,
        "forced": forced,
    }))
}

/// `GET /api/output-styles/:id` — one parsed style record.
#[utoipa::path(
    get,
    path = "/api/output-styles/{id}",
    tag = "Output styles",
    summary = "Get one output style",
    params(("id" = String, Path)),
    responses((status = 200, description = "OK", body = serde_json::Value))
)]
pub async fn get_style(Path(id): Path<String>) -> (StatusCode, Json<serde_json::Value>) {
    match registry().get(&id) {
        Some(record) => (StatusCode::OK, Json(json!({ "style": record }))),
        None => not_found(),
    }
}

/// `GET /api/output-styles/:id/source` — the full editable file plus its decomposed
/// fields, so the editor opens in one round trip.
///
/// `raw` is the file text (a plugin style has no path, so it is the contributed text);
/// `source` is the tier and `editable` says whether saving edits it in place or forks
/// it into the user root.
#[utoipa::path(
    get,
    path = "/api/output-styles/{id}/source",
    tag = "Output styles",
    summary = "Read an output style's raw markdown",
    params(("id" = String, Path)),
    responses((status = 200, description = "OK", body = serde_json::Value))
)]
pub async fn get_style_source(Path(id): Path<String>) -> (StatusCode, Json<serde_json::Value>) {
    let Some(record) = registry().get(&id) else {
        return not_found();
    };
    let raw = registry().source_of(&id).unwrap_or_default();
    (
        StatusCode::OK,
        Json(json!({
            "id": record.id,
            "name": record.name,
            "description": record.description,
            "keep_coding_instructions": record.keep_coding_instructions,
            "body": record.body,
            "raw": raw,
            "source": record.source.as_str(),
            "editable": record.source.is_writable(),
        })),
    )
}

/// `POST /api/output-styles` — create a new user style from the editor.
pub async fn create_style_handler(
    Json(draft): Json<store::OutputStyleDraft>,
) -> (StatusCode, Json<serde_json::Value>) {
    match store::create_style(&draft) {
        Ok(res) => {
            registry().reload();
            (
                StatusCode::OK,
                Json(json!({
                    "id": res.id,
                    "path": res.path.to_string_lossy(),
                    "raw": res.source,
                })),
            )
        }
        Err(e) => write_error(e),
    }
}

/// `PUT /api/output-styles/:id` — save an edited style.
///
/// Writes to the user root either way. When `id` names a plugin / project / managed
/// style this is the **fork** design §6 describes, and the response says so with
/// `forked: true` — the caller needs to be able to tell the user their edit created
/// their own copy rather than changing the shipped one. The original's unmanaged
/// frontmatter keys are carried into the fork.
#[utoipa::path(
    put,
    path = "/api/output-styles/{id}",
    tag = "Output styles",
    summary = "Update (or fork) an output style",
    params(("id" = String, Path)),
    request_body = serde_json::Value,
    responses((status = 200, description = "OK", body = serde_json::Value))
)]
pub async fn update_style_handler(
    Path(id): Path<String>,
    Json(draft): Json<store::OutputStyleDraft>,
) -> (StatusCode, Json<serde_json::Value>) {
    let existing = registry().get(&id);
    let forked = existing
        .as_ref()
        .map(|r| !store::edits_in_place(r.source))
        .unwrap_or(false);
    // Only a fork needs a base to inherit unmanaged keys from; an in-place edit reads
    // its own file inside `update_style`.
    let inherit = forked.then(|| registry().source_of(&id)).flatten();
    match store::update_style(&id, &draft, inherit.as_deref()) {
        Ok(res) => {
            registry().reload();
            (
                StatusCode::OK,
                Json(json!({
                    "id": res.id,
                    "path": res.path.to_string_lossy(),
                    "raw": res.source,
                    "forked": forked,
                })),
            )
        }
        Err(e) => write_error(e),
    }
}

/// `DELETE /api/output-styles/:id` — delete a user style.
///
/// Only the user root is touched. Deleting a fork un-shadows the plugin original, so
/// `deleted: false` genuinely means "there was no file of mine to remove", not
/// "failed".
#[utoipa::path(
    delete,
    path = "/api/output-styles/{id}",
    tag = "Output styles",
    summary = "Delete a user-authored output style",
    params(("id" = String, Path)),
    responses((status = 200, description = "OK", body = serde_json::Value))
)]
pub async fn delete_style_handler(Path(id): Path<String>) -> (StatusCode, Json<serde_json::Value>) {
    match store::delete_style(&id) {
        Ok(deleted) => {
            if deleted {
                // A deleted style must not stay selected — the node would resolve a
                // dangling id on every turn.
                if crate::load_selection().as_deref() == Some(id.as_str()) {
                    crate::set_selection(None);
                }
                registry().reload();
            }
            (
                StatusCode::OK,
                Json(json!({ "success": true, "deleted": deleted })),
            )
        }
        Err(e) => internal(e.to_string()),
    }
}

/// Request body for [`select_style`]. `style_id: null` (or an empty string) clears the
/// selection back to "no style", which is the shipped default.
#[derive(serde::Deserialize)]
pub struct SelectStyleBody {
    #[serde(default)]
    pub style_id: Option<String>,
}

/// `POST /api/output-styles/select { style_id }` — set the legacy node-default style.
///
/// This is the store tab's install action, and it is deliberately the whole of it: a
/// style is a prompt preset. This endpoint remains for older clients and upgrade
/// tooling; normal turns now resolve the profile stored on the selected agent.
#[utoipa::path(
    post,
    path = "/api/output-styles/select",
    tag = "Output styles",
    summary = "Select the legacy node-default output style",
    request_body = serde_json::Value,
    responses((status = 200, description = "OK", body = serde_json::Value))
)]
pub async fn select_style(
    Json(body): Json<SelectStyleBody>,
) -> (StatusCode, Json<serde_json::Value>) {
    let requested = body
        .style_id
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty());

    if let Some(id) = requested.as_deref() {
        // Fail loudly on an unknown id: silently persisting one would make every
        // later turn resolve to no style while the picker showed a selection.
        if registry().get(id).is_none() {
            return not_found();
        }
    }
    crate::set_selection(requested.as_deref());

    let (active, forced) = effective_selection();
    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "style_id": requested,
            "selected": active,
            "forced": forced,
        })),
    )
}

fn not_found() -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::NOT_FOUND,
        Json(json!({ "error": "output style not found" })),
    )
}

fn internal(message: String) -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": message })),
    )
}

/// Map a [`store::CreateError`] to an HTTP response.
fn write_error(e: store::CreateError) -> (StatusCode, Json<serde_json::Value>) {
    use store::CreateError;
    match e {
        CreateError::Conflict(slug) => (
            StatusCode::CONFLICT,
            Json(json!({ "error": format!("an output style named '{slug}' already exists") })),
        ),
        CreateError::Invalid(m) => (StatusCode::BAD_REQUEST, Json(json!({ "error": m }))),
        CreateError::Io(err) => internal(err.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openapi_lists_the_external_paths() {
        let doc = openapi();
        assert!(doc.paths.paths.contains_key("/api/output-styles"));
        assert!(doc.paths.paths.contains_key("/api/output-styles/select"));
        assert!(doc.paths.paths.contains_key("/api/output-styles/{id}"));
        assert!(doc
            .paths
            .paths
            .contains_key("/api/output-styles/{id}/source"));
    }

    #[test]
    fn routes_builds_over_an_arbitrary_state() {
        // Compiles + builds for a unit state, proving the generic `Router<S>` nests
        // into Core's `ServerState` router (the whole reason handlers are State-free).
        let _: Router<()> = routes(OutputStylesCtx::new(OutputStyleRegistry::empty()));
    }
}
