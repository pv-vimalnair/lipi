/**
 * PrivacyDataCard — Settings "Privacy & data" section
 * with the S2 export/import buttons, now
 * S3-wired, M6b-upgraded to v4, and M6c-upgraded
 * to v5.
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
 * Phase S3 added the **transactional apply**
 * (`applyLipiStateV3`, snapshot all three
 * stores → apply → restore-on-failure) and
 * the **import preview** (parse → preview →
 * confirm → apply).
 *
 * M6b (June 2026) upgrades the file format
 * to v4 (the multi-workspace-tabs shape):
 * the `workspace` payload is now an array
 * of `WorkspaceTab` objects plus an
 * `activeId`, and each tab carries its own
 * per-tab `state` (file tree expansion /
 * selection / open editor tabs / active
 * editor tab). The v4 apply is also
 * transactional (same S3 design), AND it
 * auto-detects v3 files and runs an
 * in-memory v3 → v4 migration. So a v3
 * import is transparent to the user — the
 * UI surfaces a "this is a v3 file" notice
 * and the rest of the flow is the same.
 *
 * M6c (June 2026) upgrades the file format
 * to v5: each tab's `state` now carries
 * `editorCursorByPath` (per-file cursor
 * memory) and `fileTreeScrollAnchor` (the
 * topmost visible file-tree row's path).
 * v5 accepts v3, v4, and v5 input — the
 * parser auto-migrates v3 to v4 and v4 to
 * v5 in memory. The UI surfaces a notice
 * for v3 and v4 imports so the user knows
 * the per-file cursor and file-tree scroll
 * positions are fresh (not preserved in
 * the source file).
 *
 * The privacy scope (no keys, no audit log,
 * no live state) is documented in
 * `LIPI_STATE_V2_PRIVACY_STATEMENT` (a
 * single multi-line string, re-used by v5)
 * and rendered in the card above the
 * export/import buttons. The user sees
 * exactly what's in the file *before* they
 * click Export.
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';

import { Button } from '@/shared/components/Button';
import { applyLipiStateV5 } from '@/shared/settingsIOv5.apply';
import {
  computeLipiStateV5ImportPreview,
  type LipiStateV5ImportPreview,
} from '@/shared/settingsIOv5.preview';
import {
  buildLipiStateV5,
  LIPI_STATE_V5_FORMAT,
  LIPI_STATE_V5_VERSION,
  parseLipiStateV5,
  serialiseLipiStateV5,
  suggestLipiStateV5Filename,
  type LipiStateV5Data,
  type LipiStateV5ParseError,
} from '@/shared/settingsIOv5';
import { previewDiffLabelV4 } from '@/shared/settingsIOv4.preview';
import { LIPI_STATE_V2_PRIVACY_STATEMENT } from '@/shared/settingsIOv2';

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
export function parseErrorMessage(err: LipiStateV5ParseError): string {
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

/** Build the v5 payload from the live stores.
 *  Lives as a function (not inlined in the
 *  onExport callback) so the test can pin the
 *  shape: any new persisted field added to a
 *  future Lipi version must be added here, and
 *  the omission is caught by the diff in the
 *  test snapshot.
 *
 *  **Cloning**: every array and record
 *  (`workspaces[]`, `recents`,
 *  `disabledToolNames`,
 *  `confirmationMode`, every tab's
 *  `state.expandedDirs` /
 *  `state.openEditorTabPaths` /
 *  `state.editorCursorByPath`) is
 *  shallow-cloned. The serialised JSON
 *  is the export contract; a future caller
 *  that mutates the returned payload
 *  (e.g. redacting a path) must NOT
 *  accidentally mutate the live store.
 *  Pinned by the test in
 *  `PrivacyDataCard.test.ts`.
 *
 *  **M6b**: the `workspace` payload is
 *  now an array of `WorkspaceTab`
 *  objects plus an `activeId` (the v4
 *  shape). Each tab's `state` is
 *  included verbatim (file tree
 *  expansion / selection / open editor
 *  tabs / active editor tab). The
 *  pre-M6b `currentPath` field is
 *  gone.
 *
 *  **M6c**: each tab's `state` now
 *  also carries `editorCursorByPath`
 *  (per-file cursor memory) and
 *  `fileTreeScrollAnchor` (the topmost
 *  visible file-tree row's path). The
 *  `editorCursorByPath` is shallow-cloned
 *  to keep the snapshot independent of
 *  the live store. */
