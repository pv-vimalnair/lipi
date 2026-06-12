/**
 * Typed IPC wrapper for the Rust git (gix) commands.
 *
 * Mirrors `src-tauri/src/git.rs`. Components import from `@/ipc`,
 * never from `@tauri-apps/api/core` directly (Rule 4).
 *
 * Phase 3a: read-only status and current branch.
 * Phase 3b: panel-friendly selectors (changeKindLabel / changeKindBadge).
 * Phase 3c-1: per-file `gitDiff` + `gitDiscard` commands and the
 *             `FileDiff` payload. The wire shape is locked here so
 *             3c-2's `DiffView` can build against it without an
 *             interim stub.
 */

import { invoke } from '@tauri-apps/api/core';

export type ChangeKind =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'type-change'
  | 'conflict';

export interface ChangedFile {
  path: string;
  kind: ChangeKind;
  staged: boolean;
  unstaged: boolean;
}

export interface RepoStatus {
  repoId: string;
  branch: string | null;
  isDetached: boolean;
  ahead: number;
  behind: number;
  isClean: boolean;
  changedFiles: ChangedFile[];
}

export interface RepoHandle {
  workdir: string;
}

/// Per-file diff payload for the side-panel DiffView. Mirrors the
/// `FileDiff` struct in `src-tauri/src/git.rs`.
///
///   `old` is `null` for added / untracked files.
///   `new` is `null` for deleted files.
///   `isBinary` is `true` for files containing a NUL byte in the
///              first 8 KB; both `old` and `new` will be `null` in
///              that case (3c-2 renders a "Binary file" placeholder).
///   `isNew`     — true when HEAD has no entry for the file.
///   `isDeleted` — true when the worktree has no file at the path.
///
/// `path` is the absolute worktree path (same as `ChangedFile.path`).
export interface FileDiff {
  path: string;
  old: string | null;
  new: string | null;
  isBinary: boolean;
  isNew: boolean;
  isDeleted: boolean;
}

export interface GitErrorPayload {
  kind:
    | 'NotARepository'
    | 'NotFound'
    | 'PermissionDenied'
    | 'Git';
  detail: string;
}

/**
 * Result of a successful commit. Mirrors the
 * `CommitResult` struct in `src-tauri/src/git.rs`.
 *   `sha` — full 40-character commit hash.
 *   `shortSha` — first 7 chars, suitable for
 *                display ("a1b2c3d"). The UI shows
 *                the short form in the commit
 *                toast; the full SHA is used for
 *                follow-up features (5f-style
 *                jump-to-commit, future M-phases
 *                linking AI messages to commits).
 */
export interface CommitResult {
  sha: string;
  shortSha: string;
}

export class GitError extends Error {
  readonly payload: GitErrorPayload;

  constructor(payload: GitErrorPayload) {
    super(`[${payload.kind}] ${payload.detail}`);
    this.name = 'GitError';
    this.payload = payload;
  }
}

function asGitError(err: unknown): GitError {
  if (err instanceof GitError) return err;
  if (
    typeof err === 'object' &&
    err !== null &&
    'kind' in err &&
    typeof (err as { kind: unknown }).kind === 'string'
  ) {
    return new GitError(err as GitErrorPayload);
  }
  return new GitError({ kind: 'Git', detail: String(err) });
}

/** Open a repo at the given path. Throws `GitError('NotARepository')`
 *  if the path is not a git working tree. */
export async function gitOpen(path: string): Promise<RepoHandle> {
  try {
    return await invoke<RepoHandle>('git_open', { path });
  } catch (err) {
    throw asGitError(err);
  }
}

/** Compute status for an open repo. Re-opens internally; cheap. */
export async function gitStatus(repoId: string): Promise<RepoStatus> {
  try {
    return await invoke<RepoStatus>('git_status', { repoId });
  } catch (err) {
    throw asGitError(err);
  }
}

