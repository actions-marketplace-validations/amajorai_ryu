//! A small, local Git-backed history primitive for source artifacts.
//!
//! The repository is owned by the caller (Core normally points it at
//! `RYU_DIR/source-history`). Callers decide which source file represents a
//! resource; this module only provides checkpoint, list, read, and path-safe
//! Git operations. It deliberately does not know about Spaces, agents, skills,
//! or workflows, so the existing generic VersionHistory UI can use one history
//! contract across all of them.

use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};

use crate::win_process::NoWindow;

const MAX_HISTORY_PATH_BYTES: usize = 1024;
const MAX_HISTORY_LABEL_BYTES: usize = 240;
const DEFAULT_HISTORY_LIMIT: usize = 200;
const SOURCE_PATH_TRAILER: &str = "Ryu-Source-Path:";

static SOURCE_HISTORY_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

/// One immutable Git checkpoint, shaped for the existing version-history UIs.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct SourceHistoryVersion {
    pub created_at: i64,
    pub id: String,
    pub label: Option<String>,
}

/// Git-backed source history rooted at one local repository.
#[derive(Debug, Clone)]
pub struct SourceHistory {
    root: PathBuf,
}

impl SourceHistory {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    /// Write one source file and checkpoint it as an immutable Git commit.
    ///
    /// An unlabeled checkpoint with unchanged bytes is idempotent: it returns the
    /// existing latest commit. An explicit label creates a named Git checkpoint
    /// even when the source bytes are unchanged, preserving the existing snapshot
    /// API without pretending that a named action was a new content revision.
    /// Commit identity is explicit and local, so this never depends on the user's
    /// global Git configuration.
    pub fn checkpoint(
        &self,
        relative_path: &str,
        content: &str,
        label: Option<&str>,
    ) -> std::io::Result<SourceHistoryVersion> {
        validate_relative_path(relative_path)?;
        let _guard = source_history_lock()?;
        self.ensure_repository()?;
        let destination = self.root.join(relative_path);
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&destination, content.as_bytes())?;

        self.run_git(&["add", "--", relative_path])?;
        let changed = self.run_git_status(&["diff", "--cached", "--quiet", "--", relative_path])?;
        if changed > 1 {
            return Err(io_error("could not inspect the staged source checkpoint"));
        }
        let has_label = label.is_some_and(|value| !value.trim().is_empty());
        if changed == 0 && !has_label {
            return self
                .latest_for_path(relative_path)?
                .ok_or_else(|| io_error("Git source history has no checkpoint"));
        }

