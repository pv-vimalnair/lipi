/**
 * useOpenWorkspace — the
 * single bridge between the
 * "Open Folder" UI and the
 * Tauri filesystem.
 *
 * Returns an `open(path?)`
 * function. When called
 * without arguments it
 * launches the native
 * folder picker via
 * `pickFolder()`. When
 * called with a path
 * (e.g. clicking a recent)
 * it skips the picker.
 *
 * The hook owns the
 * transient UI states
 * (opening, error). The
 * workspace store owns the
 * ground truth
 * (`currentPath`); the
 * hook flips `status` to
 * `{ kind: 'opening' }`
 * while the picker is
 * up so the button can
 * show a spinner, then
 * commits the chosen path
 * to the store on success
 * or sets the error
 * banner on failure.
 *
 * Per Rule 6 (section
 * isolation), this hook
 * lives in the Welcome
 * screen folder even
 * though the
 * `commandPaletteStore`
 * also uses it — the
 * palette's "Open
 * Folder" command is
 * defined here, not in
 * the palette folder,
 * because the
 * business logic for
 * "open a workspace"
 * is the Welcome
 * screen's concern.
 *
 * The hook is a thin
 * `useCallback` wrapper
 * around the pure
 * `openWorkspace(path)`
 * function (exported for
 * tests). The pure
 * function holds the
 * actual control flow so
 * we can test it
 * without rendering a
 * React tree.
 */

import { useCallback } from 'react';

import { pickFolder, FsError } from '@/ipc';
import {
  useWorkspaceStore,
} from '@/shared/state/workspaceStore';

export interface UseOpenWorkspaceResult {
  /** Open the native folder
   * picker (no-arg) or
   * re-open a specific path
   * (with-arg). */
  open: (path?: string) => Promise<void>;
}

/** Pure control flow. Exported
 *  for tests; production
 *  callers use the
 *  `useOpenWorkspace` hook. */
export async function openWorkspace(
  path?: string,
): Promise<void> {
  const store = useWorkspaceStore.getState();

  // Block concurrent
  // opens. If the picker
  // is already up, or a
  // previous open is still
  // in flight, the second
  // call is a no-op.
  if (store.status.kind === 'opening') return;

  store.setStatus({ kind: 'opening' });

  let chosen: string | null = path ?? null;
  if (chosen === null) {
    try {
      chosen = await pickFolder();
    } catch (err) {
      // The native
      // dialog
      // threw
      // unexpectedly
      // — show an
      // error
      // banner.
      // (A
      // user
      // cancel
      // returns
      // `null`,
      // not
      // a
      // throw,
      // so
      // this
      // branch
      // is
      // for
      // genuine
      // errors
      // only.)
      useWorkspaceStore
        .getState()
        .setStatus({
          kind: 'error',
          message: friendlyError(err),
        });
      return;
    }
  }

  if (chosen === null) {
    // User cancelled. Drop
    // back to idle so the
    // "Open Folder" button
    // is clickable again.
    useWorkspaceStore
      .getState()
      .setStatus({ kind: 'idle' });
    return;
  }

  // Commit the chosen path
  // to the store. The
  // `open()` action also
  // updates `recents` and
  // persists both keys.
  useWorkspaceStore.getState().open(chosen);
}

export function useOpenWorkspace(): UseOpenWorkspaceResult['open'] {
  return useCallback(
    (path?: string) => openWorkspace(path),
    [],
  );
}

/** Format a thrown Tauri /
 *  FS error into a
 *  user-readable one-liner. */
function friendlyError(err: unknown): string {
  if (err instanceof FsError) {
    return `Could not open folder: ${err.payload.kind === 'PermissionDenied' ? 'permission denied' : err.payload.detail}`;
  }
  return 'Could not open the folder picker. Please try again.';
}

