/**
 * wisprClient — WebSocket client for the Wispr Flow streaming
 * STT API (M2b).
 *
 * Public surface:
 *   - `transcribeViaWispr(pcm, apiKey, opts)` — the entry
 *     point the hook calls. Opens a WebSocket, sends a
 *     single `auth` message, then forwards each Int16Array
 *     chunk from `pcm` as an `append` message, then sends a
 *     `commit` and returns the final transcript text.
 *
 * The function is intentionally small. It does NOT do
 * permission flow, mic management, or session lifecycle —
 * that's the hook's job. It just owns the wire protocol.
 *
 * ## Why a function, not a class
 *
 * The M2a `voiceStore` + `useVoiceCapture` design is
 * "functionally pure, side effects via the store". A class
 * here would force the hook to instantiate one per recording
 * and reason about its lifetime; a function is "open it,
 * call it, await it, throw it away", which is the natural
 * shape for a single round-trip.
 *
 * The session is a one-shot: one auth, one stream, one
 * commit, one result. Wispr supports `final: false`
 * intermediate `text` events; we capture them but only
 * return the LAST one (with `final: true`) — Lipi's
 * Composer wants the cleaned-up final text, not the
 * partial. A future M3 streaming-partials phase can
 * promote the client to emit an `AsyncIterable` of events.
 *
 * ## Why a WebSocket constructor injection point
 *
 * The M2a tests stub audio globals on `globalThis`. Wispr
 * has its own global (`WebSocket`) that we can't easily
 * shim with `vi.stubGlobal` because TypeScript's
 * `lib.dom.d.ts` types it as a class. We accept an
 * optional `webSocketCtor` parameter and default to the
 * platform's `WebSocket`. Tests pass a mock constructor
 * that returns a fake instance with `addEventListener`,
 * `send`, `close`, and a way to fire `onmessage` /
 * `onclose` synchronously.
 *
 * ## Protocol summary
 *
 * Endpoint: `wss://platform-api.wisprflow.ai/api/v1/dash/client_ws?client_key=Bearer%20<KEY>`
 *   (per https://api-docs.wisprflow.ai/websocket_api)
 *
 * Client -> server:
 *   1. Auth frame on connect:
 *      { type: 'auth', access_token: '<apiKey>', context: {...}, language: ['en'] }
 *   2. For each PCM chunk (Int16Array, base64-encoded):
 *      { type: 'append', position: N, audio_packets: { packets: [<b64>], volumes: [<rms>], packet_duration: 0.05, audio_encoding: 'wav', byte_encoding: 'base64' } }
 *   3. When the user stops:
 *      { type: 'commit', total_packets: N }
 *
 * Server -> client (we only react to a few):
 *   - { status: 'auth' }          — authenticated
 *   - { status: 'text', body: { text, final: true|false } }
 *                                 — partial or final text
 *   - { error: '...' }            — error, connection closed
 *
 * The `position` field is the GLOBAL packet index across
 * the whole session, not per-message. So if we send 4
 * packets in the first `append`, the next `append` starts
 * at position 4.
 *
 * ## Volume calculation
 *
 * Wispr uses the per-packet `volumes` array to drive
 * silence detection and UI feedback. We compute RMS
 * (root-mean-square) over the Int16 samples, normalized
 * to [0, 1]. This matches the reference quickstart.
 */

import {
  encodeInt16AsBase64,
  PCM_CHUNK_MS,
  WISPR_SAMPLE_RATE_HZ,
} from './pcmCapture';

/** The Wispr WebSocket endpoint (with the
 *  `client_key=Bearer%20<KEY>` query param). The reference
 *  docs recommend this endpoint for "client-side auth"
 *  (vs. the server-side `?api_key=...` one). */
export const WISPR_WS_ENDPOINT = 'wss://platform-api.wisprflow.ai/api/v1/dash/client_ws';

/** Default request timeout. Wispr's typical first-final
 *  round-trip is 1-3 seconds for a 5-second utterance;
 *  30s is generous and matches typical HTTP-client
 *  timeouts. The user can stop the recording and the
 *  hook cancels the WebSocket; this timeout is a
 *  safety net for the case where the server never
 *  sends a final (e.g. the user records 30 minutes
 *  of silence). */
export const WISPR_DEFAULT_TIMEOUT_MS = 30_000;

export interface WisprClientOptions {
  /** Override the WebSocket constructor (for tests). */
  webSocketCtor?: new (url: string) => WebSocket;
  /** Override the endpoint. Defaults to the production
   *  Wispr URL. Tests may pass a dummy. */
  endpoint?: string;
  /** Timeout in ms. Defaults to 30 seconds. The timeout
   *  covers the WHOLE call (connect + auth + stream +
   *  commit + final), not individual steps. */
  timeoutMs?: number;
  /** BCP-47 language code (e.g. 'en', 'en-US'). Wispr
   *  defaults to en if omitted. */
  language?: string;
  /** App context, sent in the `auth` frame. Wispr uses
   *  this for accuracy tuning ("is this dictation for a
   *  chat? for an IDE?"). */
  appContext?: WisprAppContext;
}

