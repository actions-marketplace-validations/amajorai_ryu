use super::*;

#[tokio::test]
async fn operation_idempotency_is_scoped_and_conflicts_fail_closed() {
    let directory = tempfile::tempdir().unwrap();
    let service = BackupService::open(directory.path().to_owned()).unwrap();
    let scope = BackupScope::Node;
    let (first, created) = service
        .begin("dest", &scope, "backup", "same-key", "hash-a".into())
        .await
        .unwrap();
    assert!(created);
    let (retry, created) = service
        .begin("dest", &scope, "backup", "same-key", "hash-a".into())
        .await
        .unwrap();
    assert!(!created);
    assert_eq!(retry.id, first.id);
    assert!(service
        .begin("dest", &scope, "backup", "same-key", "hash-b".into())
        .await
        .is_err());
    assert!(service
        .begin("dest", &scope, "restore", "same-key", "hash-a".into())
        .await
        .is_err());
    let app = BackupScope::App {
        app_id: "@ryu/example".into(),
        namespace: "default".into(),
        tenant: "alice".into(),
    };
    let (_, created) = service
        .begin("dest", &app, "backup", "same-key", "hash-a".into())
        .await
        .unwrap();
    assert!(created);
    drop(service);
    let restarted = BackupService::open(directory.path().to_owned()).unwrap();
    let recovered = restarted.operation(&first.id).await.unwrap();
    assert_eq!(recovered.status, "failed");
    assert!(recovered.error.unwrap().contains("interrupted"));
}

#[test]
fn malformed_state_is_never_overwritten_with_empty_defaults() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("backups");
    std::fs::create_dir(&path).unwrap();
    let original = b"{\"version\":999}";
    std::fs::write(path.join("state.json"), original).unwrap();
    assert!(BackupService::open(directory.path().to_owned()).is_err());
    assert_eq!(std::fs::read(path.join("state.json")).unwrap(), original);
}

#[test]
fn backup_boundaries_exclude_identity_and_staging_but_preserve_source_history_and_app_data() {
    for value in [
        "core.token",
        "plugins/node-auth.token",
        "backups",
        "cache",
        "master.key",
        "fleet-identity.json",
    ] {
        assert!(node_excluded(Path::new(value)), "{value}");
    }
    for value in [
        "conversations.db",
        "models/custom-model.gguf",
        "blobs",
        "source-history",
        "app-data/config.json",
        "source-history/Cargo.lock",
    ] {
        assert!(!node_excluded(Path::new(value)), "{value}");
    }
}

#[test]
fn retention_never_prunes_another_node_or_an_unknown_source() {
    let record = |source: &str, id: &str| BackupRecord {
        version: 1,
        id: id.into(),
        source_node_id: source.into(),
        scope: BackupScope::Node,
        created_at: now(),
        bytes: 0,
        sha256: "hash".into(),
        object_key: "key".into(),
    };
    let candidates = retained_candidates(
        vec![
            record("alice-node", "a"),
            record("bob-node", "b"),
            record("", "legacy"),
        ],
        "alice-node",
    );
    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].id, "a");
    assert!(retained_candidates(vec![record("", "legacy")], "").is_empty());
}

#[test]
fn restore_request_defaults_to_live_and_accepts_a_dry_run() {
    let live: super::RestoreBackup = serde_json::from_value(serde_json::json!({
        "destinationId": "destination",
        "backupId": "backup",
        "idempotencyKey": "request"
    }))
    .unwrap();
    assert!(!live.dry_run);

    let preview: super::RestoreBackup = serde_json::from_value(serde_json::json!({
        "destinationId": "destination",
        "backupId": "backup",
        "idempotencyKey": "request",
        "dryRun": true
    }))
    .unwrap();
    assert!(preview.dry_run);
}
