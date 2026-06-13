/**
 * workspaceStore — the cross-screen
 * source of truth for "which folder(s)
 * are currently open".
 *
 * M6a update (June 2026): the store
 * now tracks an ARRAY of open
 * workspaces (a tab model) instead of
 * a single `currentPath`. The
 * `currentPath` field is preserved as
 * a derived read-only selector for
 * backward compatibility with the
 * pre-M6a consumers (see the
 * `useActivePath` helper). New code
 * should read `useActivePath` and the
 * `workspaces` array directly.
 *
 * Each open workspace is a `WorkspaceTab`:
 *   - `id`: a `crypto.randomUUID()` so
 *     the tab is identifiable even
 *     after rename / move.
 *   - `path`: the absolute path on disk.
 *   - `addedAt`: the time the tab was
 *     first added. Used to break ties
 *     in "most recent tab" ordering.
 *
 * Persistence keys (v2 schema, shipped
 * with M6a):
 *   - `lipi:workspace:workspaces:v1` —
 *     the array of tabs.
 *   - `lipi:workspace:activeId:v1` —
 *     the id of the active tab, or
 *     `null` for "no active workspace".
 *   - `lipi:workspace:recents:v1` —
 *     the recents list (unchanged from
 *     the pre-M6a v1 schema).
 *
 * Migration (v1 → v2):
 *   - The pre-M6a persistence wrote
 *     `lipi:workspace:v1` (the
 *     `currentPath` string or `null`)
 *     and `lipi:workspace:recents:v1`.
 *   - On first hydrate after M6a
 *     ships, if the v2 keys are
 *     absent but the v1 keys are
 *     present, the store reads the
 *     v1 values, builds a v2 state
 *     (wrapping `currentPath` in a
 *     single tab), and writes the
 *     v2 keys. The v1 keys are LEFT
 *     IN PLACE — a defensive measure
 *     in case the user has both an
 *     old binary and a new binary
 *     running side-by-side (e.g. a
 *     dev session and a packaged
 *     build). The v1 keys are never
 *     re-written by the new code.
 *
 * `hydrated` flips to `true` after
 * the first read from `localStorage`.
 * Before hydration, the store reports
 * `workspaces: []`, `activeId: null` —
 * the safe "no workspace" state. The
 * Welcome screen and the editor both
 * wait for hydration before deciding
 * what to render.
 *
 * Per Rule 3 (screen-folder layout),
 * this store lives in
 * `src/shared/state/` because it
 * spans screens. Per Rule 6 (section
 * isolation), screens never import
 * each other directly — they all read
 * THIS store.
 */

import { create } from 'zustand';

const STORAGE_KEY_CURRENT_V1 = 'lipi:workspace:v1';
const STORAGE_KEY_RECENTS_V1 = 'lipi:workspace:recents:v1';
const STORAGE_KEY_WORKSPACES_V2 = 'lipi:workspace:workspaces:v1';
const STORAGE_KEY_ACTIVE_ID_V2 = 'lipi:workspace:activeId:v1';
const STORAGE_KEY_RECENTS_V2 = STORAGE_KEY_RECENTS_V1;
const MAX_RECENTS = 5;

// Re-exported below for tests; tests
// also import these as named exports.
export {
  STORAGE_KEY_CURRENT_V1,
  STORAGE_KEY_RECENTS_V1,
  STORAGE_KEY_WORKSPACES_V2,
  STORAGE_KEY_ACTIVE_ID_V2,
  STORAGE_KEY_RECENTS_V2,
  MAX_RECENTS,
};

export type WorkspaceStatus =
  | { kind: 'idle' }
  | { kind: 'opening' }
  | { kind: 'ready'; path: string }
  | { kind: 'error'; message: string };

/**
 * One open workspace tab.
 *
 * The `id` is stable across the
 * tab's lifetime — it's the key
 * the `setActive(id)` /
 * `close(id)` actions use, and
 * it's the value persisted to
 * `localStorage` so a tab can be
 * restored across reloads.
 *
 * The `path` may change in the
 * future (e.g. if a "Move
 * workspace" feature lands), at
 * which point the `id` will
 * stay the same and the
 * `path` will update. Today
 * the `path` is set once on
 * `open` and never changes
 * (a "Move" would be a close +
 * open).
 */
