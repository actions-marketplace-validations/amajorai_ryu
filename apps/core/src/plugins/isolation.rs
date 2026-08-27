//! Which installed plugins actually run sandboxed — and which run with full host
//! access, on whose authority.
//!
//! Ryu runs plugin code on lanes with **very different** isolation strength, and
//! until this module nothing reported the difference:
//!
//! - The **Deno lane** (turn hooks, capability adapters, PTC tool-exec) is a real
//!   sandbox: `--no-prompt` plus path-scoped `--allow-read`/`--allow-write`,
//!   host-scoped `--allow-net`, name-scoped `--allow-run`, and `--allow-env` is
//!   never passed. An ungranted access fails rather than prompting. See
//!   [`ryu_tool_exec::deno_backend`].
//! - The **browser lane** (a plugin's `ui_code` bundle) renders in an iframe with
//!   `sandbox="allow-scripts"` and no `allow-same-origin` — browser-enforced.
//! - The **native lane** (manifest `sidecars`, `mcp_servers`) has **no enforcement
//!   mechanism at all**. `crate::sidecar::manifest_sidecar` says so in as many
//!   words: a declared `permissions` set is "RECORDED BUT NOT OS-ENFORCED … the
//!   process runs unsandboxed with full host access". A `kind: "node"` sidecar is
//!   additionally gated behind the experimental-plugin-runtime flag, but the gate
//!   controls *whether it spawns*, not *what it can reach once spawned*.
//!
//! # Unenforceable is not the same as exempt
//!
//! These are kept as separate fields on purpose, and must never be collapsed into
//! one "unsandboxed" badge:
//!
//! - [`Enforcement::Unenforceable`] — the lane has no mechanism. **Nobody chose
//!   this.** It is a statement about Ryu, not about the plugin or the user.
//! - [`HostAccess::Permitted`] — the lane runs with host access and a trust basis
//!   says that is allowed.
//!
//! If the two ever render as one badge, then the day OS-level sandboxing lands for
//! native sidecars, every native app silently converts from "we cannot isolate
//! this" into "someone exempted this", and the trust allowlist becomes
//! retroactively load-bearing for plugins that never passed through it.
//!
//! # System plugins are described, not exempted
//!
//! [`TrustBasis::SystemPlugin`] is **descriptive**. A system plugin is compiled
//! into the Core binary via `include_str!` (see [`crate::plugins::builtins`]); it
//! was never a candidate for the sandbox in the first place, so calling it
//! "exempt" would imply a policy decision that does not exist.
//!
//! # Trust is captured at install, never fetched at spawn
//!
//! `org_verified` is control-plane state (an admin decision recorded in the
//! marketplace, see `packages/db/src/models/org-verification.model.ts`). This
//! module reads it only from [`PluginProvenance`] persisted at install time. It is
//! deliberately **not** fetched live when deciding isolation: that would make a
//! local security decision depend on network reachability, and a timeout that
//! fails open is a bypass.
//!
//! The cost of that choice, stated rather than left implicit: **revocation is not
//! retroactive**. If an org loses verification after a user installed its plugin,
//! the captured provenance keeps saying `org_verified = true` until the plugin is
//! updated or reinstalled. [`PluginProvenance::captured_at`] exists so a future
//! staleness policy can expire a capture without a schema change.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use crate::plugin_manifest::schema::SidecarProcess;
use crate::plugin_manifest::PluginManifest;

/// The catalog source id of the first-party Ryu marketplace. Items served by this
/// source went through the publish boundary in `packages/api/src/routers/
/// marketplace.ts` (caps, review state, signature verification, channel
/// derivation) — which is what makes it a usable trust signal at all.
pub const OFFICIAL_MARKETPLACE_SOURCE_ID: &str = "ryu-marketplace";

/// Preference key: the user's explicit list of plugin ids allowed to run
/// host-access lanes. **Not** a bypass — an id here is only honoured when its
/// captured provenance already vouches for the publisher. See
/// [`TrustPolicy::resolve_trust`].
pub const TRUSTED_IDS_PREF: &str = "ryu:plugins-trusted-ids";

