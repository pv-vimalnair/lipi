import { useEffect, useRef, useState } from 'react';
import { Stack } from '@/shared/components/Stack';
import { Button } from '@/shared/components/Button';
import { useAppStore } from '@/shared/state/appStore';
import { useChatNavStore } from '@/shared/state/chatNavStore';
import { useToolSettingsStore } from '@/shared/state/toolSettingsStore';
import {
  type DecisionRecord,
  useToolDecisionLogStore,
} from '@/shared/state/toolDecisionLogStore';
import styles from '../SettingsProvider.module.css';

const DECISION_VISIBILITY_LIMIT = 50;

export function DecisionLogCards(): JSX.Element {
  const records = useToolDecisionLogStore((s) => s.records);
  const clearLog = useToolDecisionLogStore((s) => s.clearLog);
  const requestJump = useChatNavStore((s) => s.requestJump);
  const setActiveScreen = useAppStore((s) => s.setActiveScreen);
  const lastCleared = useToolDecisionLogStore((s) => s.lastCleared);
  const undoClear = useToolDecisionLogStore((s) => s.undoClear);
  const discardUndo = useToolDecisionLogStore((s) => s.discardUndo);
  const undoTimerRef = useRef<number | null>(null);
  const UNDO_WINDOW_MS = 5 * 1000;
  useEffect(() => {
    return () => {
      if (undoTimerRef.current !== null) {
        window.clearTimeout(undoTimerRef.current);
      }
    };
  }, []);
  const [visibleLimit, setVisibleLimit] = useState(
    DECISION_VISIBILITY_LIMIT,
  );
  const visible = records.slice(0, visibleLimit);
  const hasMore = records.length > visible.length;
  const onClear = () => {
    if (records.length === 0) return;
    clearLog();
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
    }
    undoTimerRef.current = window.setTimeout(() => {
      discardUndo();
      undoTimerRef.current = null;
    }, UNDO_WINDOW_MS);
  };
  const onUndoClear = () => {
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    undoClear();
  };

  const onJump = (record: DecisionRecord) => {
    if (!record.toolCallId) return;
    requestJump({
      messageId: record.assistantMessageId,
      toolCallId: record.toolCallId,
    });
    setActiveScreen('editor');
  };

  const setConfirmationMode = useToolSettingsStore(
    (s) => s.setConfirmationMode,
  );
  const recordDecision = useToolDecisionLogStore(
    (s) => s.recordDecision,
  );
  const onRevert = (record: DecisionRecord) => {
    setConfirmationMode(record.toolName, 'always_confirm');
    recordDecision({
      toolName: record.toolName,
      decision: 'revert',
      argsPreview: '',
      requestId: 'revert',
      assistantMessageId: 'revert',
      toolCallId: 'revert',
    });
  };

  return (
    <Stack direction="column" gap={4}>
      {lastCleared && (
        <div
          className={styles.decisionLogUndo}
          role="status"
          aria-live="polite"
          data-testid="decision-log-undo"
        >
          <span className={styles.decisionLogUndoText}>
            Cleared {lastCleared.length === 1
              ? '1 decision'
              : `${lastCleared.length} decisions`}
            .{' '}
          </span>
          <button
            type="button"
            className={styles.decisionLogUndoButton}
            onClick={onUndoClear}
            data-testid="decision-log-undo-button"
          >
            Undo
          </button>
        </div>
      )}
      {records.length > 0 && (
        <div
          className={styles.decisionLogToolbar}
          data-testid="decision-log-toolbar"
        >
          <span className={styles.decisionLogCount}>
            {records.length === 1
              ? '1 decision'
              : `${records.length} decisions`}
            {records.length >= 500 && ' (cap reached)'}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            data-testid="decision-log-clear"
            data-confirm="danger"
          >
            Clear log
          </Button>
        </div>
      )}
      {records.length === 0 ? (
        <div
          className={styles.placeholder}
          data-testid="decision-log-empty"
        >
          <span>
            No decisions recorded yet. They&apos;ll appear here as
            you use the chat.
          </span>
        </div>
      ) : (
        <>
          {visible.map((r) => (
            <DecisionRow
              key={r.id}
              record={r}
              onJump={() => onJump(r)}
              onRevert={
                r.decision === 'allow_always'
                  ? () => onRevert(r)
                  : undefined
              }
            />
          ))}
          {hasMore && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setVisibleLimit((n) => n + DECISION_VISIBILITY_LIMIT)
              }
              data-testid="decision-log-show-more"
            >
              Show older ({records.length - visible.length} more)
            </Button>
          )}
        </>
      )}
    </Stack>
  );
}

interface DecisionRowProps {
  record: DecisionRecord;
  onJump?: () => void;
  onRevert?: () => void;
}

function DecisionRow({ record, onJump, onRevert }: DecisionRowProps): JSX.Element {
  const jumpable = Boolean(onJump);
  const revertable = Boolean(onRevert);
  return (
    <article
      className={styles.decisionRow}
      data-testid={`decision-row-${record.id}`}
      data-jumpable={jumpable || undefined}
      data-revertable={revertable || undefined}
    >
      <div className={styles.decisionRowActions}>
        {jumpable && (
          <button
            type="button"
            className={styles.decisionRowJump}
            onClick={onJump}
            aria-label={`Jump to ${record.toolName} in chat`}
            data-testid={`decision-row-jump-${record.id}`}
          >
            Jump to chat
          </button>
        )}
        {revertable && (
          <button
            type="button"
            className={styles.decisionRowRevert}
            onClick={onRevert}
            aria-label={`Revert Always-allow for ${record.toolName}`}
            data-testid={`decision-row-revert-${record.id}`}
          >
            Undo
          </button>
        )}
      </div>
      <div className={styles.decisionRowMain}>
        <span
          className={styles.decisionBadge}
          data-decision={record.decision}
          data-testid={`decision-badge-${record.id}`}
        >
          {record.decision === 'deny' && 'Deny'}
          {record.decision === 'allow_once' && 'Run once'}
          {record.decision === 'allow_always' && 'Always allow'}
          {record.decision === 'revert' && 'Reverted'}
        </span>
        <code className={styles.decisionToolName}>
          {record.toolName}
        </code>
        <time
          className={styles.decisionTimestamp}
          dateTime={new Date(record.timestamp).toISOString()}
          title={new Date(record.timestamp).toLocaleString()}
        >
          {formatRelativeTime(record.timestamp)}
        </time>
      </div>
      {record.argsPreview && (
        <details className={styles.decisionArgs}>
          <summary className={styles.decisionArgsSummary}>
            Arguments
          </summary>
          <pre
            className={styles.decisionArgsPre}
            data-testid={`decision-args-${record.id}`}
          >
            {record.argsPreview}
          </pre>
        </details>
      )}
      <div className={styles.decisionMeta}>
        <span className={styles.decisionMetaLabel}>
          Chat message
        </span>
        <code className={styles.decisionMetaValue}>
          {record.assistantMessageId}
        </code>
      </div>
    </article>
  );
}

function formatRelativeTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  if (diff < 0) return 'in the future';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return 'yesterday';
  if (day < 7) return `${day}d ago`;
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
