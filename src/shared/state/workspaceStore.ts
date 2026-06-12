/**
 * workspaceStore — the
 * cross-screen source of truth
 * for "which folder is currently
 * open".
 *
 * The Welcome screen reads this
 * to know whether to render the
 * "Open Folder" hero. The
 * EditorWorkspace reads it to
 * know which directory to
 * display in the file tree. The
 * `customToolsStore` listens to
 * it to know which
 * `lipi-tools.json` to read.
 * The Settings screen reads it
 * to show the current path.
 *
 * Per Rule 3 (screen-folder
 * layout), this store lives in
 * `src/shared/state/` because
 * it spans screens. Per Rule 6
 * (section isolation), screens
 * never import each other
 * directly — they all read
 * THIS store.
 *
 * The store persists the
 * workspace path to
 * `localStorage` under
 * `lipi:workspace:v1` so a
 * returning user lands back in
 * their last folder. We also
 * keep a small "recent
 * workspaces" list (most
 * recent first, deduped, capped
 * at 5) so the Welcome screen
 * can offer a one-click
 * re-open. The recents are
 * `localStorage`-backed too
 * (`lipi:workspace:recents:v1`).
 *
 * `hydrated` flips to `true`
 * after the first read from
 * `localStorage`. Before
 * hydration, the store reports
 * `currentPath: null` (the
 * safe "no workspace" state) —
 * the Welcome screen waits for
 * hydration before deciding
 * what to render, so a user
 * with a previously-open
 * folder doesn't see a flash
 * of the Welcome screen.
 *
 * `setStatus` is exposed for
 * transient UI states
 * (opening, error). The store
 * is otherwise an append-only
 * path log.
 */

import { create } from 'zustand';

const STORAGE_KEY_CURRENT = 'lipi:workspace:v1';
const STORAGE_KEY_RECENTS = 'lipi:workspace:recents:v1';
const MAX_RECENTS = 5;

// Re-exported below for
// tests; tests also import
// these as named exports.
export { STORAGE_KEY_CURRENT, STORAGE_KEY_RECENTS, MAX_RECENTS };

export type WorkspaceStatus =
  | { kind: 'idle' }
  | { kind: 'opening' }
  | { kind: 'ready'; path: string }
  | { kind: 'error'; message: string };

interface WorkspaceState {
  /** Whether the store has finished
   * its first `localStorage` read.
   * The Welcome screen waits for
   * this before deciding whether
   * to render the hero or the
   * editor. Default `false`. */
  hydrated: boolean;
  /** The currently-open workspace
   * path, or `null` if no
   * workspace is open. */
  currentPath: string | null;
  /** Last-known recent workspace
   * paths, most recent first.
   * Capped at `MAX_RECENTS`. The
   * Welcome screen renders these
   * as a "Recent" list. */
  recents: string[];
  /** Transient status. The
   * `currentPath` field is the
   * ground truth; `status` is
   * for UI (spinner, error
   * banner). */
  status: WorkspaceStatus;

  /** Read from `localStorage` and
   * set `hydrated` to `true`.
   * Idempotent — calling twice
   * is a no-op. Called once at
   * app startup (from
   * `main.tsx`). */
  hydrate: () => void;
  /** Open a workspace at `path`.
   * Updates `currentPath`,
   * prepends to `recents` (capped
   * at `MAX_RECENTS`, deduped),
   * sets `status: { kind: 'ready'
   * }`, and persists. */
  open: (path: string) => void;
  /** Close the current workspace.
   * Sets `currentPath: null`,
   * `status: { kind: 'idle' }`,
   * persists. The `recents` list
   * is preserved (closing
   * doesn't forget history). */
  close: () => void;
  /** Update the transient status
   * (e.g. show a spinner while
   * the folder picker is open,
   * or an error banner if the
   * chosen folder can't be
   * read). Does NOT change
   * `currentPath` or persist. */
  setStatus: (status: WorkspaceStatus) => void;
  /** Manually clear the recents
   * list. Used by a future
   * "Clear recent workspaces"
   * button in the Welcome
   * screen (not yet wired). */
  clearRecents: () => void;
  /** Remove a single path from
   * the recents list and
   * persist. Does NOT change
   * `currentPath` — if the
   * user is currently in the
   * path they're removing,
   * the editor stays open.
   * The recents list is purely
   * "places you've been"; the
   * open workspace is a
   * separate concern. No-op
   * if the path is not in
   * the list. */
  removeRecent: (path: string) => void;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch {
    // Corrupt JSON. Drop the
    // entry rather than throw —
    // the user's workspace
    // should not be lost
    // because of a single
    // bad key.
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // Quota exceeded, private
    // mode, etc. Persistence is
    // best-effort — log + move
    // on. The in-memory store
    // still works for this
    // session.
    if (import.meta.env.DEV) {
      console.warn(`[workspaceStore] failed to persist ${key}`, value, e);
    }
  }
}

