/**
 * lspClientStore — Zustand store + LspClient class for
 * the Phase 9 (Tiniest scope) real `typescript-language-server`
 * integration.
 *
 * Owns one `LspClient` per workspace (keyed by the
 * workspace's absolute path; the same workspace reopened
 * in a new tab reuses the running server). The
 * `LspClient` itself is a plain TS class that:
 *
 *   1. Spawns the child process via `lspRunStdio`
 *      (the `lsp_run_stdio` Tauri command)
 *   2. Runs a reader loop that calls `lspStdioRead` in
 *      a tight async loop, accumulates bytes, finds
 *      `Content-Length: N\r\n\r\n` header boundaries,
 *      extracts the JSON-RPC body, parses it, and
 *      pushes the parsed message into a per-serverId
 *      message queue
 *   3. Holds a `Map<requestId, { resolve, reject, method }>`
 *      for in-flight requests
 *   4. Exposes a `Transport` (the `monaco-languageclient`
 *      `MessageReader` / `MessageWriter` shape) that
 *      reads from the message queue and writes via
 *      `lspStdioWrite`
 *
 * The Zustand store exposes `getOrCreate(workspaceRoot)`,
 * `dispose(workspaceRoot)`, and `statusByWorkspace` so
 * the settings card can subscribe to the per-workspace
 * status (Stopped / Starting / Ready / Error) without
 * owning a `LspClient` directly.
 *
 * Per Rule 3 (screen-folder layout) this lives in
 * `src/screens/EditorWorkspace/state/`, not in
 * `src/shared/state/`. Only EditorWorkspace's bridge
 * hook (which creates the `MonacoLanguageClient`) and
 * the settings card read it.
 *
 * Per Rule 6 (section isolation), the JSON-RPC framing
 * lives entirely in the `LspClient` class — neither the
 * store nor the bridge hook ever sees a `Content-Length`
 * byte sequence.
 */

import { create } from 'zustand';
import {
  lspRunStdio,
  lspStdioRead,
  lspStdioWrite,
  lspStdioClose,
  type RunStdioResult,
} from '@/ipc/lsp';

/**
 * The lifecycle status of an LSP server for a given
 * workspace. The settings card subscribes to this
 * slice of state.
 *
 *   - `stopped`: no `LspClient` exists for this workspace
 *   - `starting`: the child process is spawned but the
 *     `initialize` handshake hasn't completed
 *   - `ready`: the server has responded to `initialize`
 *     and the `initialized` notification has been sent
 *   - `error`: the child died, the spawn failed, or the
 *     `initialize` request timed out
 */
export type LspStatus = 'stopped' | 'starting' | 'ready' | 'error';

/**
 * A JSON-RPC 2.0 message — request, response, or
 * notification. The LSP wire shape (and what
 * `monaco-languageclient` consumes) is:
 *
 *   - Request:     `{ jsonrpc: '2.0', id: number|string, method: string, params?: unknown }`
 *   - Response:    `{ jsonrpc: '2.0', id: number|string, result?: unknown, error?: { code, message, data? } }`
 *   - Notification: `{ jsonrpc: '2.0', method: string, params?: unknown }`  (no `id`)
 */
export type JsonRpcMessage =
  | {
      jsonrpc: '2.0';
      id: number | string;
      method: string;
      params?: unknown;
    }
  | {
      jsonrpc: '2.0';
      id: number | string;
      result?: unknown;
      error?: { code: number; message: string; data?: unknown };
    }
  | {
      jsonrpc: '2.0';
      method: string;
      params?: unknown;
    };

/**
 * A pending in-flight request. The `LspClient` stores
 * `{ resolve, reject, method }` keyed by the request's
 * `id`; when the matching `JsonRpcMessage` response
 * arrives, the resolver is called.
 */
interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  method: string;
}

/**
 * The wire shape that `monaco-languageclient` consumes
 * for its `Transport` constructor. We don't depend on
 * the package's types at this layer to keep the store
 * free of `monaco` and `monaco-languageclient` imports
 * (so the store can be unit-tested in jsdom without
 * monaco loaded).
 */
