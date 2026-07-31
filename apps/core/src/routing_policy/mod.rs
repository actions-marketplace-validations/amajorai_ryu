//! Threshold-driven model fallback — "when I'm nearly out of X, run Y instead,
//! and tell me you did it".
//!
//! Ryu already had two *reactive* fallbacks: the Gateway's provider tiers
//! (`ModelRouter::fallback_chain`, which moves after a provider errors or 429s)
//! and its typed `ProviderRateLimited` demotion. Neither can express the thing a
//! user actually wants — *proactive* substitution on a headroom threshold they
//! chose: "under $5 of Ryu credit, drop to the cheap model", "Claude's weekly
//! window under 50%, finish the week on Sonnet". This module is that axis.
//!
//! It is deliberately NOT an extension of `fallback_chain`: that is a startup
//! snapshot (`apps/gateway/src/router/mod.rs`) keyed on *providers* and driven by
//! *errors*, while these rules must be hot-editable and are keyed on *models* and
//! driven by *balances*. Folding one into the other would have meant a restart to
//! change a dollar threshold.
//!
//! ## Why the evaluation lives in Core, not the Gateway
//!
//! The headline constraint of the whole feature: **subscription agents never
//! reach the Gateway**. `acp:claude` / `acp:codex` talk to the vendor directly
//! with the user's own credential (it is exactly why `ryu_usage` has to scrape
//! their windows off disk instead of metering them). A Gateway-only policy engine
//! could therefore enforce nothing at all for the "Claude weekly < 50%" rule that
//! motivated this. Core sees every turn — gateway-routed and ACP alike — so Core
//! is the one place a single rule list can govern both.
//!
//! ## The three signals are three different units, on purpose
//!
//! There is one rule grammar but not one predicate list, because the sources do
//! not report the same kind of number and a shared predicate vocabulary would let
//! the settings UI compose rules that can never evaluate ("Claude subscription
//! below $5"):
//!
//! | Source | Truth we can read | Unit |
//! |---|---|---|
//! | Ryu pooled capacity | the org's prepaid Ryu $ wallet, via the Gateway's post-debit balance | **$ left** |
//! | BYO-key provider | the prepaid balance the inference key itself can query (`ryu_usage::provider_credits` — only OpenRouter / DeepSeek / Moonshot expose one) | **$ left** |
//! | Subscription agent | the vendor's rolling rate-limit windows (`ryu_usage`) | **% left** |
//!
//! [`Condition`] is therefore a tagged enum whose variants carry their own
//! threshold field, and the desktop builds its form from the variant, so an
//! impossible rule is unrepresentable rather than merely discouraged.
//!
//! ## Evaluation is pure
//!
//! Everything here is a pure function over a [`Signals`] snapshot. Reading the
//! signals — with their caches, TTLs and never-refresh constraints — is
//! [`signals`]'s job. That split is what makes the interesting behaviour (which
//! rule wins, the warn band, the degrade when a rule names an unusable target)
//! testable without a network or a credential on disk.

use serde::{Deserialize, Serialize};

use crate::agent_selection::AgentSelection;

pub mod reactive;
pub mod signals;

/// Preference key holding the node's rule list, as JSON ([`RoutingPolicy`]).
///
/// Node-scoped, and edited in the **Gateway (node) settings** dialog rather than
/// registered by an apps-store app. That is a deliberate call: an app-registered
/// settings tab inherits the app's enablement, so disabling the app would either
/// keep swapping models with no UI left to explain why, or stop enforcing rules
/// the user still believes are active. Both are the silent-loss-of-control trap.
/// A kernel section with an empty default rule list is exactly today's behaviour
/// until the user writes a rule.
pub const ROUTING_POLICY_PREF: &str = "routing-fallback-policy";

/// A signal reading, normalized for display in the composer's info bar.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SignalReading {
    /// What was measured ("Ryu credit", "OpenRouter credit", "Claude · Weekly").
    pub label: String,
    /// The measured headroom, in `unit`.
    pub value: f64,
    /// The rule's threshold, same unit — so the bar can say "$3.10 left of $5".
    pub threshold: f64,
    /// `usd` or `percent`.
    pub unit: SignalUnit,
}

/// The unit a [`SignalReading`] is in. Mirrors the split in the table above.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SignalUnit {
    /// US dollars remaining.
    Usd,
    /// Percent of a rolling window still unused (0–100).
    Percent,
}

