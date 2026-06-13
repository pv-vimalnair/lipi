/**
 * PrivacyDataCard — Settings "Privacy & data" section
 * with the S2 export/import buttons, now
 * S3-wired.
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
 * Phase S3 adds the **transactional apply** and
 * the **import preview**:
 *
 *   - The apply is now `applyLipiStateV3`
 *     (snapshot all three stores → apply →
 *     restore-on-failure), per Decision #63.
 *     The v2 partial-on-error apply is
 *     preserved on disk as a documented
 *     fallback; this card is the v3 default.
 *
 *   - The import flow is now:
 *       parse → preview → confirm → apply
 *     The preview shows the user what will
 *     change BEFORE they commit. "No changes"
 *     is a valid result (the file is identical
 *     to the current state; the Apply button
 *     is disabled).
 *
 * The privacy scope (no keys, no audit log, no
 * live state) is documented in
 * `LIPI_STATE_V2_PRIVACY_STATEMENT` (a single
 * multi-line string) and rendered in the card
 * above the export/import buttons. The user sees
 * exactly what's in the file *before* they
 * click Export.
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';

import { Button } from '@/shared/components/Button';
import { applyLipiStateV3 } from '@/shared/settingsIOv3.apply';
import { computeLipiStateImportPreview } from '@/shared/settingsIOv3.preview';
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
import { useActivePath, useWorkspaceStore } from '@/shared/state/workspaceStore';

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

/** Pure: a human-friendly line for a single
 *  preview diff row. Used by both the UI
 *  and the tests (so the wording is one
 *  place). */
export function previewDiffLabel(diff: {
  path: string;
  before: unknown;
  after: unknown;
}): string {
  switch (diff.path) {
    case 'workspace.currentPath':
      return `Workspace path: ${stringifyValue(diff.before)} → ${stringifyValue(diff.after)}`;
    case 'workspace.recents': {
      const before = diff.before as { added: string[]; removed: string[] };
      const after = diff.after as { added: string[]; removed: string[] };
      const addedCount = after.added.length;
      const removedCount = before.removed.length;
      const parts: string[] = ['Recents list:'];
      if (addedCount > 0) parts.push(`  +${addedCount} new`);
      if (removedCount > 0) parts.push(`  -${removedCount} removed`);
      return parts.join('\n');
    }
    case 'voicePreferences.provider':
      return `Voice provider: ${diff.before} → ${diff.after}`;
    case 'toolSettings.disabledToolNames': {
      const before = diff.before as { added: string[]; removed: string[] };
      const after = diff.after as { added: string[]; removed: string[] };
      const parts: string[] = ['Disabled tools:'];
      for (const t of after.added) parts.push(`  + ${t}`);
      for (const t of before.removed) parts.push(`  - ${t}`);
      return parts.join('\n');
    }
    default: {
      if (diff.path.startsWith('toolSettings.confirmationMode.')) {
        const tool = diff.path.slice('toolSettings.confirmationMode.'.length);
        return `Tool "${tool}" confirmation: ${stringifyValue(diff.before)} → ${stringifyValue(diff.after)}`;
      }
      return `${diff.path}: ${stringifyValue(diff.before)} → ${stringifyValue(diff.after)}`;
    }
  }
}

function stringifyValue(v: unknown): string {
  if (v === null) return '(none)';
  if (v === undefined) return '(missing)';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
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
    workspace: { currentPath: useActivePath(ws), recents: [...ws.recents] },
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
  // The S3 import-preview state.
  // `null` means "no preview
  // shown" (the user hasn't
  // picked a file, or the file
  // failed to parse). When set,
  // the card renders the preview
  // block above the action row.
  const [pendingImport, setPendingImport] = useState<{
    parsed: LipiStateV2Data;
    preview: ReturnType<typeof computeLipiStateImportPreview>;
  } | null>(null);

  useEffect(() => {
    return () => {
      if (importNoticeTimerRef.current !== null) {
        window.clearTimeout(importNoticeTimerRef.current);
      }
    };
  }, []);

  const showNotice = useCallback((msg: string) => {
    setImportNotice(msg);
    if (importNoticeTimerRef.current !== null) {
      window.clearTimeout(importNoticeTimerRef.current);
    }
    importNoticeTimerRef.current = window.setTimeout(() => {
      setImportNotice(null);
      importNoticeTimerRef.current = null;
    }, 3000);
  }, []);

  const onExport = useCallback(() => {
    setImportError(null);
    setImportNotice(null);
    setPendingImport(null);
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
    showNotice('Exported.');
  }, [showNotice]);

  const onImportFile = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setImportError(null);
    setImportNotice(null);
    setPendingImport(null);
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
      // S3 step 2: show the
      // preview BEFORE asking
      // for confirmation. The
      // user sees a list of
      // changes (or "No
      // changes") and can
      // decide whether to
      // proceed. The apply is
      // destructive; this is
      // the right time to
      // surface the diff.
      const preview = computeLipiStateImportPreview(
        snapshotStoresForExport(),
        parsed.data,
      );
      setPendingImport({ parsed: parsed.data, preview });
    };
    reader.readAsText(file);
  }, []);

  const onConfirmImport = useCallback(() => {
    if (pendingImport === null) return;
    setImportError(null);
    const applied = applyLipiStateV3(pendingImport.parsed);
    setPendingImport(null);
    if (!applied.ok) {
      setImportError(
        `Imported file is valid, but applying it failed (${applied.error.kind}): ${applied.error.message}. Your state was restored to what it was before the import.`,
      );
      return;
    }
    showNotice('Imported.');
  }, [pendingImport, showNotice]);

  const onCancelImport = useCallback(() => {
    setPendingImport(null);
    setImportError(null);
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
      {pendingImport !== null && (
        <div
          className={styles.preview}
          role="region"
          aria-label="Import preview"
          data-testid="lipi-state-import-preview"
        >
          <h4 className={styles.previewTitle}>
            {pendingImport.preview.isNoOp
              ? 'No changes'
              : `${pendingImport.preview.changeCount} change${pendingImport.preview.changeCount === 1 ? '' : 's'} will be applied:`}
          </h4>
          {!pendingImport.preview.isNoOp && (
            <ul className={styles.previewList}>
              {pendingImport.preview.diffs.map((d) => (
                <li
                  key={d.path}
                  className={styles.previewItem}
                  data-path={d.path}
                >
                  <pre className={styles.previewItemBody}>
                    {previewDiffLabel(d)}
                  </pre>
                </li>
              ))}
            </ul>
          )}
          {pendingImport.preview.isNoOp && (
            <p className={styles.previewNoOp}>
              The file is identical to your current state. You can close
              this preview without doing anything.
            </p>
          )}
          <div className={styles.previewActions}>
            <Button
              type="button"
              variant="ghost"
              onClick={onCancelImport}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={onConfirmImport}
              disabled={pendingImport.preview.isNoOp}
              data-testid="lipi-state-apply"
            >
              Apply import
            </Button>
          </div>
        </div>
      )}
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
