//! Composio event triggers — fire an agent when a Composio event arrives.
//!
//! A user attaches a Composio trigger (e.g. `SLACK_CHANNEL_MESSAGE_RECEIVED`,
//! `GITHUB_COMMIT_EVENT`) to an agent. We register a **trigger instance** with
//! Composio (`POST /api/v3.1/trigger_instances/{slug}/upsert`) and store the
//! agent↔trigger mapping. When the event fires, Composio delivers it to a
//! webhook; Core's `POST /api/composio/webhook` looks up the matching
//! subscription(s) and runs the agent with a prompt built from the payload.
//!
//! Placement (Core vs Gateway, CLAUDE.md §1): deciding *what runs* in response to
//! an event is orchestration → Core. The Composio key/registry is the user's own.
//!
//! ## Delivery constraint (important)
//!
//! Composio triggers are **webhook-delivered** — there is no event-pull API. A
//! local Core bound to `127.0.0.1` is not publicly reachable, so the webhook will
//! not arrive unless Core is exposed at a public URL (Ryu Cloud) or a relay
//! forwards it. Subscriptions still register fine; firing only happens once the
//! webhook can reach `POST /api/composio/webhook`. The mapping/receiver are built
//! so a reachable deployment "just works".

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::OnceLock;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use reqwest::Client;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::RwLock;
use tokio::sync::Mutex;

/// A persisted Composio-trigger subscription. The `target_kind` selects what the
/// fired event runs: `"agent"` (the default, fires `agent_id`) or `"workflow"`
/// (fires the workflow named by `workflow_id`, with the event payload injected as
/// the run's `trigger` state).
#[derive(Clone, Debug, Serialize)]
pub struct TriggerSubscription {
    pub id: String,
    pub agent_id: String,
    pub toolkit: String,
    pub trigger_slug: String,
    pub connected_account_id: String,
    /// Composio's id for the created trigger instance (when it returned one).
    pub composio_trigger_id: Option<String>,
    /// `"agent"` (default, back-compat for existing rows) or `"workflow"`.
    pub target_kind: String,
    /// The workflow id to fire when `target_kind == "workflow"`.
    pub workflow_id: Option<String>,
    pub created_at: String,
}

/// SQLite-backed subscription store. Cheap to clone (`Arc` inside).
#[derive(Clone)]
pub struct ComposioTriggerStore {
    conn: Arc<Mutex<Connection>>,
    http: Client,
}

static GLOBAL: OnceLock<ComposioTriggerStore> = OnceLock::new();

/// Publish the process-global store (set once at startup in `main.rs`).
pub fn set_global(store: ComposioTriggerStore) {
    let _ = GLOBAL.set(store);
}

/// The process-global store, if initialised.
pub fn global() -> Option<&'static ComposioTriggerStore> {
    GLOBAL.get()
}

/// Env var holding the Composio webhook signing secret. The inbound public
/// webhook route authenticates each delivery with Composio's signed
/// id/timestamp/raw-body tuple. Nothing is hardcoded; when unset and no
/// encrypted value exists, the route fails closed.
const WEBHOOK_SECRET_ENV: &str = "COMPOSIO_WEBHOOK_SECRET";

/// The encrypted-at-rest secret-store slot used by the Webhooks companion when
/// an operator does not provide `COMPOSIO_WEBHOOK_SECRET` in the environment.
/// These are public so Core can hydrate the process-local verifier at startup
/// without duplicating the storage key in a second crate.
pub const WEBHOOK_SECRET_STORE_OWNER: &str = "@ryu/webhooks";
pub const WEBHOOK_SECRET_STORE_KEY: &str = WEBHOOK_SECRET_ENV;

/// A process-local copy of the encrypted store value. The verifier is called
/// from public ingress paths that do not carry `ServerState`, so Core hydrates
/// this once at boot and updates it after a successful Webhooks-app write.
static STORED_WEBHOOK_SECRET: OnceLock<RwLock<Option<String>>> = OnceLock::new();

fn stored_webhook_secret() -> &'static RwLock<Option<String>> {
    STORED_WEBHOOK_SECRET.get_or_init(|| RwLock::new(None))
}

/// Install the Webhooks-app secret for the in-process verifier. The value is
/// never logged; the at-rest copy lives in Core's encrypted plugin-secret store.
pub fn set_stored_webhook_secret(secret: Option<String>) {
    if let Ok(mut current) = stored_webhook_secret().write() {
        *current = secret
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
    }
}

/// Return the operator-provided environment secret, if present. Core uses this
/// to make the UI explain why a persisted value cannot override the env source.
pub fn env_webhook_secret() -> Option<String> {
    std::env::var(WEBHOOK_SECRET_ENV)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn stored_webhook_secret_value() -> Option<String> {
    stored_webhook_secret()
        .read()
        .ok()
        .and_then(|current| current.clone())
}

/// The configured webhook signing secret, if any. An explicit environment value
/// wins over the encrypted app-managed value so existing deployments retain the
/// operator-controlled configuration contract.
pub fn webhook_secret() -> Option<String> {
    env_webhook_secret().or_else(stored_webhook_secret_value)
}

/// Constant-time byte comparison (no early return on first mismatch) so the
/// signature check does not leak the secret via timing.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

const COMPOSIO_TRIGGER_MESSAGE_EVENT: &str = "composio.trigger.message";

#[derive(Deserialize)]
struct WebhookSubscriptionList {
    #[serde(default)]
    items: Vec<WebhookSubscription>,
}

#[derive(Deserialize)]
struct WebhookSubscription {
    id: String,
    webhook_url: String,
    version: String,
    #[serde(default)]
    enabled_events: Vec<String>,
    #[serde(default)]
    secret: Option<String>,
}

#[derive(Deserialize)]
struct RotatedWebhookSecret {
    secret: String,
}

/// Compute HMAC-SHA256(key, message) through the shared crypto primitive.
fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
    let encoded = ryu_crypto::hmac_sha256_hex(key, message);
    let decoded = hex::decode(encoded).expect("shared HMAC must be valid hex");
    decoded
        .try_into()
        .expect("SHA-256 HMAC must always be 32 bytes")
}

/// Compute HMAC-SHA256(key, message) and return it lowercase-hex encoded. This is
/// the legacy per-workflow webhook format; Composio uses base64 over a signed
/// id/timestamp/body tuple instead.
pub fn hmac_sha256_hex(key: &[u8], message: &[u8]) -> String {
    ryu_crypto::hmac_sha256_hex(key, message)
}

const COMPOSIO_WEBHOOK_TOLERANCE_SECS: u64 = 300;

