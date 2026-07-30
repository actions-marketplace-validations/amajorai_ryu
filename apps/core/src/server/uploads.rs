//! User-upload kernel surface — files land in the **Uploads** system space.
//!
//! Chat attachments, page/editor media, and the host `ui.uploadFile` bridge all
//! persist here (content-addressed Spaces blobs), not in the legacy
//! `~/.ryu/media/` store. The HTTP surface stays **ungated** by the Spaces app
//! (same reason `/api/media/*` is ungated): uploads are kernel storage that Voice
//! / chat / the editor need even when the Spaces UI is off. Serving is scoped to
//! documents that actually live in the Uploads space so this is not a backdoor
//! into arbitrary Space files.

use std::collections::HashMap;

use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

use super::spaces::{self, UPLOADS_SPACE_NAME};
use super::{caller_tenancy, ServerState};

/// Cap mirrors the legacy media upload limit (editor pastes / chat images).
pub const MAX_UPLOAD_BYTES: usize = super::media::MAX_MEDIA_BYTES;

/// `POST /api/uploads` — store raw request-body bytes as a file document in the
/// Uploads system space. Filename from `x-filename` / `?name=`; content-type from
/// the `content-type` header. Returns id + serve URL (`/api/uploads/<id>`).
#[utoipa::path(
    post,
    path = "/api/uploads",
    tag = "Uploads",
    summary = "Store a user file in the Uploads system space",
    request_body = serde_json::Value,
    responses((status = 200, description = "OK", body = serde_json::Value))
)]
pub async fn upload_file(
    State(state): State<ServerState>,
    axum::Extension(caller): axum::Extension<Option<crate::identity_verify::VerifiedCaller>>,
    Query(params): Query<HashMap<String, String>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if body.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "empty upload" })),
        )
            .into_response();
    }
    if body.len() > MAX_UPLOAD_BYTES {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(json!({
                "error": format!(
                    "upload too large: {} bytes (max {} MB)",
                    body.len(),
                    MAX_UPLOAD_BYTES / (1024 * 1024)
                )
            })),
        )
            .into_response();
    }

    let name = headers
        .get("x-filename")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
        .or_else(|| params.get("name").cloned())
        .unwrap_or_else(|| "upload".to_string());
    let mime = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|c| c.split(';').next().unwrap_or(c).trim().to_owned())
        .filter(|c| !c.is_empty())
        .unwrap_or_else(|| "application/octet-stream".to_owned());

    let space_id = match state
        .spaces
        .ensure_system_space(
            UPLOADS_SPACE_NAME,
            Some("Files you upload in chat and pages"),
        )
        .await
    {
        Ok(id) => id,
        Err(e) => {
            tracing::error!("upload_file: ensuring Uploads space: {e:#}");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "failed to resolve Uploads space" })),
            )
                .into_response();
        }
    };

    let title = if name.trim().is_empty() {
        "Untitled"
    } else {
        name.trim()
    };
    let tenancy = spaces::owner_of(&caller_tenancy(&caller));
    match state
        .spaces
        .create_file(&space_id, title, &body, &mime, &tenancy)
        .await
    {
        Ok(document_id) => (
            StatusCode::OK,
            Json(json!({
                "id": document_id,
                "space_id": space_id,
                "file_name": title,
                "url": format!("/api/uploads/{document_id}"),
                "size": body.len(),
                "content_type": mime,
            })),
        )
            .into_response(),
        Err(e) => {
            tracing::error!("upload_file: create_file: {e:#}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e.to_string() })),
            )
                .into_response()
        }
    }
}

/// `GET /api/uploads/:id` — serve a file that lives in the Uploads system space.
/// Images render inline (editor `<img>`); risky MIME types are neutralized.
#[utoipa::path(
    get,
    path = "/api/uploads/{id}",
    tag = "Uploads",
    summary = "Serve a user upload from the Uploads system space",
    params(("id" = String, Path)),
    responses((status = 200, description = "OK"))
)]
pub async fn serve_upload(
    State(state): State<ServerState>,
    Path(doc_id): Path<String>,
) -> Response {
    // No per-doc ACL here — matching `/api/media/:file`. The unguessable doc id is
    // the capability, so an image embedded in a shared page still renders for every
    // node member who can load the page. We still require the doc to live in the
    // Uploads system space so this is not a backdoor into Artifacts/other Spaces.

    let Some(meta) = (match state.spaces.get_file_meta(&doc_id).await {
        Ok(m) => m,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e.to_string() })),
            )
                .into_response();
        }
    }) else {
        return (StatusCode::NOT_FOUND, "upload not found").into_response();
    };

    // Only documents in the Uploads system space are reachable here.
    let uploads_id = match state
        .spaces
        .ensure_system_space(UPLOADS_SPACE_NAME, None)
        .await
    {
        Ok(id) => id,
        Err(e) => {
            tracing::error!("serve_upload: ensuring Uploads space: {e:#}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response();
        }
    };
    if meta.space_id != uploads_id {
        return (StatusCode::NOT_FOUND, "upload not found").into_response();
    }

    let Some((mime, bytes)) = (match state.spaces.read_file_blob(&doc_id).await {
        Ok(v) => v,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e.to_string() })),
            )
                .into_response();
        }
    }) else {
        return (StatusCode::NOT_FOUND, "upload not found").into_response();
    };

    let content_type = safe_inline_mime(&mime);
    let is_image = content_type.starts_with("image/");
    if is_image {
        (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, content_type),
                (
                    header::CACHE_CONTROL,
                    "private, max-age=31536000, immutable".to_owned(),
                ),
                (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_owned()),
            ],
            bytes,
        )
            .into_response()
    } else {
        (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, content_type),
                (header::CONTENT_DISPOSITION, "attachment".to_owned()),
                (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_owned()),
                (
                    header::CONTENT_SECURITY_POLICY,
                    "sandbox; default-src 'none'".to_owned(),
                ),
            ],
            bytes,
        )
            .into_response()
    }
}

/// Collapse script-capable MIME types; leave images/PDF/plain data alone so the
/// editor can render uploads inline.
fn safe_inline_mime(mime: &str) -> String {
    let base = mime
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    let risky = matches!(
        base.as_str(),
        "text/html" | "application/xhtml+xml" | "image/svg+xml" | "application/xml" | "text/xml"
    ) || base.ends_with("+xml")
        || base.is_empty();
    if risky {
        "application/octet-stream".to_owned()
    } else {
        mime.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::safe_inline_mime;

    #[test]
    fn images_pass_through() {
        assert_eq!(safe_inline_mime("image/png"), "image/png");
        assert_eq!(
            safe_inline_mime("image/jpeg; charset=binary"),
            "image/jpeg; charset=binary"
        );
    }

    #[test]
    fn html_and_svg_are_neutralized() {
        assert_eq!(safe_inline_mime("text/html"), "application/octet-stream");
        assert_eq!(
            safe_inline_mime("image/svg+xml"),
            "application/octet-stream"
        );
    }
}
