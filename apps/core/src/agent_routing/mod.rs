//! Per-agent routing/bridging gates for generic ACP agents.
//!
//! This module owns TWO independent per-agent switches. They used to be ONE
//! ([`AGENT_GATEWAY_ROUTING_PREF_KEY`] gated both), which was a conflation bug:
//!
//! | | what it changes | default | risk if wrong |
//! |---|---|---|---|
//! | **Egress routing** ([`is_gateway_routing`]) | swaps the agent's OpenAI base URL + API key to the local gateway | **ON** until explicitly disabled | a subscription credential and the billing path move |
//! | **Tool bridge** ([`is_tool_bridge_enabled`]) | injects Ryu's in-process MCP server into the ACP session | **ON** | none — see below |
//!
//! Sharing one preference meant a user who declined to have their credential
//! re-pointed at the gateway ALSO silently lost every Ryu tool, which is why a
//! freshly installed ACP agent had no tools out of the box.
//! Splitting them is the whole point of this module's two maps: **do not** re-merge
//! them. They now have independent switches: both the tool bridge and credential
//! egress routing default ON, with separate per-agent opt-outs.
//!
//! ## Why the bridge may default ON
//!
//! The bridge is *not* a grant. `build_ryu_mcp_server` offers exactly
//! `McpRegistry::tools_for_agent(allowlist)` — the agent's own configured tool
//! allowlist, further narrowed by `filter_capability_tools` — and every bridged
//! invocation re-checks that same effective allowlist inside
//! `McpRegistry::call_tool`. So an agent with a restricted allowlist sees exactly
//! that allowlist and nothing more; an agent with an EMPTY allowlist can execute
//! nothing (only the meta/discovery tools are offered, and discovery is not a
//! grant).
//!
//! **Do not read that as "the ON default grants nothing new" — it does not hold,
//! and an earlier draft of this comment claimed it.** `AcpAgentRegistry::allowlist_for`
//! resolves *only* from `RYU_MCP_ALLOWLIST_<AGENT>` / `RYU_MCP_ALLOWLIST`; unset
//! yields `None`, which means **unrestricted**. On a stock node nobody has
//! configured an allowlist, so a bridged agent reaches the full built-in set —
//! `channel_tool` (send-to-channel), `notify_tool`, `delegate`, `orchestrator`,
//! `search_conversations`, `threads`, sandbox, research, `web_fetch`. That is real
//! capability, and a future reader deciding whether to keep this default deserves
//! the true reason rather than a comforting one.
//!
//! **The default is defensible on PARITY.** The same `allowlist_for(agent_id)`
//! already governs two planes Ryu runs default-on: the Pi-extension road
//! (`/api/mcp/tools/call`) and the openai-compat adapter. And every bridged call
//! still passes `approvals::gate_tool_call`, whose fail-safe default is
//! `ApprovalMode::Smart`. So turning the bridge on does not widen what an ACP agent
//! may do relative to the rest of Ryu — it stops ACP being the one plane where a
//! user's configured tools silently never arrive. Narrowing what any of those planes
//! reaches is a separate, worthwhile change; it should move all three together.
//!
//! Egress still moves a credential and changes who bills the request, so the UI
//! keeps the direct-egress opt-out visible and explicit. A new or auto-installed
//! routable ACP agent starts with Gateway-governed provider traffic. An explicit
//! `true` or `false` entry is preserved across restarts and upgrades.
//!
//! The independent maps still have their own parse-failure behavior. A blank or
//! unparseable preference **clears** both maps, which means Gateway egress for
//! routing and "everything ON" for the bridge (fail open: never strip a user's
//! configured tools on a parse error). Both are the baseline direction for their
//! own gate.
//!
//! ## Migration: none, deliberately
//!
//! There is no data migration and none is needed, in both directions:
//!
//! - An agent whose old `agent-gateway-routing` entry was **true** keeps that
//!   entry verbatim, so it keeps egress routing (it was opted into) and — because
//!   a missing tool-bridge entry means ON — keeps its tools. Nothing lost.
//! - An agent whose entry was **false** keeps its direct-egress opt-out and still
//!   *gains* the bridge. An absent entry now gets Gateway egress and the bridge.
//!   This preserves explicit choices while making the governed baseline available
//!   until the user narrows either plane.
//!
//! The third case is the one worth naming because Core cannot resolve it: an
//! existing **true** may have been set *only* to get tools, by a user who never
//! wanted their credential re-pointed and had no way to say so. The two intents
//! are indistinguishable in the stored data, so the conservative reading wins —
//! keep egress on (never silently revoke something the user explicitly enabled)
//! and let them turn it off independently, which after this split they can do for
//! the first time. That is a UI affordance, not a data change.
//!
//! Writing a migration that seeded `{"<id>": false}` into the bridge map from
//! every old `false` would be the one genuinely wrong move: it would bake the
//! conflation in permanently, in a form no later default change could undo.
//!
//! ---
//!
//! # Egress routing (the original lever)
//!
//! The three first-class agents that can route through the gateway each have a
//! dedicated config module: the managed Pi ([`crate::pi_config`], default ON),
//! Claude Code ([`crate::claude_config`], default ON, Anthropic passthrough) and
//! Codex ([`crate::codex_config`], default ON, ChatGPT-login passthrough). This
//! module is the *generic* equivalent for **any other ACP agent** — most
//! importantly a BYO OpenAI-compatible agent the user added themselves
//! (`engine = "acp-exec:<command>"`).
//!
//! When enabled for an agent, Core injects `OPENAI_BASE_URL` (the local gateway
//! `/v1`) + `OPENAI_API_KEY` (the gateway token) into that agent's spawn command
//! (see [`crate::sidecar::adapters::acp::openai_gateway_cmd`]), so an agent whose
//! HTTP client honours the OpenAI base URL sends its model calls through the
//! gateway's firewall/budget/audit pipeline instead of straight to a provider.
//!
//! **Honest scope:** this is a genuine no-op for ACP agents that do NOT read
//! `OPENAI_BASE_URL` (Gemini CLI speaks Google format; OpenClaw talks to its own
//! WebSocket gateway; Hermes uses its own creds; even the managed Pi ignores the
//! env var and is routed via its `models.json` instead). The toggle is therefore
//! surfaced primarily for the `acp-exec:` BYO path, where it does exactly what the
//! user asked: swap the agent's OpenAI-compatible endpoint to ours, automatically,
//! with no manual env wiring.
//!
//! Storage mirrors the claude/codex toggles but, because the key is per-agent,
//! the whole set lives under ONE preference (`agent-gateway-routing`) holding a
//! JSON object `{ "<agent_id>": true, ... }`. Core seeds an in-process map from it
//! at startup and on change, read synchronously on the (sync) spawn path.