/// What a rule watches. One variant per signal family, each carrying the
/// threshold in *its own* unit — see the module docs for why this is not one
/// flat `{ metric, op, value }` predicate.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "source", rename_all = "snake_case")]
pub enum Condition {
    /// Ryu's own pooled capacity, billed from the org's prepaid Ryu $ wallet.
    /// The balance is whatever the Gateway last saw on a debit response, so it
    /// is authoritative but only as fresh as the last billed call.
    RyuCredits {
        /// Fire when the wallet holds less than this many dollars.
        below_usd: f64,
    },
    /// A BYO-key provider's prepaid balance. Only the providers
    /// `ryu_usage::supports_provider_credits` accepts can back a rule — every
    /// other vendor exposes no balance to an inference key, so the desktop must
    /// not offer them here.
    ProviderCredits {
        /// Provider id as Core's `models.json` knows it (`openrouter`, …).
        provider_id: String,
        /// Fire when the key's remaining credit is under this many dollars.
        below_usd: f64,
    },
    /// A subscription agent's rolling rate-limit window.
    SubscriptionWindow {
        /// The agent whose windows are read (`acp:claude`, `acp:codex`, …).
        agent_id: String,
        /// Case-insensitive substring of the window's label ("weekly",
        /// "session"). Empty means "whichever window is most consumed", which is
        /// the honest default: vendors name windows differently and a rule that
        /// silently matched nothing would look like a broken setting.
        #[serde(default)]
        window: String,
        /// Restrict to a model-scoped window (Claude's per-model weekly limits).
        /// `None` matches account-wide windows too.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        model: Option<String>,
        /// Fire when less than this percent of the window is left.
        remaining_below_percent: f64,
    },
}

impl Condition {
    /// The agent this condition is *about*, when it is about one. Used to skip
    /// a subscription rule on a turn run by a different agent — reading Claude's
    /// weekly window says nothing about a turn Codex is answering.
    fn subject_agent(&self) -> Option<&str> {
        match self {
            Self::SubscriptionWindow { agent_id, .. } => Some(agent_id.as_str()),
            _ => None,
        }
    }
}

/// One user-written rule.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FallbackRule {
    /// Stable id, so the info bar can say *which* rule spoke and the settings UI
    /// can reorder without losing identity.
    pub id: String,
    /// Off keeps the rule in the list, editable, but inert.
    #[serde(default = "yes")]
    pub enabled: bool,
    /// The threshold being watched.
    pub when: Condition,
    /// What to run instead. Reuses [`AgentSelection`] — the same value the
    /// composer's universal picker produces — so the settings field is the
    /// existing `agent_picker` rather than a bespoke model dropdown.
    ///
    /// An **empty** selection is legal and means *notify only*: warn me, change
    /// nothing. That is the setting a user reaches for first, before they trust
    /// the thing to rewrite their turns.
    ///
    /// Named `fallback` rather than the obvious `then` because this struct
    /// crosses into JavaScript, where an object carrying a `then` key is treated
    /// as a promise by `await` — a rule list would silently mis-resolve.
    #[serde(default)]
    pub fallback: AgentSelection,
    /// Only apply on turns run by these agents. Empty = any agent.
    #[serde(default)]
    pub applies_to_agents: Vec<String>,
    /// Surface this rule in the composer's info bar when it fires. A rule that
    /// swaps models silently is the thing users file bugs about, so this
    /// defaults on.
    #[serde(default = "yes")]
    pub notify: bool,
}

fn yes() -> bool {
    true
}

/// The node's ordered rule list.
///
/// **First match wins.** Order is the user's priority statement and is preserved
/// verbatim; there is no scoring, no "most specific rule", no attempt to merge
/// two rules that both fired. A cheaper resolution rule would be defensible, but
/// not one anybody could predict from looking at the list.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct RoutingPolicy {
    #[serde(default)]
    pub rules: Vec<FallbackRule>,
}

impl RoutingPolicy {
    /// Parse a stored preference value. An unreadable value yields an EMPTY
    /// policy, never an error: a corrupt setting must degrade to "no rules"
    /// (today's behaviour) rather than break every turn on the node.
    pub fn parse(raw: &str) -> Self {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Self::default();
        }
        serde_json::from_str(trimmed).unwrap_or_else(|e| {
            tracing::warn!(error = %e, "routing policy is unreadable; treating as no rules");
            Self::default()
        })
    }

    /// Serialize for storage.
    pub fn to_pref_value(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }

    /// True when no enabled rule exists — the fast path that skips signal reads
    /// entirely, so a node that never configured this pays nothing per turn.
    pub fn is_inert(&self) -> bool {
        !self.rules.iter().any(|r| r.enabled)
    }

    /// The signal families the enabled rules actually need, so the caller reads
    /// only those. A node with one Claude rule must not trigger a wallet lookup.
    pub fn required_signals(&self) -> RequiredSignals {
        let mut required = RequiredSignals::default();
        for rule in self.rules.iter().filter(|r| r.enabled) {
            match &rule.when {
                Condition::RyuCredits { .. } => required.ryu_credits = true,
                Condition::ProviderCredits { provider_id, .. } => {
                    if !required.providers.contains(provider_id) {
                        required.providers.push(provider_id.clone());
                    }
                }
                Condition::SubscriptionWindow { agent_id, .. } => {
                    if !required.agents.contains(agent_id) {
                        required.agents.push(agent_id.clone());
                    }
                }
            }
        }
        required
    }
}

