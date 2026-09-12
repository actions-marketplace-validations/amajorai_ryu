//! Provider-neutral live-call contracts and the Twilio Media Streams codec.
//!
//! Channel adapters currently support messages and voice notes. A live call is
//! a different transport: it owns a long-lived duplex audio stream, a call
//! identity, interruption, DTMF, and hangup semantics. Keep those concerns out
//! of [`crate::ChannelCaps::voice`], whose meaning remains "send a voice note or
//! audio attachment".
//!
//! This module deliberately stops at the transport boundary. It does not open
//! a public listener, store provider credentials, or claim that a provider is
//! enabled. Gateway wiring can bridge these normalized PCM16 events to the
//! existing Core voice session once provider onboarding and authorization are
//! configured.

use std::collections::BTreeMap;

use anyhow::{bail, Result};
use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};

/// The normalized audio rate expected by the Core voice session.
pub const CORE_VOICE_SAMPLE_RATE: u32 = 16_000;
/// Twilio Media Streams' fixed G.711 μ-law input/output rate.
pub const TWILIO_MULAW_SAMPLE_RATE: u32 = 8_000;
/// A 20 ms μ-law packet at 8 kHz, useful for pacing outbound audio.
pub const TWILIO_MULAW_FRAME_BYTES: usize = 160;

/// Product surfaces that could expose a live call.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VoiceCallSurface {
    Pstn,
    TelegramNativeBot,
    TelegramMiniApp,
    WhatsAppBusiness,
    WhatsAppPersonal,
    DiscordGuild,
    DiscordDirectMessage,
}

/// Current product-level status, kept explicit so a UI cannot infer support
/// from the fact that a text channel exists.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VoiceCallSupport {
    /// A provider adapter and end-to-end product flow still need to be wired.
    Planned,
    /// The platform can support calls, but account approval/configuration or a
    /// platform-specific prerequisite is required.
    Conditional,
    /// The selected bot/channel surface does not expose a supported call API.
    Unsupported,
}

/// Human-readable capability projection for settings and diagnostics.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct VoiceCallCapability {
    pub surface: VoiceCallSurface,
    pub support: VoiceCallSupport,
    pub reason: &'static str,
}

/// Return the honest current status for each requested call surface.
pub const fn voice_call_capability(surface: VoiceCallSurface) -> VoiceCallCapability {
    match surface {
        VoiceCallSurface::Pstn => VoiceCallCapability {
            surface,
            support: VoiceCallSupport::Planned,
            reason: "requires a configured telephony provider or SIP/BYOC trunk",
        },
        VoiceCallSurface::TelegramNativeBot => VoiceCallCapability {
            surface,
            support: VoiceCallSupport::Unsupported,
            reason: "Telegram's native group-call methods are not a Bot API surface",
        },
        VoiceCallSurface::TelegramMiniApp => VoiceCallCapability {
            surface,
            support: VoiceCallSupport::Planned,
            reason: "a Telegram Mini App can open Ryu Voice without impersonating a user account",
        },
        VoiceCallSurface::WhatsAppBusiness => VoiceCallCapability {
            surface,
            support: VoiceCallSupport::Conditional,
            reason: "requires an eligible WhatsApp Business Calling API number",
        },
        VoiceCallSurface::WhatsAppPersonal => VoiceCallCapability {
            surface,
            support: VoiceCallSupport::Unsupported,
            reason: "the Personal/OpenWA bridge is not a safe native-call transport",
        },
        VoiceCallSurface::DiscordGuild => VoiceCallCapability {
            surface,
            support: VoiceCallSupport::Conditional,
            reason:
                "requires a guild voice connection and current Discord voice encryption support",
        },
        VoiceCallSurface::DiscordDirectMessage => VoiceCallCapability {
            surface,
            support: VoiceCallSupport::Unsupported,
            reason: "Discord bots do not have a supported DM-call surface",
        },
    }
}

