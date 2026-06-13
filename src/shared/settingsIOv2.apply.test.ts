/**
 * Tests for the S2 v2 apply path.
 *
 * The apply step is the destructive half: it
 * writes a parsed v2 file's `data` block to the
 * three stores. We mock the three stores via
 * `vi.mock` so the test does not touch the
 * real localStorage / Zustand runtime, and so
 * the test does not depend on the 5a
 * soft-delete side effects (which would
 * require a hydrated store).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { setStateMock, applyImportedSettingsMock } = vi.hoisted(() => ({
  setStateMock: vi.fn(),
  applyImportedSettingsMock: vi.fn(),
}));

vi.mock('@/shared/state/workspaceStore', async (importOriginal) => {
  // M6a: the apply path
  // also imports
  // `createWorkspaceTab`
  // and `useActivePath`.
  // Re-export them from
  // the real module so
  // the test gets the
  // production
  // implementations.
  const actual =
    (await importOriginal()) as typeof import('@/shared/state/workspaceStore');
  return {
    useWorkspaceStore: { setState: setStateMock },
    createWorkspaceTab: actual.createWorkspaceTab,
    useActivePath: actual.useActivePath,
  };
});

vi.mock('@/shared/state/voicePreferencesStore', () => ({
  useVoicePreferencesStore: { setState: setStateMock },
}));

vi.mock('@/shared/state/toolSettingsStore', () => ({
  useToolSettingsStore: { getState: () => ({ applyImportedSettings: applyImportedSettingsMock }) },
}));

const { applyLipiStateV2 } = await import('./settingsIOv2.apply');
const { buildLipiStateV2 } = await import('./settingsIOv2');

const FIXTURE_DATA = {
  workspace: {
    currentPath: 'C:/Users/dev/proj',
    recents: ['C:/Users/dev/proj', 'C:/Users/dev/other'],
  },
  voicePreferences: { provider: 'wispr' as const },
  toolSettings: {
    disabledToolNames: ['run_shell_command'],
    confirmationMode: { run_shell_command: 'always_confirm' as const },
  },
};

describe('applyLipiStateV2', () => {
  beforeEach(() => {
    setStateMock.mockReset();
    applyImportedSettingsMock.mockReset();
    setStateMock.mockReturnValue(undefined);
    applyImportedSettingsMock.mockReturnValue(undefined);
  });
  afterEach(() => {
    setStateMock.mockReset();
    applyImportedSettingsMock.mockReset();
  });

  it('writes workspace + voicePreferences via setState and toolSettings via applyImportedSettings', () => {
    const r = applyLipiStateV2(FIXTURE_DATA);
    expect(r.ok).toBe(true);
    // setState is called twice: once for workspace
    // (with the M6a
    // `workspaces` +
    // `activeId` shape +
    // recents), once for
    // voicePreferences (with
    // provider).
    expect(setStateMock).toHaveBeenCalledTimes(2);
    // We don't pin the
    // tab `id` (it's a
    // `crypto.randomUUID`
    // inside the apply
    // path) but we can
    // assert the
    // structural shape.
    const workspaceCall = setStateMock.mock.calls[0]?.[0] as
      | { workspaces: { id: string; path: string }[]; activeId: string; recents: string[] }
      | undefined;
    expect(workspaceCall?.workspaces).toHaveLength(1);
    expect(workspaceCall?.workspaces[0]?.path).toBe('C:/Users/dev/proj');
    expect(workspaceCall?.activeId).toBe(workspaceCall?.workspaces[0]?.id);
    expect(workspaceCall?.recents).toEqual([
      'C:/Users/dev/proj',
      'C:/Users/dev/other',
    ]);
    expect(setStateMock).toHaveBeenNthCalledWith(2, { provider: 'wispr' });
    expect(applyImportedSettingsMock).toHaveBeenCalledWith({
      disabledToolNames: ['run_shell_command'],
      confirmationMode: { run_shell_command: 'always_confirm' },
    });
  });

  it('returns ok:true for the buildLipiStateV2 → applyLipiStateV2 path', () => {
    const built = buildLipiStateV2(FIXTURE_DATA);
    const r = applyLipiStateV2(built.data);
    expect(r.ok).toBe(true);
  });

  it('returns ok:false with kind:"workspace" if workspace setState throws', () => {
    setStateMock.mockImplementationOnce(() => {
      throw new Error('workspace boom');
    });
    const r = applyLipiStateV2(FIXTURE_DATA);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('workspace');
      expect(r.error.message).toMatch(/workspace boom/);
    }
  });

  it('returns ok:false with kind:"voice-preferences" if voice setState throws', () => {
    setStateMock.mockImplementationOnce(() => undefined); // workspace ok
    setStateMock.mockImplementationOnce(() => {
      throw new Error('voice boom');
    });
    const r = applyLipiStateV2(FIXTURE_DATA);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('voice-preferences');
    }
  });

  it('returns ok:false with kind:"tool-settings" if applyImportedSettings throws', () => {
    applyImportedSettingsMock.mockImplementationOnce(() => {
      throw new Error('tool boom');
    });
    const r = applyLipiStateV2(FIXTURE_DATA);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('tool-settings');
    }
  });
});
