/**
 * File tree state for the EditorWorkspace.
 *
 * Per Rule 3 (screen-folder layout), this store is screen-local —
 * `src/screens/EditorWorkspace/state/`, NOT in `src/shared/`. Only the
 * EditorWorkspace reads from a file tree today; if SettingsProvider
 * (later phase) needs the same shape, we promote to `shared/`.
 *
 * Per Rule 5 (best-practice defaults), the load lifecycle is modelled
 * with a discriminated union so empty / loading / error states are
 * first-class. No booleans soup like `isLoading` + `isError` + `data`.
 *
 * Per Rule 6 (section isolation), this file owns the data; the
 * `useFileTree` hook in `./hooks/useFileTree.ts` owns the imperative
 * side-effects (readDir calls, etc.). Components read selectors and
 * call hook actions.
 */

import { create } from 'zustand';
import type { FsEntry } from '@/ipc';

export type FileTreeStatus =
  | { kind: 'idle' }
  | { kind: 'opening' }
  | { kind: 'loading'; rootPath: string }
  | { kind: 'ready'; rootPath: string }
  | { kind: 'error'; message: string };

interface FileTreeState {
  status: FileTreeStatus;
  /** Path of the folder currently being browsed (set on 'ready'). */
  rootPath: string | null;
  /** Entries for the root, plus any directory the user has expanded.
   *  Keyed by absolute path; missing keys mean "not yet loaded". */
  entriesByDir: Record<string, FsEntry[]>;
  /** Directories the user has expanded. Set semantics, not ordered. */
  expanded: Set<string>;
  /** Currently selected entry (file or dir). */
  selectedPath: string | null;

  // --- Actions (imperative shape, used by the hook) ------------------
  setStatus: (status: FileTreeStatus) => void;
  setRoot: (rootPath: string) => void;
  setEntries: (dirPath: string, entries: FsEntry[]) => void;
  toggleExpanded: (dirPath: string) => void;
  select: (path: string | null) => void;
  reset: () => void;
  /**
   * Drop the cached entries for a directory.
   * The watcher uses this to clear stale
   * entries on `Remove` events so the next
   * `setEntries` call doesn't briefly show
   * a ghost row. The mutation actions
   * (`deleteInTree`) also use it before
   * re-reading the parent.
   */
  dropEntries: (dirPath: string) => void;
}

const initial: Pick<
  FileTreeState,
  'status' | 'rootPath' | 'entriesByDir' | 'expanded' | 'selectedPath'
> = {
  status: { kind: 'idle' },
  rootPath: null,
  entriesByDir: {},
  expanded: new Set(),
  selectedPath: null,
};

export const useFileTreeStore = create<FileTreeState>((set) => ({
  ...initial,
  setStatus: (status) => set({ status }),
  setRoot: (rootPath) =>
    set({
      rootPath,
      entriesByDir: {},
      expanded: new Set(),
      selectedPath: null,
    }),
  setEntries: (dirPath, entries) =>
    set((s) => ({
      entriesByDir: { ...s.entriesByDir, [dirPath]: entries },
    })),
  toggleExpanded: (dirPath) =>
    set((s) => {
      const next = new Set(s.expanded);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return { expanded: next };
    }),
  select: (path) => set({ selectedPath: path }),
  reset: () => set({ ...initial, expanded: new Set() }),
  dropEntries: (dirPath) =>
    set((s) => {
      // We rebuild the entriesByDir without
      // the dropped key. Using a fresh
      // object is cheap (small number of
      // expanded dirs in a typical session)
      // and avoids the cost of `delete` on
      // a React-observed object.
      const next: Record<string, FsEntry[]> = {};
      for (const [k, v] of Object.entries(s.entriesByDir)) {
        if (k !== dirPath) next[k] = v;
      }
      return { entriesByDir: next };
    }),
}));

/** Selectors — keep these tiny so components can compose them. */
export const fileTreeSelectors = {
  status: (s: FileTreeState) => s.status,
  rootPath: (s: FileTreeState) => s.rootPath,
  entriesFor: (dirPath: string) => (s: FileTreeState) =>
    s.entriesByDir[dirPath] ?? null,
  isExpanded: (dirPath: string) => (s: FileTreeState) => s.expanded.has(dirPath),
  selectedPath: (s: FileTreeState) => s.selectedPath,
};
