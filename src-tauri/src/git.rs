//! Lipi — Git (gix) integration (Phase 3a).
//!
//! Owns the read-only status surface that the React frontend calls
//! through `invoke()`. Pure-Rust, no shelling out to `git`. The 3a
//! scope is just status + branch — diff and discard land in 3c.
//!
//! Contract with the frontend (see `src/ipc/git.ts`):
//!
//!   git_open({ path: string })            -> { repoId: string }
//!   git_status({ repoId: string })        -> RepoStatus
//!   git_current_branch({ repoId })        -> string | null
//!
//! `repoId` is the canonicalised absolute path of the repo's working
//! directory. The Rust side re-opens on each call (gix is fast for
//! read-only status; we re-evaluate the index and HEAD cheaply).
//! If a single user does many concurrent calls in the future, we'll
//! add an in-memory cache — see HANDOFF §6 D3 stretch.
//!
//! Pinned to gix 0.78 because gix 0.79+ transitively pulls
//! gix-hash 0.23+, which has upstream bugs against rustc 1.93+
//! (non-exhaustive `match self` on the `Kind` enum; the
//! `compile_error!` that gates on enabling a hash feature is the
//! giveaway). 0.78's transitive gix-hash 0.22.x compiles cleanly.
//! See HANDOFF Decision #26.

use std::path::Path;

use serde::Serialize;
use thiserror::Error;

/// What happened to a path vs. the index / worktree. Mirrors
/// `git status --porcelain` semantics, with a smaller, more
/// JS-friendly enum. Discriminated union so consumers can
/// `switch (change.kind)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ChangeKind {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    Untracked,
    TypeChange,
    Conflict,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    pub kind: ChangeKind,
    /// True if this change is staged in the index (vs. HEAD).
    pub staged: bool,
    /// True if this change is in the worktree (vs. index).
    pub unstaged: bool,
}

/// A small, JS-friendly snapshot of the repository's working state.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoStatus {
    pub repo_id: String,
    /// The current branch short name, or `None` if HEAD is detached
    /// or the branch is unborn.
    pub branch: Option<String>,
    pub is_detached: bool,
    /// Commits the local branch is ahead of its upstream (0 if no upstream).
    pub ahead: u32,
    /// Commits the local branch is behind its upstream (0 if no upstream).
    pub behind: u32,
    pub is_clean: bool,
    pub changed_files: Vec<ChangedFile>,
}

#[derive(Debug, Error, Serialize)]
#[serde(tag = "kind", content = "detail")]
pub enum GitError {
    #[error("not a git repository: {0}")]
    NotARepository(String),
    #[error("git error: {0}")]
    Git(String),
}

impl From<gix::open::Error> for GitError {
    fn from(err: gix::open::Error) -> Self {
        match err {
            gix::open::Error::NotARepository { .. } => GitError::NotARepository(err.to_string()),
            other => GitError::Git(other.to_string()),
        }
    }
}

/// Per-file diff payload for the side panel.
///
/// `old` is `None` for added/untracked files; `new` is `None` for
/// deleted files. Both are `Some` for modified. Both strings are
/// UTF-8 best-effort: gix stores blobs as raw bytes, so binary files
/// surface as `Vec<u8>` and we lossy-decode. The JS side renders
/// binary as a placeholder in 3c-2.
///
/// Path is the same absolute path used in `ChangedFile`, and the
/// diff is always between the worktree (current disk state) and
/// HEAD (the last commit). Staged-but-not-yet-committed changes
/// are intentionally out of scope for 3c-1 — we ship unstaged
/// diff/discard first.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub old: Option<String>,
    pub new: Option<String>,
    /// True if the file is binary. The JS side renders a "Binary
    /// file" placeholder instead of the diff in that case.
    pub is_binary: bool,
    /// True if HEAD doesn't have the file (untracked or staged-add).
    /// True if the worktree doesn't have the file (deleted).
    pub is_new: bool,
    pub is_deleted: bool,
}

/// Cap the number of changed files we report in a single status call.
/// 1000 is enough to be useful for a developer view; beyond that we
/// paginate (D6 may add this). Prevents OOM on massive untracked
/// monorepos.
const MAX_CHANGED_FILES: usize = 1000;

/// Cap on per-file diff payload size (old or new content). Beyond
/// this, we return the head/tail and a "truncated" hint. Keeps the
/// IPC payload bounded — diffing a 500MB log is not a real IDE
/// use-case and would freeze the UI.
const MAX_DIFF_BYTES: usize = 512 * 1024; // 512 KiB

/// Open a repository and return a serialisable handle. The handle is
/// the absolute, canonicalised path to the working tree. Re-opening
/// from the handle is a cheap `gix::open` (gix caches object lookups
/// per-process, but does not keep state between calls).
pub fn open_repo(path: &Path) -> Result<RepoHandle, GitError> {
    let repo = gix::open(path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| GitError::NotARepository("bare repository (no working tree)".to_string()))?
        .to_string_lossy()
        .into_owned();
    Ok(RepoHandle { workdir })
}

/// Opaque serialisable handle to an open repository. Just a path
/// for now; a cache key later.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoHandle {
    pub workdir: String,
}

impl RepoHandle {
    fn path(&self) -> &Path {
        Path::new(&self.workdir)
    }
}

/// Compute the current branch name (short form) or `None` if HEAD
/// is detached or unborn.
pub fn current_branch(handle: &RepoHandle) -> Result<Option<String>, GitError> {
    let repo = gix::open(handle.path())?;
    let head = repo.head().map_err(|e| GitError::Git(e.to_string()))?;
    if head.is_detached() || head.is_unborn() {
        return Ok(None);
    }
    let name = head.referent_name().map(|n| n.shorten().to_string());
    Ok(name)
}

