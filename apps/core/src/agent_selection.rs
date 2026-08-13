//! The canonical "who runs this" selection — one value shape shared by every
//! setting that names an agent/model, plus the node-wide default they fall back
//! to when unset.
//!
//! Before this module every side feature (auto-title, `/btw`, advisor, the
//! plugin host's `sideModel`, context compaction, chat suggestions, …) read its
//! own `*-model` preference holding a bare model id, and each invented its own
//! last-resort fallback. There was no way to say "use *this* for everything I
//! haven't configured individually".
//!
//! ## The value
//!
//! [`AgentSelection`] mirrors what the chat composer's universal picker can
//! express — agent, provider, model, thinking level, reasoning effort, and ACP
//! access (permission) mode — so a settings field and the composer describe a
//! target the same way. It serializes as a JSON object under a single
//! preference key.
//!
//! **Back-compat is permanent**: every one of these preferences already holds a
//! bare model-id string in the wild, so [`AgentSelection::parse`] accepts either
//! a JSON object *or* a bare string (read as `{ model }`). Nothing needs
//! migrating and an older client that writes a bare id keeps working.
//!
//! ## The two resolvers, and why an agent must degrade
//!
//! Consumers are not interchangeable:
//!
//! - **Model-consuming sites** do a raw non-streaming `/v1/chat/completions`
//!   (`call_side_model`). They need a concrete model id and cannot "run an
//!   agent" — [`resolve_side_model`] serves them.
//! - **Agent-consuming sites** (auto-routing fallback, scheduled automations,
//!   channels) want an agent id — [`resolve_agent`] serves them.
//!
//! So an agent-typed selection reaching a model-consuming site MUST degrade to
//! a model rather than pass `"claude"` off as a model id (the gateway would 400
//! and the setting would look silently ignored). The degrade path is explicit
//! in [`model_for_agent`]: the flagship Pi-backed agent resolves to its
//! configured Pi model; an external ACP agent has no chat-completions model
//! Core can borrow, so it falls through to the next link in the chain instead
//! of poisoning the request.
//!
//! ## The chain
//!
//! Every model-consuming site resolves in this order, stopping at the first hit:
//!
//! 1. the feature's own preference (JSON selection, or a legacy bare model id);
//! 2. the node-wide default ([`GLOBAL_SELECTION_PREF`]);
//! 3. the caller's existing last-resort fallback (the resident local engine, an
//!    env var, the bundled default — unchanged, so behaviour with nothing
//!    configured is exactly what it was).

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::server::preferences::PreferencesStore;

/// Preference key holding the node-wide default selection, as JSON.
///
/// Edited in the Gateway (node) settings dialog under "Defaults". Node-scoped
/// on purpose: it is the fallback every user and every plugin on this node
/// inherits, not a per-desktop preference.
pub const GLOBAL_SELECTION_PREF: &str = "default-agent-selection";

/// Pi provider id owning the bundled llama.cpp models. The gateway's built-in
/// prefix rules route `gemma*` ids here (see `pi_config::default_gateway_model`),
/// so this is the provider that pairs with [`crate::registry::DEFAULT_LOCAL_CHAT_MODEL_ID`].
const LOCAL_PROVIDER_ID: &str = "local";

/// What the node-wide default resolves to when nothing has been written yet: the
/// flagship Pi agent on the bundled local Gemma chat model.
///
/// A READ default, not a seeded preference. Seeding writes a value that is then
/// indistinguishable from a deliberate user choice — it survives a "reset to
/// defaults", and it freezes the model id of the day into every profile ever
/// created. Reading through instead means the pair tracks
/// `DEFAULT_LOCAL_CHAT_MODEL_ID` (and its `RYU_LOCAL_CHAT_MODEL_ID` override)
/// forever, and clearing the preference genuinely returns to the default.
///
/// Safe as a default because both halves are always present on a fresh install:
/// `ryu` is the always-installed flagship, and llama.cpp plus this GGUF are
/// fetched unconditionally on first run (see `mesh_host::MESH_PREINSTALL_DEFAULT`
/// for the same argument stated from the other side).
pub fn builtin_default_selection() -> AgentSelection {
    AgentSelection {
        agent_id: FLAGSHIP_AGENT_ID.to_owned(),
        provider: LOCAL_PROVIDER_ID.to_owned(),
        model: crate::registry::ProviderRegistry::load()
            .local_chat_model
            .id,
        ..Default::default()
    }
}

