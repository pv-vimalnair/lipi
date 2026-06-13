/**
 * Editor tabs state for the EditorWorkspace.
 *
 * Per Rule 3, screen-local. Per Rule 5, tab status is a discriminated
 * union. Per Rule 6, the store is pure data — IPC lives in
 * `hooks/useEditorTabs.ts`.
 *
 * A tab's identity is its absolute file path. We dedupe on `id`
 * so opening the same file twice focuses the existing tab.
 */

import { create } from 'zustand';
import type { FileContent } from '@/ipc';

export type TabLoadStatus =
  | { kind: 'loading' }
  | { kind: 'loaded'; encoding: 'utf-8' | 'binary' }
  | { kind: 'error'; message: string };

export interface EditorTab {
  /** Stable id, same as `path`. Kept separate for future-proofing
   *  (e.g. tabs for unsaved buffers with no path). */
  id: string;
  path: string;
  displayName: string;
  /** Inferred from the file extension; passed to Monaco. */
  language: string;
  /** Current buffer content. Empty string for binary tabs. */
  content: string;
  /** Last content persisted to disk. */
  savedContent: string;
  load: TabLoadStatus;
}

interface EditorTabsState {
  /** Order of tab ids, left to right. */
  order: string[];
  tabs: Record<string, EditorTab>;
  activeId: string | null;

  // --- Actions ---
  upsertTab: (tab: EditorTab) => void;
  setLoad: (id: string, load: TabLoadStatus) => void;
  setContent: (id: string, content: string) => void;
  markSaved: (id: string) => void;
  activate: (id: string) => void;
  close: (id: string) => void;
  closeAll: () => void;
  /**
   * M6b: replace the entire
   * live editor tabs state
   * (order + tabs + activeId)
   * in one shot. The
   * tab-switch orchestrator
   * in `useEditorTabs` calls
   * this with the new active
   * tab's persisted state
   * (paths → fresh loading
   * `EditorTab`s; the IPC
   * `readFile` round-trip
   * fills in the content).
   *
   * `order` is the list of
   * file paths, left to right.
   * `activeId` is the path of
   * the active tab (or `null`).
   * `tabs` is a map keyed by
   * path; the orchestrator
   * passes a placeholder
   * (`load: { kind: 'loading' }`)
   * for each path and the
   * `readFile` IPC round-trip
   * seals them with
   * `tabFromLoaded` /
   * `upsertTab`.
   */
  replaceAll: (
    order: string[],
    tabs: Record<string, EditorTab>,
    activeId: string | null,
  ) => void;
}

export const useEditorTabsStore = create<EditorTabsState>((set) => ({
  order: [],
  tabs: {},
  activeId: null,

  upsertTab: (tab) =>
    set((s) => {
      const existing = s.tabs[tab.id];
      if (existing) {
        // Don't clobber a buffer that has unsaved changes.
        return {
          tabs: { ...s.tabs, [tab.id]: { ...existing, ...tab, content: existing.content, savedContent: existing.savedContent } },
          activeId: tab.id,
        };
      }
      return {
        order: [...s.order, tab.id],
        tabs: { ...s.tabs, [tab.id]: tab },
        activeId: tab.id,
      };
    }),

  setLoad: (id, load) =>
    set((s) => {
      const t = s.tabs[id];
      if (!t) return s;
      return { tabs: { ...s.tabs, [id]: { ...t, load } } };
    }),

  setContent: (id, content) =>
    set((s) => {
      const t = s.tabs[id];
      if (!t) return s;
      return { tabs: { ...s.tabs, [id]: { ...t, content } } };
    }),

  markSaved: (id) =>
    set((s) => {
      const t = s.tabs[id];
      if (!t) return s;
      return { tabs: { ...s.tabs, [id]: { ...t, content: t.content, savedContent: t.content } } };
    }),

  activate: (id) => set({ activeId: id }),

  close: (id) =>
    set((s) => {
      const { [id]: _gone, ...rest } = s.tabs;
      const order = s.order.filter((x) => x !== id);
      let activeId = s.activeId;
      if (activeId === id) {
        const idx = s.order.indexOf(id);
        activeId = order[idx] ?? order[idx - 1] ?? null;
      }
      return { tabs: rest, order, activeId };
    }),

  closeAll: () => set({ tabs: {}, order: [], activeId: null }),

  replaceAll: (order, tabs, activeId) =>
    set({
      order: order.slice(),
      tabs: { ...tabs },
      // Only keep the active id if
      // it's actually in the new
      // order. If a tab was
      // rehydrated with no
      // `activeEditorTabPath` (or
      // a stale one), drop to
      // null. (The orchestrator
      // also reconciles this
      // before calling, but the
      // store is defensive.)
      activeId:
        activeId && order.includes(activeId) ? activeId : order[0] ?? null,
    }),
}));

export const editorTabsSelectors = {
  order: (s: EditorTabsState) => s.order,
  tabs: (s: EditorTabsState) => s.tabs,
  activeId: (s: EditorTabsState) => s.activeId,
  activeTab: (s: EditorTabsState): EditorTab | null =>
    s.activeId ? s.tabs[s.activeId] ?? null : null,
  tabById: (id: string) => (s: EditorTabsState): EditorTab | null =>
    s.tabs[id] ?? null,
};

export function isDirty(tab: EditorTab): boolean {
  return tab.content !== tab.savedContent;
}

import { inferLanguage } from '@/shared/utils/inferLanguage';
export { inferLanguage } from '@/shared/utils/inferLanguage';

export function inferDisplayName(path: string): string {
  // Use the basename; future phases may show path segments.
  const sep = path.lastIndexOf('\\') >= 0 ? '\\' : '/';
  const idx = path.lastIndexOf(sep);
  return idx >= 0 ? path.slice(idx + 1) : path;
}

export function tabFromLoaded(
  path: string,
  loaded: FileContent,
): EditorTab {
  const displayName = inferDisplayName(path);
  return {
    id: path,
    path,
    displayName,
    language: inferLanguage(path),
    content: loaded.content,
    savedContent: loaded.content,
    load:
      loaded.encoding === 'binary'
        ? { kind: 'loaded', encoding: 'binary' }
        : { kind: 'loaded', encoding: 'utf-8' },
  };
}