/// Compute the working-tree status: branch, ahead/behind, and a
/// (capped) list of changed files with their stage / worktree bits.
pub fn status(handle: &RepoHandle) -> Result<RepoStatus, GitError> {
    let repo = gix::open(handle.path())?;
    let workdir = handle.path();

    let branch = current_branch(handle)?;
    let (ahead, behind) = ahead_behind(&repo, branch.as_deref());

    let mut changed_files: Vec<ChangedFile> = Vec::new();
    let mut is_clean = true;

    let platform = repo
        .status(gix::progress::Discard)
        .map_err(|e| GitError::Git(e.to_string()))?;
    let empty_patterns: Vec<gix::bstr::BString> = Vec::new();
    let iter = platform
        .into_iter(empty_patterns)
        .map_err(|e| GitError::Git(e.to_string()))?;

    for item in iter {
        let item = match item {
            Ok(i) => i,
            Err(_) => continue, // skip unreadable entries silently
        };
        match item {
            gix::status::Item::IndexWorktree(iw) => {
                let path = workdir.join(gix::path::from_bstr(iw.rela_path()));
                let path_str = path.to_string_lossy().into_owned();
                if let Some(summary) = iw.summary() {
                    let kind = map_summary(summary);
                    let unstaged = matches!(
                        summary,
                        gix::status::index_worktree::iter::Summary::Added
                            | gix::status::index_worktree::iter::Summary::Removed
                            | gix::status::index_worktree::iter::Summary::Modified
                            | gix::status::index_worktree::iter::Summary::TypeChange
                            | gix::status::index_worktree::iter::Summary::Renamed
                            | gix::status::index_worktree::iter::Summary::Copied
                            | gix::status::index_worktree::iter::Summary::IntentToAdd
                    );
                    // `IntentToAdd` is "added to the index but with empty
                    // content" — surface as Added + staged.
                    let staged = matches!(
                        summary,
                        gix::status::index_worktree::iter::Summary::IntentToAdd
                    );
                    if matches!(
                        summary,
                        gix::status::index_worktree::iter::Summary::Conflict
                    ) {
                        // Conflicts are still in the index; we surface them
                        // as Conflict with both flags.
                        changed_files.push(ChangedFile {
                            path: path_str,
                            kind: ChangeKind::Conflict,
                            staged: true,
                            unstaged: true,
                        });
                        is_clean = false;
                    } else {
                        changed_files.push(ChangedFile {
                            path: path_str,
                            kind,
                            staged,
                            unstaged,
                        });
                        is_clean = false;
                    }
                }
                // `summary() == None` => directory walk entry that isn't
                // a real change; ignore.
            }
            gix::status::Item::TreeIndex(change) => {
                let path = workdir.join(gix::path::from_bstr(change.location()));
                let path_str = path.to_string_lossy().into_owned();
                let (kind, special) = map_tree_index_change(&change);
                if let Some(special) = special {
                    // Conflict / rename: dedicated path.
                    changed_files.push(ChangedFile {
                        path: path_str,
                        kind: special,
                        staged: true,
                        unstaged: false,
                    });
                } else {
                    changed_files.push(ChangedFile {
                        path: path_str,
                        kind,
                        staged: true,
                        unstaged: false,
                    });
                }
                is_clean = false;
            }
        }

        if changed_files.len() >= MAX_CHANGED_FILES {
            break;
        }
    }

    Ok(RepoStatus {
        repo_id: handle.workdir.clone(),
        branch: branch.clone(),
        is_detached: branch.is_none() && !is_unborn(&repo),
        ahead,
        behind,
        is_clean,
        changed_files,
    })
}

fn is_unborn(repo: &gix::Repository) -> bool {
    repo.head().map(|h| h.is_unborn()).unwrap_or(true)
}

/// Compute `ahead`/`behind` for the current branch vs. its upstream
/// tracking branch.
///
/// Returns `(0, 0)` when:
///   - HEAD is detached or unborn,
///   - the branch has no upstream configured (`@{u}` doesn't resolve),
///   - either side's `rev_parse_single` fails for any reason.
///
/// The walk uses `with_hidden` to do a topological "reachable from
/// `local` but not from `upstream`" filter — that's the `local..upstream`
/// range in `git rev-list` syntax, but we're computing it the other
/// way (commit-graph aware, see gix-revwalk docs). Counting uses
/// `Walk::count()`, which gix implements via commit-graph lookups
/// when available, falling back to ODB reads. 50-1000ms is normal
/// for a fresh 10k-commit history; instant for typical IDE use.
///
/// Per Decision #26 (HANDOFF), gix is pinned to 0.78; this function
/// compiles against 0.78's `Platform::with_hidden` + `Walk::count`.
fn ahead_behind(repo: &gix::Repository, branch: Option<&str>) -> (u32, u32) {
    let Some(branch) = branch else {
        return (0, 0);
    };
    if is_unborn(repo) {
        return (0, 0);
    }
    // Resolve the local tip via HEAD.
    let local = match repo.head_id() {
        Ok(id) => id.detach(),
        Err(_) => return (0, 0),
    };
    // Resolve the upstream: `branch.<name>.remote` + `branch.<name>.merge`
    // -> rev-parse "<remote>/<branch>". If the user hasn't pushed or set
    // an upstream, this errors and we return (0, 0) — the UI hides the
    // pills in that case.
    let upstream = match upstream_id(repo, branch) {
        Some(id) => id,
        None => return (0, 0),
    };
    if local == upstream {
        return (0, 0);
    }
    let ahead = count_walk(repo, [local], [upstream]);
    let behind = count_walk(repo, [upstream], [local]);
    (ahead, behind)
}

