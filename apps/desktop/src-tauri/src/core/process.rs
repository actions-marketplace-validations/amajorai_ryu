//! Managed child process for the Ryu Core sidecar.
//!
//! Handles spawning, stdio forwarding, graceful shutdown (SIGTERM → SIGKILL),
//! and a PID file for orphan recovery across restarts.

use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use sysinfo::{Pid as SysinfoPid, System};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};

use crate::win_process::NoWindow;

#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(windows)]
fn configure_process_group(_command: &mut Command) {}

// ── Paths ──────────────────────────────────────────────────────────────────────

fn pid_path() -> PathBuf {
    crate::profile::ryu_home_dir().join("ryu-core.pid")
}

const PID_RECORD_VERSION: u8 = 1;

/// PID files must bind a PID to the process that Desktop actually started. A
/// bare integer is unsafe after a crash because operating systems reuse PIDs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct ManagedPidRecord {
    version: u8,
    pid: u32,
    executable: String,
    start_time: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    process_group: Option<i32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ProcessIdentity {
    pid: u32,
    executable: String,
    start_time: u64,
}

impl ManagedPidRecord {
    fn from_identity(identity: ProcessIdentity) -> Self {
        Self {
            version: PID_RECORD_VERSION,
            pid: identity.pid,
            executable: identity.executable,
            start_time: identity.start_time,
            #[cfg(unix)]
            process_group: i32::try_from(identity.pid).ok(),
            #[cfg(not(unix))]
            process_group: None,
        }
    }

    fn matches(&self, identity: &ProcessIdentity) -> bool {
        self.version == PID_RECORD_VERSION
            && self.pid == identity.pid
            && self.executable == identity.executable
            && self.start_time == identity.start_time
    }
}

fn inspect_process(pid: u32) -> Option<ProcessIdentity> {
    let system = System::new_all();
    let process = system.process(SysinfoPid::from_u32(pid))?;
    let executable = process.exe()?.to_string_lossy().into_owned();
    if executable.is_empty() || process.start_time() == 0 {
        return None;
    }
    Some(ProcessIdentity {
        pid,
        executable,
        start_time: process.start_time(),
    })
}

