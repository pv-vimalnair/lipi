/**
 * useFileTree — imperative side effects for the file tree.
 *
 * Per Rule 6, the store (`state/fileTreeStore.ts`) owns the data and
 * the components own the rendering. This hook is the only place that
 * calls `readDir` / `pickFolder` — that keeps IPC calls in one
 * verifiable place and makes the rendering layer pure.
 *
 * The mutation actions (`create`, `delete`, `rename`) follow the same
 * pattern: call a single Rust command, then refresh the affected
 * directory's entries via the existing `loadDir` private helper. The
 * pure path helpers (`parentDir`, `isDescendant`) are exported
 * alongside the hook so tests can exercise them without a React
 * renderer.
 *
 * Welcome-screen integration: when the user opens a folder via the
 * Welcome screen (or the command palette's "Open Folder…" shortcut),
 * the workspace store updates first; the file tree's own `openFolder`
 * is a fallback for the case where the user clicks the file tree's
 * own "open" affordance. Both paths converge on the same
 * `useFileTreeStore` state — the file tree is the consumer, the
 * workspace store is the source of truth.
 */

import { useCallback, useEffect, useRef } from 'react';
import {
  readDir,
  pickFolder,
  FsError,
  createFile,
  deleteEntry,
  renameEntry,
  onFsChange,
  startWatch,
  stopWatch,
  type FsChangePayload,
  type FsEntry,
  type WatchHandle,
} from '@/ipc';
import { useWorkspaceStore } from '@/shared/state/workspaceStore';
import { useFileTreeStore } from '../state/fileTreeStore';

export interface UseFileTree {
  /** Open the native folder picker and start a session. */
  openFolder: () => Promise<void>;
  /** Load a directory's children if we haven't already. */
  ensureLoaded: (dirPath: string) => Promise<void>;
  /** Toggle a directory's expanded state and lazy-load if needed. */
  toggle: (dirPath: string) => Promise<void>;
  /** Re-read a directory's children and push them to the store. */
  refresh: (dirPath: string) => Promise<void>;
  /** Select a path (file or directory). */
  select: (path: string) => void;
  /** Reset the tree to the idle state. */
  close: () => void;
  /** Create an empty file at `path`. Refreshes the parent
   *  directory on success. */
  create: (path: string) => Promise<void>;
  /** Delete `path` (file or directory, recursive). Refreshes the
   *  parent on success and clears selection if the deleted path
   *  was the selected one. */
  delete: (path: string) => Promise<void>;
  /** Rename `from` → `to`. Refreshes both directories so the
   *  tree reflects the move. Updates selection if the renamed
   *  path was the selected one. */
  rename: (from: string, to: string) => Promise<void>;
  /** Start watching a directory. Returns the
   *  handle. The component is responsible for
   *  calling `stopWatchOnHandle` on teardown. */
  startWatch: (dirPath: string) => Promise<WatchHandle>;
  /** Stop the watcher for a handle. Safe to
   *  call with an id that's already been
   *  stopped (the Rust side returns `false`). */
  stopWatchOnHandle: (handle: WatchHandle) => Promise<void>;
}

/**
 * Return the parent directory of a file path,
 * or `null` if `path` has no parent (which
 * shouldn't happen for any plausible file path
 * — we keep the null-return for the safety of
 * path-handling code).
 *
 * Exported for testing. Handles both POSIX (`/`)
 * and Windows (`\`) separators because the Rust
 * `Path::display` may emit either, and the file
 * tree is cross-platform.
 */
export function parentDir(path: string): string | null {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (idx <= 0) return null;
  return path.slice(0, idx);
}

/**
 * `true` if `maybeChild` is `parent` or a path
 * nested under it. Used to decide whether a
 * selection needs clearing after a recursive
 * delete. Handles both separator styles.
 *
 * Exported for testing.
 */
export function isDescendant(
  maybeChild: string | null,
  parent: string,
): boolean {
  if (!maybeChild) return false;
  if (maybeChild === parent) return true;
  const sep = parent.includes('\\') ? '\\' : '/';
  const prefix = parent.endsWith(sep) ? parent : parent + sep;
  return maybeChild.startsWith(prefix);
}

/**
 * Read a directory's entries and push them to
 * the store. The single place that calls
 * `readDir` IPC — every refresh / lazy-load
 * funnels through here so errors hit the
 * store's status field once.
 *
 * Exported for testing (the mutation actions
 * call it via the store's action).
 */
export async function loadDirIntoStore(
  dirPath: string,
  setEntries: (path: string, entries: FsEntry[]) => void,
  setStatus: (status: ReturnType<typeof useFileTreeStore.getState>['status']) => void,
): Promise<void> {
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
}

/**
 * Create an empty file. Pure function (aside
 * from the store + IPC side effects, both of
 * which tests mock). The JS side is
 * responsible for picking a name that doesn't
 * already exist — the Rust `create_file`
 * refuses to overwrite.
 *
 * On success, refreshes the parent directory
 * so the new file appears in the tree.
 */
export async function createInTree(
  path: string,
  refresh: (dirPath: string) => Promise<void>,
): Promise<void> {
  try {
    await createFile(path);
    const parent = parentDir(path);
    if (parent) await refresh(parent);
  } catch (err) {
    throw err instanceof FsError ? err : new Error(String(err));
  }
}

/**
 * Delete a file or directory. Recurses via
 * the Rust `delete_entry`. On success,
 * refreshes the parent directory and clears
 * the tree's selection if the deleted path was
 * the selected one or an ancestor of it.
 */
