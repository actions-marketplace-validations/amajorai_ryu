//! Node-local fleet state: explicit control-plane project mappings.
//!
//! Central project ids never carry machine paths. This store is the only bridge
//! between an org project and a checkout on this node; the control plane receives
//! ids/status only. Managed desired-state reconciliation builds on this module.

use std::{
    collections::{BTreeMap, HashSet},
    path::{Path, PathBuf},
    sync::{OnceLock, RwLock},
    time::Duration,
};

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use axum::{
    extract::{Query, State},
    http::StatusCode,
    routing::get,
    Json, Router,
};
use base64::Engine;
use chrono::{DateTime, Utc};
use ed25519_dalek::{Signature, SigningKey, Verifier, VerifyingKey};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey as EncryptionPublicKey, StaticSecret};

use crate::server::ServerState;

const MAX_POLL_SECONDS: u64 = 25;
const RETRY_SECONDS: u64 = 60;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct FleetIdentity {
    control_plane_url: String,
    credential: String,
    node_id: String,
    organization_id: String,
    signing_private_key: String,
    signing_public_key: String,
    encryption_private_key: String,
    encryption_public_key: String,
    snapshot_public_key: String,
    #[serde(default)]
    credential_updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnrollBody {
    control_plane_url: String,
    token: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnrollResponse {
    credential: String,
    node_id: String,
    organization_id: String,
    signing_public_key: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SignedSnapshot {
    payload: Value,
    public_key: String,
    signature: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SealedNodeSecret {
    ciphertext: String,
    ephemeral_public_key: String,
    nonce: String,
    tag: String,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct FleetLocalStatus {
    last_attempt_at: Option<String>,
    last_error: Option<String>,
    observed_revision: u64,
    stale: bool,
    status: String,
}

fn identity_path() -> PathBuf {
    crate::paths::ryu_dir().join("fleet-identity.json")
}

fn snapshot_path() -> PathBuf {
    crate::paths::ryu_dir().join("fleet-desired.json")
}

fn status_path() -> PathBuf {
    crate::paths::ryu_dir().join("fleet-status.json")
}

fn enforcement_path() -> PathBuf {
    crate::paths::ryu_dir().join("fleet-enforcement.json")
}

fn artifact_cache_dir() -> PathBuf {
    crate::paths::ryu_dir().join("fleet-artifacts")
}

fn skill_blocks_path() -> PathBuf {
    crate::paths::ryu_dir().join("fleet-skill-blocks.json")
}

const FLEET_SKILL_MARKER: &str = ".ryu-fleet-owner.json";

fn legacy_instance_id() -> anyhow::Result<String> {
    let path = crate::paths::ryu_dir().join("fleet-instance-id.json");
    if let Ok(id) = load_json::<String>(&path) {
        if !id.trim().is_empty() {
            return Ok(id);
        }
    }
    let id = hex::encode(rand::random::<[u8; 16]>());
    atomic_json(&path, &id, true)?;
    Ok(id)
}

#[cfg(unix)]
fn restrict_file(path: &Path) -> anyhow::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    Ok(())
}

#[cfg(not(unix))]
fn restrict_file(_path: &Path) -> anyhow::Result<()> {
    Ok(())
}

fn atomic_json<T: Serialize>(path: &Path, value: &T, secret: bool) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, serde_json::to_vec_pretty(value)?)?;
    if secret {
        restrict_file(&temporary)?;
    }
    std::fs::rename(temporary, path)?;
    Ok(())
}

fn load_json<T: for<'de> Deserialize<'de>>(path: &Path) -> anyhow::Result<T> {
    Ok(serde_json::from_slice(&std::fs::read(path)?)?)
}

fn canonicalize_json(value: &Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.iter().map(canonicalize_json).collect()),
        Value::Object(object) => Value::Object(
            object
                .iter()
                .map(|(key, value)| (key.clone(), canonicalize_json(value)))
                .collect::<BTreeMap<_, _>>()
                .into_iter()
                .collect(),
        ),
        _ => value.clone(),
    }
}

fn verify_snapshot(identity: &FleetIdentity, snapshot: &SignedSnapshot) -> anyhow::Result<u64> {
    use anyhow::{anyhow, bail};

    if snapshot.public_key != identity.snapshot_public_key {
        bail!("snapshot signing key does not match the enrolled key");
    }
    let public_bytes = base64::engine::general_purpose::STANDARD.decode(&snapshot.public_key)?;
    let public_bytes: [u8; 32] = public_bytes
        .try_into()
        .map_err(|_| anyhow!("snapshot public key must be 32 bytes"))?;
    let verifying_key = VerifyingKey::from_bytes(&public_bytes)?;
    let signature = Signature::from_slice(
        &base64::engine::general_purpose::STANDARD.decode(&snapshot.signature)?,
    )?;
    let canonical = serde_json::to_vec(&canonicalize_json(&snapshot.payload))?;
    verifying_key.verify(&canonical, &signature)?;

    if snapshot.payload.get("nodeId").and_then(Value::as_str) != Some(&identity.node_id) {
        bail!("snapshot was issued to a different node");
    }
    let expires_at = snapshot
        .payload
        .get("expiresAt")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("snapshot has no expiry"))?
        .parse::<DateTime<Utc>>()?;
    if expires_at <= Utc::now() {
        bail!("snapshot has expired");
    }
    snapshot
        .payload
        .get("revision")
        .and_then(Value::as_u64)
        .ok_or_else(|| anyhow!("snapshot revision is missing"))
}

fn cache_artifacts(
    identity: &FleetIdentity,
    snapshot: &SignedSnapshot,
) -> anyhow::Result<Vec<Value>> {
    use anyhow::{anyhow, bail};

    let assignments = snapshot
        .payload
        .get("assignments")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("snapshot assignments are missing"))?;
    std::fs::create_dir_all(artifact_cache_dir())?;
    let mut observed = Vec::with_capacity(assignments.len());
    for assignment in assignments {
        let disposition = assignment
            .get("disposition")
            .and_then(Value::as_str)
            .unwrap_or("optional");
        let assignment_id = assignment.get("id").and_then(Value::as_str).unwrap_or("");
        if disposition == "blocked" {
            observed.push(json!({ "assignmentId": assignment_id, "status": "blocked" }));
            continue;
        }
        if disposition == "optional" {
            observed.push(json!({ "assignmentId": assignment_id, "status": "optional" }));
            continue;
        }
        let artifact = assignment
            .get("artifact")
            .and_then(Value::as_object)
            .ok_or_else(|| anyhow!("required assignment {assignment_id} has no artifact"))?;
        let descriptor = artifact
            .get("descriptor")
            .ok_or_else(|| anyhow!("required assignment {assignment_id} has no descriptor"))?;
        let expected = artifact
            .get("digest")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("required assignment {assignment_id} has no digest"))?;
        let actual = hex::encode(Sha256::digest(serde_json::to_vec(&canonicalize_json(
            descriptor,
        ))?));
        if actual != expected {
            bail!("artifact digest mismatch for assignment {assignment_id}");
        }
        let key_id = artifact.get("keyId").and_then(Value::as_str).unwrap_or("");
        if key_id.starts_with("fleet:") {
            let public_bytes =
                base64::engine::general_purpose::STANDARD.decode(&identity.snapshot_public_key)?;
            let public_bytes: [u8; 32] = public_bytes
                .try_into()
                .map_err(|_| anyhow!("artifact public key must be 32 bytes"))?;
            let signature = artifact
                .get("signature")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("artifact {assignment_id} has no signature"))?;
            let signature = Signature::from_slice(
                &base64::engine::general_purpose::STANDARD.decode(signature)?,
            )?;
            let signed = canonicalize_json(&json!({
                "descriptor": descriptor,
                "digest": expected,
            }));
            VerifyingKey::from_bytes(&public_bytes)?
                .verify(&serde_json::to_vec(&signed)?, &signature)?;
        } else {
            bail!("artifact {assignment_id} uses an untrusted signing key");
        }
        atomic_json(
            &artifact_cache_dir().join(format!("{expected}.json")),
            descriptor,
            false,
        )?;
        observed.push(json!({
            "activation": assignment.get("activation"),
            "assignmentId": assignment_id,
            "digest": expected,
            "status": "installing"
        }));
    }
    Ok(observed)
}

