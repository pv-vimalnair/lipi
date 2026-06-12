/**
 * Tests for the file-tree mutation IPC wrappers.
 *
 * The actual disk-touching behaviour is covered by
 * the Rust unit tests in `src-tauri/src/fs.rs`. These
 * tests cover the JS surface: the wrapper calls the
 * right Tauri command with the right argument shape,
 * the typed error gets re-thrown as `FsError`, and
 * the new `AlreadyExists` variant is wired through.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  createFile,
  deleteEntry,
  FsError,
  pickFolder,
  readDir,
  readFile,
  renameEntry,
  writeFile,
} from './fs';

afterEach(() => {
  invokeMock.mockReset();
});

describe('fs IPC wrappers', () => {
  describe('readDir', () => {
    it('invokes fs_read_dir with the path', async () => {
      invokeMock.mockResolvedValueOnce([
        { name: 'a.txt', path: '/x/a.txt', isDir: false, size: 1, modifiedMs: 0 },
      ]);
      const out = await readDir('/x');
      expect(invokeMock).toHaveBeenCalledWith('fs_read_dir', { path: '/x' });
      expect(out[0].name).toBe('a.txt');
    });

    it('throws FsError on a typed error payload', async () => {
      invokeMock.mockRejectedValueOnce({
        kind: 'NotFound',
        detail: 'missing',
      });
      await expect(readDir('/nope')).rejects.toBeInstanceOf(FsError);
    });
  });

  describe('readFile', () => {
    it('invokes fs_read_file with the path', async () => {
      invokeMock.mockResolvedValueOnce({ content: 'hi', encoding: 'utf-8' });
      const out = await readFile('/x/a.txt');
      expect(invokeMock).toHaveBeenCalledWith('fs_read_file', {
        path: '/x/a.txt',
      });
      expect(out.content).toBe('hi');
    });
  });

  describe('writeFile', () => {
    it('invokes fs_write_file with path + content', async () => {
      invokeMock.mockResolvedValueOnce(undefined);
      await writeFile('/x/a.txt', 'hello');
      expect(invokeMock).toHaveBeenCalledWith('fs_write_file', {
        path: '/x/a.txt',
        content: 'hello',
      });
    });
  });

  describe('pickFolder', () => {
    it('invokes fs_pick_folder and returns null on cancel', async () => {
      invokeMock.mockResolvedValueOnce(null);
      const out = await pickFolder();
      expect(invokeMock).toHaveBeenCalledWith('fs_pick_folder');
      expect(out).toBeNull();
    });

    it('invokes fs_pick_folder and returns the chosen path', async () => {
      invokeMock.mockResolvedValueOnce('/chosen');
      const out = await pickFolder();
      expect(out).toBe('/chosen');
    });
  });

  describe('createFile', () => {
    it('invokes fs_create_file with the path', async () => {
      invokeMock.mockResolvedValueOnce(undefined);
      await createFile('/x/new.txt');
      expect(invokeMock).toHaveBeenCalledWith('fs_create_file', {
        path: '/x/new.txt',
      });
    });

    it('surfaces AlreadyExists as an FsError', async () => {
      invokeMock.mockRejectedValueOnce({
        kind: 'AlreadyExists',
        detail: '/x/new.txt',
      });
      await expect(createFile('/x/new.txt')).rejects.toMatchObject({
        payload: { kind: 'AlreadyExists', detail: '/x/new.txt' },
      });
    });
  });

  describe('deleteEntry', () => {
    it('invokes fs_delete_entry with the path', async () => {
      invokeMock.mockResolvedValueOnce(undefined);
      await deleteEntry('/x/doomed.txt');
      expect(invokeMock).toHaveBeenCalledWith('fs_delete_entry', {
        path: '/x/doomed.txt',
      });
    });

    it('surfaces NotFound as an FsError', async () => {
      invokeMock.mockRejectedValueOnce({
        kind: 'NotFound',
        detail: '/x/missing',
      });
      await expect(deleteEntry('/x/missing')).rejects.toBeInstanceOf(FsError);
    });
  });

  describe('renameEntry', () => {
    it('invokes fs_rename_entry with from + to', async () => {
      invokeMock.mockResolvedValueOnce(undefined);
      await renameEntry('/x/old.txt', '/x/new.txt');
      expect(invokeMock).toHaveBeenCalledWith('fs_rename_entry', {
        from: '/x/old.txt',
        to: '/x/new.txt',
      });
    });

    it('surfaces AlreadyExists as an FsError', async () => {
      invokeMock.mockRejectedValueOnce({
        kind: 'AlreadyExists',
        detail: '/x/new.txt',
      });
      await expect(
        renameEntry('/x/old.txt', '/x/new.txt'),
      ).rejects.toMatchObject({
        payload: { kind: 'AlreadyExists' },
      });
    });
  });
});
