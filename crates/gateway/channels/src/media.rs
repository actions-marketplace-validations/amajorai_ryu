//! Attachments, and the voice round trip through Core's existing STT/TTS.
//!
//! Channels were text-only in both directions: a voice note arrived as an
//! `InboundMessage` with empty text and was dropped, and a reply was always a
//! string. Ryu already owns both halves of the fix — `POST /api/voice/transcribe`
//! (multipart `file`, returns `{text, segments}`) and `POST /api/voice/speak`
//! (JSON `{text}`, returns `audio/wav`) — so this module is glue, not new
//! capability: download what the platform gave us, transcribe it, and optionally
//! synthesize the reply back.
//!
//! ## Why the outbound audio format matters
//!
//! Core's TTS returns **WAV**, and the messaging platforms disagree about what a
//! "voice message" may contain:
//!
//! - Telegram `sendVoice` accepts only OGG/OPUS, MP3 or M4A — *not* WAV. WAV must
//!   go through `sendAudio` (a music-style attachment) instead.
//! - WhatsApp Cloud API audio accepts ogg/opus, mpeg, mp4, amr, aac — again not WAV.
//! - Discord and BlueBubbles accept an arbitrary file.
//!
//! Rather than pull in an encoder, [`VoiceReply::delivery`] states per platform
//! what is actually possible, and an adapter that cannot deliver a true voice note
//! falls back to the text reply. Degrading honestly beats shipping a voice feature
//! that silently produces an unplayable file.

use std::time::Duration;

use serde::Deserialize;
use tracing::debug;

/// Cap on a downloaded inbound attachment. A channel is an untrusted ingress:
/// without a ceiling a 2 GB "voice note" is a trivial memory-exhaustion vector.
pub const MAX_ATTACHMENT_BYTES: usize = 25 * 1024 * 1024;

/// Timeout for a media download or a transcription round trip. Transcription of a
/// long voice note is genuinely slow, so this is far looser than a control call.
const MEDIA_TIMEOUT: Duration = Duration::from_secs(120);

/// What kind of media the user sent. Drives both the ingest decision (transcribe a
/// voice note, describe an image) and how the turn text is annotated.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttachmentKind {
    /// A voice note / push-to-talk recording. Transcribed to text.
    Voice,
    /// A music or audio file. Also transcribed — the user usually wants it read.
    Audio,
    Image,
    Video,
    Document,
}

impl AttachmentKind {
    /// Should this attachment be run through speech-to-text?
    pub fn is_speech(self) -> bool {
        matches!(self, Self::Voice | Self::Audio)
    }

    /// Human label used when annotating the turn text with what was attached.
    pub fn label(self) -> &'static str {
        match self {
            Self::Voice => "voice message",
            Self::Audio => "audio file",
            Self::Image => "image",
            Self::Video => "video",
            Self::Document => "file",
        }
    }
}

/// One piece of media on an inbound message, normalised across platforms.
///
/// Platforms hand over media two different ways: a directly-fetchable URL
/// (Discord, BlueBubbles) or an opaque id that must first be exchanged for a URL
/// (Telegram's `file_id`, WhatsApp's media id). Both are carried; the adapter
/// resolves `file_id` before calling [`download`].
#[derive(Debug, Clone, Default)]
pub struct Attachment {
    pub kind: Option<AttachmentKind>,
    /// Directly fetchable URL, when the platform provides one.
    pub url: Option<String>,
    /// Platform-specific media id needing a resolve step first.
    pub file_id: Option<String>,
    pub mime: Option<String>,
    pub filename: Option<String>,
    /// Size the platform declared, when known. Lets an adapter reject an oversized
    /// attachment before spending the bandwidth on it.
    pub size: Option<u64>,
}

impl Attachment {
    /// Best-effort kind, falling back to the MIME type when the platform did not
    /// label the attachment.
    pub fn resolved_kind(&self) -> AttachmentKind {
        if let Some(kind) = self.kind {
            return kind;
        }
        match self.mime.as_deref().unwrap_or("") {
            m if m.starts_with("audio/") => AttachmentKind::Audio,
            m if m.starts_with("image/") => AttachmentKind::Image,
            m if m.starts_with("video/") => AttachmentKind::Video,
            _ => AttachmentKind::Document,
        }
    }

    /// Filename to present to Core, defaulting to something with a usable
    /// extension so the transcriber can sniff the container.
    pub fn safe_filename(&self) -> String {
        if let Some(name) = self.filename.as_deref() {
            let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
            if !base.is_empty() && base != "." && base != ".." {
                return base.to_string();
            }
        }
        match self.mime.as_deref() {
            Some("audio/ogg") => "audio.ogg".to_string(),
            Some("audio/mpeg") => "audio.mp3".to_string(),
            Some("audio/mp4") | Some("audio/m4a") => "audio.m4a".to_string(),
            Some("image/png") => "image.png".to_string(),
            Some("image/jpeg") => "image.jpg".to_string(),
            _ => "attachment.bin".to_string(),
        }
    }
}

