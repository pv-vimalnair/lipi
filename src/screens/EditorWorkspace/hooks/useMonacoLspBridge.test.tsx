/**
 * useMonacoLspBridge — unit tests.
 *
 * The bridge hook glues Monaco to the LSP client.
 * We mock the three seams it depends on:
 *   1. `@/ipc/lsp` — pre-stages canned responses
 *      and captures writes.
 *   2. `./lspProviders` — stubs `registerLspProviders`
 *      so we can assert it's called and capture the
 *      registered disposables.
 *   3. The Monaco `editor` object — a minimal fake
 *      with the methods the bridge uses
 *      (`getModel`, `onDidChangeModelContent`,
 *      `onDidChangeModel`).
 *
 * Coverage:
 *   1. The hook is a no-op when the kill switch is
 *      disabled (no client is created, no providers
 *      are registered).
 *   2. The hook creates an LspClient and registers
 *      providers when the kill switch is on and a
 *      workspace is open.
 *   3. The hook sends `didClose` + `didOpen` when
 *      Monaco fires `onDidChangeModel` (file switch).
 */

import { useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the `monaco-editor` package — vitest
// doesn't load it (the package ships only
// ESM that needs vite's optimizer). The
// bridge just uses `monaco.languages` and
// `monaco.editor.IStandaloneCodeEditor`,
// and we never actually call provider
// APIs (we mock `lspProviders`).
vi.mock('monaco-editor', () => {
  const noopDisposable = { dispose: () => {} };
  return {
    languages: {
      registerDefinitionProvider: () => noopDisposable,
      registerReferenceProvider: () => noopDisposable,
      registerRenameProvider: () => noopDisposable,
      registerImplementationProvider: () => noopDisposable,
      registerDocumentSymbolProvider: () => noopDisposable,
      registerCodeActionProvider: () => noopDisposable,
      registerHoverProvider: () => noopDisposable,
      registerSignatureHelpProvider: () => noopDisposable,
      registerInlayHintsProvider: () => noopDisposable,
    },
    editor: {},
  };
});

// Mocks must be installed BEFORE the module-under-test
// imports. `vi.mock` is hoisted, so this is fine.
vi.mock('@/ipc/lsp', () => {
  const writes: Uint8Array[] = [];
  return {
    writes,
    lspRunStdio: vi.fn(async () => ({
      handleId: 'mock_handle_1',
      resolvedCommand: 'typescript-language-server',
    })),
    lspStdioRead: vi.fn(async (_h: string, maxBytes: number) => {
      // Pre-staged queue. The mock
      // lspStdioWrite below also enqueues
      // canned responses.
      const q = (globalThis as { __lspQ?: Uint8Array[] }).__lspQ ?? [];
      if (q.length === 0) return new Uint8Array(0);
      const next = q.shift()!;
      return next.byteLength > maxBytes ? next.slice(0, maxBytes) : next;
    }),
    lspStdioWrite: vi.fn(
      async (_h: string, bytes: Uint8Array) => {
        writes.push(bytes);
        // On `initialize` request, enqueue a
        // canned response with the right id.
        const text = new TextDecoder().decode(bytes);
        const headerEnd = text.indexOf('\r\n\r\n');
        if (headerEnd !== -1) {
          const body = text.slice(headerEnd + 4);
          try {
            const msg = JSON.parse(body) as {
              id?: number;
              method?: string;
            };
            if (
              msg.method === 'initialize' &&
              typeof msg.id === 'number'
            ) {
              const response = {
                jsonrpc: '2.0' as const,
                id: msg.id,
                result: { capabilities: { definitionProvider: true } },
              };
              const bodyBytes = new TextEncoder().encode(
                JSON.stringify(response),
              );
              const header = `Content-Length: ${bodyBytes.byteLength}\r\n\r\n`;
              const out = new Uint8Array(
                new TextEncoder().encode(header).byteLength +
                  bodyBytes.byteLength,
              );
              out.set(new TextEncoder().encode(header), 0);
              out.set(bodyBytes, new TextEncoder().encode(header).byteLength);
              const q =
                (globalThis as { __lspQ?: Uint8Array[] }).__lspQ ?? [];
              q.push(out);
              (globalThis as { __lspQ?: Uint8Array[] }).__lspQ = q;
            }
          } catch {
            /* ignore */
          }
        }
        return bytes.byteLength;
      },
    ),
    lspStdioClose: vi.fn(async () => undefined),
    lspCheckAvailable: vi.fn(async () => ({
      available: true,
      installHint: 'npm i -g typescript-language-server',
      version: '4.3.3',
    })),
    // Phase 9.5 — the store's
    // `ensureCrashListener` calls
    // `onLspCrashed` to subscribe to
    // `lsp://crashed` events. Tests
    // don't simulate real crashes, so
    // we return a no-op unlisten.
    onLspCrashed: vi.fn(async () => () => undefined),
  };
});

interface FakeModel {
  uri: { toString: () => string };
  getLanguageId: () => string;
  getValue: () => string;
  getVersionId: () => number;
}

interface FakeModelChangedEvent {
  oldModelUrl?: { toString: () => string } | null;
  newModelUrl?: { toString: () => string } | null;
}

let fakeModel: FakeModel = {
  uri: { toString: () => 'file:///workspace/a/index.ts' },
  getLanguageId: () => 'typescript',
  getValue: () => 'const x = 1;\n',
  getVersionId: () => 1,
};

let fakeContentListeners: Array<() => void> = [];
let fakeModelListeners: Array<(e: FakeModelChangedEvent) => void> = [];

const fakeEditor = {
  getModel: () => fakeModel,
  onDidChangeModelContent: (cb: () => void) => {
    fakeContentListeners.push(cb);
    return { dispose: () => {} };
  },
  onDidChangeModel: (cb: (e: FakeModelChangedEvent) => void) => {
    fakeModelListeners.push(cb);
    return { dispose: () => {} };
  },
};

vi.mock('./lspProviders', async (importOriginal) => {
  // Re-use the real `sendDidOpen` /
  // `sendDidChange` helpers so the test
  // exercises the real "convert model →
  // LSP params" path. Only mock
  // `registerLspProviders` (we don't
  // need the real Monaco provider
  // machinery, and the bridge just
  // disposes the returned array on
  // cleanup).
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    registerLspProviders: vi.fn(() => [
      { dispose: () => {} },
      { dispose: () => {} },
    ]),
  };
});

