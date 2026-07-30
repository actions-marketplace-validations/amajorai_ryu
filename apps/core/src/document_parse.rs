//! The **`document.parse` facade** — Core's single document-extraction path.
//!
//! Before this module a PDF dropped into the composer was silently discarded: all
//! three desktop composers filtered attachments to `image/*`, and the two chat
//! planes filtered again at [`crate::sidecar::adapters`]. Nothing in the tree read a
//! document. The `unstructured` app (`apps-store/unstructured/`) registered a
//! `document.parse` provider, but the capability had no caller.
//!
//! This is that caller, and it is deliberately the **only** one. Every surface that
//! wants text out of a file goes through these three routes; there is no second
//! extraction path to drift from.
//!
//! ## Shape: submit → poll, never one long request
//!
//! [`parse_document`] returns either a finished result (builtin floor) or a
//! `job_id` to poll ([`parse_job`]). It never blocks on a parse. That is forced by
//! the ext-proxy's activity guard, which drops when response *headers* arrive: a
//! `lazy` + `idle_stop_secs` provider sidecar can be reaped mid-parse if the caller
//! holds one long request open. Polling re-arms the guard. The provider
//! (`ryu_unstructured.server`) is built to the same contract for the same reason.
//!
//! ## The builtin floor is not a fallback, it is a floor
//!
//! A `.txt`/`.md`/`.csv` file *is* its own text. Routing it through a 1-2 GB Python
//! sidecar to learn that would make plain-text attachments depend on an opt-in
//! install, so Core reads those itself ([`builtin_markdown`]) and never consults a
//! provider. The floor is intentionally narrow — UTF-8 families where the bytes are
//! the content. Anything else (PDF, the Office family, EPUB, scanned images) needs a
//! real parser, and when none is bound the caller gets a **415 that names the
//! extension**, so the UI can say "no parser for .pdf — install one" instead of
//! dropping the file.
//!
//! ## Provider-agnostic by construction
//!
//! Nothing here names `com.ryu.unstructured`. The provider is resolved through
//! [`crate::plugins::binding`] exactly like `web.search` or `computer.control`:
//! user override > sole provider > declared default > lowest id. A second backend is
//! pure manifest data. The normalized response shape (`status` / `markdown` /
//! `error` / `missing_dependencies`) is this facade's contract, not any one
//! backend's — [`normalize_job`] maps the provider's snapshot onto it.

use std::collections::HashSet;

use axum::{
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};

use crate::server::ServerState;
use crate::sidecar::ext_proxy::{ext_token, node_token, resolve_provider_route, ProviderRoute};

/// The capability this facade consumes. One string, one place.
pub const CAP_DOCUMENT_PARSE: &str = "document.parse";

/// Cap on bytes accepted for a parse, mirroring [`crate::server::uploads::MAX_UPLOAD_BYTES`]
/// so a file the user could attach is a file the parser will look at.
pub const MAX_PARSE_BYTES: usize = crate::server::uploads::MAX_UPLOAD_BYTES;

/// Cap on bytes the typed in-process floor ([`builtin_parse`]) will read.
///
/// Deliberately NOT [`MAX_PARSE_BYTES`]: that one is an *HTTP upload* limit and means
/// nothing to a caller holding a blob address rather than a request body. A Space file
/// goes to 200 MiB, and a 50 MiB `.csv` must not be refused as "too large" on a path
/// where the same 50 MiB as a `.pdf` reaches a provider whose own ceiling is 200 MiB.
/// The read costs memory but the OUTPUT is clamped by [`MAX_MARKDOWN_BYTES`] either
/// way, so the wider bound buys correctness for free.
pub const MAX_BLOB_PARSE_BYTES: usize = 200 * 1024 * 1024;

/// Cap on extracted markdown returned to a caller, in bytes.
///
/// This bound exists because the extracted text lands in a chat turn and is
/// persisted with it: an unbounded 900-page PDF would be re-sent on every
/// subsequent turn of that thread. Truncation is REPORTED (`truncated: true`), never
/// silent — the whole point of this change is that files stop disappearing quietly.
pub const MAX_MARKDOWN_BYTES: usize = 400_000;

/// How long a single hop to the provider sidecar may take. Submit and poll are both
/// short by construction (the parse itself happens on the provider's worker pool),
/// so this is a transport bound, not a parse bound.
const PROVIDER_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// Budget for the never-wakes `/capability` probe. Short on purpose: an asleep
/// provider must cost the composer a refused loopback connection, not a stall.
const CAPABILITY_PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);

/// How long to wait for a lazy/idle-stopped provider sidecar to become healthy
/// before declining the submit. Matches the ext-proxy's own wake budget.
const WAKE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

/// Extensions Core decodes itself, with no provider bound — the floor.
///
/// Every entry is a UTF-8 text family whose bytes ARE the document. Deliberately
/// excludes anything needing a real parser (`.pdf`, `.docx`, `.pptx`, `.xlsx`,
/// `.epub`, images): guessing at those would produce mojibake presented as content,
/// which is worse than the honest "no parser for this" the caller gets instead.
pub const BUILTIN_EXTENSIONS: &[&str] = &[
    ".txt",
    ".text",
    ".md",
    ".markdown",
    ".mdx",
    ".rst",
    ".org",
    ".csv",
    ".tsv",
    ".json",
    ".jsonl",
    ".ndjson",
    ".yaml",
    ".yml",
    ".toml",
    ".xml",
    ".html",
    ".htm",
    ".log",
    ".ini",
    ".conf",
    ".env",
    ".sql",
    ".tex",
    ".srt",
    ".vtt",
];

/// The lowercase extension of `filename`, dot included (`"a/b/Report.PDF"` → `".pdf"`).
///
/// Takes the LAST dot only. A compound suffix like `.tar.gz` therefore reads as
/// `.gz`, which is correct here: the floor does not claim archives, and a provider
/// that does matches on its own list.
pub fn extension_of(filename: &str) -> String {
    let base = filename.rsplit(['/', '\\']).next().unwrap_or(filename);
    match base.rfind('.') {
        Some(i) if i + 1 < base.len() => base[i..].to_ascii_lowercase(),
        _ => String::new(),
    }
}

