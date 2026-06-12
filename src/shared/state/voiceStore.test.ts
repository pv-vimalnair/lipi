/**
 * voiceStore tests (M2a).
 *
 * Pure logic tests for the store's state machine and
 * the two helpers (`mergeTranscript`, `formatDuration`).
 * No React, no DOM, no audio APIs.
 *
 * The `useVoiceCapture` hook has its own test file
 * (`useVoiceCapture.test.ts`) that stubs the audio
 * globals; this file is the store-only contract.
 */

import { describe, expect, it, beforeEach } from 'vitest';

import {
  formatDuration,
  mergeTranscript,
  useVoiceStore,
  voiceSelectors,
} from './voiceStore';

describe('voiceStore — state machine', () => {
  beforeEach(() => {
    // Reset before each assertion - other tests
    // in the file may have left the store in a
    // non-idle state.
    useVoiceStore.getState().reset();
  });

  it('starts in the idle state with no transcript and no error', () => {
    const s = useVoiceStore.getState();
    expect(s.status).toBe('idle');
    expect(s.transcript).toBe('');
    expect(s.lastError).toBe(null);
    expect(s.durationMs).toBe(0);
  });

  it('setStatus transitions cleanly between states', () => {
    const set = useVoiceStore.getState().setStatus;
    set('requesting');
    expect(useVoiceStore.getState().status).toBe('requesting');
    set('recording');
    expect(useVoiceStore.getState().status).toBe('recording');
    set('transcribing');
    expect(useVoiceStore.getState().status).toBe('transcribing');
    set('idle');
    expect(useVoiceStore.getState().status).toBe('idle');
  });

  it('setTranscript stores the text AND returns the store to idle', () => {
    const set = useVoiceStore.getState().setStatus;
    set('transcribing');
    useVoiceStore.getState().setTranscript('hello world');
    const s = useVoiceStore.getState();
    expect(s.transcript).toBe('hello world');
    // Important: the hook's onstop callback ends
    // with `setTranscript(...)` and expects the
    // status to be flipped to 'idle' as a side
    // effect. The Composer's subscriber picks up
    // the transcript on this exact state flip.
    expect(s.status).toBe('idle');
  });

  it('setError stores the message, flips to error, resets duration', () => {
    const set = useVoiceStore.getState().setStatus;
    set('recording');
    useVoiceStore.getState().setDurationMs(1234);
    useVoiceStore.getState().setError('permission denied');
    const s = useVoiceStore.getState();
    expect(s.lastError).toBe('permission denied');
    expect(s.status).toBe('error');
    // The error state shouldn't carry a stale
    // recording duration.
    expect(s.durationMs).toBe(0);
  });

  it('reset clears every field back to its initial value', () => {
    useVoiceStore.getState().setStatus('recording');
    useVoiceStore.getState().setDurationMs(5000);
    useVoiceStore.getState().setTranscript('a');
    useVoiceStore.getState().setError('b');
    useVoiceStore.getState().reset();
    const s = useVoiceStore.getState();
    expect(s.status).toBe('idle');
    expect(s.durationMs).toBe(0);
    expect(s.transcript).toBe('');
    expect(s.lastError).toBe(null);
  });

  it('selectors expose the right values', () => {
    const s0 = useVoiceStore.getState();
    expect(voiceSelectors.status(s0)).toBe('idle');
    expect(voiceSelectors.isRecording(s0)).toBe(false);
    expect(voiceSelectors.isBusy(s0)).toBe(false);
    expect(voiceSelectors.lastError(s0)).toBe(null);

    useVoiceStore.getState().setStatus('recording');
    const s1 = useVoiceStore.getState();
    expect(voiceSelectors.isRecording(s1)).toBe(true);
    expect(voiceSelectors.isBusy(s1)).toBe(false);

    useVoiceStore.getState().setStatus('transcribing');
    const s2 = useVoiceStore.getState();
    expect(voiceSelectors.isRecording(s2)).toBe(false);
    expect(voiceSelectors.isBusy(s2)).toBe(true);
  });
});

describe('mergeTranscript', () => {
  it('returns the transcript unchanged when existing text is empty', () => {
    expect(mergeTranscript('', '  hello  ')).toBe('hello');
  });

  it('returns the existing text unchanged when the transcript is empty / whitespace', () => {
    expect(mergeTranscript('hello', '')).toBe('hello');
    expect(mergeTranscript('hello', '   ')).toBe('hello');
    expect(mergeTranscript('hello', '\n  \t')).toBe('hello');
  });

  it('separates with a single newline when existing text already ends in a newline', () => {
    expect(mergeTranscript('hello\n', 'world')).toBe('hello\nworld');
    expect(mergeTranscript('hello\n\n', 'world')).toBe('hello\n\nworld');
  });

  it('separates with a double newline (paragraph break) when existing text does not end in newline', () => {
    expect(mergeTranscript('hello', 'world')).toBe('hello\n\nworld');
    expect(mergeTranscript('hello world', 'new text')).toBe(
      'hello world\n\nnew text',
    );
  });

  it('trims the transcript (no leading/trailing whitespace from STT)', () => {
    expect(mergeTranscript('hi', '   voice here  ')).toBe('hi\n\nvoice here');
  });

  it('handles multi-line transcripts: keeps internal newlines', () => {
    expect(mergeTranscript('hi', 'line one\nline two')).toBe(
      'hi\n\nline one\nline two',
    );
  });
});

describe('formatDuration', () => {
  it('formats sub-second durations as 0:00', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(500)).toBe('0:00');
  });

  it('formats whole seconds with zero-pad', () => {
    expect(formatDuration(1000)).toBe('0:01');
    expect(formatDuration(5000)).toBe('0:05');
    expect(formatDuration(65000)).toBe('1:05');
    expect(formatDuration(600000)).toBe('10:00');
  });

  it('truncates sub-second remainders (no rounding)', () => {
    // 1999ms -> 1.999s -> floor to 1s
    expect(formatDuration(1999)).toBe('0:01');
    // 9999ms -> 9.999s -> floor to 9s
    expect(formatDuration(9999)).toBe('0:09');
  });
});