/// Which signals an evaluation will actually consult.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RequiredSignals {
    pub ryu_credits: bool,
    pub providers: Vec<String>,
    pub agents: Vec<String>,
}

/// One rolling window, flattened out of `ryu_usage::UsageWindow` so this module
/// stays a pure value-level thing that tests can construct by hand.
#[derive(Debug, Clone, PartialEq)]
pub struct WindowReading {
    pub label: String,
    /// Set only for a model-scoped window (Claude's per-model weekly limits).
    pub model: Option<String>,
    /// Percent of the cap consumed, 0–100.
    pub used_percent: f64,
}

/// A point-in-time read of every signal the policy might consult. Missing
/// entries mean "not known right now" and make their rules **abstain** — a rule
/// never fires on an absent signal, because "I couldn't reach the balance
/// endpoint" must not read as "you are out of money".
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Signals {
    /// Dollars left in the org's Ryu $ wallet.
    pub ryu_credits_usd: Option<f64>,
    /// Dollars left on a BYO-key provider's prepaid balance, by provider id.
    pub provider_credits_usd: Vec<(String, f64)>,
    /// Subscription windows by agent id.
    pub subscription_windows: Vec<(String, Vec<WindowReading>)>,
}

impl Signals {
    fn provider_credit(&self, provider_id: &str) -> Option<f64> {
        self.provider_credits_usd
            .iter()
            .find(|(id, _)| id.eq_ignore_ascii_case(provider_id))
            .map(|(_, usd)| *usd)
    }

    fn windows_for(&self, agent_id: &str) -> Option<&[WindowReading]> {
        self.subscription_windows
            .iter()
            .find(|(id, _)| id.eq_ignore_ascii_case(agent_id))
            .map(|(_, w)| w.as_slice())
    }
}

/// How loudly a verdict speaks. Ordered least → most consequential; the
/// evaluator keeps the highest it reaches, mirroring the fixed priority the
/// sandbox billing verdict already uses (`apps/gateway/src/api/sandbox.rs`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    /// Nothing to say. The turn runs exactly as picked.
    Continue,
    /// Approaching a threshold, or a notify-only rule fired. Nothing was
    /// changed.
    Warn,
    /// A rule fired and the turn's target was rewritten.
    Swap,
}

/// The agent/model a turn is aimed at.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Target {
    pub agent_id: String,
    /// Model id. For an ACP agent this is the per-turn session model pin
    /// (`ChatStreamRequest::acp_model`); for the OpenAI-compat route it is the
    /// gateway-routable model id. Empty means "whatever the agent's binding
    /// says", which a rule can still replace.
    pub model: String,
    /// Whether this turn would open a conversation rather than continue one.
    ///
    /// Gates the heavier kind of swap. Changing the *model* is safe at any point
    /// in a thread; changing the *agent* is not — an ACP agent owns its own
    /// session state, so moving mid-thread silently abandons the conversation the
    /// user is looking at. Off a conversation start, an agent-typed rule
    /// therefore degrades to a warning instead of firing.
    ///
    /// It lives on `Target`, evaluated inside [`evaluate`], because BOTH callers
    /// have to reach the same verdict: the turn path applies it, and the composer
    /// info bar predicts it. With the gate implemented only in the turn path, the
    /// bar would announce a switch that never happened.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub at_conversation_start: bool,
}

/// The verdict for one turn: what to run, and what to tell the user.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Advice {
    pub severity: Severity,
    /// What the user picked.
    pub original: Target,
    /// What should actually run. Equal to `original` unless `severity == Swap`.
    pub effective: Target,
    /// The rule that spoke, when one did.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rule_id: Option<String>,
    /// A finished sentence for the info bar.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// The number behind the verdict, so the bar can show it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signal: Option<SignalReading>,
}

impl Advice {
    /// The no-op verdict.
    pub fn unchanged(target: Target) -> Self {
        Self {
            severity: Severity::Continue,
            original: target.clone(),
            effective: target,
            rule_id: None,
            reason: None,
            signal: None,
        }
    }

    /// Whether the caller must rewrite the turn.
    pub fn swaps(&self) -> bool {
        self.severity == Severity::Swap
    }
}

/// How close to a threshold counts as "about to bite". A window at 45% left
/// against a 40% rule warns; the same window against a 5% rule does not.
///
/// Expressed as a multiple of the threshold rather than a fixed margin because
/// the two units have no common scale — 1.5 × $5 and 1.5 × 40% are both "half
/// again as much headroom as the rule wants", while "+10" would be a rounding
/// error in dollars and a third of a window in percent.
const WARN_BAND: f64 = 1.5;

