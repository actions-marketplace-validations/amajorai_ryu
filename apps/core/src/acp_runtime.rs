//! Runtime guardrails for Core-owned ACP subprocesses.
//!
//! The Gateway owns the persisted `[acp]` settings because they are node-level
//! policy. Core owns this module because it is the process supervisor: it is the
//! only place that can bound every ACP spawn, reap idle sessions, and report the
//! node's effective hardware-based limit.

use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use sysinfo::System;
use tokio::sync::Notify;

const DEFAULT_IDLE_TIMEOUT_MINUTES: u64 = 10;
const MIN_IDLE_TIMEOUT_MINUTES: u64 = 1;
const MAX_IDLE_TIMEOUT_MINUTES: u64 = 24 * 60;
const MAX_PARALLEL_AGENTS: u32 = 32;
const MIN_PARALLEL_AGENTS: u32 = 1;
const AUTO_PARALLEL_CAP: u32 = 8;
const ACP_RAM_PER_AGENT_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const GATEWAY_REFRESH_INTERVAL: Duration = Duration::from_secs(2);
const GATEWAY_REFRESH_TIMEOUT: Duration = Duration::from_millis(300);

#[derive(Debug, Clone, Copy)]
struct RuntimeConfig {
    idle_timeout_minutes: u64,
    max_parallel_agents: Option<u32>,
    keep_computer_awake: bool,
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            idle_timeout_minutes: DEFAULT_IDLE_TIMEOUT_MINUTES,
            max_parallel_agents: None,
            keep_computer_awake: true,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct AcpRuntimeSettings {
    pub idle_timeout: Duration,
    pub idle_timeout_minutes: u64,
    pub max_parallel_agents: Option<u32>,
    pub effective_max_parallel_agents: u32,
    pub auto_max_parallel_agents: u32,
    pub keep_computer_awake: bool,
    pub active_agents: u32,
}

#[derive(Debug, Clone, Copy, Serialize)]
struct HardwareSummary {
    cpu_cores: u32,
    physical_cores: u32,
    total_ram_bytes: u64,
}

struct RuntimeState {
    config: Mutex<RuntimeConfig>,
    admission: AcpAdmission,
    last_gateway_refresh: Mutex<Instant>,
}

struct AcpAdmission {
    state: Mutex<AdmissionState>,
    notify: Notify,
}

#[derive(Debug, Default)]
struct AdmissionState {
    active: u32,
}

/// A permit represents one ACP subprocess that has passed the global admission
/// gate. Dropping it is the single release path, including task cancellation and
/// subprocess startup errors.
pub struct AcpPermit {
    admission: &'static AcpAdmission,
}

impl Drop for AcpPermit {
    fn drop(&mut self) {
        if let Ok(mut state) = self.admission.state.lock() {
            state.active = state.active.saturating_sub(1);
        }
        self.admission.notify.notify_waiters();
    }
}

fn runtime_state() -> &'static RuntimeState {
    static STATE: OnceLock<RuntimeState> = OnceLock::new();
    STATE.get_or_init(|| RuntimeState {
        config: Mutex::new(RuntimeConfig::default()),
        admission: AcpAdmission {
            state: Mutex::new(AdmissionState::default()),
            notify: Notify::new(),
        },
        last_gateway_refresh: Mutex::new(Instant::now() - Duration::from_secs(60)),
    })
}

fn hardware() -> &'static HardwareSummary {
    static HARDWARE: OnceLock<HardwareSummary> = OnceLock::new();
    HARDWARE.get_or_init(|| {
        let cpu_cores = std::thread::available_parallelism()
            .map(|count| count.get() as u32)
            .unwrap_or(1)
            .max(1);
        let physical_cores = System::physical_core_count()
            .map(|count| count as u32)
            .unwrap_or(cpu_cores)
            .max(1);
        let mut system = System::new();
        system.refresh_memory();
        HardwareSummary {
            cpu_cores,
            physical_cores,
            total_ram_bytes: system.total_memory(),
        }
    })
}