        let subject = commit_subject(label);
        let trailer = format!("{SOURCE_PATH_TRAILER} {relative_path}");
        let mut commit = git_command(&self.root);
        commit
            .args([
                "-c",
                "user.name=Ryu",
                "-c",
                "user.email=local@ryu.dev",
                "-c",
                "commit.gpgSign=false",
                "commit",
                "--no-verify",
            ])
            .args((changed == 0).then_some("--allow-empty"))
            .args([
                "--only",
                "-m",
                subject.as_str(),
                "-m",
                trailer.as_str(),
                "--",
            ])
            .arg(relative_path)
            .current_dir(&self.root);
        let output = commit.output()?;
        if !output.status.success() {
            return Err(command_error("commit", &output));
        }
        self.latest_for_path(relative_path)?
            .ok_or_else(|| io_error("Git commit completed without a readable checkpoint"))
    }

    /// List recent checkpoints for one source path, newest first.
    pub fn list(
        &self,
        relative_path: &str,
        limit: Option<usize>,
    ) -> std::io::Result<Vec<SourceHistoryVersion>> {
        validate_relative_path(relative_path)?;
        let _guard = source_history_lock()?;
        if !self.is_repository() {
            return Ok(Vec::new());
        }
        let count = limit.unwrap_or(DEFAULT_HISTORY_LIMIT).clamp(1, 1000);
        self.list_unlocked(relative_path, count)
    }

    /// Read one source file at a historical commit. A missing commit/path is
    /// returned as `None`, matching the existing version-store behavior.
    pub fn read(&self, relative_path: &str, version_id: &str) -> std::io::Result<Option<String>> {
        validate_relative_path(relative_path)?;
        validate_version_id(version_id)?;
        let _guard = source_history_lock()?;
        if !self.is_repository() {
            return Ok(None);
        }
        let spec = format!("{version_id}:{relative_path}");
        // Keep the revision and path in one validated `commit:path` argument.
        // Passing it after `--` would make Git interpret it as a pathspec rather
        // than a revision on some versions.
        let mut command = git_command(&self.root);
        command.arg("show").arg(spec).current_dir(&self.root);
        let output = command.output()?;
        if !output.status.success() {
            return Ok(None);
        }
        String::from_utf8(output.stdout)
            .map(Some)
            .map_err(|error| io_error(&format!("Git history is not UTF-8: {error}")))
    }

    /// Return the managed repository root, useful for diagnostics and export
    /// surfaces that want to point a user at the local source tree.
    pub fn root(&self) -> &Path {
        &self.root
    }

    fn ensure_repository(&self) -> std::io::Result<()> {
        if self.is_repository() {
            return Ok(());
        }
        std::fs::create_dir_all(&self.root)?;
        let mut command = git_command(&self.root);
        command.args(["init", "-b", "main"]).current_dir(&self.root);
        let output = command.output()?;
        if output.status.success() {
            Ok(())
        } else {
            Err(command_error("init", &output))
        }
    }

    fn is_repository(&self) -> bool {
        self.root.join(".git").is_dir()
    }

    fn run_git(&self, args: &[&str]) -> std::io::Result<()> {
        let mut command = git_command(&self.root);
        command.args(args).current_dir(&self.root);
        let output = command.output()?;
        if output.status.success() {
            Ok(())
        } else {
            Err(command_error(
                args.first().copied().unwrap_or("Git"),
                &output,
            ))
        }
    }

    fn run_git_status(&self, args: &[&str]) -> std::io::Result<i32> {
        let mut command = git_command(&self.root);
        command.args(args).current_dir(&self.root);
        Ok(command.output()?.status.code().unwrap_or(1))
    }

    fn run_git_text(&self, args: &[&str]) -> std::io::Result<String> {
        let mut command = git_command(&self.root);
        command.args(args).current_dir(&self.root);
        let output = command.output()?;
        if output.status.success() {
            String::from_utf8(output.stdout)
                .map_err(|error| io_error(&format!("Git output is not UTF-8: {error}")))
        } else if args.first().copied() == Some("log")
            && String::from_utf8_lossy(&output.stderr).contains("does not have any commits yet")
        {
            Ok(String::new())
        } else {
            Err(command_error(
                args.first().copied().unwrap_or("Git"),
                &output,
            ))
        }
    }

    fn latest_for_path(
        &self,
        relative_path: &str,
    ) -> std::io::Result<Option<SourceHistoryVersion>> {
        Ok(self.list_unlocked(relative_path, 1)?.into_iter().next())
    }

    fn list_unlocked(
        &self,
        relative_path: &str,
        limit: usize,
    ) -> std::io::Result<Vec<SourceHistoryVersion>> {
        let format = "%H%x1f%ct%x1f%s%x1f%b%x1e";
        let format_arg = format!("--format={format}");
        let all_commits = self.run_git_text(&["log", "--date=unix", &format_arg])?;
        let path_commits =
            self.run_git_text(&["log", "--date=unix", &format_arg, "--", relative_path])?;
        let mut versions = parse_history_lines(&all_commits, Some(relative_path))?;
        let mut seen = versions
            .iter()
            .map(|version| version.id.clone())
            .collect::<HashSet<_>>();
        for version in parse_history_lines(&path_commits, None)? {
            if seen.insert(version.id.clone()) {
                versions.push(version);
            }
        }
        versions.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        versions.truncate(limit);
        Ok(versions)
    }
}

fn source_history_lock() -> std::io::Result<std::sync::MutexGuard<'static, ()>> {
    SOURCE_HISTORY_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| io_error("source history lock is poisoned"))
}

fn git_command(root: &Path) -> Command {
    let mut command = Command::new("git");
    command
        .arg("-c")
        .arg(format!(
            "core.hooksPath={}",
            if cfg!(windows) { "NUL" } else { "/dev/null" }
        ))
        .no_window()
        .current_dir(root);
    command
}

