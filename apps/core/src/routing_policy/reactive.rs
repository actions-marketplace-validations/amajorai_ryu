//! Reactive failover — "my agent just hit its cap; run this turn on whichever
//! plan still has room, and if none does, tell me which window opens first."
//!
//! The sibling of this module's parent. [`super`] is **proactive**: the user
//! writes a rule ("Claude weekly under 50% → Sonnet") and it fires *before* the
//! turn on a threshold they chose. This is **reactive**: nobody writes a rule,
//! the turn has already failed, and the question is not "which rule matches" but
//! "of every plan I am paying for, which one can answer right now".
//!
//! That is a different decision, so it is a different function. It deliberately
//! does NOT route through [`super::evaluate`]:
//!
//! - `evaluate` degrades any agent-typed rule to a `Warn` unless
//!   [`super::Target::at_conversation_start`], because moving agents mid-thread
//!   abandons the vendor-side session an ACP agent owns. A retry is mid-thread
//!   *by definition*, so reusing that path would make this feature a permanent
//!   no-op.
//! - The trade is genuinely different on this path: the turn **failed**, so
//!   there is no answer to abandon. What is lost is the vendor's own session
//!   continuity — the retry continues from the flattened replay Ryu assembles
//!   (`build_acp_prompt`), not from the agent's server-side thread. That is a
//!   real downgrade, which is why it is opt-in and always announced.
//!
//! ## The error is the trigger; `ryu_usage` is the authority
//!
//! A vendor CLI reports "you have hit your 5-hour limit" in prose that differs
//! per vendor and changes without notice, so classifying on the message text
//! would rot silently and — worse — would reroute turns that failed for some
//! unrelated reason. Instead any turn error makes us go *look*: re-read the
//! agent's own windows and only call it a limit hit when a window that gates
//! this turn is genuinely at its cap. The gateway plane has a typed signal
//! (HTTP 429 + `provider_rate_limited` / `rate_limit_exceeded`) and uses it,
//! but still confirms the same way when the agent has readable windows.
//!
//! The read here is **uncached** on purpose. [`super::signals`] serves windows
//! from a 5-minute stale-while-revalidate cache, which is right for a per-turn
//! proactive check and exactly wrong here: a stale snapshot saying "you have
//! room" is what let the turn fail in the first place. This path runs only on a
//! failure, so one fresh vendor call is affordable.
//!
//! ## What is not here
//!
//! Waiting out a window and resuming the turn later. The scheduler has no
//! one-shot-at-an-absolute-time [`Schedule`] and `JobTarget::Agent` starts a
//! *fresh* turn rather than resuming a conversation, so "retry at 14:05 when the
//! weekly rolls over" is a second feature, not a flag on this one. When no plan
//! has room, [`Verdict::Wait`] reports the soonest reset and stops there.
//!
//! [`Schedule`]: crate::scheduler::store::Schedule

use serde::{Deserialize, Serialize};

/// Preference key holding the node's reactive failover config, as JSON
/// ([`RetryPolicy`]).
///
/// Node-scoped and edited in the **Gateway (node) settings** dialog, right next
/// to [`super::ROUTING_POLICY_PREF`] — and for the same reason spelled out
/// there: a settings tab registered by an App inherits that App's enablement, so
/// disabling the App would leave turns still being rerouted with no UI left to
/// explain why, or would silently stop a failover the user still believes is
/// armed. Retry routing is the sharper version of that trap, because its whole
/// job is to act at the moment the user is least able to see what happened.
pub const RETRY_POLICY_PREF: &str = "routing-retry-policy";

/// How much of a window must be left for it to count as usable. A window under
/// this is "spent" — both for judging that the failed agent really did hit its
/// cap, and for refusing to hand the turn to a candidate that is about to.
///
/// Not zero: vendors round, and a plan reporting 0.4% left will not survive one
/// more turn. Not large either — this is the "is it over" line, not a comfort
/// margin, and the proactive rules in [`super`] are where a user expresses
/// "start moving me at 20%".
const DEFAULT_SPENT_BELOW_PERCENT: f64 = 2.0;

