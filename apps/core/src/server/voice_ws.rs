//! Realtime voice-mode WebSocket handler (`GET /api/voice/ws`).
//!
//! The node side of the ChatGPT-style desktop/island voice mode (see
//! `crate::voice`). A first-party renderer upgrades, sends a `start` frame, then
//! streams mic PCM16 as BINARY frames while the server runs the realtime loop
//! (VAD → STT → streaming LLM → per-sentence TTS) and streams control frames +
//! WAV audio back.
//!
//! ## Auth placement (auth-in-handler, mirroring `realtime_ws` / `hardware_ws`)
//!
//! On the **public** router because a browser WebSocket constructor cannot set an
//! authorization header. Clients first exchange normal HTTP credentials for a
//! short-lived, one-use ticket at `/api/ws/ticket`; the ticket carries the
//! verified caller and node-token generation without putting credentials in the
//! upgrade URL.
//!
//! ## Per-conversation ACL
//!
//! The `start` frame carries a CLIENT-SUPPLIED `conversation_id` that flows
//! straight into the chat path (history as context, turns appended). That made this
//! route an exact re-open of the `POST /api/chat/stream` bypass the conversation
//! ACL closed: a user could name someone else's conversation id and have that
//! thread read back and written to. It is now gated by
//! [`crate::server::gate_and_claim_conversation`] — the SAME create-or-use gate
//! `chat_stream` uses — before the session is built. An unbound personal node is
//! unaffected (the gate is a no-op there).
//!
//! ## Concurrency / barge-in
//!
//! The socket is split: a send task drains an `mpsc` of [`VoiceOutput`] to the wire
//! (control → TEXT, audio → BINARY), while the recv task reads frames and drives
//! the session. A shared [`AtomicBool`] abort flag is set when the VAD detects the
//! user talking over the reply (or on an explicit `abort`); the send task drops
//! queued TTS audio while it is set, so a barge-in stops playback within one frame.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use tokio::sync::mpsc;

use super::ServerState;
use crate::voice::protocol::{VoiceClientMsg, VoiceServerMsg, VoiceState};
use crate::voice::session::{
    run_voice_turn, VoiceConfig, VoiceEvent, VoiceOutput, VoiceSession, VoiceSessionDeps,
    TTS_SAMPLE_RATE,
};

/// Query params on the upgrade URL. The opaque one-use ticket is the only
/// accepted credential; node/user credentials must be exchanged over HTTP first.
#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VoiceQuery {
    #[serde(default)]
    ticket: Option<String>,
}

/// `GET /api/voice/ws` — upgrade to the voice-mode socket. Node admittance is
/// resolved here (pre-upgrade); the session opens once the `start` frame arrives.
#[utoipa::path(
    get,
    path = "/api/voice/ws",
    tag = "Voice",
    summary = "upgrade to the voice-mode socket. Node admittance is",
    responses((status = 200, description = "OK", body = serde_json::Value))
)]
pub async fn voice_ws(
    ws: WebSocketUpgrade,
    State(state): State<ServerState>,
    Query(query): Query<VoiceQuery>,
) -> Response {
    let ticket = match crate::server::ws_ticket::consume(
        query.ticket.as_deref(),
        crate::server::ws_ticket::WsTicketRoute::Voice,
        None,
    ) {
        Some(ticket) => ticket,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                "missing or invalid WebSocket ticket",
            )
                .into_response();
        }
    };
    let caller = ticket.caller.clone();
	if ticket
		.jwt_expires_at
		.is_some_and(|expires_at| expires_at <= chrono::Utc::now().timestamp())
	{
		return (StatusCode::UNAUTHORIZED, "WebSocket ticket user identity expired")
			.into_response();
	}
	let token_generation = ticket.node_generation;
	ws.on_upgrade(move |socket| handle_socket(socket, state, caller, token_generation, ticket))
}

/// Build the in-process seam bundle a session drives (same handles `ServerState`
/// holds — the exact set the streaming chat path needs).
fn session_deps(state: &ServerState) -> VoiceSessionDeps {
    VoiceSessionDeps {
        registry: Arc::clone(&state.agents),
        conversations: state.conversations.clone(),
        agent_store: state.agent_store.clone(),
        manager: Arc::clone(&state.manager),
        memory: state.memory.clone(),
        worktree_diffs: Arc::clone(&state.worktree_diffs),
        mcp: Arc::clone(&state.mcp),
        skills: state.skills.clone(),
        traces: state.traces.clone(),
        client: state.client.clone(),
    }
}

