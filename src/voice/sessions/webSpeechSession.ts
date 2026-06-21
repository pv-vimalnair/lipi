/**
 * webSpeechSession — M3 `VoiceSession` factory for the `'webSpeech'`
 * provider (M2c mobile).
 *
 * Owns the WebView's `window.SpeechRecognition` (or
 * `window.webkitSpeechRecognition`) instance. Wires
 * `onresult` / `onerror` / `onend` to the M3 listener
 * emitters.
 *
 * What changed from M2c:
 *   - The `onSessionStart({ abort })` callback pattern
 *     disappears. The session owns the recognizer in a
 *     closure ref; the consumer calls `close()` and the
 *     session calls `recognition.abort()` itself.
 *   - The session emits the 7-state machine.
 *   - Errors are `VoiceSessionError`s (the M2c
 *     `WebSpeechSttError` is gone).
 *   - The M3 `flush()` contract: we can call
 *     `recognition.stop()` (graceful) and wait for
 *     `onend` to fire. The `final` event lands
 *     through `onTranscription` (M2c didn't surface
 *     partials; M3 optionally does when
 *     `interimResults: true`).
 *
 * W3C error → M3 code mapping:
 *
 * | W3C `error`           | M3 code                |
 * |-----------------------|------------------------|
 * | `not-allowed`         | `permission-denied`    |
 * | `no-speech`           | `no-speech`            |
 * | `aborted`             | `aborted`              |
 * | `network`             | `network`              |
 * | `service-not-allowed` | `service-not-allowed`  |
 * | `bad-grammar`         | `bad-grammar`          |
 * | (anything else)       | `unsupported`          |
 */
import { voiceSessionErrorMessage, VoiceSessionError } from '../session';
import type {
  VoiceSession,
  VoiceSessionErrorCode,
  VoiceSessionHandle,
} from '../session';
import type { TranscriptionEvent, VoiceProviderId } from '../types';
import type { VoiceSessionFactoryOptions } from '../sessionFactory';
import type {
  SpeechRecognition,
  SpeechRecognitionErrorEvent,
  SpeechRecognitionEvent,
} from '../webSpeechTypes';

const WEBSPEECH_DEFAULT_TIMEOUT_MS = 30_000;

function mapW3cErrorToCode(w3cError: string): VoiceSessionErrorCode {
  switch (w3cError) {
    case 'not-allowed':
      return 'permission-denied';
    case 'no-speech':
      return 'no-speech';
    case 'aborted':
      return 'aborted';
    case 'network':
      return 'network';
    case 'service-not-allowed':
      return 'service-not-allowed';
    case 'bad-grammar':
      return 'bad-grammar';
    default:
      return 'unsupported';
  }
}

export function createWebSpeechSession(
  opts: VoiceSessionFactoryOptions,
): Promise<VoiceSessionHandle> {
  // eslint-disable-next-line no-async-promise-executor -- callback-based SpeechRecognition setup requires async executor
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

    const ctor =
      opts.webSpeechCtor ??
      opts.windowOverride?.SpeechRecognition ??
      opts.windowOverride?.webkitSpeechRecognition ??
      (typeof window !== 'undefined'
        ? window.SpeechRecognition ?? window.webkitSpeechRecognition
        : undefined);
    if (!ctor) {
      reject(
        new VoiceSessionError(
          'no-webspeech',
          voiceSessionErrorMessage('no-webspeech'),
          { retryable: false },
        ),
      );
      return;
    }

    const language = opts.language ?? 'en-US';
    const recognition = new ctor() as SpeechRecognition;
    recognition.lang = language;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    let state: 'idle' | 'starting' | 'listening' | 'stopping' | 'finalizing' | 'closed' | 'error' = 'idle';
    const stateListeners = new Set<(s: typeof state) => void>();
    const transcriptionListeners = new Set<(e: TranscriptionEvent) => void>();
    const errorListeners = new Set<(err: VoiceSessionError) => void>();
    let closed = false;
    let lastFinal = '';
    let lastPartial = '';
    let sequence = 0;
    let armHandle: ReturnType<typeof setTimeout> | null = null;
    const sessionId = `webspeech-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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
      }, WEBSPEECH_DEFAULT_TIMEOUT_MS);
    };

    recognition.onresult = (event: SpeechRecognitionEvent): void => {
      if (closed) return;
      armTimeout();
      const resultList = event.results;
      for (let i = event.resultIndex; i < resultList.length; i++) {
        const result = resultList[i];
        if (!result) continue;
        if (result.isFinal && result.length > 0) {
          lastFinal = result[0].transcript;
          lastPartial = '';
        } else if (result.length > 0) {
          lastPartial = result[0].transcript;
        }
      }
      // Surface the most recent result through
      // `onTranscription`. We emit a `partial` for the
      // current accumulator, then a `final` when
      // `onend` fires.
      if (lastPartial) {
        emitTranscription({
          kind: 'partial',
          text: lastPartial,
          sequence: ++sequence,
          timestamp: Date.now(),
          sessionId,
        });
      }
    };
    recognition.onerror = (event: SpeechRecognitionErrorEvent): void => {
      if (closed) return;
      const code = mapW3cErrorToCode(event.error);
      const err = new VoiceSessionError(
        code,
        event.message || voiceSessionErrorMessage(code),
      );
      setState('error');
      emitError(err);
      void close();
    };
    recognition.onend = (): void => {
      if (closed) return;
      // Emit the final (if we have one). The
      // `onresult` handler may have already updated
      // `lastFinal` to the last `isFinal: true`
      // result; we always have it to fall back on.
      setState('stopping');
      setState('finalizing');
      const text = lastFinal || lastPartial;
      emitTranscription({
        kind: 'final',
        text,
        sequence: ++sequence,
        timestamp: Date.now(),
        isUtteranceEnd: true,
        sessionId,
      });
      // The session is now `finalizing`; the
      // consumer calls `close()` to drop it.
    };

    const onAbort = (): void => {
      if (closed) return;
      const err = new VoiceSessionError(
        'aborted',
        voiceSessionErrorMessage('aborted'),
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
      try {
        recognition.abort();
      } catch {
        // best-effort
      }
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
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
          // `flush()` on the webSpeech path calls
          // `recognition.stop()` (graceful) and
          // waits for `onend` to fire. The final
          // lands through `onTranscription`.
          if (closed) return;
          try {
            recognition.stop();
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
    try {
      recognition.start();
    } catch (e) {
      const err = new VoiceSessionError(
        'unsupported',
        voiceSessionErrorMessage('unsupported'),
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
      session: makeSession('webSpeech'),
      abort() {
        // Decision #4: route through the same
        // onAbort path the signal listener uses.
        onAbort();
      },
    };
    resolve(handle);
  });
}