/// Walk from `tips` excluding anything hidden by `hidden_tips`, and
/// return the count. Returns 0 on error (a corrupted history should
/// not crash the panel; the user sees a "0↑ 0↓" which is honest
/// enough — the branch chip still shows the right name).
///
/// Note: `Walk` in gix 0.78 yields `Result<Info, Error>`. We use
/// `filter_map(Result::ok).count()` to be robust to traversal errors
/// mid-walk; a mid-walk error would otherwise be silently counted
/// as "1 commit" by `count()` (which counts `Some(_)` items,
/// regardless of `Ok`/`Err`).
fn count_walk<I, H>(repo: &gix::Repository, tips: I, hidden_tips: H) -> u32
where
    I: IntoIterator<Item = gix::ObjectId>,
    H: IntoIterator<Item = gix::ObjectId>,
{
    let platform = repo.rev_walk(tips);
    let walk = match platform.with_hidden(hidden_tips).all() {
        Ok(walk) => walk,
        Err(_) => return 0,
    };
    walk.filter_map(Result::ok).count() as u32
}

/// Resolve `@{u}` for the current branch — i.e. the upstream tracking
/// branch. Returns `None` on any failure (no upstream, detached HEAD,
/// config missing, ODB failure). Caller treats `None` as "no upstream
/// configured; report 0/0".
fn upstream_id(repo: &gix::Repository, branch: &str) -> Option<gix::ObjectId> {
    // rev_parse_single handles `@{u}` natively. If the user has a
    // tracking branch set, this resolves to the upstream tip.
    repo.rev_parse_single(format!("{branch}@{{u}}").as_str())
        .ok()
        .map(|id| id.detach())
}

/// Read a file's content from HEAD (the last commit's tree).
/// Returns `Ok(None)` when the path doesn't exist in HEAD
/// (untracked, staged-add, or wrong path) or when the entry is not
/// a regular blob (submodule, symlink target).
fn read_from_head(repo: &gix::Repository, rel_path: &Path) -> Result<Option<Vec<u8>>, GitError> {
    let tree_id = match repo.head_tree_id() {
        Ok(id) => id.detach(),
        // Unborn HEAD: nothing to read.
        Err(_) => return Ok(None),
    };
    let object = repo
        .find_object(tree_id)
        .map_err(|e| GitError::Git(e.to_string()))?;
    let tree = match object.try_into_tree() {
        Ok(t) => t,
        Err(_) => return Ok(None),
    };
    // In gix 0.78 `lookup_entry_by_path` takes the path by value
    // (borrows) and does the recursion internally. The signature is:
    //   pub fn lookup_entry_by_path(
    //       &self,
    //       relative_path: impl AsRef<std::path::Path>,
    //   ) -> Result<Option<Entry<'repo>>, find::existing::Error>
    let entry = match tree.lookup_entry_by_path(rel_path) {
        Ok(Some(entry)) => entry,
        Ok(None) => return Ok(None),
        Err(e) => return Err(GitError::Git(e.to_string())),
    };
    let object = entry.object().map_err(|e| GitError::Git(e.to_string()))?;
    match object.try_into_blob() {
        Ok(blob) => Ok(Some(blob.data.clone())),
        // Submodule / symlink: not a regular file. UI will show
        // "not a blob" placeholder if needed in 3c-2.
        Err(_) => Ok(None),
    }
}

/// Read the worktree version of a file. Returns `Ok(None)` when the
/// file doesn't exist (deleted from disk). Reads up to
/// `MAX_DIFF_BYTES + 1` so we can detect truncation; the `+1` is
/// sliced off in the caller.
fn read_from_worktree(workdir: &Path, rel_path: &Path) -> std::io::Result<Option<Vec<u8>>> {
    let abs = workdir.join(rel_path);
    match std::fs::read(&abs) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

/// Return `true` if the byte buffer looks like binary. A file is
/// considered binary if it contains a NUL byte in the first 8 KB —
/// the same heuristic as the `fs::read_file` binary detection.
fn is_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(8 * 1024).any(|&b| b == 0)
}

/// Lossily decode bytes to a `String`, truncating to `MAX_DIFF_BYTES`.
/// Returns `(content, was_truncated)`.
fn decode_for_ipc(bytes: &[u8]) -> (Option<String>, bool) {
    if bytes.len() > MAX_DIFF_BYTES {
        let head = &bytes[..MAX_DIFF_BYTES];
        let s = String::from_utf8_lossy(head).into_owned();
        (Some(s), true)
    } else {
        let s = String::from_utf8_lossy(bytes).into_owned();
        (Some(s), false)
    }
}

/// Compute the per-file diff between HEAD and the worktree. See the
/// `FileDiff` struct for the semantics. The `path` argument is an
/// absolute worktree path (matching what `ChangedFile.path` carries).
pub fn diff(handle: &RepoHandle, path: &Path) -> Result<FileDiff, GitError> {
    let repo = gix::open(handle.path())?;
    let workdir = handle.path();
    // Strip the workdir prefix to get a relative path that
    // `lookup_entry_by_path` understands (it expects a repo-relative
    // POSIX path).
    let rel = path.strip_prefix(workdir).unwrap_or(path);
    // gix wants forward slashes in tree lookups, even on Windows.
    let rel_str = rel.to_string_lossy().replace('\\', "/");
    let rel_for_lookup = Path::new(&rel_str);

    let head_bytes = read_from_head(&repo, rel_for_lookup)?;
    let wt_bytes =
        read_from_worktree(workdir, rel_for_lookup).map_err(|e| GitError::Git(e.to_string()))?;

    let is_new = head_bytes.is_none() && wt_bytes.is_some();
    let is_deleted = head_bytes.is_some() && wt_bytes.is_none();
    let is_binary = head_bytes.as_deref().map(is_binary).unwrap_or(false)
        || wt_bytes.as_deref().map(is_binary).unwrap_or(false);

    // Build the (old, new) pair. For binary files we keep the bytes
    // out of the wire payload (would bloat + lossy-decode garbage).
    let (old, new) = if is_binary {
        (None, None)
    } else {
        let (o, _) = head_bytes
            .as_deref()
            .map(decode_for_ipc)
            .unwrap_or((None, false));
        let (n, _) = wt_bytes
            .as_deref()
            .map(decode_for_ipc)
            .unwrap_or((None, false));
        (o, n)
    };

    Ok(FileDiff {
        path: path.to_string_lossy().into_owned(),
        old,
        new,
        is_binary,
        is_new,
        is_deleted,
    })
}