/// Evaluate the policy for one turn.
///
/// Rules are tried in order and the FIRST one that fires wins (see
/// [`RoutingPolicy`]). A rule that is merely *close* to firing records a warning
/// and evaluation continues — a real swap further down the list should still
/// beat an earlier near-miss, or the info bar would announce "getting low" while
/// quietly leaving a fired rule unapplied.
pub fn evaluate(policy: &RoutingPolicy, signals: &Signals, target: &Target) -> Advice {
    let mut best = Advice::unchanged(target.clone());

    for rule in policy.rules.iter().filter(|r| r.enabled) {
        if !rule_applies_to(rule, target) {
            continue;
        }
        let Some(reading) = read_signal(&rule.when, signals) else {
            // Signal unknown → abstain. Never treat "unreadable" as "empty".
            continue;
        };

        if reading.value < reading.threshold {
            let advice = fire(rule, target, reading);
            if advice.severity >= best.severity {
                // `>=` not `>`: among equally-severe verdicts the FIRST rule in
                // the list must win, and `best` starts at the lowest severity, so
                // a later equal never displaces an earlier one... except when
                // `best` is still the untouched `Continue` placeholder.
                if best.severity == Severity::Continue || advice.severity > best.severity {
                    best = advice;
                }
            }
            if best.severity == Severity::Swap {
                // Nothing later can outrank a swap, and running the turn on two
                // different fallbacks is not a thing.
                break;
            }
        } else if reading.value < reading.threshold * WARN_BAND
            && rule.notify
            && best.severity == Severity::Continue
        {
            best = Advice {
                severity: Severity::Warn,
                original: target.clone(),
                effective: target.clone(),
                reason: Some(approaching_sentence(rule, &reading)),
                rule_id: Some(rule.id.clone()),
                signal: Some(reading),
            };
        }
    }

    best
}

/// Load the node's policy, read whatever signals it needs, and judge one turn.
///
/// The whole path is short-circuited by [`RoutingPolicy::is_inert`], so a node
/// that has never written a rule pays one preference read per turn and touches
/// no vendor endpoint at all.
pub async fn advice_for_turn(
    prefs: &crate::server::preferences::PreferencesStore,
    target: &Target,
) -> Advice {
    let policy = load(prefs).await;
    if policy.is_inert() {
        return Advice::unchanged(target.clone());
    }
    let signals = signals::collect(&policy.required_signals()).await;
    evaluate(&policy, &signals, target)
}

/// Read the node's rule list.
pub async fn load(prefs: &crate::server::preferences::PreferencesStore) -> RoutingPolicy {
    match prefs.get(ROUTING_POLICY_PREF).await {
        Ok(Some(raw)) => RoutingPolicy::parse(&raw),
        _ => RoutingPolicy::default(),
    }
}

/// Does this rule govern this turn at all?
fn rule_applies_to(rule: &FallbackRule, target: &Target) -> bool {
    if !rule.applies_to_agents.is_empty()
        && !rule
            .applies_to_agents
            .iter()
            .any(|a| a.eq_ignore_ascii_case(&target.agent_id))
    {
        return false;
    }
    // A subscription rule is about one agent's own plan; it says nothing about a
    // turn another agent is running.
    match rule.when.subject_agent() {
        Some(subject) => subject.eq_ignore_ascii_case(&target.agent_id),
        None => true,
    }
}

/// Turn a fired rule into a verdict, degrading to a warning when the rule's
/// target cannot actually be applied.
fn fire(rule: &FallbackRule, target: &Target, reading: SignalReading) -> Advice {
    let effective = effective_target(rule, target);
    let switches_agent = !effective.agent_id.eq_ignore_ascii_case(&target.agent_id);
    if switches_agent && !target.at_conversation_start {
        // The rule is right but the moment is wrong — see `Target::at_conversation_start`.
        return Advice {
            severity: Severity::Warn,
            original: target.clone(),
            effective: target.clone(),
            reason: Some(held_back_sentence(&reading, &effective.agent_id)),
            rule_id: Some(rule.id.clone()),
            signal: Some(reading),
        };
    }
    // Two ways a fired rule ends up notify-only: the user wrote no target, or
    // the target it names is what is already running. Announcing a swap that
    // changed nothing is worse than saying "you're low" plainly.
    if effective == *target {
        return Advice {
            severity: Severity::Warn,
            original: target.clone(),
            effective,
            reason: Some(fired_sentence(rule, &reading, None)),
            rule_id: Some(rule.id.clone()),
            signal: Some(reading),
        };
    }
    Advice {
        severity: Severity::Swap,
        original: target.clone(),
        reason: Some(fired_sentence(rule, &reading, Some(&effective))),
        effective,
        rule_id: Some(rule.id.clone()),
        signal: Some(reading),
    }
}

