//! Encrypted-at-rest per-plugin secret store — the BYOK seam's UI half.
//!
//! # Why this exists
//!
//! A plugin declares a bring-your-own-key credential in its manifest as an
//! `env:` token inside `secret_headers`, e.g.
//!
//! ```json
//! "secret_headers": { "Authorization": "Bearer env:RYU_TAVILY_API_KEY" }
//! ```
//!
//! Until this module existed that token had exactly ONE source: the Core
//! process environment. So switching the `web.search` capability from `exa` to
//! `tavily` — a one-click swap in the UI — silently produced an unauthenticated
//! tool, because there was no way to *set* `RYU_TAVILY_API_KEY` short of editing
//! a shell profile and restarting Core. Settings fields could not fill the gap:
//! they persist to PREFERENCES (plaintext KV), not to process env, and there was
//! no write-only masked control to render.
//!
//! This store is the second source. [`crate::tool_exec`]'s `env:` resolver falls
//! back to it under the SAME variable name for the CALLING plugin, so **no
//! manifest changes anything**: every BYOK plugin that already ships an `env:`
//! token — `exa`, `tavily`, and any third-party one — becomes UI-configurable at
//! once. The paired UI control is
//! [`ryu_kernel_contracts::SettingsFieldType::Secret`].
//!
//! # Shape
//!
//! Rows are keyed `(plugin_id, key)` and encrypted with the shared
//! [`ryu_crypto`] master key, mirroring [`ryu_memory`]: `nonce` + `ciphertext`
//! BLOB columns, with only non-sensitive metadata (`plugin_id`, `key`,
//! `updated_at`) in plaintext so the "which keys are set" listing can be
//! answered in SQL without ever touching the cipher. There is deliberately no
//! bulk "read every secret" API — [`PluginSecretStore::list_keys`] returns key
//! names and timestamps only, and it is the ONLY thing the REST surface exposes.
//!
//! # Placement
//!
//! Core-tier, next to [`crate::plugin_storage`] (this is what a plugin *runs
//! with*, not what it is *allowed* to do — the allow/deny half is the
//! `may_read_env_secret` namespace gate in `tool_exec`). It lives in
//! `apps/core` rather than a primitive crate because it is small and has no
//! second consumer yet; extract it the day one appears.

use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use ryu_crypto::FieldCipher;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Whether `key` is a legal secret name: a C-identifier-shaped token, exactly the
/// alphabet a POSIX environment variable may use (`[A-Za-z_][A-Za-z0-9_]*`).
///
/// Delegates to the kernel contract's [`ryu_kernel_contracts::is_env_var_name`] so
/// the REST write path and the manifest validator cannot disagree: a `secret`
/// field the loader accepted must be a key this store will take, or the author
/// ships a field that only fails once a user presses Save.
///
/// The `env:` fallback looks this name up verbatim, so anything that could not be
/// an env var could never be read back — storing it would be a silent no-op the
/// user reads as "saved". The same rule keeps the value safe as a URL path segment
/// (no `/`, no `..`, no `%`).
pub fn is_valid_secret_key(key: &str) -> bool {
    ryu_kernel_contracts::is_env_var_name(key)
}

/// One entry in the "which secrets are set" listing. Carries NO value — by
/// construction, not by omission at the call site.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecretKeyInfo {
    /// The variable name, e.g. `RYU_TAVILY_API_KEY`.
    pub key: String,
    /// Epoch millis of the last write.
    pub updated_at: i64,
}

/// SQLite-backed, encrypted-at-rest `(plugin_id, key) -> secret` store.
/// Cheap to clone (wraps an `Arc`).
#[derive(Clone)]
pub struct PluginSecretStore {
    conn: Arc<Mutex<Connection>>,
    cipher: FieldCipher,
}

