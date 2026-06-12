/**
 * Tool registry — the JS-side source of truth
 * for which tools the AI can call and how to
 * execute them (5b-6, 5c).
 *
 * The Rust side declares the same set of tools
 * in its request body (`get_openai_tools` /
 * `get_anthropic_tools` in `chat.rs`); without
 * that declaration, the model would never know
 * the tool exists and would never call it. We
 * keep the two in sync by hand for the MVP —
 * adding a built-in tool means adding it to
 * BOTH places. The 5c addition is the
 * `custom_tools` field on `ChatStreamArgs` —
 * user-defined tools are declared to the model
 * via the per-request list (no Rust-side code
 * change per new tool).
 *
 * ## Why a registry?
 *
 * Three reasons:
 *   1. **Decoupling**: the AI store doesn't
 *      hardcode "if name == 'get_file_contents',
 *      then…". New tools are added in one
 *      place without touching the loop.
 *   2. **Testability**: tests can swap the
 *      registry for a mock with deterministic
 *      results.
 *   3. **Future-proofing**: user-defined
 *      custom tools (5c) register themselves
 *      the same way built-in tools do —
 *      `registerTool` is the public API for
 *      plugin authors.
 *
 * ## Tool shape
 *
 * A tool is `(args: Record<string, unknown>)
 * => Promise<string>`. The handler is
 * pure-ish (no required args) and returns
 * a string. `executeToolCall` wraps the
 * handler in a try/catch and adds a
 * timing measurement — that's the
 * `ToolExecutor` signature the `aiStore`
 * uses.
 *
 * Built-in tools are listed at the bottom
 * of the file (`get_file_contents` for the
 * MVP). The registry is a `Map<string,
 * ToolHandler>` seeded with the built-ins.
 *
 * ## `kind` field (5c)
 *
 * Every registered tool has a `kind`:
 *   - `'builtin'`: hardcoded in this
 *     file. The model sees the same set
 *     across all workspaces; the user
 *     can't add / remove / edit them
 *     from the UI. The Settings screen
 *     shows them in a read-only list
 *     (with a per-tool enable toggle —
 *     5b-7).
 *   - `'shell'`: a user-defined shell
 *     tool (5c). Backed by a
 *     `LipiToolEntry` in the
 *     `customToolsStore`. The handler
 *     substitutes `{arg}` placeholders
 *     in `entry.command` /
 *     `entry.args` and calls
 *     `runCommand`.
 *   - `'http'`: a user-defined HTTP
 *     tool (5c). Backed by a
 *     `LipiToolEntry` in the
 *     `customToolsStore`. The handler
 *     substitutes `{arg}` placeholders
 *     in `entry.url` (and optionally
 *     `body`) and calls `httpRequest`.
 *
 * The `kind` is used by the Settings UI
 * to render the right card (custom tools
 * get Edit / Delete buttons; built-ins
 * don't), and by the `customToolsStore`
 * to decide which handler to wire up.
 */

import { FsError, httpRequest, readFile, runCommand, type LipiToolEntry } from '@/ipc';

/**
 * The discriminator for a tool's
 * `kind`. Mirrors the wire-level
 * `LipiToolKind` from `lipiTools.ts` —
 * the two are kept in sync by hand for
 * the MVP. `'builtin'` is the registry's
 * own marker (NOT a value in
 * `LipiToolKind` — built-ins don't
 * appear in `lipi-tools.json`).
 */
export type ToolKind = 'builtin' | 'shell' | 'http';

/**
 * The signature of a single tool's handler.
 * Takes a parsed argument object (the
 * model's `arguments` JSON, with
 * `JSON.parse` errors handled by the
 * caller) and returns the result content
 * as a string. The string is what we send
 * back to the model as the tool result
 * message's `content`.
 *
 * Throwing is fine — `executeToolCall`
 * will catch the error and turn it into
 * a `kind: 'error'` result so the model
 * sees a "this failed because…"
 * response and can react.
 */
export type ToolHandler = (
  args: Record<string, unknown>,
) => Promise<string>;

/**
 * A registered tool: name + handler +
 * description + kind.
 *
 * 5c: `kind` discriminates builtin /
 * shell / http. `customConfig` is
 * present iff `kind !== 'builtin'` — it
 * carries the full `LipiToolEntry` so
 * the handler can substitute placeholders
 * in the command / url / body.
 *
 * The `description` is used in the tool
 * trace UI (5b-6) and the Settings cards
 * (5b-7). The model sees the description
 * in the Rust-side tool declaration
 * (5b-6, 5c).
 */
