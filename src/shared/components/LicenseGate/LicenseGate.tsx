/**
 * LicenseGate — the full-screen block + nag modal for
 * the subscription UX.
 *
 * Phase 3 (subscription UX). Renders one of three modes
 * based on the result of `licenseSurfaces(status).gate`:
 *
 *   - `none` — renders nothing (the editor is fully
 *     accessible; the trial badge / banner handle
 *     their own surfaces).
 *   - `nag` — renders a dismissable modal at the top
 *     of the screen. The user is in the grace period
 *     (past `exp` but within the 7-day grace). The
 *     editor is accessible but nagged.
 *   - `block` — renders a hard full-screen block. The
 *     user is `expired` or `invalid`; the editor is
 *     inaccessible until they activate a new license.
 *
 * The component is a React portal that lives at the
 * AppRoot level, so it overlays EVERY screen (Settings,
 * the activation screen, etc.) — not just the editor.
 *
 * The mapping is in `licenseSurfaces.ts` (a pure helper
 * with its own test suite); this component is a thin
 * render-only wrapper around the result.
 */
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/shared/components/Button';
import { Stack } from '@/shared/components/Stack/Stack';
import {
  useLicenseStore,
  licenseSelectors,
} from '@/shared/state/licenseStore';
import { useAppStore } from '@/shared/state/appStore';

import { licenseSurfaces } from './licenseSurfaces';
import { humanizeInvalidReason, statusLine } from '@/screens/SettingsProvider/components/LicenseCard';

import styles from './LicenseGate.module.css';

const NAG_DISMISS_KEY = 'lipi.licenseGate.nagDismissed';

/**
 * Read the nag-dismissed flag from sessionStorage. Per-
 * session only (not localStorage) — the nag reappears
 * on the next app launch, which is what the design doc
 * specifies.
 */
function readNagDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(NAG_DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function writeNagDismissed(dismissed: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(NAG_DISMISS_KEY, dismissed ? '1' : '0');
  } catch {
    // sessionStorage unavailable (private browsing in
    // some configs, or SSR); silently ignore.
  }
}

export function LicenseGate(): JSX.Element | null {
  const status = useLicenseStore(licenseSelectors.status);
  const setActiveScreen = useAppStore((s) => s.setActiveScreen);
  const [nagDismissed, setNagDismissed] = useState<boolean>(() => readNagDismissed());

  // When the status changes (e.g. user activates a new
  // license), reset the nag-dismissed flag so a future
  // grace period starts fresh.
  useEffect(() => {
    if (status?.kind !== 'gracePeriod') {
      setNagDismissed(false);
      writeNagDismissed(false);
    }
  }, [status]);

  const onDismissNag = useCallback(() => {
    setNagDismissed(true);
    writeNagDismissed(true);
  }, []);

  const onActivate = useCallback(() => {
    setActiveScreen('license');
  }, [setActiveScreen]);

  const surfaces = licenseSurfaces(status);

  if (surfaces.gate === 'none') {
    return null;
  }

  if (surfaces.gate === 'block') {
    return (
      <div className={styles.blockOverlay} role="alertdialog" aria-modal="true">
        <div className={styles.blockCard}>
          <h1 className={styles.blockTitle}>
            {status?.kind === 'expired' ? 'Your license has expired' : 'License invalid'}
          </h1>
          <p className={styles.blockLede}>
            {status?.kind === 'expired'
              ? 'Activate a license to continue using Lipi.'
              : status?.kind === 'invalid'
                ? humanizeInvalidReason(status.reason)
                : ''}
          </p>
          <Stack direction="row" gap={3} className={styles.blockActions}>
            <Button variant="primary" size="md" onClick={onActivate}>
              Activate a license
            </Button>
          </Stack>
        </div>
      </div>
    );
  }

  // Nag mode (grace period).
  if (nagDismissed) {
    return null;
  }

  if (status?.kind !== 'gracePeriod') {
    // Should never happen (licenseSurfaces only returns
    // gate: 'nag' for gracePeriod), but defensive.
    return null;
  }

  return (
    <div className={styles.nagOverlay} role="dialog" aria-modal="false" aria-labelledby="lipi-license-nag-title">
      <div className={styles.nagCard}>
        <h2 id="lipi-license-nag-title" className={styles.nagTitle}>
          Your license has expired
        </h2>
        <p className={styles.nagLede}>
          {statusLine(status)} You have {7 - status.daysIntoGrace} day
          {7 - status.daysIntoGrace === 1 ? '' : 's'} of grace period left.
        </p>
        <Stack direction="row" gap={2} className={styles.nagActions}>
          <Button variant="primary" size="sm" onClick={onActivate}>
            Activate a license
          </Button>
          <Button variant="ghost" size="sm" onClick={onDismissNag}>
            I'll do it later
          </Button>
        </Stack>
      </div>
    </div>
  );
}