export interface WorkspaceTab {
  id: string;
  path: string;
  addedAt: number;
}

interface WorkspaceState {
  /** Whether the store has finished
   * its first `localStorage` read.
   * The Welcome screen waits for
   * this before deciding whether
   * to render the hero or the
   * editor. Default `false`. */
  hydrated: boolean;
  /**
   * The list of open workspace
   * tabs, in "user-meaningful"
   * order. The order is not
   * significant for the v1
   * strip (the strip renders
   * the tabs in insertion order,
   * most-recently-active
   * highlighted via
   * `activeId`). The
   * `activeId` field is the
   * ground truth for "which
   * tab is the user looking
   * at right now". */
  workspaces: WorkspaceTab[];
  /** The id of the active tab, or
   * `null` for "no active
   * workspace" (i.e. all tabs
   * are closed; the Welcome
   * screen should render). */
  activeId: string | null;
  /** Last-known recent workspace
   * paths, most recent first.
   * Capped at `MAX_RECENTS`. The
   * Welcome screen renders these
   * as a "Recent" list. The
   * recents list is independent
   * of the open tabs — a closed
   * tab's path stays in the
   * recents (so the user can
   * re-open it from the
   * Welcome screen's recents
   * list). */
  recents: string[];
  /** Transient status. The
   * active path (derived via
   * `useActivePath`) is the
   * ground truth; `status` is
   * for UI (spinner, error
   * banner). */
  status: WorkspaceStatus;

