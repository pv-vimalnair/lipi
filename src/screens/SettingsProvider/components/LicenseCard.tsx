/**
 * LicenseCard — Settings "License" section.
 *
 * Phase 2 (offline licensing layer). Shows the
 * current license status and provides the
 * "Deactivate" / "Show fingerprint" actions.
 *
 * The full activation flow (paste-key wizard,
 * trial-progress badge) lives in
 * `src/screens/License/License.tsx`. This card
 * is the "manage existing license" view.
 *
 * Renders one of:
 *   - "Loading…" while `licenseStore.status` is null
 *     (the IPC hasn't resolved yet)
 *   - "Active — Yearly, 137 days remaining" for
 *     a paid license
 *   - "Trial — 13 days remaining" for a first-run
 *     trial
 *   - "Grace period — 2 days into 7" for a
 *     past-`exp` license in the 7-day grace
 *   - "Expired" for a past-grace license
 *   - "No license" for an explicit unactivated
 *     state (rare; only after a manual deactivate)
 *   - "Invalid: <reason>" for a tampered /
 *     mismatched license
 *
 * The "Show fingerprint" button fetches and
 * displays this machine's fingerprint (64
 * lowercase hex chars) in a copy-friendly text
 * field. Used when the user needs to email
 * support to get a license issued.
 *
 * The "Deactivate" button calls
 * `useLicenseStore.deactivate()` and shows a
 * confirmation. The Rust side deletes the
 * keychain entry; the next `licenseGetStatus`
 * call will generate a new 14-day trial (the
 * Rust side auto-generates on first call, so
 * "deactivate then re-open" is the v1
 * "transfer to another machine" flow).
 */
import { useCallback, useState } from 'react';

import { Button } from '@/shared/components/Button';
import { Stack } from '@/shared/components/Stack/Stack';
import {
  useLicenseStore,
  licenseSelectors,
} from '@/shared/state/licenseStore';
import type { LicenseStatusPayload } from '@/ipc/licensing';

import styles from './LicenseCard.module.css';

export function LicenseCard(): JSX.Element {
  const status = useLicenseStore(licenseSelectors.status);
  const fingerprint = useLicenseStore(licenseSelectors.machineFingerprint);
  const loadFingerprint = useLicenseStore((s) => s.loadMachineFingerprint);
  const deactivate = useLicenseStore((s) => s.deactivate);
  const [showFingerprint, setShowFingerprint] = useState(false);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  const handleShowFingerprint = useCallback(async (): Promise<void> => {
    setShowFingerprint(true);
    await loadFingerprint();
  }, [loadFingerprint]);

  const handleDeactivate = useCallback(async (): Promise<void> => {
    setDeactivateError(null);
    try {
      await deactivate();
      setConfirmingDeactivate(false);
    } catch (err) {
      setDeactivateError(String(err));
    }
  }, [deactivate]);

  if (status === null) {
    return (
      <section className={styles.card} aria-busy="true">
        <h3 className={styles.title}>License</h3>
        <p className={styles.muted}>Loading license status…</p>
      </section>
    );
  }

  return (
    <section className={styles.card}>
      <h3 className={styles.title}>License</h3>
      <p className={styles.muted}>{statusLine(status)}</p>

      {status.kind === 'invalid' && (
        <p className={styles.error} role="alert">
          {humanizeInvalidReason(status.reason)}
        </p>
      )}

      <Stack direction="row" gap={2} className={styles.actions}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => (showFingerprint ? setShowFingerprint(false) : void handleShowFingerprint())}
          aria-expanded={showFingerprint}
        >
          {showFingerprint ? 'Hide fingerprint' : 'Show machine fingerprint'}
        </Button>
        {(status.kind === 'active' || status.kind === 'trial' || status.kind === 'gracePeriod') && (
          confirmingDeactivate ? (
            <>
              <Button variant="danger" size="sm" onClick={() => void handleDeactivate()}>
                Confirm deactivate
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmingDeactivate(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setConfirmingDeactivate(true)}>
              Deactivate
            </Button>
          )
        )}
      </Stack>

      {showFingerprint && (
        <div className={styles.fingerprintBlock}>
          <p className={styles.muted}>
            This machine's fingerprint (include in your license request email):
          </p>
          <code className={styles.fingerprint} aria-label="Machine fingerprint">
            {fingerprint ?? <span className={styles.muted}>Loading…</span>}
          </code>
        </div>
      )}

      {deactivateError && (
        <p className={styles.error} role="alert">
          {deactivateError}
        </p>
      )}
    </section>
  );
}

/** Pure: human-friendly single-line summary of the status. */
export function statusLine(status: LicenseStatusPayload): string {
  switch (status.kind) {
    case 'unactivated':
      return 'No license activated.';
    case 'active':
      return `Active — ${capitalize(status.plan)}, ${status.daysRemaining} day${status.daysRemaining === 1 ? '' : 's'} remaining.`;
    case 'gracePeriod':
      return `Grace period — ${capitalize(status.plan)} license expired ${status.daysIntoGrace} day${status.daysIntoGrace === 1 ? '' : 's'} ago. Renew to restore full access.`;
    case 'expired':
      return `Expired — ${capitalize(status.plan)} license. Activate a new license to continue.`;
    case 'trial':
      return `Trial — ${status.daysRemaining} day${status.daysRemaining === 1 ? '' : 's'} remaining. Activate a license to keep using Lipi.`;
    case 'invalid':
      return 'License invalid.';
  }
}

/** Pure: human-friendly text for an `invalid` reason. */
export function humanizeInvalidReason(reason: string): string {
  if (reason.includes('machine-mismatch')) {
    return 'This license is for a different machine. To use it here, request a new license from the project lead (the fingerprint on the activation screen is for THIS machine).';
  }
  if (reason.includes('not-yet-valid')) {
    return 'This license is not yet valid (it has a delayed activation date). Wait until that date and try again.';
  }
  if (reason.includes('verification-failed')) {
    return 'The license signature is invalid. The key may be corrupted or tampered with. Double-check that you pasted the entire key.';
  }
  if (reason.includes('empty key')) {
    return 'No license key was provided.';
  }
  return `License invalid — ${reason}`;
}

function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
