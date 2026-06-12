/**
 * useVoiceCapture — M2a capture pipeline + M2b Wispr STT.
 *
 * Owns the `getUserMedia` + `MediaRecorder` / PCM
 * lifecycle and drives the voiceStore. Returns a small
 * imperative API (`start`, `stop`, `isActive`) that the
 * Composer (or any other mic surface) can call from its
 * onClick.
 *
 * Two STT provider paths:
 *   - `'stub'` (M2a): the MediaRecorder produces a
 *     `Blob`, the hook's transcribe stub returns a
 *     recognisable placeholder string after a 200ms
 *     sleep. Used for plumbing verification and as a
 *     debug fallback toggleable via the Command Palette.
 *   - `'wispr'` (M2b): the hook opens a raw PCM
 *     pipeline (`MediaStreamAudioSourceNode` +
 *     `ScriptProcessorNode` → 16kHz mono Int16) and
 *     streams the chunks to the Wispr Flow WebSocket
 *     (see `src/voice/wisprClient.ts`). The final
 *     transcript is returned when the user stops the
 *     recording and Wispr sends the `final: true`
 *     `text` frame.
 *   - `'ondevice'` (M2c, not yet implemented): throws
 *     a clear "not yet wired" error.
 *
 * What this hook does NOT do:
 *   - Audio waveform / VU meter. The button shows a
 *     pulsing red dot + the duration; we don't render
 *     a frequency canvas. That's a later phase.
 *   - Recording persistence. The blob / PCM stream is
 *     held in memory for the duration of the
 *     `transcribing` step and then dropped.
 *
 * Permission flow:
 *   - `navigator.mediaDevices.getUserMedia({ audio: ... })`
 *     triggers the WebView's permission prompt. On
 *     Windows it's a system-level WebView2 dialog;
 *     on macOS it's an in-app NSMicrophoneUsageDescription
 *     prompt; on Linux GTK it's the WebKitGTK permission
 *     dialog. The user has to accept once per app
 *     install; subsequent calls reuse the grant.
 *   - If the user denies, `getUserMedia` rejects with
 *     `NotAllowedError`. We catch that, set the store
 *     status to `'error'`, and surface a user-facing
 *     message ("Microphone access was blocked — enable
 *     it in the OS privacy settings").
 *
 * Wispr-key flow (M2b):
 *   - The Wispr API key is stored in the OS keychain
 *     (same path as AI provider keys, Decision #41).
 *   - On `start()` with `provider: 'wispr'`, the hook
 *     calls `secretsGetApiKey('wispr')`. If the key is
 *     missing, the store flips to `error` with "No
 *     Wispr API key — set one in Settings → Voice".
 *   - The key is held in a local variable for the
 *     duration of the recording, then dropped on
 *     `stop()` / unmount. It is never logged, never
 *     sent to any URL other than the Wispr WebSocket
 *     endpoint, never persisted to localStorage.
 *
 * Test escape hatch:
 *   - The hook imports `getUserMedia` / `MediaRecorder`
 *     from globals (`navigator.mediaDevices.*`,
 *     `window.MediaRecorder`). The M2a test file
 *     mocks these via `vi.stubGlobal` so we can
 *     simulate success / denial / no-device without
 *     a real mic.
 *   - The M2b tests additionally stub
 *     `secretsGetApiKey` and the Wispr WS client
 *     (`@/voice/wisprClient`).
 *
 * Why a hook and not a class:
 *   - The mic is opened/closed at the React level (the
 *     Composer owns the toggle button). Hooks are the
 *     natural place for "open on mount, close on
 *     unmount" lifecycles.
 *   - We need `useEffect` cleanup to release the
 *     MediaStream tracks on unmount (otherwise the OS
 *     keeps the mic LED on after the panel closes).
 */

import { useCallback, useEffect, useRef } from 'react';
import {
  formatDuration,
  useVoiceStore,
  voiceSelectors,
} from '@/shared/state/voiceStore';
import {
  pcmCaptureErrorMessage,
  PcmCaptureError,
  startPcmCapture,
  transcribeViaWispr,
  type PcmCaptureHandle,
  WisprClientError,
  wisprErrorMessage,
} from '@/voice';
import { secretsGetApiKey } from '@/ipc';

export interface UseVoiceCaptureOptions {
  /**
   * The STT provider. M2a is hard-wired to 'stub'.
   * M2b will pass 'wispr' (and the relevant config
   * via `providerOptions`); M2c will pass
   * 'ondevice' (and pick the platform's engine).
   * For M2a we accept the option so the test file
   * can verify the path is plumbed through, but we
   * only implement the 'stub' branch.
   */
  provider?: 'stub' | 'wispr' | 'ondevice';
}

