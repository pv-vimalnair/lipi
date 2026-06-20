/**
 * Typed IPC wrapper for the `read_lipi_tools`
 * and `write_lipi_tools` Tauri commands
 * (Phase 5c).
 *
 * The user's custom tools live in a JSON
 * file at the root of the open workspace:
 * `<workspace>/lipi-tools.json`. The JS
 * `customToolsStore` is the source of truth
 * at runtime; the Rust side just provides
 * read/write primitives.
 *
 * Mirrors `src-tauri/src/lipi_tools.rs`.
 * Components import from `@/ipc`, never
 * from `@tauri-apps/api/core` directly
 * (Rule 4).
 */

import { invoke } from '@tauri-apps/api/core';

/**
 * The discriminator for a custom tool's
 * `kind`. 5c only supports these two
 * values. Future versions may add
 * `'mcp' | 'wasm' | ...`.
 */
export type LipiToolKind = 'shell' | 'http';

/**
 * A single argument for a custom tool.
 * Mirrors `LipiToolArgSpec` on the Rust
 * side. The runtime `CustomToolArg`
 * (passed to the chat IPC) is derived
 * from this in the `customToolsStore`.
 */
export interface LipiToolArgSpec {
  /** Argument name (e.g. `'path'`). Must
   *  match a `{name}` placeholder in the
   *  tool's command/url template.
   *  Case-sensitive. */
  name: string;
  /** Argument type. Only `'string'` in 5c. */
  type: 'string';
  /** Human-readable description shown to
   *  the model in the tool's JSON Schema. */
  description: string;
}

/**
 * The full per-tool definition. Lives
 * inside `LipiToolsFile.tools`. The
 * `command` / `url` / `headers` fields
 * are *only* used by the JS executor
 * (in `toolRegistry`); the Rust side
 * never sees them — it only projects
 * the `name` / `description` /
 * `argsSpec` triple into the chat IPC.
 */
export interface LipiToolEntry {
  /** Tool name (e.g. `'run_npm_test'`).
   *  Must be unique across `tools`. The
   *  `customToolsStore` enforces this on
   *  save. */
  name: string;
  /** Human-readable description shown to
   *  the model in the tool's JSON Schema. */
  description: string;
  /** Tool kind. 5c only supports
   *  `'shell' | 'http'`. The JS editor
   *  restricts the dropdown. */
  kind: LipiToolKind;
  /** `shell` only: the program to run
   *  (e.g. `'npm'`). Ignored for `http`
   *  tools. */
  command?: string;
  /** `shell` only: argv after the
   *  program. May contain `{arg_name}`
   *  placeholders that the JS side
   *  substitutes before calling
   *  `run_command`. Ignored for `http`
   *  tools. */
  args?: string[];
  /** `shell` only: optional working
   *  directory. `undefined` = inherit
   *  from the parent process. Ignored
   *  for `http` tools. */
  cwd?: string;
  /** `http` only: the URL with optional
   *  `{arg_name}` placeholders. Ignored
   *  for `shell` tools. */
  url?: string;
  /** `http` only: HTTP method. The JS
   *  side supplies the default
   *  (`'GET'`) on save if the user
   *  leaves the field empty. Ignored
   *  for `shell` tools. */
  method?: string;
  /** `http` only: HTTP headers. Ignored
   *  for `shell` tools. */
  headers?: Record<string, string>;
  /** `http` only: request body (raw
   *  string). Ignored for `shell`
   *  tools. */
  body?: string;
  /** `http` only: explicit host allowlist for
   *  placeholder-based hosts. Static URL-template
   *  hosts are derived automatically by the JS
   *  executor. Supports exact hosts and `*.domain`
   *  wildcards. */
  allowedHosts?: string[];
  /** `http` only: allow localhost/private/link-local
   *  targets. Defaults to false. */
  allowPrivateNetwork?: boolean;
  /** Arguments the model can pass. The
   *  Rust side only sees this to build
   *  the provider-specific JSON Schema
   *  (via `custom_tool.rs`); the actual
   *  substitution happens on the JS
   *  side using `args` / `url`. */
  argsSpec: LipiToolArgSpec[];
}

/**
 * The file envelope. Serialised
 * one-for-one to / from JSON in
 * `lipi-tools.json`.
 */
export interface LipiToolsFile {
  /** Shape version. Must equal `1` for
   *  the JS store to load it. */
  version: number;
  /** All the user's custom tools. The
   *  JS store indexes this by `name`
   *  for O(1) lookup. */
  tools: LipiToolEntry[];
}

/**
 * The error variants the Rust side can
 * return. Discriminated union on `kind`
 * — the `customToolsStore` switches on
 * the discriminator to format a
 * user-friendly error message.
 *
 * The `unknownKind` variant carries the
 * offending `kind` value as `unknownKindValue`
 * (not `kind`) to avoid a name collision
 * with the discriminator.
 */
export type LipiToolsError =
  | { kind: 'notFound'; message: string; path: string }
  | { kind: 'io'; message: string; path: string }
  | { kind: 'json'; message: string }
  | { kind: 'shape'; message: string; reason: string }
  | { kind: 'duplicateName'; message: string; name: string }
  | { kind: 'unknownKind'; message: string; unknownKindValue: string };

/**
 * Read the `lipi-tools.json` at the
 * given workspace root.
 *
 * The Rust side does NOT propagate
 * `NotFound` as an error — it returns
 * `LipiToolsFile.empty()` (version 1,
 * tools = []). This is the "first run"
 * path: the file doesn't exist yet, so
 * the JS store should start with an
 * empty list. All other errors
 * (`json` / `shape` / `io`) ARE
 * propagated.
 */
export async function readLipiTools(
  workspaceRoot: string,
): Promise<LipiToolsFile> {
  return invoke<LipiToolsFile>('read_lipi_tools', {
    workspaceRoot,
  });
}

/**
 * Write the `lipi-tools.json` to the
 * given workspace root. Validates the
 * in-memory representation before
 * touching disk (rejects duplicate
 * tool names, unsupported version,
 * etc.). The JS store calls this on
 * every add / edit / delete action —
 * the in-memory list is the source of
 * truth, the file is just a
 * persistence layer.
 */
export async function writeLipiTools(
  workspaceRoot: string,
  file: LipiToolsFile,
): Promise<void> {
  return invoke<void>('write_lipi_tools', {
    workspaceRoot,
    file,
  });
}

/** The constant filename. */
export const LIPI_TOOLS_FILENAME = 'lipi-tools.json';

/** The current file shape version. */
export const LIPI_TOOLS_VERSION = 1;