fn collect_secret_refs(value: &Value, output: &mut HashSet<String>) {
    match value {
        Value::Array(items) => {
            for item in items {
                collect_secret_refs(item, output);
            }
        }
        Value::Object(object) => {
            for (key, child) in object {
                if key == "secretRef" {
                    if child.get("kind").and_then(Value::as_str) == Some("org_secret") {
                        if let Some(id) = child.get("id").and_then(Value::as_str) {
                            output.insert(id.to_owned());
                        }
                    }
                } else {
                    collect_secret_refs(child, output);
                }
            }
        }
        _ => {}
    }
}

async fn materialize_secrets(
    identity: &FleetIdentity,
    snapshot: &SignedSnapshot,
) -> anyhow::Result<HashSet<String>> {
    use anyhow::anyhow;

    let private_bytes =
        base64::engine::general_purpose::STANDARD.decode(&identity.encryption_private_key)?;
    let private_bytes: [u8; 32] = private_bytes
        .try_into()
        .map_err(|_| anyhow!("node encryption private key must be 32 bytes"))?;
    let private_key = StaticSecret::from(private_bytes);
    let mut delivered = HashSet::new();
    let Some(secrets) = snapshot.payload.get("secrets").and_then(Value::as_array) else {
        return Ok(delivered);
    };
    if secrets.is_empty() {
        return Ok(delivered);
    }
    let store = crate::plugin_secrets::global()
        .ok_or_else(|| anyhow!("node secret store is unavailable"))?;
    for entry in secrets {
        let id = entry
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("sealed secret has no id"))?;
        let sealed: SealedNodeSecret = serde_json::from_value(
            entry
                .get("sealed")
                .cloned()
                .ok_or_else(|| anyhow!("sealed secret has no envelope"))?,
        )?;
        let ephemeral_bytes =
            base64::engine::general_purpose::STANDARD.decode(sealed.ephemeral_public_key)?;
        let ephemeral_bytes: [u8; 32] = ephemeral_bytes
            .try_into()
            .map_err(|_| anyhow!("ephemeral public key must be 32 bytes"))?;
        let shared = private_key.diffie_hellman(&EncryptionPublicKey::from(ephemeral_bytes));
        let key = Sha256::digest(shared.as_bytes());
        let cipher = Aes256Gcm::new_from_slice(&key)?;
        let nonce_bytes = base64::engine::general_purpose::STANDARD.decode(sealed.nonce)?;
        if nonce_bytes.len() != 12 {
            return Err(anyhow!("sealed secret nonce must be 12 bytes"));
        }
        let mut ciphertext = base64::engine::general_purpose::STANDARD.decode(sealed.ciphertext)?;
        ciphertext.extend(base64::engine::general_purpose::STANDARD.decode(sealed.tag)?);
        let plaintext = cipher
            .decrypt(Nonce::from_slice(&nonce_bytes), ciphertext.as_ref())
            .map_err(|_| anyhow!("could not decrypt sealed secret '{id}'"))?;
        store
            .set("fleet", id, &String::from_utf8(plaintext)?)
            .await?;
        delivered.insert(id.to_owned());
    }
    Ok(delivered)
}

fn artifact_disposition(id: &str) -> Option<String> {
    let persisted_blocks = load_json::<Value>(&enforcement_path())
        .ok()
        .and_then(|enforcement| enforcement.get("assignments").cloned());
    if persisted_blocks.as_ref().is_some_and(|assignments| {
        assignments.as_array().is_some_and(|assignments| {
            assignments.iter().any(|assignment| {
                assignment
                    .get("artifact")
                    .and_then(|artifact| artifact.get("artifactId"))
                    .and_then(Value::as_str)
                    == Some(id)
            })
        })
    }) {
        return Some("blocked".to_owned());
    }
    let active = active_assignments_cache()
        .read()
        .ok()
        .and_then(|assignments| assignments.clone())
        .or_else(|| {
            load_json::<SignedSnapshot>(&snapshot_path())
                .ok()
                .and_then(|snapshot| snapshot.payload.get("assignments").cloned())
        })?;
    active
        .as_array()?
        .iter()
        .find(|assignment| {
            assignment
                .get("artifact")
                .and_then(|artifact| artifact.get("artifactId"))
                .and_then(Value::as_str)
                == Some(id)
        })?
        .get("disposition")?
        .as_str()
        .map(str::to_owned)
}

static ACTIVE_ASSIGNMENTS: OnceLock<RwLock<Option<Value>>> = OnceLock::new();

fn active_assignments_cache() -> &'static RwLock<Option<Value>> {
    ACTIVE_ASSIGNMENTS.get_or_init(|| RwLock::new(None))
}

fn use_verified_assignments(snapshot: &SignedSnapshot) {
    if let Ok(mut assignments) = active_assignments_cache().write() {
        *assignments = snapshot.payload.get("assignments").cloned();
    }
}

fn persist_fail_closed_enforcement(snapshot: &SignedSnapshot) -> anyhow::Result<()> {
    let assignments: Vec<Value> = snapshot
        .payload
        .get("assignments")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|assignment| {
            assignment.get("disposition").and_then(Value::as_str) == Some("blocked")
        })
        .cloned()
        .collect();
    let rules: Vec<Value> = snapshot
        .payload
        .get("rules")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|rule| {
            rule.get("kind").and_then(Value::as_str) == Some("command")
                && rule
                    .get("definition")
                    .and_then(|definition| definition.get("decision"))
                    .and_then(Value::as_str)
                    == Some("deny")
        })
        .cloned()
        .collect();
    atomic_json(
        &enforcement_path(),
        &json!({
            "assignments": assignments,
            "revision": snapshot.payload.get("revision"),
            "rules": rules,
        }),
        false,
    )
}

pub fn is_artifact_blocked(id: &str) -> bool {
    artifact_disposition(id).as_deref() == Some("blocked")
}

pub fn managed_mcp_configs() -> BTreeMap<String, crate::sidecar::mcp::McpServerConfig> {
    managed_mcp_cache()
        .read()
        .map(|configs| configs.clone())
        .unwrap_or_default()
}

static MANAGED_MCP_CONFIGS: OnceLock<
    RwLock<BTreeMap<String, crate::sidecar::mcp::McpServerConfig>>,
> = OnceLock::new();

fn managed_mcp_cache() -> &'static RwLock<BTreeMap<String, crate::sidecar::mcp::McpServerConfig>> {
    MANAGED_MCP_CONFIGS.get_or_init(|| RwLock::new(BTreeMap::new()))
}

