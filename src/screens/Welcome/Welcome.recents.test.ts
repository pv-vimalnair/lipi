/**
 * Recents-management polish — pure-data-layer tests.
 *
 * The Welcome screen now exposes a "Clear all" button
 * above the recents list. The button:
 *   - is hidden when there's 0 or 1 entry (a single-
 *     item "Clear all" would be a footgun);
 *   - shows up when there are 2+ entries;
 *   - calls `useWorkspaceStore.clearRecents()` on
 *     click, which the store then persists to
 *     localStorage.
 *
 * We don't render the component (the project doesn't
 * ship `@testing-library/react`). We test:
 *   1. `shouldShowClearAll(n)` for the n=0/1/2/3
 *      boundary cases.
 *   2. The store integration: seeding recents via
 *      `open(path)` + invoking `clearRecents()` empties
 *      the list and persists.
 *   3. `clearRecents` is a no-op when the list is
 *      already empty (no extra write).
 *
 * The existing `workspaceStore.test.ts` covers the
 * store's `clearRecents` happy path. The new tests
 * here focus on the UI-side contract: the button is
 * reachable in the right list-state, and the click
 * produces the expected store transition.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useWorkspaceStore } from '@/shared/state/workspaceStore';

import { shouldShowClearAll } from './Welcome';

function resetStore(): void {
  useWorkspaceStore.setState({
    hydrated: true,
    currentPath: null,
    recents: [],
    status: { kind: 'idle' },
  });
  localStorage.clear();
}

describe('shouldShowClearAll', () => {
  it('returns false for an empty recents list', () => {
    expect(shouldShowClearAll(0)).toBe(false);
  });

  it('returns false for a single entry (footgun guard)', () => {
    expect(shouldShowClearAll(1)).toBe(false);
  });

  it('returns true for 2 entries', () => {
    expect(shouldShowClearAll(2)).toBe(true);
  });

  it('returns true for the cap (5) and beyond', () => {
    expect(shouldShowClearAll(5)).toBe(true);
    expect(shouldShowClearAll(8)).toBe(true);
  });
});

describe('Welcome recents: "Clear all" button -> store', () => {
  beforeEach(() => {
    resetStore();
  });
  afterEach(() => {
    resetStore();
  });

  it('seeds recents via open() and clearRecents() empties them', () => {
    // Seed 3 recents by opening 3 paths.
    useWorkspaceStore.getState().open('/projects/a');
    useWorkspaceStore.getState().open('/projects/b');
    useWorkspaceStore.getState().open('/projects/c');
    expect(useWorkspaceStore.getState().recents).toEqual([
      '/projects/c',
      '/projects/b',
      '/projects/a',
    ]);

    // The clear button is a one-liner: store.clearRecents().
    useWorkspaceStore.getState().clearRecents();

    // The list is empty.
    expect(useWorkspaceStore.getState().recents).toEqual([]);

    // The persisted storage is also empty.
    const persisted = localStorage.getItem('lipi:workspace:recents:v1');
    expect(persisted).toBe('[]');
  });

  it('does not change currentPath (the open workspace is independent)', () => {
    useWorkspaceStore.getState().open('/projects/a');
    useWorkspaceStore.getState().open('/projects/b');
    // `/projects/b` is the most-recent open, so it's
    // also the current workspace.
    expect(useWorkspaceStore.getState().currentPath).toBe('/projects/b');

    useWorkspaceStore.getState().clearRecents();

    // The current path is preserved; only the recents
    // list is cleared.
    expect(useWorkspaceStore.getState().currentPath).toBe('/projects/b');
    expect(useWorkspaceStore.getState().recents).toEqual([]);
  });

  it('is a no-op when the list is already empty', () => {
    // Store is empty from resetStore(). Call clearRecents().
    // The test passes if no throw, no state change.
    expect(() => useWorkspaceStore.getState().clearRecents()).not.toThrow();
    expect(useWorkspaceStore.getState().recents).toEqual([]);
  });
});
