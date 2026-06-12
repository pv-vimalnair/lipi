/**
 * VoiceButton — M2a mic toggle for the AI composer.
 *
 * Visual states:
 *   - idle:        a mic icon. Click to start recording.
 *   - requesting:  a faint spinner. The browser is asking
 *                  for permission (or the user has yet to
 *                  respond). Click is ignored.
 *   - recording:   a red dot + a "M:SS" timer. The icon
 *                  pulses (CSS animation) to signal "live".
 *                  Click to stop.
 *   - transcribing: the spinner again, briefly, while the
 *                  STT step runs. M2a uses a 200ms stub;
 *                  M2b/c will be a real WS / on-device
 *                  call.
 *   - error:       a red mic icon with a tooltip
 *                  describing the failure. Click to retry.
 *
 * The button is a wrapper around `useVoiceCapture` — it
 * renders nothing about the audio pipeline itself, just
 * the visible state. The hook returns the imperative
 * `start` / `stop` API and the live status; this component
 * is responsible for the visual mapping.
 *
 * M5 wiring:
 *   The button now accepts an optional
 *   `controlledState` prop. If passed, the
 *   button is purely presentational — it
 *   renders the given `status` and dispatches
 *   clicks to the given `start` / `stop`. If
 *   not, it creates its own
 *   `useVoiceCapture` instance (the original
 *   M2a behaviour, kept for callers that
 *   don't need to share the voice flow with
 *   other surfaces — Cmd-K modal, etc.).
 *
 *   The Composer (the main caller) passes
 *   `controlledState` from a single
 *   `useVoiceCapture` instance it owns. That
 *   way the global voice shortcut
 *   (`useVoiceShortcut`) and the on-screen
 *   button share the SAME underlying
 *   capture / store. Before M5 there was a
 *   latent risk: each `useVoiceCapture`
 *   instance owns its own MediaStream, so
 *   two instances in the same Composer
 *   would have raced for the mic. M5 fixes
 *   this by making the Composer the single
 *   owner.
 *
 * Why a separate component (and not inlined in the
 * Composer):
 *   - It has its own internal `useVoiceCapture` instance
 *     by default, but M5+ callers can pass
 *     `controlledState` to share the parent's instance.
 *   - The button is the canonical "voice capture" UI for
 *     the app. Putting it in `shared/components/` lets
 *     other surfaces (Cmd-K modal, future inline-edit
 *     mic, mobile bottom-bar) reuse the same control.
 *
 * Test escape hatch:
 *   - The button's click handler calls the hook's
 *     `start()` / `stop()`. The hook internally calls
 *     `navigator.mediaDevices.getUserMedia` which is
 *     not in jsdom. The test file stubs the hook
 *     (`vi.mock('@/shared/hooks/useVoiceCapture')`) so
 *     the render tests run in a pure-DOM environment
 *     without needing a fake mic.
 *   - When the button is used in `controlledState`
 *     mode (the M5 Composer), the parent owns the
 *     hook and the button's tests are pure render
 *     tests (no mock needed — just pass
 *     `controlledState` with stubbed functions).
 */

import { useCallback } from 'react';
import { useVoiceCapture } from '@/shared/hooks/useVoiceCapture';
import {
  useVoicePreferencesStore,
  voicePreferencesSelectors,
} from '@/shared/state/voicePreferencesStore';
import type { VoiceProviderId } from '@/voice';
import styles from './VoiceButton.module.css';

/** Shape of a `useVoiceCapture()` return value that
 *  the controlled-mode button needs. We extract
 *  this so the prop is documented in one place. */
export interface VoiceButtonControlledState {
  start: () => Promise<void> | void;
  stop: () => Promise<void> | void;
  status: 'idle' | 'requesting' | 'recording' | 'transcribing' | 'error';
  durationLabel: string;
  lastError: string | null;
}

