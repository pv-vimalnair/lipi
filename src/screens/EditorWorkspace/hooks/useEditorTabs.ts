/**
 * useEditorTabs — imperative side effects for the editor tabs.
 *
 * Per Rule 6, the store (`state/editorTabsStore.ts`) owns the data
 * and components own the rendering. This hook is the only place
 * that calls `readFile` / `writeFile` for editor purposes (the FS
 * hook in `useFileTree` does the same for tree purposes — keeping
 * the surfaces separate per Rule 4).
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
 */

import { useCallback } from 'react';
import { readFile, writeFile, FsError } from '@/ipc';
import {
  tabFromLoaded,
  useEditorTabsStore,
} from '../state/editorTabsStore';

export interface UseEditorTabs {
  openFile: (path: string) => Promise<void>;
  saveActive: () => Promise<void>;
  closeTab: (id: string) => void;
  setContent: (id: string, content: string) => void;
}

export function useEditorTabs(): UseEditorTabs {
  const upsertTab = useEditorTabsStore((s) => s.upsertTab);
  const setLoad = useEditorTabsStore((s) => s.setLoad);
  const setContent = useEditorTabsStore((s) => s.setContent);
  const markSaved = useEditorTabsStore((s) => s.markSaved);
  const closeStore = useEditorTabsStore((s) => s.close);

  const openFile = useCallback(
    async (path: string) => {
      // Optimistic placeholder tab so the UI shows feedback instantly.
      upsertTab({
        id: path,
        path,
        displayName: path,
        language: 'plaintext',
        content: '',
        savedContent: '',
        load: { kind: 'loading' },
      });
      try {
        const loaded = await readFile(path);
        // If the file is binary, show a minimal message instead of Monaco.
        if (loaded.encoding === 'binary') {
          upsertTab({
            id: path,
            path,
            displayName: path,
            language: 'plaintext',
            content: '',
            savedContent: '',
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
    [upsertTab, setLoad],
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
    },
    [closeStore],
  );

  return { openFile, saveActive, closeTab, setContent };
}
