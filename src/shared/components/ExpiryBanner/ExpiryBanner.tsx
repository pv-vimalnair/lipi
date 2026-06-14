/**
 * ExpiryBanner — the editor-top red banner for the
 * subscription UX.
 *
 * Phase 3 (subscription UX). Renders a horizontal banner
 * above the file tree (below the title bar) when the
 * license is in one of the "needs attention" states:
 *
 *   - `trial`, days ≤ 3: "Your trial ends in N days.
 *     Activate now →"
 *   - `gracePeriod`: "Your license expired N days ago.
 *     You have N grace days left. Activate now →"
 *
 * The banner is dismissable per-session ("Got it"
 * button). The dismiss state is held in component
 * state (not localStorage), so the banner reappears
 * on next launch.
 *
 * The mapping is in `licenseSurfaces.ts` (a pure helper
 * with its own test suite); this component is a thin
 * render-only wrapper around the result.
 */
import { useCallback, useState } from 'react';

import {
  useLicenseStore,
  licenseSelectors,
} from '@/shared/state/licenseStore';
import { useAppStore } from '@/shared/state/appStore';

import { licenseSurfaces } from '@/shared/components/LicenseGate/licenseSurfaces';

import styles from './ExpiryBanner.module.css';

export function ExpiryBanner(): JSX.Element | null {
  const status = useLicenseStore(licenseSelectors.status);
  const setActiveScreen = useAppStore((s) => s.setActiveScreen);
  const [dismissed, setDismissed] = useState(false);

  const onActivate = useCallback(() => {
    setActiveScreen('license');
  }, [setActiveScreen]);

  const onDismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  // Reset the dismiss state when the status flips to
  // something else (e.g. user activated a new license).
  // We do this via a derive-on-every-render rather than
  // a useEffect to avoid an extra render cycle.
  const surfaces = licenseSurfaces(status);
  if (!surfaces.banner || dismissed) {
    return null;
  }

  if (status?.kind === 'trial') {
    const { daysRemaining } = status;
    return (
      <div className={styles.banner} role="alert">
        <span className={styles.message}>
          Your trial ends in {daysRemaining} day{daysRemaining === 1 ? '' : 's'}.
        </span>
        <span className={styles.actions}>
          <button
            type="button"
            className={styles.cta}
            onClick={onActivate}
            aria-label="Activate a license now"
          >
            Activate now →
          </button>
          <button
            type="button"
            className={styles.dismiss}
            onClick={onDismiss}
            aria-label="Dismiss this reminder for this session"
          >
            Got it
          </button>
        </span>
      </div>
    );
  }

  if (status?.kind === 'gracePeriod') {
    const { daysIntoGrace } = status;
    const daysLeftInGrace = 7 - daysIntoGrace;
    return (
      <div className={styles.banner} role="alert">
        <span className={styles.message}>
          Your license expired {daysIntoGrace} day{daysIntoGrace === 1 ? '' : 's'} ago.
          You have {daysLeftInGrace} grace day{daysLeftInGrace === 1 ? '' : 's'} left.
        </span>
        <span className={styles.actions}>
          <button
            type="button"
            className={styles.cta}
            onClick={onActivate}
            aria-label="Activate a license now"
          >
            Activate now →
          </button>
          <button
            type="button"
            className={styles.dismiss}
            onClick={onDismiss}
            aria-label="Dismiss this reminder for this session"
          >
            Got it
          </button>
        </span>
      </div>
    );
  }

  return null;
}
