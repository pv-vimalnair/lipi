/**
 * `computeLipiStateV4ImportPreview` —
 * the M6b "show the user what
 * this import will change"
 * helper.
 *
 * The S3 v3 preview handles the
 * v2 file shape (a single
 * `workspace.currentPath` +
 * `recents`). The v4 preview
 * handles the v4 file shape: a
 * `workspaces[]` array + an
 * `activeId` + `recents`. Each
 * workspace tab also carries a
 * per-tab `state` (file tree
 * expansion / selection / open
 * editor tabs / active editor
 * tab), and the preview surfaces
 * the per-tab changes.
 *
 * The v4 preview is the v3
 * preview's analogue for the
 * multi-workspace-tabs world. It
 * is also pure (no store writes,
 * no IO) so it can be tested in
 * isolation.
 *
 * ## What the preview shows
 *
 *   - **workspace.workspaces**
 *     — a per-tab diff:
 *     `workspaces[]` is the new
 *     tab array; the diff is
 *     "added tabs" (paths in
 *     incoming not in current)
 *     and "removed tabs" (paths
 *     in current not in incoming).
 *   - **workspace.workspaces[N].state**
 *     — a per-tab state diff for
 *     tabs that exist in BOTH the
 *     current and incoming
 *     arrays (matched by `path`,
 *     not by `id` — the `id` is
 *     regenerated on import).
 *     For matching tabs, the
 *     per-tab `state` is
 *     compared field-by-field:
 *     `expandedDirs` (added /
 *     removed), `selectedPath`
 *     (string diff),
 *     `openEditorTabPaths`
 *     (added / removed),
 *     `activeEditorTabPath`
 *     (string diff).
 *   - **workspace.activeId**
 *     — a string diff (the
 *     active tab's id will
 *     change; the user should
 *     know which tab they'll
 *     land on after the import).
 *   - **workspace.recents** —
 *     added / removed entries
 *     (same pattern as v3).
 *   - **voicePreferences.provider**
 *     — string diff (same as
 *     v3).
 *   - **toolSettings.disabledToolNames**
 *     — added / removed tools
 *     (same as v3).
 *   - **toolSettings.confirmationMode**
 *     — per-tool changes (same
 *     as v3).
 *
 * ## What the preview does NOT
 * show
 *
 *   - The previous tab's
 *     per-tab `state` content
 *     (the editor buffer
 *     contents, the file tree
 *     scroll position) — those
 *     are NOT persisted (per
 *     Decision #84) and are
 *     re-read from disk on
 *     rehydration. The preview
 *     surfaces the persisted
 *     state only.
 *   - The v3 → v4 migration
 *     trace. A v3 import
 *     synthesises an empty
 *     per-tab `state` for the
 *     wrapped tab; the preview
 *     shows the migrated shape
 *     (one tab, empty state),
 *     not the v3 shape (one
 *     `currentPath`). The UI
 *     surfaces a separate
 *     notice "this is a v3
 *     file" so the user knows
 *     the migration happened
 *     (driven by the
 *     `sourceFormat` field on
 *     the parse result).
 *
 * ## The "no changes" case
 *
 * Same as v3: the file is
 * identical to the current state.
 * The UI surfaces "No changes" in
 * the preview and the Apply
 * button is disabled.
 */

import type { LipiStateV4Data, ExportedWorkspaceTabV4 } from './settingsIOv4';

/** A single field-level diff. Same
 *  shape as the v3
 *  `PreviewFieldDiff` — the UI
 *  uses the same
 *  `previewDiffLabel` helper. */
