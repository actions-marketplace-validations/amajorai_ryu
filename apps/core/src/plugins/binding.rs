//! The **capability binding registry** — Track A of the platform-decomposition
//! handoff.
//!
//! A plugin declares an *abstract* dependency (`requires.capabilities = [{rag}]`)
//! instead of naming a concrete provider plugin. This module resolves each such
//! edge to the concrete provider app that `provides` the capability, so the app can
//! be built at any layer (raw `requires: [rag]` for control, `requires: [spaces]`
//! for convenience) and a provider can be swapped (rag → GraphRAG) without touching
//! consumers.
//!
//! ## The resolution ladder (mirrors the Gateway's `ModelRouter`)
//!
//! For one required capability, over the candidate manifest set:
//! 1. Collect every candidate that `provides` the capability.
//! 2. **No provider** ⇒ [`BindingError::Unprovided`].
//! 3. A **user override** (`BindingConfig.overrides[cap] = app-id`) picks the
//!    provider explicitly — it must be among the candidates, else
//!    [`BindingError::OverrideNotProvider`].
//! 4. Exactly **one** provider ⇒ that one (the zero-config happy path).
//! 5. **Two or more** with no override: the capability's *flavour* decides.
//!    * **Strict** (the default, used by `rag`/`engines`) ⇒ [`BindingError::Ambiguous`],
//!      an *explicit refusal* surfaced to the user — never a silent first-match pick.
//!    * **Selectable** (every provider declares `provides[].selectable`, used by the
//!      swappable layers `web.search`/`web.extract`/`browser.control`/`computer.control`/
//!      `memory`) ⇒ the deterministic pick in [`pick_selectable`]: the provider
//!      declaring `default`, else the lexicographically-lowest id. This is the
//!      engine UX — many installed, one picked — and it stays a pure function of the
//!      candidate set, so the disable-safety reconstruction argument below is
//!      unchanged. Selectability needs **unanimity** among the providers, so one
//!      third-party manifest cannot loosen a strict capability.
//! 6. The chosen provider's [`ProvidesEntry::version`] must satisfy the consumer's
//!    [`CapabilityReq::min_version`] floor, else [`BindingError::VersionUnsatisfied`].
//!    The floor is checked against the *capability* version, not the provider app's
//!    semver.
//!
//! ## Graph lowering (why the topological machinery is untouched)
//!
//! Once a capability binds to a provider app-id, [`lower_manifests`] materializes it
//! as a **bare** [`AppDependency`] (`min_version: None`) appended to the consumer's
//! `requires.apps`. `crate::plugins::graph` reads edges only through
//! [`PluginManifest::dependencies`], so a lowered capability edge is indistinguishable
//! from a hand-written app dep: enable order, cycle detection, `dependents_of`, and
//! disable-blast-radius all work unchanged. The edge is **bare** deliberately — the
//! graph's `min_version` gate compares against the provider's *app* version, which is
//! the wrong number for a *capability* floor; that floor is enforced here at bind
//! time instead.
//!
//! ## The enabled-set invariant (why disable-safety holds without a binding record)
//!
//! Governance enforces: **every enabled consumer binds deterministically over the
//! ENABLED set** (single provider, or an override — never ambiguous, never unbound).
//! Two enable-time gates keep it true:
//! 1. A consumer with an ambiguous/unbound capability cannot enable.
//! 2. Enabling a plugin re-validates the WHOLE post-enable enabled set (every
//!    consumer, not just the target) — so enabling a *second* provider that would
//!    render an already-enabled consumer ambiguous is refused, naming that consumer.
//!
//! Both gates resolve over the ENABLED set (what the broker actually sees at call
//! time), not the installed set — a merely-installed-but-disabled second provider
//! introduces no ambiguity. Because the invariant holds, the same lowering run over
//! the enabled set at disable time reconstructs the identical consumer→provider edge,
//! so disable-safety (a bound consumer blocks its provider's disable) holds
//! symmetrically without persisting a per-consumer binding record.

use std::collections::BTreeMap;
use std::sync::{OnceLock, RwLock};

use crate::plugin_manifest::PluginManifest;
use crate::plugin_manifest::{parse_min_version, AppDependency, CapabilityReq};

/// User-supplied binding overrides — the tie-breaker when two or more installed
/// plugins provide the same capability. Absent/empty for the zero-config case.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BindingConfig {
    /// `capability name → chosen provider app-id`. An entry wins over the
    /// auto-pick, exactly as a user `model_map` entry shadows a built-in rule in
    /// the Gateway's `ModelRouter`.
    pub overrides: BTreeMap<String, String>,
}

/// The process-wide active binding config the lifecycle reads (loaded from
/// preferences at startup, refreshable via [`set_active_config`]). Kept as an
/// ambient global — like [`crate::profile`]'s node profile — so the many
/// `enable_app`/`disable_app` call sites need no extra parameter. Defaults to
/// no overrides (the zero-config path), so an ambiguous multi-provider capability
/// is refused until the user sets an override.
fn cell() -> &'static RwLock<BindingConfig> {
    static ACTIVE: OnceLock<RwLock<BindingConfig>> = OnceLock::new();
    ACTIVE.get_or_init(|| RwLock::new(BindingConfig::default()))
}

/// A snapshot of the active binding config (cheap clone; overrides are few).
pub fn active_config() -> BindingConfig {
    cell().read().map(|c| c.clone()).unwrap_or_default()
}

/// Replace the active binding config (e.g. after loading overrides from
/// preferences, or when the user changes a binding). Re-running enable/disable
/// resolution afterwards re-checks cycles + dependents against the new bindings.
pub fn set_active_config(cfg: BindingConfig) {
    if let Ok(mut c) = cell().write() {
        *c = cfg;
    }
    // The capability tool facade caches which provider serves each verb. Changing the
    // selection here is exactly the event that cache must not miss — otherwise the
    // user picks a new provider and calls keep going to the old one.
    crate::sidecar::mcp::capability_tools::invalidate();
}

