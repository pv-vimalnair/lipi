/**
 * Terminal session state for the EditorWorkspace.
 *
 * Per Rule 3 (screen-folder layout), this store is screen-local —
 * `src/screens/EditorWorkspace/state/`, NOT in `src/shared/`. Only
 * the EditorWorkspace's terminal tab reads session state today.
 *
 * Per Rule 5 (best-practice defaults), the load lifecycle is
 * modelled with a discriminated union so "opening / running /
 * exited / error" states are first-class. We deliberately do NOT
 * use an `isOpening + isRunning + sessions` boolean soup.
 *
 * Per Rule 6 (section isolation), this file owns the data. The
 * `useTerminal` hook in `./hooks/useTerminal.ts` is a thin facade
 * over this store — it adds the IPC `terminal_open` / `write` /
 * `resize` / `close` calls and the event subscription. The
 * `TerminalPanel` and `TerminalTabs` components read selectors
 * and call hook actions.
 *
 * ## Multi-session shape
 *
 * Sessions are keyed by their Rust-side session id (32-char hex).
 * The Rust pipe (`src-tauri/src/terminal.rs`) already supports
 * multiple concurrent sessions — the IPC commands take a
 * `sessionId` parameter and the `TerminalState` is a
 * `HashMap<String, Session>`. 4a only ever used one; 4c adds the
 * tab strip and `+` button to spawn more.
 *
 *   - `sessions: Map<sessionId, TerminalEntry>` — live sessions
 *   - `sessionOrder: sessionId[]` — tab-strip order (insertion
 *     order — newest at the end, matching VS Code)
 *   - `activeSessionId: string | null` — the session whose
 *     xterm.js mount is visible
 *
 * ## Sinks (output forwarding)
 *
 * Sinks are functions, not data, and they change on every mount
 * of an xterm.js wrapper. Storing them in the Zustand state
 * would trigger spurious re-renders and is impossible to
 * serialise. We keep them in a `Map<sessionId, OutputSink>` held
 * in a module-level ref, separate from the store.
 *
 * The global `onTerminalOutput` subscription (started once at
 * module load) demuxes each event to the right sink.
 */

import { create } from 'zustand';

import {
  onTerminalExit,
  onTerminalOutput,
  type TerminalExitEvent,
  type TerminalOutputEvent,
} from '@/ipc';

/** Per-session status. Mirrors the 4a hook's discriminator. */
export type SessionStatus =
  | { kind: 'idle' }
  | { kind: 'opening' }
  | { kind: 'running'; shell: string; rows: number; cols: number }
  | { kind: 'exited'; exitCode: number | null }
  | { kind: 'error'; message: string };

/** What's in the store per session. */
export interface TerminalEntry {
  id: string;
  status: SessionStatus;
  /** Monotonically increasing index; used to derive a
   *  human-readable tab name (e.g. "1", "2", "3"). */
  index: number;
}

/** Callback signature for an xterm.js sink. Same as the
 *  4b hook's `OutputSink` — we re-declare it here so
 *  consumers that import the store don't have to also
 *  import the hook. */
export type OutputSink = (data: Uint8Array) => void;

interface TerminalStoreState {
  sessions: Map<string, TerminalEntry>;
  sessionOrder: string[];
  activeSessionId: string | null;

  // --- Actions (imperative shape, used by the hook) ---
  addSession: (entry: TerminalEntry) => void;
  removeSession: (id: string) => void;
  setStatus: (id: string, status: SessionStatus) => void;
  setActive: (id: string | null) => void;
  /** Internal: reset everything (e.g. on workspace close). */
  reset: () => void;
}

/** Module-level sink registry. Sinks are functions and
 *  change on every xterm.js mount, so they live outside
 *  the store. The `setSink` / `clearSink` helpers are
 *  called by the hook when an xterm.js wrapper mounts /
 *  unmounts. */
const sinks: Map<string, OutputSink> = new Map();

