//! App-level context-window management for chat (limited local-model contexts).
//!
//! Local models run with small context windows (often 4k–8k). Without any
//! app-side bounding, Ryu sends the full thread and relies entirely on
//! llama.cpp's *engine* context-shift to drop tokens when the prompt overflows.
//! That shift is a blunt instrument: Ryu never emits `--keep`/`n_keep`, and
//! llama.cpp's server defaults `n_keep` to 0, so on overflow it can evict the
//! **system prompt** (the leading instructions / long-term memory / skills)
//! along with the oldest turns. The genuine value of trimming here is control
//! plus a guarantee the engine doesn't give: the system block is *always kept*,
//! and dropped turns can be summarized instead of silently lost.
//!
//! This mirrors Jan AI's `context-manager` (`trimMessages` + `compactMessages`)
//! and is **opt-in / off by default** — nothing changes unless the user sets a
//! context budget (see `server::resolve_context_window`). Two modes:
//!
//! * **trim** — a token-budgeted sliding window: keep the newest turns that fit
//!   the input budget, always keeping at least the last user turn and every
//!   `system` message. Older turns are dropped.
//! * **compact** (`auto_compact`) — instead of dropping the older turns, send
//!   them to a side model for a concise summary, injected as a leading system
//!   block. Adds one blocking summarization round-trip per over-budget turn
//!   (cached by the dropped-message set so an unchanged tail is not re-summarized).
//!
//! Both modes are observable and steerable by plugins: whenever turns are about to
//! leave the window the `session_before_compact` phase fires (detached), and a
//! produced summary is offered to `session_compact` (awaited, bounded) before it is
//! merged back. Both fire on BOTH planes — the OpenAI-compat array and the ACP
//! short-term replay — so one plugin governs every agent.
//!
//! Token accounting is a deliberately conservative `len / 3.5` char heuristic
//! (no tokenizer), matching Jan. Base64 image payloads are **not** counted —
//! a flat per-image cost is used so a vision chat does not look like 100k tokens.

use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::OnceLock;

use serde_json::json;
use tokio::sync::Mutex;

use super::{message_image_parts, UiMessage};
use crate::plugin_host::{self, HookContext, HookDirective, HookMessage};
use crate::server::conversations::ConversationStore;

/// Conservative chars-per-token divisor (Jan uses the same 3.5).
const CHARS_PER_TOKEN: f32 = 3.5;
/// Per-message overhead for the role/formatting wrapper (Jan adds 4).
const PER_MESSAGE_OVERHEAD: usize = 4;
/// Flat token cost charged per inline image, instead of measuring its base64
/// payload (which would dwarf the real budget). Roughly a tiled vision frame.
const IMAGE_TOKEN_COST: usize = 768;
/// Slack reserved for skill instructions injected *downstream* of the trim
/// (inside `route_openai_stream`), which we cannot estimate exactly here. A
/// flat margin keeps us under budget for the common case; documented as an
/// approximation, not an exact accounting.
const SKILLS_RESERVE: usize = 512;
/// Upper bound on rows pulled for the ACP short-term window before budgeting,
/// so a very long conversation does not load + estimate unboundedly.
const MAX_SHORT_TERM_FETCH: usize = 400;

/// System prompt for the side-model summarizer (mirrors Jan's COMPACT prompt).
const COMPACT_SYSTEM_PROMPT: &str = "You are a conversation summarizer. Produce a concise summary that preserves key facts, decisions, code snippets, and action items. Use bullet points. Keep the summary under 500 words.";

/// Resolved, ready-to-apply context-window settings. Built by
/// `server::resolve_context_window` from preferences; `None` upstream means the
/// feature is off and none of this runs.
#[derive(Debug, Clone)]
pub struct ContextWindowConfig {
    /// Total context budget in tokens (input + output). When the pref is
    /// `auto`, this is the loaded model's `ctx_size`.
    pub max_tokens: usize,
    /// Tokens reserved for the model's reply (subtracted from the input budget).
    pub reserve_output: usize,
    /// Summarize dropped turns instead of dropping them.
    pub auto_compact: bool,
    /// Model id used for summarization (gateway-routable). Defaults to the chat model.
    pub compact_model: String,
    /// Reasoning effort forwarded to the summarizer (may be empty).
    pub compact_effort: String,
}