use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};

pub mod auto;
pub use auto::{
    resolve_auto_agent, set_auto_config_from_json, AGENT_AUTO_ROUTING_PREF_KEY, AUTO_AGENT_ID,
};

/// Shared governed-by-default posture for new and auto-installed routable agents.
/// An explicit `false` remains the per-agent direct-egress opt-out.
pub const DEFAULT_GATEWAY_ROUTING: bool = true;

/// Generic per-agent alias kept for the preference/API contract.
pub const DEFAULT_AGENT_GATEWAY_ROUTING: bool = DEFAULT_GATEWAY_ROUTING;

/// Shared default for the ACP tool bridge. It remains a separate preference and
/// runtime gate, but a fresh agent gets the same broad governed baseline.
pub const DEFAULT_AGENT_TOOL_BRIDGE: bool = DEFAULT_GATEWAY_ROUTING;

/// Preferences key the desktop writes; Core loads it on startup and on change.
/// The value is a JSON object mapping agent id → enabled boolean.
///
/// **Egress only.** This key no longer has any say over the MCP tool bridge — see
/// [`AGENT_TOOL_BRIDGE_PREF_KEY`] and the module docs for why they were split.
pub const AGENT_GATEWAY_ROUTING_PREF_KEY: &str = "agent-gateway-routing";

/// Preferences key holding the per-agent **MCP tool bridge** switch: a JSON object
/// mapping agent id → enabled boolean, where a MISSING entry means **ON**.
///
/// Deliberately a different key from [`AGENT_GATEWAY_ROUTING_PREF_KEY`] rather
/// than a nested field of it: a shared key is what made the two concerns
/// impossible to set independently in the first place, and a separate key lets an
/// existing node's egress choice survive untouched while the bridge picks up its
/// new default (see the module docs' migration note).
pub const AGENT_TOOL_BRIDGE_PREF_KEY: &str = "agent-tool-bridge";

/// Preferences key holding per-agent Plane A model-routing overrides (the
/// "both" config scope, spec §1). The value is a JSON object mapping agent id →
/// a full `SmartRoutingConfig` JSON (opaque to Core — only the gateway parses it).
/// When Core forwards an OpenAI-compat chat request for an agent that HAS an
/// override, it injects that config into the request body as `ryu_smart_route`;
/// the gateway reads and strips the field, building an ephemeral per-agent smart
/// router for that request. Agents without an override keep the global path.
pub const AGENT_SMART_ROUTE_PREF_KEY: &str = "agent-smart-route";