/// The node's reactive failover config.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RetryPolicy {
    /// Off by default. A node that never opts in behaves exactly as it does
    /// today: the failure surfaces and nothing is rerouted.
    #[serde(default)]
    pub enabled: bool,
    /// Explain, never reroute. The turn still fails, but the user is told which
    /// of their plans had room (or when the first window reopens) instead of
    /// being handed a bare vendor error.
    ///
    /// This is the setting to reach for first, mirroring the empty-`fallback`
    /// notify-only rule in [`super::FallbackRule`] — it lets someone watch the
    /// decision the feature *would* have made before letting it rewrite turns.
    #[serde(default)]
    pub notify_only: bool,
    /// Restrict failover to these agent ids, in preference order. Empty means
    /// "any subscription agent whose windows I can read", which is the useful
    /// default: the whole point is to shop across the plans the user already
    /// pays for without first enumerating them in a settings screen.
    ///
    /// A non-empty list is honoured as **priority order**, not merely as a
    /// filter — someone who lists Codex before Copilot is stating a preference
    /// that must beat a raw headroom comparison.
    #[serde(default)]
    pub candidates: Vec<String>,
    /// Percent-left below which a window counts as spent. See
    /// [`DEFAULT_SPENT_BELOW_PERCENT`].
    #[serde(default = "default_spent_below")]
    pub spent_below_percent: f64,
}

fn default_spent_below() -> f64 {
    DEFAULT_SPENT_BELOW_PERCENT
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            enabled: false,
            notify_only: false,
            candidates: Vec::new(),
            spent_below_percent: DEFAULT_SPENT_BELOW_PERCENT,
        }
    }
}

impl RetryPolicy {
    /// Parse a stored preference value. An unreadable value yields the DEFAULT
    /// (disabled) policy, never an error — a corrupt setting must degrade to
    /// today's behaviour rather than start rerouting turns on a guess.
    pub fn parse(raw: &str) -> Self {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Self::default();
        }
        serde_json::from_str(trimmed).unwrap_or_else(|e| {
            tracing::warn!(error = %e, "retry policy is unreadable; treating as disabled");
            Self::default()
        })
    }

    /// Serialize for storage.
    pub fn to_pref_value(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }

    /// The threshold, clamped to something a window can actually be measured
    /// against. A hand-edited pref carrying `-5` or `140` must not make every
    /// plan look spent (or none of them).
    fn spent_threshold(&self) -> f64 {
        if self.spent_below_percent.is_nan() {
            return DEFAULT_SPENT_BELOW_PERCENT;
        }
        self.spent_below_percent.clamp(0.0, 100.0)
    }
}

/// Read the node's reactive failover config.
pub async fn load(prefs: &crate::server::preferences::PreferencesStore) -> RetryPolicy {
    match prefs.get(RETRY_POLICY_PREF).await {
        Ok(Some(raw)) => RetryPolicy::parse(&raw),
        _ => RetryPolicy::default(),
    }
}

/// One rolling window, carrying the two fields the proactive
/// [`super::WindowReading`] drops: when it resets, and how long it runs.
///
/// Both matter here and neither is interchangeable with the other. `resets_at`
/// is what orders a wait; `window_seconds` only ever labels one ("5h", "7d").
/// Sorting a wait by length would be wrong in the ordinary case — a 5-hour
/// window that just refilled loses to a weekly one rolling over in ten minutes.
#[derive(Debug, Clone, PartialEq)]
pub struct WindowReading {
    pub label: String,
    /// Set only for a model-scoped window (Claude's per-model weekly limits).
    pub model: Option<String>,
    /// Percent of the cap consumed, 0–100.
    pub used_percent: f64,
    /// RFC3339, when the vendor said so. `None` means unknown — never "now".
    pub resets_at: Option<String>,
    /// The window's own length in seconds, for labelling only.
    pub window_seconds: Option<i64>,
}

