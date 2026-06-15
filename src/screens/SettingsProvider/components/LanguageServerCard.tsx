/**
 * LanguageServerCard — Phase 9 / Phase 9.2e
 * (multi-server).
 *
 * The "Language servers" card under Editor →
 * Language Servers in the Settings screen. Phase
 * 9.2e renders one stacked row per supported
 * LSP kind (`SUPPORTED_LSP_SERVER_KINDS`):
 * `typescript`, `rust_analyzer`, `pyright`.
 * Each row is independent — its own status
 * badge, install hint, kill switch, restart
 * button, server output panel.
 *
 * ## Per-row state
 *
 *   - Status badge (Stopped / Starting /
 *     Ready / Error) — sourced from
 *     `lspClientStore.statusByWorkspace` keyed
 *     by `${workspaceRoot}//${kind}` (the
 *     composite key from Phase 9.2d).
 *   - Install hint — driven by the
 *     `lspCheckAvailable({ serverKind })` IPC
 *     probe.
 *   - "Restart server" button — calls
 *     `respawn(workspaceRoot, kind)`.
 *   - Kill switch — flips the per-kind
 *     `useRealServerByKind[kind]` localStorage
 *     value. On OFF, disposes *just that
 *     kind's* client (Phase 9.2e — Phase 9.2d's
 *     `disposeAllKindsForWorkspace` is no longer
 *     used here).
 *   - "Server output" panel — collapsible,
 *     per-(root, kind) live log.
 *
 * ## Card-level (shared) state
 *
 *   - The Phase 9.6 completion sub-toggle.
 *     Phase 9.2e decided completion is *not*
 *     per-kind — it's a global sub-toggle. If
 *     the user enables completion for the
 *     `typescript` kind, they get it for every
 *     enabled kind. The per-kind kill switch
 *     determines which kinds are enabled at
 *     all; the completion sub-toggle determines
 *     whether the *enabled* kinds' completion
 *     is real-server or built-in.
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
import {
  useLspClientStore,
  parseWorkspaceKindKey,
  workspaceKindKey,
  SUPPORTED_LSP_SERVER_KINDS,
  type LspServerKind,
  type LspStatus,
} from '@/screens/EditorWorkspace/state/lspClientStore';
import {
  getUseRealServer,
  getUseRealServerForCompletion,
  setUseRealServer,
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
    'No server is running for this workspace. Open a matching file to start one.',
  starting:
    'Spawning the child process and running the `initialize` handshake.',
  ready:
    'The language server is connected and feeding Monaco. Go-to-def, find-references, rename, code actions, signature help, and inlay hints are live.',
  error:
    'The server failed to start. The most common cause is the binary not being on PATH — see the install hint below.',
};

/**
 * Human-readable label for each supported
 * kind. Used in the row header + the kill
 * switch label. Picked to be terse but
 * unambiguous (e.g. "TypeScript" is friendlier
 * than `typescript-language-server`; the
 * install hint surfaces the binary name).
 */
const KIND_LABEL: Record<LspServerKind, string> = {
  typescript: 'TypeScript',
  rust_analyzer: 'rust-analyzer',
  pyright: 'pyright',
  unknown: 'Unknown',
};

/**
 * Default install hint per kind — used in the
 * `catch` path of the `lspCheckAvailable`
 * probe (the Rust IPC call failed; we still
 * want to show *something* so the user can
 * install the binary).
 */
const KIND_INSTALL_HINT_FALLBACK: Record<LspServerKind, string> = {
  typescript: 'npm install -g typescript-language-server',
  rust_analyzer: 'rustup component add rust-analyzer',
  pyright: 'npm install -g pyright',
  unknown: '',
};

/**
 * Format a crash time as "Xs ago". Pure
 * helper — the caller passes in `nowMs`
 * (instead of calling `Date.now()` inside)
 * so a single timer tick can drive both
 * this and the "Auto-restarting in Ns…"
 * label without each one calling
 * `Date.now()` separately.
 */
