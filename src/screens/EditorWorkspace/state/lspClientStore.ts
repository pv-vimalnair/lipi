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
  lspStdioReadStderrLog,
  onLspCrashed,
  onLspLog,
  type OnLspCrashedPayload,
  type OnLspLogPayload,
  type RunStdioResult,
} from '@/ipc/lsp';
import { getUseRealServer } from '@/screens/EditorWorkspace/state/lspKillSwitch';

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
 *     `initialize` request timed out. When the cause is
 *     a crash, `crashByWorkspace` has the details and
 *     an auto-respawn is scheduled.
 */
export type LspStatus = 'stopped' | 'starting' | 'ready' | 'error';

/**
 * Phase 9.5 — auto-respawn backoff schedule. When a
 * child crashes the store schedules a respawn on
 * this exponential ladder, capped at
 * `MAX_RESPAWN_BACKOFF_MS` (30s). After 5
 * consecutive crashes at the cap, the store gives
 * up and stops respawning (the user has to click
 * "Restart server" manually — useful when the
 * server is, e.g., a misconfigured
 * `typescript-language-server` that crashes on
 * startup).
 */
const RESPAWN_BACKOFF_STEPS_MS: readonly number[] = [
  1_000,   // 1s  — first crash
  2_000,   // 2s
  4_000,   // 4s
  8_000,   // 8s
  16_000,  // 16s
  30_000,  // 30s — cap
];
/** How many consecutive crashes at the cap before
 *  the store stops auto-respawning. */
const MAX_CONSECUTIVE_CRASHES = 5;

/** Per-workspace crash details. Set when an
 *  `lsp://crashed` event fires and the store
 *  flips the workspace's status to `error`.
 *  Cleared when a new client successfully
 *  transitions to `ready` (so the settings card
 *  doesn't keep showing a stale crash). */
export interface LspCrashInfo {
  /** Last 100 lines of server stderr (UTF-8 lossy). */
  stderrTail: string;
  /** Exit code if available, `null` if the child
   *  was killed by a signal. */
  exitStatus: number | null;
  /** Wall-clock time the crash was observed
   *  (ms since epoch). The settings card uses
   *  this to render a "Crashed 12s ago" line. */
  crashedAt: number;
  /** How many consecutive crashes this workspace
   *  has seen. Reset to 0 when a respawn
   *  succeeds. Backs off auto-respawn when it
   *  hits `MAX_CONSECUTIVE_CRASHES`. */
  consecutiveCrashes: number;
  /** How many milliseconds until the next
   *  auto-respawn, or `null` if no respawn is
   *  scheduled. The card uses this for its
   *  "Auto-restarting in Ns..." message. */
  respawnInMs: number | null;
}

/**
 * Phase 9.7 — the live "Server output" panel.
 * Backs the `LanguageServerCard`'s collapsible
 * section that shows the language server's
 * stderr stream in real time.
 *
 * The store accumulates *lines* (not raw
 * chunks) because the panel is a `<pre>` of
 * newline-separated text. The Rust reader
 * pushes raw chunks via the `lsp://log` event;
 * the store does the line-splitting (splitting
 * any chunk that ends mid-line, holding the
 * partial-line remainder in `partialLine` until
 * the next chunk arrives).
 *
 * The line buffer is bounded by `maxLines`
 * (default `LSP_OUTPUT_MAX_LINES`, 1000). When
 * a new line would push the buffer over the
 * cap, the oldest line is dropped — same
 * "newest wins" policy as the Rust ring
 * buffer. This bounds both memory and the
 * panel's render cost.
 */
export interface LspOutputEntry {
  /** Already-completed lines (newline-terminated
   *  chunks are split on arrival; partial-line
   *  tails are held in `partialLine` until the
   *  next chunk arrives). */
  lines: string[];
  /** A trailing fragment of the most recent
   *  chunk that didn't end in a newline. The
   *  panel renders this concatenated onto the
   *  last `lines` entry (or as a single line if
   *  `lines` is empty) so the user sees output
   *  as it streams. */
  partialLine: string;
  /** Wall-clock time the store last appended
   *  to this entry. The panel uses this for a
   *  "Last updated 2s ago" footer. */
  updatedAt: number;
  /** Configurable cap on `lines.length`.
   *  Defaults to `LSP_OUTPUT_MAX_LINES` (1000)
   *  but the settings card lets the user lower
   *  it (useful for slow machines where 1000
   *  rows of `<pre>` re-rendering stutters). */
  maxLines: number;
}

