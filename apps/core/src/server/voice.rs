//! Voice engine data path — speech-to-text transcription.
//!
//! `POST /api/voice/transcribe` accepts a multipart upload with a `file` field
//! (the audio) and proxies it to the running whisper.cpp voice sidecar's
//! `/inference` endpoint, returning `{ "text": "..." }`. This is the consumer
//! that makes the voice engine callable: install + start `whispercpp` from the
//! Store, then POST audio here.
//!
//! Per the Core-vs-Gateway rule this is **Core** (it decides *what runs* — which
//! voice engine handles the audio). Both legs can also route to the cloud:
//! `?engine=gateway` on transcribe goes through the Gateway's STT slot
//! (`crates/core/stt`), and `engine: "gateway"` on speak goes through its TTS
//! slot ([`synth_via_gateway`] below).

use axum::{
    extract::{Multipart, Query, State},
    http::{header, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use super::ServerState;

// The STT primitive — result types (`Transcription`/`TranscriptSegment`),
// `verbose_json` parsing, the engine dispatch, and the in-process parakeet ONNX
// engine — now lives in the extracted `ryu-stt` crate. Re-export the result types
// + the cross-surface default resolver + the Core-wired data-path entrypoints
// (`stt_host`) so the route handlers below and external callers keep referring to
// `crate::server::voice::{...}` unchanged.
pub use ryu_stt::{default_stt_engine, TranscriptSegment, Transcription};

pub use crate::stt_host::{transcribe_wav, transcribe_wav_detailed};

/// Optional `?engine=` selector for the transcription engine.
#[derive(Debug, Deserialize)]
pub struct TranscribeQuery {
    /// `"parakeet"` (default), `"whisper"` (local whisper.cpp), or `"gateway"`
    /// (Gateway-routed Whisper — the swappable cloud STT slot, default Groq).
    /// When omitted, the cross-surface default from [`default_stt_engine`] is used.
    #[serde(default)]
    pub engine: Option<String>,
}

/// Request body for text-to-speech synthesis.
#[derive(Debug, Deserialize)]
pub struct SpeakRequest {
    /// The text to speak.
    pub text: String,
    /// Engine selector. Omitted or `"outetts"` → the built-in OuteTTS engine
    /// (backward compatible). `"gateway"` routes to the Gateway's TTS modality
    /// slot (the swappable cloud provider). Any other id (e.g. `"kitten"`,
    /// `"pocket"`) is served by the universal Ryu TTS sidecar
    /// (`apps-store/voice/sidecar`).
    #[serde(default)]
    pub engine: Option<String>,
    /// Voice id (engine-specific); defaults to the engine's default voice.
    #[serde(default)]
    pub voice: Option<String>,
    /// Speaking-rate multiplier where the engine supports it.
    #[serde(default)]
    pub speed: Option<f32>,
    /// BCP-47-ish language hint for multilingual engines.
    #[serde(default)]
    pub language: Option<String>,
    /// Reference wav path/URL for cloning-capable engines (ignored otherwise).
    #[serde(default)]
    pub reference_audio: Option<String>,
}

/// `POST /api/voice/speak` — synthesize speech from text, returning a `audio/wav`
/// body. Engine selection mirrors `/api/voice/transcribe`'s `?engine=` pattern:
/// omitted (or `"outetts"`) runs the built-in OuteTTS `llama-tts` path; any other
/// engine id is proxied to the universal Ryu TTS sidecar's `/generate`. Nothing
/// is hardcoded — the available engines are whatever the sidecar registry serves.
#[utoipa::path(
    post,
    path = "/api/voice/speak",
    tag = "Voice",
    summary = "synthesize speech from text, returning a `audio/wav",
    request_body = serde_json::Value,
    responses((status = 200, description = "OK", body = serde_json::Value))
)]
pub async fn speak(
    State(state): State<ServerState>,
    Json(req): Json<SpeakRequest>,
) -> impl IntoResponse {
    let text = req.text.trim();
    if text.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "missing `text` (the words to speak)" })),
        )
            .into_response();
    }

    // The cross-surface default engine (Kokoro 82M) is a swappable registry default,
    // not a hardcoded literal — resolved here so one env var re-points every surface.
    let engine = req
        .engine
        .clone()
        .unwrap_or_else(crate::sidecar::providers::ryutts::default_tts_engine);

    // Built-in fallback engine: OuteTTS via the shared llama-tts binary (no sidecar).
    if engine == "outetts" {
        return match crate::sidecar::providers::outetts::synthesize(text).await {
            Ok(wav) => (StatusCode::OK, [(header::CONTENT_TYPE, "audio/wav")], wav).into_response(),
            Err(e) => (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "error": format!("text-to-speech failed: {e:#}") })),
            )
                .into_response(),
        };
    }

    // The cloud slot: route to the Gateway's TTS modality provider. Same
    // graceful degrade as the sidecar path below — a cloud outage must not
    // silence the island — but the content type comes from the provider, since
    // it may hand back mp3 rather than wav.
    if engine == "gateway" {
        match synth_via_gateway(&state.client, req.voice.as_deref(), req.speed, text).await {
            Ok((audio, content_type)) => {
                return (
                    StatusCode::OK,
                    [(header::CONTENT_TYPE, content_type)],
                    audio,
                )
                    .into_response();
            }
            Err(gateway_err) => {
                tracing::warn!("gateway TTS failed ({gateway_err}); falling back to OuteTTS");
                return match crate::sidecar::providers::outetts::synthesize(text).await {
                    Ok(wav) => {
                        (StatusCode::OK, [(header::CONTENT_TYPE, "audio/wav")], wav).into_response()
                    }
                    Err(fallback_err) => (
                        StatusCode::BAD_GATEWAY,
                        Json(json!({
                            "error": format!(
                                "gateway TTS failed ({gateway_err}) and the OuteTTS \
                                 fallback also failed ({fallback_err:#})."
                            )
                        })),
                    )
                        .into_response(),
                };
            }
        }
    }

    // Everything else (incl. the Kokoro default): proxy to the Ryu TTS sidecar's
    // normalized /generate. If the sidecar is down or the engine can't render (e.g.
    // the sidecar runtime isn't provisioned yet on this node), degrade gracefully to
    // the always-available OuteTTS fallback so spoken output never hard-fails.
    match synth_via_sidecar(&state, &engine, &req, text).await {
        Ok(wav) => (StatusCode::OK, [(header::CONTENT_TYPE, "audio/wav")], wav).into_response(),
        Err(sidecar_err) => {
            tracing::warn!(
                engine = %engine,
                "TTS sidecar synthesis failed ({sidecar_err}); falling back to OuteTTS"
            );
            match crate::sidecar::providers::outetts::synthesize(text).await {
                Ok(wav) => {
                    (StatusCode::OK, [(header::CONTENT_TYPE, "audio/wav")], wav).into_response()
                }
                Err(fallback_err) => (
                    StatusCode::BAD_GATEWAY,
                    Json(json!({
                        "error": format!(
                            "TTS engine '{engine}' failed ({sidecar_err}) and the OuteTTS \
                             fallback also failed ({fallback_err:#})."
                        )
                    })),
                )
                    .into_response(),
            }
        }
    }
}

