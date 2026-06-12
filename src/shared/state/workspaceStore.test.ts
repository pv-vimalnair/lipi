/**
 * Tests for `useWorkspaceStore` —
 * the cross-screen source of
 * truth for the currently-open
 * folder.
 *
 * Per project convention, one
 * test file per store.
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
  STORAGE_KEY_CURRENT,
  STORAGE_KEY_RECENTS,
  MAX_RECENTS,
  useWorkspaceStore,
  workspaceStoreInternals,
} from './workspaceStore';

function reset(): void {
  localStorage.clear();
  useWorkspaceStore.setState({
    hydrated: false,
    currentPath: null,
    recents: [],
    status: { kind: 'idle' },
  });
}

describe('useWorkspaceStore', () => {
  beforeEach(reset);
  afterEach(reset);

  it('starts un-hydrated, no current path, empty recents', () => {
    const s = useWorkspaceStore.getState();
    expect(s.hydrated).toBe(false);
    expect(s.currentPath).toBeNull();
    expect(s.recents).toEqual([]);
    expect(s.status).toEqual({ kind: 'idle' });
  });

  describe('hydrate', () => {
    it('hydrates from localStorage when both keys are set', () => {
      localStorage.setItem(
        STORAGE_KEY_CURRENT,
        JSON.stringify('/Users/me/projects/lipi'),
      );
      localStorage.setItem(
        STORAGE_KEY_RECENTS,
        JSON.stringify([
          '/Users/me/projects/lipi',
          '/Users/me/projects/other',
        ]),
      );
      useWorkspaceStore.getState().hydrate();
      const s = useWorkspaceStore.getState();
      expect(s.hydrated).toBe(true);
      expect(s.currentPath).toBe('/Users/me/projects/lipi');
      expect(s.recents).toEqual([
        '/Users/me/projects/lipi',
        '/Users/me/projects/other',
      ]);
      // The status flips to
      // 'ready' on a successful
      // hydration so the
      // editor can mount
      // without a flash.
      expect(s.status).toEqual({
        kind: 'ready',
        path: '/Users/me/projects/lipi',
      });
    });

    it('hydrates to no-workspace when no current path is persisted', () => {
      localStorage.setItem(STORAGE_KEY_RECENTS, JSON.stringify(['/x']));
      useWorkspaceStore.getState().hydrate();
      const s = useWorkspaceStore.getState();
      expect(s.hydrated).toBe(true);
      expect(s.currentPath).toBeNull();
      expect(s.recents).toEqual(['/x']);
      expect(s.status).toEqual({ kind: 'idle' });
    });

    it('is idempotent — calling hydrate twice is a no-op', () => {
      localStorage.setItem(
        STORAGE_KEY_CURRENT,
        JSON.stringify('/first'),
      );
      useWorkspaceStore.getState().hydrate();
      // Simulate a change in
      // localStorage AFTER
      // hydrate (which the
      // store should NOT
      // pick up).
      localStorage.setItem(
        STORAGE_KEY_CURRENT,
        JSON.stringify('/second'),
      );
      useWorkspaceStore.getState().hydrate();
      // Still the first value.
      expect(useWorkspaceStore.getState().currentPath).toBe('/first');
    });

    it('drops corrupt JSON rather than throwing', () => {
      localStorage.setItem(STORAGE_KEY_CURRENT, '{not valid json');
      useWorkspaceStore.getState().hydrate();
      // Hydrated successfully,
      // but currentPath is
      // null (the bad value
      // was dropped).
      const s = useWorkspaceStore.getState();
      expect(s.hydrated).toBe(true);
      expect(s.currentPath).toBeNull();
    });

    it('drops a non-array recents value', () => {
      localStorage.setItem(
        STORAGE_KEY_RECENTS,
        JSON.stringify({ not: 'an array' }),
      );
      useWorkspaceStore.getState().hydrate();
      // JSON.parse accepts
      // the object as a
      // value; the store
      // validates the shape
      // and falls back to
      // an empty recents
      // list rather than
      // exposing a non-array
      // as if it were one.
      expect(useWorkspaceStore.getState().recents).toEqual([]);
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

    it('sets currentPath and recents (prepended)', () => {
      useWorkspaceStore.getState().open('/a');
      const s = useWorkspaceStore.getState();
      expect(s.currentPath).toBe('/a');
      expect(s.recents).toEqual(['/a']);
      expect(s.status).toEqual({ kind: 'ready', path: '/a' });
    });

    it('persists to localStorage', () => {
      useWorkspaceStore.getState().open('/a');
      expect(localStorage.getItem(STORAGE_KEY_CURRENT)).toBe(
        JSON.stringify('/a'),
      );
      expect(localStorage.getItem(STORAGE_KEY_RECENTS)).toBe(
        JSON.stringify(['/a']),
      );
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
    it('clears currentPath but preserves recents', () => {
      // Open two workspaces so
      // recents are persisted
      // through the proper
      // path (we only persist
      // on `open()`, not on
      // raw `setState`).
      useWorkspaceStore.getState().open('/a');
      useWorkspaceStore.getState().open('/b');
      expect(useWorkspaceStore.getState().recents).toEqual(['/b', '/a']);
      useWorkspaceStore.getState().close();
      const s = useWorkspaceStore.getState();
      expect(s.currentPath).toBeNull();
      expect(s.recents).toEqual(['/b', '/a']);
      expect(s.status).toEqual({ kind: 'idle' });
      // Persisted currentPath
      // is null; recents
      // remain in the same
      // order.
      expect(localStorage.getItem(STORAGE_KEY_CURRENT)).toBe(
        JSON.stringify(null),
      );
      expect(localStorage.getItem(STORAGE_KEY_RECENTS)).toBe(
        JSON.stringify(['/b', '/a']),
      );
    });
  });

  describe('setStatus', () => {
    it('updates the status without touching currentPath or recents', () => {
      useWorkspaceStore.setState({
        hydrated: true,
        currentPath: '/a',
        recents: ['/a'],
        status: { kind: 'ready', path: '/a' },
      });
      useWorkspaceStore
        .getState()
        .setStatus({ kind: 'opening' });
      const s = useWorkspaceStore.getState();
      expect(s.status).toEqual({ kind: 'opening' });
      expect(s.currentPath).toBe('/a');
      expect(s.recents).toEqual(['/a']);
    });
  });

  describe('clearRecents', () => {
    it('empties the recents list and persists the empty array', () => {
      useWorkspaceStore.setState({ recents: ['/a', '/b', '/c'] });
      useWorkspaceStore.getState().clearRecents();
      expect(useWorkspaceStore.getState().recents).toEqual([]);
      expect(localStorage.getItem(STORAGE_KEY_RECENTS)).toBe(
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
        localStorage.getItem(STORAGE_KEY_RECENTS) ?? '[]',
      )).toEqual(['/c', '/a']);
    });
    it('is a no-op if the path is not in recents', () => {
      useWorkspaceStore.getState().open('/a');
      useWorkspaceStore.getState().removeRecent('/nope');
      expect(useWorkspaceStore.getState().recents).toEqual(['/a']);
    });
    it('does not touch currentPath even if it matches', () => {
      useWorkspaceStore.getState().open('/a');
      useWorkspaceStore.getState().removeRecent('/a');
      // The recent is gone...
      expect(useWorkspaceStore.getState().recents).toEqual([]);
      // ...but the workspace
      // stays open.
      expect(useWorkspaceStore.getState().currentPath).toBe('/a');
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
    // Simulate a page reload
    // by re-reading
    // localStorage into a
    // fresh store.
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
    localStorage.setItem(
      STORAGE_KEY_CURRENT,
      JSON.stringify('/round-trip'),
    );
    useWorkspaceStore.setState({
      hydrated: false,
      currentPath: null,
      recents: [],
      status: { kind: 'idle' },
    });
    useWorkspaceStore.getState().hydrate();
    const s = useWorkspaceStore.getState();
    expect(s.currentPath).toBe('/round-trip');
    expect(s.recents[0]).toBe('/round-trip');
  });
});