fn parse_history_lines(
    raw: &str,
    source_path: Option<&str>,
) -> std::io::Result<Vec<SourceHistoryVersion>> {
    let mut versions = Vec::new();
    for record in raw
        .split('\u{1e}')
        .map(|record| record.trim_start_matches(['\n', '\r']))
        .filter(|record| !record.trim().is_empty())
    {
        let mut fields = record.splitn(4, '\u{1f}');
        let Some(id) = fields.next() else {
            continue;
        };
        let Some(timestamp) = fields.next() else {
            continue;
        };
        let Some(label) = fields.next() else {
            continue;
        };
        let body = fields.next().unwrap_or_default();
        if let Some(source_path) = source_path {
            let expected = format!("{SOURCE_PATH_TRAILER} {source_path}");
            if !body.lines().any(|line| line.trim() == expected) {
                continue;
            }
        }
        let created_at = timestamp
            .parse::<i64>()
            .map(|seconds| seconds.saturating_mul(1000))
            .map_err(|_| io_error("Git history returned an invalid timestamp"))?;
        versions.push(SourceHistoryVersion {
            created_at,
            id: id.to_owned(),
            label: Some(label.to_owned()),
        });
    }
    Ok(versions)
}

fn validate_relative_path(path: &str) -> std::io::Result<()> {
    let relative = Path::new(path);
    if path.is_empty()
        || path.len() > MAX_HISTORY_PATH_BYTES
        || relative.is_absolute()
        || path.chars().any(char::is_control)
        || relative
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::Prefix(_)))
    {
        return Err(io_error(
            "source history path must stay inside the repository",
        ));
    }
    Ok(())
}

fn validate_version_id(id: &str) -> std::io::Result<()> {
    if id.len() < 7 || id.len() > 64 || !id.chars().all(|character| character.is_ascii_hexdigit()) {
        return Err(io_error("source history version id is invalid"));
    }
    Ok(())
}

fn commit_subject(label: Option<&str>) -> String {
    let label = label
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Checkpoint")
        .chars()
        .map(|character| {
            if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect::<String>();
    label.chars().take(MAX_HISTORY_LABEL_BYTES).collect()
}

fn command_error(operation: &str, output: &std::process::Output) -> std::io::Error {
    let details = String::from_utf8_lossy(&output.stderr)
        .trim()
        .chars()
        .take(400)
        .collect::<String>();
    if details.is_empty() {
        io_error(operation.to_owned())
    } else {
        io_error(format!("{operation}: {details}"))
    }
}

fn io_error(message: impl Into<String>) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::Other, message.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checkpoints_list_read_and_reject_unsafe_paths() {
        let root = tempfile::tempdir().expect("temp source history");
        let history = SourceHistory::new(root.path().join("source-history"));

        let first = history
            .checkpoint("workflows/example.json", "one\n", Some("First"))
            .expect("first checkpoint");
        let second = history
            .checkpoint("workflows/example.json", "two\n", Some("Second"))
            .expect("second checkpoint");
        let duplicate = history
            .checkpoint("workflows/example.json", "two\n", None)
            .expect("idempotent checkpoint");
        let named = history
            .checkpoint("workflows/example.json", "two\n", Some("Named"))
            .expect("named checkpoint");
        history
            .checkpoint("agents/example.json", "agent\n", Some("Other source"))
            .expect("other source checkpoint");

        assert_ne!(first.id, second.id);
        assert_eq!(duplicate.id, second.id);
        assert_ne!(named.id, second.id);
        assert_eq!(
            history.read("workflows/example.json", &first.id).unwrap(),
            Some("one\n".to_owned())
        );
        assert_eq!(
            history.read("workflows/example.json", &second.id).unwrap(),
            Some("two\n".to_owned())
        );
        let versions = history.list("workflows/example.json", None).expect("list");
        assert_eq!(versions.len(), 3);
        assert!(versions[0]
            .label
            .as_deref()
            .is_some_and(|label| label.contains("Named")));
        assert!(history.checkpoint("../outside.json", "x", None).is_err());
        assert!(history
            .read("workflows/example.json", "not-a-commit")
            .is_err());
    }
}
