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
    currentPath: 'C:/Users/dev/proj',
    recents: ['C:/Users/dev/proj', 'C:/Users/dev/other'],
  },
  voicePreferencesState: { provider: 'wispr' as const },
  toolSettingsState: {
    disabledToolNames: ['run_shell_command'],
    confirmationMode: { run_shell_command: 'always_confirm' as const },
  },
}));

vi.mock('@/shared/state/workspaceStore', () => ({
  useWorkspaceStore: { getState: () => workspaceState },
}));
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
