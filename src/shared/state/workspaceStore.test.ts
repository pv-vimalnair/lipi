/**
 * Tests for `useWorkspaceStore` —
 * the cross-screen source of
 * truth for the currently-open
 * folder(s).
 *
 * Per project convention, one
 * test file per store.
 *
 * M6a update: the store now
 * tracks an array of open
 * workspaces (a tab model) +
 * an `activeId`. The v1
 * `currentPath` field is gone;
 * tests use `useActivePath`
 * to get the active path as
 * a string.
 *
 * We test the store in
 * isolation — no React, no
 * Tauri mocks. The store is
 * pure Zustand + localStorage;
 * the React-side effects (auto-
 * hydrate on mount, subscriptions
 * from other stores) are covered
 * by their own tests.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  MAX_RECENTS,
  STORAGE_KEY_ACTIVE_ID_V2,
  STORAGE_KEY_CURRENT_V1,
  STORAGE_KEY_RECENTS_V2,
  STORAGE_KEY_WORKSPACES_V2,
  createWorkspaceTab,
  EMPTY_TAB_STATE,
  useActivePath,
  useWorkspaceStore,
  workspaceStoreInternals,
} from './workspaceStore';

function reset(): void {
  localStorage.clear();
  useWorkspaceStore.setState({
    hydrated: false,
    workspaces: [],
    activeId: null,
    recents: [],
    status: { kind: 'idle' },
  });
}

function makeTab(path: string, id: string, addedAt: number) {
  return createWorkspaceTab(path, id, addedAt);
}

describe('useWorkspaceStore', () => {
  beforeEach(reset);
  afterEach(reset);

  it('starts un-hydrated, no workspaces, no active id, empty recents', () => {
    const s = useWorkspaceStore.getState();
    expect(s.hydrated).toBe(false);
    expect(s.workspaces).toEqual([]);
    expect(s.activeId).toBeNull();
    expect(useActivePath(s)).toBeNull();
    expect(s.recents).toEqual([]);
    expect(s.status).toEqual({ kind: 'idle' });
  });

  describe('hydrate', () => {
    it('hydrates from v2 localStorage when all three keys are set', () => {
      const tab1 = makeTab('/Users/me/projects/lipi', 't1', 1000);
      const tab2 = makeTab('/Users/me/projects/other', 't2', 2000);
      localStorage.setItem(
        STORAGE_KEY_WORKSPACES_V2,
        JSON.stringify([tab1, tab2]),
      );
      localStorage.setItem(STORAGE_KEY_ACTIVE_ID_V2, JSON.stringify('t1'));
      localStorage.setItem(
        STORAGE_KEY_RECENTS_V2,
        JSON.stringify([
          '/Users/me/projects/lipi',
          '/Users/me/projects/other',
        ]),
      );
      useWorkspaceStore.getState().hydrate();
      const s = useWorkspaceStore.getState();
      expect(s.hydrated).toBe(true);
      expect(s.workspaces).toEqual([tab1, tab2]);
      expect(s.activeId).toBe('t1');
      expect(useActivePath(s)).toBe('/Users/me/projects/lipi');
      expect(s.recents).toEqual([
        '/Users/me/projects/lipi',
        '/Users/me/projects/other',
      ]);
      expect(s.status).toEqual({
        kind: 'ready',
        path: '/Users/me/projects/lipi',
      });
    });

    it('hydrates to no-workspace when no workspaces are persisted', () => {
      localStorage.setItem(STORAGE_KEY_RECENTS_V2, JSON.stringify(['/x']));
      useWorkspaceStore.getState().hydrate();
      const s = useWorkspaceStore.getState();
      expect(s.hydrated).toBe(true);
      expect(s.workspaces).toEqual([]);
      expect(s.activeId).toBeNull();
      expect(useActivePath(s)).toBeNull();
      expect(s.recents).toEqual(['/x']);
      expect(s.status).toEqual({ kind: 'idle' });
    });

    it('is idempotent — calling hydrate twice is a no-op', () => {
      const tab = makeTab('/first', 't1', 1);
      localStorage.setItem(
        STORAGE_KEY_WORKSPACES_V2,
        JSON.stringify([tab]),
      );
      localStorage.setItem(STORAGE_KEY_ACTIVE_ID_V2, JSON.stringify('t1'));
      useWorkspaceStore.getState().hydrate();
      // Simulate a change in
      // localStorage AFTER
      // hydrate (which the
      // store should NOT
      // pick up).
      const tab2 = makeTab('/second', 't2', 2);
      localStorage.setItem(
        STORAGE_KEY_WORKSPACES_V2,
        JSON.stringify([tab2]),
      );
      localStorage.setItem(STORAGE_KEY_ACTIVE_ID_V2, JSON.stringify('t2'));
      useWorkspaceStore.getState().hydrate();
      // Still the first value.
      const s = useWorkspaceStore.getState();
      expect(s.workspaces).toEqual([tab]);
      expect(s.activeId).toBe('t1');
    });

    it('drops corrupt JSON rather than throwing', () => {
      localStorage.setItem(
        STORAGE_KEY_WORKSPACES_V2,
        '{not valid json',
      );
      useWorkspaceStore.getState().hydrate();
      // Hydrated successfully,
      // but workspaces is empty
      // (the bad value was
      // dropped).
      const s = useWorkspaceStore.getState();
      expect(s.hydrated).toBe(true);
      expect(s.workspaces).toEqual([]);
      expect(s.activeId).toBeNull();
    });

    it('drops a non-array workspaces value', () => {
      localStorage.setItem(
        STORAGE_KEY_WORKSPACES_V2,
        JSON.stringify({ not: 'an array' }),
      );
      useWorkspaceStore.getState().hydrate();
      expect(useWorkspaceStore.getState().workspaces).toEqual([]);
    });

    it('drops workspaces rows that do not match the WorkspaceTab shape', () => {
      // Mix of valid + invalid
      // rows. Only the valid
      // ones should survive.
      const tab = makeTab('/ok', 't1', 1);
      localStorage.setItem(
        STORAGE_KEY_WORKSPACES_V2,
        JSON.stringify([
          tab,
          { id: 'broken' }, // missing path + addedAt
          { id: 'broken2', path: '/x' }, // missing addedAt
          { id: 'broken3', path: '/y', addedAt: 'not-a-number' },
          'a string, not an object',
          null,
        ]),
      );
      useWorkspaceStore.getState().hydrate();
      expect(useWorkspaceStore.getState().workspaces).toEqual([tab]);
    });

    it('falls back to the first workspace when the persisted activeId does not match', () => {
      const tab1 = makeTab('/a', 't1', 1);
      const tab2 = makeTab('/b', 't2', 2);
      localStorage.setItem(
        STORAGE_KEY_WORKSPACES_V2,
        JSON.stringify([tab1, tab2]),
      );
      // activeId points to a
      // tab that's no longer
      // in the array.
      localStorage.setItem(
        STORAGE_KEY_ACTIVE_ID_V2,
        JSON.stringify('stale-id'),
      );
      useWorkspaceStore.getState().hydrate();
      const s = useWorkspaceStore.getState();
      expect(s.activeId).toBe('t1');
      expect(useActivePath(s)).toBe('/a');
    });
  });

  describe('v1 → v2 migration on first hydrate', () => {
    it('migrates a v1 currentPath + recents into a single workspace tab', () => {
      // Pre-M6a persistence
      // shape: the
      // `lipi:workspace:v1` key
      // holds a string path
      // (or null).
      localStorage.setItem(
        STORAGE_KEY_CURRENT_V1,
        JSON.stringify('/Users/me/projects/lipi'),
      );
      localStorage.setItem(
        STORAGE_KEY_RECENTS_V2,
        JSON.stringify([
          '/Users/me/projects/lipi',
          '/Users/me/projects/older',
        ]),
      );
      useWorkspaceStore.getState().hydrate();
      const s = useWorkspaceStore.getState();
      expect(s.hydrated).toBe(true);
      // The path was wrapped
      // in a tab.
      expect(s.workspaces).toHaveLength(1);
      expect(s.workspaces[0].path).toBe('/Users/me/projects/lipi');
      expect(s.activeId).toBe(s.workspaces[0].id);
      expect(useActivePath(s)).toBe('/Users/me/projects/lipi');
      // The v1 `currentPath`
      // key was removed.
      expect(localStorage.getItem(STORAGE_KEY_CURRENT_V1)).toBeNull();
      // The v2 keys are now
      // written.
      expect(localStorage.getItem(STORAGE_KEY_WORKSPACES_V2)).not.toBeNull();
      expect(localStorage.getItem(STORAGE_KEY_ACTIVE_ID_V2)).not.toBeNull();
      // Recents survived the
      // migration unchanged.
      expect(s.recents).toEqual([
        '/Users/me/projects/lipi',
        '/Users/me/projects/older',
      ]);
      // Status flipped to
      // ready.
      expect(s.status).toEqual({
        kind: 'ready',
        path: '/Users/me/projects/lipi',
      });
    });

    it('migrates when v1 currentPath is null but recents exist', () => {
      localStorage.setItem(STORAGE_KEY_CURRENT_V1, JSON.stringify(null));
      localStorage.setItem(
        STORAGE_KEY_RECENTS_V2,
        JSON.stringify(['/some/recent']),
      );
      useWorkspaceStore.getState().hydrate();
      const s = useWorkspaceStore.getState();
      // No tab was created
      // (no v1 path), but
      // recents were carried
      // over.
      expect(s.workspaces).toEqual([]);
      expect(s.activeId).toBeNull();
      expect(s.recents).toEqual(['/some/recent']);
      // The v1 key was
      // removed.
      expect(localStorage.getItem(STORAGE_KEY_CURRENT_V1)).toBeNull();
    });

    it('does not migrate when v2 keys are already present', () => {
      const tab = makeTab('/already-v2', 't1', 1);
      localStorage.setItem(
        STORAGE_KEY_WORKSPACES_V2,
        JSON.stringify([tab]),
      );
      localStorage.setItem(STORAGE_KEY_ACTIVE_ID_V2, JSON.stringify('t1'));
      // The v1 key is
      // ALSO present —
      // a user who has
      // both an old binary
      // and a new binary
      // running side-by-side.
      localStorage.setItem(
        STORAGE_KEY_CURRENT_V1,
        JSON.stringify('/stale-v1-value'),
      );
      useWorkspaceStore.getState().hydrate();
      const s = useWorkspaceStore.getState();
      // The v2 keys won.
      expect(s.workspaces).toEqual([tab]);
      expect(s.activeId).toBe('t1');
      // The v1 key was NOT
      // removed (the v2
      // path was already
      // taken, no migration
      // happened).
      expect(localStorage.getItem(STORAGE_KEY_CURRENT_V1)).toBe(
        JSON.stringify('/stale-v1-value'),
      );
    });
  });

  describe('open', () => {
    beforeEach(() => {
      // Hydrate first so the
      // store is in a "ready"
      // state for the open
      // calls.
      useWorkspaceStore.getState().hydrate();
    });

    it('adds a new tab and makes it active', () => {
      useWorkspaceStore.getState().open('/a');
      const s = useWorkspaceStore.getState();
      expect(s.workspaces).toHaveLength(1);
      expect(s.workspaces[0].path).toBe('/a');
      expect(s.activeId).toBe(s.workspaces[0].id);
      expect(useActivePath(s)).toBe('/a');
      expect(s.recents).toEqual(['/a']);
      expect(s.status).toEqual({ kind: 'ready', path: '/a' });
    });

    it('persists the v2 keys to localStorage', () => {
      useWorkspaceStore.getState().open('/a');
      const stored = JSON.parse(
        localStorage.getItem(STORAGE_KEY_WORKSPACES_V2) ?? '[]',
      );
      expect(stored).toHaveLength(1);
      expect(stored[0].path).toBe('/a');
      expect(typeof stored[0].id).toBe('string');
      expect(typeof stored[0].addedAt).toBe('number');
      expect(localStorage.getItem(STORAGE_KEY_ACTIVE_ID_V2)).toBe(
        JSON.stringify(stored[0].id),
      );
      expect(localStorage.getItem(STORAGE_KEY_RECENTS_V2)).toBe(
        JSON.stringify(['/a']),
      );
    });

    it('does not add a duplicate tab when the path is already open', () => {
      useWorkspaceStore.getState().open('/a');
      useWorkspaceStore.getState().open('/b');
      useWorkspaceStore.getState().open('/a');
      const s = useWorkspaceStore.getState();
      expect(s.workspaces).toHaveLength(2);
      expect(s.workspaces.map((w) => w.path)).toEqual(['/a', '/b']);
      // The active tab is the
      // /a tab (the one that
      // was just "re-opened").
      expect(s.activeId).toBe(s.workspaces[0].id);
      // Recents were updated
      // (the /a path is at
      // the front).
      expect(s.recents).toEqual(['/a', '/b']);
    });

    it('moves an existing recent to the front (dedup)', () => {
      useWorkspaceStore.setState({ recents: ['/a', '/b', '/c'] });
      useWorkspaceStore.getState().open('/c');
      expect(useWorkspaceStore.getState().recents).toEqual([
        '/c',
        '/a',
        '/b',
      ]);
    });

    it('caps recents at MAX_RECENTS (5)', () => {
      for (const p of ['/1', '/2', '/3', '/4', '/5']) {
        useWorkspaceStore.getState().open(p);
      }
      expect(useWorkspaceStore.getState().recents).toEqual([
        '/5',
        '/4',
        '/3',
        '/2',
        '/1',
      ]);
      // Opening a 6th caps
      // the list and drops
      // the oldest.
      useWorkspaceStore.getState().open('/6');
      expect(useWorkspaceStore.getState().recents).toEqual([
        '/6',
        '/5',
        '/4',
        '/3',
        '/2',
      ]);
    });
  });

  describe('close', () => {
    it('closing a non-active tab leaves the active tab unchanged', () => {
      useWorkspaceStore.getState().open('/a');
      useWorkspaceStore.getState().open('/b');
      useWorkspaceStore.getState().open('/c');
      // Currently active: /c
      // (last opened).
      const aTab = useWorkspaceStore
        .getState()
        .workspaces.find((w) => w.path === '/a')!;
      useWorkspaceStore.getState().close(aTab.id);
      const s = useWorkspaceStore.getState();
      expect(s.workspaces).toHaveLength(2);
      expect(s.workspaces.map((w) => w.path)).toEqual(['/b', '/c']);
      // Active was /c and
      // /c was not closed,
      // so active is still
      // /c.
      expect(useActivePath(s)).toBe('/c');
    });

    it('closing the active tab picks the next tab to the right', () => {
      useWorkspaceStore.getState().open('/a');
      useWorkspaceStore.getState().open('/b');
      useWorkspaceStore.getState().open('/c');
      // Make /a the active
      // tab, then close
      // it. /a is at
      // index 0, /b is at
      // index 1 — the
      // "next to the
      // right" is /b.
      const aTab = useWorkspaceStore
        .getState()
        .workspaces.find((w) => w.path === '/a')!;
      useWorkspaceStore.getState().setActive(aTab.id);
      useWorkspaceStore.getState().close(aTab.id);
      const s = useWorkspaceStore.getState();
      expect(s.workspaces.map((w) => w.path)).toEqual(['/b', '/c']);
      expect(useActivePath(s)).toBe('/b');
    });

    it('picks the tab to the left when the closed tab was the rightmost', () => {
      useWorkspaceStore.getState().open('/a');
      useWorkspaceStore.getState().open('/b');
      // Currently active:
      // /b. Close /b.
      const bTab = useWorkspaceStore
        .getState()
        .workspaces.find((w) => w.path === '/b')!;
      useWorkspaceStore.getState().close(bTab.id);
      const s = useWorkspaceStore.getState();
      expect(s.workspaces).toHaveLength(1);
      expect(s.activeId).toBe(s.workspaces[0].id);
      expect(useActivePath(s)).toBe('/a');
    });

    it('flips activeId to null when the last tab is closed', () => {
      useWorkspaceStore.getState().open('/a');
      const aTab = useWorkspaceStore
        .getState()
        .workspaces.find((w) => w.path === '/a')!;
      useWorkspaceStore.getState().close(aTab.id);
      const s = useWorkspaceStore.getState();
      expect(s.workspaces).toEqual([]);
      expect(s.activeId).toBeNull();
      expect(useActivePath(s)).toBeNull();
      expect(s.status).toEqual({ kind: 'idle' });
    });

    it('closes the active tab when called with no argument', () => {
      useWorkspaceStore.getState().open('/a');
      useWorkspaceStore.getState().open('/b');
      // /b is active.
      useWorkspaceStore.getState().close();
      const s = useWorkspaceStore.getState();
      expect(s.workspaces.map((w) => w.path)).toEqual(['/a']);
      expect(useActivePath(s)).toBe('/a');
    });

    it('preserves recents when closing a tab', () => {
      useWorkspaceStore.getState().open('/a');
      useWorkspaceStore.getState().open('/b');
      expect(useWorkspaceStore.getState().recents).toEqual(['/b', '/a']);
      const aTab = useWorkspaceStore
        .getState()
        .workspaces.find((w) => w.path === '/a')!;
      useWorkspaceStore.getState().close(aTab.id);
      // The recents list is
      // unchanged.
      expect(useWorkspaceStore.getState().recents).toEqual(['/b', '/a']);
    });

    it('is a no-op for an unknown tab id', () => {
      useWorkspaceStore.getState().open('/a');
      const before = useWorkspaceStore.getState();
      useWorkspaceStore.getState().close('nonsense');
      const after = useWorkspaceStore.getState();
      expect(after.workspaces).toEqual(before.workspaces);
      expect(after.activeId).toBe(before.activeId);
    });

    it('persists the post-close workspaces + activeId', () => {
      useWorkspaceStore.getState().open('/a');
      useWorkspaceStore.getState().open('/b');
      const aTab = useWorkspaceStore
        .getState()
        .workspaces.find((w) => w.path === '/a')!;
      useWorkspaceStore.getState().close(aTab.id);
      // The v2 keys reflect
      // the post-close state.
      const stored = JSON.parse(
        localStorage.getItem(STORAGE_KEY_WORKSPACES_V2) ?? '[]',
      );
      expect(stored.map((w: { path: string }) => w.path)).toEqual(['/b']);
      expect(localStorage.getItem(STORAGE_KEY_ACTIVE_ID_V2)).toBe(
        JSON.stringify(stored[0].id),
      );
    });
  });

  describe('setActive', () => {
    it('switches the active tab', () => {
      useWorkspaceStore.getState().open('/a');
      useWorkspaceStore.getState().open('/b');
      const aTab = useWorkspaceStore
        .getState()
        .workspaces.find((w) => w.path === '/a')!;
      useWorkspaceStore.getState().setActive(aTab.id);
      expect(useActivePath(useWorkspaceStore.getState())).toBe('/a');
    });

    it('persists the new activeId', () => {
      useWorkspaceStore.getState().open('/a');
      useWorkspaceStore.getState().open('/b');
      const aTab = useWorkspaceStore
        .getState()
        .workspaces.find((w) => w.path === '/a')!;
      useWorkspaceStore.getState().setActive(aTab.id);
      expect(localStorage.getItem(STORAGE_KEY_ACTIVE_ID_V2)).toBe(
        JSON.stringify(aTab.id),
      );
    });

    it('is a no-op for an unknown tab id', () => {
      useWorkspaceStore.getState().open('/a');
      const before = useWorkspaceStore.getState();
      useWorkspaceStore.getState().setActive('nonsense');
      expect(useWorkspaceStore.getState().activeId).toBe(before.activeId);
    });
  });

  describe('setStatus', () => {
    it('updates the status without touching workspaces or recents', () => {
      useWorkspaceStore.getState().open('/a');
      useWorkspaceStore
        .getState()
        .setStatus({ kind: 'opening' });
      const s = useWorkspaceStore.getState();
      expect(s.status).toEqual({ kind: 'opening' });
      expect(s.workspaces).toHaveLength(1);
      expect(s.recents).toEqual(['/a']);
    });
  });

  describe('clearRecents', () => {
    it('empties the recents list and persists the empty array', () => {
      useWorkspaceStore.setState({ recents: ['/a', '/b', '/c'] });
      useWorkspaceStore.getState().clearRecents();
      expect(useWorkspaceStore.getState().recents).toEqual([]);
      expect(localStorage.getItem(STORAGE_KEY_RECENTS_V2)).toBe(
        JSON.stringify([]),
      );
    });
  });

  describe('removeRecent', () => {
    it('removes the path and persists the new list', () => {
      // Use open() to set up
      // state through the
      // proper persistence
      // path.
      useWorkspaceStore.getState().open('/a');
      useWorkspaceStore.getState().open('/b');
      useWorkspaceStore.getState().open('/c');
      expect(useWorkspaceStore.getState().recents).toEqual([
        '/c',
        '/b',
        '/a',
      ]);
      useWorkspaceStore.getState().removeRecent('/b');
      expect(useWorkspaceStore.getState().recents).toEqual(['/c', '/a']);
      expect(JSON.parse(
        localStorage.getItem(STORAGE_KEY_RECENTS_V2) ?? '[]',
      )).toEqual(['/c', '/a']);
    });
    it('is a no-op if the path is not in recents', () => {
      useWorkspaceStore.getState().open('/a');
      useWorkspaceStore.getState().removeRecent('/nope');
      expect(useWorkspaceStore.getState().recents).toEqual(['/a']);
    });
    it('does not touch activeId even if the open workspace path matches', () => {
      useWorkspaceStore.getState().open('/a');
      useWorkspaceStore.getState().removeRecent('/a');
      // The recent is gone...
      expect(useWorkspaceStore.getState().recents).toEqual([]);
      // ...but the workspace
      // stays open.
      expect(useActivePath(useWorkspaceStore.getState())).toBe('/a');
    });
  });

  describe('dedupAndCap helper (workspaceStoreInternals)', () => {
    const { dedupAndCap } = workspaceStoreInternals;
    it('places the newest path at index 0', () => {
      expect(dedupAndCap(['/a', '/b'], '/c')).toEqual(['/c', '/a', '/b']);
    });
    it('removes prior copies of the newest path before prepending', () => {
      expect(dedupAndCap(['/a', '/b', '/c'], '/b')).toEqual([
        '/b',
        '/a',
        '/c',
      ]);
    });
    it('caps at MAX_RECENTS', () => {
      const long = Array.from({ length: 20 }, (_, i) => `/${i}`);
      const out = dedupAndCap(long, '/new');
      expect(out).toHaveLength(MAX_RECENTS);
      expect(out[0]).toBe('/new');
    });
  });

  it('round-trip: open -> reload (re-hydrate) restores the same state', () => {
    // Open a couple of
    // tabs to set up the
    // v2 persistence.
    useWorkspaceStore.getState().hydrate();
    useWorkspaceStore.getState().open('/round-trip');
    // Now re-hydrate
    // (re-mount). The
    // `hydrated` guard makes
    // this a no-op in real
    // code, but for the
    // round-trip we
    // explicitly reset and
    // re-hydrate.
    useWorkspaceStore.setState({
      hydrated: false,
      workspaces: [],
      activeId: null,
      recents: [],
      status: { kind: 'idle' },
    });
    useWorkspaceStore.getState().hydrate();
    const s = useWorkspaceStore.getState();
    expect(s.workspaces).toHaveLength(1);
    expect(useActivePath(s)).toBe('/round-trip');
    expect(s.recents[0]).toBe('/round-trip');
  });

  // -----------------------------------------------------------------
  // M6b — per-tab state keying
  // -----------------------------------------------------------------
  // Each tab now carries a
  // `state: WorkspaceTabState`
  // field. The M6b additions to
  // the store are:
  //   1. `EMPTY_TAB_STATE` export
  //      (the canonical empty).
  //   2. `createWorkspaceTab`
  //      accepts an optional
  //      `state` argument.
  //   3. `open()` initialises the
  //      new tab's `state` to
  //      `EMPTY_TAB_STATE`.
  //   4. `setTabState(tabId,
  //      partial)` merges `partial`
  //      into the tab's `state`
  //      and persists.
  //   5. `replaceTabState(tabId,
  //      state)` replaces the
  //      tab's `state` and
  //      persists.
  //   6. The hydrate synthesises
  //      `EMPTY_TAB_STATE` for
  //      pre-M6b tabs (no `state`
  //      field) and for
  //      partial-state tabs.
  //   7. The `useActiveTabState`
  //      helper returns the
  //      active tab's state, or
  //      `EMPTY_TAB_STATE` if no
  //      tab is active.
  describe('M6b — per-tab state keying', () => {
    it('creates a new tab with EMPTY_TAB_STATE', () => {
      useWorkspaceStore.getState().open('/proj');
      const tab = useWorkspaceStore.getState().workspaces[0]!;
      expect(tab.state).toEqual({
        expandedDirs: [],
        selectedPath: null,
        openEditorTabPaths: [],
        activeEditorTabPath: null,
        editorCursorByPath: {},
        fileTreeScrollAnchor: null,
      });
    });

    it('setTabState merges the partial into the tab state', () => {
      useWorkspaceStore.getState().open('/proj');
      const tabId = useWorkspaceStore.getState().workspaces[0]!.id;
      useWorkspaceStore.getState().setTabState(tabId, {
        expandedDirs: ['/proj/src', '/proj/src/components'],
      });
      const after = useWorkspaceStore.getState().workspaces[0]!;
      expect(after.state.expandedDirs).toEqual([
        '/proj/src',
        '/proj/src/components',
      ]);
      // Other fields stay at
      // their empty-state
      // defaults.
      expect(after.state.selectedPath).toBeNull();
      expect(after.state.openEditorTabPaths).toEqual([]);
    });

    it('setTabState is a no-op for an unknown tab id', () => {
      useWorkspaceStore.getState().open('/proj');
      const before = useWorkspaceStore.getState().workspaces[0]!.state;
      useWorkspaceStore.getState().setTabState('nonsense', {
        selectedPath: '/proj/x',
      });
      const after = useWorkspaceStore.getState().workspaces[0]!.state;
      expect(after).toBe(before); // same reference — no-op
    });

    it('setTabState is a no-op if the merge is structurally identical', () => {
      useWorkspaceStore.getState().open('/proj');
      const tabId = useWorkspaceStore.getState().workspaces[0]!.id;
      useWorkspaceStore.getState().setTabState(tabId, {
        expandedDirs: ['/proj/src'],
      });
      const before = useWorkspaceStore.getState().workspaces[0]!.state;
      // Setting the same
      // expandedDirs array
      // reference should be a
      // no-op (the array is
      // compared by reference).
      useWorkspaceStore.getState().setTabState(tabId, {
        expandedDirs: before.expandedDirs,
      });
      const after = useWorkspaceStore.getState().workspaces[0]!.state;
      expect(after).toBe(before); // same reference — no-op
    });

    it('replaceTabState replaces the whole state', () => {
      useWorkspaceStore.getState().open('/proj');
      const tabId = useWorkspaceStore.getState().workspaces[0]!.id;
      const next = {
        expandedDirs: ['/proj/src'],
        selectedPath: '/proj/src/index.ts',
        openEditorTabPaths: ['/proj/src/index.ts'],
        activeEditorTabPath: '/proj/src/index.ts',
        editorCursorByPath: {},
        fileTreeScrollAnchor: null,
      };
      useWorkspaceStore.getState().replaceTabState(tabId, next);
      const after = useWorkspaceStore.getState().workspaces[0]!;
      expect(after.state).toEqual(next);
    });

    it('replaceTabState is a no-op for an unknown tab id', () => {
      useWorkspaceStore.getState().open('/proj');
      const before = useWorkspaceStore.getState().workspaces[0]!.state;
      useWorkspaceStore.getState().replaceTabState('nonsense', {
        ...before,
        selectedPath: '/x',
      });
      expect(useWorkspaceStore.getState().workspaces[0]!.state).toBe(before);
    });

    it('setTabState persists the new state to localStorage', () => {
      useWorkspaceStore.getState().open('/proj');
      const tabId = useWorkspaceStore.getState().workspaces[0]!.id;
      useWorkspaceStore.getState().setTabState(tabId, {
        openEditorTabPaths: ['/proj/a.ts', '/proj/b.ts'],
        activeEditorTabPath: '/proj/a.ts',
      });
      const stored = JSON.parse(
        localStorage.getItem(STORAGE_KEY_WORKSPACES_V2) ?? '[]',
      );
      expect(stored[0].state).toEqual({
        expandedDirs: [],
        selectedPath: null,
        openEditorTabPaths: ['/proj/a.ts', '/proj/b.ts'],
        activeEditorTabPath: '/proj/a.ts',
        editorCursorByPath: {},
        fileTreeScrollAnchor: null,
      });
    });

    it('hydrate synthesises EMPTY_TAB_STATE for pre-M6b tabs (no state field)', () => {
      // Persist a pre-M6b
      // tab (no `state`
      // field).
      const preM6b = {
        id: 't1',
        path: '/legacy',
        addedAt: 1000,
        // no `state` field
      };
      localStorage.setItem(
        STORAGE_KEY_WORKSPACES_V2,
        JSON.stringify([preM6b]),
      );
      localStorage.setItem(STORAGE_KEY_ACTIVE_ID_V2, JSON.stringify('t1'));
      useWorkspaceStore.getState().hydrate();
      const tab = useWorkspaceStore.getState().workspaces[0]!;
      expect(tab.state).toEqual({
        expandedDirs: [],
        selectedPath: null,
        openEditorTabPaths: [],
        activeEditorTabPath: null,
        editorCursorByPath: {},
        fileTreeScrollAnchor: null,
      });
    });

    it('hydrate fills in missing fields for a partial-state tab', () => {
      // Persist a tab with a
      // partial `state`
      // (e.g. from a future
      // version that added a
      // new field and an
      // older install is
      // missing it).
      const partial = {
        id: 't1',
        path: '/proj',
        addedAt: 1000,
        state: {
          expandedDirs: ['/proj/src'],
          // selectedPath, openEditorTabPaths, activeEditorTabPath all missing
        },
      };
      localStorage.setItem(
        STORAGE_KEY_WORKSPACES_V2,
        JSON.stringify([partial]),
      );
      localStorage.setItem(STORAGE_KEY_ACTIVE_ID_V2, JSON.stringify('t1'));
      useWorkspaceStore.getState().hydrate();
      const tab = useWorkspaceStore.getState().workspaces[0]!;
      expect(tab.state).toEqual({
        expandedDirs: ['/proj/src'],
        selectedPath: null,
        openEditorTabPaths: [],
        activeEditorTabPath: null,
        editorCursorByPath: {},
        fileTreeScrollAnchor: null,
      });
    });

    it('hydrate drops a corrupt tab (e.g. wrong type for state.expandedDirs)', () => {
      const corrupt = {
        id: 't1',
        path: '/proj',
        addedAt: 1000,
        state: {
          expandedDirs: 'not-an-array', // wrong type
        },
      };
      localStorage.setItem(
        STORAGE_KEY_WORKSPACES_V2,
        JSON.stringify([corrupt]),
      );
      localStorage.setItem(STORAGE_KEY_ACTIVE_ID_V2, JSON.stringify('t1'));
      useWorkspaceStore.getState().hydrate();
      const tab = useWorkspaceStore.getState().workspaces[0]!;
      // The wrong-type field
      // is reset to the
      // empty-state default;
      // the rest of the
      // state shape is
      // preserved.
      expect(tab.state.expandedDirs).toEqual([]);
      expect(tab.state.selectedPath).toBeNull();
    });

    it('useActiveTabState returns the active tab state, or EMPTY_TAB_STATE if none', async () => {
      const { useActiveTabState } = await import('./workspaceStore');
      // No active tab —
      // returns empty.
      expect(
        useActiveTabState({
          workspaces: [],
          activeId: null,
        }),
      ).toEqual({
        expandedDirs: [],
        selectedPath: null,
        openEditorTabPaths: [],
        activeEditorTabPath: null,
        editorCursorByPath: {},
        fileTreeScrollAnchor: null,
      });
      // With an active tab —
      // returns its state.
      const tab = createWorkspaceTab('/proj', 't1', 1000, {
        expandedDirs: ['/proj/src'],
        selectedPath: '/proj/src/index.ts',
        openEditorTabPaths: ['/proj/src/index.ts'],
        activeEditorTabPath: '/proj/src/index.ts',
        editorCursorByPath: {},
        fileTreeScrollAnchor: null,
      });
      expect(
        useActiveTabState({
          workspaces: [tab],
          activeId: 't1',
        }),
      ).toEqual(tab.state);
    });

    it('close preserves the closed tab’s state (with the tab itself)', () => {
      // M6b doesn't change
      // close behaviour
      // relative to M6a —
      // the closed tab goes
      // away, and its
      // per-tab `state` goes
      // with it. Closing is
      // not forgetting the
      // path (recents), but
      // the per-tab state is
      // for the open tab
      // only. This test
      // documents the
      // behaviour.
      useWorkspaceStore.getState().open('/proj');
      const tabId = useWorkspaceStore.getState().workspaces[0]!.id;
      useWorkspaceStore.getState().setTabState(tabId, {
        openEditorTabPaths: ['/proj/a.ts'],
      });
      useWorkspaceStore.getState().close(tabId);
      expect(useWorkspaceStore.getState().workspaces).toEqual([]);
      // The path is still in
      // recents (closing is
      // not forgetting —
      // Decision #80).
      expect(useWorkspaceStore.getState().recents).toContain('/proj');
    });

    it('createWorkspaceTab accepts a custom state argument', () => {
      const custom = {
        expandedDirs: ['/proj/src'],
        selectedPath: '/proj/src/index.ts',
        openEditorTabPaths: ['/proj/src/index.ts'],
        activeEditorTabPath: '/proj/src/index.ts',
        editorCursorByPath: {},
        fileTreeScrollAnchor: null,
      };
      const tab = createWorkspaceTab('/proj', 't1', 1000, custom);
      expect(tab).toEqual({
        id: 't1',
        path: '/proj',
        addedAt: 1000,
        state: custom,
      });
    });
  });

  // -----------------------------------------------------------------
  // M6c — per-file editor cursor (new field on WorkspaceTabState)
  // -----------------------------------------------------------------
  // M6c adds two new fields to
  // WorkspaceTabState:
  //   - `editorCursorByPath`:
  //     per-file cursor memory.
  //   - `fileTreeScrollAnchor`:
  //     the first-visible path
  //     in the file tree (Task 7).
  // And one new store action:
  //   - `setEditorCursor(tabId,
  //     filePath, cursor)`:
  //     writes the cursor for one
  //     file in one tab, with an
  //     equality short-circuit
  //     (line+column match = no-op).
  describe('EMPTY_TAB_STATE — M6c fields', () => {
    it('has editorCursorByPath = {} and fileTreeScrollAnchor = null', () => {
      expect(EMPTY_TAB_STATE.editorCursorByPath).toEqual({});
      expect(EMPTY_TAB_STATE.fileTreeScrollAnchor).toBeNull();
    });
  });

  describe('setEditorCursor (M6c)', () => {
    beforeEach(() => {
      // Reset the store to a
      // clean idle state before
      // each test (the outer
      // `beforeEach(reset)` at
      // line 59 already does
      // this — but we re-assert
      // it for clarity here).
      useWorkspaceStore.setState({
        hydrated: true,
        workspaces: [],
        activeId: null,
        recents: [],
        status: { kind: 'idle' },
      });
    });

    it('writes the cursor into the active tab editorCursorByPath', () => {
      useWorkspaceStore.getState().open('C:/proj');
      const tabId = useWorkspaceStore.getState().activeId!;
      useWorkspaceStore
        .getState()
        .setEditorCursor(tabId, 'C:/proj/index.ts', { line: 12, column: 4 });
      const tab = useWorkspaceStore
        .getState()
        .workspaces.find((w) => w.id === tabId)!;
      expect(tab.state.editorCursorByPath['C:/proj/index.ts']).toEqual({
        line: 12,
        column: 4,
      });
    });

    it('merges new entries without overwriting existing ones', () => {
      useWorkspaceStore.getState().open('C:/proj');
      const tabId = useWorkspaceStore.getState().activeId!;
      useWorkspaceStore
        .getState()
        .setEditorCursor(tabId, 'C:/proj/a.ts', { line: 1, column: 1 });
      useWorkspaceStore
        .getState()
        .setEditorCursor(tabId, 'C:/proj/b.ts', { line: 5, column: 2 });
      const tab = useWorkspaceStore
        .getState()
        .workspaces.find((w) => w.id === tabId)!;
      expect(tab.state.editorCursorByPath).toEqual({
        'C:/proj/a.ts': { line: 1, column: 1 },
        'C:/proj/b.ts': { line: 5, column: 2 },
      });
    });

    it('is a no-op when the incoming cursor matches the existing one (line+column)', () => {
      useWorkspaceStore.getState().open('C:/proj');
      const tabId = useWorkspaceStore.getState().activeId!;
      useWorkspaceStore
        .getState()
        .setEditorCursor(tabId, 'C:/proj/a.ts', { line: 3, column: 7 });
      const before = useWorkspaceStore.getState().workspaces;
      useWorkspaceStore
        .getState()
        .setEditorCursor(tabId, 'C:/proj/a.ts', { line: 3, column: 7 });
      const after = useWorkspaceStore.getState().workspaces;
      // The workspaces array reference should be unchanged
      // (no-op short-circuit at the top of setEditorCursor).
      expect(after).toBe(before);
    });

    it('is a no-op when the tab id is unknown', () => {
      useWorkspaceStore.getState().open('C:/proj');
      useWorkspaceStore
        .getState()
        .setEditorCursor('not-a-tab', 'C:/proj/a.ts', { line: 1, column: 1 });
      const tab = useWorkspaceStore.getState().workspaces[0]!;
      expect(tab.state.editorCursorByPath).toEqual({});
    });
  });
});