/// The node-wide default selection: what is stored, else
/// [`builtin_default_selection`].
pub async fn load_global(prefs: &PreferencesStore) -> AgentSelection {
    let stored = AgentSelection::load(prefs, GLOBAL_SELECTION_PREF).await;
    if stored.is_empty() {
        builtin_default_selection()
    } else {
        stored
    }
}

/// The flagship agent id (mirrors [`crate::registry::DEFAULT_AGENT_ID`]). It is
/// the one agent Core can resolve to a concrete model, because Core owns its
/// Pi config.
const FLAGSHIP_AGENT_ID: &str = "ryu";

/// A target as the universal picker can express it. Every field is optional —
/// an empty string means "not chosen", and the whole struct empty means "unset"
/// (see [`AgentSelection::is_empty`]), which is what makes the fallback chain
/// work without a sentinel value.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentSelection {
    /// Agent id (`ryu`, an installed external ACP agent, a custom agent).
    #[serde(default)]
    pub agent_id: String,
    /// Pi provider id that owns `model`. UI/routing hint only — the Gateway
    /// routes by model id alone, exactly as the older `*-provider` prefs did.
    #[serde(default)]
    pub provider: String,
    /// Model id, gateway-routable.
    #[serde(default)]
    pub model: String,
    /// Pi thinking level for the picked provider/model.
    #[serde(default)]
    pub thinking_level: String,
    /// Reasoning effort, forwarded as `reasoning_effort`.
    #[serde(default)]
    pub effort: String,
    /// ACP access (permission) mode for an agent-typed selection, e.g.
    /// `acceptEdits`. Carried so an agent-consuming site can start the session
    /// the user configured; model-consuming sites ignore it.
    #[serde(default)]
    pub access_mode: String,
}

impl AgentSelection {
    /// Parse a stored preference value.
    ///
    /// Accepts the JSON object form and — permanently, see the module docs —
    /// a legacy bare model id, which reads as `{ model: <id> }`. Anything
    /// unparseable that is not obviously a model id yields an empty selection
    /// rather than an error: a malformed preference must degrade to "unset",
    /// never break the feature it configures.
    pub fn parse(raw: &str) -> Self {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Self::default();
        }
        if trimmed.starts_with('{') {
            if let Ok(parsed) = serde_json::from_str::<Self>(trimmed) {
                return parsed.trimmed();
            }
            // A JSON-looking blob we can't read is a corrupt setting, not a
            // model id — treat it as unset so the chain moves on.
            return Self::default();
        }
        Self {
            model: trimmed.to_string(),
            ..Default::default()
        }
    }

    /// Read a selection from `key`, or the empty selection when unset/unreadable.
    pub async fn load(prefs: &PreferencesStore, key: &str) -> Self {
        match prefs.get(key).await {
            Ok(Some(raw)) => Self::parse(&raw),
            _ => Self::default(),
        }
    }

    /// Whitespace-trim every field, so `" gpt-5 "` and `"gpt-5"` behave alike
    /// and a field holding only spaces counts as unset.
    fn trimmed(self) -> Self {
        Self {
            agent_id: self.agent_id.trim().to_string(),
            provider: self.provider.trim().to_string(),
            model: self.model.trim().to_string(),
            thinking_level: self.thinking_level.trim().to_string(),
            effort: self.effort.trim().to_string(),
            access_mode: self.access_mode.trim().to_string(),
        }
    }

    /// True when nothing at all is chosen (the fallback chain should continue).
    pub fn is_empty(&self) -> bool {
        self.agent_id.is_empty()
            && self.provider.is_empty()
            && self.model.is_empty()
            && self.thinking_level.is_empty()
            && self.effort.is_empty()
            && self.access_mode.is_empty()
    }

    /// Serialize for storage. Always the JSON object form — writers upgrade the
    /// value in place, readers still accept the legacy bare string.
    pub fn to_pref_value(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| String::new())
    }
}

/// A model-consuming site's resolved target: what to send and how hard to think.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedSideModel {
    /// Model id for the `/v1/chat/completions` call.
    pub model: String,
    /// `reasoning_effort` (empty = the provider's default).
    pub effort: String,
}

/// The concrete model an agent-typed selection stands for, or `None` when Core
/// cannot know it.
///
/// Only the flagship is resolvable: Core owns its Pi config, so "agent `ryu`"
/// genuinely means "whatever model Pi is pointed at". An external ACP agent
/// runs its own model behind its own protocol — there is no id Core could put
/// in a chat-completions body — so this returns `None` and the caller moves to
/// the next link in the chain. Silently sending the agent id as a model would
/// 400 at the gateway and read to the user as "my setting was ignored".
fn model_for_agent(agent_id: &str) -> Option<String> {
    if agent_id != FLAGSHIP_AGENT_ID {
        return None;
    }
    let view = crate::pi_config::current();
    view.model
        .map(|m| m.trim().to_string())
        .filter(|m| !m.is_empty())
}