impl WindowReading {
    /// Percent of this window still unused.
    fn remaining_percent(&self) -> f64 {
        (100.0 - self.used_percent).clamp(0.0, 100.0)
    }
}

/// One agent's readable plan state.
#[derive(Debug, Clone, PartialEq)]
pub struct AgentWindows {
    pub agent_id: String,
    /// Plan label when the vendor gave one ("Max 20x"), for the note text.
    pub plan: Option<String>,
    /// False when the snapshot was unavailable for ANY reason — not logged in,
    /// no plan on the account, token expired, the usage endpoint itself rate
    /// limited, unsupported. All of them mean the same thing to this module:
    /// nothing here can be trusted to answer a turn, so the agent is neither a
    /// candidate nor evidence that the failed agent is spent.
    pub readable: bool,
    pub windows: Vec<WindowReading>,
}

impl AgentWindows {
    /// The windows that actually gate a turn on `model`.
    ///
    /// Account-wide windows (`model: None`) always gate. A model-scoped window
    /// gates only when it names the model the turn will use — Opus being spent
    /// says nothing about a Sonnet turn.
    ///
    /// When the model is unknown, model-scoped windows are **excluded** rather
    /// than folded in. Including them is the tempting conservative choice and it
    /// is wrong in the direction that matters: one spent per-model cap would
    /// condemn a whole plan for a model this turn may never touch, so the
    /// feature would refuse to fail over to an agent that had plenty of room.
    fn gating<'a>(&'a self, model: Option<&'a str>) -> impl Iterator<Item = &'a WindowReading> {
        self.windows.iter().filter(move |w| match &w.model {
            None => true,
            Some(scoped) => model.is_some_and(|m| models_match(scoped, m)),
        })
    }

    /// Percent left on the tightest window gating a turn on `model`, or `None`
    /// when the agent reports nothing we can judge.
    ///
    /// **MIN, not max.** A plan carries several windows at once (Claude has a
    /// 5-hour, a weekly, and per-model weeklies) and a turn needs *every* one of
    /// them to have room. Taking the maximum — the natural reading of "how much
    /// headroom does this plan have" — picks an account whose weekly is at 99%
    /// on the strength of a freshly reset 5-hour window, and the retry fails
    /// exactly like the turn it was replacing.
    pub fn headroom_percent(&self, model: Option<&str>) -> Option<f64> {
        if !self.readable {
            return None;
        }
        self.gating(model)
            .map(WindowReading::remaining_percent)
            .fold(None, |acc: Option<f64>, remaining| {
                Some(acc.map_or(remaining, |a| a.min(remaining)))
            })
    }

    /// The gating window that is currently tightest, for the note text.
    fn tightest<'a>(&'a self, model: Option<&'a str>) -> Option<&'a WindowReading> {
        self.gating(model).min_by(|a, b| {
            a.remaining_percent()
                .partial_cmp(&b.remaining_percent())
                .unwrap_or(std::cmp::Ordering::Equal)
        })
    }

    /// The soonest RFC3339 reset among the gating windows that are actually
    /// spent, paired with that window's label.
    ///
    /// Only spent windows are considered: a 5-hour window sitting at 3% used
    /// will reset soon and tells us nothing — waiting for it changes nothing
    /// because it is not what is blocking. A window with no `resets_at` is
    /// skipped entirely rather than sorted as "now", following the same abstain
    /// rule the proactive module states: an absent signal never fires a verdict.
    fn soonest_reset(&self, model: Option<&str>, spent_below: f64) -> Option<(String, String)> {
        self.gating(model)
            .filter(|w| w.remaining_percent() < spent_below)
            .filter_map(|w| {
                let at = w.resets_at.as_deref()?;
                let parsed = chrono::DateTime::parse_from_rfc3339(at).ok()?;
                Some((parsed, w.label.clone(), at.to_string()))
            })
            .min_by_key(|(parsed, _, _)| *parsed)
            .map(|(_, label, at)| (label, at))
    }
}