export interface VoiceButtonProps {
  /**
   * Disable the button (greyed out, no clicks). The
   * Composer sets this when the AI provider is not
   * configured (no key) — there's no point asking
   * the user to record a message they can't send.
   */
  disabled?: boolean;
  /**
   * STT provider override. If omitted, reads from
   * `useVoicePreferencesStore` (which the Command
   * Palette can flip). M2b defaults to 'wispr' (the
   * headline path). M2a's 'stub' is kept as a debug
   * fallback. 'ondevice' is the M2c desktop Whisper
   * path (Rust cpal+whisper). 'webSpeech' is the M2c
   * mobile shim (the WebView's
   * `window.SpeechRecognition`). 'nativeDictation' is
   * the iOS Swift / Android Kotlin plugin stub (M3
   * factory exists; plugin land later).
   *
   * Ignored in controlled mode — the parent owns the
   * provider choice.
   */
  provider?: VoiceProviderId;
  /**
   * M5: when provided, the button is purely
   * presentational. It renders `controlledState.status`
   * and dispatches clicks to `controlledState.start` /
   * `controlledState.stop`. Use this when the parent
   * (e.g. the Composer) needs to share the voice
   * capture with a global keyboard shortcut.
   */
  controlledState?: VoiceButtonControlledState;
}

export function VoiceButton({
  disabled = false,
  provider: providerOverride,
  controlledState,
}: VoiceButtonProps): JSX.Element {
  // M2b: the provider comes from the preferences
  // store by default; the explicit prop wins if
  // passed (lets the Composer or a test pin a
  // specific provider).
  const providerFromStore = useVoicePreferencesStore(voicePreferencesSelectors.provider);
  const provider = providerOverride ?? providerFromStore;
  // M5: prefer the controlled state from the parent
  // when provided; otherwise create our own
  // `useVoiceCapture` instance (the M2a default).
  const ownHook = useVoiceCapture({ provider });
  const { start, stop, status, durationLabel, lastError } =
    controlledState ?? ownHook;

  // The "transcript landed" event is a status
  // transition from 'transcribing' to 'idle' (the
  // store's `setTranscript` does that). The hook
  // is the one that calls `setTranscript`; the
  // Composer is the one that subscribes to
  // `useVoiceStore.transcript` and appends. We
  // don't need an effect here: the hook already
  // writes to the store, and the Composer
  // (which has its own subscription) reacts.

  const handleClick = useCallback(() => {
    if (disabled) return;
    if (status === 'recording' || status === 'requesting') {
      void stop();
    } else if (status === 'idle' || status === 'error') {
      // Errors are retriable: clicking starts a new
      // recording, which clears the error in the
      // hook's `start()` body.
      void start();
    }
    // 'transcribing' is a no-op (the spinner
    // ignores clicks; the user has to wait).
  }, [disabled, status, start, stop]);

  // ARIA: announce the current state. The button
  // is `aria-pressed` while recording (it's a
  // toggle) and `aria-busy` while requesting /
  // transcribing. The `title` attribute is the
  // user-facing hint on hover.
  const ariaLabel = (() => {
    if (status === 'recording') return `Stop recording (${durationLabel})`;
    if (status === 'requesting') return 'Requesting microphone access…';
    if (status === 'transcribing') return 'Transcribing…';
    if (status === 'error') return `Voice error: ${lastError ?? 'unknown'}. Click to retry.`;
    return 'Start voice input';
  })();

  const titleText = (() => {
    if (status === 'recording') return `Stop recording (${durationLabel})`;
    if (status === 'error' && lastError) return lastError;
    if (disabled) return 'Add an API key in Settings to enable voice input';
    return 'Start voice input';
  })();

  return (
    <button
      type="button"
      className={styles.button}
      data-status={status}
      data-disabled={disabled || undefined}
      data-testid="voice-button"
      onClick={handleClick}
      disabled={disabled || status === 'transcribing'}
      aria-label={ariaLabel}
      aria-pressed={status === 'recording' || undefined}
      aria-busy={status === 'requesting' || status === 'transcribing' || undefined}
      title={titleText}
    >
      <span className={styles.icon} aria-hidden="true">
        {/* The icon swaps based on status. We keep
            the four glyphs as plain text (no SVG) so
            the CSS animation is the only thing
            running on the GPU — no font / glyph
            reflow on toggle. */}
        {status === 'recording' ? '⏹' : status === 'error' ? '⚠' : '🎙'}
      </span>
      {status === 'recording' && (
        <span className={styles.duration} data-testid="voice-duration">
          {durationLabel}
        </span>
      )}
    </button>
  );
}