/// Percent-decode a header value. Invalid escapes are kept verbatim rather than
/// dropped — a mangled character in a filename is recoverable, a silently shortened
/// one is not.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Whether Core itself can read `filename` with no provider bound.
pub fn is_builtin_readable(filename: &str) -> bool {
    let ext = extension_of(filename);
    !ext.is_empty() && BUILTIN_EXTENSIONS.contains(&ext.as_str())
}

/// Decode floor bytes to markdown, or `None` when they are not valid UTF-8.
///
/// Strict, not lossy, on purpose: a `.txt` that is actually UTF-16 or a mislabelled
/// binary should surface as "cannot read this" rather than as a page of replacement
/// characters the model would then reason about as if it were content. This is the
/// **route** floor and its strictness is the shipped `415 not_text` contract; the
/// in-process floor ([`builtin_parse`]) is allowed a lossy last resort because it can
/// report it in `warnings`, which an HTTP status code cannot.
///
/// HTML is tag-stripped rather than passed through: `.html` is on the floor because
/// its bytes are text, but handing a model raw `<div class="…">` markup as "the
/// document" spends the context window on layout. Minimal on purpose — see
/// [`strip_html`].
pub fn builtin_markdown(filename: &str, bytes: &[u8]) -> Option<(String, bool)> {
    let text = std::str::from_utf8(bytes).ok()?;
    Some(truncate_markdown(&apply_html_strip(filename, text)))
}

/// Tag-strip when the extension says HTML, pass through otherwise.
fn apply_html_strip(filename: &str, text: &str) -> String {
    match extension_of(filename).as_str() {
        ".html" | ".htm" => strip_html(text),
        _ => text.to_owned(),
    }
}

/// The minimal HTML-to-text reduction the floor performs.
///
/// Deliberately NOT an HTML parser: it drops `<script>`/`<style>` bodies, removes
/// tags, resolves the five XML entities plus `&nbsp;`/`&#39;`, and collapses runs of
/// blank lines. A real DOM-aware conversion (tables, headings, lists) is exactly what
/// a `document.parse` provider is for — the floor's job is to stop plain files from
/// needing one, not to compete with it.
fn strip_html(html: &str) -> String {
    // Drop the two element bodies that are never document content. Case-insensitive
    // on the tag name; an unclosed one swallows the remainder, which is the safe
    // direction (script text is never prose).
    let mut rest = html.to_owned();
    for tag in ["script", "style"] {
        rest = drop_element(&rest, tag);
    }

    let mut out = String::with_capacity(rest.len());
    let mut in_tag = false;
    for ch in rest.chars() {
        match ch {
            '<' => in_tag = true,
            '>' if in_tag => {
                in_tag = false;
                // A removed tag is a word boundary: `a<br>b` must not become `ab`.
                out.push('\n');
            }
            _ if in_tag => {}
            _ => out.push(ch),
        }
    }

    let decoded = out
        .replace("&nbsp;", " ")
        .replace("&#39;", "'")
        .replace("&quot;", "\"")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        // `&amp;` last, so `&amp;lt;` stays the literal `&lt;` it encoded.
        .replace("&amp;", "&");

    let mut lines: Vec<&str> = Vec::new();
    for line in decoded.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() && lines.last().is_some_and(|l: &&str| l.is_empty()) {
            continue;
        }
        lines.push(trimmed);
    }
    lines.join("\n").trim().to_owned()
}

/// Remove every `<tag …>…</tag>` region from `src`, tag name matched case-insensitively.
fn drop_element(src: &str, tag: &str) -> String {
    let lower = src.to_ascii_lowercase();
    let open = format!("<{tag}");
    let close = format!("</{tag}");
    let mut out = String::with_capacity(src.len());
    let mut cursor = 0usize;
    while let Some(hit) = lower[cursor..].find(&open) {
        let start = cursor + hit;
        out.push_str(&src[cursor..start]);
        match lower[start..].find(&close) {
            Some(end) => {
                let after = start + end;
                cursor = src[after..]
                    .find('>')
                    .map_or(src.len(), |gt| after + gt + 1);
            }
            // Unclosed: everything after the open tag is script/style text.
            None => cursor = src.len(),
        }
    }
    out.push_str(&src[cursor.min(src.len())..]);
    out
}

/// Clamp markdown to [`MAX_MARKDOWN_BYTES`] on a char boundary. Returns the text and
/// whether it was cut.
fn truncate_markdown(text: &str) -> (String, bool) {
    if text.len() <= MAX_MARKDOWN_BYTES {
        return (text.to_owned(), false);
    }
    let mut end = MAX_MARKDOWN_BYTES;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    (text[..end].to_owned(), true)
}

// ── Provider resolution ───────────────────────────────────────────────────────

/// The bound `document.parse` provider: its plugin id, display name, and the
/// resolved route to its sidecar. `None` when no enabled app provides the capability.
///
/// Mirrors [`crate::memory_provider::bound_provider`] in intent — "who serves this
/// capability right now" — but resolves through the binding registry rather than the
/// MCP verb table, because this capability is served by an HTTP route on a sidecar
/// (`provides[].sidecar` + `provides[].route`), not by MCP verbs.
async fn bound_provider(state: &ServerState) -> Option<(ProviderRoute, String)> {
    let records = state.app_store.list().await.ok()?;
    let enabled: HashSet<String> = records
        .iter()
        .filter(|r| r.enabled)
        .map(|r| r.id.clone())
        .collect();

    let manifests = state.app_manifests.read().await;
    let candidates: Vec<crate::plugin_manifest::PluginManifest> = manifests
        .iter()
        .filter(|m| enabled.contains(&m.id))
        .cloned()
        .collect();
    drop(manifests);

    let cfg = crate::plugins::binding::active_config();
    let registry = crate::plugins::binding::BindingRegistry::new(&cfg, &candidates);
    let req = crate::plugin_manifest::CapabilityReq {
        capability: CAP_DOCUMENT_PARSE.to_owned(),
        min_version: None,
    };
    let binding = registry.resolve(&req).ok()?;
    let provider = candidates.iter().find(|m| m.id == binding.provider_id)?;
    let entry = provider
        .provided_capabilities()
        .iter()
        .find(|e| e.capability == CAP_DOCUMENT_PARSE)?
        .clone();
    let route = resolve_provider_route(provider, &entry, &binding.provider_id).ok()?;
    Some((route, provider.name.clone()))
}

