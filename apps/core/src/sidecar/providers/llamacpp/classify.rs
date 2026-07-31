//! Local **classify tier** — a dedicated llama.cpp instance serving a 270M model.
//!
//! Mirrors the reranker sidecar (`rerank.rs`) but serves a tiny instruction-tuned
//! GGUF on port 8083 in plain chat-completions mode (no `--embeddings`, no
//! `--reranking`), so the gateway can register it as its own `classify` provider.
//!
//! **Why this exists.** The gateway's two guardrail consumers — the firewall's
//! cheap-LLM traffic inspector (`firewall.inspector.model`) and smart routing's
//! classifier (`routing.smart_routing.classifier_model`) — both resolve a `gemma-*`
//! selection through `RoutingTables::route`, which before this unit sent every
//! `gemma` prefix to the gateway's `local` provider. That provider has a single
//! `base_url` pointing at the **resident chat engine**, and one llama-server serves
//! exactly one model (`process.rs`), so asking for a 270M classifier silently ran
//! the guardrail on the user's full-size chat model: slow, expensive, and nothing in
//! the UI said so. There was no small model to point at. This sidecar is it.
//!
//! Placement (CLAUDE.md §1): deciding *which* model classifies is "what runs" →
//! Core. The model + URL are swappable registry defaults (`local_classifier_model`),
//! never hardcoded.
//!
//! Like the reranker this sidecar is **off by default** — it is NOT in
//! `startup_order`, so it consumes no memory until something selects the classify
//! tier. Core's gateway config-push path lazily starts it
//! (`crate::sidecar::gateway::push_config`) when a pushed config selects a classify
//! model. Both consumers fail **open** (a timeout or unreachable provider is treated
//! as "no verdict": allow + warn), so a classify server that is not warm yet degrades
//! to no guardrail verdict, never to a broken request.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use anyhow::Context;

use crate::sidecar::providers::llamacpp::{
    process::{LlamaCppProcess, LlamaCppStartOptions},
    LlamaCppDownloader,
};
use crate::sidecar::{BoxFuture, HealthStatus, Sidecar};

/// The name this sidecar is registered under, and therefore the only string that
/// [`crate::sidecar::SidecarManager::start_sidecar`] will resolve to it.
///
/// **Load-bearing, not tidiness.** Three independent places have to agree on it —
/// [`Sidecar::name`] here, the lazy start in `sidecar/gateway.rs`, and
/// [`crate::sidecar::onboarding`]'s `LLAMACPP_DERIVED_SIDECARS` (which is what marks
/// the sidecar *installed*; `start_sidecar` refuses anything absent from the
/// installed set). Until this const existed all three were bare literals, so a
/// rename in one place produced a lazy start that returns
/// `"'llamacpp-classify' is not installed"` — a permanently dead guardrail on every
/// node, because both consumers fail OPEN. The desktop has had a
/// `CLASSIFY_SIDECAR_NAME` plus a mirror test since the badge shipped
/// (`apps/desktop/src/lib/api/gateway.ts`); Rust had neither.
pub const CLASSIFY_SIDECAR_NAME: &str = "llamacpp-classify";

/// Canonical (release) loopback port the classify server binds to. Distinct from
/// the chat engine's 8080, the embeddings server's 8081 and the reranker's 8082 so
/// all four can run together. The concrete port is profile-aware — see
/// [`classify_port`].
pub const CLASSIFY_PORT_BASE: u16 = 8083;

/// Profile-aware classify port (release 8083, dev 9083, …). The gateway that dials
/// this resolves the SAME port from `RYU_CLASSIFY_LLM_URL`, which Core computes via
/// this function in `gateway::gateway_spawn_env`, so spawn and client never diverge.
pub fn classify_port() -> u16 {
    crate::profile::port(CLASSIFY_PORT_BASE)
}

/// Loopback `host:port` the classify server binds to (profile-aware).
fn classify_addr() -> String {
    format!("127.0.0.1:{}", classify_port())
}

// ── Lazy-start failure record ───────────────────────────────────────────────────
//
// The tier is started fire-and-forget from `sidecar/gateway.rs`, off a config push
// that has already returned to its caller. There is no request to fail and no
// `Result` to hand anywhere, so before this record a failed start left only a log
// line. That is the gap: the desktop's classify-tier badge
// (`deriveClassifyTierState`) crosses `/api/sidecar/status` with a weights probe,
// which distinguishes exactly ONE cause (`unweighted`) and reads every other —
// llama.cpp binary missing, port taken, name not in the installed set, download
// center unwired — as the sidecar's normal lazy `idle`.
//
// Modelled on `manifest_sidecar`'s `missing_binary_record`: a process-global keyed
// record, written on failure, CLEARED by the success path, and surfaced through
// [`HealthStatus`] — the reason channel that already exists — rather than a new one.

/// Why the classify tier is not up, or `None` if the most recent start succeeded (or
/// nothing has been attempted). One slot, not a log: the useful question is always
/// "can the tier serve right now, and if not why", never "how many times".
///
/// Two kinds of writer, both from the lazy-start hook in `sidecar/gateway.rs`:
/// a start that FAILED, and a start that was deliberately SKIPPED in a state that
/// cannot be told apart from a misconfiguration (`RYU_CLASSIFY_LLM_URL` repointed
/// while the model id is still the registry default). The slot is named for the first
/// because that is what it was built for; both answer the same question, and a skip
/// that is genuinely benign — an external tier configured in full, a remote gateway —
/// deliberately writes nothing.
fn lazy_start_failure() -> &'static Mutex<Option<String>> {
    static RECORD: std::sync::OnceLock<Mutex<Option<String>>> = std::sync::OnceLock::new();
    RECORD.get_or_init(|| Mutex::new(None))
}