/// Proxy one synthesis request to the Ryu TTS sidecar's `/generate`, returning the
/// `audio/wav` bytes or a human-readable error. Factored out so [`speak`] can wrap it
/// in an OuteTTS fallback (and so the low-latency voice-session path can reuse it).
async fn synth_via_sidecar(
    state: &ServerState,
    engine: &str,
    req: &SpeakRequest,
    text: &str,
) -> Result<Vec<u8>, String> {
    let url = format!(
        "{}/generate",
        crate::sidecar::providers::ryutts::tts_base_url()
    );
    let mut body = json!({ "text": text, "engine": engine });
    if let Some(v) = &req.voice {
        body["voice"] = json!(v);
    }
    if let Some(s) = req.speed {
        body["speed"] = json!(s);
    }
    if let Some(l) = &req.language {
        body["language"] = json!(l);
    }
    if let Some(r) = &req.reference_audio {
        body["reference_audio"] = json!(r);
    }

    let resp = state
        .client
        .post(&url)
        .bearer_auth(crate::sidecar::providers::ryutts::bearer())
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ryu TTS sidecar not reachable at {url}: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let detail = resp.text().await.unwrap_or_default();
        return Err(format!(
            "ryu-tts engine '{engine}' returned {status}: {detail}"
        ));
    }

    resp.bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| format!("reading ryu-tts audio failed: {e}"))
}