/// Apply a rule's [`AgentSelection`] over the turn's target.
///
/// A selection that names only a model swaps the model and KEEPS the agent —
/// that is the common, safe case, and the one the ACP plane supports natively
/// (`session/set_model` via `ChatStreamRequest::acp_model`). A selection naming a
/// different agent replaces both, which is a heavier move: an ACP agent owns its
/// own thread state, so switching vendors mid-conversation starts a new session.
/// The rule model allows it; the caller decides whether the turn is at a
/// boundary where that is acceptable (see `crate::routing_policy::signals`
/// consumers).
fn effective_target(rule: &FallbackRule, target: &Target) -> Target {
    let mut effective = target.clone();
    if !rule.fallback.agent_id.is_empty() {
        effective.agent_id = rule.fallback.agent_id.clone();
        // A new agent invalidates a model pinned for the old one.
        effective.model = String::new();
    }
    if !rule.fallback.model.is_empty() {
        effective.model = rule.fallback.model.clone();
    }
    effective
}

/// Read the one number a condition cares about, or `None` when the signal is
/// not currently known.
fn read_signal(condition: &Condition, signals: &Signals) -> Option<SignalReading> {
    match condition {
        Condition::RyuCredits { below_usd } => Some(SignalReading {
            label: "Ryu credit".to_string(),
            value: signals.ryu_credits_usd?,
            threshold: *below_usd,
            unit: SignalUnit::Usd,
        }),
        Condition::ProviderCredits {
            provider_id,
            below_usd,
        } => Some(SignalReading {
            label: format!("{provider_id} credit"),
            value: signals.provider_credit(provider_id)?,
            threshold: *below_usd,
            unit: SignalUnit::Usd,
        }),
        Condition::SubscriptionWindow {
            agent_id,
            window,
            model,
            remaining_below_percent,
        } => {
            let windows = signals.windows_for(agent_id)?;
            let matched = pick_window(windows, window, model.as_deref())?;
            Some(SignalReading {
                label: format!("{} · {}", short_agent(agent_id), matched.label),
                // Rules are written in "how much is LEFT", vendors report "how
                // much is USED". Converting here (rather than at every call site)
                // is what keeps the rule text and the info bar in one vocabulary.
                value: (100.0 - matched.used_percent).clamp(0.0, 100.0),
                threshold: *remaining_below_percent,
                unit: SignalUnit::Percent,
            })
        }
    }
}

/// Choose the window a subscription rule is about.
///
/// With a label filter: the first case-insensitive substring match. Without one:
/// the MOST consumed window, because "I'm running out" is a statement about
/// whichever limit bites first, and vendors disagree on how many windows they
/// report and what they call them.
fn pick_window<'a>(
    windows: &'a [WindowReading],
    label_filter: &str,
    model_filter: Option<&str>,
) -> Option<&'a WindowReading> {
    let candidates = windows.iter().filter(|w| {
        let label_ok = label_filter.is_empty()
            || w.label
                .to_ascii_lowercase()
                .contains(&label_filter.to_ascii_lowercase());
        let model_ok = match model_filter {
            Some(m) => w
                .model
                .as_deref()
                .is_some_and(|wm| wm.eq_ignore_ascii_case(m)),
            None => true,
        };
        label_ok && model_ok
    });
    if label_filter.is_empty() {
        candidates.max_by(|a, b| {
            a.used_percent
                .partial_cmp(&b.used_percent)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
    } else {
        candidates.take(1).next()
    }
}

/// `acp:claude` → `Claude`, for a sentence a human reads.
fn short_agent(agent_id: &str) -> String {
    let bare = agent_id.rsplit(':').next().unwrap_or(agent_id);
    let mut chars = bare.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => bare.to_string(),
    }
}

fn format_reading(reading: &SignalReading) -> String {
    match reading.unit {
        SignalUnit::Usd => format!("${:.2}", reading.value),
        SignalUnit::Percent => format!("{:.0}%", reading.value),
    }
}

fn format_threshold(reading: &SignalReading) -> String {
    match reading.unit {
        SignalUnit::Usd => format!("${:.2}", reading.threshold),
        SignalUnit::Percent => format!("{:.0}%", reading.threshold),
    }
}

fn fired_sentence(
    rule: &FallbackRule,
    reading: &SignalReading,
    swapped_to: Option<&Target>,
) -> String {
    let head = format!(
        "{} is at {} (under your {} rule)",
        reading.label,
        format_reading(reading),
        format_threshold(reading)
    );
    match swapped_to {
        Some(target) => {
            let name = if target.model.is_empty() {
                target.agent_id.clone()
            } else {
                target.model.clone()
            };
            format!("{head} — running this turn on {name}.")
        }
        None => {
            let _ = rule;
            format!("{head}.")
        }
    }
}

/// A cross-agent rule that fired outside a conversation start. Says what will
/// happen and when, rather than claiming a switch that is not being made.
fn held_back_sentence(reading: &SignalReading, agent_id: &str) -> String {
    format!(
        "{} is at {} — new conversations will start on {}.",
        reading.label,
        format_reading(reading),
        short_agent(agent_id)
    )
}

