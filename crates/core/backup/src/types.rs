use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Non-secret destination projection. Credentials and the recovery key are
/// write-only inputs; they never appear in destination or operation listings.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupDestination {
    pub id: String,
    pub name: String,
    pub endpoint: String,
    pub bucket: String,
    pub region: String,
    pub prefix: String,
    pub path_style: bool,
    pub allow_http: bool,
    pub allowed_apps: Vec<String>,
    pub created_at: String,
}

#[derive(Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveBackupDestination {
    pub name: String,
    pub endpoint: String,
    pub bucket: String,
    pub region: String,
    #[serde(default)]
    pub prefix: String,
    #[serde(default = "default_true")]
    pub path_style: bool,
    #[serde(default)]
    pub allow_http: bool,
    #[serde(default)]
    pub allowed_apps: Vec<String>,
    pub access_key_id: String,
    pub secret_access_key: String,
    #[serde(default)]
    pub session_token: Option<String>,
    /// Base64-encoded random 32-byte key. Keep a copy outside the node for
    /// disaster recovery. Reusing it reconnects a replacement node to backups.
    pub recovery_key: String,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum BackupScope {
    Node,
    Space {
        #[serde(rename = "spaceId")]
        space_id: String,
    },
    App {
        #[serde(rename = "appId")]
        app_id: String,
        namespace: String,
        /// Server-derived opaque tenant partition; never caller supplied.
        tenant: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupRecord {
    pub version: u32,
    pub id: String,
    /// The backup service's persisted source identity. A different node sharing
    /// a destination may discover these records but never prunes them.
    #[serde(default)]
    pub source_node_id: String,
    pub scope: BackupScope,
    pub created_at: String,
    pub bytes: u64,
    pub sha256: String,
    pub object_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupPolicy {
    pub id: String,
    pub destination_id: String,
    pub scope: BackupScope,
    /// Standard five-field cron, evaluated in UTC.
    pub schedule: String,
    pub enabled: bool,
    /// Keep the newest successful backups for this destination and scope.
    pub retention_count: usize,
    pub last_attempt_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveBackupPolicy {
    pub destination_id: String,
    pub scope: BackupScope,
    pub schedule: String,
    pub enabled: bool,
    pub retention_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateBackup {
    pub destination_id: String,
    pub scope: BackupScope,
    /// Required on manual requests. Repeating it returns the same operation.
    pub idempotency_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BackupOperation {
    pub id: String,
    pub destination_id: String,
    pub scope: BackupScope,
    pub action: String,
    pub status: String,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub backup: Option<BackupRecord>,
    pub error: Option<String>,
    pub result: Option<serde_json::Value>,
}