export interface UseVoiceCaptureResult {
  /** True while the user is being prompted for mic
   *  permission OR the mic is open. The button shows
   *  a spinner in this state and ignores clicks. */
  isActive: boolean;
  /** Imperative: start a new recording. Resolves when
   *  permission is granted and the MediaRecorder is
   *  open. Rejects (via the store's `error` field) if
   *  permission is denied or the device is busy. */
  start: () => Promise<void>;
  /** Imperative: stop the current recording. The
   *  hook then runs the STT step (M2a: stub; M2b/c:
   *  real) and the store's `transcript` field is
   *  populated when the call returns. */
  stop: () => Promise<void>;
  /** The current state of the pipeline (read from the
   *  store). Re-renders the caller when it changes. */
  status: ReturnType<typeof voiceSelectors.status>;
  /** Elapsed ms since the current recording started. */
  durationMs: number;
  /** Last user-facing error message, or null. */
  lastError: string | null;
  /** Human-readable duration ("0:05", "1:23") for the
   *  mic button label. */
  durationLabel: string;
}

const M2A_STUB_TRANSCRIBE_DELAY_MS = 200;

export function useVoiceCapture(
  options: UseVoiceCaptureOptions = {},
): UseVoiceCaptureResult {
  const { provider = 'stub' } = options;

  const status = useVoiceStore(voiceSelectors.status);
  const durationMs = useVoiceStore(voiceSelectors.durationMs);
  const lastError = useVoiceStore(voiceSelectors.lastError);

  // Refs hold the live objects that shouldn't trigger a
  // re-render when they change. The React state is in
  // the store; these are the "private" state.
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  // M2b: the PCM capture handle for the wispr path.
  const pcmHandleRef = useRef<PcmCaptureHandle | null>(null);
  // The Wispr API key is fetched from the keychain on
  // start() and dropped on stop() / unmount.
  // It never leaves this ref.
  const wisprKeyRef = useRef<string | null>(null);
  const startedAtRef = useRef<number>(0);
  // Tracks the animation frame id so we can cancel it
  // on stop / unmount. The durationMs counter ticks
  // every animation frame, not every 1s, so the user
  // sees a smooth "0:00 -> 0:01" transition.
  const rafIdRef = useRef<number | null>(null);
  // A guard that prevents a stale `stop()` from a
  // previous recording from clobbering the new
  // recording's state. Without this, an unmount-mid-
  // recording leaves a promise that, when it resolves
  // (M2a: 200ms later), writes to the store and flips
  // the new recording into "transcribing". A simple
  // generation counter increments on every `start()`
  // and the in-flight stop check matches against it.
  const generationRef = useRef(0);

  const tickDuration = useCallback(() => {
    useVoiceStore.getState().setDurationMs(Date.now() - startedAtRef.current);
    rafIdRef.current = requestAnimationFrame(tickDuration);
  }, []);

  // Cleanup: stop the mic + cancel the rAF + drop the
  // Wispr key when the host unmounts (Composer unmounts
  // when the user switches screens). Without this the
  // OS mic LED stays on AND the key stays in memory.
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try {
          recorderRef.current.stop();
        } catch {
          // The recorder can throw if it was never
          // started (e.g. permission denied before we
          // got here). We swallow — the cleanup
          // is best-effort.
        }
      }
      if (pcmHandleRef.current) {
        void pcmHandleRef.current.stop();
        pcmHandleRef.current = null;
      }
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) {
          track.stop();
        }
        streamRef.current = null;
      }
      // Drop the Wispr key on unmount. It is NEVER
      // re-read by a future start() — start() always
      // re-fetches from the keychain.
      wisprKeyRef.current = null;
    };
  }, []);

  const start = useCallback(async (): Promise<void> => {
    const currentStatus = useVoiceStore.getState().status;
    if (currentStatus === 'recording' || currentStatus === 'requesting') {
      // Idempotent: a double-click on the button
      // doesn't open two mics. We return without
      // changing state.
      return;
    }
    // New recording — bump the generation so any
    // in-flight stop from a previous recording
    // becomes a no-op.
    const generation = ++generationRef.current;

    // Reset the store to a clean "requesting" state.
    // Clearing `transcript` means a stale transcript
    // from a previous send (or a never-sent one) is
    // gone the moment the user starts a new take.
    useVoiceStore.setState({
      status: 'requesting',
      durationMs: 0,
      transcript: '',
      lastError: null,
    });

    // Branch on provider. The two paths share the
    // pre-amble (status flip, generation bump) and
    // the post-amble (transcribe → setTranscript /
    // setError), but the capture loop is different.
    if (provider === 'wispr') {
      await startWisprRecording(generation);
      return;
    }
    if (provider === 'ondevice') {
      // M2c placeholder — fail fast with a clear
      // "not yet wired" error so the failure mode
      // is obvious.
      useVoiceStore.getState().setError(
        'On-device STT is not implemented yet (M2c).',
      );
      return;
    }
    await startStubRecording(generation);
  }, [provider, tickDuration]);

  /**
   * The M2a stub-recording path. Uses `MediaRecorder`
   * for capture and returns a placeholder transcript.
   * Tests stub the audio globals.
   */
  const startStubRecording = useCallback(
    async (generation: number): Promise<void> => {
      // MediaRecorder + getUserMedia are not in jsdom;
      // the test file stubs them on globalThis. We
      // feature-detect at call time, not at module load.
      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== 'function' ||
        typeof window === 'undefined' ||
        typeof window.MediaRecorder !== 'function'
      ) {
        useVoiceStore.getState().setError(
          'Microphone is not available in this environment',
        );
        return;
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        const name = e instanceof Error ? e.name : 'Error';
        const message = errorMessageForCode(name);
        useVoiceStore.getState().setError(message);
        return;
      }

      if (generation !== generationRef.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }

      streamRef.current = stream;

      const mimeType = pickMimeType();
      const recorder = new window.MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = async () => {
        for (const track of stream.getTracks()) track.stop();
        streamRef.current = null;
        recorderRef.current = null;

        if (generation !== generationRef.current) return;

        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }

        const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
        const durationAtStop = Date.now() - startedAtRef.current;
        useVoiceStore.setState({ status: 'transcribing', durationMs: durationAtStop });

        try {
          const transcript = await transcribeStub(blob, durationAtStop);
          if (generation !== generationRef.current) return;
          useVoiceStore.getState().setTranscript(transcript);
        } catch (e) {
          if (generation !== generationRef.current) return;
          const message =
            e instanceof Error ? e.message : 'Transcription failed';
          useVoiceStore.getState().setError(message);
        }
      };
      recorderRef.current = recorder;

      startedAtRef.current = Date.now();
      useVoiceStore.setState({ status: 'recording', durationMs: 0 });
      rafIdRef.current = requestAnimationFrame(tickDuration);

      try {
        recorder.start();
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Failed to start recording';
        useVoiceStore.getState().setError(message);
        for (const track of stream.getTracks()) track.stop();
        streamRef.current = null;
      }
    },
    [tickDuration],
  );

  /**
   * The M2b Wispr path. Opens a raw PCM capture
   * pipeline, fetches the API key from the keychain,
   * and streams chunks to the Wispr WS. On stop, the
   * async iterator ends, the WS client sends the
   * commit, and the final transcript lands in the
   * store.
   */
  const startWisprRecording = useCallback(
    async (generation: number): Promise<void> => {
      // 1. Fetch the Wispr API key. Done BEFORE we
      //    open the mic so the user gets the "no
      //    key" error without a permission prompt
      //    they'd then have to dismiss.
      let apiKey: string | null = null;
      try {
        apiKey = await secretsGetApiKey('wispr');
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Could not read the keychain';
        useVoiceStore.getState().setError(
          `Voice keychain error: ${message}. Check OS keychain permissions.`,
        );
        return;
      }
      if (!apiKey) {
        useVoiceStore.getState().setError(
          'No Wispr API key. Set one in Settings → Voice to enable voice input.',
        );
        return;
      }
      if (generation !== generationRef.current) return;
      wisprKeyRef.current = apiKey;

      // 2. Open the PCM capture pipeline. This
      //    triggers the browser's permission prompt.
      let handle: PcmCaptureHandle;
      try {
        handle = await startPcmCapture();
      } catch (e) {
        if (e instanceof PcmCaptureError) {
          useVoiceStore.getState().setError(pcmCaptureErrorMessage(e.code));
        } else {
          useVoiceStore.getState().setError(
            e instanceof Error ? e.message : 'Failed to start the microphone',
          );
        }
        return;
      }
      if (generation !== generationRef.current) {
        await handle.stop();
        return;
      }
      pcmHandleRef.current = handle;

      // 3. Start the duration timer.
      startedAtRef.current = Date.now();
      useVoiceStore.setState({ status: 'recording', durationMs: 0 });
      rafIdRef.current = requestAnimationFrame(tickDuration);

      // 4. Kick off the Wispr transcription. The
      //    promise resolves when the server sends
      //    `final: true` (or rejects on auth/network
      //    failure). We don't await it here — it
      //    lives until the iterator ends AND the
      //    final text arrives.
      const sttPromise = transcribeViaWispr(handle.chunks, apiKey).then(
        async (transcript) => {
          if (generation !== generationRef.current) return;
          // Stop the duration timer cleanly.
          if (rafIdRef.current !== null) {
            cancelAnimationFrame(rafIdRef.current);
            rafIdRef.current = null;
          }
          useVoiceStore.getState().setTranscript(transcript);
        },
        (err: unknown) => {
          if (generation !== generationRef.current) return;
          if (rafIdRef.current !== null) {
            cancelAnimationFrame(rafIdRef.current);
            rafIdRef.current = null;
          }
          if (err instanceof WisprClientError) {
            useVoiceStore.getState().setError(wisprErrorMessage(err.code));
          } else {
            useVoiceStore.getState().setError(
              err instanceof Error ? err.message : 'Wispr transcription failed',
            );
          }
        },
      );

      // 5. Stash the sttPromise on the handle's
      //    stop() so the unmount cleanup can await
      //    it. We use a microtask instead of
      //    attaching to the handle, which is a
      //    read-only object.
      void sttPromise;
    },
    [tickDuration],
  );

  const stop = useCallback(async (): Promise<void> => {
    // The Wispr path: the PCM iterator ends when we
    // call stop() on the handle, which causes the
    // transcribeViaWispr call to send the commit and
    // wait for the final text. The hook's sttPromise
    // resolves on the next microtask.
    if (provider === 'wispr' && pcmHandleRef.current) {
      const handle = pcmHandleRef.current;
      pcmHandleRef.current = null;
      const durationAtStop = Date.now() - startedAtRef.current;
      useVoiceStore.setState({ status: 'transcribing', durationMs: durationAtStop });
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      // Drop the key — the WebSocket call has
      // already received it.
      wisprKeyRef.current = null;
      try {
        await handle.stop();
      } catch {
        // Best-effort. The transcription is
        // in-flight; errors surface as a
        // transcription failure on the next render.
      }
      return;
    }
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      // stop() called when nothing is recording.
      // No-op.
      return;
    }
    // The MediaRecorder's onstop callback drives
    // the state transitions. We just ask it to
    // stop and wait for the callback.
    try {
      recorder.stop();
    } catch (e) {
      // Same as above: a stop() can throw if the
      // recorder is in a bad state. We surface it
      // as an error and let the user retry.
      const message = e instanceof Error ? e.message : 'Failed to stop recording';
      useVoiceStore.getState().setError(message);
    }
  }, [provider]);

  const isActive = status === 'requesting' || status === 'recording';

  return {
    isActive,
    start,
    stop,
    status,
    durationMs,
    lastError,
    durationLabel: formatDuration(durationMs),
  };
}

