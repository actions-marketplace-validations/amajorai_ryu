//! Shared, short-lived registry for processes that can be shown and stopped by
//! the desktop shell, companion apps, and plugin hooks.
//!
//! The registry deliberately does not kill operating-system PIDs itself. The
//! process owner publishes snapshots here and polls the stop-request queue, so
//! termination keeps the owner's cleanup and audit semantics intact.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const FINISHED_RETENTION: Duration = Duration::from_secs(5 * 60);
const MAX_RECORDS: usize = 512;
const MAX_TEXT_LENGTH: usize = 16 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct BackgroundProcess {
    pub process_id: String,
    #[serde(default)]
    pub shell_id: Option<String>,
    #[serde(default)]
    pub producer: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    pub command: String,
    pub cwd: String,
    #[serde(default)]
    pub pid: Option<u32>,
    pub started_at: i64,
    #[serde(default)]
    pub elapsed_ms: u64,
    pub running: bool,
    #[serde(default)]
    pub exit_code: Option<i32>,
    #[serde(default)]
    pub exit_signal: Option<String>,
}

struct RegistryEntry {
    process: BackgroundProcess,
    updated_at: Instant,
    stop_reason: Option<String>,
}

fn registry() -> &'static Mutex<HashMap<String, RegistryEntry>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, RegistryEntry>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

fn validate_text(name: &str, value: &str, required: bool) -> Result<(), String> {
    if required && value.trim().is_empty() {
        return Err(format!("background process {name} must not be empty"));
    }
    if value.len() > MAX_TEXT_LENGTH {
        return Err(format!("background process {name} is too long"));
    }
    Ok(())
}

fn validate(process: &BackgroundProcess) -> Result<(), String> {
    validate_text("process_id", &process.process_id, true)?;
    validate_text("producer", &process.producer, true)?;
    validate_text("kind", &process.kind, true)?;
    validate_text("command", &process.command, true)?;
    validate_text("cwd", &process.cwd, true)?;
    if let Some(label) = &process.label {
        validate_text("label", label, false)?;
    }
    if let Some(description) = &process.description {
        validate_text("description", description, false)?;
    }
    if let Some(shell_id) = &process.shell_id {
        validate_text("shell_id", shell_id, false)?;
    }
    if let Some(exit_signal) = &process.exit_signal {
        validate_text("exit_signal", exit_signal, false)?;
    }
    Ok(())
}

fn refresh_elapsed(process: &mut BackgroundProcess) {
    if !process.running || process.started_at <= 0 {
        return;
    }
    let elapsed = now_millis().saturating_sub(process.started_at);
    process.elapsed_ms = elapsed.max(0) as u64;
}

fn prune_locked(entries: &mut HashMap<String, RegistryEntry>) {
    let now = Instant::now();
    entries.retain(|_, entry| {
        entry.process.running || now.duration_since(entry.updated_at) <= FINISHED_RETENTION
    });

    if entries.len() <= MAX_RECORDS {
        return;
    }

    let mut finished: Vec<(String, Instant)> = entries
        .iter()
        .filter(|(_, entry)| !entry.process.running)
        .map(|(id, entry)| (id.clone(), entry.updated_at))
        .collect();
    finished.sort_by_key(|(_, updated_at)| *updated_at);
    for (id, _) in finished
        .into_iter()
        .take(entries.len().saturating_sub(MAX_RECORDS))
    {
        entries.remove(&id);
    }
}

pub fn upsert(mut process: BackgroundProcess) -> Result<BackgroundProcess, String> {
    validate(&process)?;
    refresh_elapsed(&mut process);
    let process_id = process.process_id.clone();
    let mut entries = registry()
        .lock()
        .map_err(|_| "background process registry is unavailable".to_string())?;
    let stop_reason = entries
        .get(&process_id)
        .and_then(|entry| entry.stop_reason.clone());
    entries.insert(
        process_id,
        RegistryEntry {
            process: process.clone(),
            updated_at: Instant::now(),
            stop_reason,
        },
    );
    prune_locked(&mut entries);
    Ok(process)
}

