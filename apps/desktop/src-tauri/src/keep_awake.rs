//! OS sleep inhibition for active ACP work.
//!
//! The frontend decides when the feature should be active (the persisted Gateway
//! preference must be on and Core must report an active ACP agent). This module
//! only owns the native assertion and keeps it scoped to the desktop process.

use std::sync::Mutex;

use serde::Serialize;
use tauri::State;

#[cfg(any(target_os = "linux", target_os = "macos"))]
use std::process::{Child, Command, Stdio};

#[derive(Default)]
pub struct KeepAwakeState {
    inner: Mutex<KeepAwakeInner>,
}

#[derive(Default)]
struct KeepAwakeInner {
    enabled: bool,
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    child: Option<Child>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeepAwakeStatus {
    enabled: bool,
    supported: bool,
    backend: &'static str,
}

fn backend() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        return "caffeinate";
    }
    #[cfg(target_os = "linux")]
    {
        return "systemd-inhibit";
    }
    #[cfg(target_os = "windows")]
    {
        return "SetThreadExecutionState";
    }
    #[allow(unreachable_code)]
    "unsupported"
}

fn supported() -> bool {
    cfg!(any(
        target_os = "linux",
        target_os = "macos",
        target_os = "windows"
    ))
}

fn status(inner: &KeepAwakeInner) -> KeepAwakeStatus {
    KeepAwakeStatus {
        enabled: inner.enabled,
        supported: supported(),
        backend: backend(),
    }
}

#[cfg(target_os = "windows")]
const ES_SYSTEM_REQUIRED: u32 = 0x0000_0001;
#[cfg(target_os = "windows")]
const ES_CONTINUOUS: u32 = 0x8000_0000;

#[cfg(target_os = "windows")]
#[link(name = "kernel32")]
extern "system" {
    fn SetThreadExecutionState(execution_state: u32) -> u32;
}

/// Apply the native assertion. It is deliberately idempotent because the React
/// runtime polls ACP status and may send the same state more than once.
#[tauri::command]
pub fn set_keep_awake(
    state: State<'_, KeepAwakeState>,
    enabled: bool,
) -> Result<KeepAwakeStatus, String> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "keep-awake state is unavailable".to_owned())?;

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    if inner.enabled {
        let exited = inner
            .child
            .as_mut()
            .map(|child| {
                child
                    .try_wait()
                    .map(|status| status.is_some())
                    .map_err(|error| format!("could not inspect sleep inhibition: {error}"))
            })
            .transpose()?
            .unwrap_or(false);
        if exited {
            inner.child = None;
            inner.enabled = false;
        }
    }

    if !supported() {
        inner.enabled = false;
        return Ok(status(&inner));
    }

    #[cfg(target_os = "macos")]
    {
        if enabled && !inner.enabled {
            let child = Command::new("/usr/bin/caffeinate")
                .arg("-i")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|error| format!("could not start caffeinate: {error}"))?;
            inner.child = Some(child);
        } else if !enabled {
            stop_child(&mut inner)?;
        }
        inner.enabled = enabled;
    }

    #[cfg(target_os = "linux")]
    {
        if enabled && !inner.enabled {
            let child = match Command::new("systemd-inhibit")
                .args([
                    "--what=idle:sleep",
                    "--who=Ryu",
                    "--why=ACP agents are active",
                    "--mode=block",
                    "sh",
                    "-c",
                    "while :; do sleep 3600; done",
                ])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
            {
                Ok(child) => child,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    inner.enabled = false;
                    return Ok(status(&inner));
                }
                Err(error) => {
                    return Err(format!("could not start systemd-inhibit: {error}"));
                }
            };
            inner.child = Some(child);
        } else if !enabled {
            stop_child(&mut inner)?;
        }
        inner.enabled = enabled;
    }

    #[cfg(target_os = "windows")]
    {
        let flags = if enabled {
            ES_CONTINUOUS | ES_SYSTEM_REQUIRED
        } else {
            ES_CONTINUOUS
        };
        // SAFETY: SetThreadExecutionState is a process-local Windows power API;
        // the flags are fixed constants and no pointers cross the FFI boundary.
        let result = unsafe { SetThreadExecutionState(flags) };
        if result == 0 {
            return Err("Windows rejected the sleep-inhibition request".to_owned());
        }
        inner.enabled = enabled;
    }

    Ok(status(&inner))
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn stop_child(inner: &mut KeepAwakeInner) -> Result<(), String> {
    if let Some(mut child) = inner.child.take() {
        if let Err(error) = child.kill() {
            if !matches!(
                error.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::InvalidInput
            ) {
                return Err(format!("could not stop sleep inhibition: {error}"));
            }
        }
        let _ = child.wait();
    }
    Ok(())
}