impl ContextWindowConfig {
    /// The input-token budget left for conversation history after reserving
    /// space for the reply, the system block, and downstream skill injection.
    fn input_budget(&self, system_tokens: usize) -> usize {
        self.max_tokens
            .saturating_sub(self.reserve_output)
            .saturating_sub(system_tokens)
            .saturating_sub(SKILLS_RESERVE)
    }
}

/// Estimate the token count of a plain string (`ceil(len / 3.5)`).
pub fn estimate_tokens(text: &str) -> usize {
    if text.is_empty() {
        return 0;
    }
    (text.len() as f32 / CHARS_PER_TOKEN).ceil() as usize
}

/// Estimate a UI message's tokens: its text parts plus a flat per-image cost
/// and the per-message overhead. Base64 image data is intentionally ignored.
fn estimate_ui_message_tokens(msg: &UiMessage) -> usize {
    let text = ui_message_text(msg);
    let images = message_image_parts(msg).len();
    estimate_tokens(&text) + images * IMAGE_TOKEN_COST + PER_MESSAGE_OVERHEAD
}

/// The plain text of a UI message (content string or joined `text` parts).
fn ui_message_text(msg: &UiMessage) -> String {
    let from_content = msg.content.as_text();
    if !from_content.is_empty() {
        return from_content;
    }
    msg.parts
        .iter()
        .filter_map(|p| p.get("text")?.as_str().map(str::to_owned))
        .collect::<Vec<_>>()
        .join("")
}

/// Given per-message token estimates (chronological), return how many of the
/// **newest** messages fit within `budget`. Always keeps at least one (the last
/// turn must be sent even if it alone exceeds the budget).
fn window_count(estimates: &[usize], budget: usize) -> usize {
    let mut total = 0usize;
    let mut kept = 0usize;
    for &tokens in estimates.iter().rev() {
        if total + tokens > budget && kept > 0 {
            break;
        }
        total += tokens;
        kept += 1;
    }
    kept.clamp(1, estimates.len().max(1)).min(estimates.len())
}

// ── Plugin compaction hooks (`session_before_compact` / `session_compact`) ────
//
// Both planes below (the OpenAI-compat array and the ACP short-term replay) drop
// the same shape of turns, so both fire the same two phases through the
// process-global dispatcher — these functions have no `ServerState` handle, and
// deliberately don't take one (that is why summarization talks to the gateway
// directly instead of going through `server::call_side_model`).

tokio::task_local! {
    /// Set while a compaction hook runs, so a hook whose own side effects reach
    /// back into the chat path — `host.runAgent` spawns a real sub-agent turn,
    /// which assembles its own context window — cannot re-enter compaction in the
    /// SAME task and recurse. Mirrors `sidecar::mcp`'s `IN_TOOL_HOOK`.
    ///
    /// Task-locals do not propagate across `tokio::spawn`, so a delegated
    /// sub-agent's own compaction IS still governed: that is intentional (the
    /// sub-agent is a real turn a plugin should see), and the recursion it allows
    /// is bounded by the delegation wall-time/depth caps rather than by this flag.
    static IN_COMPACT_HOOK: ();
}

fn in_compact_hook() -> bool {
    IN_COMPACT_HOOK.try_with(|()| ()).is_ok()
}

/// How long the `session_compact` hooks may run before the ORIGINAL summary is
/// used anyway. Mirrors the 8s tool-hook budget in `sidecar::mcp`
/// (`PRE_TOOL_HOOK_TIMEOUT` / `TOOL_RESULT_HOOK_TIMEOUT`): a stuck rewriting hook
/// must never wedge a turn, and must never lose the real summary.
const COMPACT_HOOK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(8);

/// The dropped turns in the hook wire shape. Built from the same flattened
/// `(role, text)` view the summarizer sends to the side model, so a hook inspects
/// exactly what compaction acted on rather than a second, differently-derived one.
fn hook_messages(convo: &[(String, String)]) -> Vec<HookMessage> {
    convo
        .iter()
        .map(|(role, content)| HookMessage {
            role: role.clone(),
            content: content.clone(),
        })
        .collect()
}