/// Conservative automatic parallelism: reserve roughly half the physical CPU
/// cores and four GiB of RAM per resident ACP process, capped at eight. The cap
/// is deliberately modest because ACP agents may launch their own tools and
/// model clients in addition to the process itself.
fn calculate_auto_max_parallel_agents(
    cpu_cores: u32,
    physical_cores: u32,
    total_ram_bytes: u64,
) -> u32 {
    let measured_cores = if physical_cores == 0 {
        cpu_cores
    } else {
        physical_cores
    };
    let cpu_budget = (measured_cores.max(1) / 2).clamp(1, AUTO_PARALLEL_CAP);
    let ram_budget = if total_ram_bytes == 0 {
        1
    } else {
        (total_ram_bytes / ACP_RAM_PER_AGENT_BYTES).clamp(1, AUTO_PARALLEL_CAP as u64) as u32
    };
    cpu_budget
        .min(ram_budget)
        .clamp(MIN_PARALLEL_AGENTS, AUTO_PARALLEL_CAP)
}

fn auto_max_parallel_agents() -> u32 {
    let info = hardware();
    calculate_auto_max_parallel_agents(info.cpu_cores, info.physical_cores, info.total_ram_bytes)
}

fn sanitize_config(value: &Value) -> RuntimeConfig {
    let object = value.as_object();
    let idle_timeout_minutes = object
        .and_then(|value| value.get("idle_timeout_minutes"))
        .and_then(Value::as_u64)
        .unwrap_or(DEFAULT_IDLE_TIMEOUT_MINUTES)
        .clamp(MIN_IDLE_TIMEOUT_MINUTES, MAX_IDLE_TIMEOUT_MINUTES);
    let max_parallel_agents = object
        .and_then(|value| value.get("max_parallel_agents"))
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .filter(|value| (MIN_PARALLEL_AGENTS..=MAX_PARALLEL_AGENTS).contains(value));
    let keep_computer_awake = object
        .and_then(|value| value.get("keep_computer_awake"))
        .and_then(Value::as_bool)
        .unwrap_or(true);
    RuntimeConfig {
        idle_timeout_minutes,
        max_parallel_agents,
        keep_computer_awake,
    }
}

fn apply_config(value: &Value) {
    if let Ok(mut config) = runtime_state().config.lock() {
        *config = sanitize_config(value);
    }
    runtime_state().admission.notify.notify_waiters();
}

fn is_local_gateway() -> bool {
    let raw = crate::sidecar::gateway::gateway_url();
    url::Url::parse(&raw)
        .ok()
        .and_then(|parsed| parsed.host_str().map(str::to_owned))
        .is_some_and(|host| host == "127.0.0.1" || host == "localhost" || host == "::1")
}

/// Refresh the local file before a new message is routed. This is intentionally
/// limited to loopback gateways; a remote node's local file is not authoritative.
pub fn refresh_from_local_file() {
    if !is_local_gateway() {
        return;
    }
    let path = std::env::var("GATEWAY_CONFIG")
        .map(std::path::PathBuf::from)
        .ok()
        .or_else(|| dirs::config_dir().map(|dir| dir.join("ryu").join("gateway.toml")));
    let Some(path) = path else {
        return;
    };
    let Ok(raw) = std::fs::read_to_string(path) else {
        return;
    };
    let Ok(root) = toml::from_str::<toml::Value>(&raw) else {
        return;
    };
    let section = root
        .get("acp")
        .and_then(|value| serde_json::to_value(value).ok())
        .unwrap_or_else(|| json!({}));
    apply_config(&section);
}

/// Read the Gateway section when Core is serving a remote node or when a config
/// changed outside the desktop. The short cache prevents a burst of new chats
/// from turning the guardrail into a per-message config request.
pub async fn refresh_from_gateway(client: &reqwest::Client) {
    let should_refresh = runtime_state()
        .last_gateway_refresh
        .lock()
        .map(|mut last| {
            if last.elapsed() < GATEWAY_REFRESH_INTERVAL {
                false
            } else {
                *last = Instant::now();
                true
            }
        })
        .unwrap_or(false);
    if !should_refresh {
        return;
    }
    let result = tokio::time::timeout(
        GATEWAY_REFRESH_TIMEOUT,
        crate::sidecar::gateway::fetch_config(client),
    )
    .await;
    if let Ok(Ok(value)) = result {
        if let Some(section) = value.get("acp") {
            apply_config(section);
        }
    }
}