async fn inspect_spawned_process(pid: u32) -> Option<ProcessIdentity> {
    // A freshly-spawned process can take a scheduler tick to appear in the OS
    // process table. Bound the wait; inability to establish identity fails closed
    // and the caller terminates the child rather than writing an unsafe PID file.
    for _ in 0..20 {
        if let Some(identity) = inspect_process(pid) {
            return Some(identity);
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    None
}

/// Resolve the Sentry DSN to hand the Core sidecar: an explicit runtime
/// `SENTRY_DSN` wins (dev shells, self-hosters), else the value baked into this
/// build via `option_env!` (packaged releases set `SENTRY_DSN` at `cargo build`
/// time). `None` leaves Core's crash tier a graceful no-op.
fn sentry_dsn() -> Option<String> {
    std::env::var("SENTRY_DSN")
        .ok()
        .or_else(|| option_env!("SENTRY_DSN").map(str::to_string))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

// ── ProcessState ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub enum ProcessState {
    Starting,
    Running,
    Stopping,
    Stopped,
}

// ── RyuCoreProcess ─────────────────────────────────────────────────────────────

pub struct RyuCoreProcess {
    child: Option<Child>,
    binary_path: PathBuf,
    pid_path: PathBuf,
    state: ProcessState,
    /// Handles for stdout/stderr forwarding tasks.
    log_tasks: Vec<tokio::task::JoinHandle<()>>,
}

impl RyuCoreProcess {
    pub fn new(binary_path: PathBuf) -> Self {
        Self {
            child: None,
            binary_path,
            pid_path: pid_path(),
            state: ProcessState::Stopped,
            log_tasks: Vec::new(),
        }
    }

    /// Check if Ryu Core is already running by hitting the health endpoint.
    pub async fn is_already_running(&self) -> bool {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(2))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        match client
            .get(format!("{}/api/health", crate::profile::core_base_url()))
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => true,
            _ => false,
        }
    }

    /// Spawn the Ryu Core binary and begin forwarding its stdio to tracing.
    /// First checks if an instance is already running on THIS PROFILE's Core port
    /// (`profile::core_port()` — 7980 release, 9980 canary). Never a literal: a
    /// canary desktop that probed 7980 would find the stable Core, adopt it, and
    /// drive `~/.ryu` while believing it was isolated.
    pub async fn start(&mut self) -> Result<()> {
        // Check if already running
        if self.is_already_running().await {
            tracing::info!("Ryu Core already running, connecting to existing instance");
            self.state = ProcessState::Running;
            return Ok(());
        }

        self.cleanup_orphan().await;
        self.state = ProcessState::Starting;

        let mut command = Command::new(&self.binary_path);
        command
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(false)
            // Core is a console binary; without CREATE_NO_WINDOW it opens a
            // command-prompt window that stays up for the whole app session.
            // Piping stdio does NOT suppress it — only the creation flag does.
            .no_window();
        configure_process_group(&mut command);
        // Isolate the dev variant's backend: hand the Core child our profile so it
        // binds the shifted port (8980) and uses the shifted data dir (~/.ryu-dev)
        // via its own `profile::apply_env_defaults`. Release passes nothing new
        // ("release" is byte-identical to unset), so the release path is untouched.
        if crate::profile::is_dev() {
            command.env(crate::profile::RYU_PROFILE_ENV, crate::profile::name());
        }
        // Crash reporting: hand the Sentry DSN to the Core sidecar so its (and the
        // gateway's, via Core's spawn-env forwarding) panic tier has a destination.
        // Core reads SENTRY_DSN from env and stays a graceful no-op without it; the
        // desktop `crash-reports-enabled` consent still gates capture inside Core.
        if let Some(dsn) = sentry_dsn() {
            command.env("SENTRY_DSN", dsn);
        }
        let child = command.spawn()?;
        self.own_spawned_child(child).await
    }

    /// Persist the child's verified identity before publishing it as managed.
    /// Every failure path terminates the just-spawned process group.
    async fn own_spawned_child(&mut self, mut child: Child) -> Result<()> {
        let persisted = async {
            let pid = child
                .id()
                .ok_or_else(|| anyhow!("ryu-core spawned without a process id"))?;
            let identity = inspect_spawned_process(pid)
                .await
                .ok_or_else(|| anyhow!("could not verify the spawned ryu-core process identity"))?;
            self.persist_pid_record(ManagedPidRecord::from_identity(identity))
                .await
        }
        .await;
        if let Err(error) = persisted {
            terminate_child_async(&mut child, Duration::from_millis(500)).await;
            self.state = ProcessState::Stopped;
            return Err(error);
        }

        // Forward stdout → tracing::info
        if let Some(stdout) = child.stdout.take() {
            let handle = tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    tracing::info!(target: "ryu-core", "{line}");
                }
            });
            self.log_tasks.push(handle);
        }

        // Forward stderr → tracing::warn
        if let Some(stderr) = child.stderr.take() {
            let handle = tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    tracing::warn!(target: "ryu-core", "{line}");
                }
            });
            self.log_tasks.push(handle);
        }

        self.child = Some(child);
        self.state = ProcessState::Running;
        Ok(())
    }

    async fn persist_pid_record(&self, record: ManagedPidRecord) -> Result<()> {
        let parent = self
            .pid_path
            .parent()
            .ok_or_else(|| anyhow!("ryu-core PID path has no parent"))?;
        tokio::fs::create_dir_all(parent).await?;
        let bytes = serde_json::to_vec(&record)?;
        let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
        use std::io::Write as _;
        temporary.write_all(&bytes)?;
        temporary.as_file().sync_all()?;
        temporary
            .persist(&self.pid_path)
            .map_err(|error| error.error)?;
        Ok(())
    }

    /// Gracefully stop the process: SIGTERM → 5 s wait → SIGKILL.
    pub async fn stop(&mut self) -> Result<()> {
        self.state = ProcessState::Stopping;

        // Abort log forwarding tasks first.
        for handle in self.log_tasks.drain(..) {
            handle.abort();
        }

        if let Some(child) = self.child.as_mut() {
            terminate_child_async(child, Duration::from_secs(5)).await;
        }

        // Always sweep orphans: PID file (if we ever wrote one) AND whoever is
        // still listening on this profile's Core/gateway ports. Turbo-owned Core
        // in dev never gets a PID file from us, so port kill is what makes
        // restart/reset actually stop the process that holds the data-dir locks.
        self.cleanup_orphan().await;
        kill_profile_listeners().await;

        let _ = tokio::fs::remove_file(&self.pid_path).await;
        self.state = ProcessState::Stopped;
        self.child = None;
        Ok(())
    }

    /// Synchronous stop for use in non-async contexts (window destroy, app exit).
    /// Gives the whole managed process group a bounded graceful shutdown before a
    /// final kill, so Gateway/plugin children cannot outlive Desktop Quit.
    pub fn try_stop(&mut self) -> Result<()> {
        // Abort log forwarding tasks
        for handle in self.log_tasks.drain(..) {
            handle.abort();
        }

        // Stop the process group if we have a handle.
        if let Some(ref mut child) = self.child {
            terminate_child_sync(child, Duration::from_secs(2));
        } else {
            // A prior crash may have dropped the in-memory handle. Only terminate
            // the PID-file process when executable + start time still match.
            self.cleanup_orphan_sync();
        }

        // Clean up PID file synchronously
        let _ = std::fs::remove_file(&self.pid_path);

        self.state = ProcessState::Stopped;
        self.child = None;
        Ok(())
    }

    pub async fn restart(&mut self) -> Result<()> {
        self.stop().await?;
        self.start().await
    }

    /// Returns true if the child process is still alive.
    pub fn is_running(&mut self) -> bool {
        let Some(child) = self.child.as_mut() else {
            return false;
        };
        match child.try_wait() {
            Ok(None) => true,
            _ => {
                self.state = ProcessState::Stopped;
                self.child = None;
                false
            }
        }
    }

    /// Non-blocking exit check.
    pub fn poll_exit(&mut self) -> Option<std::process::ExitStatus> {
        let child = self.child.as_mut()?;
        match child.try_wait() {
            Ok(Some(status)) => {
                self.state = ProcessState::Stopped;
                self.child = None;
                Some(status)
            }
            _ => None,
        }
    }

    /// Returns `true` if a live child process handle is currently held.
    pub fn has_child(&self) -> bool {
        self.child.is_some()
    }

    /// Kill an owned leftover process whose full identity is recorded in the PID
    /// file. Invalid/legacy records and PID-reuse mismatches are removed without
    /// signaling anything.
    pub async fn cleanup_orphan(&self) {
        let Ok(content) = tokio::fs::read_to_string(&self.pid_path).await else {
            return;
        };
        let Ok(record) = serde_json::from_str::<ManagedPidRecord>(&content) else {
            tracing::warn!(
                path = %self.pid_path.display(),
                "ignoring unsafe legacy or corrupt ryu-core PID record"
            );
            let _ = tokio::fs::remove_file(&self.pid_path).await;
            return;
        };
        let Some(identity) = inspect_process(record.pid) else {
            let _ = tokio::fs::remove_file(&self.pid_path).await;
            return;
        };
        if !record.matches(&identity) {
            tracing::warn!(
                pid = record.pid,
                expected_executable = %record.executable,
                actual_executable = %identity.executable,
                "refusing to terminate a reused ryu-core PID"
            );
            let _ = tokio::fs::remove_file(&self.pid_path).await;
            return;
        }
        kill_pid_tree(record.pid, record.process_group).await;
        let _ = tokio::fs::remove_file(&self.pid_path).await;
    }

    fn cleanup_orphan_sync(&self) {
        let Ok(content) = std::fs::read_to_string(&self.pid_path) else {
            return;
        };
        let Ok(record) = serde_json::from_str::<ManagedPidRecord>(&content) else {
            let _ = std::fs::remove_file(&self.pid_path);
            return;
        };
        if inspect_process(record.pid).is_some_and(|identity| record.matches(&identity)) {
            kill_pid_tree_sync(record.pid, record.process_group, Duration::from_secs(1));
        }
        let _ = std::fs::remove_file(&self.pid_path);
    }
}

