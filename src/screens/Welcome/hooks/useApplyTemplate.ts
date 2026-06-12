/**
 * useApplyTemplate — the bridge from the Welcome screen's
 * template gallery to the Rust `apply_template` command.
 *
 * Flow:
 *   1. User clicks "Create" on a card.
 *   2. `start(id)` opens the native folder picker via
 *      `pickFolder()`.
 *   3. The chosen path becomes the *parent*; we then
 *      create a fresh subdir inside it (named after
 *      the template + a short suffix) and hand that
 *      subdir to Rust. The Rust side refuses to write
 *      into a non-empty dir, so creating a subdir is
 *      mandatory.
 *   4. On success we call `openWorkspace(newDirPath)`
 *      so the new project becomes the active
 *      workspace, exactly like the regular "Open
 *      Folder" flow.
 *   5. On failure the workspace store's status is set
 *      to `error` with a friendly message; no files
 *      are left behind (atomic rollback on the Rust
 *      side).
 *
 * The hook exports a pure `applyTemplate` function
 * for unit tests, mirroring the `useOpenWorkspace`
 * pattern.
 */

import { useCallback } from 'react';

import { applyTemplate, pickFolder } from '@/ipc';
import { useWorkspaceStore } from '@/shared/state/workspaceStore';
import {
  workspaceTemplateById,
  type WorkspaceTemplateId,
} from '@/templates/registry';

import { openWorkspace } from './useOpenWorkspace';

export interface UseApplyTemplateResult {
  /** Apply a template into a freshly-picked subdir.
   *  No-op while a previous apply is in flight
   *  (workspace store status === 'opening'). */
  start: (id: WorkspaceTemplateId) => Promise<void>;
}

/** Derive a fresh subdir name from the template id.
 *  `react-vite` -> `react-vite-app`. Keeps the
 *  destination clearly named without forcing the user
 *  to type. The picker still lets them choose where
 *  the subdir lives. */
function defaultSubdirName(id: WorkspaceTemplateId): string {
  const base = workspaceTemplateById(id)?.id ?? id;
  return `${base}-app`;
}

export async function applyTemplateFlow(
  id: WorkspaceTemplateId,
): Promise<void> {
  const store = useWorkspaceStore.getState();
  if (store.status.kind === 'opening') return;

  store.setStatus({ kind: 'opening' });

  // 1. Open the picker for the parent dir.
  let parent: string | null;
  try {
    parent = await pickFolder();
  } catch (err) {
    useWorkspaceStore.getState().setStatus({
      kind: 'error',
      message:
        err instanceof Error
          ? `Could not open the folder picker: ${err.message}`
          : 'Could not open the folder picker.',
    });
    return;
  }

  if (parent === null) {
    // User cancelled. Drop back to idle.
    useWorkspaceStore.getState().setStatus({ kind: 'idle' });
    return;
  }

  // 2. Derive a fresh subdir under the picked parent.
  //    Tauri 2's path APIs aren't exposed in JS without
  //    a plugin; we use the URL API which produces the
  //    same forward-slash output on every platform.
  const subdir = defaultSubdirName(id);
  const dest = new URL(`./${subdir}`, pathToFileUrl(parent) as unknown as string)
    .pathname;

  // 3. Call Rust. The Rust side rejects if `dest`
  //    already exists with files (it would be a
  //    partial clone of the picked parent plus a
  //    subdir of the same name from a previous run).
  try {
    const res = await applyTemplate(id, dest);
    // 4. Open the new workspace.
    await openWorkspace(res.createdPaths[0] ? dest : dest);
  } catch (err) {
    useWorkspaceStore.getState().setStatus({
      kind: 'error',
      message: friendlyApplyError(err),
    });
  }
}

/** Convert a platform path to a `file://` URL. Used
 *  by `new URL('./subdir', ...)` to derive the
 *  destination path. On Windows the path looks like
 *  `C:\Users\foo`; we have to prepend `file:///` so
 *  `URL` parses it as a file URL. On POSIX
 *  `/home/foo` works as-is. */
function pathToFileUrl(p: string): string {
  if (/^[A-Za-z]:[\\/]/.test(p)) {
    return `file:///${p.replace(/\\/g, '/')}`;
  }
  if (p.startsWith('/')) {
    return `file://${p}`;
  }
  return `file:///${p}`;
}

export function useApplyTemplate(): UseApplyTemplateResult['start'] {
  return useCallback(
    (id: WorkspaceTemplateId) => applyTemplateFlow(id),
    [],
  );
}

function friendlyApplyError(err: unknown): string {
  if (err instanceof Error) {
    return `Couldn't create the project: ${err.message}`;
  }
  return "Couldn't create the project. Please try again.";
}
