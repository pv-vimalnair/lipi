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
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/shared/components/Button';
import { Stack } from '@/shared/components/Stack/Stack';
import {
  useLicenseStore,
  licenseSelectors,
} from '@/shared/state/licenseStore';
import { useAppStore } from '@/shared/state/appStore';
import type { LicenseStatusPayload } from '@/ipc/licensing';
import { licenseGetKid } from '@/ipc/licensing';

import styles from './LicenseCard.module.css';

export function LicenseCard(): JSX.Element {
  const status = useLicenseStore(licenseSelectors.status);
  const fingerprint = useLicenseStore(licenseSelectors.machineFingerprint);
  const loadFingerprint = useLicenseStore((s) => s.loadMachineFingerprint);
  const deactivate = useLicenseStore((s) => s.deactivate);
  const setActiveScreen = useAppStore((s) => s.setActiveScreen);
  const [showFingerprint, setShowFingerprint] = useState(false);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);
  // Phase 4.1: the `kid` of the current
  // license. `null` means "no license" or
  // "failed to verify"; the UI hides the
  // Refresh from IAP button in those cases.
  // We only care about the value `"iap-local"`
  // for the button visibility.
  const [licenseKid, setLicenseKid] = useState<
    'trial' | 'offline' | 'iap-local' | null
  >(null);
  const [iapRefreshError, setIapRefreshError] = useState<string | null>(null);

  // Fetch the `kid` on mount + whenever the
  // status changes (e.g. after a deactivate /
  // activate cycle).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const kid = await licenseGetKid();
      if (!cancelled) {
        setLicenseKid(kid);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

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

  // Phase 3: navigate to the License activation
  // screen's transfer flow. The full transfer
  // wizard lives on the License screen (not in
  // the card) because the wizard needs a multi-
  // step layout that doesn't fit a settings card.
  const handleTransfer = useCallback((): void => {
    setActiveScreen('license');
  }, [setActiveScreen]);

  // Phase 4.1: navigate to the License
  // activation screen's IAP refresh flow.
  // The full refresh wizard (paste the new
  // receipt, see the new expiration, confirm)
  // lives on the License screen for the same
  // reason as the transfer flow.
  const handleRefreshIap = useCallback((): void => {
    setIapRefreshError(null);
    setActiveScreen('license');
  }, [setActiveScreen]);

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
        {/* Phase 3: "Transfer to a new machine".
            Navigates to the License activation
            screen where the transfer wizard lives.
            Available for any non-empty license
            (trial, active, grace period) — there's
            nothing to transfer for an unactivated
            state (the user just hasn't activated
            yet; "transfer" is a no-op there). */}
        {(status.kind === 'active' || status.kind === 'trial' || status.kind === 'gracePeriod') && (
          <Button variant="ghost" size="sm" onClick={handleTransfer}>
            Transfer to a new machine
          </Button>
        )}
        {/* Phase 4.1: "Refresh from IAP" button.
            Only visible for IAP-issued licenses
            (kid === "iap-local"). The full
            refresh wizard (paste the new
            receipt, see the new expiration,
            confirm) lives on the License
            activation screen. This button
            navigates there. */}
        {licenseKid === 'iap-local' && status.kind === 'active' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefreshIap}
          >
            Refresh from IAP
          </Button>
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

      {iapRefreshError && (
        <p className={styles.error} role="alert">
          {iapRefreshError}
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
  // IAP-specific reasons (Phase 4). The `iap-` prefix is the convention;
  // the rest of the reason is a short code that maps to a user-friendly
  // message. The fallback ("License invalid — <reason>") is the last
  // resort; we aim to cover every iap-* reason in the ifs above.
  if (reason.includes('iap-receipt-format-unrecognized')) {
    return "We couldn't recognize the receipt format. Please paste a license key instead (the receipt format depends on the App Store / Microsoft Store; the easiest path is to email licensing@lipi.ide to get a key).";
  }
  if (reason.includes('iap-malformed-response')) {
    return 'The receipt server returned an unexpected response. Please try again, or paste a license key instead.';
  }
  if (reason.includes('iap-sandbox-not-supported')) {
    return 'This receipt is a TestFlight / sandbox receipt. Phase 4 only supports production receipts. Please request a production license key from licensing@lipi.ide.';
  }
  if (reason.includes('iap-rejected-by-apple') || reason.includes('iap-rejected-by-microsoft')) {
    return 'The receipt was rejected by the store. Please contact support with the receipt details.';
  }
  if (reason.includes('iap-no-purchase-found')) {
    return "The receipt is valid but has no in-app purchases. Did you mean to paste a license key?";
  }
  if (reason.includes('iap-product-id-mismatch') || reason.includes('iap-plan-mismatch')) {
    return 'This receipt is for a different plan. Use the matching Restore button (e.g. if you have a yearly receipt, click "Restore yearly").';
  }
  if (reason.includes('iap-product-id-unknown')) {
    return "Internal error: the receipt's product ID doesn't match any known plan. Please file a bug.";
  }
  if (reason.includes('iap-expired')) {
    return 'Your subscription has expired. Please renew at the pricing page, or paste a license key instead.';
  }
  if (reason.includes('iap-future-purchase')) {
    return "The receipt's purchase date is in the future. Please check your system clock and try again.";
  }
  if (reason.includes('iap-network-error')) {
    return "Couldn't reach the receipt server. Please try again, or paste a license key instead.";
  }
  if (reason.includes('iap-shared-secret-missing') || reason.includes('iap-azure-credentials-missing')) {
    return 'IAP is not configured in this build. Please paste a license key instead (request one from licensing@lipi.ide).';
  }
  if (reason.includes('iap-oauth-failed')) {
    return 'Microsoft Store authentication failed. Please try again, or paste a license key instead.';
  }
  if (reason.includes('iap-unknown-plan')) {
    return "Unknown plan. Use 'monthly' or 'yearly'.";
  }
  if (reason.includes('iap-keychain-error')) {
    return "Couldn't access the keychain. Please check the OS keychain permissions for Lipi.";
  }
  if (reason.includes('iap-sign-failed') || reason.includes('iap-save-failed') || reason.includes('license-shape-invalid')) {
    return 'Internal error during IAP redemption. Please file a bug with the receipt details.';
  }
  if (reason.includes('iap-not-yet-implemented')) {
    // Backward-compat with the Phase 3 stub.
    return 'IAP is coming in a future update. For now, please paste a license key (request one from licensing@lipi.ide).';
  }
  // Phase 4.1 (IAP v1.1 follow-ups): reasons
  // specific to the `iap_refresh_license`
  // command.
  if (reason.includes('iap-refresh-not-applicable')) {
    return 'The "Refresh from IAP" command only works for IAP-issued licenses. For trial or offline-purchase licenses, use the existing license activation flow (paste a license key).';
  }
  if (reason.includes('iap-refresh-no-extension')) {
    return "The new receipt's expiration is not later than the current license's. The license was not updated. If you renewed, please wait a few minutes for the receipt to propagate and try again.";
  }
  if (reason.includes('iap-license-missing')) {
    return 'No license found in the keychain. Use the Restore from IAP button to redeem a fresh receipt.';
  }
  if (reason.includes('iap-license-invalid')) {
    return 'The existing license is invalid (signature mismatch or corrupted). Please deactivate and re-activate.';
  }
  if (reason.includes('iap-license-load-failed')) {
    return "Couldn't read the existing license from the keychain. Please check the OS keychain permissions for Lipi.";
  }
  if (reason.includes('iap-refresh-failed')) {
    return 'The new receipt did not produce an active license. Please try again, or paste a license key instead.';
  }
  return `License invalid — ${reason}`;
}

function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