/// The voice sent to the Gateway when the caller supplies none. OpenAI's
/// `/v1/audio/speech` **requires** `voice`, and the stored preference is empty
/// for anyone who picked the cloud engine before a voice list existed — so a
/// default here is what keeps read-aloud from 400ing into the OuteTTS fallback.
pub(crate) const DEFAULT_GATEWAY_TTS_VOICE: &str = "alloy";

/// The model Core asks the Gateway for when `RYU_TTS_GATEWAY_MODEL` is unset.
/// It is only a routing hint: with no slot header and no `modality_map[Tts]`
/// entry the Gateway falls through to model-based routing, and the provider
/// overwrites `model` with whatever the route resolved to.
pub(crate) const DEFAULT_GATEWAY_TTS_MODEL: &str = "tts-1";

/// The operator's explicit TTS slot pins, if any.
///
/// Empty means "do not send the slot headers at all" — and that is the point.
/// The Gateway resolves slot override → `modality_map` → model routing, so a
/// header sent unconditionally would win over the TTS provider the user chose
/// in Settings → Providers and make that setting permanently inert.
fn gateway_tts_slot_overrides() -> (Option<String>, Option<String>) {
    let read = |key: &str| {
        std::env::var(key)
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    };
    (
        read("RYU_TTS_GATEWAY_PROVIDER"),
        read("RYU_TTS_GATEWAY_MODEL"),
    )
}

/// Build the `/v1/audio/speech` body. `input` (not `text`) is load-bearing: the
/// Gateway's inbound firewall scans `body["input"]` for Tts, so any other key
/// would route fine and silently skip the scan. `voice` is always populated
/// because OpenAI rejects the request without one.
fn gateway_tts_payload(model: &str, voice: Option<&str>, speed: Option<f32>, text: &str) -> Value {
    let voice = voice
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_GATEWAY_TTS_VOICE);
    let mut payload = json!({
        "model": model,
        "input": text,
        "voice": voice,
        "response_format": "wav",
    });
    if let Some(s) = speed {
        payload["speed"] = json!(s);
    }
    payload
}

/// Assemble the outbound request, attaching the per-attribute slot headers only
/// when the operator actually pinned them (see [`gateway_tts_slot_overrides`]).
fn build_gateway_tts_request(
    client: &reqwest::Client,
    url: &str,
    bearer: &str,
    payload: &Value,
    slot_provider: Option<&str>,
    slot_model: Option<&str>,
) -> reqwest::RequestBuilder {
    let mut request = client.post(url).bearer_auth(bearer);
    if let Some(provider) = slot_provider {
        request = request.header("x-ryu-slot-tts-provider", provider);
    }
    if let Some(model) = slot_model {
        request = request.header("x-ryu-slot-tts-model", model);
    }
    request.json(payload)
}

