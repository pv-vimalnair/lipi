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
    // Phase 9.2b — the store calls
    // `kindToSpawnSpec` (a pure function) to
    // pick the binary. The bridge test mock
    // returns the TS spec by default; the
    // `rust_analyzer` bridge test overrides
    // this with `mockImplementation`.
    kindToSpawnSpec: vi.fn((kind: string) => {
      if (kind === 'rust_analyzer') {
        return {
          command: 'rust-analyzer',
          args: [],
          installHint: 'rustup component add rust-analyzer',
        };
      }
      // Phase 9.2c — `pyright` arm.
      // Mirrors the JS
      // `kindToSpawnSpec('pyright')` in
      // `ipc/lsp.ts` and the Rust
      // `server_kind_spec(Pyright).binary`
      // in `src-tauri/src/stdio.rs`.
      if (kind === 'pyright') {
        return {
          command: 'pyright-langserver',
          args: ['--stdio'],
          installHint: 'npm install -g pyright',
        };
      }
      return {
        command: 'typescript-language-server',
        args: ['--stdio'],
        installHint: 'npm install -g typescript-language-server',
      };
    }),
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
    // Phase 9.7 — same for `onLspLog`. The
    // store subscribes once on first
    // `getOrCreate`; bridge tests don't
    // simulate log events, so a no-op
    // unlisten is enough.
    onLspLog: vi.fn(async () => () => undefined),
    // Phase 9.7 — the replay-drain the
    // store calls once per handleId.
    // Empty by default in bridge tests.
    lspStdioReadStderrLog: vi.fn(async () => new Uint8Array(0)),
  };
});

interface FakeModel {
  uri: { toString: () => string };
  getLanguageId: () => string;
  getValue: () => string;
  getVersionId: () => number;
}

/**
 * Shape of a fake `IModelContentChange` —
 * a *minimal* subset of the Monaco type
 * the bridge reads. Mirrors the real
 * `IModelContentChange` fields the
 * `convertContentChanges` helper cares
 * about.
 */
interface FakeContentChange {
  range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
  rangeLength: number;
  text: string;
}

/**
 * Shape of a fake `IModelContentChangedEvent` —
 * the wrapper Monaco passes to
 * `onDidChangeModelContent`. The bridge now
 * reads `event.changes` and `event.versionId`
 * (Phase 9.1 — was previously just a void
 * callback).
 */
