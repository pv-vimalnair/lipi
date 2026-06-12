/**
 * Git status state for the EditorWorkspace.
 *
 * Per Rule 3 (screen-folder layout), this store is screen-local —
 * `src/screens/EditorWorkspace/state/`, NOT in `src/shared/`. Only the
 * EditorWorkspace's side panel reads git status today.
 *
 * Per Rule 5 (best-practice defaults), the load lifecycle is modelled
 * with a discriminated union so "no repo" / "loading" / "error" /
 * "ready" states are first-class. We deliberately do NOT use a
 * `isRepo + isLoading + isError + data` boolean soup.
 *
 * Per Rule 6 (section isolation), this file owns the data. The
 * `useGitStatus` hook in `./hooks/useGitStatus.ts` owns the
 * imperative side-effects (gitOpen / gitStatus calls). Components
 * read selectors and call hook actions.
 *
 * The store is keyed by `rootPath` — when the user opens a different
 * folder, we reset to the new root. We do not cache across roots
 * (gix is fast enough that re-opening is cheap, and a stale
 * status is a worse UX than a fresh fetch).
 */

import { create } from 'zustand';
import type { ChangedFile, CommitResult, RepoStatus } from '@/ipc';

export type GitPanelStatus =
  | { kind: 'idle' } // no folder opened
  | { kind: 'opening'; rootPath: string } // calling gitOpen
  | { kind: 'not-a-repo'; rootPath: string } // gitOpen returned NotARepository
  | { kind: 'loading'; rootPath: string } // calling gitStatus
  | { kind: 'ready'; rootPath: string; status: RepoStatus }
  | { kind: 'error'; rootPath: string; message: string };

interface GitState {
  status: GitPanelStatus;
  /** Path of the folder this panel is currently tracking. Set when we
   *  start probing a root; cleared on reset. */
  rootPath: string | null;
  /** Set to true when a refresh is in flight; used to gate the
   *  "Refresh" button's loading state. */
  isRefreshing: boolean;
  /** The file the user has clicked into for a per-file diff. When
   *  set, the side panel swaps from the GitPanel (file list) to
   *  the DiffView (Monaco diff editor). Cleared on close() and on
   *  the back chevron. Phase 3c-2. */
  activeDiffPath: string | null;

  // M4: voice-driven commit state. The AIPanel
  // surface uses this to render a "Committing…"
  // status while the IPC round-trips and a
  // "Created <short-sha>" toast on success. The
  // store deliberately doesn't own the commit
  // message — that's owned by the AIPanel's
  // Composer (or the voice flow). The store
  // just tracks the lifecycle: idle / running /
  // success / error.
  commitStatus: 'idle' | 'running' | 'success' | 'error';
  /** Last successful commit (M4 voice flow uses
   *  this to show "Committed a1b2c3d via voice"
   *  for 5 seconds). Cleared on the next start. */
  lastCommit: { shortSha: string; sha: string; at: number } | null;
  /** Error message when commitStatus === 'error'.
   *  Cleared on the next start. */
  commitError: string | null;

  // --- Actions (imperative shape, used by the hook) ------------------
  setStatus: (status: GitPanelStatus) => void;
  setRefreshing: (isRefreshing: boolean) => void;
  setRoot: (rootPath: string | null) => void;
  setActiveDiffPath: (path: string | null) => void;
  reset: () => void;
  // M4 commit lifecycle
  setCommitRunning: () => void;
  setCommitSuccess: (result: CommitResult) => void;
  setCommitError: (message: string) => void;
  clearCommitResult: () => void;
}

const initial: Pick<
  GitState,
  | 'status'
  | 'rootPath'
  | 'isRefreshing'
  | 'activeDiffPath'
  | 'commitStatus'
  | 'lastCommit'
  | 'commitError'
> = {
  status: { kind: 'idle' },
  rootPath: null,
  isRefreshing: false,
  activeDiffPath: null,
  commitStatus: 'idle',
  lastCommit: null,
  commitError: null,
};

export const useGitStore = create<GitState>((set) => ({
  ...initial,
  setStatus: (status) => set({ status }),
  setRefreshing: (isRefreshing) => set({ isRefreshing }),
  setRoot: (rootPath) => set({ rootPath }),
  setActiveDiffPath: (activeDiffPath) => set({ activeDiffPath }),
  reset: () => set({ ...initial }),
  // M4: commit lifecycle actions. The store
  // doesn't call the IPC — the AIPanel
  // Composer's commit-by-voice flow calls
  // `gitCommit(...)` from `@/ipc/git` and then
  // dispatches these setters. We split the
  // responsibility because the store is the
  // "what's the visible state" surface and the
  // IPC is the "actually do the work" surface.
  setCommitRunning: () =>
    set({ commitStatus: 'running', lastCommit: null, commitError: null }),
  setCommitSuccess: (result) =>
    set({
      commitStatus: 'success',
      lastCommit: {
        shortSha: result.shortSha,
        sha: result.sha,
        at: Date.now(),
      },
      commitError: null,
    }),
  setCommitError: (message) =>
    set({ commitStatus: 'error', commitError: message, lastCommit: null }),
  clearCommitResult: () =>
    set({ commitStatus: 'idle', lastCommit: null, commitError: null }),
}));

/** Selectors — keep these tiny so components can compose them. */
export const gitSelectors = {
  status: (s: GitState) => s.status,
  rootPath: (s: GitState) => s.rootPath,
  isRefreshing: (s: GitState) => s.isRefreshing,
  activeDiffPath: (s: GitState) => s.activeDiffPath,
  changedFiles: (s: GitState): ChangedFile[] =>
    s.status.kind === 'ready' ? s.status.status.changedFiles : [],
  branch: (s: GitState): string | null =>
    s.status.kind === 'ready' ? s.status.status.branch : null,
  ahead: (s: GitState): number =>
    s.status.kind === 'ready' ? s.status.status.ahead : 0,
  behind: (s: GitState): number =>
    s.status.kind === 'ready' ? s.status.status.behind : 0,
  isClean: (s: GitState): boolean =>
    s.status.kind === 'ready' ? s.status.status.isClean : true,
  // M4 selectors. The toast is considered "visible"
  // for 5 seconds after a successful commit; the
  // `isCommitToastVisible` selector checks both the
  // status and the elapsed time. Components using
  // this should also call `clearCommitResult()`
  // when they want to dismiss early (e.g. when the
  // user starts a new recording).
  commitStatus: (s: GitState) => s.commitStatus,
  lastCommit: (s: GitState) => s.lastCommit,
  commitError: (s: GitState) => s.commitError,
  isCommitToastVisible: (s: GitState): boolean => {
    if (s.commitStatus !== 'success' || !s.lastCommit) return false;
    return Date.now() - s.lastCommit.at < 5_000;
  },
};
