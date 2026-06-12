/**
 * PrivacyDataCard — Settings "Privacy & data" section
 * with the S2 v2 export/import buttons.
 *
 * Phase S2. This is the S2 counterpart to the
 * 5b v1 `ToolSettingsBackupCard`. The difference:
 *
 *   - v1 is per-decision (just `toolSettings`)
 *     and lives in the Tool Settings section.
 *   - v2 is full Lipi state (workspace +
 *     voicePreferences + toolSettings) and
 *     lives in a "Privacy & data" section at
 *     the bottom of Settings.
 *
 * The privacy scope (no keys, no audit log, no
 * live state) is documented in
 * `LIPI_STATE_V2_PRIVACY_STATEMENT` (a single
 * multi-line string) and rendered in the card
 * above the export/import buttons. The user sees
 * exactly what's in the file *before* they
 * click Export.
 *
 * The Import button goes through a native
 * confirm dialog because the apply is
 * destructive. We do NOT use a custom modal —
 * a `window.confirm` is enough for a single-
 * click flow and matches the 5b v1 pattern.
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';

import { Button } from '@/shared/components/Button';
import { applyLipiStateV2 } from '@/shared/settingsIOv2.apply';
import {
  buildLipiStateV2,
  LIPI_STATE_V2_PRIVACY_STATEMENT,
  parseLipiStateV2,
  serialiseLipiStateV2,
  suggestLipiStateV2Filename,
  type LipiStateV2Data,
  type LipiStateV2ParseError,
} from '@/shared/settingsIOv2';

import { useToolSettingsStore } from '@/shared/state/toolSettingsStore';
import { useVoicePreferencesStore } from '@/shared/state/voicePreferencesStore';
import { useWorkspaceStore } from '@/shared/state/workspaceStore';

import styles from './PrivacyDataCard.module.css';

/** Pure: human-friendly error message for a
 *  parse error. Pulled out for testability
 *  (and so the message wording is one place,
 *  not duplicated across the two error paths:
 *  the in-page import error and a future
 *  "import via deep-link" path). */
export function parseErrorMessage(err: LipiStateV2ParseError): string {
  switch (err.kind) {
    case 'not-json':
      return `Not valid JSON: ${err.message.replace(/^Not valid JSON: /, '')}`;
    case 'wrong-format':
      return err.message;
    case 'wrong-shape':
      return err.message;
    case 'unsupported-version':
      return err.message;
    case 'invalid-data':
      return err.message;
  }
}

/** Pure: human-friendly text for the "What
 *  this is" lede above the privacy statement. */
export function privacyCardLede(): string {
  return 'Back up your Lipi state to a JSON file you can keep as a backup or copy to another machine. Importing overwrites your current state.';
}

/** Build the v2 payload from the live stores.
 *  Lives as a function (not inlined in the
 *  onExport callback) so the test can pin the
 *  shape: any new persisted field added to a
 *  future Lipi version must be added here, and
 *  the omission is caught by the diff in the
 *  test snapshot.
 *
 *  **Cloning**: the `recents` array, the
 *  `disabledToolNames` array, and the
 *  `confirmationMode` record are all shallow-
 *  cloned. The serialised JSON is the export
 *  contract; a future caller that mutates the
 *  returned payload (e.g. redacting a path)
 *  must NOT accidentally mutate the live
 *  store. Pinned by the test in
 *  `PrivacyDataCard.test.ts`. */
export function snapshotStoresForExport(): LipiStateV2Data {
  const ws = useWorkspaceStore.getState();
  const vp = useVoicePreferencesStore.getState();
  const ts = useToolSettingsStore.getState();
  return {
    workspace: { currentPath: ws.currentPath, recents: [...ws.recents] },
    voicePreferences: { provider: vp.provider },
    toolSettings: {
      disabledToolNames: [...ts.disabledToolNames],
      confirmationMode: { ...ts.confirmationMode },
    },
  };
}

export function PrivacyDataCard() {
  const [importError, setImportError] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const importNoticeTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (importNoticeTimerRef.current !== null) {
        window.clearTimeout(importNoticeTimerRef.current);
      }
    };
  }, []);

  const onExport = useCallback(() => {
    setImportError(null);
    setImportNotice(null);
    const file = buildLipiStateV2(snapshotStoresForExport());
    const json = serialiseLipiStateV2(file);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestLipiStateV2Filename();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setImportNotice('Exported.');
    if (importNoticeTimerRef.current !== null) {
      window.clearTimeout(importNoticeTimerRef.current);
    }
    importNoticeTimerRef.current = window.setTimeout(() => {
      setImportNotice(null);
      importNoticeTimerRef.current = null;
    }, 3000);
  }, []);

  const onImportFile = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setImportError(null);
    setImportNotice(null);
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.json')) {
      setImportError('Please pick a `.json` file.');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => {
      setImportError('Could not read the file.');
    };
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const parsed = parseLipiStateV2(text);
      if (!parsed.ok) {
        setImportError(parseErrorMessage(parsed.error));
        return;
      }
      // Destructive: confirm with the user
      // before overwriting local state.
      // `window.confirm` is the simplest
      // synchronous confirmation and matches
      // the 5b v1 card's pattern.
      const ok = window.confirm(
        'Importing will replace your current workspace, voice provider, and tool settings. ' +
          'This is destructive. Continue?',
      );
      if (!ok) return;
      const applied = applyLipiStateV2(parsed.data);
      if (!applied.ok) {
        setImportError(
          `Imported file is valid, but applying it failed (${applied.error.kind}): ${applied.error.message}`,
        );
        return;
      }
      setImportNotice('Imported.');
      if (importNoticeTimerRef.current !== null) {
        window.clearTimeout(importNoticeTimerRef.current);
      }
      importNoticeTimerRef.current = window.setTimeout(() => {
        setImportNotice(null);
        importNoticeTimerRef.current = null;
      }, 3000);
    };
    reader.readAsText(file);
  }, []);

  return (
    <div className={styles.card}>
      <h3 className={styles.title}>Privacy &amp; data</h3>
      <p className={styles.lede}>{privacyCardLede()}</p>
      <pre className={styles.privacyStatement}>
        {LIPI_STATE_V2_PRIVACY_STATEMENT}
      </pre>
      <div className={styles.actions}>
        <Button type="button" onClick={onExport}>
          Export Lipi state…
        </Button>
        <label className={styles.importLabel}>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className={styles.fileInput}
            onChange={onImportFile}
            data-testid="lipi-state-import-input"
          />
          <span className={styles.importButton}>Import Lipi state…</span>
        </label>
      </div>
      {importNotice && (
        <p className={styles.notice} role="status">
          {importNotice}
        </p>
      )}
      {importError && (
        <p className={styles.error} role="alert">
          {importError}
        </p>
      )}
    </div>
  );
}