function formatAgo(ms: number, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((nowMs - ms) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

/**
 * Phase 9.3 — the crash-header
 * ("Crashed Xs ago (exit code N) —
 * M in a row. Auto-restarting in Ns…" or
 * "Auto-restart disabled after M crashes —")
 * was previously inlined in
 * `LanguageServerCard` and driven by a
 * `setInterval(…, 1000)` in the card root
 * that re-rendered the *whole* card 1×/sec.
 *
 * Extracted to a sub-component that owns
 * its own 1 Hz ticker. The card no longer
 * re-renders on the timer; only the
 * countdown does. Two wins:
 *
 *   1. **Re-render scope.** The card has
 *      `useEffect`s, derived state, and
 *      several Zustand selectors — a 1 Hz
 *      re-render is cheap but not free. The
 *      sub-component is a few `<span>`s and
 *      re-renders in <1ms.
 *   2. **Clock alignment.** The sub-component
 *      uses a self-rescheduling
 *      `setTimeout(1000 - (Date.now() %
 *      1000))` — the first tick lands on the
 *      next wall-clock second boundary, and
 *      subsequent ticks align to second
 *      boundaries. `setInterval` drifts; the
 *      `setTimeout` chain doesn't.
 *
 * The ticker is **opt-in** — only started
 * when there's a respawn scheduled
 * (`respawnInMs !== null`). When the respawn
 * fires (or is cancelled), the cleanup
 * function returns and the ticker stops.
 * The sub-component itself stays mounted
 * (it just renders `<strong>Crashed Xs
 * ago</strong>` with no countdown suffix
 * when the respawn is null).
 */
// Exported for the Phase 9.3 sub-component
// unit test (RespawnCountdown.test.tsx).
export function RespawnCountdown(props: {
  crashedAt: number;
  respawnInMs: number | null;
  consecutiveCrashes: number;
  exitStatus: number | null;
}) {
  const { crashedAt, respawnInMs, consecutiveCrashes, exitStatus } = props;
  // We render with the *current* time on
  // every tick; the tick is opt-in (only
  // when `respawnInMs !== null`), so the
  // component re-renders the header text
  // 1×/sec while a respawn is pending and
  // is otherwise idle.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    if (respawnInMs === null) return;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      setNowMs(Date.now());
      // Re-schedule aligned to the next
      // wall-clock second boundary.
      const ms = 1000 - (Date.now() % 1000);
      timerId = setTimeout(tick, ms);
    };
    // Kick the first tick on the next
    // boundary (so the "Auto-restarting
    // in Ns…" label stays in sync with
    // wall-clock seconds).
    timerId = setTimeout(tick, 1000 - (Date.now() % 1000));
    return () => {
      if (timerId !== null) clearTimeout(timerId);
    };
  }, [respawnInMs]);
  return (
    <strong>
      Crashed {formatAgo(crashedAt, nowMs)}
      {exitStatus !== null && ` (exit code ${exitStatus})`}
      {consecutiveCrashes > 1 &&
        ` — ${consecutiveCrashes} in a row`}
      .
      {respawnInMs !== null && (
        <span data-testid="lsp-respawn-countdown">
          {' '}
          Auto-restarting in{' '}
          {Math.max(0, Math.ceil(respawnInMs / 1000))}s…
        </span>
      )}
      {respawnInMs === null && consecutiveCrashes >= 5 && (
        <span data-testid="lsp-respawn-giveup">
          {' '}
          Auto-restart disabled after {consecutiveCrashes} consecutive crashes
          — click <em>Restart server</em> to try again.
        </span>
      )}
    </strong>
  );
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

/**
 * Phase 9.2e — one row per supported kind.
 *
 * `LanguageServerCard` renders N of these (one
 * per `SUPPORTED_LSP_SERVER_KINDS`). Each row
 * owns its own:
 *   - Status / crash / output-entry selectors
 *     (keyed by `${workspaceRoot}//${kind}`).
 *   - Install-hint probe.
 *   - Kill switch state (the
 *     `useRealServerByKind[kind]` localStorage
 *     value, mirrored into local `useState`).
 *   - Per-row output-panel UI state
 *     (collapsed/expanded, auto-scroll).
 *
 * The card-level completion sub-toggle and
 * the active-workspace logic live in the
 * parent. Killing a row's switch disposes
 * *only that kind's* client (via
 * `dispose(root, kind)`).
 */
