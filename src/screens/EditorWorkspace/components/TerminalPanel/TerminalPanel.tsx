import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

import { Button } from '@/shared/components';

import { PaneShell } from '../PaneShell';
import { TerminalTabs } from '../TerminalTabs';
import { useTerminal } from '../../hooks/useTerminal';
import type { SessionStatus } from '../../state/terminalStore';
import styles from './TerminalPanel.module.css';

/**
 * TerminalPanel — multi-session terminal view (Phase 4c).
 *
 * Layout (top to bottom inside the side panel):
 *
 *   ┌─ Tab bar (Source Control | Terminal) ─── [ SidePanelPane ]
 *   ├─ PaneShell header (label, hint = active shell, no action)
 *   ├─ TerminalTabs (1, 2, 3, …, +)             [ per-session ]
 *   └─ Body (idle / opening / error / exited / running)
 *
 * First-class states (Rule 5 — discriminated union, no boolean
 * soup). The "running" state is split: it renders the active
 * session's xterm.js mount, keyed by `sessionId` so a tab
 * switch unmounts the old xterm and mounts a fresh one.
 *
 * Per Rule 6, the panel only talks to `useTerminal` and the
 * store. It never imports from `@/ipc/terminal` directly.
 */
export function TerminalPanel() {
  const { activeSessionId, activeStatus, hasSessions, start } = useTerminal();

  return (
    <PaneShell
      label="Terminal"
      hint={
        activeStatus.kind === 'running' ? activeStatus.shell : undefined
      }
      area="side"
    >
      {hasSessions && <TerminalTabs />}
      <Body
        activeSessionId={activeSessionId}
        activeStatus={activeStatus}
        onStart={() => void start()}
      />
    </PaneShell>
  );
}

interface BodyProps {
  activeSessionId: string | null;
  activeStatus: SessionStatus;
  onStart: () => void;
}

function Body({ activeSessionId, activeStatus, onStart }: BodyProps) {
  if (!activeSessionId || activeStatus.kind === 'idle') {
    return (
      <div className={styles.placeholder}>
        <span>No terminal open</span>
        <span className={styles.placeholderHint}>
          Open one to run shell commands.
        </span>
        <div>
          <Button
            variant="primary"
            size="sm"
            onClick={onStart}
            aria-label="Open new terminal"
          >
            + New terminal
          </Button>
        </div>
      </div>
    );
  }

  if (activeStatus.kind === 'opening') {
    return (
      <div className={styles.placeholder}>
        <span>Starting terminal…</span>
      </div>
    );
  }

  if (activeStatus.kind === 'error') {
    return (
      <div className={styles.placeholder} role="alert">
        <span className={styles.errorTitle}>Couldn’t start terminal</span>
        <span className={styles.placeholderHint}>
          {activeStatus.message}
        </span>
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onStart}
            aria-label="Retry opening terminal"
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (activeStatus.kind === 'exited') {
    return (
      <div className={styles.placeholder}>
        <span>Terminal exited</span>
        <span className={styles.placeholderHint}>
          Exit code:{' '}
          <code className={styles.code}>
            {activeStatus.exitCode === null ? 'signal' : activeStatus.exitCode}
          </code>
          . Open a new one to continue.
        </span>
        <div>
          <Button
            variant="primary"
            size="sm"
            onClick={onStart}
            aria-label="Open new terminal"
          >
            + New terminal
          </Button>
        </div>
      </div>
    );
  }

  // activeStatus.kind === 'running'
  return <RunningTerminal sessionId={activeSessionId} />;
}

interface RunningTerminalProps {
  sessionId: string;
}

/**
 * RunningTerminal — the live xterm.js mount for ONE session.
 * Re-mounted (effect re-runs) when the user switches tabs,
 * because we key it by `sessionId` in the parent.
 *
 * The output sink is registered in the store's module-level
 * `sinks` Map (via `setSink`) and the global IPC listener
 * forwards bytes to it. When this component unmounts, we
 * clear the sink so stale output doesn't get written to a
 * disposed xterm.
 */
function RunningTerminal({ sessionId }: RunningTerminalProps) {
  const { setSink, write, resize } = useTerminal();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!wrapperRef.current) return;
    const wrapper = wrapperRef.current;

    const term = new XTerm({
      fontFamily:
        '"Cascadia Code", "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      convertEol: true,
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        cursorAccent: '#1e1e1e',
        selectionBackground: '#264f78',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#ffffff',
      },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(wrapper);
    xtermRef.current = term;
    fitRef.current = fit;

    const textEncoder = new TextEncoder();
    const dataDisposable = term.onData((data) => {
      void write(sessionId, textEncoder.encode(data));
    });

    const ro = new ResizeObserver(() => {
      const f = fitRef.current;
      if (!f) return;
      try {
        f.fit();
        const { rows, cols } = term;
        void resize(sessionId, rows, cols);
      } catch {
        // FitAddon can throw on 0×0 containers; safe to
        // ignore — the next resize will retry.
      }
    });
    ro.observe(wrapper);

    setSink(sessionId, (data) => term.write(data));
    setIsReady(true);

    return () => {
      setIsReady(false);
      setSink(sessionId, null);
      ro.disconnect();
      dataDisposable.dispose();
      term.dispose();
      xtermRef.current = null;
      fitRef.current = null;
    };
  }, [sessionId, setSink, write, resize]);

  return (
    <div
      ref={wrapperRef}
      className={styles.terminalWrapper}
      data-ready={isReady || undefined}
      aria-label="Terminal"
    />
  );
}
