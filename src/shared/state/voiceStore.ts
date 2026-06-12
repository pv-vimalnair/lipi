/**
 * voiceStore — M2a UI-state for the voice capture pipeline.
 *
 * The store is the single source of truth for the mic button's
 * visible state and the most-recent finalized transcript. It is
 * deliberately small and dumb: it does NOT own the Web Audio /
 * MediaRecorder / getUserMedia plumbing. That lives in
 * `useVoiceCapture` (a hook), which mutates this store via
 * `setState` from the callbacks it gets.
 *
 * Why a store, not React state in the Composer:
 *   - The mic UI is shared by every screen that has an AI
 *     composer (today: just the AIPanel; tomorrow: maybe a
 *     Cmd-K modal). A store lets any component read the
 *     current state without prop-drilling.
 *   - Recording state must survive the Composer unmounting
 *     (e.g. user opens Cmd-K mid-recording). The store
 *     outlives the React tree; the hook is what we tear down
 *     to actually stop the mic.
 *
 * State machine (Rule 5 — discriminated union):
 *
 *   idle  ──start()──▶  requesting  ──ok──▶  recording
 *      ▲                  │                       │
 *      │                  │                       │ stop()
 *      │                  ▼                       ▼
 *      └──ok────────   error ◀──fail──  transcribing
 *                                               │
 *                                               │ done
 *                                               ▼
 *                                              idle
 *
 *   - `requesting`: the user just clicked the mic, we are
 *      awaiting the browser's permission prompt + the first
 *      MediaRecorder sample. Mic button shows a "…" spinner.
 *   - `recording`: MediaRecorder is active, the mic is
 *      capturing. Mic button shows a pulsing red dot. A
 *      monotonic `durationMs` is updated every animation
 *      frame by the hook.
 *   - `transcribing`: M2a stub: the user has stopped and we
 *      are "transcribing" (in M2a this is a 200ms sleep
 *      before we hand back a placeholder; in M2b/c this is
 *      the WS round-trip / on-device STT).
 *   - `error`: any step failed (permission denied, device
 *      busy, no mic). The `lastError` field has a user-
 *      facing message; the mic button shows it on hover.
 *
 * Persistence: NONE. Recordings and transcripts are
 * ephemeral. The user is expected to either send the
 * transcript (in which case it lives in the AI chat history)
 * or discard it (which clears `transcript`). We never
 * persist audio blobs.
 */

import { create } from 'zustand';

export type VoiceStatus =
  | 'idle'
  | 'requesting'
  | 'recording'
  | 'transcribing'
  | 'error';

export interface VoiceState {
  /** Current state of the capture pipeline. */
  status: VoiceStatus;
  /** Elapsed ms since recording started. 0 when not recording. */
  durationMs: number;
  /** Most recent finalized transcript (the user has stopped
   *  recording and the STT step returned). Stays on screen
   *  until the user sends it (the composer appends + clears)
   *  or dismisses it (the next `start()` call clears it). */
  transcript: string;
  /** Last user-facing error message, populated when
   *  `status === 'error'`. Cleared on the next `start()`. */
  lastError: string | null;

  /** Actions. Each is a pure state transition; the hook is
   *  the one that actually starts/stops the mic. */
  setStatus: (status: VoiceStatus) => void;
  setDurationMs: (ms: number) => void;
  setTranscript: (text: string) => void;
  setError: (message: string) => void;
  /** Reset to idle. Called when the user dismisses the
   *  transcript or the composer mounts fresh. */
  reset: () => void;
}

export const useVoiceStore = create<VoiceState>((set) => ({
  status: 'idle',
  durationMs: 0,
  transcript: '',
  lastError: null,

  setStatus: (status) => set({ status }),
  setDurationMs: (durationMs) => set({ durationMs }),
  setTranscript: (transcript) => set({ transcript, status: 'idle' }),
  setError: (lastError) => set({ lastError, status: 'error', durationMs: 0 }),
  reset: () =>
    set({ status: 'idle', durationMs: 0, transcript: '', lastError: null }),
}));

export const voiceSelectors = {
  status: (s: VoiceState) => s.status,
  durationMs: (s: VoiceState) => s.durationMs,
  transcript: (s: VoiceState) => s.transcript,
  lastError: (s: VoiceState) => s.lastError,
  isRecording: (s: VoiceState): boolean => s.status === 'recording',
  isBusy: (s: VoiceState): boolean =>
    s.status === 'requesting' || s.status === 'transcribing',
};

/**
 * Pure helper: merge an existing composer text with a new
 * voice transcript. Lives in this file (not the hook or
 * the Composer) so the test file can import it directly
 * and assert the merge rules without spinning up React.
 *
 * Rules:
 *   - If the existing text is empty, return the transcript
 *     trimmed (no leading newline).
 *   - If the existing text doesn't end with a newline, prepend
 *     one. The result is "previous text\n\nnew transcript"
 *     when previous ends without a newline, or "previous text\n
 *     new transcript" when it already ends with one.
 *   - The transcript is trimmed (no trailing whitespace
 *     from the STT output).
 *
 * The "double newline" rule when previous doesn't end in \n
 * is a deliberate choice: voice transcripts often start
 * with a sentence that's its own thought ("Explain what
 * this function does"), so we separate the user-typed
 * context from the voice input with a paragraph break.
 * When previous already ends in \n (user just hit Enter),
 * a single newline is enough.
 */
export function mergeTranscript(
  existingText: string,
  transcript: string,
): string {
  const t = transcript.trim();
  if (t === '') return existingText;
  if (existingText === '') return t;
  const endsWithNewline = existingText.endsWith('\n');
  return endsWithNewline ? existingText + t : existingText + '\n\n' + t;
}

/**
 * Pure helper: format `durationMs` as `M:SS` for the
 * mic button's timer label. 0 -> "0:00", 6500 -> "0:06",
 * 65000 -> "1:05", 600000 -> "10:00". No hours — voice
 * recordings over 10 minutes are a UX bug, not a feature.
 */
export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
