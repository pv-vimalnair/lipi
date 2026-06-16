/**
 * `computeLipiStateV5ImportPreview` — the
 * M6c counterpart to
 * `computeLipiStateV4ImportPreview`.
 *
 * v5 extends the per-tab preview with 2
 * new sub-sections:
 *   - `editorCursorByPath`: a count of
 *     per-file cursor entries.
 *   - `fileTreeScrollAnchor`: the imported
 *     anchor (or null).
 *
 * The diff structure (added / removed /
 * changed tabs) is unchanged from v4.
 */

import { useWorkspaceStore } from '@/shared/state/workspaceStore';

import type { LipiStateV5Data } from './settingsIOv5';

export interface LipiStateV5ImportTabPreview {
  id: string;
  path: string;
  addedAt: number;
  /** Whether this tab is a new addition (not in the live store). */
  isNew: boolean;
  /** Whether this tab is a removal (in the live store, not in import). */
  isRemoved: boolean;
  /** The expandedDirs of the imported tab (unchanged from v4). */
  expandedDirs: string[];
  /** The selectedPath of the imported tab (unchanged from v4). */
  selectedPath: string | null;
  /** The open editor tabs of the imported tab (unchanged from v4). */
  openEditorTabPaths: string[];
  /** The active editor tab of the imported tab (unchanged from v4). */
  activeEditorTabPath: string | null;
  /** M6c: the imported editorCursorByPath. */
  editorCursorByPath: Record<string, { line: number; column: number }>;
  /** M6c: count of cursor entries in the imported map. */
  editorCursorByPathCount: number;
  /** M6c: the imported fileTreeScrollAnchor. */
  fileTreeScrollAnchor: string | null;
}

export interface LipiStateV5ImportPreview {
  workspaces: LipiStateV5ImportTabPreview[];
  activeId: string | null;
  recents: string[];
  voicePreferences: { provider: string };
  toolSettings: {
    disabledToolNames: string[];
    confirmationMode: Record<string, string>;
  };
}

export function computeLipiStateV5ImportPreview(
  data: LipiStateV5Data,
): LipiStateV5ImportPreview {
  const liveWorkspaces = useWorkspaceStore.getState().workspaces;
  const liveIds = new Set(liveWorkspaces.map((w) => w.id));
  const importIds = new Set(data.workspace.workspaces.map((w) => w.id));

  const workspaces: LipiStateV5ImportTabPreview[] =
    data.workspace.workspaces.map((tab) => ({
      id: tab.id,
      path: tab.path,
      addedAt: tab.addedAt,
      isNew: !liveIds.has(tab.id),
      isRemoved: false,
      expandedDirs: tab.state.expandedDirs,
      selectedPath: tab.state.selectedPath,
      openEditorTabPaths: tab.state.openEditorTabPaths,
      activeEditorTabPath: tab.state.activeEditorTabPath,
      editorCursorByPath: tab.state.editorCursorByPath,
      editorCursorByPathCount: Object.keys(tab.state.editorCursorByPath)
        .length,
      fileTreeScrollAnchor: tab.state.fileTreeScrollAnchor,
    }));

  // Add a "removed" entry for each live tab that is not in the
  // import. (Same as v4 — a separate marker so the UI can show
  // "this tab will be removed" without confusing it with a new
  // tab that happens to have the same path.)
  for (const live of liveWorkspaces) {
    if (!importIds.has(live.id)) {
      workspaces.push({
        id: live.id,
        path: live.path,
        addedAt: live.addedAt,
        isNew: false,
        isRemoved: true,
        expandedDirs: live.state.expandedDirs,
        selectedPath: live.state.selectedPath,
        openEditorTabPaths: live.state.openEditorTabPaths,
        activeEditorTabPath: live.state.activeEditorTabPath,
        editorCursorByPath: live.state.editorCursorByPath,
        editorCursorByPathCount: Object.keys(live.state.editorCursorByPath)
          .length,
        fileTreeScrollAnchor: live.state.fileTreeScrollAnchor,
      });
    }
  }

  return {
    workspaces,
    activeId: data.workspace.activeId,
    recents: data.workspace.recents,
    voicePreferences: data.voicePreferences,
    toolSettings: data.toolSettings,
  };
}
