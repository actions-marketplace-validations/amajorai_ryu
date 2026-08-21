//! The git engine: status/branches plus checkout/create-branch,
//! pull/sync, and commit-push, all shelling `git` against a caller-supplied cwd.
//! This is the "reads/runs what-is, no policy" half of the workspace primitive;
//! the axum HTTP handlers that call these functions stay in Core (server
//! wiring), as do the pure-filesystem `/api/workspace/{new-folder,list}`
//! handlers (they shell no git — node-fs, kernel-owned).

use std::collections::HashSet;
use std::process::{Command, Output, Stdio};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

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

/// Undo Git's C-style path quoting (`"a\tb"`), including octal byte escapes.
/// Non-quoted paths pass through. Git uses octal escapes for bytes that are not
/// safe in the configured quote format, so decoding into bytes first preserves
/// UTF-8 filenames instead of treating each escaped byte as a Unicode character.
fn unquote_git_path(raw: &str) -> String {
    let Some(inner) = raw.strip_prefix('"').and_then(|s| s.strip_suffix('"')) else {
        return raw.to_string();
    };
    let bytes = inner.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'\\' {
            out.push(bytes[index]);
            index += 1;
            continue;
        }
        index += 1;
        let Some(&escaped) = bytes.get(index) else {
            out.push(b'\\');
            break;
        };
        match escaped {
            b'a' => out.push(0x07),
            b'b' => out.push(0x08),
            b'f' => out.push(0x0c),
            b'n' => out.push(b'\n'),
            b'r' => out.push(b'\r'),
            b't' => out.push(b'\t'),
            b'v' => out.push(0x0b),
            b'\\' | b'"' => out.push(escaped),
            b'0'..=b'7' => {
                let mut value = 0u8;
                let mut digits = 0;
                while digits < 3 {
                    let Some(&digit) = bytes.get(index) else {
                        break;
                    };
                    if !(b'0'..=b'7').contains(&digit) {
                        break;
                    }
                    value = value * 8 + (digit - b'0');
                    index += 1;
                    digits += 1;
                }
                out.push(value);
                continue;
            }
            other => {
                out.push(b'\\');
                out.push(other);
            }
        }
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
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

/// Return a `git` command whose hook directory cannot contain a repository
/// hook. `--no-verify` covers commit/push hooks; this explicit `core.hooksPath`
/// override also protects any future mutating command added here. `/dev/null`
/// (or `NUL`) is intentionally used instead of a writable temp directory: a
/// temp directory could itself be populated by another local process between
/// creation and invocation.
fn git_without_hooks(args: &[&str]) -> Command {
    let mut command = Command::new("git");
    command
        .arg("-c")
        .arg(format!(
            "core.hooksPath={}",
            if cfg!(windows) { "NUL" } else { "/dev/null" }
        ))
        .args(args);
    command
}

/// Repo-local clean/smudge/process filters are executable code invoked by Git
/// during staging and checkout.
/// The mutation endpoints do not have a safe way to review or authorize those
/// commands, so fail closed before staging anything. Global filters are outside
/// this repository's control and are not part of this guard.
fn reject_local_executable_filters(cwd: &str) -> Result<(), String> {
    let output = Command::new("git")
        .args([
            "config",
            "--local",
            "--get-regexp",
            r"^filter\..*\.(clean|process|smudge)$",
        ])
        .current_dir(cwd)
        .no_window()
        .output()
        .map_err(|_| "could not inspect repository filter configuration".to_string())?;
    if output.status.success() && !output.stdout.is_empty() {
        return Err(
            "git mutation blocked: repository-local clean/smudge/process filters are not allowed"
                .to_string(),
        );
    }
    if output.status.success() || output.status.code() == Some(1) {
        return Ok(());
    }
    Err("git mutation blocked: repository filter configuration could not be inspected".to_string())
}

fn git_mutation_failed(operation: &str) -> String {
    format!("git {operation} failed; no command output was returned")
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
    let porcelain =
        run_git(cwd, &["status", "--porcelain", "--untracked-files=all"]).unwrap_or_default();
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
        &[
            "branch",
            "--sort=-committerdate",
            "--format=%(refname:short)",
        ],
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
/// is set, stages everything before committing. Mutating commands reject
/// repo-local executable filters, disable hooks, and return bounded operation
/// errors rather than forwarding untrusted hook output to the caller.
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
        reject_local_executable_filters(cwd)?;
    }

    if action != "push" && include_unstaged {
        // Stage everything. A failure here is fatal (e.g. corrupt index).
        let add = git_without_hooks(&["add", "-A"])
            .current_dir(cwd)
            .no_window()
            .output()
            .map_err(|_| "could not start git add".to_string())?;
        if !add.status.success() {
            return Err(git_mutation_failed("add"));
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

        let commit = git_without_hooks(&["commit", "--no-verify", "-m", message])
            .current_dir(cwd)
            .no_window()
            .output()
            .map_err(|_| "could not start git commit".to_string())?;
        if has_staged && commit.status.success() {
            committed = true;
        } else if has_staged {
            return Err(git_mutation_failed("commit"));
        }
    }

    let mut pushed = false;
    if action != "commit" {
        // Push to the configured upstream. When there is no tracking branch git
        // exits non-zero with a helpful message — surface it verbatim.
        let push = git_without_hooks(&["push", "--no-verify"])
            .current_dir(cwd)
            .no_window()
            .output()
            .map_err(|_| "could not start git push".to_string())?;
        if !push.status.success() {
            return Err(git_mutation_failed("push"));
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

/// Shaped `POST /api/git/pull` and `POST /api/git/sync` result.
#[derive(Debug, serde::Serialize)]
pub struct GitRemoteOutcome {
    pub success: bool,
    pub pulled: bool,
    pub pushed: bool,
    pub commit: Option<String>,
}

fn remote_git_failed(operation: &str, output: &std::process::Output) -> String {
    let details = String::from_utf8_lossy(&output.stderr)
        .trim()
        .chars()
        .take(400)
        .collect::<String>();
    if details.is_empty() {
        format!("git {operation} failed")
    } else {
        format!("git {operation} failed: {details}")
    }
}

const REMOTE_GIT_TIMEOUT: Duration = Duration::from_secs(120);

/// Run a remote Git mutation without giving Git an interactive credential or
/// terminal path. A blocking `Command::output` cannot be cancelled when the
/// HTTP client disconnects, so remote actions use a supervised child with a
/// bounded lifetime and kill it on timeout.
fn run_remote_git_command(cwd: &str, args: &[&str]) -> Result<Output, String> {
    let ssh_command = std::env::var("GIT_SSH_COMMAND")
        .map(|value| format!("{value} -o BatchMode=yes"))
        .unwrap_or_else(|_| "ssh -o BatchMode=yes".to_string());
    let mut child = git_without_hooks(args)
        .current_dir(cwd)
        .no_window()
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_SSH_COMMAND", ssh_command)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("could not start git: {error}"))?;
    let deadline = Instant::now() + REMOTE_GIT_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                return child
                    .wait_with_output()
                    .map_err(|error| format!("could not collect git output: {error}"));
            }
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("timed out after 120 seconds".to_string());
            }
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("could not inspect git process: {error}"));
            }
        }
    }
}