  /**
   * Read from `localStorage` and
   * set `hydrated` to `true`.
   * Idempotent — calling twice
   * is a no-op. Called once at
   * app startup (from
   * `main.tsx`). */
  hydrate: () => void;
  /**
   * Open a workspace at `path`.
   *
   * - If `path` is already open as a
   *   tab, make that tab the active
   *   one (no duplicate tab is
   *   added).
   * - Otherwise, add a new tab
   *   with a fresh
   *   `crypto.randomUUID()` and
   *   make it the active tab.
   * - The path is prepended to
   *   `recents` (capped at
   *   `MAX_RECENTS`, deduped),
   *   `status` flips to
   *   `{ kind: 'ready', path }`,
   *   and the new state is
   *   persisted.
   */
  open: (path: string) => void;
  /**
   * Close a workspace tab.
   *
   * - If `tabId` is omitted,
   *   closes the active tab
   *   (i.e. `closeActive()`).
   * - If the closed tab was the
   *   active one, the next tab
   *   to the right is selected;
   *   if there's no tab to the
   *   right, the tab to the left
   *   is selected; if there are
   *   no tabs left, `activeId`
   *   flips to `null` (the
   *   router routes to the
   *   Welcome screen).
   * - The closed tab's path is
   *   preserved in `recents`
   *   (closing is not
   *   forgetting). No-op if
   *   the tab id is not in the
   *   store. */
  close: (tabId?: string) => void;
  /**
   * Switch the active tab.
   * No-op if the tab id is not
   * in the store. */
  setActive: (tabId: string) => void;
  /**
   * Update the transient status
   * (e.g. show a spinner while
   * the folder picker is open,
   * or an error banner if the
   * chosen folder can't be
   * read). Does NOT change
   * `activeId` or persist. */
  setStatus: (status: WorkspaceStatus) => void;
  /** Manually clear the recents
   * list. */
  clearRecents: () => void;
  /** Remove a single path from
   * the recents list and
   * persist. Does NOT change
   * `activeId` — the open
   * workspaces are a separate
   * concern. No-op if the path
   * is not in the list. */
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

function removeJson(key: string): void {
  // Used by the v1 → v2 migration
  // to drop the old `lipi:workspace:v1`
  // key once the new keys are
  // written. The migration is
  // otherwise defensive (it LEAVES
  // the v1 key in place), but a
  // successful write + cleanup
  // pair is cleaner.
  try {
    localStorage.removeItem(key);
  } catch {
    // Same as writeJson —
    // persistence is best-effort.
  }
}

function dedupAndCap(paths: string[], newest: string): string[] {
  // Move `newest` to the front,
  // deduping any prior copy,
  // cap at MAX_RECENTS.
  const filtered = paths.filter((p) => p !== newest);
  return [newest, ...filtered].slice(0, MAX_RECENTS);
}

/**
 * Build a fresh `WorkspaceTab` for
 * `path`. The `id` is a UUID; the
 * `addedAt` is `Date.now()`. Pure
 * (aside from the side effects of
 * `crypto.randomUUID` and
 * `Date.now`, which the test
 * injects via the same module). */
export function createWorkspaceTab(
  path: string,
  id: string = crypto.randomUUID(),
  addedAt: number = Date.now(),
): WorkspaceTab {
  return { id, path, addedAt };
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  hydrated: false,
  workspaces: [],
  activeId: null,
  recents: [],
  status: { kind: 'idle' },

  hydrate: () => {
    if (get().hydrated) return;

    // Step 1: read the v2 keys.
    // If present, use them as-is.
    const workspacesRaw = readJson<unknown>(STORAGE_KEY_WORKSPACES_V2);
    const activeIdRaw = readJson<unknown>(STORAGE_KEY_ACTIVE_ID_V2);
    const recentsRaw = readJson<unknown>(STORAGE_KEY_RECENTS_V2);

    // Validate the v2 shape. The
    // tabs are an array of objects
    // with `{id, path, addedAt}` —
    // any row that doesn't match
    // the shape is dropped, the
    // rest are kept (a single
    // corrupt row from a future
    // version's bug doesn't wipe
    // the whole tab list).
    let workspaces: WorkspaceTab[] = [];
    if (Array.isArray(workspacesRaw)) {
      for (const w of workspacesRaw) {
        if (
          w &&
          typeof w === 'object' &&
          typeof (w as WorkspaceTab).id === 'string' &&
          typeof (w as WorkspaceTab).path === 'string' &&
          typeof (w as WorkspaceTab).addedAt === 'number'
        ) {
          workspaces.push(w as WorkspaceTab);
        }
      }
    }
    // The active id is either a
    // string (matching one of the
    // tab ids) or `null`. If it
    // doesn't match any tab, we
    // silently fall back to the
    // first tab (the user sees
    // their last-open workspace).
    let activeId: string | null = null;
    if (typeof activeIdRaw === 'string') {
      activeId = workspaces.some((w) => w.id === activeIdRaw)
        ? activeIdRaw
        : (workspaces[0]?.id ?? null);
    } else if (activeIdRaw === null) {
      activeId = null;
    } else {
      // The persisted value was
      // neither a string nor null
      // (corrupt). Default to the
      // first tab.
      activeId = workspaces[0]?.id ?? null;
    }
    // If there's no active id but
    // there ARE tabs, the v2
    // writer forgot to update
    // activeId — recover by
    // picking the first tab.
    if (activeId === null && workspaces.length > 0) {
      activeId = workspaces[0].id;
    }

    // Recents are an array of
    // strings. We trust the shape
    // check the same way the v1
    // path did. `let` because
    // the v1 → v2 migration
    // may need to merge in v1
    // recents below.
    let recents: string[] = Array.isArray(recentsRaw)
      ? recentsRaw.filter((r): r is string => typeof r === 'string')
      : [];

    // Step 2: if the v2
    // `workspaces` key is
    // absent, try to migrate
    // from the v1 keys. The
    // recents key alone is not
    // a sufficient signal —
    // the recents key is the
    // SAME between v1 and v2
    // (the persistence
    // format didn't change
    // for it), so its
    // presence is
    // uninformative. The
    // workspaces key is the
    // differentiator: if
    // it's there, we're on
    // v2; if it's not, we
    // try to read the v1
    // `currentPath` key.
    const v2WorkspacesKeyPresent = readJson<unknown>(
      STORAGE_KEY_WORKSPACES_V2,
    ) !== null;
    if (!v2WorkspacesKeyPresent) {
      const v1CurrentRaw = readJson<unknown>(STORAGE_KEY_CURRENT_V1);
      const v1RecentsRaw = readJson<unknown>(STORAGE_KEY_RECENTS_V1);
      const v1Current: string | null =
        typeof v1CurrentRaw === 'string' ? v1CurrentRaw : null;
      const v1Recents: string[] = Array.isArray(v1RecentsRaw)
        ? v1RecentsRaw.filter((r): r is string => typeof r === 'string')
        : [];
      if (v1Current || v1Recents.length > 0) {
        // Build a v2 state from
        // the v1 values. Wrap
        // `currentPath` in a
        // single tab; the recents
        // are carried over
        // unchanged.
        if (v1Current) {
          const tab = createWorkspaceTab(v1Current);
          workspaces = [tab];
          activeId = tab.id;
        }
        // Merge v1 recents
        // with whatever was
        // already in the v2
        // recents key (rare,
        // but possible if a
        // user has both an
        // old binary and a
        // new binary running
        // side-by-side and
        // the new one has
        // just written
        // recents).
        if (v1Recents.length > 0) {
          const merged = [...recents];
          for (const p of v1Recents) {
            if (!merged.includes(p)) merged.push(p);
          }
          recents = merged;
        }
        // Persist the v2 keys
        // and DROP the v1 keys
        // — a successful migration
        // is the right time to
        // remove the old shape.
        writeJson(STORAGE_KEY_WORKSPACES_V2, workspaces);
        writeJson(STORAGE_KEY_ACTIVE_ID_V2, activeId);
        writeJson(STORAGE_KEY_RECENTS_V2, recents);
        removeJson(STORAGE_KEY_CURRENT_V1);
      }
    }

    // Compute the active path
    // for the status field. The
    // `status` UI is
    // status-of-the-active-tab,
    // not a cross-tab aggregate.
    const activePath = activeId
      ? workspaces.find((w) => w.id === activeId)?.path ?? null
      : null;

    set({
      hydrated: true,
      workspaces,
      activeId,
      recents,
      // Mirror the v1 shape: if
      // we hydrated with at
      // least one tab, mark the
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
      status: activePath
        ? { kind: 'ready', path: activePath }
        : { kind: 'idle' },
    });
  },

  open: (path) => {
    const state = get();
    // If the path is already
    // open as a tab, just make
    // that tab the active one
    // (no duplicate tab is
    // added). The tab's
    // `addedAt` is NOT updated
    // — the user re-opening a
    // tab they already had open
    // is not a "new open"
    // event for recents purposes.
    const existing = state.workspaces.find((w) => w.path === path);
    const recents = dedupAndCap(state.recents, path);
    if (existing) {
      set({ activeId: existing.id, recents, status: { kind: 'ready', path } });
      writeJson(STORAGE_KEY_ACTIVE_ID_V2, existing.id);
      writeJson(STORAGE_KEY_RECENTS_V2, recents);
      return;
    }
    // Add a new tab + make it
    // active.
    const tab = createWorkspaceTab(path);
    set({
      workspaces: [...state.workspaces, tab],
      activeId: tab.id,
      recents,
      status: { kind: 'ready', path },
    });
    writeJson(STORAGE_KEY_WORKSPACES_V2, [...state.workspaces, tab]);
    writeJson(STORAGE_KEY_ACTIVE_ID_V2, tab.id);
    writeJson(STORAGE_KEY_RECENTS_V2, recents);
  },

  close: (tabId) => {
    const state = get();
    const targetId = tabId ?? state.activeId;
    if (!targetId) return;
    const target = state.workspaces.find((w) => w.id === targetId);
    if (!target) return; // unknown tab id — no-op
    const nextWorkspaces = state.workspaces.filter((w) => w.id !== targetId);
    let nextActiveId: string | null = state.activeId;
    if (state.activeId === targetId) {
      // Pick the next tab to
      // the right of the
      // closed one; if
      // there's no tab to the
      // right, pick the
      // last tab to the
      // left; if there are no
      // tabs left, set to
      // null.
      const idx = state.workspaces.findIndex((w) => w.id === targetId);
      const right = state.workspaces[idx + 1];
      const left = idx > 0 ? state.workspaces[idx - 1] : null;
      nextActiveId = (right ?? left ?? null)?.id ?? null;
    }
    const nextActivePath = nextActiveId
      ? nextWorkspaces.find((w) => w.id === nextActiveId)?.path ?? null
      : null;
    set({
      workspaces: nextWorkspaces,
      activeId: nextActiveId,
      status: nextActivePath
        ? { kind: 'ready', path: nextActivePath }
        : { kind: 'idle' },
    });
    writeJson(STORAGE_KEY_WORKSPACES_V2, nextWorkspaces);
    writeJson(STORAGE_KEY_ACTIVE_ID_V2, nextActiveId);
    // We deliberately do NOT
    // remove the closed path
    // from `recents` — the
    // user might want to
    // re-open the same folder
    // later, and "closed" is
    // not "forgotten".
  },

  setActive: (tabId) => {
    const state = get();
    if (!state.workspaces.some((w) => w.id === tabId)) return;
    const target = state.workspaces.find((w) => w.id === tabId);
    if (!target) return;
    set({ activeId: tabId, status: { kind: 'ready', path: target.path } });
    writeJson(STORAGE_KEY_ACTIVE_ID_V2, tabId);
  },

  setStatus: (status) => set({ status }),

  clearRecents: () => {
    set({ recents: [] });
    writeJson(STORAGE_KEY_RECENTS_V2, []);
  },

  removeRecent: (path) => {
    const { recents } = get();
    if (!recents.includes(path)) return;
    const next = recents.filter((p) => p !== path);
    set({ recents: next });
    writeJson(STORAGE_KEY_RECENTS_V2, next);
  },
}));

