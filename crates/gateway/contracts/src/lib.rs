//! Shared value-types exchanged between Ryu Gateway stages.
//!
//! This crate is the neutral home for vocabulary that crosses stage boundaries
//! so that peer stage crates (`ryu-gw-budget`, and later `ryu-gw-firewall`, …)
//! can share a type without depending on each other. It has no logic — only the
//! serde-shaped enums/structs that the pipeline threads between stages.

use serde::{Deserialize, Serialize};

/// Alert tier: the notification fan-out a policy match triggers, ORTHOGONAL to
/// the enforcement action (`BudgetAction`/`FirewallPolicy`). Enforcement decides
/// what happens to the request; the tier decides who gets told.
///
/// The derive order (Silent < Warn < Fanout < Email) is load-bearing — keep the
/// variants in ascending severity. **The `max` is taken in this process, not in
/// Core**: `pipeline/mod.rs::enforce_budget` folds the token / wallet / session
/// decisions with `.max()`, and `firewall/resolve.rs::louder_alert` (also `max`)
/// merges a locked tier down the node → org → agent cascade. Core never compares
/// two tiers; it receives one already-merged tier on the wire.
///
/// Named `Fanout` (never `Notify`) so it never collides with
/// `BudgetAction::Notify`, which is an enforcement action, not a tier.
///
/// # This enum is mirrored in Core, not shared with it
///
/// Core does **not** depend on this crate. `apps/core/src/policy_alerts/mod.rs`
/// declares its own four-variant `AlertTier` and the two are coupled only by their
/// serde wire forms — and those are spelled differently: this one is
/// `rename_all = "lowercase"`, the mirror is `rename_all = "snake_case"`. All four
/// current variants are single words, so both rules emit the same strings and the
/// wire is compatible today. A future multi-word variant would not be: this side
/// would emit `emailonly` where the mirror expects `email_only`, `from_header`'s
/// deliberately lenient decode would return `None`, and the alert would vanish with
/// no error logged on either side. Adding a variant here means adding it to the
/// mirror **and** checking the rename rules still agree.
///
/// (Verified by grep: `apps/core` contains no reference to `AlertTier` outside that
/// one file, so nothing in Core ever names the type declared here.)
///
/// # The tiers are EXCLUSIVE, not cumulative
///
/// There is exactly one deliverer — `policy_alerts::dispatch` in the mirror's module
/// (spawned by `dispatch_from_headers` off the gateway-fronting response head) — and
/// its arms select *one* sink set rather than adding to the previous tier's. So a
/// higher tier is not a superset of a lower one, and the variant docs below say what
/// each tier delivers, not what it adds.
///
/// Two facts hold across every tier and are therefore stated once here:
///
/// * **SSE does not depend on the tier.** `dispatch` publishes a `DesktopNotification`
///   (the in-app feed + OS toast) *before* it matches on the tier, so the live desktop
///   sees every alert it delivers whatever the tier says. Not literally unconditional:
///   the atomic dedupe claim above it returns early, so a repeat of a `dedupe_key`
///   inside the 300 s cooldown produces no SSE either.
/// * **Silent never reaches `dispatch`.** Both stamp producers gate on `>= Warn` —
///   `pipeline/mod.rs::firewall_policy_alert` on `cfg.alert`, and `enforce_budget` on
///   the folded `max_tier` before it builds `PolicyAlert::from_budget_decision`. Those
///   two are the only non-test constructors, so no `PolicyAlert` is ever built for a
///   Silent tier. The mirror's `Silent` arm is defensive only. (The `b.alert >= Warn`
///   filters elsewhere in `pipeline/mod.rs` select which *rules* are eligible; they are
///   not the stamp gate.)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, Default, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum AlertTier {
    /// No alert. The default, so every pre-existing config parses to Silent.
    #[default]
    Silent,
    /// Log/SSE only: surface a live warning to the desktop, no fan-out sinks.
    Warn,
    /// Fan out to the node's Webhook/Telegram/ExpoPush targets (Core `notify_all` over
    /// `AlertDeliveryTargets::targets`). Does NOT send email.
    Fanout,
    /// Email the node's configured recipients (`AlertDeliveryTargets::emails`, over the
    /// shared BYO SMTP transport) — **instead of**, not in addition to, the `Fanout`
    /// sinks. `dispatch`'s `Email` arm builds its target list purely from `emails` and
    /// never touches `targets`, so raising Fanout → Email *moves* delivery off
    /// webhook/Telegram/push rather than widening it. Being the top tier by `Ord` (which
    /// `max`-style tier merging depends on) does not make it a superset of delivery.
    Email,
}