function LanguageServerRow(props: {
  kind: LspServerKind;
  workspaceRoot: string | null;
}) {
  const { kind, workspaceRoot } = props;
  // The composite (root, kind) key. Null
  // when there's no active workspace — the
  // row renders a "no workspace" placeholder
  // in that case.
  const key =
    workspaceRoot !== null
      ? workspaceKindKey(workspaceRoot, kind)
      : null;
  // Per-(root, kind) status from the
  // LspClient store.
  const status = useLspClientStore(
    (s) => (key ? s.statusByWorkspace.get(key) ?? 'stopped' : 'stopped'),
  );
  // Per-(root, kind) crash info.
  const crashInfo = useLspClientStore(
    (s) => (key ? s.crashByWorkspace.get(key) ?? null : null),
  );
  // Per-(root, kind) live server output.
  const outputEntry = useLspClientStore(
    (s) => (key ? s.lspOutputByWorkspace.get(key) ?? null : null),
  );
  // Per-row UI state for the collapsible
  // "Server output" panel.
  const [outputExpanded, setOutputExpanded] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  // Per-row auto-scroll effect — the `pre`
  // ref is per-row, so the effect is
  // per-row too.
  const outputPreNodeRef = useRef<HTMLPreElement | null>(null);
  const outputPreRef = useCallback((node: HTMLPreElement | null) => {
    outputPreNodeRef.current = node;
  }, []);
  useEffect(() => {
    if (!autoScroll) return;
    if (!outputExpanded) return;
    if (!outputPreNodeRef.current) return;
    outputPreNodeRef.current.scrollTop =
      outputPreNodeRef.current.scrollHeight;
  }, [
    autoScroll,
    outputExpanded,
    outputEntry?.lines.length,
    outputEntry?.updatedAt,
  ]);
  // The available / install-hint probe.
  // The effect re-runs when the kind
  // changes (a different row may have a
  // different binary to check).
  const [probe, setProbe] = useState<CheckAvailableResult | null>(null);
  // The per-kind kill switch toggle state.
  // Mirrored into local `useState` so the
  // toggle is responsive to the click.
  const [useRealServer, setUseRealServerLocal] = useState<boolean>(() =>
    getUseRealServer(kind),
  );
  // The fallback install hint for this
  // kind — used in the `catch` path of the
  // probe (Rust IPC unreachable).
  const fallbackInstallHint = KIND_INSTALL_HINT_FALLBACK[kind];

  useEffect(() => {
    let cancelled = false;
    // Skip the probe for `'unknown'` — the
    // bridge never spawns a client for an
    // unknown kind, so there's no binary
    // to check. The row renders the "Open
    // a matching file" status blurb.
    if (kind === 'unknown') {
      setProbe({ available: false, installHint: '', version: null });
      return () => {
        cancelled = true;
      };
    }
    lspCheckAvailable({ serverKind: kind })
      .then((r) => {
        if (!cancelled) setProbe(r);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setProbe({
            available: false,
            installHint: fallbackInstallHint,
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
  }, [kind, fallbackInstallHint]);

  const handleKillSwitchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.checked;
      // Persist the per-kind value (Phase
      // 9.2e). `setUseRealServer(kind, value)`
      // does a read-merge-write on the v2
      // record.
      setUseRealServer(kind, next);
      setUseRealServerLocal(next);
      // If the user just disabled *this
      // kind's* real server, dispose
      // *just this kind's* client. Other
      // kinds (e.g. TS is off, pyright is
      // on) are unaffected. Phase 9.2d's
      // `disposeAllKindsForWorkspace` is no
      // longer used here — the per-kind
      // kill switch is per-kind.
      if (!next && workspaceRoot) {
        void useLspClientStore
          .getState()
          .dispose(workspaceRoot, kind);
      }
    },
    [kind, workspaceRoot],
  );

  const handleRestart = useCallback(() => {
    if (!workspaceRoot) return;
    // `respawn(root, kind)` cancels any
    // pending auto-respawn timer for this
    // kind and resets the
    // `consecutiveCrashes` counter. The
    // per-row button targets *this* kind.
    void useLspClientStore
      .getState()
      .respawn(workspaceRoot, kind);
  }, [workspaceRoot, kind]);

  const badge = BADGE_LABEL[status];
  const crashed = status === 'error' && crashInfo !== null;
  const crashBadge = crashed
    ? {
        label: 'Crashed',
        className: styles.badgeCrashed ?? styles.badgeError,
      }
    : null;

  return (
    <div
      className={styles.row}
      data-testid="lsp-row"
      data-kind={kind}
    >
      <div className={styles.cardHeader}>
        <h4 className={styles.rowTitle}>
          {KIND_LABEL[kind]} language server
        </h4>
        <span
          className={`${styles.badge} ${(crashBadge ?? badge).className}`}
          data-testid="lsp-status-badge"
        >
          {(crashBadge ?? badge).label}
        </span>
      </div>
      <p className={styles.statusLine}>{STATUS_BLURB[status]}</p>
      {crashInfo && (
        <div className={styles.crashPanel} data-testid="lsp-crash-panel">
          <div className={styles.crashHeader}>
            <RespawnCountdown
              crashedAt={crashInfo.crashedAt}
              respawnInMs={crashInfo.respawnInMs}
              consecutiveCrashes={crashInfo.consecutiveCrashes}
              exitStatus={crashInfo.exitStatus}
            />
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
                    `Workspace: ${workspaceRoot}\n` +
                    `Kind: ${kind}\n` +
                    `Exit: ${crashInfo.exitStatus ?? 'unknown'}\n` +
                    `When: ${new Date(crashInfo.crashedAt).toISOString()}\n` +
                    `\n--- stderr ---\n${crashInfo.stderrTail}`,
                )
                .catch(() => {
                  // Clipboard is best-effort.
                });
            }}
            data-testid="lsp-crash-copy"
          >
            Copy diagnostics
          </button>
        </div>
      )}
      {kind !== 'unknown' && !probe?.available && (
        <div className={styles.installHint} data-testid="lsp-install-hint">
          <strong>Not installed.</strong> Run{' '}
          <code>{probe?.installHint ?? fallbackInstallHint}</code>{' '}
          in your shell, then click <em>Restart server</em>. Requires{' '}
          {kind === 'rust_analyzer' ? 'the Rust toolchain' : 'Node.js'} and a{' '}
          <code>PATH</code> entry.
        </div>
      )}
      {kind !== 'unknown' && probe?.available && probe.version && (
        <p className={styles.statusLine} data-testid="lsp-version">
          Server version: {probe.version}
        </p>
      )}
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
                    if (workspaceRoot) {
                      useLspClientStore
                        .getState()
                        .clearLspOutput(workspaceRoot, kind);
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
            data-kind={kind}
          />
          Use built-in for {KIND_LABEL[kind]} instead
        </label>
        <p className={styles.toggleHint}>
          The built-in service is faster on the hot path (autocomplete) and
          doesn&apos;t need {kind === 'rust_analyzer' ? 'a separate server process' : 'Node'}.
          The real server adds cross-file go-to-def, find-references, rename
          with preview, and code actions.
        </p>
      </div>
      {workspaceRoot && status !== 'stopped' && (
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

/**
 * Top-level card. Renders one `LanguageServerRow`
 * per supported kind, plus the global Phase 9.6
 * completion sub-toggle. The card is a thin
 * wrapper — all per-kind state lives in the row.
 */
export function LanguageServerCard() {
  // The active workspace (same source of truth
  // as the rest of the editor). Passed down
  // to each row.
  const activeWorkspaceRoot = useWorkspaceStore((s) =>
    s.activeId ? s.workspaces.find((w) => w.id === s.activeId)?.path ?? null : null,
  );
  // The Phase 9.6 completion sub-toggle is
  // a card-level (global) setting. It's
  // *not* per-kind — see the file header.
  const [
    useRealServerForCompletion,
    setUseRealServerForCompletionLocal,
  ] = useState<boolean>(getUseRealServerForCompletion());
  // The completion sub-toggle is hidden when
  // *every* supported kind is off. If at
  // least one is on, the user is using the
  // real server for at least one kind and
  // the completion sub-toggle is meaningful.
  const anyKindEnabled = SUPPORTED_LSP_SERVER_KINDS.some(
    (k) => k !== 'unknown' && getUseRealServer(k),
  );
  const handleCompletionToggleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.checked;
      setUseRealServerForCompletion(next);
      setUseRealServerForCompletionLocal(next);
    },
    [],
  );

  return (
    <div className={styles.card} data-testid="language-server-card">
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>Language servers</h3>
      </div>
      <p className={styles.cardDescription}>
        Real cross-file go-to-def, find-references, rename, code actions,
        signature help, and inlay hints for the supported languages. Each
        language has its own row; the kill switch is per-language.
      </p>
      {/* Phase 9.2e — one row per supported
          kind. The order is the
          `SUPPORTED_LSP_SERVER_KINDS` order
          (typescript, rust_analyzer,
          pyright). Unknown is filtered out —
          the bridge never spawns a client for
          an unknown kind, so there's nothing
          to render. */}
      <div className={styles.rows} data-testid="lsp-rows">
        {SUPPORTED_LSP_SERVER_KINDS.filter((k) => k !== 'unknown').map(
          (kind) => (
            <LanguageServerRow
              key={kind}
              kind={kind}
              workspaceRoot={activeWorkspaceRoot}
            />
          ),
        )}
      </div>
      {anyKindEnabled && (
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
            Applies to every enabled language server. The real server&apos;s{' '}
            <code>textDocument/completion</code> knows about{' '}
            <code>node_modules</code> types, <code>paths</code> aliases in{' '}
            <code>tsconfig.json</code>, and cross-file imports — but each
            completion is a 50-200&nbsp;ms round-trip vs 5-20&nbsp;ms for the
            built-in. Default is the built-in.
          </p>
        </div>
      )}
    </div>
  );
}

// Re-export for tests that want to assert the
// composite key behaviour in the card's
// `data-kind` / status badge.
export { parseWorkspaceKindKey };
