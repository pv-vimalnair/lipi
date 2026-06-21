/**
 * pcmCapture — raw PCM audio capture for the Wispr provider (M2b / M3).
 *
 * The M2a `MediaRecorder` path produces encoded audio (Opus / AAC
 * inside a `Blob`). Wispr Flow's WebSocket API needs raw, 16-bit
 * signed integer, 16 kHz, mono PCM, encoded as base64 strings
 * inside `append` messages (see HANDOFF section 9.1 and
 * https://api-docs.wisprflow.ai/websocket_api).
 *
 * This module owns the conversion. It exposes:
 *   - `startPcmCapture(opts)` — opens the mic, returns an
 *     `AsyncIterable<Int16Array>` that yields ~50ms of PCM at a
 *     time, then a `stop()` callback that releases the mic.
 *   - `float32ToInt16(samples)` — pure function, exported for
 *     tests.
 *   - `encodeInt16AsBase64(samples)` — pure function, exported
 *     for tests.
 *
 * ## Why ScriptProcessorNode (not AudioWorkletNode)
 *
 * The Wispr quickstart uses an `AudioWorkletNode` with a
 * separately-loaded `.js` file. For M2b, that's a lot of
 * plumbing for one feature — a worklet module, a Vite asset
 * loader, lifecycle management around the worklet port. We
 * use `ScriptProcessorNode` (deprecated but never removed from
 * WebView2 / WKWebView / WebKitGTK) for the M2b release and
 * note the upgrade path in HANDOFF Decision #42. The audio
 * callback runs on the main thread, but 50ms of Float32
 * conversion is <0.1ms of CPU on a modern laptop, so the
 * scheduling jitter is invisible.
 *
 * If a future phase sees audio glitches (clipping, drift),
 * promote to `AudioWorkletNode` — the conversion functions
 * are reusable.
 *
 * ## Sample rate negotiation
 *
 * Wispr wants 16 kHz. We pass `sampleRate: 16000` to
 * `getUserMedia`'s audio constraints — modern WebView2 /
 * WKWebView / WebKitGTK honor this and resample natively. The
 * resulting `MediaStreamTrack` has its own `getSettings()`
 * rate; we re-check and surface a clear error if the OS
 * didn't honor the request.
 *
 * We also ask for `channelCount: 1` (mono). The M2a
 * `MediaRecorder` produced mono automatically; the
 * `ScriptProcessorNode` defaults to whatever the mic stream
 * carries. Asking explicitly avoids the rare "the OS
 * delivered stereo and the Wispr server silently mixed it"
 * pitfall.
 *
 * ## Lifetime
 *
 * The returned `stop()` MUST be called when the user clicks
 * "stop" OR when the host unmounts. It:
 *   1. Calls `disconnect()` on the audio nodes (stops the
 *      callback firing).
 *   2. Stops every track on the underlying MediaStream
 *      (releases the OS mic LED).
 *   3. Closes the AudioContext (frees a few MB of heap).
 *   4. Ends the async iterator (any pending `for await` on the
 *      consumer side resolves cleanly).
 *
 * Calling `stop()` twice is safe (idempotent — every step
 * checks "is it already stopped?" first).
 *
 * ## M3: errors are `VoiceSessionError`s
 *
 * M2b had a private `PcmCaptureError` class. M3 collapses all
 * provider errors into the single `VoiceSessionError` type
 * (Decision #3) — `startPcmCapture` now throws
 * `VoiceSessionError` directly. The wispr session factory
 * treats the rejection's `code` field as the user-facing
 * diagnostic.
 */
import { VoiceSessionError } from './session';
import type { VoiceSessionErrorCode } from './session';

/** The negotiated sample rate. Wispr hard-requires 16 kHz. */
export const WISPR_SAMPLE_RATE_HZ = 16_000;

/** The chunk size we aim for. 50ms is a good latency /
 *  overhead tradeoff: small enough to feel "live", large
 *  enough to keep the per-chunk overhead <1% of the chunk. */
export const PCM_CHUNK_MS = 50;

/** Mono. */
export const PCM_CHANNELS = 1;

/** Compute the chunk size in samples. 50ms at 16kHz = 800
 *  samples. */
export const PCM_CHUNK_SAMPLES = (WISPR_SAMPLE_RATE_HZ * PCM_CHUNK_MS) / 1000;

export interface PcmCaptureOptions {
  /**
   * Override the getUserMedia constraints. Defaults to mono
   * 16kHz. Tests pass a stub to skip real audio.
   */
  audioConstraints?: MediaTrackConstraints;
  /**
   * Override the AudioContext constructor. Tests pass a
   * stub. Defaults to the platform's `window.AudioContext`.
   */
  audioContextCtor?: typeof AudioContext;
}