export interface LspTransport {
  /**
   * Read the next message from the transport.
   * Returns `null` when the transport is closed
   * (child exited, LspClient disposed).
   */
  read(): Promise<JsonRpcMessage | null>;
  /**
   * Write a message to the transport (frames it with
   * the LSP `Content-Length` header + UTF-8 body and
   * writes via `lspStdioWrite`).
   */
  write(message: JsonRpcMessage): Promise<void>;
  /**
   * Close the transport (calls `lspStdioClose` on
   * the handle).
   */
  close(): Promise<void>;
}

/**
 * Generate a monotonic request id. The LSP spec
 * requires `id` to be a string or integer that
 * doesn't collide with any in-flight request. We use
 * a simple counter so consecutive requests get
 * `id: 1`, `id: 2`, etc. — readable in
 * `tsserver.log` for debugging.
 */
let _nextRequestId = 1;
function nextRequestId(): number {
  return _nextRequestId++;
}

/**
 * One live LSP server for a workspace. The
 * `LspClient` owns the child process handle, the
 * message queue, the in-flight request map, and the
 * `Transport` that `monaco-languageclient` drives.
 *
 * Lifecycle:
 *   1. `new LspClient({ workspaceRoot })` — pure
 *      constructor, doesn't touch the network
 *   2. `await client.start()` — spawns the child,
 *      runs the reader loop, sends `initialize`,
 *      awaits the response, sends `initialized`,
 *      transitions to `ready`
 *   3. `client.transport.read() / .write() / .close()`
 *      — driven by `monaco-languageclient` via the
 *      bridge hook
 *   4. `await client.shutdown()` — sends `shutdown`
 *      + `exit` JSON-RPC messages, awaits the
 *      `exit` notification, closes the handle
 */
export class LspClient {
  /** The workspace this client serves. Used to
   *  scope `tsconfig.json` discovery in the
   *  `initialize` params. */
  readonly workspaceRoot: string;

  /** The Tauri-side `handleId` for the child
   *  process. `null` until `start()` completes
   *  the spawn. */
  handleId: string | null = null;

  /** The child process's PID (or `null` if the
   *  spawn failed). Useful for the settings
   *  card's "Server: <pid>" status line. */
  resolvedCommand: string | null = null;

  /** The current status. Subscribed by the
   *  settings card. */
  private _status: LspStatus = 'stopped';

  /** Listeners that get called on every status
   *  change. The store subscribes the LspClient
   *  so the Zustand `statusByWorkspace` map stays
   *  in sync. */
  private _statusListeners: Set<(s: LspStatus) => void> = new Set();

  /** The reader loop's `setInterval` handle.
   *  Polled via `lspStdioRead` every 1-2ms. */
  private _readerTimer: ReturnType<typeof setTimeout> | null = null;

  /** The accumulated bytes the reader has read
   *  from the child but not yet framed into a
   *  JSON-RPC message. */
  private _readBuffer: Uint8Array = new Uint8Array(0);

  /** Per-handle message queue. The reader loop
   *  pushes parsed messages; the transport's
   *  `read()` consumes them. */
  private _messageQueue: JsonRpcMessage[] = [];

  /** Waiters for the next message (for the case
   *  where `read()` is called when the queue is
   *  empty). */
  private _messageWaiters: Array<(msg: JsonRpcMessage | null) => void> = [];

  /** In-flight request map. Keyed by request id. */
  private _pending: Map<number | string, PendingRequest> = new Map();

  /** `true` after `close()` has been called.
   *  The reader loop checks this to stop
   *  polling. */
  private _closed = false;

  /** The server's `InitializeResult` from the
   *  `initialize` handshake. `null` until the
   *  handshake completes. */
  initializeResult: {
    capabilities: Record<string, unknown>;
    serverInfo?: { name: string; version?: string };
  } | null = null;

  /** The `Transport` view for `monaco-languageclient`.
   *  Same object for the lifetime of the
   *  client; methods close over `this`. */
  readonly transport: LspTransport;

  constructor(opts: { workspaceRoot: string }) {
    this.workspaceRoot = opts.workspaceRoot;
    this.transport = {
      read: () => this._transportRead(),
      write: (msg) => this._transportWrite(msg),
      close: () => this._transportClose(),
    };
  }

  /** Get the current status. */
  get status(): LspStatus {
    return this._status;
  }

