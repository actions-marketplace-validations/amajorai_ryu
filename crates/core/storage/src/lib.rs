//! Plugin-owned key/value storage — the extracted `storage` primitive crate.
//!
//! Each plugin gets an isolated, namespaced KV space exposed **only** through the
//! plugin-host `storage` capability (gated by the `storage:kv` grant). This is
//! where a plugin keeps durable state instead of Core growing bespoke columns for
//! it — e.g. the goal plugin's per-conversation completion condition + turn count
//! live here (key = conversation id), not on the `conversations` table.
//!
//! Placement (Core vs Gateway): this stores *what a plugin is tracking* — it
//! decides what runs, not what is allowed — so it is Core-tier. Rows are
//! namespaced by `(plugin_id, namespace, key)` so one plugin can never read
//! another's state.
//!
//! This crate is a **pure** primitive: [`PluginStorage::open`] takes an explicit
//! db path, so the crate has ZERO dependency on `apps/core`. The single kernel
//! coupling — choosing the default `~/.ryu/plugin-storage.db` path — and the
//! process-global handle stay Core-side as wiring (`apps/core/src/plugin_storage`).

use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// SQLite-backed per-plugin KV store. Cheap to clone (wraps an `Arc`).
#[derive(Clone)]
pub struct PluginStorage {
    conn: Arc<Mutex<Connection>>,
}

