//! HTTP surface the desktop drives to create a Telegram bot without @BotFather.
//!
//! Four verbs over three paths, and the split between them is the whole security
//! design:
//!
//! - `POST /api/channels/managed-bot/pair` mints a pairing on the manager service
//!   and answers with the **public** half only — nonce, deep link, expiry. The
//!   `claim_secret` stays in [`crate::managed_bot`]'s process-local map and is the
//!   reason a nonce shown on screen (or in a QR) is not a credential.
//! - `GET /api/channels/managed-bot/:nonce` polls. While the user is still in
//!   Telegram it answers `waiting`; once the manager hands the token over it answers
//!   `confirm` with the bot's public identity — never the token.
//! - `POST /api/channels/managed-bot/:nonce/confirm` is the human's yes, and the
//!   only thing that writes the token into a channel config.
//! - `DELETE /api/channels/managed-bot/:nonce` is the no (or a cancel): it drops the
//!   pairing here and asks the manager to forget — and revoke — the bot.
//!
//! **Why a confirmation step exists.** The nonce is public by design; it rides a QR
//! the user may hold up to a camera. The manager therefore binds the pairing to
//! whoever opens the deep link FIRST, which need not be the person at this desktop.
//! Landing a token the moment it arrives would let a stranger who read the nonce off
//! a screen share have this node adopt a bot THEY own — a live credential inside the
//! user's chats. Only the human can tell their new bot from a stranger's, so the
//! token waits for them to say which it is.
//!
//! All of them live on the protected router, so `require_auth` (the node bearer)
//! already gates them; and all are deliberately free of any success-path logging
//! beyond public ids, because everything else in this flow is a live credential.
//!
//! Core owns no channel storage: landing the token is an authenticated call to the
//! control plane's existing `POST /api/channels` / `PATCH /api/channels/:id` — the
//! same write a hand-pasted token goes through. See [`crate::managed_bot`].