/// Whether a window's model scope names the model a turn will run on.
///
/// Lenient and symmetric on purpose: vendors label these windows for humans
/// ("Opus", "Sonnet") while a turn carries a full id (`claude-opus-4-20250514`),
/// and neither side is canonical. Comparison is on lowercased alphanumerics so
/// punctuation and casing differences (`GPT-5` vs `gpt5`) do not split a match.
fn models_match(scoped: &str, model: &str) -> bool {
    let norm = |s: &str| {
        s.chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .map(|c| c.to_ascii_lowercase())
            .collect::<String>()
    };
    let (a, b) = (norm(scoped), norm(model));
    if a.is_empty() || b.is_empty() {
        return false;
    }
    a.contains(&b) || b.contains(&a)
}

/// What the reactive path decided about a failed turn.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Verdict {
    /// Not a limit failure, or nothing to say. The caller surfaces the original
    /// error unchanged — this path adds nothing.
    Stand,
    /// A plan with room was found. `note` is a finished sentence for the user.
    Reroute {
        agent_id: String,
        /// Percent left on that agent's tightest gating window.
        headroom_percent: f64,
        note: String,
    },
    /// The cap is real and no plan has room. `resets_at` is the soonest window
    /// that will reopen, across every readable agent.
    Wait {
        /// The agent whose window reopens first.
        agent_id: String,
        /// RFC3339.
        resets_at: String,
        note: String,
    },
    /// A plan with room was found and deliberately NOT used, because the node is
    /// configured [`RetryPolicy::notify_only`].
    ///
    /// Distinct from [`Verdict::NoCandidate`] on purpose: the two look alike in
    /// that neither reroutes, but they mean opposite things to a reader — one
    /// found somewhere to go and held back, the other found nowhere. Collapsing
    /// them makes a working notify-only setup render as a warning that nothing
    /// could be done.
    Held {
        /// The agent that would have taken the turn.
        agent_id: String,
        headroom_percent: f64,
        note: String,
    },
    /// The cap is real, but there is nothing readable to move to and no reset we
    /// can name (no other plan configured, or every reset time unknown).
    NoCandidate { note: String },
}

impl Verdict {
    /// The agent to run the retry on, when the verdict calls for one.
    pub fn reroute_agent(&self) -> Option<&str> {
        match self {
            Self::Reroute { agent_id, .. } => Some(agent_id.as_str()),
            _ => None,
        }
    }

    /// The sentence to show the user, if any.
    pub fn note(&self) -> Option<&str> {
        match self {
            Self::Stand => None,
            Self::Reroute { note, .. }
            | Self::Held { note, .. }
            | Self::Wait { note, .. }
            | Self::NoCandidate { note } => Some(note.as_str()),
        }
    }
}