/// Download an attachment's bytes, refusing anything over [`MAX_ATTACHMENT_BYTES`].
///
/// `extra_headers` carries platform auth (Discord needs none on its CDN, WhatsApp
/// needs a bearer token on the resolved media URL).
///
/// # Errors
/// Returns `Err` when the URL is missing, the fetch fails, or the payload exceeds
/// the size cap.
pub async fn download(
    http: &reqwest::Client,
    url: &str,
    extra_headers: &[(&str, &str)],
) -> anyhow::Result<Vec<u8>> {
    let mut req = http.get(url).timeout(MEDIA_TIMEOUT);
    for (name, value) in extra_headers {
        req = req.header(*name, *value);
    }
    let resp = req.send().await?.error_for_status()?;

    // Trust the declared length when present so an oversized body is refused
    // before it is buffered.
    if let Some(len) = resp.content_length() {
        if len as usize > MAX_ATTACHMENT_BYTES {
            anyhow::bail!("attachment is {len} bytes, over the {MAX_ATTACHMENT_BYTES} cap");
        }
    }
    let bytes = resp.bytes().await?;
    if bytes.len() > MAX_ATTACHMENT_BYTES {
        anyhow::bail!(
            "attachment is {} bytes, over the {MAX_ATTACHMENT_BYTES} cap",
            bytes.len()
        );
    }
    Ok(bytes.to_vec())
}

/// Core's `/api/voice/transcribe` response.
#[derive(Debug, Deserialize)]
struct TranscribeResponse {
    #[serde(default)]
    text: String,
}

/// Transcribe audio via Core's STT endpoint.
///
/// # Errors
/// Returns `Err` on transport failure or a non-2xx from Core (e.g. the Voice app
/// is disabled, which gates the `/api/voice/*` router).
pub async fn transcribe(
    http: &reqwest::Client,
    core_url: &str,
    audio: Vec<u8>,
    filename: &str,
) -> anyhow::Result<String> {
    let url = format!("{}/api/voice/transcribe", core_url.trim_end_matches('/'));
    let part = reqwest::multipart::Part::bytes(audio).file_name(filename.to_string());
    let form = reqwest::multipart::Form::new().part("file", part);

    let resp = http
        .post(&url)
        .multipart(form)
        .timeout(MEDIA_TIMEOUT)
        .send()
        .await?
        .error_for_status()?;
    let parsed: TranscribeResponse = resp.json().await?;
    debug!(chars = parsed.text.len(), "transcribed inbound audio");
    Ok(parsed.text)
}

/// Synthesize a spoken reply via Core's TTS endpoint, returning WAV bytes.
///
/// # Errors
/// Returns `Err` on transport failure or a non-2xx from Core.
pub async fn speak(http: &reqwest::Client, core_url: &str, text: &str) -> anyhow::Result<Vec<u8>> {
    let url = format!("{}/api/voice/speak", core_url.trim_end_matches('/'));
    let resp = http
        .post(&url)
        .json(&serde_json::json!({ "text": text }))
        .timeout(MEDIA_TIMEOUT)
        .send()
        .await?
        .error_for_status()?;
    Ok(resp.bytes().await?.to_vec())
}

/// How a platform can deliver Core's WAV output.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VoiceDelivery {
    /// Send as a true voice note (waveform bubble).
    VoiceNote,
    /// Send as an audio file attachment — playable, but not a voice bubble. Used
    /// where the platform's voice-note endpoint rejects WAV.
    AudioFile,
    /// The platform cannot carry this audio; send the text reply instead.
    Unsupported,
}

/// When the bot should answer with speech as well as text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum VoiceReplyMode {
    /// Never synthesize. The default — TTS costs time and most chats want text.
    #[default]
    Never,
    /// Speak only when the user's own message was a voice note. The natural
    /// behaviour: talk back to someone who talked.
    Mirror,
    /// Speak every reply.
    Always,
}

impl VoiceReplyMode {
    /// Should this turn get a spoken reply, given whether the inbound was speech?
    pub fn should_speak(self, inbound_was_voice: bool) -> bool {
        match self {
            Self::Never => false,
            Self::Mirror => inbound_was_voice,
            Self::Always => true,
        }
    }
}

