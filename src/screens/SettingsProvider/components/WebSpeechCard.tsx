/**
 * WebSpeechCard — M2c mobile "use the browser's
 * built-in speech engine" card.
 *
 * Mirrors the established `OnDeviceCard` shape
 * (header + badge + lede + privacy callout + a
 * single toggle), but tiny: no model install, no
 * curated list, no per-model state. The whole
 * card is a privacy disclosure + an on/off
 * switch.
 *
 * ## What it shows
 *
 *   1. Header: title + a "Available" /
 *      "Not available on this platform" badge.
 *      The badge is computed from the
 *      `useVoiceCapabilitiesStore` (true when
 *      the Rust side reports
 *      `webSpeech: true` for the current build).
 *   2. A short lede explaining what the
 *      browser's speech engine is and the
 *      PRIVACY trade-off (audio leaves the
 *      device and is sent to the WebView's
 *      vendor server).
 *   3. A privacy callout (locked-on, not
 *      user-editable) spelling out where the
 *      audio is sent. This is the single most
 *      important row in the card — see
 *      Decision #46 risk R3.
 *   4. A single `Switch`: "Use browser speech
 *      engine as the voice provider". ON calls
 *      `useVoicePreferencesStore.setProvider('webSpeech')`.
 *      OFF (when the current provider is
 *      `webSpeech`) falls back to `'wispr'` (the
 *      default). The toggle is `disabled` when
 *      the capability badge is "Not available
 *      on this platform".
 *
 * ## Why a tiny card (and not a full OnDeviceCard
 * clone with model picker, etc.)
 *
 *   - No model download — the WebView already
 *     ships the engine. V1 has no "install" step
 *     to surface.
 *   - No language picker in V1. The
 *     `voicePreferencesStore` has a `language`
 *     field (Decision #46 Q1 — store-only in
 *     V1; the Settings UI picker is a M2c.b
 *     follow-up). The default is `'en-US'` and
 *     is forwarded to `recognition.lang`. A
 *     future M2c.b commit will add a `<select>`
 *     row above the toggle.
 *   - No "Test connection" button. The
 *     capability is platform-determined; a
 *     probe would require the user to grant
 *     mic permission and speak, which is the
 *     main action anyway.
 *
 * ## Data flow
 *
 *   - On mount + on every store change: read
 *     `useVoiceCapabilitiesStore.getState().capabilities.webSpeech`.
 *     The store is hydrated once at app startup
 *     (next to `setupVoicePreferencesPersistence()`).
 *     While the IPC is in-flight (the very
 *     first few ms), the store's `capabilities`
 *     field is `null` and the card renders the
 *     toggle as disabled.
 *   - Toggle on: `setProvider('webSpeech')`.
 *   - Toggle off: `setProvider('wispr')` (the
 *     default).
 *   - Provider change re-renders the card
 *     (Zustand subscription) so the toggle
 *     stays in sync with the user's selection.
 *
 * ## Why this is its own file (and not inlined
 * in `SettingsProvider.tsx`)
 *
 *   - The Settings screen is already pushing
 *     1800+ LoC across AI Providers + AI Tools +
 *     Custom Tools. The M2c-mobile card is
 *     another ~120 LoC of JSX; inlining it
 *     would push the screen past the
 *     "comfortable to navigate" threshold.
 *   - Per Rule 3, components live next to the
 *     screen that uses them — that's
 *     `src/screens/SettingsProvider/components/`.
 *   - The M2b WisprCard is inlined in
 *     `SettingsProvider.tsx` (a pre-M2c habit).
 *     The M2c cards (OnDeviceCard + this one)
 *     are extracted for the new convention.
 */

import { useCallback } from 'react';

import { Switch } from '@/shared/components/Switch';
import { useVoicePreferencesStore } from '@/shared/state/voicePreferencesStore';
import { useVoiceCapabilitiesStore } from '@/shared/state/voiceCapabilitiesStore';

import styles from './WebSpeechCard.module.css';

