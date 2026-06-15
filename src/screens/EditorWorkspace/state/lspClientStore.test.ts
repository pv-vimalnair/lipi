/**
 * Tests for `lspClientStore.ts` — the Zustand
 * store + `LspClient` class that owns one
 * `typescript-language-server` child process per
 * workspace.
 *
 * The `LspClient` depends on the `lsp.ts` IPC
 * wrapper (the `lsp_run_stdio` /
 * `lsp_stdio_read` / `lsp_stdio_write` /
 * `lsp_stdio_close` Tauri commands). We mock
 * that wrapper with a controllable in-memory
 * pipe so the tests can drive the JSON-RPC
 * handshake deterministically.
 *
 * ## How the mock works
 *
 * The `lspStdioRead` mock returns bytes from
 * a queue that's filled by `feed()`. The test
 * uses `feed()` to push a canned `initialize`
 * response back to the client, which lets
 * `start()` complete + transition to `ready`.
 *
 * Coverage:
 *   1. `getOrCreate` for a new workspace spawns
 *      a single client + transitions to
 *      `starting` then `ready`
 *   2. `getOrCreate` for the same workspace
 *      returns the same client (no second
 *      spawn)
 *   3. `dispose` removes the client + flips
 *      the status back to `stopped`
 *   4. Spawn failure flips the status to
 *      `error` and removes the client
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Per-test pipe state. Reset in `beforeEach`.
let writes: Uint8Array[] = [];
let readQueue: Uint8Array[] = [];
// Phase 9.5 — listeners registered via
// `onLspCrashed`. The store subscribes exactly
// one in `getOrCreate`; tests capture it so
// they can fire a synthetic `lsp://crashed`
// event to exercise the crash path.
let crashListeners: Array<(p: {
  handleId: string;
  exitStatus: number | null;
  stderrTail: string;
}) => void> = [];
let nextHandleIdCounter = 1;

vi.mock('@/ipc/lsp', () => {
  return {
    lspRunStdio: vi.fn(async () => {
      const id = `mock_handle_${nextHandleIdCounter++}`;
      return {
        handleId: id,
        resolvedCommand: 'typescript-language-server',
      };
    }),
    lspStdioRead: vi.fn(async (_handleId: string, maxBytes: number) => {
      // Pop up to `maxBytes` from the
      // queue. If the queue is empty, return
      // an empty buffer (the polling loop
      // retries on the next tick).
      if (readQueue.length === 0) {
        return new Uint8Array(0);
      }
      const next = readQueue.shift()!;
      return next.byteLength > maxBytes ? next.slice(0, maxBytes) : next;
    }),
    lspStdioWrite: vi.fn(async (_handleId: string, bytes: Uint8Array) => {
      writes.push(bytes);
      // If the request is `initialize` or
      // `shutdown`, queue a canned response
      // with the correct id. (We parse the
      // frame we just received and
      // immediately enqueue the response
      // — the LspClient's polling loop will
      // pick it up on the next tick.)
      const text = new TextDecoder().decode(bytes);
      const headerEnd = text.indexOf('\r\n\r\n');
      if (headerEnd !== -1) {
        const body = text.slice(headerEnd + 4);
        try {
          const msg = JSON.parse(body) as {
            id?: number;
            method?: string;
            jsonrpc?: string;
          };
          if (msg.method === 'initialize' && typeof msg.id === 'number') {
            readQueue.push(
              lspFrame({
                jsonrpc: '2.0',
                id: msg.id,
                result: INIT_RESPONSE.result,
              }),
            );
          } else if (msg.method === 'shutdown' && typeof msg.id === 'number') {
            // `shutdown` returns `null`. The
            // mock auto-replies so the
            // client's `await _request(...)`
            // resolves and the dispose path
            // doesn't hang.
            readQueue.push(
              lspFrame({
                jsonrpc: '2.0',
                id: msg.id,
                result: null,
              }),
            );
          }
        } catch {
          // not JSON — ignore
        }
      }
      return bytes.byteLength;
    }),
    lspStdioClose: vi.fn(async () => undefined),
    lspStdioReadStderr: vi.fn(async () => new Uint8Array(0)),
    lspCheckAvailable: vi.fn(async () => ({
      available: true,
      installHint: 'npm install -g typescript-language-server',
      version: '4.3.3',
    })),
    onLspCrashed: vi.fn((handler: (p: {
      handleId: string;
      exitStatus: number | null;
      stderrTail: string;
    }) => void) => {
      // The store calls `void onLspCrashed(...).then(...)`,
      // so the function must return a
      // thenable. We push synchronously so
      // the test's `fireCrash` helper sees
      // the listener immediately, then
      // resolve the promise in a microtask.
      crashListeners.push(handler);
      return {
        then(onFulfilled: (un: () => void) => void) {
          return Promise.resolve(
            () => {
              const idx = crashListeners.indexOf(handler);
              if (idx >= 0) crashListeners.splice(idx, 1);
            },
          ).then(onFulfilled);
        },
      };
    }),
    LSP_CRASHED_EVENT: 'lsp://crashed',
  };
});

// Frame a JSON-RPC message the way
// `typescript-language-server` would: a
// `Content-Length: N\r\n\r\n<body>` envelope.
function lspFrame(message: object): Uint8Array {
  const body = JSON.stringify(message);
  const bodyBytes = new TextEncoder().encode(body);
  const header = `Content-Length: ${bodyBytes.byteLength}\r\n\r\n`;
  const headerBytes = new TextEncoder().encode(header);
  const out = new Uint8Array(headerBytes.byteLength + bodyBytes.byteLength);
  out.set(headerBytes, 0);
  out.set(bodyBytes, headerBytes.byteLength);
  return out;
}

// Canned `initialize` response. The client
// only needs the `capabilities` field to
// register its providers.
const INIT_RESPONSE = {
  jsonrpc: '2.0',
  id: 1,
  result: {
    capabilities: {
      // No inlay hint support in the mock —
      // tests don't exercise that provider
      // (the bridge guards on
      // `capabilities.inlayHintProvider`).
      definitionProvider: true,
      referencesProvider: true,
      renameProvider: true,
      implementationProvider: true,
      documentSymbolProvider: true,
      codeActionProvider: true,
      hoverProvider: true,
      signatureHelpProvider: true,
    },
    serverInfo: { name: 'mock-tsserver', version: '4.3.3' },
  },
};

// The store is imported once for the
// whole test file. Tests reset its state
// in `beforeEach` but reuse the same
// instance. The crash-listener is
// detached via the store's
// `__resetLspClientStoreForTests` action
// (closure-scoped, so it has to live on
// the actions object, not in `setState`).
import { useLspClientStore as importedStore } from './lspClientStore';
let useLspClientStore: typeof importedStore = importedStore;

beforeEach(() => {
  // Phase 9.5 — the store's
  // `crashUnlisten` and internal
  // `handleToWorkspace` /
  // `respawnTimers` /
  // `startPromises` maps are
  // closure-scoped (so they can't be
  // reset via `setState`). The store
  // exposes a `__resetLspClientStoreForTests`
  // action for the test suite to call
  // in `beforeEach` — it cancels timers,
  // clears the handle map, and
  // detaches the crash listener so
  // the next test's first
  // `getOrCreate` re-registers a
  // fresh one.
  useLspClientStore.getState().__resetLspClientStoreForTests();
  useLspClientStore.setState({
    clients: new Map(),
    statusByWorkspace: new Map(),
    crashByWorkspace: new Map(),
  });
  writes = [];
  readQueue = [];
  // Drain listeners that the previous
  // test's `ensureCrashListener` added.
  crashListeners = [];
  nextHandleIdCounter = 1;
  // Default the kill switch ON for most
  // tests; per-test overrides set it OFF
  // and back as needed.
  localStorage.setItem('lipi:lsp:useRealServer:v1', 'true');
  vi.clearAllMocks();
});

afterEach(() => {
  // Tear down any live client so the polling
  // loop's `setTimeout` doesn't fire after
  // the test ends. We do NOT await
  // `shutdown()` — it sends a `shutdown` JSON-RPC
  // request that needs a response, and the
  // mock doesn't simulate a server. Fire and
  // forget.
  const state = useLspClientStore.getState();
  for (const [, client] of state.clients) {
    void client.shutdown();
  }
  useLspClientStore.setState({
    clients: new Map(),
    statusByWorkspace: new Map(),
    crashByWorkspace: new Map(),
  });
  // Drain any pending crash listeners.
  crashListeners = [];
  localStorage.removeItem('lipi:lsp:useRealServer:v1');
});

describe('lspClientStore', () => {
  it('getOrCreate spawns a client for a new workspace and flips status to starting then ready', async () => {
    // The mock `lspStdioWrite` automatically
    // queues a canned `initialize` response
    // when it sees the request, so we don't
    // need to pre-stage it. The LspClient's
    // polling loop reads the response on the
    // next tick and the `start()` promise
    // resolves.
    const client = await useLspClientStore
      .getState()
      .getOrCreate('/workspace/a');
    expect(client).toBeDefined();
    expect(useLspClientStore.getState().statusByWorkspace.get('/workspace/a')).toBe(
      'ready',
    );
  });

  it('getOrCreate for the same workspace returns the same client', async () => {
    const a = await useLspClientStore.getState().getOrCreate('/workspace/a');
    const b = await useLspClientStore.getState().getOrCreate('/workspace/a');
    expect(a).toBe(b);
    const { lspRunStdio } = await import('@/ipc/lsp');
    expect(
      (lspRunStdio as unknown as { mock: { calls: unknown[] } }).mock.calls,
    ).toHaveLength(1);
  });

  it('dispose removes the client and flips the status back to stopped', async () => {
    await useLspClientStore.getState().getOrCreate('/workspace/a');
    // `dispose` calls `client.shutdown()` which
    // awaits a `shutdown` JSON-RPC request —
    // the mock doesn't simulate a server
    // response, so we don't await dispose
    // here. The synchronous part of `dispose`
    // removes the client from the map and
    // flips the status; the async shutdown
    // continues in the background.
    void useLspClientStore.getState().dispose('/workspace/a');
    expect(useLspClientStore.getState().clients.has('/workspace/a')).toBe(false);
    expect(useLspClientStore.getState().statusByWorkspace.get('/workspace/a')).toBe(
      'stopped',
    );
  });

  it('spawn failure flips the status to error and removes the client', async () => {
    // Override the mock to reject.
    const { lspRunStdio } = await import('@/ipc/lsp');
    const originalImpl = (
      lspRunStdio as unknown as { getMockImplementation: () => unknown }
    ).getMockImplementation();
    (lspRunStdio as unknown as { mockImplementation: (fn: () => Promise<unknown>) => void }).mockImplementation(
      () => Promise.reject(new Error('command not found')),
    );
    try {
      await expect(
        useLspClientStore.getState().getOrCreate('/workspace/b'),
      ).rejects.toThrow();
      expect(useLspClientStore.getState().clients.has('/workspace/b')).toBe(false);
      expect(useLspClientStore.getState().statusByWorkspace.get('/workspace/b')).toBe(
        'error',
      );
    } finally {
      // Restore the factory default so the
      // `mockImplementation` override doesn't
      // leak into subsequent tests.
      if (originalImpl) {
        (lspRunStdio as unknown as { mockImplementation: (fn: unknown) => void }).mockImplementation(
          originalImpl as () => Promise<unknown>,
        );
      }
    }
  });

  // --- Phase 9.5 — crash recovery (T2#2) ---

  /**
   * Helper: fire a synthetic `lsp://crashed`
   * event with the given handle + payload.
   * Pushes the event into every registered
   * crash listener (the store subscribes
   * exactly one in `getOrCreate`).
   */
  function fireCrash(payload: {
    handleId: string;
    exitStatus: number | null;
    stderrTail: string;
  }): void {
    for (const l of crashListeners) l(payload);
  }

  it('lsp://crashed event flips status to error and populates crash info', async () => {
    const client = await useLspClientStore
      .getState()
      .getOrCreate('/workspace/crash-1');
    expect(client.handleId).toBe('mock_handle_1');
    // The store subscribed to onLspCrashed
    // during getOrCreate but the
    // subscription is asynchronous (the
    // Tauri event API returns a Promise).
    // Wait for the listener to be
    // registered before firing the
    // synthetic crash.
    await waitForCrashListener();
    fireCrash({
      handleId: 'mock_handle_1',
      exitStatus: 139,
      stderrTail: 'panic at typescript: out of memory',
    });
    const state = useLspClientStore.getState();
    expect(state.statusByWorkspace.get('/workspace/crash-1')).toBe('error');
    const info = state.crashByWorkspace.get('/workspace/crash-1');
    expect(info).toBeDefined();
    expect(info?.exitStatus).toBe(139);
    expect(info?.stderrTail).toBe('panic at typescript: out of memory');
    expect(info?.consecutiveCrashes).toBe(1);
  });

  it('crash event schedules an auto-respawn with exponential backoff (1s for first crash)', async () => {
    await useLspClientStore.getState().getOrCreate('/workspace/crash-2');
    await waitForCrashListener();
    fireCrash({
      handleId: 'mock_handle_1',
      exitStatus: null,
      stderrTail: 'killed by signal',
    });
    const info = useLspClientStore
      .getState()
      .crashByWorkspace.get('/workspace/crash-2');
    expect(info).toBeDefined();
    // First crash on the backoff ladder
    // is 1s (the smallest step). The
    // store sets `respawnInMs` to the
    // current backoff delay so the UI
    // can render a countdown.
    expect(info?.respawnInMs).toBe(1_000);
  });

  it('auto-respawn cancels when the kill switch is OFF', async () => {
    // The kill switch is OFF. Even on a
    // crash, the store must NOT schedule a
    // respawn (the user has explicitly
    // disabled the LSP integration for this
    // session).
    localStorage.setItem('lipi:lsp:useRealServer:v1', 'false');
    await useLspClientStore.getState().getOrCreate('/workspace/crash-3');
    await waitForCrashListener();
    fireCrash({
      handleId: 'mock_handle_1',
      exitStatus: 1,
      stderrTail: '',
    });
    const state = useLspClientStore.getState();
    // Status is still `error` (the crash
    // happened) but no respawn is
    // scheduled.
    expect(state.statusByWorkspace.get('/workspace/crash-3')).toBe('error');
    const info = state.crashByWorkspace.get('/workspace/crash-3');
    expect(info).toBeDefined();
    expect(info?.respawnInMs).toBeNull();
  });

  it('dispose cancels a pending auto-respawn (no zombie respawn after workspace close)', async () => {
    await useLspClientStore.getState().getOrCreate('/workspace/crash-4');
    await waitForCrashListener();
    fireCrash({
      handleId: 'mock_handle_1',
      exitStatus: 1,
      stderrTail: 'panic',
    });
    // Workspace is closed before the
    // 1s backoff fires.
    await useLspClientStore.getState().dispose('/workspace/crash-4');
    // After dispose, crash info is wiped
    // (so the settings card doesn't show
    // a stale "crashed" badge for a
    // workspace the user closed).
    expect(
      useLspClientStore.getState().crashByWorkspace.has('/workspace/crash-4'),
    ).toBe(false);
    // Wait past the 1s backoff to confirm
    // no respawn happened. We use a real
    // `setTimeout` (not `vi.useFakeTimers`)
    // because the LspClient's reader loop
    // uses `setTimeout` too — faking
    // timers would freeze the reader and
    // cause the test to hang on
    // `getOrCreate`.
    await new Promise((r) => setTimeout(r, 1_500));
    // The crashed client was disposed, so
    // no auto-respawn should have created
    // a new client for this workspace.
    expect(
      useLspClientStore.getState().clients.has('/workspace/crash-4'),
    ).toBe(false);
  });

  it('respawn action creates a fresh client and resets crash info', async () => {
    await useLspClientStore.getState().getOrCreate('/workspace/crash-5');
    await waitForCrashListener();
    fireCrash({
      handleId: 'mock_handle_1',
      exitStatus: 1,
      stderrTail: 'old crash',
    });
    // `respawn` is the manual restart path.
    // It disposes the dead client + starts
    // a new one. The new client gets a
    // new `handleId` (mock_handle_2).
    await useLspClientStore.getState().respawn('/workspace/crash-5');
    const state = useLspClientStore.getState();
    // Fresh client in the map.
    const fresh = state.clients.get('/workspace/crash-5');
    expect(fresh).toBeDefined();
    expect(fresh?.handleId).toBe('mock_handle_2');
    // The status is `ready` (the new
    // client's `initialize` handshake
    // completed — the mock auto-replies
    // to `initialize`).
    expect(state.statusByWorkspace.get('/workspace/crash-5')).toBe('ready');
    // The crash info is cleared on a
    // successful respawn.
    expect(state.crashByWorkspace.has('/workspace/crash-5')).toBe(false);
  });

  it('crash event for an unknown handleId is ignored (stale event from a disposed workspace)', async () => {
    // The store has no client for
    // `/workspace/never-existed` and
    // receives a crash event for a
    // handle that was never registered.
    // The store should silently ignore
    // the event — it has no way to look
    // up the workspace, and racing a
    // crash event for a long-disposed
    // workspace would be a spurious
    // status flip.
    expect(crashListeners.length).toBe(0);
    // First, subscribe via getOrCreate on a
    // different workspace.
    await useLspClientStore.getState().getOrCreate('/workspace/other');
    await waitForCrashListener();
    expect(crashListeners.length).toBe(1);
    // Now fire a crash for a handle the
    // store doesn't know about.
    fireCrash({
      handleId: 'mock_handle_unknown',
      exitStatus: 1,
      stderrTail: 'orphan crash',
    });
    const state = useLspClientStore.getState();
    // `/workspace/other` is unaffected
    // (still `ready`).
    expect(state.statusByWorkspace.get('/workspace/other')).toBe('ready');
    // `/workspace/never-existed` has no
    // crash info and no client.
    expect(state.clients.has('/workspace/never-existed')).toBe(false);
    expect(state.crashByWorkspace.has('/workspace/never-existed')).toBe(false);
  });

  it('consecutive crashes escalate the backoff and stop auto-respawning after the cap', async () => {
    // The crash handler reads the previous
    // crash from `crashByWorkspace` to pick
    // the next backoff step. We test the
    // escalation by firing multiple crash
    // events against the *same* handleId —
    // the counter lives in `crashByWorkspace`,
    // not in the client. The auto-respawn
    // timer itself is never awaited (it
    // would take 30+ s of real time).
    await useLspClientStore.getState().getOrCreate('/workspace/crash-6');
    await waitForCrashListener();
    // First crash: 1s.
    fireCrash({
      handleId: 'mock_handle_1',
      exitStatus: 1,
      stderrTail: 'crash 1',
    });
    expect(
      useLspClientStore
        .getState()
        .crashByWorkspace.get('/workspace/crash-6')?.respawnInMs,
    ).toBe(1_000);
    // Second crash (same handleId — the
    // counter lives in `crashByWorkspace`):
    // 2s.
    fireCrash({
      handleId: 'mock_handle_1',
      exitStatus: 1,
      stderrTail: 'crash 2',
    });
    expect(
      useLspClientStore
        .getState()
        .crashByWorkspace.get('/workspace/crash-6')?.respawnInMs,
    ).toBe(2_000);
    // Third crash: 4s.
    fireCrash({
      handleId: 'mock_handle_1',
      exitStatus: 1,
      stderrTail: 'crash 3',
    });
    expect(
      useLspClientStore
        .getState()
        .crashByWorkspace.get('/workspace/crash-6')?.respawnInMs,
    ).toBe(4_000);
    // Fourth: 8s.
    fireCrash({
      handleId: 'mock_handle_1',
      exitStatus: 1,
      stderrTail: 'crash 4',
    });
    expect(
      useLspClientStore
        .getState()
        .crashByWorkspace.get('/workspace/crash-6')?.respawnInMs,
    ).toBe(8_000);
    // Fifth: cap reached (30s) — no more
    // auto-respawn.
    fireCrash({
      handleId: 'mock_handle_1',
      exitStatus: 1,
      stderrTail: 'crash 5',
    });
    expect(
      useLspClientStore
        .getState()
        .crashByWorkspace.get('/workspace/crash-6')?.respawnInMs,
    ).toBeNull();
  });
});

/**
 * Wait for the store to have registered a
 * crash listener. The store subscribes via
 * `onLspCrashed` inside `getOrCreate`, but the
 * subscription is an async Promise. Tests
 * that fire synthetic `lsp://crashed` events
 * immediately after `getOrCreate` would
 * otherwise race the listener registration
 * and lose the event.
 */
async function waitForCrashListener(): Promise<void> {
  for (let i = 0; i < 50 && crashListeners.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  if (crashListeners.length === 0) {
    throw new Error(
      'crash listener was never registered by useLspClientStore.getOrCreate()',
    );
  }
}