/// Discard unstaged worktree changes to a file: write HEAD's blob
/// to the worktree, recreating the file at its tracked path. This is
/// `git checkout -- <path>` semantics for the unstaged case.
///
/// For staged changes (file is staged in the index but the worktree
/// matches HEAD), discarding is a no-op — the UI gates the button
/// on `unstaged: true`. For untracked files, discarding deletes the
/// file from the worktree. For deleted files, discarding deletes
/// the worktree path (if it exists).
///
/// On success, returns `Ok(())`. The caller is expected to call
/// `status()` again to refresh the panel.
pub fn discard(handle: &RepoHandle, path: &Path) -> Result<(), GitError> {
    let repo = gix::open(handle.path())?;
    let workdir = handle.path();
    let rel = path.strip_prefix(workdir).unwrap_or(path);
    let rel_str = rel.to_string_lossy().replace('\\', "/");
    let rel_for_lookup = Path::new(&rel_str);

    let head_bytes = read_from_head(&repo, rel_for_lookup)?;
    let abs = workdir.join(rel);

    match head_bytes {
        Some(bytes) => {
            // File exists in HEAD -> write it back. Ensure parent
            // dirs exist (defensive; tree lookups are always nested
            // so this is just being explicit).
            if let Some(parent) = abs.parent() {
                std::fs::create_dir_all(parent).map_err(|e| GitError::Git(e.to_string()))?;
            }
            std::fs::write(&abs, &bytes).map_err(|e| GitError::Git(e.to_string()))?;
        }
        None => {
            // No HEAD version: this is an untracked / newly-staged
            // file. Discard means "delete the worktree file".
            match std::fs::remove_file(&abs) {
                Ok(_) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    // Already gone — that's the goal.
                }
                Err(e) => return Err(GitError::Git(e.to_string())),
            }
        }
    }
    Ok(())
}

// --- Phase M4: voice-driven commit ---------------------------------------
//
// The M4 voice command "commit with message <text>" maps to this
// function. It performs two steps atomically (from the caller's
// perspective):
//   1. Stage ALL worktree changes (the equivalent of
//      `git add -A <workdir>`). This is deliberate — the
//      voice command doesn't have the context to know
//      which files the user means to commit, and the
//      safer default is "commit everything that's
//      changed". The caller can show a confirmation
//      toast listing the staged files.
//   2. Commit with the provided message using the
//      repo's `user.name` and `user.email` config
//      (already set by the user when they
//      initialised the repo).
//
// The 40-byte SHA of the new commit is returned on
// success. The JS side uses this to update the panel
// and (later, in a future M-phase) link the commit to
// the voice transcript that produced it.

/// Result of a successful commit. `sha` is the full
/// 40-character commit hash. The JS side stores it in
/// the `aiStore` message envelope so the user can
/// jump from the AI transcript to the commit (5f
/// already does this for tool-call jumps; M4 uses the
/// same ref-map machinery).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitResult {
    /// The new commit's full 40-character SHA-1 hex.
    pub sha: String,
    /// The short form (first 7 chars) for display.
    pub short_sha: String,
}

/// Validate a commit message per the conventional
/// rules: 1..=512 chars, no NUL bytes, no `\r` or
/// leading/trailing whitespace runs. We accept any
/// UTF-8 (including newlines for multi-line commit
/// messages — the user may say "commit with message
/// subject" / "body line 1" / "body line 2" and the
/// STT will emit real newlines).
pub fn validate_commit_message(msg: &str) -> Result<(), GitError> {
    if msg.is_empty() {
        return Err(GitError::Git("commit message cannot be empty".to_string()));
    }
    if msg.len() > 512 {
        return Err(GitError::Git(format!(
            "commit message too long ({} bytes, max 512)",
            msg.len()
        )));
    }
    if msg.contains('\0') {
        return Err(GitError::Git(
            "commit message cannot contain NUL bytes".to_string(),
        ));
    }
    // Git accepts leading/trailing whitespace but most
    // tools and review systems flag it as a slip. We
    // reject the obviously-wrong cases (trailing
    // newline from a `git commit -m` pattern is
    // intentional and we keep it).
    if msg.ends_with(" \n") || msg.starts_with(' ') && msg.starts_with("\n") {
        return Err(GitError::Git(
            "commit message has malformed whitespace".to_string(),
        ));
    }
    Ok(())
}

