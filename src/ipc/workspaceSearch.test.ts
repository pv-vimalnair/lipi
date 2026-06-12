/**
 * Tests for the workspace-search IPC
 * wrapper. The actual disk-touching
 * behaviour is covered by the Rust unit
 * tests in
 * `src-tauri/src/workspace_search.rs`.
 * These tests cover the JS surface: the
 * wrapper calls the right Tauri command
 * with the right argument shape, typed
 * errors get re-thrown as `SearchError`,
 * and unknown errors get wrapped.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  SearchError,
  workspaceSearch,
  type SearchOptions,
} from './workspaceSearch';

afterEach(() => {
  invokeMock.mockReset();
});

describe('workspaceSearch IPC', () => {
  it('invokes workspace_search with the opts object', async () => {
    invokeMock.mockResolvedValueOnce({
      matches: [
        { path: '/a/b.txt', line: 1, column: 1, lineText: 'foo' },
      ],
      filesScanned: 1,
      truncated: false,
    });
    const opts: SearchOptions = {
      query: 'foo',
      rootPath: '/a',
    };
    const out = await workspaceSearch(opts);
    expect(invokeMock).toHaveBeenCalledWith('workspace_search', {
      opts,
    });
    expect(out.matches).toEqual([
      { path: '/a/b.txt', line: 1, column: 1, lineText: 'foo' },
    ]);
    expect(out.truncated).toBe(false);
  });

  it('forwards caseInsensitive and extraIgnores through', async () => {
    invokeMock.mockResolvedValueOnce({
      matches: [],
      filesScanned: 0,
      truncated: false,
    });
    await workspaceSearch({
      query: 'foo',
      rootPath: '/a',
      caseInsensitive: true,
      extraIgnores: ['build'],
      maxResults: 50,
    });
    expect(invokeMock).toHaveBeenCalledWith('workspace_search', {
      opts: {
        query: 'foo',
        rootPath: '/a',
        caseInsensitive: true,
        extraIgnores: ['build'],
        maxResults: 50,
      },
    });
  });

  it('throws SearchError on a typed NotFound payload', async () => {
    invokeMock.mockRejectedValueOnce({
      kind: 'NotFound',
      detail: '/missing',
    });
    await expect(
      workspaceSearch({ query: 'x', rootPath: '/missing' }),
    ).rejects.toBeInstanceOf(SearchError);
  });

  it('throws SearchError on a typed InvalidQuery payload', async () => {
    invokeMock.mockRejectedValueOnce({
      kind: 'InvalidQuery',
      detail: 'query must not be empty',
    });
    await expect(
      workspaceSearch({ query: '', rootPath: '/a' }),
    ).rejects.toMatchObject({
      payload: { kind: 'InvalidQuery' },
    });
  });

  it('wraps unknown errors as a generic Io SearchError', async () => {
    invokeMock.mockRejectedValueOnce(new Error('boom'));
    await expect(
      workspaceSearch({ query: 'x', rootPath: '/a' }),
    ).rejects.toMatchObject({
      payload: { kind: 'Io', detail: 'Error: boom' },
    });
  });
});