pub fn observe_gateway_config(value: &mut Value) {
    if let Some(section) = value.get("acp").cloned() {
        apply_config(&section);
    }
    let settings = settings();
    let Some(root) = value.as_object_mut() else {
        return;
    };
    let acp = root.entry("acp").or_insert_with(|| json!({}));
    if !acp.is_object() {
        *acp = json!({});
    }
    let object = acp
        .as_object_mut()
        .expect("ACP runtime section is an object");
    object.insert(
        "effective_max_parallel_agents".to_owned(),
        json!(settings.effective_max_parallel_agents),
    );
    object.insert(
        "auto_max_parallel_agents".to_owned(),
        json!(settings.auto_max_parallel_agents),
    );
    object.insert("active_agents".to_owned(), json!(settings.active_agents));
    object.insert(
        "hardware".to_owned(),
        serde_json::to_value(hardware()).unwrap_or_else(|_| json!({})),
    );
}

pub fn observe_gateway_patch(patch: &Value) {
    if let Some(section) = patch.get("acp") {
        apply_config(section);
    }
}

pub fn settings() -> AcpRuntimeSettings {
    let config = runtime_state()
        .config
        .lock()
        .map(|config| *config)
        .unwrap_or_default();
    let auto_max_parallel_agents = auto_max_parallel_agents();
    let effective_max_parallel_agents = config
        .max_parallel_agents
        .unwrap_or(auto_max_parallel_agents)
        .clamp(MIN_PARALLEL_AGENTS, MAX_PARALLEL_AGENTS);
    let active_agents = runtime_state()
        .admission
        .state
        .lock()
        .map(|state| state.active)
        .unwrap_or(0);
    AcpRuntimeSettings {
        idle_timeout: Duration::from_secs(config.idle_timeout_minutes * 60),
        idle_timeout_minutes: config.idle_timeout_minutes,
        max_parallel_agents: config.max_parallel_agents,
        effective_max_parallel_agents,
        auto_max_parallel_agents,
        keep_computer_awake: config.keep_computer_awake,
        active_agents,
    }
}

/// Wait until the current global parallel limit has room, then return a permit.
/// Waiting turns remain in Core rather than spawning their ACP child, which is the
/// important memory bound for old threads waking at the same time.
pub async fn acquire() -> AcpPermit {
    let admission = &runtime_state().admission;
    loop {
        let notified = admission.notify.notified();
        let limit = settings().effective_max_parallel_agents;
        if let Ok(mut state) = admission.state.lock() {
            if state.active < limit {
                state.active += 1;
                return AcpPermit { admission };
            }
        }
        notified.await;
    }
}

#[cfg(test)]
mod tests {
    use super::{calculate_auto_max_parallel_agents, sanitize_config};
    use serde_json::json;

    #[test]
    fn automatic_limit_is_cpu_and_memory_bounded() {
        assert_eq!(
            calculate_auto_max_parallel_agents(8, 4, 32 * 1024 * 1024 * 1024),
            2
        );
        assert_eq!(
            calculate_auto_max_parallel_agents(32, 16, 128 * 1024 * 1024 * 1024),
            8
        );
        assert_eq!(
            calculate_auto_max_parallel_agents(2, 2, 4 * 1024 * 1024 * 1024),
            1
        );
    }

    #[test]
    fn malformed_runtime_values_fail_safe_to_defaults_or_bounds() {
        let config = sanitize_config(&json!({
            "idle_timeout_minutes": 0,
            "max_parallel_agents": 500,
            "keep_computer_awake": false
        }));
        assert_eq!(config.idle_timeout_minutes, 1);
        assert_eq!(config.max_parallel_agents, None);
        assert!(!config.keep_computer_awake);
    }
}