/// Force-kill whatever is still bound to this profile's Core + gateway ports.
///
/// Needed because in dev turbo owns Core (no desktop PID file), and a node reset
/// previously only wrote `.reset-pending` then no-op'd the restart — leaving the
/// old process holding every SQLite lock so the wipe could never delete agents /
/// plugins / apps DBs.
async fn kill_profile_listeners() {
    let core = crate::profile::core_port();
    // Gateway base is Core+1 (7981 release / 8981 dev) — matches Core's profile.
    let gateway = core.saturating_add(1);
    for (port, expected_binary) in [(core, "ryu-core"), (gateway, "ryu-gateway")] {
        for pid in pids_listening_on(port) {
            if !process_has_binary_name(pid as u32, expected_binary) {
                tracing::warn!(
                    "refusing to kill pid {pid} on port {port}: it is not {expected_binary}"
                );
                continue;
            }
            tracing::warn!("killing pid {pid} still listening on port {port}");
            kill_pid_tree(pid as u32, None).await;
        }
    }
}

async fn kill_pid_tree(pid: u32, process_group: Option<i32>) {
    if pid == 0 {
        return;
    }
    #[cfg(unix)]
    {
        use nix::sys::signal::{kill, Signal};
        use nix::unistd::Pid;
        let target = process_group
            .filter(|group| *group > 0)
            .map_or_else(|| Pid::from_raw(pid as i32), |group| Pid::from_raw(-group));
        let _ = kill(target, Signal::SIGTERM);
        tokio::time::sleep(Duration::from_secs(1)).await;
        let _ = kill(target, Signal::SIGKILL);
    }
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .no_window()
            .output();
    }
}