export interface PreviewFieldDiffV4 {
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
export interface LipiStateV4ImportPreview {
  diffs: readonly PreviewFieldDiffV4[];
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
 *  the parsed v4 file. The two
 *  arguments are the same shape
 *  — `LipiStateV4Data`. */
export function computeLipiStateV4ImportPreview(
  current: LipiStateV4Data,
  incoming: LipiStateV4Data,
): LipiStateV4ImportPreview {
  const diffs: PreviewFieldDiffV4[] = [];

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
  // activeEditorTabPath) per
  // matching tab.
  for (const currentTab of current.workspace.workspaces) {
    const idx = findIncomingTabByPath(currentTab, incoming.workspace.workspaces);
    if (idx === -1) continue; // tab is "removed" — already surfaced
    const incomingTab = incoming.workspace.workspaces[idx]!;
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
  }

  // 2. workspace.activeId
  //    String diff. The active
  //    tab will change to the
  //    incoming file's active
  //    tab; the user should know
  //    which tab they'll land on
  //    after the import.
  if (current.workspace.activeId !== incoming.workspace.activeId) {
    // Surface the active
    // tab's PATH, not the
    // id, so the preview
    // is human-readable.
    // (The id is a UUID
    // generated on import;
    // it's not meaningful to
    // the user.)
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
  //    Same added/removed
  //    treatment as v3.
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
  //    Same added/removed
  //    treatment as recents.
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
  //    Per-tool diff: any tool
  //    that has a different mode
  //    in the new file gets a
  //    diff row.
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

/** Human-friendly label for a
 *  single v4 preview diff row.
 *  Used by both the UI and the
 *  tests (so the wording is one
 *  place). Mirrors the v3
 *  `previewDiffLabel` shape but
 *  with the v4 paths
 *  (workspace.workspaces[]
 *  etc.).
 *
 *  The label is a multi-line
 *  string for the "added/removed"
 *  previews (recents,
 *  disabledToolNames,
 *  expandedDirs) and a single
 *  line for the simple string
 *  diffs (provider, activeId).
 *
 *  Decision: the per-tab
 *  `state` diffs are surfaced
 *  with the tab's path in
 *  parentheses (the path is
 *  human-meaningful; the tab's
 *  id is a UUID regenerated on
 *  import). The label reads:
 *  "Tab /Users/me/proj/src: …". */
export function previewDiffLabelV4(diff: {
  path: string;
  before: unknown;
  after: unknown;
}): string {
  // 1. workspace.workspaces
  if (diff.path === 'workspace.workspaces') {
    const before = diff.before as { added: string[]; removed: string[] };
    const after = diff.after as { added: string[]; removed: string[] };
    const addedCount = after.added.length;
    const removedCount = before.removed.length;
    const parts: string[] = ['Workspace tabs:'];
    if (addedCount > 0) parts.push(`  +${addedCount} new`);
    if (removedCount > 0) parts.push(`  -${removedCount} removed`);
    return parts.join('\n');
  }
  // 2. Per-tab state diffs.
  //    Match the path against
  //    the per-tab `state`
  //    patterns. The path is
  //    `workspace.workspaces[path=<PATH>].state.<FIELD>`.
  const perTabMatch = /^workspace\.workspaces\[path=(.+)\]\.state\.(.+)$/.exec(
    diff.path,
  );
  if (perTabMatch) {
    const tabPath = perTabMatch[1]!;
    const field = perTabMatch[2]!;
    if (field === 'expandedDirs') {
      const before = diff.before as { added: string[]; removed: string[] };
      const after = diff.after as { added: string[]; removed: string[] };
      const parts: string[] = [`Tab ${tabPath} — expanded directories:`];
      for (const d of after.added) parts.push(`  + ${d}`);
      for (const d of before.removed) parts.push(`  - ${d}`);
      return parts.join('\n');
    }
    if (field === 'openEditorTabPaths') {
      const before = diff.before as { added: string[]; removed: string[] };
      const after = diff.after as { added: string[]; removed: string[] };
      const parts: string[] = [`Tab ${tabPath} — open editor tabs:`];
      for (const p of after.added) parts.push(`  + ${p}`);
      for (const p of before.removed) parts.push(`  - ${p}`);
      return parts.join('\n');
    }
    if (field === 'selectedPath') {
      return `Tab ${tabPath} — file tree selection: ${stringifyValue(diff.before)} → ${stringifyValue(diff.after)}`;
    }
    if (field === 'activeEditorTabPath') {
      return `Tab ${tabPath} — active editor tab: ${stringifyValue(diff.before)} → ${stringifyValue(diff.after)}`;
    }
    // M6c — the v5 preview
    // emits 2 new per-tab
    // diff rows. They use the
    // same path pattern
    // (`workspace.workspaces[path=…].state.<FIELD>`)
    // so we route them here
    // rather than in a
    // separate v5 renderer.
    if (field === 'editorCursorByPath') {
      const before = diff.before as { count: number };
      const after = diff.after as { count: number };
      return `Tab ${tabPath} — per-file cursor memory: ${before.count} entr${before.count === 1 ? 'y' : 'ies'} → ${after.count} entr${after.count === 1 ? 'y' : 'ies'}`;
    }
    if (field === 'fileTreeScrollAnchor') {
      return `Tab ${tabPath} — file tree scroll anchor: ${stringifyValue(diff.before)} → ${stringifyValue(diff.after)}`;
    }
  }
  // 3. workspace.activeId —
  //    the diff's before/after
  //    are paths (not ids), see
  //    the preview builder.
  if (diff.path === 'workspace.activeId') {
    return `Active workspace: ${stringifyValue(diff.before)} → ${stringifyValue(diff.after)}`;
  }
  // 4. workspace.recents
  if (diff.path === 'workspace.recents') {
    const before = diff.before as { added: string[]; removed: string[] };
    const after = diff.after as { added: string[]; removed: string[] };
    const addedCount = after.added.length;
    const removedCount = before.removed.length;
    const parts: string[] = ['Recents list:'];
    if (addedCount > 0) parts.push(`  +${addedCount} new`);
    if (removedCount > 0) parts.push(`  -${removedCount} removed`);
    return parts.join('\n');
  }
  // 5. voicePreferences.provider
  if (diff.path === 'voicePreferences.provider') {
    return `Voice provider: ${diff.before} → ${diff.after}`;
  }
  // 6. toolSettings.disabledToolNames
  if (diff.path === 'toolSettings.disabledToolNames') {
    const before = diff.before as { added: string[]; removed: string[] };
    const after = diff.after as { added: string[]; removed: string[] };
    const parts: string[] = ['Disabled tools:'];
    for (const t of after.added) parts.push(`  + ${t}`);
    for (const t of before.removed) parts.push(`  - ${t}`);
    return parts.join('\n');
  }
  // 7. toolSettings.confirmationMode.*
  if (diff.path.startsWith('toolSettings.confirmationMode.')) {
    const tool = diff.path.slice('toolSettings.confirmationMode.'.length);
    return `Tool "${tool}" confirmation: ${stringifyValue(diff.before)} → ${stringifyValue(diff.after)}`;
  }
  // Default: pass-through.
  return `${diff.path}: ${stringifyValue(diff.before)} → ${stringifyValue(diff.after)}`;
}

function stringifyValue(v: unknown): string {
  if (v === null) return '(none)';
  if (v === undefined) return '(missing)';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}
