/**
 * `applyLipiStateV3` — the
 * transactional counterpart to
 * the S2 `applyLipiStateV2`.
 *
 * The v2 apply is **partial-on-error**:
 * if the `toolSettings` apply
 * fails, the `workspace` and
 * `voicePreferences` writes have
 * already happened. The user
 * sees a "tool-settings" error
 * but their workspace is now
 * the imported one — confusing
 * to debug, easy to mis-recover.
 *
 * The v3 apply snapshots all
 * three stores BEFORE writing
 * anything. If any of the three
 * apply steps throws, the
 * snapshots are restored in
 * reverse order, leaving the
 * user's local state exactly
 * as it was. The user sees the
 * same `ApplyLipiStateV2Result`
 * (so the UI doesn't need to
 * change its error-rendering
 * code), but the underlying
 * state is guaranteed consistent.
 *
 * What v3 does NOT change:
 *   - The v2 file format. v3
 *     reads the same
 *     `LipiStateV2Data` payload
 *     (no new field, no version
 *     bump). The v3 vs v2
 *     difference is the apply
 *     semantics, not the file
 *     shape.
 *   - The `applyImportedSettings`
 *     tool-settings path. v3
 *     still goes through the 5a
 *     soft-delete + 5s-undo
 *     surface (the 5a undo
 *     buffer is independent of
 *     the v3 snapshot — undo
 *     covers a 5-second window
 *     for an individual tool
 *     settings change; the v3
 *     snapshot covers the whole
 *     import. They coexist).
 *
 * Why a separate file from
 * `settingsIOv2.apply.ts`?
 *   - The v2 apply is the
 *     "simple, partial-on-error"
 *     version. Keeping it on
 *     disk (and keeping the v2
 *     tests passing) means a
 *     future regression in the
 *     v3 path can fall back to
 *     v2 semantics without
 *     touching the file format
 *     or the export path. v2
 *     and v3 are alternative
 *     import strategies, not
 *     versioned file shapes.
 *   - The Settings UI gets a
 *     feature flag (or a
 *     command-line switch) to
 *     pick the strategy. v3 is
 *     the default going forward;
 *     v2 is the documented
 *     "if you have a partial-
 *     state recovery need, the
 *     import is destructive but
 *     simple" fallback.
 */

import { useToolSettingsStore } from '@/shared/state/toolSettingsStore';
import { useVoicePreferencesStore } from '@/shared/state/voicePreferencesStore';
import { useWorkspaceStore } from '@/shared/state/workspaceStore';

import type { LipiStateV2Data } from './settingsIOv2';
import type {
  ApplyLipiStateV2Result,
} from './settingsIOv2.apply';
import {
  restoreSnapshots,
  snapshotStores,
} from './storeSnapshot';

/** Apply a parsed v2 file's `data` block to
 *  the three stores with snapshot-on-failure
 *  rollback.
 *
 *  **Transactional**: either all three
 *  stores are written, or NONE of them
 *  are. The S2 v2 apply was partial-on-error;
 *  v3 is all-or-nothing.
 *
 *  **Destructive**: this overwrites the
 *  local `workspace` (`currentPath` +
 *  `recents`), `voicePreferences.provider`,
 *  and `toolSettings.disabledToolNames` +
 *  `toolSettings.confirmationMode`. The
 *  caller is responsible for confirming the
 *  import with the user.
 *
 *  **Differences from v2**:
 *    - Snapshots all three stores BEFORE
 *      any write.
 *    - On any step throwing, restores the
 *      snapshots in reverse order. The
 *      return shape is identical to v2
 *      (`ApplyLipiStateV2Result`), so the
 *      UI doesn't need to change.
 */
export function applyLipiStateV3(
  data: LipiStateV2Data,
): ApplyLipiStateV2Result {
  // 1. Snapshot the three stores
  //    before any write. The
  //    `read` closures return
  //    the live state; the
  //    `write` closures put it
  //    back. The snapshot values
  //    are captured at this
  //    point in time and will be
  //    restored if anything below
  //    throws.
  //
  //    For the `toolSettings`
  //    store, the `write` is the
  //    `applyImportedSettings`
  //    action — the same surface
  //    v2 uses, which goes
  //    through the 5a soft-delete
  //    + 5s-undo plumbing. The
  //    snapshot of the PRE-apply
  //    state (taken via the
  //    `read` closure) is just
  //    the raw `getState()` —
  //    we cannot use
  //    `applyImportedSettings`
  //    for the restore, because
  //    that's the destructive
  //    write. For rollback we
  //    use `setState` directly
  //    (a pure, non-undo-buffered
  //    write). The v3 rollback
  //    is a "no questions asked,
  //    put the state back" —
  //    not undoable in turn.
  const [workspaceSnap, voiceSnap, toolSnap] = snapshotStores(
    {
      read: () => {
        const s = useWorkspaceStore.getState();
        // Shallow-clone the
        // recents array so a
        // caller that mutates
        // the store later does
        // not affect the
        // snapshot.
        return {
          currentPath: s.currentPath,
          recents: [...s.recents],
        };
      },
      write: (v) => {
        useWorkspaceStore.setState({
          currentPath: v.currentPath,
          recents: v.recents,
        });
      },
    },
    {
      read: () => {
        const s = useVoicePreferencesStore.getState();
        return { provider: s.provider };
      },
      write: (v) => {
        useVoicePreferencesStore.setState({ provider: v.provider });
      },
    },
    {
      read: () => {
        const s = useToolSettingsStore.getState();
        return {
          disabledToolNames: [...s.disabledToolNames],
          confirmationMode: { ...s.confirmationMode },
        };
      },
      // The restore is a direct
      // `setState` (not
      // `applyImportedSettings`)
      // — the apply is the
      // destructive surface; the
      // restore is the
      // best-effort put-it-back.
      // We deliberately do NOT
      // push another 5a undo
      // entry on restore; the
      // user already saw the
      // import error, an undo
      // would be confusing
      // (5-second window on a
      // 10-second-old import).
      write: (v) => {
        useToolSettingsStore.setState({
          disabledToolNames: v.disabledToolNames,
          confirmationMode: v.confirmationMode,
        });
      },
    },
  );

  // 2. Apply. Each step is
  //    wrapped in its own
  //    try/catch. On failure
  //    we restore and return
  //    the same error shape
  //    v2 returns.
  try {
    useWorkspaceStore.setState({
      currentPath: data.workspace.currentPath,
      recents: data.workspace.recents,
    });
  } catch (e) {
    restoreSnapshots([workspaceSnap, voiceSnap, toolSnap]);
    return {
      ok: false,
      error: {
        kind: 'workspace',
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }
  try {
    useVoicePreferencesStore.setState({
      provider: data.voicePreferences.provider,
    });
  } catch (e) {
    restoreSnapshots([workspaceSnap, voiceSnap, toolSnap]);
    return {
      ok: false,
      error: {
        kind: 'voice-preferences',
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }
  try {
    useToolSettingsStore
      .getState()
      .applyImportedSettings(data.toolSettings);
  } catch (e) {
    restoreSnapshots([workspaceSnap, voiceSnap, toolSnap]);
    return {
      ok: false,
      error: {
        kind: 'tool-settings',
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }
  return { ok: true };
}

/** Re-export of the v2 result type
 *  so consumers can import it
 *  from this module without
 *  pulling in the v2 file. The
 *  v3 apply returns the same
 *  shape; the type alias keeps
 *  the import surface tight. */
export type {
  ApplyLipiStateV2Result,
} from './settingsIOv2.apply';