use axum::{
    extract::Path,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::managed_bot::{
    self, ChannelIntent, ClaimStatus, ConfirmationView, ManagedBot, ManagerClient, PairSession,
    PollDecision, Secret,
};

use super::ServerState;

/// `POST` path that mints a pairing.
///
/// The route paths are constants because the desktop client hard-codes the same
/// strings in another language (`apps/desktop/src/lib/api/managed-bots.ts`), and
/// nothing else couples the two: a mismatch is not a type error, it is a 404 the
/// desktop reports to the user as an expired link. Naming them here makes Core the
/// definition and lets a test pin the spelling.
pub const PAIR_ROUTE: &str = "/api/channels/managed-bot/pair";
/// `GET` path that polls a pairing, and the `DELETE` path that abandons one.
/// `:nonce` is ONE path segment — an extra segment (`…/status/:nonce`) matches no
/// route at all.
pub const POLL_ROUTE: &str = "/api/channels/managed-bot/:nonce";
/// `POST` path carrying the human's "yes, that is my bot".
pub const CONFIRM_ROUTE: &str = "/api/channels/managed-bot/:nonce/confirm";

/// Body for [`begin_pairing`]. Every field is optional: the bot does not exist yet,
/// so nothing about it can be required here.
///
/// Most of it is the add-channel FORM, forwarded now because the config is written
/// minutes later by a poll — see [`ChannelIntent`]. Anything missing from here is a
/// user choice that quietly reverts to a control-plane default.
#[derive(Debug, Default, Deserialize)]
pub struct BeginPairingBody {
    /// Name for the channel config. Falls back to the created bot's `@handle`.
    #[serde(default)]
    pub name: Option<String>,
    /// Name Telegram pre-fills in its create-a-bot dialog (a suggestion the user
    /// may edit — Telegram does not document the dialog, so treat it as a hint).
    #[serde(default)]
    pub suggested_name: Option<String>,
    /// Username Telegram suggests for the new bot.
    #[serde(default)]
    pub suggested_username: Option<String>,
    /// Existing Telegram channel config to write the token into. Absent creates a
    /// new one; present makes this a token (re)binding for a bot the user already
    /// has, which is also the seam a later rotate-my-token flow reuses.
    #[serde(default)]
    pub channel_id: Option<String>,
    /// Agent the new bot answers as. Only applied when creating.
    #[serde(default)]
    pub agent_id: Option<String>,
    /// Team the new bot routes to instead of a single agent (mutually exclusive with
    /// `agent_id`; the desktop's one picker has already resolved which it is).
    #[serde(default)]
    pub team_id: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub system_prompt: Option<String>,
    /// `mentions` | `all` — when the bot answers inside a group chat.
    #[serde(default)]
    pub group_reply_mode: Option<String>,
    /// Send Ryu's first plain-language welcome to the explicit approved target
    /// when the channel starts. This is opt-in and never broadcasts.
    #[serde(default)]
    pub proactive_opening: Option<bool>,
    #[serde(default)]
    pub proactive_target: Option<String>,
    /// The form's Enabled switch. Absent means "enabled": a caller that says nothing
    /// asked for a working bot, and a disabled config is one the gateway never spawns.
    #[serde(default)]
    pub enabled: Option<bool>,
    /// Optional provider-emoji to Learning feedback mapping. It is carried with
    /// the pending pairing because the channel row is written after Telegram
    /// creates the bot, not while this form is still open.
    #[serde(default)]
    pub reaction_learning: Option<Value>,
}

impl BeginPairingBody {
    /// The channel form, in the shape the pending pairing carries.
    fn intent(&self) -> ChannelIntent {
        ChannelIntent {
            name: trimmed(self.name.clone()),
            channel_id: trimmed(self.channel_id.clone()),
            agent_id: trimmed(self.agent_id.clone()),
            team_id: trimmed(self.team_id.clone()),
            model: trimmed(self.model.clone()),
            system_prompt: trimmed(self.system_prompt.clone()),
            group_reply_mode: trimmed(self.group_reply_mode.clone()),
            proactive_opening: self.proactive_opening.unwrap_or(false),
            proactive_target: trimmed(self.proactive_target.clone()),
            enabled: self.enabled.unwrap_or(true),
            reaction_learning: self.reaction_learning.clone(),
        }
    }
}

/// `POST /api/channels/managed-bot/pair` — start a managed-bot pairing.
///
/// The response is exactly what a UI needs to show a deep link and a QR. The
/// `claim_secret` minted alongside the nonce is NOT in it, is not logged, and has no
/// schema — see [`crate::managed_bot::Secret`].
#[utoipa::path(
    post,
    path = "/api/channels/managed-bot/pair",
    tag = "Chat",
    summary = "Start a Telegram managed-bot pairing (returns a deep link + QR nonce)",
    request_body = serde_json::Value,
    responses(
        (status = 200, description = "Pairing started", body = serde_json::Value),
        (status = 501, description = "Managed bots are switched off server-side; use the manual token path", body = serde_json::Value),
        (status = 502, description = "The managed-bot manager is unreachable", body = serde_json::Value)
    )
)]
pub async fn begin_pairing(Json(body): Json<BeginPairingBody>) -> Response {
    let client = ManagerClient::from_env();
    let req = managed_bot::PairRequest {
        suggested_name: trimmed(body.suggested_name.clone()),
        suggested_username: trimmed(body.suggested_username.clone()),
    };
    let session = match client.pair(&req).await {
        Ok(session) => session,
        // `{e:#}` is safe here: the client never puts a manager response body into
        // its error, precisely because a pair body carries the claim_secret.
        Err(e) => return manager_error(&e),
    };
    if let Err(e) = managed_bot::remember(&session, body.intent(), managed_bot::now_ms()) {
        return bad_gateway(&format!("{e:#}"));
    }
    // Public ids only. The nonce is public by design (it rides the deep link), the
    // claim_secret is never logged.
    tracing::info!(nonce = %session.nonce, "managed-bot pairing started");
    Json(pairing_body(&session)).into_response()
}

