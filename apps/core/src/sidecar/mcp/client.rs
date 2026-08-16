//! Minimal MCP client (JSON-RPC 2.0) over **two** transports: a child process's
//! stdin/stdout (stdio), and HTTP POST against a remote endpoint.
//!
//! Core already spawns MCP stdio servers (see `tools/ghost/process.rs`); this is
//! the *client* side of the same transport. It implements just the slice the
//! registry needs: `initialize`, `tools/list`, `tools/call`, and the two
//! `resources/*` calls. The server is connected per request and torn down when
//! the call completes — MCP stdio servers are cheap to start, and a short-lived
//! connection keeps the registry stateless and crash-safe (a wedged server can
//! never leak a long-lived child).
//!
//! ## Why the HTTP half is small
//!
//! That statelessness is exactly what makes the HTTP transport cheap to add.
//! Every call site here is *connect → one request → shutdown*, so Core never
//! needs the hard half of MCP's Streamable HTTP transport: the long-lived
//! server→client `GET` stream that carries unsolicited notifications, sampling
//! requests, and progress. We only ever need the response to the POST we just
//! made. So the whole HTTP transport is "POST one frame, buffer whatever frames
//! come back", and the id-correlation loop, the 60 s deadline, the error
//! unwrapping — the parts that are actually protocol — stay in ONE
//! transport-agnostic driver ([`McpConnection`]) shared by both.
//!
//! If Core ever *does* need server-initiated messages, that is the point at which
//! the HTTP half stops being a request/response shim and needs a real SSE reader
//! task; do not bolt one on here without revisiting [`McpConnection`]'s
//! one-response-per-request assumption.

use std::collections::{BTreeMap, VecDeque};
use std::process::Stdio;
use std::sync::OnceLock;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

use crate::win_process::NoWindow;

/// Sanitized HTTP failure from a remote MCP endpoint. Authentication callers can
/// downcast this to inspect the status and `WWW-Authenticate` challenge without
/// exposing response headers or bearer values in a string error.
#[derive(Debug)]
pub struct McpHttpFailure {
    pub status: reqwest::StatusCode,
    pub www_authenticate: Option<String>,
    pub body_snippet: String,
}

impl std::fmt::Display for McpHttpFailure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "remote MCP endpoint returned HTTP {}: {}",
            self.status, self.body_snippet
        )
    }
}

impl std::error::Error for McpHttpFailure {}

/// The MCP protocol version this client offers during a **stdio** `initialize`.
///
/// Deliberately left at the original revision. Every stdio server Core spawns
/// today negotiates fine against it, and the stdio framing (newline-delimited
/// JSON on a pipe) has not changed across revisions — so bumping it would be
/// churn against a working handshake with nothing to gain.
const MCP_PROTOCOL_VERSION: &str = "2024-11-05";

/// The version offered during an **HTTP** `initialize`. Higher than the stdio
/// one on purpose, and this is not cosmetic.
///
/// Streamable HTTP — one endpoint that answers a POST with either a JSON body or
/// an SSE stream, which is exactly what [`HttpTransport`] implements — arrived in
/// `2025-03-26`. The revision before it defined a *different* HTTP transport
/// (a long-lived `GET /sse` that hands back a separate message endpoint to POST
/// to). Offering `2024-11-05` over HTTP therefore risks the worst outcome
/// available: a server that negotiates down, answers `initialize` happily, and
/// then behaves as the legacy transport we do not implement — a green handshake
/// followed by a wrong-shaped `tools/list`.
///
/// `2025-06-18` additionally requires the negotiated version to be echoed on
/// every subsequent request as `MCP-Protocol-Version`; servers that enforce it
/// reject a request without it. That is what
/// [`HttpTransport::protocol_version`] carries.
const MCP_HTTP_PROTOCOL_VERSION: &str = "2025-06-18";
const MCP_HTTP_STATELESS_PROTOCOL_VERSION: &str = "2026-07-28";

#[derive(Clone, Copy)]
enum HttpProtocolMode {
    Modern,
    Legacy,
}

fn http_protocol_modes() -> &'static tokio::sync::RwLock<BTreeMap<String, HttpProtocolMode>> {
    static MODES: OnceLock<tokio::sync::RwLock<BTreeMap<String, HttpProtocolMode>>> =
        OnceLock::new();
    MODES.get_or_init(|| tokio::sync::RwLock::new(BTreeMap::new()))
}

/// How long to wait for any single JSON-RPC response before giving up. MCP
/// servers spawned via `npx` can be slow to start, so this is generous.
const RPC_TIMEOUT: Duration = Duration::from_secs(60);

/// A tool advertised by an MCP server (`tools/list` entry).
#[derive(Debug, Clone)]
pub struct McpTool {
    pub name: String,
    pub description: Option<String>,
    pub input_schema: Option<Value>,
    /// `outputSchema`, verbatim (JSON Schema for `structuredContent`).
    pub output_schema: Option<Value>,
    /// `annotations`, verbatim (MCP tool annotations).
    pub annotations: Option<Value>,
    /// `_meta`, verbatim — carries the Ryu/OpenAI widget keys (`ryu/outputTemplate`,
    /// `openai/outputTemplate`, `ryu/widgetAccessible`, `ryu/toolInvocation`, …).
    pub meta: Option<Value>,
}

/// A resource advertised by an MCP server (`resources/list` entry).
#[derive(Debug, Clone)]
pub struct McpResource {
    pub uri: String,
    pub name: Option<String>,
    pub mime_type: Option<String>,
    pub description: Option<String>,
    pub meta: Option<Value>,
}

