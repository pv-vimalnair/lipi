/**
 * Tests for `applyLipiStateV4`
 * (the M6b transactional apply).
 *
 * The v4 apply takes a
 * `LipiStateV4Data` (already
 * normalised from v3 if
 * needed — the parser does
 * the normalisation) and
 * writes it to the three
 * stores with snapshot
 * rollback. The tests cover
 * the happy path, the v3
 * migration path (a v3 file
 * is normalised to v4 in
 * the parser, then applied
 * the same way), and the
 * rollback paths.
 *
 * The tests mirror the v3
 * apply test structure: each
 * test sets up the three
 * stores via direct
 * `setState` calls (no React),
 * applies the imported data,
 * and asserts the post-apply
 * state. Rollback tests set
 * up a "throw on apply"
 * stub on one of the stores
 * and assert the other two
 * are restored to their
 * pre-apply state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LipiStateV4Data } from './settingsIOv4';

const {
  workspaceState,
  setWorkspaceStateMock,
  voicePreferencesState,
  setVoicePreferencesStateMock,
  toolSettingsState,
  applyImportedSettingsMock,
} = vi.hoisted(() => ({
  workspaceState: {
    workspaces: [
      {
        id: 'tab-existing',
        path: 'C:/Users/existing/proj',
        addedAt: 500,
        state: {
          expandedDirs: ['C:/Users/existing/proj/old'],
          selectedPath: 'C:/Users/existing/proj/old/x.ts',
          openEditorTabPaths: ['C:/Users/existing/proj/old/x.ts'],
          activeEditorTabPath: 'C:/Users/existing/proj/old/x.ts',
        },
      },
    ],
    activeId: 'tab-existing',
    recents: ['C:/Users/existing/proj'],
  },
  setWorkspaceStateMock: vi.fn(),
  voicePreferencesState: { provider: 'stub' as const },
  setVoicePreferencesStateMock: vi.fn(),
  toolSettingsState: {
    disabledToolNames: ['legacy_tool'],
    confirmationMode: { legacy_tool: 'always_confirm' as const },
  },
  applyImportedSettingsMock: vi.fn(),
}));

vi.mock('@/shared/state/workspaceStore', async (importOriginal) => {
  const actual =
    (await importOriginal()) as typeof import('@/shared/state/workspaceStore');
  return {
    useWorkspaceStore: {
      getState: () => workspaceState,
      setState: (partial: unknown) => {
        setWorkspaceStateMock(partial);
        // Apply the partial
        // to the mock state
        // for the
        // post-apply
        // assertions.
        Object.assign(workspaceState, partial);
      },
    },
    useActivePath: actual.useActivePath,
  };
});
vi.mock('@/shared/state/voicePreferencesStore', () => ({
  useVoicePreferencesStore: {
    getState: () => voicePreferencesState,
    setState: (partial: unknown) => {
      setVoicePreferencesStateMock(partial);
      Object.assign(voicePreferencesState, partial);
    },
  },
}));
vi.mock('@/shared/state/toolSettingsStore', () => ({
  useToolSettingsStore: {
    getState: () => ({
      disabledToolNames: toolSettingsState.disabledToolNames,
      confirmationMode: toolSettingsState.confirmationMode,
      applyImportedSettings: (s: unknown) => {
        applyImportedSettingsMock(s);
        // Default behaviour:
        // apply successfully.
        // Tests that want to
        // simulate a failure
        // override this via
        // `applyImportedSettingsMock.mockImplementationOnce`.
        toolSettingsState.disabledToolNames = (
          s as { disabledToolNames: string[] }
        ).disabledToolNames;
        toolSettingsState.confirmationMode = (
          s as { confirmationMode: Record<string, string> }
        ).confirmationMode as typeof toolSettingsState.confirmationMode;
      },
    }),
  },
}));

const { applyLipiStateV4 } = await import('./settingsIOv4.apply');

function reset(): void {
  workspaceState.workspaces = [
    {
      id: 'tab-existing',
      path: 'C:/Users/existing/proj',
      addedAt: 500,
      state: {
        expandedDirs: ['C:/Users/existing/proj/old'],
        selectedPath: 'C:/Users/existing/proj/old/x.ts',
        openEditorTabPaths: ['C:/Users/existing/proj/old/x.ts'],
        activeEditorTabPath: 'C:/Users/existing/proj/old/x.ts',
      },
    },
  ];
  workspaceState.activeId = 'tab-existing';
  workspaceState.recents = ['C:/Users/existing/proj'];
  voicePreferencesState.provider = 'stub';
  toolSettingsState.disabledToolNames = ['legacy_tool'];
  toolSettingsState.confirmationMode = { legacy_tool: 'always_confirm' };
  setWorkspaceStateMock.mockClear();
  setVoicePreferencesStateMock.mockClear();
  applyImportedSettingsMock.mockClear();
  applyImportedSettingsMock.mockReset();
  // Default: apply
  // successfully. Tests
  // that want to
  // simulate a failure
  // override this.
  applyImportedSettingsMock.mockImplementation(
    (s: { disabledToolNames: string[]; confirmationMode: Record<string, string> }) => {
      toolSettingsState.disabledToolNames = s.disabledToolNames;
      toolSettingsState.confirmationMode = s.confirmationMode as typeof toolSettingsState.confirmationMode;
    },
  );
}

describe('applyLipiStateV4', () => {
  beforeEach(reset);
  afterEach(reset);

  const sampleIncoming: LipiStateV4Data = {
    workspace: {
      workspaces: [
        {
          id: 'tab-new-1',
          path: 'C:/Users/incoming/proj1',
          addedAt: 1000,
          state: {
            expandedDirs: ['C:/Users/incoming/proj1/src'],
            selectedPath: 'C:/Users/incoming/proj1/src/index.ts',
            openEditorTabPaths: ['C:/Users/incoming/proj1/src/index.ts'],
            activeEditorTabPath: 'C:/Users/incoming/proj1/src/index.ts',
          },
        },
        {
          id: 'tab-new-2',
          path: 'C:/Users/incoming/proj2',
          addedAt: 2000,
          state: {
            expandedDirs: [],
            selectedPath: null,
            openEditorTabPaths: [],
            activeEditorTabPath: null,
          },
        },
      ],
      activeId: 'tab-new-1',
      recents: ['C:/Users/incoming/proj1', 'C:/Users/incoming/proj2'],
    },
    voicePreferences: { provider: 'wispr' },
    toolSettings: {
      disabledToolNames: ['run_shell_command'],
      confirmationMode: { run_shell_command: 'always_confirm' },
    },
  };

  it('applies a v4 payload: workspace tabs, voice provider, tool settings', () => {
    const r = applyLipiStateV4(sampleIncoming);
    expect(r.ok).toBe(true);
    // workspace: full tab
    // array + activeId +
    // recents.
    expect(workspaceState.workspaces).toHaveLength(2);
    expect(workspaceState.workspaces[0]!.path).toBe('C:/Users/incoming/proj1');
    expect(workspaceState.workspaces[0]!.state.expandedDirs).toEqual([
      'C:/Users/incoming/proj1/src',
    ]);
    expect(workspaceState.workspaces[1]!.path).toBe('C:/Users/incoming/proj2');
    expect(workspaceState.activeId).toBe('tab-new-1');
    expect(workspaceState.recents).toEqual([
      'C:/Users/incoming/proj1',
      'C:/Users/incoming/proj2',
    ]);
    // voice + tool
    expect(voicePreferencesState.provider).toBe('wispr');
    expect(toolSettingsState.disabledToolNames).toEqual(['run_shell_command']);
  });

  it('applies a v3-migrated-to-v4 payload (one wrapped tab + empty state)', () => {
    // The parser
    // produces this
    // shape for a v3
    // import.
    const v3Migrated: LipiStateV4Data = {
      workspace: {
        workspaces: [
          {
            id: 'fresh-uuid',
            path: 'C:/Users/v3/proj',
            addedAt: 9999,
            state: {
              expandedDirs: [],
              selectedPath: null,
              openEditorTabPaths: [],
              activeEditorTabPath: null,
            },
          },
        ],
        activeId: 'fresh-uuid',
        recents: ['C:/Users/v3/proj'],
      },
      voicePreferences: { provider: 'ondevice' },
      toolSettings: {
        disabledToolNames: [],
        confirmationMode: {},
      },
    };
    const r = applyLipiStateV4(v3Migrated);
    expect(r.ok).toBe(true);
    expect(workspaceState.workspaces).toHaveLength(1);
    expect(workspaceState.workspaces[0]!.path).toBe('C:/Users/v3/proj');
    expect(workspaceState.workspaces[0]!.state).toEqual({
      expandedDirs: [],
      selectedPath: null,
      openEditorTabPaths: [],
      activeEditorTabPath: null,
    });
    expect(voicePreferencesState.provider).toBe('ondevice');
  });

  it('handles a v4 payload with empty workspaces[] (all tabs closed)', () => {
    const empty: LipiStateV4Data = {
      workspace: {
        workspaces: [],
        activeId: null,
        recents: [],
      },
      voicePreferences: { provider: 'wispr' },
      toolSettings: {
        disabledToolNames: [],
        confirmationMode: {},
      },
    };
    const r = applyLipiStateV4(empty);
    expect(r.ok).toBe(true);
    expect(workspaceState.workspaces).toEqual([]);
    expect(workspaceState.activeId).toBeNull();
    expect(workspaceState.recents).toEqual([]);
  });

  it('rolls back all three stores if the tool-settings apply throws', () => {
    // Make
    // `applyImportedSettings`
    // throw on this call.
    applyImportedSettingsMock.mockImplementationOnce(() => {
      throw new Error('simulated tool-settings failure');
    });
    const r = applyLipiStateV4(sampleIncoming);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('tool-settings');
    expect(r.error.message).toBe('simulated tool-settings failure');
    // The workspace
    // and voice
    // apply
    // already
    // happened
    // before the
    // tool-settings
    // step, so
    // they were
    // rolled back.
    expect(workspaceState.workspaces).toHaveLength(1);
    expect(workspaceState.workspaces[0]!.id).toBe('tab-existing');
    expect(workspaceState.activeId).toBe('tab-existing');
    expect(voicePreferencesState.provider).toBe('stub');
    expect(toolSettingsState.disabledToolNames).toEqual(['legacy_tool']);
  });

  it('rolls back if the voice-preferences apply throws', () => {
    setVoicePreferencesStateMock.mockImplementationOnce(() => {
      throw new Error('simulated voice failure');
    });
    const r = applyLipiStateV4(sampleIncoming);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('voice-preferences');
    // Workspace was
    // applied (and
    // rolled back).
    expect(workspaceState.workspaces[0]!.id).toBe('tab-existing');
    // Voice stayed at
    // the pre-apply
    // value.
    expect(voicePreferencesState.provider).toBe('stub');
    // Tool settings
    // never applied.
    expect(toolSettingsState.disabledToolNames).toEqual(['legacy_tool']);
  });

  it('rolls back if the workspace apply throws', () => {
    setWorkspaceStateMock.mockImplementationOnce(() => {
      throw new Error('simulated workspace failure');
    });
    const r = applyLipiStateV4(sampleIncoming);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('workspace');
    // The rollback
    // restored the
    // pre-apply
    // workspace
    // state.
    expect(workspaceState.workspaces[0]!.id).toBe('tab-existing');
    // The other
    // stores were
    // never
    // touched.
    expect(voicePreferencesState.provider).toBe('stub');
    expect(toolSettingsState.disabledToolNames).toEqual(['legacy_tool']);
  });

  it('clones the per-tab state so the live store cannot be mutated through the snapshot', () => {
    // Apply, then
    // mutate the
    // workspace
    // store's tab
    // state. The
    // snapshot
    // taken at the
    // start of the
    // apply should
    // be
    // independent
    // of the
    // post-apply
    // mutations.
    // This is
    // tested via
    // the rollback
    // path: if the
    // snapshot was
    // shared with
    // the live
    // store, the
    // rollback
    // would mutate
    // the post-apply
    // state, not
    // restore it.
    applyImportedSettingsMock.mockImplementationOnce(() => {
      // Simulate a
      // user mutation
      // between
      // apply and
      // rollback:
      // mutate the
      // workspace's
      // tab state.
      workspaceState.workspaces[0]!.state.expandedDirs = [
        'C:/Users/existing/proj/MUTATED',
      ];
      throw new Error('force rollback');
    });
    const r = applyLipiStateV4(sampleIncoming);
    expect(r.ok).toBe(false);
    // After rollback,
    // the snapshot's
    // value (the
    // pre-apply state)
    // is restored. The
    // user's mutation
    // is gone.
    expect(workspaceState.workspaces[0]!.state.expandedDirs).toEqual([
      'C:/Users/existing/proj/old',
    ]);
  });
});