/// In-process map of agent id → its opaque `SmartRoutingConfig` JSON, populated
/// from [`AGENT_SMART_ROUTE_PREF_KEY`]. A missing entry means "no override".
fn smart_route_map() -> &'static RwLock<HashMap<String, serde_json::Value>> {
    static MAP: OnceLock<RwLock<HashMap<String, serde_json::Value>>> = OnceLock::new();
    MAP.get_or_init(|| RwLock::new(HashMap::new()))
}

/// Replace the in-process per-agent smart-route map from the persisted preference
/// value (a JSON object of agent id → SmartRoutingConfig JSON). A blank or
/// unparseable value clears the map (every agent reverts to the global router)
/// rather than erroring — the forward path must never panic. Object/empty values
/// are ignored per-agent so a `{}` or `null` entry does not shadow the global.
pub fn set_smart_routes_from_json(value: &str) {
    let mut next: HashMap<String, serde_json::Value> = HashMap::new();
    let trimmed = value.trim();
    if !trimmed.is_empty() {
        if let Ok(serde_json::Value::Object(obj)) =
            serde_json::from_str::<serde_json::Value>(trimmed)
        {
            for (id, cfg) in obj {
                // Only store a non-empty object override; a null/empty entry means
                // "no override for this agent" (keep the global router).
                if let serde_json::Value::Object(map) = &cfg {
                    if !map.is_empty() {
                        next.insert(id, cfg);
                    }
                }
            }
        }
    }
    if let Ok(mut guard) = smart_route_map().write() {
        *guard = next;
    }
}

/// The per-agent Plane A `SmartRoutingConfig` override for `agent_id`, if any.
/// Returned as an opaque JSON value to inject verbatim into the outbound
/// OpenAI-compat body as `ryu_smart_route`. `None` for agents without an override.
pub fn smart_route_override(agent_id: &str) -> Option<serde_json::Value> {
    smart_route_map()
        .read()
        .ok()
        .and_then(|m| m.get(agent_id).cloned())
}

/// In-process map of agent id → gateway-routing enabled, populated from the
/// preference. A missing entry means ON, so only an explicit `false` opts out of
/// Gateway egress.
fn routing_map() -> &'static RwLock<HashMap<String, bool>> {
    static MAP: OnceLock<RwLock<HashMap<String, bool>>> = OnceLock::new();
    MAP.get_or_init(|| RwLock::new(HashMap::new()))
}

/// Parse a persisted boolean string without treating an unknown value as an
/// opt-in. An unreadable preference must fall back to the governed default.
fn parse_bool_string(value: &str) -> Option<bool> {
    match value.trim().to_ascii_lowercase().as_str() {
        "true" | "1" | "on" | "yes" => Some(true),
        "false" | "0" | "off" | "no" => Some(false),
        _ => None,
    }
}

/// Parse one JSON map entry. Invalid entries are skipped so the caller's
/// missing-entry default remains in force.
fn parse_json_bool(value: &serde_json::Value) -> Option<bool> {
    match value {
        serde_json::Value::Bool(value) => Some(*value),
        serde_json::Value::String(value) => parse_bool_string(value),
        serde_json::Value::Number(value) => value.as_i64().map(|value| value != 0),
        _ => None,
    }
}

/// Replace the in-process map from the persisted preference value (a JSON object
/// of agent id → boolean, or one of the truthy string forms per value). A blank
/// or unparseable value clears the map (everything reverts to the governed default)
/// rather than erroring — the spawn path must never panic.
pub fn set_from_json(value: &str) {
    let mut next: HashMap<String, bool> = HashMap::new();
    let trimmed = value.trim();
    if !trimmed.is_empty() {
        if let Ok(serde_json::Value::Object(obj)) = serde_json::from_str(trimmed) {
            for (id, raw) in obj {
                if let Some(on) = parse_json_bool(&raw) {
                    next.insert(id, on);
                }
            }
        }
    }
    if let Ok(mut guard) = routing_map().write() {
        *guard = next;
    }
}

/// Whether `agent_id` should route its egress through the Ryu gateway via the
/// OpenAI base-URL swap. Read on the synchronous spawn path; defaults to ON.
pub fn is_gateway_routing(agent_id: &str) -> bool {
    routing_map()
        .read()
        .ok()
        .and_then(|m| m.get(agent_id).copied())
        .unwrap_or(DEFAULT_AGENT_GATEWAY_ROUTING)
}