async fn materialize_mcp_config(
    artifact_id: &str,
    descriptor: &Value,
    assignment: &Value,
) -> Result<crate::sidecar::mcp::McpServerConfig, String> {
    let mut config = descriptor.get("config").unwrap_or(descriptor).clone();
    let store = crate::plugin_secrets::global()
        .ok_or_else(|| "node secret store is unavailable".to_owned())?;
    for field in ["headers", "env"] {
        let Some(values) = config.get_mut(field).and_then(Value::as_object_mut) else {
            continue;
        };
        for value in values.values_mut() {
            let Some(reference) = value.get("secretRef") else {
                continue;
            };
            let Some(secret_id) = reference.get("id").and_then(Value::as_str) else {
                continue;
            };
            let owner = if reference.get("kind").and_then(Value::as_str) == Some("node_local") {
                artifact_id
            } else {
                "fleet"
            };
            let secret = store
                .get(owner, secret_id)
                .await
                .map_err(|error| error.to_string())?
                .ok_or_else(|| format!("missing secret '{secret_id}'"))?;
            *value = Value::String(secret);
        }
    }
    let mut config = serde_json::from_value::<crate::sidecar::mcp::McpServerConfig>(config)
        .map_err(|error| error.to_string())?;
    config.enabled = assignment.get("activation").and_then(Value::as_str) == Some("enabled");
    Ok(config)
}

