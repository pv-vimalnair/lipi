/**
 * TrialBadge — the title-bar pill for the subscription UX.
 *
 * Phase 3 (subscription UX). Renders a small pill in the
 * title bar showing the current license status:
 *
 *   - `trial`, days > 7: "Trial — N days left" (neutral).
 *   - `trial`, days ≤ 7: "Trial — N days left" (amber).
 *   - `trial`, days ≤ 3: "Trial — N days left" (red).
 *   - `active`, days ≤ 7: "{plan} — N days left" (amber).
 *   - `gracePeriod`: "Grace — N days left" (red).
 *   - All other states: no badge.
 *
 * The mapping is in `licenseSurfaces.ts` (a pure helper
 * with its own test suite); this component is a thin
 * render-only wrapper around the result.
 *
 * Clicking the badge navigates to the License activation
 * screen (the user can paste a new key, transfer to a
 * new machine, or see the pricing). The gate handles
 * hard blocks; the badge is a "reminder" surface.
 */
import { useCallback } from 'react';

import {
  useLicenseStore,
  licenseSelectors,
} from '@/shared/state/licenseStore';
import { useAppStore } from '@/shared/state/appStore';

import { licenseSurfaces } from '@/shared/components/LicenseGate/licenseSurfaces';

import styles from './TrialBadge.module.css';

export function TrialBadge(): JSX.Element | null {
  const status = useLicenseStore(licenseSelectors.status);
  const setActiveScreen = useAppStore((s) => s.setActiveScreen);

  const onClick = useCallback(() => {
    setActiveScreen('license');
  }, [setActiveScreen]);

  const surfaces = licenseSurfaces(status);
  const badge = surfaces.badge;
  if (badge === null) {
    return null;
  }

  const toneClass =
    badge.tone === 'red'
      ? styles.red
      : badge.tone === 'amber'
        ? styles.amber
        : styles.neutral;

  return (
    <button
      type="button"
      className={`${styles.badge} ${toneClass}`}
      onClick={onClick}
      title="Open license settings"
      aria-label={`License status: ${badge.label}. Click to manage your license.`}
    >
      {badge.label}
    </button>
  );
}
