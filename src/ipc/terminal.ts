/**
 * Typed IPC wrapper for the Rust embedded-terminal pipe.
 *
 * Mirrors `src-tauri/src/terminal.rs`. Components import from
 * `@/ipc`, never from `@tauri-apps/api/core` or
 * `@tauri-apps/api/event` directly (Rule 4).
 *
 * Phase 4a: pipe only — no UI. The `useTerminal` hook in
 * `screens/EditorWorkspace/hooks/useTerminal.ts` consumes these
 * wrappers and exposes a discriminated `idle | opening |
 * running | exited | error` status. xterm.js lands in 4b.
 *
 * ## Event model
 *
 * The Rust side runs a reader thread per session. The thread
 * emits two Tauri events to the main window:
 *
 *   `terminal://output`  payload: TerminalOutputEvent
 *                          (sessionId, data: number[])
 *   `terminal://exit`    payload: TerminalExitEvent
 *                          (sessionId, exitCode: number | null)
 *
 * The JS side subscribes once at app startup (in `useTerminal`)
 * and demuxes events to the right session via `sessionId`.
 * Subscribing per-session would mean N listeners for N
 * terminals and we'd lose the ability to dispatch to a
 * session that was just opened but not yet returned to the
 * caller.
 *
 * Note: `data` arrives as `number[]` because Tauri serialises
 * `Vec<u8>` as a JSON array of numbers. xterm.js's
 * `write(Uint8Array)` accepts a `Uint8Array` directly, so
 * the hook converts via `Uint8Array.from(data)` before
 * writing.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface OpenResult {
  sessionId: string;
  shell: string;
  rows: number;
  cols: number;
}

export interface TerminalOutputEvent {
  sessionId: string;
  /** Raw bytes emitted by the shell. xterm.js accepts
   *  `Uint8Array` directly. */
  data: number[];
}

export interface TerminalExitEvent {
  sessionId: string;
  /** Integer exit code; `null` if killed by a signal. */
  exitCode: number | null;
}

export interface TerminalErrorPayload {
  kind: 'Io' | 'Spawn' | 'NotFound' | 'AlreadyClosed' | 'Pty' | 'Policy';
  detail: string;
}

export class TerminalError extends Error {
  readonly payload: TerminalErrorPayload;

  constructor(payload: TerminalErrorPayload) {
    super(`[${payload.kind}] ${payload.detail}`);
    this.name = 'TerminalError';
    this.payload = payload;
  }
}

function asTerminalError(err: unknown): TerminalError {
  if (err instanceof TerminalError) return err;
  if (
    typeof err === 'object' &&
    err !== null &&
    'kind' in err &&
    typeof (err as { kind: unknown }).kind === 'string'
  ) {
    return new TerminalError(err as TerminalErrorPayload);
  }
  return new TerminalError({ kind: 'Pty', detail: String(err) });
}

export interface OpenOptions {
  /** Deprecated. Rust rejects renderer-supplied shell overrides;
   *  omit this to use the platform default shell. */
  shell?: string;
  /** Initial PTY rows. Defaults to 24 (xterm.js default). */
  rows?: number;
  /** Initial PTY cols. Defaults to 80. */
  cols?: number;
}

/**
 * Open a new PTY session. Spawns the chosen shell (or the
 * platform default) inside a PTY of the requested size and
 * starts the reader thread. Subscribe to
 * `onTerminalOutput` / `onTerminalExit` BEFORE the first
 * `write()` — events may arrive within milliseconds of the
 * call returning (the shell's first prompt).
 */
export async function terminalOpen(
  options: OpenOptions = {},
): Promise<OpenResult> {
  try {
    return await invoke<OpenResult>('terminal_open', { args: options });
  } catch (err) {
    throw asTerminalError(err);
  }
}

/** Write raw bytes to the session's stdin. The caller is
 *  responsible for terminal-encoding semantics (xterm.js's
 *  `onData` callback gives the right bytes including \r
 *  for line endings). */
export async function terminalWrite(
  sessionId: string,
  data: Uint8Array,
): Promise<void> {
  try {
    await invoke<void>('terminal_write', { sessionId, data: Array.from(data) });
  } catch (err) {
    throw asTerminalError(err);
  }
}

/** Resize the PTY. Sends SIGWINCH (or ConPTY equivalent). */
export async function terminalResize(
  sessionId: string,
  rows: number,
  cols: number,
): Promise<void> {
  try {
    await invoke<void>('terminal_resize', { sessionId, rows, cols });
  } catch (err) {
    throw asTerminalError(err);
  }
}

/** Close the session. Idempotent. */
export async function terminalClose(sessionId: string): Promise<void> {
  try {
    await invoke<void>('terminal_close', { sessionId });
  } catch (err) {
    throw asTerminalError(err);
  }
}

/** Returns the platform's default shell path. The settings
 *  panel uses this to show the user "Terminal: cmd.exe" /
 *  "Terminal: /bin/zsh" so they know what they'll get when
 *  they open a new terminal. */
export async function terminalDefaultShell(): Promise<string> {
  return invoke<string>('terminal_default_shell_cmd');
}

/**
 * Subscribe to terminal output events for any session.
 * Returns an unlisten function — call it to unsubscribe.
 * Typically you subscribe once at app startup and demux
 * via `sessionId` in the callback.
 */
export async function onTerminalOutput(
  cb: (event: TerminalOutputEvent) => void,
): Promise<UnlistenFn> {
  return listen<TerminalOutputEvent>('terminal://output', (e) => {
    cb(e.payload);
  });
}

/**
 * Subscribe to terminal exit events for any session. The
 * `exitCode` is `null` if the child was killed by a signal
 * (rare on Windows ConPTY, more common on Unix SIGKILL).
 */
export async function onTerminalExit(
  cb: (event: TerminalExitEvent) => void,
): Promise<UnlistenFn> {
  return listen<TerminalExitEvent>('terminal://exit', (e) => {
    cb(e.payload);
  });
}
