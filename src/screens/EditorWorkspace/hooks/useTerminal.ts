/**
 * useTerminal — multi-session PTY facade over the terminalStore.
 *
 * Phase 4a: pipe only, single session, accumulated output.
 * Phase 4b: live I/O, single session, sink-based output.
 * Phase 4c: multi-session, sink-based output, state lives in
 *           the `terminalStore` (Zustand). This hook is now a
 *           thin facade that adds the IPC `terminal_open` /
 *           `write` / `resize` / `close` calls and the global
 *           event subscription (lazy, on first call).
 *
 * The hook does NOT auto-open. The caller decides when. For
 * the TerminalPanel's "no sessions yet" idle state, the UI
 * shows a `+ New terminal` button that calls `start()`.
 *
 * Per Rule 6, this hook is the ONLY place in the React tree
 * that imports from `@/ipc/terminal`. Components import this
 * hook and the store; they never see `@/ipc` directly.
 */

import { useCallback, useEffect } from 'react';

import {
  terminalClose,
  terminalDefaultShell,
  terminalOpen,
  terminalResize,
  terminalWrite,
  type OpenOptions,
  type OpenResult,
  type TerminalError,
} from '@/ipc';
import { logger } from '@/shared/logger';

import {
  clearSink,
  ensureTerminalEventSubscription,
  setSink,
  useTerminalStore,
  type OutputSink,
  type SessionStatus,
  type TerminalEntry,
} from '../state/terminalStore';

export type { SessionStatus, TerminalEntry, OutputSink };

export interface UseTerminal {
  /** All live sessions, in tab-strip order (oldest → newest). */
  sessions: TerminalEntry[];
  /** The session whose xterm.js mount should be visible. */
  activeSessionId: string | null;
  /** The active session's status. Convenience: callers don't
   *  have to look it up in `sessions`. */
  activeStatus: SessionStatus;
  /** True when at least one session exists. */
  hasSessions: boolean;
  /** Returns the platform's default shell. */
  getDefaultShell: () => Promise<string>;
  /** Spawn a new terminal session. Returns the new session id
   *  on success, or `null` if the IPC call failed. */
  start: (opts?: OpenOptions) => Promise<string | null>;
  /** Close a specific session. Idempotent. */
  close: (sessionId: string) => Promise<void>;
  /** Switch the active tab. */
  setActive: (sessionId: string) => void;
  /** Register / clear the xterm.js output sink for a session.
   *  Pass `null` to clear. */
  setSink: (sessionId: string, sink: OutputSink | null) => void;
  /** Write bytes to a session's stdin. */
  write: (sessionId: string, data: Uint8Array) => Promise<void>;
  /** Resize a session's PTY. */
  resize: (sessionId: string, rows: number, cols: number) => Promise<void>;
}

export function useTerminal(): UseTerminal {
  // Subscribe to the store. The selectors are stable, so
  // re-renders only happen when the selected slice changes.
  const sessions = useTerminalStore((s) => s.sessionOrder
    .map((id) => s.sessions.get(id))
    .filter((e): e is TerminalEntry => e !== undefined));
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const activeStatus: SessionStatus = useTerminalStore((s) => {
    if (!s.activeSessionId) return { kind: 'idle' };
    const entry = s.sessions.get(s.activeSessionId);
    return entry ? entry.status : { kind: 'idle' };
  });
  const hasSessions = useTerminalStore((s) => s.sessionOrder.length > 0);

  // Lazy subscription to the global IPC events. Safe to
  // call from multiple components — `ensureTerminalEventSubscription`
  // is idempotent.
  useEffect(() => {
    ensureTerminalEventSubscription();
  }, []);

  const start = useCallback(
    async (opts: OpenOptions = {}): Promise<string | null> => {
      // Pre-allocate the entry with status `opening` so the
      // tab strip shows a placeholder while the IPC call
      // is in flight. We don't know the new session id
      // until the Rust side returns, so we use a
      // temporary id and rename when the call returns.
      // Simpler: just call the IPC first, then add on
      // success. The tab appears a few ms later; UX is
      // fine because the IPC call is sub-100ms.
      try {
        const result: OpenResult = await terminalOpen(opts);
        const state = useTerminalStore.getState();
        const index = state.sessionOrder.length + 1;
        state.addSession({
          id: result.sessionId,
          status: {
            kind: 'running',
            shell: result.shell,
            rows: result.rows,
            cols: result.cols,
          },
          index,
        });
        return result.sessionId;
      } catch (err) {
        // Surface a synthetic error session so the UI can
        // show "failed to start" in a tab. We use a
        // random id; it never reaches the Rust side.
        const errId = `error-${Date.now().toString(36)}`;
        const message =
          err && typeof err === 'object' && 'message' in err
            ? String((err as { message: unknown }).message)
            : String(err);
        useTerminalStore.getState().addSession({
          id: errId,
          status: { kind: 'error', message },
          index: 0,
        });
        return null;
      }
    },
    [],
  );

  const close = useCallback(async (sessionId: string) => {
    // Optimistic remove from the store (so the tab
    // disappears immediately). The Rust side will emit
    // `terminal://exit` shortly; the listener will
    // try to update the entry but it's already gone —
    // no-op.
    const state = useTerminalStore.getState();
    if (!state.sessions.has(sessionId)) return;
    state.removeSession(sessionId);
    clearSink(sessionId);
    try {
      await terminalClose(sessionId);
    } catch (err) {
      // The session is already closed from the UI's POV;
      // we just log the underlying error.
      const message =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : String(err);
      logger.warn('[useTerminal] close failed for', sessionId, message);
    }
  }, []);

  const setActive = useCallback((sessionId: string) => {
    useTerminalStore.getState().setActive(sessionId);
  }, []);

  const setSinkCallback = useCallback(
    (sessionId: string, sink: OutputSink | null) => {
      if (sink === null) {
        clearSink(sessionId);
      } else {
        setSink(sessionId, sink);
      }
    },
    [],
  );

  const write = useCallback(
    async (sessionId: string, data: Uint8Array) => {
      try {
        await terminalWrite(sessionId, data);
      } catch (err) {
        // Surface as an error status on the session.
        const message =
          err && typeof err === 'object' && 'message' in err
            ? String((err as { message: unknown }).message)
            : String(err);
        useTerminalStore
          .getState()
          .setStatus(sessionId, { kind: 'error', message });
      }
    },
    [],
  );

  const resize = useCallback(
    async (sessionId: string, rows: number, cols: number) => {
      try {
        await terminalResize(sessionId, rows, cols);
        // We deliberately do NOT update the store with the
        // new size — the React tree doesn't render the size
        // anywhere, and xterm.js's own `term.rows` / `term.cols`
        // is the source of truth. Updating the store would
        // cause a re-render of every subscriber for no gain.
      } catch (err) {
        const message =
          err && typeof err === 'object' && 'message' in err
            ? String((err as { message: unknown }).message)
            : String(err);
        useTerminalStore
          .getState()
          .setStatus(sessionId, { kind: 'error', message });
      }
    },
    [],
  );

  const getDefaultShell = useCallback(() => terminalDefaultShell(), []);

  return {
    sessions,
    activeSessionId,
    activeStatus,
    hasSessions,
    getDefaultShell,
    start,
    close,
    setActive,
    setSink: setSinkCallback,
    write,
    resize,
  };
}

export type { TerminalError };