/// Fire `session_before_compact` DETACHED, once the set of turns to drop is known.
///
/// Observation-only, so it must add exactly zero latency to the turn that
/// triggered the compaction; directives are ignored here. A plugin that wants to
/// *change* the outcome declares `session_compact` instead, which is awaited.
///
/// Fired for BOTH modes — trim drops the turns outright — because the phase is
/// "Ryu is about to drop these turns", not "Ryu is about to summarize them".
/// Gating it on `auto_compact` would mean an observer plugin silently never fires
/// for the majority (trim) case.
///
/// Because it is detached, this can land *after* the awaited `session_compact`
/// dispatch below has already completed. That ordering skew is deliberate and
/// harmless: nothing downstream reads the observers' result.
fn fire_before_compact_hooks(conversation_id: Option<String>, convo: &[(String, String)]) {
    if in_compact_hook() {
        return;
    }
    let dropped = hook_messages(convo);
    tokio::spawn(async move {
        let ctx = HookContext {
            conversation_id,
            dropped: Some(dropped),
            ..Default::default()
        };
        let _ = IN_COMPACT_HOOK
            .scope(
                (),
                plugin_host::dispatch_global(plugin_host::ON_SESSION_BEFORE_COMPACT, ctx),
            )
            .await;
    });
}

/// Run the awaited `session_compact` hooks over a produced `summary` and return the
/// text to actually merge back into the window. Returns `summary` unchanged when no
/// plugin subscribes, on timeout, on a hook error, and when the code-exec backend is
/// absent — every failure mode leaves compaction byte-identical to the un-hooked path.
///
/// `ctx.output` is the summary *as it will be merged*, i.e. the already-labelled
/// `[Earlier conversation summary]` block, so a hook that returns
/// [`HookDirective::Replace`] owns the label too. A blank replacement is ignored
/// rather than allowed to erase the summary, mirroring the blank-summary guard in
/// [`summarize`].
///
/// First writer wins: only the FIRST `Replace` is applied and the rewrite is not
/// re-fed through the remaining hooks, so what every hook inspects is the real
/// model summary and plugin install order cannot silently defeat another plugin.
///
/// **Cache interaction (deliberate, do not move this inside [`summarize`]).** This
/// runs strictly *after* `summarize` has memoized, so `summary_cache` always holds
/// the untouched side-model summary and never a plugin's rewrite. The cache key
/// hashes only `(model, dropped turns)` — not the installed plugin set — so a cached
/// rewrite would keep being served after that plugin was disabled or replaced, and
/// re-feeding a rewrite into the hook on the next identical compaction would let a
/// non-idempotent hook compound its own output. Keeping the memo a pure record of
/// what the model said, and re-applying the hook to it every time, is stable under
/// both.
async fn apply_compact_hooks(
    conversation_id: Option<String>,
    convo: &[(String, String)],
    summary: String,
) -> String {
    if in_compact_hook() {
        return summary;
    }
    let ctx = HookContext {
        conversation_id,
        dropped: Some(hook_messages(convo)),
        output: Some(summary.clone()),
        ..Default::default()
    };
    let fut = IN_COMPACT_HOOK.scope(
        (),
        plugin_host::dispatch_global(plugin_host::ON_SESSION_COMPACT, ctx),
    );
    let directives = match tokio::time::timeout(COMPACT_HOOK_TIMEOUT, fut).await {
        Ok(d) => d,
        Err(_) => {
            tracing::warn!(
                "plugin_host: session_compact hook timed out; using the original summary"
            );
            return summary;
        }
    };
    directives
        .into_iter()
        .find_map(|d| match d {
            HookDirective::Replace { text } if !text.trim().is_empty() => Some(text),
            _ => None,
        })
        .unwrap_or(summary)
}

