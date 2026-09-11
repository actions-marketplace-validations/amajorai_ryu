use std::sync::Arc;

use anyhow::{ensure, Context, Result};
use ryu_backup::{BackupScope, CreateBackup};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::{
    backups::{global, BackupService},
    tool_exec::InvokeOutcome,
};

use super::{err, ok, PluginHookBridge};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AppBackupInput {
    destination_id: String,
    #[serde(default = "default_namespace")]
    namespace: String,
    #[serde(default)]
    idempotency_key: Option<String>,
    #[serde(default)]
    data: Option<Value>,
    #[serde(default)]
    backup_id: Option<String>,
    #[serde(default)]
    operation_id: Option<String>,
}

fn default_namespace() -> String {
    "default".into()
}

impl PluginHookBridge {
    pub(super) async fn backups(&self, method: &str, args: Value) -> InvokeOutcome {
        if !self.grants.contains("backups:app") {
            return err("backups:app is not granted".into());
        }
        let result: Result<Value> = async {
            let service = global().await?;
            if method == "backups_destinations" {
                return Ok(json!(service
                    .destinations()
                    .await
                    .into_iter()
                    .filter(|d| d.allowed_apps.contains(&self.plugin_id))
                    .map(|d| json!({ "id": d.id, "name": d.name }))
                    .collect::<Vec<_>>()));
            }
            let input: AppBackupInput =
                serde_json::from_value(args).context("Invalid app backup arguments")?;
            ensure!(
                !input.namespace.is_empty()
                    && input.namespace.len() <= 128
                    && input
                        .namespace
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_')),
                "Invalid backup namespace"
            );
            let (destination, s3) = service.destination(&input.destination_id).await?;
            ensure!(
                destination.allowed_apps.contains(&self.plugin_id),
                "This destination is not shared with the app"
            );
            let tenant = hex::encode(Sha256::digest(self.storage_namespace("backups").as_bytes()));
            // Neither identity nor scope is accepted from the app's arguments.
            let scope = BackupScope::App {
                app_id: self.plugin_id.clone(),
                namespace: input.namespace,
                tenant,
            };
            match method {
                "backups_create" => {
                    let operation = service
                        .create(
                            self.state.clone(),
                            CreateBackup {
                                destination_id: input.destination_id,
                                scope,
                                idempotency_key: input
                                    .idempotency_key
                                    .context("idempotencyKey is required")?,
                            },
                            Some(input.data.context("data is required")?),
                        )
                        .await?;
                    Ok(serde_json::to_value(operation)?)
                }
                "backups_list" => Ok(serde_json::to_value(
                    s3.list(Some(&scope))
                        .await
                        .context("App backup catalog is unavailable")?,
                )?),
                "backups_get" => {
                    let operation = service
                        .operation(&input.operation_id.context("operationId is required")?)
                        .await
                        .context("Operation not found")?;
                    ensure!(
                        operation.scope == scope
                            && operation.destination_id == input.destination_id,
                        "Operation does not belong to this app and tenant"
                    );
                    Ok(serde_json::to_value(operation)?)
                }
                "backups_restore" => {
                    restore(
                        &service,
                        &input.destination_id,
                        input.backup_id.context("backupId is required")?,
                        &scope,
                    )
                    .await
                }
                _ => anyhow::bail!("Unknown backup method"),
            }
        }
        .await;
        match result {
            Ok(value) => ok(value),
            Err(error) => err(error.to_string()),
        }
    }
}

async fn restore(
    service: &Arc<BackupService>,
    destination: &str,
    id: String,
    scope: &BackupScope,
) -> Result<Value> {
    service.restore_app(destination, &id, scope).await
}
