/**
 * License activation screen.
 *
 * Phase 2 (offline licensing layer). The first
 * thing a user with an `unactivated` / `invalid`
 * license sees. Renders:
 *
 *   - A one-line lede explaining the situation
 *     ("Trial active — 13 days remaining" or
 *     "License invalid" or "No license activated").
 *   - A textarea for the user to paste their
 *     license key.
 *   - An "Activate" button.
 *   - A "Get a license" link to the project's
 *     pricing page (Phase 4 will wire this to the
 *     real pricing URL; Phase 2 uses a placeholder).
 *   - A machine-fingerprint display (so the user
 *     can include it in a "please issue me a
 *     license" support email).
 *
 * On successful activation, the screen calls
 * `useLicenseStore.activate(key)`; the Rust side
 * verifies the signature and stores the key in the
 * OS keychain. The store's `status` is updated;
 * the host (AppRoot) navigates to the next screen.
 *
 * On a bad key, the store's `status` is updated to
 * `invalid` and a human-friendly reason is shown
 * inline. The user can correct the key and try
 * again — the keychain is NOT modified on failure.
 *
 * Phase 2 is a "minimal" implementation: the
 * screen is the *only* place the user enters a
 * key, and there's no trial-progress badge in the
 * title bar (that's Phase 3). The screen is
 * shown when the host (`main.tsx`) detects an
 * `unactivated` or `invalid` status and gates the
 * workspace. Phase 2 just renders the screen; the
 * actual gate is also Phase 3.
 */
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/shared/components/Button';
import { Stack } from '@/shared/components/Stack/Stack';
import {
  useLicenseStore,
  licenseSelectors,
} from '@/shared/state/licenseStore';

import { humanizeInvalidReason, statusLine } from './helpers';

import styles from './License.module.css';

export interface LicenseProps {
  /**
   * Optional slot for a secondary action (e.g. an
   * "Open Settings" link in the top-right). The
   * host (AppRoot) passes this in so the License
   * screen doesn't import the global `useAppStore`
   * directly — same isolation rule as
   * `Welcome.renderActions`.
   */
  renderActions?: () => React.ReactNode;
}

export function License({ renderActions }: LicenseProps): JSX.Element {
  const status = useLicenseStore(licenseSelectors.status);
  const fingerprint = useLicenseStore(licenseSelectors.machineFingerprint);
  const loadFingerprint = useLicenseStore((s) => s.loadMachineFingerprint);
  const activate = useLicenseStore((s) => s.activate);

  const [key, setKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Lazily fetch the fingerprint so the user can
  // copy it without an extra click.
  useEffect(() => {
    void loadFingerprint();
  }, [loadFingerprint]);

  const handleActivate = useCallback(async (): Promise<void> => {
    const trimmed = key.trim();
    if (trimmed.length === 0) {
      setErrorMessage('Paste a license key first.');
      return;
    }
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const result = await activate(trimmed);
      if (result.kind === 'invalid') {
        setErrorMessage(humanizeInvalidReason(result.reason));
      } else {
        // Active / trial / grace / expired (any
        // non-invalid variant). The host will
        // navigate to the next screen on the
        // status flip; the Phase 3 gate reads
        // `useLicenseStore.status.kind` and
        // routes accordingly.
        setKey('');
      }
    } catch (err) {
      setErrorMessage(`Activation failed: ${String(err)}`);
    } finally {
      setSubmitting(false);
    }
  }, [activate, key]);

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.logo} aria-hidden="true">L</span>
          <span className={styles.brandName}>Lipi</span>
        </div>
        {renderActions?.()}
      </header>

      <main className={styles.hero}>
        <h1 className={styles.title}>Activate Lipi</h1>
        <p className={styles.lede}>{statusLineForScreen(status)}</p>

        <Stack gap={3} className={styles.form}>
          <label className={styles.label} htmlFor="lipi-license-key">
            License key
          </label>
          <textarea
            id="lipi-license-key"
            className={styles.textarea}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="LIP1.eyJmb3JtYXQiOi…"
            rows={4}
            spellCheck={false}
            autoComplete="off"
            disabled={submitting}
          />
          {errorMessage && (
            <p className={styles.error} role="alert">
              {errorMessage}
            </p>
          )}
          <Stack direction="row" gap={2} className={styles.actions}>
            <Button
              variant="primary"
              size="md"
              onClick={() => void handleActivate()}
              disabled={submitting || key.trim().length === 0}
            >
              {submitting ? 'Activating…' : 'Activate'}
            </Button>
            <a
              className={styles.pricingLink}
              href="https://lipi.ide/pricing"
              target="_blank"
              rel="noopener noreferrer"
            >
              Get a license →
            </a>
          </Stack>
        </Stack>

        <section className={styles.fingerprintSection}>
          <h2 className={styles.subhead}>Need a license issued?</h2>
          <p className={styles.muted}>
            Email <a href="mailto:licensing@lipi.ide">licensing@lipi.ide</a> with
            the fingerprint below and the plan you'd like (monthly or yearly).
            The project lead issues a license key by hand within one business day.
          </p>
          <code className={styles.fingerprint} aria-label="Machine fingerprint">
            {fingerprint ?? 'Loading fingerprint…'}
          </code>
        </section>
      </main>
    </div>
  );
}

/** Pure: human-friendly lede for the screen. */
function statusLineForScreen(status: ReturnType<typeof useLicenseStore.getState>['status']): string {
  if (status === null) return 'Loading license status…';
  if (status.kind === 'unactivated') {
    return 'Paste a license key below, or grab one from the pricing page.';
  }
  if (status.kind === 'invalid') {
    return 'Your current license is invalid. Paste a valid key below to restore access.';
  }
  return statusLine(status);
}
