//! Core-side driver for the out-of-process `ryu-healing` sidecar.
//!
//! Self-healing used to run in-process: `healing_host::spawn` published a
//! `ryu_healing::HealEngine` as a process-global, the scheduler + workflow executor
//! called `ryu_healing::global_engine().report_failure(...)` directly, and the
//! `/api/healing/*` HTTP surface was merged into Core's router. Healing is now an
//! out-of-process app (`@ryu/healing`): the `ryu-healing` sidecar owns the
//! diagnose→propose ENGINE, the per-source attempt cap (`healing-attempts.json`),
//! the `healing.*` prefs, the Gateway diagnosis call, and the public
//! `/api/healing/config|status` surface (served through the ext-proxy
//! `public_mount`).
//!
//! **The welded couplings stay in Core** and are driven from the sidecar's verdict:
//! a heal proposal embeds a Core `PendingAction` that the `ApprovalEngine` executes
//! on approve, and an auto-fix re-run reaches Core's agent runner / workflow store.
//! So the sidecar does NOT call back into Core; instead Core posts a failed run's
//! context to `POST /api/healing/report-failure`, the sidecar returns a
//! [`HealVerdict`], and [`HealingClient::apply`] dispatches it against
//! [`CoreHealingHost`] (the approvals write + the re-run). The three failure
//! surfaces that stay kernel drive this client:
//!
//! - **run-status bus** — [`spawn`] subscribes to
//!   [`crate::server::conversations::subscribe_run_events`], reads the failed run's
//!   instruction + failure output from the conversation store (both kernel), and
//!   posts them (the old in-process `healing_host` loop, now over loopback).
//! - **scheduler agent job** — the `JobTarget::Agent` failure arm posts via
//!   [`global_client`].
//! - **workflow run** — `fail_run` posts via [`global_client`].
//!
//! Security mirrors the ext-proxy hop exactly: loopback target on the sidecar's
//! declared port ([`crate::profile::port`]-shifted), with the per-plugin minted
//! bearer ([`crate::sidecar::ext_proxy::ext_token`]) the sidecar was spawned with —
//! nothing hardcoded. Fail-open: an unreachable sidecar (Self-Healing app disabled,
//! so the sidecar isn't spawned) means a run simply isn't auto-healed, never a wedge.
//!
//! **Core links no `ryu-healing` code.** The app is a satellite (AGENTS.md); the only
//! Rust the two halves share is `ryu-healing-contracts`, a serde-only crate that
//! neither of them owns, carrying the [`HealVerdict`] this module decodes plus the
//! two agreements that never appear on the wire — [`HEAL_PREFIX`] and the
//! [`truncate_context`] policy. Everything else the sidecar exposed to Core (the
//! `HealingHost` trait, `HealSource`, `apply_verdict`) was either dead here or
//! cheaper to state locally, so it stayed in the app.

use std::sync::Arc;

use serde_json::json;

use ryu_healing_contracts::{
    truncate_context, HealVerdict, HEAL_PREFIX, SOURCE_KIND_AGENT, SOURCE_KIND_WORKFLOW,
};

use crate::plugins::builtins::HEALING_PLUGIN_ID;
use crate::server::conversations::ConversationSummary;
use crate::server::ServerState;
use crate::sidecar::ext_proxy::{ext_token, node_token};

/// The `ryu-healing` sidecar's name inside the Self-Healing manifest — the other half
/// of the `(plugin id, sidecar name)` key the port resolves through.
const HEALING_SIDECAR: &str = "ryu-healing";

// ---------------------------------------------------------------------------
// HealSource — which kernel surface failed
// ---------------------------------------------------------------------------

/// What kind of run failed, at the two call sites that report one. Selects the
/// `kind` discriminant Core sends the sidecar.
///
/// Core-local rather than shared: this never crosses the wire as a *type* — it is
/// flattened to `kind` + `agent_id` strings in [`HealingClient::report_failure`] and
/// re-parsed sidecar-side — and each side wants a different shape anyway. What DOES
/// have to match is the `kind` spelling, so that comes from the shared contract
/// ([`ryu_healing_contracts::SOURCE_KIND_AGENT`] / `_WORKFLOW`) rather than a literal.
/// An enum rather than a bare `&str` keeps the flatten exhaustive, so adding a third
/// failure surface cannot forget it.
#[derive(Debug, Clone)]
pub enum HealSource {
    /// A chat / agent / scheduled-agent run: re-run the agent with a corrected
    /// prompt.
    Agent { agent_id: Option<String> },
    /// A workflow run: re-run the workflow from scratch (diagnosed retry).
    Workflow,
}

