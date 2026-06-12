/**
 * NativeDictationCard — Settings voice card section that
 * displays the native-dictation plugin contract.
 *
 * Phase NPS. Renders a "Native dictation" subsection
 * under the existing Voice section, with:
 *
 *   - A status badge (`active` / `inert` /
 *     `not-applicable`) sourced from the
 *     `get_native_dictation_contract` IPC.
 *   - A "Plugin contract" collapsible list of every
 *     IPC method the iOS Swift / Android Kotlin
 *     plugin must implement, with its purpose and
 *     signature.
 *   - A "Error kinds" list — the 5 `SttError` kinds
 *     the plugin may emit, with a one-line message
 *     the JS side maps to.
 *   - A pointer to `docs/plugins/lipi-stt-ios/` and
 *     `docs/plugins/lipi-stt-android/` for the
 *     actual Swift / Kotlin contract the future
 *     plugin will fill in.
 *
 * On desktop the card reads `status: 'not-applicable'`
 * and shows a one-line "iOS / Android only" message
 * — the contract list still renders (it's the same
 * 3 methods + 5 error kinds on every platform; the
 * difference is *which* platform's plugin
 * implements it).
 */
import { useEffect, useState } from 'react';

import {
  contractStatusLabel,
  errorKindLabel,
  getNativeDictationContract,
  type ContractStatus,
  type NativeDictationContract,
} from '@/ipc';

import styles from './NativeDictationCard.module.css';

/** The status text the user sees at the top of the
 *  card. Pulled out for testability — the JSX
 *  renders this directly. */
export function nativeDictationStatusBlurb(
  status: ContractStatus,
): string {
  if (status === 'not-applicable') {
    return 'iOS / Android only. The contract below is what the future iOS Swift / Android Kotlin plugins will satisfy.';
  }
  if (status === 'inert') {
    return 'Contract is ready; the Swift / Kotlin plugin binding is not yet implemented. See docs/plugins/lipi-stt-ios/ and lipi-stt-android/.';
  }
  return 'Native dictation is active on this build.';
}

export function NativeDictationCard() {
  const [contract, setContract] = useState<NativeDictationContract | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getNativeDictationContract()
      .then((c) => {
        if (!cancelled) setContract(c);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className={styles.card}>
        <h3 className={styles.title}>Native dictation</h3>
        <p className={styles.errorText}>Could not load contract: {error}</p>
      </div>
    );
  }

  if (!contract) {
    return (
      <div className={styles.card}>
        <h3 className={styles.title}>Native dictation</h3>
        <p className={styles.muted}>Loading contract…</p>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <h3 className={styles.title}>Native dictation</h3>
        <span
          className={styles.statusBadge}
          data-status={contract.status}
          aria-label={`Contract status: ${contractStatusLabel(contract.status)}`}
        >
          {contractStatusLabel(contract.status)}
        </span>
      </div>
      <p className={styles.lede}>{nativeDictationStatusBlurb(contract.status)}</p>

      <details className={styles.contract}>
        <summary className={styles.contractSummary}>
          Plugin contract ({contract.methods.length} methods,{' '}
          {contract.error_kinds.length} error kinds)
        </summary>

        <h4 className={styles.subheading}>IPC methods</h4>
        <ul className={styles.methodList}>
          {contract.methods.map((m) => (
            <li key={m.name} className={styles.methodItem}>
              <code className={styles.methodName}>{m.name}</code>
              <span className={styles.methodPurpose}>{m.purpose}</span>
              <code className={styles.methodSignature}>{m.signature}</code>
            </li>
          ))}
        </ul>

        <h4 className={styles.subheading}>Error kinds</h4>
        <ul className={styles.errorKindList}>
          {contract.error_kinds.map((k) => (
            <li key={k} className={styles.errorKindItem}>
              <code className={styles.errorKindCode}>{k}</code>
              <span className={styles.errorKindMessage}>
                {errorKindLabel(k)}
              </span>
            </li>
          ))}
        </ul>

        <h4 className={styles.subheading}>Events</h4>
        <ul className={styles.eventList}>
          <li className={styles.eventItem}>
            <code className={styles.eventName}>{contract.events.transcript}</code>
            <span className={styles.eventPurpose}>
              transcript events (Swift / Kotlin → JS)
            </span>
          </li>
          <li className={styles.eventItem}>
            <code className={styles.eventName}>{contract.events.error}</code>
            <span className={styles.eventPurpose}>
              error payloads (Swift / Kotlin → JS)
            </span>
          </li>
        </ul>
      </details>

      <p className={styles.foot}>
        Full Swift / Kotlin contracts live in{' '}
        <code>docs/plugins/lipi-stt-ios/README.md</code> and{' '}
        <code>docs/plugins/lipi-stt-android/README.md</code>.
      </p>
    </div>
  );
}
