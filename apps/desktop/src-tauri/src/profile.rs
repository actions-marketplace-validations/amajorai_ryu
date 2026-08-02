//! Desktop build/runtime profile — the client mirror of Core's `profile.rs`.
//!
//! A *profile* lets a **dev variant** of the desktop ("Ryu Dev") run FULLY
//! ISOLATED alongside a release install on one machine: a distinct Core port, a
//! distinct data dir (`~/.ryu-dev`), and a distinct island control port, so the
//! two stacks never bleed into each other. The distinct bundle identifier
//! (`ai.amajor.ryu.desktop.dev`, set in `tauri.dev.conf.json`) gives it its own
//! single-instance lock and app-data store for free.
//!
//! This MUST agree with `apps/core/src/profile.rs`: dev shifts every base port by
//! [`DEV_PORT_OFFSET`] (1000) and suffixes the data dir with `-<profile>`. The
//! desktop passes `RYU_PROFILE` to the Core child it spawns (see
//! `core/process.rs`), and Core's own profile module then binds the shifted port
//! and uses the shifted data dir — so there is one offset convention on both
//! sides and they can never disagree.
//!
//! The active profile comes from, in order: the `RYU_PROFILE` env var, else the
//! `dev-variant` compile feature (the packaged "Ryu Dev" build), else release. A
//! release build with neither is **byte-identical to before**: port 7980,
//! `~/.ryu`, the original bundle id.
//!
//! Every profile has its OWN port offset ([`PROFILE_PORT_OFFSETS`]). This used to
//! be "release ⇒ 0, anything else ⇒ dev's +1000", which gave `canary` its own data
//! dir and keychain slot but dev's listeners — two stacks that each believed they
//! were isolated while sharing one port.

use std::path::PathBuf;

/// Env var naming the active profile. Unset / empty / `release` ⇒ release.
pub const RYU_PROFILE_ENV: &str = "RYU_PROFILE";

/// Port offset for the `dev` profile. Must equal Core's
/// `profile::DEV_PORT_OFFSET`.
pub const DEV_PORT_OFFSET: u16 = 1000;

/// Mirror of `apps/core/src/profile.rs::PROFILE_PORT_OFFSETS`. The desktop
/// spawns Core with this same `RYU_PROFILE` and then dials the port it computes
/// here, so a row that disagrees with Core's table means the desktop adopts a
/// port nothing is listening on.
pub const PROFILE_PORT_OFFSETS: &[(&str, u16)] = &[
	("release", 0),
	("dev", DEV_PORT_OFFSET),
	("canary", 2000),
	("nightly", 3000),
	("beta", 4000),
];

/// The port offset for `profile`, or `None` when it is not a known profile.
pub fn offset_of(profile: &str) -> Option<u16> {
	PROFILE_PORT_OFFSETS
		.iter()
		.find(|(name, _)| *name == profile)
		.map(|(_, offset)| *offset)
}

/// The base Core HTTP port (release). `port()` shifts it per profile.
pub const CORE_BASE_PORT: u16 = 7980;

/// The base island loopback control port (release).
pub const ISLAND_CONTROL_BASE_PORT: u16 = 7989;

/// The active profile name, lowercased. `"release"` when unset/empty; otherwise
/// the `RYU_PROFILE` value; otherwise `"dev"` when built as the dev variant.
pub fn name() -> String {
	if let Ok(raw) = std::env::var(RYU_PROFILE_ENV) {
		let trimmed = raw.trim().to_ascii_lowercase();
		if !trimmed.is_empty() {
			return trimmed;
		}
	}
	if cfg!(feature = "dev-variant") {
		return "dev".to_string();
	}
	"release".to_string()
}

/// True for the default release profile (zero offset, no data-dir suffix).
pub fn is_release() -> bool {
	name() == "release"
}

/// True for any non-release (dev) profile.
pub fn is_dev() -> bool {
	!is_release()
}

/// `base + offset`, saturating. release ⇒ `base`; dev ⇒ `base + 1000`; every
/// other known profile gets its own offset from [`PROFILE_PORT_OFFSETS`].
///
/// An unknown profile falls back to release's zero offset rather than dev's —
/// Core rejects the name outright at startup, so the desktop would fail to reach
/// the Core it spawned either way, and aliasing onto dev would have it dial a
/// *different, running* stack instead. Failing to connect beats connecting to
/// the wrong stack.
pub fn port(base: u16) -> u16 {
	base.saturating_add(offset_of(&name()).unwrap_or(0))
}