/// Verify a Composio webhook signature, FAIL CLOSED. Current Composio
/// deliveries sign `{webhook-id}.{webhook-timestamp}.{rawBody}` and send one or
/// more space-separated `v1,<base64>` values in `webhook-signature`. All three
/// headers are required, and timestamps outside the 300-second replay window are
/// rejected before comparing the digest.
///
/// `raw_body` MUST be the exact bytes received (not a re-serialized JSON value),
/// otherwise the HMAC will never match.
pub fn verify_webhook_signature(
    raw_body: &[u8],
    webhook_id: Option<&str>,
    webhook_timestamp: Option<&str>,
    signature_header: Option<&str>,
) -> bool {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0);
    verify_webhook_signature_at(
        raw_body,
        webhook_id,
        webhook_timestamp,
        signature_header,
        now,
    )
}

fn verify_webhook_signature_at(
    raw_body: &[u8],
    webhook_id: Option<&str>,
    webhook_timestamp: Option<&str>,
    signature_header: Option<&str>,
    now: i64,
) -> bool {
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    let Some(secret) = webhook_secret() else {
        return false;
    };
    let Some(id) = webhook_id.map(str::trim).filter(|value| !value.is_empty()) else {
        return false;
    };
    let Some(timestamp) = webhook_timestamp
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return false;
    };
    let Ok(timestamp_seconds) = timestamp.parse::<i64>() else {
        return false;
    };
    if timestamp_seconds < 0 || now.abs_diff(timestamp_seconds) > COMPOSIO_WEBHOOK_TOLERANCE_SECS {
        return false;
    }
    let Some(header) = signature_header.map(str::trim).filter(|s| !s.is_empty()) else {
        return false;
    };

    let mut signing_message = Vec::with_capacity(id.len() + timestamp.len() + raw_body.len() + 2);
    signing_message.extend_from_slice(id.as_bytes());
    signing_message.push(b'.');
    signing_message.extend_from_slice(timestamp.as_bytes());
    signing_message.push(b'.');
    signing_message.extend_from_slice(raw_body);
    let expected = hmac_sha256(secret.as_bytes(), &signing_message);

    header.split_whitespace().any(|token| {
        let Some(candidate) = token.strip_prefix("v1,") else {
            return false;
        };
        let Ok(decoded) = STANDARD.decode(candidate) else {
            return false;
        };
        constant_time_eq(&decoded, &expected)
    })
}

/// Verify an inbound **per-workflow** webhook POST against a trigger-specific
/// secret (`WorkflowTrigger::Webhook.secret`), independent of the global Composio
/// webhook secret. This legacy route accepts `v1,<hex>`, `sha256=<hex>`, or a
/// bare hex digest over the raw body. An absent header or mismatch is rejected.
/// The caller must also refuse to fire when the trigger has no secret.
pub fn verify_workflow_webhook_signature(
    secret: &str,
    raw_body: &[u8],
    signature_header: Option<&str>,
) -> bool {
    let Some(header) = signature_header.map(str::trim).filter(|s| !s.is_empty()) else {
        return false;
    };
    let expected_hex = hmac_sha256_hex(secret.as_bytes(), raw_body);
    header.split_whitespace().any(|token| {
        let candidate = token
            .rsplit(',')
            .next()
            .unwrap_or(token)
            .trim_start_matches("sha256=");
        constant_time_eq(candidate.as_bytes(), expected_hex.as_bytes())
    })
}

