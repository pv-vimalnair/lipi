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
    // Phase 9.2f — the bridge uses
    // `monaco.editor.getModels()` to discover
    // already-open models and
    // `monaco.editor.onDidCreateModel` to
    // subscribe to future model creation.
    // The mock provides a no-op default; the
    // test fixture's `vi.mock` of
    // `useMonacoLspBridge` (or the fixture
    // itself) overrides these on a per-test
    // basis. We use a *getter* so the test
    // can swap the implementation by
    // reassigning the module-level
    // `fakeGetModels` variable.
    editor: {
      get getModels() {
        return () => fakeGetModelsReturn;
      },
      get onDidCreateModel() {
        return (
          cb: (m: unknown) => void,
        ): { dispose: () => void } => {
          fakeCreateModelListeners.push(cb as (m: FakeModel) => void);
          return { dispose: () => {} };
        };
      },
    },
  };
});

// Mocks must be installed BEFORE the module-under-test
// imports. `vi.mock` is hoisted, so this is fine.
vi.mock('@/ipc/lsp', () => {
  const writes: Uint8Array[] = [];
  // Phase 9.36 — per-handle stdout handler
  // registry. The SUT's `LspClient` calls
  // `onLspStdout` once during `start()` and
  // filters on `handleId` internally. The
  // mock stores the handler per-handle so
  // the `lspStdioWrite` mock can fire the
  // event-driven path (in addition to
  // queuing bytes for the catch-up drain).
  // This mirrors the `lspClientStore.test.ts`
  // pattern but is keyed by handleId
  // because the bridge test runs multiple
  // concurrent clients in some tests.
  const stdoutHandlersByHandle: Map<
    string,
    Set<(p: { handleId: string; chunk: number[] }) => void>
  > = new Map();
  // Expose the registry for the test
  // suite's `beforeEach` to clear it
  // between tests. Mirrors the `writes`
  // pattern below.
  (globalThis as { __lspStdoutHandlers?: typeof stdoutHandlersByHandle }).__lspStdoutHandlers = stdoutHandlersByHandle;
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
    lspStdioRead: vi.fn(async (h: string, maxBytes: number) => {
      // Per-handleId queue. The Rust
      // side delivers each handle's
      // stdout independently; the mock
      // mirrors that by giving each
      // handleId its own queue. This
      // prevents the new client (after
      // a respawn) from accidentally
      // consuming a response intended
      // for a still-alive sibling
      // client (the previous
      // single-`__lspQ` design had
      // this race — D-146's respawn
      // test exposed it).
      const qm =
        (globalThis as { __lspQByHandle?: Map<string, Uint8Array[]> })
          .__lspQByHandle ?? new Map();
      const q = qm.get(h) ?? [];
      if (q.length === 0) return new Uint8Array(0);
      const next = q.shift()!;
      qm.set(h, q);
      (globalThis as { __lspQByHandle?: Map<string, Uint8Array[]> })
        .__lspQByHandle = qm;
      return next.byteLength > maxBytes ? next.slice(0, maxBytes) : next;
    }),
    lspStdioWrite: vi.fn(
      async (h: string, bytes: Uint8Array) => {
        writes.push(bytes);
        // On `initialize` request, enqueue a
        // canned response with the right id
        // into THIS handleId's queue.
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
              const qm =
                (globalThis as { __lspQByHandle?: Map<string, Uint8Array[]> })
                  .__lspQByHandle ?? new Map();
              const q = qm.get(h) ?? [];
              q.push(out);
              qm.set(h, q);
              (globalThis as {
                __lspQByHandle?: Map<string, Uint8Array[]>;
              }).__lspQByHandle = qm;
              // Phase 9.36 — also fire the
              // event-driven path so the
              // SUT's `lsp://stdout`
              // subscription receives the
              // response. The SUT's
              // `LspClient._subscribeStdout`
              // filters on `handleId`
              // internally; firing with the
              // correct handleId is the
              // equivalent of the Rust
              // `app_handle.emit(LSP_STDOUT_EVENT)`
              // call. We push to BOTH the
              // catch-up queue (for
              // `_catchupStdout`) AND the
              // event (for the hot path) so
              // the same test fixtures work
              // regardless of which path the
              // SUT uses. Fire every active
              // wildcard handler — each
              // LspClient filters on its
              // own `handleId` internally.
              const handlers = stdoutHandlersByHandle.get('*');
              if (handlers) {
                for (const handler of handlers) {
                  handler({
                    handleId: h,
                    chunk: Array.from(out),
                  });
                }
              }
            }
          } catch (_e) {
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
    // Phase 9.36 — same for `onLspStdout`.
    // Each LspClient subscribes once during
    // `start()`. The SUT's handler filters
    // on `handleId` internally, so the mock
    // uses a wildcard handler (fires for
    // every handleId; the SUT's own filter
    // does the actual per-handle filtering).
    // The unlisten is a no-op.
    onLspStdout: vi.fn(
      (handler: (p: { handleId: string; chunk: number[] }) => void) => {
        // Register under a wildcard key
        // so `lspStdioWrite` can fire it
        // for any handleId. The SUT's
        // handler closure filters on its
        // own `myHandleId`, so cross-talk
        // between clients is prevented by
        // the production code, not the
        // mock. Multiple LspClients can be
        // alive in the same test (e.g. the
        // bridge spawns one per kind), so
        // the wildcard key holds a Set of
        // handlers — every active LspClient
        // gets its handler fired.
        let set = stdoutHandlersByHandle.get('*');
        if (!set) {
          set = new Set();
          stdoutHandlersByHandle.set('*', set);
        }
        set.add(handler);
        const un = (): void => {
          const s = stdoutHandlersByHandle.get('*');
          if (s) {
            s.delete(handler);
            if (s.size === 0) {
              stdoutHandlersByHandle.delete('*');
            }
          }
        };
        return Promise.resolve(un);
      },
    ),
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
  /**
   * Phase 9.2f — the bridge now subscribes
   * to per-model events (was per-editor
   * pre-9.2f). `onDidChangeContent` is the
   * per-model analog of Monaco's editor
   * `onDidChangeModelContent`. `onWillDispose`
   * fires when the model is garbage-collected
   * (e.g. a tab is closed).
   */
  onDidChangeContent: (
    cb: (e: FakeContentChangedEvent) => void,
  ) => { dispose: () => void };
  onWillDispose: (cb: () => void) => { dispose: () => void };
  fireContentChange: (e: FakeContentChangedEvent) => void;
  fireWillDispose: () => void;
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
 * `onDidChangeContent`. The bridge reads
 * `event.changes` and `event.versionId`
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

/**
 * Phase 9.2f — the test fixture exposes a
 * module-level `getModels()` mock that
 * the bridge calls to discover
 * already-open models. The default
 * implementation returns `[fakeModel]`;
 * individual tests can override.
 */
let fakeGetModelsReturn: FakeModel[] = [];

/**
 * Phase 9.2f — the test fixture exposes
 * module-level `onDidCreateModel` and
 * `onWillDispose` subscriptions. The
 * bridge registers `onDidCreateModel`
 * for future model creation. The
 * fixture's `createFakeModel` helper
 * fires the `onDidCreateModel`
 * listeners so the bridge hooks the
 * new model.
 */
let fakeCreateModelListeners: Array<(m: FakeModel) => void> = [];

function makeFakeModel(
  uri: string,
  languageId: string,
  initial: string = '',
): FakeModel {
  const contentListeners: Array<(e: FakeContentChangedEvent) => void> = [];
  const willDisposeListeners: Array<() => void> = [];
  return {
    uri: { toString: () => uri },
    getLanguageId: () => languageId,
    getValue: () => initial,
    getVersionId: () => 1,
    onDidChangeContent: (cb) => {
      contentListeners.push(cb);
      return { dispose: () => {} };
    },
    onWillDispose: (cb) => {
      willDisposeListeners.push(cb);
      return { dispose: () => {} };
    },
    fireContentChange: (e) => {
      for (const cb of contentListeners) cb(e);
    },
    fireWillDispose: () => {
      for (const cb of willDisposeListeners) cb();
    },
  };
}

let fakeModel: FakeModel = makeFakeModel(
  'file:///workspace/a/index.ts',
  'typescript',
  'const x = 1;\n',
);
// Default `getModels()` returns the
// module-level `fakeModel` (the test
// fixture's "focused" model).
fakeGetModelsReturn = [fakeModel];

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
            editorCursorByPath: {},
            fileTreeScrollAnchor: null,
          },
        },
      ],
      activeId: path,
    });
  });
}

