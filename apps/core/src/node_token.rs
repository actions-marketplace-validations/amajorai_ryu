//! Node-admittance token resolution (`RYU_TOKEN`).
//!
//! Core's `require_auth` gate compares a caller's `Authorization: Bearer` against
//! ONE shared secret. Historically that secret came from the `RYU_TOKEN`
//! environment variable and nowhere else, which meant a default desktop install
//! ran with **no token at all** — and `require_auth` treats "no token configured"
//! as "let everything through". Every process on the machine could therefore drive
//! the full local API unauthenticated, and so could any page served from an
//! allowlisted CORS origin.
//!
//! This module closes that by minting a strong token on first boot and persisting
//! it at `<ryu_dir>/core.token` (0600), so a fresh install is authenticated by
//! default with no operator action.
//!
//! ## Why this EXPORTS into the environment
//!
//! Nine call sites across two crates read `std::env::var("RYU_TOKEN")` directly —
//! the gateway child's `CORE_TOKEN`, the ACP adapter's two spawns, `ext_proxy`,
//! `self_api`, the hardware crate's shared-token fallback, and `main` itself.
//! Rather than rewrite each (and silently miss one at runtime, since none of them
//! fail at compile time), [`resolve_and_export`] runs FIRST in `main` and writes
//! the resolved value back into the process environment. Every existing reader —
//! including spawned children, which inherit it — then observes the same token
//! with no change. Core is edition 2021, where `set_var` is safe, and this runs
//! before any sidecar or server thread exists.
//!
//! ## Provenance is load-bearing, not bookkeeping
//!
//! A file-minted token is per-node. The mesh's shared-fleet convention
//! (`ryu_mesh::resolve_mesh_bearer`) assumes every node runs the SAME operator-
//! provisioned `RYU_TOKEN`, and hands the desktop this node's token to use as the
//! bearer for its PEERS. Offering a locally-minted token there would advertise a
//! bearer every peer rejects. So [`TokenSource`] is tracked and callers that mean
//! "the shared fleet secret" ask for [`shared_fleet_token`], not just any token.

use std::sync::OnceLock;

/// Where the active node token came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenSource {
    /// Operator-provisioned via the `RYU_TOKEN` environment variable. This is the
    /// only source that can be a SHARED fleet secret (the same value deliberately
    /// installed on several nodes).
    Env,
    /// Read from a `core.token` this machine minted on an earlier boot.
    File,
    /// Minted by this process on first boot.
    Minted,
}

/// The resolved token plus where it came from.
#[derive(Debug, Clone)]
pub struct ResolvedToken {
    pub token: String,
    pub source: TokenSource,
}

static RESOLVED: OnceLock<Option<ResolvedToken>> = OnceLock::new();

/// The file the minted token is persisted to.
///
/// Deliberately NOT `core.token`: that name is already the node IDENTITY marker
/// minted once by `POST /api/node/init` / `ryu node init` with `create_new(true)`,
/// and `data_path` excludes it from profile copies for that reason. Minting the
/// AUTH token into the same path would make `node_init` answer 409
/// `already_initialized` forever and `ryu node init` refuse without `--force`.
pub fn token_path() -> std::path::PathBuf {
    crate::paths::ryu_dir().join("node-auth.token")
}

/// Resolve the node token and export it to the process environment.
///
/// Precedence: an operator's `RYU_TOKEN` always wins (including on a machine that
/// also has a minted file, so provisioning a fleet secret is never fought by a
/// leftover local mint). Otherwise the persisted `core.token` is reused, and only
/// when neither exists is a fresh one minted.
///
/// Returns `None` only when no token could be established AND none could be
/// minted (e.g. an unwritable home directory). That is deliberately not fatal:
/// Core still boots, `require_auth` behaves exactly as it did before this module
/// existed, and the caller logs it. Refusing to start because a token file could
/// not be written would turn a hardening improvement into an outage.
pub fn resolve_and_export() -> Option<ResolvedToken> {
    RESOLVED
        .get_or_init(|| {
            let resolved = resolve_uncached();
            if let Some(r) = &resolved {
                // Export so the ~9 direct `env::var("RYU_TOKEN")` readers and every
                // spawned child (gateway, ACP agents, sidecars) see the same value.
                std::env::set_var("RYU_TOKEN", &r.token);
            }
            resolved
        })
        .clone()
}