fn approaching_sentence(rule: &FallbackRule, reading: &SignalReading) -> String {
    let _ = rule;
    format!(
        "{} is at {}, approaching your {} fallback.",
        reading.label,
        format_reading(reading),
        format_threshold(reading)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model_rule(id: &str, when: Condition, model: &str) -> FallbackRule {
        FallbackRule {
            id: id.to_string(),
            enabled: true,
            when,
            fallback: AgentSelection {
                model: model.to_string(),
                ..Default::default()
            },
            applies_to_agents: Vec::new(),
            notify: true,
        }
    }

    fn claude_turn() -> Target {
        Target {
            agent_id: "acp:claude".to_string(),
            model: "opus".to_string(),
            at_conversation_start: true,
        }
    }

    #[test]
    fn empty_policy_is_inert_and_changes_nothing() {
        let policy = RoutingPolicy::default();
        assert!(policy.is_inert());
        let advice = evaluate(&policy, &Signals::default(), &claude_turn());
        assert_eq!(advice.severity, Severity::Continue);
        assert_eq!(advice.effective, claude_turn());
    }

    #[test]
    fn disabled_rules_do_not_fire_and_do_not_request_signals() {
        let mut rule = model_rule("r1", Condition::RyuCredits { below_usd: 5.0 }, "cheap");
        rule.enabled = false;
        let policy = RoutingPolicy { rules: vec![rule] };
        assert!(policy.is_inert());
        assert_eq!(policy.required_signals(), RequiredSignals::default());
        let signals = Signals {
            ryu_credits_usd: Some(0.10),
            ..Default::default()
        };
        assert_eq!(
            evaluate(&policy, &signals, &claude_turn()).severity,
            Severity::Continue
        );
    }

    #[test]
    fn ryu_credit_below_threshold_swaps_the_model() {
        let policy = RoutingPolicy {
            rules: vec![model_rule(
                "r1",
                Condition::RyuCredits { below_usd: 5.0 },
                "cheap-model",
            )],
        };
        let signals = Signals {
            ryu_credits_usd: Some(3.10),
            ..Default::default()
        };
        let advice = evaluate(&policy, &signals, &claude_turn());
        assert_eq!(advice.severity, Severity::Swap);
        assert_eq!(advice.effective.model, "cheap-model");
        // The agent is untouched — a model-only selection swaps the model.
        assert_eq!(advice.effective.agent_id, "acp:claude");
        assert!(advice.reason.as_deref().unwrap().contains("$3.10"));
    }

    #[test]
    fn an_unknown_signal_makes_the_rule_abstain() {
        let policy = RoutingPolicy {
            rules: vec![model_rule(
                "r1",
                Condition::RyuCredits { below_usd: 5.0 },
                "cheap-model",
            )],
        };
        // Balance not readable right now — must NOT read as "out of money".
        let advice = evaluate(&policy, &Signals::default(), &claude_turn());
        assert_eq!(advice.severity, Severity::Continue);
    }

    #[test]
    fn subscription_rule_reads_remaining_not_used() {
        // 60% used ⇒ 40% left ⇒ fires a "under 50% left" rule.
        let policy = RoutingPolicy {
            rules: vec![model_rule(
                "weekly",
                Condition::SubscriptionWindow {
                    agent_id: "acp:claude".to_string(),
                    window: "weekly".to_string(),
                    model: None,
                    remaining_below_percent: 50.0,
                },
                "sonnet",
            )],
        };
        let signals = Signals {
            subscription_windows: vec![(
                "acp:claude".to_string(),
                vec![
                    WindowReading {
                        label: "Session".to_string(),
                        model: None,
                        used_percent: 10.0,
                    },
                    WindowReading {
                        label: "Weekly".to_string(),
                        model: None,
                        used_percent: 60.0,
                    },
                ],
            )],
            ..Default::default()
        };
        let advice = evaluate(&policy, &signals, &claude_turn());
        assert_eq!(advice.severity, Severity::Swap);
        assert_eq!(advice.effective.model, "sonnet");
        assert_eq!(advice.signal.as_ref().unwrap().value, 40.0);
        assert!(advice
            .reason
            .as_deref()
            .unwrap()
            .contains("Claude · Weekly"));
    }

    #[test]
    fn subscription_rule_is_scoped_to_its_own_agent() {
        let policy = RoutingPolicy {
            rules: vec![model_rule(
                "weekly",
                Condition::SubscriptionWindow {
                    agent_id: "acp:claude".to_string(),
                    window: String::new(),
                    model: None,
                    remaining_below_percent: 50.0,
                },
                "sonnet",
            )],
        };
        let signals = Signals {
            subscription_windows: vec![(
                "acp:claude".to_string(),
                vec![WindowReading {
                    label: "Weekly".to_string(),
                    model: None,
                    used_percent: 99.0,
                }],
            )],
            ..Default::default()
        };
        // A Codex turn must not be rerouted because Claude's week is spent.
        let codex_turn = Target {
            agent_id: "acp:codex".to_string(),
            model: "gpt-5.1-codex".to_string(),
            at_conversation_start: true,
        };
        assert_eq!(
            evaluate(&policy, &signals, &codex_turn).severity,
            Severity::Continue
        );
    }

    #[test]
    fn empty_window_filter_picks_the_most_consumed_window() {
        let policy = RoutingPolicy {
            rules: vec![model_rule(
                "any",
                Condition::SubscriptionWindow {
                    agent_id: "acp:claude".to_string(),
                    window: String::new(),
                    model: None,
                    remaining_below_percent: 20.0,
                },
                "sonnet",
            )],
        };
        let signals = Signals {
            subscription_windows: vec![(
                "acp:claude".to_string(),
                vec![
                    WindowReading {
                        label: "Session".to_string(),
                        model: None,
                        used_percent: 95.0,
                    },
                    WindowReading {
                        label: "Weekly".to_string(),
                        model: None,
                        used_percent: 5.0,
                    },
                ],
            )],
            ..Default::default()
        };
        let advice = evaluate(&policy, &signals, &claude_turn());
        assert_eq!(advice.severity, Severity::Swap);
        assert!(advice.reason.as_deref().unwrap().contains("Session"));
    }

    #[test]
    fn model_scoped_window_is_matched_by_model() {
        let policy = RoutingPolicy {
            rules: vec![model_rule(
                "opus-weekly",
                Condition::SubscriptionWindow {
                    agent_id: "acp:claude".to_string(),
                    window: String::new(),
                    model: Some("opus".to_string()),
                    remaining_below_percent: 30.0,
                },
                "sonnet",
            )],
        };
        let signals = Signals {
            subscription_windows: vec![(
                "acp:claude".to_string(),
                vec![
                    // Account-wide window is fine; only the Opus one is spent.
                    WindowReading {
                        label: "Weekly".to_string(),
                        model: None,
                        used_percent: 5.0,
                    },
                    WindowReading {
                        label: "Opus".to_string(),
                        model: Some("opus".to_string()),
                        used_percent: 90.0,
                    },
                ],
            )],
            ..Default::default()
        };
        let advice = evaluate(&policy, &signals, &claude_turn());
        assert_eq!(advice.severity, Severity::Swap);
        assert_eq!(advice.effective.model, "sonnet");
    }

    #[test]
    fn notify_only_rule_warns_without_changing_the_turn() {
        let mut rule = model_rule("warn", Condition::RyuCredits { below_usd: 5.0 }, "");
        rule.fallback = AgentSelection::default();
        let policy = RoutingPolicy { rules: vec![rule] };
        let signals = Signals {
            ryu_credits_usd: Some(1.0),
            ..Default::default()
        };
        let advice = evaluate(&policy, &signals, &claude_turn());
        assert_eq!(advice.severity, Severity::Warn);
        assert_eq!(advice.effective, claude_turn());
    }

    #[test]
    fn a_rule_naming_the_running_model_warns_instead_of_claiming_a_swap() {
        let policy = RoutingPolicy {
            rules: vec![model_rule(
                "self",
                Condition::RyuCredits { below_usd: 5.0 },
                "opus",
            )],
        };
        let signals = Signals {
            ryu_credits_usd: Some(1.0),
            ..Default::default()
        };
        let advice = evaluate(&policy, &signals, &claude_turn());
        assert_eq!(advice.severity, Severity::Warn);
        assert_eq!(advice.effective, claude_turn());
    }

    #[test]
    fn approaching_a_threshold_warns_but_a_later_firing_rule_still_wins() {
        let policy = RoutingPolicy {
            rules: vec![
                // $7.50 left, threshold $5 → inside the 1.5× warn band.
                model_rule("near", Condition::RyuCredits { below_usd: 5.0 }, "cheap"),
                model_rule(
                    "fired",
                    Condition::ProviderCredits {
                        provider_id: "openrouter".to_string(),
                        below_usd: 2.0,
                    },
                    "backup",
                ),
            ],
        };
        let signals = Signals {
            ryu_credits_usd: Some(7.0),
            provider_credits_usd: vec![("openrouter".to_string(), 0.5)],
            ..Default::default()
        };
        let advice = evaluate(&policy, &signals, &claude_turn());
        assert_eq!(advice.severity, Severity::Swap);
        assert_eq!(advice.rule_id.as_deref(), Some("fired"));
    }

    #[test]
    fn first_matching_rule_wins() {
        let policy = RoutingPolicy {
            rules: vec![
                model_rule("first", Condition::RyuCredits { below_usd: 5.0 }, "a"),
                model_rule("second", Condition::RyuCredits { below_usd: 5.0 }, "b"),
            ],
        };
        let signals = Signals {
            ryu_credits_usd: Some(1.0),
            ..Default::default()
        };
        let advice = evaluate(&policy, &signals, &claude_turn());
        assert_eq!(advice.rule_id.as_deref(), Some("first"));
        assert_eq!(advice.effective.model, "a");
    }

    #[test]
    fn applies_to_agents_scopes_a_wallet_rule() {
        let mut rule = model_rule("r", Condition::RyuCredits { below_usd: 5.0 }, "cheap");
        rule.applies_to_agents = vec!["ryu".to_string()];
        let policy = RoutingPolicy { rules: vec![rule] };
        let signals = Signals {
            ryu_credits_usd: Some(1.0),
            ..Default::default()
        };
        assert_eq!(
            evaluate(&policy, &signals, &claude_turn()).severity,
            Severity::Continue
        );
        let ryu_turn = Target {
            agent_id: "ryu".to_string(),
            model: "big".to_string(),
            at_conversation_start: true,
        };
        assert_eq!(
            evaluate(&policy, &signals, &ryu_turn).severity,
            Severity::Swap
        );
    }

    #[test]
    fn agent_typed_target_replaces_the_agent_and_clears_the_model_pin() {
        let rule = FallbackRule {
            id: "cross".to_string(),
            enabled: true,
            when: Condition::RyuCredits { below_usd: 5.0 },
            fallback: AgentSelection {
                agent_id: "acp:codex".to_string(),
                ..Default::default()
            },
            applies_to_agents: Vec::new(),
            notify: true,
        };
        let policy = RoutingPolicy { rules: vec![rule] };
        let signals = Signals {
            ryu_credits_usd: Some(1.0),
            ..Default::default()
        };
        let advice = evaluate(&policy, &signals, &claude_turn());
        assert_eq!(advice.severity, Severity::Swap);
        assert_eq!(advice.effective.agent_id, "acp:codex");
        assert!(advice.effective.model.is_empty());
    }

    #[test]
    fn cross_agent_swap_is_held_back_mid_conversation() {
        let rule = FallbackRule {
            id: "cross".to_string(),
            enabled: true,
            when: Condition::RyuCredits { below_usd: 5.0 },
            fallback: AgentSelection {
                agent_id: "acp:codex".to_string(),
                ..Default::default()
            },
            applies_to_agents: Vec::new(),
            notify: true,
        };
        let policy = RoutingPolicy { rules: vec![rule] };
        let signals = Signals {
            ryu_credits_usd: Some(1.0),
            ..Default::default()
        };
        let mid_thread = Target {
            at_conversation_start: false,
            ..claude_turn()
        };
        let advice = evaluate(&policy, &signals, &mid_thread);
        // The thread keeps its agent (and so its session), but the user is told.
        assert_eq!(advice.severity, Severity::Warn);
        assert_eq!(advice.effective, mid_thread);
        assert!(advice
            .reason
            .as_deref()
            .unwrap()
            .contains("new conversations"));
    }

    #[test]
    fn a_model_only_swap_still_applies_mid_conversation() {
        let policy = RoutingPolicy {
            rules: vec![model_rule(
                "cheap",
                Condition::RyuCredits { below_usd: 5.0 },
                "cheap-model",
            )],
        };
        let signals = Signals {
            ryu_credits_usd: Some(1.0),
            ..Default::default()
        };
        let advice = evaluate(
            &policy,
            &signals,
            &Target {
                at_conversation_start: false,
                ..claude_turn()
            },
        );
        assert_eq!(advice.severity, Severity::Swap);
        assert_eq!(advice.effective.model, "cheap-model");
    }

    #[test]
    fn required_signals_lists_only_what_enabled_rules_need() {
        let policy = RoutingPolicy {
            rules: vec![
                model_rule(
                    "a",
                    Condition::SubscriptionWindow {
                        agent_id: "acp:claude".to_string(),
                        window: String::new(),
                        model: None,
                        remaining_below_percent: 10.0,
                    },
                    "sonnet",
                ),
                model_rule(
                    "b",
                    Condition::ProviderCredits {
                        provider_id: "openrouter".to_string(),
                        below_usd: 1.0,
                    },
                    "x",
                ),
            ],
        };
        let required = policy.required_signals();
        assert!(!required.ryu_credits);
        assert_eq!(required.agents, vec!["acp:claude".to_string()]);
        assert_eq!(required.providers, vec!["openrouter".to_string()]);
    }

    #[test]
    fn corrupt_policy_json_degrades_to_no_rules() {
        assert_eq!(RoutingPolicy::parse("{not json"), RoutingPolicy::default());
        assert_eq!(RoutingPolicy::parse(""), RoutingPolicy::default());
    }

    #[test]
    fn policy_round_trips_through_the_preference_value() {
        let policy = RoutingPolicy {
            rules: vec![model_rule(
                "r",
                Condition::SubscriptionWindow {
                    agent_id: "acp:claude".to_string(),
                    window: "weekly".to_string(),
                    model: Some("opus".to_string()),
                    remaining_below_percent: 50.0,
                },
                "sonnet",
            )],
        };
        let raw = policy.to_pref_value();
        assert!(raw.contains("\"source\":\"subscription_window\""));
        assert_eq!(RoutingPolicy::parse(&raw), policy);
    }
}
