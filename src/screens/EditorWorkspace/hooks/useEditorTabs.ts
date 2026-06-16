/**
 * useEditorTabs — imperative side effects for the editor tabs.
 *
 * Per Rule 6, the store (`state/editorTabsStore.ts`) owns the data
 * and components own the rendering. This hook is the only place that
 * calls `readFile` / `writeFile` for editor purposes (the FS hook in
 * `useFileTree` does the same for tree purposes — keeping the
 * surfaces separate per Rule 4).
 *
 * Phase 2c exposes three actions:
 *   openFile(path)  — read from disk, create/upsert tab, activate
 *   saveActive()    — write the active tab to disk, mark clean
 *   closeTab(id)    — close tab, return focus to the next/prev
 *
 * Cross-screen wiring: 2b's `useFileTree.select(path)` only logs the
 * path today. To complete the loop, we update `useFileTree` to also
 * call `useEditorTabs.openFile(path)` when a file is selected —
 * implemented as a small effect at the EditorWorkspace level (the
 * natural place for cross-feature wiring).
 *
 * M6b: per-tab state keying.
 *
 * The live editor tabs store
 * is a "view" over the active
 * workspace tab's
 * `state.openEditorTabPaths`
 * / `state.activeEditorTabPath`.
 * The hook does two things on
 * top of the M6a behaviour:
 *
 *  1. **Tab switch → rehydrate**.
 *     When the user switches
 *     workspace tabs, the
 *     `useEffect` subscribes
 *     to `useWorkspaceStore`
 *     and pushes the new
 *     active tab's
 *     `openEditorTabPaths` /
 *     `activeEditorTabPath`
 *     into the live store. For
 *     each path it dispatches
 *     a `readFile` IPC to
 *     re-create the
 *     `EditorTab` with
 *     `tabFromLoaded`. (The
 *     `EditorTab.content` is
 *     NOT persisted — we
 *     re-read from disk each
 *     time. Stale buffers
 *     after a relaunch are
 *     worse than a brief
 *     "loading" flash.)
 *
 *  2. **Mutation mirror-back**.
 *     When the user opens /
 *     closes an editor tab,
 *     the corresponding
 *     callback mirrors the
 *     new `order` / `activeId`
 *     back to the active
 *     workspace tab's
 *     `state` via
 *     `useWorkspaceStore.setTabState`.
 *     Activate (click an
 *     existing tab) is
 *     handled by the
 *     `EditorTabsStrip`
 *     component calling
 *     `useEditorTabsStore.activate`
 *     directly, which the
 *     rehydrate effect's
 *     "no-op if active tab id
 *     didn't change" guard
 *     lets pass through
 *     without a rehydrate.
 *     We also mirror the
 *     active-tab change back
 *     to the persisted state
 *     via a small
 *     subscription on the
 *     editor tabs store.
 */

import { useCallback, useEffect } from 'react';
import { readFile, writeFile, FsError } from '@/ipc';
import {
  tabFromLoaded,
  useEditorTabsStore,
  type EditorTab,
} from '../state/editorTabsStore';
import { useWorkspaceStore } from '@/shared/state/workspaceStore';

export interface UseEditorTabs {
  openFile: (path: string) => Promise<void>;
  saveActive: () => Promise<void>;
  closeTab: (id: string) => void;
  setContent: (id: string, content: string) => void;
}

/**
 * Build a fresh loading `EditorTab` for `path`. Pure function so
 * tests can exercise it. The `displayName` and `language` are
 * placeholders — the IPC `readFile` round-trip fills them in via
 * `tabFromLoaded`.
 */
function loadingTab(path: string): EditorTab {
  return {
    id: path,
    path,
    displayName: path,
    language: 'plaintext',
    content: '',
    savedContent: '',
    load: { kind: 'loading' },
  };
}