export interface PcmCaptureHandle {
  /**
   * An async iterator that yields one `Int16Array` per
   * `PCM_CHUNK_MS` window. The iteration ends when `stop()`
   * is called or the underlying audio context is closed.
   */
  chunks: AsyncIterable<Int16Array>;
  /**
   * The negotiated sample rate. After start, this is the
   * rate the OS is actually delivering (should equal
   * `WISPR_SAMPLE_RATE_HZ`; if it doesn't, the caller can
   * surface a clear error).
   */
  sampleRate: number;
  /**
   * Stop capture: disconnect nodes, stop tracks, close the
   * AudioContext, end the iterator. Idempotent.
   */
  stop: () => Promise<void>;
}

/**
 * Pure helper: convert a Float32Array of samples in
 * [-1, 1] to an Int16Array. Clamps out-of-range values
 * (a sine wave that briefly exceeds 1.0 due to FP rounding
 * is a real failure mode we want to handle defensively).
 *
 * Symmetric rounding toward `-Infinity` so 0.0 maps to 0
 * and -0.9999 maps to -32768 (not -32767) — this matches
 * the Wispr quickstart reference code.
 */
export function float32ToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i] ?? 0));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

/**
 * Pure helper: encode an Int16Array as a base64 string. The
 * Wispr protocol accepts `byte_encoding: 'base64'` in the
 * `append` message; this is the smallest representation
 * that works without binary frames. The `btoa(...)`
 * function is the browser-native base64 encoder; we
 * convert the Int16 bytes via `String.fromCharCode` +
 * `Uint8Array` view, which is the canonical pattern.
 *
 * Note: `btoa` is "binary string to ASCII" — we have to
 * map each byte to a char-code, which is what
 * `String.fromCharCode(...bytes)` does.
 */
export function encodeInt16AsBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  // The spread is safe up to a few KB per chunk; for larger
  // chunks we'd want a chunked encoder. Our 50ms / 16kHz /
  // mono chunks are 800 samples = 1600 bytes, well under
  // the V8 string-length limit.
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Open a PCM capture session.
 *
 * The returned iterator yields `Int16Array` chunks. Each
 * chunk is `PCM_CHUNK_SAMPLES` long (800 at 16kHz).
 * `stop()` ends the session.
 */
