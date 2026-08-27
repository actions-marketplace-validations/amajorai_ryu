//! Node-level entitlement gate for autonomous automation.
//!
//! The desktop hard paywall (epic #496) blocks the *app shell* when the trial
//! expires with no active subscription / license key. But a Core node keeps
//! running background automations (scheduled jobs → monitors, quests, workflows,
//! agent prompts) independently of any UI. Those autonomous runs consume the
//! same managed inference the paywall gates, so Core must also know the
//! entitlement state and **pause autonomous firing** when the node is not
//! entitled — otherwise a paywalled user's automations would keep spending in
//! the background.
//!
//! Mechanism mirrors [`crate::sidecar::untrusted`] and the auth resolvers
//! ([`crate::openrouter_auth`]): a process-global [`AtomicBool`] seeded from a
//! preference at startup and updated on change, read synchronously by the
//! scheduler tick. The desktop pushes the flag for local nodes, while managed
//! nodes refresh it from the authenticated control-plane handshake.
//!
//! Default is **ON (active)**: a fresh node, a headless / self-hosted OSS Core,
//! or one that has never been told otherwise must run automations normally. The
//! paywall is a desktop product decision, not an OSS-Core lock. Paid-only
//! profile bootstrap is a separate, fail-closed gate below.
//!
//! Placement note (Core vs Gateway): this pauses *what runs* (autonomous
//! automation) based on a state the desktop or authenticated control-plane
//! handshake supplies; it enforces no billing policy of its own and classifies
//! nothing. It is Core orchestration config, not a Gateway policy decision.

use std::collections::BTreeSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{OnceLock, RwLock};

/// Preferences key the desktop writes on every entitlement verdict change; Core
/// loads it on startup and on change. Absent ⇒ the default-ON behaviour holds.
pub const ENTITLEMENT_ACTIVE_PREF_KEY: &str = "entitlement-active";
/// Desktop-pushed snapshot of the control-plane plan capability used by
/// Core-owned profile bootstrap. Unlike the autonomy flag, this defaults OFF:
/// a free or headless node must never start a paid-only profile job.
pub const MANAGED_INFERENCE_ENTITLED_PREF_KEY: &str = "managed-inference-entitled";
/// Desktop-pushed snapshot of the recurring Marketplace capability.
pub const MARKETPLACE_APPS_ENTITLED_PREF_KEY: &str = "marketplace-apps-entitled";
/// Desktop-pushed active direct Marketplace app licenses, used so a direct
/// license can bypass the Membership-only runtime gate for that app.
pub const MARKETPLACE_DIRECT_LICENSED_ITEMS_PREF_KEY: &str = "marketplace-direct-licensed-items";

/// In-process flag, populated from preferences. Defaults to `true` (active): a
/// node with no signal must run automations normally (headless / OSS Core / a
/// desktop still within its trial or subscribed).
static ACTIVE: AtomicBool = AtomicBool::new(true);
static MANAGED_INFERENCE_ENTITLED: AtomicBool = AtomicBool::new(false);
static MARKETPLACE_APPS_ENTITLED: AtomicBool = AtomicBool::new(false);
static MARKETPLACE_DIRECT_LICENSED_ITEMS: OnceLock<RwLock<BTreeSet<String>>> = OnceLock::new();

/// Set the in-process flag from a preferences value. Accepts the common truthy
/// string forms the desktop may persist (`"true"`, `"1"`, `"on"`, `"yes"`);
/// anything else marks the node as NOT entitled (paused).
pub fn set_active(value: &str) {
    let on = matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "true" | "1" | "on" | "yes"
    );
    ACTIVE.store(on, Ordering::Relaxed);
}

/// Whether the node is currently entitled to run autonomous automations. Read on
/// the (sync) scheduler tick path. When `false`, the scheduler skips firing due
/// jobs until entitlement is restored.
pub fn is_active() -> bool {
    ACTIVE.load(Ordering::Relaxed)
}

pub fn set_managed_inference_entitled(value: &str) {
    let on = matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "true" | "1" | "on" | "yes"
    );
    MANAGED_INFERENCE_ENTITLED.store(on, Ordering::Relaxed);
}

pub fn managed_inference_entitled() -> bool {
    MANAGED_INFERENCE_ENTITLED.load(Ordering::Relaxed)
}

pub fn set_marketplace_apps_entitled(value: &str) {
    let on = matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "true" | "1" | "on" | "yes"
    );
    MARKETPLACE_APPS_ENTITLED.store(on, Ordering::Relaxed);
}

pub fn marketplace_apps_entitled() -> bool {
    MARKETPLACE_APPS_ENTITLED.load(Ordering::Relaxed)
}

pub fn set_marketplace_direct_licensed_items(value: &str) {
    let parsed = serde_json::from_str::<Vec<String>>(value).unwrap_or_default();
    let values = parsed
        .into_iter()
        .map(|item| item.trim().to_owned())
        .filter(|item| !item.is_empty())
        .collect::<BTreeSet<_>>();
    if let Ok(mut current) = MARKETPLACE_DIRECT_LICENSED_ITEMS
        .get_or_init(|| RwLock::new(BTreeSet::new()))
        .write()
    {
        *current = values;
    }
}

pub fn marketplace_app_allowed(plugin_id: &str) -> bool {
    if marketplace_apps_entitled() {
        return true;
    }
    MARKETPLACE_DIRECT_LICENSED_ITEMS
        .get_or_init(|| RwLock::new(BTreeSet::new()))
        .read()
        .map(|items| items.contains(plugin_id))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_truthy_forms_and_defaults_active() {
        // Default (never set) is active.
        assert!(is_active());
        set_active("false");
        assert!(!is_active());
        set_active("true");
        assert!(is_active());
        set_active("  ON ");
        assert!(is_active());
        set_active("0");
        assert!(!is_active());
        // Anything unrecognized pauses (fail-safe toward not spending).
        set_active("paywalled");
        assert!(!is_active());
        // Restore the default-ON state so other tests are unaffected.
        set_active("true");
    }

    #[test]
    fn marketplace_app_access_allows_subscription_or_exact_direct_license() {
        set_marketplace_apps_entitled("false");
        set_marketplace_direct_licensed_items(r#"["com.example.direct"]"#);
        assert!(marketplace_app_allowed("com.example.direct"));
        assert!(!marketplace_app_allowed("com.example.other"));
        set_marketplace_apps_entitled("true");
        assert!(marketplace_app_allowed("com.example.other"));
        set_marketplace_apps_entitled("false");
        set_marketplace_direct_licensed_items("[]");
    }
}