// ---------------------------------------------------------------------------
// CoreHealingHost — the welded-coupling side (approvals write + re-run)
// ---------------------------------------------------------------------------

/// The couplings that stay kernel, and the whole reason Core is in this loop at all:
/// a heal proposal has to land in Core's approvals inbox and an auto-fix has to
/// re-enter Core's agent runner / workflow store, neither of which a separate
/// process can reach. [`HealingClient::apply`] is the only caller.
///
/// This used to implement the app crate's `HealingHost` trait. Half of that trait
/// (`pref_*`, `default_diagnose_model`, `data_dir`, `call_side_model`) moved to the
/// sidecar when the engine did and was never invoked Core-side again, so the trait
/// had become five live methods carrying five dead ones. The dead half is deleted
/// and what is left is a plain inherent impl — Core no longer links the app to
/// declare it.
///
/// Stateless: every surviving method reaches a Core process-global
/// (`approvals::global_engine`, `agent_runner::global_agent_runner`,
/// `workflow::rerun_run`). The `ServerState` this struct used to hold existed only
/// for the read-side methods that moved to the sidecar.
pub struct CoreHealingHost;

impl CoreHealingHost {
    async fn rerun_agent(&self, agent_id: Option<String>, run_id: String, prompt: String) {
        if let Some(runner) = crate::sidecar::agent_runner::global_agent_runner() {
            if let Err(e) = runner.run(agent_id, run_id, prompt).await {
                tracing::warn!("healing: auto re-run failed: {e:#}");
            }
        }
    }

    async fn rerun_workflow(&self, source_id: &str) {
        if let Err(e) = crate::workflow::rerun_run(source_id).await {
            tracing::warn!("healing: auto workflow re-run failed for {source_id}: {e}");
        }
    }

    async fn queue_heal_fix(
        &self,
        source_id: &str,
        agent_id: Option<String>,
        diagnosis: &str,
        corrected: String,
    ) {
        if let Some(engine) = crate::approvals::global_engine() {
            let req = crate::approvals::ApprovalRequest::for_heal_fix(
                source_id, agent_id, diagnosis, corrected,
            );
            if let Err(e) = engine.request_deduped(req).await {
                tracing::warn!("healing: queue heal approval failed for {source_id}: {e:#}");
            }
        }
    }

    async fn queue_heal_workflow(&self, source_id: &str, diagnosis: &str) {
        if let Some(engine) = crate::approvals::global_engine() {
            let req = crate::approvals::ApprovalRequest::for_heal_workflow(source_id, diagnosis);
            if let Err(e) = engine.request_deduped(req).await {
                tracing::warn!("healing: queue workflow heal failed for {source_id}: {e:#}");
            }
        }
    }

    async fn queue_heal_exhausted(&self, source_id: &str, note: &str) {
        if let Some(engine) = crate::approvals::global_engine() {
            let req = crate::approvals::ApprovalRequest::for_heal_exhausted(source_id, note);
            if let Err(e) = engine.request_deduped(req).await {
                tracing::warn!("healing: escalation enqueue failed for {source_id}: {e:#}");
            }
        }
    }
}

// ---------------------------------------------------------------------------
// HealingClient — post-failure → verdict → apply
// ---------------------------------------------------------------------------

/// Typed loopback client for the `ryu-healing` sidecar. Cheap to clone (holds the
/// resolved port + a shared [`CoreHealingHost`]); the bearer is minted per call so
/// it always tracks the current node token.
#[derive(Clone)]
pub struct HealingClient {
    port: u16,
    host: Arc<CoreHealingHost>,
}

