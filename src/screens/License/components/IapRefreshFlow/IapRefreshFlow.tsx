/**
 * IapRefreshFlow — the "Refresh from IAP" wizard
 * on the License activation screen.
 *
 * Phase 4.1 (IAP v1.1 follow-ups). A 3-step
 * wizard that walks the user through pasting
 * a fresh IAP receipt to extend the expiration
 * of their IAP-issued license (e.g. after
 * renewing their subscription).
 *
 *   - Step 1: Paste the new receipt. The user
 *     enters the receipt text + selects the
 *     plan (monthly or yearly). The wizard
 *     explains the constraints ("this only
 *     works for IAP-issued licenses", "the
 *     new receipt's expiration must be later
 *     than the current license's").
 *   - Step 2: Running. The wizard calls
 *     `iapRefreshLicense`. The button shows
 *     a spinner.
 *   - Step 3: Result. The wizard shows the
 *     new expiration date and asks the user
 *     to restart the app (or refresh the
 *     license status).
 *
 * The wizard is a pure React component; the
 * actual refresh goes through the
 * `iapRefreshLicense` IPC call (defined in
 * `src/ipc/iap.ts`).
 */
import { useCallback, useState } from 'react';

import { Button } from '@/shared/components/Button';
import { Stack } from '@/shared/components/Stack/Stack';
import { iapRefreshLicense } from '@/ipc/iap';
import { useLicenseStore, licenseSelectors } from '@/shared/state/licenseStore';

import styles from './IapRefreshFlow.module.css';

type Step = 'paste' | 'running' | 'result';

type Plan = 'monthly' | 'yearly';

interface IapRefreshResult {
  newExpiresAt: number;
  newDaysRemaining: number;
  plan: Plan;
}

export function IapRefreshFlow(): JSX.Element {
  const [step, setStep] = useState<Step>('paste');
  const [receipt, setReceipt] = useState('');
  const [plan, setPlan] = useState<Plan>('monthly');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IapRefreshResult | null>(null);
  const status = useLicenseStore(licenseSelectors.status);
  const refreshStatus = useLicenseStore((s) => s.refresh);

  const handlePaste = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setReceipt(e.target.value);
  }, []);

  const handlePlanChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>): void => {
    const value = e.target.value as Plan;
    if (value === 'monthly' || value === 'yearly') {
      setPlan(value);
    }
  }, []);

  const handleStart = useCallback((): void => {
    setStep('paste');
    setError(null);
    setResult(null);
  }, []);

  const handleRefresh = useCallback(async (): Promise<void> => {
    if (receipt.trim().length === 0) {
      setError('Please paste a receipt first.');
      return;
    }
    setStep('running');
    setError(null);
    try {
      const newStatus = await iapRefreshLicense(receipt, plan);
      if (newStatus.kind === 'active') {
        setResult({
          newExpiresAt: newStatus.expiresAt,
          newDaysRemaining: newStatus.daysRemaining,
          plan,
        });
        // Refresh the local license status so
        // the card updates without a manual
        // reload.
        await refreshStatus();
        setStep('result');
      } else if (newStatus.kind === 'invalid') {
        setError(newStatus.reason);
        setStep('paste');
      } else {
        setError(`Unexpected status: ${newStatus.kind}`);
        setStep('paste');
      }
    } catch (err) {
      setError(String(err));
      setStep('paste');
    }
  }, [receipt, plan, refreshStatus]);

  const handleCancel = useCallback((): void => {
    setStep('paste');
    setError(null);
  }, []);

  if (step === 'paste') {
    const currentExp =
      status && (status.kind === 'active' || status.kind === 'gracePeriod' || status.kind === 'expired')
        ? status.kind === 'active'
          ? status.expiresAt
          : status.kind === 'gracePeriod'
            ? status.expiredAt
            : status.expiredAt
        : null;
    return (
      <section className={styles.flow} aria-labelledby="lipi-iap-refresh-paste-title">
        <h2 id="lipi-iap-refresh-paste-title" className={styles.title}>
          Refresh from IAP
        </h2>
        <p className={styles.lede}>
          Use this if you renewed your IAP subscription and want Lipi to pick up
          the new expiration date without re-activating. Paste a fresh receipt
          from the App Store or Microsoft Store below.
        </p>
        {currentExp !== null && (
          <p className={styles.lede}>
            Current expiration: <code>{new Date(currentExp * 1000).toISOString().slice(0, 10)}</code>
            {' '}(the new receipt must be later than this).
          </p>
        )}
        <label className={styles.fieldLabel} htmlFor="lipi-iap-refresh-receipt">
          IAP receipt
        </label>
        <textarea
          id="lipi-iap-refresh-receipt"
          className={styles.receiptInput}
          value={receipt}
          onChange={handlePaste}
          rows={6}
          aria-label="IAP receipt"
          placeholder="Paste the receipt JSON (Apple) or XML (Microsoft) here"
        />
        <label className={styles.fieldLabel} htmlFor="lipi-iap-refresh-plan">
          Plan
        </label>
        <select
          id="lipi-iap-refresh-plan"
          className={styles.planSelect}
          value={plan}
          onChange={handlePlanChange}
          aria-label="Plan"
        >
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <Stack direction="row" gap={2} className={styles.actions}>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleRefresh()}
            disabled={receipt.trim().length === 0}
          >
            Refresh
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
        <h2 className={styles.title}>Refreshing license…</h2>
        <p className={styles.lede}>
          Re-validating your IAP receipt with the App Store / Microsoft Store.
        </p>
      </section>
    );
  }

  // step === 'result'
  if (!result) {
    return (
      <section className={styles.flow}>
        <h2 className={styles.title}>Refresh complete</h2>
        <p className={styles.lede}>
          Your license has been updated. Return to Settings to see the new
          expiration date.
        </p>
      </section>
    );
  }
  const newDate = new Date(result.newExpiresAt * 1000).toISOString().slice(0, 10);
  return (
    <section className={styles.flow} aria-labelledby="lipi-iap-refresh-result-title">
      <h2 id="lipi-iap-refresh-result-title" className={styles.title}>
        License refreshed
      </h2>
      <p className={styles.lede}>
        Your {result.plan} license has been updated. New expiration:{' '}
        <code>{newDate}</code> ({result.newDaysRemaining} days remaining).
      </p>
      <Stack direction="row" gap={2} className={styles.actions}>
        <Button variant="primary" size="sm" onClick={handleStart}>
          Refresh again
        </Button>
      </Stack>
    </section>
  );
}