export function useEditorTabs(): UseEditorTabs {
  const upsertTab = useEditorTabsStore((s) => s.upsertTab);
  const setLoad = useEditorTabsStore((s) => s.setLoad);
  const setContent = useEditorTabsStore((s) => s.setContent);
  const markSaved = useEditorTabsStore((s) => s.markSaved);
  const closeStore = useEditorTabsStore((s) => s.close);
  const replaceAll = useEditorTabsStore((s) => s.replaceAll);

  /**
   * M6b: mirror the live `order` / `activeId` back to the active
   * workspace tab's `state`. Called from `openFile` and `closeTab`
   * after the live mutation settles. Defensive: if no workspace
   * tab is active (the user closed all tabs), the mirror is a
   * no-op (the live state will be cleared by the tab-switch
   * rehydrate when the user opens a new tab).
   */
  const mirrorOpenEditorTabsToActiveTab = useCallback(() => {
    const activeId = useWorkspaceStore.getState().activeId;
    if (!activeId) return;
    const { order, activeId: liveActive } = useEditorTabsStore.getState();
    useWorkspaceStore.getState().setTabState(activeId, {
      openEditorTabPaths: [...order],
      activeEditorTabPath: liveActive,
    });
  }, []);

  const openFile = useCallback(
    async (path: string) => {
      // Optimistic placeholder tab so the UI shows feedback instantly.
      upsertTab(loadingTab(path));
      // M6b: mirror the new
      // `order` / `activeId`
      // back to the active
      // workspace tab's
      // `state`. We pull the
      // post-`upsertTab` state
      // (the optimistic
      // placeholder is
      // already in `order`).
      mirrorOpenEditorTabsToActiveTab();
      try {
        const loaded = await readFile(path);
        // If the file is binary, show a minimal message instead of Monaco.
        if (loaded.encoding === 'binary') {
          upsertTab({
            ...loadingTab(path),
            load: { kind: 'loaded', encoding: 'binary' },
          });
          return;
        }
        upsertTab(tabFromLoaded(path, loaded));
      } catch (err) {
        const msg =
          err instanceof FsError
            ? `${err.payload.kind}: ${err.payload.detail}`
            : String(err);
        setLoad(path, { kind: 'error', message: msg });
      }
    },
    [upsertTab, setLoad, mirrorOpenEditorTabsToActiveTab],
  );

  const saveActive = useCallback(async () => {
    const { activeId, tabs } = useEditorTabsStore.getState();
    if (!activeId) return;
    const tab = tabs[activeId];
    if (!tab) return;
    if (tab.load.kind === 'loaded' && tab.load.encoding === 'binary') return;
    try {
      await writeFile(tab.path, tab.content);
      markSaved(tab.id);
    } catch (err) {
      const msg =
        err instanceof FsError
          ? `${err.payload.kind}: ${err.payload.detail}`
          : String(err);
      setLoad(tab.id, { kind: 'error', message: msg });
    }
  }, [markSaved, setLoad]);

  const closeTab = useCallback(
    (id: string) => {
      closeStore(id);
      // M6b: mirror the
      // post-close `order` /
      // `activeId` back to the
      // active workspace
      // tab's `state`.
      mirrorOpenEditorTabsToActiveTab();
    },
    [closeStore, mirrorOpenEditorTabsToActiveTab],
  );

  // M6b: tab switch → rehydrate.
  // When the active workspace
  // tab changes, push the new
  // tab's
  // `state.openEditorTabPaths`
  // / `state.activeEditorTabPath`
  // into the live editor tabs
  // store and re-read each
  // file from disk.
  //
  // We compare the live
  // `useEditorTabsStore.order`
  // to the new tab's paths
  // to detect "tab switched
  // to a different workspace"
  // (the order will differ) vs.
  // "tab's persisted state
  // didn't change" (the order
  // is already correct, e.g.
  // the user just persisted
  // an additional file open).
  useEffect(() => {
    const rehydrate = async (activeTabId: string) => {
      const state = useWorkspaceStore.getState();
      const tab = state.workspaces.find((w) => w.id === activeTabId);
      if (!tab) return;
      const paths = tab.state.openEditorTabPaths;
      const activePath = tab.state.activeEditorTabPath;
      // Replace the live
      // store with placeholder
      // loading tabs. This is
      // a hard reset — we don't
      // try to keep tabs that
      // are in both the old
      // and new sets (e.g. if
      // the user has the same
      // file open in two
      // workspaces, switching
      // tabs doesn't carry the
      // loaded content over —
      // the new tab's content
      // is re-read from disk).
      const tabsMap: Record<string, EditorTab> = {};
      for (const p of paths) tabsMap[p] = loadingTab(p);
      const resolvedActive =
        activePath && paths.includes(activePath) ? activePath : paths[0] ?? null;
      replaceAll(paths, tabsMap, resolvedActive);

      // M6c: prune stale `editorCursorByPath` entries
      // (files that are in the cursor map but not in
      // `openEditorTabPaths`). Hydrate-time prune is
      // preferred over per-close-action coordination:
      // one place, simple, accepts a few transient
      // stale entries per tab.
      const validPaths = new Set(paths);
      const currentCursorMap = tab.state.editorCursorByPath;
      const nextCursorByPath: Record<string, { line: number; column: number }> = {};
      let prunedAny = false;
      for (const [p, c] of Object.entries(currentCursorMap)) {
        if (validPaths.has(p)) {
          nextCursorByPath[p] = c;
        } else {
          prunedAny = true;
        }
      }
      if (prunedAny) {
        useWorkspaceStore.getState().setTabState(activeTabId, {
          editorCursorByPath: nextCursorByPath,
        });
      }

      // Re-read each file
      // from disk. Failures
      // (file deleted
      // between sessions)
      // are surfaced as a
      // tab with `load:
      // { kind: 'error' }`
      // — the user sees a
      // "file missing" badge
      // and decides whether
      // to close or restore
      // the file.
      await Promise.all(
        paths.map(async (p) => {
          try {
            const loaded = await readFile(p);
            if (loaded.encoding === 'binary') {
              upsertTab({
                ...loadingTab(p),
                load: { kind: 'loaded', encoding: 'binary' },
              });
            } else {
              upsertTab(tabFromLoaded(p, loaded));
            }
          } catch (err) {
            const msg =
              err instanceof FsError
                ? `${err.payload.kind}: ${err.payload.detail}`
                : String(err);
            setLoad(p, { kind: 'error', message: msg });
          }
        }),
      );
    };

    // Track the last
    // active-tab id we
    // rehydrated for. The
    // subscribe callback
    // fires on every state
    // change; we only want
    // to rehydrate when the
    // active tab id
    // changes.
    let lastRehydratedTabId: string | null = null;

    const unsubscribe = useWorkspaceStore.subscribe((state) => {
      const activeTabId = state.activeId;
      if (!activeTabId) {
        // All tabs closed —
        // the live store
        // should also be
        // empty. (The
        // `close` action
        // already triggered
        // this via the
        // `replaceAll` in
        // the subscribe
        // callback for the
        // `activeId === null`
        // case.)
        if (lastRehydratedTabId !== null) {
          lastRehydratedTabId = null;
        }
        return;
      }
      if (activeTabId === lastRehydratedTabId) {
        // The active tab
        // didn't change —
        // the user's
        // mutation to
        // editor tabs is
        // being mirrored
        // back by the
        // `openFile` /
        // `closeTab`
        // callbacks. No
        // rehydrate needed.
        return;
      }
      lastRehydratedTabId = activeTabId;
      void rehydrate(activeTabId);
    });

    // Initial rehydrate: if
    // a tab is already active
    // at hook mount (e.g. the
    // editor mount happens
    // after the workspace
    // store is hydrated),
    // rehydrate once.
    const initial = useWorkspaceStore.getState();
    if (initial.activeId) {
      lastRehydratedTabId = initial.activeId;
      void rehydrate(initial.activeId);
    }

    return unsubscribe;
  }, [replaceAll, setLoad, upsertTab]);

  // M6b: also mirror `activate`
  // (clicking an existing tab
  // in the strip) to the active
  // workspace tab's
  // `state.activeEditorTabPath`.
  // `activate` doesn't change
  // the `order`, so we only
  // need to mirror the
  // `activeEditorTabPath`.
  // This subscribes to the
  // editor tabs store so we
  // catch `activate` calls
  // from anywhere in the
  // component tree (e.g. the
  // `EditorTabsStrip` calls
  // `useEditorTabsStore.activate`
  // directly).
  useEffect(() => {
    let lastActive: string | null = useEditorTabsStore.getState().activeId;
    const unsubscribe = useEditorTabsStore.subscribe((state) => {
      if (state.activeId === lastActive) return;
      lastActive = state.activeId;
      // The active tab id
      // changed via
      // `activate` (not via
      // the workspace tab
      // switch — those are
      // handled by the
      // rehydrate effect).
      // Mirror to the
      // active workspace
      // tab's state. The
      // rehydrate effect's
      // "did the workspace
      // tab id change?" guard
      // lets this pass through
      // without triggering
      // a rehydrate.
      const activeId = useWorkspaceStore.getState().activeId;
      if (!activeId) return;
      useWorkspaceStore.getState().setTabState(activeId, {
        activeEditorTabPath: state.activeId,
      });
    });
    return unsubscribe;
  }, []);

  return { openFile, saveActive, closeTab, setContent };
}
