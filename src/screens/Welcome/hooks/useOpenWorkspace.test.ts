/**
 * Tests for `useOpenWorkspace` —
 * the hook that bridges the
 * "Open Folder" UI to the
 * Tauri filesystem.
 *
 * The hook is a thin
 * `useCallback` wrapper
 * around the pure
 * `openWorkspace(path)`
 * function (also exported
 * from the same module), so
 * we test the pure function
 * directly. This avoids the
 * need for
 * `@testing-library/react`,
 * which the project does
 * not ship.
 *
 * Behaviours we test:
 * 1. No-arg call: opens the
 *    native picker, commits
 *    the chosen path to the
 *    store, and updates
 *    status.
 * 2. With-arg call: skips the
 *    picker, opens the given
 *    path directly.
 * 3. User cancel: returns
 *    without committing
 *    anything, drops status
 *    back to idle.
 * 4. Picker throws: error
 *    status set, no path
 *    committed.
 * 5. Concurrent opens are
 *    blocked while one is in
 *    flight.
 *
 * Per project convention,
 * Tauri APIs are mocked
 * with `vi.hoisted` so the
 * `useAiStore` import chain
 * (transitively) doesn't
 * trip on undefined
 * references at module
 * load. (See
 * `src/shared/commands/commands.test.ts`
 * for the same pattern.)
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { useWorkspaceStore } from '@/shared/state/workspaceStore';

const { pickFolderMock } = vi.hoisted(() => ({
  pickFolderMock: vi.fn(),
}));

vi.mock('@/ipc', async () => {
  const actual =
    await vi.importActual<typeof import('@/ipc')>('@/ipc');
  return {
    ...actual,
    pickFolder: pickFolderMock,
  };
});

const { openWorkspace } = await import('./useOpenWorkspace');

function resetStore(): void {
  useWorkspaceStore.setState({
    hydrated: true,
    currentPath: null,
    recents: [],
    status: { kind: 'idle' },
  });
}

describe('openWorkspace', () => {
  beforeEach(() => {
    resetStore();
    pickFolderMock.mockReset();
  });
  afterEach(() => {
    pickFolderMock.mockReset();
  });

  it('opens the picker when called with no args and commits the chosen path', async () => {
    pickFolderMock.mockResolvedValue('/chosen/path');
    await openWorkspace();
    expect(pickFolderMock).toHaveBeenCalledTimes(1);
    expect(useWorkspaceStore.getState().currentPath).toBe('/chosen/path');
    expect(useWorkspaceStore.getState().recents[0]).toBe('/chosen/path');
    expect(useWorkspaceStore.getState().status).toEqual({
      kind: 'ready',
      path: '/chosen/path',
    });
  });

  it('skips the picker when called with a path arg', async () => {
    await openWorkspace('/a/recents/click');
    expect(pickFolderMock).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().currentPath).toBe(
      '/a/recents/click',
    );
  });

  it('drops back to idle on user cancel (picker returns null)', async () => {
    pickFolderMock.mockResolvedValue(null);
    await openWorkspace();
    expect(useWorkspaceStore.getState().currentPath).toBeNull();
    expect(useWorkspaceStore.getState().status).toEqual({ kind: 'idle' });
  });

  it('sets an error status if the picker throws', async () => {
    pickFolderMock.mockRejectedValue(new Error('boom'));
    await openWorkspace();
    const status = useWorkspaceStore.getState().status;
    expect(status.kind).toBe('error');
    if (status.kind === 'error') {
      expect(status.message).toMatch(/picker/i);
    }
    expect(useWorkspaceStore.getState().currentPath).toBeNull();
  });

  it('blocks concurrent opens while one is in flight', async () => {
    let resolve: (v: string | null) => void = () => {};
    pickFolderMock.mockImplementation(
      () =>
        new Promise<string | null>((r) => {
          resolve = r;
        }),
    );
    // Fire the first open
    // and don't await it.
    const first = openWorkspace();
    // Yield to the
    // microtask queue so
    // the 'opening'
    // status commit
    // lands before we
    // check.
    await Promise.resolve();
    expect(useWorkspaceStore.getState().status.kind).toBe('opening');
    // Fire a second open
    // while the first is
    // still pending. We
    // await it; it should
    // be a no-op that
    // resolves
    // immediately.
    await openWorkspace();
    // The second call
    // should NOT have
    // reached the
    // picker; the picker
    // should still have
    // been called only
    // once.
    expect(pickFolderMock).toHaveBeenCalledTimes(1);
    // Resolve the first.
    resolve('/done');
    await first;
    expect(useWorkspaceStore.getState().currentPath).toBe('/done');
  });
});
