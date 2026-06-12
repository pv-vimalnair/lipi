/**
 * wisprSession — M3 `VoiceSession` factory for the `'wispr'`
 * provider (M2b).
 *
 * Owns the raw PCM capture pipeline (via `startPcmCapture`)
 * AND the Wispr Flow WebSocket protocol (auth → append
 * chunks → commit → await final). The M2b hook was the
 * only consumer of the `transcribeViaWispr` function —
 * M3 folds both into a single `VoiceSession`.
 *
 * What changed from M2b:
 *   - The wire protocol (the `auth` / `append` / `commit`
 *     frames, the per-packet RMS, the `text` / `error` /
 *     `close` event handling) moved IN-HOUSE. The M2b
 *     `wisprClient.ts` file is deleted.
 *   - The session emits `starting → listening → stopping
 *     → finalizing → closed` in that order, matching the
 *     M3 7-state machine.
 *   - Cancellation: the consumer's `handle.abort()` (or
 *     the AbortSignal) closes the WebSocket and ends the
 *     PCM iterator. The next `onmessage` is a no-op (the
 *     `closed` guard).
 *   - Errors map to `VoiceSessionErrorCode` (the M2b
 *     `WisprClientErrorCode` union is gone).
 *
 * Protocol reference: see
 * `docs/decisions/0044-wispr-integration.md` §"Protocol"
 * and https://api-docs.wisprflow.ai/websocket_api.
 */
import { voiceSessionErrorMessage, VoiceSessionError } from '../session';
import type {
  VoiceSession,
  VoiceSessionErrorCode,
  VoiceSessionHandle,
} from '../session';
import type { TranscriptionEvent, VoiceProviderId } from '../types';
import type { VoiceSessionFactoryOptions } from '../sessionFactory';
import {
  encodeInt16AsBase64,
  PCM_CHUNK_MS,
  startPcmCapture,
  WISPR_SAMPLE_RATE_HZ,
  type PcmCaptureHandle,
} from '../pcmCapture';

export const WISPR_WS_ENDPOINT = 'wss://platform-api.wisprflow.ai/api/v1/dash/client_ws';
export const WISPR_DEFAULT_TIMEOUT_MS = 30_000;
const LIPI_APP_CONTEXT = { name: 'Lipi', type: 'editor' as const };

function rmsVolume(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = (samples[i] ?? 0) / 32768;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / samples.length));
}

/** Convert a server-supplied error string to a stable
 *  M3 `VoiceSessionErrorCode`. The server is a black box —
 *  the string match covers the four common cases
 *  documented in the Wispr API; anything else falls
 *  through to `'network'` (most server errors are
 *  network-related from the JS side's POV). */
function mapServerErrorToCode(message: string): VoiceSessionErrorCode {
  const m = message.toLowerCase();
  if (m.includes('auth') || m.includes('unauthorized') || m.includes('api key')) {
    return 'auth';
  }
  if (m.includes('rate') || m.includes('quota') || m.includes('limit')) {
    return 'rate-limited';
  }
  if (m.includes('audio') || m.includes('encoding')) {
    return 'bad-audio';
  }
  return 'network';
}