/// The Core HTTP port for this profile: 7980 release, 8980 dev.
pub fn core_port() -> u16 {
	port(CORE_BASE_PORT)
}

/// `http://127.0.0.1:<core_port>` — the loopback base for health/control calls.
pub fn core_base_url() -> String {
	format!("http://127.0.0.1:{}", core_port())
}

/// `http://localhost:<core_port>` — the URL handed to the webview (matches the
/// historical spelling of `get_ryu_core_url`).
pub fn core_localhost_url() -> String {
	format!("http://localhost:{}", core_port())
}

/// The island loopback control port for this profile: 7989 release, 8989 dev.
/// An explicit `ISLAND_CONTROL_PORT` env var wins (so `bun run dev` can override
/// both sides at once); otherwise it is derived from the profile.
pub fn island_control_port() -> u16 {
	if let Ok(raw) = std::env::var("ISLAND_CONTROL_PORT") {
		if let Ok(parsed) = raw.trim().parse::<u16>() {
			return parsed;
		}
	}
	port(ISLAND_CONTROL_BASE_PORT)
}

/// Data-dir suffix: `""` for release (byte-identical `~/.ryu`), `-<profile>`
/// otherwise (e.g. `~/.ryu-dev`). Matches Core's `profile::suffix`.
pub fn suffix() -> String {
	if is_release() {
		String::new()
	} else {
		format!("-{}", name())
	}
}

/// The Ryu data/home dir for this profile: `~/.ryu` release, `~/.ryu-dev` dev.
pub fn ryu_home_dir() -> PathBuf {
	dirs::home_dir()
		.unwrap_or_else(|| PathBuf::from("."))
		.join(format!(".ryu{}", suffix()))
}

/// True when `candidate` is `<home>/.ryu<suffix>/bin/<exe>` for a Ryu profile home
/// that is NOT the active one.
///
/// Installers put **both** `~/.ryu/bin` and `~/.ryu-dev/bin` on PATH, so any
/// `which("ryu-core")`-style lookup from the dev profile happily returns the
/// RELEASE binary. Every PATH fallback must run its hit through this first, or a
/// dev profile silently runs a release-build Core against `~/.ryu-dev` — a version
/// skew that shows up as routes 404-ing for no visible reason.
///
/// Both PATH fallbacks (binary resolution *and* the installed-check that decides
/// whether to download) must agree here: if only the resolver rejected the foreign
/// hit, the installed-check would still count it as present, skip the download, and
/// leave the profile with no binary at all.
pub fn is_foreign_profile_bin(candidate: &std::path::Path) -> bool {
	// <profile home>/bin/<exe> → the profile home is two levels up.
	let Some(home) = candidate.parent().and_then(std::path::Path::parent) else {
		return false;
	};
	if home == ryu_home_dir() {
		return false;
	}
	home.file_name()
		.and_then(|n| n.to_str())
		.is_some_and(|n| n == ".ryu" || n.starts_with(".ryu-"))
}

#[cfg(test)]
mod tests {
	use super::*;

	/// The three `PROFILE_PORT_OFFSETS` mirrors (Core, Gateway, desktop) MUST
	/// stay identical: the desktop spawns Core and Core spawns the Gateway, all
	/// with the same `RYU_PROFILE`, so one table drifting means a spawner dials a
	/// port its child never bound. Each crate asserts the SAME literal rows, so
	/// editing one mirror without the others fails here.
	#[test]
	fn the_profile_table_matches_its_mirrors() {
		assert_eq!(
			PROFILE_PORT_OFFSETS,
			&[
				("release", 0u16),
				("dev", 1000),
				("canary", 2000),
				("nightly", 3000),
				("beta", 4000),
			][..]
		);
	}

	#[test]
	fn canary_no_longer_shares_devs_ports() {
		// Was: every non-release profile got +1000, so a canary desktop dialled
		// the dev stack's Core.
		assert_eq!(offset_of("dev"), Some(1000));
		assert_eq!(offset_of("canary"), Some(2000));
		assert_ne!(offset_of("canary"), offset_of("dev"));
		// An unknown name resolves to release's offset, never dev's — failing to
		// connect beats connecting to a different, running stack.
		assert_eq!(offset_of("typo"), None);
	}
}