/** Default cap on `LspOutputEntry.lines.length`.
 *  Tuned for "the user is debugging a TS server
 *  issue" — 1000 lines is enough context for
 *  most panic messages + backtraces without
 *  freezing the settings card on each scroll. */
const LSP_OUTPUT_MAX_LINES = 1000;

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
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log('[lsp] start: initialize response received, id:', initResult);
    }

    // Send `initialized` notification (no response
    // expected). The `initialized` notification is
    // the LSP spec's "the client is now ready for
    // normal traffic" signal.
    await this._notify('initialized', {});
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log('[lsp] start: initialized sent');
    }

    this._setStatus('ready');
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log('[lsp] start: status set to ready');
    }
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
    // Send `shutdown` + `exit` (best-effort —
    // the child may already be dead).
    // We DON'T await these — the response
    // delivery depends on the reader loop,
    // which we're about to tear down. The
    // await would hang the caller (the
    // store's `dispose`, the bridge's
    // `useEffect` cleanup) forever in the
    // case where the child has already
    // exited (no response coming) or
    // where the reader is paused. Fire
    // the JSON-RPC messages and move on.
    if (this.handleId) {
      void this._request('shutdown', null).catch(() => {
        // ignore
      });
      void this._notify('exit', null).catch(() => {
        // ignore
      });
      void lspStdioClose(this.handleId).catch(() => {
        // ignore
      });
    }
    // Tear down the reader + reject any
    // in-flight requests + flip the
    // closed flag.
    if (this._readerTimer !== null) {
      clearTimeout(this._readerTimer);
      this._readerTimer = null;
    }
    for (const [, pending] of this._pending) {
      pending.reject(new Error('LspClient closed'));
    }
    this._pending.clear();
    // Wake up any read() waiters with `null`.
    for (const waiter of this._messageWaiters) waiter(null);
    this._messageWaiters = [];
    this._closed = true;
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
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log(
          '[lsp] dispatched message id:',
          (message as { id?: unknown }).id,
        );
      }
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
   * Per-workspace crash details. Set when an
   * `lsp://crashed` event fires; cleared when a
   * new client successfully transitions to
   * `ready` (or when the workspace is disposed).
   */
  crashByWorkspace: Map<string, LspCrashInfo>;

  /**
   * Phase 9.7 — per-workspace live server
   * output. Populated by the `lsp://log`
   * subscription; read by the
   * `LanguageServerCard`'s "Server output"
   * panel. Cleared on dispose and on a
   * successful restart (so a fresh child
   * starts with an empty panel).
   */
  lspOutputByWorkspace: Map<string, LspOutputEntry>;

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
   * handle, removes the client from the map,
   * and cancels any pending auto-respawn.
   */
  dispose(workspaceRoot: string): Promise<void>;

  /**
   * Force an immediate respawn of a workspace's
   * client. Cancels any pending auto-respawn,
   * disposes the current client, and starts a
   * fresh one. The settings card's "Restart
   * server" button calls this.
   *
   * The new client's `consecutiveCrashes`
   * counter is reset to 0 (a manual restart
   * is a "I know what I'm doing" signal — the
   * auto-respawn ladder is no longer
   * relevant).
   */
  respawn(workspaceRoot: string): Promise<void>;

  /**
   * Phase 9.7 — clear the per-workspace
   * "Server output" panel. The settings card's
   * `Clear` button calls this. Idempotent —
   * no-op if there's no entry.
   */
  clearLspOutput(workspaceRoot: string): void;

  /**
   * Test-only helper. Tears down the
   * closure-scoped state that
   * `setState` can't reach (pending
   * respawn timers, the handleId →
   * workspace map, the global crash
   * listener, the per-workspace
   * in-flight start-promise cache).
   * Exposed under the `__` prefix so
   * it's clear it's not part of the
   * public surface.
   */
  __resetLspClientStoreForTests(): void;
}