export interface RegisteredTool {
  name: string;
  handler: ToolHandler;
  description: string;
  kind: ToolKind;
  /**
   * 5c: the full `LipiToolEntry` for
   * custom tools. `undefined` for
   * built-ins (they have no
   * `lipi-tools.json` representation —
   * they're hardcoded in this file).
   */
  customConfig?: LipiToolEntry;
}

/**
 * The registry. A `Map` so lookups are
 * O(1) and we can iterate entries for
 * a future "list available tools" UI
 * (5c). Module-level — the registry is
 * a singleton.
 */
const REGISTRY = new Map<string, RegisteredTool>();

/**
 * Register a tool. Replaces any existing
 * tool with the same name (useful for
 * hot-reload in dev and for tests).
 */
export function registerTool(tool: RegisteredTool): void {
  REGISTRY.set(tool.name, tool);
}

/**
 * Look up a tool by name. Returns the
 * registered entry or `undefined` (the
 * caller decides what to do — typically
 * a `'skipped'` result).
 */
export function getTool(name: string): RegisteredTool | undefined {
  return REGISTRY.get(name);
}

/**
 * List all registered tools. Read-only —
 * callers should not mutate the returned
 * array in place.
 */
export function listTools(): RegisteredTool[] {
  return Array.from(REGISTRY.values());
}

/**
 * The result of executing a single tool
 * call. Mirrors the `ToolResult` shape
 * stored on `ChatMessage.toolCalls[i]`
 * (5b-6) but is the WIRE-LEVEL shape
 * (the JS side stores it on the message
 * for the renderer). The keys are
 * camelCase to match the rest of the
 * JS surface (Rust side is snake_case
 * for the equivalent fields).
 *
 * `kind` is the coarse classification
 * the renderer uses to colour the
 * result preview:
 *   - 'text': a free-form string
 *     (e.g. file contents, command
 *     output)
 *   - 'json': pretty-printed JSON
 *     (e.g. a directory listing)
 *   - 'error': the handler threw or
 *     returned an error message
 */
export interface ToolExecutionResult {
  /** The tool call's id — copied through
   *  to the result message's
   *  `toolCallId`. */
  toolCallId: string;
  output: string;
  kind: 'text' | 'json' | 'error';
  durationMs: number;
}

/**
 * Execute a single tool call. Looks up
 * the handler in the registry, parses
 * the JSON argument string (with
 * try/catch), runs the handler, and
 * returns a `ToolExecutionResult`.
 *
 * Errors at any stage (unknown tool,
 * disabled tool, invalid JSON, handler
 * threw) become `kind: 'error'` results
 * — the model sees the error and can
 * react (e.g. "the file doesn't exist,
 * let me try another path").
 *
 * `durationMs` is the wall-clock time
 * spent in the handler (NOT the JSON
 * parse or the registry lookup — those
 * are O(1) and not user-visible).
 * For error cases, the duration is
 * still measured (it's just shorter,
 * often 0).
 *
 * 5b-7: `isEnabled` is an optional
 * predicate consulted BEFORE the
 * registry lookup. If absent, the
 * default is "always enabled" (the
 * 5b-6 behaviour — every registered
 * tool is allowed to run). The
 * `aiStore` passes the real predicate
 * from the `toolSettingsStore`. The
 * model shouldn't have asked for a
 * disabled tool (the Rust side filters
 * the tool list before sending the
 * request) but if it did — e.g. the
 * user toggled off mid-stream — we
 * still surface a clean error rather
 * than executing the tool silently.
 */