/// The pair response body, split out so the test that pins its key set exercises
/// the real thing rather than a copy of it — the copy would keep passing after a
/// `claim_secret` was added here, which is the one regression it exists to catch.
fn pairing_body(session: &PairSession) -> Value {
    json!({
        "status": "waiting",
        "nonce": session.nonce,
        "deep_link": session.deep_link,
        "expires_at": session.expires_at,
    })
}

/// `GET /api/channels/managed-bot/:nonce` — poll a pairing.
///
/// Answers `waiting` until the user finishes in Telegram, then `confirm` with the
/// new bot's public identity, and `ready` once [`confirm_pairing`] has written the
/// config. Nothing here writes: the token is held on the node until a human
/// confirms the bot is theirs (see the module docs).
///
/// Re-polling a finished pairing keeps answering from local state: the manager hands
/// the token over exactly once, so a second claim would fail and must not be
/// reported as an expiry.
#[utoipa::path(
    get,
    path = "/api/channels/managed-bot/{nonce}",
    tag = "Chat",
    summary = "Poll a managed-bot pairing (waiting | confirm | ready)",
    params(("nonce" = String, Path, description = "Pairing nonce returned by the pair call")),
    responses(
        (status = 200, description = "waiting | confirm | ready", body = serde_json::Value),
        (status = 400, description = "Malformed nonce", body = serde_json::Value),
        (status = 404, description = "Unknown or expired pairing", body = serde_json::Value),
        (status = 501, description = "Managed bots are switched off server-side", body = serde_json::Value),
        (status = 502, description = "The manager is unreachable", body = serde_json::Value)
    )
)]
pub async fn poll_pairing(Path(nonce): Path<String>) -> Response {
    if let Err(e) = managed_bot::validate_nonce(&nonce) {
        return bad_request(&format!("{e:#}"));
    }
    let (claim_secret, use_refresh) = match managed_bot::begin_poll(&nonce, managed_bot::now_ms()) {
        PollDecision::Unknown => return expired(),
        PollDecision::Throttled => return waiting(),
        PollDecision::NeedsConfirmation(view) => return confirm(&view),
        PollDecision::Landed {
            channel_id,
            bot_id,
            bot_username,
        } => return ready(&channel_id, bot_id, &bot_username),
        PollDecision::AskManager {
            claim_secret,
            use_refresh,
        } => (claim_secret, use_refresh),
    };

    let client = ManagerClient::from_env();
    let bot = match fetch_managed_bot(&client, &nonce, &claim_secret, use_refresh).await {
        Ok(Some(bot)) => bot,
        Ok(None) => return waiting(),
        Err(e) => return e,
    };

    // Hold it, do not write it. The bot exists on Telegram now, but nothing says the
    // person who created it is the person at this desktop.
    match managed_bot::hold_for_confirmation(&nonce, bot) {
        Some(view) => {
            tracing::info!(
                nonce = %nonce,
                bot_id = view.bot_id,
                "managed bot created; waiting for the user to confirm it is theirs"
            );
            confirm(&view)
        }
        // The pairing was cancelled while the claim was in flight. The token is in
        // nobody's hands now, so say the pairing is gone rather than inventing one.
        None => expired(),
    }
}

