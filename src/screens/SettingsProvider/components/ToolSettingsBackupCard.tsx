import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Stack } from '@/shared/components/Stack';
import { Button } from '@/shared/components/Button';
import {
  useToolSettingsStore,
  toolSettingsSelectors,
} from '@/shared/state/toolSettingsStore';
import {
  buildSettingsFile,
  parseSettingsFile,
  serialiseSettingsFile,
  suggestFilename,
} from '@/shared/settingsIO';
import styles from '../SettingsProvider.module.css';

export function ToolSettingsBackupCard() {
  const disabledToolNames = useToolSettingsStore(
    toolSettingsSelectors.disabledToolNames,
  );
  const confirmationMode = useToolSettingsStore(
    toolSettingsSelectors.confirmationMode,
  );
  const applyImportedSettings = useToolSettingsStore(
    (s) => s.applyImportedSettings,
  );
  const pendingUndo = useToolSettingsStore((s) => s.pendingUndo);
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
  const onExport = () => {
    setImportError(null);
    setImportNotice(null);
    const file = buildSettingsFile({
      disabledToolNames,
      confirmationMode,
    });
    const json = serialiseSettingsFile(file);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestFilename();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setImportNotice('Exported.');
  };
  const onImportFile = (e: ChangeEvent<HTMLInputElement>) => {
    setImportError(null);
    setImportNotice(null);
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.json')) {
      setImportError(
        'Please pick a .json file exported from Lipi.',
      );
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => {
      setImportError('Could not read the file.');
    };
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const result = parseSettingsFile(text);
      if (!result.ok) {
        setImportError(result.error.message);
        return;
      }
      const beforeState = useToolSettingsStore.getState();
      applyImportedSettings(result.data);
      const afterState = useToolSettingsStore.getState();
      if (afterState.pendingUndo === beforeState.pendingUndo) {
        setImportNotice(
          'No changes — the imported settings match the current ones.',
        );
      } else {
        setImportNotice('Imported. Undo within 5 seconds if needed.');
      }
    };
    reader.readAsText(file);
  };
  useEffect(() => {
    if (!importNotice) return;
    if (importNoticeTimerRef.current !== null) {
      window.clearTimeout(importNoticeTimerRef.current);
    }
    importNoticeTimerRef.current = window.setTimeout(() => {
      setImportNotice(null);
      importNoticeTimerRef.current = null;
    }, 3000);
  }, [importNotice]);
  return (
    <Stack direction="column" gap={3}>
      {pendingUndo && (
        <div
          className={styles.toolSettingsResetUndo}
          role="status"
          aria-live="polite"
          data-testid="tool-settings-backup-undo"
        >
          <span className={styles.toolSettingsResetUndoText}>
            Tool settings updated.
          </span>
          <button
            type="button"
            className={styles.toolSettingsResetUndoButton}
            onClick={() => {
              useToolSettingsStore.getState().undoClearAllSettings();
            }}
            data-testid="tool-settings-backup-undo-button"
          >
            Undo
          </button>
        </div>
      )}
      {importError && (
        <div
          className={styles.toolSettingsBackupError}
          role="alert"
          data-testid="tool-settings-backup-error"
        >
          {importError}
        </div>
      )}
      {importNotice && !importError && (
        <div
          className={styles.toolSettingsBackupNotice}
          role="status"
          aria-live="polite"
          data-testid="tool-settings-backup-notice"
        >
          {importNotice}
        </div>
      )}
      <article
        className={styles.toolSettingsBackupCard}
        data-testid="tool-settings-backup-card"
      >
        <header className={styles.toolSettingsBackupCardHeader}>
          <h3 className={styles.toolSettingsBackupCardTitle}>
            Backup &amp; Restore
          </h3>
        </header>
        <p className={styles.toolSettingsBackupCardDescription}>
          Save your current tool settings to a JSON file, or apply
          one. The file includes which tools are disabled and each
          tool's confirmation policy. It does <em>not</em> include
          your API keys, the activity log, or any per-workspace
          custom tools.
        </p>
        <div className={styles.toolSettingsBackupCardActions}>
          <Button
            variant="primary"
            onClick={onExport}
            data-testid="tool-settings-export-button"
          >
            Export…
          </Button>
          <Button
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
            data-testid="tool-settings-import-button"
          >
            Import…
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={onImportFile}
            className={styles.toolSettingsBackupFileInput}
            aria-label="Import settings file"
            data-testid="tool-settings-import-input"
          />
        </div>
      </article>
    </Stack>
  );
}
