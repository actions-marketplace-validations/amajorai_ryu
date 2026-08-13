//! The git engine: read-only status/branches plus checkout/create-branch/
//! commit-push, all shelling `git` against a caller-supplied cwd. This is the
//! "reads/runs what-is, no policy" half of the workspace primitive; the axum
//! HTTP handlers that call these functions stay in Core (server wiring), as do
//! the pure-filesystem `/api/workspace/{new-folder,list}` handlers (they shell
//! no git — node-fs, kernel-owned).

use std::process::Command;

use crate::win_process::NoWindow;

/// Shaped `GET /api/git/status` result: the working-tree state of a repo cwd.
#[derive(serde::Serialize)]
pub struct GitState {
    pub is_repo: bool,
    pub branch: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub dirty: bool,
    pub changed_files_count: usize,
    pub insertions: u32,
    pub deletions: u32,
}

/// Files larger than this are counted as 0 added lines, the same way git treats
/// a file it decides is binary. Keeps a stray multi-gigabyte artifact in an
/// untracked folder from stalling a status poll.
const MAX_UNTRACKED_SCAN_BYTES: u64 = 2 * 1024 * 1024;

/// Added lines contributed by files git does not track yet.
///
/// `git diff HEAD --numstat` only sees tracked files, but `git status
/// --porcelain` counts untracked ones — so without this the two halves of
/// `GitState` describe different file sets, and a folder of brand-new files
/// reads as "12 files changed, +0 −0". Every line of a new file is an insertion,
/// which is what `git add -N` + `diff` would report. Binary and oversized files
/// contribute 0, matching numstat's "-" rows.
fn untracked_insertions(cwd: &str, untracked: &[String]) -> u32 {
    let root = std::path::Path::new(cwd);
    let mut insertions = 0u32;
    for rel in untracked {
        let path = root.join(rel);
        let Ok(meta) = std::fs::metadata(&path) else {
            continue;
        };
        if !meta.is_file() || meta.len() > MAX_UNTRACKED_SCAN_BYTES {
            continue;
        }
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        if bytes.is_empty() || bytes.contains(&0) {
            continue;
        }
        let newlines = bytes.iter().filter(|b| **b == b'\n').count();
        // A trailing byte that is not a newline is still a line to git.
        let lines = if bytes.last() == Some(&b'\n') {
            newlines
        } else {
            newlines + 1
        };
        insertions = insertions.saturating_add(lines as u32);
    }
    insertions
}

/// Pull the untracked paths out of `git status --porcelain --untracked-files=all`
/// output (the `?? <path>` rows), un-quoting the C-style quoting git applies to
/// paths with unusual bytes.
fn untracked_paths(porcelain: &str) -> Vec<String> {
    porcelain
        .lines()
        .filter_map(|l| l.strip_prefix("?? "))
        .map(unquote_git_path)
        .collect()
}

/// Undo git's C-style path quoting (`"a\tb"`). Non-quoted paths pass through.
fn unquote_git_path(raw: &str) -> String {
    let Some(inner) = raw.strip_prefix('"').and_then(|s| s.strip_suffix('"')) else {
        return raw.to_string();
    };
    let mut out = String::with_capacity(inner.len());
    let mut chars = inner.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('n') => out.push('\n'),
            Some('t') => out.push('\t'),
            Some('r') => out.push('\r'),
            Some(other) => out.push(other),
            None => break,
        }
    }
    out
}

/// Total added/removed lines for the working tree vs HEAD (staged + unstaged),
/// summed from `git diff HEAD --numstat`. Binary files (numstat "-") are skipped.
fn query_diff_totals(cwd: &str) -> (u32, u32) {
    let numstat = run_git(cwd, &["diff", "HEAD", "--numstat"]).unwrap_or_default();
    let mut insertions = 0u32;
    let mut deletions = 0u32;
    for line in numstat.lines() {
        let mut cols = line.split('\t');
        let adds = cols.next().and_then(|c| c.parse::<u32>().ok());
        let dels = cols.next().and_then(|c| c.parse::<u32>().ok());
        if let (Some(a), Some(d)) = (adds, dels) {
            insertions += a;
            deletions += d;
        }
    }
    (insertions, deletions)
}

fn run_git(cwd: &str, args: &[&str]) -> Option<String> {
    let out = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .no_window()
        .output()
        .ok()?;
    if out.status.success() {
        Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        None
    }
}

