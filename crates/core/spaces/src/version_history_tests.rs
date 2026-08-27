use super::*;

fn applied(outcome: DocumentUpdateOutcome) -> DocumentUpdateResult {
    match outcome {
        DocumentUpdateOutcome::Applied(result) => result,
        DocumentUpdateOutcome::Conflict { current_revision } => {
            panic!("unexpected revision conflict at {current_revision}")
        }
    }
}

fn owner() -> DocOwner {
    DocOwner::owned(Some("alice"), Some("org1"))
}

#[tokio::test]
async fn records_coalesced_retry_safe_updates() {
    let store = SpaceStore::open_in_memory().unwrap();
    let space_id = store.create_space("History", None, &owner()).await.unwrap();
    let document_id = store
        .ingest_document(&space_id, "Plan", "Original", &owner())
        .await
        .unwrap();

    let first = applied(
        store
            .update_document_versioned(
                &document_id,
                "Plan",
                "First edit",
                Some(0),
                Some("edit-1"),
                Some("alice"),
            )
            .await
            .unwrap(),
    );
    assert_eq!(first.revision, 1);

    let second = applied(
        store
            .update_document_versioned(
                &document_id,
                "Plan",
                "Second edit",
                Some(1),
                Some("edit-2"),
                Some("alice"),
            )
            .await
            .unwrap(),
    );
    assert_eq!(second.revision, 2);

    let versions = store.list_document_versions(&document_id).await.unwrap();
    assert_eq!(versions.len(), 3, "creation plus two Git checkpoints");
    let automatic = versions
        .iter()
        .find(|version| version.capture_type == "git")
        .unwrap();
    assert_eq!(automatic.revision, 2);
    let mut has_latest_source = false;
    for version in versions
        .iter()
        .filter(|version| version.capture_type == "git")
    {
        if let Some(full) = store
            .get_source_history_version(&document_id, &version.id)
            .await
            .unwrap()
        {
            if full.source == "Second edit" {
                has_latest_source = true;
                break;
            }
        }
    }
    assert!(has_latest_source, "Git history contains the latest source");

    let retry = applied(
        store
            .update_document_versioned(
                &document_id,
                "Plan",
                "must not replace the accepted retry",
                Some(0),
                Some("edit-2"),
                Some("alice"),
            )
            .await
            .unwrap(),
    );
    assert!(retry.duplicate);
    assert_eq!(retry.revision, 2);

    let conflict = store
        .update_document_versioned(
            &document_id,
            "Plan",
            "stale overwrite",
            Some(0),
            Some("edit-3"),
            Some("alice"),
        )
        .await
        .unwrap();
    assert!(matches!(
        conflict,
        DocumentUpdateOutcome::Conflict {
            current_revision: 2
        }
    ));
    assert_eq!(
        store
            .get_document(&document_id)
            .await
            .unwrap()
            .unwrap()
            .source,
        "Second edit"
    );
}

#[tokio::test]
async fn restore_is_guarded_and_idempotent() {
    let store = SpaceStore::open_in_memory().unwrap();
    let space_id = store.create_space("History", None, &owner()).await.unwrap();
    let document_id = store
        .ingest_document(&space_id, "Plan", "Original", &owner())
        .await
        .unwrap();
    applied(
        store
            .update_document_versioned(
                &document_id,
                "Plan",
                "Draft",
                Some(0),
                Some("draft"),
                Some("alice"),
            )
            .await
            .unwrap(),
    );
    let named = store
        .snapshot_document_as(&document_id, Some("Ready for review"), Some("alice"))
        .await
        .unwrap();
    applied(
        store
            .update_document_versioned(
                &document_id,
                "Plan",
                "Published",
                Some(1),
                Some("publish"),
                Some("alice"),
            )
            .await
            .unwrap(),
    );

    let restored = applied(
        store
            .restore_document_version_versioned(
                &document_id,
                &named.id,
                2,
                "restore-1",
                Some("alice"),
            )
            .await
            .unwrap(),
    );
    assert_eq!(restored.revision, 3);
    assert_eq!(
        store
            .get_document(&document_id)
            .await
            .unwrap()
            .unwrap()
            .source,
        "Draft"
    );

    let versions = store.list_document_versions(&document_id).await.unwrap();
    assert_eq!(
        versions
            .iter()
            .filter(|version| version.capture_type == "git")
            .count(),
        6,
        "Git records creation, named, guard, and restore checkpoints"
    );
    assert!(versions
        .iter()
        .any(|version| version.label.as_deref() == Some("Ready for review")));
    assert!(versions
        .iter()
        .any(|version| version.label.as_deref() == Some("Before restore")));
    assert!(versions
        .iter()
        .any(|version| version.label.as_deref() == Some("Restore document version")));

    let retry = applied(
        store
            .restore_document_version_versioned(
                &document_id,
                &named.id,
                2,
                "restore-1",
                Some("alice"),
            )
            .await
            .unwrap(),
    );
    assert!(retry.duplicate);
    assert_eq!(retry.revision, 3);
    assert_eq!(
        store
            .list_document_versions(&document_id)
            .await
            .unwrap()
            .iter()
            .filter(|version| version.capture_type == "git")
            .count(),
        6
    );
}