export async function executeToolCall(
  args: {
    toolCallId: string;
    name: string;
    arguments: string;
  },
  isEnabled?: (name: string) => boolean,
): Promise<ToolExecutionResult> {
  const { toolCallId, name, arguments: argsJson } = args;
  // 5b-7: per-tool enable/disable. The
  // predicate is optional — when absent,
  // we default to "always enabled" (the
  // 5b-6 behaviour, kept for backwards-
  // compat in tests and one-off callers).
  if (isEnabled && !isEnabled(name)) {
    return {
      toolCallId,
      output: `Tool '${name}' is disabled. Enable it in Settings → AI Tools to allow the model to use it.`,
      kind: 'error',
      durationMs: 0,
    };
  }
  const tool = getTool(name);
  // Unknown tool — no point trying.
  // The model will see "Unknown tool
  // 'foo'" in the result and can
  // self-correct.
  if (!tool) {
    return {
      toolCallId,
      output: `Unknown tool '${name}'. Available tools: ${listTools()
        .map((t) => t.name)
        .join(', ')}.`,
      kind: 'error',
      durationMs: 0,
    };
  }
  // Parse the arguments. The model is
  // supposed to emit valid JSON, but
  // sometimes hallucinates. We fall
  // back to an empty object so the
  // handler at least runs (some
  // tools like `get_current_time`
  // take no args).
  let parsed: Record<string, unknown>;
  try {
    const raw: unknown = argsJson === '' ? {} : JSON.parse(argsJson);
    // Defensive — the model might
    // emit `[]` or `"foo"` instead of
    // an object. We coerce to an
    // object so the handler's
    // `args.foo` access doesn't
    // throw.
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      parsed = {};
    } else {
      parsed = raw as Record<string, unknown>;
    }
  } catch {
    parsed = {};
  }
  // Run the handler with timing.
  const start = Date.now();
  try {
    const output = await tool.handler(parsed);
    return {
      toolCallId,
      output,
      kind: classifyOutput(output),
      durationMs: Date.now() - start,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      toolCallId,
      output: `Tool '${name}' failed: ${message}`,
      kind: 'error',
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Classify a tool's output as `'text'`,
 * `'json'`, or fall through to `'text'`.
 * We try `JSON.parse` on the output —
 * if it succeeds AND the top-level
 * value is an object or array (not
 * a string/number/bool), we call it
 * `'json'`. Otherwise it's plain
 * text (file contents, etc.).
 *
 * The renderer uses this to pick
 * a colour for the result preview
 * (json gets a slightly different
 * background) and to decide whether
 * to pretty-print (`JSON.stringify`
 * with 2-space indent) before
 * showing.
 */
function classifyOutput(output: string): 'text' | 'json' {
  if (output.length === 0) return 'text';
  // Quick heuristic: JSON almost
  // always starts with `{` or `[`.
  // Plain text rarely does at the
  // first character.
  const first = output.charAt(0);
  if (first !== '{' && first !== '[') return 'text';
  try {
    const parsed: unknown = JSON.parse(output);
    if (typeof parsed === 'object' && parsed !== null) {
      return 'json';
    }
  } catch {
    // Not JSON. That's fine.
  }
  return 'text';
}

// --- Built-in tools (5b-6) -----------------------------------------------
//
// One tool for the MVP: `get_file_contents`.
// Reads a workspace-relative file via the
// `fsReadFile` IPC. Returns the file content
// as a UTF-8 string; returns an error string
// for binary files (which the Rust side
// marks as `kind: 'binary'`) and for
// missing paths.

/**
 * Read the contents of a file at the given
 * workspace-relative path. The Rust side
 * gates binary files (any file with NUL
 * bytes in the first 8 KB is marked
 * `encoding: 'binary'`) and missing paths
 * (raises an `FsError` with
 * `kind: 'NotFound'`).
 *
 * The tool handler returns:
 *   - For `encoding: 'utf-8'`: the raw
 *     content.
 *   - For `encoding: 'binary'`: an error
 *     string ("binary file, X bytes").
 *   - For `FsError` with `NotFound`: an
 *     error string ("file not found: <path>").
 *   - For `FsError` with `TooLarge`: an
 *     error string ("file too large").
 *   - For other errors: the error message.
 *
 * Errors are returned as strings (not
 * thrown) so the model sees them in the
 * tool result and can react. Throwing
 * would still work (the registry catches
 * it) but returning a string is more
 * transparent in the tool trace UI.
 */
const getFileContentsHandler: ToolHandler = async (args) => {
  const path = args['path'];
  if (typeof path !== 'string' || path.length === 0) {
    return `Error: 'get_file_contents' requires a non-empty 'path' string argument.`;
  }
  try {
    const content = await readFile(path);
    if (content.encoding === 'binary') {
      // Don't expose raw binary bytes —
      // the model can't make sense of
      // them and it wastes tokens. Tell
      // the model it's a binary file and
      // let it decide what to do (e.g.
      // ask the user to look at it
      // manually).
      return `Error: '${path}' is a binary file; refusing to read as text.`;
    }
    return content.content;
  } catch (e) {
    if (e instanceof FsError) {
      switch (e.payload.kind) {
        case 'NotFound':
          return `Error: file not found: '${path}'.`;
        case 'PermissionDenied':
          return `Error: permission denied reading '${path}'.`;
        case 'TooLarge':
          return `Error: '${path}' is too large to read.`;
        case 'NotAFile':
          return `Error: '${path}' is a directory, not a file.`;
        case 'NotADirectory':
          return `Error: a parent of '${path}' is not a directory.`;
        case 'Io':
          return `Error reading '${path}': ${e.payload.detail}`;
        default: {
          // Exhaustive check.
          const exhaustive: never = e.payload.kind;
          return `Error reading '${path}': ${String(exhaustive)}`;
        }
      }
    }
    const message = e instanceof Error ? e.message : String(e);
    return `Error reading '${path}': ${message}`;
  }
};

registerTool({
  name: 'get_file_contents',
  handler: getFileContentsHandler,
  description:
    'Read the contents of a file at the given path (relative to the workspace root). Returns the file content as a UTF-8 string. Returns an error string for binary files or missing paths.',
  kind: 'builtin',
});

// --- Custom tool handlers (5c) ------------------------------------------
//
// Two generic handlers, one for each
// `LipiToolKind`. They look up the
// `LipiToolEntry` from the `customConfig`
// field on the `RegisteredTool`, substitute
// `{arg}` placeholders in the command /
// url / body / headers, and call the
// matching Rust IPC (`runCommand` or
// `httpRequest`).
//
// The actual `registerTool` call for
// each custom tool happens in the
// `customToolsStore` — the registry
// itself doesn't know about custom
// tools until they're registered. This
// keeps the registry as a "dumb
// storage" — the store is the source
// of truth for which customs exist and
// when they're registered.

/**
 * Substitute `{arg_name}` placeholders
 * in a string template with values from
 * the model's `arguments` JSON. We do
 * the substitution on the JS side (not
 * the Rust side) so we can:
 *   - URL-encode path / identifier
 *     values (so a space in a file path
 *     doesn't break the URL),
 *   - handle missing args (the user
 *     might have left a placeholder in
 *     the template but the model
 *     didn't pass the arg),
 *   - handle type mismatches (the model
 *     might pass a number when the
 *     template expects a string).
 *
 * If the model's arg is missing OR
 * non-string, we substitute an empty
 * string and the user's command will
 * see a malformed invocation. The Rust
 * side's error path will catch most
 * of these (e.g. `command not found`).
 */
function substitutePlaceholders(
  template: string,
  args: Record<string, unknown>,
): string {
  return template.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_match, name) => {
    const value = args[name];
    if (typeof value === 'string') {
      return encodeURIComponent(value);
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return encodeURIComponent(String(value));
    }
    // Missing or wrong-type — substitute
    // an empty string. The model will
    // see the command's error in the
    // tool result and can self-correct.
    return '';
  });
}

