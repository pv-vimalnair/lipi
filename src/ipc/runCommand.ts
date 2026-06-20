/**
 * Typed IPC wrapper for the `run_command` Tauri
 * command (Phase 5c).
 *
 * The JS `toolRegistry` calls this for any
 * `kind: 'shell'` custom tool. The Rust side
 * spawns `tokio::process::Command`, captures
 * stdout / stderr, enforces a hard timeout, and
 * returns a `RunCommandResult` to the JS side.
 *
 * Mirrors `src-tauri/src/command.rs`. Components
 * import from `@/ipc`, never from
 * `@tauri-apps/api/core` directly (Rule 4).
 *
 * ## Why this is its own module (not in `ai.ts`)
 *
 * `ai.ts` is the AI provider / streaming chat
 * surface. `run_command` is a *custom tool*
 * surface — the model may not even be in the
 * loop (e.g. a 5d+ Cmd-K that lets the user
 * invoke a custom tool directly). Keeping the
 * two surfaces separate means a future custom-
 * tool use case doesn't accidentally pull in
 * the streaming chat plumbing.
 */

import { invoke } from '@tauri-apps/api/core';

/**
 * Args for `run_command`. The JS `toolRegistry`
 * builds this from a custom tool's `command`
 * template + the model's substituted args.
 *
 * `cwd` is the working directory for the child
 * process — 5c uses the JS-side workspace root
 * (the same path the AI is editing). 5d+ could
 * allow the user to override per-tool.
 */
export interface RunCommandArgs {
  /** Program path. On Windows this can be
   *  either a bare executable name (resolved
   *  via `PATH`) or an absolute path. The JS
   *  side does not shell-quote; we pass the
   *  `argv` as-is. */
  program: string;
  /** Args after the program. Empty array is
   *  allowed (e.g. `node --version` becomes
   *  `{program: 'node', args: ['--version']}`). */
  args: string[];
  /** Optional working directory. Omit to
   *  inherit from the parent process. */
  cwd?: string;
  /** Per-call timeout (seconds). Omit to use
   *  the Rust default (30s). 5d+ may surface
   *  this as a per-tool field in
   *  `lipi-tools.json`. */
  timeoutSecs?: number;
  /** Per-call max-output cap (bytes). Omit
   *  to use the Rust default (256 KiB). */
  maxOutputBytes?: number;
  /** Required Rust-side spawn policy. Keeps
   *  `run_command` from being a generic
   *  renderer-controlled process launcher. */
  policy?: RunCommandPolicy;
}

export interface RunCommandPolicy {
  kind: 'customTool';
  toolName: string;
  workspaceRoot: string;
}

/**
 * The response shape. Returned on the happy
 * path (exit code 0). Non-zero exits are
 * serialised as `RunCommandError` to the JS
 * side — the `toolRegistry` catches those and
 * converts them into a `kind: 'error'` tool
 * result for the model to react to.
 */
export interface RunCommandResult {
  /** Truncated stdout (UTF-8 lossy). 5c caps
   *  at 256 KiB and appends `<truncated>` if
   *  the output exceeds that. */
  stdout: string;
  /** Truncated stderr (UTF-8 lossy). Same
   *  truncation behaviour. */
  stderr: string;
  /** Exit status, if the process exited
   *  normally. `null` if killed by a signal
   *  (Unix-only; Windows always reports a
   *  number). */
  exitCode: number | null;
  /** `true` if the command was cancelled by
   *  the timeout. 5c: the only way the JS
   *  side sees `cancelled: true` is if the
   *  timeout fires. */
  cancelled: boolean;
}

/**
 * The error variants the Rust side can
 * return. Discriminated union on `kind` —
 * the `toolRegistry` switches on the
 * discriminator to format a model-friendly
 * error message. Tauri exposes the serialized
 * Rust fields directly, so variants do not
 * always include a display `message`.
 * The `stdout` / `stderr` fields (only on
 * `nonZeroExit`) include the captured
 * output for the model to see.
 */
export type RunCommandError =
  | { kind: 'empty'; message?: string }
  | {
      kind: 'spawn';
      program: string;
      detail: string;
      message?: string;
    }
  | { kind: 'timeout'; seconds: number; message?: string }
  | { kind: 'policy'; detail: string; message?: string }
  | {
      kind: 'nonZeroExit';
      code: number | null;
      stdout: string;
      stderr: string;
      message?: string;
    };

/**
 * Run a shell command. Used by the JS
 * `toolRegistry` for any `kind: 'shell'`
 * custom tool.
 *
 * The Rust side enforces a hard timeout
 * (30s default) and a max-output cap
 * (256 KiB default). Both are configurable
 * via the args.
 *
 * Throws ONLY for setup failures the JS side
 * can't pre-validate (e.g. Tauri command not
 * registered, IPC channel closed). All
 * runtime errors (non-zero exit, timeout,
 * missing program) come back as
 * `RunCommandError` values, not thrown
 * exceptions.
 */
export async function runCommand(
  args: RunCommandArgs,
): Promise<RunCommandResult> {
  return invoke<RunCommandResult>('run_command', { args });
}