/// Trim the OpenAI-compat message list in place to the input budget.
///
/// Every `system` message is preserved (and moved to the front); the remaining
/// turns are windowed newest-first to `cfg.input_budget(system_tokens)`. When
/// `auto_compact` is on and turns were dropped, the dropped turns are summarized
/// and the summary is returned for the caller to merge into the system prompt
/// (labelled clearly so it does not read as a long-term "memory fact").
/// Returns `None` when nothing was dropped or compaction is off/failed.
pub async fn apply_openai(
    messages: &mut Vec<UiMessage>,
    system_tokens: usize,
    cfg: &ContextWindowConfig,
) -> Option<String> {
    // Split system (always kept) from the windowable conversation turns.
    let mut system_msgs: Vec<UiMessage> = Vec::new();
    let mut turns: Vec<UiMessage> = Vec::new();
    for m in messages.drain(..) {
        if m.role == "system" {
            system_msgs.push(m);
        } else {
            turns.push(m);
        }
    }

    // The budget must also account for any system message the client itself sent
    // (the agent's base prompt), not just the injected `system_tokens`, since
    // those rows are always kept and still consume context.
    let in_msg_system: usize = system_msgs.iter().map(estimate_ui_message_tokens).sum();
    let budget = cfg.input_budget(system_tokens + in_msg_system);

    let estimates: Vec<usize> = turns.iter().map(estimate_ui_message_tokens).collect();
    let keep = window_count(&estimates, budget);
    let drop_count = turns.len().saturating_sub(keep);
    let dropped: Vec<UiMessage> = turns.drain(0..drop_count).collect();

    // Reassemble: system block first, then the kept newest turns.
    messages.extend(system_msgs);
    messages.append(&mut turns);

    if dropped.is_empty() {
        return None;
    }
    // Flatten once and reuse: the `session_before_compact` observers, the summarizer
    // and the `session_compact` hooks all want the same `(role, text)` view. Built by
    // consuming `dropped` (it is discarded either way), so this is strictly cheaper
    // than the borrow-and-clone it replaces.
    let convo: Vec<(String, String)> = dropped
        .into_iter()
        .map(|m| {
            let text = ui_message_text(&m);
            (m.role, text)
        })
        .collect();
    // Fired before the `auto_compact` check: in trim mode these turns are dropped
    // outright, and an observer must see that too. No conversation id on this plane
    // — the OpenAI-compat request carries a client-supplied array, not a Ryu
    // conversation, so there is genuinely none to hand the hook.
    fire_before_compact_hooks(None, &convo);
    if !cfg.auto_compact {
        return None;
    }
    let summary = summarize(&convo, cfg).await?;
    // Hook applied OUTSIDE `summarize` on purpose — see `apply_compact_hooks`: the
    // cache stays a pure memo of the model's summary, never a plugin's rewrite.
    Some(apply_compact_hooks(None, &convo, summary).await)
}

/// Assemble a token-budgeted short-term context block for the ACP path (the Pi
/// agent), replacing the fixed last-10 cap. Fetches up to `MAX_SHORT_TERM_FETCH`
/// recent turns, windows them to the input budget, and (when `auto_compact` is
/// on) summarizes the dropped older turns into a leading bullet block. Returns
/// `None` when there is no prior context to replay.
pub async fn budgeted_short_term(
    store: &ConversationStore,
    conversation_id: &str,
    system_tokens: usize,
    cfg: &ContextWindowConfig,
) -> Option<String> {
    let recent = match store
        .get_recent_messages(conversation_id, MAX_SHORT_TERM_FETCH)
        .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("failed to load short-term context: {e:#}");
            return None;
        }
    };
    // The final entry is the just-persisted current user turn; the prefix is the
    // prior context worth replaying. Fewer than 2 messages means no prior turns.
    if recent.len() < 2 {
        return None;
    }
    let prefix = &recent[..recent.len() - 1];

    let estimates: Vec<usize> = prefix
        .iter()
        .map(|m| estimate_tokens(&m.content) + PER_MESSAGE_OVERHEAD)
        .collect();
    let budget = cfg.input_budget(system_tokens);
    let keep = window_count(&estimates, budget);
    let drop_count = prefix.len().saturating_sub(keep);
    let (dropped, kept) = prefix.split_at(drop_count);

    let mut block = String::from("Conversation so far:\n");
    if !dropped.is_empty() {
        let convo: Vec<(String, String)> = dropped
            .iter()
            .map(|m| (m.role.clone(), m.content.clone()))
            .collect();
        // Observers first, and outside the `auto_compact` branch: with compaction off
        // these turns are still dropped from the replay, which is what the phase
        // reports. Detached, so it costs the ACP turn nothing.
        fire_before_compact_hooks(Some(conversation_id.to_string()), &convo);
        if cfg.auto_compact {
            if let Some(summary) = summarize(&convo, cfg).await {
                // Hook applied OUTSIDE `summarize` on purpose — see
                // `apply_compact_hooks`: the cache stays a pure memo of the model's
                // summary, never a plugin's rewrite.
                let summary =
                    apply_compact_hooks(Some(conversation_id.to_string()), &convo, summary).await;
                block.push_str(summary.trim());
                block.push('\n');
            }
        }
    }
    for msg in kept {
        block.push_str(&msg.role);
        block.push_str(": ");
        block.push_str(msg.content.trim());
        block.push('\n');
    }
    Some(block)
}