/// Decide what to do about a turn that failed on `failed_agent`.
///
/// Pure: every vendor read has already happened and arrives in `readings`. That
/// is what lets the interesting behaviour — min-over-windows, the notify-only
/// downgrade, the ordering of a wait — be tested without a credential on disk.
///
/// `readings` must include the failed agent itself when its windows are
/// readable; its absence is treated as "we could not confirm a cap", which
/// yields [`Verdict::Stand`] rather than a guess — UNLESS `kind` is already
/// [`FailureKind::RateLimited`], which is the Gateway stating it outright.
///
/// Those two confirmation paths exist because the planes carry different
/// evidence. On the ACP plane the vendor CLI reports a cap as prose, so the
/// windows are the only trustworthy witness and a turn that failed with room to
/// spare must be left alone. On the gateway plane a 429 / `provider_rate_limited`
/// IS the witness — and the turn may have been routed to a BYO-key provider that
/// has no subscription window to read at all, so demanding one would make the
/// feature silently inert for exactly the failures it was told about.
pub fn decide(
    policy: &RetryPolicy,
    failed_agent: &str,
    model: Option<&str>,
    kind: FailureKind,
    readings: &[AgentWindows],
) -> Verdict {
    if !policy.enabled {
        return Verdict::Stand;
    }
    let spent_below = policy.spent_threshold();

    // 1. Confirm the cap, by whichever witness this plane has.
    let failed = readings
        .iter()
        .find(|r| r.agent_id.eq_ignore_ascii_case(failed_agent));
    let told_outright = kind == FailureKind::RateLimited;
    let confirmed_by_windows = failed
        .and_then(|f| f.headroom_percent(model))
        .is_some_and(|headroom| headroom < spent_below);
    if !told_outright && !confirmed_by_windows {
        return Verdict::Stand;
    }
    let spent_label = failed
        .and_then(|f| f.tightest(model))
        .filter(|_| confirmed_by_windows)
        .map(|w| w.label.clone())
        .unwrap_or_else(|| "usage".to_string());

    // 2. Rank the alternatives.
    let ranked = rank_candidates(policy, failed_agent, model, readings, spent_below);

    if let Some((best, headroom)) = ranked.first().copied() {
        let note = if policy.notify_only {
            format!(
                "{} is out of {} ({}). {} still has {:.0}% left — reactive failover is set to notify only, so nothing was rerouted.",
                display_agent(failed_agent),
                spent_label.to_lowercase(),
                plan_phrase(failed),
                display_agent(best),
                headroom,
            )
        } else {
            format!(
                "{} is out of {} ({}). Retrying on {}, which has {:.0}% left.",
                display_agent(failed_agent),
                spent_label.to_lowercase(),
                plan_phrase(failed),
                display_agent(best),
                headroom,
            )
        };
        if policy.notify_only {
            return Verdict::Held {
                agent_id: best.to_string(),
                headroom_percent: headroom,
                note,
            };
        }
        return Verdict::Reroute {
            agent_id: best.to_string(),
            headroom_percent: headroom,
            note,
        };
    }

    // 3. Nobody has room. Report the window that reopens first, across every
    //    readable agent INCLUDING the one that just failed — the ordinary
    //    outcome for a single-plan user is "your own 5-hour window is back at
    //    18:40", which is the most useful thing we can say.
    let soonest = readings
        .iter()
        .filter(|r| r.readable)
        .filter(|r| {
            is_candidate(policy, failed_agent, r) || r.agent_id.eq_ignore_ascii_case(failed_agent)
        })
        .filter_map(|r| {
            let (label, at) = r.soonest_reset(model, spent_below)?;
            let parsed = chrono::DateTime::parse_from_rfc3339(&at).ok()?;
            Some((parsed, r.agent_id.clone(), label, at))
        })
        .min_by_key(|(parsed, _, _, _)| *parsed);

    match soonest {
        Some((_, agent_id, label, at)) => {
            let note = format!(
                "Every plan is out of room. The first to reopen is {}'s {} window, at {}.",
                display_agent(&agent_id),
                label.to_lowercase(),
                friendly_time(&at),
            );
            Verdict::Wait {
                agent_id,
                resets_at: at,
                note,
            }
        }
        None => Verdict::NoCandidate {
            note: format!(
                "{} is out of {} and no other plan with room was found.",
                display_agent(failed_agent),
                spent_label.to_lowercase(),
            ),
        },
    }
}

/// Whether `reading` is eligible to receive a rerouted turn at all — before any
/// headroom comparison.
fn is_candidate(policy: &RetryPolicy, failed_agent: &str, reading: &AgentWindows) -> bool {
    if reading.agent_id.eq_ignore_ascii_case(failed_agent) {
        return false;
    }
    if !reading.readable {
        return false;
    }
    policy.candidates.is_empty()
        || policy
            .candidates
            .iter()
            .any(|c| c.eq_ignore_ascii_case(&reading.agent_id))
}