/// The provider's sibling route for `name`, derived from its declared submit route.
///
/// **The convention, stated once:** a `document.parse` provider declares its *submit*
/// route in `provides[].route` (`/parse`) and serves `capability` and `jobs/{id}` as
/// siblings of it. The manifest schema has one `route` field, and inventing three
/// would push backend-specific layout into the kernel contract for every capability;
/// pinning the sibling names here keeps the manifest a single line while the poll and
/// discovery surfaces stay provider-agnostic. `/parse` → `/capability`, `/jobs/<id>`,
/// and a mounted provider (`/api/doc/parse`) keeps its mount.
fn sibling_path(route: &ProviderRoute, name: &str) -> String {
    let base = match route.upstream_path.rfind('/') {
        Some(i) => &route.upstream_path[..i],
        None => "",
    };
    format!("{base}/{name}")
}

/// Wake a lazy provider sidecar and hold it for the hop.
///
/// The returned guard must stay alive across the request: the ext-proxy's activity
/// guard drops at header arrival, so without it an idle-stop sidecar can be reaped
/// between the wake and the call.
async fn wake_provider(
    state: &ServerState,
    route: &ProviderRoute,
) -> Result<Option<crate::sidecar::manager::ActivityGuard>, Response> {
    let Some(wake) = route.wake_name.as_ref() else {
        return Ok(None);
    };
    state
        .manager
        .wake_and_await_healthy(wake, WAKE_TIMEOUT)
        .await
        .map_err(|e| {
            tracing::warn!("document.parse: waking provider '{wake}' failed: {e}");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({
                    "error": "document parser is warming up, retry shortly",
                    "code": "provider_warming",
                })),
            )
                .into_response()
        })?;
    Ok(Some(state.manager.enter_request(wake)))
}

/// One authenticated hop to the provider sidecar. The bearer is the PROVIDER's
/// minted `ext_token` — the same secret the ext-proxy stamps — so the sidecar's
/// fail-closed middleware accepts it and no other local process can.
///
/// Typed variant: the HTTP handlers below flatten this into a [`Response`]
/// ([`provider_call`]), the in-process API keeps the reason so a caller can tell a
/// transport timeout from a refused connection.
async fn provider_call_typed(
    route: &ProviderRoute,
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
    timeout: std::time::Duration,
) -> Result<(StatusCode, Value), ParseFailure> {
    let url = format!("http://127.0.0.1:{}{}", route.port, path);
    let token = ext_token(node_token().as_deref(), &route.provider_id);
    let client = reqwest::Client::new();
    let mut req = client
        .request(method, &url)
        .timeout(timeout)
        .bearer_auth(token);
    if let Some(body) = body {
        req = req.json(&body);
    }
    let resp = req.send().await.map_err(|e| {
        tracing::warn!("document.parse: provider call to {url} failed: {e}");
        let reason = if e.is_timeout() {
            ParseFailureReason::ProviderTimeout
        } else {
            ParseFailureReason::ProviderError
        };
        ParseFailure::new(reason, "document parser is unreachable")
    })?;
    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let value: Value = resp.json().await.unwrap_or_else(|_| json!({}));
    Ok((status, value))
}

/// [`provider_call_typed`] flattened for the HTTP handlers.
///
/// Both transport reasons collapse to the SAME 502 `provider_unreachable` the route
/// contract has always returned — the typed split is new information for in-process
/// callers, not a change to a shipped wire response.
async fn provider_call(
    route: &ProviderRoute,
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
    timeout: std::time::Duration,
) -> Result<(StatusCode, Value), Response> {
    provider_call_typed(route, method, path, body, timeout)
        .await
        .map_err(|_| {
            (
                StatusCode::BAD_GATEWAY,
                Json(json!({
                    "error": "document parser is unreachable",
                    "code": "provider_unreachable",
                })),
            )
                .into_response()
        })
}

// ── Routes ────────────────────────────────────────────────────────────────────

/// `GET /api/documents/parse/capability` — what this node can read, right now.
///
/// The composer's file-picker `accept` list is built from this, so the picker offers
/// exactly what the bound backend (plus the floor) can actually handle instead of a
/// hardcoded guess that drifts the moment a provider is swapped.
#[utoipa::path(
    get,
    path = "/api/documents/parse/capability",
    tag = "Documents",
    summary = "Formats this node can extract text from",
    responses((status = 200, description = "OK", body = serde_json::Value))
)]
pub async fn parse_capability(State(state): State<ServerState>) -> Response {
    let builtin: Vec<String> = BUILTIN_EXTENSIONS.iter().map(|s| (*s).to_owned()).collect();

    let Some((route, provider_name)) = bound_provider(&state).await else {
        // No provider bound. Honest, not empty: the floor still works, and the
        // caller needs to know the difference so it can tell the user why a PDF is
        // refused rather than dropping it.
        return Json(json!({
            "provider": Value::Null,
            "provider_name": Value::Null,
            "available": true,
            "extensions": builtin,
            "builtin_extensions": BUILTIN_EXTENSIONS,
            "missing_dependencies": [],
            "max_input_bytes": MAX_PARSE_BYTES,
        }))
        .into_response();
    };

    // A lazy provider is deliberately NOT woken to answer this. Every composer mount
    // asks what formats are readable; spinning a 1-2 GB Python process for a picker's
    // `accept` list would make opening a chat expensive. So the probe is a plain
    // short-timeout call: if the sidecar is asleep nothing is listening on loopback
    // and it fails immediately, and we answer with the floor plus the provider's
    // identity. The format list fills in once a real parse has woken it.
    let probe = provider_call(
        &route,
        reqwest::Method::GET,
        &sibling_path(&route, "capability"),
        None,
        CAPABILITY_PROBE_TIMEOUT,
    )
    .await
    .ok();

    let (formats, missing, available) = match probe {
        Some((status, body)) if status.is_success() => {
            let formats: Vec<String> = body
                .get("formats")
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_default();
            let missing: Vec<String> = body
                .get("missing_dependencies")
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_default();
            let available = body
                .get("available")
                .and_then(Value::as_bool)
                .unwrap_or(true);
            (formats, missing, available)
        }
        _ => (Vec::new(), Vec::new(), true),
    };

    let mut extensions: Vec<String> = builtin.clone();
    for f in formats {
        if !extensions.contains(&f) {
            extensions.push(f);
        }
    }
    extensions.sort();

    Json(json!({
        "provider": route.provider_id,
        "provider_name": provider_name,
        "available": available,
        "extensions": extensions,
        "builtin_extensions": BUILTIN_EXTENSIONS,
        "missing_dependencies": missing,
        "max_input_bytes": MAX_PARSE_BYTES,
    }))
    .into_response()
}

