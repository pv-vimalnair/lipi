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
  // Phase 9.36 — the store's
  // `LspClient._subscribeStdout` calls
  // `onLspStdout` during `start()`. The
  // settings card tests don't drive LSP
  // servers, so a no-op unlisten is
  // enough. The `_catchupStdout` call
  // to `lspStdioRead` is also safe (the
  // mock returns `undefined` which the
  // SUT's catch handles).
  onLspStdout: vi.fn(async () => () => undefined),
  // Phase 9.36 — the SUT calls
  // `lspStdioRead` once during
  // `_catchupStdout`. The settings card
  // tests don't exercise the LSP hot
  // path, so returning an empty buffer
  // is fine.
  lspStdioRead: vi.fn(async () => new Uint8Array(0)),
}));

import { lspCheckAvailable } from '@/ipc/lsp';
import {
  useLspClientStore,
  workspaceKindKey,
} from '@/screens/EditorWorkspace/state/lspClientStore';
import {
  setUseRealServer,
  setUseRealServerByKind,
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
            editorCursorByPath: {},
            fileTreeScrollAnchor: null,
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
      // Phase 9.2d — the status map is
      // keyed by `${root}//${kind}`. The
      // test fixture uses the default
      // TS kind (the pre-9.2b behaviour).
      nextStatus.set(workspaceKindKey(workspaceRoot, 'typescript'), status);
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
  // Phase 9.2e — reset the per-kind kill switch
  // to "all kinds on" (the v1 default). Tests
  // that flip a specific kind do so in the test
  // body.
  setUseRealServerByKind({
    typescript: true,
    rust_analyzer: true,
    pyright: true,
    unknown: true,
  });
  // Phase 9.6: completion sub-toggle defaults
  // to `false` (built-in is faster for the
  // hot path). Reset to the default in
  // `beforeEach` so tests don't leak state.
  setUseRealServerForCompletion(false);
  vi.clearAllMocks();
});

afterEach(() => {
  setUseRealServerByKind({
    typescript: true,
    rust_analyzer: true,
    pyright: true,
    unknown: true,
  });
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
        // Phase 9.2d — plant the fake
        // client at the (root, 'typescript')
        // composite key. The card's
        // `activeKind` selector walks
        // `clients.keys()` and picks the
        // first match, so planting at
        // the TS key makes the card
        // "discover" the TS kind.
        nextClients.set(
          workspaceKindKey('/workspace/a', 'typescript'),
          fakeClient as never,
        );
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
    // localStorage should now be 'false' for
    // the TS kind (the card's kill switch).
    expect(getUseRealServer('typescript')).toBe(false);
    // The client should have been removed
    // from the store (dispose was called).
    // Phase 9.2d — the kill-switch path
    // uses `disposeAllKindsForWorkspace`,
    // which disposes *every* (root, kind)
    // pair for the workspace. The fake
    // client was planted at the TS key, so
    // that key is the one to check.
    expect(
      useLspClientStore
        .getState()
        .clients.has(workspaceKindKey('/workspace/a', 'typescript')),
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
  it('hides the completion sub-toggle when every kind\'s kill switch is OFF', async () => {
    // Phase 9.2e — the completion
    // sub-toggle is hidden when *every*
    // supported kind's kill switch is
    // OFF (no real server is in use, so
    // the completion sub-toggle is
    // meaningless). If at least one
    // kind is on, the toggle is shown
    // (it applies to every enabled
    // kind).
    setUseRealServerByKind({
      typescript: false,
      rust_analyzer: false,
      pyright: false,
      unknown: false,
    });
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
    setUseRealServer('typescript', true); // Master on (default)
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

  /**
   * Phase 9.2e — the card renders one row
   * per supported kind (typescript,
   * rust_analyzer, pyright). Each row is
   * independent — its own status badge,
   * kill switch, restart button.
   */
  it('renders one row per supported LSP kind (Phase 9.2e)', async () => {
    addWorkspace('/workspace/a');
    const mounted = mountCard();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const rows = mounted.container.querySelectorAll(
      '[data-testid="lsp-row"]',
    );
    expect(rows.length).toBe(3);
    const kinds = Array.from(rows).map(
      (r) => r.getAttribute('data-kind'),
    );
    expect(kinds).toEqual(['typescript', 'rust_analyzer', 'pyright']);
    mounted.unmount();
  });

  /**
   * Phase 9.2e — per-row kill switches.
   * Disabling the TS row's kill switch
   * disposes only the TS client; the
   * rust_analyzer and pyright clients
   * (if any) are unaffected.
   */
  it('per-row kill switch targets the right kind (Phase 9.2e)', async () => {
    addWorkspace('/workspace/a');
    setLspStatus('/workspace/a', 'ready');
    // Plant fake clients for two kinds.
    const tsClient = { dispose: vi.fn(), shutdown: vi.fn() } as unknown as { dispose: () => void };
    const pyrightClient = { dispose: vi.fn(), shutdown: vi.fn() } as unknown as { dispose: () => void };
    act(() => {
      useLspClientStore.setState((s) => {
        const next = new Map(s.clients);
        next.set(workspaceKindKey('/workspace/a', 'typescript'), tsClient as never);
        next.set(workspaceKindKey('/workspace/a', 'pyright'), pyrightClient as never);
        return { ...s, clients: next };
      });
    });
    const mounted = mountCard();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    // Find the TS row's kill switch.
    const tsKillSwitch = mounted.container.querySelector(
      '[data-testid="lsp-kill-switch"][data-kind="typescript"]',
    ) as HTMLInputElement;
    expect(tsKillSwitch).toBeTruthy();
    // Flip the TS kill switch OFF.
    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Simulate.change(tsKillSwitch, { target: { checked: false } } as any);
      await new Promise((r) => setTimeout(r, 5));
    });
    // Only the TS kind's localStorage value
    // changed; rust_analyzer and pyright
    // remain enabled.
    expect(getUseRealServer('typescript')).toBe(false);
    expect(getUseRealServer('rust_analyzer')).toBe(true);
    expect(getUseRealServer('pyright')).toBe(true);
    // The TS client was disposed; the
    // pyright client is still in the store.
    expect(
      useLspClientStore
        .getState()
        .clients.has(workspaceKindKey('/workspace/a', 'typescript')),
    ).toBe(false);
    expect(
      useLspClientStore
        .getState()
        .clients.has(workspaceKindKey('/workspace/a', 'pyright')),
    ).toBe(true);
    mounted.unmount();
  });

  /**
   * Phase 9.2e — the completion sub-toggle
   * is visible when *any* kind's kill
   * switch is on. Disabling all kinds
   * hides it (already covered above); we
   * also verify the "any" case.
   */
  it('shows the completion sub-toggle when at least one kind is enabled', async () => {
    // Disable TS and rust-analyzer; leave
    // pyright enabled.
    setUseRealServerByKind({
      typescript: false,
      rust_analyzer: false,
      pyright: true,
      unknown: false,
    });
    addWorkspace('/workspace/a');
    const mounted = mountCard();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const completionToggle = mounted.container.querySelector(
      '[data-testid="lsp-completion-toggle"]',
    );
    expect(completionToggle).toBeTruthy();
    mounted.unmount();
  });
});