export function setSink(sessionId: string, sink: OutputSink): void {
  sinks.set(sessionId, sink);
}
export function clearSink(sessionId: string): void {
  sinks.delete(sessionId);
}
export function getSink(sessionId: string): OutputSink | undefined {
  return sinks.get(sessionId);
}

export const useTerminalStore = create<TerminalStoreState>((set) => ({
  sessions: new Map(),
  sessionOrder: [],
  activeSessionId: null,

  addSession: (entry) =>
    set((state) => {
      // Re-create the Map so React consumers see a new
      // reference (Zustand uses Object.is to detect changes;
      // mutating the existing Map wouldn't trigger updates).
      const next = new Map(state.sessions);
      next.set(entry.id, entry);
      return {
        sessions: next,
        sessionOrder: [...state.sessionOrder, entry.id],
        // New session always becomes the active one (VS
        // Code behavior). The user explicitly asked for a
        // new tab; they want to see it.
        activeSessionId: entry.id,
      };
    }),

  removeSession: (id) =>
    set((state) => {
      const next = new Map(state.sessions);
      next.delete(id);
      const order = state.sessionOrder.filter((x) => x !== id);
      // If we removed the active session, pick a neighbour
      // from the surviving tabs. Prefer the previous tab in
      // the strip (matching VS Code); fall back to the new
      // last tab; fall back to null if the strip is empty.
      let nextActive = state.activeSessionId;
      if (state.activeSessionId === id) {
        const removedIdx = state.sessionOrder.indexOf(id);
        const candidate = order[removedIdx - 1] ?? order[removedIdx] ?? null;
        nextActive = candidate;
      }
      return {
        sessions: next,
        sessionOrder: order,
        activeSessionId: nextActive,
      };
    }),

  setStatus: (id, status) =>
    set((state) => {
      const entry = state.sessions.get(id);
      if (!entry) return state;
      const next = new Map(state.sessions);
      next.set(id, { ...entry, status });
      return { sessions: next };
    }),

  setActive: (id) => set({ activeSessionId: id }),

  reset: () =>
    set({
      sessions: new Map(),
      sessionOrder: [],
      activeSessionId: null,
    }),
}));

/** Selectors — keep these tiny so components can compose them. */
export const terminalSelectors = {
  sessions: (s: TerminalStoreState): TerminalEntry[] =>
    s.sessionOrder
      .map((id) => s.sessions.get(id))
      .filter((e): e is TerminalEntry => e !== undefined),
  activeSessionId: (s: TerminalStoreState) => s.activeSessionId,
  activeEntry: (s: TerminalStoreState): TerminalEntry | null => {
    if (!s.activeSessionId) return null;
    return s.sessions.get(s.activeSessionId) ?? null;
  },
  hasSessions: (s: TerminalStoreState) => s.sessionOrder.length > 0,
  entry: (id: string) => (s: TerminalStoreState): TerminalEntry | null =>
    s.sessions.get(id) ?? null,
};

// --- One-time global subscription ------------------------------
//
// We subscribe to `terminal://output` and `terminal://exit`
// once at module load (not per hook call) and demux to the
// right sink / store entry. This is the only place in the
// React tree that knows about the IPC events (Rule 6).

let subscribed = false;

export function ensureTerminalEventSubscription(): void {
  if (subscribed) return;
  subscribed = true;

  onTerminalOutput((event: TerminalOutputEvent) => {
    const sink = sinks.get(event.sessionId);
    if (sink) {
      sink(new Uint8Array(event.data));
    }
  }).catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[terminalStore] failed to subscribe to output:', err);
    subscribed = false;
  });

  onTerminalExit((event: TerminalExitEvent) => {
    const state = useTerminalStore.getState();
    const entry = state.sessions.get(event.sessionId);
    if (!entry) return;
    useTerminalStore.getState().setStatus(event.sessionId, {
      kind: 'exited',
      exitCode: event.exitCode,
    });
    clearSink(event.sessionId);
  }).catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[terminalStore] failed to subscribe to exit:', err);
    subscribed = false;
  });
}
