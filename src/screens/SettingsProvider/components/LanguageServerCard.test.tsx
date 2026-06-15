/**
 * LanguageServerCard — unit tests.
 *
 * Coverage:
 *   1. Renders the "Ready" badge when the
 *      LspClient store has a `ready` status
 *      for the active workspace.
 *   2. Renders the install hint when
 *      `lspCheckAvailable` reports
 *      `available: false`.
 *   3. Toggling the kill switch checkbox
 *      writes to `localStorage` and (when
 *      flipped OFF) disposes the live client.
 */

import { createRoot, type Root } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/ipc/lsp', () => ({
  lspCheckAvailable: vi.fn(async () => ({
    available: true,
    installHint: 'npm install -g typescript-language-server',
    version: '4.3.3',
  })),
}));

import { lspCheckAvailable } from '@/ipc/lsp';
import { useLspClientStore } from '@/screens/EditorWorkspace/state/lspClientStore';
import {
  setUseRealServer,
  getUseRealServer,
  setUseRealServerForCompletion,
  getUseRealServerForCompletion,
} from '@/screens/EditorWorkspace/state/lspKillSwitch';
import { useWorkspaceStore } from '@/shared/state/workspaceStore';

import { LanguageServerCard } from './LanguageServerCard';

interface Mounted {
  root: Root;
  container: HTMLDivElement;
  unmount: () => void;
}

function mountCard(): Mounted {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<LanguageServerCard />);
  });
  return {
    root,
    container,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      document.body.removeChild(container);
    },
  };
}

function addWorkspace(path: string): void {
  act(() => {
    useWorkspaceStore.setState({
      workspaces: [
        {
          id: path,
          path,
          addedAt: Date.now(),
          state: {
            expandedDirs: [],
            selectedPath: null,
            openEditorTabPaths: [],
            activeEditorTabPath: null,
          },
        },
      ],
      activeId: path,
    });
  });
}

function setLspStatus(workspaceRoot: string, status: 'stopped' | 'starting' | 'ready' | 'error'): void {
  act(() => {
    useLspClientStore.setState((s) => {
      const nextStatus = new Map(s.statusByWorkspace);
      nextStatus.set(workspaceRoot, status);
      return { ...s, statusByWorkspace: nextStatus };
    });
  });
}

beforeEach(() => {
  useLspClientStore.setState({
    clients: new Map(),
    statusByWorkspace: new Map(),
  });
  useWorkspaceStore.setState({
    workspaces: [],
    activeId: null,
  });
  setUseRealServer(true);
  // Phase 9.6: completion sub-toggle defaults
  // to `false` (built-in is faster for the
  // hot path). Reset to the default in
  // `beforeEach` so tests don't leak state.
  setUseRealServerForCompletion(false);
  vi.clearAllMocks();
});

afterEach(() => {
  setUseRealServer(true);
  setUseRealServerForCompletion(false);
});

describe('LanguageServerCard', () => {
  it('shows the Ready badge when the LspClient store has a ready status for the active workspace', async () => {
    addWorkspace('/workspace/a');
    setLspStatus('/workspace/a', 'ready');
    const mounted = mountCard();
    // Wait a tick for the effect to run
    // (lspCheckAvailable resolves).
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const badge = mounted.container.querySelector(
      '[data-testid="lsp-status-badge"]',
    );
    expect(badge?.textContent).toBe('Ready');
    mounted.unmount();
  });

  it('shows the install hint when lspCheckAvailable reports unavailable', async () => {
    // Override the mock to report unavailable.
    (lspCheckAvailable as unknown as { mockImplementation: (fn: () => Promise<unknown>) => void }).mockImplementation(
      async () => ({
        available: false,
        installHint: 'npm install -g typescript-language-server',
        version: null,
      }),
    );
    addWorkspace('/workspace/a');
    const mounted = mountCard();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const hint = mounted.container.querySelector(
      '[data-testid="lsp-install-hint"]',
    );
    expect(hint?.textContent).toContain('Not installed');
    expect(hint?.textContent).toContain(
      'npm install -g typescript-language-server',
    );
    mounted.unmount();
  });

  it('toggling the kill switch writes to localStorage and disposes the live client when flipped off', async () => {
    addWorkspace('/workspace/a');
    setLspStatus('/workspace/a', 'ready');
    // Plant a fake client so we can verify
    // dispose was called.
    const fakeClient = { dispose: vi.fn(), shutdown: vi.fn() } as unknown as { dispose: () => void };
    act(() => {
      useLspClientStore.setState((s) => {
        const nextClients = new Map(s.clients);
        nextClients.set('/workspace/a', fakeClient as never);
        return { ...s, clients: nextClients };
      });
    });
    const mounted = mountCard();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const checkbox = mounted.container.querySelector(
      '[data-testid="lsp-kill-switch"]',
    ) as HTMLInputElement;
    expect(checkbox).toBeTruthy();
    // Default: kill switch is ON (use real server).
    expect(checkbox.checked).toBe(true);
    // Flip it OFF using React's test
    // utilities. `Simulate.change` correctly
    // updates the input's value via the
    // React-internal value tracker so the
    // onChange handler fires.
    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Simulate.change(checkbox, { target: { checked: false } } as any);
      await new Promise((r) => setTimeout(r, 5));
    });
    // localStorage should now be 'false'.
    expect(getUseRealServer()).toBe(false);
    // The client should have been removed
    // from the store (dispose was called).
    expect(
      useLspClientStore.getState().clients.has('/workspace/a'),
    ).toBe(false);
    mounted.unmount();
  });

  /**
   * Phase 9.6 — the completion sub-toggle.
   *
   *   - The sub-toggle is hidden when the
   *     master kill switch is OFF (real
   *     server is not in use, so completion
   *     toggle is meaningless).
   *   - The sub-toggle is visible when the
   *     master kill switch is ON.
   *   - Clicking the sub-toggle persists
   *     the new value to localStorage.
   */
  it('hides the completion sub-toggle when the master kill switch is OFF', async () => {
    // Master off → built-in is used for
    // everything, completion sub-toggle
    // is hidden.
    setUseRealServer(false);
    addWorkspace('/workspace/a');
    const mounted = mountCard();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const completionToggle = mounted.container.querySelector(
      '[data-testid="lsp-completion-toggle"]',
    );
    expect(completionToggle).toBeNull();
    mounted.unmount();
  });

  it('toggles the completion sub-toggle and persists to localStorage', async () => {
    setUseRealServer(true); // Master on (default)
    setUseRealServerForCompletion(false); // Completion off (default)
    addWorkspace('/workspace/a');
    const mounted = mountCard();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    // The sub-toggle should be visible (the
    // master is on) and currently unchecked
    // (built-in is used for completion).
    const checkbox = mounted.container.querySelector(
      '[data-testid="lsp-completion-toggle"]',
    ) as HTMLInputElement;
    expect(checkbox).toBeTruthy();
    expect(checkbox.checked).toBe(false);
    // Click the sub-toggle ON. Use
    // `Simulate.change` so React's internal
    // value tracker updates and `onChange`
    // fires.
    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Simulate.change(checkbox, { target: { checked: true } } as any);
      await new Promise((r) => setTimeout(r, 5));
    });
    // localStorage should now be 'true'.
    expect(getUseRealServerForCompletion()).toBe(true);
    expect(checkbox.checked).toBe(true);
    mounted.unmount();
  });
});