/// Pull the current branch from its upstream, or pull and then push for sync.
///
/// Pull is deliberately fast-forward-only: the Environment summary must not
/// create an implicit merge commit or leave a conflict in the user's folder.
/// Sync uses the same pull first, then pushes the current branch to its
/// configured upstream. Neither action stages or commits working-tree files.
pub fn run_git_remote_action(cwd: &str, action: &str) -> Result<GitRemoteOutcome, String> {
    if !matches!(action, "pull" | "sync") {
        return Err("invalid git remote action".to_string());
    }
    // Confirm this is a git repo before running a mutating remote command.
    if run_git(cwd, &["rev-parse", "--abbrev-ref", "HEAD"]).is_none() {
        return Err("not a git repository".to_string());
    }
    reject_local_executable_filters(cwd)?;

    let pull = run_remote_git_command(cwd, &["pull", "--ff-only", "--no-recurse-submodules"])
        .map_err(|error| format!("git pull {error}"))?;
    if !pull.status.success() {
        return Err(remote_git_failed("pull", &pull));
    }

    let pushed = action == "sync";
    if pushed {
        let push = run_remote_git_command(cwd, &["push", "--no-verify"])
            .map_err(|error| format!("git push {error}"))?;
        if !push.status.success() {
            return Err(remote_git_failed("push", &push));
        }
    }

    Ok(GitRemoteOutcome {
        success: true,
        pulled: true,
        pushed,
        commit: run_git(cwd, &["rev-parse", "--short", "HEAD"]),
    })
}

