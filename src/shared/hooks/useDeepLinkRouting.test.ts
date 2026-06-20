/**
 * Tests for `useDeepLinkRouting`'s pure routing function.
 *
 * The hook itself is a thin effect-wrapped `onDeepLink`
 * subscription. We test the `routeDeepLink` pure function
 * directly so the React tree isn't needed (the project
 * doesn't ship `@testing-library/react`).
 *
 * What we cover:
 *  1. Valid URL → `openWorkspace` is called with the
 *     decoded path.
 *  2. Missing path → status is set to `error` with a
 *     friendly message; `openWorkspace` is NOT called.
 *  3. Path traversal → same, with a traversal-specific
 *     message.
 *  4. Outside-user-dirs → same, with the
 *     outside-user-dirs message.
 *  5. Multiple consecutive URLs route independently
 *     (no implicit global state).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceStore } from '@/shared/state/workspaceStore';

const { openWorkspaceMock } = vi.hoisted(() => ({
  openWorkspaceMock: vi.fn(),
}));

vi.mock('@/screens/Welcome/hooks/useOpenWorkspace', async () => {
  const actual =
    await vi.importActual<
      typeof import('@/screens/Welcome/hooks/useOpenWorkspace')
    >('@/screens/Welcome/hooks/useOpenWorkspace');
  return {
    ...actual,
    openWorkspace: openWorkspaceMock,
  };
});

const { routeDeepLink } = await import('./useDeepLinkRouting');

const WIN_DIRS = {
  home: 'C:\\Users\\alice',
  documents: 'C:\\Users\\alice\\Documents',
  desktop: 'C:\\Users\\alice\\Desktop',
};

const acceptPath = async (path: string): Promise<string> => path;

function resetStore(): void {
  // M6a: the store no longer
  // has a `currentPath`
  // field.
  useWorkspaceStore.setState({
    hydrated: true,
    workspaces: [],
    activeId: null,
    recents: [],
    status: { kind: 'idle' },
  });
}

describe('routeDeepLink', () => {
  beforeEach(() => {
    resetStore();
    openWorkspaceMock.mockReset();
    openWorkspaceMock.mockResolvedValue(undefined);
  });
  afterEach(() => {
    openWorkspaceMock.mockReset();
  });

  it('calls openWorkspace with the validated path on a valid URL', async () => {
    const validatePath = vi
      .fn<(path: string) => Promise<string>>()
      .mockResolvedValue('C:\\Users\\alice\\Projects\\my-app-canonical');
    await routeDeepLink(
      'lipi://open?path=C%3A%5CUsers%5Calice%5CProjects%5Cmy-app',
      WIN_DIRS,
      validatePath,
    );
    expect(validatePath).toHaveBeenCalledWith(
      'C:\\Users\\alice\\Projects\\my-app',
    );
    expect(openWorkspaceMock).toHaveBeenCalledTimes(1);
    expect(openWorkspaceMock).toHaveBeenCalledWith(
      'C:\\Users\\alice\\Projects\\my-app-canonical',
    );
    // The store's status should not have been set to error.
    expect(useWorkspaceStore.getState().status.kind).toBe('idle');
  });

  it('sets an error status and skips openWorkspace when the path is missing', async () => {
    await routeDeepLink('lipi://open', WIN_DIRS, acceptPath);
    expect(openWorkspaceMock).not.toHaveBeenCalled();
    const s = useWorkspaceStore.getState().status;
    expect(s.kind).toBe('error');
    if (s.kind === 'error') {
      expect(s.message).toMatch(/deep link/i);
    }
  });

  it('sets an error status when the path contains ..', async () => {
    await routeDeepLink(
      'lipi://open?path=C%3A%5CUsers%5Calice%5CDocuments%5C..%5C..%5CWindows',
      WIN_DIRS,
      acceptPath,
    );
    expect(openWorkspaceMock).not.toHaveBeenCalled();
    const s = useWorkspaceStore.getState().status;
    expect(s.kind).toBe('error');
    if (s.kind === 'error') {
      expect(s.message).toMatch(/rejected for safety/);
    }
  });

  it('sets an error status when the path is outside user dirs', async () => {
    await routeDeepLink(
      'lipi://open?path=C%3A%5CWindows%5CSystem32%5Ccmd.exe',
      WIN_DIRS,
      acceptPath,
    );
    expect(openWorkspaceMock).not.toHaveBeenCalled();
    const s = useWorkspaceStore.getState().status;
    expect(s.kind).toBe('error');
    if (s.kind === 'error') {
      expect(s.message).toMatch(/outside/i);
    }
  });

  it('sets an error status when Rust-side canonical validation rejects', async () => {
    const validatePath = vi
      .fn<(path: string) => Promise<string>>()
      .mockRejectedValue('outside-user-dirs');
    await routeDeepLink(
      'lipi://open?path=C%3A%5CUsers%5Calice%5CDocuments%5Ca.md',
      WIN_DIRS,
      validatePath,
    );
    expect(openWorkspaceMock).not.toHaveBeenCalled();
    const s = useWorkspaceStore.getState().status;
    expect(s.kind).toBe('error');
    if (s.kind === 'error') {
      expect(s.message).toMatch(/outside/i);
    }
  });

  it('routes two consecutive URLs independently', async () => {
    await routeDeepLink(
      'lipi://open?path=C%3A%5CUsers%5Calice%5CDocuments%5Ca.md',
      WIN_DIRS,
      acceptPath,
    );
    await routeDeepLink(
      'lipi://open?path=C%3A%5CUsers%5Calice%5CDesktop%5Cb.md',
      WIN_DIRS,
      acceptPath,
    );
    expect(openWorkspaceMock).toHaveBeenCalledTimes(2);
    expect(openWorkspaceMock).toHaveBeenNthCalledWith(
      1,
      'C:\\Users\\alice\\Documents\\a.md',
    );
    expect(openWorkspaceMock).toHaveBeenNthCalledWith(
      2,
      'C:\\Users\\alice\\Desktop\\b.md',
    );
  });
});