/// The synthetic `gateway` row in the TTS engine list — the one thing that makes
/// the cloud engine selectable from every picker without a client-side list edit.
fn gateway_tts_engine_row() -> Value {
    json!({
        "id": "gateway",
        "display_name": "Cloud (via gateway)",
        "description": "Routed to this node's TTS provider · no local model",
        // OpenAI's voices, because model-based routing resolves `tts-1` to
        // openai when the node has pinned no TTS provider. They are not
        // meaningful if `modality_map[Tts]` points elsewhere; the voice is
        // forwarded as-is and the provider judges it.
        "voices": ["alloy", "echo", "fable", "onyx", "nova", "shimmer"],
        "default_voice": DEFAULT_GATEWAY_TTS_VOICE,
        "sample_rate": 24000,
        "supports_cloning": false,
        "languages": ["en"],
        "size_mb": 0,
        // Deliberate: a cloud engine installs nothing locally. Same reasoning as
        // the STT `gateway` row.
        "installed": true,
        "loaded": false,
    })
}

/// Synthesize one utterance through the Gateway's `/v1/audio/speech` — the
/// swappable cloud TTS slot. Returns the audio bytes and the content type to
/// serve them under. Mirrors `transcribe_via_gateway` (the STT leg) in
/// `crates/core/stt`, with two deliberate differences:
///
/// * The per-attribute slot headers (`x-ryu-slot-tts-*`) are sent **only** when
///   the operator set `RYU_TTS_GATEWAY_PROVIDER` / `RYU_TTS_GATEWAY_MODEL`.
///   The Gateway resolves slot override → `modality_map` → model routing, so
///   always sending them would pin every read-aloud to openai/tts-1 and make
///   the node's configured TTS provider (Settings → Providers, "Serves POST
///   /v1/audio/speech") permanently inert.
/// * The prompt goes under the key `input`, not `text`: the Gateway's inbound
///   firewall scans `body["input"]` for Tts, so `text` would route fine and
///   silently skip the scan.
///
/// Takes a bare `reqwest::Client` rather than the `ServerState` so the realtime
/// voice session (`crate::voice::session`) can reuse it — shipping read-aloud
/// with a cloud voice while voice mode silently stayed local would be exactly
/// the half-landed pattern this repo keeps getting burned by.
pub(crate) async fn synth_via_gateway(
    client: &reqwest::Client,
    voice: Option<&str>,
    speed: Option<f32>,
    text: &str,
) -> Result<(Vec<u8>, String), String> {
    use base64::Engine as _;

    let (slot_provider, slot_model) = gateway_tts_slot_overrides();
    let model = slot_model
        .clone()
        .unwrap_or_else(|| DEFAULT_GATEWAY_TTS_MODEL.to_string());

    let base = crate::sidecar::gateway::gateway_url();
    let base = base.trim_end_matches('/');
    let url = format!("{base}/v1/audio/speech");
    let bearer = crate::sidecar::gateway::gateway_bearer()
        .map_err(|e| format!("no gateway credential for TTS: {e:#}"))?;

    let payload = gateway_tts_payload(&model, voice, speed, text);
    let resp = build_gateway_tts_request(
        client,
        &url,
        &bearer,
        &payload,
        slot_provider.as_deref(),
        slot_model.as_deref(),
    )
    .send()
    .await
    .map_err(|e| format!("gateway TTS unreachable at {url}: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let detail = resp.text().await.unwrap_or_default();
        return Err(format!("gateway TTS returned {status}: {detail}"));
    }

    let value: Value = resp
        .json()
        .await
        .map_err(|e| format!("could not parse gateway TTS response: {e}"))?;

    // Inline bytes (openai and any provider that answers with audio).
    if let Some(b64) = value["data"][0]["b64_json"].as_str() {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64.trim())
            .map_err(|e| format!("gateway TTS audio is not valid base64: {e}"))?;
        let content_type = value["data"][0]["content_type"]
            .as_str()
            .filter(|s| !s.is_empty())
            .unwrap_or("audio/wav")
            .to_string();
        return Ok((bytes, content_type));
    }

    // Hosted URL (fal/replicate are job-based and can only ever return a link).
    // This is a second, un-gatewayed egress from Core, straight to a provider CDN.
    if let Some(link) = value["data"][0]["url"].as_str() {
        let media = client
            .get(link)
            .send()
            .await
            .map_err(|e| format!("gateway TTS audio URL unreachable: {e}"))?;
        if !media.status().is_success() {
            return Err(format!("gateway TTS audio URL returned {}", media.status()));
        }
        let content_type = media
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .filter(|s| !s.is_empty())
            .unwrap_or("audio/mpeg")
            .to_string();
        let bytes = media
            .bytes()
            .await
            .map_err(|e| format!("reading gateway TTS audio failed: {e}"))?;
        return Ok((bytes.to_vec(), content_type));
    }

    Err(format!(
        "gateway TTS response carried no audio (expected data[0].b64_json or data[0].url), got keys: {}",
        value
            .as_object()
            .map(|o| o.keys().cloned().collect::<Vec<_>>().join(", "))
            .unwrap_or_else(|| "<not an object>".to_string())
    ))
}

