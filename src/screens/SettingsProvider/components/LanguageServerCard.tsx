/**
 * LanguageServerCard — Phase 9 (Tiniest scope).
 *
 * The "TypeScript language server" card under
 * Editor → Language Servers in the Settings
 * screen. Renders:
 *
 *   1. A status badge (Stopped / Starting /
 *      Ready / Error) sourced from
 *      `lspClientStore.statusByWorkspace`. The
 *      first workspace in `workspaceStore` is
 *      the "current" one (the status card is
 *      per-workspace; we show the active one
 *      in v1 — per-workspace settings live in
 *      the editor-pane status badge).
 *   2. The "Restart server" button (visible when
 *      a server is alive or starting). Calls
 *      `lspClientStore.dispose(workspaceRoot)`
 *      then `getOrCreate(workspaceRoot)`.
 *   3. A toggle: "Use built-in Monaco TS
 *      service instead of
 *      `typescript-language-server`" (the
 *      kill switch). Writes the value to
 *      `localStorage` via the
 *      `lspKillSwitch` utility; the bridge
 *      hook reads it on mount.
 *   4. An install hint panel (visible when
 *      `lspCheckAvailable` returns
 *      `available: false`). Shows the copy-
 *      paste-able `npm install -g
 *      typescript-language-server` command
 *      the user can run in their shell.
 *
 * ## Why a local `useState` (vs. a Zustand field)
 *   for the available / version probe
 *
 * The probe is a one-shot IPC call. It doesn't
 * need to be shared across components. Putting
 * it in a Zustand store would mean a v3
 * `toolSettingsStore` migration for a single
 * field that only this card reads. A `useState`
 * + `useEffect` is the right shape.
 *
 * ## Per-Rule 4 spacing/colors
 *
 * All spacing / colors / typography come from
 * the design tokens in
 * `src/shared/styles/tokens.css` (via the CSS
 * module). No hardcoded hex / px.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { lspCheckAvailable, type CheckAvailableResult } from '@/ipc/lsp';
import { useWorkspaceStore } from '@/shared/state/workspaceStore';
import { useLspClientStore, type LspStatus } from '@/screens/EditorWorkspace/state/lspClientStore';
import {
  getUseRealServer,
  setUseRealServer,
  getUseRealServerForCompletion,
  setUseRealServerForCompletion,
} from '@/screens/EditorWorkspace/state/lspKillSwitch';

import styles from './LanguageServerCard.module.css';

const BADGE_LABEL: Record<LspStatus, { label: string; className: string }> = {
  stopped: { label: 'Stopped', className: styles.badgeStopped },
  starting: { label: 'Starting', className: styles.badgeStarting },
  ready: { label: 'Ready', className: styles.badgeReady },
  error: { label: 'Error', className: styles.badgeError },
};

const STATUS_BLURB: Record<LspStatus, string> = {
  stopped:
    'No server is running for this workspace. Open a TypeScript / JavaScript file to start one.',
  starting:
    'Spawning the `typescript-language-server` child process and running the `initialize` handshake.',
  ready:
    'The language server is connected and feeding Monaco. Go-to-def, find-references, rename, code actions, signature help, and inlay hints are live.',
  error:
    'The server failed to start. The most common cause is `typescript-language-server` not being on PATH — see the install hint below.',
};

/**
 * Format a crash time as "Xs ago". Used in the
 * "Last lines of server output" panel to give
 * the user a quick sense of when the crash
 * happened.
 *
 * The `nowSec` argument is passed in (rather
 * than calling `Date.now()` inside) so the
 * caller can re-render at a fixed cadence via
 * a `useEffect` interval — keeps the label in
 * lockstep with the auto-respawn countdown.
 */