impl PluginSecretStore {
    /// Open (or create) the store at a specific path, encrypting with the shared
    /// [`ryu_crypto`] master key. Fails closed if the key cannot be resolved —
    /// an ephemeral key would write rows that die on the next restart.
    pub fn open(path: PathBuf) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("creating db dir {}", parent.display()))?;
        }
        let conn = Connection::open(&path)
            .with_context(|| format!("opening plugin-secrets db {}", path.display()))?;
        Self::init_schema(&conn)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            cipher: ryu_crypto::global_cipher()?,
        })
    }

    /// In-memory store with an ephemeral key, for tests. Never touches the real
    /// keychain or `~/.ryu`.
    #[cfg(test)]
    pub fn in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory().context("opening in-memory plugin-secrets db")?;
        Self::init_schema(&conn)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            cipher: FieldCipher::new(&[0x37; 32]),
        })
    }

    fn init_schema(conn: &Connection) -> Result<()> {
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS plugin_secrets (
                 plugin_id  TEXT NOT NULL,
                 key        TEXT NOT NULL,
                 nonce      BLOB NOT NULL,
                 ciphertext BLOB NOT NULL,
                 updated_at INTEGER NOT NULL,
                 PRIMARY KEY (plugin_id, key)
             );",
        )
        .context("initializing plugin-secrets schema")?;
        // Additive columns, when this table eventually needs one, go through the
        // in-repo `PRAGMA table_info` + `ALTER TABLE` migration idiom (see
        // `ryu_memory::MemoryStore::add_column_if_missing`). None yet, so the
        // helper is not written out here.
        Ok(())
    }

    /// Read and decrypt one secret. `Ok(None)` when unset.
    ///
    /// A row that fails to decrypt (master key rotated / db copied between
    /// machines) is treated as UNSET rather than as an error: the caller is the
    /// header resolver, whose "absent" path omits the header and lets the tool
    /// surface its own auth error. Turning a stale row into a hard failure would
    /// take the whole tool call down over a credential the user can simply re-enter.
    pub async fn get(&self, plugin_id: &str, key: &str) -> Result<Option<String>> {
        let row: Option<(Vec<u8>, Vec<u8>)> = {
            let conn = self.conn.lock().await;
            conn.query_row(
                "SELECT nonce, ciphertext FROM plugin_secrets WHERE plugin_id = ?1 AND key = ?2",
                params![plugin_id, key],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .context("reading plugin_secrets")?
        };
        let Some((nonce, ciphertext)) = row else {
            return Ok(None);
        };
        match self.cipher.decrypt(&nonce, &ciphertext) {
            Ok(plain) => Ok(Some(String::from_utf8_lossy(&plain).into_owned())),
            Err(e) => {
                tracing::warn!(
                    "plugin secret '{key}' for '{plugin_id}' could not be decrypted \
                     (master key changed?); treating it as unset: {e:#}"
                );
                Ok(None)
            }
        }
    }

    /// Store (or replace) a secret. The value is encrypted before it touches disk.
    ///
    /// An empty/whitespace-only value is a DELETE, not an empty secret: the `env:`
    /// resolver already treats an empty string as absent, so storing one would
    /// leave a row the UI reports as "set" and the resolver ignores.
    pub async fn set(&self, plugin_id: &str, key: &str, value: &str) -> Result<()> {
        if value.trim().is_empty() {
            return self.delete(plugin_id, key).await;
        }
        let (nonce, ciphertext) = self.cipher.encrypt(value.as_bytes())?;
        let conn = self.conn.lock().await;
        conn.execute(
            "INSERT INTO plugin_secrets (plugin_id, key, nonce, ciphertext, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(plugin_id, key) DO UPDATE SET
                 nonce = excluded.nonce,
                 ciphertext = excluded.ciphertext,
                 updated_at = excluded.updated_at",
            params![plugin_id, key, nonce, ciphertext, now_millis()],
        )
        .context("writing plugin_secrets")?;
        Ok(())
    }

    /// Delete a secret (no-op if absent).
    pub async fn delete(&self, plugin_id: &str, key: &str) -> Result<()> {
        let conn = self.conn.lock().await;
        conn.execute(
            "DELETE FROM plugin_secrets WHERE plugin_id = ?1 AND key = ?2",
            params![plugin_id, key],
        )
        .context("deleting plugin_secrets")?;
        Ok(())
    }

    /// Delete every secret owned by one plugin. Secret values are never loaded
    /// into memory for this operation; SQLite removes the encrypted rows in
    /// place and returns the affected-row count for cleanup reporting.
    pub async fn delete_plugin(&self, plugin_id: &str) -> Result<usize> {
        let conn = self.conn.lock().await;
        Ok(conn.execute(
            "DELETE FROM plugin_secrets WHERE plugin_id = ?1",
            params![plugin_id],
        )?)
    }

    /// Which secrets a plugin has set, newest write first. **Names and timestamps
    /// only** — the ciphertext columns are not even selected, so no code path from
    /// this function can leak a value.
    pub async fn list_keys(&self, plugin_id: &str) -> Result<Vec<SecretKeyInfo>> {
        let conn = self.conn.lock().await;
        let mut stmt = conn
            .prepare(
                "SELECT key, updated_at FROM plugin_secrets WHERE plugin_id = ?1
                 ORDER BY updated_at DESC, key ASC",
            )
            .context("preparing plugin_secrets keys query")?;
        let rows = stmt
            .query_map(params![plugin_id], |row| {
                Ok(SecretKeyInfo {
                    key: row.get(0)?,
                    updated_at: row.get(1)?,
                })
            })
            .context("querying plugin_secrets keys")?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.context("reading plugin_secrets key row")?);
        }
        Ok(out)
    }

    /// The raw stored ciphertext for a row, for tests that must prove a response
    /// body leaks neither the plaintext NOR the encrypted form. Not part of the
    /// production API — there is deliberately no way to reach the bytes otherwise.
    #[cfg(test)]
    pub async fn raw_ciphertext_for_test(&self, plugin_id: &str, key: &str) -> Option<Vec<u8>> {
        let conn = self.conn.lock().await;
        conn.query_row(
            "SELECT ciphertext FROM plugin_secrets WHERE plugin_id = ?1 AND key = ?2",
            params![plugin_id, key],
            |row| row.get::<_, Vec<u8>>(0),
        )
        .optional()
        .ok()
        .flatten()
    }
}