/// `POST /api/documents/parse` — submit bytes for extraction.
///
/// Raw request body + `x-filename` (the same shape as `POST /api/uploads`, so a
/// caller that already stages an upload does not have to learn a second encoding).
///
/// Returns one of three things, and **never** silently succeeds with nothing:
/// - `{ status: "succeeded", via: "builtin", markdown, truncated }` — the floor read it;
/// - `{ status: "queued", via: "<provider id>", job_id }` — poll [`parse_job`];
/// - `415 { code: "unsupported_format", extension }` — no floor, no provider that
///   claims it. The caller shows this on the attachment chip.
#[utoipa::path(
    post,
    path = "/api/documents/parse",
    tag = "Documents",
    summary = "Extract markdown from a document",
    request_body = serde_json::Value,
    responses((status = 200, description = "OK", body = serde_json::Value))
)]
pub async fn parse_document(
    State(state): State<ServerState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if body.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "empty document", "code": "empty" })),
        )
            .into_response();
    }
    if body.len() > MAX_PARSE_BYTES {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(json!({
                "error": format!(
                    "document too large: {} bytes (max {} MB)",
                    body.len(),
                    MAX_PARSE_BYTES / (1024 * 1024)
                ),
                "code": "too_large",
            })),
        )
            .into_response();
    }

    // `x-filename` is percent-encoded by the caller. HTTP headers are Latin-1, so a
    // raw `Rapport financier — Q3.pdf` either throws in the browser's fetch or
    // arrives mojibake'd; percent-encoding is the only way a non-ASCII document name
    // survives the hop, and losing it would cost the extension the dispatch depends on.
    let filename = headers
        .get("x-filename")
        .and_then(|v| v.to_str().ok())
        .map(percent_decode)
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "document".to_owned());
    let ext = extension_of(&filename);

    // 1. Floor first — a text file must not depend on an opt-in 1-2 GB install.
    if is_builtin_readable(&filename) {
        return match builtin_markdown(&filename, &body) {
            Some((markdown, truncated)) => Json(json!({
                "status": "succeeded",
                "via": "builtin",
                "filename": filename,
                "markdown": markdown,
                "truncated": truncated,
            }))
            .into_response(),
            None => (
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                Json(json!({
                    "error": format!("{filename} is not valid UTF-8 text"),
                    "code": "not_text",
                    "extension": ext,
                })),
            )
                .into_response(),
        };
    }

    // 2. Otherwise the bound provider, or an honest refusal that names the format.
    let Some((route, provider_name)) = bound_provider(&state).await else {
        return (
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            Json(json!({
                "error": format!(
                    "no document parser is installed that can read {}",
                    if ext.is_empty() { "this file" } else { ext.as_str() }
                ),
                "code": "no_provider",
                "extension": ext,
            })),
        )
            .into_response();
    };

    let _activity = match wake_provider(&state, &route).await {
        Ok(guard) => guard,
        Err(resp) => return resp,
    };

    // The provider takes inline bytes (`content_base64`) rather than a path: Core
    // holds the request body in memory and has no shared staging contract with an
    // arbitrary provider, and handing a provider a filesystem path it then reads
    // would be an arbitrary-file-read primitive if the path ever came from a client.
    use base64::Engine as _;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&body);
    let (status, value) = match provider_call(
        &route,
        reqwest::Method::POST,
        &route.upstream_path,
        Some(json!({ "content_base64": encoded, "filename": filename })),
        PROVIDER_TIMEOUT,
    )
    .await
    {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    if !status.is_success() {
        let msg = value
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("document parser rejected this file");
        return (
            status,
            Json(json!({
                "error": msg,
                "code": value.get("error_code").and_then(Value::as_str).unwrap_or("provider_error"),
                "provider": route.provider_id,
                "provider_name": provider_name,
            })),
        )
            .into_response();
    }

    let Some(job_id) = value.get("job_id").and_then(Value::as_str) else {
        return (
            StatusCode::BAD_GATEWAY,
            Json(json!({
                "error": "document parser accepted the file but returned no job id",
                "code": "provider_contract",
            })),
        )
            .into_response();
    };

    Json(json!({
        "status": value.get("status").and_then(Value::as_str).unwrap_or("queued"),
        "via": route.provider_id,
        "provider_name": provider_name,
        "job_id": job_id,
        "filename": filename,
    }))
    .into_response()
}