async fn bind_plugin_secrets(plugin_id: &str, assignment: &Value) -> Result<(), String> {
    let store = crate::plugin_secrets::global()
        .ok_or_else(|| "node secret store is unavailable".to_owned())?;
    let Some(config) = assignment.get("config").and_then(Value::as_object) else {
        return Ok(());
    };
    for (key, value) in config {
        let Some(reference) = value.get("secretRef") else {
            continue;
        };
        let Some(secret_id) = reference.get("id").and_then(Value::as_str) else {
            continue;
        };
        let owner = if reference.get("kind").and_then(Value::as_str) == Some("node_local") {
            plugin_id
        } else {
            "fleet"
        };
        let secret = store
            .get(owner, secret_id)
            .await
            .map_err(|error| error.to_string())?
            .ok_or_else(|| format!("missing secret '{secret_id}'"))?;
        store
            .set(plugin_id, key, &secret)
            .await
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn retained_plugin_ids(snapshot: &SignedSnapshot) -> HashSet<String> {
    snapshot
        .payload
        .get("assignments")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|assignment| {
            matches!(
                assignment.get("disposition").and_then(Value::as_str),
                Some("required" | "blocked")
            )
        })
        .filter(|assignment| {
            matches!(
                assignment
                    .get("artifact")
                    .and_then(|artifact| artifact.get("kind"))
                    .and_then(Value::as_str),
                Some("app" | "plugin")
            )
        })
        .filter_map(|assignment| {
            assignment
                .get("artifact")
                .and_then(|artifact| artifact.get("artifactId"))
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .collect()
}

fn assigned_skill_ids(snapshot: &SignedSnapshot) -> HashSet<String> {
    snapshot
        .payload
        .get("assignments")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|assignment| {
            matches!(
                assignment.get("disposition").and_then(Value::as_str),
                Some("required" | "blocked")
            )
        })
        .filter(|assignment| {
            assignment
                .get("artifact")
                .and_then(|artifact| artifact.get("kind"))
                .and_then(Value::as_str)
                == Some("skill")
        })
        .filter_map(|assignment| {
            assignment
                .get("artifact")
                .and_then(|artifact| artifact.get("artifactId"))
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .collect()
}

fn fleet_skill_dir(artifact_id: &str) -> Result<PathBuf, String> {
    let path = Path::new(artifact_id);
    if artifact_id.is_empty()
        || matches!(artifact_id, "." | "..")
        || !artifact_id.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
        || path.components().count() != 1
        || !matches!(
            path.components().next(),
            Some(std::path::Component::Normal(_))
        )
    {
        return Err(format!("unsafe managed skill id '{artifact_id}'"));
    }
    Ok(ryu_skills::SkillRegistry::skills_dir().join(artifact_id))
}

fn remove_stale_fleet_skills(
    previous: Option<&SignedSnapshot>,
    current: &SignedSnapshot,
) -> Vec<Value> {
    let Some(previous) = previous else {
        return Vec::new();
    };
    let retained = assigned_skill_ids(current);
    let mut removed = Vec::new();
    for artifact_id in assigned_skill_ids(previous).difference(&retained) {
        let result = fleet_skill_dir(artifact_id).and_then(|dir| {
            if !dir.join(FLEET_SKILL_MARKER).is_file() {
                return Ok(false);
            }
            std::fs::remove_dir_all(&dir)
                .map_err(|error| format!("removing managed skill {}: {error}", dir.display()))?;
            ryu_skills::set_active(artifact_id, false);
            Ok(true)
        });
        removed.push(match result {
            Ok(was_removed) => json!({
                "artifactId": artifact_id,
                "status": if was_removed { "removed" } else { "preserved_user_install" },
            }),
            Err(error) => json!({
                "artifactId": artifact_id,
                "error": error,
                "status": "error",
            }),
        });
    }
    removed
}

fn reconcile_skill_blocks(state: &ServerState, snapshot: &SignedSnapshot) -> Result<(), String> {
    let currently_blocked: HashSet<String> = snapshot
        .payload
        .get("assignments")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|assignment| {
            assignment.get("disposition").and_then(Value::as_str) == Some("blocked")
        })
        .filter(|assignment| {
            assignment
                .get("artifact")
                .and_then(|artifact| artifact.get("kind"))
                .and_then(Value::as_str)
                == Some("skill")
        })
        .filter_map(|assignment| {
            assignment
                .get("artifact")
                .and_then(|artifact| artifact.get("artifactId"))
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .collect();
    let mut prior: BTreeMap<String, bool> = load_json(&skill_blocks_path()).unwrap_or_default();
    let no_longer_blocked: Vec<String> = prior
        .keys()
        .filter(|id| !currently_blocked.contains(*id))
        .cloned()
        .collect();
    for artifact_id in no_longer_blocked {
        if prior.remove(&artifact_id).unwrap_or(false) {
            ryu_skills::set_active(&artifact_id, true);
        }
    }
    let enabled: HashSet<String> = state
        .skills
        .enabled()
        .into_iter()
        .map(|skill| skill.id)
        .collect();
    for artifact_id in currently_blocked {
        prior
            .entry(artifact_id.clone())
            .or_insert_with(|| enabled.contains(&artifact_id));
        ryu_skills::set_active(&artifact_id, false);
    }
    atomic_json(&skill_blocks_path(), &prior, false).map_err(|error| error.to_string())
}

async fn install_fleet_skill(
    artifact_id: &str,
    assignment_id: &str,
    digest: Option<&str>,
    markdown: &str,
    enabled: bool,
) -> Result<(), String> {
    let destination = fleet_skill_dir(artifact_id)?;
    let marker = destination.join(FLEET_SKILL_MARKER);
    if destination.exists() && !marker.is_file() {
        return Err(format!(
            "managed skill '{artifact_id}' conflicts with a user-owned install"
        ));
    }
    let installed =
        crate::skills_catalog::from_source::install_skill_md_text(artifact_id, markdown)
            .await
            .map_err(|error| error.to_string())?;
    let installed_dir = Path::new(&installed.path)
        .parent()
        .ok_or_else(|| "managed skill installer returned an invalid path".to_owned())?;
    atomic_json(
        &installed_dir.join(FLEET_SKILL_MARKER),
        &json!({
            "artifactId": artifact_id,
            "assignmentId": assignment_id,
            "digest": digest,
        }),
        false,
    )
    .map_err(|error| error.to_string())?;
    ryu_skills::set_active(artifact_id, enabled);
    Ok(())
}

async fn remove_stale_fleet_plugins(
    state: &ServerState,
    previous: Option<&SignedSnapshot>,
    current: &SignedSnapshot,
) -> Vec<Value> {
    let Some(previous) = previous else {
        return Vec::new();
    };
    let retained = retained_plugin_ids(current);
    let mut removed = Vec::new();
    for artifact_id in retained_plugin_ids(previous).difference(&retained) {
        match crate::server::remove_fleet_owned_plugin(state, artifact_id).await {
            Ok(was_removed) => removed.push(json!({
                "artifactId": artifact_id,
                "status": if was_removed { "removed" } else { "preserved_user_install" },
            })),
            Err(error) => removed.push(json!({
                "artifactId": artifact_id,
                "error": error,
                "status": "error",
            })),
        }
    }
    removed
}

async fn apply_artifacts(
    state: &ServerState,
    snapshot: &SignedSnapshot,
    delivered_secrets: &HashSet<String>,
    previous: Option<&SignedSnapshot>,
) -> Vec<Value> {
    let mut observed = Vec::new();
    if let Ok(mut configs) = managed_mcp_cache().write() {
        configs.clear();
    }
    let Some(assignments) = snapshot
        .payload
        .get("assignments")
        .and_then(Value::as_array)
    else {
        return observed;
    };
    // Denials are applied before removals, downloads, installs, or activation.
    if let Err(error) = reconcile_skill_blocks(state, snapshot) {
        observed.push(json!({ "error": error, "status": "error", "type": "skill_blocks" }));
    }
    for assignment in assignments {
        if assignment.get("disposition").and_then(Value::as_str) != Some("blocked") {
            continue;
        }
        let assignment_id = assignment.get("id").and_then(Value::as_str).unwrap_or("");
        let artifact_id = assignment
            .get("artifact")
            .and_then(|artifact| artifact.get("artifactId"))
            .and_then(Value::as_str)
            .unwrap_or("");
        let kind = assignment
            .get("artifact")
            .and_then(|artifact| artifact.get("kind"))
            .and_then(Value::as_str)
            .unwrap_or("");
        let error = if matches!(kind, "app" | "plugin") {
            crate::server::apply_fleet_plugin_block(state, artifact_id)
                .await
                .err()
        } else {
            None
        };
        observed.push(json!({
            "artifactId": artifact_id,
            "assignmentId": assignment_id,
            "error": error,
            "status": if error.is_some() { "error" } else { "blocked" },
        }));
    }
    observed.extend(remove_stale_fleet_plugins(state, previous, snapshot).await);
    observed.extend(remove_stale_fleet_skills(previous, snapshot));
    for assignment in assignments {
        let assignment_id = assignment.get("id").and_then(Value::as_str).unwrap_or("");
        let disposition = assignment
            .get("disposition")
            .and_then(Value::as_str)
            .unwrap_or("optional");
        let artifact = assignment.get("artifact");
        let artifact_id = artifact
            .and_then(|value| value.get("artifactId"))
            .and_then(Value::as_str)
            .unwrap_or("");
        if disposition == "blocked" {
            continue;
        }
        if disposition == "optional" {
            observed.push(json!({
                "artifactId": artifact_id,
                "assignmentId": assignment_id,
                "status": "optional",
            }));
            continue;
        }
        let mut required_secrets = HashSet::new();
        if let Some(config) = assignment.get("config") {
            collect_secret_refs(config, &mut required_secrets);
        }
        if !required_secrets.is_subset(delivered_secrets) {
            observed.push(json!({
                "artifactId": artifact_id,
                "assignmentId": assignment_id,
                "missingSecretIds": required_secrets.difference(delivered_secrets).collect::<Vec<_>>(),
                "status": "needs_secret",
            }));
            continue;
        }
        let kind = artifact
            .and_then(|value| value.get("kind"))
            .and_then(Value::as_str)
            .unwrap_or("");
        let descriptor = artifact.and_then(|value| value.get("descriptor"));
        let result = match (kind, descriptor) {
            ("app" | "plugin", Some(descriptor)) => {
                if let Err(error) = bind_plugin_secrets(artifact_id, assignment).await {
                    observed.push(json!({
                        "artifactId": artifact_id,
                        "assignmentId": assignment_id,
                        "error": error,
                        "status": "needs_secret",
                    }));
                    continue;
                }
                let manifest_value = descriptor
                    .get("manifest")
                    .or_else(|| descriptor.get("raw").and_then(|raw| raw.get("manifest")))
                    .unwrap_or(descriptor);
                match serde_json::from_value::<crate::plugin_manifest::PluginManifest>(
                    manifest_value.clone(),
                ) {
                    Ok(manifest) => {
                        let ui_code = descriptor
                            .get("uiCode")
                            .or_else(|| descriptor.get("ui_code"))
                            .or_else(|| {
                                descriptor.get("raw").and_then(|raw| {
                                    raw.get("ui_code").or_else(|| raw.get("uiCode"))
                                })
                            })
                            .and_then(Value::as_str)
                            .map(str::to_owned);
                        let enable =
                            assignment.get("activation").and_then(Value::as_str) == Some("enabled");
                        crate::server::install_fleet_plugin(state, manifest, ui_code, enable).await
                    }
                    Err(error) => Err(format!("invalid plugin descriptor: {error}")),
                }
            }
            ("skill", Some(descriptor)) => {
                let markdown = descriptor
                    .get("markdown")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "skill descriptor has no markdown".to_owned());
                match markdown {
                    Ok(markdown) => {
                        install_fleet_skill(
                            artifact_id,
                            assignment_id,
                            artifact
                                .and_then(|value| value.get("digest"))
                                .and_then(Value::as_str),
                            markdown,
                            assignment.get("activation").and_then(Value::as_str) == Some("enabled"),
                        )
                        .await
                    }
                    Err(error) => Err(error),
                }
            }
            ("mcp", Some(descriptor)) => {
                match materialize_mcp_config(artifact_id, descriptor, assignment).await {
                    Ok(config) => {
                        if let Ok(mut configs) = managed_mcp_cache().write() {
                            configs.insert(artifact_id.to_owned(), config);
                        }
                        Ok(())
                    }
                    Err(error) => Err(error),
                }
            }
            _ => Err(format!("unsupported managed artifact kind '{kind}'")),
        };
        observed.push(json!({
            "activation": assignment.get("activation"),
            "artifactId": artifact_id,
            "assignmentId": assignment_id,
            "digest": artifact.and_then(|value| value.get("digest")),
            "error": result.as_ref().err(),
            "status": if result.is_ok() { "converged" } else { "error" },
        }));
    }
    state.mcp.reload();
    observed
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMapping {
    pub organization_id: String,
    pub project_id: String,
    pub root: PathBuf,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PutMappingBody {
    organization_id: String,
    project_id: String,
    root: PathBuf,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteMappingQuery {
    organization_id: String,
    project_id: String,
    root: PathBuf,
}

fn mappings_path() -> PathBuf {
    crate::paths::ryu_dir().join("org-project-mappings.json")
}

fn load_from(path: &Path) -> anyhow::Result<Vec<ProjectMapping>> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(serde_json::from_slice(&bytes)?),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(error.into()),
    }
}

fn save_to(path: &Path, mappings: &[ProjectMapping]) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, serde_json::to_vec_pretty(mappings)?)?;
    std::fs::rename(temporary, path)?;
    Ok(())
}

fn roots_overlap(left: &Path, right: &Path) -> bool {
    left.starts_with(right) || right.starts_with(left)
}

fn validate_insert(mappings: &[ProjectMapping], incoming: &ProjectMapping) -> Result<(), String> {
    for existing in mappings {
        if existing.root == incoming.root
            && existing.organization_id == incoming.organization_id
            && existing.project_id == incoming.project_id
        {
            continue;
        }
        if roots_overlap(&existing.root, &incoming.root)
            && (existing.organization_id != incoming.organization_id
                || existing.project_id != incoming.project_id)
        {
            return Err(format!(
                "workspace root overlaps mapping for project '{}'",
                existing.project_id
            ));
        }
    }
    Ok(())
}

pub fn project_for_cwd<'a>(
    mappings: &'a [ProjectMapping],
    organization_id: &str,
    cwd: &Path,
) -> Option<&'a str> {
    mappings
        .iter()
        .filter(|mapping| {
            mapping.organization_id == organization_id && cwd.starts_with(&mapping.root)
        })
        .max_by_key(|mapping| mapping.root.components().count())
        .map(|mapping| mapping.project_id.as_str())
}

async fn list_mappings() -> (StatusCode, Json<Value>) {
    match load_from(&mappings_path()) {
        Ok(mappings) => (StatusCode::OK, Json(json!({ "mappings": mappings }))),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        ),
    }
}

