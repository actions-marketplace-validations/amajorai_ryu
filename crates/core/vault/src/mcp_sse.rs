//! Shared bounded incremental SSE parser, extracted from Core's MCP client.
use anyhow::{anyhow, Result};
/// Split an SSE body into its `data:` payloads, in order. Pure.
///
/// Per the SSE grammar: `data:` lines accumulate (joined with `\n`) into one
/// event, and a blank line dispatches it. Every other field (`event:`, `id:`,
/// `retry:`, `:` comments) is ignored — an MCP frame is always the `data`
/// payload, and MCP's own message id lives *inside* that JSON, not in the SSE
/// `id:` field. A trailing event with no closing blank line is still emitted,
/// because a server that closes the stream right after its last frame is common
/// and dropping that frame would hang the caller until the RPC deadline.
pub fn data_frames(body: &str) -> Vec<String> {
    let mut frames = Vec::new();
    let mut current = String::new();
    for line in body.lines() {
        if let Some(rest) = line.strip_prefix("data:") {
            if !current.is_empty() {
                current.push('\n');
            }
            current.push_str(rest.strip_prefix(' ').unwrap_or(rest));
        } else if line.trim().is_empty() && !current.is_empty() {
            frames.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        frames.push(current);
    }
    frames
}
const MAX_MCP_HTTP_BODY_BYTES: u64 = 8 * 1024 * 1024;
/// One parsed SSE event. Legacy MCP uses an `endpoint` event during connection
/// setup and ordinary message events for JSON-RPC frames afterwards.
#[derive(Debug, PartialEq, Eq)]
pub struct SseEvent {
    pub event: Option<String>,
    pub data: String,
}

/// Incremental SSE reader for a response body that may remain open for the
/// lifetime of a legacy MCP session. Keeping this parser separate from the
/// buffered Streamable HTTP parser is important: a legacy POST usually returns
/// `202 Accepted` while its result arrives later on this GET stream.
pub struct SseReader {
    max_body_bytes: usize,
    response: reqwest::Response,
    line_buffer: Vec<u8>,
    event_name: Option<String>,
    data_lines: Vec<String>,
    event_bytes: usize,
    stream_ended: bool,
}

impl SseReader {
    pub fn new(response: reqwest::Response) -> Self {
        Self::with_limit(response, MAX_MCP_HTTP_BODY_BYTES as usize)
    }

    pub fn with_limit(response: reqwest::Response, max_body_bytes: usize) -> Self {
        Self {
            max_body_bytes,
            response,
            line_buffer: Vec::new(),
            event_name: None,
            data_lines: Vec::new(),
            event_bytes: 0,
            stream_ended: false,
        }
    }

    fn take_line(&mut self) -> Option<Vec<u8>> {
        let newline = self.line_buffer.iter().position(|byte| *byte == b'\n')?;
        Some(self.line_buffer.drain(..=newline).collect())
    }

    fn flush_event(&mut self) -> Option<SseEvent> {
        if self.data_lines.is_empty() {
            self.event_name = None;
            self.event_bytes = 0;
            return None;
        }
        let data = self.data_lines.drain(..).collect::<Vec<_>>().join("\n");
        self.event_bytes = 0;
        Some(SseEvent {
            event: self.event_name.take(),
            data,
        })
    }

    fn process_line(&mut self, raw_line: &[u8]) -> Result<Option<SseEvent>> {
        let line = String::from_utf8_lossy(raw_line)
            .trim_end_matches(['\n', '\r'])
            .to_owned();
        if line.is_empty() {
            return Ok(self.flush_event());
        }
        if line.starts_with(':') {
            return Ok(None);
        }
        if let Some(value) = line.strip_prefix("event:") {
            self.event_name = Some(value.strip_prefix(' ').unwrap_or(value).to_owned());
        } else if let Some(value) = line.strip_prefix("data:") {
            let event_bytes = self
                .event_bytes
                .checked_add(line.len())
                .ok_or_else(|| anyhow!("legacy MCP SSE event exceeded its byte cap"))?;
            if event_bytes > self.max_body_bytes {
                return Err(anyhow!("legacy MCP SSE event exceeded its byte cap"));
            }
            self.event_bytes = event_bytes;
            self.data_lines
                .push(value.strip_prefix(' ').unwrap_or(value).to_owned());
        }
        Ok(None)
    }

    pub async fn next_event(&mut self) -> Result<Option<SseEvent>> {
        loop {
            if let Some(line) = self.take_line() {
                if let Some(event) = self.process_line(&line)? {
                    return Ok(Some(event));
                }
                continue;
            }

            if self.stream_ended {
                return Ok(self.flush_event());
            }

            match self.response.chunk().await? {
                Some(chunk) => {
                    if self.line_buffer.len() + chunk.len() > self.max_body_bytes {
                        return Err(anyhow!("legacy MCP SSE line buffer exceeded its byte cap"));
                    }
                    self.line_buffer.extend_from_slice(&chunk);
                }
                None => {
                    self.stream_ended = true;
                    // SSE permits a final event without a blank line. Process a
                    // final partial line before flushing the event.
                    if !self.line_buffer.is_empty() {
                        let line = std::mem::take(&mut self.line_buffer);
                        if let Some(event) = self.process_line(&line)? {
                            return Ok(Some(event));
                        }
                    }
                }
            }
        }
    }
}
