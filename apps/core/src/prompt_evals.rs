//! Core-owned persistence for Prompt Studio suites, runs, versions, and human
//! review. Provider execution remains Gateway-owned; this module stores the
//! reproducible input/output envelope around that execution.

use std::path::PathBuf;
use std::sync::OnceLock;

use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::Mutex;

use crate::sidecar::download_manager::ryu_dir;

const MAX_SUITE_VERSIONS: i64 = 50;
const MAX_SUITE_CASES: usize = 10_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptSuiteRecord {
    pub agent_id: String,
    pub config: Value,
    pub created_at: i64,
    pub id: String,
    pub name: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptSuiteVersionMeta {
    pub created_at: i64,
    pub id: String,
    pub label: Option<String>,
    pub suite_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptSuiteVersion {
    pub config: Value,
    pub created_at: i64,
    pub id: String,
    pub label: Option<String>,
    pub suite_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptRunMeta {
    pub created_at: i64,
    pub id: String,
    pub name: String,
    pub suite_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptRun {
    pub created_at: i64,
    pub id: String,
    pub name: String,
    pub request: Value,
    pub result: Value,
    pub suite_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PromptReview {
    pub comment: Option<String>,
    pub highlighted: bool,
    pub pass: Option<bool>,
    pub result_key: String,
    pub run_id: String,
    pub score: Option<f32>,
    pub updated_at: i64,
}

#[derive(Clone)]
pub struct PromptEvalStore {
    conn: std::sync::Arc<Mutex<Connection>>,
}

static GLOBAL: OnceLock<PromptEvalStore> = OnceLock::new();

fn db_path() -> PathBuf {
    ryu_dir().join("prompt-evals.db")
}

fn now_millis() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn new_id(prefix: &str) -> String {
    format!("{prefix}_{}", uuid::Uuid::new_v4().simple())
}

impl PromptEvalStore {
    pub fn open() -> Result<Self> {
        let path = db_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).context("creating prompt eval data dir")?;
        }
        let conn = Connection::open(&path)
            .with_context(|| format!("opening prompt eval database at {}", path.display()))?;
        Self::migrate(&conn)?;
        Ok(Self {
            conn: std::sync::Arc::new(Mutex::new(conn)),
        })
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        Self::migrate(&conn)?;
        Ok(Self {
            conn: std::sync::Arc::new(Mutex::new(conn)),
        })
    }

    fn migrate(conn: &Connection) -> Result<()> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS prompt_suites (
                id         TEXT PRIMARY KEY,
                agent_id   TEXT NOT NULL,
                name       TEXT NOT NULL,
                config     TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_prompt_suites_agent
                ON prompt_suites(agent_id, updated_at DESC);
            CREATE TABLE IF NOT EXISTS prompt_suite_versions (
                id         TEXT PRIMARY KEY,
                suite_id   TEXT NOT NULL,
                config     TEXT NOT NULL,
                label      TEXT,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_prompt_suite_versions_suite
                ON prompt_suite_versions(suite_id, created_at DESC, id DESC);
            CREATE TABLE IF NOT EXISTS prompt_runs (
                id         TEXT PRIMARY KEY,
                suite_id   TEXT NOT NULL,
                name       TEXT NOT NULL,
                request    TEXT NOT NULL,
                result     TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_prompt_runs_suite
                ON prompt_runs(suite_id, created_at DESC, id DESC);
            CREATE TABLE IF NOT EXISTS prompt_reviews (
                run_id      TEXT NOT NULL,
                result_key  TEXT NOT NULL,
                pass        INTEGER,
                score       REAL,
                comment     TEXT,
                highlighted INTEGER NOT NULL DEFAULT 0,
                updated_at  INTEGER NOT NULL,
                PRIMARY KEY (run_id, result_key)
            );",
        )
        .context("creating prompt eval schema")?;
        Ok(())
    }

    pub fn install_global(store: Self) -> Result<()> {
        GLOBAL
            .set(store)
            .map_err(|_| anyhow::anyhow!("prompt eval store already installed"))
    }

    pub fn global() -> Option<&'static Self> {
        GLOBAL.get()
    }

    pub async fn create_suite(
        &self,
        agent_id: &str,
        name: &str,
        config: &Value,
    ) -> Result<PromptSuiteRecord> {
        let id = new_id("ps");
        let now = now_millis();
        let name = name.trim();
        if name.is_empty() {
            anyhow::bail!("prompt suite name is required");
        }
        let config_json = serde_json::to_string(config)?;
        let conn = self.conn.lock().await;
        conn.execute(
            "INSERT INTO prompt_suites (id, agent_id, name, config, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![id, agent_id, name, config_json, now],
        )?;
        Ok(PromptSuiteRecord {
            agent_id: agent_id.to_owned(),
            config: config.clone(),
            created_at: now,
            id,
            name: name.to_owned(),
            updated_at: now,
        })
    }

    pub async fn list_suites(&self, agent_id: &str) -> Result<Vec<PromptSuiteRecord>> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare(
            "SELECT id, agent_id, name, config, created_at, updated_at
             FROM prompt_suites WHERE agent_id = ?1 ORDER BY updated_at DESC, id DESC",
        )?;
        let rows = stmt
            .query_map(params![agent_id], |row| decode_suite_row(row))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub async fn get_suite(&self, suite_id: &str) -> Result<Option<PromptSuiteRecord>> {
        let conn = self.conn.lock().await;
        conn.query_row(
            "SELECT id, agent_id, name, config, created_at, updated_at
             FROM prompt_suites WHERE id = ?1",
            params![suite_id],
            decode_suite_row,
        )
        .optional()
        .map_err(Into::into)
    }

    pub async fn update_suite(
        &self,
        suite_id: &str,
        name: &str,
        config: &Value,
    ) -> Result<Option<PromptSuiteRecord>> {
        let name = name.trim();
        if name.is_empty() {
            anyhow::bail!("prompt suite name is required");
        }
        let now = now_millis();
        let config_json = serde_json::to_string(config)?;
        let conn = self.conn.lock().await;
        let changed = conn.execute(
            "UPDATE prompt_suites SET name = ?1, config = ?2, updated_at = ?3 WHERE id = ?4",
            params![name, config_json, now, suite_id],
        )?;
        if changed == 0 {
            return Ok(None);
        }
        drop(conn);
        self.get_suite(suite_id).await
    }

    /// Append one trace-derived case to a suite and return the updated suite.
    ///
    /// The caller owns authorization and trace-to-case extraction. Keeping the
    /// mutation here means imported cases use the same suite persistence and
    /// versioning path as hand-authored Promptfoo cases.
    pub async fn append_case(
        &self,
        suite_id: &str,
        case: &Value,
    ) -> Result<Option<PromptSuiteRecord>> {
        Ok(self
            .append_case_if_absent(suite_id, case)
            .await?
            .map(|(suite, _added)| suite))
    }

    /// Append one case while holding the SQLite write lock across the duplicate
    /// check and update. Trace import retries are common (the browser can replay a
    /// request after a lost response), so an `id` already present in the suite is
    /// treated as an idempotent no-op. Returning the boolean lets the HTTP layer
    /// report whether it created a new case without doing a second racy read.
    pub async fn append_case_if_absent(
        &self,
        suite_id: &str,
        case: &Value,
    ) -> Result<Option<(PromptSuiteRecord, bool)>> {
        let conn = self.conn.lock().await;
        conn.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            let suite = conn
                .query_row(
                    "SELECT id, agent_id, name, config, created_at, updated_at
                     FROM prompt_suites WHERE id = ?1",
                    params![suite_id],
                    decode_suite_row,
                )
                .optional()?;
            let Some(suite) = suite else {
                return Ok(None);
            };

            let mut config = suite.config.clone();
            let object = config
                .as_object_mut()
                .ok_or_else(|| anyhow::anyhow!("prompt suite config must be a JSON object"))?;
            let tests = object
                .entry("tests".to_owned())
                .or_insert_with(|| Value::Array(Vec::new()));
            let cases = tests
                .as_array_mut()
                .ok_or_else(|| anyhow::anyhow!("prompt suite tests must be an array"))?;

            if let Some(case_id) = case.get("id").and_then(Value::as_str) {
                if cases
                    .iter()
                    .any(|existing| existing.get("id").and_then(Value::as_str) == Some(case_id))
                {
                    return Ok(Some((suite, false)));
                }
            }
            if cases.len() >= MAX_SUITE_CASES {
                anyhow::bail!("prompt suite cannot contain more than {MAX_SUITE_CASES} cases");
            }
            cases.push(case.clone());
            let now = now_millis();
            conn.execute(
                "UPDATE prompt_suites SET config = ?1, updated_at = ?2 WHERE id = ?3",
                params![serde_json::to_string(&config)?, now, suite_id],
            )?;
            let updated = conn
                .query_row(
                    "SELECT id, agent_id, name, config, created_at, updated_at
                     FROM prompt_suites WHERE id = ?1",
                    params![suite_id],
                    decode_suite_row,
                )
                .optional()?;
            Ok(updated.map(|suite| (suite, true)))
        })();
        match result {
            Ok(value) => {
                conn.execute_batch("COMMIT")?;
                Ok(value)
            }
            Err(error) => {
                let _ = conn.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    pub async fn delete_suite(&self, suite_id: &str) -> Result<bool> {
        let conn = self.conn.lock().await;
        conn.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            let changed =
                conn.execute("DELETE FROM prompt_suites WHERE id = ?1", params![suite_id])?;
            if changed == 0 {
                return Ok(false);
            }
            conn.execute(
                "DELETE FROM prompt_suite_versions WHERE suite_id = ?1",
                params![suite_id],
            )?;
            conn.execute(
                "DELETE FROM prompt_reviews WHERE run_id IN (
                    SELECT id FROM prompt_runs WHERE suite_id = ?1
                )",
                params![suite_id],
            )?;
            conn.execute(
                "DELETE FROM prompt_runs WHERE suite_id = ?1",
                params![suite_id],
            )?;
            Ok(true)
        })();
        match result {
            Ok(value) => {
                conn.execute_batch("COMMIT")?;
                Ok(value)
            }
            Err(error) => {
                let _ = conn.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    pub async fn snapshot_suite(
        &self,
        suite_id: &str,
        label: Option<&str>,
    ) -> Result<Option<PromptSuiteVersionMeta>> {
        let Some(suite) = self.get_suite(suite_id).await? else {
            return Ok(None);
        };
        let id = new_id("psv");
        let now = now_millis();
        let conn = self.conn.lock().await;
        conn.execute(
            "INSERT INTO prompt_suite_versions (id, suite_id, config, label, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                id,
                suite_id,
                serde_json::to_string(&suite.config)?,
                label,
                now
            ],
        )?;
        conn.execute(
            "DELETE FROM prompt_suite_versions
             WHERE suite_id = ?1 AND id NOT IN (
               SELECT id FROM prompt_suite_versions WHERE suite_id = ?1
               ORDER BY created_at DESC, id DESC LIMIT ?2
             )",
            params![suite_id, MAX_SUITE_VERSIONS],
        )?;
        Ok(Some(PromptSuiteVersionMeta {
            created_at: now,
            id,
            label: label.map(str::to_owned),
            suite_id: suite.id,
        }))
    }

    pub async fn list_versions(&self, suite_id: &str) -> Result<Vec<PromptSuiteVersionMeta>> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare(
            "SELECT id, suite_id, label, created_at FROM prompt_suite_versions
             WHERE suite_id = ?1 ORDER BY created_at DESC, id DESC",
        )?;
        let rows = stmt
            .query_map(params![suite_id], |row| {
                Ok(PromptSuiteVersionMeta {
                    id: row.get(0)?,
                    suite_id: row.get(1)?,
                    label: row.get(2)?,
                    created_at: row.get(3)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub async fn get_version(
        &self,
        suite_id: &str,
        version_id: &str,
    ) -> Result<Option<PromptSuiteVersion>> {
        let conn = self.conn.lock().await;
        conn.query_row(
            "SELECT id, suite_id, config, label, created_at FROM prompt_suite_versions
             WHERE id = ?1 AND suite_id = ?2",
            params![version_id, suite_id],
            |row| {
                let raw: String = row.get(2)?;
                Ok(PromptSuiteVersion {
                    config: serde_json::from_str(&raw).unwrap_or(Value::Null),
                    created_at: row.get(4)?,
                    id: row.get(0)?,
                    label: row.get(3)?,
                    suite_id: row.get(1)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
    }

    pub async fn restore_version(
        &self,
        suite_id: &str,
        version_id: &str,
    ) -> Result<Option<PromptSuiteRecord>> {
        let Some(version) = self.get_version(suite_id, version_id).await? else {
            return Ok(None);
        };
        let _ = self
            .snapshot_suite(suite_id, Some("Before restore"))
            .await?;
        let Some(current) = self.get_suite(suite_id).await? else {
            return Ok(None);
        };
        self.update_suite(suite_id, &current.name, &version.config)
            .await
    }

    pub async fn save_run(
        &self,
        suite_id: &str,
        name: &str,
        request: &Value,
        result: &Value,
    ) -> Result<Option<PromptRunMeta>> {
        if self.get_suite(suite_id).await?.is_none() {
            return Ok(None);
        }
        let id = new_id("pr");
        let now = now_millis();
        let conn = self.conn.lock().await;
        conn.execute(
            "INSERT INTO prompt_runs (id, suite_id, name, request, result, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                id,
                suite_id,
                if name.trim().is_empty() {
                    "Untitled run"
                } else {
                    name.trim()
                },
                serde_json::to_string(request)?,
                serde_json::to_string(result)?,
                now
            ],
        )?;
        Ok(Some(PromptRunMeta {
            created_at: now,
            id,
            name: if name.trim().is_empty() {
                "Untitled run".to_owned()
            } else {
                name.trim().to_owned()
            },
            suite_id: suite_id.to_owned(),
        }))
    }

    pub async fn list_runs(&self, suite_id: &str) -> Result<Vec<PromptRunMeta>> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare(
            "SELECT id, suite_id, name, created_at FROM prompt_runs
             WHERE suite_id = ?1 ORDER BY created_at DESC, id DESC",
        )?;
        let rows = stmt
            .query_map(params![suite_id], |row| {
                Ok(PromptRunMeta {
                    id: row.get(0)?,
                    suite_id: row.get(1)?,
                    name: row.get(2)?,
                    created_at: row.get(3)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub async fn get_run(&self, suite_id: &str, run_id: &str) -> Result<Option<PromptRun>> {
        let conn = self.conn.lock().await;
        conn.query_row(
            "SELECT id, suite_id, name, request, result, created_at FROM prompt_runs
             WHERE id = ?1 AND suite_id = ?2",
            params![run_id, suite_id],
            |row| {
                let request: String = row.get(3)?;
                let result: String = row.get(4)?;
                Ok(PromptRun {
                    created_at: row.get(5)?,
                    id: row.get(0)?,
                    name: row.get(2)?,
                    request: serde_json::from_str(&request).unwrap_or(Value::Null),
                    result: serde_json::from_str(&result).unwrap_or(Value::Null),
                    suite_id: row.get(1)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
    }

    pub async fn rename_run(
        &self,
        suite_id: &str,
        run_id: &str,
        name: &str,
    ) -> Result<Option<PromptRunMeta>> {
        let name = name.trim();
        if name.is_empty() {
            anyhow::bail!("prompt run name is required");
        }
        let conn = self.conn.lock().await;
        let changed = conn.execute(
            "UPDATE prompt_runs SET name = ?1 WHERE id = ?2 AND suite_id = ?3",
            params![name, run_id, suite_id],
        )?;
        if changed == 0 {
            return Ok(None);
        }
        drop(conn);
        self.list_runs(suite_id)
            .await
            .map(|runs| runs.into_iter().find(|run| run.id == run_id))
    }

    pub async fn delete_run(&self, suite_id: &str, run_id: &str) -> Result<bool> {
        let conn = self.conn.lock().await;
        conn.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            let changed = conn.execute(
                "DELETE FROM prompt_runs WHERE id = ?1 AND suite_id = ?2",
                params![run_id, suite_id],
            )?;
            if changed > 0 {
                conn.execute(
                    "DELETE FROM prompt_reviews WHERE run_id = ?1",
                    params![run_id],
                )?;
            }
            Ok(changed > 0)
        })();
        match result {
            Ok(value) => {
                conn.execute_batch("COMMIT")?;
                Ok(value)
            }
            Err(error) => {
                let _ = conn.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    pub async fn duplicate_run(
        &self,
        suite_id: &str,
        run_id: &str,
        name: Option<&str>,
    ) -> Result<Option<PromptRunMeta>> {
        let Some(run) = self.get_run(suite_id, run_id).await? else {
            return Ok(None);
        };
        self.save_run(
            suite_id,
            name.unwrap_or_else(|| "").trim(),
            &run.request,
            &run.result,
        )
        .await
    }

    pub async fn save_review(&self, review: &PromptReview) -> Result<PromptReview> {
        let now = now_millis();
        let conn = self.conn.lock().await;
        conn.execute(
            "INSERT INTO prompt_reviews
                (run_id, result_key, pass, score, comment, highlighted, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(run_id, result_key) DO UPDATE SET
                pass = excluded.pass,
                score = excluded.score,
                comment = excluded.comment,
                highlighted = excluded.highlighted,
                updated_at = excluded.updated_at",
            params![
                review.run_id,
                review.result_key,
                review.pass.map(i64::from),
                review.score,
                review.comment,
                i64::from(review.highlighted),
                now
            ],
        )?;
        Ok(PromptReview {
            updated_at: now,
            ..review.clone()
        })
    }

    pub async fn list_reviews(&self, run_id: &str) -> Result<Vec<PromptReview>> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare(
            "SELECT run_id, result_key, pass, score, comment, highlighted, updated_at
             FROM prompt_reviews WHERE run_id = ?1 ORDER BY result_key",
        )?;
        let rows = stmt
            .query_map(params![run_id], |row| {
                Ok(PromptReview {
                    run_id: row.get(0)?,
                    result_key: row.get(1)?,
                    pass: row.get::<_, Option<i64>>(2)?.map(|v| v != 0),
                    score: row.get(3)?,
                    comment: row.get(4)?,
                    highlighted: row.get::<_, i64>(5)? != 0,
                    updated_at: row.get(6)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }
}

fn decode_suite_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PromptSuiteRecord> {
    let raw: String = row.get(3)?;
    Ok(PromptSuiteRecord {
        id: row.get(0)?,
        agent_id: row.get(1)?,
        name: row.get(2)?,
        config: serde_json::from_str(&raw).unwrap_or(Value::Null),
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn suite_version_run_and_review_roundtrip() {
        let store = PromptEvalStore::open_in_memory().unwrap();
        let suite = store
            .create_suite("agent-1", "Regression", &serde_json::json!({"tests": []}))
            .await
            .unwrap();
        let version = store
            .snapshot_suite(&suite.id, Some("Baseline"))
            .await
            .unwrap()
            .unwrap();
        store
            .update_suite(
                &suite.id,
                "Regression",
                &serde_json::json!({"tests": [{"id": "case-1"}]}),
            )
            .await
            .unwrap();
        let run = store
            .save_run(
                &suite.id,
                "First run",
                &serde_json::json!({"model": "m1"}),
                &serde_json::json!({"cases": []}),
            )
            .await
            .unwrap()
            .unwrap();
        let review = store
            .save_review(&PromptReview {
                comment: Some("Looks good".to_owned()),
                highlighted: true,
                pass: Some(true),
                result_key: "case-1:m1".to_owned(),
                run_id: run.id.clone(),
                score: Some(0.9),
                updated_at: 0,
            })
            .await
            .unwrap();
        assert_eq!(store.list_suites("agent-1").await.unwrap().len(), 1);
        assert_eq!(store.list_versions(&suite.id).await.unwrap().len(), 1);
        assert_eq!(store.list_runs(&suite.id).await.unwrap().len(), 1);
        assert_eq!(store.list_reviews(&run.id).await.unwrap()[0], review);
        assert_eq!(
            store
                .restore_version(&suite.id, &version.id)
                .await
                .unwrap()
                .unwrap()
                .config,
            serde_json::json!({"tests": []})
        );
    }

    #[tokio::test]
    async fn append_case_updates_suite_without_dropping_existing_config() {
        let store = PromptEvalStore::open_in_memory().unwrap();
        let suite = store
            .create_suite(
                "agent-1",
                "Regression",
                &serde_json::json!({
                    "prompts": ["You are helpful."],
                    "providers": ["openai:gpt-4o-mini"],
                    "tests": [{"id": "existing"}]
                }),
            )
            .await
            .unwrap();

        let updated = store
            .append_case(
                &suite.id,
                &serde_json::json!({
                    "id": "trace-run-1",
                    "prompt": "What is 2 + 2?",
                    "expected": "4",
                    "metadata": {"source": "ryu-trace"}
                }),
            )
            .await
            .unwrap()
            .unwrap();

        assert_eq!(updated.config["prompts"][0], "You are helpful.");
        assert_eq!(updated.config["tests"].as_array().unwrap().len(), 2);
        assert_eq!(updated.config["tests"][1]["id"], "trace-run-1");
    }

    #[tokio::test]
    async fn append_case_is_idempotent_and_atomic_for_duplicate_trace_ids() {
        let store = PromptEvalStore::open_in_memory().unwrap();
        let suite = store
            .create_suite("agent-1", "Regression", &serde_json::json!({"tests": []}))
            .await
            .unwrap();
        let case = serde_json::json!({
            "id": "trace-run-1",
            "prompt": "What is 2 + 2?",
            "expected": "4"
        });

        let (first, second) = tokio::join!(
            store.append_case_if_absent(&suite.id, &case),
            store.append_case_if_absent(&suite.id, &case),
        );
        let (first, first_added) = first.unwrap().unwrap();
        let (second, second_added) = second.unwrap().unwrap();
        assert_ne!(
            first_added, second_added,
            "exactly one concurrent import adds"
        );
        assert_eq!(
            first.config["tests"].as_array().unwrap().len(),
            second.config["tests"].as_array().unwrap().len()
        );
        assert_eq!(
            store.get_suite(&suite.id).await.unwrap().unwrap().config["tests"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }
}
