/**
 * Tests for `useFileTree` — the file-tree mutation hook.
 *
 * The hook itself is a thin React wrapper around
 * the IPC + the `useFileTreeStore` Zustand store.
 * We follow the project's existing convention
 * (see `useOpenWorkspace.test.ts`): test the
 * pure helpers (`parentDir`, `isDescendant`,
 * `loadDirIntoStore`, `createInTree`,
 * `deleteInTree`, `renameInTree`) directly, and
 * assert against the Zustand store's
 * post-mutation state.
 *
 * What we cover:
 * 1. `parentDir` — POSIX, Windows, mixed separators.
 * 2. `isDescendant` — exact match, nested, sibling, null, separator-style.
 * 3. `loadDirIntoStore` — happy path pushes to the store; error
 *    surfaces as a status update.
 * 4. `createInTree` — calls `createFile`, refreshes the parent on
 *    success, rethrows `FsError` on failure.
 * 5. `deleteInTree` — calls `deleteEntry`, refreshes the parent,
 *    clears selection when the deleted path (or an ancestor of it)
 *    was selected, keeps selection otherwise.
 * 6. `renameInTree` — calls `renameEntry` with `from`/`to`,
 *    refreshes both parents, updates selection if the renamed path
 *    was the selected one, no-op for selection otherwise.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  createFileMock,
  deleteEntryMock,
  renameEntryMock,
  readDirMock,
  startWatchMock,
  stopWatchMock,
  onFsChangeMock,
} = vi.hoisted(() => ({
  createFileMock: vi.fn(),
  deleteEntryMock: vi.fn(),
  renameEntryMock: vi.fn(),
  readDirMock: vi.fn(),
  startWatchMock: vi.fn(),
  stopWatchMock: vi.fn(),
  onFsChangeMock: vi.fn(),
}));

vi.mock('@/ipc', async () => {
  const actual = await vi.importActual<typeof import('@/ipc')>('@/ipc');
  return {
    ...actual,
    createFile: createFileMock,
    deleteEntry: deleteEntryMock,
    renameEntry: renameEntryMock,
    readDir: readDirMock,
    startWatch: startWatchMock,
    stopWatch: stopWatchMock,
    onFsChange: onFsChangeMock,
  };
});

import {
  createInTree,
  deleteInTree,
  isDescendant,
  loadDirIntoStore,
  parentDir,
  renameInTree,
} from './useFileTree';
import { useFileTreeStore } from '../state/fileTreeStore';
import { FsError } from '@/ipc';

afterEach(() => {
  createFileMock.mockReset();
  deleteEntryMock.mockReset();
  renameEntryMock.mockReset();
  readDirMock.mockReset();
  startWatchMock.mockReset();
  stopWatchMock.mockReset();
  onFsChangeMock.mockReset();
  // Reset the store to a known shape so tests
  // don't leak selection between cases.
  useFileTreeStore.setState({
    rootPath: null,
    status: { kind: 'idle' },
    entriesByDir: {},
    expanded: new Set<string>(),
    selectedPath: null,
  });
});

describe('parentDir', () => {
  it('returns the parent for a POSIX path', () => {
    expect(parentDir('/a/b/c.txt')).toBe('/a/b');
  });

  it('returns the parent for a Windows path', () => {
    expect(parentDir('C:\\Users\\me\\a.txt')).toBe('C:\\Users\\me');
  });

  it('handles mixed separators (Windows accepts both)', () => {
    expect(parentDir('C:/Users/me/a.txt')).toBe('C:/Users/me');
  });

  it('returns null for a path with no parent', () => {
    expect(parentDir('/')).toBeNull();
    expect(parentDir('a.txt')).toBeNull();
  });
});

describe('isDescendant', () => {
  it('matches the exact path', () => {
    expect(isDescendant('/a/b', '/a/b')).toBe(true);
  });

  it('matches a nested path', () => {
    expect(isDescendant('/a/b/c', '/a/b')).toBe(true);
  });

  it('does not match a sibling', () => {
    expect(isDescendant('/a/c', '/a/b')).toBe(false);
  });

  it('does not match a path that only shares a prefix but is not nested', () => {
    expect(isDescendant('/a/bbb', '/a/b')).toBe(false);
  });

  it('returns false for a null child', () => {
    expect(isDescendant(null, '/a/b')).toBe(false);
  });

  it('handles Windows-style paths', () => {
    expect(isDescendant('C:\\a\\b\\c', 'C:\\a\\b')).toBe(true);
  });
});

describe('loadDirIntoStore', () => {
  it('pushes entries to the store on success', async () => {
    const entries = [
      { name: 'a.txt', path: '/a/a.txt', isDir: false, size: 1, modifiedMs: 0 },
    ];
    readDirMock.mockResolvedValueOnce(entries);
    const setEntries = vi.fn();
    const setStatus = vi.fn();
    await loadDirIntoStore('/a', setEntries, setStatus);
    expect(setEntries).toHaveBeenCalledWith('/a', entries);
    expect(setStatus).not.toHaveBeenCalled();
  });

  it('reports an error status on failure', async () => {
    readDirMock.mockRejectedValueOnce(new Error('boom'));
    const setEntries = vi.fn();
    const setStatus = vi.fn();
    await loadDirIntoStore('/a', setEntries, setStatus);
    expect(setEntries).not.toHaveBeenCalled();
    expect(setStatus).toHaveBeenCalledWith({
      kind: 'error',
      // `String(new Error('boom'))` is
      // `'Error: boom'` — the production
      // code uses `String(err)` for the
      // non-FsError branch, which is what
      // we want to verify.
      message: 'Error: boom',
    });
  });

  it('formats an FsError with kind + detail', async () => {
    readDirMock.mockRejectedValueOnce(
      new FsError({ kind: 'PermissionDenied', detail: '/secret' }),
    );
    const setStatus = vi.fn();
    await loadDirIntoStore('/secret', vi.fn(), setStatus);
    expect(setStatus).toHaveBeenCalledWith({
      kind: 'error',
      message: 'PermissionDenied: /secret',
    });
  });
});

describe('createInTree', () => {
  it('calls createFile and refreshes the parent directory', async () => {
    createFileMock.mockResolvedValueOnce(undefined);
    const refresh = vi.fn().mockResolvedValueOnce(undefined);
    await createInTree('/a/new.txt', refresh);
    expect(createFileMock).toHaveBeenCalledWith('/a/new.txt');
    expect(refresh).toHaveBeenCalledWith('/a');
  });

  it('rethrows the FsError verbatim so the UI can show it', async () => {
    const err = new FsError({ kind: 'AlreadyExists', detail: '/a/new.txt' });
    createFileMock.mockRejectedValueOnce(err);
    const refresh = vi.fn();
    await expect(createInTree('/a/new.txt', refresh)).rejects.toBe(err);
    // No refresh on failure.
    expect(refresh).not.toHaveBeenCalled();
  });

  it('wraps unknown errors in a generic Error', async () => {
    createFileMock.mockRejectedValueOnce(new Error('boom'));
    await expect(createInTree('/a/new.txt', vi.fn())).rejects.toThrow('boom');
  });
});

describe('deleteInTree', () => {
  it('calls deleteEntry, refreshes the parent, and clears selection if matched', async () => {
    deleteEntryMock.mockResolvedValueOnce(undefined);
    const refresh = vi.fn().mockResolvedValueOnce(undefined);
    useFileTreeStore.setState({ selectedPath: '/a/doomed.txt' });
    await deleteInTree('/a/doomed.txt', refresh);
    expect(deleteEntryMock).toHaveBeenCalledWith('/a/doomed.txt');
    expect(refresh).toHaveBeenCalledWith('/a');
    expect(useFileTreeStore.getState().selectedPath).toBeNull();
  });

  it('clears selection if a descendant of the deleted dir was selected', async () => {
    deleteEntryMock.mockResolvedValueOnce(undefined);
    const refresh = vi.fn().mockResolvedValueOnce(undefined);
    useFileTreeStore.setState({ selectedPath: '/a/sub/inner.txt' });
    await deleteInTree('/a/sub', refresh);
    expect(useFileTreeStore.getState().selectedPath).toBeNull();
  });

  it('leaves selection alone if the deleted path is unrelated', async () => {
    deleteEntryMock.mockResolvedValueOnce(undefined);
    const refresh = vi.fn().mockResolvedValueOnce(undefined);
    useFileTreeStore.setState({ selectedPath: '/b/keep.txt' });
    await deleteInTree('/a/doomed.txt', refresh);
    expect(useFileTreeStore.getState().selectedPath).toBe('/b/keep.txt');
  });

  it('rethrows the FsError verbatim', async () => {
    const err = new FsError({ kind: 'NotFound', detail: '/a/missing' });
    deleteEntryMock.mockRejectedValueOnce(err);
    await expect(deleteInTree('/a/missing', vi.fn())).rejects.toBe(err);
  });
});

describe('renameInTree', () => {
  it('calls renameEntry with from + to, refreshes both parents, and updates selection if matched', async () => {
    renameEntryMock.mockResolvedValueOnce(undefined);
    const refresh = vi.fn().mockResolvedValueOnce(undefined);
    useFileTreeStore.setState({ selectedPath: '/a/old.txt' });
    await renameInTree('/a/old.txt', '/a/new.txt', refresh);
    expect(renameEntryMock).toHaveBeenCalledWith('/a/old.txt', '/a/new.txt');
    // Same parent: only one refresh.
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith('/a');
    // Selection should track the new path.
    expect(useFileTreeStore.getState().selectedPath).toBe('/a/new.txt');
  });

  it('refreshes both parents when the rename crosses directories', async () => {
    renameEntryMock.mockResolvedValueOnce(undefined);
    const refresh = vi.fn().mockResolvedValueOnce(undefined);
    await renameInTree('/a/old.txt', '/b/new.txt', refresh);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenNthCalledWith(1, '/a');
    expect(refresh).toHaveBeenNthCalledWith(2, '/b');
  });

  it('leaves selection alone if the renamed path is not selected', async () => {
    renameEntryMock.mockResolvedValueOnce(undefined);
    const refresh = vi.fn().mockResolvedValueOnce(undefined);
    useFileTreeStore.setState({ selectedPath: '/b/keep.txt' });
    await renameInTree('/a/old.txt', '/a/new.txt', refresh);
    expect(useFileTreeStore.getState().selectedPath).toBe('/b/keep.txt');
  });

  it('rethrows the FsError verbatim', async () => {
    const err = new FsError({ kind: 'AlreadyExists', detail: '/a/new.txt' });
    renameEntryMock.mockRejectedValueOnce(err);
    await expect(
      renameInTree('/a/old.txt', '/a/new.txt', vi.fn()),
    ).rejects.toBe(err);
  });
});

/**
 * `useFileTreeWatcher` is a React hook that
 * subscribes to `onFsChange` and debounces
 * `refresh(watchedPath)` calls. Without
 * `@testing-library/react` we can't render
 * the hook, but we can exercise the
 * underlying pure function
 * `decideFsChangeAction` that decides what
 * to do with each event.
 *
 * The hook itself is a thin wrapper that
 * just wires the listener + the debounce.
 * The interesting logic (skip unloaded
 * dirs, drop entries on Remove) lives in
 * `decideFsChangeAction` — testing that is
 * what gives us coverage.
 */