/// Record why the tier is not up: the flattened `anyhow` chain when a lazy start
/// failed, or an explanation when one was skipped in a state indistinguishable from a
/// misconfiguration.
///
/// The WRITE half of the seam. Both callers are in [`crate::sidecar::gateway`]'s
/// `maybe_start_classify_tier` — the fire-and-forget spawn (the only place that ever
/// sees the start's `Err`) and its second spend gate. A poisoned lock is dropped
/// silently — losing a diagnostic must never be able to panic the task that was
/// already handling a failure.
pub fn record_lazy_start_failure(reason: String) {
    if let Ok(mut slot) = lazy_start_failure().lock() {
        *slot = Some(reason);
    }
}

/// Forget any recorded failure. Called by the success paths ([`Sidecar::start`]'s
/// adopt and spawn branches) so the record can only ever describe the CURRENT state
/// — the same self-clearing contract that lets a reader treat any entry in
/// `manifest_sidecar::missing_sidecar_binary_reports` as actionable.
fn clear_lazy_start_failure() {
    if let Ok(mut slot) = lazy_start_failure().lock() {
        *slot = None;
    }
}

/// The recorded reason, if the last lazy start failed or was skipped in a state that
/// cannot be told apart from a misconfiguration.
///
/// The READ half. Its only consumer today is this module's [`Sidecar::health_check`],
/// which is why it is not `pub`: the `/api/sidecar/status` key that would put this in
/// front of a user lives in `server/mod.rs`, outside this change set. That followup is
/// the point of the seam — mirroring the note on
/// `SidecarManager::native_sidecar_permissions`. Be honest about the reach today: a
/// failed lazy start spawns NO health monitor (`start_sidecar` only calls
/// `spawn_health_monitor` after `start()` returns `Ok`) and nothing wakes this
/// sidecar through `await_healthy` (the gateway dials its port directly, never through
/// Core's ext-proxy), so on the failure path the `warn!` at the call site is what a
/// human actually sees. This record makes the reason *retrievable*; wiring the status
/// key is what will make it *visible*. The same is true of the skip path added beside
/// it: a skipped start spawns no monitor either, so its `warn!` carries the same
/// weight.
fn lazy_start_failure_reason() -> Option<String> {
    lazy_start_failure().lock().ok().and_then(|s| s.clone())
}

/// Poison-tolerant lock serializing every test — in ANY module — that reads or writes
/// the process-global record above.
///
/// `cargo` runs a crate's unit tests in ONE process, in parallel. Two modules write
/// this slot now (this one's own test, and `sidecar::gateway`'s spend-gate test), so
/// without a shared lock a write from one can land inside the other's "the record is
/// empty" window and fail it for the wrong reason. Lives here because this module owns
/// the record, exactly like `sidecar::gateway`'s `GATEWAY_ENV_TEST_LOCK`.
#[cfg(test)]
pub(crate) fn lock_lazy_start_record() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: Mutex<()> = Mutex::new(());
    LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

/// Test-only reader for the record, for the `sidecar::gateway` spend-gate test that
/// writes it through [`record_lazy_start_failure`]. Not `pub(crate)` on the real
/// reader: production visibility stays exactly as narrow as it was.
#[cfg(test)]
pub(crate) fn lazy_start_failure_reason_for_test() -> Option<String> {
    lazy_start_failure_reason()
}

/// Test-only clear, so a cross-module test can leave the slot as it found it.
#[cfg(test)]
pub(crate) fn clear_lazy_start_failure_for_test() {
    clear_lazy_start_failure();
}

/// Who owns the classify server that answered the port probe — the question the
/// adopt branch of [`Sidecar::start`] has to answer, and the one it used to get wrong.
///
/// The lazy start fires on EVERY gateway config push that selects the tier, so after
/// the first one the port is normally already answering. Before this enum, *any*
/// answering port was recorded as `adopted_external = true`, including the server
/// **this manager spawned on the previous push** — which made the next [`Sidecar::stop`]
/// a no-op that left our own llama-server resident and unstoppable, and made
/// [`Sidecar::is_running`] return `true` unconditionally instead of reflecting the child
/// we hold. That flows straight to the user: `deriveClassifyTierState` maps a `true` in
/// `/api/sidecar/status` to `"running"` with no second opinion, and `"running"` prints
/// the badge "Local classifier running" (`apps/desktop/src/lib/api/gateway.ts:606-628`
/// and `:672`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReachableServer {
    /// The child this manager spawned on an earlier start is still held: we own it,
    /// so `stop` must kill it and `is_running` must report the handle's state.
    OurChild,
    /// A server this manager did not spawn — an operator's own `llama-server`, a
    /// leftover from a previous Core process, another profile pointed at this port.
    /// Hands off: we hold no `Child` for it, so we could not stop it even if we tried.
    Foreign,
}