/// A call accepted by a provider transport and bound to one Ryu conversation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VoiceCallOffer {
    pub surface: VoiceCallSurface,
    pub call_id: String,
    pub stream_id: String,
    pub remote_identity: Option<String>,
    pub conversation_id: String,
    pub agent_id: Option<String>,
}

/// Events normalized by a provider transport before entering the Core voice
/// session. Audio is always signed PCM16; the provider codec stays at the edge.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VoiceCallEvent {
    Audio { sample_rate: u32, samples: Vec<i16> },
    Dtmf { digit: char },
    Hangup { reason: Option<String> },
}

/// Commands emitted by the Core bridge toward a provider transport.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VoiceCallCommand {
    Audio { sample_rate: u32, samples: Vec<i16> },
    ClearAudio,
    Hangup,
}

/// Long-lived provider connection contract. The first implementation can wrap
/// this around a Twilio WebSocket; WhatsApp Calling and Discord voice can reuse
/// the same Core-facing event vocabulary later.
#[async_trait]
pub trait VoiceCallConnection: Send {
    async fn next_event(&mut self) -> Result<Option<VoiceCallEvent>>;
    async fn send_command(&mut self, command: VoiceCallCommand) -> Result<()>;
}

/// Provider adapter boundary. Authorization, call admission, and credential
/// custody remain owned by the Gateway wiring around this trait.
#[async_trait]
pub trait VoiceCallTransport: Send + Sync {
    fn surface(&self) -> VoiceCallSurface;
    async fn accept(&self, offer: VoiceCallOffer) -> Result<Box<dyn VoiceCallConnection>>;
}

