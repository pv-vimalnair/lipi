import { useEffect, useRef } from 'react';
import { Stack } from '@/shared/components/Stack';
import { Button } from '@/shared/components/Button';
import { useToolSettingsStore } from '@/shared/state/toolSettingsStore';
import styles from '../SettingsProvider.module.css';

export function ToolSettingsResetCard() {
  const pendingUndo = useToolSettingsStore((s) => s.pendingUndo);
  const clearAllSettings = useToolSettingsStore((s) => s.clearAllSettings);
  const undoClearAllSettings = useToolSettingsStore(
    (s) => s.undoClearAllSettings,
  );
  const discardUndoAllSettings = useToolSettingsStore(
    (s) => s.discardUndoAllSettings,
  );
  const UNDO_WINDOW_MS = 5 * 1000;
  const undoTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!pendingUndo) {
      if (undoTimerRef.current !== null) {
        window.clearTimeout(undoTimerRef.current);
        undoTimerRef.current = null;
      }
    }
  }, [pendingUndo]);
  useEffect(() => {
    return () => {
      if (undoTimerRef.current !== null) {
        window.clearTimeout(undoTimerRef.current);
      }
    };
  }, []);
  const onReset = () => {
    clearAllSettings();
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
    }
    undoTimerRef.current = window.setTimeout(() => {
      discardUndoAllSettings();
      undoTimerRef.current = null;
    }, UNDO_WINDOW_MS);
  };
  const onUndo = () => {
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    undoClearAllSettings();
  };
  return (
    <Stack direction="column" gap={3}>
      {pendingUndo && (
        <div
          className={styles.toolSettingsResetUndo}
          role="status"
          aria-live="polite"
          data-testid="tool-settings-reset-undo"
        >
          <span className={styles.toolSettingsResetUndoText}>
            Reset all tool settings to defaults.
          </span>
          <button
            type="button"
            className={styles.toolSettingsResetUndoButton}
            onClick={onUndo}
            data-testid="tool-settings-reset-undo-button"
          >
            Undo
          </button>
        </div>
      )}
      <article
        className={styles.toolSettingsResetCard}
        data-testid="tool-settings-reset-card"
      >
        <header className={styles.toolSettingsResetCardHeader}>
          <h3 className={styles.toolSettingsResetCardTitle}>
            Reset all tool settings
          </h3>
        </header>
        <p className={styles.toolSettingsResetCardDescription}>
          Re-enable every tool and clear every per-tool confirmation
          policy. Every built-in and custom tool becomes available
          to the model with the default confirm-before-running policy. The
          current settings are saved for 5 seconds and you can
          undo from the toast that appears after clicking Reset.
        </p>
        <div className={styles.toolSettingsResetCardActions}>
          <Button
            variant="danger"
            onClick={onReset}
            data-testid="tool-settings-reset-button"
          >
            Reset all
          </Button>
        </div>
      </article>
    </Stack>
  );
}
