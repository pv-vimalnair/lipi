/* eslint-disable @typescript-eslint/no-non-null-assertion -- test assertion is guarded by prior expect(typeof registered).toBe('function') */
/**
 * Tests for the file-watcher IPC wrapper.
 *
 * The actual disk-touching behaviour is
 * covered by the Rust unit tests in
 * `src-tauri/src/fs_watcher.rs`. These tests
 * cover the JS surface: the wrapper calls
 * the right Tauri command with the right
 * argument shape, the event constant is the
 * wire-format name, and `onFsChange` wires
 * through Tauri's `listen()`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
const listenMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

import {
  FS_WATCHER_EVENT,
  onFsChange,
  startWatch,
  stopWatch,
  type FsChangePayload,
} from './fsWatcher';

afterEach(() => {
  invokeMock.mockReset();
  listenMock.mockReset();
});

describe('fsWatcher IPC wrappers', () => {
  describe('FS_WATCHER_EVENT', () => {
    it('is the expected Tauri event name', () => {
      expect(FS_WATCHER_EVENT).toBe('fs://changed');
    });
  });

  describe('startWatch', () => {
    it('invokes fs_watch with the path', async () => {
      invokeMock.mockResolvedValueOnce({ id: 7, path: '/a' });
      const out = await startWatch('/a');
      expect(invokeMock).toHaveBeenCalledWith('fs_watch', { path: '/a' });
      expect(out.id).toBe(7);
      expect(out.path).toBe('/a');
    });
  });

  describe('stopWatch', () => {
    it('invokes fs_unwatch with the id', async () => {
      invokeMock.mockResolvedValueOnce(true);
      const out = await stopWatch(7);
      expect(invokeMock).toHaveBeenCalledWith('fs_unwatch', { id: 7 });
      expect(out).toBe(true);
    });

    it('returns false when no watcher with that id was registered', async () => {
      invokeMock.mockResolvedValueOnce(false);
      const out = await stopWatch(999);
      expect(out).toBe(false);
    });
  });

  describe('onFsChange', () => {
    it('subscribes to FS_WATCHER_EVENT and forwards the payload to the callback', async () => {
      const unlisten = vi.fn();
      let registered: ((event: { payload: FsChangePayload }) => void) | null =
        null;
      listenMock.mockImplementationOnce(
        async (
          _event: string,
          handler: (event: { payload: FsChangePayload }) => void,
        ) => {
          registered = handler;
          return unlisten;
        },
      );
      const cb = vi.fn();
      const off = await onFsChange(cb);
      expect(listenMock).toHaveBeenCalledWith(
        'fs://changed',
        expect.any(Function),
      );
      expect(typeof registered).toBe('function');
      const payload: FsChangePayload = {
        kind: 'create',
        paths: ['/a/new.txt'],
        watchedPath: '/a',
      };
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
      registered!({ payload });
      expect(cb).toHaveBeenCalledWith(payload);
      // The returned unlisten should be the
      // one Tauri gave us -- callers invoke
      // it on teardown.
      expect(off).toBe(unlisten);
    });
  });
});