/// Cache of summaries keyed by `(model, dropped-turn content)` so an unchanged
/// dropped set is not re-summarized on every subsequent over-budget turn.
fn summary_cache() -> &'static Mutex<HashMap<u64, String>> {
    static CACHE: OnceLock<Mutex<HashMap<u64, String>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// A reused HTTP client for the side-model summarization call.
fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(reqwest::Client::new)
}

/// Summarize dropped `(role, text)` turns via the gateway side model. Returns a
/// labelled summary block, or `None` on any failure (caller falls back to a
/// plain drop). Memoized by the dropped-set hash.
async fn summarize(convo: &[(String, String)], cfg: &ContextWindowConfig) -> Option<String> {
    if convo.is_empty() {
        return None;
    }
    let key = {
        let mut hasher = DefaultHasher::new();
        cfg.compact_model.hash(&mut hasher);
        for (role, text) in convo {
            role.hash(&mut hasher);
            text.hash(&mut hasher);
        }
        hasher.finish()
    };
    if let Some(cached) = summary_cache().lock().await.get(&key).cloned() {
        return Some(cached);
    }

    let mut excerpt = convo
        .iter()
        .map(|(role, text)| format!("{role}: {text}"))
        .collect::<Vec<_>>()
        .join("\n");
    // Cap the excerpt to the context budget in chars, keeping the most recent
    // tail when over (older context is the first to go).
    let cap_chars = cfg.max_tokens * CHARS_PER_TOKEN as usize;
    if cap_chars > 0 && excerpt.len() > cap_chars {
        let start = excerpt.len() - cap_chars;
        // Snap to a char boundary so the slice is valid UTF-8.
        let start = (start..excerpt.len())
            .find(|i| excerpt.is_char_boundary(*i))
            .unwrap_or(excerpt.len());
        excerpt = excerpt[start..].to_string();
    }

    let summary = match gateway_summarize(&cfg.compact_model, &cfg.compact_effort, &excerpt).await {
        Ok(s) if !s.trim().is_empty() => s,
        Ok(_) => return None,
        Err(e) => {
            tracing::warn!("context compaction summarize failed, dropping turns instead: {e}");
            return None;
        }
    };
    let block = format!("[Earlier conversation summary]\n{}", summary.trim());
    summary_cache().lock().await.insert(key, block.clone());
    Some(block)
}

