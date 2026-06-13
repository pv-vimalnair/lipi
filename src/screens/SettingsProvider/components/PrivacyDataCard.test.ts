/**
 * Tests for the `PrivacyDataCard`'s pure helpers
 * and the `snapshotStoresForExport` function.
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
    // M6a: the snapshot
    // reads the active
    // path via the
    // `useActivePath`
    // selector, which
    // needs
    // `workspaces` +
    // `activeId` (the v1
    // `currentPath` field
    // is gone). The mock
    // carries both for
    // clarity.
    workspaces: [
      {
        id: 'tab-1',
        path: 'C:/Users/dev/proj',
        addedAt: 1000,
      },
    ],
    activeId: 'tab-1',
    currentPath: 'C:/Users/dev/proj', // legacy field — kept for diff tests
    recents: ['C:/Users/dev/proj', 'C:/Users/dev/other'],
  },
  voicePreferencesState: { provider: 'wispr' as const },
  toolSettingsState: {
    disabledToolNames: ['run_shell_command'],
    confirmationMode: { run_shell_command: 'always_confirm' as const },
  },
}));

vi.mock('@/shared/state/workspaceStore', async (importOriginal) => {
  // M6a: the snapshot
  // function also
  // imports
  // `useActivePath`.
  // Re-export it from
  // the real module so
  // the test gets the
  // production
  // selector.
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
  previewDiffLabel,
  privacyCardLede,
  snapshotStoresForExport,
} = await import('./PrivacyDataCard');

describe('parseErrorMessage', () => {
  it('passes through the wrong-format message verbatim', () => {
    const m = parseErrorMessage({
      kind: 'wrong-format',
      message: 'Not a Lipi state v2 file',
    });
    expect(m).toMatch(/Not a Lipi state v2 file/);
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
    workspaceState.currentPath = 'C:/Users/dev/proj';
    workspaceState.recents = ['C:/Users/dev/proj', 'C:/Users/dev/other'];
    voicePreferencesState.provider = 'wispr';
    toolSettingsState.disabledToolNames = ['run_shell_command'];
    toolSettingsState.confirmationMode = { run_shell_command: 'always_confirm' };
  });
  afterEach(() => {
    workspaceState.currentPath = 'C:/Users/dev/proj';
    workspaceState.recents = ['C:/Users/dev/proj', 'C:/Users/dev/other'];
  });

  it('captures all three stores into the v2 payload shape', () => {
    const snap = snapshotStoresForExport();
    expect(snap.workspace.currentPath).toBe('C:/Users/dev/proj');
    expect(snap.workspace.recents).toEqual([
      'C:/Users/dev/proj',
      'C:/Users/dev/other',
    ]);
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
    expect(toolSettingsState.disabledToolNames).toEqual(['run_shell_command']);
    expect(toolSettingsState.confirmationMode).toEqual({
      run_shell_command: 'always_confirm',
    });
    expect(workspaceState.recents).toEqual([
      'C:/Users/dev/proj',
      'C:/Users/dev/other',
    ]);
  });
});

describe('previewDiffLabel', () => {
  it('formats workspace.currentPath changes with a before/after arrow', () => {
    const label = previewDiffLabel({
      path: 'workspace.currentPath',
      before: 'C:/old',
      after: 'C:/new',
    });
    expect(label).toBe('Workspace path: C:/old → C:/new');
  });

  it('renders workspace.currentPath = null as "(none)"', () => {
    const label = previewDiffLabel({
      path: 'workspace.currentPath',
      before: null,
      after: 'C:/new',
    });
    expect(label).toContain('(none)');
    expect(label).toContain('C:/new');
  });

  it('formats workspace.recents with added/removed counts', () => {
    const label = previewDiffLabel({
      path: 'workspace.recents',
      before: { added: [], removed: ['/old'] },
      after: { added: ['/new'], removed: [] },
    });
    expect(label).toContain('Recents list');
    expect(label).toContain('+1 new');
    expect(label).toContain('-1 removed');
  });

  it('formats voicePreferences.provider as a simple arrow', () => {
    const label = previewDiffLabel({
      path: 'voicePreferences.provider',
      before: 'stub',
      after: 'wispr',
    });
    expect(label).toBe('Voice provider: stub → wispr');
  });

  it('formats toolSettings.disabledToolNames with per-tool bullets', () => {
    const label = previewDiffLabel({
      path: 'toolSettings.disabledToolNames',
      before: { added: [], removed: ['a'] },
      after: { added: ['b', 'c'], removed: [] },
    });
    expect(label).toContain('+ b');
    expect(label).toContain('+ c');
    expect(label).toContain('- a');
  });

  it('formats per-tool confirmationMode changes with the tool name', () => {
    const label = previewDiffLabel({
      path: 'toolSettings.confirmationMode.run_shell_command',
      before: 'always_confirm',
      after: 'per_call',
    });
    expect(label).toBe(
      'Tool "run_shell_command" confirmation: always_confirm → per_call',
    );
  });

  it('formats a new tool (before = null) as a clear "(none)" indicator', () => {
    const label = previewDiffLabel({
      path: 'toolSettings.confirmationMode.new_tool',
      before: null,
      after: 'always_allow',
    });
    expect(label).toContain('Tool "new_tool"');
    expect(label).toContain('(none)');
    expect(label).toContain('always_allow');
  });

  it('falls back to a generic arrow for unknown paths', () => {
    const label = previewDiffLabel({
      path: 'someFutureField.value',
      before: 'a',
      after: 'b',
    });
    expect(label).toContain('someFutureField.value');
    expect(label).toContain('a → b');
  });
});
