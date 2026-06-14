/**
 * TransferFlow — the "transfer to a new machine" wizard
 * on the License activation screen.
 *
 * Phase 3 (subscription UX). A 3-step wizard that walks
 * the user through deactivating their license on this
 * machine and getting a new one for a new machine.
 *
 *   - Step 1: Confirmation. The user reads the
 *     consequences ("this will deactivate your license
 *     on this machine") and confirms.
 *   - Step 2: Running. The wizard calls
 *     `useLicenseStore.deactivate()`. The button shows
 *     a spinner.
 *   - Step 3: Result. The wizard shows the email
 *     template the user should send to the project
 *     lead, with both fingerprints (old + new) and the
 *     old license key (if any) pre-filled. A "Copy
 *     email to clipboard" button copies the body.
 *
 * The wizard is a pure React component; the actual
 * deactivation goes through `useLicenseStore.deactivate`
 * (which calls the Phase 2 `license_deactivate` IPC).
 *
 * Phase 4.1 (IAP v1.1 follow-ups): if the current
 * license is IAP-issued (kid === "iap-local"), the
 * wizard shows a different message in the result
 * step: IAP licenses can't be transferred (they're
 * bound to a single machine). The user is told
 * to cancel their IAP subscription on this
 * machine and re-subscribe on the new one. The
 * email-generation step is skipped (no email to
 * send). The deactivation still happens (so the
 * IAP local keypair is cleared), but the result
 * step shows the IAP-specific message.
 */
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/shared/components/Button';
import { Stack } from '@/shared/components/Stack/Stack';
import { useLicenseStore, licenseSelectors } from '@/shared/state/licenseStore';
import { licenseGetKid } from '@/ipc/licensing';

import styles from './TransferFlow.module.css';

type Step = 'confirm' | 'running' | 'result';