export function createWisprSession(
  opts: VoiceSessionFactoryOptions,
): Promise<VoiceSessionHandle> {
  return new Promise<VoiceSessionHandle>(async (resolve, reject) => {
    // Refuse to start if the AbortSignal is already fired.
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

    const apiKey = opts.config?.wisprApiKey;
    if (!apiKey) {
      reject(
        new VoiceSessionError(
          'auth',
          'No Wispr API key. Set one in Settings → Voice to enable voice input.',
          { retryable: false },
        ),
      );
      return;
    }

    const Ctor =
      opts.webSocketCtor ??
      (typeof WebSocket !== 'undefined' ? WebSocket : undefined);
    if (typeof Ctor !== 'function') {
      reject(
        new VoiceSessionError(
          'no-webspeech',
          'WebSocket is not available in this environment',
          { retryable: false },
        ),
      );
      return;
    }

    const url = `${WISPR_WS_ENDPOINT}?client_key=Bearer%20${encodeURIComponent(apiKey)}`;
    const ws = new Ctor(url);
    const language = opts.language ?? 'en';

    let state: 'idle' | 'starting' | 'listening' | 'stopping' | 'finalizing' | 'closed' | 'error' = 'idle';
    const stateListeners = new Set<(s: typeof state) => void>();
    const transcriptionListeners = new Set<(e: TranscriptionEvent) => void>();
    const errorListeners = new Set<(err: VoiceSessionError) => void>();
    let closed = false;
    let pcmHandle: PcmCaptureHandle | null = null;
    let streamDone = false;
    let position = 0;
    let sequence = 0;
    let latestText = '';
    let armHandle: ReturnType<typeof setTimeout> | null = null;
    let sessionId = `wispr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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
      }, WISPR_DEFAULT_TIMEOUT_MS);
    };

    const cleanup = (): void => {
      if (armHandle !== null) {
        clearTimeout(armHandle);
        armHandle = null;
      }
      try {
        ws.close();
      } catch {
        // already closed
      }
    };

    // Open the PCM capture pipeline.
    try {
      setState('starting');
      pcmHandle = await startPcmCapture();
      if (pcmHandle.sampleRate !== WISPR_SAMPLE_RATE_HZ) {
        const err = new VoiceSessionError(
          'sample-rate-mismatch',
          voiceSessionErrorMessage('sample-rate-mismatch'),
        );
        setState('error');
        emitError(err);
        await pcmHandle.stop();
        pcmHandle = null;
        return;
      }
    } catch (e) {
      const message =
        e instanceof Error ? e.message : 'Failed to start the microphone';
      const err = new VoiceSessionError(
        'mic-unavailable',
        message,
        { cause: e, retryable: true },
      );
      setState('error');
      emitError(err);
      reject(err);
      return;
    }

    if (opts.signal.aborted) {
      await pcmHandle.stop();
      pcmHandle = null;
      reject(
        new VoiceSessionError(
          'aborted',
          voiceSessionErrorMessage('aborted'),
          { cause: opts.signal.reason, retryable: false },
        ),
      );
      return;
    }

    setState('listening');
    armTimeout();

    // The session aborts when the signal fires.
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

    // Wire the WebSocket events. We use the
    // addEventListener API (rather than `onopen` etc.)
    // so the test fake can fire multiple events.
    ws.addEventListener('open', () => {
      if (closed) return;
      try {
        ws.send(
          JSON.stringify({
            type: 'auth',
            access_token: apiKey,
            context: {
              app: LIPI_APP_CONTEXT,
              dictionary_context: [],
            },
            language: [language],
          }),
        );
      } catch (e) {
        const err = new VoiceSessionError(
          'start-failed',
          e instanceof Error ? e.message : 'Failed to send auth frame',
          { cause: e, retryable: true },
        );
        setState('error');
        emitError(err);
        void close();
      }
    });

    ws.addEventListener('message', (event) => {
      if (closed) return;
      armTimeout();
      let msg: unknown;
      try {
        msg = JSON.parse(
          typeof event.data === 'string' ? event.data : String(event.data),
        );
      } catch {
        return;
      }
      if (typeof msg !== 'object' || msg === null) return;
      const m = msg as Record<string, unknown>;

      if (typeof m.error === 'string') {
        const code = mapServerErrorToCode(m.error);
        const err = new VoiceSessionError(
          code,
          voiceSessionErrorMessage(code),
        );
        setState('error');
        emitError(err);
        void close();
        return;
      }

      if (m.status === 'auth') {
        return;
      }

      if (
        m.status === 'text' &&
        typeof m.body === 'object' &&
        m.body !== null
      ) {
        const body = m.body as Record<string, unknown>;
        const text = typeof body.text === 'string' ? body.text : '';
        const isFinal = body.final === true;
        if (isFinal) {
          latestText = text;
          setState('stopping');
          setState('finalizing');
          emitTranscription({
            kind: 'final',
            text,
            sequence: ++sequence,
            timestamp: Date.now(),
            isUtteranceEnd: true,
            sessionId,
          });
          cleanup();
        } else {
          // Partial — keep the latest as fallback. The
          // session's hook will see a `partial` event
          // (M3 surfaces them through `onTranscription`).
          latestText = text;
          emitTranscription({
            kind: 'partial',
            text,
            sequence: ++sequence,
            timestamp: Date.now(),
            sessionId,
          });
        }
      }
    });

    ws.addEventListener('error', () => {
      if (closed) return;
      const err = new VoiceSessionError(
        'network',
        voiceSessionErrorMessage('network'),
      );
      setState('error');
      emitError(err);
      void close();
    });

    ws.addEventListener('close', (event) => {
      if (closed) return;
      if (!event.wasClean && latestText === '') {
        const err = new VoiceSessionError(
          'network',
          `Wispr connection closed (code ${event.code}). Check the WebSocket URL and your network.`,
        );
        setState('error');
        emitError(err);
      } else if (latestText === '') {
        // Closed cleanly but we never got a final.
        setState('stopping');
        setState('finalizing');
        emitTranscription({
          kind: 'final',
          text: '',
          sequence: ++sequence,
          timestamp: Date.now(),
          isUtteranceEnd: true,
          sessionId,
        });
      }
      cleanup();
    });

    // Stream chunks. The async iterator ends when
    // `pcmHandle.stop()` is called (by the consumer
    // or by the abort path).
    let close: () => Promise<void> = async () => {
      // no-op until we bind the real implementation
    };
    void (async (): Promise<void> => {
      try {
        if (!pcmHandle) return;
        for await (const chunk of pcmHandle.chunks) {
          if (closed || streamDone) return;
          if (ws.readyState !== ws.OPEN && ws.readyState !== 1) return;
          const base64 = encodeInt16AsBase64(chunk);
          const volume = rmsVolume(chunk);
          ws.send(
            JSON.stringify({
              type: 'append',
              position,
              audio_packets: {
                packets: [base64],
                volumes: [volume],
                packet_duration: PCM_CHUNK_MS / 1000,
                audio_encoding: 'wav',
                byte_encoding: 'base64',
              },
            }),
          );
          position++;
        }
        // The iterator ended — the consumer stopped.
        if (closed) return;
        if (ws.readyState === ws.OPEN || ws.readyState === 1) {
          ws.send(
            JSON.stringify({
              type: 'commit',
              total_packets: position,
            }),
          );
        }
      } catch (e) {
        if (closed) return;
        const err = new VoiceSessionError(
          'bad-audio',
          e instanceof Error ? e.message : 'Audio stream failed',
          { cause: e, retryable: true },
        );
        setState('error');
        emitError(err);
        void close();
      }
    })();

    close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      streamDone = true;
      cleanup();
      if (pcmHandle) {
        try {
          await pcmHandle.stop();
        } catch {
          // best-effort
        }
        pcmHandle = null;
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
          // Wispr supports `commit`; we treat `flush()` as
          // a forced commit. Send the commit frame and wait
          // for the final.
          if (closed) return;
          if (ws.readyState === ws.OPEN || ws.readyState === 1) {
            ws.send(
              JSON.stringify({
                type: 'commit',
                total_packets: position,
              }),
            );
          }
          // Wait for the final to land through
          // `onTranscription`. We poll the latestText
          // ref until it changes (the message handler
          // will set it + emit).
          await new Promise<void>((res) => {
            const check = (): void => {
              if (closed) {
                res();
                return;
              }
              // The `finalizing` state is set inside
              // the message handler; we wait one more
              // microtask for the listener to fire.
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

    const handle: VoiceSessionHandle = {
      session: makeSession('wispr'),
      abort() {
        // Decision #4: route through the same
        // onAbort path the signal listener uses.
        // We don't synthesise an Event (jsdom's
        // AbortSignal.dispatchEvent is strict
        // about the AbortEvent type).
        onAbort();
      },
    };
    resolve(handle);
  });
}