/// In-process map of agent id → MCP-tool-bridge enabled, populated from
/// [`AGENT_TOOL_BRIDGE_PREF_KEY`].
///
/// Semantically the INVERSE of [`routing_map`]: a missing entry means ON, so only
/// an explicit opt-OUT is ever stored. A separate map (not a second value in the
/// routing map) because the two gates have independent opt-outs and a shared
/// container would make one plane's writes affect the other.
fn bridge_map() -> &'static RwLock<HashMap<String, bool>> {
    static MAP: OnceLock<RwLock<HashMap<String, bool>>> = OnceLock::new();
    MAP.get_or_init(|| RwLock::new(HashMap::new()))
}

/// Replace the in-process tool-bridge map from the persisted preference value (a
/// JSON object of agent id → boolean, accepting the same truthy string/number
/// forms the desktop may persist as [`set_from_json`]).
///
/// A blank or unparseable value clears the map, which for THIS gate means every
/// agent reverts to ON — the opposite of [`set_from_json`]'s fail-closed clear,
/// and correct for the same reason the default is ON: an unreadable preference
/// must not silently strip an agent of the tools its allowlist already grants.
/// Never panics; the (sync) session-build path reads this.
pub fn set_bridge_from_json(value: &str) {
    let mut next: HashMap<String, bool> = HashMap::new();
    let trimmed = value.trim();
    if !trimmed.is_empty() {
        if let Ok(serde_json::Value::Object(obj)) = serde_json::from_str(trimmed) {
            for (id, raw) in obj {
                if let Some(on) = parse_json_bool(&raw) {
                    next.insert(id, on);
                }
            }
        }
    }
    if let Ok(mut guard) = bridge_map().write() {
        *guard = next;
    }
}

/// Whether `agent_id` should get Ryu's MCP tool bridge injected into its ACP
/// session. **Defaults to ON**: only an explicit `false` in
/// [`AGENT_TOOL_BRIDGE_PREF_KEY`] withholds it.
///
/// Callers must still honour the transport-level `bridge_supported` guard (an
/// agent that advertises no MCP-server support cannot be handed one regardless of
/// preference) — see [`crate::sidecar::adapters::acp::acp_tool_bridge_enabled`],
/// which composes the two in the right order.
pub fn is_tool_bridge_enabled(agent_id: &str) -> bool {
    bridge_map()
        .read()
        .ok()
        .and_then(|m| m.get(agent_id).copied())
        .unwrap_or(DEFAULT_AGENT_TOOL_BRIDGE)
}