/// `GET /api/voice/tts-engines` — list available TTS engines for the desktop
/// picker. Always includes the built-in `outetts`, then mirrors the Ryu TTS
/// sidecar's `/engines` catalog when it is reachable (so the set is whatever the
/// sidecar registry serves — nothing hardcoded). When the sidecar is down, only
/// the built-in is returned.
#[utoipa::path(
    get,
    path = "/api/voice/tts-engines",
    tag = "Voice",
    summary = "list available TTS engines for the desktop",
    responses((status = 200, description = "OK", body = serde_json::Value))
)]
pub async fn tts_engines(State(state): State<ServerState>) -> impl IntoResponse {
    let builtin = json!({
        "id": "outetts",
        "display_name": "OuteTTS (built-in)",
        "description": "Local OuteTTS + WavTokenizer on llama.cpp · CPU-friendly",
        "voices": [],
        "default_voice": "",
        "sample_rate": 24000,
        "supports_cloning": false,
        "languages": ["en"],
        "size_mb": 0,
        "installed": true,
        "loaded": false,
    });

    // The cloud slot, listed independently of the sidecar call so it is
    // reachable from every picker (TtsEngineSettings, IslandSettings,
    // NodeSelector) even when no TTS sidecar is running.
    let mut engines = vec![builtin, gateway_tts_engine_row()];
    if let Ok(Value::Array(sidecar_engines)) =
        crate::sidecar::providers::ryutts::list_engines(&state.client).await
    {
        engines.extend(sidecar_engines);
    }
    (
        StatusCode::OK,
        Json(json!({ "object": "list", "data": engines })),
    )
        .into_response()
}

/// `GET /api/voice/tts-models` — the curated, installable TTS model catalog (the
/// voicebox-style known-good set, each model bound to its engine + cache state).
/// Distinct from the raw HF `pipeline_tag=text-to-speech` browse in the Models
/// tab: these are the models Core can actually install + run. Empty when the Ryu
/// TTS sidecar is not running.
#[utoipa::path(
    get,
    path = "/api/voice/tts-models",
    tag = "Voice",
    summary = "the curated, installable TTS model catalog (the",
    responses((status = 200, description = "OK", body = serde_json::Value))
)]
pub async fn tts_models(State(state): State<ServerState>) -> impl IntoResponse {
    let models = match crate::sidecar::providers::ryutts::list_models(&state.client).await {
        Ok(Value::Array(rows)) => rows,
        _ => Vec::new(),
    };
    (
        StatusCode::OK,
        Json(json!({ "object": "list", "data": models })),
    )
        .into_response()
}

/// Request body for installing a curated TTS model.
#[derive(Debug, Deserialize)]
pub struct InstallTtsModelRequest {
    /// Engine id the model belongs to (from `/api/voice/tts-models`).
    pub engine: String,
    /// Curated `model_name` to install.
    pub model_name: String,
}