export function TransferFlow(): JSX.Element {
  const [step, setStep] = useState<Step>('confirm');
  const [error, setError] = useState<string | null>(null);
  const status = useLicenseStore(licenseSelectors.status);
  const machineFingerprint = useLicenseStore(licenseSelectors.machineFingerprint);
  const loadFingerprint = useLicenseStore((s) => s.loadMachineFingerprint);
  const deactivate = useLicenseStore((s) => s.deactivate);
  // Phase 4.1: track the `kid` of the current
  // license. If it's `iap-local`, the result
  // step shows the IAP-specific message.
  const [licenseKid, setLicenseKid] = useState<
    'trial' | 'offline' | 'iap-local' | null
  >(null);

  // Re-fetch the kid on mount + after every
  // status change. The status change covers
  // the deactivation-after-confirm case.
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

  const handleStart = useCallback((): void => {
    setStep('confirm');
    setError(null);
    void loadFingerprint();
  }, [loadFingerprint]);

  const handleConfirm = useCallback(async (): Promise<void> => {
    setStep('running');
    setError(null);
    try {
      await deactivate();
      setStep('result');
    } catch (err) {
      setError(String(err));
      setStep('confirm');
    }
  }, [deactivate]);

  const handleCancel = useCallback((): void => {
    setStep('confirm');
    setError(null);
  }, []);

  const handleCopyEmail = useCallback((): void => {
    const fp = machineFingerprint ?? '<loading fingerprint>';
    const plan = status?.kind === 'active' || status?.kind === 'gracePeriod' || status?.kind === 'expired'
      ? status.plan
      : 'unknown';
    const body = TRANSFER_EMAIL_BODY
      .replace('{PLAN}', plan)
      .replace('{FINGERPRINT}', fp);
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(body).catch(() => {
        // Clipboard write failed (permissions, no HTTPS, etc.);
        // the user can still select-and-copy manually.
      });
    }
  }, [machineFingerprint, status]);

  if (step === 'confirm') {
    return (
      <section className={styles.flow} aria-labelledby="lipi-transfer-confirm-title">
        <h2 id="lipi-transfer-confirm-title" className={styles.title}>
          Transfer to a new machine
        </h2>
        <p className={styles.lede}>
          This will deactivate your license on this machine. To re-activate
          on a new machine, email <a href="mailto:licensing@lipi.ide">licensing@lipi.ide</a>
          with both fingerprints and your original license key. The project lead
          will issue a new key for your new machine within one business day.
        </p>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <Stack direction="row" gap={2} className={styles.actions}>
          <Button variant="danger" size="sm" onClick={() => void handleConfirm()}>
            Yes, deactivate on this machine
          </Button>
          <Button variant="ghost" size="sm" onClick={handleCancel}>
            Cancel
          </Button>
        </Stack>
      </section>
    );
  }

  if (step === 'running') {
    return (
      <section className={styles.flow} aria-busy="true">
        <h2 className={styles.title}>Deactivating…</h2>
        <p className={styles.lede}>Removing your license from this machine's keychain.</p>
      </section>
    );
  }

  // step === 'result'
  //
  // Phase 4.1: for IAP-issued licenses, show a
  // different message — IAP licenses can't be
  // transferred (the IAP receipt was paid on
  // this machine's Apple ID, not the new
  // machine's). The user is told to cancel
  // their IAP subscription on this machine and
  // re-subscribe on the new one. No email to
  // send (the project lead can't help with
  // IAP transfers).
  if (licenseKid === 'iap-local') {
    return (
      <section className={styles.flow} aria-labelledby="lipi-transfer-iap-result-title">
        <h2 id="lipi-transfer-iap-result-title" className={styles.title}>
          IAP licenses can't be transferred
        </h2>
        <p className={styles.lede}>
          Your license has been removed from this machine. IAP licenses are
          bound to a single machine, so you can't re-activate on a new
          machine via transfer. To use Lipi on a new machine, please
          cancel your IAP subscription on this machine (the subscription
          will remain active until the end of the paid period), then
          subscribe again on the new machine.
        </p>
        <p className={styles.lede}>
          Your local license on this machine is no longer valid. If you'd
          like to keep using Lipi on this machine until the end of the
          paid period, please re-activate by pasting a license key (request
          one from <a href="mailto:licensing@lipi.ide">licensing@lipi.ide</a>).
        </p>
        <Stack direction="row" gap={2} className={styles.actions}>
          <Button variant="ghost" size="sm" onClick={handleStart}>
            Done
          </Button>
        </Stack>
      </section>
    );
  }

  // For trial / offline licenses, the existing
  // email-body flow applies.
  const fp = machineFingerprint ?? '<loading fingerprint>';
  const plan = status?.kind === 'active' || status?.kind === 'gracePeriod' || status?.kind === 'expired'
    ? status.plan
    : 'unknown';
  const body = TRANSFER_EMAIL_BODY
    .replace('{PLAN}', plan)
    .replace('{FINGERPRINT}', fp);

  return (
    <section className={styles.flow} aria-labelledby="lipi-transfer-result-title">
      <h2 id="lipi-transfer-result-title" className={styles.title}>
        Your license has been deactivated on this machine
      </h2>
      <p className={styles.lede}>
        To re-activate on a new machine, email the project lead at
        {' '}<a href="mailto:licensing@lipi.ide">licensing@lipi.ide</a> with
        the body below. A new license key will be issued within one business day.
      </p>
      <pre className={styles.emailBody} aria-label="Email body to send to support">
        {body}
      </pre>
      <Stack direction="row" gap={2} className={styles.actions}>
        <Button variant="primary" size="sm" onClick={handleCopyEmail}>
          Copy email to clipboard
        </Button>
        <Button variant="ghost" size="sm" onClick={handleStart}>
          Done
        </Button>
      </Stack>
    </section>
  );
}

const TRANSFER_EMAIL_BODY = `Hi Lipi team,

I'd like to transfer my license to a new machine.

Old machine fingerprint: {FINGERPRINT}
New machine fingerprint: <paste the fingerprint from the License activation screen on your new machine>
Plan: {PLAN}

Thanks!`;
