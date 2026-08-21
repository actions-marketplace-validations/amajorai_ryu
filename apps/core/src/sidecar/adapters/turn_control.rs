//! Core-owned control for an in-flight model turn.
//!
//! The UI may ask a running turn to leave its reasoning block early, but only a
//! provider adapter that can prove it supports that operation may register here.
//! The first adapter is direct, loopback llama.cpp. Cloud providers, Gateway
//! routes, ACP agents, and sandboxed plugins never receive this capability by
//! implication.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

/// A native reasoning-control target owned by a provider adapter.
#[derive(Clone, Debug)]
pub(crate) struct NativeTurnControl {
    conversation_id: String,
    base_url: String,
    model: String,
    effort: Option<String>,
}

impl NativeTurnControl {
    /// Build a target only when the turn has a conversation and has not
    /// explicitly disabled reasoning. An absent effort means the model's
    /// default reasoning mode, which may still be controlled by llama.cpp.
    pub(crate) fn new(
        conversation_id: Option<&str>,
        base_url: String,
        model: String,
        effort: Option<String>,
    ) -> Option<Self> {
        let conversation_id = conversation_id?.trim();
        if conversation_id.is_empty() {
            return None;
        }
        let effort = effort
            .map(|value| value.trim().to_ascii_lowercase())
            .filter(|value| !value.is_empty());
        if effort.as_deref() == Some("none") {
            return None;
        }
        Some(Self {
            conversation_id: conversation_id.to_owned(),
            base_url,
            model,
            effort,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TurnPhase {
    Reasoning,
    Answering,
}

struct ActiveTurn {
    target: NativeTurnControl,
    completion_id: Option<String>,
    phase: TurnPhase,
    request_sent: bool,
}

fn registry() -> &'static Mutex<HashMap<String, ActiveTurn>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, ActiveTurn>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Metadata retained by the streaming adapter so it can emit the same turn id
/// the control endpoint receives. Dropping it removes the live capability.
pub(crate) struct TurnRegistration {
    pub(crate) turn_id: String,
    pub(crate) started_at_ms: u64,
    pub(crate) effort: Option<String>,
}

impl Drop for TurnRegistration {
    fn drop(&mut self) {
        if let Ok(mut turns) = registry().lock() {
            turns.remove(&self.turn_id);
        }
    }
}

pub(crate) fn register(target: NativeTurnControl) -> TurnRegistration {
    let turn_id = format!("turn_{}", uuid::Uuid::new_v4().simple());
    let started_at_ms = now_ms();
    let effort = target.effort.clone();
    if let Ok(mut turns) = registry().lock() {
        turns.insert(
            turn_id.clone(),
            ActiveTurn {
                target,
                completion_id: None,
                phase: TurnPhase::Reasoning,
                request_sent: false,
            },
        );
    }
    TurnRegistration {
        turn_id,
        started_at_ms,
        effort,
    }
}

/// Record the provider's streamed completion id. The id is what llama.cpp's
/// control endpoint uses to find the in-flight request. Returns `true` only for
/// the first valid id so the adapter emits one initial descriptor part.
pub(crate) fn set_completion_id(turn_id: &str, completion_id: &str) -> bool {
    let completion_id = completion_id.trim();
    if completion_id.is_empty() {
        return false;
    }
    let Ok(mut turns) = registry().lock() else {
        return false;
    };
    let Some(turn) = turns.get_mut(turn_id) else {
        return false;
    };
    if turn.completion_id.is_some() {
        return false;
    }
    turn.completion_id = Some(completion_id.to_owned());
    true
}

pub(crate) fn mark_answering(turn_id: &str) -> bool {
    let Ok(mut turns) = registry().lock() else {
        return false;
    };
    let Some(turn) = turns.get_mut(turn_id) else {
        return false;
    };
    if turn.phase != TurnPhase::Reasoning {
        return false;
    }
    turn.phase = TurnPhase::Answering;
    true
}

#[derive(Debug)]
pub(crate) enum AnswerNowError {
    NotFound,
    NotReady,
    AlreadyRequested,
    Provider(String),
}

struct ControlRequest {
    base_url: String,
    model: String,
    completion_id: String,
}

fn control_endpoint(base_url: &str) -> String {
    format!(
        "{}/v1/chat/completions/control",
        base_url.trim_end_matches('/')
    )
}

fn control_body(request: &ControlRequest) -> Value {
    json!({
        "id": request.completion_id,
        "action": "reasoning_end",
        "model": request.model,
    })
}

async fn send_reasoning_end(request: ControlRequest) -> Result<(), String> {
    static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    let client = HTTP_CLIENT.get_or_init(reqwest::Client::new);
    let response = client
        .post(control_endpoint(&request.base_url))
        .json(&control_body(&request))
        .send()
        .await
        .map_err(|error| format!("llama.cpp control request failed: {error}"))?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("llama.cpp control endpoint returned HTTP {status}"));
    }
    if let Ok(value) = serde_json::from_str::<Value>(&body) {
        if value.get("success").and_then(Value::as_bool) == Some(false) {
            let message = value
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("provider rejected reasoning control");
            return Err(message.to_owned());
        }
    }
    Ok(())
}

fn clear_failed_request(turn_id: &str) {
    if let Ok(mut turns) = registry().lock() {
        if let Some(turn) = turns.get_mut(turn_id) {
            turn.request_sent = false;
        }
    }
}

/// Ask a registered native provider to end reasoning. The registry check and
/// completion-id lookup happen before the network call, so a stale UI action
/// cannot control a later turn that happens to reuse the same conversation.
pub(crate) async fn request_answer_now(
    conversation_id: &str,
    turn_id: &str,
) -> Result<(), AnswerNowError> {
    let request = {
        let Ok(mut turns) = registry().lock() else {
            return Err(AnswerNowError::NotFound);
        };
        let Some(turn) = turns.get_mut(turn_id) else {
            return Err(AnswerNowError::NotFound);
        };
        if turn.target.conversation_id != conversation_id {
            return Err(AnswerNowError::NotFound);
        }
        if turn.phase != TurnPhase::Reasoning {
            return Err(AnswerNowError::NotReady);
        }
        if turn.request_sent {
            return Err(AnswerNowError::AlreadyRequested);
        }
        let Some(completion_id) = turn.completion_id.clone() else {
            return Err(AnswerNowError::NotReady);
        };
        turn.request_sent = true;
        ControlRequest {
            base_url: turn.target.base_url.clone(),
            model: turn.target.model.clone(),
            completion_id,
        }
    };

    if let Err(error) = send_reasoning_end(request).await {
        clear_failed_request(turn_id);
        return Err(AnswerNowError::Provider(error));
    }
    Ok(())
}

pub(crate) fn descriptor(registration: &TurnRegistration, phase: &str) -> Value {
    let mut data = json!({
        "turnId": registration.turn_id,
        "strategy": "native",
        "phase": phase,
        "startedAtMs": registration.started_at_ms,
    });
    if let Some(effort) = registration.effort.as_deref() {
        data["effort"] = Value::String(effort.to_owned());
    }
    data
}

#[cfg(test)]
mod tests {
    use super::{control_body, control_endpoint, ControlRequest, NativeTurnControl};

    #[test]
    fn control_endpoint_joins_a_loopback_base_url() {
        assert_eq!(
            control_endpoint("http://127.0.0.1:9080/"),
            "http://127.0.0.1:9080/v1/chat/completions/control"
        );
    }

    #[test]
    fn control_body_matches_llama_cpp_wire_contract() {
        let body = control_body(&ControlRequest {
            base_url: "http://127.0.0.1:9080".to_owned(),
            model: "local-model".to_owned(),
            completion_id: "chatcmpl-1".to_owned(),
        });
        assert_eq!(body["id"], "chatcmpl-1");
        assert_eq!(body["action"], "reasoning_end");
        assert_eq!(body["model"], "local-model");
    }

    #[test]
    fn explicit_none_effort_does_not_advertise_control() {
        assert!(NativeTurnControl::new(
            Some("conv-1"),
            "http://127.0.0.1:9080".to_owned(),
            "local-model".to_owned(),
            Some("none".to_owned()),
        )
        .is_none());
    }

    #[tokio::test]
    async fn answer_now_posts_the_native_provider_control_request() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            loop {
                let mut chunk = [0_u8; 1024];
                let read = socket.read(&mut chunk).await.unwrap();
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&chunk[..read]);
                if request
                    .windows(b"reasoning_end".len())
                    .any(|window| window == b"reasoning_end")
                {
                    break;
                }
            }
            let body = r#"{"success":true}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            socket.write_all(response.as_bytes()).await.unwrap();
            String::from_utf8(request).unwrap()
        });

        let target = NativeTurnControl::new(
            Some("conv-1"),
            format!("http://{address}"),
            "local-model".to_owned(),
            Some("high".to_owned()),
        )
        .unwrap();
        let registration = super::register(target);
        assert!(super::set_completion_id(
            &registration.turn_id,
            "chatcmpl-1"
        ));
        super::request_answer_now("conv-1", &registration.turn_id)
            .await
            .unwrap();
        let request = server.await.unwrap();
        assert!(request.contains("POST /v1/chat/completions/control HTTP/1.1"));
        assert!(request.contains(r#""id":"chatcmpl-1"#));
        assert!(request.contains(r#""action":"reasoning_end"#));
    }
}
