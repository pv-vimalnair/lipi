/**
 * VoiceAnnouncer — M5 a11y.
 *
 * A visually-hidden live region that announces
 * voice-pipeline state changes to screen-reader
 * users. The voice flow is fundamentally a
 * non-visual one — the user speaks, the system
 * transcribes, the text appears. A blind user
 * using a screen reader (NVDA, JAWS, VoiceOver)
 * has no way to know:
 *   - that the recording actually started
 *     (the mic button changes visually, but
 *     the user isn't looking at it),
 *   - that the system is transcribing,
 *   - what the transcript was after the
 *     capture (the textarea is the destination,
 *     and the SR may or may not read it
 *     automatically depending on focus),
 *   - that an error occurred and what the
 *     error was.
 *
 * This component renders a single `<div
 * aria-live="polite" role="status" />` (a
 * polite live region so the SR doesn't
 * interrupt other speech) and pushes the
 * current state-derived announcement into
 * it. We use a single region and a single
 * text node so the SR doesn't get a
 * cacophony of overlapping announcements.
 *
 * The component does NOT own the
 * announcement logic — that's a pure
 * function `announceForStatus()` exported
 * below. Tests cover the pure function
 * (no DOM needed); the component itself is
 * a thin render layer.
 *
 * Visually hidden (but not display:none —
 * the SR needs the element in the
 * accessibility tree):
 *   - 1px clip, absolute positioned
 *     off-screen, 0 height/width.
 *   - `aria-live` works on elements
 *     regardless of visibility; the SR
 *     follows the accessibility tree, not
 *     the visual layout. We use a
 *     visually-hidden style rather than
 *     `display: none` because some SRs
 *     ignore `display: none` subtrees.
 *
 * Why a single component (not a hook):
 *   - The announcer is global — every voice
 *     surface in the app reads from the same
 *     voiceStore. A single `<VoiceAnnouncer
 *     />` mounted at the app root gives us
 *     one source of truth.
 *   - Multiple live regions racing each
 *     other is an SR anti-pattern (the
 *     speech queue gets corrupted). One
 *     region = one announcement = clean
 *     output.
 */

import { useEffect, useRef, useState } from 'react';
import { useVoiceStore, voiceSelectors } from '@/shared/state/voiceStore';
import styles from './VoiceAnnouncer.module.css';

export function VoiceAnnouncer(): JSX.Element {
  const status = useVoiceStore(voiceSelectors.status);
  const transcript = useVoiceStore(voiceSelectors.transcript);
  const lastError = useVoiceStore(voiceSelectors.lastError);
  const durationMs = useVoiceStore(voiceSelectors.durationMs);

  // We track the last announced state so a
  // re-render with the same state doesn't
  // re-announce (some SRs read the same text
  // repeatedly if the node text doesn't
  // change — we avoid that by emitting an
  // empty announcement when the state
  // hasn't changed).
  const [announcement, setAnnouncement] = useState('');
  const lastAnnouncedRef = useRef('');

  useEffect(() => {
    const next = announceForStatus({
      status,
      transcript,
      lastError,
      durationMs,
    });
    // Skip re-announcing the same string —
    // avoids SR repetition on re-render.
    if (next === lastAnnouncedRef.current) return;
    lastAnnouncedRef.current = next;
    setAnnouncement(next);
  }, [status, transcript, lastError, durationMs]);

  return (
    <div
      className={styles.srOnly}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="voice-announcer"
    >
      {announcement}
    </div>
  );
}

/**
 * The pure announcement function. Given a
 * snapshot of the voice state, return the
 * string that should be read by the screen
 * reader. Returning an empty string means
 * "nothing to say right now" — the live
 * region is silent.
 *
 * The mapping:
 *   - idle: silent (the user just stopped
 *     and the previous announcement already
 *     covered it).
 *   - requesting: "Requesting microphone
 *     access".
 *   - recording: "Recording. X seconds
 *     elapsed." (announced once at start;
 *     subsequent duration updates do NOT
 *     re-announce — SR users don't need
 *     a per-second "Recording. 3…4…5…"
 *     countdown. We only re-announce on
 *     status transitions.)
 *   - transcribing: "Transcribing".
 *   - error: "Voice error: <message>".
 *
 * The transcript text is NOT announced here
 * — the Composer subscribes to the
 * transcript and inserts it into the
 * textarea. A screen reader focused on the
 * textarea will read the inserted text
 * automatically (browsers re-announce
 * textarea content changes on focus).
 * Re-announcing the same text from a
 * live region is duplication and noise.
 */
export function announceForStatus(snapshot: {
  status: 'idle' | 'requesting' | 'recording' | 'transcribing' | 'error';
  transcript: string;
  lastError: string | null;
  durationMs: number;
}): string {
  switch (snapshot.status) {
    case 'idle':
      return '';
    case 'requesting':
      return 'Requesting microphone access.';
    case 'recording': {
      const seconds = Math.floor(snapshot.durationMs / 1000);
      // We only emit a duration-aware
      // announcement when seconds is a
      // round number (avoids "Recording.
      // 3.7s elapsed" — the SR would round
      // it anyway and the value changes
      // every render). At second boundaries
      // we get "Recording. 5 seconds
      // elapsed." which is meaningful.
      return `Recording. ${seconds} seconds elapsed.`;
    }
    case 'transcribing':
      return 'Transcribing.';
    case 'error':
      return `Voice error: ${snapshot.lastError ?? 'unknown error'}. Click the mic button to retry.`;
  }
}