/**
 * Build a handler for a `kind: 'shell'`
 * custom tool. The handler:
 *   1. Substitutes `{arg}` placeholders
 *      in `entry.command` and
 *      `entry.args` from the model's
 *      argument object.
 *   2. Calls the Rust `run_command` IPC
 *      with the substituted argv.
 *   3. Formats the result for the model:
 *      a short header (exit code, timing)
 *      followed by stdout / stderr.
 *
 * The result format is intentionally
 * terse — the model's context window is
 * precious and most of the time the
 * user wants to see "did the test pass",
 * not a ream of output.
 */
function makeShellHandler(entry: LipiToolEntry): ToolHandler {
  return async (args) => {
    if (!entry.command) {
      return `Error: shell tool '${entry.name}' has no 'command' configured.`;
    }
    const program = substitutePlaceholders(entry.command, args);
    const argv = (entry.args ?? []).map((a) =>
      substitutePlaceholders(a, args),
    );
    try {
      const result = await runCommand({
        program,
        args: argv,
        cwd: entry.cwd,
      });
      const header = `Exit code: ${result.exitCode ?? 'null'}`;
      const parts = [header];
      if (result.stdout.length > 0) {
        parts.push(`--- stdout ---\n${result.stdout}`);
      }
      if (result.stderr.length > 0) {
        parts.push(`--- stderr ---\n${result.stderr}`);
      }
      return parts.join('\n');
    } catch (e) {
      // `runCommand` returns a `RunCommandError`
      // object on runtime errors (non-zero
      // exit, timeout, missing program, etc.).
      // Tauri surfaces those as thrown
      // errors with a serialised payload —
      // the `e` here is the error envelope
      // from `command.rs`.
      const err = e as { kind?: string; message?: string; code?: number; stdout?: string; stderr?: string; seconds?: number; program?: string };
      const message = err.message ?? String(e);
      switch (err.kind) {
        case 'nonZeroExit': {
          const parts = [`Error: command exited with code ${err.code ?? 'null'}.`];
          if (err.stdout) parts.push(`--- stdout ---\n${err.stdout}`);
          if (err.stderr) parts.push(`--- stderr ---\n${err.stderr}`);
          return parts.join('\n');
        }
        case 'timeout':
          return `Error: command timed out after ${err.seconds ?? 30}s. The process may still be running in the background.`;
        case 'spawn':
          return `Error: failed to spawn '${err.program ?? program}': ${message}`;
        case 'empty':
          return `Error: command is empty. Check the 'command' field for '${entry.name}'.`;
        default:
          return `Error running '${entry.name}': ${message}`;
      }
    }
  };
}

