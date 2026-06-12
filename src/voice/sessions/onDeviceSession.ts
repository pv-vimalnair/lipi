/**
 * onDeviceSession — M3 `VoiceSession` factory for the `'ondevice'`
 * provider (M2c desktop + M2c mobile via the Swift / Kotlin
 * plugin shim).
 *
 * Owns the Rust `stt_start_listening` / `stt_stop_listening`
 * round-trip AND the `stt://transcript` / `stt://error` event
 * subscriptions. The M2c hook was the only consumer of the
 * `transcribeViaOnDevice` function — M3 folds both into a
 * single `VoiceSession`.
 *
 * What changed from M2c:
 *   - The `onSessionStart(sessionId)` callback pattern
 *     disappears. The session owns the sessionId in a closure
 *     ref; the consumer (the hook) no longer has to stash it
 *     for `stop()`. The session's `close()` calls
 *     `sttStopListening(sessionId)` itself.
 *   - The session emits the 7-state machine
 *     `starting → listening → stopping → finalizing → closed`.
 *   - Errors are `VoiceSessionError`s (the M2c
 *     `OnDeviceSttError` is gone).
 *   - Cancellation: `handle.abort()` calls
 *     `stt_stop_listening(sessionId)` and emits
 *     `VoiceSessionError('cancelled')` (the M2c code name
 *     maps to the M3 `cancelled` code).
 *
 * Test escape hatch (per Decision #2):
 *   - `sttStartOverride` / `sttStopOverride` replace the IPC
 *     commands.
 *   - `subscribeTranscript` / `subscribeError` replace the
 *     Tauri event subscriptions. The shape matches the
 *     Tauri `listen()` contract: returns an unsubscribe
 *     function.
 */
import { voiceSessionErrorMessage, VoiceSessionError } from '../session';
import type {
  VoiceSession,
  VoiceSessionErrorCode,
  VoiceSessionHandle,
} from '../session';
import type { TranscriptionEvent, VoiceProviderId } from '../types';
import type { VoiceSessionFactoryOptions } from '../sessionFactory';

const ONDEVICE_DEFAULT_TIMEOUT_MS = 60_000;

export interface TranscriptSubscription {
  unsubscribe: () => void;
}

/** Default subscription that wires Tauri's `listen()` to
 *  the `stt://transcript` event. Tests inject
 *  `subscribeTranscript` to bypass Tauri entirely. */
async function defaultSubscribeTranscript(
  handler: (event: {
    sessionId: string;
    text: string;
    isFinal: boolean;
    confidence?: number;
    timestamp: number;
  }) => void,
): Promise<TranscriptSubscription> {
  // The dynamic import keeps this module testable
  // in a Node-only test runner (no Tauri runtime).
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen<TranscriptionEvent>('stt://transcript', (e) => {
    const p = e.payload;
    handler({
      sessionId: p.sessionId ?? '',
      text: p.text,
      isFinal: p.kind === 'final' || p.isUtteranceEnd === true,
      confidence: p.confidence,
      timestamp: p.timestamp,
    });
  });
  return { unsubscribe: unlisten };
}

/** Default subscription for `stt://error`. */
async function defaultSubscribeError(
  handler: (event: {
    sessionId: string;
    code: string;
    message: string;
    retryable: boolean;
  }) => void,
): Promise<TranscriptSubscription> {
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen<{
    kind: string;
    message: string;
    sessionId?: string;
  }>('stt://error', (e) => {
    const p = e.payload;
    handler({
      sessionId: p.sessionId ?? '',
      code: p.kind,
      message: p.message,
      retryable: false,
    });
  });
  return { unsubscribe: unlisten };
}

async function defaultSttStart(opts: {
  sessionId: string;
  language?: string;
}): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('stt_start_listening', {
    opts: { language: opts.language, maxDurationMs: undefined },
  });
}

async function defaultSttStop(sessionId: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('stt_stop_listening', { sessionId });
}

function mapRustKindToCode(kind: string): VoiceSessionErrorCode {
  switch (kind) {
    case 'permission-denied':
      return 'permission-denied';
    case 'no-input-device':
      return 'no-input-device';
    case 'no-active-model':
      return 'no-active-model';
    case 'cancelled':
      return 'cancelled';
    case 'inference':
      return 'inference-failed';
    case 'download-failed':
    case 'checksum-mismatch':
    case 'unknown-model':
    case 'model-file-missing':
    case 'io':
      return 'start-failed';
    default:
      return 'unknown';
  }
}