/// Candidates that can take the turn right now, best first.
///
/// Ordering is *preference then headroom*: an explicit `candidates` list is the
/// user stating priority, so it outranks a raw percentage. With no list, the
/// most headroom wins, and ties break on agent id so the choice is reproducible
/// rather than dependent on whichever vendor call returned first.
fn rank_candidates<'a>(
    policy: &RetryPolicy,
    failed_agent: &str,
    model: Option<&str>,
    readings: &'a [AgentWindows],
    spent_below: f64,
) -> Vec<(&'a str, f64)> {
    let mut ranked: Vec<(&str, f64, usize)> = readings
        .iter()
        .filter(|r| is_candidate(policy, failed_agent, r))
        .filter_map(|r| {
            let headroom = r.headroom_percent(model)?;
            if headroom < spent_below {
                return None;
            }
            let rank = policy
                .candidates
                .iter()
                .position(|c| c.eq_ignore_ascii_case(&r.agent_id))
                .unwrap_or(usize::MAX);
            Some((r.agent_id.as_str(), headroom, rank))
        })
        .collect();
    ranked.sort_by(|a, b| {
        a.2.cmp(&b.2)
            .then_with(|| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal))
            .then_with(|| a.0.cmp(b.0))
    });
    ranked.into_iter().map(|(id, h, _)| (id, h)).collect()
}

/// A human name for an agent id (`acp:claude` → `Claude`).
fn display_agent(agent_id: &str) -> String {
    let bare = agent_id.strip_prefix("acp:").unwrap_or(agent_id);
    match bare.to_ascii_lowercase().as_str() {
        "claude" => "Claude".to_string(),
        "codex" => "Codex".to_string(),
        "copilot" => "Copilot".to_string(),
        "grok" => "Grok".to_string(),
        "glm" => "GLM".to_string(),
        other => title(other),
    }
}

/// Title-case an unknown agent id for display.
fn title(value: &str) -> String {
    let mut chars = value.chars();
    match chars.next() {
        Some(first) => first.to_ascii_uppercase().to_string() + chars.as_str(),
        None => String::new(),
    }
}

/// "your Max 20x plan" / "your plan" when the vendor named no plan — or when
/// there is no readable reading at all, which is the ordinary case for a
/// gateway 429 against a provider that exposes no subscription window.
fn plan_phrase(reading: Option<&AgentWindows>) -> String {
    match reading
        .and_then(|r| r.plan.as_deref())
        .map(str::trim)
        .filter(|p| !p.is_empty())
    {
        Some(plan) => format!("your {plan} plan"),
        None => "your plan".to_string(),
    }
}

/// An RFC3339 instant rendered for a sentence, in the node's local zone.
fn friendly_time(rfc3339: &str) -> String {
    match chrono::DateTime::parse_from_rfc3339(rfc3339) {
        Ok(dt) => dt
            .with_timezone(&chrono::Local)
            .format("%H:%M on %a %-d %b")
            .to_string(),
        Err(_) => rfc3339.to_string(),
    }
}

// ── Reading the windows (uncached) ───────────────────────────────────────────

/// Read one agent's windows straight from the vendor, bypassing
/// [`super::signals`]'s stale-while-revalidate cache.
///
/// See the module docs for why the cache is wrong here: it exists so a *per
/// turn* proactive check is affordable, and the snapshot it would serve is the
/// one that already proved wrong by letting this turn fail.
pub async fn read_agent_windows(agent_id: &str) -> AgentWindows {
    let snapshot = ryu_usage::fetch_usage(agent_id).await;
    AgentWindows {
        agent_id: agent_id.to_string(),
        plan: snapshot.plan.clone(),
        readable: snapshot.available,
        windows: snapshot
            .windows
            .iter()
            .map(|w| WindowReading {
                label: w.label.clone(),
                model: w.model.clone(),
                used_percent: w.used_percent,
                resets_at: w.resets_at.clone(),
                window_seconds: w.window_seconds,
            })
            .collect(),
    }
}