/// One round trip to the manager. `Ok(None)` means "still waiting"; the `Err` arm
/// carries a finished response so the caller stays a straight line.
async fn fetch_managed_bot(
    client: &ManagerClient,
    nonce: &str,
    claim_secret: &Secret,
    use_refresh: bool,
) -> std::result::Result<Option<ManagedBot>, Response> {
    if use_refresh {
        // A previous poll already spent the one-shot claim and only the local write
        // failed, so re-read the CURRENT token instead of claiming again.
        return match client.refresh(nonce, claim_secret).await {
            Ok(bot) => Ok(Some(bot)),
            Err(e) => Err(manager_error(&e)),
        };
    }
    match client.claim(nonce, claim_secret).await {
        Ok(ClaimStatus::Pending) => Ok(None),
        Ok(ClaimStatus::Ready(bot)) => Ok(Some(*bot)),
        Ok(ClaimStatus::AlreadyClaimed) => {
            // The claim landed on the manager but its response never reached us (a
            // reset, or our own timeout). The one-shot token will not come again, but
            // the managed-bot record survives a claim — so switch this pairing to the
            // refresh lane and take the token that way, right now.
            managed_bot::mark_unlanded(nonce);
            match client.refresh(nonce, claim_secret).await {
                Ok(bot) => Ok(Some(bot)),
                Err(e) => Err(manager_error(&e)),
            }
        }
        Ok(ClaimStatus::Gone) => {
            managed_bot::forget(nonce);
            Err(expired())
        }
        Err(e) => Err(manager_error(&e)),
    }
}

/// `POST /api/channels/managed-bot/:nonce/confirm` — the human's yes.
///
/// The ONLY thing that writes a managed token into a channel config. Idempotent: a
/// second confirm answers `ready` from the landed state without a second write.
#[utoipa::path(
    post,
    path = "/api/channels/managed-bot/{nonce}/confirm",
    tag = "Chat",
    summary = "Confirm the created bot is yours; writes its token into a channel config",
    params(("nonce" = String, Path, description = "Pairing nonce returned by the pair call")),
    responses(
        (status = 200, description = "ready — the channel config now carries the token", body = serde_json::Value),
        (status = 400, description = "Malformed nonce", body = serde_json::Value),
        (status = 404, description = "Unknown pairing, or no bot is waiting on it", body = serde_json::Value),
        (status = 502, description = "The control-plane write failed", body = serde_json::Value)
    )
)]
pub async fn confirm_pairing(Path(nonce): Path<String>) -> Response {
    if let Err(e) = managed_bot::validate_nonce(&nonce) {
        return bad_request(&format!("{e:#}"));
    }
    // Already landed: answer from local state rather than writing twice.
    if let PollDecision::Landed {
        channel_id,
        bot_id,
        bot_username,
    } = managed_bot::begin_poll(&nonce, managed_bot::now_ms())
    {
        return ready(&channel_id, bot_id, &bot_username);
    }
    let Some((bot, claim_secret, intent)) = managed_bot::take_confirmed(&nonce) else {
        return expired();
    };

    match managed_bot::land_token(&bot, &nonce, &claim_secret, &intent).await {
        Ok(id) => {
            managed_bot::mark_landed(&nonce, &id, bot.bot_id, &bot.bot_username);
            tracing::info!(
                nonce = %nonce,
                bot_id = bot.bot_id,
                channel_id = %id,
                "managed bot token landed in its channel config"
            );
            ready(&id, bot.bot_id, &bot.bot_username)
        }
        // The pairing stays in `AwaitingConfirmation`, so the desktop's retry is
        // another confirm — no Telegram round trip and no lost token.
        Err(e) => bad_gateway(&format!("{e:#}")),
    }
}

