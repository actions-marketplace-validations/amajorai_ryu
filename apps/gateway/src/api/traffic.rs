//! `GET /v1/traffic` — live request traffic as a Server-Sent Events stream.
//!
//! Subscribes to the gateway's in-memory [`crate::traffic::TrafficBus`], seeds
//! the subscriber with the bounded recent ring buffer, then streams every
//! request that completes (audit records are broadcast by
//! [`crate::state::AppState::log_audit`]). This is the live feed behind the
//! desktop's LM-Studio-style traffic dashboard.
//!
//! Contract:
//!
//! * **SSE framing** — `Content-Type: text/event-stream`; each event carries a
//!   `data:` line with the redacted JSON request event and a `id:` line with the
//!   gateway request id (for `Last-Event-ID` resume if a client implements it).
//! * **Seeded on connect** — a new subscriber first receives the recent ring
//!   buffer (newest last), so the dashboard renders history immediately, then
//!   live events.
//! * **Keep-alive** — a comment line every 15s so proxies / browsers hold the
//!   connection open even during quiet periods.
//! * **Admin-gated** — same [`crate::api::config::require_local_admin`] gate the
//!   audit query uses: master key, or the zero-config loopback posture. The
//!   desktop reaches it through Core's proxy (which forwards the gateway admin
//!   token), never directly with the master key.
//!
//! The stream is best-effort by design: if the client lags behind the broadcast
//! channel it is dropped, and the client reconnects (the ring re-seeds it).
//! There is no replay cursor beyond the ring — the SQLite audit store remains
//! the system of record for anything older.

use std::net::SocketAddr;
use std::time::Duration;

use axum::{
    extract::{ConnectInfo, State},
    http::HeaderMap,
    response::sse::{Event, KeepAlive, Sse},
    Error as AxumError,
};
use futures_util::stream::Stream;
use serde_json::Value;

use crate::{
    api::config::require_local_admin,
    error::GatewayError,
    pipeline::{authenticate, AuthInputs},
    state::SharedState,
};

/// Keep-alive cadence. Comments carry no data and are ignored by SSE parsers;
/// they exist to keep intermediaries from closing an idle connection.
const KEEP_ALIVE_INTERVAL: Duration = Duration::from_secs(15);

/// Build the live traffic SSE stream.
///
/// The handler authenticates and gate-checks BEFORE constructing the stream, so
/// an unauthorized caller gets a clean error instead of a half-open stream. The
/// returned `Sse` then lives independently: the broadcast receiver it holds is
/// 'static (cloned from the shared bus), so no state borrow is retained.
pub async fn live_traffic(
    State(state): State<SharedState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Result<Sse<impl Stream<Item = Result<Event, AxumError>>>, GatewayError> {
    let raw_key = headers.get("authorization").and_then(|v| v.to_str().ok());
    let ctx = authenticate(&state, AuthInputs::with_key(raw_key)).await?;
    require_local_admin(
        &state,
        &peer,
        ctx.is_master_key,
        &headers,
        "Live traffic feed",
    )?;

    let rx = state.traffic.subscribe();
    // Snapshot the ring AFTER subscribing so a request completing between the
    // snapshot and the subscribe cannot be lost — anything in the snapshot is
    // deduped against the live stream by `request_id` below.
    let seed = state.traffic.recent();
    let seeded_ids: std::collections::HashSet<String> = seed
        .iter()
        .filter_map(|v| v.get("request_id").and_then(Value::as_str))
        .map(str::to_owned)
        .collect();

    // Map each broadcast event to an SSE `data:` + `id:` line. Uses
    // `stream::unfold` (the tree's convention) rather than the `async-stream`
    // macro: the receiver lives in the unfold state, so the stream owns it.
    //
    // The ring snapshot is emitted first, then live events; a live event whose
    // `request_id` already appeared in the snapshot is skipped (it raced the
    // subscribe and must not double-render).
    //
    // Broadcast lag (`RecvError::Lagged`) means the client fell behind the ring
    // capacity — skip the lagged marker and continue from the live position;
    // the client's next reconnect re-seeds history.
    let stream = futures_util::stream::unfold(
        (rx, seed.into_iter(), seeded_ids),
        |(mut rx, mut seed_events, mut seen)| async move {
            // Drain the snapshot first.
            if let Some(value) = seed_events.next() {
                let event = to_sse_event(value);
                return Some((Ok(event), (rx, seed_events, seen)));
            }
            // Then follow the live channel.
            loop {
                match rx.recv().await {
                    Ok(value) => {
                        let id = value
                            .get("request_id")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string();
                        // Skip a live event that raced the snapshot.
                        if !id.is_empty() && !seen.insert(id.clone()) {
                            continue;
                        }
                        let event = to_sse_event(value);
                        return Some((Ok(event), (rx, seed_events, seen)));
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                        // The bus sender lives for the process lifetime; Closed is
                        // unreachable in practice. End the stream defensively.
                        return None;
                    }
                }
            }
        },
    );

    Ok(Sse::new(stream).keep_alive(KeepAlive::new().interval(KEEP_ALIVE_INTERVAL)))
}

/// Build a single SSE `traffic` event with `data:` + `id:` fields.
fn to_sse_event(value: Value) -> Event {
    let id = value
        .get("request_id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let mut event = Event::default()
        .event("traffic")
        .json_data(value)
        .expect("traffic event is JSON-serializable");
    if !id.is_empty() {
        event = event.id(id);
    }
    event
}