/// The contents of one resource read via `resources/read`.
#[derive(Debug, Clone)]
pub struct McpResourceContents {
    pub uri: String,
    pub mime_type: Option<String>,
    /// Text payload (`text` field) when the resource is textual.
    pub text: Option<String>,
    /// Base64 blob (`blob` field) when the resource is binary.
    pub blob: Option<String>,
    pub meta: Option<Value>,
}

/// A typed `tools/call` result that preserves the structured channels an MCP
/// server returns alongside the human-readable `content` (needed for widgets:
/// `structuredContent` feeds `toolOutput`, `_meta` feeds `toolResponseMetadata`).
#[derive(Debug, Clone)]
pub struct McpToolResult {
    /// `structuredContent`, verbatim.
    pub structured_content: Option<Value>,
    /// `content` array, verbatim.
    pub content: Option<Value>,
    /// `_meta`, verbatim.
    pub meta: Option<Value>,
    /// `isError`, defaulting to `false`.
    pub is_error: bool,
    /// The whole raw result value, untouched (what `call_tool` returns today).
    pub raw: Value,
}

impl McpToolResult {
    /// Split a raw `tools/call` result value into its typed channels.
    pub fn from_result_value(raw: Value) -> Self {
        let structured_content = raw.get("structuredContent").cloned();
        let content = raw.get("content").cloned();
        let meta = raw.get("_meta").cloned();
        let is_error = raw.get("isError").and_then(Value::as_bool).unwrap_or(false);
        Self {
            structured_content,
            content,
            meta,
            is_error,
            raw,
        }
    }
}

/// Unwrap a ghost MCP `tools/call` result envelope into structured JSON.
///
/// ghost replies `{ "content": [{ "type": "text", "text": "<json>" }], "isError"?
/// }` (see `apps/ghost/src/mcp/server.rs`): the structured tool value is the
/// stringified JSON inside `content[0].text`. This parses it back, surfaces
/// `isError` as an `Err`, and falls back to the raw text/string when the payload
/// is not JSON.
///
/// Lives here, next to [`McpToolResult::from_result_value`], because it parses the
/// SAME envelope Core's own [`super::McpRegistry`] produces — `isError` + `content`
/// out of a `tools/call` result. Pure: no state, no host, no I/O. Callers are the
/// workflow executor's `Recipe`/`GhostAction` nodes and the recorder shim in
/// `recipes_host`.
pub fn extract_mcp_json(result: &Value) -> Result<Value> {
    let text = result
        .get("content")
        .and_then(|c| c.get(0))
        .and_then(|first| first.get("text"))
        .and_then(Value::as_str);
    if result
        .get("isError")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return Err(anyhow!("{}", text.unwrap_or("tool error")));
    }
    match text {
        Some(t) => Ok(serde_json::from_str::<Value>(t).unwrap_or(Value::String(t.to_string()))),
        None => Ok(result.clone()),
    }
}

/// A spawnable MCP stdio server: a command plus its arguments and environment.
#[derive(Debug, Clone)]
pub struct McpStdioCommand {
    pub command: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

/// A remote MCP server reached over HTTP (MCP's "Streamable HTTP" transport).
///
/// `headers` is the user's verbatim header map — this is the field a pasted
/// Cursor / Claude Desktop entry's `headers: { "Authorization": "Bearer …" }`
/// lands in. It is NOT an env map: a remote server has no process to inherit
/// env, and every hosted MCP provider documents auth as a request header.
#[derive(Debug, Clone)]
pub struct McpHttpEndpoint {
    pub url: String,
    pub headers: BTreeMap<String, String>,
}

/// Where an MCP server lives — the one thing every entry point here is generic
/// over. Everything downstream of [`McpConnection::connect`] (id allocation,
/// correlation, timeout, error unwrapping, and every response *parser*) is
/// transport-blind: it only ever sees `serde_json::Value`.
#[derive(Debug, Clone)]
pub enum McpTarget {
    Stdio(McpStdioCommand),
    Http(McpHttpEndpoint),
}

impl McpTarget {
    /// Short human label for error text (`"MCP server 'npx'"` / the endpoint URL).
    ///
    /// The HTTP label is REDACTED, because this string is attached as context to
    /// every failure on the connection (`initialize`, `tools/list`, every call) and
    /// a hosted endpoint's URL routinely carries the operator's credential —
    /// userinfo, or a `?api_key=` query. See `server::redact_url_for_display`.
    fn describe(&self) -> String {
        match self {
            Self::Stdio(cmd) => cmd.command.clone(),
            Self::Http(ep) => crate::server::redact_url_for_display(&ep.url),
        }
    }
}

/// One JSON-RPC frame's verdict inside the id-correlation loop.
///
/// Extracted from the loop body so the exact code the driver runs can be
/// asserted directly — notably for the SSE case, where correlation is the whole
/// point (a Streamable-HTTP endpoint may interleave progress notifications and
/// unrelated responses in the same event stream as our answer).
enum FrameVerdict {
    /// Not ours (a notification, another id, or unparseable) — keep reading.
    Skip,
    /// Ours, and it carried a JSON-RPC `error` object.
    Failed(String),
    /// Ours: the `result` value (`null` when the server omitted it).
    Done(Value),
}

/// Classify one newline- or `data:`-delimited JSON-RPC frame against the id we
/// are waiting for. Pure.
fn classify_frame(raw: &str, id: i64) -> FrameVerdict {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return FrameVerdict::Skip;
    }
    let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
        return FrameVerdict::Skip;
    };
    if value.get("id").and_then(Value::as_i64) != Some(id) {
        return FrameVerdict::Skip;
    }
    if let Some(err) = value.get("error") {
        return FrameVerdict::Failed(err.to_string());
    }
    FrameVerdict::Done(value.get("result").cloned().unwrap_or(Value::Null))
}