/// Read the failed agent and every eligible alternative, concurrently.
///
/// `installed` is the set of agent ids this node actually has configured; a plan
/// the user never set up would answer `NotLoggedIn` anyway, but filtering first
/// saves the round-trip and keeps the failure path fast.
pub async fn read_all_windows(
    policy: &RetryPolicy,
    failed_agent: &str,
    installed: &[String],
) -> Vec<AgentWindows> {
    let mut ids: Vec<String> = vec![failed_agent.to_string()];
    let pool: Vec<&str> = if policy.candidates.is_empty() {
        ryu_usage::SUBSCRIPTION_AGENTS.to_vec()
    } else {
        policy.candidates.iter().map(String::as_str).collect()
    };
    for id in pool {
        if id.eq_ignore_ascii_case(failed_agent) {
            continue;
        }
        // Only agents this node has configured. An explicit candidate list is
        // still filtered: naming an agent you never installed must not cost a
        // vendor round-trip on every failure.
        if !installed.iter().any(|a| a.eq_ignore_ascii_case(id)) {
            continue;
        }
        if !ids.iter().any(|a| a.eq_ignore_ascii_case(id)) {
            ids.push(id.to_string());
        }
    }
    let reads = ids.iter().map(|id| read_agent_windows(id));
    futures_util::future::join_all(reads).await
}

// ── Classifying the failure ──────────────────────────────────────────────────

/// Why a turn ended, as far as the reactive path cares.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailureKind {
    /// The gateway told us, in a typed way, that an upstream provider is rate
    /// limited (HTTP 429 / `provider_rate_limited` / `rate_limit_exceeded`).
    RateLimited,
    /// Anything else. Still worth a look on the ACP plane, where the vendor CLI
    /// reports a cap as an ordinary error, but never on its own a reason to
    /// reroute — [`decide`] confirms against the windows either way.
    Other,
}

/// What one failed attempt reported back, so the retry wrapper can decide
/// without re-parsing the SSE it just forwarded.
#[derive(Debug, Clone)]
pub struct TurnFailure {
    /// The agent that was running when it failed.
    pub agent_id: String,
    /// The model the turn was pinned to, when it was pinned.
    pub model: Option<String>,
    pub kind: FailureKind,
    /// Whether ANY assistant content (text delta or tool row) reached the client
    /// before the failure.
    ///
    /// This is recorded as a flag at the emit sites, never inferred from the
    /// byte stream: `error_ui_lines` is three lines and there is preamble, so
    /// counting is unreliable in exactly the direction that double-renders a
    /// half-written answer. A retry is only safe when this is false — which is
    /// the case that matters, because a vendor cap arrives as a banner at
    /// session start, before any content.
    pub emitted_content: bool,
    /// The vendor's own message, preserved for the surfaced error.
    pub detail: String,
}

/// A handle the streaming routes use to report how a turn ended, so the retry
/// wrapper can decide without re-parsing the SSE it already forwarded.
///
/// Cheap and clonable, and **disarmed by default**: [`TurnWatch::off`] holds no
/// allocation and every method is a no-op, so the four callers that do not want
/// retry semantics (voice, the three team paths) and every node that never
/// enabled the feature pay nothing. Only the retry wrapper arms one.
#[derive(Debug, Clone, Default)]
pub struct TurnWatch(Option<std::sync::Arc<std::sync::Mutex<WatchState>>>);

#[derive(Debug, Default)]
struct WatchState {
    emitted_content: bool,
    failure: Option<TurnFailure>,
}

impl TurnWatch {
    /// A disarmed handle. Every method is a no-op.
    pub fn off() -> Self {
        Self(None)
    }

    /// An armed handle that records what happens to the turn.
    pub fn armed() -> Self {
        Self(Some(std::sync::Arc::new(std::sync::Mutex::new(
            WatchState::default(),
        ))))
    }

    /// Whether anyone is listening — lets a hot path skip the work entirely.
    pub fn is_armed(&self) -> bool {
        self.0.is_some()
    }

    /// Record that assistant content (a text delta or a tool row) has reached
    /// the client. Called at the emit sites rather than inferred from the byte
    /// stream — see [`TurnFailure::emitted_content`].
    pub fn mark_content(&self) {
        let Some(state) = &self.0 else { return };
        if let Ok(mut state) = state.lock() {
            state.emitted_content = true;
        }
    }

