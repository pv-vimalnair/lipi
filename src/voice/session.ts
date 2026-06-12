/**
 * session — M3 unified `VoiceSession` interface.
 *
 * Replaces the M2a/M2b/M2c function-style `transcribeViaX`
 * entry points with a single stateful object that every
 * provider (stub, wispr, ondevice, webSpeech, nativeDictation)
 * conforms to. The unification buys us:
 *
 *   1. A `Record<VoiceProviderId, VoiceSessionFactory>`
 *      registry that the `useVoiceCapture` hook dispatches
 *      against (collapsing the 4-branch `if/else` ladder —
 *      Rule 5).
 *   2. A single error class (`VoiceSessionError`) with a
 *      stable 24-code `code` union (replacing the four
 *      provider-specific `*Error` classes and the 4 unions).
 *   3. A drop-in slot for the iOS Swift / Android Kotlin
 *      plugins (`createNativeDictationSession`), gated on
 *      `capabilities.nativeDictation`.
 *
 * What this file owns:
 *   - The `VoiceSessionError` class (single error shape).
 *   - The 24-code `VoiceSessionErrorCode` union.
 *   - The 7-state `VoiceSessionState` union (finer-grained
 *     than the 5-state store — `transcribing` splits into
 *     `stopping | finalizing`).
 *   - The `VoiceSession` / `VoiceSessionHandle` interfaces.
 *   - The `voiceSessionErrorMessage(code)` helper (single
 *     source of truth for the user-facing string per code).
 *
 * What this file does NOT own:
 *   - The `TranscriptionEvent` shape — lives in `./types.ts`
 *     (re-exported via the `@/voice` barrel).
 *   - The `VoiceProviderId` literal union — also in
 *     `./types.ts` (re-exported).
 *   - The factory registry itself — `sessionFactory.ts`.
 *
 * The session is intentionally a thin object (state +
 * 3 listeners + 2 methods). All the provider-specific
 * state (mic streams, WebSockets, the Rust IPC subscription,
 * the abort handle) lives in the factory's closure. The
 * session exposes only what the consumer needs: state
 * transitions, transcription events, and errors.
 */

import type { TranscriptionEvent, VoiceMode, VoiceProviderId } from './types';

/** A handle-shaped object that test seam functions return
 *  for the on-device transcript / error subscriptions.
 *  Mirrors the Tauri `UnlistenFn` shape: `unsubscribe()`
 *  tears the subscription down. The handle is its OWN
 *  type (not `VoiceSessionHandle`) because it predates
 *  the M3 unification and the on-device factory
 *  accepts it as an injection point. */
export interface TranscriptSubscription {
  unsubscribe: () => void;
}

/** Stable error taxonomy across every STT provider. The
 *  union is the source of truth for the M3 user-facing
 *  error surface (replaces the four M2a/b/c `*Error` classes
 *  and their 4 `*ErrorCode` unions). Each code has a
 *  one-line message in `voiceSessionErrorMessage()` below. */
export type VoiceSessionErrorCode =
  | 'permission-denied'
  | 'mic-unavailable'
  | 'no-audio-context'
  | 'sample-rate-mismatch'
  | 'no-input-device'
  | 'no-active-model'
  | 'network'
  | 'auth'
  | 'rate-limited'
  | 'bad-audio'
  | 'no-speech'
  | 'no-webspeech'
  | 'service-not-allowed'
  | 'bad-grammar'
  | 'not-configured'
  | 'start-failed'
  | 'stop-failed'
  | 'inference-failed'
  | 'aborted'
  | 'cancelled'
  | 'timeout'
  | 'unsupported'
  | 'unknown';

/** Single error class every provider throws. Replaces
 *  `WisprClientError`, `OnDeviceSttError`, `WebSpeechSttError`,
 *  and the bare `Error` from the M2a stub. Consumers switch
 *  on `err.code` (a `VoiceSessionErrorCode`) and read
 *  `err.message` for the user-facing text. */
export class VoiceSessionError extends Error {
  readonly code: VoiceSessionErrorCode;
  /** Hint to the UI: `true` if the user can retry without
   *  changing anything (e.g. a network blip); `false` if
   *  the failure is configuration-related (e.g. no API
   *  key, no model installed). */
  readonly retryable: boolean;
  /** The underlying error, if any. Useful for logging;
   *  never shown raw to users. */
  override readonly cause?: unknown;
  constructor(
    code: VoiceSessionErrorCode,
    message: string,
    opts: { cause?: unknown; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = 'VoiceSessionError';
    this.code = code;
    this.cause = opts.cause;
    this.retryable = opts.retryable ?? false;
  }
}

/** Lifecycle state of a single `VoiceSession`. Finer-grained
 *  than the 5-state `VoiceStatus` in `voiceStore.ts` (the
 *  store is a UI-state machine; this is a protocol state
 *  machine). The hook maps session states to store states
 *  via its `onStateChange` listener.
 *
 *  Mappings:
 *    `'starting' | 'listening'`        → store `'requesting' | 'recording'`
 *    `'stopping' | 'finalizing'`       → store `'transcribing'`
 *    `'closed'`                        → store `'idle'`
 *    `'error'`                         → store `'error'`
 *    `'idle'`                          → pre-construction (not visible to the store)
 *
 *  The `transcribing` → `stopping | finalizing` split is the
 *  key M3 win: today the Wispr `if (provider === 'wispr' && pcmHandleRef.current)`
 *  branch and the on-device `if (provider === 'ondevice' && onDeviceSessionIdRef.current)`
 *  branch both flip the store to `transcribing` then `await`
 *  different things. With the session API, every factory
 *  emits `listening → stopping → finalizing → closed` in
 *  that order, and the hook has a single listener. */
export type VoiceSessionState =
  | 'idle'
  | 'starting'
  | 'listening'
  | 'stopping'
  | 'finalizing'
  | 'closed'
  | 'error';

/** An open voice capture session. Emit-only events; one
 *  session = one mic stream. The session is created by a
 *  `VoiceSessionFactory`; the consumer (the `useVoiceCapture`
 *  hook) wires the three listeners and calls `close()` to
 *  tear it down. */
export interface VoiceSession {
  /** Current session state. Subscribe via `onStateChange`. */
  readonly state: VoiceSessionState;