  /** Subscribe to status changes. Returns an
   *  unlisten function. */
  onStatusChange(cb: (s: LspStatus) => void): () => void {
    this._statusListeners.add(cb);
    return () => {
      this._statusListeners.delete(cb);
    };
  }

  private _setStatus(s: LspStatus): void {
    if (this._status === s) return;
    this._status = s;
    for (const l of this._statusListeners) l(s);
  }

  /**
   * Spawn the child process, run the reader loop,
   * send `initialize`, await the response, send
   * `initialized`. Resolves with the
   * `InitializeResult` on success; rejects with
   * an `Error` on spawn failure or `initialize`
   * timeout.
   */
  async start(): Promise<NonNullable<LspClient['initializeResult']>> {
    this._setStatus('starting');
    let spawn: RunStdioResult;
    try {
      spawn = await lspRunStdio({
        command: 'typescript-language-server',
        args: ['--stdio'],
        cwd: this.workspaceRoot,
      });
    } catch (e) {
      this._setStatus('error');
      throw new Error(
        `Failed to spawn typescript-language-server: ${(e as Error).message}. ` +
          `Install with: npm install -g typescript-language-server`,
      );
    }
    this.handleId = spawn.handleId;
    this.resolvedCommand = spawn.resolvedCommand;

    // Start the reader loop. The loop reads bytes
    // via `lspStdioRead`, accumulates them in
    // `_readBuffer`, finds `Content-Length: N`
    // header boundaries, extracts the body, parses
    // it as JSON, and pushes the message into
    // `_messageQueue` (or resolves a pending
    // request's promise).
    this._scheduleReaderTick();

    // Send `initialize`. The server's response
    // is captured by the reader loop (which
    // resolves our pending request).
    const initResult = await this._request<{
      capabilities: Record<string, unknown>;
      serverInfo?: { name: string; version?: string };
    }>('initialize', {
      processId: null,
      clientInfo: { name: 'lipi', version: '0.0.2' },
      rootUri: pathToFileUri(this.workspaceRoot),
      capabilities: {
        // The client capabilities we advertise.
        // `monaco-languageclient` merges its own
        // capabilities on top of these via the
        // bridge hook; we just need the bare
        // minimum for the handshake to complete.
        workspace: {
          configuration: false,
          workspaceFolders: false,
        },
        textDocument: {
          synchronization: {
            dynamicRegistration: false,
            willSave: false,
            willSaveWaitUntil: false,
            didSave: false,
          },
          completion: {
            dynamicRegistration: false,
            completionItem: {
              snippetSupport: false,
              commitCharactersSupport: false,
              documentationFormat: ['markdown', 'plaintext'],
              deprecatedSupport: true,
              preselectSupport: false,
            },
            contextSupport: true,
          },
          hover: {
            dynamicRegistration: false,
            contentFormat: ['markdown', 'plaintext'],
          },
          signatureHelp: {
            dynamicRegistration: false,
            signatureInformation: {
              documentationFormat: ['markdown', 'plaintext'],
              parameterInformation: { labelOffsetSupport: true },
              activeParameterSupport: true,
            },
          },
          definition: { dynamicRegistration: false, linkSupport: true },
          references: { dynamicRegistration: false },
          documentHighlight: { dynamicRegistration: false },
          documentSymbol: {
            dynamicRegistration: false,
            symbolKind: { valueSet: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26] },
            hierarchicalDocumentSymbolSupport: true,
          },
          codeAction: { dynamicRegistration: false },
          rename: { dynamicRegistration: false, prepareSupport: true },
          implementation: { dynamicRegistration: false, linkSupport: true },
          typeDefinition: { dynamicRegistration: false, linkSupport: true },
          inlayHint: { dynamicRegistration: false },
        },
      },
      initializationOptions: {
        // The TS server reads these from the
        // `tsserver.log` location + the
        // `preferences` for inlay hints. We
        // pass an empty object; the workspace's
        // `tsconfig.json` is the source of
        // truth for everything else.
        preferences: {},
      },
      workspaceFolders: null,
      trace: 'off',
    });

    this.initializeResult = initResult;

    // Send `initialized` notification (no response
    // expected). The `initialized` notification is
    // the LSP spec's "the client is now ready for
    // normal traffic" signal.
    await this._notify('initialized', {});

