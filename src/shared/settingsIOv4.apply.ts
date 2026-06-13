/**
 * `applyLipiStateV4` — the M6b
 * counterpart to `applyLipiStateV3`.
 *
 * v3 (S3) introduced the
 * transactional snapshot + restore
 * apply for the v2 file shape (a
 * single `workspace.currentPath` +
 * `recents`). v4 (M6b) is the
 * file-shape upgrade for the
 * multi-workspace-tabs world: the
 * `workspace` payload is an array
 * of `WorkspaceTab` objects plus
 * an `activeId`, and each tab
 * carries its own per-tab `state`.
 *
 * The v4 apply is also
 * transactional (same S3 design —
 * snapshot all three stores →
 * apply → restore on failure),
 * AND it normalises v3 input to
 * v4 in-memory via the same
 * `migrateV3DataToV4` helper the
 * parser uses. So a v3 file is
 * imported with no special
 * branching in the UI; the
 * parser / apply handle it
 * uniformly.
 *
 * What v4 does NOT change:
 *   - The 5a soft-delete +
 *     5s-undo plumbing for
 *     `toolSettings`. v4 still
 *     goes through
 *     `applyImportedSettings`,
 *     which pushes an undo
 *     entry. The snapshot
 *     restore (on failure) is
 *     a direct `setState`, not
 *     an undo push (per the
 *     S3 design).
 *   - The v3 partial-on-error
 *     apply. v3 is preserved
 *     on disk as a documented
 *     fallback for users who
 *     intentionally want it
 *     (per Decision #63).
 *
 * Why a separate file from
 * `settingsIOv3.apply.ts`?
 *   - Different file shape:
 *     v3 has `currentPath`; v4
 *     has `workspaces[]` +
 *     `activeId`. The apply
 *     logic for the workspace
 *     store is different (a
 *     single tab vs. an array
 *     of tabs).
 *   - Different apply
 *     strategy: v3 is
 *     partial-on-error; v4 is
 *     transactional. The two
 *     are alternative import
 *     strategies, not versioned
 *     file shapes.
 *   - The Settings UI gets a
 *     feature flag (or a
 *     command-line switch) to
 *     pick the strategy. v4 is
 *     the default going forward;
 *     v3 is the documented
 *     fallback.
 */

import { useToolSettingsStore } from '@/shared/state/toolSettingsStore';
import { useVoicePreferencesStore } from '@/shared/state/voicePreferencesStore';
import { useWorkspaceStore } from '@/shared/state/workspaceStore';

import type { ApplyLipiStateV2Result } from './settingsIOv2.apply';
import { restoreSnapshots, snapshotStores } from './storeSnapshot';
import type { LipiStateV4Data } from './settingsIOv4';

/**
 * Apply a parsed v4 (or v3-migrated-to-v4)
 * file's `data` block to the three stores
 * with snapshot-on-failure rollback.
 *
 * **Transactional**: either all three
 * stores are written, or NONE of them
 * are. The S3 v3 apply was partial-on-error;
 * v4 is all-or-nothing.
 *
 * **Destructive**: this overwrites the
 * local `workspace` (the full tab array +
 * activeId + recents), `voicePreferences.provider`,
 * and `toolSettings.disabledToolNames` +
 * `toolSettings.confirmationMode`. The
 * caller is responsible for confirming the
 * import with the user.
 *
 * **M6b additions** over v3:
 *   - The `workspace` apply uses
 *     `setState({ workspaces, activeId, recents })`
 *     — the v3 single-tab-from-currentPath
 *     pattern is gone. The apply is
 *     uniform: the data is a v4-shaped
 *     `workspaces[]` + `activeId` +
 *     `recents`, regardless of whether
 *     the input was a native v4 file or
 *     a v3 file (the parser already
 *     normalised v3 to v4 in memory).
 *   - The workspace snapshot captures
 *     the full tab array (not just the
 *     derived `currentPath`), so a
 *     rollback restores the user's
 *     tabs verbatim.
 */
export function applyLipiStateV4(
  data: LipiStateV4Data,
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
  //    v3 uses, which goes
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
  //    write).
  const [workspaceSnap, voiceSnap, toolSnap] = snapshotStores(
    {
      read: () => {
        // M6b: snapshot the
        // full tab array +
        // activeId + recents,
        // not just the
        // derived
        // `currentPath`. The
        // v3 snapshot lost
        // the per-tab
        // `state` field on
        // rollback; v4
        // preserves it.
        const s = useWorkspaceStore.getState();
        return {
          workspaces: s.workspaces.map((w) => ({
            ...w,
            state: { ...w.state, expandedDirs: [...w.state.expandedDirs] },
          })),
          activeId: s.activeId,
          recents: [...s.recents],
        };
      },
      write: (v) => {
        useWorkspaceStore.setState({
          workspaces: v.workspaces.map((w) => ({
            ...w,
            state: { ...w.state, expandedDirs: [...w.state.expandedDirs] },
          })),
          activeId: v.activeId,
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
  //    v3 returns.
  try {
    useWorkspaceStore.setState({
      workspaces: data.workspace.workspaces.map((w) => ({
        ...w,
        state: { ...w.state, expandedDirs: [...w.state.expandedDirs] },
      })),
      activeId: data.workspace.activeId,
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

/** Re-export of the v2/v3 result type
 *  so consumers can import it
 *  from this module without
 *  pulling in the v2 file. The
 *  v4 apply returns the same
 *  shape; the type alias keeps
 *  the import surface tight. */
export type {
  ApplyLipiStateV2Result,
} from './settingsIOv2.apply';