/**
 * `useActivePath` — derive the
 * path of the active tab from
 * the store state. This is the
 * canonical replacement for
 * reading `state.currentPath`
 * (which M6a removes from the
 * store's settable state —
 * `currentPath` is no longer a
 * real field; the v1 → v2
 * migration builds the initial
 * state from the v1 `currentPath`
 * value, but new code reads via
 * this helper).
 *
 * Returns `null` when no tab is
 * active (i.e. all tabs are
 * closed; the router should
 * route to the Welcome screen).
 *
 * Exported as a regular function
 * so it can be called from
 * non-React code (tests, the
 * `useActivePathSelector` below,
 * etc.). The React-side hook
 * is `useActivePathSelector` —
 * the store's `state` is the
 * argument.
 *
 * Decision #77 (in HANDOFF §4)
 * records the architectural
 * call to use a derived helper
 * rather than a real
 * `currentPath` field.
 */
export function useActivePath(
  // M6a: the helper only
  // needs `workspaces` and
  // `activeId` — accepting
  // a `Pick` lets the
  // onboarding-tour gate
  // call it with a
  // minimal state
  // shape, and it
  // composes with the
  // zustand `state`
  // (which is a
  // `WorkspaceState`).
  state: Pick<WorkspaceState, 'workspaces' | 'activeId'>,
): string | null {
  if (!state.activeId) return null;
  const tab = state.workspaces.find((w) => w.id === state.activeId);
  return tab?.path ?? null;
}

/**
 * Convenience hook for React
 * components: subscribes to the
 * store, returns the active path,
 * re-renders on change.
 *
 * Equivalent to:
 * `useActivePath(useWorkspaceStore())`
 * — but with the selector
 * inline so Zustand's default
 * equality check (===) gives the
 * right re-render cadence.
 */
export function useActivePathSelector(): string | null {
  return useActivePath(useWorkspaceStore.getState());
}

/** Selectors — keep these tiny so components can compose them. */
export const workspaceSelectors = {
  hydrated: (s: WorkspaceState) => s.hydrated,
  workspaces: (s: WorkspaceState) => s.workspaces,
  activeId: (s: WorkspaceState) => s.activeId,
  /** Derived — prefer `useActivePath` directly. */
  currentPath: useActivePath,
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
  createWorkspaceTab,
} as const;