    this._setStatus('ready');
    return initResult;
  }

  /**
   * Send a request and await the response. Used
   * internally for the `initialize` handshake and
   * exposed for the bridge hook to call
   * `textDocument/definition`, `textDocument/
   * references`, etc.
   */
  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    return this._request<T>(method, params);
  }

  /**
   * Send a notification (no response expected).
   * Used internally for `initialized` /
   * `exit` / `textDocument/didOpen` /
   * `textDocument/didChange` /
   * `textDocument/didClose`.
   */
  async notify(method: string, params?: unknown): Promise<void> {
    return this._notify(method, params);
  }

  private async _request<T = unknown>(
    method: string,
    params?: unknown,
  ): Promise<T> {
    if (!this.handleId) {
      throw new Error('LspClient not started');
    }
    const id = nextRequestId();
    const message: JsonRpcMessage = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };
    const promise = new Promise<T>((resolve, reject) => {
      this._pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        method,
      });
    });
    await this._transportWrite(message);
    return promise;
  }

  private async _notify(method: string, params?: unknown): Promise<void> {
    if (!this.handleId) return;
    const message: JsonRpcMessage = {
      jsonrpc: '2.0',
      method,
      params,
    };
    await this._transportWrite(message);
  }

  /**
   * The transport's `read()` implementation.
   * Returns the next parsed message, waiting if
   * the queue is empty. Returns `null` when the
   * client is closed.
   */
  private _transportRead(): Promise<JsonRpcMessage | null> {
    if (this._messageQueue.length > 0) {
      return Promise.resolve(this._messageQueue.shift() ?? null);
    }
    if (this._closed) {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      this._messageWaiters.push(resolve);
    });
  }

  /**
   * The transport's `write()` implementation.
   * Frames the message with the LSP
   * `Content-Length: N\r\n\r\n<body>` header
   * and writes via `lspStdioWrite`.
   */
  private async _transportWrite(message: JsonRpcMessage): Promise<void> {
    if (!this.handleId) {
      throw new Error('LspClient not started');
    }
    const body = JSON.stringify(message);
    const bodyBytes = new TextEncoder().encode(body);
    const header = `Content-Length: ${bodyBytes.byteLength}\r\n\r\n`;
    const headerBytes = new TextEncoder().encode(header);
    const frame = new Uint8Array(headerBytes.byteLength + bodyBytes.byteLength);
    frame.set(headerBytes, 0);
    frame.set(bodyBytes, headerBytes.byteLength);
    await lspStdioWrite(this.handleId, frame);
  }

  private async _transportClose(): Promise<void> {
    await this.shutdown();
  }

  /**
   * Send `shutdown` + `exit` and close the
   * handle. Idempotent.
   */
  async shutdown(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
    if (this._readerTimer !== null) {
      clearTimeout(this._readerTimer);
      this._readerTimer = null;
    }
    // Reject all in-flight requests.
    for (const [, pending] of this._pending) {
      pending.reject(new Error('LspClient closed'));
    }
    this._pending.clear();
    // Wake up any read() waiters with `null`.
    for (const waiter of this._messageWaiters) waiter(null);
    this._messageWaiters = [];
    // Send `shutdown` + `exit` (best-effort —
    // the child may already be dead).
    if (this.handleId) {
      try {
        await this._request('shutdown', null);
      } catch {
        // ignore
      }
      try {
        await this._notify('exit', null);
      } catch {
        // ignore
      }
      try {
        await lspStdioClose(this.handleId);
      } catch {
        // ignore
      }
    }
    this._setStatus('stopped');
  }

  /**
   * Schedule the next reader poll. We use
   * `setTimeout` (not `setInterval`) so a slow
   * `lspStdioRead` call naturally defers the
   * next tick.
   */
  private _scheduleReaderTick(): void {
    if (this._closed) return;
    this._readerTimer = setTimeout(() => {
      this._readerTimer = null;
      void this._readerTick();
    }, 1);
  }

  private async _readerTick(): Promise<void> {
    if (this._closed) return;
    if (!this.handleId) {
      this._scheduleReaderTick();
      return;
    }
    try {
      const bytes = await lspStdioRead(this.handleId, 65536);
      if (bytes.length > 0) {
        // 0xFF is the sentinel the Rust side
        // emits when the child has exited and
        // the buffer is empty.
        const isSentinel = bytes.length === 1 && bytes[0] === 0xff;
        if (!isSentinel) {
          this._appendBytes(bytes);
          this._drainFrames();
        }
      }
    } catch {
      // Read error — child probably died.
      this._setStatus('error');
      this._closed = true;
      for (const [, pending] of this._pending) {
        pending.reject(new Error('LspClient read error'));
      }
      this._pending.clear();
      for (const waiter of this._messageWaiters) waiter(null);
      this._messageWaiters = [];
      return;
    }
    this._scheduleReaderTick();
  }

  private _appendBytes(bytes: Uint8Array): void {
    const next = new Uint8Array(this._readBuffer.byteLength + bytes.byteLength);
    next.set(this._readBuffer, 0);
    next.set(bytes, this._readBuffer.byteLength);
    this._readBuffer = next;
  }

  private _drainFrames(): void {
    // LSP framing: `Content-Length: N\r\n\r\n<body>`
    // Loop until we don't have a full frame.
    const HEADER_TERMINATOR = new Uint8Array([0x0d, 0x0a, 0x0d, 0x0a]); // \r\n\r\n
    while (true) {
      const termIdx = indexOf(this._readBuffer, HEADER_TERMINATOR);
      if (termIdx < 0) return;
      const headerBytes = this._readBuffer.slice(0, termIdx);
      const headerStr = new TextDecoder('utf-8', { fatal: false }).decode(headerBytes);
      const match = /Content-Length:\s*(\d+)/i.exec(headerStr);
      if (!match) {
        // Malformed frame — drop the header and
        // try to recover (skip until the next
        // \r\n\r\n). This shouldn't happen in
        // practice; it's a defence-in-depth
        // measure for a misbehaving server.
        this._readBuffer = this._readBuffer.slice(termIdx + HEADER_TERMINATOR.byteLength);
        continue;
      }
      const bodyLength = parseInt(match[1]!, 10);
      const bodyStart = termIdx + HEADER_TERMINATOR.byteLength;
      if (this._readBuffer.byteLength < bodyStart + bodyLength) {
        // Not enough bytes yet — wait for the
        // next tick.
        return;
      }
      const bodyBytes = this._readBuffer.slice(bodyStart, bodyStart + bodyLength);
      this._readBuffer = this._readBuffer.slice(bodyStart + bodyLength);
      let message: JsonRpcMessage;
      try {
        message = JSON.parse(new TextDecoder('utf-8').decode(bodyBytes));
      } catch (e) {
        // Malformed JSON — drop the frame and
        // continue.
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.warn('[lsp] malformed JSON frame:', e);
        }
        continue;
      }
      // eslint-disable-next-line no-console
      console.log('[lsp] dispatched message id:', (message as { id?: unknown }).id);
      this._dispatchMessage(message);
    }
  }

  private _dispatchMessage(message: JsonRpcMessage): void {
    // Response to an in-flight request?
    if ('id' in message && (message as { result?: unknown }).result !== undefined || 'error' in message) {
      const id = (message as { id: number | string }).id;
      const pending = this._pending.get(id);
      if (pending) {
        this._pending.delete(id);
        if ('error' in message && message.error) {
          const errMsg = message.error;
          pending.reject(new Error(`LSP ${pending.method} failed: ${errMsg.message}`));
        } else {
          pending.resolve((message as { result: unknown }).result);
        }
        return;
      }
    }
    // Request or notification from the server —
    // push to the queue for the bridge hook to
    // handle.
    this._messageQueue.push(message);
    if (this._messageWaiters.length > 0) {
      const waiter = this._messageWaiters.shift()!;
      waiter(message);
    }
  }
}