/// Lifecycle manager for the dedicated llama.cpp classify sidecar.
pub struct LlamaCppClassifyManager {
    running: Arc<AtomicBool>,
    process: Arc<Mutex<Option<LlamaCppProcess>>>,
    /// `true` when the server on the classify port is one this manager did **not**
    /// spawn ([`ReachableServer::Foreign`]) — never merely because a server was up
    /// (our own child from a previous lazy start is the common case for that).
    ///
    /// It is load-bearing for [`Sidecar::is_running`] / the desktop badge, which is
    /// the only way a foreign server can be reported as "the tier is up" when we hold
    /// no child handle. It is NOT what keeps `stop` from killing a foreign process:
    /// `stop` only ever kills the [`LlamaCppProcess`] in `process`, and for a foreign
    /// server that slot is empty. So do not "simplify" the flag away as redundant with
    /// the empty slot — and do not treat its early return in `stop` as the safety
    /// mechanism.
    adopted_external: Arc<AtomicBool>,
    client: reqwest::Client,
    /// Global download center (#456), injected at construction in `main.rs`.
    downloads: Option<crate::downloads::DownloadCenter>,
}

impl LlamaCppClassifyManager {
    pub fn new() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            process: Arc::new(Mutex::new(None)),
            adopted_external: Arc::new(AtomicBool::new(false)),
            client: reqwest::Client::builder()
                .user_agent("ryu-core/0.1")
                .timeout(std::time::Duration::from_secs(3))
                .build()
                .expect("reqwest client"),
            downloads: None,
        }
    }

    /// Inject the global download center (called at the `main.rs` build site).
    pub fn with_downloads(mut self, downloads: crate::downloads::DownloadCenter) -> Self {
        self.downloads = Some(downloads);
        self
    }

    fn binary_path() -> std::path::PathBuf {
        let name = if cfg!(target_os = "windows") {
            "llama-server.exe"
        } else {
            "llama-server"
        };
        crate::paths::ryu_dir().join("bin").join(name)
    }

    /// The injected download center, as an `Err` rather than a panic when it is
    /// absent.
    ///
    /// It used to be `.expect("download center not wired (main.rs)")`. `main.rs` does
    /// wire it, so the panic was unreachable *there* — but this runs inside the
    /// fire-and-forget `tokio::spawn` of the gateway config-push path, whose
    /// `JoinHandle` is dropped. A panic on that task therefore kills only the task:
    /// the start silently never happens, and the guardrail fails open with no `Err`
    /// for the caller to record. As a `Result` it becomes the same reportable failure
    /// as a missing binary. Kept as a named accessor so the bare-`new()` case is
    /// unit-testable without touching the port or the filesystem.
    fn downloads_or_err(
        downloads: Option<crate::downloads::DownloadCenter>,
    ) -> anyhow::Result<crate::downloads::DownloadCenter> {
        downloads.ok_or_else(|| {
            anyhow::anyhow!(
                "{CLASSIFY_SIDECAR_NAME}: download center not wired — the manager was built \
                 without `with_downloads` (see the `main.rs` sidecar registration), so \
                 llama.cpp cannot be installed for the classify tier"
            )
        })
    }

    /// Classify a reachable classify port: is the server that answered the child we
    /// spawned, or one we do not own?
    ///
    /// The predicate is "do we hold an OS child handle" — `pid()`, which is `Some`
    /// exactly while `LlamaCppProcess::child` is `Some` (`process.rs`). We spawned that
    /// child on this very port and llama-server holds its listener for its whole life,
    /// so a held handle plus an answering port means the answer came from us.
    ///
    /// It is a *presumption*, not a proof: if our child exited and something else then
    /// bound the port, this says [`ReachableServer::OurChild`] for a server we do not
    /// own. That direction is harmless — `stop` kills the pid in the handle we hold and
    /// nothing else, so it reaps our dead child and never touches the squatter. The
    /// opposite mistake is the one that costs a resident process, which is why the
    /// predicate errs toward "ours".
    ///
    /// **Why not `LlamaCppProcess::is_running()`** (the obvious call): it is
    /// `child.is_some() && binary_path.exists()` (`process.rs:188`), so a llama.cpp
    /// binary deleted or moved under a running server flips it to `false` while our
    /// child is still very much alive and serving. That would classify our own child as
    /// [`ReachableServer::Foreign`] and leak the process on `stop` — the same
    /// unstoppable-server bug from the other direction. Ownership is about the handle,
    /// not about the binary.
    ///
    /// **Why not `Option::is_some()`**: a `LlamaCppProcess` that never spawned (or was
    /// stopped, which `take()`s the handle out) owns nothing, and `pid()` says so
    /// without assuming the slot is only ever filled by the spawn path.
    fn reachable_server_owner(process: &Mutex<Option<LlamaCppProcess>>) -> ReachableServer {
        if Self::holds_own_child(process) {
            ReachableServer::OurChild
        } else {
            ReachableServer::Foreign
        }
    }

    /// Do we hold an OS child handle for a server we spawned?
    ///
    /// One predicate, two callers on purpose: [`Self::reachable_server_owner`] (who
    /// owns the answering port) and the own-child arm of [`Sidecar::is_running`] (is
    /// the tier up). They ask the same question of the same slot, and when they were
    /// written separately they disagreed — ownership used `pid()`, liveness used
    /// `LlamaCppProcess::is_running()`, which additionally requires the llama.cpp
    /// binary to still exist on disk. See the "why not" paragraphs above; both apply
    /// here verbatim.
    ///
    /// What this does NOT claim: that the child is alive. `LlamaCppProcess` never
    /// reaps (`stop` is the only thing that clears the handle), so a child that
    /// exited on its own still reads `true` until something calls `stop`. That is
    /// pre-existing and unchanged by sharing the predicate.
    ///
    /// Scope note: the CHAT engine's `LlamaCppManager` (`llamacpp/mod.rs`) still calls
    /// `LlamaCppProcess::is_running()` for its own liveness. It was left alone — it is
    /// outside this change's files — so the binary-existence term survives there. This
    /// is a statement about these three satellites, not about the whole directory.
    fn holds_own_child(process: &Mutex<Option<LlamaCppProcess>>) -> bool {
        process
            .lock()
            .unwrap()
            .as_ref()
            .and_then(|p| p.pid())
            .is_some()
    }

    /// Record that the port is serving, tagged with who owns the server. Pure over the
    /// two flags (no port, no process) so both arms are unit-testable.
    ///
    /// `store` rather than `fetch_or`: a manager that adopted a foreign server on an
    /// earlier start and later spawned its own child must stop claiming the server is
    /// foreign, or `stop` keeps skipping the child it now owns.
    fn record_reachable_server(
        running: &AtomicBool,
        adopted_external: &AtomicBool,
        owner: ReachableServer,
    ) {
        adopted_external.store(owner == ReachableServer::Foreign, Ordering::Relaxed);
        running.store(true, Ordering::Relaxed);
    }

    /// `true` if a classify server already answers on the port.
    async fn server_reachable(client: &reqwest::Client) -> bool {
        client
            .get(format!("http://{}/health", classify_addr()))
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false)
    }
}