const PULL_REQUEST_FIELDS: &str =
    "baseRefName,commentsCount,headRefName,headRefOid,isDraft,number,repository,state,title,url";

#[derive(serde::Deserialize)]
struct GhRepository {
    #[serde(rename = "nameWithOwner")]
    name_with_owner: Option<String>,
}

#[derive(serde::Deserialize)]
struct GhPullRequest {
    #[serde(rename = "baseRefName")]
    base_ref_name: Option<String>,
    #[serde(rename = "commentsCount")]
    comments_count: Option<u64>,
    #[serde(rename = "headRefName")]
    head_ref_name: Option<String>,
    #[serde(rename = "headRefOid")]
    head_ref_oid: Option<String>,
    #[serde(rename = "isDraft")]
    is_draft: bool,
    number: u64,
    repository: Option<GhRepository>,
    state: Option<String>,
    title: String,
    url: String,
}

static ACTIVE_PR_CREATIONS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

struct PullRequestCreationGuard {
    key: String,
}

impl Drop for PullRequestCreationGuard {
    fn drop(&mut self) {
        if let Some(active) = ACTIVE_PR_CREATIONS.get() {
            if let Ok(mut keys) = active.lock() {
                keys.remove(&self.key);
            }
        }
    }
}

fn begin_pull_request_creation(
    cwd: &str,
    branch: &str,
) -> Result<PullRequestCreationGuard, String> {
    let key = format!("{cwd}\0{branch}");
    let active = ACTIVE_PR_CREATIONS.get_or_init(|| Mutex::new(HashSet::new()));
    let mut keys = active
        .lock()
        .map_err(|_| "pull request operation lock is unavailable".to_string())?;
    if !keys.insert(key.clone()) {
        return Err("a pull request operation is already in progress for this branch".to_string());
    }
    Ok(PullRequestCreationGuard { key })
}

fn list_open_pull_requests(cwd: &str, branch: &str) -> Result<Vec<GhPullRequest>, String> {
    let args = [
        "pr",
        "list",
        "--head",
        branch,
        "--state",
        "open",
        "--limit",
        "2",
        "--json",
        PULL_REQUEST_FIELDS,
    ];
    let gh = Command::new("gh")
        .args(args)
        .current_dir(cwd)
        .no_window()
        .output()
        .map_err(|e| format!("failed to run gh: {e}"))?;
    if !gh.status.success() {
        return Err(String::from_utf8_lossy(&gh.stderr).trim().to_string());
    }
    serde_json::from_slice(&gh.stdout).map_err(|e| format!("invalid gh pull request response: {e}"))
}

fn existing_open_pull_request(cwd: &str, branch: &str) -> Result<Option<GhPullRequest>, String> {
    let mut pulls = list_open_pull_requests(cwd, branch)?;
    if pulls.len() > 1 {
        return Err(format!(
            "more than one open pull request exists for branch {branch}"
        ));
    }
    Ok(pulls.pop())
}

fn pull_request_outcome(
    pull: &GhPullRequest,
    branch: &str,
    fallback_base: Option<&str>,
    already_exists: bool,
) -> PullRequestOutcome {
    PullRequestOutcome {
        already_exists,
        base: pull
            .base_ref_name
            .clone()
            .or_else(|| fallback_base.map(str::to_owned)),
        branch: pull
            .head_ref_name
            .clone()
            .unwrap_or_else(|| branch.to_string()),
        comments_count: pull.comments_count,
        head_sha: pull.head_ref_oid.clone(),
        is_draft: pull.is_draft,
        number: Some(pull.number),
        pr_url: pull.url.clone(),
        repository: pull
            .repository
            .as_ref()
            .and_then(|repo| repo.name_with_owner.clone()),
        state: pull.state.clone(),
        success: true,
        title: Some(pull.title.clone()),
    }
}

/// Shaped `POST /api/git/pull-request` result. The URL is returned by `gh` so
/// the desktop can offer both a completion link and an explicit browser action.
#[derive(serde::Serialize)]
pub struct PullRequestOutcome {
    pub already_exists: bool,
    pub base: Option<String>,
    pub branch: String,
    pub comments_count: Option<u64>,
    pub head_sha: Option<String>,
    pub is_draft: bool,
    pub number: Option<u64>,
    pub pr_url: String,
    pub repository: Option<String>,
    pub state: Option<String>,
    pub success: bool,
    pub title: Option<String>,
}