// --- helpers --------------------------------------------------------------

function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return null;
}

function errorMessageForCode(name: string): string {
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Microphone access was blocked. Enable it in the OS privacy settings and try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone was found. Plug one in and try again.';
    case 'NotReadableError':
      return 'The microphone is busy. Close other apps using the mic and try again.';
    case 'AbortError':
      return 'Recording was interrupted. Try again.';
    default:
      return `Microphone error: ${name}`;
  }
}

/**
 * M2a stub STT. Returns a placeholder string so the
 * Composer can verify the merge + UI flow end-to-end
 * without depending on a real STT backend. The
 * placeholder echoes the recording duration so the
 * user has a visible "something happened" signal
 * while we wait for M2b/c.
 */
async function transcribeStub(blob: Blob, durationMs: number): Promise<string> {
  // Simulate the latency of a real STT call so the
  // `transcribing` state is visible (without it the
  // placeholder flips so fast the user can't tell
  // anything happened). 200ms is enough to feel
  // intentional, not enough to feel slow.
  await new Promise<void>((resolve) => setTimeout(resolve, M2A_STUB_TRANSCRIBE_DELAY_MS));
  const seconds = (durationMs / 1000).toFixed(1);
  // Note: the placeholder is recognisable so the
  // user (and tests) can tell at a glance that the
  // stub provider is in use. M2b's Wispr path is the
  // real implementation; the stub is now a debug
  // fallback.
  return `voice transcript (${seconds}s, ${blob.size} bytes — stub STT, switch to Wispr in the Command Palette)`;
}
