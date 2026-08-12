//! PATH environment variable management for Ryu binaries.
//!
//! Automatically adds `~/.ryu/bin/` to PATH on first run to make installed
//! sidecar binaries (zeroclaw, temporal, etc.) accessible from the terminal.

#[cfg(not(target_os = "windows"))]
use std::io::Write;
use std::path::Path;
#[cfg(not(target_os = "windows"))]
use std::path::PathBuf;

use anyhow::{Context, Result};

/// User-level bin directories that a GUI-launched Core does not inherit.
///
/// This is the whole reason the function below exists. A Core started from a
/// terminal inherits the user's real `PATH` and can see everything they have
/// installed; a Core started by the desktop app is launched by the OS session
/// (launchd on macOS, Explorer on Windows), which hands it a minimal `PATH` —
/// `/usr/bin:/bin:/usr/sbin:/sbin` and nothing else. Every CLI a user actually
/// installs an agent with (`npm i -g`, Homebrew, bun, the vendor's own curl
/// script) lands in one of these directories and in NONE of those four, so the
/// same machine reports "Claude Code not installed" in the app and "installed"
/// in a terminal. That is what makes onboarding's agent detection look removed.
#[cfg(not(target_os = "windows"))]
const WELL_KNOWN_BIN_DIRS: &[&str] = &[
    // Vendor install scripts (Claude Code, Codex) and pipx/uv tools.
    ".local/bin",
    // JS/TS toolchains that place global binaries under $HOME.
    ".bun/bin",
    ".deno/bin",
    ".npm-global/bin",
    ".volta/bin",
    ".yarn/bin",
    // Rust and Go toolchains.
    ".cargo/bin",
    "go/bin",
];

/// Absolute (non-`$HOME`) directories in the same category.
#[cfg(not(target_os = "windows"))]
const WELL_KNOWN_ABS_BIN_DIRS: &[&str] = &[
    "/opt/homebrew/bin", // Homebrew, Apple Silicon
    "/usr/local/bin",    // Homebrew (Intel), most curl|sh installers
    "/opt/local/bin",    // MacPorts
];

pub struct PathManager;

impl PathManager {
    /// Append the user's well-known bin directories to THIS process's `PATH`.
    ///
    /// Called once at boot, before anything probes for or spawns a CLI, so that
    /// detection (`binary_in_path`) and execution (`Command::new`) resolve
    /// against the same set — a detector that finds a binary the spawner cannot
    /// run just moves the failure later.
    ///
    /// Three properties are load-bearing:
    ///
    /// 1. **Appended, never prepended.** Anything the real `PATH` already
    ///    provides keeps winning, so this can only ever ADD reachable binaries;
    ///    it can never shadow a system tool with something from `$HOME`.
    /// 2. **Existing directories only**, deduplicated against what is already
    ///    there, so `PATH` does not grow on every boot or fill with dead entries.
    /// 3. **Per-tool roots are included** (`~/.opencode/bin`, `~/.grok/bin`, …).
    ///    Several agent CLIs install into their own `~/.<tool>/bin` rather than a
    ///    shared prefix, and being last in `PATH` they can only resolve a name
    ///    nothing else provides — which is exactly the name we are looking for.
    pub fn enrich_process_path() {
        #[cfg(not(target_os = "windows"))]
        {
            let Some(home) = dirs::home_dir() else {
                return;
            };
            let current = std::env::var_os("PATH").unwrap_or_default();
            let mut dirs_in_path: Vec<PathBuf> = std::env::split_paths(&current).collect();
            let known: std::collections::HashSet<PathBuf> = dirs_in_path.iter().cloned().collect();
            let missing = missing_bin_dirs(&home, &known);
            if missing.is_empty() {
                return;
            }
            let appended: Vec<String> = missing.iter().map(|d| d.display().to_string()).collect();
            dirs_in_path.extend(missing);
            match std::env::join_paths(&dirs_in_path) {
                Ok(joined) => {
                    std::env::set_var("PATH", joined);
                    tracing::debug!(
                        added = %appended.join(", "),
                        "path: appended user bin directories the launcher did not inherit"
                    );
                }
                // A directory containing the path separator cannot be joined; leaving
                // PATH exactly as inherited is the safe outcome.
                Err(e) => tracing::debug!("path: could not extend PATH: {e}"),
            }
        }
    }
}

