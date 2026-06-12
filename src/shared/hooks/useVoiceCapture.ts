/**
 * useVoiceCapture — M3 capture pipeline.
 *
 * Owns the `voiceStore` UI state (status, durationMs,
 * transcript, lastError) and drives the M3 `VoiceSession`
 * lifecycle. The hook is intentionally thin: every
 * provider-specific concern (mic capture, WebSocket
 * protocol, the Rust IPC subscription) lives inside the
 * factory's closure. The hook is just a thin adapter
 * between the session's `onStateChange` / `onTranscription`
 * / `onError` listeners and the store.
 *
 * What M3 changed (vs M2a/b/c):
 *   - The 4-branch `if/else` ladder (lines 344-356 of the
 *     M2a file) collapses to a single
 *     `voiceSessionFactories[provider]()` dispatch.
 *   - The 4 per-provider `startXxxRecording` callbacks
 *     collapse to one `start` callback that drives the
 *     listeners.
 *   - The 3 per-provider `stop()` branches collapse to one
 *     (each provider's `close()` does the right thing).
 *   - The `streamRef` / `recorderRef` / `pcmHandleRef` /
 *     `onDeviceSessionIdRef` / `webSpeechHandleRef` are
 *     gone — the session owns them.
 *   - The `generationRef` counter stays (per Decision #4
 *     the abort controller doesn't solve the "new session
 *     started after the old one was aborted" case).
 *   - The public return shape
 *     (`{ isActive, start, stop, status, durationMs, lastError, durationLabel }`)
 *     is unchanged — the Composer call site is unchanged.
 *
 * Per-session cancellation (Decision #4): the hook
 * creates a fresh `AbortController` on every `start()`.
 * The session's `opts.signal` is `controller.signal`; the
 * handle's `abort()` fires the signal. On `useEffect`
 * cleanup the hook fires the controller too — every
 * session is aborted on unmount.
 */

import { useCallback, useEffect, useRef } from 'react';

import {
  formatDuration,
  useVoiceStore,
  voiceSelectors,
} from '@/shared/state/voiceStore';
import { useVoicePreferencesStore } from '@/shared/state/voicePreferencesStore';
import {
  voiceSessionFactories,
  VoiceSessionError,
  type VoiceSessionFactoryOptions,
  type VoiceSessionHandle,
  type VoiceSessionState,
} from '@/voice';
import { secretsGetApiKey } from '@/ipc';

import type { VoiceProviderId } from '@/voice/types';

export interface UseVoiceCaptureOptions {
  /**
   * The STT provider. M3 accepts all 5 ids from the
   * `VoiceProviderId` literal union. The
   * `voiceSessionFactories` registry dispatches against
   * this — the hook itself has zero per-provider code.
   *
   * For backward compat with the M2a call site, the
   * default is `'stub'` (the debug placeholder).
   */
  provider?: VoiceProviderId;
}

export interface UseVoiceCaptureResult {
  /** True while the user is being prompted for mic
   *  permission OR the mic is open. The button shows
   *  a spinner in this state and ignores clicks. */
  isActive: boolean;
  /** Imperative: start a new recording. Resolves when
   *  the session is in `listening` (the mic is open).
   *  Rejects (via the store's `lastError` field) if
   *  permission is denied, the device is busy, or the
   *  provider is not configured. */
  start: () => Promise<void>;
  /** Imperative: stop the current recording. The
   *  session's `close()` runs; the transcript lands
   *  in `voiceStore.transcript` on the next render. */
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

/** Map a `VoiceSessionState` to the corresponding UI
 *  state in `voiceStore`. The M3 7-state protocol machine
 *  collapses to the 5-state UI machine via this table.
 *  States not in the table don't change the store
 *  (the consumer is already showing the right state). */
function sessionStateToVoiceStatus(
  s: VoiceSessionState,
): 'idle' | 'requesting' | 'recording' | 'transcribing' | 'error' {
  switch (s) {
    case 'starting':
      return 'requesting';
    case 'listening':
      return 'recording';
    case 'stopping':
    case 'finalizing':
      return 'transcribing';
    case 'error':
      return 'error';
    case 'closed':
      return 'idle';
    case 'idle':
      // Pre-construction — the store should already
      // be `'idle'`. The factory doesn't fire `'idle'`
      // to the listener (it goes straight to
      // `'starting'`), so this branch is defensive.
      return 'idle';
  }
}

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
  const startedAtRef = useRef<number>(0);
  // Tracks the animation frame id so we can cancel it
  // on stop / unmount. The durationMs counter ticks
  // every animation frame so the user sees a smooth
  // "0:00 → 0:01" transition.
  const rafIdRef = useRef<number | null>(null);
  // The current session handle (M3). `null` when no
  // session is active. The cleanup effect calls
  // `handle.abort()` on unmount.
  const handleRef = useRef<VoiceSessionHandle | null>(null);
  // The current session's AbortController. Created
  // on every `start()`; the controller is aborted on
  // `stop()` and on unmount.
  const abortControllerRef = useRef<AbortController | null>(null);
  // The Wispr API key. Fetched from the keychain on
  // start() and dropped on stop() / unmount. It never
  // leaves this ref.
  const wisprKeyRef = useRef<string | null>(null);
  // A guard that prevents a stale `close()` from a
  // previous session from clobbering the new session's
  // state. Without this, an unmount-mid-session leaves
  // a listener that, when it fires (e.g. the abort
  // resolves on the next microtask), writes to the
  // store and flips the new recording into a wrong
  // state. A simple generation counter increments on
  // every `start()` and the in-flight session's
  // listeners check against it.
  const generationRef = useRef(0);

