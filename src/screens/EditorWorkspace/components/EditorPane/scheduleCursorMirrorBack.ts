/**
 * scheduleCursorMirrorBack —
 * per-(tabId, filePath) trailing
 * debounce for the editor cursor's
 * mirror-back to the workspace
 * store.
 *
 * Used by `EditorPane`'s
 * `ActiveEditor` to throttle
 * `onDidChangeCursorPosition`
 * writes to `useWorkspaceStore`'s
 * `setEditorCursor`. A trailing
 * debounce is the right shape: the
 * user moves the cursor rapidly
 * (10+ times per second is normal
 * for arrow-key navigation), and
 * the persisted store + localStorage
 * write per move would be wasteful.
 * The debounce fires 500ms after
 * the last move, so the write
 * captures the final position.
 *
 * ## Dispose semantics
 *
 * `scheduleCursorMirrorBack` returns
 * a `dispose` callback. The
 * `EditorPane` `useEffect` cleanup
 * calls it on unmount so:
 *
 *   1. The pending write is flushed
 *      **synchronously** — a cursor
 *      move the user made just before
 *      a tab close is never lost.
 *   2. The pending `setTimeout` (or
 *      `requestIdleCallback`) is
 *      cancelled.
 *
 * If no write is pending, `dispose`
 * is a no-op.
 *
 * The flush is also exposed as a
 * standalone
 * `_flushPendingCursor(tabId, filePath)`
 * utility for cases where the
 * caller doesn't have a handle to
 * the dispose callback (e.g. the
 * `useEffect` cleanup re-creates
 * its subscription per `activeTabId`
 * change and the old schedule's
 * dispose handle is lost).
 */

import {
  useWorkspaceStore,
  type EditorCursor,
} from '@/shared/state/workspaceStore';

interface ScheduleEntry {
  kind: 'idle' | 'timeout';
  handle: number;
  cursor: EditorCursor;
}

const schedules = new Map<string, ScheduleEntry>();

function key(tabId: string, filePath: string): string {
  return `${tabId}\0${filePath}`;
}

function flush(tabId: string, filePath: string, cursor: EditorCursor): void {
  useWorkspaceStore.getState().setEditorCursor(tabId, filePath, cursor);
  schedules.delete(key(tabId, filePath));
}

function cancel(entry: ScheduleEntry): void {
  if (entry.kind === 'idle') {
    if (typeof cancelIdleCallback === 'function') {
      cancelIdleCallback(entry.handle);
    }
  } else {
    clearTimeout(entry.handle);
  }
}

/**
 * Trailing-debounce the cursor
 * mirror-back per (tabId, filePath).
 *
 * Implementation: a module-level
 * Map keyed by `tabId + '\0' +
 * filePath`. A new move cancels any
 * previously scheduled write for
 * the same key and schedules a
 * new one. The new write fires
 * after `requestIdleCallback`
 * (500ms timeout) in browsers, or
 * after `setTimeout(500ms)` in
 * test envs (and in environments
 * where `requestIdleCallback` is
 * missing).
 *
 * Returns a `dispose` function.
 * Calling `dispose`:
 *   1. Cancels any pending schedule
 *      (no future write fires).
 *   2. If a write was pending,
 *      **flushes it synchronously**
 *      before returning — a cursor
 *      move the user made just
 *      before a tab close is never
 *      lost.
 *
 * If no write is pending, `dispose`
 * is a no-op.
 */
export function scheduleCursorMirrorBack(
  tabId: string,
  filePath: string,
  cursor: EditorCursor,
): () => void {
  const k = key(tabId, filePath);
  const prev = schedules.get(k);
  if (prev) cancel(prev);
  let handle: number;
  if (typeof requestIdleCallback === 'function') {
    handle = requestIdleCallback(() => flush(tabId, filePath, cursor), {
      timeout: 500,
    }) as unknown as number;
    schedules.set(k, { kind: 'idle', handle, cursor });
  } else {
    handle = setTimeout(() => flush(tabId, filePath, cursor), 500) as unknown as number;
    schedules.set(k, { kind: 'timeout', handle, cursor });
  }
  return () => {
    const pending = schedules.get(k);
    if (!pending) return;
    cancel(pending);
    // The cursor might have been updated by a more recent call before
    // the dispose; we use the LATEST cursor from the schedule entry.
    flush(tabId, filePath, pending.cursor);
  };
}

/** Test/utility: synchronously flush any pending cursor write for
 *  (tabId, filePath). Returns `true` if a write was flushed, `false`
 *  if no schedule was pending. Used by `EditorPane`'s unmount
 *  cleanup to ensure the last cursor move is persisted. */
export function _flushPendingCursor(
  tabId: string,
  filePath: string,
): boolean {
  const k = key(tabId, filePath);
  const pending = schedules.get(k);
  if (!pending) return false;
  cancel(pending);
  flush(tabId, filePath, pending.cursor);
  return true;
}

/** Test-only helper. Clears all pending schedules. */
export function _resetCursorSchedulesForTests(): void {
  for (const entry of schedules.values()) cancel(entry);
  schedules.clear();
}