/// The preferences key under which the user's capability→provider overrides are
/// persisted (a JSON object `{ "<capability>": "<provider-app-id>" }`).
pub const BINDING_OVERRIDES_PREF_KEY: &str = "binding.overrides";

/// Parse a persisted overrides JSON object into a [`BindingConfig`]. An empty or
/// malformed value yields the default (no overrides) — never an error that would
/// block startup.
pub fn config_from_overrides_json(json: &str) -> BindingConfig {
    let overrides = serde_json::from_str::<BTreeMap<String, String>>(json).unwrap_or_default();
    BindingConfig { overrides }
}

/// Serialize a [`BindingConfig`]'s overrides to the persisted JSON object form.
pub fn overrides_to_json(config: &BindingConfig) -> String {
    serde_json::to_string(&config.overrides).unwrap_or_else(|_| "{}".to_owned())
}

/// One resolved capability→provider binding.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Binding {
    /// The capability that was required.
    pub capability: String,
    /// The provider plugin's app-id the capability bound to.
    pub provider_id: String,
    /// The provider's declared capability version (from its [`ProvidesEntry`]).
    pub provided_version: String,
}

/// Why a required capability could not be bound. Every variant is an *explicit*,
/// user-surfaceable refusal — the registry never silently drops or guesses.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BindingError {
    /// No candidate plugin provides the capability at all.
    Unprovided { capability: String },
    /// Two or more candidates provide it and no override disambiguates — the user
    /// must choose (set an override) before the consumer can enable.
    Ambiguous {
        capability: String,
        providers: Vec<String>,
    },
    /// An override names a plugin that does not provide the capability.
    OverrideNotProvider { capability: String, chosen: String },
    /// The chosen provider's capability version does not satisfy the floor.
    VersionUnsatisfied {
        capability: String,
        provider: String,
        required: String,
        provided: String,
    },
    /// The floor string is malformed (defence in depth; load-validation already
    /// rejects it).
    InvalidVersionReq {
        capability: String,
        requirement: String,
        reason: String,
    },
}

impl BindingError {
    /// A stable machine token (for JSON error payloads / logging).
    pub fn code(&self) -> &'static str {
        match self {
            BindingError::Unprovided { .. } => "capability_unprovided",
            BindingError::Ambiguous { .. } => "capability_ambiguous",
            BindingError::OverrideNotProvider { .. } => "capability_override_not_provider",
            BindingError::VersionUnsatisfied { .. } => "capability_version_unsatisfied",
            BindingError::InvalidVersionReq { .. } => "capability_invalid_version_req",
        }
    }
}

impl std::fmt::Display for BindingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BindingError::Unprovided { capability } => {
                write!(
                    f,
                    "no available provider for capability '{capability}' (none installed, or the provider is disabled)"
                )
            }
            BindingError::Ambiguous {
                capability,
                providers,
            } => write!(
                f,
                "capability '{capability}' is provided by multiple plugins ({}) — set a binding override to choose one",
                providers.join(", ")
            ),
            BindingError::OverrideNotProvider { capability, chosen } => write!(
                f,
                "binding override for '{capability}' names '{chosen}', which does not provide it"
            ),
            BindingError::VersionUnsatisfied {
                capability,
                provider,
                required,
                provided,
            } => write!(
                f,
                "provider '{provider}' offers capability '{capability}' v{provided}, which does not satisfy the required '{required}'"
            ),
            BindingError::InvalidVersionReq {
                capability,
                requirement,
                reason,
            } => write!(
                f,
                "capability '{capability}' has an invalid version requirement '{requirement}': {reason}"
            ),
        }
    }
}

impl std::error::Error for BindingError {}

/// One provider candidate of a capability, paired with the entry that declares it.
/// `pub` because [`BindingRegistry::resolve_provider`] returns it — the capability
/// tool facade lives outside this module and needs the provider's `ProvidesEntry` to
/// read its verb→tool bindings.
pub type Candidate<'a> = (
    &'a PluginManifest,
    &'a crate::plugin_manifest::ProvidesEntry,
);

/// The deterministic pick among 2+ providers of a **selectable** capability, or
/// `None` when the capability is not selectable (⇒ the caller raises `Ambiguous`,
/// preserving the original strict behaviour verbatim).
///
/// Selectability is a property of the capability, so it is only honoured when
/// **every** candidate declares [`ProvidesEntry::selectable`]. Unanimity is the
/// fail-closed reading: a single third-party manifest cannot loosen a strict
/// capability (`rag`, `engines`) by unilaterally declaring itself selectable.
///
/// Among selectable providers the pick is: the one declaring
/// [`ProvidesEntry::default_provider`], else the lexicographically-lowest plugin id.
/// Both are pure functions of the candidate set — the property the disable-safety
/// argument in the module docs relies on. Ties on `default` (two manifests both
/// claiming it) degrade to the same lexicographic rule rather than erroring, so a
/// bad third-party manifest can never brick an enable.
fn pick_selectable<'a>(providers: &[Candidate<'a>]) -> Option<Candidate<'a>> {
    if !providers.iter().all(|(_, p)| p.selectable) {
        return None;
    }
    let lowest = |set: &[Candidate<'a>]| -> Option<Candidate<'a>> {
        set.iter().min_by(|(a, _), (b, _)| a.id.cmp(&b.id)).copied()
    };
    let defaults: Vec<Candidate<'a>> = providers
        .iter()
        .filter(|(_, p)| p.default_provider)
        .copied()
        .collect();
    if defaults.is_empty() {
        lowest(providers)
    } else {
        lowest(&defaults)
    }
}

