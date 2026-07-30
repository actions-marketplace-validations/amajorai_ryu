//! At-rest encryption posture (`GET /api/encryption/status`).
//!
//! The read-only status surface behind the desktop's Gateway settings →
//! **Encryption** tab. Two things, both honest:
//!
//! 1. **Key custody** — which of the three paths (`RYU_MASTER_KEY` env → OS
//!    keychain → `~/.ryu/master.key` file fallback) the *running* process
//!    actually resolved, from [`ryu_crypto::key_custody`]. The file fallback puts
//!    the key next to the data it protects, so it is reported as a degraded
//!    posture rather than a silent equivalent.
//! 2. **Per-store coverage** — what is sealed today, store by store, with live
//!    row counts where they can be measured cheaply. Encryption-at-rest landed as
//!    slices (`docs/encryption-at-rest.md` §8): chat content, long-term memory,
//!    identity-vault state and plugin secrets are sealed; preferences, the device
//!    token, and Spaces/RAG chunks are **not** yet. A single "Encrypted ✓" badge
//!    would misreport the node, so this endpoint names every store's real state.
//!
//! Deliberately read-only and secret-free: no key material in any form (not the
//! key, not a prefix, not a hash), and no rotation/re-encrypt actions — those are
//! later slices of the same doc, not part of showing the posture.

use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use serde_json::json;

use super::ServerState;

/// Coverage verdict for one store. Ordered worst-to-best is not meaningful here;
/// the desktop colours on the string.
const SEALED: &str = "sealed";
const PARTIAL: &str = "partial";
const PLAINTEXT: &str = "plaintext";

/// `GET /api/encryption/status`
///
/// The node's at-rest encryption posture: master-key custody plus a per-store
/// coverage table. Fails closed like the stores do — when the master key cannot
/// be loaded at all, `key.available` is `false` and carries the error, because in
/// that state the sealed stores refuse to open rather than writing plaintext.
#[utoipa::path(
    get,
    path = "/api/encryption/status",
    tag = "Data",
    summary = "At-rest encryption posture: key custody + per-store coverage",
    responses((status = 200, description = "OK", body = serde_json::Value))
)]
pub async fn encryption_status(State(state): State<ServerState>) -> impl IntoResponse {
    // Key custody. `key_custody` resolves the key (cheap after boot) so the
    // answer describes the key in use, not a configured preference.
    let key = match ryu_crypto::key_custody() {
        Ok(c) => json!({
            "available": true,
            "source": c.source.as_str(),
            "envVar": c.env_var,
            "keychainService": c.keychain_service,
            "keychainAccount": c.keychain_account,
            "keyFile": c.key_file.as_ref().map(|p| p.display().to_string()),
            "legacyMemoryKeyPresent": c.legacy_memory_key_present,
            "error": serde_json::Value::Null,
        }),
        Err(e) => json!({
            "available": false,
            "source": serde_json::Value::Null,
            "envVar": "RYU_MASTER_KEY",
            "keychainService": serde_json::Value::Null,
            "keychainAccount": serde_json::Value::Null,
            "keyFile": serde_json::Value::Null,
            "legacyMemoryKeyPresent": false,
            "error": e.to_string(),
        }),
    };

    // Measured chat coverage: rows carrying the `enc:v1:` envelope vs rows that
    // exist. Legacy plaintext rows written before slice 1 upgrade lazily on the
    // next write, so this can legitimately read "partial" on an old node.
    let (chat_sealed, chat_total) = state
        .conversations
        .count_sealed_content()
        .await
        .unwrap_or((0, 0));
    let chat_status = if chat_total == 0 || chat_sealed == chat_total {
        SEALED
    } else {
        PARTIAL
    };

    // Memory rows are encrypted by construction (ciphertext + nonce blob columns,
    // no plaintext column to fall back to), so the count is exposure context, not
    // a coverage ratio.
    let memory_total = state.memory.count().await.unwrap_or(0);
    let spaces_total = state.spaces.count_spaces().await.unwrap_or(0);

    let stores = json!([
        {
            "id": "chats",
            "label": "Chats",
            "status": chat_status,
            "sealed": chat_sealed,
            "total": chat_total,
            "detail": "Message bodies, streamed parts and conversation titles are sealed with the master key. Roles, ids and timestamps stay readable so lists and ordering keep working.",
        },
        {
            "id": "memory",
            "label": "Long-term memory",
            "status": SEALED,
            "sealed": memory_total,
            "total": memory_total,
            "detail": "Every entry's content is stored as ciphertext; only its category, tags and scope stay readable so recall can filter.",
        },
        {
            "id": "identities",
            "label": "Identity vault",
            "status": SEALED,
            "sealed": serde_json::Value::Null,
            "total": serde_json::Value::Null,
            "detail": "Saved website credentials are sealed before they touch the row and are never logged.",
        },
        {
            "id": "plugin-secrets",
            "label": "Plugin secrets",
            "status": SEALED,
            "sealed": serde_json::Value::Null,
            "total": serde_json::Value::Null,
            "detail": "Per-plugin API keys are write-only and sealed at rest. Without a loadable master key the store refuses writes rather than storing plaintext.",
        },
        {
            "id": "preferences",
            "label": "Preferences & provider keys",
            "status": PLAINTEXT,
            "sealed": serde_json::Value::Null,
            "total": serde_json::Value::Null,
            "detail": "Settings — including provider API keys stored here — are still written in the clear. Anyone who can read the data folder can read them.",
        },
        {
            "id": "device-token",
            "label": "Device token",
            "status": PLAINTEXT,
            "sealed": serde_json::Value::Null,
            "total": serde_json::Value::Null,
            "detail": "This node's sign-in token is stored unencrypted in the data folder.",
        },
        {
            "id": "spaces",
            "label": "Spaces & documents",
            "status": PLAINTEXT,
            "sealed": 0,
            "total": spaces_total,
            "detail": "Indexed document text and its embeddings are stored in the clear. Embeddings can be inverted back into approximate source text, so this exposes document content, not just metadata.",
        },
        {
            "id": "gateway-audit",
            "label": "Gateway audit log",
            "status": PLAINTEXT,
            "sealed": serde_json::Value::Null,
            "total": serde_json::Value::Null,
            "detail": "Request metadata only — no prompts or replies — but the API key of each request is written to disk unredacted (it is masked on read, not on write).",
        },
    ]);

    (
        StatusCode::OK,
        Json(json!({
            "key": key,
            "stores": stores,
            "dataDir": crate::paths::ryu_dir().display().to_string(),
        })),
    )
        .into_response()
}