/// Split an SSE body into its `data:` payloads, in order. Pure.
///
/// Per the SSE grammar: `data:` lines accumulate (joined with `\n`) into one
/// event, and a blank line dispatches it. Every other field (`event:`, `id:`,
/// `retry:`, `:` comments) is ignored — an MCP frame is always the `data`
/// payload, and MCP's own message id lives *inside* that JSON, not in the SSE
/// `id:` field. A trailing event with no closing blank line is still emitted,
/// because a server that closes the stream right after its last frame is common
/// and dropping that frame would hang the caller until the RPC deadline.
fn sse_data_frames(body: &str) -> Vec<String> {
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

/// The stdio half, reduced to write-one-line / read-one-line. Everything that
/// used to live here that was *protocol* rather than *transport* now lives in
/// [`McpConnection`].
struct StdioTransport {
    child: tokio::process::Child,
    stdin: tokio::process::ChildStdin,
    stdout: BufReader<tokio::process::ChildStdout>,
}

/// The HTTP half. Deliberately request/response: `send` performs the POST and
/// buffers whatever frames the response carried; `recv` drains that buffer.
///
/// A JSON body is one frame. A `text/event-stream` body is every `data:` payload
/// it contained, in order — the driver then picks the one whose `id` matches, so
/// interleaved progress notifications cost nothing.
struct HttpTransport {
    url: String,
    headers: BTreeMap<String, String>,
    /// `Mcp-Session-Id`, captured from whichever response first sets it (the
    /// `initialize` response, per the spec) and echoed on every request after.
    /// A stateful endpoint 404s a request that omits it, so this is what makes
    /// `initialize` → `tools/call` work against a session-bearing server.
    session_id: Option<String>,
    /// The version the server settled on in its `initialize` reply, echoed as
    /// `MCP-Protocol-Version` on every request after. `None` until the handshake
    /// completes — the `initialize` POST itself carries no such header, because
    /// nothing has been negotiated yet.
    protocol_version: Option<String>,
    /// Current stateless HTTP protocol: no initialize/session, with per-request
    /// method/name headers and client metadata.
    modern: bool,
    pending: VecDeque<String>,
}

/// Response frames read from an HTTP MCP endpoint are capped: a hostile or
/// broken remote must not be able to OOM Core with a multi-GB "SSE stream".
/// A `tools/list` for a large server is tens of KB; 8 MB is ample.
const MAX_MCP_HTTP_BODY_BYTES: u64 = 8 * 1024 * 1024;

/// The transport-specific half of a connection: move bytes, nothing more.
enum Transport {
    Stdio(StdioTransport),
    Http(HttpTransport),
}

impl Transport {
    /// Write one JSON-RPC frame. For stdio this is a line on the child's stdin;
    /// for HTTP it is the whole request/response round-trip (responses land in
    /// the pending queue for [`recv`](Self::recv)).
    async fn send(&mut self, line: &str) -> Result<()> {
        match self {
            Self::Stdio(t) => {
                let mut framed = String::with_capacity(line.len() + 1);
                framed.push_str(line);
                framed.push('\n');
                t.stdin.write_all(framed.as_bytes()).await?;
                t.stdin.flush().await?;
                Ok(())
            }
            Self::Http(t) => t.post(line).await,
        }
    }

    /// Read the next frame, or `None` when no more can arrive.
    async fn recv(&mut self) -> Result<Option<String>> {
        match self {
            Self::Stdio(t) => {
                let mut buf = String::new();
                let n = t.stdout.read_line(&mut buf).await?;
                Ok(if n == 0 { None } else { Some(buf) })
            }
            Self::Http(t) => Ok(t.pending.pop_front()),
        }
    }

    /// Why no further frame can arrive — the two transports fail differently and
    /// the distinction is the whole diagnosis (a crashed child vs. a response
    /// that simply never contained our id).
    fn exhausted_error(&self) -> anyhow::Error {
        match self {
            Self::Stdio(_) => anyhow!("MCP server closed the connection"),
            // Redacted: the URL may carry the operator's credential, and this
            // string is logged and shown. Same rule as `HttpTransport::post`.
            Self::Http(t) => anyhow!(
                "MCP endpoint {} returned no response frame matching the request id",
                crate::server::redact_url_for_display(&t.url)
            ),
        }
    }

    async fn shutdown(self) {
        match self {
            Self::Stdio(t) => {
                // Dropping stdin closes the pipe; most servers exit on stdin EOF.
                let StdioTransport {
                    mut child, stdin, ..
                } = t;
                drop(stdin);
                let _ = child.kill().await;
            }
            // Nothing to tear down: an HTTP endpoint holds no Core-side resource.
            // (MCP's `DELETE <url>` session teardown is deliberately not sent —
            // it is optional, servers may reject it, and a stateless per-call
            // connection has nothing to reclaim.)
            Self::Http(_) => {}
        }
    }
}

impl HttpTransport {
    /// POST one JSON-RPC frame through Core's SSRF-guarded client and buffer the
    /// response frames.
    ///
    /// The guard is not optional and is not a shared client: see
    /// `server::guarded_post_json`. The moment Core fetches a user-supplied MCP
    /// URL in-process, `http://169.254.169.254/` is Core's own SSRF, so the
    /// resolve → screen → **pin** builder runs per request against this host.
    async fn post(&mut self, line: &str) -> Result<()> {
        let mut headers: Vec<(String, String)> = self
            .headers
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        // Both are required by MCP's Streamable HTTP transport: a server may
        // answer a POST with either a JSON body or an SSE stream, and it picks
        // based on this Accept.
        headers.push((
            "Accept".to_owned(),
            "application/json, text/event-stream".to_owned(),
        ));
        headers.push(("Content-Type".to_owned(), "application/json".to_owned()));
        if self.modern {
            let frame: Value = serde_json::from_str(line).context("parsing outbound MCP frame")?;
            if let Some(method) = frame.get("method").and_then(Value::as_str) {
                headers.push(("Mcp-Method".to_owned(), method.to_owned()));
            }
            let name = frame
                .pointer("/params/name")
                .or_else(|| frame.pointer("/params/uri"))
                .and_then(Value::as_str);
            if let Some(name) = name {
                headers.push(("Mcp-Name".to_owned(), name.to_owned()));
            }
        }
        if let Some(session) = &self.session_id {
            headers.push(("Mcp-Session-Id".to_owned(), session.clone()));
        }
        if let Some(version) = &self.protocol_version {
            headers.push(("MCP-Protocol-Version".to_owned(), version.clone()));
        }

        let (status, resp_headers, body) = crate::server::guarded_post_json(
            &self.url,
            &headers,
            line.to_owned(),
            MAX_MCP_HTTP_BODY_BYTES,
        )
        .await?;

        if !self.modern {
            if let Some(session) = resp_headers
                .get("mcp-session-id")
                .and_then(|v| v.to_str().ok())
                .map(str::to_owned)
            {
                self.session_id = Some(session);
            }
        }

        if status.is_redirection() {
            // Named rather than lumped into the generic failure below, because a
            // 3xx here is almost always a benign `/mcp` → `/mcp/` normalization
            // and the generic message ("returned HTTP 308: ") carries an empty
            // body snippet — nothing the user can act on. Redirects are refused
            // by design (`Policy::none()`): following one would let a screened
            // host bounce Core to an unscreened address after the SSRF check, so
            // the fix is for the user to configure the final URL, and the message
            // has to say so and show it.
            // Both URLs go through the redactor: ours may carry the operator's
            // credential, and a `Location` a remote chose can carry anything at
            // all. See `server::redact_url_for_display`.
            let location = resp_headers
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .map(crate::server::redact_url_for_display)
                .unwrap_or_else(|| "(no Location header)".to_owned());
            return Err(anyhow!(
                "MCP endpoint {} returned HTTP {status} redirecting to {location}. Redirects \
                 are not followed (a redirect could bounce past the SSRF screen) — configure \
                 the final URL for this server instead",
                crate::server::redact_url_for_display(&self.url)
            ));
        }
        if !status.is_success() {
            // Body snippet, truncated: a remote's error page is untrusted text
            // and this string reaches logs and the model. The URL is redacted for
            // the complementary reason — it is OUR secret, not the remote's text.
            let mut snippet: String = body.chars().take(300).collect();
            for (name, value) in &self.headers {
                if name.eq_ignore_ascii_case("authorization") {
                    snippet = snippet.replace(value, "<redacted>");
                    if let Some((_, token)) = value.split_once(' ') {
                        snippet = snippet.replace(token, "<redacted>");
                    }
                }
            }
            return Err(anyhow!(McpHttpFailure {
                status,
                www_authenticate: resp_headers
                    .get(reqwest::header::WWW_AUTHENTICATE)
                    .and_then(|value| value.to_str().ok())
                    .map(str::to_owned),
                body_snippet: snippet,
            }))
            .with_context(|| {
                format!(
                    "MCP endpoint {} authentication/HTTP failure",
                    crate::server::redact_url_for_display(&self.url)
                )
            });
        }

        let content_type = resp_headers
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_ascii_lowercase();
        if content_type.contains("text/event-stream") {
            self.pending.extend(sse_data_frames(&body));
        } else if !body.trim().is_empty() {
            self.pending.push_back(body);
        }
        Ok(())
    }
}

/// A live connection to an MCP server, over either transport.
///
/// This is the transport-agnostic **driver**: id allocation, the correlation
/// loop, JSON-RPC error unwrapping, and the [`RPC_TIMEOUT`] deadline. It is the
/// only thing that understands the protocol; [`Transport`] only moves bytes.
struct McpConnection {
    transport: Transport,
    next_id: i64,
    /// For error text only.
    label: String,
}

impl McpConnection {
    /// Open the transport and complete the MCP `initialize` handshake.
    async fn connect(target: &McpTarget) -> Result<Self> {
        let cached_http_mode = match target {
            McpTarget::Http(endpoint) => http_protocol_modes()
                .read()
                .await
                .get(&endpoint.url)
                .copied(),
            McpTarget::Stdio(_) => None,
        };
        let transport = match target {
            McpTarget::Stdio(cmd) => Transport::Stdio(Self::spawn_stdio(cmd).await?),
            McpTarget::Http(ep) => Transport::Http(HttpTransport {
                url: ep.url.clone(),
                headers: ep.headers.clone(),
                session_id: None,
                protocol_version: None,
                modern: !matches!(cached_http_mode, Some(HttpProtocolMode::Legacy)),
                pending: VecDeque::new(),
            }),
        };

        let mut conn = Self {
            transport,
            next_id: 1,
            label: target.describe(),
        };

        // Current HTTP is stateless: `server/discover` carries client metadata on
        // the request and no initialize/session follows. A method-not-found (or a
        // transport-level 404) proves the endpoint is legacy, in which case we
        // reconnect through the 2025 initialize/session path below.
        if matches!(cached_http_mode, Some(HttpProtocolMode::Modern)) {
            if let Transport::Http(http) = &mut conn.transport {
                http.protocol_version = Some(MCP_HTTP_STATELESS_PROTOCOL_VERSION.to_owned());
            }
            return Ok(conn);
        }
        if matches!(target, McpTarget::Http(_)) && cached_http_mode.is_none() {
            if let Transport::Http(http) = &mut conn.transport {
                http.protocol_version = Some(MCP_HTTP_STATELESS_PROTOCOL_VERSION.to_owned());
            }
            match conn
                .request(
                    "server/discover",
                    json!({
                        "_meta": modern_client_meta(),
                    }),
                )
                .await
            {
                Ok(_) => {
                    let McpTarget::Http(endpoint) = target else {
                        unreachable!("guarded by the HTTP match")
                    };
                    http_protocol_modes()
                        .write()
                        .await
                        .insert(endpoint.url.clone(), HttpProtocolMode::Modern);
                    return Ok(conn);
                }
                Err(error) if error_proves_legacy(&error) => {
                    let McpTarget::Http(endpoint) = target else {
                        unreachable!("guarded by the HTTP match")
                    };
                    conn.transport = Transport::Http(HttpTransport {
                        url: endpoint.url.clone(),
                        headers: endpoint.headers.clone(),
                        session_id: None,
                        protocol_version: None,
                        modern: false,
                        pending: VecDeque::new(),
                    });
                    conn.next_id = 1;
                    http_protocol_modes()
                        .write()
                        .await
                        .insert(endpoint.url.clone(), HttpProtocolMode::Legacy);
                }
                Err(error) => return Err(error).context("MCP server/discover"),
            }
        }

        // Legacy `initialize` request → `initialized` notification.
        let offered = match target {
            McpTarget::Stdio(_) => MCP_PROTOCOL_VERSION,
            McpTarget::Http(_) => MCP_HTTP_PROTOCOL_VERSION,
        };
        let result = conn
            .request(
                "initialize",
                json!({
                    "protocolVersion": offered,
                    "capabilities": {},
                    "clientInfo": { "name": "ryu-core", "version": env!("CARGO_PKG_VERSION") },
                }),
            )
            .await
            .with_context(|| format!("MCP initialize ({})", conn.label))?;

        // Adopt whatever the server settled on, falling back to what we offered.
        // A server is allowed to answer with an OLDER revision than the client
        // asked for, and from `2025-06-18` on it may then reject any subsequent
        // request that does not echo the agreed version back — so this must be
        // the server's answer, not our offer.
        if let Transport::Http(http) = &mut conn.transport {
            http.protocol_version = Some(
                result
                    .get("protocolVersion")
                    .and_then(Value::as_str)
                    .unwrap_or(offered)
                    .to_owned(),
            );
        }

        conn.notify("notifications/initialized", json!({})).await?;

        Ok(conn)
    }

    /// Spawn the server process for the stdio transport.
    async fn spawn_stdio(cmd: &McpStdioCommand) -> Result<StdioTransport> {
        let mut command = Command::new(&cmd.command);
        command
            .args(&cmd.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .no_window();
        // Env-scrub (security): an MCP stdio server has no business inheriting
        // Core's full env (provider keys, gateway/credits tokens). `env_clear`
        // first is load-bearing (a bare `Command` inherits the parent env);
        // then pass ONLY a small benign allowlist (PATH/HOME/XDG_*/...) and
        // finally layer the server config's own declared env on top.
        command.env_clear();
        command.envs(crate::sidecar::env_scrub::mcp_safe_env(std::env::vars()));
        for (k, v) in &cmd.env {
            command.env(k, v);
        }

        let mut child = command
            .spawn()
            .with_context(|| format!("spawn MCP server '{}'", cmd.command))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow!("MCP server stdin unavailable"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow!("MCP server stdout unavailable"))?;

        // Forward the server's stderr to tracing so failures are diagnosable.
        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    tracing::debug!(target: "mcp", "{line}");
                }
            });
        }

        Ok(StdioTransport {
            child,
            stdin,
            stdout: BufReader::new(stdout),
        })
    }

    /// Send a JSON-RPC request and await the matching response `result`.
    ///
    /// The whole round-trip — write *and* read — is under [`RPC_TIMEOUT`], not
    /// just the read. For stdio the write is a pipe write and effectively free,
    /// but for HTTP the "write" is the entire request, so a remote that accepts
    /// the connection and then stalls would otherwise hang forever.
    async fn request(&mut self, method: &str, params: Value) -> Result<Value> {
        let id = self.next_id;
        self.next_id += 1;

        let params = if matches!(&self.transport, Transport::Http(http) if http.modern) {
            with_modern_client_meta(params)
        } else {
            params
        };
        let frame = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        let line = serde_json::to_string(&frame)?;

        // Send, then read frames until the one with our `id`. Notifications and
        // unrelated responses are skipped — identical for both transports,
        // because both hand us JSON-RPC frames one at a time.
        let round_trip = async {
            self.transport.send(&line).await?;
            loop {
                let Some(raw) = self.transport.recv().await? else {
                    return Err(self.transport.exhausted_error());
                };
                match classify_frame(&raw, id) {
                    FrameVerdict::Skip => continue,
                    FrameVerdict::Failed(err) => return Err(anyhow!("MCP error: {err}")),
                    FrameVerdict::Done(result) => return Ok(result),
                }
            }
        };

        tokio::time::timeout(RPC_TIMEOUT, round_trip)
            .await
            .map_err(|_| anyhow!("MCP request '{method}' timed out"))?
    }

    /// Send a JSON-RPC notification (no response expected).
    ///
    /// Over HTTP a notification is still a POST; the server answers `202` with an
    /// empty body, which the transport simply buffers nothing from. A server that
    /// *does* answer with frames has them queued for the next `request`, where
    /// they fail the id match and are skipped — the correlation loop is what
    /// makes that harmless.
    async fn notify(&mut self, method: &str, params: Value) -> Result<()> {
        let frame = json!({ "jsonrpc": "2.0", "method": method, "params": params });
        let line = serde_json::to_string(&frame)?;
        self.transport.send(&line).await
    }

    /// Best-effort graceful shutdown (stdio: drop stdin to signal EOF, then kill;
    /// HTTP: nothing to release).
    async fn shutdown(self) {
        self.transport.shutdown().await;
    }
}