export interface WisprAppContext {
  readonly name: string;
  readonly type: 'ai' | 'editor' | 'chat' | 'general';
}

/** What the user has configured in Lipi. Sent to Wispr so
 *  the server can pick the right cleanup profile (code-
 *  aware dictation, chat polish, etc.). */
export const LIPI_APP_CONTEXT: WisprAppContext = {
  name: 'Lipi',
  type: 'editor',
};

/** Pure helper: compute RMS volume over a chunk, in
 *  [0, 1]. Used to populate the `volumes` array Wispr
 *  wants. Matches the Wispr quickstart reference. */
export function rmsVolume(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  // Int16 has 16-bit range. Normalize to [-1, 1] for the
  // RMS calc, then clamp.
  for (let i = 0; i < samples.length; i++) {
    const v = (samples[i] ?? 0) / 32768;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / samples.length));
}

/**
 * Transcribe a PCM stream via Wispr Flow. The `pcm`
 * argument is an `AsyncIterable<Int16Array>` of chunks
 * (each is `PCM_CHUNK_SAMPLES` long); we forward each
 * chunk as one `append` message.
 *
 * Returns the final transcript (the last `text` message
 * with `final: true`). Throws `WisprClientError` on
 * connection failure, auth rejection, server error, or
 * timeout.
 *
 * Lifecycle: the function opens the WebSocket, drains
 * `pcm` to completion, sends the `commit`, then awaits
 * the final text. It does NOT close the WebSocket until
 * the final arrives — Wispr keeps the connection open
 * for the server-side cleanup, and closing early can
 * lose the final.
 */