/// `POST /api/voice/tts-models/install` — download a curated model into the
/// Core-managed HF cache (`HF_HOME` under `~/.ryu`) via the sidecar's
/// `snapshot_download`. The download is registered with the DownloadCenter (a
/// spinner entry, since HF reports no byte total here) so it shows in the global
/// download overlay. Idempotent — a cache hit returns immediately.
#[utoipa::path(
    post,
    path = "/api/voice/tts-models/install",
    tag = "Voice",
    summary = "download a curated model into the",
    request_body = serde_json::Value,
    responses((status = 200, description = "OK", body = serde_json::Value))
)]
pub async fn tts_models_install(
    State(state): State<ServerState>,
    Json(req): Json<InstallTtsModelRequest>,
) -> impl IntoResponse {
    let engine = req.engine.clone();
    let model_name = req.model_name.clone();
    let client = state.client.clone();
    let label = format!("TTS model: {model_name}");

    let result = state
        .downloads
        .register_indeterminate_as(
            format!("tts-model:{engine}:{model_name}"),
            crate::downloads::DownloadKind::Model,
            crate::downloads::DownloadRole::VoiceModel,
            label,
            async move {
                crate::sidecar::providers::ryutts::install_model(&client, &engine, &model_name)
                    .await
            },
        )
        .await;

    match result {
        Ok(body) => (StatusCode::OK, Json(body)).into_response(),
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "error": format!("installing TTS model failed: {e:#}") })),
        )
            .into_response(),
    }
}

/// Transcribe an uploaded audio file. Routes to the in-process parakeet engine
/// (default) or the whisper.cpp voice server (`?engine=whisper`, HTTP proxy).
#[utoipa::path(
    post,
    path = "/api/voice/transcribe",
    tag = "Voice",
    summary = "Transcribe an uploaded audio file",
    request_body = serde_json::Value,
    responses((status = 200, description = "OK", body = serde_json::Value))
)]
pub async fn transcribe(
    State(state): State<ServerState>,
    Query(query): Query<TranscribeQuery>,
    mut multipart: Multipart,
) -> impl IntoResponse {
    // Pull the `file` field (the audio bytes) out of the multipart upload.
    let mut audio: Option<(String, Vec<u8>)> = None;
    while let Ok(Some(field)) = multipart.next_field().await {
        if field.name() == Some("file") {
            let filename = field
                .file_name()
                .map(str::to_string)
                .unwrap_or_else(|| "audio.wav".to_string());
            match field.bytes().await {
                Ok(bytes) => audio = Some((filename, bytes.to_vec())),
                Err(e) => {
                    return (
                        StatusCode::BAD_REQUEST,
                        Json(json!({ "error": format!("could not read audio field: {e}") })),
                    );
                }
            }
        }
    }

    let Some((filename, bytes)) = audio else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "missing `file` field (the audio to transcribe)" })),
        );
    };

    match transcribe_wav_detailed(&state.client, bytes, filename, query.engine.as_deref()).await {
        Ok(t) => (
            StatusCode::OK,
            Json(json!({ "text": t.text, "segments": t.segments })),
        ),
        Err(e) => (StatusCode::BAD_GATEWAY, Json(json!({ "error": e }))),
    }
}

#[cfg(test)]
mod gateway_tts_tests {
    use super::*;

    /// The prompt must ride under `input`. The Gateway's inbound firewall scans
    /// `body["input"]` for Tts, so sending Core's own field name (`text`) would
    /// route correctly and silently skip the scan.
    #[test]
    fn payload_uses_input_not_text() {
        let p = gateway_tts_payload("tts-1", Some("nova"), None, "hello there");
        assert_eq!(p["input"], "hello there");
        assert!(
            p.get("text").is_none(),
            "`text` bypasses the gateway firewall scan: {p}"
        );
        assert_eq!(p["voice"], "nova");
        assert_eq!(p["response_format"], "wav");
        assert_eq!(p["model"], "tts-1");
        assert!(p.get("speed").is_none());
    }

