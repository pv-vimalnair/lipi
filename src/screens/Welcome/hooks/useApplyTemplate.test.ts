/**
 * Tests for the pure `applyTemplateFlow` function.
 *
 * Phase J: covers the happy path (pick folder + apply +
 * open), the cancel path (picker returns null), the
 * Rust-error path (apply throws), and the no-double-
 * fire guard.
 *
 * The `pickFolder` and `applyTemplate` IPCs are
 * mocked via `vi.hoisted`; the `openWorkspace` import
 * is mocked the same way `useDeepLinkRouting.test.ts`
 * does it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceStore } from '@/shared/state/workspaceStore';

const { pickFolderMock, applyTemplateMock, openWorkspaceMock } = vi.hoisted(
  () => ({
    pickFolderMock: vi.fn(),
    applyTemplateMock: vi.fn(),
    openWorkspaceMock: vi.fn(),
  }),
);

vi.mock('@/ipc', async () => {
  const actual = await vi.importActual<typeof import('@/ipc')>('@/ipc');
  return {
    ...actual,
    pickFolder: pickFolderMock,
    applyTemplate: applyTemplateMock,
  };
});

vi.mock('./useOpenWorkspace', async () => {
  const actual =
    await vi.importActual<
      typeof import('@/screens/Welcome/hooks/useOpenWorkspace')
    >('@/screens/Welcome/hooks/useOpenWorkspace');
  return {
    ...actual,
    openWorkspace: openWorkspaceMock,
  };
});

const { applyTemplateFlow } = await import('./useApplyTemplate');

function resetStore(): void {
  useWorkspaceStore.setState({
    hydrated: true,
    currentPath: null,
    recents: [],
    status: { kind: 'idle' },
  });
}

describe('applyTemplateFlow', () => {
  beforeEach(() => {
    resetStore();
    pickFolderMock.mockReset();
    applyTemplateMock.mockReset();
    openWorkspaceMock.mockReset();
    openWorkspaceMock.mockResolvedValue(undefined);
  });
  afterEach(() => {
    pickFolderMock.mockReset();
    applyTemplateMock.mockReset();
    openWorkspaceMock.mockReset();
  });

  it('applies the template and opens the new workspace', async () => {
    pickFolderMock.mockResolvedValue('/parent');
    applyTemplateMock.mockResolvedValue({
      createdPaths: ['/parent/react-vite-app/package.json'],
      templateId: 'react-vite',
    });
    await applyTemplateFlow('react-vite');
    expect(applyTemplateMock).toHaveBeenCalledTimes(1);
    const [calledId, calledDest] = applyTemplateMock.mock.calls[0] as [
      string,
      string,
    ];
    expect(calledId).toBe('react-vite');
    expect(calledDest).toContain('react-vite-app');
    expect(openWorkspaceMock).toHaveBeenCalledTimes(1);
    // The status was committed to `ready` by openWorkspace
    // (we don't assert that here — useOpenWorkspace's
    // tests cover it).
  });

  it('drops back to idle on user cancel', async () => {
    pickFolderMock.mockResolvedValue(null);
    await applyTemplateFlow('tauri-rust');
    expect(applyTemplateMock).not.toHaveBeenCalled();
    expect(openWorkspaceMock).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().status.kind).toBe('idle');
  });

  it('sets an error status when the picker throws', async () => {
    pickFolderMock.mockRejectedValue(new Error('boom'));
    await applyTemplateFlow('node-api');
    expect(applyTemplateMock).not.toHaveBeenCalled();
    const s = useWorkspaceStore.getState().status;
    expect(s.kind).toBe('error');
    if (s.kind === 'error') {
      expect(s.message).toMatch(/folder picker/i);
    }
  });

  it('sets an error status when the Rust apply throws', async () => {
    pickFolderMock.mockResolvedValue('/parent');
    applyTemplateMock.mockRejectedValue(
      new Error('the destination already contains files'),
    );
    await applyTemplateFlow('python-venv');
    expect(openWorkspaceMock).not.toHaveBeenCalled();
    const s = useWorkspaceStore.getState().status;
    expect(s.kind).toBe('error');
    if (s.kind === 'error') {
      expect(s.message).toMatch(/Couldn't create/);
    }
  });

  it('blocks concurrent apply calls', async () => {
    let resolve: (v: string | null) => void = () => {};
    pickFolderMock.mockImplementation(
      () =>
        new Promise<string | null>((r) => {
          resolve = r;
        }),
    );
    // Fire the first apply and don't await.
    const first = applyTemplateFlow('go-module');
    // Yield so the 'opening' status commits.
    await Promise.resolve();
    expect(useWorkspaceStore.getState().status.kind).toBe('opening');
    // The second apply should be a no-op.
    await applyTemplateFlow('go-module');
    // Only the first call reached the picker; the
    // second one returned immediately.
    expect(pickFolderMock).toHaveBeenCalledTimes(1);
    // Resolve the first apply to clean up.
    resolve('/parent');
    applyTemplateMock.mockResolvedValue({
      createdPaths: ['/parent/go-module-app/main.go'],
      templateId: 'go-module',
    });
    await first;
  });
});