export async function deleteInTree(
  path: string,
  refresh: (dirPath: string) => Promise<void>,
): Promise<void> {
  try {
    await deleteEntry(path);
    const parent = parentDir(path);
    if (parent) await refresh(parent);
    const selected = useFileTreeStore.getState().selectedPath;
    if (selected === path || isDescendant(selected, path)) {
      useFileTreeStore.getState().select(null);
    }
  } catch (err) {
    throw err instanceof FsError ? err : new Error(String(err));
  }
}

/**
 * Rename a file or directory. On success,
 * refreshes both the source and destination
 * parent directories (they may be the same)
 * and updates the selection if the renamed
 * path was the selected one.
 */
export async function renameInTree(
  from: string,
  to: string,
  refresh: (dirPath: string) => Promise<void>,
): Promise<void> {
  try {
    await renameEntry(from, to);
    const fromParent = parentDir(from);
    const toParent = parentDir(to);
    if (fromParent) await refresh(fromParent);
    if (toParent && toParent !== fromParent) {
      await refresh(toParent);
    }
    const selected = useFileTreeStore.getState().selectedPath;
    if (selected === from) {
      useFileTreeStore.getState().select(to);
    }
  } catch (err) {
    throw err instanceof FsError ? err : new Error(String(err));
  }
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
      await loadDirIntoStore(dirPath, setEntries, setStatus);
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
      // Push to the workspace store first — it
      // owns the "current path" source of truth
      // (which the router reads and the recents
      // list appends to).
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

  const refresh = useCallback(
    async (dirPath: string) => {
      await loadDir(dirPath);
    },
    [loadDir],
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
    // Mirror to the workspace store so the
    // router routes back to the Welcome screen.
    useWorkspaceStore.getState().close();
  }, [reset]);

  const create = useCallback(
    async (path: string) => createInTree(path, refresh),
    [refresh],
  );

  const deleteOp = useCallback(
    async (path: string) => deleteInTree(path, refresh),
    [refresh],
  );

  const renameOp = useCallback(
    async (from: string, to: string) => renameInTree(from, to, refresh),
    [refresh],
  );

  const startWatchCb = useCallback(
    async (dirPath: string) => {
      const handle = await startWatch(dirPath);
      return handle;
    },
    [],
  );

  const stopWatchOnHandle = useCallback(
    async (handle: WatchHandle) => {
      await stopWatch(handle.id);
    },
    [],
  );

  return {
    openFolder,
    ensureLoaded,
    toggle,
    refresh,
    select,
    close,
    create,
    delete: deleteOp,
    rename: renameOp,
    startWatch: startWatchCb,
    stopWatchOnHandle,
  };
}

/**
 * The per-event decision logic for the
 * file-tree watcher, extracted as a pure
 * function so tests can exercise it
 * without a React renderer.
 *
 * Returns the action to take (or
 * `'skip'` if the event should be
 * ignored):
 *   - 'skip'           — the directory
 *                         isn't loaded, or
 *                         the event is for a
 *                         different watched
 *                         path.
 *   - 'drop'           — the event is a
 *                         Remove, drop the
 *                         cached entries.
 *   - 'refresh'        — schedule a
 *                         refresh of the
 *                         directory.
 *
 * Exported for testing.
 */
export type FsChangeAction = 'skip' | 'drop' | 'refresh';

export function decideFsChangeAction(
  payload: FsChangePayload,
  loadedPaths: ReadonlySet<string>,
): FsChangeAction {
  if (!loadedPaths.has(payload.watchedPath)) return 'skip';
  if (payload.kind === 'remove') return 'drop';
  return 'refresh';
}

/**
 * Subscribe to `fs://changed` events for the
 * lifetime of the calling component. The
 * callback is `loadDirIntoStore`'s caller —
 * we debounce per directory and skip events
 * for directories we haven't loaded (so an
 * external `git pull` that creates a
 * thousand entries in `.git/` doesn't
 * trigger a thousand refreshes).
 *
 * The hook takes a `refresh` callback so
 * tests can pass a stub. The production
 * caller (`FileTreePane`) wires the
 * `useFileTree().refresh` action into this.
 */
export function useFileTreeWatcher(
  refresh: (dirPath: string) => Promise<void>,
): void {
  // Per-directory debounce timers. We keep
  // them in a ref so changing `refresh`
  // doesn't reset the debounce state.
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  // The most recent `refresh` we want to
  // call when the debounce fires. Same
  // reason as above.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    void onFsChange((payload: FsChangePayload) => {
      const watched = payload.watchedPath;
      const action = decideFsChangeAction(
        payload,
        // Snapshot the keys — reading
        // `entriesByDir` directly inside
        // the callback would be a
        // re-render hazard.
        new Set(Object.keys(useFileTreeStore.getState().entriesByDir)),
      );
      if (action === 'skip') return;
      if (action === 'drop') {
        useFileTreeStore.getState().dropEntries(watched);
      }

      // Debounce per-directory: a 75 ms
      // burst-coalesce in Rust is already
      // in place, but a user deleting
      // several files via the OS file
      // manager can produce multiple
      // 75 ms-coalesced events in quick
      // succession. We add a 150 ms
      // follow-up debounce on the JS side
      // to absorb that.
      const existing = timersRef.current.get(watched);
      if (existing) clearTimeout(existing);
      const t = setTimeout(() => {
        timersRef.current.delete(watched);
        void refreshRef.current(watched).catch(() => {
          // Swallow — the refresh
          // action's own error path
          // (setStatus to error) will
          // have already surfaced the
          // message in the UI.
        });
      }, 150);
      timersRef.current.set(watched, t);
    }).then((off) => {
      if (cancelled) {
        off();
      } else {
        unlisten = off;
      }
    });

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
      // Clear any pending timers on
      // teardown so we don't fire a
      // refresh after the component
      // unmounted.
      for (const t of timersRef.current.values()) clearTimeout(t);
      timersRef.current.clear();
    };
  }, []);
}