/// Decode a BINARY frame of little-endian PCM16 into i16 samples.
fn pcm_from_bytes(bytes: &[u8]) -> Vec<i16> {
    bytes
        .chunks_exact(2)
        .map(|c| i16::from_le_bytes([c[0], c[1]]))
        .collect()
}

/// Per-connection driver: handshake on `start`, then the concurrent send/recv pump.
async fn handle_socket(
    socket: WebSocket,
    state: ServerState,
    caller: Option<crate::identity_verify::VerifiedCaller>,
    token_generation: u64,
    ticket: crate::server::ws_ticket::WsTicketClaims,
) {
    use futures_util::{SinkExt, StreamExt};

    let (mut ws_tx, mut ws_rx) = socket.split();
    let jwt_expiry = crate::server::ws_ticket::wait_for_jwt_expiry(ticket.jwt_expires_at);
    tokio::pin!(jwt_expiry);

    // ── Handshake: the first frame must be `start` ───────────────────────────
    let start = loop {
        let frame = tokio::select! {
            _ = &mut jwt_expiry => return,
            frame = ws_rx.next() => frame,
        };
        match frame {
            Some(Ok(Message::Text(text))) => match serde_json::from_str::<VoiceClientMsg>(&text) {
                Ok(msg @ VoiceClientMsg::Start { .. }) => break msg,
                Ok(_) => {
                    let _ = ws_tx
                        .send(error_frame("expected_start", "first frame must be `start`"))
                        .await;
                    return;
                }
                Err(e) => {
                    let _ = ws_tx
                        .send(error_frame("bad_json", &format!("malformed start: {e}")))
                        .await;
                    return;
                }
            },
            Some(Ok(Message::Close(_))) | None => return,
            Some(Ok(_)) => continue,
            Some(Err(_)) => return,
        }
    };

    let VoiceClientMsg::Start {
        conversation_id,
        sample_rate,
        agent_id,
        stt_engine,
        tts_engine,
        tts_voice,
    } = start
    else {
        return;
    };

    let session_id = format!("vs_{}", uuid::Uuid::new_v4().simple());
    // Ephemeral sessions get a stable id so ChatEnd + persistence have a key. A
    // client-supplied id is a REUSE of an existing conversation and must be gated;
    // a minted `voice_…` id is brand new and cannot collide with anyone's row.
    let conversation_id = conversation_id.unwrap_or_else(|| format!("voice_{session_id}"));
    if ticket
        .room_id
        .as_deref()
        .is_some_and(|room_id| room_id != conversation_id.as_str())
    {
        let _ = ws_tx
            .send(error_frame(
                "forbidden",
                "WebSocket ticket is not bound to this conversation",
            ))
            .await;
        return;
    }
    if !crate::sidecar::adapters::acp::is_safe_host_conversation_id(&conversation_id) {
        let _ = ws_tx
            .send(error_frame(
                "bad_conversation_id",
                "conversation_id must be 1-128 ASCII letters, digits, '.', '_' or '-'",
            ))
            .await;
        return;
    }

    // ── THE GATE ─────────────────────────────────────────────────────────────
    // The same create-or-use gate `chat_stream` uses: an EXISTING row gets the full
    // write check (this is what closes the bypass — user B naming user A's
    // conversation id and having A's history streamed back as context and B's turns
    // appended into A's thread); a NEW id is claimed for this caller so nobody else
    // can take it. No-op on an unbound personal node.
    if let Err(_resp) = super::gate_and_claim_conversation(&state, &caller, &conversation_id).await
    {
        let _ = ws_tx
            .send(error_frame(
                "forbidden",
                "you do not have access to that conversation",
            ))
            .await;
        return;
    }

    let cfg = VoiceConfig {
        conversation_id,
        agent_id,
        stt_engine,
        tts_engine,
        tts_voice,
        client_rate: sample_rate.max(8_000),
    };
    let mut session = VoiceSession::new(cfg, session_deps(&state));

    // ── Ack ──────────────────────────────────────────────────────────────────
    let ready = VoiceServerMsg::Ready {
        session_id,
        tts_sample_rate: TTS_SAMPLE_RATE,
    };
    if ws_tx.send(text_frame(&ready)).await.is_err() {
        return;
    }

    // ── Send task fed by an mpsc of session outputs ──────────────────────────
    let (out_tx, mut out_rx) = mpsc::channel::<VoiceOutput>(256);
    // Shared barge-in flag: set on VAD onset over the reply (or explicit `abort`),
    // read by the send side to drop queued TTS audio mid-stream.
    let abort = Arc::new(AtomicBool::new(false));
    let send_abort = Arc::clone(&abort);
    let send_task = tokio::spawn(async move {
        while let Some(output) = out_rx.recv().await {
            let msg = match output {
                VoiceOutput::Control(ctrl) => text_frame(&ctrl),
                VoiceOutput::Audio(bytes) => {
                    // Barge-in: drop queued audio while aborting. The flag is reset
                    // by the recv loop when it spawns the next turn, so a fresh
                    // turn's audio is never dropped by a stale abort.
                    if send_abort.load(Ordering::SeqCst) {
                        continue;
                    }
                    Message::Binary(bytes)
                }
            };
            if ws_tx.send(msg).await.is_err() {
                break;
            }
        }
    });

    // The in-flight turn (spawned off this loop so the loop stays responsive to
    // audio + barge-in while the model + TTS run). At most one at a time.
    let mut turn_handle: Option<tokio::task::JoinHandle<()>> = None;

	// ── Receive loop ─────────────────────────────────────────────────────────
	let mut token_updates = crate::node_token::subscribe_generation();
	if *token_updates.borrow() != token_generation {
		let _ = out_tx
			.send(VoiceOutput::Control(VoiceServerMsg::Error {
				code: "node_token_rotated".to_string(),
				message: "node token rotated; reconnect required".to_string(),
			}))
			.await;
		drop(out_tx);
		let _ = send_task.await;
		return;
	}
	loop {
		let frame = tokio::select! {
			_ = &mut jwt_expiry => {
				let _ = out_tx
					.send(VoiceOutput::Control(VoiceServerMsg::Error {
						code: "user_identity_expired".to_string(),
						message: "user identity expired; reconnect required".to_string(),
					}))
					.await;
				break;
			}
			changed = token_updates.changed() => {
				if changed.is_ok() && *token_updates.borrow() != token_generation {
					let _ = out_tx
						.send(VoiceOutput::Control(VoiceServerMsg::Error {
							code: "node_token_rotated".to_string(),
							message: "node token rotated; reconnect required".to_string(),
						}))
						.await;
				}
				break;
			}
			frame = ws_rx.next() => frame,
		};
		let Some(frame) = frame else { break };
		if crate::node_token::active_generation() != token_generation {
			let _ = out_tx
				.send(VoiceOutput::Control(VoiceServerMsg::Error {
					code: "node_token_rotated".to_string(),
					message: "node token rotated; reconnect required".to_string(),
				}))
				.await;
			break;
		}
		let frame = match frame {
            Ok(f) => f,
            Err(_) => break,
        };
        match frame {
            Message::Binary(bytes) => {
                let pcm = pcm_from_bytes(&bytes);
                if pcm.is_empty() {
                    continue;
	}
                for ev in session.on_audio(&pcm) {
                    match ev {
                        VoiceEvent::SpeechStart => {
                            let turn_active =
                                turn_handle.as_ref().is_some_and(|h| !h.is_finished());
                            // Barge-in: the user is talking over an in-flight reply.
                            if turn_active {
                                abort.store(true, Ordering::SeqCst);
                                let _ = out_tx
                                    .send(VoiceOutput::Control(VoiceServerMsg::StopPlayback))
                                    .await;
                            }
                            let _ = out_tx
                                .send(VoiceOutput::Control(VoiceServerMsg::State {
                                    value: VoiceState::Listening,
                                }))
                                .await;
                            let _ = out_tx
                                .send(VoiceOutput::Control(VoiceServerMsg::SpeechStart))
                                .await;
                        }
                        VoiceEvent::SpeechEnd => {
                            if let Some(turn) = session.take_utterance_turn() {
                                spawn_turn(turn, &abort, &out_tx, &mut turn_handle).await;
                            }
                        }
                    }
                }
            }
            Message::Text(text) => {
                let msg = match serde_json::from_str::<VoiceClientMsg>(&text) {
                    Ok(m) => m,
                    Err(e) => {
                        let _ = out_tx
                            .send(VoiceOutput::Control(VoiceServerMsg::Error {
                                code: "bad_json".to_string(),
                                message: format!("{e}"),
                            }))
                            .await;
                        continue;
                    }
                };
                match msg {
                    // A second `start` is ignored (session already established).
                    VoiceClientMsg::Start { .. } => {}
                    VoiceClientMsg::Text { content } => {
                        if let Some(turn) = session.make_text_turn(&content) {
                            spawn_turn(turn, &abort, &out_tx, &mut turn_handle).await;
                        }
                    }
                    VoiceClientMsg::Abort => {
                        abort.store(true, Ordering::SeqCst);
                        let _ = out_tx
                            .send(VoiceOutput::Control(VoiceServerMsg::StopPlayback))
                            .await;
                    }
                    VoiceClientMsg::Ping => {
                        let _ = out_tx
                            .send(VoiceOutput::Control(VoiceServerMsg::Pong))
                            .await;
                    }
                }
            }
            Message::Ping(_) | Message::Pong(_) => {}
            Message::Close(_) => break,
        }
    }

    // Teardown: signal abort, drop the sender so the send task ends, and await any
    // in-flight turn + the send task.
    abort.store(true, Ordering::SeqCst);
    drop(out_tx);
    if let Some(handle) = turn_handle.take() {
        let _ = handle.await;
    }
    let _ = send_task.await;
}

