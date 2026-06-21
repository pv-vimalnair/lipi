/**
 * `computeLipiStateV5ImportPreview` — the
 * M6c counterpart to
 * `computeLipiStateV4ImportPreview`.
 *
 * v5 extends the v4 preview with 2 new
 * per-tab state diff rows:
 *   - `editorCursorByPath` (per-file cursor
 *     count diff)
 *   - `fileTreeScrollAnchor` (string diff)
 *
 * The diff structure (added / removed tabs,
 * expandedDirs, selectedPath,
 * openEditorTabPaths, activeEditorTabPath,
 * recents, voicePreferences, toolSettings)
 * is unchanged from v4. v5 auto-detects v3,
 * v4, and v5 input via the parser; the
 * preview receives the *parsed* v5 data.
 *
 * The label is rendered by
 * `previewDiffLabelV4` (re-used from v4);
 * the new fields route to their own cases
 * in the regex match in that helper.
 */

import type {
  ExportedWorkspaceTabV4,
  LipiStateV4Data,
} from './settingsIOv4';
import type { LipiStateV5Data } from './settingsIOv5';

/** A single field-level diff. Same
 *  shape as the v4
 *  `PreviewFieldDiffV4` — the UI
 *  uses the same
 *  `previewDiffLabelV4` helper. */
export interface PreviewFieldDiffV5 {
  /** A human-readable path,
   *  e.g. "workspace.workspaces[0].path"
   *  or
   *  "toolSettings.confirmationMode.run_shell_command".
   *  Used as the diff row's
   *  key. */
  path: string;
  /** The value before. `null`
   *  for "not present" (e.g. a
   *  recents entry that didn't
   *  exist before). */
  before: unknown;
  /** The value after. `null`
   *  for "removed". */
  after: unknown;
}

/** The aggregated preview. `diffs`
 *  is empty when the file is
 *  identical to the current state. */
export interface LipiStateV5ImportPreview {
  diffs: readonly PreviewFieldDiffV5[];
  /** A count summary, useful for
   *  the "X changes" header. */
  changeCount: number;
  /** Convenience: `diffs.length === 0`. */
  isNoOp: boolean;
}

/** Match a current tab to an
 *  incoming tab by `path`. The
 *  `id` is regenerated on import
 *  (a v3 → v4 import mints a new
 *  UUID; a v4 native import
 *  preserves the `id` but the
 *  user may have edited the file
 *  by hand) so we can't match by
 *  `id`. Two tabs with the same
 *  `path` are the "same" workspace
 *  for the purposes of the
 *  per-tab state diff.
 *
 *  Returns the index in
 *  `incoming` of the tab with the
 *  same `path` as `currentTab`, or
 *  `-1` if no match. */
function findIncomingTabByPath(
  currentTab: ExportedWorkspaceTabV4,
  incoming: readonly ExportedWorkspaceTabV4[],
): number {
  return incoming.findIndex((t) => t.path === currentTab.path);
}

/** Compute the diff between
 *  the current local state and
 *  the parsed v5 file. The two
 *  arguments are the same shape
 *  — `LipiStateV5Data`. */
