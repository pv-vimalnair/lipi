/**
 * useGitStatus — imperative side effects for the git panel.
 *
 * Per Rule 6, the store (`state/gitStore.ts`) owns the data and the
 * components own the rendering. This hook is the only place that
 * calls `gitOpen` / `gitStatus` — that keeps IPC calls in one
 * verifiable place and makes the rendering layer pure.
 *
 * Lifecycle:
 *   - On `openRoot(path)`: try to open the repo. If the path is not a
 *     git working tree, surface 'not-a-repo'. Otherwise fetch status
 *     and surface 'ready'.
 *   - `refresh()` re-fetches status for the current root.
 *   - `close()` resets the store (called when the file tree is closed).
 *
 * Per Rule 5, we do not throw exceptions to the caller for known
 * cases like "not a git repository" — those are first-class states in
 * `GitPanelStatus`. We do propagate unexpected errors (e.g. permission
 * denied, gix internal errors) as 'error'.
 */

import { useCallback } from 'react';
import { gitOpen, gitStatus, GitError } from '@/ipc';
import { useGitStore } from '../state/gitStore';

export interface UseGitStatus {
  /** Start tracking a new root path. Idempotent on the same path. */
  openRoot: (rootPath: string) => Promise<void>;
  /** Re-fetch status for the currently tracked root. */
  refresh: () => Promise<void>;
  /** Reset to idle. */
  close: () => void;
}

export function useGitStatus(): UseGitStatus {
  const setStatus = useGitStore((s) => s.setStatus);
  const setRefreshing = useGitStore((s) => s.setRefreshing);
  const setRoot = useGitStore((s) => s.setRoot);
  const setActiveDiffPath = useGitStore((s) => s.setActiveDiffPath);
  const reset = useGitStore((s) => s.reset);

  const openRoot = useCallback(
    async (rootPath: string) => {
      setRoot(rootPath);
      setStatus({ kind: 'opening', rootPath });
      try {
        const handle = await gitOpen(rootPath);
        setStatus({ kind: 'loading', rootPath: handle.workdir });
        const status = await gitStatus(handle.workdir);
        setStatus({ kind: 'ready', rootPath: handle.workdir, status });
      } catch (err) {
        if (err instanceof GitError && err.payload.kind === 'NotARepository') {
          setStatus({ kind: 'not-a-repo', rootPath });
          return;
        }
        const msg =
          err instanceof GitError
            ? `${err.payload.kind}: ${err.payload.detail}`
            : String(err);
        setStatus({ kind: 'error', rootPath, message: msg });
      }
    },
    [setRoot, setStatus],
  );

  const refresh = useCallback(async () => {
    const current = useGitStore.getState();
    if (current.status.kind === 'idle' || !current.rootPath) return;
    const rootPath = current.rootPath;
    setRefreshing(true);
    setStatus({ kind: 'loading', rootPath });
    try {
      // Re-open to get a fresh handle in case the root moved.
      const handle = await gitOpen(rootPath);
      const status = await gitStatus(handle.workdir);
      setStatus({ kind: 'ready', rootPath: handle.workdir, status });
    } catch (err) {
      if (err instanceof GitError && err.payload.kind === 'NotARepository') {
        setStatus({ kind: 'not-a-repo', rootPath });
        return;
      }
      const msg =
        err instanceof GitError
          ? `${err.payload.kind}: ${err.payload.detail}`
          : String(err);
      setStatus({ kind: 'error', rootPath, message: msg });
    } finally {
      setRefreshing(false);
    }
  }, [setRefreshing, setStatus]);

  const close = useCallback(() => {
    // Closing the file tree also closes any open diff view (Phase
    // 3c-2). `reset()` clears status / rootPath / isRefreshing, but
    // activeDiffPath lives in the same store and is owned by the
    // side panel, so we set it explicitly here. The orchestrator
    // calls `close()` only when the rootPath is dropped to null.
    setActiveDiffPath(null);
    reset();
  }, [reset, setActiveDiffPath]);

  return { openRoot, refresh, close };
}