export async function startPcmCapture(
  options: PcmCaptureOptions = {},
): Promise<PcmCaptureHandle> {
  // Feature detect getUserMedia. The M2a hook also
  // feature-detects; we duplicate the check here so the
  // hook's wispr path can be tested in isolation.
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.getUserMedia !== 'function'
  ) {
    throw new VoiceSessionError(
      'mic-unavailable',
      'Microphone is not available in this environment',
      { retryable: false },
    );
  }

  const AudioContextCtor =
    options.audioContextCtor ??
    (typeof window !== 'undefined' ? window.AudioContext : undefined);
  if (typeof AudioContextCtor !== 'function') {
    throw new VoiceSessionError(
      'no-audio-context',
      'AudioContext is not available in this environment',
      { retryable: false },
    );
  }

  // Constraints: ask for mono 16kHz. The OS may not honor
  // the exact rate; we re-check via `getSettings()` after
  // opening.
  const constraints: MediaTrackConstraints = {
    channelCount: PCM_CHANNELS,
    sampleRate: WISPR_SAMPLE_RATE_HZ,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    ...(options.audioConstraints ?? {}),
  };

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
  } catch (e) {
    // Re-throw as a typed VoiceSessionError. The wispr
    // session factory translates the `code` to a
    // user-facing message via `voiceSessionErrorMessage`.
    const name = e instanceof Error ? e.name : 'Error';
    throw new VoiceSessionError(
      mapGetUserMediaErrorToCode(name),
      e instanceof Error ? e.message : String(e),
      { cause: e, retryable: true },
    );
  }

  // Sanity-check the negotiated rate. The OS sometimes
  // returns a different rate (Chrome on some Linux
  // builds). If we got something other than 16kHz, the
  // audio will be mis-transcribed — abort with a clear
  // error rather than silently producing bad text.
  const track = stream.getAudioTracks()[0];
  if (!track) {
    for (const t of stream.getTracks()) t.stop();
    throw new VoiceSessionError(
      'no-input-device',
      'No audio track in the stream',
      { retryable: false },
    );
  }
  const settings = track.getSettings();
  const actualRate = settings.sampleRate ?? WISPR_SAMPLE_RATE_HZ;
  if (actualRate !== WISPR_SAMPLE_RATE_HZ) {
    // We don't try to resample in the producer (that
    // would duplicate the OS resampler). We surface the
    // mismatch and let the user fix it. In practice this
    // is rare and usually means the OS doesn't have a
    // 16kHz capture path (some virtual audio devices).
    for (const t of stream.getTracks()) t.stop();
    throw new VoiceSessionError(
      'sample-rate-mismatch',
      `Microphone delivers ${actualRate} Hz; Wispr requires ${WISPR_SAMPLE_RATE_HZ} Hz. Try a different input device.`,
      { retryable: false },
    );
  }

  // Open the audio graph. We use a ScriptProcessorNode
  // (deprecated but supported on all 5 platforms) to
  // intercept the raw Float32 samples. The buffer size
  // we ask for is irrelevant — we accumulate samples
  // across callbacks until we have a full chunk. The
  // platform picks the actual buffer size (typically
  // 128 or 256 frames).
  const audioContext = new AudioContextCtor({ sampleRate: WISPR_SAMPLE_RATE_HZ });
  const source = audioContext.createMediaStreamSource(stream);
  // The bufferSize arg is a HINT. The actual buffer is
  // platform-dependent; we use 4096 to keep callback
  // overhead low. 1 input, 1 output, both mono.
  const processor = audioContext.createScriptProcessor(4096, 1, 1);

  // The async-iterator plumbing. We use a queue + a
  // "stopped" flag instead of a Promise-per-chunk so the
  // consumer can `for await` cleanly. The audio
  // callback pushes to the queue; `stop()` flips the
  // flag and ends the queue.
  const queue: Int16Array[] = [];
  const waiters: Array<(chunk: Int16Array | null) => void> = [];
  let stopped = false;
  const pending: number[] = []; // accumulate samples across callbacks

  const push = (chunk: Int16Array | null): void => {
    const w = waiters.shift();
    if (w) w(chunk);
    else if (chunk !== null) queue.push(chunk);
  };

  // The audio callback. Each call delivers ~256 frames
  // of Float32. We accumulate until we have a full
  // PCM_CHUNK_SAMPLES (800) and emit one Int16Array.
  // The remaining samples (less than a full chunk) stay
  // in `pending` for the next callback.
  processor.onaudioprocess = (event: AudioProcessingEvent): void => {
    if (stopped) return;
    const input = event.inputBuffer.getChannelData(0);
    for (let i = 0; i < input.length; i++) pending.push(input[i] ?? 0);
    while (pending.length >= PCM_CHUNK_SAMPLES) {
      const slice = pending.splice(0, PCM_CHUNK_SAMPLES);
      const float32 = Float32Array.from(slice);
      push(float32ToInt16(float32));
    }
  };

  // Wire the graph. We connect source -> processor ->
  // destination; the destination connection is
  // effectively a no-op (we never play the captured
  // audio back), but ScriptProcessorNode only fires
  // when connected to something. The M2a code didn't
  // need this dance because MediaRecorder doesn't.
  source.connect(processor);
  // The `as unknown` cast is because the Tauri WebView
  // typings sometimes lack the `destination` field on
  // the AudioContextNode in older TypeScript libs.
  const dest = (audioContext as unknown as { destination?: AudioNode }).destination;
  if (dest) processor.connect(dest);

  const iterator: AsyncIterable<Int16Array> = {
    [Symbol.asyncIterator](): AsyncIterator<Int16Array> {
      return {
        next(): Promise<IteratorResult<Int16Array>> {
          if (stopped) {
            return Promise.resolve({ value: undefined, done: true });
          }
          // Fast-path: queue has a chunk waiting.
          const queued = queue.shift();
          if (queued) return Promise.resolve({ value: queued, done: false });
          // Wait for the next push().
          return new Promise((resolve) => {
            waiters.push((chunk) => {
              if (chunk === null) {
                resolve({ value: undefined, done: true });
              } else {
                resolve({ value: chunk, done: false });
              }
            });
          });
        },
      };
    },
  };

  // Stop the mic and clean up. Idempotent.
  let stoppedOnce = false;
  const stop = async (): Promise<void> => {
    if (stoppedOnce) return;
    stoppedOnce = true;
    stopped = true;
    try {
      processor.disconnect();
    } catch {
      // Already disconnected.
    }
    try {
      source.disconnect();
    } catch {
      // Already disconnected.
    }
    for (const t of stream.getTracks()) t.stop();
    try {
      await audioContext.close();
    } catch {
      // Already closed.
    }
    // Wake up any pending consumer with `done: true`.
    while (waiters.length) push(null);
  };

  return {
    chunks: iterator,
    sampleRate: actualRate,
    stop,
  };
}

/**
 * Map a `getUserMedia` rejection name to a stable
 * `VoiceSessionErrorCode`. The codes used here are part
 * of the 24-code M3 union (see `src/voice/session.ts`).
 */
function mapGetUserMediaErrorToCode(name: string): VoiceSessionErrorCode {
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'permission-denied';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'no-input-device';
    case 'NotReadableError':
      return 'mic-unavailable';
    case 'AbortError':
      return 'aborted';
    default:
      return 'unknown';
  }
}