/// Serialize turns: abort + drain any prior turn, reset the flag so the new turn
/// speaks, then spawn it. Mirrors the hardware handler's barge-in-then-speak.
async fn spawn_turn(
    turn: crate::voice::session::VoiceTurn,
    abort: &Arc<AtomicBool>,
    out_tx: &mpsc::Sender<VoiceOutput>,
    turn_handle: &mut Option<tokio::task::JoinHandle<()>>,
) {
    abort.store(true, Ordering::SeqCst);
    if let Some(prev) = turn_handle.take() {
        let _ = prev.await;
    }
    abort.store(false, Ordering::SeqCst);
    *turn_handle = Some(tokio::spawn(run_voice_turn(
        turn,
        Arc::clone(abort),
        out_tx.clone(),
    )));
}

/// Serialize a server control message into a WS TEXT frame.
fn text_frame(msg: &VoiceServerMsg) -> Message {
    Message::Text(serde_json::to_string(msg).unwrap_or_else(|_| "{}".to_string()))
}

/// Build an `error` TEXT frame.
fn error_frame(code: &str, message: &str) -> Message {
    text_frame(&VoiceServerMsg::Error {
        code: code.to_string(),
        message: message.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Little-endian PCM16 decode: bytes pair into i16 samples LSB-first, including
    /// negative samples (the mic sends signed audio).
    #[test]
    fn pcm_decodes_little_endian_signed_samples() {
        // 0x0001 LE = 1; 0xFFFF LE = -1; 0x0080 -> 0x8000 is i16::MIN when high byte
        // set: [0x00, 0x80] = 0x8000 = -32768.
        let bytes = [0x01, 0x00, 0xFF, 0xFF, 0x00, 0x80];
        assert_eq!(pcm_from_bytes(&bytes), vec![1_i16, -1, i16::MIN]);
    }

    /// A trailing odd byte (a torn frame boundary) is dropped, never panics — the
    /// realtime mic path must survive a half-delivered sample.
    #[test]
    fn pcm_drops_trailing_odd_byte() {
        // Three bytes: one full sample + a dangling byte.
        let bytes = [0x10, 0x27, 0x42];
        assert_eq!(pcm_from_bytes(&bytes), vec![0x2710_i16]); // 10000
    }

    #[test]
    fn pcm_empty_slice_is_empty() {
        assert!(pcm_from_bytes(&[]).is_empty());
        // A lone byte yields no samples (no half-sample emitted).
        assert!(pcm_from_bytes(&[0x42]).is_empty());
    }

    /// The upgrade query accepts only the opaque ticket field; bearer credentials
    /// are exchanged over HTTP before the socket is opened.
    #[test]
    fn voice_query_contains_only_a_ticket() {
        let query: VoiceQuery =
            serde_json::from_value(serde_json::json!({ "ticket": "opaque-ticket" })).unwrap();
        assert_eq!(query.ticket.as_deref(), Some("opaque-ticket"));
        assert!(serde_json::from_value::<VoiceQuery>(
            serde_json::json!({ "jwt": "legacy" })
        )
        .is_err());
    }

    /// The error frame is a tagged-union TEXT message the client can route by
    /// `type`; it carries the code + message verbatim.
    #[test]
    fn error_frame_is_tagged_error_text() {
        let Message::Text(text) = error_frame("expected_start", "first frame must be `start`")
        else {
            panic!("error_frame must produce a TEXT frame");
        };
        let v: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v["type"], "error");
        assert_eq!(v["code"], "expected_start");
        assert_eq!(v["message"], "first frame must be `start`");
    }

    /// `text_frame` serializes a control message to a routable `type`-tagged frame.
    #[test]
    fn text_frame_tags_control_messages() {
        let Message::Text(text) = text_frame(&VoiceServerMsg::Pong) else {
            panic!("expected TEXT");
        };
        let v: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v["type"], "pong");
    }
}