/// Whether a capability is **selectable** over `candidates` — many providers may be
/// enabled at once and the user picks one. Reported to the UI so a layer picker can
/// render a radio list instead of an ambiguity error. A capability with fewer than
/// two providers is still selectable if its providers say so; the flag describes the
/// contract, not the current install state.
pub fn is_selectable(candidates: &[PluginManifest], capability: &str) -> bool {
    let mut any = false;
    for m in candidates {
        for p in m.provided_capabilities() {
            if p.capability == capability {
                if !p.selectable {
                    return false;
                }
                any = true;
            }
        }
    }
    any
}

/// One provider row in a [`CapabilityInfo`] — what a layer picker renders.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct CapabilityProvider {
    /// The provider plugin's app id.
    pub id: String,
    /// Its display name.
    pub name: String,
    /// The capability version it serves.
    pub version: String,
    /// Whether it declares itself the default pick.
    pub is_default: bool,
    /// The capability verbs it can serve (keys of [`ProvidesEntry::tools`]).
    pub verbs: Vec<String>,
    /// Whether this provider binds any capability verb. A provider may legitimately
    /// declare a capability with no verb bindings, but SELECTING one that serves
    /// nothing at all makes every verb of that layer disappear with no error.
    /// Surfaced so a picker can mark such a provider unselectable instead of offering
    /// a choice that silently turns the layer off.
    ///
    /// **Not sufficient on its own to answer "can this be picked"** — see
    /// [`Self::serves_route`]. Reading this flag alone is what disabled every
    /// `document.parse` provider in the desktop picker.
    pub serves_verbs: bool,
    /// Whether this provider serves the capability over a **broker-proxyable HTTP
    /// route** instead of verb bindings.
    ///
    /// The other half of "does selecting this actually do anything", and NOT a
    /// refinement of [`Self::serves_verbs`]: the two are alternative serving
    /// surfaces, and a capability may be built entirely on this one. `document.parse`
    /// is — Core resolves the binding and then calls the provider's sidecar route
    /// directly (`crate::document_parse`), so all four of its providers declare zero
    /// `tools` and are perfectly functional. A picker that reads only `serves_verbs`
    /// concluded the opposite and disabled every row, which is the bug this exists to
    /// close; the honest question a picker must ask is `serves_verbs || serves_route`.
    ///
    /// Mirrors what [`crate::sidecar::ext_proxy::resolve_provider_route`] actually
    /// requires — `sidecar` AND `route` declared, and the named sidecar present on
    /// this manifest — rather than the weaker `route.is_some()`. A route with no
    /// resolvable sidecar is exactly the dead-end the `serves_verbs` gate was built to
    /// prevent, so it must not be laundered into "selectable" here.
    pub serves_route: bool,
    /// What this provider acts on, when the capability controls a machine or an
    /// environment ([`crate::plugin_manifest::ProvidesEntry::target`]). `None` =
    /// not applicable or undeclared.
    ///
    /// Load-bearing for honesty, not decoration: within one capability, providers
    /// that differ here are NOT interchangeable in the way the word "swap"
    /// implies — `computer.control`'s two providers type on two different
    /// computers. A picker must render that difference.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<crate::plugin_manifest::ProviderTarget>,
}

/// One capability and everything a picker needs to render + change it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct CapabilityInfo {
    /// The capability name (`"web.search"`, `"rag"`, …).
    pub capability: String,
    /// Whether many providers may be enabled at once and one is picked.
    pub selectable: bool,
    /// Every ENABLED candidate provider, sorted by id.
    pub providers: Vec<CapabilityProvider>,
    /// Providers that serve this capability but are NOT enabled, sorted by id.
    ///
    /// Empty for a fully-enabled capability. Non-empty (with an empty
    /// [`Self::providers`]) is the "nothing serves this yet, but something could"
    /// state, which a picker must render rather than hide: every `web.search`
    /// provider ships opt-in, so that toolkit was invisible on a fresh install and
    /// nothing told the user the Store had five candidates.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub available: Vec<CapabilityProvider>,
    /// The provider currently bound, or `None` when the capability does not resolve
    /// (unprovided, or ambiguous and not selectable).
    pub bound: Option<String>,
    /// Set when the current binding comes from an explicit user override rather than
    /// the automatic pick.
    pub overridden: bool,
}

/// Whether `entry` names a broker-proxyable HTTP route on `manifest`.
///
/// Deliberately mirrors [`crate::sidecar::ext_proxy::resolve_provider_route`]'s
/// preconditions instead of the weaker `entry.route.is_some()`: that function 501s
/// unless BOTH `sidecar` and `route` are declared, and 500s unless the manifest
/// actually carries a sidecar by that name. Reporting a route the broker would
/// refuse to resolve would hand a picker the same dead-end pick that
/// [`CapabilityProvider::serves_verbs`] exists to keep it away from.
fn serves_route(manifest: &PluginManifest, entry: &crate::plugin_manifest::ProvidesEntry) -> bool {
    let (Some(sidecar), Some(_route)) = (&entry.sidecar, &entry.route) else {
        return false;
    };
    manifest.sidecars.iter().any(|s| &s.name == sidecar)
}

/// One provider row for the read model.
///
/// Shared by the `providers` (enabled) and `available` (installable) lists so a flag
/// added to one cannot silently go missing from the other — the two lists are
/// rendered by the same picker and any asymmetry reads as a difference in the
/// provider rather than in the code that built the row.
fn provider_row(
    manifest: &PluginManifest,
    entry: &crate::plugin_manifest::ProvidesEntry,
) -> CapabilityProvider {
    CapabilityProvider {
        id: manifest.id.clone(),
        name: manifest.name.clone(),
        version: entry.version.clone(),
        is_default: entry.default_provider,
        serves_verbs: !entry.tools.is_empty(),
        serves_route: serves_route(manifest, entry),
        target: entry.target,
        verbs: entry.tools.keys().cloned().collect(),
    }
}