export function snapshotStoresForExport(): LipiStateV5Data {
  const ws = useWorkspaceStore.getState();
  const vp = useVoicePreferencesStore.getState();
  const ts = useToolSettingsStore.getState();
  return {
    workspace: {
      workspaces: ws.workspaces.map((t) => ({
        id: t.id,
        path: t.path,
        addedAt: t.addedAt,
        state: {
          expandedDirs: [...t.state.expandedDirs],
          selectedPath: t.state.selectedPath,
          openEditorTabPaths: [...t.state.openEditorTabPaths],
          activeEditorTabPath: t.state.activeEditorTabPath,
          editorCursorByPath: { ...t.state.editorCursorByPath },
          fileTreeScrollAnchor: t.state.fileTreeScrollAnchor,
        },
      })),
      activeId: ws.activeId,
      recents: [...ws.recents],
    },
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
  // M6b: the `sourceFormat` field
  // tells the UI whether the
  // file was a native v4 (no
  // banner) or a v3 migrated to
  // v4 ("this is a v3 file…
  // importing as v4" banner).
  // M6c: v5 adds the same
  // v3/v4 auto-migrate, plus a
  // native v5 path. A v3 or v4
  // import shows a notice that
  // the per-file cursor /
  // file-tree scroll positions
  // are fresh (not preserved in
  // the source file).
  const [pendingImport, setPendingImport] = useState<{
    parsed: LipiStateV5Data;
    preview: LipiStateV5ImportPreview;
    sourceFormat: 'v3' | 'v4' | 'v5';
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
    const file = buildLipiStateV5(snapshotStoresForExport());
    const json = serialiseLipiStateV5(file);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestLipiStateV5Filename();
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
      const parsed = parseLipiStateV5(text);
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
      const preview = computeLipiStateV5ImportPreview(
        snapshotStoresForExport(),
        parsed.data,
      );
      setPendingImport({
        parsed: parsed.data,
        preview,
        sourceFormat: parsed.sourceFormat,
      });
    };
    reader.readAsText(file);
  }, []);

  const onConfirmImport = useCallback(() => {
    if (pendingImport === null) return;
    setImportError(null);
    const applied = applyLipiStateV5(pendingImport.parsed);
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
      <p className={styles.formatNote}>
        Files use the {LIPI_STATE_V5_FORMAT} v{LIPI_STATE_V5_VERSION} format
        (multi-workspace tabs + per-tab state including per-file cursor
        memory and file-tree scroll anchor). v3 and v4 files are auto-migrated
        on import.
      </p>
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
          {(pendingImport.sourceFormat === 'v3' ||
            pendingImport.sourceFormat === 'v4') && (
            <p
              className={styles.migrationNotice}
              data-testid="lipi-state-migration-notice"
            >
              {pendingImport.sourceFormat === 'v3'
                ? 'This is a v3 file. It will be imported as v5 — the single currentPath becomes one tab with no per-tab state (no file tree expansion, no open editor tabs, no per-file cursor memory, no file-tree scroll anchor). After importing, re-export to save a v5 file.'
                : 'This is a v4 file. It will be imported as v5 — your open editor tabs, file tree expansion, and selection are preserved, but per-file cursor memory and the file-tree scroll anchor are not (those fields were added in v5 and have no v4 equivalent). After importing, re-export to save a v5 file.'}
            </p>
          )}
          {!pendingImport.preview.isNoOp && (
            <ul className={styles.previewList}>
              {pendingImport.preview.diffs.map((d) => (
                <li
                  key={d.path}
                  className={styles.previewItem}
                  data-path={d.path}
                >
                  <pre className={styles.previewItemBody}>
                    {previewDiffLabelV4(d)}
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