async fn put_mapping(Json(body): Json<PutMappingBody>) -> (StatusCode, Json<Value>) {
    if body.organization_id.trim().is_empty() || body.project_id.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "organizationId and projectId are required" })),
        );
    }
    let root = match std::fs::canonicalize(&body.root) {
        Ok(root) if root.is_dir() => root,
        Ok(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "root must be an existing directory" })),
            );
        }
        Err(error) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": format!("could not resolve root: {error}") })),
            );
        }
    };
    let path = mappings_path();
    let mut mappings = match load_from(&path) {
        Ok(mappings) => mappings,
        Err(error) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": error.to_string() })),
            );
        }
    };
    let incoming = ProjectMapping {
        organization_id: body.organization_id,
        project_id: body.project_id,
        root,
    };
    if let Err(error) = validate_insert(&mappings, &incoming) {
        return (StatusCode::CONFLICT, Json(json!({ "error": error })));
    }
    mappings.retain(|mapping| mapping != &incoming);
    mappings.push(incoming.clone());
    mappings.sort_by(|left, right| left.root.cmp(&right.root));
    match save_to(&path, &mappings) {
        Ok(()) => (StatusCode::OK, Json(json!({ "mapping": incoming }))),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        ),
    }
}

async fn delete_mapping(Query(query): Query<DeleteMappingQuery>) -> (StatusCode, Json<Value>) {
    let root = match std::fs::canonicalize(&query.root) {
        Ok(root) => root,
        Err(_) => query.root,
    };
    let path = mappings_path();
    let mut mappings = match load_from(&path) {
        Ok(mappings) => mappings,
        Err(error) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": error.to_string() })),
            );
        }
    };
    let before = mappings.len();
    mappings.retain(|mapping| {
        !(mapping.organization_id == query.organization_id
            && mapping.project_id == query.project_id
            && mapping.root == root)
    });
    if mappings.len() == before {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "mapping not found" })),
        );
    }
    match save_to(&path, &mappings) {
        Ok(()) => (StatusCode::OK, Json(json!({ "success": true }))),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        ),
    }
}

async fn enroll_node(
    State(state): State<ServerState>,
    Json(body): Json<EnrollBody>,
) -> (StatusCode, Json<Value>) {
    let base_url = body.control_plane_url.trim().trim_end_matches('/');
    if !(base_url.starts_with("https://") || base_url.starts_with("http://127.0.0.1")) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "controlPlaneUrl must use HTTPS (localhost HTTP is allowed)" })),
        );
    }
    if !body.token.starts_with("rfe_") {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "invalid enrollment token" })),
        );
    }
    let signing_key = SigningKey::generate(&mut OsRng);
    let public_key =
        base64::engine::general_purpose::STANDARD.encode(signing_key.verifying_key().as_bytes());
    let encryption_secret = StaticSecret::random_from_rng(OsRng);
    let encryption_public = EncryptionPublicKey::from(&encryption_secret);
    let encryption_public_key =
        base64::engine::general_purpose::STANDARD.encode(encryption_public.as_bytes());
    let response = match state
        .client
        .post(format!("{base_url}/api/control-plane/nodes/enroll"))
        .json(&json!({
            "architecture": std::env::consts::ARCH,
            "capabilities": ["fleet-v1", "project-mapping-v1"],
            "coreVersion": env!("CARGO_PKG_VERSION"),
            "encryptionPublicKey": encryption_public_key,
            "platform": std::env::consts::OS,
            "publicKey": public_key,
            "token": body.token,
        }))
        .timeout(Duration::from_secs(15))
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "error": format!("enrollment request failed: {error}") })),
            );
        }
    };
    if !response.status().is_success() {
        let status = response.status();
        return (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "error": format!("control plane rejected enrollment: {status}") })),
        );
    }
    let enrolled: EnrollResponse = match response.json().await {
        Ok(enrolled) => enrolled,
        Err(error) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "error": format!("invalid enrollment response: {error}") })),
            );
        }
    };
    let identity = FleetIdentity {
        control_plane_url: base_url.to_owned(),
        credential: enrolled.credential,
        node_id: enrolled.node_id.clone(),
        organization_id: enrolled.organization_id.clone(),
        signing_private_key: base64::engine::general_purpose::STANDARD
            .encode(signing_key.to_bytes()),
        signing_public_key: public_key,
        encryption_private_key: base64::engine::general_purpose::STANDARD
            .encode(encryption_secret.to_bytes()),
        encryption_public_key,
        snapshot_public_key: enrolled.signing_public_key,
        credential_updated_at: Some(Utc::now()),
    };
    if let Err(error) = atomic_json(&identity_path(), &identity, true) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("could not persist node identity: {error}") })),
        );
    }
    (
        StatusCode::CREATED,
        Json(json!({
            "nodeId": enrolled.node_id,
            "organizationId": enrolled.organization_id,
        })),
    )
}