/// Describe every capability provided anywhere in `candidates`, with its providers
/// and current binding. The read model behind `GET /api/capabilities` and the
/// desktop layer picker. Pure — no I/O.
pub fn describe_capabilities(
    candidates: &[PluginManifest],
    known: &[PluginManifest],
    config: &BindingConfig,
) -> Vec<CapabilityInfo> {
    let registry = BindingRegistry::new(config, candidates);
    // Names come from the KNOWN set, not just the enabled one. Deriving them from
    // enabled providers alone made a capability whose providers are all disabled
    // disappear from the read model entirely - no row, not even an empty one - so a
    // picker could not tell "nothing provides this" apart from "this does not
    // exist". `web.search` hit exactly that: every one of its five providers ships
    // opt-in, so on a fresh install the toolkit was invisible and nothing pointed
    // at the Store. `web.extract` / `web.crawl` only escaped it because `spider`
    // happens to be default-on.
    let mut names: Vec<String> = known
        .iter()
        .flat_map(|m| {
            m.provided_capabilities()
                .iter()
                .map(|p| p.capability.clone())
        })
        .collect();
    names.sort();
    names.dedup();

    names
        .into_iter()
        .map(|capability| {
            let mut providers: Vec<CapabilityProvider> = candidates
                .iter()
                .filter_map(|m| {
                    m.provided_capabilities()
                        .iter()
                        .find(|p| p.capability == capability)
                        .map(|p| provider_row(m, p))
                })
                .collect();
            providers.sort_by(|a, b| a.id.cmp(&b.id));
            // Providers that could serve this capability but are not enabled. This
            // is what lets a picker say "install or enable one" instead of hiding
            // the capability, and it is the only place a user learns that a toolkit
            // they cannot see has candidates waiting in the Store.
            let enabled_ids: std::collections::HashSet<&str> =
                candidates.iter().map(|m| m.id.as_str()).collect();
            let mut available: Vec<CapabilityProvider> = known
                .iter()
                .filter(|m| !enabled_ids.contains(m.id.as_str()))
                .filter_map(|m| {
                    m.provided_capabilities()
                        .iter()
                        .find(|p| p.capability == capability)
                        .map(|p| provider_row(m, p))
                })
                .collect();
            available.sort_by(|a, b| a.id.cmp(&b.id));
            let bound = registry
                .resolve(&CapabilityReq {
                    capability: capability.clone(),
                    min_version: None,
                })
                .ok()
                .map(|b| b.provider_id);
            CapabilityInfo {
                // Selectability is read off the KNOWN set: a capability whose
                // providers are all disabled still has a true answer, and reading it
                // from the enabled set would report `false` for every such
                // capability and hide it from the picker a second time.
                selectable: is_selectable(known, &capability),
                overridden: config.overrides.contains_key(&capability),
                providers,
                available,
                bound,
                capability,
            }
        })
        .collect()
}

/// The binding registry — a thin resolver over a candidate manifest set plus the
/// user override config. Borrows both; constructing it is free.
pub struct BindingRegistry<'a> {
    config: &'a BindingConfig,
    candidates: &'a [PluginManifest],
}

impl<'a> BindingRegistry<'a> {
    /// Build a registry over `candidates` (the manifest set a capability may bind
    /// to — the *installed* set at enable time, the *enabled* set at disable time)
    /// and the user override `config`.
    pub fn new(config: &'a BindingConfig, candidates: &'a [PluginManifest]) -> Self {
        Self { config, candidates }
    }

    /// Resolve one required capability to a concrete provider binding, applying the
    /// ladder in the module docs. Pure — no I/O, no mutation.
    pub fn resolve(&self, req: &CapabilityReq) -> Result<Binding, BindingError> {
        // 1. Collect providers of this capability (the provider's own ProvidesEntry
        //    carries the served capability version).
        let providers: Vec<(&PluginManifest, &crate::plugin_manifest::ProvidesEntry)> = self
            .candidates
            .iter()
            .filter_map(|m| {
                m.provided_capabilities()
                    .iter()
                    .find(|p| p.capability == req.capability)
                    .map(|p| (m, p))
            })
            .collect();

        if providers.is_empty() {
            return Err(BindingError::Unprovided {
                capability: req.capability.clone(),
            });
        }

        // 2. Pick: override > single provider > (selectable: declared default >
        //    lowest id) > ambiguous.
        let (provider, entry) = if let Some(chosen) = self.config.overrides.get(&req.capability) {
            *providers
                .iter()
                .find(|(m, _)| &m.id == chosen)
                .ok_or_else(|| BindingError::OverrideNotProvider {
                    capability: req.capability.clone(),
                    chosen: chosen.clone(),
                })?
        } else if providers.len() == 1 {
            providers[0]
        } else if let Some(pick) = pick_selectable(&providers) {
            pick
        } else {
            let mut ids: Vec<String> = providers.iter().map(|(m, _)| m.id.clone()).collect();
            ids.sort();
            return Err(BindingError::Ambiguous {
                capability: req.capability.clone(),
                providers: ids,
            });
        };

        // 3. Capability-version floor (checked against ProvidesEntry.version).
        if let Some(min) = &req.min_version {
            let want =
                parse_min_version(min).map_err(|reason| BindingError::InvalidVersionReq {
                    capability: req.capability.clone(),
                    requirement: min.clone(),
                    reason,
                })?;
            let have = semver::Version::parse(&entry.version).map_err(|e| {
                BindingError::InvalidVersionReq {
                    capability: req.capability.clone(),
                    requirement: entry.version.clone(),
                    reason: format!("provider version is not valid semver: {e}"),
                }
            })?;
            if !want.matches(&have) {
                return Err(BindingError::VersionUnsatisfied {
                    capability: req.capability.clone(),
                    provider: provider.id.clone(),
                    required: min.clone(),
                    provided: entry.version.clone(),
                });
            }
        }

        Ok(Binding {
            capability: req.capability.clone(),
            provider_id: provider.id.clone(),
            provided_version: entry.version.clone(),
        })
    }

