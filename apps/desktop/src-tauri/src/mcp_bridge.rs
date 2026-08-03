//! Developer-Mode gate for the Tauri MCP bridge.
//!
//! `tauri-plugin-mcp-bridge` opens a WebSocket that lets an external MCP server
//! (`@hypothesi/tauri-mcp-server`, the `tauri` entry in the repo's `.mcp.json`)
//! drive this app: run JS in the webview, screenshot it, click it, invoke IPC
//! commands. That is exactly the tool you want when debugging a *stable release*
//! build — and exactly the thing you must not leave listening by default.
//!
//! So the plugin is registered at startup ONLY when the user has opted in, and
//! the opt-in lives here rather than in the webview's `ryu_developer_mode`
//! localStorage key: the registration decision is made before the window exists,
//! so it has to be readable from disk at process start. The Developer settings
//! tab mirrors the master toggle into this file (see `set_mcp_bridge_enabled`).
//!
//! Two deliberate posture decisions:
//!
//! - **Loopback only.** The plugin defaults to `0.0.0.0`; we always pass
//!   `127.0.0.1`. A debug channel that can drive the app must never be reachable
//!   off-host.
//! - **Registration, not just a listener, is what the toggle controls.** When
//!   the flag is off there is no plugin: no socket, no `bridge.js` injected into
//!   the webview, no `plugin:mcp-bridge|*` commands. Nothing to attack. The
//!   previous `#[cfg(debug_assertions)]` gate is gone, so "off" now means off in
//!   debug builds too.
//!
//! **The opt-in is SINGLE-SHOT, and that is a security property, not tidiness.**
//!
//! `take_enabled()` reads the flag and immediately clears it, so arming survives
//! exactly one launch. The reason is the escalation the plugin's own socket makes
//! possible: it accepts any loopback WebSocket with no auth, no Origin check and
//! no subprotocol (see the gap note below), and WebSocket handshakes are exempt
//! from CORS preflight — so while the bridge is live, ANY web page open in the
//! user's browser can connect to it, and the socket exposes `invoke_tauri`.
//!
//! With a sticky flag that chain ends in permanent compromise: the page calls
//! `invoke_tauri("set_mcp_bridge_enabled", {enabled: true})`, the flag is written,
//! and every subsequent launch of the *stable release build* comes up listening —
//! with Developer Mode reading "off" in the UI, because nothing reconciled it.
//! Consuming the flag at startup caps that at a single launch, and since the only
//! thing that re-arms it is the frontend mirroring a genuinely-on Developer Mode
//! at boot, turning Developer Mode off is now sufficient to keep the bridge from
//! ever coming back. The reconcile deliberately does NOT live on the settings
//! tab's mount: a user who never opens that tab again would never run it.
//!
//! **Known gap — there is no wire-level bearer.** The plugin's server accepts any
//! loopback connection and its client dials a bare `ws://host:port` with no
//! headers, no subprotocol and no path, reading only `MCP_BRIDGE_HOST` /
//! `MCP_BRIDGE_PORT` from its environment. A token therefore has nothing to ride
//! on in either direction, and inventing one here would be theatre: the socket
//! would still accept the unauthenticated connection. What the user pastes into
//! their agent config is the port, and the real gate is that the socket only
//! exists while Developer Mode is on. Closing this properly means a Ryu-owned
//! `"type": "http"` MCP endpoint that can carry `Authorization: Bearer` — a
//! different transport, not a tweak to this one.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};

/// Lives next to the other per-profile state in `~/.ryu` (`~/.ryu-dev`, …), so
/// a profile wipe takes the opt-in with it and each profile decides separately.
const STATE_FILE: &str = "mcp-bridge.json";

/// Set by [`mark_live`] when `run()` actually registered the plugin. The flag on
/// disk is *intent*; this is what the current process did with it, and the
/// difference between the two is what the settings UI reports as "relaunch to
/// attach".
static LIVE: AtomicBool = AtomicBool::new(false);

/// The port the plugin was actually handed. The plugin walks forward from its
/// base port when that one is busy, so a settings tab that reported the profile
/// default would hand the user a port nothing is listening on whenever a second
/// instance got there first.
static LIVE_PORT: AtomicU16 = AtomicU16::new(0);

#[derive(Default, Deserialize, Serialize)]
struct Persisted {
	enabled: bool,
}

fn state_path() -> PathBuf {
	crate::profile::ryu_home_dir().join(STATE_FILE)
}

/// Missing / unreadable / malformed all mean "not opted in" — this file gates a
/// debug channel, so anything we cannot positively read as `true` fails closed.
fn read_persisted() -> Persisted {
	std::fs::read_to_string(state_path())
		.ok()
		.and_then(|raw| serde_json::from_str(&raw).ok())
		.unwrap_or_default()
}