/// `DELETE /api/channels/managed-bot/:nonce` — the human's no, or a cancel.
///
/// Drops the pairing here and asks the manager to forget the record, which revokes
/// the token it holds. That revocation is the point: refusing a bot someone else
/// created must leave nobody holding a working credential, and a cancelled pairing
/// must not leave a claimable token on the manager either.
#[utoipa::path(
    delete,
    path = "/api/channels/managed-bot/{nonce}",
    tag = "Chat",
    summary = "Abandon a managed-bot pairing (and revoke any token the manager holds)",
    params(("nonce" = String, Path, description = "Pairing nonce returned by the pair call")),
    responses(
        (status = 200, description = "Forgotten locally (`manager_forgot` says whether the manager agreed), or `ready` if it had already landed", body = serde_json::Value),
        (status = 400, description = "Malformed nonce", body = serde_json::Value),
        (status = 404, description = "Unknown pairing", body = serde_json::Value)
    )
)]
pub async fn cancel_pairing(Path(nonce): Path<String>) -> Response {
    if let Err(e) = managed_bot::validate_nonce(&nonce) {
        return bad_request(&format!("{e:#}"));
    }
    // A landed pairing is not cancellable, and saying so is not pedantry: cancelling
    // asks the manager to forget the record, which REVOKES the token now sealed in the
    // channel config — leaving a channel that 401s forever with no refresh path. A
    // confirm whose response was lost looks like an unfinished pairing to the client
    // that retried it, so this arrives without anyone being confused.
    if let PollDecision::Landed {
        channel_id,
        bot_id,
        bot_username,
    } = managed_bot::begin_poll(&nonce, managed_bot::now_ms())
    {
        return ready(&channel_id, bot_id, &bot_username);
    }
    let Some(claim_secret) = managed_bot::take_for_cancel(&nonce) else {
        return expired();
    };
    // Local state is already gone, so report success either way — but say whether the
    // manager agreed, because a manager that still holds the token is a fact the
    // operator (and the user, who can send /deletebot) may need.
    let manager_forgot = match ManagerClient::from_env()
        .delete(&nonce, &claim_secret)
        .await
    {
        Ok(()) => true,
        Err(e) => {
            tracing::warn!(nonce = %nonce, error = %format!("{e:#}"), "manager did not forget a cancelled managed-bot pairing");
            false
        }
    };
    tracing::info!(nonce = %nonce, manager_forgot, "managed-bot pairing cancelled");
    Json(json!({ "status": "cancelled", "manager_forgot": manager_forgot })).into_response()
}

/// The managed-bot routes, merged into the protected router so they inherit
/// `require_auth`.
pub fn routes() -> Router<ServerState> {
    Router::new()
        .route(PAIR_ROUTE, post(begin_pairing))
        // GET polls, DELETE abandons: same pairing, same path, so the desktop needs
        // one URL builder rather than two constants that can drift apart.
        .route(POLL_ROUTE, get(poll_pairing).delete(cancel_pairing))
        .route(CONFIRM_ROUTE, post(confirm_pairing))
}