/// Preference key: when truthy, a plugin whose host-access lane has no trust basis
/// is refused rather than merely reported. **Default off** — turning it on is a
/// tightening that can stop an already-installed sideloaded app from running, so
/// it is the user's call, not a silent upgrade.
pub const REQUIRE_TRUST_PREF: &str = "ryu:plugins-require-trust-for-host-access";

/// What a lane's isolation mechanism can actually enforce.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Enforcement {
    /// A real, mechanically-enforced sandbox denies by default (Deno lane, or the
    /// browser's iframe sandbox for UI bundles).
    Sandboxed,
    /// No isolation mechanism exists for this lane today. The process runs with
    /// the full ambient authority of the Core process. Nobody chose this.
    Unenforceable,
}

/// A distinct way a plugin can execute code.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LaneKind {
    /// `contributes.turn_hooks[]` — a JS fragment spliced into an async IIFE and
    /// run in the Deno sandbox on the turn boundary.
    TurnHook,
    /// `provides[].tools.<verb>.adapter` — a capability adapter body, same lane.
    CapabilityAdapter,
    /// The plugin's `ui_code` bundle, rendered in a `sandbox="allow-scripts"`
    /// iframe without `allow-same-origin`.
    UiBundle,
    /// A `sidecars[]` entry: an out-of-process backend. Full host access.
    Sidecar,
    /// A `mcp_servers` entry: a spawned MCP server subprocess. Full host access.
    McpServer,
}

impl LaneKind {
    /// The enforcement this lane's mechanism provides. A property of Ryu's
    /// implementation, never of the individual plugin.
    #[must_use]
    pub const fn enforcement(self) -> Enforcement {
        match self {
            Self::TurnHook | Self::CapabilityAdapter | Self::UiBundle => Enforcement::Sandboxed,
            Self::Sidecar | Self::McpServer => Enforcement::Unenforceable,
        }
    }
}

/// One executable lane a plugin declares.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LaneReport {
    pub kind: LaneKind,
    pub enforcement: Enforcement,
    /// Human-readable identifier for the specific lane instance (hook id, sidecar
    /// name, MCP server key) so a report can point at *which* one needs host access.
    pub detail: String,
}

/// Why a plugin's host-access lane is (or is not) considered vouched for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "basis", rename_all = "snake_case")]
pub enum TrustBasis {
    /// Compiled into the Core binary. Descriptive, not a grant — see the module
    /// docs.
    SystemPlugin,
    /// The publishing organization carries the marketplace identity check.
    VerifiedPublisher {
        org: Option<String>,
        tier: Option<String>,
    },
    /// Served by the first-party Ryu marketplace, which applies a publish
    /// boundary, but the publishing org is not identity-verified.
    OfficialMarketplace,
    /// The user named this id in [`TRUSTED_IDS_PREF`] *and* its provenance already
    /// vouched for the publisher.
    UserAllowlisted,
    /// No basis. Sideloaded, third-party source, or provenance never captured.
    Untrusted,
}

impl TrustBasis {
    /// Whether this basis vouches for running an unenforceable lane.
    #[must_use]
    pub const fn vouches(&self) -> bool {
        !matches!(self, Self::Untrusted)
    }
}

/// The verdict on a plugin's use of host-access lanes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum HostAccess {
    /// The plugin declares no unenforceable lane. Everything it runs is sandboxed.
    NotRequested,
    /// It runs an unenforceable lane and something vouches for the publisher.
    Permitted { basis: TrustBasis },
    /// It runs an unenforceable lane with nothing vouching for it.
    Unvetted,
}