export function createOnDeviceSession(
  opts: VoiceSessionFactoryOptions,
): Promise<VoiceSessionHandle> {
  return new Promise<VoiceSessionHandle>(async (resolve, reject) => {
    if (opts.signal.aborted) {
      reject(
        new VoiceSessionError(
          'aborted',
          voiceSessionErrorMessage('aborted'),
          { cause: opts.signal.reason, retryable: false },
        ),
      );
      return;
    }

    const subscribeTranscript =
      opts.subscribeTranscript ?? defaultSubscribeTranscript;
    const subscribeError = opts.subscribeError ?? defaultSubscribeError;
    const startListening = opts.sttStartOverride ?? defaultSttStart;
    const stopListening = opts.sttStopOverride ?? defaultSttStop;

    let state: 'idle' | 'starting' | 'listening' | 'stopping' | 'finalizing' | 'closed' | 'error' = 'idle';
    const stateListeners = new Set<(s: typeof state) => void>();
    const transcriptionListeners = new Set<(e: TranscriptionEvent) => void>();
    const errorListeners = new Set<(err: VoiceSessionError) => void>();
    let closed = false;
    let sessionId = `ondevice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let sequence = 0;
    let armHandle: ReturnType<typeof setTimeout> | null = null;
    let transcriptSub: TranscriptSubscription | null = null;
    let errorSub: TranscriptSubscription | null = null;

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

    const armTimeout = (): void => {
      if (armHandle !== null) clearTimeout(armHandle);
      armHandle = setTimeout(() => {
        if (closed) return;
        const err = new VoiceSessionError(
          'timeout',
          voiceSessionErrorMessage('timeout'),
        );
        setState('error');
        emitError(err);
        void close();
      }, ONDEVICE_DEFAULT_TIMEOUT_MS);
    };

    const onAbort = (): void => {
      if (closed) return;
      const err = new VoiceSessionError(
        'cancelled',
        voiceSessionErrorMessage('cancelled'),
        { cause: opts.signal.reason, retryable: false },
      );
      setState('error');
      emitError(err);
      void close();
    };
    opts.signal.addEventListener('abort', onAbort, { once: true });

    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      if (armHandle !== null) {
        clearTimeout(armHandle);
        armHandle = null;
      }
      // Call `stt_stop_listening` on the Rust side.
      // We swallow errors — the session is closing
      // regardless.
      try {
        await stopListening(sessionId);
      } catch {
        // best-effort
      }
      if (transcriptSub) {
        transcriptSub.unsubscribe();
        transcriptSub = null;
      }
      if (errorSub) {
        errorSub.unsubscribe();
        errorSub = null;
      }
      opts.signal.removeEventListener('abort', onAbort);
      setState('closed');
    };

    function makeSession(provider: VoiceProviderId): VoiceSession {
      return {
        get state() {
          return state;
        },
        mode: opts.mode,
        provider,
        onStateChange(l) {
          stateListeners.add(l);
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
          // The on-device path supports `flush()` — it
          // sends `stt_stop_listening` to the Rust side
          // and waits for the final `stt://transcript`
          // event. Wait for the `finalizing` state.
          if (closed) return;
          try {
            await stopListening(sessionId);
          } catch {
            // best-effort
          }
          await new Promise<void>((res) => {
            const check = (): void => {
              if (closed) {
                res();
                return;
              }
              if (state === 'finalizing' || state === 'closed') {
                res();
                return;
              }
              setTimeout(check, 10);
            };
            check();
          });
        },
        close,
      };
    }

    setState('starting');
    // Subscribe BEFORE starting so the transcript
    // event isn't dropped.
    try {
      transcriptSub = await subscribeTranscript((event) => {
        if (closed) return;
        if (event.sessionId && event.sessionId !== sessionId) return;
        armTimeout();
        if (event.isFinal) {
          setState('stopping');
          setState('finalizing');
          emitTranscription({
            kind: 'final',
            text: event.text,
            sequence: ++sequence,
            timestamp: event.timestamp,
            isUtteranceEnd: true,
            sessionId,
          });
        } else {
          emitTranscription({
            kind: 'partial',
            text: event.text,
            sequence: ++sequence,
            timestamp: event.timestamp,
            sessionId,
          });
        }
      });
      errorSub = await subscribeError((event) => {
        if (closed) return;
        if (event.sessionId && event.sessionId !== sessionId) return;
        const code = mapRustKindToCode(event.code);
        const err = new VoiceSessionError(
          code,
          event.message || voiceSessionErrorMessage(code),
        );
        setState('error');
        emitError(err);
        void close();
      });
    } catch (e) {
      const err = new VoiceSessionError(
        'start-failed',
        e instanceof Error ? e.message : 'Failed to subscribe to STT events',
        { cause: e, retryable: true },
      );
      setState('error');
      emitError(err);
      reject(err);
      return;
    }

    if (opts.signal.aborted) {
      const err = new VoiceSessionError(
        'aborted',
        voiceSessionErrorMessage('aborted'),
        { cause: opts.signal.reason, retryable: false },
      );
      setState('error');
      emitError(err);
      reject(err);
      return;
    }

    try {
      await startListening({ sessionId, language: opts.language });
    } catch (e) {
      const err = new VoiceSessionError(
        'start-failed',
        e instanceof Error ? e.message : 'Failed to start STT session',
        { cause: e, retryable: true },
      );
      setState('error');
      emitError(err);
      reject(err);
      return;
    }

    setState('listening');
    armTimeout();

    const handle: VoiceSessionHandle = {
      session: makeSession('ondevice'),
      abort() {
        // Decision #4: route through the same
        // onAbort path the signal listener uses.
        onAbort();
      },
    };
    resolve(handle);
  });
}