import { decideFsChangeAction } from './useFileTree';
import type { FsChangePayload } from '@/ipc';

describe('decideFsChangeAction', () => {
  it('skips events for directories that are not loaded', () => {
    const payload: FsChangePayload = {
      kind: 'create',
      paths: ['/a/new.txt'],
      watchedPath: '/a',
    };
    const loaded = new Set<string>(['/b']);
    expect(decideFsChangeAction(payload, loaded)).toBe('skip');
  });

  it('refreshes loaded directories on create events', () => {
    const payload: FsChangePayload = {
      kind: 'create',
      paths: ['/a/new.txt'],
      watchedPath: '/a',
    };
    const loaded = new Set<string>(['/a']);
    expect(decideFsChangeAction(payload, loaded)).toBe('refresh');
  });

  it('refreshes loaded directories on modify events', () => {
    const payload: FsChangePayload = {
      kind: 'modify',
      paths: ['/a/a.txt'],
      watchedPath: '/a',
    };
    const loaded = new Set<string>(['/a']);
    expect(decideFsChangeAction(payload, loaded)).toBe('refresh');
  });

  it('drops cached entries on remove events so the next read is fresh', () => {
    const payload: FsChangePayload = {
      kind: 'remove',
      paths: ['/a/a.txt'],
      watchedPath: '/a',
    };
    const loaded = new Set<string>(['/a']);
    expect(decideFsChangeAction(payload, loaded)).toBe('drop');
  });

  it('refreshes loaded directories on any-kind events (coalesced bursts)', () => {
    const payload: FsChangePayload = {
      kind: 'any',
      paths: ['/a/x', '/a/y'],
      watchedPath: '/a',
    };
    const loaded = new Set<string>(['/a']);
    expect(decideFsChangeAction(payload, loaded)).toBe('refresh');
  });
});