fn write_persisted(state: &Persisted) -> Result<(), String> {
	let path = state_path();
	if let Some(parent) = path.parent() {
		std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
	}
	let body = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
	std::fs::write(&path, body).map_err(|e| e.to_string())?;
	// Owner-only: this flag decides whether a socket that can drive the app
	// comes up on next launch, so another local account must not be able to
	// flip it.
	#[cfg(unix)]
	{
		use std::os::unix::fs::PermissionsExt;
		let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
	}
	Ok(())
}

/// The startup question: should `run()` register the bridge plugin?
///
/// CONSUMES the flag — reads it, then clears it on disk. Arming is good for one
/// launch, so a flag written by anything other than the frontend's boot-time
/// mirror of Developer Mode cannot persist. See the module docs for the
/// escalation this closes.
pub fn take_enabled() -> bool {
	let enabled = read_persisted().enabled;
	if enabled {
		// Best-effort: a failure here means the flag survives to the next launch,
		// which is the pre-existing behaviour, not a new hole.
		let _ = write_persisted(&Persisted { enabled: false });
	}
	enabled
}

/// The flag as it currently sits on disk, without consuming it. Only the status
/// read-out uses this; the startup decision goes through [`take_enabled`].
pub fn is_enabled() -> bool {
	read_persisted().enabled
}

/// Records that this process registered the plugin, on `port`. Called from
/// `run()` right after the registration so the two can never disagree.
pub fn mark_live(port: u16) {
	LIVE_PORT.store(port, Ordering::Relaxed);
	LIVE.store(true, Ordering::Relaxed);
}

#[derive(Serialize)]
pub struct BridgeStatus {
	/// The persisted opt-in — what the next launch will do.
	pub enabled: bool,
	/// Whether the bridge is actually listening in *this* process.
	pub live: bool,
	/// `enabled != live`: the user changed the opt-in since launch, so the
	/// change only takes effect after a relaunch.
	pub needs_relaunch: bool,
	pub host: String,
	pub port: u16,
}

fn status() -> BridgeStatus {
	// `enabled` is the flag for the NEXT launch. Because startup consumes it, a
	// live bridge normally shows `enabled: false` until the frontend re-mirrors
	// Developer Mode — so `live` is what the UI must key "the socket is open" on,
	// never `enabled`.
	let enabled = is_enabled();
	let live = LIVE.load(Ordering::Relaxed);
	let live_port = LIVE_PORT.load(Ordering::Relaxed);
	BridgeStatus {
		enabled,
		live,
		needs_relaunch: enabled != live,
		host: "127.0.0.1".to_string(),
		// Off: the port the next launch will try. On: the one it actually took.
		port: if live_port == 0 {
			crate::profile::mcp_bridge_port()
		} else {
			live_port
		},
	}
}

#[tauri::command]
pub fn mcp_bridge_status() -> BridgeStatus {
	status()
}

/// Mirror the Developer Mode master toggle into the on-disk opt-in.
///
/// Idempotent, and safe to call on every settings mount to reconcile drift (a
/// cleared localStorage would otherwise leave the bridge armed for the next
/// launch with the UI showing Developer Mode off).
#[tauri::command]
pub fn set_mcp_bridge_enabled(enabled: bool) -> Result<BridgeStatus, String> {
	if is_enabled() != enabled {
		write_persisted(&Persisted { enabled })?;
	}
	Ok(status())
}

#[cfg(test)]
mod tests {
	use super::*;

	// The gate must fail closed on every unreadable shape, because each of these
	// is what a partially-written or hand-edited file looks like, and the failure
	// mode of the other direction is a listening debug socket nobody asked for.
	#[test]
	fn unreadable_state_is_not_enabled() {
		for raw in ["", "{}", "not json", r#"{"enabled":"yes"}"#] {
			let parsed: Persisted = serde_json::from_str(raw).unwrap_or_default();
			assert!(!parsed.enabled, "{raw:?} must not arm the bridge");
		}
	}

	#[test]
	fn only_explicit_true_enables() {
		let parsed: Persisted = serde_json::from_str(r#"{"enabled":true}"#).unwrap();
		assert!(parsed.enabled);
	}

	// Release must stay on the documented port and every other profile must get
	// its own, or two installs debugged side by side would fight over one socket.
	#[test]
	fn port_is_profile_shifted() {
		assert_eq!(crate::profile::MCP_BRIDGE_BASE_PORT, 8400);
		assert_eq!(
			crate::profile::MCP_BRIDGE_BASE_PORT
				+ crate::profile::offset_of("dev").expect("dev is a known profile"),
			9400
		);
	}
}