/// Twilio's inbound Media Streams wire messages.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(tag = "event")]
pub enum TwilioMediaEvent {
    #[serde(rename = "connected")]
    Connected { protocol: String, version: String },
    #[serde(rename = "start")]
    Start {
        #[serde(rename = "sequenceNumber")]
        sequence_number: String,
        #[serde(rename = "streamSid")]
        stream_sid: String,
        start: TwilioStart,
    },
    #[serde(rename = "media")]
    Media {
        #[serde(rename = "sequenceNumber")]
        sequence_number: String,
        #[serde(rename = "streamSid")]
        stream_sid: String,
        media: TwilioMedia,
    },
    #[serde(rename = "dtmf")]
    Dtmf {
        #[serde(rename = "sequenceNumber")]
        sequence_number: String,
        #[serde(rename = "streamSid")]
        stream_sid: String,
        dtmf: TwilioDtmf,
    },
    #[serde(rename = "stop")]
    Stop {
        #[serde(rename = "sequenceNumber")]
        sequence_number: String,
        #[serde(rename = "streamSid")]
        stream_sid: String,
        stop: TwilioStop,
    },
    #[serde(rename = "mark")]
    Mark {
        #[serde(rename = "sequenceNumber")]
        sequence_number: String,
        #[serde(rename = "streamSid")]
        stream_sid: String,
        mark: TwilioMark,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TwilioStart {
    pub account_sid: String,
    pub stream_sid: String,
    pub call_sid: String,
    pub tracks: Vec<String>,
    pub media_format: TwilioMediaFormat,
    #[serde(default)]
    pub custom_parameters: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TwilioMediaFormat {
    pub encoding: String,
    pub sample_rate: u32,
    pub channels: u8,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct TwilioMedia {
    pub track: String,
    pub chunk: String,
    pub timestamp: String,
    pub payload: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct TwilioDtmf {
    pub track: String,
    pub digit: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct TwilioStop {
    #[serde(rename = "accountSid")]
    pub account_sid: String,
    #[serde(rename = "callSid")]
    pub call_sid: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct TwilioMark {
    pub name: String,
}

/// Parse one provider frame without silently accepting malformed JSON.
pub fn parse_twilio_event(raw: &str) -> Result<TwilioMediaEvent> {
    Ok(serde_json::from_str(raw)?)
}

/// Validate that the stream carries the mono μ-law format required by the
/// adapter and includes inbound caller audio.
pub fn validate_twilio_start(start: &TwilioStart) -> Result<()> {
    if start.media_format.encoding != "audio/x-mulaw" {
        bail!(
            "unsupported Twilio audio encoding {}; expected audio/x-mulaw",
            start.media_format.encoding
        );
    }
    if start.media_format.sample_rate != TWILIO_MULAW_SAMPLE_RATE {
        bail!(
            "unsupported Twilio sample rate {}; expected {}",
            start.media_format.sample_rate,
            TWILIO_MULAW_SAMPLE_RATE
        );
    }
    if start.media_format.channels != 1 {
        bail!(
            "unsupported Twilio channel count {}; expected mono",
            start.media_format.channels
        );
    }
    if !start.tracks.iter().any(|track| track == "inbound") {
        bail!("Twilio stream does not include an inbound audio track");
    }
    Ok(())
}

/// Decode an inbound Twilio base64 μ-law payload into signed PCM16 samples.
pub fn decode_twilio_audio(payload: &str) -> Result<Vec<i16>> {
    let bytes = BASE64.decode(payload)?;
    Ok(bytes.into_iter().map(decode_mulaw_sample).collect())
}

/// Encode signed PCM16 samples as a base64 μ-law payload for Twilio.
pub fn encode_twilio_audio(samples: &[i16]) -> String {
    BASE64.encode(mulaw_bytes(samples))
}

/// Build a bidirectional-stream media frame. The payload is raw μ-law, never a
/// WAV header; Twilio buffers and plays frames in receive order.
pub fn twilio_media_message(stream_sid: &str, samples: &[i16]) -> String {
    twilio_media_payload_message(stream_sid, &mulaw_bytes(samples))
}

/// Build a media frame from already encoded raw μ-law bytes.
pub fn twilio_media_payload_message(stream_sid: &str, payload: &[u8]) -> String {
    serde_json::json!({
        "event": "media",
        "streamSid": stream_sid,
        "media": { "payload": BASE64.encode(payload) },
    })
    .to_string()
}

/// Clear audio buffered on the provider when Core detects barge-in.
pub fn twilio_clear_message(stream_sid: &str) -> String {
    serde_json::json!({ "event": "clear", "streamSid": stream_sid }).to_string()
}

/// Parse a mono PCM16 WAV and return its sample rate plus samples.
pub fn pcm16_wav(wav: &[u8]) -> Result<(u32, Vec<i16>)> {
    if wav.len() < 12 || &wav[0..4] != b"RIFF" || &wav[8..12] != b"WAVE" {
        bail!("audio is not a RIFF/WAVE file");
    }

    let mut offset = 12usize;
    let mut sample_rate = None;
    let mut data = None;
    while offset + 8 <= wav.len() {
        let id = &wav[offset..offset + 4];
        let size = u32::from_le_bytes(wav[offset + 4..offset + 8].try_into()?) as usize;
        let start = offset + 8;
        let end = start
            .checked_add(size)
            .ok_or_else(|| anyhow::anyhow!("WAV chunk length overflow"))?;
        if end > wav.len() {
            bail!("WAV chunk extends beyond the payload");
        }

        match id {
            b"fmt " if size >= 16 => {
                let audio_format = u16::from_le_bytes(wav[start..start + 2].try_into()?);
                let channels = u16::from_le_bytes(wav[start + 2..start + 4].try_into()?);
                let rate = u32::from_le_bytes(wav[start + 4..start + 8].try_into()?);
                let bits = u16::from_le_bytes(wav[start + 14..start + 16].try_into()?);
                if audio_format != 1 || channels != 1 || bits != 16 {
                    bail!("WAV must be mono PCM16");
                }
                sample_rate = Some(rate);
            }
            b"data" => data = Some(&wav[start..end]),
            _ => {}
        }
        offset = end + (size & 1);
    }

    let rate = sample_rate.ok_or_else(|| anyhow::anyhow!("WAV has no PCM format chunk"))?;
    let data = data.ok_or_else(|| anyhow::anyhow!("WAV has no data chunk"))?;
    if data.len() % 2 != 0 {
        bail!("WAV PCM16 data has an odd byte count");
    }
    let samples = data
        .chunks_exact(2)
        .map(|pair| i16::from_le_bytes([pair[0], pair[1]]))
        .collect();
    Ok((rate, samples))
}

/// Resample signed mono PCM16 with linear interpolation.
pub fn resample_pcm16(samples: &[i16], input_rate: u32, output_rate: u32) -> Vec<i16> {
    if samples.is_empty() || input_rate == 0 || output_rate == 0 {
        return Vec::new();
    }
    if input_rate == output_rate {
        return samples.to_vec();
    }

    let output_len = ((samples.len() as u64 * u64::from(output_rate)) + u64::from(input_rate) - 1)
        / u64::from(input_rate);
    let output_len = output_len as usize;
    let mut output = Vec::with_capacity(output_len);
    for index in 0..output_len {
        let position = index as u64 * u64::from(input_rate);
        let left = (position / u64::from(output_rate)) as usize;
        if left + 1 >= samples.len() {
            output.push(*samples.last().unwrap_or(&0));
            continue;
        }
        let remainder = position % u64::from(output_rate);
        let denominator = i64::from(output_rate);
        let a = i64::from(samples[left]);
        let b = i64::from(samples[left + 1]);
        let interpolated =
            (a * (denominator - remainder as i64) + b * remainder as i64) / denominator;
        output.push(interpolated.clamp(i64::from(i16::MIN), i64::from(i16::MAX)) as i16);
    }
    output
}

/// Convert Core's mono PCM16 WAV output into Twilio's raw μ-law payload.
pub fn wav_to_twilio_audio(wav: &[u8]) -> Result<String> {
    let (sample_rate, samples) = pcm16_wav(wav)?;
    let samples = resample_pcm16(&samples, sample_rate, TWILIO_MULAW_SAMPLE_RATE);
    Ok(encode_twilio_audio(&samples))
}

const MULAW_BIAS: i32 = 0x84;
const MULAW_CLIP: i32 = 32_635;

fn mulaw_bytes(samples: &[i16]) -> Vec<u8> {
    samples.iter().copied().map(encode_mulaw_sample).collect()
}

fn encode_mulaw_sample(sample: i16) -> u8 {
    let sign = if sample < 0 { 0x80 } else { 0 };
    let magnitude = (i32::from(sample).abs().min(MULAW_CLIP)) + MULAW_BIAS;
    let exponent = (31 - magnitude.leading_zeros()).saturating_sub(7).min(7) as i32;
    let mantissa = (magnitude >> (exponent + 3)) & 0x0f;
    !(sign | (exponent << 4) | mantissa) as u8
}

fn decode_mulaw_sample(encoded: u8) -> i16 {
    let value = i32::from(!encoded);
    let sign = value & 0x80;
    let exponent = (value >> 4) & 0x07;
    let mantissa = value & 0x0f;
    let magnitude = ((mantissa << 3) + MULAW_BIAS) << exponent;
    let sample = magnitude - MULAW_BIAS;
    if sign != 0 {
        (-sample).clamp(i32::from(i16::MIN), i32::from(i16::MAX)) as i16
    } else {
        sample.clamp(i32::from(i16::MIN), i32::from(i16::MAX)) as i16
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capability_matrix_does_not_conflate_voice_notes_with_calls() {
        assert_eq!(
            voice_call_capability(VoiceCallSurface::TelegramNativeBot).support,
            VoiceCallSupport::Unsupported
        );
        assert_eq!(
            voice_call_capability(VoiceCallSurface::WhatsAppBusiness).support,
            VoiceCallSupport::Conditional
        );
        assert_eq!(
            voice_call_capability(VoiceCallSurface::DiscordGuild).support,
            VoiceCallSupport::Conditional
        );
        assert_eq!(
            voice_call_capability(VoiceCallSurface::DiscordDirectMessage).support,
            VoiceCallSupport::Unsupported
        );
    }

    #[test]
    fn parses_and_validates_twilio_start() {
        let raw = r#"{
            "event":"start",
            "sequenceNumber":"1",
            "streamSid":"MZ1",
            "start":{
                "accountSid":"AC1",
                "streamSid":"MZ1",
                "callSid":"CA1",
                "tracks":["inbound"],
                "mediaFormat":{"encoding":"audio/x-mulaw","sampleRate":8000,"channels":1},
                "customParameters":{"agentId":"agent_1"}
            }
        }"#;
        let TwilioMediaEvent::Start { start, .. } = parse_twilio_event(raw).unwrap() else {
            panic!("expected start event");
        };
        validate_twilio_start(&start).unwrap();
        assert_eq!(start.custom_parameters["agentId"], "agent_1");
    }

    #[test]
    fn rejects_non_mulaw_twilio_streams() {
        let start = TwilioStart {
            account_sid: "AC1".into(),
            stream_sid: "MZ1".into(),
            call_sid: "CA1".into(),
            tracks: vec!["inbound".into()],
            media_format: TwilioMediaFormat {
                encoding: "audio/pcm".into(),
                sample_rate: 16_000,
                channels: 1,
            },
            custom_parameters: BTreeMap::new(),
        };
        assert!(validate_twilio_start(&start).is_err());
    }

    #[test]
    fn mulaw_silence_and_sign_roundtrip() {
        assert_eq!(
            decode_twilio_audio(&BASE64.encode([0xff])).unwrap(),
            vec![0]
        );
        let samples = [-30_000_i16, -1, 0, 1, 30_000];
        let encoded = encode_twilio_audio(&samples);
        let decoded = decode_twilio_audio(&encoded).unwrap();
        assert_eq!(decoded.len(), samples.len());
        for (original, roundtrip) in samples.into_iter().zip(decoded) {
            assert!((i32::from(original) - i32::from(roundtrip)).abs() < 2_500);
        }
    }

    #[test]
    fn outbound_media_has_no_wav_header() {
        let raw = twilio_media_message("MZ1", &[0, 1, -1]);
        let value: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(value["event"], "media");
        assert_eq!(value["streamSid"], "MZ1");
        let payload = value["media"]["payload"].as_str().unwrap();
        let bytes = BASE64.decode(payload).unwrap();
        assert_eq!(bytes.len(), 3);
        assert_ne!(&bytes[..], b"RIFF");
        assert_eq!(
            twilio_clear_message("MZ1"),
            r#"{"event":"clear","streamSid":"MZ1"}"#
        );
    }

    #[test]
    fn resamples_and_parses_pcm16_wav() {
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(40_u32).to_le_bytes());
        wav.extend_from_slice(b"WAVE");
        wav.extend_from_slice(b"fmt ");
        wav.extend_from_slice(&(16_u32).to_le_bytes());
        wav.extend_from_slice(&(1_u16).to_le_bytes());
        wav.extend_from_slice(&(1_u16).to_le_bytes());
        wav.extend_from_slice(&(24_000_u32).to_le_bytes());
        wav.extend_from_slice(&(48_000_u32).to_le_bytes());
        wav.extend_from_slice(&(2_u16).to_le_bytes());
        wav.extend_from_slice(&(16_u16).to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&(4_u32).to_le_bytes());
        wav.extend_from_slice(&100_i16.to_le_bytes());
        wav.extend_from_slice(&200_i16.to_le_bytes());
        let (rate, samples) = pcm16_wav(&wav).unwrap();
        assert_eq!(rate, 24_000);
        assert_eq!(samples, vec![100, 200]);
        assert_eq!(resample_pcm16(&samples, rate, 8_000), vec![100]);
        let payload = wav_to_twilio_audio(&wav).unwrap();
        assert_eq!(BASE64.decode(payload).unwrap().len(), 1);
    }
}