/// Where an installed plugin came from, captured at install time.
///
/// `None` on a [`crate::plugins::PluginRecord`] means the column predates this
/// feature or the install path never supplied it. That reads as **untrusted**,
/// never as trusted-by-default — see [`TrustPolicy::resolve_trust`] and its test.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginProvenance {
    /// Catalog source that served the install (`ryu-marketplace`, `github-topic`, …).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    /// Publishing organization id, when the source reported one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub publisher_org: Option<String>,
    /// The marketplace blue check on the publishing ORG at install time.
    #[serde(default)]
    pub org_verified: bool,
    /// Verification tier, only meaningful alongside `org_verified`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub org_verified_tier: Option<String>,
    /// Whether the manifest signature verified at install.
    #[serde(default)]
    pub signature_verified: bool,
    /// Digest of the exact manifest bytes accepted by the signed install path.
    /// This binds reloaded on-disk bytes to the provenance; an ID match alone
    /// must never restore Core privileges.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manifest_sha256: Option<String>,
    /// Transitional marker for a manifest compiled into the Core binary. This
    /// means official Ryu content, not system status; system status is derived
    /// only from `SYSTEM_PLUGINS`.
    #[serde(default)]
    pub builtin: bool,
    /// RFC3339 capture time, so a future staleness policy can expire a capture
    /// without a schema change (revocation is not retroactive — see module docs).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub captured_at: Option<String>,
}

#[must_use]
pub fn manifest_sha256(manifest: &PluginManifest) -> String {
    use sha2::{Digest, Sha256};
    let bytes = serde_json::to_vec(manifest).unwrap_or_default();
    format!("{:x}", Sha256::digest(bytes))
}

/// Digest the capability-bearing manifest shape used for compiled first-party
/// trust decisions.
///
/// Standalone bundles add `ui_code_sha256` and, for inline backends,
/// `backend_sha256` after reading the satellite's carriage. Those fields protect
/// the carried bytes at the install boundary, but they are not capability or
/// lifecycle declarations. Including them in the compiled-manifest identity
/// would make every standalone build look like a modified Community package and
/// would disable its manifest-owned sidecar/MCP lanes. Signed marketplace
/// provenance continues to use [`manifest_sha256`] over the exact accepted
/// manifest bytes.
#[must_use]
pub fn manifest_sha256_for_trust(manifest: &PluginManifest) -> String {
    use sha2::{Digest, Sha256};

    let mut value = serde_json::to_value(manifest).unwrap_or_default();
    if let Some(object) = value.as_object_mut() {
        object.remove("ui_code_sha256");
        object.remove("backend_sha256");
    }
    let bytes = serde_json::to_vec(&value).unwrap_or_default();
    format!("{:x}", Sha256::digest(bytes))
}

impl PluginProvenance {
    /// Provenance for a manifest compiled into the Core binary.
    #[must_use]
    pub fn builtin() -> Self {
        Self {
            source_id: Some("built-in".to_owned()),
            builtin: true,
            captured_at: Some(chrono::Utc::now().to_rfc3339()),
            ..Self::default()
        }
    }
}

/// User configuration governing host-access lanes.
#[derive(Debug, Clone, Default)]
pub struct TrustPolicy {
    /// Plugin ids the user explicitly trusts ([`TRUSTED_IDS_PREF`]).
    pub trusted_ids: BTreeSet<String>,
    /// Refuse, rather than report, an unvetted host-access lane
    /// ([`REQUIRE_TRUST_PREF`]).
    pub require_trust_for_host_access: bool,
}

impl TrustPolicy {
    /// Resolve the trust basis for one plugin.
    ///
    /// The ordering is deliberate and **fail-closed**: the user allowlist is
    /// consulted *last* and can only re-label a plugin whose provenance already
    /// vouches for its publisher. Listing a sideloaded id does nothing. Without
    /// that rule the preference is a universal sandbox bypass that any process
    /// able to write one preference key could arm.
    #[must_use]
    pub fn resolve_trust(&self, id: &str, provenance: Option<&PluginProvenance>) -> TrustBasis {
        if crate::plugins::builtins::is_system_plugin(id) {
            return TrustBasis::SystemPlugin;
        }
        // No provenance captured ⇒ nothing is known ⇒ nothing is trusted. This is
        // the migration path for every record installed before the column existed.
        let Some(p) = provenance else {
            return TrustBasis::Untrusted;
        };
        // A compiled manifest is an official Ryu artifact, but compilation is
        // not the same thing as being part of the system. Only the explicit
        // SYSTEM_PLUGINS allowlist above receives the non-removable
        // SystemPlugin basis. This distinction lets ordinary first-party
        // packages move to the verified marketplace without changing their
        // trust semantics.
        if p.builtin {
            return TrustBasis::OfficialMarketplace;
        }
        let from_official = p.source_id.as_deref() == Some(OFFICIAL_MARKETPLACE_SOURCE_ID);
        let signed_official = from_official && p.signature_verified;
        let basis = if p.org_verified && signed_official {
            TrustBasis::VerifiedPublisher {
                org: p.publisher_org.clone(),
                tier: p.org_verified_tier.clone(),
            }
        } else if signed_official {
            TrustBasis::OfficialMarketplace
        } else {
            // A third-party source can claim `orgVerified` in its own JSON. Ryu's
            // blue check is an admin decision in Ryu's own control plane, so a
            // claim carried by any other source is publisher-controlled data and
            // is not a trust signal.
            TrustBasis::Untrusted
        };
        if self.trusted_ids.contains(id) && basis.vouches() {
            return TrustBasis::UserAllowlisted;
        }
        basis
    }
}

