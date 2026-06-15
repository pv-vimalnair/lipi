/**
 * Typed IPC wrapper for the Phase 9 LSP stdio-pipe
 * commands. Mirrors `src-tauri/src/stdio.rs` + the
 * `lsp_run_stdio` / `lsp_stdio_read` / `lsp_stdio_write` /
 * `lsp_stdio_close` / `lsp_check_available` Tauri commands
 * registered in `lib.rs`. Components import from `@/ipc`,
 * never from `@tauri-apps/api/core` directly (Rule 4).
 *
 * ## What this surface is
 *
 * The "Tiniest" scope of Phase 9 lets the renderer drive
 * a long-lived child process (a real
 * `typescript-language-server`) by piping its stdio over
 * the Tauri IPC boundary. The JS side treats the child
 * like a normal Node `ChildProcess`: `lspRunStdio` is
 * the `spawn`, `lspStdioRead` is a non-blocking read,
 * `lspStdioWrite` is a write, and `lspStdioClose` is the
 * graceful-then-forceful kill ladder.
 *
 * The renderer-side `LspClient` (in
 * `screens/EditorWorkspace/state/lspClientStore.ts`)
 * wraps these primitives in an async Transport that
 * `monaco-languageclient` can drive directly.
 *
 * ## Why polling (`lspStdioRead` is a Tauri command, not
 *   an event)
 *
 * LSP `typescript-language-server` is a low-throughput
 * protocol (one `didChange` → one `publishDiagnostics`).
 * Polling `lspStdioRead` at ~1ms granularity is more than
 * enough and avoids the long-lived-event-subscription
 * memory-leak risk. See HANDOFF §9.33 for the full
 * design.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/**
 * Args for `lsp_run_stdio`. The JS `LspClient` builds
 * this with `command: 'typescript-language-server'` and
 * `args: ['--stdio']` (the canonical flags for the
 * `vscode-langservers-extracted` Node CLI).
 *
 * `cwd` is the workspace root — the LSP server's
 * `tsc` program resolves the project's `tsconfig.json`
 * relative to its own CWD. We set it to the workspace
 * root (the same path the AI is editing) so the server
 * finds the right `tsconfig.json`.
 */
export interface RunStdioArgs {
  /** Program path. On Windows this can be a bare
   *  executable name (resolved via `PATH`) or an
   *  absolute path. The most common call is
   *  `command: 'typescript-language-server'`. */
  command: string;
  /** Args after the program. For
   *  `typescript-language-server` this is `['--stdio']`. */
  args: string[];
  /** Optional working directory. Omit to inherit
   *  from the parent process. The `LspClient` sets
   *  this to the workspace root. */
  cwd?: string;
}

/**
 * Response from `lsp_run_stdio`. `handleId` is a
 * 32-char hex string the JS side passes to
 * `lspStdioRead` / `lspStdioWrite` / `lspStdioClose` to
 * address the spawned child.
 *
 * `resolvedCommand` is the program name as resolved by
 * the OS PATH lookup — useful for the settings card's
 * "Server: <path>" status line.
 */
export interface RunStdioResult {
  handleId: string;
  resolvedCommand: string;
}

/**
 * Response from `lsp_check_available`. The settings card
 * surfaces `available` + `installHint` verbatim and
 * hides the "Restart server" button when the CLI isn't
 * on PATH.
 *
 * `version` is the string the server printed with
 * `--version` (e.g. "4.3.3"), or `null` if the server
 * isn't on PATH or didn't respond to `--version`.
 */
export interface CheckAvailableResult {
  available: boolean;
  installHint: string;
  version: string | null;
}

/**
 * Spawn a child process with piped stdio and return an
 * opaque `handleId`. The handle is owned by the Rust
 * `StdioState` (registered via Tauri's `manage()`) and
 * is freed by `lspStdioClose`. The caller is expected to
 * hold the handle and call `lspStdioClose` when done.
 */
export async function lspRunStdio(args: RunStdioArgs): Promise<RunStdioResult> {
  return invoke<RunStdioResult>('lsp_run_stdio', { args });
}

/**
 * Drain up to `maxBytes` from the child's stdout
 * buffer. Returns an empty `Uint8Array` if no data is
 * ready. Returns `[0xFF]` (a single sentinel byte) if
 * the child has exited and the buffer is empty, so the
 * caller can distinguish "no data right now" from
 * "process is dead". 0xFF is invalid UTF-8, so the
 * caller's UTF-8 decoder will treat it as a clean
 * end-of-stream.
 */
export async function lspStdioRead(
  handleId: string,
  maxBytes: number,
): Promise<Uint8Array> {
  const bytes = await invoke<number[]>('lsp_stdio_read', {
    handleId,
    maxBytes,
  });
  return new Uint8Array(bytes);
}

/**
 * Write `bytes` to the child's stdin. Returns the
 * number of bytes written (which is always `bytes.length`
 * in practice — partial writes are folded into the
 * internal `BufWriter`, but the Rust side counts only
 * the `write_all` call's bytes).
 */