/// One non-streaming gateway completion used only for summarization. Mirrors the
/// request shape of `server::call_side_model` but lives here so the adapters
/// layer needs no `ServerState` handle.
async fn gateway_summarize(model: &str, effort: &str, excerpt: &str) -> Result<String, String> {
    let base = crate::sidecar::gateway::gateway_url();
    let base = base.trim_end_matches('/');
    let mut payload = json!({
        "model": model,
        "stream": false,
        "max_tokens": 512,
        "messages": [
            { "role": "system", "content": COMPACT_SYSTEM_PROMPT },
            { "role": "user", "content": format!("Summarize this conversation excerpt:\n\n{excerpt}") },
        ],
    });
    let effort = effort.trim();
    if !effort.is_empty() {
        payload["reasoning_effort"] = json!(effort);
    }
    let mut req = http()
        .post(format!("{base}/v1/chat/completions"))
        .timeout(std::time::Duration::from_secs(60))
        .json(&payload);
    if let Some(t) = crate::sidecar::gateway::gateway_token() {
        req = req.bearer_auth(t);
    }
    let resp = req
        .send()
        .await
        .map_err(|e| format!("gateway unreachable: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("gateway returned HTTP {}", resp.status()));
    }
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("response was not valid JSON: {e}"))?;
    let text = body
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|t| t.as_str())
        .unwrap_or_default();
    Ok(text.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sidecar::adapters::UiContent;

    fn user(text: &str) -> UiMessage {
        UiMessage {
            role: "user".to_owned(),
            content: UiContent::Text(text.to_owned()),
            parts: vec![],
        }
    }
    fn system(text: &str) -> UiMessage {
        UiMessage {
            role: "system".to_owned(),
            content: UiContent::Text(text.to_owned()),
            parts: vec![],
        }
    }

    fn cfg(max: usize, reserve: usize) -> ContextWindowConfig {
        ContextWindowConfig {
            max_tokens: max,
            reserve_output: reserve,
            auto_compact: false,
            compact_model: "m".to_owned(),
            compact_effort: String::new(),
        }
    }

    #[test]
    fn estimate_is_ceil_len_over_3_5() {
        assert_eq!(estimate_tokens(""), 0);
        assert_eq!(estimate_tokens("abcd"), 2); // ceil(4/3.5)=2
        assert_eq!(estimate_tokens(&"a".repeat(7)), 2); // ceil(7/3.5)=2
        assert_eq!(estimate_tokens(&"a".repeat(8)), 3); // ceil(8/3.5)=3
    }

    #[test]
    fn window_keeps_newest_within_budget() {
        let est = vec![10, 10, 10, 10]; // oldest..newest
        assert_eq!(window_count(&est, 25), 2); // 10+10 fit, +10 would exceed
        assert_eq!(window_count(&est, 100), 4);
        assert_eq!(window_count(&est, 0), 1); // always keep at least the last
        assert_eq!(window_count(&est, 5), 1);
    }

    #[test]
    fn window_empty_is_zero() {
        assert_eq!(window_count(&[], 100), 0);
    }

    #[tokio::test]
    async fn apply_openai_drops_oldest_keeps_system_and_last() {
        // Big per-message text so each turn is ~many tokens; tiny budget forces
        // a drop. System message must survive regardless and move to the front.
        let big = "x".repeat(350); // ~100 tokens each
        let mut msgs = vec![
            system("you are helpful"),
            user(&big),
            user(&big),
            user("latest"),
        ];
        // budget after reserves is small -> only the last user turn fits.
        let summary = apply_openai(&mut msgs, 0, &cfg(200, 0)).await;
        assert!(summary.is_none()); // auto_compact off
        assert_eq!(msgs.first().map(|m| m.role.as_str()), Some("system"));
        assert_eq!(
            msgs.last().map(|m| ui_message_text(m)),
            Some("latest".to_owned())
        );
        // system + at least the last user turn; oldest big turns dropped.
        assert!(msgs.len() < 4);
    }

    #[tokio::test]
    async fn apply_openai_noop_when_everything_fits() {
        let mut msgs = vec![system("sys"), user("hi"), user("there")];
        let before = msgs.len();
        let summary = apply_openai(&mut msgs, 0, &cfg(100_000, 1024)).await;
        assert!(summary.is_none());
        assert_eq!(msgs.len(), before);
        assert_eq!(
            msgs.last().map(|m| ui_message_text(m)),
            Some("there".to_owned())
        );
    }

    #[test]
    fn images_counted_flat_not_by_payload() {
        // A message whose only content is a giant base64 image part must not be
        // estimated as a huge token count.
        let huge_b64 = "A".repeat(200_000);
        let msg = UiMessage {
            role: "user".to_owned(),
            content: UiContent::Empty,
            parts: vec![json!({
                "type": "file",
                "mediaType": "image/png",
                "url": format!("data:image/png;base64,{huge_b64}")
            })],
        };
        // Whatever message_image_parts detects, the estimate must be small
        // (flat per-image cost), never ~57k tokens from the base64 length.
        assert!(estimate_ui_message_tokens(&msg) <= IMAGE_TOKEN_COST + PER_MESSAGE_OVERHEAD + 8);
    }

    #[test]
    fn input_budget_saturates_when_reserves_exceed_max() {
        // reserve_output + system + SKILLS_RESERVE all subtract from max_tokens;
        // when they exceed it the budget floors at 0 (never underflows/panics).
        let c = cfg(100, 1000); // reserve_output alone dwarfs max_tokens
        assert_eq!(c.input_budget(0), 0);
        // Even a modest max is fully consumed by system_tokens + SKILLS_RESERVE.
        let c2 = cfg(1000, 0);
        assert_eq!(c2.input_budget(10_000), 0);
    }

    #[test]
    fn ui_message_text_joins_text_parts_when_content_empty() {
        // With empty content, the text is reconstructed from the `text` parts.
        let msg = UiMessage {
            role: "user".to_owned(),
            content: UiContent::Empty,
            parts: vec![
                json!({ "type": "text", "text": "foo" }),
                json!({ "type": "image", "url": "x" }), // no `text` key → skipped
                json!({ "type": "text", "text": "bar" }),
            ],
        };
        assert_eq!(ui_message_text(&msg), "foobar");
    }

    #[test]
    fn ui_message_text_prefers_content_over_parts() {
        let msg = UiMessage {
            role: "user".to_owned(),
            content: UiContent::Text("primary".to_owned()),
            parts: vec![json!({ "type": "text", "text": "ignored" })],
        };
        assert_eq!(ui_message_text(&msg), "primary");
    }

    // ── budgeted_short_term (ACP short-term window) ─────────────────────────

    use crate::server::conversations::ConversationStore;

    #[tokio::test]
    async fn budgeted_short_term_none_without_prior_turns() {
        let store = ConversationStore::open_in_memory().unwrap();
        // No messages at all → None.
        assert!(budgeted_short_term(&store, "empty-conv", 0, &cfg(1000, 0))
            .await
            .is_none());
        // A single message is JUST the current turn — no prior context to replay.
        store
            .append_message("one-conv", "user", "only turn", None, None, None)
            .await
            .unwrap();
        assert!(budgeted_short_term(&store, "one-conv", 0, &cfg(1000, 0))
            .await
            .is_none());
    }

    #[tokio::test]
    async fn budgeted_short_term_replays_prefix_excluding_current_turn() {
        let store = ConversationStore::open_in_memory().unwrap();
        for (role, text) in [
            ("user", "remember 42"),
            ("assistant", "noted"),
            ("user", "what number?"), // current turn — must be excluded
        ] {
            store
                .append_message("c", role, text, None, None, None)
                .await
                .unwrap();
        }
        let block = budgeted_short_term(&store, "c", 0, &cfg(100_000, 0))
            .await
            .expect("prior turns replayed");
        assert!(block.starts_with("Conversation so far:\n"));
        assert!(block.contains("user: remember 42"));
        assert!(block.contains("assistant: noted"));
        // The just-persisted current turn is never echoed back into context.
        assert!(!block.contains("what number?"));
    }

    #[tokio::test]
    async fn budgeted_short_term_drops_oldest_when_over_budget() {
        let store = ConversationStore::open_in_memory().unwrap();
        let big = "x".repeat(400); // ~114 tokens each
        for _ in 0..4 {
            store
                .append_message("cb", "user", &big, None, None, None)
                .await
                .unwrap();
        }
        store
            .append_message("cb", "user", "current", None, None, None)
            .await
            .unwrap();
        // Tiny budget (auto_compact off) → only the newest prefix turn survives,
        // older ones are silently dropped rather than summarized.
        let block = budgeted_short_term(&store, "cb", 0, &cfg(200, 0))
            .await
            .expect("some prior context");
        let big_occurrences = block.matches(&big).count();
        assert_eq!(
            big_occurrences, 1,
            "over-budget prefix keeps only the newest turn"
        );
        assert!(!block.contains("current"), "current turn excluded");
    }

    // ── Compaction hooks ──────────────────────────────────────────────────────

    #[test]
    fn hook_messages_mirror_the_flattened_summarizer_view() {
        // The hook must see the same rows the side model was handed, in order —
        // deriving a second view would let a hook act on turns that were not the
        // ones actually dropped.
        let convo = vec![
            ("user".to_owned(), "remember 42".to_owned()),
            ("assistant".to_owned(), "noted".to_owned()),
        ];
        let msgs = hook_messages(&convo);
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].role, "user");
        assert_eq!(msgs[0].content, "remember 42");
        assert_eq!(msgs[1].role, "assistant");
        assert_eq!(msgs[1].content, "noted");
    }

    #[tokio::test]
    async fn compact_hook_reentrancy_keeps_the_original_summary() {
        // A hook whose side effects re-enter compaction in the same task must not
        // dispatch again (and must not lose the summary it was handed).
        let convo = vec![("user".to_owned(), "hi".to_owned())];
        let original = "[Earlier conversation summary]\n- said hi".to_owned();
        let out = IN_COMPACT_HOOK
            .scope((), apply_compact_hooks(None, &convo, original.clone()))
            .await;
        assert_eq!(out, original);
    }
}