    /// Record that the turn failed. The FIRST failure wins: a route that fails
    /// and then tears down must not have its cause overwritten by the teardown.
    pub fn record_failure(
        &self,
        agent_id: &str,
        model: Option<&str>,
        kind: FailureKind,
        detail: &str,
    ) {
        let Some(state) = &self.0 else { return };
        if let Ok(mut state) = state.lock() {
            if state.failure.is_some() {
                return;
            }
            state.failure = Some(TurnFailure {
                agent_id: agent_id.to_string(),
                model: model.map(str::to_string),
                kind,
                emitted_content: state.emitted_content,
                detail: detail.to_string(),
            });
        }
    }

    /// Whether any assistant content has reached the client yet. The retry
    /// wrapper uses this to decide when it can stop buffering and start
    /// forwarding: once the user is reading an answer, no retry is possible, so
    /// there is nothing left to hold back.
    pub fn saw_content(&self) -> bool {
        self.0
            .as_ref()
            .and_then(|s| s.lock().ok().map(|s| s.emitted_content))
            .unwrap_or(false)
    }

    /// Whether this turn is a candidate for a retry: it failed, and nothing has
    /// been shown to the user yet.
    ///
    /// The content check is the one that keeps a retry from double-rendering a
    /// half-written answer on top of a fresh one. It reads `emitted_content` as
    /// of *now* rather than as of the failure, because content can still be
    /// flushed between the two.
    pub fn retryable(&self) -> Option<TurnFailure> {
        let state = self.0.as_ref()?.lock().ok()?;
        let failure = state.failure.clone()?;
        if state.emitted_content || failure.emitted_content {
            return None;
        }
        Some(failure)
    }
}

/// What the retry wrapper should do with one frame it just took off attempt 1.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameAction {
    /// Hold it back. The turn might still be retried, and forwarding now would
    /// leave the error triple on screen underneath the retry's answer.
    Hold,
    /// Content has appeared: flush everything held so far (this frame last) and
    /// stay in passthrough from here.
    Flush,
    /// Already passing through; forward immediately.
    Pass,
}

/// The wrapper's frame gate, as a pure state machine.
///
/// Extracted from the stream generator because that is the one place in this
/// feature the compiler is the only reviewer: an off-by-one here either strands
/// frames the client needed or double-renders a half-written answer, and neither
/// shows up in a test of [`decide`].
///
/// The gate is monotonic — once content has been seen it never goes back to
/// holding — which is what bounds the buffer to the preamble rather than to the
/// size of an answer.
#[derive(Debug, Default, Clone, Copy)]
pub struct FrameGate {
    passthrough: bool,
}

impl FrameGate {
    /// Classify the frame just received, given whether any assistant content has
    /// been emitted by now.
    pub fn admit(&mut self, saw_content: bool) -> FrameAction {
        if self.passthrough {
            return FrameAction::Pass;
        }
        if saw_content {
            self.passthrough = true;
            return FrameAction::Flush;
        }
        FrameAction::Hold
    }

    /// Whether anything was forwarded to the client. A turn that never left the
    /// gate is the only one a retry may replace.
    pub fn forwarded_anything(&self) -> bool {
        self.passthrough
    }
}

/// Whether a gateway-plane response is a typed rate-limit refusal.
///
/// Reads the status and the OpenAI-shaped `error.type` the Gateway emits
/// (`apps/gateway/src/error.rs`), never the human message: the message is
/// prose that changes, the type is a contract.
pub fn gateway_failure_kind(status: u16, error_type: Option<&str>) -> FailureKind {
    const RATE_LIMIT_TYPES: &[&str] = &["provider_rate_limited", "rate_limit_exceeded"];
    if status == 429 || error_type.is_some_and(|t| RATE_LIMIT_TYPES.contains(&t)) {
        FailureKind::RateLimited
    } else {
        FailureKind::Other
    }
}

/// Pull the `error.type` out of a gateway error body, if it is one.
pub fn error_type_of(body: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()?
        .get("error")?
        .get("type")?
        .as_str()
        .map(str::to_owned)
}

#[cfg(test)]
mod tests;