/// How hard a model-consuming call should think: the explicit `effort`, else the
/// thinking level.
///
/// These are one vocabulary, not two: the effort picker's options ARE Pi's
/// `thinkingLevels` (see the desktop's `SideModelPicker`), and a raw
/// chat-completions call has exactly one knob for it — `reasoning_effort`. So a
/// thinking level chosen from a provider's submenu has to land here, or it would
/// be collected, stored, shown in the trigger, and silently do nothing.
fn effort_of(selection: &AgentSelection) -> String {
    if selection.effort.is_empty() {
        selection.thinking_level.clone()
    } else {
        selection.effort.clone()
    }
}

/// Turn one selection into a model target, degrading an agent-typed pick.
/// `None` means this link of the chain yielded nothing.
fn side_model_from(selection: &AgentSelection) -> Option<ResolvedSideModel> {
    if !selection.model.is_empty() {
        return Some(ResolvedSideModel {
            model: selection.model.clone(),
            effort: effort_of(selection),
        });
    }
    if !selection.agent_id.is_empty() {
        if let Some(model) = model_for_agent(&selection.agent_id) {
            return Some(ResolvedSideModel {
                model,
                effort: effort_of(selection),
            });
        }
        tracing::debug!(
            agent = %selection.agent_id,
            "agent-typed selection has no chat-completions model; falling through"
        );
    }
    None
}

/// Resolve the model + effort for a model-consuming feature.
///
/// `feature_key` is that feature's own preference (e.g. `auto-title-model`);
/// `legacy_effort_key` is its separate pre-existing effort preference (e.g.
/// `auto-title-effort`), still honoured when the selection carries no effort of
/// its own, so an older config keeps working.
///
/// Returns `None` when neither the feature nor the node default names a usable
/// model — the caller then applies its own last-resort fallback unchanged.
pub async fn resolve_side_model(
    prefs: &PreferencesStore,
    feature_key: &str,
    legacy_effort_key: Option<&str>,
) -> Option<ResolvedSideModel> {
    let feature = AgentSelection::load(prefs, feature_key).await;
    let mut resolved = side_model_from(&feature);
    if resolved.is_none() {
        resolved = side_model_from(&load_global(prefs).await);
    }
    let mut resolved = resolved?;
    if resolved.effort.is_empty() {
        if let Some(key) = legacy_effort_key {
            if let Ok(Some(raw)) = prefs.get(key).await {
                resolved.effort = raw.trim().to_string();
            }
        }
    }
    Some(resolved)
}

/// Resolve the agent id for an agent-consuming feature: the feature's own
/// preference, else the node-wide default, else `None` (caller keeps its own
/// default, e.g. the flagship).
///
/// A model-typed selection names no agent, so it contributes nothing here and
/// the chain moves on — the mirror image of [`model_for_agent`]'s degrade.
pub async fn resolve_agent(prefs: &PreferencesStore, feature_key: &str) -> Option<String> {
    let feature = AgentSelection::load(prefs, feature_key).await;
    if !feature.agent_id.is_empty() {
        return Some(feature.agent_id);
    }
    // The snapshot first (it is what a written preference refreshes), then the
    // built-in pair — so an unconfigured node still names the flagship rather
    // than handing every caller back its own ad-hoc default.
    default_agent_id().or_else(|| Some(builtin_default_selection().agent_id))
}

/// In-process snapshot of the node-wide default's `agent_id`.
///
/// Some agent-consuming code runs on a hot, synchronous path with no
/// preference-store handle (agent-auto routing keeps its config in exactly such
/// a snapshot). Rather than thread a store through it, Core seeds this at
/// startup and refreshes it whenever [`GLOBAL_SELECTION_PREF`] is written —
/// the same shape `agent_routing::set_auto_config_from_json` already uses.
fn default_agent_cell() -> &'static std::sync::RwLock<Option<String>> {
    static CELL: std::sync::OnceLock<std::sync::RwLock<Option<String>>> =
        std::sync::OnceLock::new();
    CELL.get_or_init(|| std::sync::RwLock::new(None))
}