/// The full isolation report for one installed plugin.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginIsolation {
    pub id: String,
    pub name: String,
    /// Every executable lane the manifest declares.
    pub lanes: Vec<LaneReport>,
    /// Whether every lane it runs is mechanically sandboxed. True (vacuously) for
    /// a plugin that declares no executable lane at all.
    pub fully_sandboxed: bool,
    /// The lanes with no enforcement mechanism. Empty ⇒ nothing to vet.
    pub unenforceable_lanes: Vec<LaneReport>,
    pub trust: TrustBasis,
    pub host_access: HostAccess,
}

impl PluginIsolation {
    /// Whether policy says this plugin's host-access lanes must be refused.
    ///
    /// Only ever true when the user has explicitly turned on
    /// [`REQUIRE_TRUST_PREF`]: the default is to report, not to break an install
    /// that worked yesterday.
    #[must_use]
    pub fn should_refuse_host_access(&self, policy: &TrustPolicy) -> bool {
        policy.require_trust_for_host_access && matches!(self.host_access, HostAccess::Unvetted)
    }
}

/// Enumerate the executable lanes a manifest declares.
#[must_use]
pub fn lanes_of(manifest: &PluginManifest) -> Vec<LaneReport> {
    let mut lanes = Vec::new();

    if let Some(contributes) = &manifest.contributes {
        for hook in &contributes.turn_hooks {
            lanes.push(LaneReport {
                kind: LaneKind::TurnHook,
                enforcement: LaneKind::TurnHook.enforcement(),
                detail: hook.id.clone(),
            });
        }
    }

    for entry in &manifest.provides {
        for (verb, tool) in &entry.tools {
            if tool.adapter.is_some() {
                lanes.push(LaneReport {
                    kind: LaneKind::CapabilityAdapter,
                    enforcement: LaneKind::CapabilityAdapter.enforcement(),
                    detail: format!("{}::{verb}", entry.capability),
                });
            }
        }
    }

    // The bundle itself is persisted in the store, not the manifest; the declared
    // integrity hash is the manifest-side signal that one exists.
    if manifest.ui_code_sha256.is_some() {
        lanes.push(LaneReport {
            kind: LaneKind::UiBundle,
            enforcement: LaneKind::UiBundle.enforcement(),
            detail: "ui_code".to_owned(),
        });
    }

    for sidecar in &manifest.sidecars {
        // Every process kind lands on the same verdict. A `node` sidecar is gated
        // behind the experimental-plugin-runtime flag, but that gate decides
        // whether it spawns — not what it can reach once it has.
        let runtime = match &sidecar.process {
            SidecarProcess::Binary(_) => "binary",
            SidecarProcess::Python(_) => "python",
            SidecarProcess::Local(_) => "local",
            SidecarProcess::Node(_) => "node",
        };
        lanes.push(LaneReport {
            kind: LaneKind::Sidecar,
            enforcement: LaneKind::Sidecar.enforcement(),
            detail: format!("{} ({runtime})", sidecar.name),
        });
    }

    for name in manifest.mcp_servers.keys() {
        lanes.push(LaneReport {
            kind: LaneKind::McpServer,
            enforcement: LaneKind::McpServer.enforcement(),
            detail: name.clone(),
        });
    }

    lanes
}