fn default_db_path() -> PathBuf {
    crate::paths::ryu_dir().join("plugin-secrets.db")
}

/// Open (or create) the store at the default path (`~/.ryu/plugin-secrets.db`).
pub fn open_default() -> Result<PluginSecretStore> {
    PluginSecretStore::open(default_db_path())
}

// ── Process-global handle (set in `main.rs`, like `plugin_storage::global`) ────

static GLOBAL: OnceLock<PluginSecretStore> = OnceLock::new();

/// Publish the process-global secret store. Idempotent (first set wins).
pub fn set_global(store: PluginSecretStore) {
    let _ = GLOBAL.set(store);
}

/// The process-global secret store, if it has been published.
///
/// A global rather than a threaded parameter because the primary reader,
/// `tool_exec::resolve_secret_token`, is a free async fn several layers below any
/// `ServerState` — exactly the situation [`crate::plugin_storage::global`] and
/// [`crate::identity::global`] already solve this way.
pub fn global() -> Option<&'static PluginSecretStore> {
    GLOBAL.get()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn set_get_delete_round_trips() {
        let s = PluginSecretStore::in_memory().unwrap();
        assert_eq!(s.get("exa", "RYU_EXA_API_KEY").await.unwrap(), None);

        s.set("exa", "RYU_EXA_API_KEY", "sk-exa-1").await.unwrap();
        assert_eq!(
            s.get("exa", "RYU_EXA_API_KEY").await.unwrap().as_deref(),
            Some("sk-exa-1")
        );

        // Upsert replaces.
        s.set("exa", "RYU_EXA_API_KEY", "sk-exa-2").await.unwrap();
        assert_eq!(
            s.get("exa", "RYU_EXA_API_KEY").await.unwrap().as_deref(),
            Some("sk-exa-2")
        );

        s.delete("exa", "RYU_EXA_API_KEY").await.unwrap();
        assert_eq!(s.get("exa", "RYU_EXA_API_KEY").await.unwrap(), None);
        // Deleting an absent key is a no-op, not an error.
        s.delete("exa", "RYU_EXA_API_KEY").await.unwrap();
    }

    #[tokio::test]
    async fn delete_plugin_removes_only_the_requested_plugin() {
        let s = PluginSecretStore::in_memory().unwrap();
        s.set("exa", "RYU_EXA_API_KEY", "sk-exa").await.unwrap();
        s.set("tavily", "RYU_TAVILY_API_KEY", "sk-tavily")
            .await
            .unwrap();

        assert_eq!(s.delete_plugin("exa").await.unwrap(), 1);
        assert!(s.list_keys("exa").await.unwrap().is_empty());
        assert_eq!(s.list_keys("tavily").await.unwrap().len(), 1);
    }

    /// The point of the store: the plaintext must not survive the write. Asserted
    /// against the raw BLOB column, not the API, so a future "store it plainly for
    /// speed" refactor fails here.
    #[tokio::test]
    async fn the_value_is_encrypted_at_rest() {
        let s = PluginSecretStore::in_memory().unwrap();
        let secret = "sk-tavily-super-secret";
        s.set("tavily", "RYU_TAVILY_API_KEY", secret).await.unwrap();

        let raw: Vec<u8> = {
            let conn = s.conn.lock().await;
            conn.query_row(
                "SELECT ciphertext FROM plugin_secrets WHERE plugin_id = 'tavily'",
                [],
                |row| row.get(0),
            )
            .unwrap()
        };
        assert_ne!(raw.as_slice(), secret.as_bytes());
        assert!(
            !String::from_utf8_lossy(&raw).contains("tavily-super"),
            "the plaintext must not be recoverable from the stored column"
        );
    }

    /// Rows are keyed by plugin: one plugin's key name never resolves to another's
    /// value. (The read-side namespace gate in `tool_exec` is the second layer.)
    #[tokio::test]
    async fn secrets_are_isolated_per_plugin() {
        let s = PluginSecretStore::in_memory().unwrap();
        s.set("exa", "RYU_SHARED_NAME", "exa-value").await.unwrap();
        s.set("tavily", "RYU_SHARED_NAME", "tavily-value")
            .await
            .unwrap();

        assert_eq!(
            s.get("exa", "RYU_SHARED_NAME").await.unwrap().as_deref(),
            Some("exa-value")
        );
        assert_eq!(
            s.get("tavily", "RYU_SHARED_NAME").await.unwrap().as_deref(),
            Some("tavily-value")
        );
        assert_eq!(s.get("other", "RYU_SHARED_NAME").await.unwrap(), None);
    }

    /// An empty (or whitespace-only) value CLEARS the secret rather than storing a
    /// blank one — an empty secret would read as "set" in the UI while the `env:`
    /// resolver treats it as absent.
    #[tokio::test]
    async fn an_empty_value_deletes_rather_than_storing_a_blank_secret() {
        let s = PluginSecretStore::in_memory().unwrap();
        s.set("exa", "RYU_EXA_API_KEY", "sk-exa").await.unwrap();

        s.set("exa", "RYU_EXA_API_KEY", "   ").await.unwrap();
        assert_eq!(s.get("exa", "RYU_EXA_API_KEY").await.unwrap(), None);
        assert!(
            s.list_keys("exa").await.unwrap().is_empty(),
            "a cleared secret must not linger in the listing as 'set'"
        );
    }

    #[tokio::test]
    async fn list_keys_reports_names_and_timestamps_only() {
        let s = PluginSecretStore::in_memory().unwrap();
        s.set("exa", "RYU_EXA_API_KEY", "sk-exa").await.unwrap();
        s.set("exa", "RYU_EXA_BASE", "https://x").await.unwrap();

        let keys = s.list_keys("exa").await.unwrap();
        assert_eq!(keys.len(), 2);
        let names: Vec<&str> = keys.iter().map(|k| k.key.as_str()).collect();
        assert!(names.contains(&"RYU_EXA_API_KEY"));
        assert!(names.contains(&"RYU_EXA_BASE"));
        assert!(
            keys.iter().all(|k| k.updated_at > 0),
            "each entry carries a write timestamp"
        );
        // Another plugin's listing is unaffected.
        assert!(s.list_keys("tavily").await.unwrap().is_empty());
    }

    #[test]
    fn secret_key_names_are_env_var_shaped() {
        for ok in ["RYU_EXA_API_KEY", "_private", "A1", "a_b_c"] {
            assert!(is_valid_secret_key(ok), "'{ok}' should be accepted");
        }
        for bad in [
            "",
            "1LEADING_DIGIT",
            "has-dash",
            "has space",
            "has/slash",
            "..",
            "unicodé",
        ] {
            assert!(!is_valid_secret_key(bad), "'{bad}' should be rejected");
        }
        assert!(!is_valid_secret_key(
            &"A".repeat(ryu_kernel_contracts::MAX_SECRET_KEY_LEN + 1)
        ));
    }
}