    /// Resolve a capability named directly, with no version floor — the entry point
    /// for *call-time* consumers (the capability tool facade) as opposed to the
    /// enable-time graph, which always comes in through a [`CapabilityReq`].
    pub fn resolve_by_name(&self, capability: &str) -> Result<Binding, BindingError> {
        self.resolve(&CapabilityReq {
            capability: capability.to_owned(),
            min_version: None,
        })
    }

    /// The bound provider's manifest plus the [`ProvidesEntry`] that declares the
    /// capability — what the facade needs to read the verb→tool bindings. `Err`
    /// carries the same explicit refusal [`Self::resolve`] would give.
    pub fn resolve_provider(&self, capability: &str) -> Result<Candidate<'a>, BindingError> {
        let binding = self.resolve_by_name(capability)?;
        self.candidates
            .iter()
            .find(|m| m.id == binding.provider_id)
            .and_then(|m| {
                m.provided_capabilities()
                    .iter()
                    .find(|p| p.capability == capability)
                    .map(|p| (m, p))
            })
            .ok_or_else(|| BindingError::Unprovided {
                capability: capability.to_owned(),
            })
    }

    /// Resolve every required capability of one plugin. Returns the successful
    /// bindings and, separately, every capability that failed — so a caller can
    /// refuse enable with the full list rather than one error at a time.
    pub fn resolve_all(&self, manifest: &PluginManifest) -> (Vec<Binding>, Vec<BindingError>) {
        let mut ok = Vec::new();
        let mut errs = Vec::new();
        for req in manifest.required_capabilities() {
            match self.resolve(req) {
                Ok(b) => ok.push(b),
                Err(e) => errs.push(e),
            }
        }
        (ok, errs)
    }
}

/// Scan a candidate set (the **post-enable enabled set** at the enable gate, or the
/// enabled set generally) and return the first consumer whose required capabilities
/// do not all bind, with the failing [`BindingError`]. `None` ⇒ every consumer binds
/// deterministically — the enabled-set invariant (see module docs) holds.
///
/// This is the gate that catches the "enable a second provider ⇒ orphan an existing
/// consumer" hole: run over `currently_enabled ∪ about_to_enable`, it flags the
/// pre-existing consumer that the new provider would make ambiguous, so the enable is
/// refused instead of silently breaking that consumer's broker calls + disable-safety.
pub fn first_binding_error(
    candidates: &[PluginManifest],
    config: &BindingConfig,
) -> Option<(String, BindingError)> {
    let registry = BindingRegistry::new(config, candidates);
    for m in candidates {
        if let Some(err) = registry.resolve_all(m).1.into_iter().next() {
            return Some((m.id.clone(), err));
        }
    }
    None
}