/// Compute the working-tree state for `cwd` (branch, ahead/behind, dirty, diff
/// totals). Returns `is_repo:false` when `cwd` is not a git repository.
pub fn query_git_state(cwd: &str) -> GitState {
    // Confirm this is actually a git repo.
    let branch = run_git(cwd, &["rev-parse", "--abbrev-ref", "HEAD"]);
    let is_repo = branch.is_some();

    if !is_repo {
        return GitState {
            is_repo: false,
            branch: None,
            ahead: 0,
            behind: 0,
            dirty: false,
            changed_files_count: 0,
            insertions: 0,
            deletions: 0,
        };
    }

    // Dirty state from porcelain output — one line per changed file.
    // `--untracked-files=all` lists new files individually rather than collapsing
    // a new directory into a single row, so `changed_files_count` counts the same
    // files the insertion total below is summed over.
    let porcelain = run_git(cwd, &["status", "--porcelain", "--untracked-files=all"])
        .unwrap_or_default();
    let changed: Vec<&str> = porcelain.lines().filter(|l| !l.is_empty()).collect();
    let dirty = !changed.is_empty();

    // Ahead / behind relative to the upstream branch. Fails gracefully when no
    // tracking branch is configured — defaults to 0/0.
    let ahead_behind = run_git(cwd, &["rev-list", "--count", "--left-right", "@{u}...HEAD"]);
    let (behind, ahead) = parse_ahead_behind(ahead_behind.as_deref());

    let (tracked_insertions, deletions) = query_diff_totals(cwd);
    let insertions =
        tracked_insertions.saturating_add(untracked_insertions(cwd, &untracked_paths(&porcelain)));

    GitState {
        is_repo: true,
        branch,
        ahead,
        behind,
        dirty,
        changed_files_count: changed.len(),
        insertions,
        deletions,
    }
}

/// Parse `git rev-list --count --left-right @{u}...HEAD` output: "<behind>\t<ahead>".
fn parse_ahead_behind(raw: Option<&str>) -> (u32, u32) {
    let Some(s) = raw else {
        return (0, 0);
    };
    let mut parts = s.split_whitespace();
    let behind = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
    let ahead = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
    (behind, ahead)
}

/// Shaped `GET /api/git/branches` result: local branches plus the current one.
#[derive(serde::Serialize)]
pub struct GitBranches {
    pub is_repo: bool,
    pub current: Option<String>,
    pub branches: Vec<String>,
}

/// List local branches plus the currently checked-out one for `cwd`. Returns
/// `is_repo:false` when `cwd` is not a git repository.
pub fn list_branches(cwd: &str) -> GitBranches {
    let current = run_git(cwd, &["rev-parse", "--abbrev-ref", "HEAD"]);
    if current.is_none() {
        return GitBranches {
            is_repo: false,
            current: None,
            branches: Vec::new(),
        };
    }

    // Most-recently-committed first, not git's default alphabetical order. The
    // list is NOT paged — `checkout_branch` re-lists to validate its argument, so
    // a server-side limit would make any branch past the cut unreachable — but a
    // client that shows only the head of a long list should be showing the
    // branches actually in play, not the ones that happen to start with "a".
    let raw = run_git(
        cwd,
        &["branch", "--sort=-committerdate", "--format=%(refname:short)"],
    )
    .unwrap_or_default();
    let branches: Vec<String> = raw
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();

    GitBranches {
        is_repo: true,
        current,
        branches,
    }
}