fn resolve_uncached() -> Option<ResolvedToken> {
    // 1. Operator-provisioned env var. A placeholder is treated as absent: it is
    //    not a secret, and `enforce_remote_auth` already refuses to expose a node
    //    running one, so silently minting over it is strictly better than honoring
    //    it. `is_insecure_auth_token_placeholder` is the SAME predicate the mesh
    //    and the startup gate use, so all three agree on what counts as unset.
    if let Ok(env_token) = std::env::var("RYU_TOKEN") {
        let trimmed = env_token.trim();
        if !trimmed.is_empty() && !ryu_mesh::is_insecure_auth_token_placeholder(trimmed) {
            return Some(ResolvedToken {
                token: trimmed.to_owned(),
                source: TokenSource::Env,
            });
        }
    }

    let path = token_path();

    // 2. A token this machine minted earlier.
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let trimmed = existing.trim();
        if !trimmed.is_empty() && !ryu_mesh::is_insecure_auth_token_placeholder(trimmed) {
            return Some(ResolvedToken {
                token: trimmed.to_owned(),
                source: TokenSource::File,
            });
        }
    }

    // 3. Mint one.
    let token = mint_token();
    match write_token_file(&path, &token) {
        Ok(()) => {
            tracing::info!(
                path = %path.display(),
                "minted a node auth token; local API is authenticated by default"
            );
            Some(ResolvedToken {
                token,
                source: TokenSource::Minted,
            })
        }
        Err(e) => {
            tracing::warn!(
                path = %path.display(),
                error = %e,
                "could not persist a node auth token; Core will run WITHOUT local API \
                 authentication (set RYU_TOKEN to force one)"
            );
            None
        }
    }
}

/// A 256-bit URL-safe random token. Mirrors the strength of `infra/install.sh`'s
/// `openssl rand -base64 32`.
fn mint_token() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    // Hex rather than base64: the token travels in an HTTP header and in shell
    // env assignments, and hex has no `+`/`/`/`=` to quote or percent-encode.
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!("ryu_{hex}")
}

/// Write the token 0600, creating `<ryu_dir>` 0700. Uses `create_new` semantics
/// via a truncating open guarded by the caller's read-first check — a concurrent
/// second Core loses the race harmlessly because both write to the same path and
/// whichever value survives is read back by everyone through the same file.
fn write_token_file(path: &std::path::Path, token: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))?;
        }
    }

    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .mode(0o600)
            .open(path)?;
        file.write_all(token.as_bytes())?;
        file.sync_all()?;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }

    #[cfg(not(unix))]
    {
        std::fs::write(path, token)?;
    }

    Ok(())
}

/// The active token, whatever its provenance. This is what `require_auth`
/// compares against.
pub fn active_token() -> Option<String> {
    resolve_and_export().map(|r| r.token)
}

/// The active token ONLY when it can serve as a shared fleet secret — i.e. an
/// operator deliberately provisioned it via `RYU_TOKEN`.
///
/// A locally-minted token is unique to this machine, so handing it to a peer as
/// an enrollment bearer would advertise a credential that peer always rejects.
/// Callers wanting "the secret every node in this fleet shares" must use this,
/// not [`active_token`].
pub fn shared_fleet_token() -> Option<String> {
    resolve_and_export()
        .filter(|r| r.source == TokenSource::Env)
        .map(|r| r.token)
}

/// Rotate the node token: mint a fresh one and persist it.
///
/// Deliberately does NOT touch the process environment or the resolved
/// `OnceLock`. A half-applied rotation is worse than none: the running Core would
/// keep authenticating the OLD token while `env::var("RYU_TOKEN")` handed the NEW
/// one to freshly-spawned children, so which token worked would depend on which
/// reader answered. Writing only the file keeps the process wholly on the old
/// token until it restarts, and wholly on the new one after.
///
/// Errors when the active token came from the environment: `RYU_TOKEN` takes
/// precedence over the file, so rotating the file would be invisible — the
/// operator has to change their own env var.
pub fn rotate() -> std::io::Result<String> {
    if let Some(active) = resolve_and_export() {
        if active.source == TokenSource::Env {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "this node's token is provisioned via the RYU_TOKEN environment \
                 variable, which takes precedence over the token file. Rotating the \
                 file would have no effect — change RYU_TOKEN instead.",
            ));
        }
    }
    let token = mint_token();
    write_token_file(&token_path(), &token)?;
    Ok(token)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn minted_tokens_are_prefixed_unique_and_long_enough() {
        let a = mint_token();
        let b = mint_token();
        assert_ne!(a, b, "each mint must be independently random");
        assert!(a.starts_with("ryu_"));
        // 32 bytes hex = 64 chars, plus the 4-char prefix.
        assert_eq!(a.len(), 68);
        // The infra token-presence probe requires >= 24 chars; ours clears it.
        assert!(a.len() >= 24);
    }

    #[test]
    fn minted_tokens_are_not_treated_as_placeholders() {
        // A mint that the shared placeholder predicate rejected would be refused
        // by `enforce_remote_auth` on a non-loopback bind.
        assert!(!ryu_mesh::is_insecure_auth_token_placeholder(&mint_token()));
    }

    #[test]
    fn token_file_is_written_owner_only() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("core.token");
        write_token_file(&path, "ryu_abc").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "ryu_abc");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600, "token file must be owner-only");
            let parent = std::fs::metadata(path.parent().unwrap())
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(parent & 0o777, 0o700, "token dir must be owner-only");
        }
    }

    #[test]
    fn writing_over_an_existing_token_keeps_it_owner_only() {
        // Rotation path: the file already exists, so the mode must be re-asserted
        // rather than inherited from whatever was there.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("core.token");
        std::fs::write(&path, "old").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        }
        write_token_file(&path, "ryu_new").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "ryu_new");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
    }
}