export async function transcribeViaWispr(
  pcm: AsyncIterable<Int16Array>,
  apiKey: string,
  options: WisprClientOptions = {},
): Promise<string> {
  if (!apiKey) {
    throw new WisprClientError('no-api-key', 'No Wispr API key. Set one in Settings -> Voice.');
  }

  const Ctor = options.webSocketCtor ?? (typeof WebSocket !== 'undefined' ? WebSocket : undefined);
  if (typeof Ctor !== 'function') {
    throw new WisprClientError('no-websocket', 'WebSocket is not available in this environment');
  }

  const endpoint = options.endpoint ?? WISPR_WS_ENDPOINT;
  const url = `${endpoint}?client_key=Bearer%20${encodeURIComponent(apiKey)}`;
  const ws = new Ctor(url);

  const timeoutMs = options.timeoutMs ?? WISPR_DEFAULT_TIMEOUT_MS;
  const appContext = options.appContext ?? LIPI_APP_CONTEXT;
  const language = options.language ?? 'en';

  // Resolve the final text. We use a deferred promise
  // that the WS event handlers settle. If anything goes
  // wrong (auth fail, network error, server error,
  // timeout), we reject.
  let resolveFinal!: (text: string) => void;
  let rejectCall!: (err: Error) => void;
  let settled = false;
  const finalPromise = new Promise<string>((resolve, reject) => {
    resolveFinal = (text) => {
      if (settled) return;
      settled = true;
      resolve(text);
    };
    rejectCall = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
  });

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const armTimeout = (): void => {
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    timeoutHandle = setTimeout(() => {
      rejectCall(
        new WisprClientError(
          'timeout',
          `Wispr did not respond within ${timeoutMs}ms. Check your network and try again.`,
        ),
      );
      try {
        ws.close();
      } catch {
        // already closed
      }
    }, timeoutMs);
  };
  armTimeout();

  // Clean up on any termination path.
  const cleanup = (): void => {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
    try {
      ws.close();
    } catch {
      // already closed
    }
  };

  // Partial text accumulator: we keep the most recent
  // `final: true` text, falling back to the last
  // `final: false` if the user times out and we still
  // have a partial. M2b: we just return whatever final
  // the server emits.
  let latestFinal: string | null = null;
  let position = 0;

  // Wire up the WebSocket event handlers. We use the
  // addEventListener API (rather than `onopen` etc.)
  // because tests can fire multiple events on the same
  // instance — onopen is a single-slot property.
  ws.addEventListener('open', () => {
    // The first message after open is the auth frame.
    // The protocol requires it.
    try {
      ws.send(
        JSON.stringify({
          type: 'auth',
          access_token: apiKey,
          context: {
            app: appContext,
            dictionary_context: [],
          },
          language: [language],
        }),
      );
    } catch (e) {
      rejectCall(
        new WisprClientError(
          'send-failed',
          e instanceof Error ? e.message : 'Failed to send auth frame',
        ),
      );
      cleanup();
    }
  });

  ws.addEventListener('message', (event: MessageEvent) => {
    // Re-arm the timeout on any server activity — the
    // server is alive.
    armTimeout();
    let msg: unknown;
    try {
      msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
    } catch {
      // Non-JSON frame — ignore.
      return;
    }
    if (typeof msg !== 'object' || msg === null) return;
    const m = msg as Record<string, unknown>;

    if (typeof m.error === 'string') {
      rejectCall(
        new WisprClientError(
          mapServerErrorToCode(m.error),
          `Wispr error: ${m.error}`,
        ),
      );
      cleanup();
      return;
    }

    if (m.status === 'auth') {
      // Authenticated; the stream is now open. Nothing
      // to do here — the consumer-side code below will
      // start sending appends as soon as it gets the
      // first chunk.
      return;
    }

    if (m.status === 'text' && typeof m.body === 'object' && m.body !== null) {
      const body = m.body as Record<string, unknown>;
      const text = typeof body.text === 'string' ? body.text : '';
      const isFinal = body.final === true;
      if (isFinal) {
        latestFinal = text;
        resolveFinal(text);
        cleanup();
      } else {
        // Partial. We don't surface it to the caller
        // (the Composer wants the final), but we keep
        // it as a fallback in case the commit is never
        // answered.
        latestFinal = text;
      }
    }
  });

  ws.addEventListener('error', () => {
    // The `error` event doesn't carry a message; the
    // `close` event always follows with the reason.
    rejectCall(new WisprClientError('network', 'WebSocket error talking to Wispr.'));
    cleanup();
  });

  ws.addEventListener('close', (event: CloseEvent) => {
    if (!event.wasClean && latestFinal === null) {
      rejectCall(
        new WisprClientError(
          'connection-closed',
          `Wispr connection closed (code ${event.code}). Check the WebSocket URL and your network.`,
        ),
      );
    } else if (latestFinal === null) {
      // Closed cleanly but we never got a final. Use
      // the last partial if any.
      resolveFinal('');
    }
    cleanup();
  });

  // Start streaming chunks. The iterator's next() blocks
  // until a chunk is available; we send one append per
  // chunk, tracking the GLOBAL packet position.
  try {
    for await (const chunk of pcm) {
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
    // Iterator ended — the user stopped the recording.
    // Send the commit. The server will reply with one
    // final `text` message.
    if (ws.readyState === ws.OPEN || ws.readyState === 1 /* legacy */) {
      ws.send(
        JSON.stringify({
          type: 'commit',
          total_packets: position,
        }),
      );
    }
  } catch (e) {
    rejectCall(
      new WisprClientError(
        'stream-failed',
        e instanceof Error ? e.message : 'Audio stream failed',
      ),
    );
    cleanup();
  }

  // Wait for the final (or rejection). The promise was
  // resolved by the message handler on `final: true`,
  // OR by the close handler if the server never sent
  // one.
  return finalPromise;
}

/** Convert a server-supplied error string to a stable code. */
function mapServerErrorToCode(message: string): WisprClientErrorCode {
  const m = message.toLowerCase();
  if (m.includes('auth') || m.includes('unauthorized') || m.includes('api key')) {
    return 'auth-rejected';
  }
  if (m.includes('rate') || m.includes('quota') || m.includes('limit')) {
    return 'rate-limited';
  }
  if (m.includes('audio') || m.includes('encoding')) {
    return 'bad-audio';
  }
  return 'server-error';
}

/** Stable error codes the hook can switch on. */
export type WisprClientErrorCode =
  | 'no-api-key'
  | 'no-websocket'
  | 'timeout'
  | 'network'
  | 'auth-rejected'
  | 'rate-limited'
  | 'bad-audio'
  | 'server-error'
  | 'connection-closed'
  | 'stream-failed'
  | 'send-failed';

export class WisprClientError extends Error {
  readonly code: WisprClientErrorCode;
  constructor(code: WisprClientErrorCode, message: string) {
    super(message);
    this.name = 'WisprClientError';
    this.code = code;
  }
}

/** User-facing message for a WisprClientError. Pure for tests. */
export function wisprErrorMessage(code: WisprClientErrorCode): string {
  switch (code) {
    case 'no-api-key':
      return 'No Wispr API key. Set one in Settings -> Voice to enable voice input.';
    case 'no-websocket':
      return 'WebSocket is not available in this environment.';
    case 'timeout':
      return 'Wispr did not respond in time. Check your network and try again.';
    case 'network':
    case 'connection-closed':
      return 'Could not reach Wispr. Check your network connection and try again.';
    case 'auth-rejected':
      return 'Wispr rejected the API key. Check it in Settings -> Voice.';
    case 'rate-limited':
      return 'Wispr rate limit hit. Wait a moment and try again.';
    case 'bad-audio':
      return 'Wispr could not transcribe the audio. Try a quieter environment.';
    case 'server-error':
    case 'stream-failed':
    case 'send-failed':
    default:
      return 'Wispr transcription failed. Try again.';
  }
}

// Suppress the unused-export warning for sample-rate;
// the constant is part of the public API but the
// streaming path doesn't reference it directly (the
// hook uses it for its own state).
void WISPR_SAMPLE_RATE_HZ;