    /// OpenAI's `/v1/audio/speech` 400s without a `voice`, and the stored
    /// preference is `""` for anyone who picked the engine before a voice list
    /// existed. Both "absent" and "empty" must therefore resolve to a real voice.
    #[test]
    fn payload_always_carries_a_voice() {
        for voice in [None, Some(""), Some("   ")] {
            let p = gateway_tts_payload("tts-1", voice, None, "hi");
            assert_eq!(
                p["voice"], DEFAULT_GATEWAY_TTS_VOICE,
                "empty voice must fall back, got {p}"
            );
        }
        let p = gateway_tts_payload("tts-1", Some("shimmer"), Some(1.25), "hi");
        assert_eq!(p["voice"], "shimmer");
        assert_eq!(p["speed"], 1.25);
    }

    /// The default install must NOT pin a provider: the Gateway resolves slot
    /// override → modality_map → model routing, so an unconditional slot header
    /// would silently override the TTS provider the user picked in Settings.
    #[test]
    fn slot_headers_are_sent_only_when_explicitly_pinned() {
        let client = reqwest::Client::new();
        let payload = gateway_tts_payload("tts-1", Some("alloy"), None, "hi");

        let unpinned = build_gateway_tts_request(
            &client,
            "http://127.0.0.1:1/v1/audio/speech",
            "ryu-local",
            &payload,
            None,
            None,
        )
        .build()
        .expect("request builds");
        assert!(
            unpinned.headers().get("x-ryu-slot-tts-provider").is_none(),
            "an unpinned node must let modality_map decide the TTS provider"
        );
        assert!(unpinned.headers().get("x-ryu-slot-tts-model").is_none());
        assert!(unpinned.headers().get("authorization").is_some());

        let pinned = build_gateway_tts_request(
            &client,
            "http://127.0.0.1:1/v1/audio/speech",
            "ryu-local",
            &payload,
            Some("groq"),
            Some("playai-tts"),
        )
        .build()
        .expect("request builds");
        assert_eq!(
            pinned.headers()["x-ryu-slot-tts-provider"],
            "groq",
            "an explicit RYU_TTS_GATEWAY_PROVIDER must still win"
        );
        assert_eq!(pinned.headers()["x-ryu-slot-tts-model"], "playai-tts");
    }

    /// Env-driven pins, asserted in one test because the vars are process-global
    /// and parallel tests would race each other over them.
    #[test]
    fn slot_overrides_read_env_and_ignore_blanks() {
        std::env::remove_var("RYU_TTS_GATEWAY_PROVIDER");
        std::env::remove_var("RYU_TTS_GATEWAY_MODEL");
        assert_eq!(gateway_tts_slot_overrides(), (None, None));

        std::env::set_var("RYU_TTS_GATEWAY_PROVIDER", "   ");
        assert_eq!(
            gateway_tts_slot_overrides().0,
            None,
            "a blank pin must not count as pinned"
        );

        std::env::set_var("RYU_TTS_GATEWAY_PROVIDER", "groq");
        std::env::set_var("RYU_TTS_GATEWAY_MODEL", "playai-tts");
        assert_eq!(
            gateway_tts_slot_overrides(),
            (Some("groq".into()), Some("playai-tts".into()))
        );

        std::env::remove_var("RYU_TTS_GATEWAY_PROVIDER");
        std::env::remove_var("RYU_TTS_GATEWAY_MODEL");
    }

    /// The row is what makes `engine=gateway` selectable at all, and its
    /// `default_voice` is what the desktop stores when the engine is picked
    /// (`handleTtsEngine` writes `next?.default_voice ?? ""`). An empty one ships
    /// a request OpenAI rejects.
    #[test]
    fn engine_row_offers_a_real_default_voice() {
        let row = gateway_tts_engine_row();
        assert_eq!(row["id"], "gateway");
        assert_eq!(row["installed"], true);
        let default_voice = row["default_voice"].as_str().unwrap();
        assert!(!default_voice.is_empty(), "default_voice must not be empty");
        let voices = row["voices"].as_array().unwrap();
        assert!(!voices.is_empty(), "an empty list renders an empty picker");
        assert!(
            voices.iter().any(|v| v == default_voice),
            "the default voice must be one of the offered voices"
        );
    }
}
