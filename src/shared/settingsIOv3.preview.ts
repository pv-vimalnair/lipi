/**
 * `computeLipiStateImportPreview` —
 * the S3 "show the user what
 * this import will change"
 * helper.
 *
 * The S2 v2 import is one-step:
 * pick a file, get a `window.confirm`
 * dialog, apply. The user has
 * no way to see the diff before
 * committing. The v3 import
 * surfaces a preview first:
 *
 *   1. The user picks a file
 *      (no change from v2).
 *   2. The v3 UI shows a
 *      preview: "Workspace
 *      currentPath will change
 *      from A to B; recents
 *      will be replaced; voice
 *      provider will change
 *      from stub to wispr;
 *      tool settings will be
 *      fully replaced." A list
 *      of paths the user can
 *      scan in 5 seconds.
 *   3. The user clicks
 *      "Apply" (or "Cancel").
 *   4. `applyLipiStateV3` runs
 *      with snapshot rollback.
 *
 * The preview is the cheap
 * "is this the right file?"
 * check. It's pure (no store
 * writes, no IO) so it can be
 * tested in isolation.
 *
 * What the preview CAN show:
 *   - workspace.currentPath
 *     (string diff)
 *   - workspace.recents
 *     (added / removed items)
 *   - voicePreferences.provider
 *     (string diff)
 *   - toolSettings.disabledToolNames
 *     (added / removed tools)
 *   - toolSettings.confirmationMode
 *     (per-tool changes)
 *
 * What the preview does NOT
 * show: a tool's full
 * confirmation mode history
 * (just the current state and
 * the new state). The diff is
 * field-level, not
 * history-level.
 *
 * The "no changes" case is
 * also a valid result: the
 * file is identical to the
 * current state. The UI
 * surfaces "No changes" in
 * the preview and the Apply
 * button is disabled (a no-op
 * apply is a wasted user
 * gesture; the user can
 * close the preview).
 */

import type { LipiStateV2Data } from './settingsIOv2';

/** A single field-level diff. */
export interface PreviewFieldDiff {
  /** A human-readable path,
   *  e.g. "workspace.currentPath"
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

/** The aggregated preview. `diffs` is empty when the file is
 *  identical to the current state. */
export interface LipiStateImportPreview {
  diffs: readonly PreviewFieldDiff[];
  /** A count summary, useful for the "X changes" header. */
  changeCount: number;
  /** Convenience: `diffs.length === 0`. */
  isNoOp: boolean;
}

/** Compute the diff between
 *  the current local state and
 *  the parsed file. The two
 *  arguments are the same shape
 *  — `LipiStateV2Data`. */
export function computeLipiStateImportPreview(
  current: LipiStateV2Data,
  incoming: LipiStateV2Data,
): LipiStateImportPreview {
  const diffs: PreviewFieldDiff[] = [];

  // 1. workspace.currentPath
  if (current.workspace.currentPath !== incoming.workspace.currentPath) {
    diffs.push({
      path: 'workspace.currentPath',
      before: current.workspace.currentPath,
      after: incoming.workspace.currentPath,
    });
  }

  // 2. workspace.recents
  //    Show added / removed
  //    entries. The order is
  //    also a difference
  //    (recents is an ordered
  //    list), but the UI
  //    surfaces "X will be
  //    replaced with Y" — the
  //    order matters only in
  //    that the new list is the
  //    entire incoming list.
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
      before: {
        added: [],
        removed: removedRecents,
      },
      after: {
        added: addedRecents,
        removed: [],
      },
    });
  }

  // 3. voicePreferences.provider
  if (current.voicePreferences.provider !== incoming.voicePreferences.provider) {
    diffs.push({
      path: 'voicePreferences.provider',
      before: current.voicePreferences.provider,
      after: incoming.voicePreferences.provider,
    });
  }

  // 4. toolSettings.disabledToolNames
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
      before: {
        added: [],
        removed: removedDisabled,
      },
      after: {
        added: addedDisabled,
        removed: [],
      },
    });
  }

  // 5. toolSettings.confirmationMode
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