/**
 * Find the first occurrence of `needle` in `haystack`.
 * Returns -1 if not found.
 */
function indexOf(haystack: Uint8Array, needle: Uint8Array): number {
  if (needle.byteLength === 0) return 0;
  outer: for (let i = 0; i <= haystack.byteLength - needle.byteLength; i++) {
    for (let j = 0; j < needle.byteLength; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * Convert an absolute path to a `file://` URI. The
 * LSP `rootUri` parameter requires a URI, not a
 * plain path.
 */
function pathToFileUri(absolutePath: string): string {
  // Normalise Windows backslashes to forward slashes
  // and URL-encode the path components.
  const normalised = absolutePath.replace(/\\/g, '/');
  const encoded = normalised
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  // On Windows, the path starts with a drive letter
  // like `C:/...` — the URI form is
  // `file:///C:/...`.
  if (/^[A-Za-z]:/.test(encoded)) {
    return `file:///${encoded}`;
  }
  return `file://${encoded}`;
}

// ----------------------------------------------------------------------
// Zustand store
// ----------------------------------------------------------------------

interface LspClientStoreState {
  /**
   * One LspClient per workspace. Keyed by the
   * absolute workspace root path.
   */
  clients: Map<string, LspClient>;

  /**
   * The per-workspace status. Mirrored from
   * `LspClient.status` so React components can
   * subscribe to it without owning a `LspClient`
   * directly.
   */
  statusByWorkspace: Map<string, LspStatus>;

  /**
   * Get the existing LspClient for a workspace,
   * or create a new one (and start it
   * asynchronously). The first call to
   * `getOrCreate` for a workspace spawns the
   * child; subsequent calls return the same
   * client.
   */
  getOrCreate(workspaceRoot: string): Promise<LspClient>;

  /**
   * Dispose the LspClient for a workspace.
   * Sends `shutdown` + `exit`, closes the
   * handle, removes the client from the map.
   */
  dispose(workspaceRoot: string): Promise<void>;
}

export const useLspClientStore = create<LspClientStoreState>((set, get) => {
  // Track the in-flight `start()` promise per
  // workspace so concurrent `getOrCreate` calls
  // (e.g. a fast workspace switch that mounts
  // and unmounts the bridge) share a single
  // spawn.
  const startPromises: Map<string, Promise<LspClient>> = new Map();

  return {
    clients: new Map(),
    statusByWorkspace: new Map(),

    async getOrCreate(workspaceRoot) {
      const existing = get().clients.get(workspaceRoot);
      if (existing) return existing;
      const inflight = startPromises.get(workspaceRoot);
      if (inflight) return inflight;

      const client = new LspClient({ workspaceRoot });
      // Mirror status changes into the store
      // before `start()` is called (so the
      // status is `starting` from the moment
      // we begin).
      client.onStatusChange((s) => {
        set((state) => {
          const next = new Map(state.statusByWorkspace);
          next.set(workspaceRoot, s);
          return { statusByWorkspace: next };
        });
      });
      set((state) => {
        const nextClients = new Map(state.clients);
        nextClients.set(workspaceRoot, client);
        const nextStatus = new Map(state.statusByWorkspace);
        nextStatus.set(workspaceRoot, client.status);
        return {
          clients: nextClients,
          statusByWorkspace: nextStatus,
        };
      });

      const promise = (async () => {
        try {
          await client.start();
          return client;
        } catch (e) {
          // Spawn or initialize failed —
          // remove the client from the map
          // so the user can retry via
          // `dispose` + `getOrCreate`.
          set((state) => {
            const nextClients = new Map(state.clients);
            nextClients.delete(workspaceRoot);
            const nextStatus = new Map(state.statusByWorkspace);
            nextStatus.set(workspaceRoot, 'error');
            return {
              clients: nextClients,
              statusByWorkspace: nextStatus,
            };
          });
          throw e;
        } finally {
          startPromises.delete(workspaceRoot);
        }
      })();
      startPromises.set(workspaceRoot, promise);
      return promise;
    },

    async dispose(workspaceRoot) {
      const client = get().clients.get(workspaceRoot);
      if (!client) return;
      // Remove from the map FIRST so a concurrent
      // `getOrCreate` doesn't return this (now
      // being-shut-down) client.
      set((state) => {
        const nextClients = new Map(state.clients);
        nextClients.delete(workspaceRoot);
        const nextStatus = new Map(state.statusByWorkspace);
        nextStatus.set(workspaceRoot, 'stopped');
        return {
          clients: nextClients,
          statusByWorkspace: nextStatus,
        };
      });
      await client.shutdown();
    },
  };
});
