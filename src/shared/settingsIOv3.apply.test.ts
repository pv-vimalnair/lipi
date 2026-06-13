/**
 * Tests for the S3 v3 apply path.
 *
 * Mirrors the S2 v2 apply test
 * (mocked stores) but the v3
 * assertion is different: on
 * failure, the v3 apply must
 * RESTORE the previous state,
 * not leave a partial write
 * behind.
 *
 * The mocks here use a
 * `setState` mock that tracks
 * the value, so we can assert
 * what the live state was AFTER
 * a failed apply.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  workspaceState,
  voiceState,
  toolState,
  setWorkspaceStateMock,
  setVoiceStateMock,
  setToolStateMock,
  applyImportedSettingsMock,
} = vi.hoisted(() => {
  const workspaceState = {
    currentPath: 'C:/Users/old/ws',
    recents: ['C:/Users/old/ws', 'C:/Users/other'],
  };
  const voiceState = { provider: 'stub' as const };
  const toolState: {
    disabledToolNames: string[];
    confirmationMode: Record<
      string,
      'always_allow' | 'always_confirm' | 'per_call'
    >;
  } = {
    disabledToolNames: ['old_tool'],
    confirmationMode: { old_tool: 'always_confirm' },
  };
  return {
    workspaceState,
    voiceState,
    toolState,
    setWorkspaceStateMock: vi.fn((patch: Partial<typeof workspaceState>) => {
      Object.assign(workspaceState, patch);
    }),
    setVoiceStateMock: vi.fn((patch: Partial<typeof voiceState>) => {
      Object.assign(voiceState, patch);
    }),
    setToolStateMock: vi.fn((patch: Partial<typeof toolState>) => {
      Object.assign(toolState, patch);
    }),
    applyImportedSettingsMock: vi.fn(
      (payload: {
        disabledToolNames: string[];
        confirmationMode: Record<string, 'always_allow' | 'always_confirm' | 'per_call'>;
      }) => {
        toolState.disabledToolNames = [...payload.disabledToolNames];
        toolState.confirmationMode = { ...payload.confirmationMode };
      },
    ),
  };
});

vi.mock('@/shared/state/workspaceStore', () => ({
  useWorkspaceStore: {
    getState: () => workspaceState,
    setState: setWorkspaceStateMock,
  },
}));

vi.mock('@/shared/state/voicePreferencesStore', () => ({
  useVoicePreferencesStore: {
    getState: () => voiceState,
    setState: setVoiceStateMock,
  },
}));

vi.mock('@/shared/state/toolSettingsStore', () => ({
  useToolSettingsStore: {
    getState: () => ({
      disabledToolNames: toolState.disabledToolNames,
      confirmationMode: toolState.confirmationMode,
      applyImportedSettings: applyImportedSettingsMock,
    }),
    setState: setToolStateMock,
  },
}));

const { applyLipiStateV3 } = await import('./settingsIOv3.apply');

const NEW_DATA = {
  workspace: {
    currentPath: 'C:/Users/new/proj',
    recents: ['C:/Users/new/proj'],
  },
  voicePreferences: { provider: 'wispr' as const },
  toolSettings: {
    disabledToolNames: ['run_shell_command'],
    confirmationMode: { run_shell_command: 'always_confirm' as const },
  },
};

function resetMocks(): void {
  // Reset the live state
  // back to the "before"
  // snapshot.
  workspaceState.currentPath = 'C:/Users/old/ws';
  workspaceState.recents = ['C:/Users/old/ws', 'C:/Users/other'];
  voiceState.provider = 'stub';
  toolState.disabledToolNames = ['old_tool'];
  toolState.confirmationMode = { old_tool: 'always_confirm' };
  setWorkspaceStateMock.mockClear();
  setVoiceStateMock.mockClear();
  setToolStateMock.mockClear();
  applyImportedSettingsMock.mockClear();
  setWorkspaceStateMock.mockImplementation(
    (patch: Partial<typeof workspaceState>) => {
      Object.assign(workspaceState, patch);
    },
  );
  setVoiceStateMock.mockImplementation(
    (patch: Partial<typeof voiceState>) => {
      Object.assign(voiceState, patch);
    },
  );
  setToolStateMock.mockImplementation(
    (patch: Partial<typeof toolState>) => {
      Object.assign(toolState, patch);
    },
  );
  applyImportedSettingsMock.mockImplementation(
    (payload: {
      disabledToolNames: string[];
      confirmationMode: Record<string, 'always_allow' | 'always_confirm' | 'per_call'>;
    }) => {
      toolState.disabledToolNames = [...payload.disabledToolNames];
      toolState.confirmationMode = { ...payload.confirmationMode };
    },
  );
}

describe('applyLipiStateV3', () => {
  beforeEach(resetMocks);
  afterEach(resetMocks);

  it('writes all three stores on success', () => {
    const r = applyLipiStateV3(NEW_DATA);
    expect(r.ok).toBe(true);
    expect(workspaceState.currentPath).toBe('C:/Users/new/proj');
    expect(voiceState.provider).toBe('wispr');
    expect(toolState.disabledToolNames).toEqual(['run_shell_command']);
  });

  it('returns ok:true and does not write to a recovery path on success', () => {
    const r = applyLipiStateV3(NEW_DATA);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // The `result.error` is not
      // present on the ok:true
      // branch; the type system
      // guarantees it.
      // @ts-expect-error -- error is not on the ok branch
      expect(r.error).toBeUndefined();
    }
  });

  it('on tool-settings failure, restores the previous workspace and voice state', () => {
    applyImportedSettingsMock.mockImplementation(() => {
      throw new Error('tool-settings blew up');
    });
    const r = applyLipiStateV3(NEW_DATA);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('tool-settings');
      expect(r.error.message).toBe('tool-settings blew up');
    }
    // The workspace and
    // voicePreferences writes
    // that v2 would have left
    // in place are NOW
    // ROLLED BACK.
    expect(workspaceState.currentPath).toBe('C:/Users/old/ws');
    expect(workspaceState.recents).toEqual([
      'C:/Users/old/ws',
      'C:/Users/other',
    ]);
    expect(voiceState.provider).toBe('stub');
  });

  it('on voice-preferences failure, restores the previous workspace state', () => {
    setVoiceStateMock.mockImplementation(() => {
      throw new Error('voice-prefs blew up');
    });
    const r = applyLipiStateV3(NEW_DATA);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('voice-preferences');
    }
    expect(workspaceState.currentPath).toBe('C:/Users/old/ws');
    expect(workspaceState.recents).toEqual([
      'C:/Users/old/ws',
      'C:/Users/other',
    ]);
  });

  it('on workspace failure, restores BOTH (no writes happened for the other two)', () => {
    setWorkspaceStateMock.mockImplementation(() => {
      throw new Error('workspace blew up');
    });
    const r = applyLipiStateV3(NEW_DATA);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('workspace');
    }
    expect(workspaceState.currentPath).toBe('C:/Users/old/ws');
    expect(voiceState.provider).toBe('stub');
  });

  it('snapshot values are point-in-time: a post-snapshot store mutation is NOT picked up by the restore', () => {
    // The apply takes the
    // snapshot, then the
    // toolSettings apply
    // changes the live
    // toolState, then throws.
    // The restore must put the
    // ORIGINAL toolState back
    // (the snapshot, not the
    // intermediate value).
    const originalDisabled = [...toolState.disabledToolNames];
    const originalCm = { ...toolState.confirmationMode };
    applyImportedSettingsMock.mockImplementation(
      (payload: {
        disabledToolNames: string[];
        confirmationMode: Record<string, 'always_allow' | 'always_confirm' | 'per_call'>;
      }) => {
        toolState.disabledToolNames = [...payload.disabledToolNames];
        toolState.confirmationMode = { ...payload.confirmationMode };
        throw new Error('partial write before throw');
      },
    );
    const r = applyLipiStateV3(NEW_DATA);
    expect(r.ok).toBe(false);
    expect(toolState.disabledToolNames).toEqual(originalDisabled);
    expect(toolState.confirmationMode).toEqual(originalCm);
  });
});
