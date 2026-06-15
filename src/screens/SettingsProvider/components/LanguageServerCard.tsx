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
import { useCallback, useEffect, useState } from 'react';

import { lspCheckAvailable, type CheckAvailableResult } from '@/ipc/lsp';
import { useWorkspaceStore } from '@/shared/state/workspaceStore';
import { useLspClientStore, type LspStatus } from '@/screens/EditorWorkspace/state/lspClientStore';
import {
  getUseRealServer,
  setUseRealServer,
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
  // The available / install-hint probe.
  const [probe, setProbe] = useState<CheckAvailableResult | null>(null);
  // The kill switch toggle.
  const [useRealServer, setUseRealServerLocal] = useState<boolean>(getUseRealServer());

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

  const handleRestart = useCallback(() => {
    if (!activeWorkspaceRoot) return;
    void useLspClientStore.getState().dispose(activeWorkspaceRoot);
    void useLspClientStore.getState().getOrCreate(activeWorkspaceRoot);
  }, [activeWorkspaceRoot]);

  const badge = BADGE_LABEL[status];

  return (
    <div className={styles.card} data-testid="language-server-card">
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>TypeScript language server</h3>
        <span
          className={`${styles.badge} ${badge.className}`}
          data-testid="lsp-status-badge"
        >
          {badge.label}
        </span>
      </div>
      <p className={styles.cardDescription}>
        Real cross-file go-to-def, find-references, rename, code actions,
        signature help, and inlay hints. Backed by{' '}
        <code>typescript-language-server</code> (the same LSP server
        nvim / helix / zed use).
      </p>
      <p className={styles.statusLine}>{STATUS_BLURB[status]}</p>
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