impl ComposioTriggerStore {
    /// Open (creating if needed) the triggers DB at `db_path` (Core passes
    /// `~/.ryu/composio-triggers.db`; the data dir is a kernel concern, inverted
    /// so this crate never reaches into `apps/core`).
    pub fn open(http: Client, db_path: PathBuf) -> Result<Self> {
        let path = db_path;
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).context("creating ~/.ryu for composio-triggers.db")?;
        }
        let conn = Connection::open(&path)
            .with_context(|| format!("opening composio-triggers db at {}", path.display()))?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS subscriptions (
                 id                   TEXT PRIMARY KEY,
                 agent_id             TEXT NOT NULL,
                 toolkit              TEXT NOT NULL,
                 trigger_slug         TEXT NOT NULL,
                 connected_account_id TEXT NOT NULL,
                 composio_trigger_id  TEXT,
                 target_kind          TEXT NOT NULL DEFAULT 'agent',
                 workflow_id          TEXT,
                 created_at           TEXT NOT NULL
             );",
        )
        .context("running composio-triggers schema migration")?;
        // Guarded migration for DBs created before target_kind/workflow_id
        // existed: CREATE TABLE IF NOT EXISTS won't add columns to a live table,
        // and a bare ALTER throws "duplicate column" on the second boot, so only
        // ALTER the columns that are actually missing. Existing rows default to
        // the agent target.
        Self::add_missing_columns(&conn)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            http,
        })
    }

    /// Add the `target_kind`/`workflow_id` columns to a pre-existing table when
    /// they are missing. Idempotent (safe to run on every boot).
    fn add_missing_columns(conn: &Connection) -> Result<()> {
        let mut existing: std::collections::HashSet<String> = std::collections::HashSet::new();
        {
            let mut stmt = conn.prepare("PRAGMA table_info(subscriptions)")?;
            let names = stmt.query_map([], |row| row.get::<_, String>(1))?;
            for name in names {
                existing.insert(name?);
            }
        }
        if !existing.contains("target_kind") {
            conn.execute(
                "ALTER TABLE subscriptions ADD COLUMN target_kind TEXT NOT NULL DEFAULT 'agent'",
                [],
            )?;
        }
        if !existing.contains("workflow_id") {
            conn.execute("ALTER TABLE subscriptions ADD COLUMN workflow_id TEXT", [])?;
        }
        Ok(())
    }

    /// Create or update the authenticated Composio project's single outbound
    /// webhook subscription. The subscription is always upgraded to V3 and
    /// `composio.trigger.message` is added without removing event types the user
    /// already enabled. Returns the signing secret so Core can place it in the
    /// encrypted plugin-secret store before any trigger instance is created.
    pub async fn reconcile_webhook_subscription(&self, webhook_url: &str) -> Result<String> {
        let key = crate::auth::key()
            .ok_or_else(|| anyhow!("Composio API key not set (Settings → Integrations)"))?;
        let collection_url = format!("{}/webhook_subscriptions", crate::catalog::base_url());
        let response = self
            .http
            .get(&collection_url)
            .header("x-api-key", &key)
            .timeout(Duration::from_secs(20))
            .send()
            .await
            .map_err(|error| anyhow!("listing Composio webhook subscriptions failed: {error}"))?;
        let status = response.status();
        if !status.is_success() {
            return Err(anyhow!(
                "listing Composio webhook subscriptions returned {status}"
            ));
        }
        let subscriptions: WebhookSubscriptionList = response
            .json()
            .await
            .context("decoding Composio webhook subscriptions response")?;
        if subscriptions.items.len() > 1 {
            return Err(anyhow!(
                "Composio returned multiple project webhook subscriptions; refusing to update an ambiguous destination"
            ));
        }

        let Some(existing) = subscriptions.items.into_iter().next() else {
            let response = self
                .http
                .post(&collection_url)
                .header("x-api-key", &key)
                .header("content-type", "application/json")
                .timeout(Duration::from_secs(20))
                .json(&json!({
                    "webhook_url": webhook_url,
                    "enabled_events": [COMPOSIO_TRIGGER_MESSAGE_EVENT],
                    "version": "V3",
                }))
                .send()
                .await
                .map_err(|error| {
                    anyhow!("creating Composio webhook subscription failed: {error}")
                })?;
            let status = response.status();
            if !status.is_success() {
                return Err(anyhow!(
                    "creating Composio webhook subscription returned {status}"
                ));
            }
            let created: WebhookSubscription = response
                .json()
                .await
                .context("decoding created Composio webhook subscription")?;
            return required_webhook_secret(created.secret);
        };

        let mut enabled_events = existing.enabled_events.clone();
        if !enabled_events
            .iter()
            .any(|event| event == COMPOSIO_TRIGGER_MESSAGE_EVENT)
        {
            enabled_events.push(COMPOSIO_TRIGGER_MESSAGE_EVENT.to_owned());
        }
        enabled_events.sort();
        enabled_events.dedup();

        let drifted = existing.webhook_url != webhook_url
            || existing.version != "V3"
            || enabled_events != existing.enabled_events;
        // Current API responses include the secret, while migrated/older
        // subscriptions may omit it except at creation or rotation. Reuse the
        // already-hydrated local value in that case so adding a second trigger
        // does not rotate a still-valid project secret.
        let mut secret = existing
            .secret
            .or_else(stored_webhook_secret_value)
            .or_else(env_webhook_secret);
        if drifted {
            let item_url = format!("{collection_url}/{}", existing.id);
            let response = self
                .http
                .patch(&item_url)
                .header("x-api-key", &key)
                .header("content-type", "application/json")
                .timeout(Duration::from_secs(20))
                .json(&json!({
                    "webhook_url": webhook_url,
                    "enabled_events": enabled_events,
                    "version": "V3",
                }))
                .send()
                .await
                .map_err(|error| {
                    anyhow!("updating Composio webhook subscription failed: {error}")
                })?;
            let status = response.status();
            if !status.is_success() {
                return Err(anyhow!(
                    "updating Composio webhook subscription returned {status}"
                ));
            }
            let updated: WebhookSubscription = response
                .json()
                .await
                .context("decoding updated Composio webhook subscription")?;
            secret = updated.secret.or(secret);
        }

        if let Some(secret) = normalized_secret(secret) {
            return Ok(secret);
        }

        // Some Composio API versions return a subscription's secret only when it
        // is created or rotated. Rotate only when no usable secret was returned,
        // otherwise a normal reconcile never changes credentials.
        let rotate_url = format!("{collection_url}/{}/rotate_secret", existing.id);
        let response = self
            .http
            .post(&rotate_url)
            .header("x-api-key", key)
            .timeout(Duration::from_secs(20))
            .send()
            .await
            .map_err(|error| anyhow!("rotating Composio webhook secret failed: {error}"))?;
        let status = response.status();
        if !status.is_success() {
            return Err(anyhow!(
                "rotating Composio webhook secret returned {status}"
            ));
        }
        let rotated: RotatedWebhookSecret = response
            .json()
            .await
            .context("decoding rotated Composio webhook secret")?;
        required_webhook_secret(Some(rotated.secret))
    }

    /// Register a trigger instance with Composio and persist an **agent**-target
    /// mapping. Kept for existing callers; delegates to [`Self::subscribe_target`].
    pub async fn subscribe(
        &self,
        agent_id: &str,
        toolkit: &str,
        trigger_slug: &str,
        connected_account_id: &str,
        config: Value,
    ) -> Result<TriggerSubscription> {
        self.subscribe_target(
            "agent",
            agent_id,
            None,
            toolkit,
            trigger_slug,
            connected_account_id,
            config,
        )
        .await
    }

    /// Register a trigger instance with Composio and persist a **workflow**-target
    /// mapping. The fired event runs `workflow_id` with the payload injected as
    /// `trigger` state.
    pub async fn subscribe_workflow(
        &self,
        workflow_id: &str,
        toolkit: &str,
        trigger_slug: &str,
        connected_account_id: &str,
        config: Value,
    ) -> Result<TriggerSubscription> {
        self.subscribe_target(
            "workflow",
            "",
            Some(workflow_id),
            toolkit,
            trigger_slug,
            connected_account_id,
            config,
        )
        .await
    }

    /// Shared subscribe implementation for either target kind.
    #[allow(clippy::too_many_arguments)]
    async fn subscribe_target(
        &self,
        target_kind: &str,
        agent_id: &str,
        workflow_id: Option<&str>,
        toolkit: &str,
        trigger_slug: &str,
        connected_account_id: &str,
        config: Value,
    ) -> Result<TriggerSubscription> {
        let key = crate::auth::key()
            .ok_or_else(|| anyhow!("Composio API key not set (Settings → Integrations)"))?;
        let url = format!(
            "{}/trigger_instances/{}/upsert",
            crate::catalog::base_url(),
            trigger_slug
        );
        let resp = self
            .http
            .post(&url)
            .header("x-api-key", key)
            .header("content-type", "application/json")
            .timeout(Duration::from_secs(20))
            .json(&json!({
                "connected_account_id": connected_account_id,
                "trigger_config": config,
            }))
            .send()
            .await
            .map_err(|e| anyhow!("Composio trigger upsert failed: {e}"))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(anyhow!("Composio trigger upsert {status}: {body}"));
        }
        let body: Value = resp.json().await.unwrap_or(Value::Null);
        // Composio returns the instance id under one of these keys depending on
        // API version — read defensively.
        let composio_trigger_id = ["trigger_id", "triggerId", "id", "nano_id"]
            .iter()
            .find_map(|k| body.get(*k).and_then(Value::as_str))
            .map(str::to_owned);

        let id = format!("ctrig_{}", uuid::Uuid::new_v4().simple());
        let created_at = chrono::Utc::now().to_rfc3339();
        {
            let conn = self.conn.lock().await;
            conn.execute(
                "INSERT INTO subscriptions
                    (id, agent_id, toolkit, trigger_slug, connected_account_id,
                     composio_trigger_id, target_kind, workflow_id, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    id,
                    agent_id,
                    toolkit,
                    trigger_slug,
                    connected_account_id,
                    composio_trigger_id,
                    target_kind,
                    workflow_id,
                    created_at,
                ],
            )?;
        }
        Ok(TriggerSubscription {
            id,
            agent_id: agent_id.to_owned(),
            toolkit: toolkit.to_owned(),
            trigger_slug: trigger_slug.to_owned(),
            connected_account_id: connected_account_id.to_owned(),
            composio_trigger_id,
            target_kind: target_kind.to_owned(),
            workflow_id: workflow_id.map(str::to_owned),
            created_at,
        })
    }

    /// All subscriptions, newest first.
    pub async fn list(&self) -> Result<Vec<TriggerSubscription>> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare(
            "SELECT id, agent_id, toolkit, trigger_slug, connected_account_id,
                    composio_trigger_id, target_kind, workflow_id, created_at
             FROM subscriptions ORDER BY created_at DESC",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(TriggerSubscription {
                    id: row.get(0)?,
                    agent_id: row.get(1)?,
                    toolkit: row.get(2)?,
                    trigger_slug: row.get(3)?,
                    connected_account_id: row.get(4)?,
                    composio_trigger_id: row.get(5)?,
                    target_kind: row.get(6)?,
                    workflow_id: row.get(7)?,
                    created_at: row.get(8)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Best-effort remote teardown of a Composio trigger *instance* so a removed
    /// subscription stops the remote from firing into the void. Never fails the
    /// caller: a missing key, an absent instance id, or an API error are logged
    /// and swallowed (the local row is still deleted by the caller).
    async fn remote_disable(&self, composio_trigger_id: Option<&str>) {
        let Some(trigger_id) = composio_trigger_id else {
            return;
        };
        let Some(key) = crate::auth::key() else {
            return;
        };
        let url = format!(
            "{}/trigger_instances/manage/{}",
            crate::catalog::base_url(),
            trigger_id
        );
        let resp = self
            .http
            .delete(&url)
            .header("x-api-key", key)
            .timeout(Duration::from_secs(20))
            .send()
            .await;
        match resp {
            Ok(r) if r.status().is_success() => {}
            Ok(r) => {
                let status = r.status();
                tracing::warn!(trigger = %trigger_id, %status, "composio trigger remote disable returned non-success");
            }
            Err(e) => {
                tracing::warn!(trigger = %trigger_id, error = %e, "composio trigger remote disable failed");
            }
        }
    }

    /// Delete a subscription. Returns `false` when no row matched. Best-effort
    /// remote teardown: before removing the local row we ask Composio to disable
    /// the remote trigger instance so it stops firing into the void.
    pub async fn delete(&self, id: &str) -> Result<bool> {
        // Resolve the remote instance id first (before we drop the row).
        let trigger_id: Option<String> = {
            let conn = self.conn.lock().await;
            conn.query_row(
                "SELECT composio_trigger_id FROM subscriptions WHERE id = ?1",
                params![id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten()
        };
        self.remote_disable(trigger_id.as_deref()).await;
        let conn = self.conn.lock().await;
        let n = conn.execute("DELETE FROM subscriptions WHERE id = ?1", params![id])?;
        Ok(n > 0)
    }

    /// All workflow-target subscriptions for a given workflow id.
    pub async fn list_for_workflow(&self, workflow_id: &str) -> Vec<TriggerSubscription> {
        self.list()
            .await
            .unwrap_or_default()
            .into_iter()
            .filter(|s| {
                s.target_kind == "workflow" && s.workflow_id.as_deref() == Some(workflow_id)
            })
            .collect()
    }

    /// Delete every workflow-target subscription for a workflow. Returns the
    /// number of rows removed. Used by reconcile + workflow delete. Best-effort
    /// remote teardown: each removed instance is disabled on Composio first so it
    /// stops firing into the void (an orphaned remote trigger whose local mapping
    /// is gone).
    pub async fn delete_for_workflow(&self, workflow_id: &str) -> Result<usize> {
        // Disable the remote instances before dropping the local rows.
        for sub in self.list_for_workflow(workflow_id).await {
            self.remote_disable(sub.composio_trigger_id.as_deref())
                .await;
        }
        let conn = self.conn.lock().await;
        let n = conn.execute(
            "DELETE FROM subscriptions WHERE target_kind = 'workflow' AND workflow_id = ?1",
            params![workflow_id],
        )?;
        Ok(n)
    }

    /// Subscriptions matching a fired event, by Composio trigger id (preferred) or
    /// trigger slug (fallback).
    async fn matching(
        &self,
        trigger_id: Option<&str>,
        slug: Option<&str>,
    ) -> Vec<TriggerSubscription> {
        let all = self.list().await.unwrap_or_default();
        all.into_iter()
            .filter(|s| {
                trigger_id.is_some_and(|t| s.composio_trigger_id.as_deref() == Some(t))
                    || slug.is_some_and(|sl| s.trigger_slug.eq_ignore_ascii_case(sl))
            })
            .collect()
    }

    /// Handle an inbound Composio webhook payload: find matching subscriptions and
    /// fire each bound target. An `agent` target runs the configured agent with a
    /// prompt built from the event; a `workflow` target runs the workflow with the
    /// raw event payload injected as `trigger` state. Returns how many runs were
    /// started.
    pub async fn handle_webhook(&self, payload: &Value) -> usize {
        // V3 (the current default) nests trigger identity under `metadata`.
        // Retain the flat aliases as a fallback for existing V1/V2 subscriptions.
        let metadata = payload.get("metadata").and_then(Value::as_object);
        let metadata_string = |key: &str| {
            metadata
                .and_then(|value| value.get(key))
                .and_then(Value::as_str)
        };
        let trigger_id = ["trigger_id", "triggerId", "id", "nano_id"]
            .iter()
            .find_map(|key| metadata_string(key))
            .or_else(|| {
                ["trigger_id", "triggerId", "nano_id"]
                    .iter()
                    .find_map(|key| payload.get(*key).and_then(Value::as_str))
            });
        let slug = ["trigger_slug", "triggerName", "type", "trigger_name"]
            .iter()
            .find_map(|key| metadata_string(key))
            .or_else(|| {
                ["trigger_slug", "triggerName", "type", "trigger_name"]
                    .iter()
                    .find_map(|key| payload.get(*key).and_then(Value::as_str))
            });

        let subs = self.matching(trigger_id, slug).await;
        let mut fired = 0;
        for sub in subs {
            if sub.target_kind == "workflow" {
                let Some(workflow_id) = sub.workflow_id.as_deref() else {
                    tracing::warn!(sub = %sub.id, "workflow trigger missing workflow_id");
                    continue;
                };
                let payload_json = serde_json::to_string(payload).unwrap_or_default();
                let run = match crate::host::host() {
                    Ok(h) => h.run_workflow_for_trigger(workflow_id, &payload_json).await,
                    Err(e) => Err(e),
                };
                match run {
                    Ok(run_id) => {
                        tracing::info!(
                            workflow = %workflow_id,
                            trigger = %sub.trigger_slug,
                            run = %run_id,
                            "composio trigger fired workflow run"
                        );
                        fired += 1;
                    }
                    Err(e) => {
                        tracing::warn!(workflow = %workflow_id, error = %e, "composio trigger workflow run failed");
                    }
                }
                continue;
            }

            let prompt = format!(
                "A Composio `{}` event fired for the `{}` integration. Handle it. \
                 Event payload (JSON):\n\n{}",
                sub.trigger_slug,
                sub.toolkit,
                serde_json::to_string_pretty(payload).unwrap_or_default()
            );
            let run = match crate::host::host() {
                Ok(h) => h.run_agent(&sub.agent_id, &prompt).await,
                Err(e) => Err(e),
            };
            match run {
                Ok(run_id) => {
                    tracing::info!(
                        agent = %sub.agent_id,
                        trigger = %sub.trigger_slug,
                        run = %run_id,
                        "composio trigger fired agent run"
                    );
                    fired += 1;
                }
                Err(e) => {
                    tracing::warn!(agent = %sub.agent_id, error = %e, "composio trigger run failed");
                }
            }
        }
        fired
    }
}

fn normalized_secret(secret: Option<String>) -> Option<String> {
    secret
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn required_webhook_secret(secret: Option<String>) -> Result<String> {
    normalized_secret(secret)
        .ok_or_else(|| anyhow!("Composio webhook subscription response omitted the signing secret"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Serializes the two tests that mutate the process-global
    /// `COMPOSIO_WEBHOOK_SECRET` env var. cargo runs tests in one process in
    /// parallel, so without this one can clear the secret while the other has set
    /// it and is mid-verify. Poison-tolerant.
    static WEBHOOK_SECRET_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    fn lock_webhook_secret() -> std::sync::MutexGuard<'static, ()> {
        WEBHOOK_SECRET_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner())
    }

    #[test]
    fn hmac_matches_known_vector() {
        // RFC 4231 Test Case 2: key="Jefe", data="what do ya want for nothing?".
        let mac = hmac_sha256_hex(b"Jefe", b"what do ya want for nothing?");
        assert_eq!(
            mac,
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
        );
    }

    #[test]
    fn verify_rejects_when_secret_unset() {
        // Serialize against the other webhook-secret test and restore on exit so
        // neither reads the other's transient value.
        let _lock = lock_webhook_secret();
        let prev = std::env::var(WEBHOOK_SECRET_ENV).ok();
        std::env::remove_var(WEBHOOK_SECRET_ENV);
        assert!(!verify_webhook_signature_at(
            b"{}",
            Some("msg_test"),
            Some("1735689600"),
            Some("v1,deadbeef"),
            1_735_689_600,
        ));
        match prev {
            Some(v) => std::env::set_var(WEBHOOK_SECRET_ENV, v),
            None => std::env::remove_var(WEBHOOK_SECRET_ENV),
        }
    }

    #[test]
    fn verify_accepts_valid_and_rejects_tampered() {
        let _lock = lock_webhook_secret();
        let prev = std::env::var(WEBHOOK_SECRET_ENV).ok();
        std::env::set_var(WEBHOOK_SECRET_ENV, "shhh");
        let body = b"hello";
        let id = "msg_test";
        let timestamp = "1735689600";
        let signature = "v1,/YUk2Hs+/BGr9UgXO4Z1HlNIb79STp+msEPmVUihovw=";
        assert!(verify_webhook_signature_at(
            body,
            Some(id),
            Some(timestamp),
            Some(signature),
            1_735_689_700,
        ));
        // Every signed component, the v1 format, and the replay window are
        // mandatory under Composio's current contract.
        assert!(!verify_webhook_signature_at(
            body,
            Some("msg_other"),
            Some(timestamp),
            Some(signature),
            1_735_689_700,
        ));
        assert!(!verify_webhook_signature_at(
            body,
            Some(id),
            Some(timestamp),
            Some(signature),
            1_735_690_000,
        ));
        assert!(!verify_webhook_signature_at(
            body,
            Some(id),
            Some(timestamp),
            Some("/YUk2Hs+/BGr9UgXO4Z1HlNIb79STp+msEPmVUihovw="),
            1_735_689_700,
        ));
        assert!(!verify_webhook_signature_at(
            b"tampered",
            Some(id),
            Some(timestamp),
            Some(signature),
            1_735_689_700,
        ));
        match prev {
            Some(v) => std::env::set_var(WEBHOOK_SECRET_ENV, v),
            None => std::env::remove_var(WEBHOOK_SECRET_ENV),
        }
    }

    #[test]
    fn workflow_webhook_verify_uses_per_trigger_secret() {
        let body = br#"{"event":"deploy"}"#;
        let sig = hmac_sha256_hex(b"per-wf-secret", body);
        // Correct per-trigger secret + any accepted spelling verifies.
        assert!(verify_workflow_webhook_signature(
            "per-wf-secret",
            body,
            Some(&sig)
        ));
        assert!(verify_workflow_webhook_signature(
            "per-wf-secret",
            body,
            Some(&format!("sha256={sig}"))
        ));
        // A different secret, a wrong signature, an absent header, and a mutated
        // body all reject (fail-closed, independent of the global Composio secret).
        assert!(!verify_workflow_webhook_signature(
            "other",
            body,
            Some(&sig)
        ));
        assert!(!verify_workflow_webhook_signature(
            "per-wf-secret",
            body,
            Some("00")
        ));
        assert!(!verify_workflow_webhook_signature(
            "per-wf-secret",
            body,
            None
        ));
        assert!(!verify_workflow_webhook_signature(
            "per-wf-secret",
            br#"{"event":"other"}"#,
            Some(&sig)
        ));
    }

    // --- Store + webhook-dispatch tests ---------------------------------------
    //
    // The trigger store's `subscribe*` path is the ONE composio HTTP leg reachable
    // from a hermetic loopback: it builds its URL from the *unvalidated*
    // `catalog::base_url()` (unlike catalog/connect/execute, which pin https + an
    // allowlisted host and so cannot be pointed at a plaintext mock). We drive it
    // end-to-end against a raw `std::net::TcpListener` (the sibling `core/usage`
    // idiom), a temp SQLite DB, and a set-once mock `ComposioHost`.

    use std::io::{Read, Write};

    /// Records every host fan-out. The `ComposioHost` slot is a set-once
    /// `OnceLock`, so a single process-global mock + call log serves the whole
    /// binary; the webhook test that uses it holds `test_env_lock` for its whole
    /// body, so there is no cross-test race on this log.
    static HOST_CALLS: std::sync::Mutex<Vec<(String, String)>> = std::sync::Mutex::new(Vec::new());

    struct RecordingHost;

    #[async_trait::async_trait]
    impl crate::host::ComposioHost for RecordingHost {
        async fn run_workflow_for_trigger(
            &self,
            workflow_id: &str,
            payload_json: &str,
        ) -> Result<String> {
            HOST_CALLS
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .push((format!("workflow:{workflow_id}"), payload_json.to_string()));
            if workflow_id == "FAIL-WF" {
                return Err(anyhow!("simulated workflow failure"));
            }
            Ok(format!("run_wf_{workflow_id}"))
        }

        async fn run_agent(&self, agent_id: &str, prompt: &str) -> Result<String> {
            HOST_CALLS
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .push((format!("agent:{agent_id}"), prompt.to_string()));
            if agent_id == "FAIL-AGENT" {
                return Err(anyhow!("simulated agent failure"));
            }
            Ok(format!("run_ag_{agent_id}"))
        }
    }

    fn host_calls() -> Vec<(String, String)> {
        HOST_CALLS.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
    fn clear_host_calls() {
        HOST_CALLS.lock().unwrap_or_else(|e| e.into_inner()).clear();
    }

    /// True once the buffer holds a full HTTP request (headers + declared body).
    fn request_complete(buf: &[u8]) -> bool {
        let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") else {
            return false;
        };
        let head = String::from_utf8_lossy(&buf[..pos]).to_ascii_lowercase();
        let content_length = head
            .lines()
            .find_map(|l| l.strip_prefix("content-length:"))
            .and_then(|v| v.trim().parse::<usize>().ok())
            .unwrap_or(0);
        buf.len() - (pos + 4) >= content_length
    }

    /// A hermetic loopback HTTP/1.1 server that serves `status_line` + `body` to
    /// every request on a detached thread. Returns its `http://127.0.0.1:port`
    /// base (no trailing slash) to point `COMPOSIO_BASE_URL` at.
    fn spawn_mock(status_line: &'static str, body: String) -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind loopback");
        let addr = listener.local_addr().expect("addr");
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { break };
                let _ = stream.set_read_timeout(Some(Duration::from_millis(300)));
                // Drain the request (headers + body) so the client's write side
                // completes before we reply and close (avoids a RST).
                let mut req: Vec<u8> = Vec::new();
                let mut tmp = [0u8; 2048];
                loop {
                    match stream.read(&mut tmp) {
                        Ok(0) => break,
                        Ok(n) => {
                            req.extend_from_slice(&tmp[..n]);
                            if request_complete(&req) {
                                break;
                            }
                        }
                        Err(_) => break, // read timeout / would-block
                    }
                }
                let response = format!(
                    "HTTP/1.1 {status_line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
            }
        });
        format!("http://{addr}")
    }

    fn spawn_mock_sequence(
        responses: Vec<(&'static str, String)>,
    ) -> (String, std::sync::Arc<std::sync::Mutex<Vec<String>>>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind loopback");
        let addr = listener.local_addr().expect("addr");
        let requests = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let recorded = std::sync::Arc::clone(&requests);
        std::thread::spawn(move || {
            for ((status_line, body), stream) in responses.into_iter().zip(listener.incoming()) {
                let Ok(mut stream) = stream else { break };
                let _ = stream.set_read_timeout(Some(Duration::from_millis(300)));
                let mut request = Vec::new();
                let mut chunk = [0_u8; 2048];
                loop {
                    match stream.read(&mut chunk) {
                        Ok(0) => break,
                        Ok(read) => {
                            request.extend_from_slice(&chunk[..read]);
                            if request_complete(&request) {
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }
                recorded
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .push(String::from_utf8_lossy(&request).into_owned());
                let response = format!(
                    "HTTP/1.1 {status_line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
            }
        });
        (format!("http://{addr}"), requests)
    }

    /// Snapshot of the shared env this suite mutates, restored on drop-in.
    fn base_url_snapshot() -> Option<String> {
        std::env::var("COMPOSIO_BASE_URL").ok()
    }
    fn restore_env(prev_base: Option<String>) {
        // Clear the key cache we set and put COMPOSIO_BASE_URL back.
        crate::auth::set_key("");
        match prev_base {
            Some(v) => std::env::set_var("COMPOSIO_BASE_URL", v),
            None => std::env::remove_var("COMPOSIO_BASE_URL"),
        }
    }

    async fn temp_store() -> (ComposioTriggerStore, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("tempdir");
        let db = dir.path().join("composio-triggers.db");
        let store = ComposioTriggerStore::open(Client::new(), db).expect("open store");
        (store, dir)
    }

    #[tokio::test]
    async fn subscribe_persists_agent_target_and_lists_newest_first() {
        let _lock = crate::auth::test_env_lock();
        let prev = base_url_snapshot();
        let base = spawn_mock("200 OK", r#"{"trigger_id":"trig_abc"}"#.to_string());
        crate::auth::set_key("comp_key");
        std::env::set_var("COMPOSIO_BASE_URL", &base);

        let (store, _dir) = temp_store().await;
        assert!(store.list().await.unwrap().is_empty());

        let sub = store
            .subscribe(
                "agent-1",
                "slack",
                "SLACK_MSG",
                "ca_1",
                json!({ "channel": "C1" }),
            )
            .await
            .expect("subscribe");
        assert_eq!(sub.agent_id, "agent-1");
        assert_eq!(sub.toolkit, "slack");
        assert_eq!(sub.trigger_slug, "SLACK_MSG");
        assert_eq!(sub.target_kind, "agent");
        assert!(sub.workflow_id.is_none());
        // The instance id is parsed defensively from the upsert response.
        assert_eq!(sub.composio_trigger_id.as_deref(), Some("trig_abc"));
        assert!(sub.id.starts_with("ctrig_"));

        let all = store.list().await.unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].id, sub.id);
        restore_env(prev);
    }

    #[tokio::test]
    async fn subscribe_errors_on_upstream_failure_and_persists_nothing() {
        let _lock = crate::auth::test_env_lock();
        let prev = base_url_snapshot();
        let base = spawn_mock("400 Bad Request", r#"{"error":"bad config"}"#.to_string());
        crate::auth::set_key("comp_key");
        std::env::set_var("COMPOSIO_BASE_URL", &base);

        let (store, _dir) = temp_store().await;
        let err = store
            .subscribe("agent-1", "slack", "SLACK_MSG", "ca_1", json!({}))
            .await
            .expect_err("upstream 400 must surface");
        assert!(err.to_string().contains("trigger upsert"));
        // A failed upsert never writes a row.
        assert!(store.list().await.unwrap().is_empty());
        restore_env(prev);
    }

    #[tokio::test]
    async fn subscribe_requires_a_key() {
        let _lock = crate::auth::test_env_lock();
        let prev_r = std::env::var("RYU_COMPOSIO_API_KEY").ok();
        let prev_c = std::env::var("COMPOSIO_API_KEY").ok();
        crate::auth::set_key("");
        std::env::remove_var("RYU_COMPOSIO_API_KEY");
        std::env::remove_var("COMPOSIO_API_KEY");

        let (store, _dir) = temp_store().await;
        let err = store
            .subscribe("agent-1", "slack", "SLACK_MSG", "ca_1", json!({}))
            .await
            .expect_err("no key must error before HTTP");
        assert!(err.to_string().contains("API key not set"));

        match prev_r {
            Some(v) => std::env::set_var("RYU_COMPOSIO_API_KEY", v),
            None => std::env::remove_var("RYU_COMPOSIO_API_KEY"),
        }
        match prev_c {
            Some(v) => std::env::set_var("COMPOSIO_API_KEY", v),
            None => std::env::remove_var("COMPOSIO_API_KEY"),
        }
    }

    #[tokio::test]
    async fn delete_reports_match_and_removes_row() {
        let _lock = crate::auth::test_env_lock();
        let prev = base_url_snapshot();
        // 200 for the upsert AND the best-effort remote-disable DELETE.
        let base = spawn_mock("200 OK", r#"{"trigger_id":"trig_del"}"#.to_string());
        crate::auth::set_key("comp_key");
        std::env::set_var("COMPOSIO_BASE_URL", &base);

        let (store, _dir) = temp_store().await;
        let sub = store
            .subscribe("agent-x", "github", "GH_PUSH", "ca_9", json!({}))
            .await
            .unwrap();

        // Deleting a non-existent id reports false and removes nothing.
        assert!(!store.delete("ctrig_missing").await.unwrap());
        assert_eq!(store.list().await.unwrap().len(), 1);

        // Deleting the real row reports true (and best-effort-disables remotely).
        assert!(store.delete(&sub.id).await.unwrap());
        assert!(store.list().await.unwrap().is_empty());
        restore_env(prev);
    }

    #[tokio::test]
    async fn workflow_subscriptions_filter_and_bulk_delete() {
        let _lock = crate::auth::test_env_lock();
        let prev = base_url_snapshot();
        let base = spawn_mock("200 OK", r#"{"id":"trig_wf"}"#.to_string());
        crate::auth::set_key("comp_key");
        std::env::set_var("COMPOSIO_BASE_URL", &base);

        let (store, _dir) = temp_store().await;
        // Two workflow subs on wf-1, one agent sub, one workflow sub on wf-2.
        store
            .subscribe_workflow("wf-1", "slack", "SLACK_MSG", "ca_1", json!({}))
            .await
            .unwrap();
        store
            .subscribe_workflow("wf-1", "github", "GH_PUSH", "ca_2", json!({}))
            .await
            .unwrap();
        store
            .subscribe("agent-a", "gmail", "MAIL_IN", "ca_3", json!({}))
            .await
            .unwrap();
        store
            .subscribe_workflow("wf-2", "linear", "ISSUE_NEW", "ca_4", json!({}))
            .await
            .unwrap();

        let for_wf1 = store.list_for_workflow("wf-1").await;
        assert_eq!(for_wf1.len(), 2);
        assert!(for_wf1.iter().all(|s| s.target_kind == "workflow"));
        assert!(for_wf1
            .iter()
            .all(|s| s.workflow_id.as_deref() == Some("wf-1")));
        assert!(store.list_for_workflow("does-not-exist").await.is_empty());

        // Bulk delete only wf-1's two rows.
        let removed = store.delete_for_workflow("wf-1").await.unwrap();
        assert_eq!(removed, 2);
        assert!(store.list_for_workflow("wf-1").await.is_empty());
        // The agent sub and wf-2 sub survive.
        assert_eq!(store.list().await.unwrap().len(), 2);
        restore_env(prev);
    }

    #[tokio::test]
    async fn open_migrates_legacy_table_missing_columns() {
        // A DB created before target_kind/workflow_id existed must be ALTERed in
        // place (the guarded migration), not rejected, and its rows default to the
        // agent target.
        let dir = tempfile::tempdir().expect("tempdir");
        let db = dir.path().join("legacy.db");
        {
            let conn = rusqlite::Connection::open(&db).expect("open legacy");
            conn.execute_batch(
                "CREATE TABLE subscriptions (
                     id                   TEXT PRIMARY KEY,
                     agent_id             TEXT NOT NULL,
                     toolkit              TEXT NOT NULL,
                     trigger_slug         TEXT NOT NULL,
                     connected_account_id TEXT NOT NULL,
                     composio_trigger_id  TEXT,
                     created_at           TEXT NOT NULL
                 );",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO subscriptions
                    (id, agent_id, toolkit, trigger_slug, connected_account_id, created_at)
                 VALUES ('old1','ag','slack','SLACK_MSG','ca','2020-01-01T00:00:00Z')",
                [],
            )
            .unwrap();
        }

        let store = ComposioTriggerStore::open(Client::new(), db.clone()).expect("open migrates");
        let rows = store.list().await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "old1");
        assert_eq!(rows[0].target_kind, "agent");
        assert!(rows[0].workflow_id.is_none());

        // Re-opening is idempotent (columns already present → no ALTER, no error).
        let store2 = ComposioTriggerStore::open(Client::new(), db).expect("reopen idempotent");
        assert_eq!(store2.list().await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn handle_webhook_dispatches_agent_and_workflow_and_reports_failures() {
        let _lock = crate::auth::test_env_lock();
        let prev = base_url_snapshot();
        let base = spawn_mock("200 OK", r#"{"trigger_id":"trig_hook"}"#.to_string());
        crate::auth::set_key("comp_key");
        std::env::set_var("COMPOSIO_BASE_URL", &base);
        crate::host::set_global_host(std::sync::Arc::new(RecordingHost));

        let (store, _dir) = temp_store().await;
        store
            .subscribe("agent-1", "slack", "SLACK_MSG", "ca_1", json!({}))
            .await
            .unwrap();
        store
            .subscribe_workflow("wf-1", "github", "GH_PUSH", "ca_2", json!({}))
            .await
            .unwrap();
        store
            .subscribe("FAIL-AGENT", "gmail", "MAIL_IN", "ca_3", json!({}))
            .await
            .unwrap();

        // Agent fire, matched by slug (case-insensitive).
        clear_host_calls();
        let fired = store
            .handle_webhook(&json!({ "trigger_slug": "slack_msg", "payload": { "text": "hi" } }))
            .await;
        assert_eq!(fired, 1);
        let calls = host_calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "agent:agent-1");
        assert!(calls[0].1.contains("SLACK_MSG"));
        assert!(calls[0].1.contains("slack"));

        // Workflow fire, matched by an alternate slug key; payload injected raw.
        clear_host_calls();
        let fired = store
            .handle_webhook(&json!({ "triggerName": "GH_PUSH", "ref": "main" }))
            .await;
        assert_eq!(fired, 1);
        let calls = host_calls();
        assert_eq!(calls[0].0, "workflow:wf-1");
        assert!(calls[0].1.contains("\"ref\":\"main\""));

        // A host failure is swallowed and not counted as fired.
        clear_host_calls();
        let fired = store
            .handle_webhook(&json!({ "trigger_slug": "MAIL_IN" }))
            .await;
        assert_eq!(fired, 0);
        assert_eq!(host_calls()[0].0, "agent:FAIL-AGENT");

        // No matching subscription → nothing fires (no trigger_id, unknown slug).
        clear_host_calls();
        let fired = store
            .handle_webhook(&json!({ "trigger_slug": "UNKNOWN_EVENT" }))
            .await;
        assert_eq!(fired, 0);
        assert!(host_calls().is_empty());

        restore_env(prev);
    }

    #[tokio::test]
    async fn handle_webhook_matches_by_composio_trigger_id() {
        let _lock = crate::auth::test_env_lock();
        let prev = base_url_snapshot();
        let base = spawn_mock("200 OK", r#"{"trigger_id":"trig_unique"}"#.to_string());
        crate::auth::set_key("comp_key");
        std::env::set_var("COMPOSIO_BASE_URL", &base);
        crate::host::set_global_host(std::sync::Arc::new(RecordingHost));

        let (store, _dir) = temp_store().await;
        store
            .subscribe("agent-id-match", "slack", "SLACK_MSG", "ca_1", json!({}))
            .await
            .unwrap();

        // A payload carrying only the Composio trigger id (no slug) still matches.
        clear_host_calls();
        let fired = store
            .handle_webhook(&json!({ "trigger_id": "trig_unique" }))
            .await;
        assert_eq!(fired, 1);
        assert_eq!(host_calls()[0].0, "agent:agent-id-match");
        restore_env(prev);
    }

    #[tokio::test]
    async fn reconcile_webhook_subscription_creates_v3_project_subscription() {
        let _lock = crate::auth::test_env_lock();
        let prev = base_url_snapshot();
        let (base, requests) = spawn_mock_sequence(vec![
            ("200 OK", r#"{"items":[]}"#.to_string()),
            (
                "201 Created",
                r#"{"id":"ws_new","webhook_url":"https://relay.example/api/composio/webhook","version":"V3","enabled_events":["composio.trigger.message"],"secret":"whsec_new"}"#.to_string(),
            ),
        ]);
        crate::auth::set_key("comp_key");
        std::env::set_var("COMPOSIO_BASE_URL", &base);

        let (store, _dir) = temp_store().await;
        let secret = store
            .reconcile_webhook_subscription("https://relay.example/api/composio/webhook")
            .await
            .expect("reconcile");
        assert_eq!(secret, "whsec_new");

        let requests = requests.lock().unwrap_or_else(|error| error.into_inner());
        assert!(requests[0].starts_with("GET /webhook_subscriptions "));
        assert!(requests[1].starts_with("POST /webhook_subscriptions "));
        assert!(requests[1].contains("\"version\":\"V3\""));
        assert!(requests[1].contains("\"enabled_events\":[\"composio.trigger.message\"]"));

        restore_env(prev);
    }

    #[tokio::test]
    async fn reconcile_webhook_subscription_updates_drift_and_preserves_events() {
        let _lock = crate::auth::test_env_lock();
        let prev = base_url_snapshot();
        let (base, requests) = spawn_mock_sequence(vec![
            (
                "200 OK",
                r#"{"items":[{"id":"ws_existing","webhook_url":"https://old.example/hook","version":"V1","enabled_events":["composio.connected_account.expired"],"secret":"whsec_existing"}]}"#.to_string(),
            ),
            (
                "200 OK",
                r#"{"id":"ws_existing","webhook_url":"https://relay.example/api/composio/webhook","version":"V3","enabled_events":["composio.connected_account.expired","composio.trigger.message"],"secret":"whsec_existing"}"#.to_string(),
            ),
        ]);
        crate::auth::set_key("comp_key");
        std::env::set_var("COMPOSIO_BASE_URL", &base);

        let (store, _dir) = temp_store().await;
        let secret = store
            .reconcile_webhook_subscription("https://relay.example/api/composio/webhook")
            .await
            .expect("reconcile");
        assert_eq!(secret, "whsec_existing");

        let requests = requests.lock().unwrap_or_else(|error| error.into_inner());
        assert!(requests[1].starts_with("PATCH /webhook_subscriptions/ws_existing "));
        assert!(requests[1].contains("composio.connected_account.expired"));
        assert!(requests[1].contains("composio.trigger.message"));
        assert!(requests[1].contains("\"version\":\"V3\""));

        restore_env(prev);
    }

    #[tokio::test]
    async fn reconcile_prefers_stored_secret_over_a_stale_environment_override() {
        let _env_lock = crate::auth::test_env_lock();
        let _lock = lock_webhook_secret();
        let prev_base = base_url_snapshot();
        let prev_secret = std::env::var(WEBHOOK_SECRET_ENV).ok();
        let (base, _requests) = spawn_mock_sequence(vec![(
            "200 OK",
            r#"{"items":[{"id":"ws_existing","webhook_url":"https://relay.example/api/composio/webhook","version":"V3","enabled_events":["composio.trigger.message"]}]}"#.to_string(),
        )]);
        crate::auth::set_key("comp_key");
        std::env::set_var("COMPOSIO_BASE_URL", &base);
        std::env::set_var(WEBHOOK_SECRET_ENV, "stale_environment_secret");
        set_stored_webhook_secret(Some("current_provider_secret".to_owned()));

        let (store, _dir) = temp_store().await;
        let secret = store
            .reconcile_webhook_subscription("https://relay.example/api/composio/webhook")
            .await
            .expect("reconcile");
        assert_eq!(secret, "current_provider_secret");

        set_stored_webhook_secret(None);
        match prev_secret {
            Some(value) => std::env::set_var(WEBHOOK_SECRET_ENV, value),
            None => std::env::remove_var(WEBHOOK_SECRET_ENV),
        }
        restore_env(prev_base);
    }

    #[tokio::test]
    async fn handle_webhook_matches_v3_nested_trigger_metadata() {
        let _lock = crate::auth::test_env_lock();
        let prev = base_url_snapshot();
        let base = spawn_mock("200 OK", r#"{"trigger_id":"ti_xyz789"}"#.to_string());
        crate::auth::set_key("comp_key");
        std::env::set_var("COMPOSIO_BASE_URL", &base);
        crate::host::set_global_host(std::sync::Arc::new(RecordingHost));

        let (store, _dir) = temp_store().await;
        store
            .subscribe(
                "agent-v3",
                "github",
                "GITHUB_COMMIT_EVENT",
                "ca_1",
                json!({}),
            )
            .await
            .unwrap();

        clear_host_calls();
        let fired = store
            .handle_webhook(&json!({
                "id": "msg_abc123",
                "type": "composio.trigger.message",
                "metadata": {
                    "trigger_id": "ti_xyz789",
                    "trigger_slug": "GITHUB_COMMIT_EVENT"
                },
                "data": { "message": "fix webhook handling" }
            }))
            .await;
        assert_eq!(fired, 1);
        assert_eq!(host_calls()[0].0, "agent:agent-v3");

        restore_env(prev);
    }
}