impl HealingClient {
    /// Build a client bound to the sidecar's resolved loopback port, applying
    /// verdicts against a [`CoreHealingHost`].
    pub fn new(port: u16) -> Self {
        Self {
            port,
            host: Arc::new(CoreHealingHost),
        }
    }

    fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}/api/healing", self.port)
    }

    /// The per-plugin minted bearer the sidecar was spawned with — the same value
    /// the ext-proxy stamps on its hop, so a hand-rolled local request without it is
    /// rejected fail-closed.
    fn bearer(&self) -> String {
        ext_token(node_token().as_deref(), HEALING_PLUGIN_ID)
    }

    /// Report a failed run to the sidecar and apply the returned verdict. Best-effort
    /// end to end: an unreachable sidecar (Self-Healing disabled) is a benign no-op,
    /// and a `Skip` verdict does nothing. The diagnosis is a slow Gateway call, so
    /// callers already run this inside a spawned, fire-and-forget task.
    pub async fn report_failure(
        &self,
        source_id: &str,
        source: HealSource,
        instruction: String,
        failure: String,
    ) {
        let kind = match source {
            HealSource::Agent { .. } => SOURCE_KIND_AGENT,
            HealSource::Workflow => SOURCE_KIND_WORKFLOW,
        };
        let agent_id = match &source {
            HealSource::Agent { agent_id } => agent_id.clone(),
            HealSource::Workflow => None,
        };
        let body = json!({
            "source_id": source_id,
            "kind": kind,
            "agent_id": agent_id,
            "instruction": instruction,
            "failure": failure,
        });
        let resp = reqwest::Client::new()
            .post(format!("{}/report-failure", self.base_url()))
            .bearer_auth(self.bearer())
            .json(&body)
            .send()
            .await;
        let resp = match resp {
            Ok(r) => r,
            Err(e) => {
                // Fail-open: the sidecar being down just means no auto-heal.
                tracing::debug!("healing: sidecar not reachable for {source_id} ({e})");
                return;
            }
        };
        if !resp.status().is_success() {
            tracing::debug!("healing: report-failure returned HTTP {}", resp.status());
            return;
        }
        let verdict: HealVerdict = match resp.json().await {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!("healing: unparseable verdict for {source_id}: {e}");
                return;
            }
        };
        // Core owns the welded action (approvals write / re-run).
        self.apply(verdict).await;
    }

    /// Dispatch the sidecar's verdict against Core's internals — the welded half the
    /// sidecar cannot perform itself. The mirror image of the app crate's
    /// `apply_verdict`, which drives the same enum against the sidecar's own host;
    /// the enum is shared, the dispatch is not, because the two sides' actions have
    /// nothing in common beyond the vocabulary.
    ///
    /// The re-run id is minted here rather than carried in the verdict: it is only
    /// meaningful at the moment the re-run starts, and its [`HEAL_PREFIX`] is the
    /// never-heal-a-heal marker the sidecar's `decide_heal` reads back off the next
    /// failure — which is why the prefix is a shared constant and not a literal.
    async fn apply(&self, verdict: HealVerdict) {
        match verdict {
            HealVerdict::Skip { reason } => tracing::debug!("healing: skip: {reason}"),
            HealVerdict::RerunAgent { agent_id, prompt } => {
                let run_id = format!("{HEAL_PREFIX}{}", uuid::Uuid::new_v4().simple());
                self.host.rerun_agent(agent_id, run_id, prompt).await;
            }
            HealVerdict::RerunWorkflow { source_id } => {
                self.host.rerun_workflow(&source_id).await;
            }
            HealVerdict::QueueFix {
                source_id,
                agent_id,
                diagnosis,
                corrected,
            } => {
                self.host
                    .queue_heal_fix(&source_id, agent_id, &diagnosis, corrected)
                    .await;
            }
            HealVerdict::QueueWorkflow {
                source_id,
                diagnosis,
            } => self.host.queue_heal_workflow(&source_id, &diagnosis).await,
            HealVerdict::QueueExhausted { source_id, note } => {
                self.host.queue_heal_exhausted(&source_id, &note).await;
            }
            // Binary skew, not source drift: the sidecar ships as its own executable
            // (`RYU_HEALING_BIN`), so a newer one can answer with an action this Core
            // has never heard of. The contract's catch-all makes that one verdict a
            // logged no-op instead of an unparseable body that drops every heal.
            HealVerdict::Unknown => {
                tracing::warn!("healing: sidecar returned an unknown verdict action, ignored");
            }
        }
    }
}