/// How a given platform can deliver a WAV produced by Core's TTS.
///
/// Encoded as a function rather than a per-adapter constant so the WAV constraint
/// is stated once, in the place that documents it.
pub fn wav_delivery(platform: &str) -> VoiceDelivery {
    match platform {
        // Telegram sendVoice rejects WAV; sendAudio takes it.
        "telegram" => VoiceDelivery::AudioFile,
        // Discord attaches arbitrary files.
        "discord" => VoiceDelivery::AudioFile,
        // BlueBubbles/iMessage attaches arbitrary files.
        "bluebubbles" => VoiceDelivery::AudioFile,
        // Slack file upload takes any type.
        "slack" => VoiceDelivery::AudioFile,
        // WhatsApp Cloud API audio does not accept audio/wav at all.
        "whatsapp" => VoiceDelivery::Unsupported,
        // OpenWA can convert Core's WAV through its optional ffmpeg endpoint and
        // then send a real OGG/Opus voice note.
        "whatsapp_personal" => VoiceDelivery::VoiceNote,
        _ => VoiceDelivery::Unsupported,
    }
}

/// Annotate turn text with what the user attached, so the agent knows a picture
/// or a document arrived even when only its filename can be conveyed.
///
/// A transcribed voice note contributes its transcript as the text itself; other
/// media contribute a bracketed note. Pure, so the phrasing is testable.
pub fn annotate(text: &str, attachments: &[Attachment]) -> String {
    let notes: Vec<String> = attachments
        .iter()
        .filter(|a| !a.resolved_kind().is_speech())
        .map(|a| {
            let kind = a.resolved_kind().label();
            match a.filename.as_deref() {
                Some(name) if !name.is_empty() => format!("[attached {kind}: {name}]"),
                _ => format!("[attached {kind}]"),
            }
        })
        .collect();
    if notes.is_empty() {
        return text.to_string();
    }
    let joined = notes.join(" ");
    if text.trim().is_empty() {
        joined
    } else {
        format!("{text}\n\n{joined}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn att(kind: AttachmentKind, filename: Option<&str>) -> Attachment {
        Attachment {
            kind: Some(kind),
            filename: filename.map(str::to_string),
            ..Default::default()
        }
    }

    #[test]
    fn kind_falls_back_to_mime() {
        let a = Attachment {
            mime: Some("image/png".into()),
            ..Default::default()
        };
        assert_eq!(a.resolved_kind(), AttachmentKind::Image);

        let unknown = Attachment {
            mime: Some("application/x-thing".into()),
            ..Default::default()
        };
        assert_eq!(unknown.resolved_kind(), AttachmentKind::Document);
    }

    #[test]
    fn safe_filename_strips_path_traversal() {
        let a = Attachment {
            filename: Some("../../etc/passwd".into()),
            ..Default::default()
        };
        assert_eq!(a.safe_filename(), "passwd");

        let dotted = Attachment {
            filename: Some("..".into()),
            mime: Some("audio/ogg".into()),
            ..Default::default()
        };
        assert_eq!(dotted.safe_filename(), "audio.ogg");
    }

    #[test]
    fn speech_kinds_are_transcribed() {
        assert!(AttachmentKind::Voice.is_speech());
        assert!(AttachmentKind::Audio.is_speech());
        assert!(!AttachmentKind::Image.is_speech());
    }

    #[test]
    fn annotate_notes_non_speech_media_only() {
        // A transcript IS the text, so a voice note adds no bracketed note.
        assert_eq!(
            annotate("hello", &[att(AttachmentKind::Voice, None)]),
            "hello"
        );
        assert_eq!(
            annotate("look", &[att(AttachmentKind::Image, Some("cat.png"))]),
            "look\n\n[attached image: cat.png]"
        );
        // An image with no caption becomes the whole prompt.
        assert_eq!(
            annotate("", &[att(AttachmentKind::Image, None)]),
            "[attached image]"
        );
    }

    #[test]
    fn voice_reply_mode_mirrors_the_user() {
        assert!(!VoiceReplyMode::Never.should_speak(true));
        assert!(VoiceReplyMode::Mirror.should_speak(true));
        assert!(!VoiceReplyMode::Mirror.should_speak(false));
        assert!(VoiceReplyMode::Always.should_speak(false));
    }

    #[test]
    fn wav_delivery_reflects_platform_limits() {
        // Telegram voice notes reject WAV, so it must degrade to an audio file.
        assert_eq!(wav_delivery("telegram"), VoiceDelivery::AudioFile);
        // WhatsApp cannot carry WAV in any audio form.
        assert_eq!(wav_delivery("whatsapp"), VoiceDelivery::Unsupported);
        assert_eq!(wav_delivery("whatsapp_personal"), VoiceDelivery::VoiceNote);
        assert_eq!(wav_delivery("unknown-platform"), VoiceDelivery::Unsupported);
    }
}