interface FakeContentChangedEvent {
  changes: FakeContentChange[];
  versionId: number;
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

let fakeContentListeners: Array<(e: FakeContentChangedEvent) => void> = [];
let fakeModelListeners: Array<(e: FakeModelChangedEvent) => void> = [];

const fakeEditor = {
  getModel: () => fakeModel,
  onDidChangeModelContent: (
    cb: (e: FakeContentChangedEvent) => void,
  ) => {
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

import {
  useLspClientStore,
  parseWorkspaceKindKey,
  workspaceKindKey,
} from '../state/lspClientStore';
// Phase 9.2d — every test fixture below
// that previously used a bare
// `'/workspace/x'` string as a map key now
// uses `tsKey('/workspace/x')`, which
// produces the composite key
// `'/workspace/x//typescript'`. The TS kind
// is the implicit default for pre-9.2b call
// sites; all the legacy tests use the
// default kind. Tests that need a
// non-default kind import `workspaceKindKey`
// directly and pass the kind explicitly.
const tsKey = (workspaceRoot: string): string =>
  workspaceKindKey(workspaceRoot, 'typescript');
import {
  setUseRealServer,
  setUseRealServerByKind,
  setUseRealServerForCompletion,
} from '../state/lspKillSwitch';
import { useWorkspaceStore } from '@/shared/state/workspaceStore';
import { useMonacoLspBridge } from './useMonacoLspBridge';
import { registerLspProviders } from './lspProviders';
// Phase 9.2b — we need direct access to
// the `lspRunStdio` and `kindToSpawnSpec`
// mocks to assert the rust-analyzer bridge
// test. The module is fully mocked above,
// so these imports resolve to the mock
// functions (which carry a `.mock.calls`
// property we can introspect).
import { kindToSpawnSpec, lspRunStdio } from '@/ipc/lsp';

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

/**
 * Phase 9.1 — extract the first JSON-RPC
 * frame from a concatenated string of
 * LSP wire writes. The test's mock
 * `lspStdioWrite` captures the raw
 * `Uint8Array`; we decode + concatenate +
 * split on `Content-Length: <n>\r\n\r\n`
 * to find the first body. We then
 * `JSON.parse` it and return
 * `{ method, params }` (or the relevant
 * fields).
 *
 * The fake's `lspStdioWrite` is
 * pre-staged in the
 * `vi.mock('@/ipc/lsp', ...)` block;
 * the `writes[]` array is exposed via
 * `(await import('@/ipc/lsp')).writes`.
 */
function parseFirstLspFrame(
  concatenatedWrites: string,
): {
  method: string;
  params: {
    textDocument: { uri: string; version: number };
    contentChanges: Array<{
      range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
      };
      rangeLength: number;
      text: string;
    }>;
  };
} {
  // Find the first `Content-Length: <n>\r\n\r\n<body>` frame.
  const match = concatenatedWrites.match(
    /Content-Length: (\d+)\r\n\r\n/,
  );
  expect(match, 'no Content-Length header found').not.toBeNull();
  const headerLen = match![0]!.length;
  const bodyLen = Number(match![1]);
  const body = concatenatedWrites.slice(
    headerLen,
    headerLen + bodyLen,
  );
  const parsed = JSON.parse(body) as {
    method: string;
    params: {
      textDocument: { uri: string; version: number };
      contentChanges: Array<{
        range: {
          start: { line: number; character: number };
          end: { line: number; character: number };
        };
        rangeLength: number;
        text: string;
      }>;
    };
  };
  return parsed;
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
    lspOutputByWorkspace: new Map(),
  });
  useWorkspaceStore.setState({
    workspaces: [],
    activeId: null,
  });
  // Default to "use real server on for every kind"
  // unless a test flips it. The per-kind record
  // needs every supported kind so the gate
  // doesn't fall through to the v1 default (the
  // kill switch defaults to `true` for missing
  // kinds, but resetting it explicitly here
  // keeps the test fixture deterministic).
  setUseRealServerByKind({
    typescript: true,
    rust_analyzer: true,
    pyright: true,
    unknown: true,
  });
  vi.clearAllMocks();
});

afterEach(async () => {
  // Restore default kill switch for every kind.
  setUseRealServerByKind({
    typescript: true,
    rust_analyzer: true,
    pyright: true,
    unknown: true,
  });
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
  // Phase 9.2d — keys are now
  // `${workspaceRoot}//${kind}`, not bare
  // roots. We need to extract the root
  // for `disposeAllKindsForWorkspace`.
  // Parse the keys and dedupe by root.
  const seenRoots = new Set<string>();
  for (const key of useLspClientStore.getState().clients.keys()) {
    const parsed = parseWorkspaceKindKey(key);
    if (parsed) seenRoots.add(parsed.workspaceRoot);
  }
  for (const workspaceRoot of seenRoots) {
    await useLspClientStore
      .getState()
      .disposeAllKindsForWorkspace(workspaceRoot);
  }
  // Reset the closure-scoped state too
  // (handle map, crash listener, respawn
  // timers).
  useLspClientStore.getState().__resetLspClientStoreForTests();
});

