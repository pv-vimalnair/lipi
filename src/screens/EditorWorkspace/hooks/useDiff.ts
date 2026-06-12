/**
 * useDiff — imperative side effects for the per-file diff view.
 *
 * Per Rule 6, the rendering component owns the data flow. The diff
 * view mounts this hook; the hook calls `gitDiff` (Rust → gix) and
 * shapes the result into a discriminated union the component can
 * switch on (loading / error / ready).
 *
 * The hook tracks the *currently-being-loaded* path. If the caller
 * passes a different `path` mid-flight, the in-flight call is
 * abandoned (its result is discarded via a captured flag) and a
 * fresh one is started. This keeps the side panel snappy when the
 * user clicks through the file list quickly.
 *
 * Discard is colocated with the load: the same hook owns both, so
 * callers don't have to import `gitDiscard` from `@/ipc` directly
 * (which would violate Rule 4).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { gitDiff, gitDiscard, GitError, type FileDiff } from '@/ipc';
import { useGitStore } from '../state/gitStore';

export type DiffLoadStatus =
  | { kind: 'idle' }
  | { kind: 'loading'; path: string }
  | { kind: 'ready'; path: string; diff: FileDiff }
  | { kind: 'error'; path: string; message: string };

export interface UseDiff {
  status: DiffLoadStatus;
  /** Re-fetch the diff for the path. No-op if status is idle. */
  refresh: () => Promise<void>;
  /**
   * Discard the worktree changes to the active file. Writes HEAD's
   * blob back (or deletes the file, for untracked). The caller is
   * responsible for also calling `useGitStatus().refresh()` after
   * this returns so the file list updates. We do that for the
   * side panel; the diff panel and the file-list row both call this
   * through the same hook.
   */
  discard: () => Promise<void>;
}

export function useDiff(activePath: string | null): UseDiff {
  const repoRootPath = useGitStore((s) => s.rootPath);
  const [status, setStatus] = useState<DiffLoadStatus>({ kind: 'idle' });
  // The active-path ref is used to discard in-flight loads when the
  // path changes (or the component unmounts). We use a ref instead
  // of closing over `activePath` directly so the load callback has
  // a stable identity across renders.
  const activePathRef = useRef<string | null>(activePath);
  activePathRef.current = activePath;

  const load = useCallback(
    async (path: string) => {
      if (!repoRootPath) {
        setStatus({ kind: 'error', path, message: 'No folder opened.' });
        return;
      }
      setStatus({ kind: 'loading', path });
      try {
        const diff = await gitDiff(repoRootPath, path);
        // The user may have navigated away while this was in flight.
        // Discard the result so the UI doesn't flash a stale diff.
        if (activePathRef.current !== path) return;
        setStatus({ kind: 'ready', path, diff });
      } catch (err) {
        if (activePathRef.current !== path) return;
        const msg =
          err instanceof GitError
            ? `${err.payload.kind}: ${err.payload.detail}`
            : String(err);
        setStatus({ kind: 'error', path, message: msg });
      }
    },
    [repoRootPath],
  );

  useEffect(() => {
    if (activePath === null) {
      setStatus({ kind: 'idle' });
      return;
    }
    void load(activePath);
  }, [activePath, load]);

  const refresh = useCallback(async () => {
    if (activePathRef.current) {
      await load(activePathRef.current);
    }
  }, [load]);

  const discard = useCallback(async () => {
    const path = activePathRef.current;
    if (!path || !repoRootPath) return;
    try {
      await gitDiscard(repoRootPath, path);
      // Re-fetch diff so the right-pane catches up to the
      // post-discard state (typically: file disappears from
      // status, diff becomes None / None).
      await load(path);
    } catch (err) {
      const msg =
        err instanceof GitError
          ? `${err.payload.kind}: ${err.payload.detail}`
          : String(err);
      setStatus({ kind: 'error', path, message: msg });
    }
  }, [load, repoRootPath]);

  return { status, refresh, discard };
}