/// Lower every plugin's required capabilities in `manifests` into **bare** app-id
/// graph edges, returning a cloned manifest set the `graph` resolver can consume
/// unchanged. A capability that fails to bind (unprovided / ambiguous) is **skipped**
/// here — the graph is a statement about presence and order; bind *errors* are
/// surfaced separately by the enable path via [`BindingRegistry::resolve_all`], which
/// refuses enable before this lowering ever runs. Duplicate edges (a capability that
/// resolves to a plugin already named in `requires.apps`) are de-duplicated so the
/// graph's diamond handling isn't relied on for a self-inflicted double.
pub fn lower_manifests(
    manifests: &[PluginManifest],
    config: &BindingConfig,
) -> Vec<PluginManifest> {
    let registry = BindingRegistry::new(config, manifests);
    manifests
        .iter()
        .map(|m| {
            let (bindings, _errs) = registry.resolve_all(m);
            if bindings.is_empty() {
                return m.clone();
            }
            let mut lowered = m.clone();
            let requires = lowered
                .requires
                .get_or_insert_with(crate::plugin_manifest::Requires::default);
            for b in bindings {
                // Never self-edge (a plugin providing a capability it also requires),
                // and never duplicate an existing app edge.
                if b.provider_id == m.id {
                    continue;
                }
                if requires.apps.iter().any(|a| a.id == b.provider_id) {
                    continue;
                }
                requires.apps.push(AppDependency {
                    id: b.provider_id,
                    min_version: None,
                });
            }
            lowered
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_manifest::{ProvidesEntry, Requires};

    fn provider(id: &str, cap: &str, version: &str) -> PluginManifest {
        PluginManifest {
            id: id.to_owned(),
            name: id.to_owned(),
            version: "1.0.0".to_owned(),
            provides: vec![ProvidesEntry {
                capability: cap.to_owned(),
                version: version.to_owned(),
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    /// A provider of a **selectable** capability (the engine-style flavour: many
    /// enabled, one picked).
    fn selectable_provider(id: &str, cap: &str, is_default: bool) -> PluginManifest {
        let mut m = provider(id, cap, "1.0.0");
        m.provides[0].selectable = true;
        m.provides[0].default_provider = is_default;
        m
    }

    fn consumer(id: &str, cap: &str, min: Option<&str>) -> PluginManifest {
        PluginManifest {
            id: id.to_owned(),
            name: id.to_owned(),
            version: "1.0.0".to_owned(),
            requires: Some(Requires {
                capabilities: vec![CapabilityReq {
                    capability: cap.to_owned(),
                    min_version: min.map(str::to_owned),
                }],
                ..Default::default()
            }),
            ..Default::default()
        }
    }

    fn req(cap: &str, min: Option<&str>) -> CapabilityReq {
        CapabilityReq {
            capability: cap.to_owned(),
            min_version: min.map(str::to_owned),
        }
    }

    #[test]
    fn overrides_json_round_trips_and_tolerates_garbage() {
        let mut cfg = BindingConfig::default();
        cfg.overrides
            .insert("rag".to_owned(), "graphrag".to_owned());
        cfg.overrides.insert("tts".to_owned(), "piper".to_owned());
        let json = overrides_to_json(&cfg);
        assert_eq!(config_from_overrides_json(&json), cfg);
        // Malformed / empty ⇒ default (never blocks startup).
        assert_eq!(
            config_from_overrides_json("not json"),
            BindingConfig::default()
        );
        assert_eq!(config_from_overrides_json("{}"), BindingConfig::default());
    }

    #[test]
    fn single_provider_binds_zero_config() {
        let set = vec![
            provider("rag-app", "rag", "1.5.0"),
            consumer("spaces", "rag", None),
        ];
        let cfg = BindingConfig::default();
        let reg = BindingRegistry::new(&cfg, &set);
        let b = reg.resolve(&req("rag", None)).expect("binds");
        assert_eq!(b.provider_id, "rag-app");
        assert_eq!(b.provided_version, "1.5.0");
    }

    #[test]
    fn no_provider_is_unprovided() {
        let set = vec![consumer("spaces", "rag", None)];
        let cfg = BindingConfig::default();
        let reg = BindingRegistry::new(&cfg, &set);
        assert_eq!(
            reg.resolve(&req("rag", None)).unwrap_err(),
            BindingError::Unprovided {
                capability: "rag".to_owned()
            }
        );
    }

    #[test]
    fn two_providers_no_override_is_ambiguous_not_silent_pick() {
        let set = vec![
            provider("graphrag", "rag", "2.0.0"),
            provider("vecrag", "rag", "1.0.0"),
        ];
        let cfg = BindingConfig::default();
        let reg = BindingRegistry::new(&cfg, &set);
        match reg.resolve(&req("rag", None)).unwrap_err() {
            BindingError::Ambiguous { providers, .. } => {
                assert_eq!(providers, vec!["graphrag".to_owned(), "vecrag".to_owned()]);
            }
            other => panic!("expected Ambiguous, got {other:?}"),
        }
    }

    // ── Selectable capabilities (the engine-style flavour) ───────────────────

    #[test]
    fn selectable_two_providers_picks_the_declared_default() {
        let set = vec![
            selectable_provider("@ryu/tavily", "web.search", false),
            selectable_provider("@ryu/exa", "web.search", true),
        ];
        let cfg = BindingConfig::default();
        let reg = BindingRegistry::new(&cfg, &set);
        assert_eq!(
            reg.resolve_by_name("web.search").unwrap().provider_id,
            "@ryu/exa"
        );
    }

    #[test]
    fn selectable_without_a_default_picks_lowest_id_deterministically() {
        let set = vec![
            selectable_provider("@ryu/tavily", "web.search", false),
            selectable_provider("@ryu/brave", "web.search", false),
        ];
        let cfg = BindingConfig::default();
        let reg = BindingRegistry::new(&cfg, &set);
        // Deterministic, and stable across candidate ordering — the property the
        // disable-safety reconstruction argument depends on.
        assert_eq!(
            reg.resolve_by_name("web.search").unwrap().provider_id,
            "@ryu/brave"
        );
        let reversed = vec![set[1].clone(), set[0].clone()];
        let reg2 = BindingRegistry::new(&cfg, &reversed);
        assert_eq!(
            reg2.resolve_by_name("web.search").unwrap().provider_id,
            "@ryu/brave"
        );
    }

    #[test]
    fn override_still_beats_the_selectable_default() {
        let set = vec![
            selectable_provider("@ryu/tavily", "web.search", false),
            selectable_provider("@ryu/exa", "web.search", true),
        ];
        let mut cfg = BindingConfig::default();
        cfg.overrides
            .insert("web.search".to_owned(), "@ryu/tavily".to_owned());
        let reg = BindingRegistry::new(&cfg, &set);
        assert_eq!(
            reg.resolve_by_name("web.search").unwrap().provider_id,
            "@ryu/tavily"
        );
    }

    #[test]
    fn selectability_requires_unanimity_so_one_manifest_cannot_loosen_rag() {
        // A rogue third-party provider declaring itself selectable must NOT relax the
        // strict capability: the ambiguity refusal still stands.
        let mut rogue = provider("rogue-rag", "rag", "1.0.0");
        rogue.provides[0].selectable = true;
        let set = vec![provider("vecrag", "rag", "1.0.0"), rogue];
        let cfg = BindingConfig::default();
        let reg = BindingRegistry::new(&cfg, &set);
        assert!(matches!(
            reg.resolve_by_name("rag").unwrap_err(),
            BindingError::Ambiguous { .. }
        ));
        assert!(!is_selectable(&set, "rag"));
    }

    #[test]
    fn enable_gate_no_longer_refuses_a_second_selectable_provider() {
        // The engine UX: install five search backends, pick one. With the strict
        // flavour this consumer set would be refused at enable time.
        let mut set = vec![
            selectable_provider("@ryu/exa", "web.search", true),
            selectable_provider("@ryu/tavily", "web.search", false),
            selectable_provider("@ryu/brave", "web.search", false),
        ];
        set.push(consumer("agent-tools", "web.search", None));
        let cfg = BindingConfig::default();
        assert!(first_binding_error(&set, &cfg).is_none());
    }

    #[test]
    fn describe_capabilities_reports_providers_and_the_current_pick() {
        let set = vec![
            selectable_provider("@ryu/exa", "web.search", true),
            selectable_provider("@ryu/tavily", "web.search", false),
            provider("vecrag", "rag", "1.0.0"),
        ];
        let mut cfg = BindingConfig::default();
        cfg.overrides
            .insert("web.search".to_owned(), "@ryu/tavily".to_owned());
        let described = describe_capabilities(&set, &set, &cfg);

        let search = described
            .iter()
            .find(|c| c.capability == "web.search")
            .expect("web.search described");
        assert!(search.selectable);
        assert!(search.overridden);
        assert_eq!(search.bound.as_deref(), Some("@ryu/tavily"));
        assert_eq!(
            search
                .providers
                .iter()
                .map(|p| p.id.as_str())
                .collect::<Vec<_>>(),
            vec!["@ryu/exa", "@ryu/tavily"]
        );
        // Everything known is enabled here, so nothing is merely available.
        assert!(search.available.is_empty());

        let rag = described
            .iter()
            .find(|c| c.capability == "rag")
            .expect("rag described");
        assert!(!rag.selectable);
        assert!(!rag.overridden);
        assert_eq!(rag.bound.as_deref(), Some("vecrag"));
    }

    #[test]
    fn a_capability_whose_providers_are_all_disabled_is_still_described() {
        // The bug this closes: names used to come from the ENABLED set, so a
        // capability with candidates but none enabled vanished from the read model
        // entirely. A picker could not distinguish "nothing serves this" from "this
        // does not exist", and `web.search` - whose five providers all ship opt-in -
        // was therefore invisible on a fresh install with no pointer to the Store.
        let known = vec![
            selectable_provider("@ryu/exa", "web.search", true),
            selectable_provider("@ryu/tavily", "web.search", false),
        ];
        let enabled: Vec<PluginManifest> = Vec::new();
        let described = describe_capabilities(&enabled, &known, &BindingConfig::default());

        let search = described
            .iter()
            .find(|c| c.capability == "web.search")
            .expect("web.search must still be described when no provider is enabled");
        assert!(search.providers.is_empty(), "nothing is enabled");
        assert_eq!(
            search
                .available
                .iter()
                .map(|p| p.id.as_str())
                .collect::<Vec<_>>(),
            vec!["@ryu/exa", "@ryu/tavily"],
            "both candidates must be offered so the user can enable one"
        );
        assert_eq!(search.bound, None, "nothing can be bound");
        // Selectability is read off the KNOWN set; reading it from the empty enabled
        // set would report false and hide the row from the picker a second time.
        assert!(search.selectable);
    }

    #[test]
    fn override_disambiguates_two_providers() {
        let set = vec![
            provider("graphrag", "rag", "2.0.0"),
            provider("vecrag", "rag", "1.0.0"),
        ];
        let mut cfg = BindingConfig::default();
        cfg.overrides.insert("rag".to_owned(), "vecrag".to_owned());
        let reg = BindingRegistry::new(&cfg, &set);
        assert_eq!(
            reg.resolve(&req("rag", None)).unwrap().provider_id,
            "vecrag"
        );
    }

    #[test]
    fn override_naming_non_provider_is_rejected() {
        let set = vec![provider("rag-app", "rag", "1.0.0")];
        let mut cfg = BindingConfig::default();
        cfg.overrides
            .insert("rag".to_owned(), "@ryu/ghost".to_owned());
        let reg = BindingRegistry::new(&cfg, &set);
        assert_eq!(
            reg.resolve(&req("rag", None)).unwrap_err(),
            BindingError::OverrideNotProvider {
                capability: "rag".to_owned(),
                chosen: "@ryu/ghost".to_owned()
            }
        );
    }

    #[test]
    fn version_floor_checks_capability_version_not_app_version() {
        // Provider APP version 1.0.0 but CAPABILITY version 2.0.0 satisfies a
        // floor of 1.5.0 — proving the floor uses provides.version, not app semver.
        let set = vec![provider("rag-app", "rag", "2.0.0")];
        let cfg = BindingConfig::default();
        let reg = BindingRegistry::new(&cfg, &set);
        assert!(reg.resolve(&req("rag", Some("1.5.0"))).is_ok());
    }

    #[test]
    fn version_floor_unsatisfied_is_rejected() {
        let set = vec![provider("rag-app", "rag", "1.0.0")];
        let cfg = BindingConfig::default();
        let reg = BindingRegistry::new(&cfg, &set);
        assert_eq!(
            reg.resolve(&req("rag", Some("2.0.0"))).unwrap_err(),
            BindingError::VersionUnsatisfied {
                capability: "rag".to_owned(),
                provider: "rag-app".to_owned(),
                required: "2.0.0".to_owned(),
                provided: "1.0.0".to_owned(),
            }
        );
    }

    #[test]
    fn lowering_appends_bare_app_edge() {
        let set = vec![
            provider("rag-app", "rag", "1.5.0"),
            consumer("spaces", "rag", Some("1.0.0")),
        ];
        let cfg = BindingConfig::default();
        let lowered = lower_manifests(&set, &cfg);
        let spaces = lowered.iter().find(|m| m.id == "spaces").unwrap();
        // Exactly one bare app edge to the provider (min_version stripped).
        assert_eq!(spaces.dependencies().len(), 1);
        assert_eq!(spaces.dependencies()[0].id, "rag-app");
        assert_eq!(spaces.dependencies()[0].min_version, None);
    }

    #[test]
    fn lowering_skips_unbindable_capability() {
        // No provider for 'rag' ⇒ the edge is skipped (enable path refuses
        // separately); lowering never panics or fabricates an edge.
        let set = vec![consumer("spaces", "rag", None)];
        let cfg = BindingConfig::default();
        let lowered = lower_manifests(&set, &cfg);
        let spaces = lowered.iter().find(|m| m.id == "spaces").unwrap();
        assert_eq!(spaces.dependencies().len(), 0);
    }

    #[test]
    fn finetune_builtin_loads_after_the_kind_tag_fix() {
        // Regression: @ryu/finetune (default-on, a Python-sidecar app) silently
        // never loaded — the SidecarProcess `#[serde(tag="kind")]` consumed the inner
        // ExternalRuntimeConfig.kind, so its manifest failed to parse and it was
        // absent from the built-in set. The inner kind now defaults; it must load.
        let builtins = crate::plugin_manifest::PluginManifestLoader::load_builtins();
        assert!(
            builtins.iter().any(|m| m.id == "@ryu/finetune"),
            "@ryu/finetune now loads as a built-in"
        );
    }

    #[test]
    fn builtin_rag_capability_resolves_to_engines_through_the_real_graph() {
        // End-to-end over the SHIPPED manifests (not synthetic): @ryu/rag declares
        // `requires.capabilities=[engines]`, the `engines` built-in declares
        // `provides=[engines]`, so the binding resolves + lowers to a real app edge
        // and the graph orders engines before rag / refuses disabling engines.
        use crate::plugins::graph;
        let builtins = crate::plugin_manifest::PluginManifestLoader::load_builtins();
        let cfg = BindingConfig::default();

        // rag requires the `engines` capability, bound to the `engines` app.
        let rag = builtins
            .iter()
            .find(|m| m.id == "@ryu/rag")
            .expect("@ryu/rag built-in");
        let reg = BindingRegistry::new(&cfg, &builtins);
        let (bindings, errs) = reg.resolve_all(rag);
        assert!(errs.is_empty(), "rag's capabilities all bind: {errs:?}");
        assert!(
            bindings.iter().any(|b| b.provider_id == "@ryu/engines"),
            "rag's `engines` capability binds to the engines app"
        );

        // Lowered, the graph pulls engines in before rag and lists rag as a dependent
        // of engines (so engines can't be disabled out from under it).
        let lowered = lower_manifests(&builtins, &cfg);
        let order = graph::resolve_enable_order("@ryu/rag", &lowered).expect("resolves");
        let ei = order.iter().position(|id| id == "@ryu/engines");
        let ri = order.iter().position(|id| id == "@ryu/rag");
        assert!(ei < ri, "engines enabled before rag (order: {order:?})");
        assert!(
            graph::dependents_of("@ryu/engines", &lowered).contains(&"@ryu/rag".to_owned()),
            "rag is a dependent of engines"
        );

        // The L2 chain: spaces requires the `rag` capability, so the enable order is
        // engines → rag → spaces, and disabling rag is blocked while spaces is enabled.
        let spaces_order =
            graph::resolve_enable_order("@ryu/spaces", &lowered).expect("spaces resolves");
        let si = spaces_order.iter().position(|id| id == "@ryu/spaces");
        let sri = spaces_order.iter().position(|id| id == "@ryu/rag");
        let sei = spaces_order.iter().position(|id| id == "@ryu/engines");
        assert!(
            sei < sri && sri < si,
            "engines → rag → spaces (order: {spaces_order:?})"
        );
        assert!(
            graph::dependents_of("@ryu/rag", &lowered).contains(&"@ryu/spaces".to_owned()),
            "spaces is a dependent of rag (rag can't be disabled under spaces)"
        );
    }

    #[test]
    fn enabling_second_provider_that_orphans_a_consumer_is_caught() {
        // The invariant the enable gate must uphold. C requires `rag`, bound to the
        // sole provider P1 → the enabled set binds cleanly.
        let one = vec![provider("p1", "rag", "1.0.0"), consumer("c", "rag", None)];
        assert!(
            first_binding_error(&one, &BindingConfig::default()).is_none(),
            "single provider ⇒ every consumer binds"
        );

        // Now a SECOND provider P2 joins the enabled set. C would become ambiguous —
        // `first_binding_error` (run by enable_app over the post-enable enabled set)
        // flags C, so enabling P2 is refused instead of silently 409-ing C's broker
        // calls and orphaning it on disable.
        let two = vec![
            provider("p1", "rag", "1.0.0"),
            provider("p2", "rag", "1.0.0"),
            consumer("c", "rag", None),
        ];
        let (plugin, err) =
            first_binding_error(&two, &BindingConfig::default()).expect("ambiguity caught");
        assert_eq!(plugin, "c", "the pre-existing consumer is named");
        assert!(matches!(err, BindingError::Ambiguous { .. }));

        // With an override the second provider is fine — C binds to the chosen one.
        let mut cfg = BindingConfig::default();
        cfg.overrides.insert("rag".to_owned(), "p2".to_owned());
        assert!(
            first_binding_error(&two, &cfg).is_none(),
            "override disambiguates ⇒ enable allowed"
        );
    }

    #[test]
    fn lowered_capability_drives_real_graph_enable_and_disable() {
        // The end-to-end governance seam: a capability edge, once lowered, is honored
        // by the REAL graph resolver — enable pulls the provider in first, and
        // disabling the provider while the consumer is enabled is refused.
        use crate::plugins::graph;
        let set = vec![
            provider("rag-app", "rag", "1.0.0"),
            consumer("spaces", "rag", None),
        ];
        let cfg = BindingConfig::default();
        let lowered = lower_manifests(&set, &cfg);

        // Enable order: provider before consumer.
        let order = graph::resolve_enable_order("spaces", &lowered).expect("resolves");
        assert_eq!(order, vec!["rag-app".to_owned(), "spaces".to_owned()]);

        // Disable safety: `spaces` is a dependent of `rag-app`, so disabling the
        // provider is blocked (BlockedByDependents blast radius includes it).
        let dependents = graph::dependents_of("rag-app", &lowered);
        assert_eq!(dependents, vec!["spaces".to_owned()]);
    }

    #[test]
    fn lowering_dedups_against_existing_app_edge() {
        // A consumer that names the provider BOTH as an app dep and via a capability
        // must end up with a single edge, not a self-inflicted duplicate.
        let mut spaces = consumer("spaces", "rag", None);
        spaces.requires.as_mut().unwrap().apps.push(AppDependency {
            id: "rag-app".to_owned(),
            min_version: Some("1.0.0".to_owned()),
        });
        let set = vec![provider("rag-app", "rag", "1.0.0"), spaces];
        let cfg = BindingConfig::default();
        let lowered = lower_manifests(&set, &cfg);
        let s = lowered.iter().find(|m| m.id == "spaces").unwrap();
        assert_eq!(s.dependencies().len(), 1, "no duplicate edge");
        // The original app edge (with its min_version) is preserved.
        assert_eq!(s.dependencies()[0].min_version, Some("1.0.0".to_owned()));
    }
}
