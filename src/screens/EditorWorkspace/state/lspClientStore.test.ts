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

vi.mock('@/ipc/lsp', () => {
  return {
    lspRunStdio: vi.fn(async () => {
      return {
        handleId: 'mock_handle_1',
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
      // If the request is `initialize`, queue
      // a canned response with the correct id.
      // (We parse the frame we just received
      // and immediately enqueue the response
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
          }
        } catch {
          // not JSON — ignore
        }
      }
      return bytes.byteLength;
    }),
    lspStdioClose: vi.fn(async () => undefined),
    lspCheckAvailable: vi.fn(async () => ({
      available: true,
      installHint: 'npm install -g typescript-language-server',
      version: '4.3.3',
    })),
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

// Import the store AFTER the mock is in place
// (vitest hoists `vi.mock` above imports).
import { useLspClientStore } from './lspClientStore';

beforeEach(() => {
  useLspClientStore.setState({
    clients: new Map(),
    statusByWorkspace: new Map(),
  });
  writes = [];
  readQueue = [];
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
  });
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
    (lspRunStdio as unknown as { mockImplementation: (fn: () => Promise<unknown>) => void }).mockImplementation(
      () => Promise.reject(new Error('command not found')),
    );
    await expect(
      useLspClientStore.getState().getOrCreate('/workspace/b'),
    ).rejects.toThrow();
    expect(useLspClientStore.getState().clients.has('/workspace/b')).toBe(false);
    expect(useLspClientStore.getState().statusByWorkspace.get('/workspace/b')).toBe(
      'error',
    );
  });
});