/// Process-global healing client so the scheduler (`JobTarget::Agent` failure arm)
/// and the workflow executor (`fail_run`) — neither of which carries `ServerState`
/// — can reach the sidecar. Set once from `main.rs`, mirroring the `quests_client`
/// pattern.
static GLOBAL_CLIENT: std::sync::OnceLock<HealingClient> = std::sync::OnceLock::new();

/// Publish the process-global healing client. Idempotent (first write wins).
pub fn set_global_client(client: HealingClient) {
    let _ = GLOBAL_CLIENT.set(client);
}

/// The process-global healing client, or `None` before `main.rs` has set it.
pub fn global_client() -> Option<&'static HealingClient> {
    GLOBAL_CLIENT.get()
}

/// Resolve the `ryu-healing` sidecar's loopback port from the loaded manifests,
/// profile-shifted the same way the ext-proxy forwards ([`crate::profile::port`]). The
/// port comes from the manifest and ONLY the manifest — see
/// [`crate::sidecar::ext_proxy::sidecar_port`] for why a built-in absence is a
/// build-time invariant rather than a runtime fallback. (This is orthogonal to the
/// fail-open posture above: that covers an *unreachable* sidecar, checked per call.)
pub fn sidecar_port(manifests: &[crate::plugin_manifest::PluginManifest]) -> u16 {
    crate::sidecar::ext_proxy::sidecar_port(manifests, HEALING_PLUGIN_ID, HEALING_SIDECAR).expect(
        "built-in healing.manifest.json must declare the ryu-healing sidecar (see \
         plugin_manifest::BUILTIN_MANIFESTS)",
    )
}

// ---------------------------------------------------------------------------
// Run-status bus loop (kernel: the bus + the conversation read stay Core-side)
// ---------------------------------------------------------------------------

/// Subscribe the run-status bus and drive the healing sidecar for failed chat/agent
/// runs. The bus + the conversation-store read stay kernel (Core-side); only the
/// engine moved out-of-process. Fail-open: a missed event (lagged/closed) only means
/// a run isn't auto-healed, never a wedge. Spawned unconditionally in `main.rs`.
pub fn spawn(client: HealingClient, state: ServerState) {
    tokio::spawn(async move {
        let mut rx = crate::server::conversations::subscribe_run_events();
        loop {
            match rx.recv().await {
                Ok(ev) => {
                    if ev.run.run_status.as_deref() == Some("failed") {
                        let client = client.clone();
                        let state = state.clone();
                        // Handle off the recv path so a slow diagnosis can't block
                        // draining the bus.
                        tokio::spawn(async move { handle_failed(&state, &client, ev.run).await });
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    tracing::warn!("healing: lagged {n} run events (fail-open, unhealed)");
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

/// Bus path: a chat/agent conversation run failed. Load its instruction + error from
/// the conversation store (kernel), then post to the sidecar.
async fn handle_failed(state: &ServerState, client: &HealingClient, run: ConversationSummary) {
    let (instruction, failure) = extract_context(state, &run.id).await;
    if instruction.is_empty() {
        tracing::debug!("healing: {} has no instruction to retry", run.id);
        return;
    }
    client
        .report_failure(
            &run.id,
            HealSource::Agent {
                agent_id: run.agent_id,
            },
            instruction,
            failure,
        )
        .await;
}

/// Load the failed run's last user instruction + last assistant/error output from
/// the kernel conversation store, applying the shared contract's length policy.
async fn extract_context(state: &ServerState, conv_id: &str) -> (String, String) {
    let Ok(messages) = state.conversations.get_messages(conv_id).await else {
        return (String::new(), String::new());
    };
    let mut instruction = String::new();
    let mut failure = String::new();
    for m in &messages {
        match m.role.as_str() {
            "user" => instruction = m.content.clone(),
            "assistant" => failure = m.content.clone(),
            _ => {}
        }
    }
    (truncate_context(&instruction), truncate_context(&failure))
}
