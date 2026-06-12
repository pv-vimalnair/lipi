/**
 * VoiceAnnouncer — tests for the pure
 * `announceForStatus` function.
 *
 * The component itself is a thin render
 * layer that subscribes to the
 * voiceStore; the announcement logic is
 * a pure function that's easy to
 * table-test.
 */

import { describe, expect, it } from 'vitest';
import { announceForStatus } from './VoiceAnnouncer';

describe('announceForStatus', () => {
  const baseSnapshot = {
    transcript: '',
    lastError: null,
    durationMs: 0,
  };

  it('is silent in idle state', () => {
    expect(announceForStatus({ ...baseSnapshot, status: 'idle' })).toBe('');
  });

  it('announces "Requesting microphone access" on requesting', () => {
    expect(
      announceForStatus({ ...baseSnapshot, status: 'requesting' }),
    ).toBe('Requesting microphone access.');
  });

  it('announces recording + duration on recording', () => {
    expect(
      announceForStatus({ ...baseSnapshot, status: 'recording', durationMs: 5_000 }),
    ).toBe('Recording. 5 seconds elapsed.');
  });

  it('rounds down duration to whole seconds', () => {
    // 3.7s -> "3 seconds elapsed." — the SR
    // would round it anyway, and the value
    // changes every render (which would
    // re-announce per frame). We avoid
    // that.
    expect(
      announceForStatus({ ...baseSnapshot, status: 'recording', durationMs: 3_700 }),
    ).toBe('Recording. 3 seconds elapsed.');
  });

  it('announces "Transcribing" on transcribing', () => {
    expect(
      announceForStatus({ ...baseSnapshot, status: 'transcribing' }),
    ).toBe('Transcribing.');
  });

  it('announces the error message on error', () => {
    expect(
      announceForStatus({
        ...baseSnapshot,
        status: 'error',
        lastError: 'No Wispr API key',
      }),
    ).toBe(
      'Voice error: No Wispr API key. Click the mic button to retry.',
    );
  });

  it('falls back to "unknown error" when lastError is null', () => {
    // Defensive — `setError` always sets
    // a message, but if a future code path
    // flips status to 'error' without
    // setting `lastError`, the announcer
    // shouldn't say "null".
    expect(
      announceForStatus({ ...baseSnapshot, status: 'error', lastError: null }),
    ).toBe(
      'Voice error: unknown error. Click the mic button to retry.',
    );
  });
});