/// Serializes every test that mutates the process-global routing map (one map is
/// shared across the whole test binary, including `sidecar::adapters`' wiring
/// test). Without it, parallel `set_from_json` calls clobber each other's state
/// between a set and its assert. Poison-tolerant: a panic mid-test must not wedge
/// the rest.
#[cfg(test)]
pub(crate) static TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_map_toggles_per_agent() {
        let _guard = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        set_from_json(r#"{"my-byo-agent": true, "other": false, "truthy": "on"}"#);
        assert!(is_gateway_routing("my-byo-agent"));
        assert!(is_gateway_routing("truthy"));
        assert!(!is_gateway_routing("other"));
        // Unknown agents keep Gateway egress until explicitly opted out.
        assert!(is_gateway_routing("never-seen"));
    }

    #[test]
    fn blank_or_garbage_clears_to_governed_default() {
        let _guard = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        set_from_json(r#"{"x": true}"#);
        assert!(is_gateway_routing("x"));
        set_from_json("");
        assert!(is_gateway_routing("x"));
        set_from_json("not json at all");
        assert!(is_gateway_routing("x"));
    }

    /// The headline of the split: a fresh agent nobody has configured gets the
    /// tool bridge and Gateway-governed provider egress. The controls remain
    /// separate even though their defaults now share the same broad posture.
    #[test]
    fn fresh_agent_gets_the_bridge_and_egress_routing() {
        let _guard = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        set_from_json("");
        set_bridge_from_json("");
        assert!(
            is_tool_bridge_enabled("brand-new-agent"),
            "an unconfigured agent must get Ryu's tools out of the box"
        );
        assert!(
            is_gateway_routing("brand-new-agent"),
            "new ACP agents must start with governed egress"
        );
    }

    /// The off-switch has to actually reach the sessions it names. Under the
    /// default-ON gate an unreachable key would make the toggle a lie that can
    /// only ever read "on".
    #[test]
    fn explicit_false_withholds_the_bridge_for_that_agent_only() {
        let _guard = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        set_bridge_from_json(r#"{"opted-out": false, "opted-in": true, "off-str": "no"}"#);
        assert!(!is_tool_bridge_enabled("opted-out"));
        assert!(!is_tool_bridge_enabled("off-str"));
        assert!(is_tool_bridge_enabled("opted-in"));
        // The opt-out is per-agent, not a global kill switch.
        assert!(is_tool_bridge_enabled("someone-else"));
    }

    /// The two gates read two different preferences. Writing one must not move
    /// the other in either direction — that independence IS the fix.
    #[test]
    fn the_two_gates_do_not_move_each_other() {
        let _guard = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        set_from_json("");
        set_bridge_from_json("");
        // Opting an agent into egress must not touch its bridge state...
        set_from_json(r#"{"a": true}"#);
        assert!(is_gateway_routing("a"));
        assert!(is_tool_bridge_enabled("a"));
        // ...and opting an agent OUT of the bridge must not change its egress.
        set_bridge_from_json(r#"{"b": false}"#);
        assert!(!is_tool_bridge_enabled("b"));
        assert!(is_gateway_routing("b"));
        // The egress map is untouched by the bridge write.
        assert!(is_gateway_routing("a"));
    }

    /// Every value an existing node can already hold under the OLD single
    /// preference, mapped to what the split must produce. Written as a table so a
    /// future default flip cannot quietly change one row without failing here.
    #[test]
    fn legacy_gateway_routing_values_keep_explicit_opt_outs() {
        let _guard = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        // A node upgrading in place: its `agent-gateway-routing` survives verbatim
        // and `agent-tool-bridge` has never been written.
        set_from_json(r#"{"was-on": true, "was-off": false}"#);
        set_bridge_from_json("");

        // Previously ON  ⇒ egress kept (opted into) AND tools kept. Nothing lost.
        assert!(is_gateway_routing("was-on"));
        assert!(is_tool_bridge_enabled("was-on"));
        // An explicit old false remains a direct-egress opt-out, but tools are
        // still available because the bridge has its own default-on switch.
        assert!(!is_gateway_routing("was-off"));
        assert!(is_tool_bridge_enabled("was-off"));
        // Never configured at all ⇒ governed egress.
        assert!(is_gateway_routing("never-listed"));
        assert!(is_tool_bridge_enabled("never-listed"));
    }

    /// The clear-on-garbage behaviour is deliberately asymmetric: egress returns
    /// to its governed default and the bridge returns to ON (never strip
    /// configured tools on a parse error).
    #[test]
    fn unparseable_preference_returns_to_safe_defaults() {
        let _guard = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        set_from_json(r#"{"x": true}"#);
        set_bridge_from_json(r#"{"x": false}"#);
        assert!(is_gateway_routing("x"));
        assert!(!is_tool_bridge_enabled("x"));

        set_from_json("not json at all");
        set_bridge_from_json("not json at all");
        assert!(is_gateway_routing("x"), "egress clears to its ON default");
        assert!(is_tool_bridge_enabled("x"), "bridge clears to ON");

        set_bridge_from_json("");
        assert!(is_tool_bridge_enabled("x"));
        // A malformed per-agent VALUE is not an opt-out either.
        set_bridge_from_json(r#"{"x": {"nested": "junk"}}"#);
        assert!(is_tool_bridge_enabled("x"));

        // An unreadable per-agent egress value is not an opt-out either.
        set_from_json(r#"{"x": "not-a-boolean"}"#);
        assert!(is_gateway_routing("x"));
    }

    #[test]
    fn smart_route_override_stores_per_agent_config() {
        let _guard = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        set_smart_routes_from_json(
            r#"{"agent-a": {"enabled": true, "rules": [{"description": "x", "model": "m"}]},
                "agent-b": {},
                "agent-c": null}"#,
        );
        // agent-a has a non-empty override → returned verbatim for injection.
        let cfg = smart_route_override("agent-a").expect("override present");
        assert_eq!(cfg["enabled"], serde_json::json!(true));
        // Empty object / null entries are treated as "no override" (global path).
        assert!(smart_route_override("agent-b").is_none());
        assert!(smart_route_override("agent-c").is_none());
        // Unknown agents have no override.
        assert!(smart_route_override("never-seen").is_none());
        // Blank clears everything.
        set_smart_routes_from_json("");
        assert!(smart_route_override("agent-a").is_none());
    }
}
