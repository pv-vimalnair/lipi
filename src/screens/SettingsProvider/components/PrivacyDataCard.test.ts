/**
 * Tests for the `PrivacyDataCard`'s pure helpers
 * and the `snapshotStoresForExport` function.
 *
 * M6b (June 2026) — the snapshot now produces
 * the v4 shape (a `workspaces[]` array of
 * `WorkspaceTab` objects plus an `activeId`),
 * not the v2 shape (a single
 * `workspace.currentPath`). The test was
 * rewritten to assert the v4 shape: each tab's
 * `state` field is present (file tree
 * expansion / selection / open editor tabs /
 * active editor tab), and the active tab's
 * `id` is captured as `activeId`.
 *
 * The component itself is a thin React UI over
 * the IO module; testing the full component
 * needs RTL which isn't in the project's dep
 * set. We cover the pure helpers here so the
 * `parseErrorMessage` / `privacyCardLede` /
 * `snapshotStoresForExport` shapes are pinned.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { workspaceState, voicePreferencesState, toolSettingsState } = vi.hoisted(() => ({
  workspaceState: {
    // M6b: the workspace
    // store is the M6a
    // tab model +
    // M6b per-tab
    // state. The mock
    // carries a single
    // tab with
    // non-empty
    // per-tab state so
    // the snapshot
    // test exercises
    // the field
    // plumbing.
    workspaces: [
      {
        id: 'tab-1',
        path: 'C:/Users/dev/proj',
        addedAt: 1000,
        state: {
          expandedDirs: ['C:/Users/dev/proj/src'],
          selectedPath: 'C:/Users/dev/proj/src/index.ts' as string | null,
          openEditorTabPaths: ['C:/Users/dev/proj/src/index.ts'],
          activeEditorTabPath: 'C:/Users/dev/proj/src/index.ts' as string | null,
        },
      },
    ],
    activeId: 'tab-1',
    recents: ['C:/Users/dev/proj', 'C:/Users/dev/other'],
  },
  voicePreferencesState: { provider: 'wispr' as const },
  toolSettingsState: {
    disabledToolNames: ['run_shell_command'],
    confirmationMode: { run_shell_command: 'always_confirm' as const },
  },
}));

vi.mock('@/shared/state/workspaceStore', async (importOriginal) => {
  const actual =
    (await importOriginal()) as typeof import('@/shared/state/workspaceStore');
  return {
    useWorkspaceStore: { getState: () => workspaceState },
    useActivePath: actual.useActivePath,
  };
});
vi.mock('@/shared/state/voicePreferencesStore', () => ({
  useVoicePreferencesStore: { getState: () => voicePreferencesState },
}));
vi.mock('@/shared/state/toolSettingsStore', () => ({
  useToolSettingsStore: {
    getState: () => ({
      disabledToolNames: toolSettingsState.disabledToolNames,
      confirmationMode: toolSettingsState.confirmationMode,
    }),
  },
}));

const {
  parseErrorMessage,
  privacyCardLede,
  snapshotStoresForExport,
} = await import('./PrivacyDataCard');

describe('parseErrorMessage', () => {
  it('passes through the wrong-format message verbatim', () => {
    const m = parseErrorMessage({
      kind: 'wrong-format',
      message: 'Not a Lipi state file',
    });
    expect(m).toMatch(/Not a Lipi state file/);
  });
  it('passes through the unsupported-version message verbatim', () => {
    const m = parseErrorMessage({
      kind: 'unsupported-version',
      message: 'Unsupported version',
    });
    expect(m).toMatch(/Unsupported version/);
  });
  it('passes through the wrong-shape message verbatim', () => {
    const m = parseErrorMessage({
      kind: 'wrong-shape',
      message: 'data block is missing',
    });
    expect(m).toMatch(/data block is missing/);
  });
  it('passes through the invalid-data message verbatim', () => {
    const m = parseErrorMessage({
      kind: 'invalid-data',
      message: 'data.workspace.recents contains non-strings',
    });
    expect(m).toMatch(/non-strings/);
  });
  it('strips the redundant "Not valid JSON:" prefix for not-json', () => {
    const m = parseErrorMessage({
      kind: 'not-json',
      message: 'Not valid JSON: Unexpected token',
    });
    expect(m).toBe('Not valid JSON: Unexpected token');
  });
});

describe('privacyCardLede', () => {
  it('mentions back-up / import / overwriting', () => {
    const s = privacyCardLede();
    expect(s).toMatch(/back ?up/i);
    expect(s).toMatch(/import/i);
    expect(s).toMatch(/overwrite/i);
  });
});

describe('snapshotStoresForExport', () => {
  beforeEach(() => {
    workspaceState.workspaces = [
      {
        id: 'tab-1',
        path: 'C:/Users/dev/proj',
        addedAt: 1000,
        state: {
          expandedDirs: ['C:/Users/dev/proj/src'],
          selectedPath: 'C:/Users/dev/proj/src/index.ts' as string | null,
          openEditorTabPaths: ['C:/Users/dev/proj/src/index.ts'],
          activeEditorTabPath: 'C:/Users/dev/proj/src/index.ts' as string | null,
        },
      },
    ];
    workspaceState.activeId = 'tab-1';
    workspaceState.recents = ['C:/Users/dev/proj', 'C:/Users/dev/other'];
    voicePreferencesState.provider = 'wispr';
    toolSettingsState.disabledToolNames = ['run_shell_command'];
    toolSettingsState.confirmationMode = { run_shell_command: 'always_confirm' };
  });
  afterEach(() => {
    workspaceState.workspaces = [
      {
        id: 'tab-1',
        path: 'C:/Users/dev/proj',
        addedAt: 1000,
        state: {
          expandedDirs: ['C:/Users/dev/proj/src'],
          selectedPath: 'C:/Users/dev/proj/src/index.ts' as string | null,
          openEditorTabPaths: ['C:/Users/dev/proj/src/index.ts'],
          activeEditorTabPath: 'C:/Users/dev/proj/src/index.ts' as string | null,
        },
      },
    ];
    workspaceState.activeId = 'tab-1';
    workspaceState.recents = ['C:/Users/dev/proj', 'C:/Users/dev/other'];
  });

  it('captures the v4 shape: workspaces[], activeId, recents + per-tab state', () => {
    const snap = snapshotStoresForExport();
    // workspace.workspaces
    expect(snap.workspace.workspaces).toHaveLength(1);
    expect(snap.workspace.workspaces[0]!.id).toBe('tab-1');
    expect(snap.workspace.workspaces[0]!.path).toBe('C:/Users/dev/proj');
    expect(snap.workspace.workspaces[0]!.addedAt).toBe(1000);
    // per-tab state
    expect(snap.workspace.workspaces[0]!.state).toEqual({
      expandedDirs: ['C:/Users/dev/proj/src'],
      selectedPath: 'C:/Users/dev/proj/src/index.ts',
      openEditorTabPaths: ['C:/Users/dev/proj/src/index.ts'],
      activeEditorTabPath: 'C:/Users/dev/proj/src/index.ts',
    });
    // workspace.activeId
    expect(snap.workspace.activeId).toBe('tab-1');
    // workspace.recents
    expect(snap.workspace.recents).toEqual([
      'C:/Users/dev/proj',
      'C:/Users/dev/other',
    ]);
    // voice + tool settings
    expect(snap.voicePreferences.provider).toBe('wispr');
    expect(snap.toolSettings.disabledToolNames).toEqual(['run_shell_command']);
    expect(snap.toolSettings.confirmationMode).toEqual({
      run_shell_command: 'always_confirm',
    });
  });

  it('clones the arrays / objects so the live state cannot be mutated through the snapshot', () => {
    const snap = snapshotStoresForExport();
    // Mutate the snapshot's arrays / objects;
    // the live state must NOT be affected.
    snap.toolSettings.disabledToolNames.push('mutated');
    snap.toolSettings.confirmationMode['mutated'] = 'always_allow';
    snap.workspace.recents.push('mutated');
    snap.workspace.workspaces[0]!.state.expandedDirs.push('mutated');
    snap.workspace.workspaces[0]!.state.openEditorTabPaths.push('mutated');
    expect(toolSettingsState.disabledToolNames).toEqual(['run_shell_command']);
    expect(toolSettingsState.confirmationMode).toEqual({
      run_shell_command: 'always_confirm',
    });
    expect(workspaceState.recents).toEqual([
      'C:/Users/dev/proj',
      'C:/Users/dev/other',
    ]);
    expect(workspaceState.workspaces[0]!.state.expandedDirs).toEqual([
      'C:/Users/dev/proj/src',
    ]);
    expect(workspaceState.workspaces[0]!.state.openEditorTabPaths).toEqual([
      'C:/Users/dev/proj/src/index.ts',
    ]);
  });

  it('captures multiple tabs in the workspaces[] array', () => {
    workspaceState.workspaces = [
      {
        id: 'tab-1',
        path: 'C:/Users/dev/proj1',
        addedAt: 1000,
        state: {
          expandedDirs: [],
          selectedPath: null as string | null,
          openEditorTabPaths: [],
          activeEditorTabPath: null as string | null,
        },
      },
      {
        id: 'tab-2',
        path: 'C:/Users/dev/proj2',
        addedAt: 2000,
        state: {
          expandedDirs: ['C:/Users/dev/proj2/docs'],
          selectedPath: 'C:/Users/dev/proj2/docs/README.md',
          openEditorTabPaths: [],
          activeEditorTabPath: null as string | null,
        },
      },
    ];
    workspaceState.activeId = 'tab-2';
    const snap = snapshotStoresForExport();
    expect(snap.workspace.workspaces).toHaveLength(2);
    expect(snap.workspace.workspaces[0]!.path).toBe('C:/Users/dev/proj1');
    expect(snap.workspace.workspaces[1]!.path).toBe('C:/Users/dev/proj2');
    expect(snap.workspace.workspaces[1]!.state.expandedDirs).toEqual([
      'C:/Users/dev/proj2/docs',
    ]);
    expect(snap.workspace.activeId).toBe('tab-2');
  });
});
