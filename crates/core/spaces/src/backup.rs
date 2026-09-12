//! Complete source backups, distinct from Markdown-only portable interchange.
//! Includes whiteboards, app documents, row pages and content-addressed files.

use std::{
    collections::{HashMap, HashSet},
    fs::File,
    io::{Read, Write},
    path::PathBuf,
};

use anyhow::{ensure, Context, Result};
use rusqlite::{named_params, params};
use serde::{Deserialize, Serialize};
use zip::{write::FileOptions, ZipArchive, ZipWriter};

use super::{
    blob_path, now_millis, upsert_document_row, upsert_space_row, DocFilter, DocOwner, SpaceStore,
    DOC_TENANCY_VISIBLE_PREDICATE,
};

const MAX_SOURCE_BYTES: u64 = 128 * 1024 * 1024;
const MAX_DOCUMENTS: usize = 100_000;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SpaceSnapshot {
    version: u32,
    name: String,
    description: Option<String>,
    retrieval_mode: String,
    icon: Option<String>,
    documents: Vec<SnapshotDocument>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SnapshotDocument {
    id: String,
    title: String,
    source: String,
    kind: String,
    parent_id: Option<String>,
    mime: Option<String>,
    sha256: Option<String>,
    byte_size: Option<i64>,
    icon: Option<String>,
    created_at: i64,
    updated_at: i64,
}

fn valid_sha(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

impl SpaceStore {
    pub async fn export_backup(
        &self,
        space_id: &str,
        filter: DocFilter<'_>,
        output: PathBuf,
    ) -> Result<()> {
        let space_id = space_id.to_owned();
        let bound = filter.bound_flag();
        let user = filter.owner_user_id.map(str::to_owned);
        let org = filter.org_id.map(str::to_owned);
        let teams = filter.team_ids_json;
        let conn = self.conn.clone().lock_owned().await;
        let blob_root = self.blob_root.clone();
        tokio::task::spawn_blocking(move || {
            let mut snapshot = conn.query_row("SELECT name, description, retrieval_mode, icon FROM spaces WHERE id = ?1", [&space_id], |row| Ok(SpaceSnapshot {
                version: 1, name: row.get(0)?, description: row.get(1)?, retrieval_mode: row.get(2)?, icon: row.get(3)?, documents: vec![],
            }))?;
            let sql = format!("SELECT d.id, d.title, d.source, d.kind, d.parent_id, d.mime, d.blob_sha256, d.byte_size, d.icon, d.created_at, d.updated_at FROM documents d WHERE d.space_id = :space_id AND {DOC_TENANCY_VISIBLE_PREDICATE} ORDER BY d.created_at, d.id LIMIT {}", MAX_DOCUMENTS + 1);
            let mut statement = conn.prepare(&sql)?;
            let mut rows = statement.query(named_params! { ":space_id": space_id, ":bound": bound, ":uid": user, ":org": org, ":teams": teams })?;
            let mut bytes = 0u64;
            while let Some(row) = rows.next()? {
                let document = SnapshotDocument { id: row.get(0)?, title: row.get(1)?, source: row.get(2)?, kind: row.get(3)?, parent_id: row.get(4)?, mime: row.get(5)?, sha256: row.get(6)?, byte_size: row.get(7)?, icon: row.get(8)?, created_at: row.get(9)?, updated_at: row.get(10)? };
                bytes += document.source.len() as u64 + document.title.len() as u64 + 2048;
                ensure!(bytes <= MAX_SOURCE_BYTES && snapshot.documents.len() < MAX_DOCUMENTS, "Space backup exceeds its source/document limit");
                snapshot.documents.push(document);
            }
            let mut zip = ZipWriter::new(File::create(output)?);
            let options = FileOptions::default().compression_method(zip::CompressionMethod::Deflated).unix_permissions(0o600).large_file(true);
            zip.start_file("space.json", options)?;
            serde_json::to_writer(&mut zip, &snapshot)?;
            let mut blobs = HashSet::new();
            for document in &snapshot.documents {
                if let Some(sha) = &document.sha256 {
                    ensure!(valid_sha(sha), "Invalid Space file hash");
                    if !blobs.insert(sha.clone()) { continue; }
                    let path = blob_path(&blob_root, sha);
                    ensure!(ryu_backup::encryption::sha256(File::open(&path)?)? == *sha, "Space file checksum mismatch");
                    zip.start_file(format!("blobs/{sha}"), options)?;
                    std::io::copy(&mut File::open(path)?, &mut zip)?;
                }
            }
            zip.finish()?.sync_all()?;
            Ok(())
        }).await?
    }

    /// Fully validate and stage binary data before a single SQL transaction
    /// creates a new private Space. Original documents are never overwritten.
    pub async fn restore_backup(
        &self,
        archive: PathBuf,
        owner: DocOwner,
        name: Option<String>,
    ) -> Result<String> {
        let conn = self.conn.clone();
        let blob_root = self.blob_root.clone();
        tokio::task::spawn_blocking(move || {
            let mut zip = ZipArchive::new(File::open(archive)?)?;
            ensure!(
                zip.len() <= MAX_DOCUMENTS + 1,
                "Too many Space backup files"
            );
            let mut manifest = zip.by_name("space.json")?;
            ensure!(
                manifest.size() <= MAX_SOURCE_BYTES,
                "Space backup manifest is too large"
            );
            let mut bytes = Vec::new();
            (&mut manifest)
                .take(MAX_SOURCE_BYTES + 1)
                .read_to_end(&mut bytes)?;
            ensure!(
                bytes.len() as u64 <= MAX_SOURCE_BYTES,
                "Space backup manifest is too large"
            );
            let snapshot: SpaceSnapshot = serde_json::from_slice(&bytes)?;
            drop(manifest);
            ensure!(
                snapshot.version == 1 && snapshot.documents.len() <= MAX_DOCUMENTS,
                "Unsupported Space backup"
            );
            ensure!(
                matches!(snapshot.retrieval_mode.as_str(), "vector" | "graph"),
                "Invalid retrieval mode"
            );
            let name = name.unwrap_or_else(|| format!("{} (restored)", snapshot.name));
            ensure!(
                !name.trim().is_empty() && name.len() <= 512,
                "Invalid restored Space name"
            );
            let mut ids = HashMap::new();
            for doc in &snapshot.documents {
                ensure!(
                    uuid::Uuid::parse_str(&doc.id).is_ok() && !ids.contains_key(&doc.id),
                    "Invalid or duplicate document ID"
                );
                super::validate_document_metadata(&doc.title, None)?;
                ensure!(
                    matches!(
                        doc.kind.as_str(),
                        "page" | "database" | "whiteboard" | "file"
                    ) || (doc.kind.starts_with("app:") && doc.kind.len() <= 160),
                    "Invalid document kind"
                );
                ids.insert(doc.id.clone(), uuid::Uuid::new_v4().to_string());
            }
            for doc in &snapshot.documents {
                if let Some(parent) = &doc.parent_id {
                    ensure!(
                        ids.contains_key(parent) && parent != &doc.id,
                        "Invalid document parent"
                    );
                }
                if doc.kind == "file" {
                    let sha = doc
                        .sha256
                        .as_deref()
                        .filter(|v| valid_sha(v))
                        .context("Invalid file hash")?;
                    let mut entry = zip.by_name(&format!("blobs/{sha}"))?;
                    let length = doc
                        .byte_size
                        .filter(|v| *v >= 0)
                        .context("Invalid file size")? as u64;
                    ensure!(
                        entry.size() == length && length <= ryu_backup::archive::MAX_ARCHIVE_BYTES,
                        "File size mismatch"
                    );
                    let destination = blob_path(&blob_root, sha);
                    ryu_backup::archive::private_directory(
                        destination.parent().context("Invalid blob path")?,
                    )?;
                    let mut output = tempfile::NamedTempFile::new_in(
                        destination.parent().context("Invalid blob path")?,
                    )?;
                    ensure!(
                        std::io::copy(&mut (&mut entry).take(length + 1), &mut output)? == length,
                        "Incomplete Space file"
                    );
                    output.flush()?;
                    ensure!(
                        ryu_backup::encryption::sha256(File::open(output.path())?)? == sha,
                        "Space file checksum mismatch"
                    );
                    output.as_file().sync_all()?;
                    if destination.exists() {
                        ensure!(
                            ryu_backup::encryption::sha256(File::open(&destination)?)? == sha,
                            "Existing Space blob is damaged"
                        );
                    } else {
                        output.persist_noclobber(&destination)?;
                    }
                }
            }
            let mut conn = conn.blocking_lock();
            let transaction = conn.transaction()?;
            let space_id = uuid::Uuid::new_v4().to_string();
            upsert_space_row(
                &transaction,
                &space_id,
                &name,
                snapshot.description.as_deref(),
                now_millis(),
                &snapshot.retrieval_mode,
                0,
                &owner,
            )?;
            transaction.execute(
                "UPDATE spaces SET icon = ?1 WHERE id = ?2",
                params![snapshot.icon, space_id],
            )?;
            for doc in &snapshot.documents {
                let id = &ids[&doc.id];
                let parent = doc
                    .parent_id
                    .as_ref()
                    .and_then(|v| ids.get(v))
                    .map(String::as_str);
                let mut source = doc.source.clone();
                for (old, new) in &ids {
                    source = source.replace(old, new);
                }
                upsert_document_row(
                    &transaction,
                    id,
                    &space_id,
                    &doc.title,
                    doc.created_at,
                    &source,
                    &doc.kind,
                    parent,
                    doc.mime.as_deref(),
                    doc.sha256.as_deref(),
                    doc.byte_size,
                    &owner,
                )?;
                transaction.execute(
                    "UPDATE documents SET icon = ?1, updated_at = ?2 WHERE id = ?3",
                    params![doc.icon, doc.updated_at, id],
                )?;
                super::store_doc_links(&transaction, &space_id, id, &source, now_millis())?;
            }
            transaction.commit()?;
            Ok(space_id)
        })
        .await?
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn preserves_all_document_kinds_files_and_parent_links_in_a_new_private_space() {
        let store = SpaceStore::open_in_memory().unwrap();
        let owner = DocOwner::owned(Some("alice"), Some("org"));
        let space = store
            .create_space("Recovery source", Some("Full source"), &owner)
            .await
            .unwrap();
        let database = store
            .import_document(&space, "Tasks", "{\"rows\":[]}", "database", None, &owner)
            .await
            .unwrap();
        let page = store
            .import_document(
                &space,
                "Task note",
                "Original note",
                "page",
                Some(&database),
                &owner,
            )
            .await
            .unwrap();
        let whiteboard = store
            .create_whiteboard(&space, "Drawing", &owner)
            .await
            .unwrap();
        let app = store
            .app_create_doc("com.example.app", &space, "App record", &owner)
            .await
            .unwrap();
        let file = uuid::Uuid::new_v4().to_string();
        let sha = super::super::write_blob(&store.blob_root, b"original binary\0bytes").unwrap();
        {
            let conn = store.conn.lock().await;
            upsert_document_row(
                &conn,
                &file,
                &space,
                "file.bin",
                now_millis(),
                "File descriptor",
                "file",
                None,
                Some("application/octet-stream"),
                Some(&sha),
                Some(21),
                &owner,
            )
            .unwrap();
            conn.execute(
                "UPDATE documents SET source = ?1 WHERE id = ?2",
                params![format!("{{\"pageId\":\"{page}\"}}"), database],
            )
            .unwrap();
        }
        let temporary = tempfile::tempdir().unwrap();
        let path = temporary.path().join("space.zip");
        store
            .export_backup(&space, DocFilter::unrestricted(), path.clone())
            .await
            .unwrap();
        let restored = store
            .restore_backup(path, DocOwner::owned(Some("bob"), Some("org")), None)
            .await
            .unwrap();
        assert_ne!(restored, space);
        let conn = store.conn.lock().await;
        let (count, kinds): (i64, String) = conn
            .query_row(
                "SELECT COUNT(*), group_concat(kind) FROM documents WHERE space_id = ?1",
                [&restored],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(count, 5);
        for kind in [
            "page",
            "database",
            "whiteboard",
            "app:com.example.app",
            "file",
        ] {
            assert!(kinds.contains(kind));
        }
        let source: String = conn
            .query_row(
                "SELECT source FROM documents WHERE space_id = ?1 AND kind = 'database'",
                [&restored],
                |row| row.get(0),
            )
            .unwrap();
        let child: String = conn
            .query_row(
                "SELECT id FROM documents WHERE space_id = ?1 AND kind = 'page'",
                [&restored],
                |row| row.get(0),
            )
            .unwrap();
        assert!(source.contains(&child));
        assert!(!source.contains(&page));
        let (visibility, user): (String, String) = conn
            .query_row(
                "SELECT visibility, owner_user_id FROM spaces WHERE id = ?1",
                [&restored],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!((visibility.as_str(), user.as_str()), ("private", "bob"));
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM documents WHERE space_id = ?1",
                [&space],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            5
        );
        drop(conn);
        assert!(store.get_document(&whiteboard).await.unwrap().is_some());
        assert!(store
            .app_get_doc("com.example.app", &app)
            .await
            .unwrap()
            .is_some());
    }

    #[tokio::test]
    async fn corrupt_space_file_does_not_create_a_partial_space() {
        let store = SpaceStore::open_in_memory().unwrap();
        let temp = tempfile::tempdir().unwrap();
        let archive = temp.path().join("bad.zip");
        let snapshot = SpaceSnapshot {
            version: 1,
            name: "Bad".into(),
            description: None,
            retrieval_mode: "vector".into(),
            icon: None,
            documents: vec![SnapshotDocument {
                id: uuid::Uuid::new_v4().to_string(),
                title: "file.bin".into(),
                source: "".into(),
                kind: "file".into(),
                parent_id: None,
                mime: Some("application/octet-stream".into()),
                sha256: Some("0".repeat(64)),
                byte_size: Some(3),
                icon: None,
                created_at: 0,
                updated_at: 0,
            }],
        };
        let mut zip = ZipWriter::new(File::create(&archive).unwrap());
        zip.start_file("space.json", FileOptions::default())
            .unwrap();
        serde_json::to_writer(&mut zip, &snapshot).unwrap();
        zip.start_file(format!("blobs/{}", "0".repeat(64)), FileOptions::default())
            .unwrap();
        zip.write_all(b"bad").unwrap();
        zip.finish().unwrap();
        assert!(store
            .restore_backup(archive, DocOwner::unattributed(), None)
            .await
            .is_err());
        assert!(store
            .list_spaces(DocFilter::unrestricted())
            .await
            .unwrap()
            .is_empty());
    }
}