fn trimmed(value: Option<String>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn waiting() -> Response {
    Json(json!({ "status": "waiting" })).into_response()
}

fn confirm(view: &ConfirmationView) -> Response {
    Json(confirm_body(view)).into_response()
}

/// What the user decides on. Public identifiers only — a token here would be a
/// credential handed to a webview, and the whole confirmation exists because the
/// node cannot tell whose bot this is on its own.
fn confirm_body(view: &ConfirmationView) -> Value {
    json!({
        "status": "confirm",
        "bot_id": view.bot_id,
        "bot_username": view.bot_username,
        "owner_telegram_user_id": view.owner_telegram_user_id,
    })
}

fn ready(channel_id: &str, bot_id: i64, bot_username: &str) -> Response {
    Json(ready_body(channel_id, bot_id, bot_username)).into_response()
}

/// Same split as [`pairing_body`]: the body is a value so the "never a token here"
/// test can assert on what the handler actually returns.
fn ready_body(channel_id: &str, bot_id: i64, bot_username: &str) -> Value {
    json!({
        "status": "ready",
        "channel_id": channel_id,
        "bot_id": bot_id,
        "bot_username": bot_username,
    })
}

fn expired() -> Response {
    (
        StatusCode::NOT_FOUND,
        Json(json!({ "status": "expired", "error": "unknown or expired pairing" })),
    )
        .into_response()
}

fn bad_request(msg: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": msg }))).into_response()
}

fn bad_gateway(msg: &str) -> Response {
    (StatusCode::BAD_GATEWAY, Json(json!({ "error": msg }))).into_response()
}

/// Error code the desktop matches on to fall back to the paste-a-token form. A
/// literal string rather than a message, because the fallback must not depend on
/// prose — see `classifyPairError` in `apps/desktop/src/lib/api/managed-bots.ts`.
const UNAVAILABLE_CODE: &str = "managed_bots_unavailable";

/// Turn a manager-client error into a response, keeping the one distinction the UI
/// acts on: a manager with Bot Management Mode off can never succeed, so it must not
/// arrive as a 502 with a "try again" button behind it.
fn manager_error(err: &anyhow::Error) -> Response {
    if managed_bot::is_manager_unavailable(err) {
        return (
            StatusCode::NOT_IMPLEMENTED,
            Json(json!({ "error": UNAVAILABLE_CODE, "detail": format!("{err:#}") })),
        )
            .into_response();
    }
    bad_gateway(&format!("{err:#}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The pairing response is the one place a claim_secret could escape, so pin its
    /// exact key set. A future field added here must be a conscious decision.
    #[test]
    fn the_pairing_response_carries_no_secret_material() {
        let session = managed_bot::PairSession {
            nonce: "0123456789abcdef0123456789abcdef".into(),
            claim_secret: managed_bot::Secret::new("never-leaves-the-node"),
            deep_link: "https://t.me/ryu_bot?start=mb_0123456789abcdef".into(),
            expires_at: "2026-08-06T12:00:00Z".into(),
        };
        // The handler's own body builder, not a copy of it — a copy would keep
        // passing after a claim_secret was added to the real response.
        let body = pairing_body(&session);
        let encoded = serde_json::to_string(&body).expect("serialize");
        assert!(
            !encoded.contains("never-leaves-the-node"),
            "pair response leaked the claim_secret: {encoded}"
        );
        // Sorted, not in literal order: `serde_json::Map` is a `BTreeMap` unless the
        // `preserve_order` feature is on, so insertion order is not observable and
        // asserting it would pin a cargo feature instead of the key set.
        let mut keys: Vec<&str> = body
            .as_object()
            .expect("object")
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(keys, ["deep_link", "expires_at", "nonce", "status"]);
    }

    /// The ready answer names the bot and the config the desktop should now show —
    /// and nothing else. A token here would be a credential handed to a webview.
    #[test]
    fn the_ready_response_names_the_bot_but_never_its_token() {
        let body = ready_body("chan-1", 999, "helper_bot");
        assert!(body.get("token").is_none());
        assert!(body.get("claim_secret").is_none());
        assert_eq!(body["channel_id"], "chan-1");
        assert_eq!(body["status"], "ready");
        assert_eq!(body["bot_id"], 999);
        assert_eq!(body["bot_username"], "helper_bot");
    }

    /// axum panics when two routes overlap, and it does so while BUILDING the
    /// router — which on a node means a crash at boot, not a failed request. Cheap
    /// to prove here instead: `pair` is a static sibling of `:nonce`, and `confirm`
    /// hangs off the param segment.
    #[test]
    fn the_routes_build_without_an_overlap_panic() {
        let _ = routes();
    }

    /// The seam nothing else couples: the desktop builds this path from its own
    /// string constant, in another language. A mismatch is not a type error — it is
    /// a 404 the desktop renders as "that pairing link is no longer valid".
    #[test]
    fn the_poll_route_is_exactly_the_path_the_desktop_builds() {
        assert_eq!(PAIR_ROUTE, "/api/channels/managed-bot/pair");
        assert_eq!(POLL_ROUTE, "/api/channels/managed-bot/:nonce");
        // `:nonce` matches ONE segment, so the desktop's prefix must be the route
        // with that segment removed — no `status` (or any other) leaf in between.
        assert_eq!(
            POLL_ROUTE.trim_end_matches("/:nonce"),
            "/api/channels/managed-bot",
            "STATUS_PATH in apps/desktop/src/lib/api/managed-bots.ts must equal this"
        );
    }

    /// The 501 seam. `managed_bots_unavailable` is what makes the desktop drop to
    /// the paste-a-token form; a 502 there leaves the user on a Try-again button for
    /// something only a human with @BotFather access can fix.
    #[test]
    fn a_manager_with_bot_management_off_maps_to_501_with_the_fallback_code() {
        let err = anyhow::Error::new(managed_bot::ManagerUnavailable { status: 501 })
            .context("POST /managed-bot/pair on the managed-bot manager");
        let response = manager_error(&err);
        assert_eq!(response.status(), StatusCode::NOT_IMPLEMENTED);

        // Anything else stays a 502: retrying a flaky manager is the right advice.
        let response = manager_error(&anyhow::anyhow!("connection reset"));
        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    }

    /// The confirmation answer is shown to a human who has to decide whether this bot
    /// is theirs, so it must name the bot AND its owner — and still carry no token.
    #[test]
    fn the_confirm_response_names_the_bot_and_its_owner_but_never_its_token() {
        let body = confirm_body(&ConfirmationView {
            bot_id: 555,
            bot_username: "made_bot".into(),
            owner_telegram_user_id: Some(4242),
        });
        assert_eq!(body["status"], "confirm");
        assert_eq!(body["bot_id"], 555);
        assert_eq!(body["bot_username"], "made_bot");
        // The field the decision rests on: an owner who is not the person at this
        // desktop means the public nonce was taken by someone else.
        assert_eq!(body["owner_telegram_user_id"], 4242);
        assert!(body.get("token").is_none());
        assert!(body.get("claim_secret").is_none());
    }

    /// Every form field the dialog collects has to reach the pending pairing, because
    /// the config is written by a poll long after the form is gone.
    #[test]
    fn the_begin_body_carries_the_whole_form_into_the_pairing_intent() {
        let body = BeginPairingBody {
            name: Some("  Support bot  ".into()),
            suggested_name: Some("Support".into()),
            suggested_username: None,
            channel_id: None,
            agent_id: Some("triage".into()),
            team_id: None,
            model: Some("sonnet".into()),
            system_prompt: Some("Be brief.".into()),
            group_reply_mode: Some("mentions".into()),
            proactive_opening: Some(true),
            proactive_target: Some("chat-123".into()),
            enabled: Some(false),
            reaction_learning: Some(json!({
                "enabled": true,
                "positiveEmoji": ["👍", "❤️"],
                "negativeEmoji": ["👎", "💀"],
                "allowGroup": false,
            })),
        };
        let intent = body.intent();
        assert_eq!(intent.name.as_deref(), Some("Support bot"));
        assert_eq!(intent.agent_id.as_deref(), Some("triage"));
        assert_eq!(intent.model.as_deref(), Some("sonnet"));
        assert_eq!(intent.system_prompt.as_deref(), Some("Be brief."));
        assert_eq!(intent.group_reply_mode.as_deref(), Some("mentions"));
        assert!(intent.proactive_opening);
        assert_eq!(intent.proactive_target.as_deref(), Some("chat-123"));
        assert!(!intent.enabled, "the form's Enabled switch is honoured");
        assert_eq!(
            intent
                .reaction_learning
                .as_ref()
                .and_then(|value| value["enabled"].as_bool()),
            Some(true)
        );

        // A caller that says nothing gets a running bot: `create a bot for me` asks
        // for one, and the gateway only spawns enabled configs.
        assert!(BeginPairingBody::default().intent().enabled);
    }

    #[test]
    fn blank_optional_fields_are_dropped_rather_than_sent_as_empty_strings() {
        assert_eq!(trimmed(Some("  x  ".into())).as_deref(), Some("x"));
        assert!(trimmed(Some("   ".into())).is_none());
        assert!(trimmed(None).is_none());
    }
}
