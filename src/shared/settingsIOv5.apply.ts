/**
 * `applyLipiStateV5` — the M6c
 * counterpart to `applyLipiStateV4`.
 *
 * Same S3 transactional design:
 * snapshot all 3 stores → apply →
 * restore on failure. v5 is the
 * file-shape upgrade that adds
 * `editorCursorByPath` and
 * `fileTreeScrollAnchor` to each
 * tab's `state`. The apply is the
 * same operationally as v4 — the
 * same 3 stores are mutated, just
 * with 2 more fields per tab.
 *
 * v5 accepts v3, v4, or v5 input
 * (the parser auto-migrates). The
 * apply receives the *parsed* v5
 * data, so version migration
 * happens in `parseLipiStateV5`,
 * not here.
 */

import { useWorkspaceStore } from '@/shared/state/workspaceStore';
import { useToolSettingsStore } from '@/shared/state/toolSettingsStore';
import { useVoicePreferencesStore } from '@/shared/state/voicePreferencesStore';

import type { LipiStateV5Data } from './settingsIOv5';

export type ApplyLipiStateV5Result =
  | { ok: true }
  | { ok: false; error: string };

export function applyLipiStateV5(
  data: LipiStateV5Data,
): ApplyLipiStateV5Result {
  // Snapshot the 3 stores. Same S3 design.
  const workspaceSnapshot = useWorkspaceStore.getState();
  const voiceSnapshot = useVoicePreferencesStore.getState();
  const toolSettingsSnapshot = useToolSettingsStore.getState();

  try {
    // 1. Replace the workspace store.
    useWorkspaceStore.setState({
      hydrated: true,
      workspaces: data.workspace.workspaces,
      activeId: data.workspace.activeId,
      recents: data.workspace.recents,
      status: data.workspace.activeId
        ? {
            kind: 'ready',
            path:
              data.workspace.workspaces.find(
                (w) => w.id === data.workspace.activeId,
              )?.path ?? '',
          }
        : { kind: 'idle' },
    });

    // 2. Replace the voice preferences store.
    useVoicePreferencesStore.setState({
      provider: data.voicePreferences.provider,
    });

    // 3. Replace the tool settings store.
    useToolSettingsStore.setState({
      disabledToolNames: data.toolSettings.disabledToolNames,
      confirmationMode: data.toolSettings.confirmationMode,
    });

    return { ok: true };
  } catch (e) {
    // Restore: same S3 design — direct setState, NOT an undo push.
    useWorkspaceStore.setState({
      hydrated: workspaceSnapshot.hydrated,
      workspaces: workspaceSnapshot.workspaces,
      activeId: workspaceSnapshot.activeId,
      recents: workspaceSnapshot.recents,
      status: workspaceSnapshot.status,
    });
    useVoicePreferencesStore.setState({ provider: voiceSnapshot.provider });
    useToolSettingsStore.setState({
      disabledToolNames: toolSettingsSnapshot.disabledToolNames,
      confirmationMode: toolSettingsSnapshot.confirmationMode,
    });
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'unknown apply error',
    };
  }
}