import { useLspClientStore } from '../state/lspClientStore';
import {
  setUseRealServer,
  setUseRealServerForCompletion,
} from '../state/lspKillSwitch';
import { useWorkspaceStore } from '@/shared/state/workspaceStore';
import { useMonacoLspBridge } from './useMonacoLspBridge';
import { registerLspProviders } from './lspProviders';

interface MountedHook {
  unmount: () => void;
}

function mountBridge(editor: unknown = fakeEditor): MountedHook {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  function Harness(): null {
    useMonacoLspBridge({ editor });
    useEffect(() => {
      // touch the effect — no-op
    }, []);
    return null;
  }

  act(() => {
    root.render(<Harness />);
  });
  return {
    unmount: () => {
      act(() => {
        root.unmount();
      });
      document.body.removeChild(container);
    },
  };
}

function addWorkspace(path: string): void {
  // The workspace store exposes `workspaces` as an
  // array. The simplest way to add a workspace is to
  // set state directly (it bypasses `addWorkspace` /
  // `hydrate` validation but is fine for the test).
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

beforeEach(() => {
  // Reset module state.
  (globalThis as { __lspQ?: Uint8Array[] }).__lspQ = [];
  fakeModel = {
    uri: { toString: () => 'file:///workspace/a/index.ts' },
    getLanguageId: () => 'typescript',
    getValue: () => 'const x = 1;\n',
    getVersionId: () => 1,
  };
  fakeContentListeners = [];
  fakeModelListeners = [];
  // Phase 9.5 — the store's
  // `crashUnlisten` /
  // `handleToWorkspace` /
  // `respawnTimers` / `startPromises` are
  // closure-scoped and persist across
  // tests. Without the reset, the
  // `ensureCrashListener` from a prior
  // test short-circuits and any
  // `lsp://crashed` events this test
  // fires go to a detached handler. We
  // also clear any live clients left
  // over from a previous test (the
  // `afterEach` `void client.shutdown()`
  // is fire-and-forget, so the client
  // may still be alive when the next
  // test starts).
  useLspClientStore.getState().__resetLspClientStoreForTests();
  useLspClientStore.setState({
    clients: new Map(),
    statusByWorkspace: new Map(),
    crashByWorkspace: new Map(),
  });
  useWorkspaceStore.setState({
    workspaces: [],
    activeId: null,
  });
  // Default to "use real server on" unless a test
  // flips it.
  setUseRealServer(true);
  vi.clearAllMocks();
});

afterEach(async () => {
  // Restore default kill switch.
  setUseRealServer(true);
  // Restore default completion sub-toggle
  // (Phase 9.6: independent of the master
  // kill switch, defaults to `false`).
  setUseRealServerForCompletion(false);
  // Phase 9.5 — tear down any live
  // LspClient so the previous test's
  // reader loop doesn't consume
  // `__lspQ` entries meant for the next
  // test's new client. The store's
  // `dispose` is async (it awaits
  // `client.shutdown()`); without
  // awaiting it, the new test starts
  // before the old client is gone, and
  // both readers race for the shared
  // `__lspQ`.
  const liveWorkspaces = Array.from(
    useLspClientStore.getState().clients.keys(),
  );
  for (const workspaceRoot of liveWorkspaces) {
    await useLspClientStore.getState().dispose(workspaceRoot);
  }
  // Reset the closure-scoped state too
  // (handle map, crash listener, respawn
  // timers).
  useLspClientStore.getState().__resetLspClientStoreForTests();
});

describe('useMonacoLspBridge', () => {
  it('is a no-op when the kill switch is disabled', async () => {
    setUseRealServer(false);
    addWorkspace('/workspace/a');
    const mounted = mountBridge();
    // Wait a few ticks for the effect to run.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    // The store has no client — the bridge should
    // have bailed out at the kill switch.
    expect(
      useLspClientStore.getState().clients.has('/workspace/a'),
    ).toBe(false);
    // `registerLspProviders` was never called.
    expect(registerLspProviders).not.toHaveBeenCalled();
    mounted.unmount();
  });

  it('creates an LspClient and registers providers when kill switch is on', async () => {
    addWorkspace('/workspace/a');
    const mounted = mountBridge();
    // Wait for the bridge to spawn the client.
    await act(async () => {
      // Poll up to 1s.
      const deadline = Date.now() + 1000;
      while (
        Date.now() < deadline &&
        !useLspClientStore.getState().clients.has('/workspace/a')
      ) {
        await new Promise((r) => setTimeout(r, 10));
      }
    });
    // Wait for providers to be registered
    // (a few more ticks after the client
    // handshake).
    await act(async () => {
      const deadline = Date.now() + 1000;
      while (
        Date.now() < deadline &&
        (registerLspProviders as unknown as { mock: { calls: unknown[] } })
          .mock.calls.length === 0
      ) {
        await new Promise((r) => setTimeout(r, 10));
      }
    });
    expect(
      useLspClientStore.getState().clients.has('/workspace/a'),
    ).toBe(true);
    expect(registerLspProviders).toHaveBeenCalledTimes(1);
    mounted.unmount();
  });

  it('sends didClose for the old model and didOpen for the new one on file switch', async () => {
    addWorkspace('/workspace/a');
    const mounted = mountBridge();
    // Wait for the bridge to spawn the client and
    // open the first model.
    await act(async () => {
      const deadline = Date.now() + 1000;
      while (
        Date.now() < deadline &&
        !useLspClientStore.getState().clients.has('/workspace/a')
      ) {
        await new Promise((r) => setTimeout(r, 10));
      }
    });
    // Now swap the model and fire the model-change
    // callback.
    const oldUri = fakeModel.uri.toString();
    const newModel: FakeModel = {
      uri: { toString: () => 'file:///workspace/a/other.ts' },
      getLanguageId: () => 'typescript',
      getValue: () => 'export const y = 2;\n',
      getVersionId: () => 2,
    };
    fakeModel = newModel;
    await act(async () => {
      for (const cb of fakeModelListeners) {
        cb({
          oldModelUrl: { toString: () => oldUri },
          newModelUrl: newModel.uri,
        });
      }
      await new Promise((r) => setTimeout(r, 10));
    });
    // The bridge should have called
    // `sendDidOpen` once on mount, then
    // `client.notify('textDocument/didClose', ...)`
    // + another `sendDidOpen` on the model
    // swap. We assert via the captured writes
    // (every `client.notify` / `client.request`
    // ends up in `lspStdioWrite`, which we mock).
    const lspMock = (await import('@/ipc/lsp')) as unknown as {
      writes: Uint8Array[];
    };
    const writes = lspMock.writes;
    const writeText = writes
      .map((w) => new TextDecoder().decode(w))
      .join('');
    // First call is the `initialize` request,
    // then `initialized`, then `textDocument/didOpen`,
    // then `textDocument/didClose`, then another
    // `textDocument/didOpen`.
    expect(writeText).toContain('textDocument/didClose');
    expect(writeText).toContain('textDocument/didOpen');
    // The didClose URI matches the old model.
    expect(writeText).toContain(oldUri);
    mounted.unmount();
  });

  /**
   * Phase 9.6: the bridge reads
   * `getUseRealServerForCompletion()` and passes
   * `includeCompletion` to `registerLspProviders`.
   *
   * Default: `false` (built-in is faster for
   * completion). The bridge passes
   * `{ includeCompletion: false }` and the
   * settings card reflects the matching
   * sub-toggle state.
   *
   * When the user opts in via the settings
   * card, the bridge passes
   * `{ includeCompletion: true }` and the
   * completion provider is registered.
   */
  it('passes includeCompletion:false by default to registerLspProviders', async () => {
    // Use a fresh workspace path so the
    // previous test's stale `startPromises`
    // entry doesn't shadow this test's
    // `getOrCreate` call.
    addWorkspace('/workspace/comp-default');
    // Sanity: pre-state should be clean.
    expect(useLspClientStore.getState().clients.size).toBe(0);
    const mounted = mountBridge();
    // Wait for the bridge to spawn the
    // client first (the providers are
    // registered after the handshake
    // resolves).
    await act(async () => {
      const deadline = Date.now() + 1000;
      while (
        Date.now() < deadline &&
        !useLspClientStore.getState().clients.has('/workspace/comp-default')
      ) {
        await new Promise((r) => setTimeout(r, 10));
      }
    });
    // Wait for `registerLspProviders` to be
    // called (it happens after the LSP
    // handshake).
    await act(async () => {
      const deadline = Date.now() + 1000;
      while (
        Date.now() < deadline &&
        (registerLspProviders as unknown as { mock: { calls: unknown[] } })
          .mock.calls.length === 0
      ) {
        await new Promise((r) => setTimeout(r, 10));
      }
    });
    expect(registerLspProviders).toHaveBeenCalledTimes(1);
    // The 4th argument is `options` (the
    // completion sub-toggle). Default is
    // `{ includeCompletion: false }`.
    const calls = (registerLspProviders as unknown as {
      mock: { calls: unknown[][] };
    }).mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[3]).toEqual({ includeCompletion: false });
    mounted.unmount();
  });

  it('passes includeCompletion:true to registerLspProviders when the completion sub-toggle is on', async () => {
    setUseRealServerForCompletion(true);
    // Fresh workspace path (see above).
    addWorkspace('/workspace/comp-on');
    const mounted = mountBridge();
    // Wait for the bridge to spawn the
    // client first.
    await act(async () => {
      const deadline = Date.now() + 1000;
      while (
        Date.now() < deadline &&
        !useLspClientStore.getState().clients.has('/workspace/comp-on')
      ) {
        await new Promise((r) => setTimeout(r, 10));
      }
    });
    // Wait for `registerLspProviders` to be
    // called.
    await act(async () => {
      const deadline = Date.now() + 1000;
      while (
        Date.now() < deadline &&
        (registerLspProviders as unknown as { mock: { calls: unknown[] } })
          .mock.calls.length === 0
      ) {
        await new Promise((r) => setTimeout(r, 10));
      }
    });
    expect(registerLspProviders).toHaveBeenCalledTimes(1);
    const calls = (registerLspProviders as unknown as {
      mock: { calls: unknown[][] };
    }).mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[3]).toEqual({ includeCompletion: true });
    mounted.unmount();
  });
});