  /** Active mode. Immutable for the lifetime of the session. */
  readonly mode: VoiceMode;

  /** Provider id. Matches the `VoiceProviderId` literal union. */
  readonly provider: VoiceProviderId;

  /** Subscribe to state transitions. Returns the unsubscribe
   *  function. Fires synchronously on every transition
   *  (including the initial `starting` if the factory calls
   *  `setState` before returning the handle — most factories
   *  do). */
  onStateChange(listener: (state: VoiceSessionState) => void): () => void;

  /** Subscribe to transcription events. Fires zero or more
   *  times per session; exactly one `kind: 'final'` is the
   *  canonical "the user is done and the result is in".
   *  Returns the unsubscribe function. */
  onTranscription(listener: (event: TranscriptionEvent) => void): () => void;

  /** Subscribe to errors. Fires once per error; the session
   *  is then in `state === 'error'` and the consumer should
   *  call `close()` and decide whether to retry. Returns the
   *  unsubscribe function. */
  onError(listener: (err: VoiceSessionError) => void): () => void;

  /** Force the provider to emit any pending partial as a
   *  `final`. Resolves when the flush has been DELIVERED
   *  through `onTranscription` (i.e. the consumer's listener
   *  has been called), not when the provider has
   *  acknowledged. Rejects with `VoiceSessionError('unsupported')`
   *  for providers that can't flush mid-session (e.g. the
   *  M2a stub). */
  flush(): Promise<void>;

  /** Stop capture and tear down mic + network. Idempotent —
   *  a second call is a no-op. After `close()` the session
   *  is unusable; the factory must be called again for a new
   *  one. Resolves when teardown is complete. */
  close(): Promise<void>;
}

/** The handle returned by a `VoiceSessionFactory`. Wraps the
 *  session with a cancel token. The hook creates a per-session
 *  `AbortController` (the `signal` field on
 *  `VoiceSessionFactoryOptions`) and stashes the handle;
 *  on `useEffect` cleanup it calls `abort()`.
 *
 *  The split between `close()` (consumer-initiated, idempotent
 *  "I'm done, clean up") and `abort()` (external cancellation,
 *  "stop right now, don't wait for the final") is the same
 *  distinction the M2a `generationRef` counter and the M2b
 *  `settled` flag hand-rolled. M3 makes it typed. */
export interface VoiceSessionHandle {
  readonly session: VoiceSession;
  /** Abort the in-flight session. After `abort()`, the
   *  session emits a `VoiceSessionError('aborted')` (or
   *  `'cancelled'` on the on-device path) and transitions
   *  to `state === 'closed'`. Idempotent. The underlying
   *  `AbortSignal` (the one passed as `opts.signal`) is
   *  also fired. */
  abort(): void;
}

/** User-facing message for a `VoiceSessionErrorCode`. Pure
 *  function for testability. This is the single source of
 *  truth for the user-facing string per code (replaces the
 *  four M2a/b/c `*ErrorMessage` helpers). The hook reads
 *  `err.message` directly when surfacing a session error
 *  to the voice store. */
export function voiceSessionErrorMessage(code: VoiceSessionErrorCode): string {
  switch (code) {
    case 'permission-denied':
      return 'Microphone access was blocked. Enable it in the OS privacy settings and try again.';
    case 'mic-unavailable':
      return 'The microphone is busy. Close other apps using the mic and try again.';
    case 'no-audio-context':
      return 'AudioContext is not available in this environment.';
    case 'sample-rate-mismatch':
      return 'Microphone sample rate is not 16 kHz. Try a different input device.';
    case 'no-input-device':
      return 'No microphone was found. Plug one in and try again.';
    case 'no-active-model':
      return 'No on-device STT model is installed. Open Settings → Voice to install one.';
    case 'network':
      return 'Could not reach the voice service. Check your network and try again.';
    case 'auth':
      return 'The voice service rejected the API key. Check it in Settings → Voice.';
    case 'rate-limited':
      return 'Voice service rate limit hit. Wait a moment and try again.';
    case 'bad-audio':
      return 'The voice service could not transcribe the audio. Try a quieter environment.';
    case 'no-speech':
      return "Didn't catch that. Try again.";
    case 'no-webspeech':
      return "This WebView doesn't support the browser's built-in speech engine. Try a different provider in Settings → Voice.";
    case 'service-not-allowed':
      return 'The browser blocked the speech service. Check your browser settings and try again.';
    case 'bad-grammar':
      return 'The language tag was rejected. Try a different language in Settings → Voice.';
    case 'not-configured':
      return 'On-device STT is not configured. Open Settings → Voice to install a model.';
    case 'start-failed':
      return 'Failed to start voice capture. Try again.';
    case 'stop-failed':
      return 'Failed to stop voice capture cleanly. Try again.';
    case 'inference-failed':
      return 'On-device STT inference failed. Try again.';
    case 'aborted':
      return 'Voice capture was cancelled.';
    case 'cancelled':
      return 'On-device transcription was cancelled.';
    case 'timeout':
      return 'Voice service did not respond in time. Try again.';
    case 'unsupported':
      return 'Voice capture failed. Try a different provider in Settings → Voice.';
    case 'unknown':
      return 'Voice capture failed. Try again.';
  }
}