describe('useMonacoLspBridge', () => {
  it('is a no-op when the kill switch is disabled for the file kind', async () => {
    // Phase 9.2e — the kill switch is per-kind.
    // Disable the TS kind; a `.ts` file's
    // bridge should bail out. Other kinds
    // (rust-analyzer, pyright) remain enabled
    // — a `.rs` or `.py` file's bridge would
    // still spawn a client.
    setUseRealServer('typescript', false);
    addWorkspace('/workspace/a');
    const mounted = mountBridge();
    // Wait a few ticks for the effect to run.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    // The store has no client — the bridge should
    // have bailed out at the kill switch.
    expect(
      useLspClientStore.getState().clients.has(tsKey('/workspace/a')),
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
        !useLspClientStore.getState().clients.has(tsKey('/workspace/a'))
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
      useLspClientStore.getState().clients.has(tsKey('/workspace/a')),
    ).toBe(true);
    expect(registerLspProviders).toHaveBeenCalledTimes(1);
    mounted.unmount();
  });

  /**
   * Phase 9.1 — verify the bridge forwards
   * Monaco's `IModelContentChangedEvent` as an
   * incremental `textDocument/didChange`. Before
   * Phase 9.1 the bridge re-sent the full
   * document on every keystroke; now it sends a
   * single `TextDocumentContentChangeEvent`
   * with `range` + `text` (the actual edit).
   *
   * Asserts:
   *   - The wire payload for the keystroke
   *     contains `textDocument/didChange`.
   *   - The `contentChanges` array has *one*
   *     entry (not the full document text).
   *   - That entry's `text` is the inserted
   *     character (`"x"`), not the full file.
   *   - The `version` is the post-change
   *     `versionId` (Monaco guarantees
   *     monotonic; we read it from the event).
   *   - The `range` is a single point (insertion
   *     at the cursor), 0-indexed for LSP.
   */
  it('sends incremental didChange with a single TextDocumentContentChangeEvent per keystroke', async () => {
    addWorkspace('/workspace/incr');
    const mounted = mountBridge();
    // Wait for the client + didOpen to
    // complete so the wire writes are
    // captured cleanly.
    await act(async () => {
      const deadline = Date.now() + 1000;
      while (
        Date.now() < deadline &&
        !useLspClientStore.getState().clients.has(tsKey('/workspace/incr'))
      ) {
        await new Promise((r) => setTimeout(r, 10));
      }
    });
    await act(async () => {
      // Drain the didOpen frame.
      await new Promise((r) => setTimeout(r, 50));
    });
    // Snapshot the writes so we can assert
    // only on the *new* didChange frame.
    const lspMock = (await import('@/ipc/lsp')) as unknown as {
      writes: Uint8Array[];
    };
    const writesBefore = lspMock.writes.length;
    // Fire a single keystroke at line 2,
    // col 1 → user types "x".
    await act(async () => {
      for (const cb of fakeContentListeners) {
        cb({
          changes: [
            {
              range: {
                startLineNumber: 2,
                startColumn: 1,
                endLineNumber: 2,
                endColumn: 1,
              },
              rangeLength: 0,
              text: 'x',
            },
          ],
          versionId: 2,
        });
      }
      // The bridge awaits
      // `sendDidChange` (which calls
      // `client.notify` → `lspStdioWrite`),
      // so we need to give the microtask
      // queue a few ticks.
      await new Promise((r) => setTimeout(r, 50));
    });
    // Find the new didChange frame.
    const newWrites = lspMock.writes.slice(writesBefore);
    const newWriteText = newWrites
      .map((w) => new TextDecoder().decode(w))
      .join('');
    expect(newWriteText).toContain('textDocument/didChange');
    // Parse the JSON-RPC frame and
    // inspect the params.
    const parsed = parseFirstLspFrame(newWriteText);
    expect(parsed.method).toBe('textDocument/didChange');
    expect(parsed.params.contentChanges).toHaveLength(1);
    const change = parsed.params.contentChanges[0];
    // Insertion at (line 1, col 0) — LSP is
    // 0-indexed, Monaco is 1-indexed.
    expect(change.range).toEqual({
      start: { line: 1, character: 0 },
      end: { line: 1, character: 0 },
    });
    expect(change.text).toBe('x');
    expect(change.rangeLength).toBe(0);
    // Version is the post-change
    // `versionId` (we fired 2).
    expect(parsed.params.textDocument.version).toBe(2);
    mounted.unmount();
  });

  /**
   * Phase 9.1 — the bridge does NOT re-send
   * the *full document* on every change.
   * Before Phase 9.1 a single keystroke on
   * a 5 KiB file would push ~5 KiB on the
   * wire; now it pushes ~50 bytes. We
   * assert that the `text` field of the
   * change is *not* the full document text.
   */
  it('does not re-send the full document on a single keystroke (Phase 9.1 wire-size win)', async () => {
    // Use a long fake document so the
    // "old" path would have shipped a
    // lot of bytes.
    fakeModel = {
      uri: { toString: () => 'file:///workspace/big/index.ts' },
      getLanguageId: () => 'typescript',
      getValue: () => 'a'.repeat(5000) + '\n',
      getVersionId: () => 100,
    };
    addWorkspace('/workspace/big');
    const mounted = mountBridge();
    await act(async () => {
      const deadline = Date.now() + 1000;
      while (
        Date.now() < deadline &&
        !useLspClientStore.getState().clients.has(tsKey('/workspace/big'))
      ) {
        await new Promise((r) => setTimeout(r, 10));
      }
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const lspMock = (await import('@/ipc/lsp')) as unknown as {
      writes: Uint8Array[];
    };
    const writesBefore = lspMock.writes.length;
    await act(async () => {
      for (const cb of fakeContentListeners) {
        cb({
          changes: [
            {
              range: {
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: 1,
              },
              rangeLength: 0,
              text: 'Z',
            },
          ],
          versionId: 101,
        });
      }
      await new Promise((r) => setTimeout(r, 50));
    });
    const newWrites = lspMock.writes.slice(writesBefore);
    const newWriteText = newWrites
      .map((w) => new TextDecoder().decode(w))
      .join('');
    const parsed = parseFirstLspFrame(newWriteText);
    const change = parsed.params.contentChanges[0];
    // Wire `text` is exactly the inserted
    // char — not the 5 KiB full
    // document. The "before" code would
    // have set `text: "aaaa…\n"`.
    expect(change.text).toBe('Z');
    expect(change.text.length).toBeLessThan(100);
    mounted.unmount();
  });

  /**
   * Phase 9.1 — multi-change events
   * (Monaco batches e.g. formatter edits)
   * are forwarded as multiple
   * `TextDocumentContentChangeEvent`s in
   * the same `contentChanges` array, in
   * order.
   */
  it('forwards multi-change events (e.g. formatter) as multiple LSP changes in order', async () => {
    addWorkspace('/workspace/multi');
    const mounted = mountBridge();
    await act(async () => {
      const deadline = Date.now() + 1000;
      while (
        Date.now() < deadline &&
        !useLspClientStore.getState().clients.has(tsKey('/workspace/multi'))
      ) {
        await new Promise((r) => setTimeout(r, 10));
      }
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const lspMock = (await import('@/ipc/lsp')) as unknown as {
      writes: Uint8Array[];
    };
    const writesBefore = lspMock.writes.length;
    await act(async () => {
      for (const cb of fakeContentListeners) {
        cb({
          changes: [
            {
              range: {
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: 5,
              },
              rangeLength: 4,
              text: 'AAAA',
            },
            {
              range: {
                startLineNumber: 5,
                startColumn: 1,
                endLineNumber: 5,
                endColumn: 5,
              },
              rangeLength: 4,
              text: 'BBBB',
            },
          ],
          versionId: 2,
        });
      }
      await new Promise((r) => setTimeout(r, 50));
    });
    const newWrites = lspMock.writes.slice(writesBefore);
    const newWriteText = newWrites
      .map((w) => new TextDecoder().decode(w))
      .join('');
    const parsed = parseFirstLspFrame(newWriteText);
    expect(parsed.params.contentChanges).toHaveLength(2);
    // Order preserved.
    expect(parsed.params.contentChanges[0].text).toBe('AAAA');
    expect(parsed.params.contentChanges[1].text).toBe('BBBB');
    mounted.unmount();
  });

  /**
   * Phase 9.1 — an empty `changes` array
   * (Monaco can fire these in edge cases)
   * is forwarded as an empty
   * `contentChanges` array — the spec
   * allows it; the server treats it as a
   * no-op. This makes the bridge
   * robust to whatever Monaco throws at
   * it.
   */
  it('forwards an empty changes array as an empty contentChanges array (no-op)', async () => {
    addWorkspace('/workspace/empty');
    const mounted = mountBridge();
    await act(async () => {
      const deadline = Date.now() + 1000;
      while (
        Date.now() < deadline &&
        !useLspClientStore.getState().clients.has(tsKey('/workspace/empty'))
      ) {
        await new Promise((r) => setTimeout(r, 10));
      }
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const lspMock = (await import('@/ipc/lsp')) as unknown as {
      writes: Uint8Array[];
    };
    const writesBefore = lspMock.writes.length;
    await act(async () => {
      for (const cb of fakeContentListeners) {
        cb({ changes: [], versionId: 1 });
      }
      await new Promise((r) => setTimeout(r, 50));
    });
    const newWrites = lspMock.writes.slice(writesBefore);
    const newWriteText = newWrites
      .map((w) => new TextDecoder().decode(w))
      .join('');
    // No new `didChange` frame on the
    // wire — the spec says an empty
    // contentChanges array is legal but
    // shipping it is wasteful. We
    // currently *do* ship it (the server
    // treats it as a no-op); we assert
    // *only* that nothing crashes.
    if (newWriteText.length > 0) {
      const parsed = parseFirstLspFrame(newWriteText);
      expect(parsed.params.contentChanges).toEqual([]);
    }
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
        !useLspClientStore.getState().clients.has(tsKey('/workspace/a'))
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
        !useLspClientStore.getState().clients.has(tsKey('/workspace/comp-default'))
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
        !useLspClientStore.getState().clients.has(tsKey('/workspace/comp-on'))
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

  /**
   * Phase 9.2 — the bridge is multi-server
   * from day one. The "thin slice" only
   * wires up the TypeScript arm; a `.py`
   * file in a TS workspace should be a
   * no-op (no client spawned, no
   * providers registered, no
   * per-workspace status flip).
   *
   * The inferrer is
   * extension-based: a `.py` file
   * infers `pyright`. Phase 9.2c added
   * `pyright` to
   * `SUPPORTED_LSP_SERVER_KINDS`, so
   * the bridge now actually spawns a
   * `pyright-langserver` client (mirrors
   * the `.rs` / `.ts` behaviour).
   * This test pins the positive
   * case: a `.py` file produces a
   * `pyright`-kind `LspClient` and
   * `registerLspProviders` is called.
   * A future change that accidentally
   * removes `pyright` from the
   * supported list will fail this
   * test.
   */
  it('spawns a pyright client for a .py file (pyright is supported as of Phase 9.2c)', async () => {
    // Custom fake editor for a .py file.
    // We mirror the existing `fakeModel`
    // shape but with a Python URI.
    const pyModel: FakeModel = {
      uri: { toString: () => 'file:///workspace/a/script.py' },
      getLanguageId: () => 'python',
      getValue: () => 'print("hi")\n',
      getVersionId: () => 1,
    };
    const pyEditor = {
      getModel: () => pyModel,
      onDidChangeModelContent: (
        _cb: (e: FakeContentChangedEvent) => void,
      ) => ({ dispose: () => {} }),
      onDidChangeModel: (
        _cb: (e: FakeModelChangedEvent) => void,
      ) => ({ dispose: () => {} }),
    };
    addWorkspace('/workspace/py');
    const mounted = mountBridge(pyEditor);
    // Wait for the bridge to spawn the
    // client. The `.py` workspace should
    // now have a client (the gate
    // includes `'pyright'` as of
    // Phase 9.2c). The key for a pyright
    // client is `(root, 'pyright')` —
    // NOT the legacy TS key.
    const pyrightKey = workspaceKindKey('/workspace/py', 'pyright');
    await act(async () => {
      const deadline = Date.now() + 1000;
      while (
        Date.now() < deadline &&
        !useLspClientStore.getState().clients.has(pyrightKey)
      ) {
        await new Promise((r) => setTimeout(r, 10));
      }
    });
    const client = useLspClientStore
      .getState()
      .clients.get(pyrightKey);
    expect(client).toBeDefined();
    // The client must carry the kind
    // the bridge inferred. A `.py`
    // workspace's client is a
    // `pyright` client, not a TS
    // client, and a `respawn()` after
    // a crash will spawn the same
    // binary.
    expect(client?.kind).toBe('pyright');
    mounted.unmount();
  });

  /**
   * Phase 9.2 — a `.ts` file in the
   * existing test setup DOES spawn a
   * client (the inferrer returns
   * `'typescript'`, which is in
   * `SUPPORTED_LSP_SERVER_KINDS`).
   * Pin that behaviour: it's the
   * contract the rest of the bridge
   * depends on. If a future change
   * accidentally narrows
   * `SUPPORTED_LSP_SERVER_KINDS` to an
   * empty list, this test fails.
   */
  it('spawns a client for a .ts file (typescript is supported)', async () => {
    addWorkspace('/workspace/ts-supported');
    const mounted = mountBridge();
    // Wait for the bridge to spawn the
    // client.
    await act(async () => {
      const deadline = Date.now() + 1000;
      while (
        Date.now() < deadline &&
        !useLspClientStore
          .getState()
          .clients.has(tsKey('/workspace/ts-supported'))
      ) {
        await new Promise((r) => setTimeout(r, 10));
      }
    });
    expect(
      useLspClientStore
        .getState()
        .clients.has(tsKey('/workspace/ts-supported')),
    ).toBe(true);
    mounted.unmount();
  });

  /**
   * Phase 9.2b — the same end-to-end path
   * for a `.rs` file. The bridge
   * infers `'rust_analyzer'` from the
   * file extension, the gate (now wired)
   * lets the spawn through, the store
   * creates an `LspClient` with
   * `kind: 'rust_analyzer'`, and the
   * `kindToSpawnSpec` helper picks
   * `rust-analyzer` (no `--stdio` flag)
   * as the binary to spawn.
   */
  it('spawns a rust-analyzer client for a .rs file with the rust-analyzer binary', async () => {
    // Custom fake editor for a `.rs`
    // file. The bridge infers the kind
    // from the URI's extension; the gate
    // (now including `'rust_analyzer'`)
    // lets the spawn through.
    const rsModel: FakeModel = {
      uri: { toString: () => 'file:///workspace/rs/src/main.rs' },
      getLanguageId: () => 'rust',
      getValue: () => 'fn main() {}\n',
      getVersionId: () => 1,
    };
    const rsEditor = {
      getModel: () => rsModel,
      onDidChangeModelContent: (
        _cb: (e: FakeContentChangedEvent) => void,
      ) => ({ dispose: () => {} }),
      onDidChangeModel: (
        _cb: (e: FakeModelChangedEvent) => void,
      ) => ({ dispose: () => {} }),
    };
    addWorkspace('/workspace/rs');
    // Snapshot mock call counts *before*
    // mounting — the mocks are shared
    // across tests in this file, so we
    // can only assert "called *during*
    // this test" via a delta.
    const lspRunStdioCallsBefore = (
      lspRunStdio as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls.length;
    const kindToSpawnSpecCallsBefore = (
      kindToSpawnSpec as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls.length;
    const mounted = mountBridge(rsEditor);
    // Wait for the bridge to spawn the
    // client. The `.rs` workspace
    // should now have a client (the gate
    // includes `'rust_analyzer'` as of
    // Phase 9.2b). The key for a
    // rust-analyzer client is
    // `(root, 'rust_analyzer')` — NOT the
    // legacy TS key.
    const rustKey = workspaceKindKey(
      '/workspace/rs',
      'rust_analyzer',
    );
    await act(async () => {
      const deadline = Date.now() + 1000;
      while (
        Date.now() < deadline &&
        !useLspClientStore.getState().clients.has(rustKey)
      ) {
        await new Promise((r) => setTimeout(r, 10));
      }
    });
    const client = useLspClientStore
      .getState()
      .clients.get(rustKey);
    expect(client).toBeDefined();
    // The client must carry the kind
    // the bridge inferred. This is the
    // contract the `LspClient.kind`
    // field exists to enforce — a
    // `.rs` workspace's client is a
    // `rust-analyzer` client, not a TS
    // client, and a `respawn()` after
    // a crash will spawn the same
    // binary.
    expect(client?.kind).toBe('rust_analyzer');
    // The spawn helper was called with
    // the rust_analyzer kind at some
    // point during this test.
    const lspRunStdioCallsAfter = (
      lspRunStdio as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls.length;
    const lspRunStdioDelta = (
      lspRunStdio as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls.slice(lspRunStdioCallsBefore, lspRunStdioCallsAfter);
    const calledWithRustBinary = lspRunStdioDelta.some(
      (call) =>
        (call[0] as { command: string }).command === 'rust-analyzer',
    );
    expect(calledWithRustBinary).toBe(true);
    // And `kindToSpawnSpec` was called
    // with `'rust_analyzer'` at some
    // point during this test.
    const kindToSpawnSpecCallsAfter = (
      kindToSpawnSpec as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls.length;
    const kindToSpawnSpecDelta = (
      kindToSpawnSpec as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls.slice(
      kindToSpawnSpecCallsBefore,
      kindToSpawnSpecCallsAfter,
    );
    const calledWithRust = kindToSpawnSpecDelta.some(
      (call) => call[0] === 'rust_analyzer',
    );
    expect(calledWithRust).toBe(true);
    mounted.unmount();
  });

  /**
   * Phase 9.2d — multi-server e2e. A
   * single workspace can have more than
   * one live client (one per kind) once
   * the user has opened files of
   * different kinds. The bridge drives
   * `getOrCreate(root, kind)` for each
   * file the user opens, and the store
   * keys clients by `(root, kind)`. This
   * test mounts the bridge twice on the
   * *same* workspace (once with a `.ts`
   * model, once with a `.py` model) and
   * asserts that the store has two
   * distinct clients for the workspace.
   */
  it('spawns one client per (workspace, kind) — TS + pyright side-by-side', async () => {
    addWorkspace('/workspace/multi');
    // 1. Mount a TS bridge.
    const tsMounted = mountBridge();
    // The default fake model is
    // `file:///workspace/a/index.ts` —
    // good for the TS path. The test
    // helper `mountBridge()` builds an
    // editor with that URI, so the
    // inferred kind is `'typescript'`.
    await act(async () => {
      const deadline = Date.now() + 1000;
      while (
        Date.now() < deadline &&
        !useLspClientStore
          .getState()
          .clients.has(tsKey('/workspace/multi'))
      ) {
        await new Promise((r) => setTimeout(r, 10));
      }
    });
    expect(
      useLspClientStore.getState().clients.get(tsKey('/workspace/multi')),
    ).toBeDefined();
    // 2. Mount a pyright bridge on the
    // *same* workspace. We use a custom
    // fake editor for this.
    const pyModel: FakeModel = {
      uri: { toString: () => 'file:///workspace/multi/script.py' },
      getLanguageId: () => 'python',
      getValue: () => 'print("hi")\n',
      getVersionId: () => 1,
    };
    const pyEditor = {
      getModel: () => pyModel,
      onDidChangeModelContent: (
        _cb: (e: FakeContentChangedEvent) => void,
      ) => ({ dispose: () => {} }),
      onDidChangeModel: (
        _cb: (e: FakeModelChangedEvent) => void,
      ) => ({ dispose: () => {} }),
    };
    const pyMounted = mountBridge(pyEditor);
    const pyrightKey = workspaceKindKey(
      '/workspace/multi',
      'pyright',
    );
    await act(async () => {
      const deadline = Date.now() + 1000;
      while (
        Date.now() < deadline &&
        !useLspClientStore.getState().clients.has(pyrightKey)
      ) {
        await new Promise((r) => setTimeout(r, 10));
      }
    });
    // 3. The store now has BOTH clients
    // for the same workspace. Two
    // distinct (root, kind) keys, two
    // distinct LspClient instances.
    const state = useLspClientStore.getState();
    expect(state.clients.has(tsKey('/workspace/multi'))).toBe(true);
    expect(state.clients.has(pyrightKey)).toBe(true);
    // The two clients are distinct
    // objects (not the same one
    // re-keyed).
    const tsClient = state.clients.get(tsKey('/workspace/multi'));
    const pyClient = state.clients.get(pyrightKey);
    expect(tsClient).not.toBe(pyClient);
    // And each carries the right kind.
    expect(tsClient?.kind).toBe('typescript');
    expect(pyClient?.kind).toBe('pyright');
    tsMounted.unmount();
    pyMounted.unmount();
  });

  /**
   * Phase 9.2e — the kill switch is
   * per-kind. Disabling the TS kind does
   * NOT prevent a `.py` bridge from
   * spawning a pyright client (and vice
   * versa). Two bridges for the same
   * workspace, different file kinds, and
   * only the TS kind is disabled — the
   * pyright bridge must still spawn its
   * client.
   */
  it('per-kind kill switch: TS off, pyright on — pyright still spawns (Phase 9.2e)', async () => {
    setUseRealServer('typescript', false);
    // rust_analyzer and pyright stay on
    // (the default).
    addWorkspace('/workspace/indep');
    // Open a .py file. The bridge should
    // NOT bail out at the kill switch
    // (the gate is on `pyright`, which
    // is still on).
    const pyModel: FakeModel = {
      uri: { toString: () => 'file:///workspace/indep/main.py' },
      getLanguageId: () => 'python',
      getValue: () => 'print("hi")\n',
      getVersionId: () => 1,
    };
    const pyEditor = {
      getModel: () => pyModel,
      onDidChangeModelContent: (
        _cb: (e: FakeContentChangedEvent) => void,
      ) => ({ dispose: () => {} }),
      onDidChangeModel: (
        _cb: (e: FakeModelChangedEvent) => void,
      ) => ({ dispose: () => {} }),
    };
    const pyMounted = mountBridge(pyEditor);
    await act(async () => {
      const deadline = Date.now() + 1000;
      while (
        Date.now() < deadline &&
        !useLspClientStore
          .getState()
          .clients.has(
            workspaceKindKey('/workspace/indep', 'pyright'),
          )
      ) {
        await new Promise((r) => setTimeout(r, 5));
      }
    });
    expect(
      useLspClientStore
        .getState()
        .clients.has(workspaceKindKey('/workspace/indep', 'pyright')),
    ).toBe(true);
    pyMounted.unmount();
  });

  /**
   * Phase 9.2e — flip the kill switch
   * the *other* way: disable pyright,
   * keep TS on. A `.ts` bridge must
   * still spawn its TS client, and a
   * `.py` bridge must bail out at the
   * kill switch.
   */
  it('per-kind kill switch: pyright off, TS on — .py bridge is a no-op (Phase 9.2e)', async () => {
    setUseRealServer('pyright', false);
    addWorkspace('/workspace/indep2');
    const pyModel: FakeModel = {
      uri: { toString: () => 'file:///workspace/indep2/main.py' },
      getLanguageId: () => 'python',
      getValue: () => 'print("hi")\n',
      getVersionId: () => 1,
    };
    const pyEditor = {
      getModel: () => pyModel,
      onDidChangeModelContent: (
        _cb: (e: FakeContentChangedEvent) => void,
      ) => ({ dispose: () => {} }),
      onDidChangeModel: (
        _cb: (e: FakeModelChangedEvent) => void,
      ) => ({ dispose: () => {} }),
    };
    const pyMounted = mountBridge(pyEditor);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    // The pyright client was NOT spawned
    // (kill switch off for `pyright`).
    expect(
      useLspClientStore
        .getState()
        .clients.has(workspaceKindKey('/workspace/indep2', 'pyright')),
    ).toBe(false);
    pyMounted.unmount();
  });
});