/// Optionally commit local changes, push the current branch, and create a pull
/// request through the authenticated GitHub CLI. Arguments are passed directly
/// to `git`/`gh` — no shell interpolation is used.
pub fn create_pull_request(
    cwd: &str,
    title: Option<&str>,
    body: Option<&str>,
    base: Option<&str>,
    draft: bool,
    include_unstaged: bool,
) -> Result<PullRequestOutcome, String> {
    let branch = run_git(cwd, &["rev-parse", "--abbrev-ref", "HEAD"])
        .ok_or_else(|| "not a git repository".to_string())?;
    if branch == "HEAD" {
        return Err("cannot create a pull request from a detached HEAD".to_string());
    }

    // The UI check is only an affordance. The node owns the final decision so
    // two concurrent clicks (or two desktop windows) cannot create two PRs for
    // the same local branch.
    let _creation_guard = begin_pull_request_creation(cwd, &branch)?;
    if include_unstaged {
        reject_local_executable_filters(cwd)?;
    }
    if let Some(existing) = existing_open_pull_request(cwd, &branch)? {
        return Ok(pull_request_outcome(
            &existing,
            &branch,
            base.map(str::trim).filter(|value| !value.is_empty()),
            true,
        ));
    }

    let requested_title = title
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| format!("Update {branch}"));

    if include_unstaged {
        let add = git_without_hooks(&["add", "-A"])
            .current_dir(cwd)
            .no_window()
            .output()
            .map_err(|_| "could not start git add".to_string())?;
        if !add.status.success() {
            return Err(git_mutation_failed("add"));
        }
    }

    let staged = run_git(cwd, &["diff", "--cached", "--name-only"])
        .map(|value| value.lines().any(|line| !line.trim().is_empty()))
        .unwrap_or(false);
    if staged {
        let message = title
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("Update via Ryu");
        let commit = git_without_hooks(&["commit", "--no-verify", "-m", message])
            .current_dir(cwd)
            .no_window()
            .output()
            .map_err(|_| "could not start git commit".to_string())?;
        if !commit.status.success() {
            return Err(git_mutation_failed("commit"));
        }
    }

    let has_upstream = run_git(
        cwd,
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    )
    .is_some();
    let push_args: &[&str] = if has_upstream {
        &["push", "--no-verify"]
    } else {
        &["push", "--no-verify", "-u", "origin", "HEAD"]
    };
    let push = git_without_hooks(push_args)
        .current_dir(cwd)
        .no_window()
        .output()
        .map_err(|_| "could not start git push".to_string())?;
    if !push.status.success() {
        return Err(git_mutation_failed("push"));
    }

    let body = body.unwrap_or("");
    let mut args = vec![
        "pr".to_string(),
        "create".to_string(),
        "--head".to_string(),
        branch.clone(),
        "--title".to_string(),
        requested_title.clone(),
        "--body".to_string(),
        body.to_string(),
    ];
    if let Some(base) = base.map(str::trim).filter(|value| !value.is_empty()) {
        args.extend(["--base".to_string(), base.to_string()]);
    }
    if draft {
        args.push("--draft".to_string());
    }

    let gh = Command::new("gh")
        .args(&args)
        .current_dir(cwd)
        .no_window()
        .output()
        .map_err(|e| format!("failed to run gh: {e}"))?;
    if !gh.status.success() {
        return Err(String::from_utf8_lossy(&gh.stderr).trim().to_string());
    }
    let pr_url = String::from_utf8_lossy(&gh.stdout).trim().to_string();
    if pr_url.is_empty() {
        return Err("gh did not return a pull request URL".to_string());
    }

    // A second lookup closes the check-then-create race across Core processes
    // and enriches the result with the title/number/repository the app uses for
    // its compact CI surface. The URL is still a valid success result if GitHub
    // accepts creation but the follow-up read is temporarily unavailable.
    if let Ok(Some(created)) = existing_open_pull_request(cwd, &branch) {
        return Ok(pull_request_outcome(
            &created,
            &branch,
            base.map(str::trim).filter(|value| !value.is_empty()),
            false,
        ));
    }

    Ok(PullRequestOutcome {
        already_exists: false,
        base: base
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned),
        branch,
        comments_count: None,
        head_sha: None,
        is_draft: draft,
        number: None,
        pr_url,
        repository: None,
        state: Some("OPEN".to_string()),
        success: true,
        title: Some(requested_title),
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
    fn remote_action_rejects_unknown_action() {
        let error = run_git_remote_action("/tmp", "fetch").unwrap_err();
        assert_eq!(error, "invalid git remote action");
    }

    #[test]
    fn remote_action_requires_a_git_repository() {
        let dir = tempfile::tempdir().unwrap();
        let error = run_git_remote_action(dir.path().to_str().unwrap(), "pull").unwrap_err();
        assert_eq!(error, "not a git repository");
    }

    #[test]
    fn remote_action_rejects_local_executable_filters() {
        let dir = tempfile::tempdir().unwrap();
        test_git(dir.path(), &["init"]);
        test_git(dir.path(), &["config", "user.name", "Ryu Test"]);
        test_git(
            dir.path(),
            &["config", "user.email", "ryu-test@example.com"],
        );
        std::fs::write(dir.path().join("tracked.txt"), "tracked\n").unwrap();
        test_git(dir.path(), &["add", "tracked.txt"]);
        test_git(dir.path(), &["commit", "-m", "initial"]);
        test_git(dir.path(), &["config", "filter.external.smudge", "cat"]);
        let error = run_git_remote_action(dir.path().to_str().unwrap(), "pull").unwrap_err();
        assert_eq!(
            error,
            "git mutation blocked: repository-local clean/smudge/process filters are not allowed"
        );
    }

    #[test]
    fn remote_action_pulls_and_syncs_fast_forward_only() {
        let root = tempfile::tempdir().unwrap();
        let remote = root.path().join("remote.git");
        let remote_path = remote.to_str().unwrap();

        test_git(root.path(), &["init", "--bare", remote_path]);
        test_git(root.path(), &["clone", remote_path, "seed"]);
        let seed = root.path().join("seed");
        test_git(&seed, &["config", "user.name", "Ryu Test"]);
        test_git(&seed, &["config", "user.email", "ryu-test@example.com"]);
        std::fs::write(seed.join("tracked.txt"), "one\n").unwrap();
        test_git(&seed, &["add", "tracked.txt"]);
        test_git(&seed, &["commit", "-m", "initial"]);
        test_git(&seed, &["push", "-u", "origin", "HEAD"]);

        test_git(root.path(), &["clone", remote_path, "local"]);
        test_git(root.path(), &["clone", remote_path, "peer"]);
        let peer = root.path().join("peer");
        test_git(&peer, &["config", "user.name", "Ryu Test"]);
        test_git(&peer, &["config", "user.email", "ryu-test@example.com"]);
        std::fs::write(peer.join("tracked.txt"), "one\ntwo\n").unwrap();
        test_git(&peer, &["add", "tracked.txt"]);
        test_git(&peer, &["commit", "-m", "remote update"]);
        test_git(&peer, &["push"]);

        let local = root.path().join("local");
        let local_path = local.to_str().unwrap();
        let pulled = run_git_remote_action(local_path, "pull").unwrap();
        assert!(pulled.success);
        assert!(pulled.pulled);
        assert!(!pulled.pushed);
        assert_eq!(
            std::fs::read_to_string(local.join("tracked.txt")).unwrap(),
            "one\ntwo\n"
        );

        std::fs::write(local.join("local.txt"), "local\n").unwrap();
        test_git(&local, &["add", "local.txt"]);
        test_git(&local, &["commit", "-m", "local update"]);
        let local_head = run_git(local_path, &["rev-parse", "HEAD"]).unwrap();
        let synced = run_git_remote_action(local_path, "sync").unwrap();
        assert!(synced.success);
        assert!(synced.pulled);
        assert!(synced.pushed);
        let remote_head = String::from_utf8_lossy(
            &test_git(
                root.path(),
                &["--git-dir", remote_path, "rev-parse", "HEAD"],
            )
            .stdout,
        )
        .trim()
        .to_string();
        assert_eq!(remote_head, local_head);
    }

    fn test_git(cwd: &std::path::Path, args: &[&str]) -> std::process::Output {
        let output = Command::new("git")
            .args([
                "-c",
                "core.hooksPath=/dev/null",
                "-c",
                "commit.gpgSign=false",
            ])
            .args(args)
            .current_dir(cwd)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
        output
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
        assert_eq!(
            untracked_paths("?? \"a\\tb-\\303\\251.txt\"\n"),
            vec!["a\tb-é.txt"]
        );
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