/// Switch `cwd` to an existing local branch via `git switch`.
///
/// The branch is validated against the actual branch list to reject typos and
/// argument injection (a name beginning with `-`). Returns the raw git stderr on
/// failure so the caller can surface it (e.g. uncommitted-changes conflicts).
pub fn checkout_branch(cwd: &str, branch: &str) -> Result<String, String> {
    // Only switch to a branch git itself reports — guards against typos and any
    // argument-injection (e.g. a name beginning with '-').
    let known = list_branches(cwd);
    if !known.is_repo {
        return Err("not a git repository".to_string());
    }
    if !known.branches.iter().any(|b| b == branch) {
        return Err(format!("branch '{branch}' not found"));
    }

    let out = Command::new("git")
        .args(["switch", branch])
        .current_dir(cwd)
        .no_window()
        .output()
        .map_err(|e| format!("failed to run git: {e}"))?;

    if out.status.success() {
        Ok(branch.to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// Create a new branch off the current HEAD and switch to it (`git switch -c`).
///
/// Guards against argument injection (a name beginning with `-`) and obvious bad
/// input; git validates the full ref-name grammar itself and errors cleanly.
/// Returns the raw git stderr on failure (e.g. the branch already exists).
pub fn create_branch(cwd: &str, branch: &str) -> Result<String, String> {
    if !list_branches(cwd).is_repo {
        return Err("not a git repository".to_string());
    }
    // Guard against argument injection (a name beginning with '-') and obvious bad
    // input; git validates the full ref-name grammar itself and errors cleanly.
    let name = branch.trim();
    if name.is_empty()
        || name.starts_with('-')
        || name.contains("..")
        || name.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err(format!("'{branch}' is not a valid branch name"));
    }

    let out = Command::new("git")
        .args(["switch", "-c", name])
        .current_dir(cwd)
        .no_window()
        .output()
        .map_err(|e| format!("failed to run git: {e}"))?;

    if out.status.success() {
        Ok(name.to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// Shaped `POST /api/git/commit-push` result: what the action actually did.
#[derive(serde::Serialize)]
pub struct CommitPushOutcome {
    pub success: bool,
    pub committed: bool,
    pub pushed: bool,
    pub commit: Option<String>,
}

/// Commit, push, or do both for `cwd`. `action` is one of `commit`,
/// `commit-push`, or `push` (validated by the caller). When `include_unstaged`
/// is set, stages everything before committing. Returns the raw git stderr on
/// any failure.
pub fn run_git_action(
    cwd: &str,
    message: &str,
    action: &str,
    include_unstaged: bool,
) -> Result<CommitPushOutcome, String> {
    // Confirm this is a git repo before touching the working tree.
    if run_git(cwd, &["rev-parse", "--abbrev-ref", "HEAD"]).is_none() {
        return Err("not a git repository".to_string());
    }

    if action != "push" && include_unstaged {
        // Stage everything. A failure here is fatal (e.g. corrupt index).
        let add = Command::new("git")
            .args(["add", "-A"])
            .current_dir(cwd)
            .no_window()
            .output()
            .map_err(|e| format!("failed to run git: {e}"))?;
        if !add.status.success() {
            return Err(String::from_utf8_lossy(&add.stderr).trim().to_string());
        }
    }

    let mut committed = false;
    if action != "push" {
        let staged_args = ["diff", "--cached", "--name-only"];
        let has_staged = run_git(cwd, &staged_args)
            .map(|s| s.lines().any(|l| !l.trim().is_empty()))
            .unwrap_or(false);

        if !has_staged && include_unstaged {
            let has_changes = run_git(cwd, &["status", "--porcelain"])
                .map(|s| s.lines().any(|l| !l.trim().is_empty()))
                .unwrap_or(false);
            if has_changes {
                return Err("no staged changes to commit".to_string());
            }
        }

        let commit = Command::new("git")
            .args(["commit", "-m", message])
            .current_dir(cwd)
            .no_window()
            .output()
            .map_err(|e| format!("failed to run git: {e}"))?;
        if has_staged && commit.status.success() {
            committed = true;
        } else if has_staged {
            return Err(String::from_utf8_lossy(&commit.stderr).trim().to_string());
        }
    }

    let mut pushed = false;
    if action != "commit" {
        // Push to the configured upstream. When there is no tracking branch git
        // exits non-zero with a helpful message — surface it verbatim.
        let push = Command::new("git")
            .args(["push"])
            .current_dir(cwd)
            .no_window()
            .output()
            .map_err(|e| format!("failed to run git: {e}"))?;
        if !push.status.success() {
            return Err(String::from_utf8_lossy(&push.stderr).trim().to_string());
        }
        pushed = true;
    }

    let commit = run_git(cwd, &["rev-parse", "--short", "HEAD"]);

    Ok(CommitPushOutcome {
        success: true,
        committed,
        pushed,
        commit,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_ahead_behind_normal() {
        assert_eq!(parse_ahead_behind(Some("3\t1")), (3, 1));
    }

    #[test]
    fn parse_ahead_behind_none() {
        assert_eq!(parse_ahead_behind(None), (0, 0));
    }

    #[test]
    fn parse_ahead_behind_no_upstream() {
        assert_eq!(parse_ahead_behind(Some("")), (0, 0));
    }

    #[test]
    fn untracked_paths_picks_only_untracked_rows() {
        let porcelain = " M src/lib.rs\nA  src/new.rs\n?? notes.md\n?? src/scratch.rs\n";
        assert_eq!(
            untracked_paths(porcelain),
            vec!["notes.md".to_string(), "src/scratch.rs".to_string()]
        );
    }

    #[test]
    fn untracked_paths_unquotes_git_quoting() {
        assert_eq!(untracked_paths("?? \"a\\tb.txt\"\n"), vec!["a\tb.txt"]);
    }

    #[test]
    fn untracked_insertions_counts_every_line_of_a_new_file() {
        let dir = std::env::temp_dir().join(format!(
            "ryu-untracked-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        // Three lines, no trailing newline — git counts the last one too.
        std::fs::write(dir.join("new.txt"), b"a\nb\nc").unwrap();
        // Binary content contributes nothing, exactly like a numstat "-" row.
        std::fs::write(dir.join("blob.bin"), b"a\0b\n").unwrap();

        let counted = untracked_insertions(
            dir.to_str().unwrap(),
            &["new.txt".to_string(), "blob.bin".to_string()],
        );
        std::fs::remove_dir_all(&dir).ok();

        assert_eq!(counted, 3);
    }
}