/// `GET /api/documents/parse/jobs/:job_id` — poll a submitted parse.
///
/// Normalized to this facade's shape, so a caller written against `unstructured`
/// keeps working when a different backend is bound.
#[utoipa::path(
    get,
    path = "/api/documents/parse/jobs/{job_id}",
    tag = "Documents",
    summary = "Poll a document-parse job",
    params(("job_id" = String, Path, description = "Job id from POST /api/documents/parse")),
    responses((status = 200, description = "OK", body = serde_json::Value))
)]
pub async fn parse_job(State(state): State<ServerState>, Path(job_id): Path<String>) -> Response {
    // A job id is opaque and goes into a URL path; refuse anything that could
    // traverse out of the provider's `/jobs/` namespace rather than encoding around
    // it (the ext-proxy rejects `..` for the same reason).
    if job_id.is_empty()
        || job_id.contains("..")
        || job_id.contains('/')
        || job_id.contains('\\')
        || job_id.contains('?')
        || job_id.contains('#')
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "invalid job id", "code": "bad_job_id" })),
        )
            .into_response();
    }

    let Some((route, _)) = bound_provider(&state).await else {
        // The provider was disabled mid-parse. The job died with it; say so rather
        // than leaving the caller polling forever.
        return (
            StatusCode::NOT_FOUND,
            Json(json!({
                "status": "failed",
                "error": "the document parser was disabled while this file was parsing",
                "code": "no_provider",
            })),
        )
            .into_response();
    };

    let _activity = match wake_provider(&state, &route).await {
        Ok(guard) => guard,
        Err(resp) => return resp,
    };

    let (status, value) = match provider_call(
        &route,
        reqwest::Method::GET,
        &sibling_path(&route, &format!("jobs/{job_id}")),
        None,
        PROVIDER_TIMEOUT,
    )
    .await
    {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    if !status.is_success() {
        return (
            status,
            Json(json!({
                "status": "failed",
                "error": value.get("error").and_then(Value::as_str).unwrap_or("unknown parse job"),
                "code": "unknown_job",
            })),
        )
            .into_response();
    }

    Json(normalize_job(&value)).into_response()
}

/// Map a provider job snapshot onto this facade's contract.
///
/// The provider's own vocabulary (`result.markdown`, `missing_dependencies`) is an
/// implementation detail of one backend; callers see `markdown` / `error` /
/// `missing_dependencies` at the top level regardless of who parsed.
fn normalize_job(snapshot: &Value) -> Value {
    let status = snapshot
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("running");
    let result = snapshot.get("result");
    let (markdown, truncated) = result
        .and_then(|r| r.get("markdown"))
        .and_then(Value::as_str)
        .map(truncate_markdown)
        .map(|(md, cut)| {
            let already = result
                .and_then(|r| r.get("truncated"))
                .and_then(Value::as_bool)
                .unwrap_or(false);
            (Some(md), cut || already)
        })
        .unwrap_or((None, false));

    let missing: Vec<&str> = snapshot
        .get("missing_dependencies")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();

    // A `succeeded` job with no markdown is a failure from the caller's side: the
    // whole contract is "you get text back". Reporting it as success would recreate
    // the silent-drop bug one layer up.
    let effective_status = if status == "succeeded" && markdown.is_none() {
        "failed"
    } else {
        status
    };
    let error = snapshot
        .get("error")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .or_else(|| {
            (effective_status == "failed" && markdown.is_none())
                .then(|| "the parser returned no text for this file".to_owned())
        });

    json!({
        "status": effective_status,
        "job_id": snapshot.get("job_id").cloned().unwrap_or(Value::Null),
        "filename": snapshot.get("filename").cloned().unwrap_or(Value::Null),
        "markdown": markdown,
        "truncated": truncated,
        "error": error,
        "missing_dependencies": missing,
    })
}

// ── The typed, in-process API ─────────────────────────────────────────────────
//
// The three routes above serve HTTP callers (the composers). Everything else in
// Core that needs text out of a file — Spaces ingest first — calls THIS, because a
// `Response` is not an answer an ingest pipeline can branch on: it needs to tell
// "this format has no parser" (skip the file, say so on the doc) from "the parser
// timed out" (retry later) from "the host has no Python" (tell the user to install
// it), and an axum `Response` flattens all three into bytes.

/// Why a parse produced no text. Every variant is a DIFFERENT action for the caller,
/// which is the whole reason this is an enum and not a string.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParseFailureReason {
    /// No floor claims this extension and no bound provider does either. The file is
    /// readable by nothing on this node **right now** — a permanent answer only until
    /// a provider is installed.
    Unsupported,
    /// A provider-needing format with no provider bound at all. Distinct from
    /// [`Self::Unsupported`] because the fix is "install a `document.parse` app",
    /// not "this format is unreadable".
    NoProvider,
    /// The provider was reachable but did not answer inside the hop budget, or the
    /// parse job itself hit the backend's wall-clock ceiling. Retryable.
    ProviderTimeout,
    /// The provider answered, and the answer was a failure (missing native tool,
    /// corrupt document, backend crash). `message` carries its words.
    ProviderError,
    /// Over [`MAX_PARSE_BYTES`]. Nothing was attempted.
    TooLarge,
    /// A provider is bound but its sidecar cannot run because the HOST has no Python
    /// interpreter to build a venv from. Core bundles none
    /// ([`crate::sidecar::external_runtime`]), so this is a real and common
    /// deployment state, and it MUST NOT read as "the document has no text" — that
    /// is the failure mode the builtin floor exists to make impossible.
    PythonMissing,
}

impl ParseFailureReason {
    /// The stable wire code, shared with the HTTP routes' `code` field.
    pub const fn code(self) -> &'static str {
        match self {
            Self::Unsupported => "unsupported_format",
            Self::NoProvider => "no_provider",
            Self::ProviderTimeout => "provider_timeout",
            Self::ProviderError => "provider_error",
            Self::TooLarge => "too_large",
            Self::PythonMissing => "python_missing",
        }
    }
}

/// A parse that produced no text, with the reason a caller can branch on.
#[derive(Debug, Clone)]
pub struct ParseFailure {
    pub reason: ParseFailureReason,
    pub message: String,
}

impl ParseFailure {
    fn new(reason: ParseFailureReason, message: impl Into<String>) -> Self {
        Self {
            reason,
            message: message.into(),
        }
    }
}

impl std::fmt::Display for ParseFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.reason.code(), self.message)
    }
}

impl std::error::Error for ParseFailure {}