function formatAgo(ms: number, nowSec: number): string {
  const seconds = Math.max(0, nowSec - Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

/**
 * Take the last 100 lines of a stderr tail.
 * Used to keep the diagnostics panel compact
 * even if the child wrote a 1000-line panic
 * backtrace (the buffer is capped at 8 KiB on
 * the Rust side, but a chatty server can
 * produce up to ~1000 lines of 8-byte avg).
 */
function lastNLines(s: string, n: number): string {
  const lines = s.split('\n');
  if (lines.length <= n) return s;
  return lines.slice(-n).join('\n');
}

export function LanguageServerCard() {
  // The active workspace (same source of truth
  // as the rest of the editor).
  const activeWorkspaceRoot = useWorkspaceStore((s) =>
    s.activeId ? s.workspaces.find((w) => w.id === s.activeId)?.path ?? null : null,
  );
  // Per-workspace status from the LspClient store.
  // `useShallow` keeps the selector identity
  // stable when the Map changes by reference
  // (Zustand) but the value for our workspace
  // doesn't change.
  const status = useLspClientStore(
    (s) =>
      (activeWorkspaceRoot
        ? s.statusByWorkspace.get(activeWorkspaceRoot) ?? 'stopped'
        : 'stopped'),
  );
  // Phase 9.5 — per-workspace crash info.
  // `null` when the workspace is healthy
  // (stopped / starting / ready); populated
  // when the child process has crashed at
  // least once since the workspace was last
  // mounted. The "crashed" badge + the
  // "Last lines of server output" panel +
  // the auto-respawn countdown all read
  // from this.
  const crashInfo = useLspClientStore(
    (s) =>
      (activeWorkspaceRoot
        ? s.crashByWorkspace.get(activeWorkspaceRoot) ?? null
        : null),
  );
  // Phase 9.7 — per-workspace live "Server
  // output" panel. Sourced from
  // `lspClientStore.lspOutputByWorkspace`,
  // populated by the `lsp://log` subscription
  // and the one-shot replay drain. `null`
  // when the store has no entry for this
  // workspace (i.e. the child has not
  // produced any output yet AND the user has
  // not opened the panel). The component
  // treats both `null` and `{ lines: [],
  // partialLine: '' }` as "no output yet" so
  // the panel can render an empty state.
  const outputEntry = useLspClientStore(
    (s) =>
      (activeWorkspaceRoot
        ? s.lspOutputByWorkspace.get(activeWorkspaceRoot) ?? null
        : null),
  );
  // Phase 9.7 — UI state for the
  // collapsible "Server output" panel. The
  // panel defaults to collapsed so the
  // settings card stays compact by default;
  // the user can expand it when they're
  // debugging. `autoScroll` defaults to
  // `true` so the panel always tracks the
  // latest line (the common debugging UX).
  const [outputExpanded, setOutputExpanded] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  // Phase 9.5 — re-render every second while
  // a respawn is scheduled, so the
  // "Auto-restarting in Ns..." countdown
  // ticks down. We use a single state field
  // (the current second-since-epoch) so all
  // countdown labels in the card update in
  // lockstep without each one running its
  // own interval.
  const [nowSec, setNowSec] = useState<number>(
    () => Math.floor(Date.now() / 1000),
  );
  useEffect(() => {
    if (!crashInfo?.respawnInMs) return;
    const id = setInterval(() => {
      setNowSec(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [crashInfo?.respawnInMs]);
  // Phase 9.7 — auto-scroll the "Server
  // output" panel to the bottom when new
  // lines arrive. We use a callback ref
  // (not `useRef`) so the ref object is
  // stable across renders and the effect
  // can read it without re-running.
  const outputPreNodeRef = useRef<HTMLPreElement | null>(null);
  const outputPreRef = useCallback((node: HTMLPreElement | null) => {
    outputPreNodeRef.current = node;
  }, []);
  useEffect(() => {
    if (!autoScroll) return;
    if (!outputExpanded) return;
    if (!outputPreNodeRef.current) return;
    // Scroll to the bottom on every line
    // append. The `pre` is a single node;
    // the assignment to `.scrollTop` is
    // cheap (no layout if the height is
    // unchanged).
    outputPreNodeRef.current.scrollTop =
      outputPreNodeRef.current.scrollHeight;
  }, [
    autoScroll,
    outputExpanded,
    outputEntry?.lines.length,
    outputEntry?.updatedAt,
  ]);
  // The available / install-hint probe.
  const [probe, setProbe] = useState<CheckAvailableResult | null>(null);
  // The kill switch toggle.
  const [useRealServer, setUseRealServerLocal] = useState<boolean>(getUseRealServer());
  // Phase 9.6: the completion sub-toggle.
  // Independent of the master kill switch so the
  // user can keep the real server for go-to-def /
  // refs / rename (cross-file-quality matters) but
  // keep the built-in for completion (latency
  // matters). Defaults to `false` (built-in is
  // faster for autocomplete).
  const [
    useRealServerForCompletion,
    setUseRealServerForCompletionLocal,
  ] = useState<boolean>(getUseRealServerForCompletion());

  useEffect(() => {
    let cancelled = false;
    lspCheckAvailable()
      .then((r) => {
        if (!cancelled) setProbe(r);
      })
      .catch((e: unknown) => {
        // The probe is best-effort — if the
        // Rust side is unreachable, just
        // show the install hint.
        if (!cancelled) {
          setProbe({
            available: false,
            installHint: 'npm install -g typescript-language-server',
            version: null,
          });
        }
        if (import.meta.env.DEV) {
          console.warn('[lsp] checkAvailable failed:', e);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleKillSwitchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.checked;
      setUseRealServer(next);
      setUseRealServerLocal(next);
      // If the user just disabled the real
      // server, dispose the live client so
      // the child process is gone. The next
      // time the user re-enables + opens a
      // file, a fresh client will spawn.
      if (!next && activeWorkspaceRoot) {
        void useLspClientStore.getState().dispose(activeWorkspaceRoot);
      }
    },
    [activeWorkspaceRoot],
  );

  /**
   * Phase 9.6 — completion sub-toggle handler.
   * Toggling completion doesn't need to dispose
   * the live client (the LSP session itself is
   * unchanged; only the per-method provider
   * registration changes). The user will see the
   * new completion behaviour on the next file
   * open (the bridge re-reads the toggle and
   * registers / skips the completion provider
   * accordingly).
   */
  const handleCompletionToggleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.checked;
      setUseRealServerForCompletion(next);
      setUseRealServerForCompletionLocal(next);
    },
    [],
  );

  const handleRestart = useCallback(() => {
    if (!activeWorkspaceRoot) return;
    // Phase 9.5 — use the new `respawn` action
    // instead of `dispose` + `getOrCreate`. It
    // cancels any pending auto-respawn timer
    // (so the scheduled respawn doesn't race
    // with the manual one) and resets the
    // `consecutiveCrashes` counter (so a
    // manual restart doesn't burn through the
    // 5-attempt auto-respawn ladder if the
    // user is just testing config changes).
    void useLspClientStore.getState().respawn(activeWorkspaceRoot);
  }, [activeWorkspaceRoot]);

  const badge = BADGE_LABEL[status];
  // Phase 9.5 — when we have crash info AND
  // the status is `error`, override the badge
  // to a "Crashed" label so the user
  // immediately sees the cause. The base
  // `Error` badge is still used for the
  // non-crash error path (spawn failed,
  // `initialize` timeout).
  const crashed = status === 'error' && crashInfo !== null;
  const crashBadge = crashed
    ? {
        label: 'Crashed',
        className: styles.badgeCrashed ?? styles.badgeError,
      }
    : null;

  return (
    <div className={styles.card} data-testid="language-server-card">
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>TypeScript language server</h3>
        <span
          className={`${styles.badge} ${(crashBadge ?? badge).className}`}
          data-testid="lsp-status-badge"
        >
          {(crashBadge ?? badge).label}
        </span>
      </div>
      <p className={styles.cardDescription}>
        Real cross-file go-to-def, find-references, rename, code actions,
        signature help, and inlay hints. Backed by{' '}
        <code>typescript-language-server</code> (the same LSP server
        nvim / helix / zed use).
      </p>
      <p className={styles.statusLine}>{STATUS_BLURB[status]}</p>
      {/* Phase 9.5 — crash diagnostics panel.
          Rendered when the store has crash info
          for this workspace (i.e. the child
          process exited at least once and the
          event listener captured the
          `lsp://crashed` payload). Shows:
            - The "Auto-restarting in Ns..." or
              "Restart failed" countdown (only
              when a respawn is scheduled)
            - The "Last lines of server output"
              panel with the last 100 lines of
              stderr (UTF-8 lossy)
            - A "Copy diagnostics" button so the
              user can paste the full stderr
              into a bug report. */}
      {crashInfo && (
        <div className={styles.crashPanel} data-testid="lsp-crash-panel">
          <div className={styles.crashHeader}>
            <strong>
              Crashed {formatAgo(crashInfo.crashedAt, nowSec)}
              {crashInfo.exitStatus !== null &&
                ` (exit code ${crashInfo.exitStatus})`}
              {crashInfo.consecutiveCrashes > 1 &&
                ` — ${crashInfo.consecutiveCrashes} in a row`}
              .
            </strong>
            {crashInfo.respawnInMs !== null && (
              <span data-testid="lsp-respawn-countdown">
                {' '}
                Auto-restarting in{' '}
                {Math.max(0, Math.ceil(crashInfo.respawnInMs / 1000))}s…
              </span>
            )}
            {crashInfo.respawnInMs === null &&
              crashInfo.consecutiveCrashes >= 5 && (
                <span data-testid="lsp-respawn-giveup">
                  {' '}
                  Auto-restart disabled after {crashInfo.consecutiveCrashes}{' '}
                  consecutive crashes — click <em>Restart server</em> to try
                  again.
                </span>
              )}
          </div>
          {crashInfo.stderrTail && (
            <pre
              className={styles.crashStderr}
              data-testid="lsp-crash-stderr"
            >
              {lastNLines(crashInfo.stderrTail, 100)}
            </pre>
          )}
          <button
            type="button"
            className={styles.crashCopyButton}
            onClick={() => {
              void navigator.clipboard
                .writeText(
                  `lipi LSP crash\n` +
                    `Workspace: ${activeWorkspaceRoot}\n` +
                    `Exit: ${crashInfo.exitStatus ?? 'unknown'}\n` +
                    `When: ${new Date(crashInfo.crashedAt).toISOString()}\n` +
                    `\n--- stderr ---\n${crashInfo.stderrTail}`,
                )
                .catch(() => {
                  // Clipboard is best-effort
                  // (may be blocked in some
                  // iframes / WebView
                  // contexts). The user can
                  // still select the text
                  // manually.
                });
            }}
            data-testid="lsp-crash-copy"
          >
            Copy diagnostics
          </button>
        </div>
      )}
      {!probe?.available && (
        <div className={styles.installHint} data-testid="lsp-install-hint">
          <strong>Not installed.</strong> Run{' '}
          <code>{probe?.installHint ?? 'npm install -g typescript-language-server'}</code>{' '}
          in your shell, then click <em>Restart server</em>. Requires Node.js
          and a <code>PATH</code> entry.
        </div>
      )}
      {probe?.available && probe.version && (
        <p className={styles.statusLine} data-testid="lsp-version">
          Server version: {probe.version}
        </p>
      )}
      {/* Phase 9.7 — live "Server output"
          panel. Hidden when the kill switch
          is on (built-in Monaco TS service —
          there's no server to log). The
          panel is always rendered (even when
          collapsed) so the user can see "0
          lines" / "waiting for output" as a
          sanity check that the server is
          alive. */}
      {useRealServer && (
        <div
          className={styles.outputPanel}
          data-testid="lsp-output-panel"
        >
          <button
            type="button"
            className={styles.outputHeader}
            onClick={() => setOutputExpanded((v) => !v)}
            data-testid="lsp-output-toggle"
          >
            <span className={styles.outputChevron}>
              {outputExpanded ? '▾' : '▸'}
            </span>
            <span>
              <strong>Server output</strong>
              {outputEntry && outputEntry.lines.length > 0 && (
                <span className={styles.outputCount}>
                  {' '}
                  ({outputEntry.lines.length}
                  {outputEntry.maxLines &&
                  outputEntry.lines.length >= outputEntry.maxLines
                    ? '+'
                    : ''}{' '}
                  line
                  {outputEntry.lines.length === 1 ? '' : 's'})
                </span>
              )}
            </span>
          </button>
          {outputExpanded && (
            <>
              <div className={styles.outputToolbar}>
                <label className={styles.outputToolbarLabel}>
                  <input
                    type="checkbox"
                    checked={autoScroll}
                    onChange={(e) =>
                      setAutoScroll(e.target.checked)
                    }
                    data-testid="lsp-output-autoscroll"
                  />
                  Auto-scroll
                </label>
                <button
                  type="button"
                  className={styles.outputClearButton}
                  onClick={() => {
                    if (activeWorkspaceRoot) {
                      useLspClientStore
                        .getState()
                        .clearLspOutput(activeWorkspaceRoot);
                    }
                  }}
                  data-testid="lsp-output-clear"
                >
                  Clear
                </button>
              </div>
              {outputEntry && outputEntry.lines.length > 0 ? (
                <pre
                  className={styles.outputPre}
                  ref={outputPreRef}
                  data-testid="lsp-output-pre"
                >
                  {outputEntry.lines.join('\n')}
                  {outputEntry.partialLine}
                </pre>
              ) : (
                <p
                  className={styles.outputEmpty}
                  data-testid="lsp-output-empty"
                >
                  No output yet. The server logs to stderr on startup
                  and on every parsed file. The panel updates in
                  real-time.
                </p>
              )}
            </>
          )}
        </div>
      )}
      <div className={styles.toggleRow}>
        <label className={styles.toggleLabel}>
          <input
            type="checkbox"
            checked={useRealServer}
            onChange={handleKillSwitchChange}
            data-testid="lsp-kill-switch"
          />
          Use built-in Monaco TS service instead of{' '}
          <code>typescript-language-server</code>
        </label>
        <p className={styles.toggleHint}>
          The built-in service is faster on the hot path (autocomplete) and
          doesn&apos;t need Node. The real server adds cross-file go-to-def,
          find-references, rename with preview, and code actions.
        </p>
      </div>
      {/* Phase 9.6: completion sub-toggle. Only
          meaningful when the master kill switch
          is OFF (i.e. the real server is in use
          for go-to-def / refs / etc.). If the
          master is on (built-in), the
          completion sub-toggle is hidden. */}
      {useRealServer && (
        <div className={styles.toggleRow}>
          <label className={styles.toggleLabel}>
            <input
              type="checkbox"
              checked={useRealServerForCompletion}
              onChange={handleCompletionToggleChange}
              data-testid="lsp-completion-toggle"
            />
            Use real server for completion (slower, smarter)
          </label>
          <p className={styles.toggleHint}>
            The real server&apos;s <code>textDocument/completion</code> knows
            about <code>node_modules</code> types, <code>paths</code>{' '}
            aliases in <code>tsconfig.json</code>, and cross-file imports —
            but each completion is a 50-200&nbsp;ms round-trip vs{' '}
            5-20&nbsp;ms for the built-in. Default is the built-in.
          </p>
        </div>
      )}
      {activeWorkspaceRoot && status !== 'stopped' && (
        <div className={styles.buttonRow}>
          <button
            type="button"
            className={styles.button}
            onClick={handleRestart}
            data-testid="lsp-restart"
          >
            Restart server
          </button>
        </div>
      )}
    </div>
  );
}
