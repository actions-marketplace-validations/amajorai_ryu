//! One-time migration of the legacy creative-canvas FILE store into the Canvas
//! Ryu App's Space documents.
//!
//! The built-in canvas persisted each board as `~/.ryu/canvases/<id>.json`
//! (`server/canvas.rs`, now removed). The feature was ported to a full-page
//! Companion (`@ryu/canvas`) which OWNS its boards as Space documents of kind
//! `app:@ryu/canvas`. This importer runs at startup: for every legacy file it
//! creates one app document in the "Canvas" system space, copies the board into the
//! doc `source` (the exact `{ name, nodes, edges, viewport }` shape the app reads
//! via `window.ryu.spaces.getDoc`), then renames the file to `<id>.json.migrated`
//! so it is imported exactly once (idempotent across restarts).

use std::path::PathBuf;

use serde_json::json;

use crate::paths::ryu_dir;
use crate::plugin_manifest::CANVAS_PLUGIN_ID;
use crate::server::spaces::SpaceStore;

fn canvases_dir() -> PathBuf {
    ryu_dir().join("canvases")
}

/// Whether `~/.ryu/canvases` holds at least one un-migrated `*.json` board.
///
/// The **precondition** for the import, hoisted out of [`migrate_legacy_canvases`]
/// so the caller can decide before doing anything observable. It exists because the
/// import's only input used to be a Space that boot created unconditionally:
/// `ensure_system_space("Canvas")` ran on every start, for every user, and THEN the
/// importer looked for legacy files and almost always found none. The visible cost
/// of that ordering was an undeletable, empty "Canvas" Space on machines that had
/// never installed the Canvas app — created fresh on the next boot after any reset.
///
/// Same predicate the importer applies (`*.json`, not `*.json.migrated`), so a
/// `true` here means the pass has real work and a `false` means it would have
/// migrated nothing. Cheap: one `read_dir`, short-circuiting on the first match,
/// and an absent directory — the case for every install that post-dates the App
/// port — is `false` without touching a file.
pub fn has_pending_legacy_canvases() -> bool {
    let Ok(entries) = std::fs::read_dir(canvases_dir()) else {
        return false; // no legacy store — nothing to import.
    };
    entries
        .flatten()
        .any(|entry| entry.path().extension().and_then(|e| e.to_str()) == Some("json"))
}

/// Import every legacy canvas file into `space_id` as a `@ryu/canvas` document.
/// Best-effort: a malformed file is skipped (and left in place) rather than
/// aborting the whole pass. Returns the number of boards migrated.
pub async fn migrate_legacy_canvases(store: &SpaceStore, space_id: &str) -> usize {
    let dir = canvases_dir();
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return 0; // no legacy store — nothing to do.
    };
    let mut migrated = 0usize;
    for entry in entries.flatten() {
        let path = entry.path();
        // Only untouched `*.json` files (skip already-migrated `*.json.migrated`).
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
            continue;
        };
        let name = value
            .get("name")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .unwrap_or("Untitled canvas")
            .to_owned();
        let nodes = value.get("nodes").cloned().unwrap_or_else(|| json!([]));
        let edges = value.get("edges").cloned().unwrap_or_else(|| json!([]));
        let viewport = value.get("viewport").cloned();
        // The app's scene shape: { name, nodes, edges, viewport? }.
        let mut scene = json!({ "name": name, "nodes": nodes, "edges": edges });
        if let Some(vp) = viewport {
            scene["viewport"] = vp;
        }
        let source = scene.to_string();

        match store
            .app_create_doc(
                CANVAS_PLUGIN_ID,
                space_id,
                &name,
                &crate::server::spaces::background_owner(),
            )
            .await
        {
            Ok(doc_id) => {
                if let Err(e) = store
                    .app_update_doc(CANVAS_PLUGIN_ID, &doc_id, Some(&name), &source)
                    .await
                {
                    tracing::warn!("canvas migrate: write '{}' failed: {e}", name);
                    continue;
                }
                // Rename so a restart never re-imports it.
                let done = path.with_extension("json.migrated");
                if let Err(e) = std::fs::rename(&path, &done) {
                    tracing::warn!("canvas migrate: mark-done failed for {path:?}: {e}");
                }
                migrated += 1;
            }
            Err(e) => tracing::warn!("canvas migrate: create doc for '{}' failed: {e}", name),
        }
    }
    if migrated > 0 {
        tracing::info!("canvas migrate: imported {migrated} legacy board(s) into the Canvas space");
    }
    migrated
}