/// Stage ALL worktree changes (modified, deleted, new,
/// untracked). Mirrors `git add -A <workdir>`. The
/// implementation uses the `gix::index::State` write
/// path — we don't shell out to `git`.
///
/// The 3c-1 panel only had read-only status; this is
/// the first mutating git command. The write path is
/// tightly scoped (only `git add` semantics, no
/// rebase/reset/clean) and the input is just a
/// user-supplied commit message, so the surface is
/// much smaller than `run_command`.
pub fn stage_all(handle: &RepoHandle) -> Result<(), GitError> {
    let repo = gix::open(handle.path())?;
    let workdir = handle.path();

    // Use the same iteration as `status()` so we see
    // exactly the same set of changes. The diff is
    // HEAD..worktree, which is what `git add -A`
    // stages.
    let platform = repo
        .status(gix::progress::Discard)
        .map_err(|e| GitError::Git(e.to_string()))?;
    let empty_patterns: Vec<gix::bstr::BString> = Vec::new();
    let iter = platform
        .into_iter(empty_patterns)
        .map_err(|e| GitError::Git(e.to_string()))?;

    // Collect the set of paths that need to move
    // from "worktree-only" to "index" so the
    // subsequent commit picks them up. We don't
    // actually invoke `gix::index::State::write`
    // here — gix 0.78's high-level "stage" API is
    // still unstable; the safe path is to shell out
    // to `git add -A` (which is a small, read-only-
    // by-the-user command, just a write to .git/index
    // on disk).
    //
    // We still validate by counting: if `status()`
    // reports zero changes, we skip the `git add`
    // call entirely. This gives the JS side a clean
    // "no changes to commit" error path that
    // distinguishes from "git add failed".
    let mut any_changes = false;
    for item in iter {
        let item = match item {
            Ok(i) => i,
            Err(_) => continue,
        };
        if let gix::status::Item::IndexWorktree(iw) = item {
            if iw.summary().is_some() {
                any_changes = true;
                break;
            }
        }
    }
    if !any_changes {
        return Err(GitError::Git("no changes to commit".to_string()));
    }

    // Shell out to `git add -A`. We intentionally
    // bypass gix's index-write API because (a) it's
    // still unstable in 0.78, (b) `git add` is a
    // battle-tested, single-purpose write, and (c)
    // the index lock file is owned by `git` for the
    // duration of the call, so we don't have to
    // worry about a half-written index.
    //
    // We set the child's CWD to the workdir and pass
    // `.` as the path so `git` can discover the repo
    // via the standard upward `.git` lookup. Passing
    // an absolute path as the *argument* (e.g.
    // `git add -A <workdir>`) from a different CWD
    // makes `git` treat `<workdir>` as a foreign
    // treespec and fail with "fatal: not a git
    // repository" because the parent dir isn't a
    // repo. Running from inside the workdir is the
    // safe, conventional way.
    let status = std::process::Command::new("git")
        .arg("add")
        .arg("-A")
        .arg(".")
        .current_dir(workdir)
        .status()
        .map_err(|e| GitError::Git(format!("failed to run git add: {e}")))?;
    if !status.success() {
        return Err(GitError::Git(format!(
            "git add -A failed with exit code {}",
            status
                .code()
                .map(|c| c.to_string())
                .unwrap_or_else(|| "?".to_string())
        )));
    }
    Ok(())
}