async fn adopt_legacy_gateway(state: &ServerState) -> anyhow::Result<bool> {
    let Some(gateway_key) = crate::sidecar::control_plane::gateway_key() else {
        return Ok(false);
    };
    let base_url = std::env::var("RYU_CONTROL_PLANE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "http://127.0.0.1:3000".to_owned())
        .trim_end_matches('/')
        .to_owned();
    let signing_key = SigningKey::generate(&mut OsRng);
    let public_key =
        base64::engine::general_purpose::STANDARD.encode(signing_key.verifying_key().as_bytes());
    let encryption_secret = StaticSecret::random_from_rng(OsRng);
    let encryption_public = EncryptionPublicKey::from(&encryption_secret);
    let encryption_public_key =
        base64::engine::general_purpose::STANDARD.encode(encryption_public.as_bytes());
    let legacy_instance_id = legacy_instance_id()?;
    let response = state
        .client
        .post(format!("{base_url}/api/control-plane/nodes/adopt-gateway"))
        .header("x-gateway-key", gateway_key)
        .json(&json!({
            "architecture": std::env::consts::ARCH,
            "capabilities": ["fleet-v1", "project-mapping-v1"],
            "coreVersion": env!("CARGO_PKG_VERSION"),
            "encryptionPublicKey": encryption_public_key,
            "legacyInstanceId": legacy_instance_id,
            "platform": std::env::consts::OS,
            "publicKey": public_key,
        }))
        .timeout(Duration::from_secs(15))
        .send()
        .await?;
    if !response.status().is_success() {
        anyhow::bail!("legacy node adoption returned {}", response.status());
    }
    let enrolled: EnrollResponse = response.json().await?;
    atomic_json(
        &identity_path(),
        &FleetIdentity {
            control_plane_url: base_url,
            credential: enrolled.credential,
            node_id: enrolled.node_id,
            organization_id: enrolled.organization_id,
            signing_private_key: base64::engine::general_purpose::STANDARD
                .encode(signing_key.to_bytes()),
            signing_public_key: public_key,
            encryption_private_key: base64::engine::general_purpose::STANDARD
                .encode(encryption_secret.to_bytes()),
            encryption_public_key,
            snapshot_public_key: enrolled.signing_public_key,
            credential_updated_at: Some(Utc::now()),
        },
        true,
    )?;
    Ok(true)
}

async fn report_observed(
    client: &reqwest::Client,
    identity: &FleetIdentity,
    revision: u64,
    status: &str,
    items: Vec<Value>,
) -> anyhow::Result<()> {
    let mappings = load_from(&mappings_path()).unwrap_or_default();
    let mapped_project_ids: Vec<&str> = mappings
        .iter()
        .filter(|mapping| mapping.organization_id == identity.organization_id)
        .map(|mapping| mapping.project_id.as_str())
        .collect();
    let response = client
        .post(format!(
            "{}/api/control-plane/nodes/me/observed",
            identity.control_plane_url
        ))
        .bearer_auth(&identity.credential)
        .json(&json!({
            "items": items,
            "mappedProjectIds": mapped_project_ids,
            "revision": revision,
            "status": status,
        }))
        .timeout(Duration::from_secs(15))
        .send()
        .await?;
    if !response.status().is_success() {
        anyhow::bail!("observed-state report returned {}", response.status());
    }
    Ok(())
}

async fn rotate_credential_if_due(
    client: &reqwest::Client,
    identity: &mut FleetIdentity,
) -> anyhow::Result<()> {
    let age = identity
        .credential_updated_at
        .map(|updated| Utc::now().signed_duration_since(updated))
        .unwrap_or_else(|| chrono::Duration::days(2));
    if age < chrono::Duration::days(1) {
        return Ok(());
    }
    let response = client
        .post(format!(
            "{}/api/control-plane/nodes/me/rotate-credential",
            identity.control_plane_url
        ))
        .bearer_auth(&identity.credential)
        .timeout(Duration::from_secs(15))
        .send()
        .await?;
    if !response.status().is_success() {
        anyhow::bail!("credential rotation returned {}", response.status());
    }
    let body: Value = response.json().await?;
    identity.credential = body
        .get("credential")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow::anyhow!("credential rotation response is missing credential"))?
        .to_owned();
    identity.credential_updated_at = Some(Utc::now());
    atomic_json(&identity_path(), identity, true)?;
    Ok(())
}

async fn reconcile_once(state: &ServerState) -> anyhow::Result<bool> {
    use anyhow::{anyhow, bail};

    let mut identity: FleetIdentity = load_json(&identity_path())?;
    rotate_credential_if_due(&state.client, &mut identity).await?;
    let previous = load_json::<SignedSnapshot>(&snapshot_path()).ok();
    let previous_revision = previous
        .as_ref()
        .and_then(|snapshot| snapshot.payload.get("revision"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let refresh_before_expiry = previous
        .as_ref()
        .and_then(|snapshot| snapshot.payload.get("expiresAt"))
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<DateTime<Utc>>().ok())
        .is_some_and(|expiry| expiry <= Utc::now() + chrono::Duration::hours(1));
    let after_revision = if previous.is_none() || refresh_before_expiry {
        "-1".to_owned()
    } else {
        previous_revision.to_string()
    };
    let response = state
        .client
        .get(format!(
            "{}/api/control-plane/nodes/me/desired",
            identity.control_plane_url
        ))
        .bearer_auth(&identity.credential)
        .query(&[
            ("after", after_revision),
            ("wait", MAX_POLL_SECONDS.to_string()),
        ])
        .timeout(Duration::from_secs(MAX_POLL_SECONDS + 10))
        .send()
        .await?;
    if response.status() == reqwest::StatusCode::NO_CONTENT {
        return Ok(false);
    }
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        bail!("node credential was revoked");
    }
    if !response.status().is_success() {
        bail!("desired-state request returned {}", response.status());
    }
    let snapshot: SignedSnapshot = response.json().await?;
    let revision = verify_snapshot(&identity, &snapshot)?;
    if revision < previous_revision
        || (previous.is_some() && revision == previous_revision && !refresh_before_expiry)
    {
        bail!("desired-state replay or downgrade detected");
    }

    if snapshot.payload.get("assignments").is_none() {
        return Err(anyhow!("desired state has no assignments"));
    }
    // Make verified blocks effective before any artifact work. The durable LKG
    // pointer is promoted only after every required action converges.
    use_verified_assignments(&snapshot);
    persist_fail_closed_enforcement(&snapshot)?;
    cache_artifacts(&identity, &snapshot)?;
    let delivered_secrets = materialize_secrets(&identity, &snapshot).await?;
    let mut items = apply_artifacts(state, &snapshot, &delivered_secrets, previous.as_ref()).await;
    let mapped_project_ids: HashSet<String> = load_from(&mappings_path())
        .unwrap_or_default()
        .into_iter()
        .filter(|mapping| mapping.organization_id == identity.organization_id)
        .map(|mapping| mapping.project_id)
        .collect();
    let missing_project_ids: Vec<&str> = snapshot
        .payload
        .get("requiredProjectIds")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|project_id| !mapped_project_ids.contains(*project_id))
        .collect();
    if !missing_project_ids.is_empty() {
        items.push(json!({
            "missingProjectIds": missing_project_ids,
            "status": "needs_mapping",
        }));
    }
    let status = if items
        .iter()
        .any(|item| item.get("status").and_then(Value::as_str) == Some("error"))
    {
        "error"
    } else if items
        .iter()
        .any(|item| item.get("status").and_then(Value::as_str) == Some("needs_secret"))
    {
        "needs_secret"
    } else if items
        .iter()
        .any(|item| item.get("status").and_then(Value::as_str) == Some("needs_mapping"))
    {
        "needs_mapping"
    } else {
        "converged"
    };
    if status == "converged" {
        atomic_json(&snapshot_path(), &snapshot, false)?;
    }
    report_observed(&state.client, &identity, revision, status, items).await?;
    atomic_json(
        &status_path(),
        &FleetLocalStatus {
            last_attempt_at: Some(Utc::now().to_rfc3339()),
            last_error: None,
            observed_revision: revision,
            stale: false,
            status: status.to_owned(),
        },
        false,
    )?;
    if status != "converged" {
        tokio::time::sleep(Duration::from_secs(RETRY_SECONDS)).await;
    }
    Ok(true)
}