/// A parse that produced text, and everything a store needs to record about it.
///
/// `backend_id` + `backend_version` + `parsed_at` exist so a re-index can tell rows
/// extracted by an old backend from rows extracted by the current one: swapping the
/// bound provider changes the text, and a chunk table with no provenance cannot know
/// which of its rows are stale.
#[derive(Debug, Clone)]
pub struct ParseOutcome {
    /// The extracted text, clamped to [`MAX_MARKDOWN_BYTES`].
    pub markdown: String,
    /// `"builtin"` for the floor, otherwise the provider's plugin id.
    pub backend_id: String,
    /// The backend's own version string. Empty when it reported none.
    pub backend_version: String,
    /// Lowercase hex sha256 of the SOURCE bytes — the blob address, so a caller can
    /// dedupe an extraction against the file it came from.
    pub source_sha256: String,
    pub parsed_at: chrono::DateTime<chrono::Utc>,
    /// Non-fatal notes: a lossy decode, a missing OCR tool, a truncated result.
    /// Populated, not swallowed — a degraded parse the caller cannot see is the
    /// silent-drop bug wearing a hat.
    pub warnings: Vec<String>,
    /// Whether `markdown` was cut at a cap.
    pub truncated: bool,
}

/// What a submit produced: a finished parse (the floor answered) or a job to poll.
#[derive(Debug, Clone)]
pub enum ParseSubmission {
    Done(Box<ParseOutcome>),
    Job {
        job_id: String,
        backend_id: String,
    },
}

/// `"builtin"` — the backend id the floor reports. Not a plugin id, and deliberately
/// not a name any app may take (`plugins::binding` ids are reverse-DNS).
pub const BUILTIN_BACKEND_ID: &str = "builtin";

/// Decode bytes Core can read itself, or say precisely why it cannot.
///
/// The floor, as a typed call. Differs from [`builtin_markdown`] in exactly one way:
/// a non-UTF-8 input is decoded anyway (BOM'd UTF-16 properly, anything else lossily)
/// with the compromise recorded in `warnings`, because this caller CAN carry that
/// nuance where an HTTP status code cannot. A non-floor extension is
/// [`ParseFailureReason::Unsupported`] — never an empty string, which is the one
/// answer that would let a document disappear silently.
pub fn builtin_parse(filename: &str, bytes: &[u8]) -> Result<ParseOutcome, ParseFailure> {
    if bytes.len() > MAX_BLOB_PARSE_BYTES {
        return Err(ParseFailure::new(
            ParseFailureReason::TooLarge,
            format!(
                "{filename} is {} bytes, over the {}-byte limit",
                bytes.len(),
                MAX_BLOB_PARSE_BYTES
            ),
        ));
    }
    if !is_builtin_readable(filename) {
        return Err(ParseFailure::new(
            ParseFailureReason::Unsupported,
            format!(
                "Core reads no text out of {} on its own",
                display_extension(filename)
            ),
        ));
    }

    let (text, mut warnings) = decode_text(bytes);
    let (markdown, truncated) = truncate_markdown(&apply_html_strip(filename, &text));
    if truncated {
        warnings.push(format!(
            "output was truncated at {MAX_MARKDOWN_BYTES} bytes"
        ));
    }
    Ok(ParseOutcome {
        markdown,
        backend_id: BUILTIN_BACKEND_ID.to_owned(),
        backend_version: env!("CARGO_PKG_VERSION").to_owned(),
        source_sha256: sha256_hex(bytes),
        parsed_at: chrono::Utc::now(),
        warnings,
        truncated,
    })
}

/// `".pdf"`, or `"this file"` when there is no extension — for a message a human reads.
fn display_extension(filename: &str) -> String {
    let ext = extension_of(filename);
    if ext.is_empty() {
        "this file".to_owned()
    } else {
        ext
    }
}

/// UTF-8 first, BOM'd UTF-16 second, lossy last — with a warning for anything but the
/// first. Returns the text and whatever had to be compromised to get it.
fn decode_text(bytes: &[u8]) -> (String, Vec<String>) {
    if let Ok(text) = std::str::from_utf8(bytes) {
        return (text.to_owned(), Vec::new());
    }
    if let Some(text) = decode_utf16_bom(bytes) {
        return (
            text,
            vec!["input was UTF-16; decoded to UTF-8".to_owned()],
        );
    }
    (
        String::from_utf8_lossy(bytes).into_owned(),
        vec![
            "input was not valid UTF-8; undecodable bytes were replaced".to_owned(),
        ],
    )
}

/// Decode a BOM-prefixed UTF-16 stream, or `None` when there is no BOM.
///
/// BOM-only: sniffing UTF-16 without one means guessing from byte statistics, and a
/// wrong guess produces confident nonsense. No BOM ⇒ fall through to lossy, which at
/// least says so.
fn decode_utf16_bom(bytes: &[u8]) -> Option<String> {
    let (rest, big_endian) = match bytes {
        [0xFF, 0xFE, rest @ ..] => (rest, false),
        [0xFE, 0xFF, rest @ ..] => (rest, true),
        _ => return None,
    };
    if rest.len() % 2 != 0 {
        return None;
    }
    let units: Vec<u16> = rest
        .chunks_exact(2)
        .map(|p| {
            if big_endian {
                u16::from_be_bytes([p[0], p[1]])
            } else {
                u16::from_le_bytes([p[0], p[1]])
            }
        })
        .collect();
    Some(String::from_utf16_lossy(&units))
}

/// Lowercase hex sha256. Mirrors the Spaces store's blob addressing so a caller can
/// hand us a sha and get the same one back on the outcome.
fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

/// The on-disk path of a content-addressed blob, after validating the address.
///
/// **The validation is the point.** `sha256` reaches us from a store row that
/// ultimately came from a client, and the result is joined onto a filesystem root
/// and handed to another process to open. A 64-lowercase-hex check makes traversal
/// unrepresentable — there is no `..`, no separator, and no absolute path in the
/// accepted alphabet — which is a stronger guarantee than sanitising after the fact.
/// (The sidecar re-checks containment on its side; this is the near half of the same
/// fence.)
pub fn blob_input_path(sha256: &str) -> Result<std::path::PathBuf, ParseFailure> {
    let valid = sha256.len() == 64
        && sha256
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
    if !valid {
        return Err(ParseFailure::new(
            ParseFailureReason::Unsupported,
            "blob address is not a 64-character lowercase hex sha256",
        ));
    }
    let shard = &sha256[..2];
    Ok(crate::paths::ryu_dir().join("blobs").join(shard).join(sha256))
}