export const useLspClientStore = create<LspClientStoreState>((set, get) => {
  // Track the in-flight `start()` promise per
  // workspace so concurrent `getOrCreate` calls
  // (e.g. a fast workspace switch that mounts
  // and unmounts the bridge) share a single
  // spawn.
  const startPromises: Map<string, Promise<LspClient>> = new Map();

  // Reverse map: handleId → workspaceRoot. The
  // crash listener uses this to look up the
  // affected workspace when a `lsp://crashed`
  // event fires.
  const handleToWorkspace: Map<string, string> = new Map();

  // Pending auto-respawn timers, one per
  // workspace. Phase 9.5 — the store schedules
  // a respawn on a backoff ladder when a child
  // crashes; cancelling the timer (on dispose
  // or manual restart) prevents the respawn
  // from firing.
  const respawnTimers: Map<string, ReturnType<typeof setTimeout>> =
    new Map();

  // Module-level unlisten for the
  // `lsp://crashed` event listener. Stored at
  // store-construction time so it lives for
  // the lifetime of the app — only the test
  // suite resets it (via the
  // `__resetLspClientStoreForTests` helper
  // below).
  let crashUnlisten: (() => void) | null = null;

  // Phase 9.7 — same story for the `lsp://log`
  // event listener. One subscription per store
  // instance; torn down only by the test
  // suite's reset helper.
  let logUnlisten: (() => void) | null = null;

  /** Phase 9.7 — append a chunk of stderr text
   *  to the workspace's `LspOutputEntry`,
   *  splitting on `\n` and holding the trailing
   *  partial line. Trimmed to the entry's
   *  `maxLines` cap (FIFO eviction of oldest
   *  lines).
   *
   *  Pure: takes the previous entry, returns
   *  the next. Lets the caller wrap the result
   *  in a `set((state) => …)` so React/Zustand
   *  subscribers see a new Map reference and
   *  re-render.
   */
  function appendOutputChunk(
    prev: LspOutputEntry,
    chunk: string,
  ): LspOutputEntry {
    // Empty chunks (the reader can fire on a
    // 0-byte read in edge cases) are no-ops.
    if (chunk.length === 0) {
      return prev;
    }
    // Combine the previous partial line with
    // the new chunk, then split on `\n`.
    const combined = prev.partialLine + chunk;
    const parts = combined.split('\n');
    // `parts.pop()` is the trailing fragment
    // (possibly empty if the chunk ended in
    // `\n`). The rest are complete lines.
    const trailing = parts.pop() ?? '';
    const newLines = [...prev.lines, ...parts];
    // Trim to the cap, dropping the oldest
    // lines.
    if (newLines.length > prev.maxLines) {
      newLines.splice(0, newLines.length - prev.maxLines);
    }
    return {
      lines: newLines,
      partialLine: trailing,
      updatedAt: Date.now(),
      maxLines: prev.maxLines,
    };
  }

  /** Phase 9.7 — make an empty entry with the
   *  default `maxLines`. Used when the store
   *  first sees a workspace's handleId (e.g.
   *  on `getOrCreate` or on the first `lsp://log`
   *  event). */
  function makeEmptyOutputEntry(): LspOutputEntry {
    return {
      lines: [],
      partialLine: '',
      updatedAt: Date.now(),
      maxLines: LSP_OUTPUT_MAX_LINES,
    };
  }

  function clearRespawnTimer(workspaceRoot: string): void {
    const t = respawnTimers.get(workspaceRoot);
    if (t !== undefined) {
      clearTimeout(t);
      respawnTimers.delete(workspaceRoot);
    }
  }

  function scheduleRespawn(
    workspaceRoot: string,
    consecutiveCrashes: number,
  ): void {
    clearRespawnTimer(workspaceRoot);
    // Past the cap, give up auto-respawning.
    if (consecutiveCrashes >= MAX_CONSECUTIVE_CRASHES) {
      set((state) => {
        const next = new Map(state.crashByWorkspace);
        const prev = next.get(workspaceRoot);
        if (prev) {
          next.set(workspaceRoot, { ...prev, respawnInMs: null });
        }
        return { crashByWorkspace: next };
      });
      return;
    }
    const stepIndex = Math.min(
      consecutiveCrashes - 1,
      RESPAWN_BACKOFF_STEPS_MS.length - 1,
    );
    const delay = RESPAWN_BACKOFF_STEPS_MS[stepIndex]!;
    set((state) => {
      const next = new Map(state.crashByWorkspace);
      const prev = next.get(workspaceRoot);
      if (prev) {
        next.set(workspaceRoot, { ...prev, respawnInMs: delay });
      }
      return { crashByWorkspace: next };
    });
    const timer = setTimeout(() => {
      respawnTimers.delete(workspaceRoot);
      // Bail if the kill switch flipped off in
      // the interim (we don't want to respawn
      // a server the user just disabled).
      if (!getUseRealServer()) {
        return;
      }
      // The user may have closed the workspace
      // in the meantime; the map will be empty
      // for that workspace, so `getOrCreate`
      // will start a fresh one. We don't need
      // to check explicitly.
      void get()
        .respawn(workspaceRoot)
        .catch(() => {
          // `respawn` already routes failures
          // through the store's error path; this
          // catch just prevents an unhandled
          // promise rejection.
        });
    }, delay);
    respawnTimers.set(workspaceRoot, timer);
  }

  function onChildCrashed(payload: OnLspCrashedPayload): void {
    const workspaceRoot = handleToWorkspace.get(payload.handleId);
    if (!workspaceRoot) {
      // Stale crash event for a handle we've
      // already disposed. Ignore.
      return;
    }
    // Honour the kill switch: if the user
    // turned the LSP off, don't auto-respawn.
    const useReal = getUseRealServer();
    const prevCrash = get().crashByWorkspace.get(workspaceRoot);
    const consecutiveCrashes = (prevCrash?.consecutiveCrashes ?? 0) + 1;
    const info: LspCrashInfo = {
      stderrTail: payload.stderrTail,
      exitStatus: payload.exitStatus,
      crashedAt: Date.now(),
      consecutiveCrashes,
      respawnInMs: useReal ? null : null,
    };
    set((state) => {
      const nextStatus = new Map(state.statusByWorkspace);
      nextStatus.set(workspaceRoot, 'error');
      const nextCrash = new Map(state.crashByWorkspace);
      nextCrash.set(workspaceRoot, info);
      return {
        statusByWorkspace: nextStatus,
        crashByWorkspace: nextCrash,
      };
    });
    if (useReal) {
      scheduleRespawn(workspaceRoot, consecutiveCrashes);
    }
  }

  // Subscribe exactly once. Wrapped in a
  // function so the test suite can swap the
  // subscriber for a mock.
  function ensureCrashListener(): void {
    if (crashUnlisten) return;
    void onLspCrashed(onChildCrashed).then((un) => {
      crashUnlisten = un;
    });
  }

  // Phase 9.7 — `lsp://log` handler. Looks up
  // the workspace from the handleId, splits the
  // chunk into lines, and appends to the
  // per-workspace entry.
  function onLspLogReceived(payload: OnLspLogPayload): void {
    const workspaceRoot = handleToWorkspace.get(payload.handleId);
    if (!workspaceRoot) {
      // Stale log event for a handle we've
      // already disposed. Ignore.
      return;
    }
    set((state) => {
      const prev = state.lspOutputByWorkspace.get(workspaceRoot);
      // We always create the entry on first
      // log so the panel has something to
      // render (even if the child is producing
      // no output, the panel is still "live"
      // — the user sees a "waiting for output"
      // state).
      const entry = prev ?? makeEmptyOutputEntry();
      const next = appendOutputChunk(entry, payload.chunk);
      const nextMap = new Map(state.lspOutputByWorkspace);
      nextMap.set(workspaceRoot, next);
      return { lspOutputByWorkspace: nextMap };
    });
  }

  // Phase 9.7 — subscribe to `lsp://log`
  // exactly once per store instance. Wrapped
  // in a function so the test suite can swap
  // the subscriber for a mock.
  function ensureLogListener(): void {
    if (logUnlisten) return;
    void onLspLog(onLspLogReceived).then((un) => {
      logUnlisten = un;
    });
  }

  return {
    clients: new Map(),
    statusByWorkspace: new Map(),
    crashByWorkspace: new Map(),
    lspOutputByWorkspace: new Map(),

    async getOrCreate(workspaceRoot) {
      ensureCrashListener();
      ensureLogListener();
      const existing = get().clients.get(workspaceRoot);
      if (existing) return existing;
      // If a respawn is already scheduled for
      // this workspace, the user is opening a
      // tab that the store has already decided
      // to revive. Clear the timer so the
      // scheduled respawn doesn't double-fire
      // (it would race with the new client
      // we're about to start). The new
      // `getOrCreate` replaces the scheduled
      // restart with an immediate one.
      clearRespawnTimer(workspaceRoot);
      const inflight = startPromises.get(workspaceRoot);
      if (inflight) {
        // A `getOrCreate` for this workspace is
        // already in flight (or has just
        // resolved but hasn't been re-added to
        // the `clients` map after a `setState`
        // reset — common in tests). Wait for it
        // and re-add the client to the `clients`
        // map so the caller can find it again.
        const client = await inflight;
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
        return client;
      }

      const client = new LspClient({ workspaceRoot });
      // Mirror status changes into the store
      // before `start()` is called (so the
      // status is `starting` from the moment
      // we begin).
      client.onStatusChange((s) => {
        set((state) => {
          const next = new Map(state.statusByWorkspace);
          next.set(workspaceRoot, s);
          // On `ready`, clear any crash info —
          // the user is back online.
          if (s === 'ready') {
            const nextCrash = new Map(state.crashByWorkspace);
            nextCrash.delete(workspaceRoot);
            return {
              statusByWorkspace: next,
              crashByWorkspace: nextCrash,
            };
          }
          return { statusByWorkspace: next };
        });
      });
      set((state) => {
        const nextClients = new Map(state.clients);
        nextClients.set(workspaceRoot, client);
        const nextStatus = new Map(state.statusByWorkspace);
        nextStatus.set(workspaceRoot, client.status);
        // Successful start → drop any crash
        // info for this workspace.
        const nextCrash = new Map(state.crashByWorkspace);
        nextCrash.delete(workspaceRoot);
        return {
          clients: nextClients,
          statusByWorkspace: nextStatus,
          crashByWorkspace: nextCrash,
        };
      });

      const promise = (async () => {
        try {
          await client.start();
          // Register the new handle in the
          // reverse map AFTER the spawn
          // completes — the crash listener
          // looks up by handleId, so a crash
          // event for a still-spawning child
          // (none in practice — `start()`
          // awaits the spawn IPC) would
          // otherwise be lost.
          if (client.handleId) {
            handleToWorkspace.set(client.handleId, workspaceRoot);
            // Phase 9.7 — drain the Rust log
            // buffer ONCE on first registration
            // to catch up on any stderr the
            // child wrote before the JS side
            // subscribed to `lsp://log`. The
            // reader has been firing events
            // since the child spawned; without
            // this drain, those events are lost.
            // Best-effort: a failure here is
            // silently ignored (the log is
            // best-effort data, not critical).
            void lspStdioReadStderrLog(
              client.handleId,
              64 * 1024,
            )
              .then((bytes) => {
                if (bytes.length === 0) return;
                const chunk = new TextDecoder(
                  'utf-8',
                  { fatal: false },
                ).decode(bytes);
                set((state) => {
                  const prev =
                    state.lspOutputByWorkspace.get(workspaceRoot) ??
                    makeEmptyOutputEntry();
                  const next = appendOutputChunk(prev, chunk);
                  const nextMap = new Map(
                    state.lspOutputByWorkspace,
                  );
                  nextMap.set(workspaceRoot, next);
                  return {
                    lspOutputByWorkspace: nextMap,
                  };
                });
              })
              .catch(() => {
                // Best-effort: the buffer may
                // be empty (child just spawned,
                // no stderr yet) or the IPC may
                // fail (handle disposed in the
                // interim). Either way, the
                // subscription is the source of
                // truth going forward.
              });
          }
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
      // Cancel any pending respawn for this
      // workspace — disposing means the user
      // doesn't want this server anymore.
      clearRespawnTimer(workspaceRoot);
      // Clear the handleId → workspace map.
      if (client?.handleId) {
        handleToWorkspace.delete(client.handleId);
      }
      if (!client) return;
      // Remove from the map FIRST so a concurrent
      // `getOrCreate` doesn't return this (now
      // being-shut-down) client.
      set((state) => {
        const nextClients = new Map(state.clients);
        nextClients.delete(workspaceRoot);
        const nextStatus = new Map(state.statusByWorkspace);
        nextStatus.set(workspaceRoot, 'stopped');
        const nextCrash = new Map(state.crashByWorkspace);
        nextCrash.delete(workspaceRoot);
        // Phase 9.7 — drop the per-workspace
        // "Server output" entry. The child is
        // being shut down; its logs are no
        // longer relevant. A subsequent
        // `getOrCreate` will start a fresh
        // entry via the replay-drain in the
        // spawn path.
        const nextOutput = new Map(state.lspOutputByWorkspace);
        nextOutput.delete(workspaceRoot);
        return {
          clients: nextClients,
          statusByWorkspace: nextStatus,
          crashByWorkspace: nextCrash,
          lspOutputByWorkspace: nextOutput,
        };
      });
      // Clear the `startPromises` entry so a
      // subsequent `getOrCreate` for the same
      // workspace actually starts a fresh
      // client (the previous one is shutting
      // down — returning its (resolved)
      // promise would hand out a dead client).
      // The `finally` in `getOrCreate` clears
      // it on success/failure, but `dispose`
      // may be called from outside the
      // `getOrCreate` path (e.g. the bridge
      // `useEffect` cleanup on workspace
      // close) — so we clear it here too.
      startPromises.delete(workspaceRoot);
      await client.shutdown();
    },

    async respawn(workspaceRoot) {
      // Manual restart = "I know what I'm
      // doing". Drop the auto-respawn ladder.
      clearRespawnTimer(workspaceRoot);
      set((state) => {
        const nextCrash = new Map(state.crashByWorkspace);
        nextCrash.delete(workspaceRoot);
        // Phase 9.7 — also wipe the "Server
        // output" panel. The new child starts
        // with a clean log; showing the
        // previous child's output would be
        // confusing (and could be from a
        // different workspace root if the user
        // switched). The replay-drain in
        // `getOrCreate` will repopulate if
        // needed.
        const nextOutput = new Map(state.lspOutputByWorkspace);
        nextOutput.delete(workspaceRoot);
        return {
          crashByWorkspace: nextCrash,
          lspOutputByWorkspace: nextOutput,
        };
      });
      // Dispose the current client (no-op if
      // it already crashed and the dispose
      // was a no-op).
      await get().dispose(workspaceRoot);
      // Start a fresh one. If it crashes
      // again, the crash listener will reset
      // consecutiveCrashes to 1 and start the
      // backoff ladder from the top — which is
      // the right behaviour (we don't want
      // a single bad restart to burn through
      // all 5 attempts).
      await get().getOrCreate(workspaceRoot);
    },

    /**
     * Phase 9.7 — clear the per-workspace
     * "Server output" panel. The settings
     * card's `Clear` button calls this. Does
     * NOT affect the Rust log buffer (the
     * child process is still running and may
     * write more); it only clears the
     * in-memory display state.
     *
     * Idempotent: no-op if there's no entry
     * for the workspace.
     */
    clearLspOutput(workspaceRoot) {
      set((state) => {
        if (!state.lspOutputByWorkspace.has(workspaceRoot)) {
          // No entry → nothing to do. Returning
          // the same state ref keeps the
          // selector shallow-equal and avoids
          // a spurious re-render.
          return state;
        }
        const next = new Map(state.lspOutputByWorkspace);
        next.delete(workspaceRoot);
        return { lspOutputByWorkspace: next };
      });
    },
    /**
     * Test-only helper. Tears down the
     * closure-scoped state that
     * `setState` can't reach:
     *   - pending respawn timers,
     *   - the handleId → workspace map,
     *   - the global crash listener
     *     registration,
     *   - the per-workspace in-flight
     *     start-promise cache.
     *
     * The public surface hides it under
     * the `__` prefix; the test suite
     * imports it directly from the
     * module so the call site stays
     * outside React.
     */
    __resetLspClientStoreForTests(): void {
      for (const t of respawnTimers.values()) {
        clearTimeout(t);
      }
      respawnTimers.clear();
      handleToWorkspace.clear();
      startPromises.clear();
      if (crashUnlisten) {
        crashUnlisten();
        crashUnlisten = null;
      }
      // Phase 9.7 — same for the `lsp://log`
      // subscription. Without this, the
      // listener from the previous test would
      // still fire on the next test's mocked
      // events and the workspace lookup would
      // hit a stale `handleToWorkspace` (now
      // cleared, so it'd be a silent no-op —
      // but the test would still see a leaked
      // listener).
      if (logUnlisten) {
        logUnlisten();
        logUnlisten = null;
      }
    },
  };
});