/// The well-known bin directories that exist on disk but are absent from `known`.
///
/// Pure (given a home and the current `PATH` set) so the rule can be asserted
/// without mutating the process environment, which a parallel test suite shares.
#[cfg(not(target_os = "windows"))]
fn missing_bin_dirs(
    home: &Path,
    known: &std::collections::HashSet<PathBuf>,
) -> Vec<PathBuf> {
    let mut seen = known.clone();
    let mut out = Vec::new();
    let candidates = WELL_KNOWN_BIN_DIRS
        .iter()
        .map(|rel| home.join(rel))
        .chain(WELL_KNOWN_ABS_BIN_DIRS.iter().map(PathBuf::from))
        .chain(per_tool_bin_dirs(home));
    for dir in candidates {
        // `seen` grows as we go: `~/.cargo/bin` is both a well-known entry and a
        // `~/.<tool>/bin` match, so without this it would be appended twice.
        if !seen.insert(dir.clone()) || !dir.is_dir() {
            continue;
        }
        out.push(dir);
    }
    out
}

/// `~/.<tool>/bin` directories that exist — the self-contained install layout
/// several agent CLIs use (`~/.opencode/bin/opencode`, `~/.grok/bin/grok`).
///
/// Discovered rather than listed because the set is open-ended: a curated list
/// would go stale every time a vendor ships a new CLI, which is the same
/// staleness that made detection miss these in the first place. Sorted so the
/// resulting `PATH` is deterministic across boots.
#[cfg(not(target_os = "windows"))]
fn per_tool_bin_dirs(home: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(home) else {
        return Vec::new();
    };
    let mut out: Vec<PathBuf> = entries
        .flatten()
        .filter(|e| {
            e.file_name()
                .to_str()
                .is_some_and(|n| n.starts_with('.') && n.len() > 1)
        })
        .map(|e| e.path().join("bin"))
        .filter(|p| p.is_dir())
        .collect();
    out.sort();
    out
}

impl PathManager {
    /// Add ~/.ryu/bin to PATH permanently
    pub fn add_to_path() -> Result<()> {
        let bin_dir = crate::paths::ryu_dir().join("bin");

        #[cfg(target_os = "windows")]
        {
            Self::add_to_windows_path(&bin_dir)?;
        }

        #[cfg(not(target_os = "windows"))]
        {
            Self::add_to_unix_path(&bin_dir)?;
        }

        Ok(())
    }

    #[cfg(target_os = "windows")]
    fn add_to_windows_path(bin_dir: &Path) -> Result<()> {
        use winapi::shared::minwindef::LPARAM;
        use winapi::um::winuser::{
            SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
        };
        use winreg::{enums::*, RegKey};

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let env = hkcu
            .open_subkey_with_flags("Environment", KEY_READ | KEY_WRITE)
            .context("opening Environment registry key")?;

        let current_path: String = env.get_value("Path").unwrap_or_default();

        // Check if already in PATH
        if current_path.split(';').any(|p| Path::new(p) == bin_dir) {
            tracing::debug!("~/.ryu/bin already in PATH");
            return Ok(());
        }

        // Append to PATH
        let new_path = if current_path.ends_with(';') || current_path.is_empty() {
            format!("{}{}", current_path, bin_dir.display())
        } else {
            format!("{};{}", current_path, bin_dir.display())
        };

        env.set_value("Path", &new_path)
            .context("setting Path registry value")?;

        // Notify other processes of the change
        unsafe {
            SendMessageTimeoutW(
                HWND_BROADCAST,
                WM_SETTINGCHANGE,
                0,
                "Environment\0".as_ptr() as LPARAM,
                SMTO_ABORTIFHUNG,
                5000,
                std::ptr::null_mut(),
            );
        }

        tracing::info!("Added ~/.ryu/bin to user PATH (Windows)");
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    fn add_to_unix_path(bin_dir: &Path) -> Result<()> {
        let shell_profile = Self::detect_shell_profile()?;

        let export_line = format!(
            "\n# Added by ryu-core\nexport PATH=\"$PATH:{}\"\n",
            bin_dir.display()
        );

        // Check if already in profile
        if let Ok(contents) = std::fs::read_to_string(&shell_profile) {
            if contents.contains(&bin_dir.display().to_string()) {
                tracing::debug!(
                    "~/.ryu/bin already in PATH (found in {})",
                    shell_profile.display()
                );
                return Ok(());
            }
        }

        // Append to profile
        std::fs::OpenOptions::new()
            .append(true)
            .create(true)
            .open(&shell_profile)
            .context("opening shell profile for append")?
            .write_all(export_line.as_bytes())
            .context("writing PATH export to shell profile")?;

        tracing::info!("Added ~/.ryu/bin to PATH in {}", shell_profile.display());
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    fn detect_shell_profile() -> Result<PathBuf> {
        let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("no home directory"))?;

        // Try common shell profiles in order of preference
        let profiles = vec![
            ".zshrc",        // Zsh (default on newer macOS)
            ".bashrc",       // Bash (common on Linux)
            ".bash_profile", // Bash (common on macOS)
            ".profile",      // Generic POSIX shell
        ];

        for profile in &profiles {
            let path = home.join(profile);
            if path.exists() {
                return Ok(path);
            }
        }

        // Default to .bashrc if none exist (create it if needed)
        Ok(home.join(".bashrc"))
    }
}

#[cfg(all(test, not(target_os = "windows")))]
mod tests {
    use std::collections::HashSet;