/** Short branch name (e.g. 'main') or `null` if detached / unborn. */
export async function gitCurrentBranch(
  repoId: string,
): Promise<string | null> {
  try {
    return await invoke<string | null>('git_current_branch', { repoId });
  } catch (err) {
    throw asGitError(err);
  }
}

/** Per-file diff between HEAD and the worktree. The `path` must
 *  match the absolute path used in `ChangedFile.path`. */
export async function gitDiff(
  repoId: string,
  path: string,
): Promise<FileDiff> {
  try {
    return await invoke<FileDiff>('git_diff', { repoId, path });
  } catch (err) {
    throw asGitError(err);
  }
}

/** Discard unstaged worktree changes to a file by writing HEAD's
 *  blob back to disk (or deleting the file if it's untracked).
 *  After a successful discard the caller should `gitStatus` again
 *  to refresh the panel. */
export async function gitDiscard(
  repoId: string,
  path: string,
): Promise<void> {
  try {
    await invoke<void>('git_discard', { repoId, path });
  } catch (err) {
    throw asGitError(err);
  }
}

/**
 * Phase M4: stage all worktree changes (modified,
 * deleted, untracked). Mirrors `git add -A`. The
 * call is idempotent — calling it twice is a no-op
 * if there are no further changes. The JS side
 * uses this from the future "stage by voice" flow
 * ("stage everything but don't commit yet") and
 * also as the first half of `gitCommit` (which
 * stages internally anyway).
 *
 * Throws `GitError('Git', 'no changes to commit')`
 * if there's nothing to stage — the JS side
 * catches this and surfaces "Nothing to commit"
 * in the AIPanel toast.
 */
export async function gitStageAll(repoId: string): Promise<void> {
  try {
    await invoke<void>('git_stage_all', { repoId });
  } catch (err) {
    throw asGitError(err);
  }
}

/**
 * Phase M4: stage all worktree changes and create
 * a commit with the given message. The voice
 * command parser
 * (`src/voice/commitGrammar.ts`) produces the
 * message; this IPC writes it to the repo.
 *
 * Validation:
 *   - The Rust side rejects empty messages, >512
 *     byte messages, and NUL-byte messages
 *     (matches the `validate_commit_message`
 *     function in `git.rs`).
 *   - The `--no-verify` flag is passed
 *     automatically; a `pre-commit` hook will
 *     not block a voice command. M5 may add a
 *     "skip hooks" toggle for users who rely
 *     on hook-driven commit workflows.
 *
 * Returns `{ sha, shortSha }` on success. The
 * caller is expected to `gitStatus()` again to
 * refresh the panel — the panel's `RepoStatus`
 * is the source of truth for the user's "what's
 * changed" view.
 */
export async function gitCommit(
  repoId: string,
  message: string,
): Promise<CommitResult> {
  try {
    return await invoke<CommitResult>('git_commit', { repoId, message });
  } catch (err) {
    throw asGitError(err);
  }
}

/** Human-readable label for a change kind, used in the UI. */
export function changeKindLabel(kind: ChangeKind): string {
  switch (kind) {
    case 'added':
      return 'Added';
    case 'modified':
      return 'Modified';
    case 'deleted':
      return 'Deleted';
    case 'renamed':
      return 'Renamed';
    case 'copied':
      return 'Copied';
    case 'untracked':
      return 'Untracked';
    case 'type-change':
      return 'Type change';
    case 'conflict':
      return 'Conflict';
  }
}

/** Single-letter badge for a change kind, used in compact lists. */
export function changeKindBadge(kind: ChangeKind): string {
  switch (kind) {
    case 'added':
      return 'A';
    case 'modified':
      return 'M';
    case 'deleted':
      return 'D';
    case 'renamed':
      return 'R';
    case 'copied':
      return 'C';
    case 'untracked':
      return 'U';
    case 'type-change':
      return 'T';
    case 'conflict':
      return '!';
  }
}
