/**
 * `applyLipiStateV2` — write a parsed v2 file back
 * to the three stores it covers.
 *
 * This is the destructive half of the S2 work.
 * The caller (Settings "Privacy & data" Danger
 * zone UI) is responsible for confirming the
 * import with the user; this function is a
 * straight apply.
 *
 * The apply is **partial-on-error**: if the
 * `toolSettings` apply fails, the
 * `workspace` and `voicePreferences` writes have
 * already happened. We accept that — the partial
 * state is recoverable by re-exporting the
 * current state and importing a known-good file
 * (or, for `toolSettings`, hitting the 5a
 * soft-delete undo). The alternative (snapshot
 * all three stores, apply, rollback on failure)
 * is the right long-term shape but is a v3
 * concern: it requires a cross-store snapshot
 * mechanism, which is non-trivial and not in
 * scope for S2.
 *
 * Why a separate file from `settingsIOv2.ts`?
 *   - The pure parse/build lives in
 *     `settingsIOv2.ts` (no store imports, fully
 *     unit-testable).
 *   - The apply lives here (imports the three
 *     stores; needs the runtime).
 *   - Tests of the apply can mock the stores
 *     without dragging the IO test setup in.
 *
 * Why a separate file from the store modules?
 *   - Rule 4: components and hooks import from
 *     `@/shared` and `@/ipc`, not from
 *     `@/shared/state/*` directly. The Settings
 *     UI calls `applyLipiStateV2(parsed.data)`
 *     and this module does the
 *     `useXxxStore.setState(...)` plumbing.
 *   - The 5b v1 import is the same shape: the
 *     tool-settings payload is dispatched
 *     through the existing 5a
 *     `softDeleteAndReset` + `applyImportedSettings`
 *     surface, not directly into the store. The
 *     v2 apply mirrors that — it does NOT call
 *     `useToolSettingsStore.setState` directly;
 *     it goes through the public store action
 *     that handles the soft-delete + persistence
 *     side effects.
 */

import { useToolSettingsStore } from '@/shared/state/toolSettingsStore';
import { useVoicePreferencesStore } from '@/shared/state/voicePreferencesStore';
import { createWorkspaceTab, useWorkspaceStore } from '@/shared/state/workspaceStore';

import type { LipiStateV2Data } from './settingsIOv2';

/** Pure: the result of an apply. A tagged union
 *  so the UI can show a specific error to the
 *  user if a sub-payload's apply throws. */
export type ApplyLipiStateV2Result =
  | { ok: true }
  | { ok: false; error: ApplyLipiStateV2Error };

export type ApplyLipiStateV2Error =
  | { kind: 'workspace'; message: string }
  | { kind: 'voice-preferences'; message: string }
  | { kind: 'tool-settings'; message: string };

/** Apply a parsed v2 file's `data` block to the
 *  three stores. The function is synchronous
 *  (Zustand writes are sync) but the
 *  `toolSettings` apply reuses the existing 5a
 *  soft-delete + 5s-undo hook, which is
 *  also sync.
 *
 *  **Destructive**: this overwrites the local
 *  `workspace` (`currentPath` + `recents`),
 *  `voicePreferences.provider`, and
 *  `toolSettings.disabledToolNames` +
 *  `toolSettings.confirmationMode`. The caller
 *  is responsible for confirming the import with
 *  the user.
 *
 *  **Partial-on-error**: see the file header. */
export function applyLipiStateV2(
  data: LipiStateV2Data,
): ApplyLipiStateV2Result {
  // 1. workspace.
  // M6a: the v2 export format still
  // has `currentPath` (singular),
  // but the store now uses the
  // `workspaces` + `activeId`
  // shape. Re-construct a single
  // tab from the v2 `currentPath`
  // so the import restores the
  // user's last open workspace.
  try {
    const importedPath = data.workspace.currentPath;
    if (importedPath) {
      const tab = createWorkspaceTab(importedPath);
      useWorkspaceStore.setState({
        workspaces: [tab],
        activeId: tab.id,
        recents: data.workspace.recents,
      });
    } else {
      useWorkspaceStore.setState({
        workspaces: [],
        activeId: null,
        recents: data.workspace.recents,
      });
    }
  } catch (e) {
    return {
      ok: false,
      error: {
        kind: 'workspace',
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }
  // 2. voicePreferences.
  try {
    useVoicePreferencesStore.setState({ provider: data.voicePreferences.provider });
  } catch (e) {
    return {
      ok: false,
      error: {
        kind: 'voice-preferences',
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }
  // 3. toolSettings. We delegate to the
  //    store's `applyImportedSettings` action
  //    — the same surface the 5b v1 import
  //    uses, which handles the 5a soft-delete
  //    + 5s-undo + persistence side effects.
  try {
    useToolSettingsStore.getState().applyImportedSettings(data.toolSettings);
  } catch (e) {
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