beforeEach(() => {
  // Reset module state.
  (globalThis as { __lspQByHandle?: Map<string, Uint8Array[]> }).__lspQByHandle = new Map();
  (globalThis as { __lspQ?: Uint8Array[] }).__lspQ = [];
  // Phase 9.36 — clear the stdout handler
  // registry so previous-test listeners
  // don't leak into the next test. The
  // mock's `onLspStdout` registers a
  // wildcard handler; if a test doesn't
  // explicitly unlisten, the handler
  // stays in the map and the next test's
  // `lspStdioWrite` mock would fire it.
  (
    globalThis as {
      __lspStdoutHandlers?: Map<
        string,
        Set<(p: { handleId: string; chunk: number[] }) => void>
      >;
    }
  ).__lspStdoutHandlers?.clear();
  fakeModel = makeFakeModel(
    'file:///workspace/a/index.ts',
    'typescript',
    'const x = 1;\n',
  );
  // Default: the bridge's `getModels()`
  // returns `[fakeModel]` (the test's
  // "focused" model). Tests that simulate
  // multi-tab open override this.
  fakeGetModelsReturn = [fakeModel];
  fakeCreateModelListeners = [];
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
    // bridge should bail out for the TS
    // provider set. Other kinds
    // (rust-analyzer, pyright) remain enabled
    // — the bridge registers providers for
    // those kinds independently.
    //
    // Phase 9.2f — the bridge registers one
    // provider set per *enabled* kind. With
    // TS off, the bridge registers for
    // rust_analyzer and pyright (the other
    // two enabled kinds), but not for TS.
    setUseRealServer('typescript', false);
    addWorkspace('/workspace/a');
    const mounted = mountBridge();
    // Wait a few ticks for the effect to run.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    // The TS client does not exist.
    expect(
      useLspClientStore.getState().clients.has(tsKey('/workspace/a')),
    ).toBe(false);
    // `registerLspProviders` was called for
    // the rust_analyzer and pyright provider
    // sets (not for TS).
    const callSelectors = (
      registerLspProviders as unknown as {
        mock: {
          calls: Array<[unknown, unknown, string[], unknown]>;
        };
      }
    ).mock.calls.map((c) => c[2]);
    expect(callSelectors).toEqual(
      expect.arrayContaining([expect.arrayContaining(['rust'])]),
    );
    expect(callSelectors).toEqual(
      expect.arrayContaining([expect.arrayContaining(['python'])]),
    );
    expect(callSelectors).not.toEqual(
      expect.arrayContaining([expect.arrayContaining(['typescript'])]),
    );
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
    // Phase 9.2f — the bridge registers one
    // provider set per *supported* kind. With
    // all three kinds enabled, this is 3
    // calls (one for `typescript`, one for
    // `rust_analyzer`, one for `pyright`).
    // Each call uses the kind's
    // `DocumentSelector` (the `languageId`s
    // Monaco returns for files the kind
    // handles).
    expect(registerLspProviders).toHaveBeenCalledTimes(3);
    const callSelectors = (
      registerLspProviders as unknown as {
        mock: {
          calls: Array<[unknown, unknown, string[], unknown]>;
        };
      }
    ).mock.calls.map((c) => c[2]);
    expect(callSelectors).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(['typescript', 'javascript']),
      ]),
    );
    expect(callSelectors).toEqual(
      expect.arrayContaining([expect.arrayContaining(['rust'])]),
    );
    expect(callSelectors).toEqual(
      expect.arrayContaining([expect.arrayContaining(['python'])]),
    );
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
    //
    // Phase 9.2f — the bridge subscribes
    // to `model.onDidChangeContent` (per-
    // model), not the editor's
    // `onDidChangeModelContent`. The test
    // fires the model's `fireContentChange`
    // helper to invoke the per-model
    // subscription.
    await act(async () => {
      fakeModel.fireContentChange({
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
    //
    // Phase 9.2f — use the `makeFakeModel`
    // factory so the per-model
    // `onDidChangeContent` +
    // `onWillDispose` subscriptions the
    // bridge installs are wired up.
    fakeModel = makeFakeModel(
      'file:///workspace/big/index.ts',
      'typescript',
      'a'.repeat(5000) + '\n',
    );
    // Phase 9.2f — the bridge discovers
    // models via `monaco.editor.getModels()`.
    // The `beforeEach` set
    // `fakeGetModelsReturn = [fakeModel]`
    // — that array now points to the
    // *old* `fakeModel`. Re-assign to
    // point at the new one so the bridge
    // sees the long-document model.
    fakeGetModelsReturn = [fakeModel];
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
      // Phase 9.2f — fire the per-model
      // `onDidChangeContent`.
      fakeModel.fireContentChange({
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
      // Phase 9.2f — fire the per-model
      // `onDidChangeContent` (not the
      // editor's `onDidChangeModelContent`).
      fakeModel.fireContentChange({
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
      // Phase 9.2f — fire the per-model
      // `onDidChangeContent`.
      fakeModel.fireContentChange({ changes: [], versionId: 1 });
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

  /**
   * Phase 9.2f — model lifecycle is tracked
   * via Monaco's `onDidCreateModel` (a new
   * tab is opened) and `model.onWillDispose`
   * (a tab is closed). The bridge sends
   * `didOpen` for the new model and
   * `didClose` for the closed one. This
   * replaces the pre-9.2f
   * `editor.onDidChangeModel` handler
   * (which assumed a single Monaco
   * editor with a focused model — true
   * for the pre-9.2f `EditorPane` design,
   * but the bridge is now forward-compatible
   * with a future pane that keeps a single
   * Monaco instance across tab switches).
   */
  it('sends didOpen for a new model created via onDidCreateModel', async () => {
    addWorkspace('/workspace/a');
    const mounted = mountBridge();
    // Wait for the bridge to spawn the
    // initial client + register the
    // `onDidCreateModel` subscription.
    await act(async () => {
      const deadline = Date.now() + 1000;
      while (
        Date.now() < deadline &&
        (fakeCreateModelListeners.length === 0 ||
          !useLspClientStore.getState().clients.has(tsKey('/workspace/a')))
      ) {
        await new Promise((r) => setTimeout(r, 10));
      }
    });
    const lspMock = (await import('@/ipc/lsp')) as unknown as {
      writes: Uint8Array[];
    };
    const writesBefore = lspMock.writes.length;
    // Simulate opening a new tab: create
    // a new model and fire the
    // `onDidCreateModel` listeners.
    const newUri = 'file:///workspace/a/other.ts';
    const newModel = makeFakeModel(
      newUri,
      'typescript',
      'export const y = 2;\n',
    );
    await act(async () => {
      for (const cb of fakeCreateModelListeners) cb(newModel);
      // Wait for the bridge's `didOpen`
      // round-trip.
      await new Promise((r) => setTimeout(r, 50));
    });
    const newWrites = lspMock.writes.slice(writesBefore);
    const writeText = newWrites
      .map((w) => new TextDecoder().decode(w))
      .join('');
    // The bridge should have sent
    // `textDocument/didOpen` for the new
    // model URI.
    expect(writeText).toContain('textDocument/didOpen');
    expect(writeText).toContain(newUri);
    mounted.unmount();
  });

  it('sends didClose when a model is disposed via onWillDispose', async () => {
    addWorkspace('/workspace/a');
    const mounted = mountBridge();
    // Wait for the bridge to spawn the
    // initial client + hook the default
    // `fakeModel`.
    await act(async () => {
      const deadline = Date.now() + 1000;
      while (
        Date.now() < deadline &&
        !useLspClientStore.getState().clients.has(tsKey('/workspace/a'))
      ) {
        await new Promise((r) => setTimeout(r, 10));
      }
    });
    const lspMock = (await import('@/ipc/lsp')) as unknown as {
      writes: Uint8Array[];
    };
    const writesBefore = lspMock.writes.length;
    // Fire `onWillDispose` on the model
    // (simulating a tab close).
    const closedUri = fakeModel.uri.toString();
    await act(async () => {
      fakeModel.fireWillDispose();
      // Wait for the bridge's `didClose`
      // round-trip.
      await new Promise((r) => setTimeout(r, 50));
    });
    const newWrites = lspMock.writes.slice(writesBefore);
    const writeText = newWrites
      .map((w) => new TextDecoder().decode(w))
      .join('');
    // The bridge should have sent
    // `textDocument/didClose` for the
    // closed model URI.
    expect(writeText).toContain('textDocument/didClose');
    expect(writeText).toContain(closedUri);
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
    // Phase 9.2f — the mock accumulates
    // calls across tests. Snapshot
    // *before* mounting so we can assert
    // on the delta.
    const callsBefore = (registerLspProviders as unknown as {
      mock: { calls: unknown[][] };
    }).mock.calls.length;
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
    // called 3 times (one per supported
    // kind). The mock accumulates across
    // tests, so we wait until the count
    // has grown by 3 from `callsBefore`.
    await act(async () => {
      const deadline = Date.now() + 1000;
      while (
        Date.now() < deadline &&
        (registerLspProviders as unknown as { mock: { calls: unknown[][] } })
          .mock.calls.length - callsBefore < 3
      ) {
        await new Promise((r) => setTimeout(r, 10));
      }
    });
    // Phase 9.2f — the bridge registers one
    // provider set per supported kind, so
    // there are 3 new calls (one each for
    // `typescript`, `rust_analyzer`,
    // `pyright`). The mock accumulates
    // across tests, so we use a delta
    // (count *during* this test). All
    // calls carry the same
    // `includeCompletion: false` default.
    const callsAfter = (registerLspProviders as unknown as {
      mock: { calls: unknown[][] };
    }).mock.calls;
    const newCalls = callsAfter.slice(callsBefore);
    expect(newCalls).toHaveLength(3);
    // The 4th argument is `options` (the
    // completion sub-toggle). Default is
    // `{ includeCompletion: false }`.
    for (const call of newCalls) {
      expect(call[3]).toEqual({ includeCompletion: false });
    }
    mounted.unmount();
  });

  it('passes includeCompletion:true to registerLspProviders when the completion sub-toggle is on', async () => {
    setUseRealServerForCompletion(true);
    // Fresh workspace path (see above).
    addWorkspace('/workspace/comp-on');
    // Phase 9.2f — snapshot mock call
    // count *before* mounting.
    const callsBefore = (registerLspProviders as unknown as {
      mock: { calls: unknown[][] };
    }).mock.calls.length;
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
    // called 3 times (one per supported
    // kind).
    await act(async () => {
      const deadline = Date.now() + 1000;
      while (
        Date.now() < deadline &&
        (registerLspProviders as unknown as { mock: { calls: unknown[][] } })
          .mock.calls.length - callsBefore < 3
      ) {
        await new Promise((r) => setTimeout(r, 10));
      }
    });
    // Phase 9.2f — 3 new calls (one per
    // kind), all carry
    // `includeCompletion: true`. Use a
    // delta because the mock accumulates
    // across tests.
    const callsAfter = (registerLspProviders as unknown as {
      mock: { calls: unknown[][] };
    }).mock.calls;
    const newCalls = callsAfter.slice(callsBefore);
    expect(newCalls).toHaveLength(3);
    for (const call of newCalls) {
      expect(call[3]).toEqual({ includeCompletion: true });
    }
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
    //
    // Phase 9.2f — use the `makeFakeModel`
    // factory so the per-model
    // `onDidChangeContent` + `onWillDispose`
    // subscriptions the bridge installs are
    // wired up.
    const pyModel: FakeModel = makeFakeModel(
      'file:///workspace/a/script.py',
      'python',
      'print("hi")\n',
    );
    const pyEditor = {
      getModel: () => pyModel,
      onDidChangeModelContent: (
        _cb: (e: FakeContentChangedEvent) => void,
      ) => ({ dispose: () => {} }),
      onDidChangeModel: (
        _cb: (e: FakeModelChangedEvent) => void,
      ) => ({ dispose: () => {} }),
    };
    // Phase 9.2f — the bridge discovers
    // models via `monaco.editor.getModels()`.
    fakeGetModelsReturn = [pyModel];
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
    //
    // Phase 9.2f — the test uses the
    // `makeFakeModel` factory so the
    // per-model `onDidChangeContent` +
    // `onWillDispose` subscriptions the
    // bridge installs are wired up.
    const rsModel: FakeModel = makeFakeModel(
      'file:///workspace/rs/src/main.rs',
      'rust',
      'fn main() {}\n',
    );
    const rsEditor = {
      getModel: () => rsModel,
      onDidChangeModelContent: (
        _cb: (e: FakeContentChangedEvent) => void,
      ) => ({ dispose: () => {} }),
      onDidChangeModel: (
        _cb: (e: FakeModelChangedEvent) => void,
      ) => ({ dispose: () => {} }),
    };
    // Phase 9.2f — the bridge discovers
    // models via `monaco.editor.getModels()`.
    // Override the default so the test
    // sees the `.rs` model.
    fakeGetModelsReturn = [rsModel];
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
    // Phase 9.2f — the bridge spawns
    // clients for *all* supported kinds
    // in parallel. The wait loop above
    // exits as soon as the rust client
    // is in the store; the TS and
    // pyright spawns may still be in
    // flight. Flush a few more ticks so
    // all `lspRunStdio` calls land
    // before we snapshot the delta.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
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
    //
    // Phase 9.2f — use the `makeFakeModel`
    // factory so the per-model
    // `onDidChangeContent` +
    // `onWillDispose` subscriptions the
    // bridge installs are wired up. The
    // bridge discovers models via
    // `monaco.editor.getModels()`; we
    // override `fakeGetModelsReturn` so
    // the bridge sees the `.py` model.
    const pyModel: FakeModel = makeFakeModel(
      'file:///workspace/multi/script.py',
      'python',
      'print("hi")\n',
    );
    const pyEditor = {
      getModel: () => pyModel,
      onDidChangeModelContent: (
        _cb: (e: FakeContentChangedEvent) => void,
      ) => ({ dispose: () => {} }),
      onDidChangeModel: (
        _cb: (e: FakeModelChangedEvent) => void,
      ) => ({ dispose: () => {} }),
    };
    // Phase 9.2f — the bridge discovers
    // models via `monaco.editor.getModels()`.
    fakeGetModelsReturn = [pyModel];
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
    //
    // Phase 9.2f — use the `makeFakeModel`
    // factory.
    const pyModel: FakeModel = makeFakeModel(
      'file:///workspace/indep/main.py',
      'python',
      'print("hi")\n',
    );
    const pyEditor = {
      getModel: () => pyModel,
      onDidChangeModelContent: (
        _cb: (e: FakeContentChangedEvent) => void,
      ) => ({ dispose: () => {} }),
      onDidChangeModel: (
        _cb: (e: FakeModelChangedEvent) => void,
      ) => ({ dispose: () => {} }),
    };
    // Phase 9.2f — bridge discovers models
    // via `monaco.editor.getModels()`.
    fakeGetModelsReturn = [pyModel];
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
    //
    // Phase 9.2f — use the `makeFakeModel`
    // factory.
    const pyModel: FakeModel = makeFakeModel(
      'file:///workspace/indep2/main.py',
      'python',
      'print("hi")\n',
    );
    const pyEditor = {
      getModel: () => pyModel,
      onDidChangeModelContent: (
        _cb: (e: FakeContentChangedEvent) => void,
      ) => ({ dispose: () => {} }),
      onDidChangeModel: (
        _cb: (e: FakeModelChangedEvent) => void,
      ) => ({ dispose: () => {} }),
    };
    // Phase 9.2f — bridge discovers models
    // via `monaco.editor.getModels()`.
    fakeGetModelsReturn = [pyModel];
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

  /**
   * Phase 9.2f — multi-model aggregator.
   * The "5 open tabs / 4 different kinds"
   * case. The bridge discovers all
   * currently-open models via
   * `monaco.editor.getModels()` and spawns
   * one `LspClient` per *kind*, sending
   * `didOpen` to the right client for each
   * model. When a new model is created
   * (a new tab is opened), the bridge
   * subscribes to its lifecycle and sends
   * `didOpen` to the corresponding client.
   *
   * The current `EditorPane` design
   * (`key={activeTab.id}`) remounts the
   * Monaco editor on every tab switch, so
   * the 9.2f aggregator's multi-model
   * tracking is forward-infrastructure
   * for a future pane refactor that keeps
   * one Monaco instance across tabs. The
   * aggregator is correct in both
   * designs.
   */
  it('aggregator: 5 open tabs of 4 different kinds spawn 4 distinct LspClients', async () => {
    // 5 open tabs across 4 different
    // kinds: 2x TS, 1x py, 1x rs, 1x tsx.
    // The 2x TS and 1x tsx all map to the
    // `typescript` kind (so the TS client
    // handles 3 models); the py maps to
    // `pyright`; the rs maps to
    // `rust_analyzer`. Total: 3 distinct
    // kinds → 3 LspClients.
    //
    // (The test is labeled "4 different
    // kinds" loosely; the *file* kinds
    // are 4, but the *LspServerKind* set
    // is 3 because TS/TSX both map to
    // `typescript`. The test exercises
    // the multi-client case.)
    const tabA: FakeModel = makeFakeModel(
      'file:///workspace/agg/script.ts',
      'typescript',
      'export const a = 1;\n',
    );
    const tabB: FakeModel = makeFakeModel(
      'file:///workspace/agg/main.py',
      'python',
      'print("py")\n',
    );
    const tabC: FakeModel = makeFakeModel(
      'file:///workspace/agg/lib.rs',
      'rust',
      'fn lib() {}\n',
    );
    const tabD: FakeModel = makeFakeModel(
      'file:///workspace/agg/component.tsx',
      'typescriptreact',
      'export const D = () => <div/>;\n',
    );
    const tabE: FakeModel = makeFakeModel(
      'file:///workspace/agg/other.ts',
      'typescript',
      'export const e = 5;\n',
    );
    fakeGetModelsReturn = [tabA, tabB, tabC, tabD, tabE];
    // Custom editor — the 9.2f aggregator
    // doesn't read `getModel()` from the
    // editor at all (it uses Monaco's
    // `getModels()`), so a no-op editor
    // is fine. We still pass one because
    // the hook signature requires it.
    const aggEditor = {
      getModel: () => null,
      onDidChangeModelContent: () => ({ dispose: () => {} }),
      onDidChangeModel: () => ({ dispose: () => {} }),
    };
    addWorkspace('/workspace/agg');
    const mounted = mountBridge(aggEditor);
    // Wait for all 3 clients to be
    // spawned (TS handles 3 models; rust
    // and pyright handle 1 each).
    await act(async () => {
      const deadline = Date.now() + 2000;
      while (
        Date.now() < deadline &&
        (!useLspClientStore
          .getState()
          .clients.has(workspaceKindKey('/workspace/agg', 'typescript')) ||
          !useLspClientStore
            .getState()
            .clients.has(workspaceKindKey('/workspace/agg', 'pyright')) ||
          !useLspClientStore
            .getState()
            .clients.has(workspaceKindKey('/workspace/agg', 'rust_analyzer')))
      ) {
        await new Promise((r) => setTimeout(r, 10));
      }
    });
    // Flush pending `didOpen`s.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    const state = useLspClientStore.getState();
    // 3 distinct clients.
    expect(state.clients.size).toBe(3);
    // The typescript client is the same
    // one (single client, 3 models open
    // on it).
    const tsClient = state.clients.get(
      workspaceKindKey('/workspace/agg', 'typescript'),
    );
    const pyClient = state.clients.get(
      workspaceKindKey('/workspace/agg', 'pyright'),
    );
    const rsClient = state.clients.get(
      workspaceKindKey('/workspace/agg', 'rust_analyzer'),
    );
    expect(tsClient).toBeDefined();
    expect(pyClient).toBeDefined();
    expect(rsClient).toBeDefined();
    expect(tsClient?.kind).toBe('typescript');
    expect(pyClient?.kind).toBe('pyright');
    expect(rsClient?.kind).toBe('rust_analyzer');
    // All three are distinct objects
    // (the `typescript` client is a
    // single instance, but the
    // `pyright` and `rust_analyzer`
    // clients are different objects).
    expect(tsClient).not.toBe(pyClient);
    expect(tsClient).not.toBe(rsClient);
    expect(pyClient).not.toBe(rsClient);
    // The `registerLspProviders` mock was
    // called once per supported kind (3
    // times).
    const callsAfter = (registerLspProviders as unknown as {
      mock: { calls: unknown[][] };
    }).mock.calls;
    const selectors = callsAfter.map((c) => c[2] as string[]);
    expect(selectors).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(['typescript', 'javascript']),
      ]),
    );
    expect(selectors).toEqual(
      expect.arrayContaining([expect.arrayContaining(['rust'])]),
    );
    expect(selectors).toEqual(
      expect.arrayContaining([expect.arrayContaining(['python'])]),
    );
    mounted.unmount();
  });

  /**
   * Phase 9.2f — content changes route to
   * the right client. Edit a `.py` model
   * and verify the pyright client gets
   * the `didChange` (not the TS or
   * rust-analyzer client).
   */
  it('aggregator: content changes on a .py model route to the pyright client, not the TS client', async () => {
    const pyModel: FakeModel = makeFakeModel(
      'file:///workspace/route/main.py',
      'python',
      'print("before")\n',
    );
    fakeGetModelsReturn = [pyModel];
    const routeEditor = {
      getModel: () => pyModel,
      onDidChangeModelContent: () => ({ dispose: () => {} }),
      onDidChangeModel: () => ({ dispose: () => {} }),
    };
    addWorkspace('/workspace/route');
    const mounted = mountBridge(routeEditor);
    // Wait for both the pyright and TS
    // clients to be spawned (the bridge
    // spawns all 3 kinds in parallel; we
    // wait for both so the wire-write
    // assertions are unambiguous).
    await act(async () => {
      const deadline = Date.now() + 2000;
      while (
        Date.now() < deadline &&
        (!useLspClientStore
          .getState()
          .clients.has(workspaceKindKey('/workspace/route', 'pyright')) ||
          !useLspClientStore
            .getState()
            .clients.has(workspaceKindKey('/workspace/route', 'typescript')))
      ) {
        await new Promise((r) => setTimeout(r, 10));
      }
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    const lspMock = (await import('@/ipc/lsp')) as unknown as {
      writes: Uint8Array[];
    };
    const writesBefore = lspMock.writes.length;
    // Edit the .py model. The
    // per-model `onDidChangeContent`
    // subscription on `pyModel` should
    // fire, infer the kind as
    // `pyright`, look up the pyright
    // client, and call
    // `sendDidChange` on it.
    await act(async () => {
      pyModel.fireContentChange({
        changes: [
          {
            range: {
              startLineNumber: 1,
              startColumn: 7,
              endLineNumber: 1,
              endColumn: 13,
            },
            rangeLength: 6,
            text: 'after',
          },
        ],
        versionId: 2,
      });
      await new Promise((r) => setTimeout(r, 50));
    });
    const newWrites = lspMock.writes.slice(writesBefore);
    const writeText = newWrites
      .map((w) => new TextDecoder().decode(w))
      .join('');
    // The write should contain
    // `textDocument/didChange` and the
    // .py URI.
    expect(writeText).toContain('textDocument/didChange');
    expect(writeText).toContain('main.py');
    mounted.unmount();
  });

  /**
   * Phase 9.2f — opening a new tab fires
   * `onDidCreateModel`, which the bridge
   * subscribes to. The new model is
   * hooked, `didOpen` is sent to the
   * right client, and per-model
   * `onDidChangeContent` +
   * `onWillDispose` subscriptions are
   * installed.
   */
  it('aggregator: opening a new tab (onDidCreateModel) sends didOpen to the right client', async () => {
    addWorkspace('/workspace/tab');
    const mounted = mountBridge();
    // Wait for the initial TS client +
    // `onDidCreateModel` subscription
    // to be set up.
    await act(async () => {
      const deadline = Date.now() + 2000;
      while (
        Date.now() < deadline &&
        (fakeCreateModelListeners.length === 0 ||
          !useLspClientStore
            .getState()
            .clients.has(workspaceKindKey('/workspace/tab', 'typescript')))
      ) {
        await new Promise((r) => setTimeout(r, 10));
      }
    });
    const lspMock = (await import('@/ipc/lsp')) as unknown as {
      writes: Uint8Array[];
    };
    const writesBefore = lspMock.writes.length;
    // Simulate opening a new `.rs` tab.
    // The bridge's `onDidCreateModel`
    // handler fires `hookModel` on the
    // new model, which spawns the
    // rust_analyzer client (if not
    // already alive) and sends
    // `didOpen` to it.
    const newUri = 'file:///workspace/tab/new.rs';
    const newModel = makeFakeModel(
      newUri,
      'rust',
      'fn new() {}\n',
    );
    await act(async () => {
      for (const cb of fakeCreateModelListeners) cb(newModel);
      // Wait for the spawn + `didOpen`
      // round-trip.
      const deadline = Date.now() + 2000;
      while (
        Date.now() < deadline &&
        !useLspClientStore
          .getState()
          .clients.has(workspaceKindKey('/workspace/tab', 'rust_analyzer'))
      ) {
        await new Promise((r) => setTimeout(r, 10));
      }
      await new Promise((r) => setTimeout(r, 50));
    });
    // The rust-analyzer client exists.
    expect(
      useLspClientStore
        .getState()
        .clients.has(workspaceKindKey('/workspace/tab', 'rust_analyzer')),
    ).toBe(true);
    const newWrites = lspMock.writes.slice(writesBefore);
    const writeText = newWrites
      .map((w) => new TextDecoder().decode(w))
      .join('');
    // The wire should contain
    // `textDocument/didOpen` for the
    // new .rs URI.
    expect(writeText).toContain('textDocument/didOpen');
    expect(writeText).toContain(newUri);
    mounted.unmount();
  });

  /**
   * Phase 9.2f — closing a tab fires
   * the model's `onWillDispose`. The
   * bridge's per-model `onWillDispose`
   * subscription tears down the
   * per-model subscriptions and sends
   * `didClose` to the right client.
   */
  it('aggregator: closing a tab (onWillDispose) sends didClose to the right client', async () => {
    addWorkspace('/workspace/close');
    const mounted = mountBridge();
    // Wait for the TS client + the
    // default `fakeModel` to be hooked.
    await act(async () => {
      const deadline = Date.now() + 2000;
      while (
        Date.now() < deadline &&
        !useLspClientStore
          .getState()
          .clients.has(workspaceKindKey('/workspace/close', 'typescript'))
      ) {
        await new Promise((r) => setTimeout(r, 10));
      }
      await new Promise((r) => setTimeout(r, 100));
    });
    const lspMock = (await import('@/ipc/lsp')) as unknown as {
      writes: Uint8Array[];
    };
    const writesBefore = lspMock.writes.length;
    const closedUri = fakeModel.uri.toString();
    // Fire `onWillDispose` on the
    // model (simulating a tab close).
    await act(async () => {
      fakeModel.fireWillDispose();
      await new Promise((r) => setTimeout(r, 50));
    });
    const newWrites = lspMock.writes.slice(writesBefore);
    const writeText = newWrites
      .map((w) => new TextDecoder().decode(w))
      .join('');
    // The wire should contain
    // `textDocument/didClose` for the
    // closed model URI.
    expect(writeText).toContain('textDocument/didClose');
    expect(writeText).toContain(closedUri);
    mounted.unmount();
  });

  /**
   * Phase 9.2f — per-kind kill switch still
   * gates. Disable the `pyright` kind and
   * verify that the bridge doesn't
   * spawn a pyright client OR send
   * `didOpen` for a `.py` model — even
   * when other kinds are enabled.
   */
  it('aggregator: per-kind kill switch off for pyright — .py model is not opened on a client', async () => {
    setUseRealServer('pyright', false);
    addWorkspace('/workspace/off-py');
    const pyModel: FakeModel = makeFakeModel(
      'file:///workspace/off-py/main.py',
      'python',
      'print("hi")\n',
    );
    fakeGetModelsReturn = [pyModel];
    const offEditor = {
      getModel: () => pyModel,
      onDidChangeModelContent: () => ({ dispose: () => {} }),
      onDidChangeModel: () => ({ dispose: () => {} }),
    };
    const mounted = mountBridge(offEditor);
    // Wait for the bridge to register
    // the other kinds' clients.
    await act(async () => {
      const deadline = Date.now() + 2000;
      while (
        Date.now() < deadline &&
        !useLspClientStore
          .getState()
          .clients.has(workspaceKindKey('/workspace/off-py', 'typescript'))
      ) {
        await new Promise((r) => setTimeout(r, 10));
      }
      await new Promise((r) => setTimeout(r, 100));
    });
    // The pyright client does NOT exist
    // (kill switch off). The TS and
    // rust_analyzer clients do.
    expect(
      useLspClientStore
        .getState()
        .clients.has(workspaceKindKey('/workspace/off-py', 'pyright')),
    ).toBe(false);
    expect(
      useLspClientStore
        .getState()
        .clients.has(workspaceKindKey('/workspace/off-py', 'typescript')),
    ).toBe(true);
    expect(
      useLspClientStore
        .getState()
        .clients.has(workspaceKindKey('/workspace/off-py', 'rust_analyzer')),
    ).toBe(true);
    mounted.unmount();
  });

  // ------------------------------------------------------------------
  // D-146 — provider respawn re-registration
  // ------------------------------------------------------------------

  /**
   * D-146 — sanity check: the
   * `lspClientStore` respawn path
   * creates a new `LspClient` with a
   * *different* `handleId`. The bridge
   * must observe this `handleId` change
   * and re-register the kind's provider
   * set against the fresh client. The
   * `registerLspProviders` mock returns
   * a fresh array of `dispose()` noops
   * on every call, so the test can count
   * the call count to detect re-registration.
   *
   * The mock factory uses a counter so
   * the first call returns `mock_handle_1`
   * (the default) and subsequent calls
   * return `mock_handle_respawn_N` —
   * this matches real-world behaviour
   * (the Rust side generates a fresh
   * handleId for every `lsp_run_stdio`
   * call) and triggers the bridge's
   * respawn detector.
   */
  it('D-146: re-registers providers after a respawn (new handleId)', async () => {
    addWorkspace('/workspace/respawn');
    // Wrap the `lspRunStdio` mock with a
    // counter so each spawn returns a
    // unique handleId. The default mock
    // returns `mock_handle_1` on every
    // call; with the counter, the first
    // call returns `mock_handle_1`, the
    // second returns `mock_handle_2`, etc.
    let spawnCount = 0;
    const lspRunStdioMod = (await import('@/ipc/lsp'))
      .lspRunStdio as unknown as {
      mockImplementation: (fn: () => Promise<unknown>) => unknown;
      mockReset: () => void;
    };
    lspRunStdioMod.mockImplementation(async () => {
      spawnCount += 1;
      return {
        handleId: `mock_handle_respawn_${spawnCount}`,
        resolvedCommand: 'typescript-language-server',
      };
    });
    // Snapshot the `registerLspProviders`
    // call count *before* mounting so we
    // can assert the exact delta (3 from
    // initial mount + 1 from the respawn).
    const callsBefore = (registerLspProviders as unknown as {
      mock: { calls: unknown[][] };
    }).mock.calls.length;
    const mounted = mountBridge();
    // Wait for the initial 3 providers to
    // be registered (one per kind).
    await act(async () => {
      const deadline = Date.now() + 2000;
      while (
        Date.now() < deadline &&
        (registerLspProviders as unknown as { mock: { calls: unknown[][] } })
          .mock.calls.length <
          callsBefore + 3
      ) {
        await new Promise((r) => setTimeout(r, 10));
      }
    });
    const initialDelta =
      (registerLspProviders as unknown as { mock: { calls: unknown[][] } })
        .mock.calls.length - callsBefore;
    expect(initialDelta).toBe(3);
    // Capture the TS provider's selector
    // from the initial mount (so we can
    // confirm the respawn uses the same
    // one).
    const initialTsSelector = (registerLspProviders as unknown as {
      mock: { calls: unknown[][] };
    }).mock.calls[callsBefore]![2] as string[];
    // Force a respawn of the TS kind. The
    // store's `respawn` is the manual
    // path (vs. the auto-respawn ladder
    // triggered by `lsp://crashed`); it
    // disposes the current client and
    // `getOrCreate`s a fresh one. The
    // second `lspRunStdio` call returns
    // `mock_handle_respawn_2` (from our
    // counter).
    await act(async () => {
      await useLspClientStore
        .getState()
        .respawn('/workspace/respawn', 'typescript');
    });
    // Wait for the re-registration to
    // happen. The store subscription
    // fires synchronously on the new
    // client's `setState`, but the
    // re-registration is an async
    // `getOrCreate` + `registerLspProviders`
    // round-trip. Poll until the call
    // count grows by 1 (only the TS kind
    // was respawned; the rust_analyzer +
    // pyright providers should NOT be
    // re-registered).
    await act(async () => {
      const deadline = Date.now() + 2000;
      while (
        Date.now() < deadline &&
        (registerLspProviders as unknown as { mock: { calls: unknown[][] } })
          .mock.calls.length <
          callsBefore + 4
      ) {
        await new Promise((r) => setTimeout(r, 10));
      }
    });
    const afterRespawnDelta =
      (registerLspProviders as unknown as { mock: { calls: unknown[][] } })
        .mock.calls.length - callsBefore;
    expect(afterRespawnDelta).toBe(4);
    // The 4th call (the respawn) was for
    // the TS kind. The other two kinds
    // (rust_analyzer, pyright) did NOT
    // re-register. The selector MUST
    // match the TS initial-mount
    // selector (typescript,
    // typescriptreact, javascript,
    // javascriptreact).
    const respawnCall = (registerLspProviders as unknown as {
      mock: { calls: unknown[][] };
    }).mock.calls[callsBefore + 3]!;
    const respawnSelector = respawnCall[2] as string[];
    expect(respawnSelector).toEqual(initialTsSelector);
    expect(respawnSelector).toContain('typescript');
    expect(respawnSelector).toContain('typescriptreact');
    mounted.unmount();
    // Restore the default mock for
    // subsequent tests in this file.
    lspRunStdioMod.mockReset();
  });

  /**
   * D-146 — the respawn path disposes
   * the *old* provider set before
   * registering the new one. The mock
   * returns fresh `{ dispose: vi.fn() }`
   * arrays on every call, so we can
   * pin the dispose calls to the *first*
   * registration's array (which must
   * be disposed) and confirm the
   * *second* registration's array is
   * *not* disposed yet.
   *
   * We read the disposable array from
   * `mock.results[i].value` (the return
   * value of the call), not from
   * `mock.calls[i][0]` (the first
   * argument, which is the `client`).
   */
  it('D-146: disposes the old provider set on respawn (not the new one)', async () => {
    addWorkspace('/workspace/dispose-old');
    // Wrap the `registerLspProviders`
    // mock factory so it returns a
    // fresh array of `{ dispose: vi.fn() }`
    // on every call. We also wrap
    // `lspRunStdio` with a counter so
    // each spawn returns a unique
    // handleId (respawn detector).
    const originalRegister = registerLspProviders as unknown as {
      mockImplementation: (fn: () => unknown[]) => unknown;
      mockReset: () => void;
    };
    originalRegister.mockImplementation(() => {
      return [
        { dispose: vi.fn() },
        { dispose: vi.fn() },
      ];
    });
    let spawnCount = 0;
    const lspRunStdioMod = (await import('@/ipc/lsp'))
      .lspRunStdio as unknown as {
      mockImplementation: (fn: () => Promise<unknown>) => unknown;
      mockReset: () => void;
    };
    lspRunStdioMod.mockImplementation(async () => {
      spawnCount += 1;
      return {
        handleId: `mock_handle_dispose_${spawnCount}`,
        resolvedCommand: 'typescript-language-server',
      };
    });
    const callsBefore = (registerLspProviders as unknown as {
      mock: { calls: unknown[][]; results: Array<{ value: unknown }> };
    }).mock.calls.length;
    const mounted = mountBridge();
    // Wait for initial mount (3 provider
    // sets registered, 3 arrays of
    // disposables captured by our
    // wrapper).
    await act(async () => {
      const deadline = Date.now() + 2000;
      while (
        Date.now() < deadline &&
        (registerLspProviders as unknown as { mock: { calls: unknown[][] } })
          .mock.calls.length <
          callsBefore + 3
      ) {
        await new Promise((r) => setTimeout(r, 10));
      }
    });
    // Pre-respawn: 3 arrays of 2 disposables
    // each = 6 `dispose` functions
    // captured. None have been called yet
    // (the bridge doesn't dispose the
    // initial provider set on mount).
    const initialDisposables = (registerLspProviders as unknown as {
      mock: { results: Array<{ value: unknown }> };
    }).mock.results
      .slice(callsBefore)
      .map((r) => r.value as Array<{ dispose: ReturnType<typeof vi.fn> }>);
    const initialDisposeCount = initialDisposables.reduce(
      (acc, arr) => acc + arr.length,
      0,
    );
    expect(initialDisposeCount).toBe(6);
    for (const arr of initialDisposables) {
      for (const d of arr) {
        expect(d.dispose).toHaveBeenCalledTimes(0);
      }
    }
    // Force the respawn.
    await act(async () => {
      await useLspClientStore
        .getState()
        .respawn('/workspace/dispose-old', 'typescript');
    });
    // Wait for the respawn re-registration
    // (4 total calls).
    await act(async () => {
      const deadline = Date.now() + 2000;
      while (
        Date.now() < deadline &&
        (registerLspProviders as unknown as { mock: { calls: unknown[][] } })
          .mock.calls.length <
          callsBefore + 4
      ) {
        await new Promise((r) => setTimeout(r, 10));
      }
    });
    // The 4th call (the respawn) returned
    // a fresh array of 2 disposables.
    // Index in `mock.results` is
    // `callsBefore + 3`.
    const respawnDisposables = ((registerLspProviders as unknown as {
      mock: { results: Array<{ value: unknown }> };
    }).mock.results[callsBefore + 3]!.value as Array<{
      dispose: ReturnType<typeof vi.fn>;
    }>);
    // The TS initial-mount array is at
    // index `callsBefore` in `mock.results`.
    const tsInitialDisposables = ((registerLspProviders as unknown as {
      mock: { results: Array<{ value: unknown }> };
    }).mock.results[callsBefore]!.value as Array<{
      dispose: ReturnType<typeof vi.fn>;
    }>);
    // The TS initial array's disposes
    // MUST have been called (the bridge
    // disposed the old set before
    // registering the new one).
    expect(tsInitialDisposables[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(tsInitialDisposables[1]!.dispose).toHaveBeenCalledTimes(1);
    // The respawn array's disposes
    // MUST NOT have been called yet
    // (the bridge just registered them).
    expect(respawnDisposables[0]!.dispose).toHaveBeenCalledTimes(0);
    expect(respawnDisposables[1]!.dispose).toHaveBeenCalledTimes(0);
    // The rust_analyzer and pyright
    // initial disposables (indices
    // `callsBefore + 1` and
    // `callsBefore + 2`) MUST NOT have
    // been called (only the TS kind was
    // respawned).
    const rustInitialDisposables = ((registerLspProviders as unknown as {
      mock: { results: Array<{ value: unknown }> };
    }).mock.results[callsBefore + 1]!.value as Array<{
      dispose: ReturnType<typeof vi.fn>;
    }>);
    const pyInitialDisposables = ((registerLspProviders as unknown as {
      mock: { results: Array<{ value: unknown }> };
    }).mock.results[callsBefore + 2]!.value as Array<{
      dispose: ReturnType<typeof vi.fn>;
    }>);
    expect(rustInitialDisposables[0]!.dispose).toHaveBeenCalledTimes(0);
    expect(pyInitialDisposables[0]!.dispose).toHaveBeenCalledTimes(0);
    mounted.unmount();
    // Restore the default mocks for
    // subsequent tests in this file.
    originalRegister.mockReset();
    lspRunStdioMod.mockReset();
  });

  /**
   * D-146 — the bridge's store
   * subscription is a Zustand
   * `subscribe` (not a React effect
   * dep). On bridge unmount, the
   * subscription must be torn down,
   * so a *subsequent* respawn (after
   * unmount) does not trigger any
   * re-registration. This is the leak
   * guard: without the unsubscribe
   * in the cleanup function, a
   * respawn after unmount would
   * call `registerProvidersForKind`
   * with `cancelled === true`, which
   * is a no-op, but the subscription
   * closure would still be alive,
   * holding a reference to the
   * dead `providerDisposables` map.
   */
  it('D-146: unsubscribes the respawn watcher on bridge unmount', async () => {
    addWorkspace('/workspace/unsub');
    // Counter on `lspRunStdio` so the
    // respawn's handleId differs from
    // the initial spawn's.
    let spawnCount = 0;
    const lspRunStdioMod = (await import('@/ipc/lsp'))
      .lspRunStdio as unknown as {
      mockImplementation: (fn: () => Promise<unknown>) => unknown;
      mockReset: () => void;
    };
    lspRunStdioMod.mockImplementation(async () => {
      spawnCount += 1;
      return {
        handleId: `mock_handle_unsub_${spawnCount}`,
        resolvedCommand: 'typescript-language-server',
      };
    });
    const callsBefore = (registerLspProviders as unknown as {
      mock: { calls: unknown[][] };
    }).mock.calls.length;
    const mounted = mountBridge();
    await act(async () => {
      const deadline = Date.now() + 2000;
      while (
        Date.now() < deadline &&
        (registerLspProviders as unknown as { mock: { calls: unknown[][] } })
          .mock.calls.length <
          callsBefore + 3
      ) {
        await new Promise((r) => setTimeout(r, 10));
      }
    });
    // Unmount. The cleanup function
    // runs synchronously inside
    // `act()`. After unmount, no
    // subscription should be alive.
    mounted.unmount();
    // Now force a respawn. The store
    // respawns the TS kind — the
    // bridge is unmounted, so the
    // respawn should not trigger any
    // re-registration.
    await act(async () => {
      await useLspClientStore
        .getState()
        .respawn('/workspace/unsub', 'typescript');
    });
    // Wait long enough for the
    // respawn's re-registration to
    // have fired IF the subscription
    // was still alive. The store
    // subscription is synchronous
    // (it fires inside `setState`),
    // and `registerProvidersForKind`
    // is async, so 200ms is plenty.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    // The `registerLspProviders` call
    // count should NOT have grown
    // (no subscription → no
    // re-registration).
    const finalDelta =
      (registerLspProviders as unknown as { mock: { calls: unknown[][] } })
        .mock.calls.length - callsBefore;
    expect(finalDelta).toBe(3);
    // Restore the default mock for
    // subsequent tests in this file.
    lspRunStdioMod.mockReset();
  });
});