impl PluginStorage {
    /// Open (or create) the store at a specific path and run migrations.
    pub fn open(path: PathBuf) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("creating db dir {}", parent.display()))?;
        }
        let conn = Connection::open(&path)
            .with_context(|| format!("opening plugin-storage db {}", path.display()))?;
        Self::init_schema(&conn)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    /// In-memory store for tests.
    pub fn in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory().context("opening in-memory plugin-storage db")?;
        Self::init_schema(&conn)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    fn init_schema(conn: &Connection) -> Result<()> {
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS plugin_kv (
                 plugin_id  TEXT NOT NULL,
                 namespace  TEXT NOT NULL,
                 key        TEXT NOT NULL,
                 value      TEXT NOT NULL,
                 updated_at INTEGER NOT NULL,
                 PRIMARY KEY (plugin_id, namespace, key)
             );",
        )
        .context("initializing plugin-storage schema")?;
        Ok(())
    }

    /// Read a value. `Ok(None)` when the key is unset.
    pub async fn get(&self, plugin_id: &str, namespace: &str, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().await;
        let v = conn
            .query_row(
                "SELECT value FROM plugin_kv WHERE plugin_id = ?1 AND namespace = ?2 AND key = ?3",
                params![plugin_id, namespace, key],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .context("reading plugin_kv")?;
        Ok(v)
    }

    /// Upsert a value.
    pub async fn set(
        &self,
        plugin_id: &str,
        namespace: &str,
        key: &str,
        value: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().await;
        conn.execute(
            "INSERT INTO plugin_kv (plugin_id, namespace, key, value, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(plugin_id, namespace, key)
             DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![plugin_id, namespace, key, value, now_millis()],
        )
        .context("writing plugin_kv")?;
        Ok(())
    }

    /// Atomically replace a value only when it still equals `expected`.
    /// `None` means the key must be absent; a `None` replacement deletes it.
    /// The connection mutex is held across the read and write so concurrent
    /// plugin-host calls cannot lose a read-modify-write update.
    pub async fn compare_and_set(
        &self,
        plugin_id: &str,
        namespace: &str,
        key: &str,
        expected: Option<&str>,
        value: Option<&str>,
    ) -> Result<bool> {
        let conn = self.conn.lock().await;
        let current = conn
            .query_row(
                "SELECT value FROM plugin_kv WHERE plugin_id = ?1 AND namespace = ?2 AND key = ?3",
                params![plugin_id, namespace, key],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .context("reading plugin_kv for compare_and_set")?;
        if current.as_deref() != expected {
            return Ok(false);
        }
        match value {
            Some(value) => {
                conn.execute(
                    "INSERT INTO plugin_kv (plugin_id, namespace, key, value, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT(plugin_id, namespace, key)
                     DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                    params![plugin_id, namespace, key, value, now_millis()],
                )?;
            }
            None => {
                conn.execute(
                    "DELETE FROM plugin_kv WHERE plugin_id = ?1 AND namespace = ?2 AND key = ?3",
                    params![plugin_id, namespace, key],
                )?;
            }
        }
        Ok(true)
    }

    /// Move legacy unscoped namespaces into one authenticated user's tenant.
    /// Rows already carrying a tenant prefix win on a rerun, so a failed schema
    /// version write cannot duplicate or overwrite newer state.
    pub async fn migrate_legacy_namespaces(&self, tenant: &str) -> Result<usize> {
        let tenant = tenant.trim();
        if tenant.is_empty() {
            return Ok(0);
        }
        let prefix = format!("tenant:{tenant}:");
        let conn = self.conn.lock().await;
        let transaction = conn.unchecked_transaction()?;
        transaction.execute(
            "INSERT OR IGNORE INTO plugin_kv (plugin_id, namespace, key, value, updated_at)
             SELECT plugin_id, ?1 || namespace, key, value, updated_at
             FROM plugin_kv WHERE namespace NOT LIKE 'tenant:%'",
            params![prefix],
        )?;
        let removed = transaction.execute(
            "DELETE FROM plugin_kv WHERE namespace NOT LIKE 'tenant:%'",
            [],
        )?;
        transaction.commit()?;
        Ok(removed)
    }

    /// Delete a value (no-op if absent).
    pub async fn delete(&self, plugin_id: &str, namespace: &str, key: &str) -> Result<()> {
        let conn = self.conn.lock().await;
        conn.execute(
            "DELETE FROM plugin_kv WHERE plugin_id = ?1 AND namespace = ?2 AND key = ?3",
            params![plugin_id, namespace, key],
        )
        .context("deleting plugin_kv")?;
        Ok(())
    }

    /// List the keys a plugin has set within a namespace (newest first).
    /// Move every row owned by `from` to `to` — the plugin-id rename migration.
    ///
    /// The KV is keyed `(plugin_id, namespace, key)`, so a plugin whose id changes
    /// would otherwise silently lose all of its state: a goal plugin's active
    /// conditions, the learning log, anything a hook stashed. The rows are still
    /// there, just unreachable under the new id, which reads to a user as data loss
    /// with no error anywhere.
    ///
    /// `INSERT OR IGNORE` + `DELETE` rather than `UPDATE`: if the new id already has
    /// a row at the same `(namespace, key)` — a re-run, or a fresh install that
    /// already wrote state — the NEW value wins and the stale legacy row is dropped.
    /// A bare `UPDATE` would fail the primary-key constraint and abort the whole
    /// migration on the one plugin that needed it least.
    ///
    /// Returns the number of legacy rows removed.
    ///
    /// # Errors
    /// Returns `Err` if the SQLite transaction fails.
    pub async fn rekey_plugin(&self, from: &str, to: &str) -> Result<usize> {
        let conn = self.conn.lock().await;
        conn.execute(
            "INSERT OR IGNORE INTO plugin_kv (plugin_id, namespace, key, value, updated_at)
             SELECT ?2, namespace, key, value, updated_at FROM plugin_kv WHERE plugin_id = ?1",
            rusqlite::params![from, to],
        )?;
        let removed = conn.execute(
            "DELETE FROM plugin_kv WHERE plugin_id = ?1",
            rusqlite::params![from],
        )?;
        Ok(removed)
    }

    /// Return the number of records and value bytes owned by one plugin.
    ///
    /// The byte count intentionally measures stored values, which is the useful
    /// number for the uninstall preview and does not expose another plugin's
    /// namespace or key names.
    pub async fn usage(&self, plugin_id: &str) -> Result<(u64, u64)> {
        let conn = self.conn.lock().await;
        let (count, bytes): (i64, i64) = conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(length(CAST(value AS BLOB))), 0)
             FROM plugin_kv WHERE plugin_id = ?1",
            params![plugin_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        Ok((count.max(0) as u64, bytes.max(0) as u64))
    }

    /// Delete every record owned by one plugin. Returns the number of rows
    /// removed so callers can make the cleanup observable without reading keys.
    pub async fn delete_plugin(&self, plugin_id: &str) -> Result<usize> {
        let conn = self.conn.lock().await;
        Ok(conn.execute(
            "DELETE FROM plugin_kv WHERE plugin_id = ?1",
            params![plugin_id],
        )?)
    }

    pub async fn keys(&self, plugin_id: &str, namespace: &str) -> Result<Vec<String>> {
        let conn = self.conn.lock().await;
        let mut stmt = conn
            .prepare(
                "SELECT key FROM plugin_kv WHERE plugin_id = ?1 AND namespace = ?2
                 ORDER BY updated_at DESC",
            )
            .context("preparing plugin_kv keys query")?;
        let rows = stmt
            .query_map(params![plugin_id, namespace], |row| row.get::<_, String>(0))
            .context("querying plugin_kv keys")?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.context("reading plugin_kv key row")?);
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn set_get_delete_roundtrip() {
        let s = PluginStorage::in_memory().unwrap();
        assert_eq!(s.get("p", "ns", "k").await.unwrap(), None);
        s.set("p", "ns", "k", "v1").await.unwrap();
        assert_eq!(s.get("p", "ns", "k").await.unwrap().as_deref(), Some("v1"));
        // Upsert overwrites.
        s.set("p", "ns", "k", "v2").await.unwrap();
        assert_eq!(s.get("p", "ns", "k").await.unwrap().as_deref(), Some("v2"));
        s.delete("p", "ns", "k").await.unwrap();
        assert_eq!(s.get("p", "ns", "k").await.unwrap(), None);
    }

    #[tokio::test]
    async fn compare_and_set_is_atomic_and_checks_absence() {
        let s = PluginStorage::in_memory().unwrap();
        assert!(s
            .compare_and_set("p", "ns", "k", None, Some("v1"))
            .await
            .unwrap());
        assert!(!s
            .compare_and_set("p", "ns", "k", None, Some("v2"))
            .await
            .unwrap());
        assert!(s
            .compare_and_set("p", "ns", "k", Some("v1"), Some("v2"))
            .await
            .unwrap());
        assert!(s
            .compare_and_set("p", "ns", "k", Some("v2"), None)
            .await
            .unwrap());
        assert_eq!(s.get("p", "ns", "k").await.unwrap(), None);
    }

    #[tokio::test]
    async fn migrates_legacy_namespaces_once_into_a_tenant() {
        let s = PluginStorage::in_memory().unwrap();
        s.set("p", "default", "k", "legacy").await.unwrap();
        s.set("p", "tenant:other:default", "k", "other")
            .await
            .unwrap();

        assert_eq!(s.migrate_legacy_namespaces("user-1").await.unwrap(), 1);
        assert_eq!(s.get("p", "default", "k").await.unwrap(), None);
        assert_eq!(
            s.get("p", "tenant:user-1:default", "k")
                .await
                .unwrap()
                .as_deref(),
            Some("legacy")
        );
        assert_eq!(s.migrate_legacy_namespaces("user-1").await.unwrap(), 0);
    }

    #[tokio::test]
    async fn plugins_are_isolated_by_id_and_namespace() {
        let s = PluginStorage::in_memory().unwrap();
        s.set("plugin-a", "default", "shared", "a").await.unwrap();
        s.set("plugin-b", "default", "shared", "b").await.unwrap();
        // Same key, different plugin → isolated.
        assert_eq!(
            s.get("plugin-a", "default", "shared")
                .await
                .unwrap()
                .as_deref(),
            Some("a")
        );
        assert_eq!(
            s.get("plugin-b", "default", "shared")
                .await
                .unwrap()
                .as_deref(),
            Some("b")
        );
        // Same plugin, different namespace → isolated.
        s.set("plugin-a", "other", "shared", "a2").await.unwrap();
        assert_eq!(
            s.get("plugin-a", "default", "shared")
                .await
                .unwrap()
                .as_deref(),
            Some("a")
        );
    }

    #[tokio::test]
    async fn keys_lists_namespaced_keys() {
        let s = PluginStorage::in_memory().unwrap();
        s.set("p", "goals", "conv-1", "x").await.unwrap();
        s.set("p", "goals", "conv-2", "y").await.unwrap();
        s.set("p", "other", "conv-3", "z").await.unwrap();
        let mut keys = s.keys("p", "goals").await.unwrap();
        keys.sort();
        assert_eq!(keys, vec!["conv-1".to_string(), "conv-2".to_string()]);
    }

    #[tokio::test]
    async fn usage_and_delete_plugin_are_scoped() {
        let s = PluginStorage::in_memory().unwrap();
        s.set("p", "default", "one", "123").await.unwrap();
        s.set("p", "other", "two", "4567").await.unwrap();
        s.set("other", "default", "one", "outside").await.unwrap();

        assert_eq!(s.usage("p").await.unwrap(), (2, 7));
        assert_eq!(s.delete_plugin("p").await.unwrap(), 2);
        assert_eq!(s.usage("p").await.unwrap(), (0, 0));
        assert_eq!(
            s.get("other", "default", "one").await.unwrap().as_deref(),
            Some("outside")
        );
    }
}