/// Refresh the snapshot from a raw preference value. A blank/unparseable value,
/// or a selection that names only a model, clears it — callers then keep their
/// own default rather than inheriting a stale one.
pub fn set_default_selection_from_json(value: &str) {
    let agent = AgentSelection::parse(value).agent_id;
    if let Ok(mut guard) = default_agent_cell().write() {
        *guard = Some(agent).filter(|a| !a.is_empty());
    }
}

/// The node-wide default agent id, if one is configured. Cheap and sync.
pub fn default_agent_id() -> Option<String> {
    default_agent_cell().read().ok().and_then(|g| g.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_legacy_bare_model_id() {
        let s = AgentSelection::parse("gpt-5-mini");
        assert_eq!(s.model, "gpt-5-mini");
        assert!(s.agent_id.is_empty());
        assert!(!s.is_empty());
    }

    #[test]
    fn parses_full_json_selection() {
        let s = AgentSelection::parse(
            r#"{"agent_id":"ryu","provider":"openai","model":"gpt-5","thinking_level":"high","effort":"medium","access_mode":"acceptEdits"}"#,
        );
        assert_eq!(s.agent_id, "ryu");
        assert_eq!(s.provider, "openai");
        assert_eq!(s.model, "gpt-5");
        assert_eq!(s.thinking_level, "high");
        assert_eq!(s.effort, "medium");
        assert_eq!(s.access_mode, "acceptEdits");
    }

    #[test]
    fn partial_json_leaves_other_fields_empty() {
        let s = AgentSelection::parse(r#"{"model":"claude-sonnet-5"}"#);
        assert_eq!(s.model, "claude-sonnet-5");
        assert!(s.effort.is_empty());
        assert!(s.agent_id.is_empty());
    }

    #[test]
    fn blank_and_corrupt_values_read_as_unset() {
        assert!(AgentSelection::parse("").is_empty());
        assert!(AgentSelection::parse("   ").is_empty());
        // JSON-looking but unreadable: a corrupt setting, not a model id.
        assert!(AgentSelection::parse("{not json").is_empty());
    }

    #[test]
    fn json_fields_are_trimmed() {
        let s = AgentSelection::parse(r#"{"model":"  gpt-5  ","effort":"  "}"#);
        assert_eq!(s.model, "gpt-5");
        assert!(s.effort.is_empty());
    }

    #[test]
    fn round_trips_through_pref_value() {
        let s = AgentSelection {
            agent_id: "ryu".into(),
            provider: "openai".into(),
            model: "gpt-5".into(),
            thinking_level: "high".into(),
            effort: "low".into(),
            access_mode: "plan".into(),
        };
        assert_eq!(AgentSelection::parse(&s.to_pref_value()), s);
    }

    #[test]
    fn model_typed_selection_yields_model_and_effort() {
        let s = AgentSelection {
            model: "gpt-5".into(),
            effort: "high".into(),
            ..Default::default()
        };
        let r = side_model_from(&s).expect("model-typed selection resolves");
        assert_eq!(r.model, "gpt-5");
        assert_eq!(r.effort, "high");
    }

    #[test]
    fn external_agent_selection_falls_through_instead_of_sending_agent_id() {
        // The bug this guards: passing "claude" off as a model id.
        let s = AgentSelection {
            agent_id: "claude".into(),
            ..Default::default()
        };
        assert!(side_model_from(&s).is_none());
    }

    #[test]
    fn empty_selection_yields_nothing() {
        assert!(side_model_from(&AgentSelection::default()).is_none());
    }

    #[test]
    fn thinking_level_drives_effort_when_no_explicit_effort() {
        // A thinking level picked from a provider submenu must reach the call —
        // it is the same vocabulary the effort picker offers.
        let s = AgentSelection {
            model: "gpt-5".into(),
            thinking_level: "high".into(),
            ..Default::default()
        };
        assert_eq!(side_model_from(&s).expect("resolves").effort, "high");
    }

    #[test]
    fn explicit_effort_beats_thinking_level() {
        let s = AgentSelection {
            model: "gpt-5".into(),
            thinking_level: "high".into(),
            effort: "low".into(),
            ..Default::default()
        };
        assert_eq!(side_model_from(&s).expect("resolves").effort, "low");
    }

    #[test]
    fn default_agent_snapshot_tracks_the_written_value() {
        set_default_selection_from_json(r#"{"agent_id":"claude"}"#);
        assert_eq!(default_agent_id().as_deref(), Some("claude"));
        // A model-only selection names no agent — callers keep their own default.
        set_default_selection_from_json(r#"{"model":"gpt-5"}"#);
        assert_eq!(default_agent_id(), None);
        set_default_selection_from_json("");
        assert_eq!(default_agent_id(), None);
    }
}