export async function lspStdioWrite(
  handleId: string,
  bytes: Uint8Array,
): Promise<number> {
  return invoke<number>('lsp_stdio_write', {
    handleId,
    bytes: Array.from(bytes),
  });
}

/**
 * Close the handle. Drops stdin (EOF), waits 500ms for
 * graceful exit, then SIGTERM, then SIGKILL after 2s.
 * Idempotent — calling twice on the same `handleId`
 * returns `notFound` on the second call (the handle is
 * removed from the state map on the first call).
 */
export async function lspStdioClose(handleId: string): Promise<void> {
  return invoke<void>('lsp_stdio_close', { handleId });
}

/**
 * Check whether the LSP CLI is on PATH and respond to
 * `--version`. The settings card calls this on mount
 * and shows the install hint when `available: false`.
 *
 * Note: the Rust side shells out to `which` / `where`
 * + a `--version` probe, so this IPC call can take up
 * to 5s in the worst case (the
 * `CHECK_AVAILABLE_TIMEOUT` constant in `stdio.rs`).
 * The settings card shows a "checking..." state
 * during that window.
 */
export async function lspCheckAvailable(): Promise<CheckAvailableResult> {
  return invoke<CheckAvailableResult>('lsp_check_available');
}

/**
 * The constant install hint. The Rust side is the
 * source of truth (`INSTALL_HINT` in `stdio.rs`); this
 * constant is exposed for tests that want to assert
 * "the install hint the Rust side returns matches the
 * one we expect". The settings card surfaces the
 * Rust-side value verbatim, not this constant.
 */
export const LSP_INSTALL_HINT = 'npm install -g typescript-language-server';

/**
 * `lsp://crashed` event name. Emitted by the Rust
 * `StdioHandle::spawn_wait_task` when a child process
 * exits. The JS `lspClientStore` subscribes via
 * `onLspCrashed` and uses the payload to flip the
 * workspace's `LspStatus` to `error`, capture the
 * last stderr lines, and schedule an auto-respawn
 * with exponential backoff.
 *
 * Pinning the event name as a constant guards
 * against typos on the Rust side (`LSP_CRASHED_EVENT`
 * in `src-tauri/src/stdio.rs`); the Rust test
 * `lsp_crashed_event_name_is_stable` asserts both
 * sides agree.
 */
export const LSP_CRASHED_EVENT = 'lsp://crashed';

/**
 * Payload of the `lsp://crashed` event. Mirrors
 * `LspCrashedPayload` in `src-tauri/src/stdio.rs`.
 *
 * `exitStatus` is the integer exit code if the child
 * exited normally. `null` if the child was killed by
 * a signal (Unix) or the exit code couldn't be
 * captured (Windows in some edge cases).
 *
 * `stderrTail` is the last ~8 KiB (≈100 lines) the
 * child wrote to stderr, UTF-8 lossy. May be the
 * empty string if the child never wrote to stderr.
 * The settings card surfaces this in its
 * "Last lines of server output" panel.
 *
 * `handleId` is the same opaque 32-char hex string
 * returned by `lspRunStdio`. The store matches on it
 * to decide which workspace's client crashed (the
 * store's `clients` map is keyed by `workspaceRoot`,
 * not `handleId`, so a small lookup is needed —
 * see `lspClientStore.ts`).
 */
export interface OnLspCrashedPayload {
  handleId: string;
  exitStatus: number | null;
  stderrTail: string;
}

/**
 * Drain up to `maxBytes` from the per-handle stderr
 * buffer. The buffer is a ring buffer capped at 8 KiB
 * on the Rust side, so the JS caller should call
 * once with `maxBytes = 8 * 1024` to grab the entire
 * tail in one shot.
 *
 * Phase 9.5 — crash diagnostics. The settings card
 * calls this on the back of an `lsp://crashed` event
 * to populate the "Last lines of server output"
 * panel. In normal operation (no crash), the buffer
 * is usually empty and this returns an empty
 * `Uint8Array`.
 *
 * Note: this is a destructive read. Each call
 * consumes the bytes from the buffer (the Rust side
 * does `pop_front` in a loop). Callers that want to
 * peek should cache the returned bytes themselves.
 */
export async function lspStdioReadStderr(
  handleId: string,
  maxBytes: number,
): Promise<Uint8Array> {
  const bytes = await invoke<number[]>('lsp_stdio_read_stderr', {
    handleId,
    maxBytes,
  });
  return new Uint8Array(bytes);
}

/**
 * Subscribe to `lsp://crashed` events. Returns an
 * `UnlistenFn` that the caller should invoke in a
 * cleanup effect (or `useEffect` return value) to
 * detach the listener.
 *
 * The store calls this exactly once at module load
 * and keeps the unlisten alive for the lifetime of
 * the app. The Rust side fires the event exactly
 * once per child (the wait task is single-shot), so
 * the listener doesn't need to debounce.
 */
export async function onLspCrashed(
  handler: (payload: OnLspCrashedPayload) => void,
): Promise<UnlistenFn> {
  return listen<OnLspCrashedPayload>(LSP_CRASHED_EVENT, (e) =>
    handler(e.payload),
  );
}