pub fn release(process_id: &str) -> bool {
    let Ok(mut entries) = registry().lock() else {
        return false;
    };
    entries.remove(process_id).is_some()
}

pub fn list(running_only: bool, producer: Option<&str>) -> Vec<BackgroundProcess> {
    let Ok(mut entries) = registry().lock() else {
        return Vec::new();
    };
    prune_locked(&mut entries);
    let mut processes = entries
        .values_mut()
        .filter_map(|entry| {
            refresh_elapsed(&mut entry.process);
            let producer_matches = producer.is_none_or(|value| entry.process.producer == value);
            let running_matches = !running_only || entry.process.running;
            (producer_matches && running_matches).then(|| entry.process.clone())
        })
        .collect::<Vec<_>>();
    processes.sort_by(|left, right| {
        left.started_at
            .cmp(&right.started_at)
            .then_with(|| left.process_id.cmp(&right.process_id))
    });
    processes
}

pub fn request_stop(process_id: &str) -> Result<(), String> {
    let process_id = process_id.trim();
    if process_id.is_empty() {
        return Err("process_id must not be empty".to_string());
    }
    let mut entries = registry()
        .lock()
        .map_err(|_| "background process registry is unavailable".to_string())?;
    let Some(entry) = entries.get_mut(process_id) else {
        return Err(format!("background process '{process_id}' was not found"));
    };
    if !entry.process.running {
        return Err(format!("background process '{process_id}' is not running"));
    }
    entry.stop_reason = Some("stopped from Ryu".to_string());
    Ok(())
}

pub struct StopRequest {
    pub process_id: String,
    pub reason: String,
}

pub fn take_stop_requests(process_ids: &[String]) -> Vec<StopRequest> {
    let Ok(mut entries) = registry().lock() else {
        return Vec::new();
    };
    process_ids
        .iter()
        .filter_map(|process_id| {
            let entry = entries.get_mut(process_id)?;
            let reason = entry.stop_reason.take()?;
            Some(StopRequest {
                process_id: process_id.clone(),
                reason,
            })
        })
        .collect()
}

#[cfg(test)]
fn reset() {
    if let Ok(mut entries) = registry().lock() {
        entries.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn process(id: &str, running: bool) -> BackgroundProcess {
        BackgroundProcess {
            process_id: id.to_string(),
            shell_id: Some(id.to_string()),
            producer: "test".to_string(),
            kind: "shell".to_string(),
            label: None,
            description: None,
            command: format!("echo {id}"),
            cwd: "/tmp".to_string(),
            pid: Some(42),
            started_at: now_millis(),
            elapsed_ms: 0,
            running,
            exit_code: (!running).then_some(0),
            exit_signal: None,
        }
    }

    #[test]
    fn upsert_lists_running_processes_and_refreshes_elapsed() {
        reset();
        let mut running = process("running", true);
        running.started_at -= 250;
        upsert(running).expect("upsert");
        upsert(process("finished", false)).expect("upsert");

        let processes = list(true, Some("test"));
        assert_eq!(processes.len(), 1);
        assert_eq!(processes[0].process_id, "running");
        assert!(processes[0].elapsed_ms >= 250);
        assert_eq!(list(false, Some("test")).len(), 2);
        reset();
    }

    #[test]
    fn stop_requests_are_one_shot_and_unknown_processes_fail() {
        reset();
        upsert(process("one", true)).expect("upsert");
        assert!(request_stop("one").is_ok());
        let ids = vec!["one".to_string()];
        let stops = take_stop_requests(&ids);
        assert_eq!(stops.len(), 1);
        assert_eq!(stops[0].process_id, "one");
        assert_eq!(take_stop_requests(&ids).len(), 0);
        assert!(request_stop("missing").is_err());
        reset();
    }

    #[test]
    fn invalid_processes_are_rejected() {
        reset();
        let mut invalid = process("", true);
        invalid.command.clear();
        assert!(upsert(invalid).is_err());
        reset();
    }
}
