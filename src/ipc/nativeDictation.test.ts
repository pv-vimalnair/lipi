/**
 * Tests for the `nativeDictation` IPC layer's pure
 * helpers and the typed wire shape.
 *
 * The hook call (`getNativeDictationContract`) is
 * covered by a mocked `@tauri-apps/api/core` so the
 * shape contract is pinned: any future change to the
 * Rust serialisation that breaks the JS expectation
 * is caught here, not at runtime.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NativeDictationContract } from './nativeDictation';

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

const {
  contractStatusLabel,
  errorKindLabel,
  getNativeDictationContract,
} = await import('./nativeDictation');

describe('contractStatusLabel', () => {
  it('labels `active` as ready', () => {
    expect(contractStatusLabel('active')).toMatch(/ready/i);
  });
  it('labels `inert` as contract-ready / binding-pending', () => {
    expect(contractStatusLabel('inert')).toMatch(/pending/i);
  });
  it('labels `not-applicable` as iOS / Android only', () => {
    const s = contractStatusLabel('not-applicable');
    expect(s).toMatch(/iOS/);
    expect(s).toMatch(/Android/);
  });
});

describe('errorKindLabel', () => {
  it('permission-denied mentions OS settings', () => {
    expect(errorKindLabel('permission-denied')).toMatch(/settings/i);
  });
  it('no-input-device mentions "no" / "unavailable"', () => {
    expect(errorKindLabel('no-input-device')).toMatch(/no|unavailable/i);
  });
  it('timeout mentions the 30-second limit', () => {
    expect(errorKindLabel('timeout')).toMatch(/30/);
  });
  it('unknown is a generic catch-all', () => {
    expect(errorKindLabel('unknown')).toMatch(/unknown/i);
  });
  it('backend suggests "try again"', () => {
    expect(errorKindLabel('backend')).toMatch(/try again/i);
  });
});

describe('getNativeDictationContract IPC shape', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });
  afterEach(() => {
    invokeMock.mockReset();
  });

  it('calls invoke with the command name `get_native_dictation_contract`', async () => {
    invokeMock.mockResolvedValueOnce({
      plugin_name: 'native-dictation',
      status: 'not-applicable',
      events: { transcript: 'stt://transcript', error: 'stt://error' },
      methods: [],
      error_kinds: [],
    } satisfies NativeDictationContract);
    await getNativeDictationContract();
    expect(invokeMock).toHaveBeenCalledWith('get_native_dictation_contract');
  });

  it('returns the typed contract unchanged', async () => {
    const fixture: NativeDictationContract = {
      plugin_name: 'native-dictation',
      status: 'inert',
      events: { transcript: 'stt://transcript', error: 'stt://error' },
      methods: [
        {
          name: 'start',
          purpose: 'Open a recognition session and start streaming TranscriptEvent.',
          signature:
            'start(opts: ListenArgs | null, sessionId: string) -> Result<string, NativeDictationError>',
        },
        { name: 'stop', purpose: 'Stop the active session.', signature: 'stop(sessionId: string) -> Result<(), NativeDictationError>' },
        { name: 'cancel', purpose: 'Abort the session.', signature: 'cancel(sessionId: string) -> Result<(), NativeDictationError>' },
      ],
      error_kinds: [
        'permission-denied',
        'no-input-device',
        'backend',
        'timeout',
        'unknown',
      ],
    };
    invokeMock.mockResolvedValueOnce(fixture);
    const got = await getNativeDictationContract();
    expect(got).toEqual(fixture);
  });
});