impl Default for LlamaCppClassifyManager {
    fn default() -> Self {
        Self::new()
    }
}

impl Sidecar for LlamaCppClassifyManager {
    fn name(&self) -> &'static str {
        CLASSIFY_SIDECAR_NAME
    }

    fn is_required(&self) -> bool {
        false
    }

    fn start(&self) -> BoxFuture<anyhow::Result<()>> {
        let process = Arc::clone(&self.process);
        let running = Arc::clone(&self.running);
        let adopted_external = Arc::clone(&self.adopted_external);
        let client = self.client.clone();
        let downloads = self.downloads.clone();
        Box::pin(async move {
            let addr = classify_addr();
            // A server already answering `/health` on the port means there is nothing
            // to spawn — but WHO owns it decides what `stop`/`is_running` may do, so
            // classify it instead of assuming "already up ⇒ someone else's". The lazy
            // start hook fires on EVERY config push that selects the tier, so the
            // common case after the first push is that the answering server is our own
            // child from the previous push.
            //
            // **Scope of "safe to call on every push".** Adoption makes a repeat start
            // a no-op *for the process* only once `/health` answers 2xx — that is what
            // `server_reachable` tests. This start's own readiness gate is weaker: a
            // TCP connect (below), so between "port bound" and "`/health` 2xx" a repeat
            // push still takes the spawn branch, where the loser of the bind race
            // replaces the handle of the child that is actually serving and orphans it.
            // That window is still OPEN: closing it means gating the start on `/health`
            // (the same predicate adoption uses) instead of on a TCP connect, which is a
            // change to the 120s readiness loop below, not to this branch.
            // *For the manager*, a repeat start no longer leaks a health monitor either:
            // `SidecarManager::spawn_health_monitor` (`sidecar/manager.rs`) aborts the
            // monitor it displaces, which it did not do before this change.
            if Self::server_reachable(&client).await {
                let owner = Self::reachable_server_owner(&process);
                Self::record_reachable_server(&running, &adopted_external, owner);
                // A serving tier makes any earlier failure history wrong, so the
                // adopt branch clears the record too — not just the spawn branch.
                clear_lazy_start_failure();
                match owner {
                    ReachableServer::OurChild => tracing::info!(
                        "classify server already running on {addr} — our own child is \
                         serving it, nothing to start"
                    ),
                    ReachableServer::Foreign => tracing::info!(
                        "classify server already running on {addr} — adopting a server \
                         we did not spawn"
                    ),
                }
                return Ok(());
            }
            // Nothing is answering, so nothing external is being adopted. Whatever we
            // spawn below is ours to stop.
            adopted_external.store(false, Ordering::Relaxed);

            // Ensure the llama.cpp binary is installed (shared with the chat engine).
            let downloads = Self::downloads_or_err(downloads)?;
            LlamaCppDownloader::new()
                .ensure_installed(&downloads)
                .await
                .context("installing llama.cpp for classify server")?;

            // Serve the classifier GGUF downloaded by onboarding. Like the embeddings
            // and reranker servers, this engine does NOT download the model itself —
            // onboarding (`install_local_stack`) is the single owner of model
            // downloads, so there is no double-download race against a lazy start.
            //
            // Resolved via `from_env()` — the SAME constructor the gateway-push
            // predicate uses to decide whether to start us. If the two resolved the
            // registry differently the hook could fire for a model we do not serve.
            let registry = crate::registry::ModelRegistry::from_env();
            let model_path = registry.local_classifier_model.weight_path();
            if !model_path.exists() {
                anyhow::bail!(
                    "classifier model not found at {} — onboarding may still be downloading it, \
                     or the download failed. The classify server will start once the model is \
                     present (it is fetched by default during onboarding).",
                    model_path.display()
                );
            }
            tracing::info!("classify server will serve model: {}", model_path.display());

            tracing::info!("{CLASSIFY_SIDECAR_NAME} sidecar starting on {addr}");
            let mut proc = LlamaCppProcess::new(Self::binary_path());
            let opts = LlamaCppStartOptions {
                port: classify_port(),
                model_path: Some(model_path),
                // The classifier is text-only — no vision adapter.
                mmproj_path: None,
                // gemma-3-270m-it accepts 32K tokens, but llama-server allocates the
                // whole KV cache up front, so taking the model maximum would cost
                // memory for headroom neither consumer can use: the firewall
                // inspector scans ONE turn (and skips turns under `min_chars`) and
                // the routing classifier scores ONE prompt against a short rubric.
                // 4096 tokens (~16k characters) covers both with room to spare while
                // keeping the whole tier small enough to sit resident alongside the
                // full-size chat engine — which is the entire point of having it.
                ctx_size: 4096,
                // Plain chat completions: this tier answers a prompt, it does not
                // embed or cross-encode. Both flags off ⇒ llama-server exposes
                // `/v1/chat/completions`, which is what the gateway's `classify`
                // provider dials.
                embeddings: false,
                reranking: false,
                launch: crate::inference::LaunchConfig::default(),
            };
            proc.start_with(opts)
                .await
                .context("spawning llama-server (classify)")?;
            *process.lock().unwrap() = Some(proc);

            // Wait for the HTTP port to accept connections. A 241 MB model loads in
            // a couple of seconds, but keep the same 120s ceiling as the other
            // llama.cpp sidecars so a cold page-cache on slow disks is not a failure.
            tokio::time::timeout(std::time::Duration::from_secs(120), async {
                loop {
                    if tokio::net::TcpStream::connect(&addr).await.is_ok() {
                        break;
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                }
            })
            .await
            .context(format!("{CLASSIFY_SIDECAR_NAME} did not start within 120s"))?;

            running.store(true, Ordering::Relaxed);
            clear_lazy_start_failure();
            tracing::info!("{CLASSIFY_SIDECAR_NAME} sidecar started on {addr}");
            Ok(())
        })
    }

    fn stop(&self) -> BoxFuture<anyhow::Result<()>> {
        let process = Arc::clone(&self.process);
        let running = Arc::clone(&self.running);
        let adopted_external = Arc::clone(&self.adopted_external);
        Box::pin(async move {
            running.store(false, Ordering::Relaxed);
            // Only a server we did NOT spawn is left alone. Our own child — including
            // one a later lazy start found already serving — is killed here; that is
            // the whole point of distinguishing the two, since a mislabelled child made
            // this an unconditional no-op after the second push.
            if adopted_external.swap(false, Ordering::Relaxed) {
                tracing::info!(
                    "classify server was not spawned by us — leaving it running, we hold no child"
                );
                return Ok(());
            }
            let proc = process.lock().unwrap().take();
            if let Some(mut p) = proc {
                if let Err(e) = p.stop().await {
                    tracing::warn!("{CLASSIFY_SIDECAR_NAME} stop error: {e}");
                }
            }
            Ok(())
        })
    }

    fn health_check(&self) -> BoxFuture<HealthStatus> {
        let running = Arc::clone(&self.running);
        let client = self.client.clone();
        Box::pin(async move {
            if !running.load(Ordering::Relaxed) {
                // Carry the recorded lazy-start reason when there is one, so
                // "not running" says WHY instead of only that. Same treatment
                // `ManifestSidecar::health_check` gives a missing binary: ride the
                // `HealthStatus` reason channel rather than adding a second one.
                return HealthStatus::Unhealthy(match lazy_start_failure_reason() {
                    Some(reason) => format!("classify process not running: {reason}"),
                    None => "classify process not running".to_owned(),
                });
            }
            match client
                .get(format!("http://{}/health", classify_addr()))
                .send()
                .await
            {
                Ok(resp) if resp.status().is_success() => HealthStatus::Healthy,
                Ok(resp) => {
                    HealthStatus::Unhealthy(format!("health endpoint returned {}", resp.status()))
                }
                Err(e) => HealthStatus::Unhealthy(format!("health check failed: {e}")),
            }
        })
    }

    /// Whether the tier can serve, as far as this manager can tell **synchronously**
    /// (`Sidecar::is_running` is not async, so there is no `/health` probe here).
    ///
    /// Two different claims, deliberately:
    /// * a **foreign** server we adopted — `true` until [`Sidecar::stop`] clears the
    ///   flag. Unverifiable by construction: we hold no handle and cannot probe, so this
    ///   is the adoption decision being remembered, not a liveness check.
    /// * otherwise — whether we hold our own child's handle ([`Self::holds_own_child`]).
    ///   Before the ownership fix a repeat start put our own child in the first arm, so
    ///   this returned `true` forever regardless of the child's fate.
    ///
    /// The own-child arm asks [`Self::holds_own_child`], **not**
    /// `LlamaCppProcess::is_running()`, which is `child.is_some() &&
    /// binary_path.exists()` (`process.rs:188`). The binary-existence term does not
    /// belong in a liveness predicate we can only answer from a handle we hold, and
    /// the way it goes wrong was traced rather than imagined:
    /// `LlamaCppManager::uninstall` (the CHAT engine, `llamacpp/mod.rs`) calls
    /// `remove_ryu_binary("llama-server")` → `tokio::fs::remove_file` on the very path
    /// this tier's `binary_path()` points at. This sidecar's own `uninstall`
    /// deliberately leaves that file alone because it is *shared* — so uninstalling
    /// the chat engine unlinks the binary while our classify child keeps running and
    /// serving (unlinking an executable does not kill the process that is running it).
    /// With the old term that live tier reported `false` → `/api/sidecar/status.running
    /// = false` → the desktop badge drops "Local classifier running"
    /// (`deriveClassifyTierState` in `apps/desktop/src/lib/api/gateway.ts` maps
    /// `running` straight through). A status that says "dead" about a live server is
    /// the same defect as one that says "healthy" about a dead one.
    /// `reachable_server_owner` already refused the same term for the same reason
    /// ("ownership is about the handle, not about the binary"); this is that argument
    /// applied to liveness.
    ///
    /// One claim NOT to make here, because it was checked and is false: a llama.cpp
    /// *upgrade* does not open this window. `download_manager::write_flattened` writes
    /// `llama-server.download-tmp` and `std::fs::rename`s it over the destination, so
    /// the path keeps resolving throughout (`write_flattened_writes_via_temp_rename`
    /// pins that). Only an unlink — uninstall, or an operator moving the file — makes
    /// it vanish.
    ///
    /// Be exact about what changed and in which direction. The ONLY state that reads
    /// differently is *handle held + binary gone*: previously `false`, now `true`.
    /// Within it, the sub-case where our child is also dead used to be accidentally
    /// right and is now over-reported — but that sub-case was ALREADY over-reported
    /// whenever the binary was present, because `LlamaCppProcess` does not reap, so
    /// this predicate has never been able to see a child that exited on its own. No
    /// liveness information is lost here; a term about a file is.
    fn is_running(&self) -> bool {
        if self.adopted_external.load(Ordering::Relaxed) {
            return true;
        }
        Self::holds_own_child(&self.process)
    }

    fn pid(&self) -> Option<u32> {
        // `None` when the serving classify server is one we did not spawn — we hold no
        // `Child`, so there is no pid to report (and nothing for `stop` to kill).
        self.process.lock().unwrap().as_ref().and_then(|p| p.pid())
    }

    fn uninstall(&self, _delete_data: bool) -> BoxFuture<anyhow::Result<()>> {
        Box::pin(async move {
            // The binary is shared with the chat engine — do NOT remove it here.
            // Only drop the version-store marker for this sidecar. The classifier
            // GGUF under ~/.ryu/models is left intact.
            crate::sidecar::remove_from_version_store(CLASSIFY_SIDECAR_NAME);
            tracing::info!(
                "{CLASSIFY_SIDECAR_NAME} uninstalled (shared binary + models left intact)"
            );
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The classify tier must never collide with the three llama.cpp servers that
    /// can be resident at the same time (chat 8080, embed 8081, rerank 8082) — a
    /// shared port would mean the second process to start silently fails to bind
    /// and the tier looks "not up" forever.
    #[test]
    fn classify_port_base_is_distinct_from_the_other_llamacpp_servers() {
        assert_eq!(CLASSIFY_PORT_BASE, 8083);
        assert_ne!(CLASSIFY_PORT_BASE, 8080, "chat engine port");
        assert_ne!(
            CLASSIFY_PORT_BASE,
            crate::sidecar::providers::llamacpp::embed::EMBED_PORT_BASE
        );
        assert_ne!(
            CLASSIFY_PORT_BASE,
            crate::sidecar::providers::llamacpp::rerank::RERANK_PORT_BASE
        );
    }

    /// The concrete port must ride the profile offset like every other Ryu port,
    /// so a dev profile (`+1000`) does not dial the release node's classify server.
    #[test]
    fn classify_port_is_profile_aware() {
        assert_eq!(classify_port(), crate::profile::port(CLASSIFY_PORT_BASE));
        assert_eq!(
            crate::profile::port_for(CLASSIFY_PORT_BASE, "release"),
            CLASSIFY_PORT_BASE
        );
        assert_eq!(
            crate::profile::port_for(CLASSIFY_PORT_BASE, "dev"),
            CLASSIFY_PORT_BASE + crate::profile::DEV_PORT_OFFSET
        );
        // The dev-profile ports of all four servers stay distinct too.
        assert_eq!(crate::profile::port_for(CLASSIFY_PORT_BASE, "dev"), 9083);
    }

    #[test]
    fn sidecar_is_named_and_optional() {
        let mgr = LlamaCppClassifyManager::new();
        // Both directions: the const is the wire name, and `name()` is the const —
        // so neither can be edited into disagreement with the other.
        assert_eq!(CLASSIFY_SIDECAR_NAME, "llamacpp-classify");
        assert_eq!(mgr.name(), CLASSIFY_SIDECAR_NAME);
        // Off by default: never required, never in `startup_order` — it only runs
        // once a pushed gateway config selects the classify tier.
        assert!(!mgr.is_required());
        assert!(!mgr.is_running());
    }

    /// A manager built without `with_downloads` must return an `Err`, not panic.
    ///
    /// The start path runs inside a detached `tokio::spawn` whose `JoinHandle` is
    /// dropped, so a panic there is swallowed: the tier never starts and the caller
    /// gets no `Err` to log or record. Tested through the extracted accessor rather
    /// than a whole `start()` call, which would first probe the classify port and
    /// could adopt (or race) a real server on a developer's machine.
    #[test]
    fn a_manager_without_a_download_center_errs_instead_of_panicking() {
        // `DownloadCenter` is not `Debug`, so unwrap the arm by hand rather than with
        // `expect_err` (which requires `T: Debug`).
        let msg = match LlamaCppClassifyManager::downloads_or_err(None) {
            Ok(_) => panic!("no download center must be an Err, never an Ok"),
            Err(e) => format!("{e:#}"),
        };
        assert!(
            msg.contains(CLASSIFY_SIDECAR_NAME) && msg.contains("download center"),
            "the reason has to name the sidecar and the cause, it is what gets recorded: {msg}"
        );
        // And the wired case passes the value straight through.
        assert!(LlamaCppClassifyManager::new().downloads.is_none());
    }

    /// A port that answers is only an *external* adoption when we hold no child of our
    /// own. With no handle (fresh manager, or a `LlamaCppProcess` that never spawned /
    /// was already stopped) there is nothing of ours it could be.
    #[test]
    fn a_reachable_port_is_foreign_only_when_we_hold_no_child() {
        let empty: Mutex<Option<LlamaCppProcess>> = Mutex::new(None);
        assert_eq!(
            LlamaCppClassifyManager::reachable_server_owner(&empty),
            ReachableServer::Foreign
        );

        // A process struct with no spawned child owns nothing either — `stop()` takes
        // the handle out, so this is also the post-stop state.
        let never_spawned = Mutex::new(Some(LlamaCppProcess::new(
            LlamaCppClassifyManager::binary_path(),
        )));
        assert_eq!(
            LlamaCppClassifyManager::reachable_server_owner(&never_spawned),
            ReachableServer::Foreign
        );
    }

    /// The flag write, both arms. `store` (not a one-way latch) is what lets a manager
    /// that once adopted a foreign server go back to owning its own child.
    #[test]
    fn recording_a_reachable_server_tracks_ownership_in_both_directions() {
        let running = AtomicBool::new(false);
        let adopted = AtomicBool::new(false);

        LlamaCppClassifyManager::record_reachable_server(
            &running,
            &adopted,
            ReachableServer::Foreign,
        );
        assert!(running.load(Ordering::Relaxed));
        assert!(
            adopted.load(Ordering::Relaxed),
            "a foreign server is adopted"
        );

        // Our own child later serves the port: the stale "foreign" claim MUST clear, or
        // `stop` keeps skipping the child we now own.
        LlamaCppClassifyManager::record_reachable_server(
            &running,
            &adopted,
            ReachableServer::OurChild,
        );
        assert!(running.load(Ordering::Relaxed));
        assert!(
            !adopted.load(Ordering::Relaxed),
            "our own child must never be recorded as an external adoption"
        );
    }

    /// A genuinely foreign server stays untouched by `stop`, and the manager reports the
    /// tier up while the adoption is remembered.
    #[tokio::test]
    async fn stop_leaves_a_server_we_did_not_spawn_alone() {
        let mgr = LlamaCppClassifyManager::new();
        LlamaCppClassifyManager::record_reachable_server(
            &mgr.running,
            &mgr.adopted_external,
            ReachableServer::Foreign,
        );
        assert!(
            mgr.is_running(),
            "an adopted server reads as the tier being up"
        );
        assert_eq!(mgr.pid(), None, "we hold no child, so there is no pid");

        mgr.stop().await.unwrap();
        assert!(
            !mgr.adopted_external.load(Ordering::Relaxed),
            "stop forgets the adoption"
        );
        assert!(mgr.process.lock().unwrap().is_none());
        assert!(!mgr.is_running());
    }

    /// The regression: a repeat lazy start that finds the port answered by OUR OWN child
    /// must leave that child stoppable.
    ///
    /// Before the ownership fix the adopt branch set `adopted_external = true` for it, so
    /// `stop()` returned early without touching the child (leaving a resident
    /// llama-server nothing could shut down) and `is_running()` returned `true`
    /// unconditionally — which is what the desktop's classify badge prints.
    ///
    /// A real OS child handle is required (that is the predicate), so this spawns
    /// `/bin/sleep` through the same `LlamaCppProcess` API the start path uses; it
    /// exits immediately on the llama-server flags, which is fine — ownership is about
    /// holding the handle, not about the child still living.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_repeat_start_over_our_own_child_keeps_it_stoppable() {
        let mgr = LlamaCppClassifyManager::new();
        let mut proc = LlamaCppProcess::new(std::path::PathBuf::from("/bin/sleep"));
        proc.start_with(LlamaCppStartOptions {
            port: classify_port(),
            model_path: None,
            mmproj_path: None,
            ctx_size: 0,
            embeddings: false,
            reranking: false,
            launch: crate::inference::LaunchConfig::default(),
        })
        .await
        .expect("/bin/sleep must spawn, so we hold a real child handle");
        assert!(proc.pid().is_some());
        *mgr.process.lock().unwrap() = Some(proc);

        // What the adopt branch does when the port answers on a repeat push.
        let owner = LlamaCppClassifyManager::reachable_server_owner(&mgr.process);
        assert_eq!(owner, ReachableServer::OurChild);
        LlamaCppClassifyManager::record_reachable_server(
            &mgr.running,
            &mgr.adopted_external,
            owner,
        );
        assert!(
            !mgr.adopted_external.load(Ordering::Relaxed),
            "our own child is not an external adoption"
        );
        assert!(mgr.is_running());
        assert!(mgr.pid().is_some(), "our own child reports its pid");

        // The point of the fix: stop actually reaps it instead of returning early.
        mgr.stop().await.unwrap();
        assert!(
            mgr.process.lock().unwrap().is_none(),
            "stop must take and kill our own child, not skip it"
        );
        assert!(!mgr.is_running());
    }

    /// A liveness answer must not be a function of the llama.cpp binary FILE.
    ///
    /// `LlamaCppProcess::is_running()` is `child.is_some() && binary_path.exists()`,
    /// and uninstalling the CHAT engine unlinks `~/.ryu/bin/llama-server` — the binary
    /// this sidecar shares with it and deliberately never removes itself
    /// (`LlamaCppManager::uninstall` → `remove_ryu_binary`). While the file is gone,
    /// that predicate reports a classifier that is up
    /// and serving as stopped — `/api/sidecar/status.running = false`, and the
    /// desktop's badge drops out of "Local classifier running" for a tier that never
    /// stopped answering.
    ///
    /// Unix-only, and it really spawns: `LlamaCppProcess::child` is private and only
    /// `start_with` fills it, so a held handle cannot be faked. The throwaway
    /// executable is a temp-dir shell script (nothing to bind, exits at once) so the
    /// test can delete it out from under the handle, which is the whole point.
    #[cfg(unix)]
    #[tokio::test]
    async fn is_running_ignores_the_shared_binary_being_unlinked_under_a_held_child() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().expect("tempdir");
        let fake_server = dir.path().join("llama-server");
        std::fs::write(&fake_server, "#!/bin/sh\nexit 0\n").expect("write throwaway server");
        std::fs::set_permissions(&fake_server, std::fs::Permissions::from_mode(0o755))
            .expect("chmod throwaway server");

        let mgr = LlamaCppClassifyManager::new();
        let mut proc = LlamaCppProcess::new(fake_server.clone());
        proc.start_with(LlamaCppStartOptions {
            // Port 0 is never bound — the script ignores its flags and exits. This
            // test is about the handle, not about a listener.
            port: 0,
            model_path: None,
            mmproj_path: None,
            ctx_size: 0,
            embeddings: false,
            reranking: false,
            launch: crate::inference::LaunchConfig::default(),
        })
        .await
        .expect("the throwaway script must spawn, so we hold a real child handle");
        assert!(proc.pid().is_some());
        *mgr.process.lock().unwrap() = Some(proc);
        assert!(mgr.is_running(), "a held child means the tier is up");

        // The window: the shared binary is unlinked (what the chat engine's uninstall
        // does), so the path stops resolving. On unix that does not touch a process
        // already running it — nothing about our child changed.
        std::fs::remove_file(&fake_server).expect("remove the binary");
        assert!(!fake_server.exists());
        assert!(
            mgr.is_running(),
            "unlinking the shared binary must not report a serving classifier as stopped"
        );
        assert!(mgr.pid().is_some(), "and the pid stays reportable");
        // The ownership predicate must keep agreeing with it — they are one function.
        assert_eq!(
            LlamaCppClassifyManager::reachable_server_owner(&mgr.process),
            ReachableServer::OurChild
        );

        // `stop` is still the only thing that takes the handle out, binary or no binary.
        mgr.stop().await.unwrap();
        assert!(!mgr.is_running());
    }

    /// The lazy-start failure record is what turns an invisible fire-and-forget
    /// failure into a retrievable reason, and `health_check` is its consumer: a
    /// stopped sidecar must say WHY when a cause is known, and go back to the bare
    /// message once a start succeeds.
    #[tokio::test]
    async fn a_recorded_lazy_start_failure_is_reported_and_cleared() {
        // The record is BINARY-scoped, not module-scoped, and it now has a second test
        // writer: `sidecar/gateway.rs`'s spend-gate test records the half-configured
        // skip, which happens BEFORE the `SIDECAR_MANAGER.get()` early return that used
        // to make this test the only writer in a test process. Hence the shared lock.
        let _rec = lock_lazy_start_record();
        clear_lazy_start_failure();
        assert_eq!(lazy_start_failure_reason(), None);

        record_lazy_start_failure("llama.cpp binary is not installed".to_owned());
        assert_eq!(
            lazy_start_failure_reason().as_deref(),
            Some("llama.cpp binary is not installed")
        );

        // `running` is false on a fresh manager, so this is the branch a failed lazy
        // start leaves the sidecar in.
        let mgr = LlamaCppClassifyManager::new();
        match mgr.health_check().await {
            HealthStatus::Unhealthy(msg) => {
                assert!(
                    msg.contains("llama.cpp binary is not installed"),
                    "the recorded reason must ride the health status: {msg}"
                );
            }
            other => panic!("a stopped sidecar must be Unhealthy, got {other:?}"),
        }

        // A success path clears it — the record may only ever describe the present.
        clear_lazy_start_failure();
        match mgr.health_check().await {
            HealthStatus::Unhealthy(msg) => assert_eq!(msg, "classify process not running"),
            other => panic!("a stopped sidecar must be Unhealthy, got {other:?}"),
        }
    }
}
