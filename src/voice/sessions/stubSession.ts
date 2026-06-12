/**
 * stubSession — M3 `VoiceSession` factory for the `'stub'` provider.
 *
 * The M2a "debug placeholder" path. Emits one `final` transcript
 * 200 ms after the session starts, with the recording duration
 * embedded in the text so the user (and tests) can tell at a
 * glance that the stub is in use. No real mic is opened — the
 * `MediaRecorder` from the M2a era is gone; the stub now lives
 * entirely inside this factory's closure.
 *
 * Why this exists in M3:
 *   - The Command Palette exposes a "switch to stub" command
 *     (useful for end-to-end UI verification on a build
 *     without a real STT backend).
 *   - The factory is the canonical example for new
 *     `VoiceSession` implementers — it shows the listener
 *     wiring, the state machine, and the lifecycle in ~40
 *     lines.
 *
 * Lifecycle (mirrors the M3 `VoiceSessionState` 7-state machine):
 *   `idle` → `starting` → `listening` → `stopping`
 *         → `finalizing` → `closed`
 *   The single `final` event lands on the `listening` →
 *   `stopping` transition. We do NOT auto-close after the
 *   `final` — the hook decides when to tear down by calling
 *   `close()`. This matches the Wispr + on-device
 *   semantics: the session is in `stopping` / `finalizing`
 *   until the consumer decides to drop it.
 */
import { voiceSessionErrorMessage, VoiceSessionError } from '../session';
import type { VoiceSession, VoiceSessionHandle } from '../session';
import type { TranscriptionEvent, VoiceProviderId } from '../types';
import type { VoiceSessionFactoryOptions } from '../sessionFactory';

/** Default time between `start()` and the synthetic `final`
 *  emission. 200 ms matches the M2a stub delay so the user
 *  still sees a brief "transcribing…" flash in the UI. */
const STUB_TRANSCRIBE_DELAY_MS = 200;

export function createStubSession(
  opts: VoiceSessionFactoryOptions,
): Promise<VoiceSessionHandle> {
  return new Promise<VoiceSessionHandle>((resolve) => {
    let state: 'idle' | 'starting' | 'listening' | 'stopping' | 'finalizing' | 'closed' | 'error' = 'idle';
    const stateListeners = new Set<(s: typeof state) => void>();
    const transcriptionListeners = new Set<(e: TranscriptionEvent) => void>();
    const errorListeners = new Set<(err: VoiceSessionError) => void>();
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let aborted = false;

    const setState = (s: typeof state): void => {
      if (state === s || closed) return;
      state = s;
      for (const l of stateListeners) l(s);
    };

    const emitTranscription = (event: TranscriptionEvent): void => {
      if (closed) return;
      for (const l of transcriptionListeners) l(event);
    };

    const emitError = (err: VoiceSessionError): void => {
      if (closed) return;
      for (const l of errorListeners) l(err);
    };

    const close = async (): Promise<void> => {
      if (closed) return;
      // Emit the state change BEFORE flipping the
      // `closed` flag — the `setState` guard skips
      // emissions after `closed = true` (per the
      // post-close event guard in M3 §11.7).
      setState('closed');
      closed = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    // The shared abort path. Both `handle.abort()`
    // and the `AbortSignal` listener route here
    // (Decision #4 — one cancellation API).
    const performAbort = (cause: unknown): void => {
      if (aborted || closed) return;
      aborted = true;
      const err = new VoiceSessionError(
        'aborted',
        voiceSessionErrorMessage('aborted'),
        { cause, retryable: false },
      );
      setState('error');
      emitError(err);
      void close();
    };

    // Refuse to start if the AbortSignal is already fired.
    if (opts.signal.aborted) {
      const handle: VoiceSessionHandle = {
        session: makeSession('stub'),
        abort: () => {
          /* no-op: session never started */
        },
      };
      setTimeout(() => {
        performAbort(opts.signal.reason);
        resolve(handle);
      }, 0);
      return;
    }
    opts.signal.addEventListener('abort', () => performAbort(opts.signal.reason), { once: true });

    // Phase 1: `starting` — open the (fake) capture, no real I/O.
    setState('starting');
    // Phase 2: `listening` — schedule the synthetic final.
    setState('listening');
    const startedAt = Date.now();
    timer = setTimeout(() => {
      if (closed || aborted) return;
      // Phase 3: `stopping` — the user is "done", we have a result.
      setState('stopping');
      // Phase 4: `finalizing` — the result is being delivered.
      setState('finalizing');
      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      emitTranscription({
        kind: 'final',
        text: `voice transcript (${seconds}s — stub STT, switch to Wispr in the Command Palette)`,
        sequence: 1,
        timestamp: Date.now(),
        isUtteranceEnd: true,
      });
      // The session is now in `stopping → finalizing` and waits
      // for the consumer to call `close()`. The hook flips the
      // store to `transcribing` on this state and `idle` after
      // `close()`.
    }, STUB_TRANSCRIBE_DELAY_MS);

    function makeSession(provider: VoiceProviderId): VoiceSession {
      return {
        get state() {
          return state;
        },
        mode: opts.mode,
        provider,
        onStateChange(l) {
          stateListeners.add(l);
          // Fire synchronously with the current state.
          l(state);
          return () => {
            stateListeners.delete(l);
          };
        },
        onTranscription(l) {
          transcriptionListeners.add(l);
          return () => {
            transcriptionListeners.delete(l);
          };
        },
        onError(l) {
          errorListeners.add(l);
          return () => {
            errorListeners.delete(l);
          };
        },
        async flush() {
          // The stub can't flush mid-session — there's no
          // audio to flush. Per Decision #5, the contract
          // is to reject with `unsupported`.
          throw new VoiceSessionError(
            'unsupported',
            voiceSessionErrorMessage('unsupported'),
          );
        },
        close,
      };
    }

    const handle: VoiceSessionHandle = {
      session: makeSession('stub'),
      abort() {
        // Decision #4: `abort()` and the
        // `AbortSignal` route to the same
        // `performAbort` function. We don't
        // dispatch a synthetic event through
        // the signal — the browser's `Event`
        // type doesn't satisfy `AbortSignal`'s
        // strict type, and the listener we
        // registered only checks `type === 'abort'`
        // semantically.
        performAbort(undefined);
      },
    };
    resolve(handle);
  });
}