export function computeLipiStateV5ImportPreview(
  current: LipiStateV5Data,
  incoming: LipiStateV5Data,
): LipiStateV5ImportPreview {
  const diffs: PreviewFieldDiffV5[] = [];

  // 1. workspace.workspaces
  //    Per-tab diff. We surface:
  //      - "added" tabs (paths in
  //        incoming not in current).
  //      - "removed" tabs (paths
  //        in current not in incoming).
  //      - "kept" tabs (same path
  //        in both) — for these,
  //        we further diff the
  //        per-tab `state`.
  //    A single diff row is
  //    emitted per "change class"
  //    (added / removed / per-tab
  //    state change) so the user
  //    sees a focused list, not
  //    a wall of N rows.
  const currentPaths = new Set(current.workspace.workspaces.map((t) => t.path));
  const incomingPaths = new Set(incoming.workspace.workspaces.map((t) => t.path));
  const addedPaths = incoming.workspace.workspaces
    .filter((t) => !currentPaths.has(t.path))
    .map((t) => t.path);
  const removedPaths = current.workspace.workspaces
    .filter((t) => !incomingPaths.has(t.path))
    .map((t) => t.path);
  if (addedPaths.length > 0 || removedPaths.length > 0) {
    diffs.push({
      path: 'workspace.workspaces',
      before: { added: [], removed: removedPaths },
      after: { added: addedPaths, removed: [] },
    });
  }
  // Per-tab `state` diff for
  // matching tabs. We emit one
  // diff row per changed field
  // (expandedDirs, selectedPath,
  // openEditorTabPaths,
  // activeEditorTabPath,
  // editorCursorByPath,
  // fileTreeScrollAnchor) per
  // matching tab.
  for (const currentTab of current.workspace.workspaces) {
    const idx = findIncomingTabByPath(currentTab, incoming.workspace.workspaces);
    if (idx === -1) continue; // tab is "removed" — already surfaced
    const incomingTab = incoming.workspace.workspaces[idx];
    if (!incomingTab) continue;
    // expandedDirs
    const currentDirs = new Set(currentTab.state.expandedDirs);
    const incomingDirs = new Set(incomingTab.state.expandedDirs);
    const addedDirs = incomingTab.state.expandedDirs.filter(
      (d) => !currentDirs.has(d),
    );
    const removedDirs = currentTab.state.expandedDirs.filter(
      (d) => !incomingDirs.has(d),
    );
    if (
      addedDirs.length > 0 ||
      removedDirs.length > 0 ||
      currentTab.state.expandedDirs.length !==
        incomingTab.state.expandedDirs.length
    ) {
      diffs.push({
        path: `workspace.workspaces[path=${currentTab.path}].state.expandedDirs`,
        before: { added: [], removed: removedDirs },
        after: { added: addedDirs, removed: [] },
      });
    }
    // selectedPath
    if (currentTab.state.selectedPath !== incomingTab.state.selectedPath) {
      diffs.push({
        path: `workspace.workspaces[path=${currentTab.path}].state.selectedPath`,
        before: currentTab.state.selectedPath,
        after: incomingTab.state.selectedPath,
      });
    }
    // openEditorTabPaths
    const currentOpen = new Set(currentTab.state.openEditorTabPaths);
    const incomingOpen = new Set(incomingTab.state.openEditorTabPaths);
    const addedOpen = incomingTab.state.openEditorTabPaths.filter(
      (p) => !currentOpen.has(p),
    );
    const removedOpen = currentTab.state.openEditorTabPaths.filter(
      (p) => !incomingOpen.has(p),
    );
    if (
      addedOpen.length > 0 ||
      removedOpen.length > 0 ||
      currentTab.state.openEditorTabPaths.length !==
        incomingTab.state.openEditorTabPaths.length
    ) {
      diffs.push({
        path: `workspace.workspaces[path=${currentTab.path}].state.openEditorTabPaths`,
        before: { added: [], removed: removedOpen },
        after: { added: addedOpen, removed: [] },
      });
    }
    // activeEditorTabPath
    if (
      currentTab.state.activeEditorTabPath !==
      incomingTab.state.activeEditorTabPath
    ) {
      diffs.push({
        path: `workspace.workspaces[path=${currentTab.path}].state.activeEditorTabPath`,
        before: currentTab.state.activeEditorTabPath,
        after: incomingTab.state.activeEditorTabPath,
      });
    }
    // M6c — editorCursorByPath:
    // surface a count diff (the
    // raw map can be large; the
    // user just needs to know
    // "this tab's per-file cursor
    // memory is being replaced").
    const currentCursorCount = Object.keys(currentTab.state.editorCursorByPath)
      .length;
    const incomingCursorCount = Object.keys(incomingTab.state.editorCursorByPath)
      .length;
    if (currentCursorCount !== incomingCursorCount) {
      diffs.push({
        path: `workspace.workspaces[path=${currentTab.path}].state.editorCursorByPath`,
        before: { count: currentCursorCount },
        after: { count: incomingCursorCount },
      });
    }
    // M6c — fileTreeScrollAnchor:
    // string diff (same as
    // selectedPath).
    if (
      currentTab.state.fileTreeScrollAnchor !==
      incomingTab.state.fileTreeScrollAnchor
    ) {
      diffs.push({
        path: `workspace.workspaces[path=${currentTab.path}].state.fileTreeScrollAnchor`,
        before: currentTab.state.fileTreeScrollAnchor,
        after: incomingTab.state.fileTreeScrollAnchor,
      });
    }
  }

  // 2. workspace.activeId
  if (current.workspace.activeId !== incoming.workspace.activeId) {
    const currentActivePath = current.workspace.activeId
      ? (current.workspace.workspaces.find(
          (t) => t.id === current.workspace.activeId,
        )?.path ?? null)
      : null;
    const incomingActivePath = incoming.workspace.activeId
      ? (incoming.workspace.workspaces.find(
          (t) => t.id === incoming.workspace.activeId,
        )?.path ?? null)
      : null;
    if (currentActivePath !== incomingActivePath) {
      diffs.push({
        path: 'workspace.activeId',
        before: currentActivePath,
        after: incomingActivePath,
      });
    }
  }

  // 3. workspace.recents
  const currentRecents = new Set(current.workspace.recents);
  const incomingRecents = new Set(incoming.workspace.recents);
  const addedRecents = incoming.workspace.recents.filter(
    (p) => !currentRecents.has(p),
  );
  const removedRecents = current.workspace.recents.filter(
    (p) => !incomingRecents.has(p),
  );
  if (
    addedRecents.length > 0 ||
    removedRecents.length > 0 ||
    current.workspace.recents.length !== incoming.workspace.recents.length
  ) {
    diffs.push({
      path: 'workspace.recents',
      before: { added: [], removed: removedRecents },
      after: { added: addedRecents, removed: [] },
    });
  }

  // 4. voicePreferences.provider
  if (current.voicePreferences.provider !== incoming.voicePreferences.provider) {
    diffs.push({
      path: 'voicePreferences.provider',
      before: current.voicePreferences.provider,
      after: incoming.voicePreferences.provider,
    });
  }

  // 5. toolSettings.disabledToolNames
  const currentDisabled = new Set(current.toolSettings.disabledToolNames);
  const incomingDisabled = new Set(incoming.toolSettings.disabledToolNames);
  const addedDisabled = incoming.toolSettings.disabledToolNames.filter(
    (n) => !currentDisabled.has(n),
  );
  const removedDisabled = current.toolSettings.disabledToolNames.filter(
    (n) => !incomingDisabled.has(n),
  );
  if (
    addedDisabled.length > 0 ||
    removedDisabled.length > 0 ||
    current.toolSettings.disabledToolNames.length !==
      incoming.toolSettings.disabledToolNames.length
  ) {
    diffs.push({
      path: 'toolSettings.disabledToolNames',
      before: { added: [], removed: removedDisabled },
      after: { added: addedDisabled, removed: [] },
    });
  }

  // 6. toolSettings.confirmationMode
  const allToolNames = new Set([
    ...Object.keys(current.toolSettings.confirmationMode),
    ...Object.keys(incoming.toolSettings.confirmationMode),
  ]);
  for (const tool of allToolNames) {
    const before = current.toolSettings.confirmationMode[tool] ?? null;
    const after = incoming.toolSettings.confirmationMode[tool] ?? null;
    if (before !== after) {
      diffs.push({
        path: `toolSettings.confirmationMode.${tool}`,
        before,
        after,
      });
    }
  }

  return {
    diffs,
    changeCount: diffs.length,
    isNoOp: diffs.length === 0,
  };
}

// Re-exported so the v4 / v5 modules share
// one source of truth for the data shape —
// the `LipiStateV4Data` is the structural
// base of `LipiStateV5Data` (they share the
// same fields; v5 adds 2 more).
export type { LipiStateV4Data };