fn modern_client_meta() -> Value {
    json!({
        "io.modelcontextprotocol/protocolVersion": MCP_HTTP_STATELESS_PROTOCOL_VERSION,
        "io.modelcontextprotocol/clientInfo": {
            "name": "ryu-core",
            "version": env!("CARGO_PKG_VERSION")
        },
        "io.modelcontextprotocol/clientCapabilities": {}
    })
}

fn with_modern_client_meta(mut params: Value) -> Value {
    if !params.is_object() {
        params = json!({ "value": params });
    }
    params["_meta"] = modern_client_meta();
    params
}

fn error_proves_legacy(error: &anyhow::Error) -> bool {
    if error.to_string().contains("-32601") {
        return true;
    }
    error.chain().any(|cause| {
        cause
            .downcast_ref::<McpHttpFailure>()
            .is_some_and(|failure| {
                matches!(
                    failure.status,
                    reqwest::StatusCode::NOT_FOUND | reqwest::StatusCode::METHOD_NOT_ALLOWED
                )
            })
    })
}

/// List the tools an MCP server advertises (`tools/list`).
pub async fn list_tools(target: &McpTarget) -> Result<Vec<McpTool>> {
    let mut conn = McpConnection::connect(target).await?;
    let result = conn.request("tools/list", json!({})).await;
    conn.shutdown().await;
    let result = result?;

    let tools = result
        .get("tools")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|t| {
                    let name = t.get("name")?.as_str()?.to_owned();
                    Some(McpTool {
                        name,
                        description: t
                            .get("description")
                            .and_then(Value::as_str)
                            .map(str::to_owned),
                        input_schema: t.get("inputSchema").cloned(),
                        output_schema: t.get("outputSchema").cloned(),
                        annotations: t.get("annotations").cloned(),
                        meta: t.get("_meta").cloned(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(tools)
}

/// Invoke a tool on an MCP server (`tools/call`) and return its result value.
pub async fn call_tool(target: &McpTarget, tool: &str, arguments: Value) -> Result<Value> {
    Ok(call_tool_full(target, tool, arguments).await?.raw)
}

/// Invoke a tool and return the typed [`McpToolResult`] (structured channels
/// preserved). [`call_tool`] delegates here and returns only `.raw`.
pub async fn call_tool_full(
    target: &McpTarget,
    tool: &str,
    arguments: Value,
) -> Result<McpToolResult> {
    let mut conn = McpConnection::connect(target).await?;
    let result = conn
        .request(
            "tools/call",
            json!({ "name": tool, "arguments": arguments }),
        )
        .await;
    conn.shutdown().await;
    Ok(McpToolResult::from_result_value(result?))
}

/// List the resources an MCP server advertises (`resources/list`). Mirrors
/// [`list_tools`] (connect → request → shutdown). A server without resources
/// support errors on the request; callers treat that as an empty list.
pub async fn list_resources(target: &McpTarget) -> Result<Vec<McpResource>> {
    let mut conn = McpConnection::connect(target).await?;
    let result = conn.request("resources/list", json!({})).await;
    conn.shutdown().await;
    let result = result?;

    let resources = result
        .get("resources")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|r| {
                    let uri = r.get("uri")?.as_str()?.to_owned();
                    Some(McpResource {
                        uri,
                        name: r.get("name").and_then(Value::as_str).map(str::to_owned),
                        mime_type: r.get("mimeType").and_then(Value::as_str).map(str::to_owned),
                        description: r
                            .get("description")
                            .and_then(Value::as_str)
                            .map(str::to_owned),
                        meta: r.get("_meta").cloned(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(resources)
}

/// Read one resource by URI (`resources/read`). Returns every contents entry the
/// server sends back.
pub async fn read_resource(target: &McpTarget, uri: &str) -> Result<Vec<McpResourceContents>> {
    let mut conn = McpConnection::connect(target).await?;
    let result = conn.request("resources/read", json!({ "uri": uri })).await;
    conn.shutdown().await;
    let result = result?;

    let contents = result
        .get("contents")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .map(|c| McpResourceContents {
                    uri: c
                        .get("uri")
                        .and_then(Value::as_str)
                        .unwrap_or(uri)
                        .to_owned(),
                    mime_type: c.get("mimeType").and_then(Value::as_str).map(str::to_owned),
                    text: c.get("text").and_then(Value::as_str).map(str::to_owned),
                    blob: c.get("blob").and_then(Value::as_str).map(str::to_owned),
                    meta: c.get("_meta").cloned(),
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(contents)
}

/// A persistent connection to an MCP server.
///
/// Unlike [`call_tool`] — which connects, initializes, calls, and tears down a
/// fresh connection for *every* invocation (keeping the registry stateless) — an
/// `McpSession` holds one open across multiple `tools/call`s. That is
/// required for **stateful** tools whose effect spans two calls against the same
/// process: ghost's recording flow (`ghost_learn_start` … `ghost_learn_stop`)
/// holds an in-process input tap between the two calls, so they MUST hit the same
/// ghost subprocess. Drop or [`shutdown`](Self::shutdown) the session to kill the
/// child (the connection also `kill_on_drop`s its child as a backstop). Over the
/// HTTP transport there is no child to hold, but the session is still the right
/// shape: it is what carries the `Mcp-Session-Id` across calls.
pub struct McpSession {
    conn: McpConnection,
}

impl McpSession {
    /// Open the transport and complete the MCP `initialize` handshake, leaving it
    /// open for subsequent [`call_tool`](Self::call_tool)s.
    ///
    /// Over HTTP the retained state is the `Mcp-Session-Id` rather than a child
    /// process, which is the correct analogue: a session-bearing remote server
    /// keys its per-session state on exactly that header.
    pub async fn connect(target: &McpTarget) -> Result<Self> {
        Ok(Self {
            conn: McpConnection::connect(target).await?,
        })
    }

    /// Invoke a tool on the live connection (`tools/call`) and return its result.
    pub async fn call_tool(&mut self, tool: &str, arguments: Value) -> Result<Value> {
        Ok(self.call_tool_full(tool, arguments).await?.raw)
    }

    /// Invoke a tool on the live connection and return the typed result.
    pub async fn call_tool_full(&mut self, tool: &str, arguments: Value) -> Result<McpToolResult> {
        let raw = self
            .conn
            .request(
                "tools/call",
                json!({ "name": tool, "arguments": arguments }),
            )
            .await?;
        Ok(McpToolResult::from_result_value(raw))
    }

    /// Gracefully close the connection and kill the child process.
    pub async fn shutdown(self) {
        self.conn.shutdown().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modern_requests_use_the_namespaced_stateless_meta_envelope() {
        let params = with_modern_client_meta(json!({ "name": "send_email" }));
        let meta = params.get("_meta").expect("modern request metadata");
        assert_eq!(
            meta.get("io.modelcontextprotocol/protocolVersion"),
            Some(&json!("2026-07-28"))
        );
        assert_eq!(
            meta.pointer("/io.modelcontextprotocol~1clientInfo/name"),
            Some(&json!("ryu-core"))
        );
        assert_eq!(
            meta.get("io.modelcontextprotocol/clientCapabilities"),
            Some(&json!({}))
        );
        assert!(meta.get("clientInfo").is_none());
    }

    /// The SSRF screen the HTTP transport runs before it POSTs anything.
    ///
    /// Asserted through [`crate::server::screen_egress_url_with`] — the env-free
    /// core of the screen — rather than by setting `RYU_AGENT_EGRESS_ALLOW_HOSTS`
    /// in the process. Core's tests all share ONE bin-target process, so a
    /// `set_var` here would race every other test in the binary: it would pass
    /// alone and flake in the suite, which is worse than no test at all.
    ///
    /// A literal IP needs no DNS, so neither of these touches the network.
    #[tokio::test]
    async fn http_target_rejects_metadata_ip() {
        // The cloud-metadata endpoint. This is THE reason the guard exists: the
        // moment Core fetches a user-supplied MCP URL in-process, an entry
        // pointing here would read the host's instance credentials.
        let err = crate::server::screen_egress_url_with("http://169.254.169.254/mcp", true, None)
            .await
            .expect_err("the link-local metadata address must be refused");
        let msg = err.to_string();
        assert!(
            msg.contains("169.254.169.254"),
            "the refusal must name the host it blocked: {msg}"
        );
        assert!(
            msg.contains("RYU_AGENT_EGRESS_ALLOW_HOSTS"),
            "the refusal must name the documented escape hatch: {msg}"
        );

        // Not allowlisted by a DIFFERENT host, either — the allowlist is exact.
        assert!(
            crate::server::screen_egress_url_with(
                "http://169.254.169.254/mcp",
                true,
                Some("127.0.0.1")
            )
            .await
            .is_err(),
            "an allowlist entry for another host must not unblock metadata"
        );
    }

    /// `http://127.0.0.1:3000/mcp` is the single most common remote-MCP dev
    /// target, and it is blocked by default *by design* (loopback is exactly what
    /// SSRF reaches for). The allowlist is the one supported way through, and it
    /// must actually work — a screen with no usable escape hatch makes the whole
    /// feature look broken to the first developer who tries it.
    #[tokio::test]
    async fn http_target_allows_loopback_when_allowlisted() {
        // Blocked without the allowlist…
        assert!(
            crate::server::screen_egress_url_with("http://127.0.0.1:3000/mcp", true, None)
                .await
                .is_err(),
            "loopback must be refused by default"
        );

        // …allowed with it, and `http` (not just `https`) must survive the scheme
        // check, since a local dev MCP server is never TLS.
        let url = crate::server::screen_egress_url_with(
            "http://127.0.0.1:3000/mcp",
            true,
            Some("example.com, 127.0.0.1"),
        )
        .await
        .expect("an allowlisted loopback host must pass the screen");
        assert_eq!(url.scheme(), "http");
        assert_eq!(url.port(), Some(3000));

        // A non-http(s) scheme is refused regardless of the allowlist — the
        // allowlist widens which HOSTS are reachable, never which protocols.
        assert!(
            crate::server::screen_egress_url_with("file:///etc/passwd", true, Some("*"))
                .await
                .is_err()
        );
    }

    /// A Streamable-HTTP endpoint may answer one POST with an event stream that
    /// interleaves progress notifications and unrelated responses around our
    /// answer. Correlation by JSON-RPC `id` — not "take the first frame" — is what
    /// makes that safe, and this asserts the exact pair of functions the transport
    /// runs: [`sse_data_frames`] to split the body, [`classify_frame`] to pick.
    #[test]
    fn sse_response_frame_is_correlated_by_id() {
        let body = "event: message\n\
                    data: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\",\"params\":{}}\n\
                    \n\
                    event: message\n\
                    data: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"stale\":true}}\n\
                    \n\
                    : a comment line the parser ignores\n\
                    data: {\"jsonrpc\":\"2.0\",\"id\":7,\"result\":{\"tools\":[]}}\n\
                    \n";

        let frames = sse_data_frames(body);
        assert_eq!(frames.len(), 3, "one frame per `data:` event: {frames:?}");

        // The frame we asked for is the third one; the notification (no id) and
        // the response to a different id must both be skipped, not returned.
        let mut answered = None;
        for frame in &frames {
            match classify_frame(frame, 7) {
                FrameVerdict::Skip => continue,
                FrameVerdict::Failed(e) => panic!("unexpected error frame: {e}"),
                FrameVerdict::Done(result) => {
                    answered = Some(result);
                    break;
                }
            }
        }
        assert_eq!(
            answered,
            Some(json!({ "tools": [] })),
            "the id-7 result must win over the earlier id-1 frame"
        );

        // A JSON-RPC error carrying OUR id is surfaced, not skipped.
        let err_frames =
            sse_data_frames("data: {\"jsonrpc\":\"2.0\",\"id\":3,\"error\":{\"code\":-32601}}\n\n");
        let FrameVerdict::Failed(msg) = classify_frame(&err_frames[0], 3) else {
            panic!("an error frame with a matching id must fail the request");
        };
        assert!(msg.contains("-32601"), "unexpected: {msg}");
    }

    /// A stream whose last event has no trailing blank line still yields its
    /// frame. Dropping it would hang the caller until the 60 s RPC deadline for
    /// what is a perfectly well-formed response.
    #[test]
    fn sse_last_frame_without_trailing_blank_line_is_kept() {
        let frames = sse_data_frames("data: {\"id\":1,\"result\":42}");
        assert_eq!(frames, vec!["{\"id\":1,\"result\":42}".to_owned()]);
    }

    /// Multi-line `data:` payloads join with `\n`, per the SSE grammar — a server
    /// that pretty-prints its JSON must still parse.
    #[test]
    fn sse_multiline_data_frames_are_joined() {
        let frames = sse_data_frames("data: {\"id\":1,\ndata: \"result\":42}\n\n");
        assert_eq!(frames.len(), 1);
        assert_eq!(
            serde_json::from_str::<Value>(&frames[0]).expect("joined payload is valid JSON")["id"],
            json!(1)
        );
    }

    #[test]
    fn extract_unwraps_text_json() {
        let env = json!({ "content": [{ "type": "text", "text": "{\"a\":1}" }] });
        assert_eq!(extract_mcp_json(&env).unwrap(), json!({ "a": 1 }));
    }

    #[test]
    fn extract_surfaces_is_error() {
        let env =
            json!({ "content": [{ "type": "text", "text": "Error: boom" }], "isError": true });
        let err = extract_mcp_json(&env).unwrap_err().to_string();
        assert!(err.contains("boom"), "unexpected error: {err}");
    }

    #[test]
    fn extract_falls_back_to_plain_text() {
        let env = json!({ "content": [{ "type": "text", "text": "not json" }] });
        assert_eq!(extract_mcp_json(&env).unwrap(), json!("not json"));
    }

    #[test]
    fn extract_returns_whole_result_when_no_content() {
        // No `content` array ⇒ the raw result is returned verbatim.
        let env = json!({ "some": "value" });
        assert_eq!(extract_mcp_json(&env).unwrap(), env);
    }

    #[test]
    fn extract_returns_clone_when_text_missing() {
        let env = json!({ "content": [{ "type": "image" }] });
        assert_eq!(extract_mcp_json(&env).unwrap(), env);
    }

    #[test]
    fn extract_is_error_without_text_uses_default_message() {
        let env = json!({ "content": [{ "type": "text" }], "isError": true });
        let err = extract_mcp_json(&env).unwrap_err().to_string();
        assert!(err.contains("tool error"), "unexpected: {err}");
    }

    #[test]
    fn from_result_value_splits_all_channels() {
        let raw = json!({
            "content": [{ "type": "text", "text": "hello" }],
            "structuredContent": { "answer": 42 },
            "_meta": { "ryu/outputTemplate": "ui://widget" },
            "isError": false,
        });
        let result = McpToolResult::from_result_value(raw.clone());
        assert_eq!(
            result.content,
            Some(json!([{ "type": "text", "text": "hello" }]))
        );
        assert_eq!(result.structured_content, Some(json!({ "answer": 42 })));
        assert_eq!(
            result.meta,
            Some(json!({ "ryu/outputTemplate": "ui://widget" }))
        );
        assert!(!result.is_error);
        // The raw value is preserved untouched.
        assert_eq!(result.raw, raw);
    }

    #[test]
    fn from_result_value_defaults_missing_channels_to_none() {
        let result = McpToolResult::from_result_value(json!({}));
        assert!(result.structured_content.is_none());
        assert!(result.content.is_none());
        assert!(result.meta.is_none());
        assert!(!result.is_error, "isError defaults to false when absent");
    }

    #[test]
    fn from_result_value_reads_is_error_true() {
        let result = McpToolResult::from_result_value(json!({
            "content": [{ "type": "text", "text": "boom" }],
            "isError": true,
        }));
        assert!(result.is_error);
        assert!(result.content.is_some());
    }

    #[test]
    fn from_result_value_ignores_non_bool_is_error() {
        // A non-boolean `isError` (spec violation) must not be coerced to true;
        // `as_bool` returns None and the field falls back to the false default.
        let result = McpToolResult::from_result_value(json!({ "isError": "yes" }));
        assert!(!result.is_error);
    }

    #[test]
    fn from_result_value_tolerates_non_object_raw() {
        // A non-object result (e.g. the server returned a bare array) yields all
        // None channels rather than panicking, and preserves the raw value.
        let raw = json!(["not", "an", "object"]);
        let result = McpToolResult::from_result_value(raw.clone());
        assert!(result.structured_content.is_none());
        assert!(result.content.is_none());
        assert!(result.meta.is_none());
        assert!(!result.is_error);
        assert_eq!(result.raw, raw);
    }
}
