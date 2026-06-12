/**
 * Typed IPC wrapper for the Rust file-system watcher commands.
 *
 * The Rust side registers `fs_watch` and `fs_unwatch`
 * (see `src-tauri/src/lib.rs`) and emits a
 * `fs://changed` event whenever a watched
 * directory's contents change. The Tauri
 * command returns a `WatchHandle` (id + path)
 * and the event payload describes what
 * changed.
 *
 * Usage pattern in the file-tree store:
 *   1. User opens a folder → store calls
 *      `startWatch(rootPath)`, remembers the
 *      handle.
 *   2. User expands a directory → store calls
 *      `startWatch(dirPath)`.
 *   3. User collapses the directory → store
 *      calls `stopWatch(handle)`.
 *   4. A `fs://changed` event arrives →
 *      store calls `loadDirIntoStore` for
 *      the affected directory.
 *
 * Burst debouncing is handled in the Rust
 * drain loop (75 ms window) so a single
 * editor save typically produces one event
 * for the JS side, not three.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface WatchHandle {
  id: number;
  path: string;
}

export type FsChangeKind = 'create' | 'modify' | 'remove' | 'any';

export interface FsChangePayload {
  kind: FsChangeKind;
  paths: string[];
  watchedPath: string;
}

/** Tauri event name — kept in sync with
 *  `FS_WATCHER_EVENT` in
 *  `src-tauri/src/fs_watcher.rs`. */
export const FS_WATCHER_EVENT = 'fs://changed';

/**
 * Start watching `path`. Returns a
 * `WatchHandle` whose `id` is needed to stop
 * the watch later.
 *
 * Throws a string error if `path` is not a
 * directory (the Rust command checks
 * `Path::is_dir` and returns a plain
 * `Err(String)` otherwise).
 *
 * Idempotent: the Rust side deduplicates by
 * path, so calling twice returns the same
 * handle.
 */
export async function startWatch(path: string): Promise<WatchHandle> {
  return await invoke<WatchHandle>('fs_watch', { path });
}

/**
 * Stop the watcher with this id. Returns
 * `true` if a watcher was removed, `false`
 * if no watcher with that id was registered
 * (the JS side may have called `stopWatch`
 * twice on collapse, which is fine).
 */
export async function stopWatch(id: number): Promise<boolean> {
  return await invoke<boolean>('fs_unwatch', { id });
}

/**
 * Subscribe to `fs://changed` events. The
 * callback receives the coalesced
 * `FsChangePayload`. Returns the
 * `UnlistenFn` the caller should invoke on
 * teardown.
 */
export async function onFsChange(
  callback: (payload: FsChangePayload) => void,
): Promise<UnlistenFn> {
  return await listen<FsChangePayload>(FS_WATCHER_EVENT, (event) => {
    callback(event.payload);
  });
}
