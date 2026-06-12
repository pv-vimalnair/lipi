/**
 * useFileTree — imperative side effects for the file tree.
 *
 * Per Rule 6, the store (`state/fileTreeStore.ts`) owns the data and
 * the components own the rendering. This hook is the only place that
 * calls `readDir` / `pickFolder` — that keeps IPC calls in one
 * verifiable place and makes the rendering layer pure.
 *
 * Phase 2b keeps this hook thin: open-folder, lazy-load directory
 * children. Future phases may add a `notify`-driven live refresh
 * (D2 watcher), rename/move/delete (D3 git+fs ops), and search.
 *
 * Welcome-screen integration: when the user opens a folder via the
 * Welcome screen (or the command palette's "Open Folder…" shortcut),
 * the workspace store updates first; the file tree's own `openFolder`
 * is a fallback for the case where the user clicks the file tree's
 * own "open" affordance. Both paths converge on the same
 * `useFileTreeStore` state — the file tree is the consumer, the
 * workspace store is the source of truth.
 */

import { useCallback } from 'react';
import { readDir, pickFolder, FsError } from '@/ipc';
import { useWorkspaceStore } from '@/shared/state/workspaceStore';
import { useFileTreeStore } from '../state/fileTreeStore';

export interface UseFileTree {
  /** Open the native folder picker and start a session. */
  openFolder: () => Promise<void>;
  /** Load a directory's children if we haven't already. */
  ensureLoaded: (dirPath: string) => Promise<void>;
  /** Toggle a directory's expanded state and lazy-load if needed. */
  toggle: (dirPath: string) => Promise<void>;
  /** Select a path (file or directory). Logs the path for now —
   *  Phase 2c will open the file in the editor. */
  select: (path: string) => void;
  /** Reset the tree to the idle state. */
  close: () => void;
}

export function useFileTree(): UseFileTree {
  const setStatus = useFileTreeStore((s) => s.setStatus);
  const setRoot = useFileTreeStore((s) => s.setRoot);
  const setEntries = useFileTreeStore((s) => s.setEntries);
  const toggleExpanded = useFileTreeStore((s) => s.toggleExpanded);
  const selectPath = useFileTreeStore((s) => s.select);
  const reset = useFileTreeStore((s) => s.reset);

  const loadDir = useCallback(
    async (dirPath: string) => {
      try {
        const entries = await readDir(dirPath);
        setEntries(dirPath, entries);
      } catch (err) {
        const msg =
          err instanceof FsError
            ? `${err.payload.kind}: ${err.payload.detail}`
            : String(err);
        setStatus({ kind: 'error', message: msg });
      }
    },
    [setEntries, setStatus],
  );

  const openFolder = useCallback(async () => {
    setStatus({ kind: 'opening' });
    try {
      const chosen = await pickFolder();
      if (!chosen) {
        // User cancelled — return to the previous state (idle or ready).
        setStatus({ kind: 'idle' });
        return;
      }
      // Push to the
      // workspace
      // store first
      // — it owns
      // the
      // "current
      // path"
      // source of
      // truth
      // (which the
      // router
      // reads and
      // the
      // recents
      // list
      // appends
      // to).
      useWorkspaceStore.getState().open(chosen);
      setRoot(chosen);
      setStatus({ kind: 'loading', rootPath: chosen });
      await loadDir(chosen);
      setStatus({ kind: 'ready', rootPath: chosen });
    } catch (err) {
      const msg =
        err instanceof FsError
          ? `${err.payload.kind}: ${err.payload.detail}`
          : String(err);
      setStatus({ kind: 'error', message: msg });
    }
  }, [loadDir, setRoot, setStatus]);

  const ensureLoaded = useCallback(
    async (dirPath: string) => {
      const has = useFileTreeStore.getState().entriesByDir[dirPath];
      if (has) return;
      await loadDir(dirPath);
    },
    [loadDir],
  );

  const toggle = useCallback(
    async (dirPath: string) => {
      const wasExpanded = useFileTreeStore.getState().expanded.has(dirPath);
      toggleExpanded(dirPath);
      if (!wasExpanded) {
        await ensureLoaded(dirPath);
      }
    },
    [ensureLoaded, toggleExpanded],
  );

  const select = useCallback(
    (path: string) => {
      // The store is the only side-effect here. The EditorWorkspace
      // owns the wiring to the editor (open the file) — keeping
      // this hook decoupled from the editor per Rule 6.
      selectPath(path);
    },
    [selectPath],
  );

  const close = useCallback(() => {
    reset();
    // Mirror to the
    // workspace
    // store so the
    // router
    // routes back
    // to the
    // Welcome
    // screen.
    useWorkspaceStore.getState().close();
  }, [reset]);

  return { openFolder, ensureLoaded, toggle, select, close };
}