async fn terminate_child_async(child: &mut Child, grace: Duration) {
    let Some(pid) = child.id() else {
        return;
    };
    #[cfg(unix)]
    {
        use nix::sys::signal::{kill, Signal};
        use nix::unistd::Pid;
        let group = Pid::from_raw(-(pid as i32));
        let _ = kill(group, Signal::SIGTERM);
        let deadline = tokio::time::Instant::now() + grace;
        while tokio::time::Instant::now() < deadline {
            if child.try_wait().ok().flatten().is_some() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        let _ = kill(group, Signal::SIGKILL);
        let _ = child.wait().await;
    }
    #[cfg(windows)]
    {
        let pid_string = pid.to_string();
        let _ = Command::new("taskkill")
            .args(["/T", "/PID", &pid_string])
            .no_window()
            .output()
            .await;
        let deadline = tokio::time::Instant::now() + grace;
        while tokio::time::Instant::now() < deadline {
            if child.try_wait().ok().flatten().is_some() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid_string])
            .no_window()
            .output()
            .await;
        let _ = child.wait().await;
    }
}

fn terminate_child_sync(child: &mut Child, grace: Duration) {
    let Some(pid) = child.id() else {
        return;
    };
    #[cfg(unix)]
    {
        use nix::sys::signal::{kill, Signal};
        use nix::unistd::Pid;
        let group = Pid::from_raw(-(pid as i32));
        let _ = kill(group, Signal::SIGTERM);
        let deadline = std::time::Instant::now() + grace;
        while std::time::Instant::now() < deadline {
            if child.try_wait().ok().flatten().is_some() {
                return;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        let _ = kill(group, Signal::SIGKILL);
    }
    #[cfg(windows)]
    {
        kill_pid_tree_sync(pid, None, grace);
    }
}

fn kill_pid_tree_sync(pid: u32, process_group: Option<i32>, grace: Duration) {
    if pid == 0 {
        return;
    }
    #[cfg(unix)]
    {
        use nix::sys::signal::{kill, Signal};
        use nix::unistd::Pid;
        let target = process_group
            .filter(|group| *group > 0)
            .map_or_else(|| Pid::from_raw(pid as i32), |group| Pid::from_raw(-group));
        let _ = kill(target, Signal::SIGTERM);
        std::thread::sleep(grace);
        let _ = kill(target, Signal::SIGKILL);
    }
    #[cfg(windows)]
    {
        let pid_string = pid.to_string();
        let _ = std::process::Command::new("taskkill")
            .args(["/T", "/PID", &pid_string])
            .no_window()
            .output();
        std::thread::sleep(grace);
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid_string])
            .no_window()
            .output();
    }
}

fn process_has_binary_name(pid: u32, expected: &str) -> bool {
    inspect_process(pid).is_some_and(|identity| {
        std::path::Path::new(&identity.executable)
            .file_stem()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case(expected))
    })
}

/// PIDs in LISTEN state on `port` (IPv4/IPv6). Best-effort; empty on parse failure.
fn pids_listening_on(port: u16) -> Vec<i32> {
    #[cfg(windows)]
    {
        let Ok(output) = std::process::Command::new("netstat")
            .args(["-ano", "-p", "tcp"])
            .no_window()
            .output()
        else {
            return Vec::new();
        };
        let text = String::from_utf8_lossy(&output.stdout);
        let needle = format!(":{port}");
        let mut pids = Vec::new();
        for line in text.lines() {
            let line = line.trim();
            // e.g. "TCP    127.0.0.1:8980    0.0.0.0:0    LISTENING    51588"
            if !(line.contains("LISTENING") && line.contains(&needle)) {
                continue;
            }
            let Some(pid_str) = line.split_whitespace().last() else {
                continue;
            };
            let Ok(pid) = pid_str.parse::<i32>() else {
                continue;
            };
            // Ensure the port token is a local bind (`:8980` as address end), not a
            // remote ephemeral that happens to contain the digits.
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 4 {
                continue;
            }
            let local = parts[1];
            if !local.ends_with(&needle) {
                continue;
            }
            if !pids.contains(&pid) {
                pids.push(pid);
            }
        }
        pids
    }
    #[cfg(unix)]
    {
        let Ok(output) = std::process::Command::new("lsof")
            .args(["-ti", &format!("TCP:{port}"), "-sTCP:LISTEN"])
            .output()
        else {
            return Vec::new();
        };
        String::from_utf8_lossy(&output.stdout)
            .split_whitespace()
            .filter_map(|s| s.parse::<i32>().ok())
            .collect()
    }
}