fn cached_snapshot_is_stale() -> bool {
    load_json::<SignedSnapshot>(&snapshot_path())
        .ok()
        .and_then(|snapshot| {
            snapshot
                .payload
                .get("expiresAt")
                .and_then(Value::as_str)
                .and_then(|value| value.parse::<DateTime<Utc>>().ok())
        })
        .is_none_or(|expiry| expiry <= Utc::now())
}

/// Managed command rules and authenticated node context forwarded to Gateway.
/// Expired LKG snapshots retain only denies; managed allows/prompts disappear.
pub fn command_scan_context() -> (Option<String>, Option<String>, Vec<Value>) {
    let Ok(identity) = load_json::<FleetIdentity>(&identity_path()) else {
        return (None, None, Vec::new());
    };
    let snapshot = load_json::<SignedSnapshot>(&snapshot_path()).ok();
    let stale = snapshot.is_none() || cached_snapshot_is_stale();
    let revision = snapshot
        .as_ref()
        .and_then(|snapshot| snapshot.payload.get("revision"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let project_id = std::env::current_dir().ok().and_then(|cwd| {
        load_from(&mappings_path()).ok().and_then(|mappings| {
            project_for_cwd(&mappings, &identity.organization_id, &cwd).map(str::to_owned)
        })
    });
    let enforcement = load_json::<Value>(&enforcement_path()).ok();
    let enforcement_revision = enforcement
        .as_ref()
        .and_then(|value| value.get("revision"))
        .and_then(Value::as_u64)
        .unwrap_or(revision);
    let mut candidates: Vec<(Value, u64)> = enforcement
        .as_ref()
        .and_then(|value| value.get("rules"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .cloned()
        .map(|rule| (rule, enforcement_revision))
        .collect();
    candidates.extend(
        snapshot
            .as_ref()
            .and_then(|snapshot| snapshot.payload.get("rules"))
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .cloned()
            .map(|rule| (rule, revision)),
    );
    let mut seen = HashSet::new();
    let rules = candidates
        .into_iter()
        .filter(|(rule, _)| {
            let id = rule
                .get("ruleId")
                .or_else(|| rule.get("id"))
                .and_then(Value::as_str)
                .unwrap_or("");
            seen.insert(id.to_owned())
        })
        .filter(|(rule, _)| rule.get("kind").and_then(Value::as_str) == Some("command"))
        .filter_map(|(rule, rule_revision)| {
            let definition = rule.get("definition")?;
            let decision = definition.get("decision")?.as_str()?;
            if stale && decision != "deny" {
                return None;
            }
            Some(json!({
                "argv_prefix": definition.get("argvPrefix")?,
                "backends": definition.get("backends").cloned().unwrap_or_else(|| json!([])),
                "decision": decision,
                "id": rule.get("ruleId").or_else(|| rule.get("id"))?,
                "justification": definition.get("justification")?,
                "project_ids": definition.get("projectIds").cloned().unwrap_or_else(|| json!([])),
                "revision": rule_revision,
                "scope": rule.get("level")?,
            }))
        })
        .collect();
    (Some(identity.organization_id), project_id, rules)
}

/// Resolved managed instruction rules for a turn, kept separate and labelled so
/// repository files remain untouched and their provenance stays visible.
pub fn managed_instruction_block(cwd: Option<&str>) -> Option<String> {
    let identity = load_json::<FleetIdentity>(&identity_path()).ok()?;
    let snapshot = load_json::<SignedSnapshot>(&snapshot_path()).ok()?;
    let project_id = cwd.and_then(|cwd| {
        load_from(&mappings_path()).ok().and_then(|mappings| {
            project_for_cwd(&mappings, &identity.organization_id, Path::new(cwd)).map(str::to_owned)
        })
    });
    let markdown: Vec<&str> = snapshot
        .payload
        .get("rules")?
        .as_array()?
        .iter()
        .filter(|rule| rule.get("kind").and_then(Value::as_str) == Some("instruction"))
        .filter(|rule| {
            rule.get("level").and_then(Value::as_str) != Some("project")
                || rule.get("projectId").and_then(Value::as_str) == project_id.as_deref()
        })
        .filter_map(|rule| {
            rule.get("definition")?
                .get("markdown")?
                .as_str()
                .filter(|value| !value.trim().is_empty())
        })
        .collect();
    (!markdown.is_empty()).then(|| {
        format!(
            "## Organization-managed instructions\n{}",
            markdown.join("\n\n")
        )
    })
}

pub fn spawn_reconciler(state: ServerState) {
    tokio::spawn(async move {
        loop {
            if !identity_path().exists() {
                match adopt_legacy_gateway(&state).await {
                    Ok(true) => tracing::info!("fleet: adopted legacy managed-node credential"),
                    Ok(false) => {
                        tokio::time::sleep(Duration::from_secs(RETRY_SECONDS)).await;
                        continue;
                    }
                    Err(error) => {
                        tracing::warn!("fleet: legacy node adoption failed: {error}");
                        tokio::time::sleep(Duration::from_secs(RETRY_SECONDS)).await;
                        continue;
                    }
                }
            }
            if identity_path().exists() {
                if let Err(error) = reconcile_once(&state).await {
                    let stale = cached_snapshot_is_stale();
                    if stale {
                        expire_managed_runtime(&state).await;
                    }
                    let status = if stale { "expired" } else { "offline-lkg" };
                    let local = FleetLocalStatus {
                        last_attempt_at: Some(Utc::now().to_rfc3339()),
                        last_error: Some(error.to_string()),
                        observed_revision: load_json::<FleetLocalStatus>(&status_path())
                            .map(|item| item.observed_revision)
                            .unwrap_or(0),
                        stale,
                        status: status.to_owned(),
                    };
                    if let Err(write_error) = atomic_json(&status_path(), &local, false) {
                        tracing::warn!("fleet: could not persist failure status: {write_error}");
                    }
                    tracing::warn!("fleet: reconciliation failed: {error}");
                    tokio::time::sleep(Duration::from_secs(RETRY_SECONDS)).await;
                }
            }
        }
    });
}

async fn expire_managed_runtime(state: &ServerState) {
    if let Ok(snapshot) = load_json::<SignedSnapshot>(&snapshot_path()) {
        if let Some(assignments) = snapshot
            .payload
            .get("assignments")
            .and_then(Value::as_array)
        {
            for assignment in assignments {
                let executable = assignment
                    .get("artifact")
                    .and_then(|artifact| artifact.get("kind"))
                    .and_then(Value::as_str)
                    .is_some_and(|kind| matches!(kind, "app" | "plugin"));
                if executable {
                    if let Some(id) = assignment
                        .get("artifact")
                        .and_then(|artifact| artifact.get("artifactId"))
                        .and_then(Value::as_str)
                    {
                        if let Err(error) = crate::server::apply_fleet_plugin_block(state, id).await
                        {
                            tracing::warn!(
                                "fleet: failed to disable expired artifact {id}: {error}"
                            );
                        }
                    }
                }
                let managed_skill = assignment
                    .get("artifact")
                    .and_then(|artifact| artifact.get("kind"))
                    .and_then(Value::as_str)
                    == Some("skill");
                if managed_skill {
                    if let Some(id) = assignment
                        .get("artifact")
                        .and_then(|artifact| artifact.get("artifactId"))
                        .and_then(Value::as_str)
                    {
                        if fleet_skill_dir(id)
                            .is_ok_and(|dir| dir.join(FLEET_SKILL_MARKER).is_file())
                        {
                            ryu_skills::set_active(id, false);
                        }
                    }
                }
            }
        }
    }
    if let Ok(mut configs) = managed_mcp_cache().write() {
        for config in configs.values_mut() {
            config.enabled = false;
        }
    }
    state.mcp.reload();
}

async fn fleet_status() -> (StatusCode, Json<Value>) {
    let identity = load_json::<FleetIdentity>(&identity_path()).ok();
    let status = load_json::<FleetLocalStatus>(&status_path()).unwrap_or_default();
    (
        StatusCode::OK,
        Json(json!({
            "enrolled": identity.is_some(),
            "nodeId": identity.as_ref().map(|value| &value.node_id),
            "organizationId": identity.as_ref().map(|value| &value.organization_id),
            "status": status,
        })),
    )
}

async fn export_stack() -> (StatusCode, Json<Value>) {
    let snapshot = match load_json::<SignedSnapshot>(&snapshot_path()) {
        Ok(snapshot) => snapshot,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "no verified fleet snapshot is available" })),
            );
        }
    };
    let items = snapshot
        .payload
        .get("assignments")
        .and_then(Value::as_array)
        .map(|assignments| {
            assignments
                .iter()
                .filter_map(|assignment| {
                    let artifact = assignment.get("artifact")?;
                    Some(json!({
                        "activation": assignment.get("activation"),
                        "artifactId": artifact.get("artifactId"),
                        "config": assignment.get("config").cloned().unwrap_or_else(|| json!({})),
                        "digest": artifact.get("digest"),
                        "disposition": assignment.get("disposition"),
                        "keyId": artifact.get("keyId"),
                        "kind": artifact.get("kind"),
                        "setupSlots": artifact.get("setupSlots").cloned().unwrap_or_else(|| json!([])),
                        "source": artifact.get("source"),
                        "version": artifact.get("version"),
                    }))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let rules = snapshot
        .payload
        .get("rules")
        .and_then(Value::as_array)
        .map(|rules| {
            rules
                .iter()
                .filter_map(|rule| {
                    Some(json!({
                        "definition": rule.get("definition")?,
                        "kind": rule.get("kind")?,
                        "locked": rule.get("locked").cloned().unwrap_or_else(|| json!(false)),
                        "ruleId": rule.get("ruleId").or_else(|| rule.get("id"))?,
                    }))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    (
        StatusCode::OK,
        Json(json!({
            "apiVersion": "ryu.dev/stack-template/v1",
            "items": items,
            "metadata": {
                "exportedAt": Utc::now().to_rfc3339(),
                "sourceRevision": snapshot.payload.get("revision"),
            },
            "projectAliases": [],
            "rules": rules,
        })),
    )
}

pub fn routes() -> Router<ServerState> {
    Router::new()
        .route("/api/fleet/enroll", axum::routing::post(enroll_node))
        .route("/api/fleet/stack/export", get(export_stack))
        .route("/api/fleet/status", get(fleet_status))
        .route(
            "/api/org-project-mappings",
            get(list_mappings).put(put_mapping).delete(delete_mapping),
        )
}

#[cfg(test)]
mod tests {
    use super::{
        canonicalize_json, fleet_skill_dir, project_for_cwd, validate_insert, verify_snapshot,
        FleetIdentity, ProjectMapping, SignedSnapshot,
    };
    use base64::Engine;
    use chrono::{Duration, Utc};
    use ed25519_dalek::{Signer, SigningKey};
    use serde_json::json;
    use std::path::Path;

    fn mapping(project: &str, root: &str) -> ProjectMapping {
        ProjectMapping {
            organization_id: "org".into(),
            project_id: project.into(),
            root: root.into(),
        }
    }

    #[test]
    fn longest_root_selects_project() {
        let mappings = vec![mapping("parent", "/repo"), mapping("child", "/repo/sub")];
        assert_eq!(
            project_for_cwd(&mappings, "org", Path::new("/repo/sub/src")),
            Some("child")
        );
    }

    #[test]
    fn overlapping_roots_for_different_projects_are_rejected() {
        let mappings = vec![mapping("one", "/repo")];
        assert!(validate_insert(&mappings, &mapping("two", "/repo/sub")).is_err());
    }

    #[test]
    fn same_mapping_is_idempotent() {
        let existing = mapping("one", "/repo");
        assert!(validate_insert(std::slice::from_ref(&existing), &existing).is_ok());
    }

    #[test]
    fn managed_skill_ids_cannot_escape_the_skills_directory() {
        assert!(fleet_skill_dir("portable-stack").is_ok());
        assert!(fleet_skill_dir("../escape").is_err());
        assert!(fleet_skill_dir("nested/skill").is_err());
        assert!(fleet_skill_dir("skill name").is_err());
    }

    fn signed_snapshot(node_id: &str, expires_at: String) -> (FleetIdentity, SignedSnapshot) {
        let signing_key = SigningKey::from_bytes(&[7; 32]);
        let public_key = base64::engine::general_purpose::STANDARD
            .encode(signing_key.verifying_key().as_bytes());
        let payload = json!({
            "expiresAt": expires_at,
            "nodeId": node_id,
            "revision": 4,
        });
        let signature = signing_key
            .sign(&serde_json::to_vec(&canonicalize_json(&payload)).expect("canonical payload"));
        let identity = FleetIdentity {
            control_plane_url: "https://control.example".into(),
            credential: "rfn_test".into(),
            node_id: "node-1".into(),
            organization_id: "org-1".into(),
            signing_private_key: String::new(),
            signing_public_key: String::new(),
            encryption_private_key: String::new(),
            encryption_public_key: String::new(),
            snapshot_public_key: public_key.clone(),
            credential_updated_at: None,
        };
        (
            identity,
            SignedSnapshot {
                payload,
                public_key,
                signature: base64::engine::general_purpose::STANDARD.encode(signature.to_bytes()),
            },
        )
    }

    #[test]
    fn snapshot_signature_is_bound_to_node() {
        let (identity, snapshot) =
            signed_snapshot("other-node", (Utc::now() + Duration::hours(1)).to_rfc3339());
        assert!(verify_snapshot(&identity, &snapshot).is_err());
    }

    #[test]
    fn expired_snapshot_is_rejected() {
        let (identity, snapshot) =
            signed_snapshot("node-1", (Utc::now() - Duration::seconds(1)).to_rfc3339());
        assert!(verify_snapshot(&identity, &snapshot).is_err());
    }

    #[test]
    fn valid_snapshot_returns_revision() {
        let (identity, snapshot) =
            signed_snapshot("node-1", (Utc::now() + Duration::hours(1)).to_rfc3339());
        assert_eq!(verify_snapshot(&identity, &snapshot).expect("verified"), 4);
    }
}