  const tickDuration = useCallback(() => {
    useVoiceStore.getState().setDurationMs(Date.now() - startedAtRef.current);
    rafIdRef.current = requestAnimationFrame(tickDuration);
  }, []);

  // Cleanup: cancel the rAF, abort the in-flight
  // session, drop the Wispr key, when the host unmounts.
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      const handle = handleRef.current;
      if (handle) {
        try {
          handle.abort();
        } catch {
          // best-effort
        }
        handleRef.current = null;
      }
      const controller = abortControllerRef.current;
      if (controller) {
        controller.abort();
        abortControllerRef.current = null;
      }
      wisprKeyRef.current = null;
    };
  }, []);

  const start = useCallback(async (): Promise<void> => {
    const currentStatus = useVoiceStore.getState().status;
    if (currentStatus === 'recording' || currentStatus === 'requesting') {
      return;
    }
    // New session — bump the generation so any
    // in-flight session from a previous recording
    // becomes a no-op (its listeners short-circuit
    // before mutating the store).
    const generation = ++generationRef.current;

    // Reset the store to a clean "requesting" state.
    useVoiceStore.setState({
      status: 'requesting',
      durationMs: 0,
      transcript: '',
      lastError: null,
    });

    // The per-session AbortController (Decision #4).
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Pre-flight for the Wispr path: fetch the key
    // BEFORE the factory call so the "no key" error
    // surfaces without opening a mic. The other
    // providers don't need pre-flight.
    let wisprApiKey: string | undefined;
    if (provider === 'wispr') {
      try {
        wisprApiKey = (await secretsGetApiKey('wispr')) ?? undefined;
      } catch (e) {
        const message =
          e instanceof Error ? e.message : 'Could not read the keychain';
        useVoiceStore.getState().setError(
          `Voice keychain error: ${message}. Check OS keychain permissions.`,
        );
        return;
      }
      if (!wisprApiKey) {
        useVoiceStore.getState().setError(
          'No Wispr API key. Set one in Settings → Voice to enable voice input.',
        );
        return;
      }
      if (generation !== generationRef.current) return;
      wisprKeyRef.current = wisprApiKey;
    }

    // Build the factory options. Provider-specific
    // fields (config, language) are read from the
    // relevant stores.
    const language = useVoicePreferencesStore.getState().language;
    const factoryOptions: VoiceSessionFactoryOptions = {
      mode: 'dictation',
      config: wisprApiKey ? { wisprApiKey } : undefined,
      signal: abortController.signal,
      language,
    };

    // The single dispatch point. The factory's
    // returned handle owns the session; the hook
    // wires the listeners and the store.
    let handle: VoiceSessionHandle;
    try {
      handle = await voiceSessionFactories[provider](factoryOptions);
    } catch (err) {
      // The factory itself rejected (e.g. no API key,
      // no model, no WebSocket). Surface the typed
      // error.
      if (generation !== generationRef.current) return;
      const message =
        err instanceof VoiceSessionError
          ? err.message
          : err instanceof Error
            ? err.message
            : `${provider} STT session failed to start.`;
      useVoiceStore.getState().setError(message);
      wisprKeyRef.current = null;
      return;
    }
    if (generation !== generationRef.current) {
      void handle.session.close();
      return;
    }
    handleRef.current = handle;

    // Wire the listeners. The session emits
    // `starting → listening → … → closed`; we map
    // those to the store's 5-state machine.
    handle.session.onStateChange((s) => {
      if (generation !== generationRef.current) return;
      useVoiceStore.getState().setStatus(sessionStateToVoiceStatus(s));
      if (s === 'listening') {
        // The user can see the recording is live.
        // Start the duration timer.
        startedAtRef.current = Date.now();
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
        }
        rafIdRef.current = requestAnimationFrame(tickDuration);
      }
    });
    handle.session.onTranscription((event) => {
      if (generation !== generationRef.current) return;
      if (event.kind === 'final') {
        // Stop the duration timer cleanly; the
        // store's `setTranscript` flips status to
        // `'idle'` and clears `transcript` on the
        // next render.
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
        useVoiceStore.getState().setTranscript(event.text);
        // Drop the Wispr key — the WebSocket call
        // already received it.
        wisprKeyRef.current = null;
      }
    });
    handle.session.onError((err) => {
      if (generation !== generationRef.current) return;
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      useVoiceStore.getState().setError(err.message);
      wisprKeyRef.current = null;
    });
  }, [provider, tickDuration]);

  const stop = useCallback(async (): Promise<void> => {
    const handle = handleRef.current;
    if (!handle) {
      // Stop called when nothing is recording.
      // The M2a `recorderRef.current?.state === 'inactive'`
      // no-op is mirrored here.
      return;
    }
    handleRef.current = null;
    try {
      await handle.session.close();
    } catch {
      // best-effort
    }
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

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