    use super::*;

    /// The bug this guards: a desktop-launched Core inherits launchd's minimal
    /// PATH, so a `claude` installed by its own installer into `~/.local/bin` —
    /// or an `opencode` under `~/.opencode/bin` — is invisible to the CLI probe
    /// that decides whether onboarding shows the "Found on your system" section.
    /// Both layouts must be recovered from a PATH that contains neither.
    #[test]
    fn recovers_user_install_dirs_a_gui_launcher_drops() {
        let home = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(home.path().join(".local/bin")).unwrap();
        std::fs::create_dir_all(home.path().join(".opencode/bin")).unwrap();
        // Present in $HOME but with no `bin/`, so it is not a tool root.
        std::fs::create_dir_all(home.path().join(".config")).unwrap();

        // The launchd-minimal PATH: nothing under $HOME.
        let known: HashSet<PathBuf> = ["/usr/bin", "/bin"].iter().map(PathBuf::from).collect();
        let found = missing_bin_dirs(home.path(), &known);

        assert!(found.contains(&home.path().join(".local/bin")));
        assert!(found.contains(&home.path().join(".opencode/bin")));
        assert!(!found.contains(&home.path().join(".config")));
    }

    /// Never re-add what PATH already has: this runs on every boot, and a PATH
    /// that grows by a duplicate each time is its own failure.
    #[test]
    fn skips_directories_already_on_path() {
        let home = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(home.path().join(".local/bin")).unwrap();

        let known: HashSet<PathBuf> = [home.path().join(".local/bin")].into_iter().collect();
        assert!(!missing_bin_dirs(home.path(), &known).contains(&home.path().join(".local/bin")));
    }

    /// A directory that does not exist is never added — PATH should carry no
    /// dead entries for toolchains this user has not installed.
    #[test]
    fn skips_directories_that_do_not_exist() {
        let home = tempfile::tempdir().unwrap();
        let found = missing_bin_dirs(home.path(), &HashSet::new());
        assert!(!found.contains(&home.path().join(".bun/bin")));
        assert!(!found.contains(&home.path().join(".cargo/bin")));
    }

    /// `~/.cargo/bin` is reachable both as a well-known entry and as a
    /// `~/.<tool>/bin` match; it must be appended once.
    #[test]
    fn does_not_append_the_same_directory_twice() {
        let home = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(home.path().join(".cargo/bin")).unwrap();

        let found = missing_bin_dirs(home.path(), &HashSet::new());
        let hits = found
            .iter()
            .filter(|d| **d == home.path().join(".cargo/bin"))
            .count();
        assert_eq!(hits, 1);
    }
}