/// Whether the host has a Python interpreter to bootstrap a sidecar venv from.
///
/// Probed only on the failure path — a bound provider that will not start is either
/// a broken install or a host with no Python, and only the second one has an
/// instruction the user can act on.
async fn host_python_missing() -> bool {
    let exe = crate::sidecar::external_runtime::bootstrap_python();
    tokio::process::Command::new(exe)
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await
        .is_err()
}

/// Wake the provider sidecar if it is lazy, and hold it for this hop — the typed twin
/// of [`wake_provider`].
///
/// Used by BOTH submit and poll, deliberately. Polling is the documented mechanism
/// that re-arms the activity guard across a multi-minute parse, so a poll that only
/// took `enter_request` would fail against exactly the provider the job protocol
/// exists for: one that idle-stopped while its own parse was queued.
async fn hold_provider(
    state: &ServerState,
    route: &ProviderRoute,
) -> Result<Option<crate::sidecar::manager::ActivityGuard>, ParseFailure> {
    let Some(wake) = route.wake_name.as_ref() else {
        return Ok(None);
    };
    if state
        .manager
        .wake_and_await_healthy(wake, WAKE_TIMEOUT)
        .await
        .is_err()
    {
        // A bound provider that will not start is either a broken install or a host
        // with no Python, and only the second has an instruction the user can act on.
        let reason = if host_python_missing().await {
            ParseFailureReason::PythonMissing
        } else {
            ParseFailureReason::ProviderTimeout
        };
        return Err(ParseFailure::new(
            reason,
            format!("document parser '{wake}' did not become healthy"),
        ));
    }
    Ok(Some(state.manager.enter_request(wake)))
}

/// Submit a Spaces blob for extraction: floor if Core can read it, otherwise a job on
/// the bound provider.
///
/// **The blob travels as a PATH, not as bytes.** Space files reach 200 MiB while the
/// ext-proxy caps a forwarded body at 10 MiB and base64 costs another third on top,
/// so inlining a large document is not merely wasteful, it is unrepresentable. The
/// provider runs on this machine and already has `${RYU_DIR}` in its allow-list, so it
/// opens the file itself. Core resolves the sha to a path (never the provider), which
/// keeps the shard layout — and therefore a future object-store backend — Core's
/// business alone.
pub async fn submit_blob(
    state: &ServerState,
    blob_sha256: &str,
    filename: &str,
    mime: &str,
    size_bytes: u64,
) -> Result<ParseSubmission, ParseFailure> {
    let path = blob_input_path(blob_sha256)?;

    if is_builtin_readable(filename) {
        let bytes = tokio::fs::read(&path).await.map_err(|e| {
            ParseFailure::new(
                ParseFailureReason::ProviderError,
                format!("cannot read blob {blob_sha256}: {e}"),
            )
        })?;
        let mut outcome = builtin_parse(filename, &bytes)?;
        // Trust the caller's address over a recomputed one only when they agree;
        // a mismatch means the blob store handed us the wrong file, which the
        // caller must see rather than inherit silently.
        if outcome.source_sha256 != blob_sha256 {
            outcome.warnings.push(format!(
                "blob content hashes to {} but was addressed as {blob_sha256}",
                outcome.source_sha256
            ));
        }
        return Ok(ParseSubmission::Done(Box::new(outcome)));
    }

    let Some((route, _)) = bound_provider(state).await else {
        return Err(ParseFailure::new(
            ParseFailureReason::NoProvider,
            format!(
                "no document parser is installed that can read {}",
                display_extension(filename)
            ),
        ));
    };

    let _activity = hold_provider(state, &route).await?;

    let (status, value) = provider_call_typed(
        &route,
        reqwest::Method::POST,
        &route.upstream_path,
        Some(json!({
            "path": path.to_string_lossy(),
            "blob_sha256": blob_sha256,
            "filename": filename,
            "mime": mime,
            "size_bytes": size_bytes,
        })),
        PROVIDER_TIMEOUT,
    )
    .await?;

    if !status.is_success() {
        return Err(ParseFailure::new(
            ParseFailureReason::ProviderError,
            value
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("document parser rejected this file")
                .to_owned(),
        ));
    }
    let Some(job_id) = value.get("job_id").and_then(Value::as_str) else {
        return Err(ParseFailure::new(
            ParseFailureReason::ProviderError,
            "document parser accepted the file but returned no job id",
        ));
    };
    Ok(ParseSubmission::Job {
        job_id: job_id.to_owned(),
        backend_id: route.provider_id.clone(),
    })
}