function dedupAndCap(paths: string[], newest: string): string[] {
  // Move `newest` to the front,
  // deduping any prior copy,
  // cap at MAX_RECENTS.
  const filtered = paths.filter((p) => p !== newest);
  return [newest, ...filtered].slice(0, MAX_RECENTS);
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  hydrated: false,
  currentPath: null,
  recents: [],
  status: { kind: 'idle' },
  hydrate: () => {
    if (get().hydrated) return;
    const currentRaw = readJson<unknown>(STORAGE_KEY_CURRENT);
    // Validate the shape
    // of the persisted
    // values. We trust
    // `localStorage` to
    // return a string (or
    // null) at the API
    // boundary, but we
    // can't trust the
    // contents of that
    // string to be a
    // string|number. The
    // most we can validate
    // here is that it's
    // either `null` or a
    // string.
    const current: string | null =
      typeof currentRaw === 'string' ? currentRaw : null;
    const recentsRaw = readJson<unknown>(STORAGE_KEY_RECENTS);
    const recents: string[] = Array.isArray(recentsRaw)
      ? recentsRaw.filter((r): r is string => typeof r === 'string')
      : [];
    set({
      hydrated: true,
      currentPath: current,
      recents,
      // If we hydrated with a
      // saved path, mark the
      // status as ready too —
      // the editor can mount
      // immediately. If the
      // path no longer exists
      // on disk, the editor's
      // first `fs_read_dir`
      // will surface the
      // error and we'll drop
      // back to the Welcome
      // screen.
      status: current ? { kind: 'ready', path: current } : { kind: 'idle' },
    });
  },
  open: (path) => {
    const prevRecents = get().recents;
    const recents = dedupAndCap(prevRecents, path);
    set({
      currentPath: path,
      recents,
      status: { kind: 'ready', path },
    });
    writeJson(STORAGE_KEY_CURRENT, path);
    writeJson(STORAGE_KEY_RECENTS, recents);
  },
  close: () => {
    // We deliberately do NOT
    // remove the closed path
    // from `recents` — the user
    // might want to re-open
    // the same folder later,
    // and "closed" is not
    // "forgotten". We DO
    // clear `currentPath` and
    // the persisted current.
    set({
      currentPath: null,
      status: { kind: 'idle' },
    });
    writeJson(STORAGE_KEY_CURRENT, null);
  },
  setStatus: (status) => set({ status }),
  clearRecents: () => {
    set({ recents: [] });
    writeJson(STORAGE_KEY_RECENTS, []);
  },
  removeRecent: (path) => {
    const { recents } = get();
    if (!recents.includes(path)) return;
    const next = recents.filter((p) => p !== path);
    set({ recents: next });
    writeJson(STORAGE_KEY_RECENTS, next);
  },
}));

/** Selectors — keep these tiny so components can compose them. */
export const workspaceSelectors = {
  hydrated: (s: WorkspaceState) => s.hydrated,
  currentPath: (s: WorkspaceState) => s.currentPath,
  recents: (s: WorkspaceState) => s.recents,
  status: (s: WorkspaceState) => s.status,
};

/** Pure helpers exported for tests + the Welcome screen's
 *  "Remove from recents" UI. The storage keys are re-exported
 *  both as named exports (for the test imports) and as
 *  members of this object (for code that wants all the
 *  internals in one namespace). */
export const workspaceStoreInternals = {
  dedupAndCap,
} as const;
