import { useCallback, type MouseEvent } from 'react';

import { IconButton } from '@/shared/components';

import { useTerminal } from '../../hooks/useTerminal';
import type { TerminalEntry } from '../../state/terminalStore';
import styles from './TerminalTabs.module.css';

/**
 * TerminalTabs — per-session tab strip (Phase 4c).
 *
 * Sits between the panel-level tab bar (Source Control |
 * Terminal in `SidePanelPane`) and the xterm.js mount
 * (in `TerminalPanel`). One row, horizontal scroll on
 * overflow:
 *
 *   [ 1 ✕ ]  [ 2 ✕ ]  [ 3 ✕ ]  +
 *
 * Each tab:
 *   - Shows the session's human index (1-based)
 *   - Has a `×` button to close
 *   - Has a `data-active` attribute when it's the focused
 *     tab (drives the accent underline)
 *   - Has a `data-status` attribute (running / exited /
 *     error) so CSS can dim the exited/error tabs
 *
 * The `+` button at the end spawns a new session.
 *
 * The tab strip and the xterm.js mount are siblings in
 * `TerminalPanel`, not parent-child, so the tab strip can
 * stay rendered even when the xterm mount remounts
 * (which happens when the user switches between sessions).
 */
export function TerminalTabs() {
  const { sessions, activeSessionId, setActive, close, start } = useTerminal();

  const onAdd = useCallback(() => {
    void start();
  }, [start]);

  return (
    <div className={styles.root} role="tablist" aria-label="Terminal sessions">
      {sessions.map((s) => (
        <TerminalTab
          key={s.id}
          entry={s}
          active={s.id === activeSessionId}
          onActivate={() => setActive(s.id)}
          onClose={() => void close(s.id)}
        />
      ))}
      <IconButton
        variant="subtle"
        size="sm"
        className={styles.addButton}
        onClick={onAdd}
        aria-label="Open new terminal"
        title="New terminal"
      >
        +
      </IconButton>
    </div>
  );
}

interface TerminalTabProps {
  entry: TerminalEntry;
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
}

function TerminalTab({ entry, active, onActivate, onClose }: TerminalTabProps) {
  // Stop the close button from also activating the tab.
  const onCloseClick = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      onClose();
    },
    [onClose],
  );

  // For an error session, the "shell" is undefined; show
  // a marker in the tooltip so the user knows what went
  // wrong.
  const tooltip = (() => {
    switch (entry.status.kind) {
      case 'running':
        return entry.status.shell;
      case 'exited':
        return `Exited (code ${entry.status.exitCode ?? 'signal'})`;
      case 'error':
        return `Error: ${entry.status.message}`;
      case 'opening':
        return 'Opening…';
      case 'idle':
        return 'Idle';
    }
  })();

  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={0}
      className={styles.tab}
      data-active={active || undefined}
      data-status={entry.status.kind}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onActivate();
        }
      }}
      title={tooltip}
    >
      <span className={styles.label}>{entry.index}</span>
      <button
        type="button"
        className={styles.closeButton}
        onClick={onCloseClick}
        aria-label={`Close terminal ${entry.index}`}
        title="Close"
      >
        ×
      </button>
    </div>
  );
}