/// Poll a job from [`submit_blob`]. `Ok(None)` means still running — not an error and
/// not an empty document.
pub async fn job_outcome(
    state: &ServerState,
    job_id: &str,
    source_sha256: &str,
) -> Result<Option<ParseOutcome>, ParseFailure> {
    let Some((route, _)) = bound_provider(state).await else {
        return Err(ParseFailure::new(
            ParseFailureReason::NoProvider,
            "the document parser was disabled while this file was parsing",
        ));
    };
    let _activity = hold_provider(state, &route).await?;

    let (status, value) = provider_call_typed(
        &route,
        reqwest::Method::GET,
        &sibling_path(&route, &format!("jobs/{job_id}")),
        None,
        PROVIDER_TIMEOUT,
    )
    .await?;
    if !status.is_success() {
        return Err(ParseFailure::new(
            ParseFailureReason::ProviderError,
            value
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("unknown parse job")
                .to_owned(),
        ));
    }

    let normalized = normalize_job(&value);
    match normalized["status"].as_str().unwrap_or("running") {
        "queued" | "running" => Ok(None),
        "succeeded" => {
            let markdown = normalized["markdown"].as_str().unwrap_or_default();
            let mut warnings: Vec<String> = value
                .get("result")
                .and_then(|r| r.get("warnings"))
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_default();
            for dep in normalized["missing_dependencies"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
            {
                warnings.push(format!("missing system dependency: {dep}"));
            }
            let truncated = normalized["truncated"].as_bool().unwrap_or(false);
            if truncated {
                warnings.push("output was truncated".to_owned());
            }
            Ok(Some(ParseOutcome {
                markdown: markdown.to_owned(),
                backend_id: route.provider_id.clone(),
                backend_version: value
                    .get("result")
                    .and_then(|r| r.get("backend_version"))
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                source_sha256: source_sha256.to_owned(),
                parsed_at: chrono::Utc::now(),
                warnings,
                truncated,
            }))
        }
        // `cancelled` and `failed` are both "no text, and here is why".
        _ => {
            let message = normalized["error"]
                .as_str()
                .unwrap_or("the parser returned no text for this file")
                .to_owned();
            let reason = if value.get("error_code").and_then(Value::as_str) == Some("timeout") {
                ParseFailureReason::ProviderTimeout
            } else {
                ParseFailureReason::ProviderError
            };
            Err(ParseFailure::new(reason, message))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extension_of_takes_the_last_dot_lowercased() {
        assert_eq!(extension_of("Report.PDF"), ".pdf");
        assert_eq!(extension_of("/tmp/a.b/notes.md"), ".md");
        assert_eq!(extension_of("archive.tar.gz"), ".gz");
        assert_eq!(extension_of("noext"), "");
        assert_eq!(extension_of("trailing."), "");
    }

    #[test]
    fn floor_claims_text_families_and_refuses_real_documents() {
        assert!(is_builtin_readable("notes.md"));
        assert!(is_builtin_readable("data.CSV"));
        // The floor must never claim a format it would mangle.
        assert!(!is_builtin_readable("report.pdf"));
        assert!(!is_builtin_readable("deck.pptx"));
        assert!(!is_builtin_readable("scan.png"));
    }

    #[test]
    fn builtin_markdown_refuses_non_utf8_rather_than_producing_mojibake() {
        assert!(builtin_markdown("a.txt", b"hello").is_some());
        assert!(builtin_markdown("a.txt", &[0xff, 0xfe, 0x00, 0x41]).is_none());
    }

    #[test]
    fn html_is_tag_stripped_and_script_bodies_are_dropped() {
        let html = "<html><head><style>p{color:red}</style></head><body>\
             <h1>Title</h1><p>Body &amp; more</p><script>alert('x')</script></body></html>";
        let (md, _) = builtin_markdown("page.html", html.as_bytes()).expect("utf-8");
        assert!(md.contains("Title"), "{md}");
        assert!(md.contains("Body & more"), "{md}");
        assert!(!md.contains("color:red"), "style body survived: {md}");
        assert!(!md.contains("alert"), "script body survived: {md}");
        assert!(!md.contains('<'), "markup survived: {md}");
    }

    #[test]
    fn amp_entity_is_decoded_last_so_double_encoding_survives() {
        assert_eq!(strip_html("<p>&amp;lt;</p>"), "&lt;");
    }

    #[test]
    fn typed_floor_reports_a_lossy_decode_instead_of_hiding_it() {
        let outcome = builtin_parse("a.txt", &[b'h', b'i', 0xff]).expect("lossy floor answers");
        assert!(outcome.markdown.starts_with("hi"));
        assert_eq!(outcome.warnings.len(), 1, "{:?}", outcome.warnings);
        assert_eq!(outcome.backend_id, BUILTIN_BACKEND_ID);
    }

    #[test]
    fn typed_floor_decodes_bom_utf16_without_replacement_characters() {
        let mut bytes = vec![0xFF, 0xFE];
        for unit in "héllo".encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        let outcome = builtin_parse("a.txt", &bytes).expect("utf-16 floor answers");
        assert_eq!(outcome.markdown, "héllo");
        assert!(!outcome.markdown.contains('\u{FFFD}'));
    }

    #[test]
    fn typed_floor_refuses_a_binary_format_instead_of_returning_empty() {
        let err = builtin_parse("report.pdf", b"%PDF-1.7").expect_err("no floor for pdf");
        assert_eq!(err.reason, ParseFailureReason::Unsupported);
    }

    #[test]
    fn typed_floor_reports_source_sha_of_the_input_bytes() {
        let outcome = builtin_parse("a.md", b"hello").expect("floor");
        // sha256("hello")
        assert_eq!(
            outcome.source_sha256,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }

    #[test]
    fn blob_addresses_that_are_not_plain_hex_are_refused_before_any_join() {
        for bad in [
            "../../etc/passwd",
            "/etc/passwd",
            "ABCD",
            "",
            &"g".repeat(64),
            &"a".repeat(63),
        ] {
            assert!(
                blob_input_path(bad).is_err(),
                "accepted a bad blob address: {bad}"
            );
        }
        let good = "a".repeat(64);
        let path = blob_input_path(&good).expect("64 lowercase hex is the whole alphabet");
        // Component-wise, not a literal separator — this crate builds on Windows too.
        assert!(path.ends_with(std::path::Path::new("blobs").join("aa").join(&good)));
    }

    #[test]
    fn truncation_is_reported_and_lands_on_a_char_boundary() {
        let text = "é".repeat(MAX_MARKDOWN_BYTES);
        let (out, truncated) = truncate_markdown(&text);
        assert!(truncated);
        assert!(out.len() <= MAX_MARKDOWN_BYTES);
        // Round-trips as valid UTF-8 — the cut did not split a code point.
        assert!(out.chars().all(|c| c == 'é'));
    }

    #[test]
    fn succeeded_with_no_markdown_normalizes_to_failed() {
        let snap = json!({ "status": "succeeded", "job_id": "j1", "result": {} });
        let out = normalize_job(&snap);
        assert_eq!(out["status"], "failed");
        assert!(out["error"].is_string(), "a caller must get a reason");
    }

    #[test]
    fn succeeded_with_markdown_passes_through_with_missing_deps() {
        let snap = json!({
            "status": "succeeded",
            "job_id": "j1",
            "filename": "a.pdf",
            "missing_dependencies": ["tesseract"],
            "result": { "markdown": "# Hi", "truncated": false },
        });
        let out = normalize_job(&snap);
        assert_eq!(out["status"], "succeeded");
        assert_eq!(out["markdown"], "# Hi");
        assert_eq!(out["missing_dependencies"][0], "tesseract");
    }

    #[test]
    fn provider_truncation_flag_survives_normalization() {
        let snap = json!({
            "status": "succeeded",
            "result": { "markdown": "short", "truncated": true },
        });
        assert_eq!(normalize_job(&snap)["truncated"], true);
    }
}
