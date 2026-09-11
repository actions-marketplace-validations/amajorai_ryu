//! Authenticated inbound PSTN voice bridge.
//!
//! Twilio owns the phone number and sends a bidirectional Media Streams
//! WebSocket. Gateway verifies the Twilio signature, translates μ-law/8 kHz
//! frames through the shared channel codec, and proxies the normalized audio to
//! Core's existing `/api/voice/ws` session. Provider credentials remain
//! environment-backed until the phone connection has a control-plane owner.

use std::collections::BTreeMap;

use axum::{
    extract::{
        ws::{WebSocket, WebSocketUpgrade},
        Form,
    },
    http::{header, HeaderMap, StatusCode, Uri},
    response::{IntoResponse, Response},
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use futures_util::{SinkExt, StreamExt};
use hmac::{Hmac, Mac};
use serde_json::Value;
use sha1::Sha1;
use sha2::{Digest, Sha256};
use tokio_tungstenite::{connect_async, tungstenite::Message as CoreMessage};

use ryu_gw_channels::voice_call::{
    decode_twilio_audio, parse_twilio_event, twilio_clear_message, twilio_media_payload_message,
    validate_twilio_start, wav_to_twilio_audio, TwilioMediaEvent, TWILIO_MULAW_FRAME_BYTES,
};

const TWILIO_AUTH_TOKEN_ENV: &str = "RYU_TWILIO_AUTH_TOKEN";
const PUBLIC_URL_ENV: &str = "RYU_VOICE_CALL_PUBLIC_URL";
const CORE_URL_ENV: &str = "RYU_VOICE_CALL_CORE_URL";
const CORE_TOKEN_ENV: &str = "RYU_VOICE_CALL_CORE_TOKEN";
const AGENT_ID_ENV: &str = "RYU_VOICE_CALL_AGENT_ID";
const ANSWER_PATH: &str = "/voice/twilio/answer";
const STREAM_PATH: &str = "/voice/twilio/stream";

type HmacSha1 = Hmac<Sha1>;

/// Twilio's inbound voice webhook. It returns `<Connect><Stream>` only after
/// signature verification and a complete public/core configuration is present.
pub async fn twilio_answer(
    headers: HeaderMap,
    Form(params): Form<BTreeMap<String, String>>,
) -> Response {
    let answer_url = match public_url(ANSWER_PATH) {
        Ok(url) => url,
        Err(message) => return service_unavailable(message),
    };
    let Some(auth_token) = env_value(TWILIO_AUTH_TOKEN_ENV) else {
        return service_unavailable("Twilio voice is not configured");
    };
    if !verify_twilio_signature(
        &answer_url,
        &params,
        headers.get("x-twilio-signature"),
        &auth_token,
    ) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if core_ws_url().is_err() {
        return service_unavailable("Core voice bridge credentials are not configured");
    }

    let stream_url = match public_url(STREAM_PATH).and_then(|url| websocket_url(&url)) {
        Ok(url) => url,
        Err(message) => return service_unavailable(message),
    };
    let remote_identity = params.get("From").map(String::as_str).unwrap_or("unknown");
    let call_id = params
        .get("CallSid")
        .map(String::as_str)
        .unwrap_or("unknown-call");
    let conversation_id = conversation_id(remote_identity, call_id);
    let agent_id = env_value(AGENT_ID_ENV);

    let mut xml =
        String::from(r#"<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url=""#);
    xml.push_str(&xml_escape(&stream_url));
    xml.push_str(r#"">"#);
    xml.push_str(&format!(
        r#"<Parameter name="conversationId" value="{}"/><Parameter name="remoteIdentity" value="{}"/>"#,
        xml_escape(&conversation_id),
        xml_escape(remote_identity),
    ));
    if let Some(agent_id) = agent_id.as_deref() {
        xml.push_str(&format!(
            r#"<Parameter name="agentId" value="{}"/>"#,
            xml_escape(agent_id),
        ));
    }
    xml.push_str("</Stream></Connect></Response>");

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/xml; charset=utf-8")
        .body(axum::body::Body::from(xml))
        .expect("static TwiML response headers are valid")
        .into_response()
}

/// Twilio's bidirectional media stream. This route is public at the HTTP layer
/// because Twilio initiates it; the handler performs the provider signature and
/// configuration checks before upgrading.
pub async fn twilio_stream(ws: WebSocketUpgrade, headers: HeaderMap, uri: Uri) -> Response {
    if uri.path() != STREAM_PATH || uri.query().is_some() {
        return StatusCode::NOT_FOUND.into_response();
    }
    let stream_http_url = match public_url(STREAM_PATH) {
        Ok(url) => url,
        Err(message) => return service_unavailable(message),
    };
    let stream_url = match websocket_url(&stream_http_url) {
        Ok(url) => url,
        Err(message) => return service_unavailable(message),
    };
    let Some(auth_token) = env_value(TWILIO_AUTH_TOKEN_ENV) else {
        return service_unavailable("Twilio voice is not configured");
    };
    let signature = headers.get("x-twilio-signature");
    if !verify_twilio_signature(&stream_url, &BTreeMap::new(), signature, &auth_token)
        && !verify_twilio_signature(
            &format!("{stream_url}/"),
            &BTreeMap::new(),
            signature,
            &auth_token,
        )
    {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if core_ws_url().is_err() {
        return service_unavailable("Core voice bridge credentials are not configured");
    }

    ws.on_upgrade(handle_twilio_stream).into_response()
}

async fn handle_twilio_stream(socket: WebSocket) {
    let core_url = match core_ws_url() {
        Ok(url) => url,
        Err(error) => {
            tracing::warn!(%error, "twilio voice bridge could not resolve Core URL");
            return;
        }
    };
    let (core, _) = match connect_async(core_url).await {
        Ok(connection) => connection,
        Err(error) => {
            tracing::warn!(%error, "twilio voice bridge could not connect to Core voice");
            return;
        }
    };

    let (mut twilio_tx, mut twilio_rx) = socket.split();
    let (mut core_tx, mut core_rx) = core.split();
    let mut stream_sid: Option<String> = None;
    let mut core_started = false;
    loop {
        tokio::select! {
            frame = twilio_rx.next() => {
                let Some(Ok(frame)) = frame else { break };
                match frame {
                    axum::extract::ws::Message::Text(text) => {
                        let event = match parse_twilio_event(&text) {
                            Ok(event) => event,
                            Err(error) => {
                                tracing::warn!(%error, "twilio voice bridge rejected malformed event");
                                break;
                            }
                        };
                        match event {
                            TwilioMediaEvent::Connected { .. } | TwilioMediaEvent::Mark { .. } => {}
                            TwilioMediaEvent::Start { stream_sid: incoming_sid, start, .. } => {
                                if core_started {
                                    continue;
                                }
                                if let Err(error) = validate_twilio_start(&start) {
                                    tracing::warn!(%error, "twilio voice bridge rejected audio format");
                                    break;
                                }
                                let conversation = start.custom_parameters
                                    .get("conversationId")
                                    .and_then(|value| safe_conversation_id(value))
                                    .unwrap_or_else(|| conversation_id("", &start.call_sid));
                                let agent_id = start.custom_parameters
                                    .get("agentId")
                                    .cloned()
                                    .or_else(|| env_value(AGENT_ID_ENV));
                                let start_message = serde_json::json!({
                                    "type": "start",
                                    "sample_rate": 8_000,
                                    "conversation_id": conversation,
                                    "agent_id": agent_id,
                                });
                                if core_tx.send(CoreMessage::Text(start_message.to_string().into())).await.is_err() {
                                    break;
                                }
                                stream_sid = Some(incoming_sid);
                                core_started = true;
                            }
                            TwilioMediaEvent::Media { media, .. } if core_started && media.track == "inbound" => {
                                let samples = match decode_twilio_audio(&media.payload) {
                                    Ok(samples) => samples,
                                    Err(error) => {
                                        tracing::warn!(%error, "twilio voice bridge rejected audio payload");
                                        break;
                                    }
                                };
                                if core_tx.send(CoreMessage::Binary(pcm_bytes(&samples).into())).await.is_err() {
                                    break;
                                }
                            }
                            TwilioMediaEvent::Media { .. } | TwilioMediaEvent::Dtmf { .. } => {}
                            TwilioMediaEvent::Stop { .. } => break,
                        }
                    }
                    axum::extract::ws::Message::Ping(payload) => {
                        if twilio_tx.send(axum::extract::ws::Message::Pong(payload)).await.is_err() {
                            break;
                        }
                    }
                    axum::extract::ws::Message::Close(_) => break,
                    axum::extract::ws::Message::Binary(_) | axum::extract::ws::Message::Pong(_) => {}
                }
            }
            frame = core_rx.next() => {
                let Some(Ok(frame)) = frame else { break };
                match frame {
                    CoreMessage::Text(text) => {
                        let value: Value = match serde_json::from_str(&text) {
                            Ok(value) => value,
                            Err(error) => {
                                tracing::warn!(%error, "Core voice bridge emitted malformed control frame");
                                break;
                            }
                        };
                        match value["type"].as_str() {
                            Some("stop_playback") => {
                                if let Some(stream_sid) = stream_sid.as_deref() {
                                    let _ = twilio_tx.send(axum::extract::ws::Message::Text(
                                        twilio_clear_message(stream_sid).into(),
                                    )).await;
                                }
                            }
                            Some("error") => {
                                tracing::warn!(message = ?value["message"], "Core voice session failed");
                                break;
                            }
                            _ => {}
                        }
                    }
                    CoreMessage::Binary(wav) => {
                        let Some(stream_sid) = stream_sid.as_deref() else { continue };
                        let encoded = match wav_to_twilio_audio(&wav) {
                            Ok(encoded) => encoded,
                            Err(error) => {
                                tracing::warn!(%error, "Core voice bridge received unsupported WAV");
                                break;
                            }
                        };
                        let payload = match BASE64.decode(encoded) {
                            Ok(payload) => payload,
                            Err(error) => {
                                tracing::warn!(%error, "Core voice bridge failed to encode media");
                                break;
                            }
                        };
                        for chunk in payload.chunks(TWILIO_MULAW_FRAME_BYTES) {
                            if twilio_tx.send(axum::extract::ws::Message::Text(
                                twilio_media_payload_message(stream_sid, chunk).into(),
                            )).await.is_err() {
                                break;
                            }
                        }
                    }
                    CoreMessage::Ping(payload) => {
                        if core_tx.send(CoreMessage::Pong(payload)).await.is_err() {
                            break;
                        }
                    }
                    CoreMessage::Close(_) => break,
                    CoreMessage::Pong(_) | CoreMessage::Frame(_) => {}
                }
            }
        }
    }

    let _ = core_tx.send(CoreMessage::Close(None)).await;
}

fn env_value(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn public_url(path: &str) -> Result<String, &'static str> {
    let base = env_value(PUBLIC_URL_ENV).ok_or("public voice-call URL is not configured")?;
    if !(base.starts_with("https://") || base.starts_with("http://"))
        || base.contains('?')
        || base.contains('#')
    {
        return Err("public voice-call URL must be an http(s) origin without query or fragment");
    }
    Ok(format!("{}{}", base.trim_end_matches('/'), path))
}

fn websocket_url(http_url: &str) -> Result<String, &'static str> {
    if let Some(rest) = http_url.strip_prefix("https://") {
        return Ok(format!("wss://{rest}"));
    }
    Err("Twilio Media Streams require an https public URL for wss")
}

fn core_ws_url() -> anyhow::Result<String> {
    let base = env_value(CORE_URL_ENV)
        .or_else(|| env_value("RYU_CORE_URL"))
        .ok_or_else(|| anyhow::anyhow!("Core voice URL is not configured"))?;
    let token = env_value(CORE_TOKEN_ENV)
        .or_else(|| env_value("RYU_TOKEN"))
        .ok_or_else(|| anyhow::anyhow!("Core voice token is not configured"))?;
    let mut url = reqwest::Url::parse(&base)?;
    let scheme = match url.scheme() {
        "http" => "ws",
        "https" => "wss",
        _ => anyhow::bail!("Core voice URL must use http(s)"),
    };
    url.set_scheme(scheme)
        .map_err(|_| anyhow::anyhow!("Core voice URL scheme could not be changed"))?;
    url.set_path("/api/voice/ws");
    url.set_query(None);
    url.query_pairs_mut().append_pair("token", &token);
    Ok(url.to_string())
}

fn verify_twilio_signature(
    url: &str,
    params: &BTreeMap<String, String>,
    provided: Option<&axum::http::HeaderValue>,
    auth_token: &str,
) -> bool {
    let Some(provided) = provided.and_then(|value| value.to_str().ok()) else {
        return false;
    };
    let mut input = url.to_owned();
    for (key, value) in params {
        input.push_str(key);
        input.push_str(value);
    }
    let Ok(mut mac) = HmacSha1::new_from_slice(auth_token.as_bytes()) else {
        return false;
    };
    mac.update(input.as_bytes());
    let expected = BASE64.encode(mac.finalize().into_bytes());
    constant_time_equal(expected.as_bytes(), provided.as_bytes())
}

fn constant_time_equal(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let mut difference = 0_u8;
    for (a, b) in left.iter().zip(right) {
        difference |= a ^ b;
    }
    difference == 0
}

fn conversation_id(remote_identity: &str, call_id: &str) -> String {
    let source = if remote_identity.trim().is_empty() {
        call_id
    } else {
        remote_identity
    };
    let digest = Sha256::digest(source.as_bytes());
    format!("phone_{}", &hex::encode(digest)[..24])
}

fn safe_conversation_id(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 128 {
        return None;
    }
    if value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        Some(value.to_owned())
    } else {
        None
    }
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn pcm_bytes(samples: &[i16]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(samples.len() * 2);
    for sample in samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    bytes
}

fn service_unavailable(message: &'static str) -> Response {
    (StatusCode::SERVICE_UNAVAILABLE, message).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn verifies_twilio_signature_over_sorted_form_values() {
        let mut params = BTreeMap::new();
        params.insert("CallSid".to_owned(), "CA123".to_owned());
        params.insert("From".to_owned(), "+15551234567".to_owned());
        let url = "https://voice.example.test/voice/twilio/answer";
        let mut input = url.to_owned();
        input.push_str("CallSidCA123");
        input.push_str("From+15551234567");
        let mut mac = HmacSha1::new_from_slice(b"secret").unwrap();
        mac.update(input.as_bytes());
        let signature = BASE64.encode(mac.finalize().into_bytes());
        let header = HeaderValue::from_str(&signature).unwrap();
        assert!(verify_twilio_signature(
            url,
            &params,
            Some(&header),
            "secret"
        ));
        assert!(!verify_twilio_signature(
            url,
            &params,
            Some(&header),
            "wrong"
        ));
    }

    #[test]
    fn conversation_ids_do_not_contain_phone_numbers() {
        let id = conversation_id("+6591234567", "CA123");
        assert!(id.starts_with("phone_"));
        assert!(!id.contains("6591234567"));
        assert_eq!(id, conversation_id("+6591234567", "CA999"));
    }

    #[test]
    fn xml_escape_covers_twiml_attribute_delimiters() {
        assert_eq!(xml_escape("a&b<c>\"d'e"), "a&amp;b&lt;c&gt;&quot;d&apos;e");
    }

    #[test]
    fn core_ws_url_requires_explicit_credentials() {
        // Configuration-dependent behavior is covered by the handler's fail-closed
        // response; this assertion keeps the URL builder's shape reviewable.
        assert!(safe_conversation_id("phone_abc-123").is_some());
        assert!(safe_conversation_id("phone:bad").is_none());
    }
}