/**
 * Build a handler for a `kind: 'http'`
 * custom tool. The handler:
 *   1. Substitutes `{arg}` placeholders
 *      in `entry.url` and `entry.body`
 *      from the model's argument object.
 *      (Headers are NOT substituted in
 *      5c — header values typically
 *      contain secrets, and a model
 *      controlling header values is a
 *      privilege-escalation footgun.
 *      A 5d+ enhancement can add
 *      placeholder support to header
 *      values explicitly.)
 *   2. Calls the Rust `http_request` IPC
 *      with the substituted URL, the
 *      configured method, and the static
 *      headers.
 *   3. Formats the result for the model:
 *      status + headers (truncated) +
 *      body.
 */
function makeHttpHandler(entry: LipiToolEntry): ToolHandler {
  return async (args) => {
    if (!entry.url) {
      return `Error: http tool '${entry.name}' has no 'url' configured.`;
    }
    const url = substitutePlaceholders(entry.url, args);
    const body = entry.body
      ? substitutePlaceholders(entry.body, args)
      : '';
    try {
      const result = await httpRequest({
        url,
        method: entry.method,
        headers: entry.headers,
        body,
      });
      const headerLines = [
        `Status: ${result.status}`,
        `Headers:`,
        ...result.headers
          .slice(0, 20)
          .map(([n, v]) => `  ${n}: ${v}`),
      ];
      const parts = [headerLines.join('\n')];
      if (result.body.length > 0) {
        parts.push(`--- body ---\n${result.body}`);
      }
      return parts.join('\n');
    } catch (e) {
      const err = e as { kind?: string; message?: string; status?: number; body?: string; seconds?: number; name?: string; url?: string };
      const message = err.message ?? String(e);
      switch (err.kind) {
        case 'non2xx': {
          const parts = [`Error: HTTP ${err.status ?? '?'}.`];
          if (err.body) parts.push(`--- response body ---\n${err.body}`);
          return parts.join('\n');
        }
        case 'timeout':
          return `Error: request timed out after ${err.seconds ?? 30}s.`;
        case 'network':
          return `Error: network failure. ${message}`;
        case 'invalidUrl':
          return `Error: invalid URL '${err.url ?? url}'. ${message}`;
        case 'invalidHeaderName':
          return `Error: invalid header name '${err.name}'. ${message}`;
        case 'invalidHeaderValue':
          return `Error: invalid header value for '${err.name}'. ${message}`;
        default:
          return `Error running '${entry.name}': ${message}`;
      }
    }
  };
}

/**
 * 5c: register a custom tool (shell or
 * http). The `customToolsStore` calls
 * this for every entry in the current
 * `lipi-tools.json`. The handler is
 * built from the entry's `kind`; the
 * registry stores both the handler and
 * the entry itself (so the Settings
 * UI can re-render the card without
 * re-reading the file).
 *
 * Replaces any existing tool with the
 * same name. The `customToolsStore`
 * registers the full set on every
 * reload (e.g. after an edit), so
 * re-registration is the normal case.
 */
export function registerCustomTool(entry: LipiToolEntry): void {
  const handler: ToolHandler =
    entry.kind === 'shell' ? makeShellHandler(entry) : makeHttpHandler(entry);
  registerTool({
    name: entry.name,
    handler,
    description: entry.description,
    kind: entry.kind,
    customConfig: entry,
  });
}