/// Build the isolation report for one installed plugin. Pure over persisted facts
/// — no network, no clock, no process state.
#[must_use]
pub fn resolve(
    manifest: &PluginManifest,
    provenance: Option<&PluginProvenance>,
    policy: &TrustPolicy,
) -> PluginIsolation {
    let lanes = lanes_of(manifest);
    let unenforceable_lanes: Vec<LaneReport> = lanes
        .iter()
        .filter(|l| l.enforcement == Enforcement::Unenforceable)
        .cloned()
        .collect();
    let trust = policy.resolve_trust(&manifest.id, provenance);
    let host_access = if unenforceable_lanes.is_empty() {
        HostAccess::NotRequested
    } else if trust.vouches() {
        HostAccess::Permitted {
            basis: trust.clone(),
        }
    } else {
        HostAccess::Unvetted
    };
    PluginIsolation {
        id: manifest.id.clone(),
        name: manifest.name.clone(),
        fully_sandboxed: unenforceable_lanes.is_empty(),
        unenforceable_lanes,
        lanes,
        trust,
        host_access,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy_with(ids: &[&str], require: bool) -> TrustPolicy {
        TrustPolicy {
            trusted_ids: ids.iter().map(|s| (*s).to_owned()).collect(),
            require_trust_for_host_access: require,
        }
    }

    #[test]
    fn standalone_carriage_hashes_do_not_change_compiled_trust_identity() {
        let mut manifest: PluginManifest = serde_json::from_value(serde_json::json!({
            "id": "@ryu/test-app",
            "name": "Test App",
            "version": "1.0.0",
            "runnables": []
        }))
        .expect("minimal manifest");
        let exact = manifest_sha256_for_trust(&manifest);
        let exact_bytes = manifest_sha256(&manifest);

        manifest.ui_code_sha256 = Some("ui-hash".to_owned());
        manifest.backend_sha256 = Some("backend-hash".to_owned());

        assert_eq!(manifest_sha256_for_trust(&manifest), exact);
        assert_ne!(manifest_sha256(&manifest), exact_bytes);
    }

    fn official(org_verified: bool) -> PluginProvenance {
        PluginProvenance {
            source_id: Some(OFFICIAL_MARKETPLACE_SOURCE_ID.to_owned()),
            publisher_org: Some("org_acme".to_owned()),
            org_verified,
            signature_verified: true,
            ..PluginProvenance::default()
        }
    }

    #[test]
    fn official_source_without_a_verified_signature_is_untrusted() {
        let policy = TrustPolicy::default();
        assert_eq!(
            policy.resolve_trust(
                "com.acme.app",
                Some(&PluginProvenance {
                    source_id: Some(OFFICIAL_MARKETPLACE_SOURCE_ID.to_owned()),
                    ..PluginProvenance::default()
                }),
            ),
            TrustBasis::Untrusted
        );
    }

    fn sideloaded() -> PluginProvenance {
        PluginProvenance {
            source_id: Some("github-topic".to_owned()),
            ..PluginProvenance::default()
        }
    }

    // ── The two fail-closed cases this whole feature turns on ────────────────

    #[test]
    fn allowlisting_a_sideloaded_id_does_not_trust_it() {
        // The discriminating case: the user (or anything able to write one
        // preference key) names a sideloaded plugin. Provenance does not vouch for
        // it, so the allowlist must not promote it.
        let policy = policy_with(&["com.example.evil"], false);
        let trust = policy.resolve_trust("com.example.evil", Some(&sideloaded()));
        assert_eq!(trust, TrustBasis::Untrusted);
        assert!(!trust.vouches());
    }

    #[test]
    fn absent_provenance_is_untrusted_not_trusted() {
        // Every record installed before the provenance column existed deserializes
        // as `None`. That must read as "nothing is known", never as a free pass.
        let policy = policy_with(&["com.example.legacy"], false);
        assert_eq!(
            policy.resolve_trust("com.example.legacy", None),
            TrustBasis::Untrusted
        );
    }

    // ── Trust resolution ─────────────────────────────────────────────────────

    #[test]
    fn verified_org_on_the_official_marketplace_vouches() {
        let policy = TrustPolicy::default();
        let trust = policy.resolve_trust("com.acme.app", Some(&official(true)));
        assert!(matches!(trust, TrustBasis::VerifiedPublisher { .. }));
        assert!(trust.vouches());
    }

    #[test]
    fn official_marketplace_without_a_verified_org_still_vouches_but_says_so() {
        let policy = TrustPolicy::default();
        assert_eq!(
            policy.resolve_trust("com.acme.app", Some(&official(false))),
            TrustBasis::OfficialMarketplace
        );
    }

    #[test]
    fn a_third_party_source_claiming_org_verified_is_ignored() {
        // `orgVerified` is an admin decision in Ryu's control plane. Any other
        // source asserting it is just publisher-controlled JSON.
        let liar = PluginProvenance {
            source_id: Some("github-topic".to_owned()),
            org_verified: true,
            org_verified_tier: Some("gold".to_owned()),
            ..PluginProvenance::default()
        };
        let policy = TrustPolicy::default();
        assert_eq!(
            policy.resolve_trust("com.example.liar", Some(&liar)),
            TrustBasis::Untrusted
        );
    }

    #[test]
    fn allowlisting_a_marketplace_plugin_relabels_it() {
        let policy = policy_with(&["com.acme.app"], false);
        assert_eq!(
            policy.resolve_trust("com.acme.app", Some(&official(false))),
            TrustBasis::UserAllowlisted
        );
    }

    #[test]
    fn builtin_provenance_reads_as_a_system_plugin() {
        let policy = TrustPolicy::default();
        assert_eq!(
            policy.resolve_trust("com.example.compiled", Some(&PluginProvenance::builtin())),
            TrustBasis::OfficialMarketplace
        );
    }

    // ── Enforcement vs exemption must not collapse ───────────────────────────

    #[test]
    fn sandboxed_and_unenforceable_lanes_are_distinct() {
        assert_eq!(LaneKind::TurnHook.enforcement(), Enforcement::Sandboxed);
        assert_eq!(
            LaneKind::CapabilityAdapter.enforcement(),
            Enforcement::Sandboxed
        );
        assert_eq!(LaneKind::UiBundle.enforcement(), Enforcement::Sandboxed);
        assert_eq!(LaneKind::Sidecar.enforcement(), Enforcement::Unenforceable);
        assert_eq!(
            LaneKind::McpServer.enforcement(),
            Enforcement::Unenforceable
        );
    }

    #[test]
    fn refusal_requires_the_user_to_have_opted_in() {
        let report = PluginIsolation {
            id: "com.example.evil".to_owned(),
            name: "Evil".to_owned(),
            lanes: vec![],
            fully_sandboxed: false,
            unenforceable_lanes: vec![LaneReport {
                kind: LaneKind::Sidecar,
                enforcement: Enforcement::Unenforceable,
                detail: "back (binary)".to_owned(),
            }],
            trust: TrustBasis::Untrusted,
            host_access: HostAccess::Unvetted,
        };
        // Default policy reports, never breaks a working install.
        assert!(!report.should_refuse_host_access(&policy_with(&[], false)));
        // Only an explicit opt-in refuses.
        assert!(report.should_refuse_host_access(&policy_with(&[], true)));
    }

    #[test]
    fn a_vouched_plugin_is_never_refused() {
        let report = PluginIsolation {
            id: "com.acme.app".to_owned(),
            name: "Acme".to_owned(),
            lanes: vec![],
            fully_sandboxed: false,
            unenforceable_lanes: vec![LaneReport {
                kind: LaneKind::Sidecar,
                enforcement: Enforcement::Unenforceable,
                detail: "back (python)".to_owned(),
            }],
            trust: TrustBasis::OfficialMarketplace,
            host_access: HostAccess::Permitted {
                basis: TrustBasis::OfficialMarketplace,
            },
        };
        assert!(!report.should_refuse_host_access(&policy_with(&[], true)));
    }
}