export function WebSpeechCard(): JSX.Element {
  // Read synchronously from the store. The store
  // is hydrated at app startup; while in flight
  // (a few ms), `capabilities` is `null` and the
  // badge + toggle read "unavailable". The
  // `useVoiceCapabilitiesStore` hook re-renders
  // the card when the IPC resolves, so the
  // user-visible state flips from "checking" to
  // "available" / "not available" automatically.
  const webSpeechAvailable = useVoiceCapabilitiesStore(
    (s) => s.capabilities?.webSpeech === true,
  );
  const provider = useVoicePreferencesStore((s) => s.provider);
  const setProvider = useVoicePreferencesStore((s) => s.setProvider);

  const onToggle = useCallback(
    (next: boolean) => {
      if (next) {
        setProvider('webSpeech');
        return;
      }
      // Turning the toggle off falls back to
      // 'wispr' (the default). The user can
      // always pick a different provider from
      // the Command Palette. We deliberately do
      // NOT leave the provider at 'webSpeech'
      // with the toggle "off" — that's a state
      // mismatch the user can't reach in the
      // UI but could create via
      // `setProvider('webSpeech')` from the
      // Command Palette. The next render of
      // this card would then show the toggle
      // "on" and the store at 'webSpeech' —
      // they always agree.
      setProvider('wispr');
    },
    [setProvider],
  );

  const toggleOn = provider === 'webSpeech';

  // Badge text + configured state. `null` while
  // the capabilities IPC is in-flight. We show
  // "Checking…" to match the `OnDeviceCard`'s
  // "Loading…" affordance.
  const badgeText = webSpeechAvailable
    ? 'Available'
    : 'Not available on this platform';
  const badgeConfigured = webSpeechAvailable;

  return (
    <article className={styles.card}>
      <header className={styles.cardHeader}>
        <div className={styles.cardTitleRow}>
          <h2 className={styles.cardTitle}>Browser speech engine</h2>
          <span
            className={styles.badge}
            data-configured={badgeConfigured || undefined}
          >
            {badgeText}
          </span>
        </div>
      </header>
      <p className={styles.cardDescription}>
        The WebView&rsquo;s built-in&nbsp;
        <code>SpeechRecognition</code> API is available on
        Chromium-based WebViews (Windows, macOS) and on
        WKWebView (iOS). The browser sends your audio to its
        own server for transcription — the audio does not
        stay on your machine. Choose this if you don&rsquo;t
        want to download a Whisper model.
      </p>

      <div className={styles.privacyCallout}>
        <span className={styles.privacyCalloutLabel}>
          Where is my audio sent?
        </span>
        <span className={styles.privacyCalloutValue}>
          To the WebView&rsquo;s vendor server (Google on
          Chromium, Apple on WebKit). Not to Lipi, not to a
          Wispr-style backend.
        </span>
      </div>

      {!webSpeechAvailable ? (
        // The platform doesn't expose
        // `window.SpeechRecognition` (Linux
        // WebKitGTK, or the rare Chromium
        // build with the feature stripped).
        // We hide the toggle and show a static
        // "what to do instead" notice — the
        // user can fall back to Wispr or the
        // on-device provider.
        <div className={styles.unavailableNotice}>
          <span className={styles.unavailableNoticeTitle}>
            Browser speech isn&rsquo;t available here
          </span>
          <span className={styles.unavailableNoticeDetail}>
            Your WebView doesn&rsquo;t expose the&nbsp;
            <code>SpeechRecognition</code> API. Use Wispr
            Flow (cloud) or the on-device Whisper model
            (local) instead.
          </span>
        </div>
      ) : (
        <div className={styles.toggleRow}>
          <div className={styles.toggleText}>
            <span className={styles.toggleLabel}>
              Use browser speech engine as the voice provider
            </span>
            <span className={styles.toggleHint}>
              {toggleOn
                ? "On. Click the mic to use the browser's SpeechRecognition."
                : 'Off. The mic uses Wispr Flow (or the on-device model, if active).'}
            </span>
          </div>
          <Switch
            checked={toggleOn}
            onChange={onToggle}
            aria-label="Use browser speech engine as the voice provider"
          />
        </div>
      )}
    </article>
  );
}