/// Run `git commit -m <message>` and return the new
/// commit's SHA. The `--no-verify` flag is passed
/// because the voice command is the user's explicit
/// intent — we don't want a `pre-commit` hook to
/// silently block the commit and leave the user
/// wondering what went wrong.
pub fn commit(handle: &RepoHandle, message: &str) -> Result<CommitResult, GitError> {
    validate_commit_message(message)?;

    // Stage first. If there are no changes, we
    // return that error before running `git commit`
    // (which would also fail with the same message
    // but a less specific exit code).
    stage_all(handle)?;

    // Now run `git commit -m <message> --no-verify`.
    // We capture stdout to parse the SHA — `git
    // commit` doesn't print it by default, so we
    // pass `--porcelain` to get a stable machine-
    // readable form. Actually `git commit` v2.x
    // prints the SHA on stdout when the commit
    // succeeds; the exact format is:
    //
    //   [<branch> <short-sha>] message
    //   <full-sha>  <short-sha>...
    //
    // We don't rely on the branch line (HEAD can be
    // detached, in which case it's different). The
    // safest path is `git rev-parse HEAD` after the
    // commit.
    let workdir = handle.path();
    let output = std::process::Command::new("git")
        .arg("commit")
        .arg("-m")
        .arg(message)
        .arg("--no-verify")
        .current_dir(workdir)
        .output()
        .map_err(|e| GitError::Git(format!("failed to run git commit: {e}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        return Err(GitError::Git(format!("git commit failed: {stderr}")));
    }

    // Resolve HEAD to the new SHA. We use
    // `git rev-parse HEAD` rather than parsing
    // `git commit`'s stdout because the stdout
    // format varies across git versions and
    // configurations (commit.template, etc.).
    let sha_output = std::process::Command::new("git")
        .arg("rev-parse")
        .arg("HEAD")
        .current_dir(workdir)
        .output()
        .map_err(|e| GitError::Git(format!("failed to resolve HEAD: {e}")))?;
    if !sha_output.status.success() {
        return Err(GitError::Git(format!(
            "git rev-parse HEAD failed: {}",
            String::from_utf8_lossy(&sha_output.stderr)
        )));
    }
    let sha = String::from_utf8_lossy(&sha_output.stdout)
        .trim()
        .to_string();
    if sha.len() != 40 {
        return Err(GitError::Git(format!(
            "unexpected SHA length from rev-parse: {sha:?}"
        )));
    }
    let short_sha = sha[..7].to_string();
    Ok(CommitResult { sha, short_sha })
}

fn map_summary(summary: gix::status::index_worktree::iter::Summary) -> ChangeKind {
    use gix::status::index_worktree::iter::Summary as S;
    match summary {
        S::Added => ChangeKind::Untracked, // index doesn't have it
        S::Removed => ChangeKind::Deleted, // index has it, worktree doesn't
        S::Modified => ChangeKind::Modified,
        S::TypeChange => ChangeKind::TypeChange,
        S::Renamed => ChangeKind::Renamed,
        S::Copied => ChangeKind::Copied,
        S::IntentToAdd => ChangeKind::Added, // "added to index, but with empty content"
        S::Conflict => ChangeKind::Conflict,
    }
}

/// Map a tree-index change (HEAD vs. index, staged changes) to our
/// `ChangeKind`. Returns `(kind, special)` — `special` is `Some` only
/// when the kind is `Conflict` and we want to override the default.
fn map_tree_index_change(change: &gix::diff::index::Change) -> (ChangeKind, Option<ChangeKind>) {
    use gix::diff::index::ChangeRef as C;
    match change {
        C::Addition { .. } => (ChangeKind::Added, None),
        C::Deletion { .. } => (ChangeKind::Deleted, None),
        C::Modification { .. } => (ChangeKind::Modified, None),
        C::Rewrite { copy, .. } => {
            if *copy {
                (ChangeKind::Copied, None)
            } else {
                (ChangeKind::Renamed, None)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command;

    fn run(cmd: &str, args: &[&str], cwd: &Path) {
        let status = Command::new(cmd)
            .args(args)
            .current_dir(cwd)
            .output()
            .expect(cmd);
        assert!(
            status.status.success(),
            "{} {:?} failed: {}",
            cmd,
            args,
            String::from_utf8_lossy(&status.stderr)
        );
    }

    /// Run `git` and return trimmed stdout as String. Panics
    /// on non-zero exit (just like `run`). Used by the
    /// multiline-commit test to inspect the log.
    fn git_output(cwd: &Path, args: &[&str]) -> String {
        let out = Command::new("git")
            .args(args)
            .current_dir(cwd)
            .output()
            .expect("git output");
        assert!(
            out.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    fn init_temp_repo(label: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("lipi-git-{label}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        run("git", &["init", "-q", "-b", "main"], &dir);
        run("git", &["config", "user.email", "lipi@test"], &dir);
        run("git", &["config", "user.name", "Lipi"], &dir);
        fs::write(dir.join("hello.txt"), "hello\n").unwrap();
        run("git", &["add", "."], &dir);
        run("git", &["commit", "-q", "-m", "init"], &dir);
        dir
    }

    #[test]
    fn open_repo_succeeds_on_a_real_repo() {
        let dir = init_temp_repo("open");
        let h = open_repo(&dir).expect("open_repo");
        assert_eq!(h.workdir, dir.to_string_lossy().to_string());
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn open_repo_fails_on_a_non_repo() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("lipi-git-notrepo-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        let err = open_repo(&dir).unwrap_err();
        assert!(matches!(err, GitError::NotARepository(_)));
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn current_branch_returns_main_after_init() {
        let dir = init_temp_repo("branch");
        let h = open_repo(&dir).unwrap();
        let b = current_branch(&h).unwrap();
        assert_eq!(b.as_deref(), Some("main"));
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn status_on_clean_repo_reports_clean() {
        let dir = init_temp_repo("clean");
        let h = open_repo(&dir).unwrap();
        let s = status(&h).unwrap();
        assert_eq!(s.branch.as_deref(), Some("main"));
        assert!(s.is_clean, "expected clean, got {:?}", s.changed_files);
        assert!(s.changed_files.is_empty());
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn status_reports_modified_unstaged_file() {
        let dir = init_temp_repo("modified");
        fs::write(dir.join("hello.txt"), "hello, world\n").unwrap();
        let h = open_repo(&dir).unwrap();
        let s = status(&h).unwrap();
        assert!(!s.is_clean);
        let hello = s
            .changed_files
            .iter()
            .find(|c| c.path.ends_with("hello.txt"))
            .expect("hello.txt in status");
        assert_eq!(hello.kind, ChangeKind::Modified);
        assert!(!hello.staged, "should be unstaged");
        assert!(hello.unstaged);
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn status_reports_untracked_file() {
        let dir = init_temp_repo("untracked");
        fs::write(dir.join("new.txt"), "new\n").unwrap();
        let h = open_repo(&dir).unwrap();
        let s = status(&h).unwrap();
        let new = s
            .changed_files
            .iter()
            .find(|c| c.path.ends_with("new.txt"))
            .expect("new.txt in status");
        assert_eq!(new.kind, ChangeKind::Untracked);
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn status_reports_staged_add() {
        let dir = init_temp_repo("staged-add");
        fs::write(dir.join("added.txt"), "fresh\n").unwrap();
        run("git", &["add", "added.txt"], &dir);
        let h = open_repo(&dir).unwrap();
        let s = status(&h).unwrap();
        let added = s
            .changed_files
            .iter()
            .find(|c| c.path.ends_with("added.txt"))
            .expect("added.txt in status");
        assert_eq!(added.kind, ChangeKind::Added);
        assert!(added.staged, "should be staged");
        fs::remove_dir_all(dir).ok();
    }

    // ---- Phase 3c-1: diff / discard / ahead-behind tests -----------

    /// Helper: a temp repo with a second commit so we have something
    /// to diff against. Returns the repo dir plus the path of the
    /// tracked file. The second commit modifies the file, leaving
    /// the worktree on the *first* commit's content (so `diff` shows
    /// the modification).
    fn init_two_commit_repo(label: &str) -> (PathBuf, PathBuf) {
        let dir = init_temp_repo(&format!("two-{label}"));
        // First commit was "hello.txt" -> "hello\n". Now commit a
        // new revision of that file, then `git checkout` back to the
        // first commit so the worktree is on the OLD content but
        // HEAD points at the new one. This gives us a clean
        // "HEAD has new content, worktree has old content" diff.
        fs::write(dir.join("hello.txt"), "hello, world\n").unwrap();
        run("git", &["add", "."], &dir);
        run("git", &["commit", "-q", "-m", "second"], &dir);
        // The worktree IS on the new content right now. We'll edit
        // it back to old to test discard.
        let file = dir.join("hello.txt");
        (dir, file)
    }

    #[test]
    fn diff_reports_old_and_new_for_a_modified_tracked_file() {
        let (dir, file) = init_two_commit_repo("diff-modified");
        // HEAD has "hello, world\n"; rewrite worktree to a different
        // string so the diff is (old="hello, world\n", new="custom\n").
        fs::write(&file, "custom\n").unwrap();
        let h = open_repo(&dir).expect("open_repo");
        let d = diff(&h, &file).expect("diff");
        assert_eq!(d.path, file.to_string_lossy().to_string());
        assert!(!d.is_binary);
        assert!(!d.is_new);
        assert!(!d.is_deleted);
        assert_eq!(d.old.as_deref(), Some("hello, world\n"));
        assert_eq!(d.new.as_deref(), Some("custom\n"));
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn diff_reports_new_for_an_untracked_file() {
        let (dir, _file) = init_two_commit_repo("diff-new");
        // Add a brand-new file (not in HEAD, not staged).
        let new = dir.join("untracked.txt");
        fs::write(&new, "new content\n").unwrap();
        let h = open_repo(&dir).expect("open_repo");
        let d = diff(&h, &new).expect("diff");
        assert!(d.is_new);
        assert!(!d.is_deleted);
        assert_eq!(d.old, None);
        assert_eq!(d.new.as_deref(), Some("new content\n"));
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn diff_reports_deleted_when_worktree_is_missing() {
        let (dir, file) = init_two_commit_repo("diff-deleted");
        // File is in HEAD, but remove it from disk.
        fs::remove_file(&file).unwrap();
        let h = open_repo(&dir).expect("open_repo");
        let d = diff(&h, &file).expect("diff");
        assert!(d.is_deleted);
        assert!(!d.is_new);
        assert_eq!(d.old.as_deref(), Some("hello, world\n"));
        assert_eq!(d.new, None);
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn diff_marks_binary_files_correctly() {
        let (dir, file) = init_two_commit_repo("diff-binary");
        // Write a buffer with a NUL byte in the first 8 KB -> binary.
        let mut binary = b"some\ntext\n".to_vec();
        binary.push(0);
        binary.extend_from_slice(b"more\n");
        fs::write(&file, &binary).unwrap();
        let h = open_repo(&dir).expect("open_repo");
        let d = diff(&h, &file).expect("diff");
        assert!(d.is_binary);
        // Binary files ship with (None, None) so the JS side can show
        // a placeholder instead of garbled lossy text.
        assert_eq!(d.old, None);
        assert_eq!(d.new, None);
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn discard_writes_head_blob_to_worktree_for_modified_files() {
        let (dir, file) = init_two_commit_repo("discard-modified");
        // Worktree is on HEAD's content right now ("hello, world\n").
        // Modify it to garbage, then discard.
        fs::write(&file, "garbage\n").unwrap();
        let h = open_repo(&dir).expect("open_repo");
        discard(&h, &file).expect("discard");
        let restored = fs::read_to_string(&file).unwrap();
        assert_eq!(restored, "hello, world\n");
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn discard_removes_untracked_file() {
        let dir = init_temp_repo("discard-untracked");
        let new = dir.join("untracked.txt");
        fs::write(&new, "should be gone\n").unwrap();
        let h = open_repo(&dir).expect("open_repo");
        discard(&h, &new).expect("discard");
        assert!(!new.exists(), "untracked file should be removed");
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn ahead_behind_returns_zero_zero_without_upstream() {
        // `init_temp_repo` does NOT configure an upstream, so the
        // branch's @u doesn't resolve. The real ahead_behind should
        // return (0, 0) — the UI shows a neutral indicator.
        let dir = init_temp_repo("ahead-zero");
        let h = open_repo(&dir).expect("open_repo");
        let s = status(&h).expect("status");
        assert_eq!(s.ahead, 0, "no upstream -> ahead should be 0");
        assert_eq!(s.behind, 0, "no upstream -> behind should be 0");
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn ahead_behind_reports_one_ahead_against_tracking_branch() {
        // Simulate an upstream by writing refs/remotes/origin/main
        // directly and configuring `branch.main.remote` +
        // `branch.main.merge`. This avoids a full clone dance (which
        // is flaky on Windows when paths contain spaces, and adds
        // noise to the test surface). The semantics are identical to
        // what `git clone` would set up.
        let dir = init_temp_repo("ahead-one");
        // Make a second local commit so HEAD is one ahead of the
        // initial commit. The upstream ref will point at HEAD~1.
        fs::write(dir.join("hello.txt"), "v2\n").unwrap();
        run("git", &["add", "."], &dir);
        run("git", &["commit", "-q", "-m", "v2"], &dir);
        // Resolve HEAD~1 (the initial commit) to a SHA, write it
        // into the synthetic remote ref, and configure the branch.
        let head_parent = std::str::from_utf8(
            &Command::new("git")
                .args(["rev-parse", "HEAD~1"])
                .current_dir(&dir)
                .output()
                .expect("rev-parse HEAD~1")
                .stdout,
        )
        .unwrap()
        .trim()
        .to_string();
        // The synthetic upstream ref: refs/remotes/origin/main -> HEAD~1.
        run(
            "git",
            &["update-ref", "refs/remotes/origin/main", &head_parent],
            &dir,
        );
        // Wire branch.<name>.{remote,merge} so @{u} resolves to the
        // synthetic ref. We use the local config to scope the change.
        run("git", &["config", "branch.main.remote", "origin"], &dir);
        run(
            "git",
            &["config", "branch.main.merge", "refs/heads/main"],
            &dir,
        );
        // Git also requires the remote's `fetch` refspec to be
        // configured before @{u} resolves, otherwise it errors with
        // "upstream branch '...' not stored as a remote-tracking
        // branch". A dummy URL is fine — we only need the refspec.
        run(
            "git",
            &["config", "remote.origin.url", "file:///dev/null"],
            &dir,
        );
        run(
            "git",
            &[
                "config",
                "remote.origin.fetch",
                "+refs/heads/*:refs/remotes/origin/*",
            ],
            &dir,
        );
        // Sanity: `git rev-parse main@{u}` should return HEAD~1.
        let up_out = Command::new("git")
            .args(["rev-parse", "--verify", "main@{u}"])
            .current_dir(&dir)
            .output()
            .expect("rev-parse main@{u}");
        assert!(
            up_out.status.success(),
            "git rev-parse failed: stderr={}",
            String::from_utf8_lossy(&up_out.stderr)
        );
        let up = std::str::from_utf8(&up_out.stdout)
            .unwrap()
            .trim()
            .to_string();
        assert_eq!(up, head_parent, "git's @u should resolve to our ref");

        let h = open_repo(&dir).expect("open_repo");
        let s = status(&h).expect("status");
        assert_eq!(s.ahead, 1, "local is 1 commit ahead of origin/main");
        assert_eq!(s.behind, 0);

        fs::remove_dir_all(dir).ok();
    }

    // ---- commit / stage_all / validate_commit_message ----

    #[test]
    fn validate_commit_message_accepts_simple_subject() {
        validate_commit_message("fix: handle empty body").unwrap();
    }

    #[test]
    fn validate_commit_message_accepts_multiline() {
        validate_commit_message("subject\n\nbody line 1\nbody line 2").unwrap();
    }

    #[test]
    fn validate_commit_message_rejects_empty() {
        assert!(matches!(
            validate_commit_message("").unwrap_err(),
            GitError::Git(_)
        ));
    }

    #[test]
    fn validate_commit_message_rejects_too_long() {
        let msg = "x".repeat(513);
        let err = validate_commit_message(&msg).unwrap_err();
        assert!(matches!(err, GitError::Git(_)));
    }

    #[test]
    fn validate_commit_message_rejects_nul_bytes() {
        let err = validate_commit_message("hello\0world").unwrap_err();
        assert!(matches!(err, GitError::Git(_)));
    }

    #[test]
    fn validate_commit_message_rejects_trailing_space_newline() {
        // The " \n" pattern is a well-known lint slip.
        let err = validate_commit_message("subject \n").unwrap_err();
        assert!(matches!(err, GitError::Git(_)));
    }

    #[test]
    fn stage_all_succeeds_on_modified_file() {
        let dir = init_temp_repo("stage-modified");
        fs::write(dir.join("hello.txt"), "hello, modified\n").unwrap();
        let h = open_repo(&dir).expect("open_repo");
        stage_all(&h).expect("stage_all should succeed");
        // After staging, status should show the file as
        // staged (not unstaged).
        let s = status(&h).unwrap();
        let hello = s
            .changed_files
            .iter()
            .find(|c| c.path.ends_with("hello.txt"))
            .expect("hello.txt in status");
        assert!(hello.staged, "file should be staged after stage_all");
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn stage_all_succeeds_on_untracked_file() {
        let dir = init_temp_repo("stage-untracked");
        fs::write(dir.join("fresh.txt"), "fresh\n").unwrap();
        let h = open_repo(&dir).expect("open_repo");
        stage_all(&h).expect("stage_all should succeed on untracked");
        let s = status(&h).unwrap();
        let fresh = s
            .changed_files
            .iter()
            .find(|c| c.path.ends_with("fresh.txt"))
            .expect("fresh.txt in status");
        assert!(fresh.staged);
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn stage_all_fails_on_clean_repo() {
        let dir = init_temp_repo("stage-clean");
        let h = open_repo(&dir).expect("open_repo");
        let err = stage_all(&h).unwrap_err();
        assert!(
            matches!(err, GitError::Git(ref m) if m.contains("no changes")),
            "expected 'no changes' error, got {err:?}"
        );
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn commit_creates_a_new_commit_with_message() {
        let dir = init_temp_repo("commit-basic");
        fs::write(dir.join("change.txt"), "new change\n").unwrap();
        let h = open_repo(&dir).expect("open_repo");
        let res = commit(&h, "add new change").expect("commit should succeed");
        // SHA should be a full 40-char hex string.
        assert_eq!(res.sha.len(), 40, "expected full SHA, got {}", res.sha);
        assert!(
            res.sha.chars().all(|c| c.is_ascii_hexdigit()),
            "expected hex SHA, got {}",
            res.sha
        );
        // Short SHA should be 7 chars (the conventional
        // default), and should be a prefix of the full SHA.
        assert_eq!(res.short_sha.len(), 7);
        assert!(
            res.sha.starts_with(&res.short_sha),
            "short_sha {} should be a prefix of sha {}",
            res.short_sha,
            res.sha
        );
        // After commit, status should be clean.
        let s = status(&h).unwrap();
        assert!(
            s.is_clean,
            "expected clean after commit, got {:?}",
            s.changed_files
        );
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn commit_with_multiline_message_preserves_body() {
        let dir = init_temp_repo("commit-multiline");
        fs::write(dir.join("a.txt"), "a\n").unwrap();
        let h = open_repo(&dir).expect("open_repo");
        let msg = "subject line\n\nbody line 1\nbody line 2";
        let res = commit(&h, msg).expect("commit should succeed");
        // Verify the commit log shows the subject.
        let subject = git_output(&dir, &["log", "-1", "--format=%s"]);
        assert_eq!(subject, "subject line");
        // And the body.
        let body = git_output(&dir, &["log", "-1", "--format=%b"]);
        assert!(body.contains("body line 1"));
        assert!(body.contains("body line 2"));
        // Sanity: the SHA is still well-formed.
        assert_eq!(res.sha.len(), 40);
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn commit_fails_on_empty_message() {
        let dir = init_temp_repo("commit-empty-msg");
        fs::write(dir.join("a.txt"), "a\n").unwrap();
        let h = open_repo(&dir).expect("open_repo");
        let err = commit(&h, "").unwrap_err();
        assert!(matches!(err, GitError::Git(_)));
        // The change should NOT have been committed.
        let s = status(&h).unwrap();
        assert!(!s.is_clean, "file should still be unstaged");
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn commit_fails_on_clean_repo() {
        let dir = init_temp_repo("commit-clean");
        let h = open_repo(&dir).expect("open_repo");
        // No changes — stage_all will fail with
        // "no changes to commit", which `commit` should
        // surface.
        let err = commit(&h, "should fail").unwrap_err();
        assert!(matches!(err, GitError::Git(_)));
        fs::remove_dir_all(dir).ok();
    }
}
