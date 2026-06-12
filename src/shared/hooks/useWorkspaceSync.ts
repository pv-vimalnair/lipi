/**
 * useWorkspaceSync — the bridge
 * that makes the new
 * `useWorkspaceStore` the
 * single source of truth for
 * "which folder is open".
 *
 * Background: prior to phase
 * "Open Folder / Welcome
 * screen", the project had
 * THREE separate stores
 * tracking the workspace
 * root:
 *   - `useFileTreeStore.rootPath`
 *     (the file tree's
 *     own state)
 *   - `useGitStore.rootPath`
 *     (git status panel)
 *   - `useCustomToolsStore.workspaceRoot`
 *     (the custom-tools
 *     registry)
 *
 * The new
 * `useWorkspaceStore.currentPath`
 * is now the canonical
 * source. This hook is
 * mounted ONCE in
 * `main.tsx` and subscribes
 * to it, propagating
 * changes to the downstream
 * stores. The downstream
 * stores keep their own
 * fields (for backwards
 * compat with existing
 * components), but they are
 * derived from the
 * workspace store now.
 *
 * The file tree's own
 * `openFolder` (in
 * `useFileTree.ts`) is a
 * special case: it does
 * additional work (calls
 * `pickFolder`, lazily
 * loads the root dir). On
 * the "open from file
 * tree" path, the workspace
 * store is updated FIRST
 * (so the recents list
 * gets the path) and the
 * file tree's local state
 * follows. The
 * "open from Welcome" path
 * goes the other way:
 * workspace store updates
 * → this hook propagates
 * to the file tree.
 *
 * For `useGitStore.rootPath`
 * and
 * `useCustomToolsStore.workspaceRoot`,
 * this hook is the only
 * way they ever change now
 * (the prior
 * `openGitRoot` /
 * `setupCustomToolsPersistence`
 * callers still exist as
 * one-shot initialisation,
 * but the steady-state
 * source of truth is this
 * subscriber).
 */

import { useEffect } from 'react';

import { useFileTreeStore } from '@/screens/EditorWorkspace/state/fileTreeStore';
import { useGitStore } from '@/screens/EditorWorkspace/state/gitStore';
import { useCustomToolsStore } from '@/shared/state/customToolsStore';
import { useWorkspaceStore } from '@/shared/state/workspaceStore';

const IS_DEV = import.meta.env.DEV;

export function useWorkspaceSync(enabled: boolean = true): void {
  useEffect(() => {
    if (!enabled) return;

    // Snapshot the current
    // workspace state so the
    // initial sync (before
    // any store changes) is
    // also handled.
    const sync = (next: string | null, prev: string | null) => {
      if (next === prev) return;

      // 1. Mirror to the file
      //    tree. We only
      //    touch it if the
      //    rootPath actually
      //    changed (i.e.
      //    don't reset
      //    expansion
      //    state on
      //    every
      //    unrelated
      //    state
      //    change).
      const tree = useFileTreeStore.getState();
      if (tree.rootPath !== next) {
        if (next === null) {
          tree.reset();
        } else {
          tree.setRoot(next);
          tree.setStatus({
            kind: 'ready',
            rootPath: next,
          });
        }
      }

      // 2. Mirror to the git
      //    store. The git
      //    store doesn't
      //    load anything
      //    itself — that's
      //    `useGitStatus`'s
      //    job, which is
      //    triggered by a
      //    `rootPath`
      //    change in
      //    EditorWorkspace.
      //    We just keep
      //    `rootPath` in
      //    sync.
      useGitStore.getState().setRoot(next);

      // 3. Mirror to the
      //    custom-tools
      //    store.
      //    `customToolsStore`
      //    uses
      //    `workspaceRoot`
      //    as a
      //    string
      //    field.
      //    The
      //    `load()`
      //    action
      //    reads
      //    lipi-tools.json
      //    from
      //    disk
      //    and
      //    populates
      //    `tools`
      //    —
      //    we
      //    don't
      //    auto-call
      //    `load()`
      //    here
      //    because
      //    the
      //    Settings
      //    screen
      //    does
      //    that
      //    on
      //    mount
      //    and
    //    wants
    //    explicit
    //    control
    //    over
    //    when
    //    a
    //    re-read
    //    happens.
      const toolsState = useCustomToolsStore.getState();
      if (toolsState.workspaceRoot !== next) {
        useCustomToolsStore.setState({
          workspaceRoot: next,
        });
      }
    };

    // Run the sync once
    // for the initial state.
    sync(
      useWorkspaceStore.getState().currentPath,
      null,
    );

    // Subscribe to subsequent
    // changes. `zustand`'s
    // subscribe returns an
    // unsubscribe fn.
    const unsubscribe = useWorkspaceStore.subscribe(
      (state, prev) => {
        sync(state.currentPath, prev.currentPath);
      },
    );
    if (IS_DEV) {
      // eslint-disable-next-line no-console
      console.debug(
        '[useWorkspaceSync] mounted; downstream stores will follow the workspace store',
      );
    }
    return unsubscribe;
  }, [enabled]);
}