/**
 * Tests for the tool registry (5b-6, extended in 5b-7).
 *
 * Scope (5b-6 + 5b-7):
 *   - `registerTool` + `getTool` round-trip
 *   - `listTools` reflects the current set
 *   - `executeToolCall` happy path with a
 *     stub handler
 *   - Unknown tool name → `kind: 'error'`
 *   - Invalid JSON arguments → handler
 *     still runs with an empty object
 *   - Handler throws → `kind: 'error'` with
 *     the error message in the output
 *   - `classifyOutput` (private, tested
 *     indirectly via `executeToolCall`'s
 *     `kind` field) — JSON object output is
 *     `'json'`, JSON scalar is `'text'`,
 *     free-form text is `'text'`
 *   - **5b-7**: `executeToolCall` short-circuits
 *     to `kind: 'error'` when the `isEnabled`
 *     predicate returns false — the model
 *     shouldn't have asked for a disabled
 *     tool, but the belt-and-braces check
 *     handles the "user toggled off mid-stream"
 *     race.
 *   - **5c**: `registerCustomTool` + the
 *     `kind` discriminator on `RegisteredTool`.
 *     The custom-tool handlers (`shell` /
 *     `http`) call `runCommand` / `httpRequest`
 *     IPCs; we test them with mocked IPCs
 *     (the same `invokeMock` pattern used
 *     elsewhere in the test suite).
 *
 * The `get_file_contents` handler itself is
 * integration-tested in `e2e/` and is mocked
 * out here (we just register stub handlers).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  executeToolCall,
  getTool,
  listTools,
  registerCustomTool,
  registerTool,
  type ToolHandler,
} from './toolRegistry';

// --- 5c: mocks for the new IPCs ---------------------------
//
// `toolRegistry`'s custom-tool handlers
// call `runCommand` and `httpRequest`,
// which are thin wrappers over the
// Tauri `invoke` function. We mock the
// `@tauri-apps/api/core` `invoke` so the
// handlers see deterministic responses
// in the tests.

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const STUB_NAME = 'stub_tool';

const stubHandler: ToolHandler = async (args) => {
  return `called with ${JSON.stringify(args)}`;
};

beforeEach(() => {
  // The registry is module-level, so we
  // re-register the stub fresh for each
  // test. We use a fresh name to avoid
  // clobbering the built-in
  // `get_file_contents` tool.
  registerTool({
    name: STUB_NAME,
    handler: stubHandler,
    description: 'A stub tool for tests.',
    kind: 'builtin',
  });
});

describe('toolRegistry basic CRUD', () => {
  it('round-trips a tool through registerTool / getTool', () => {
    const tool = getTool(STUB_NAME);
    expect(tool).toBeDefined();
    expect(tool?.name).toBe(STUB_NAME);
    expect(tool?.description).toBe('A stub tool for tests.');
    expect(tool?.handler).toBe(stubHandler);
  });

  it('listTools includes the stub and the built-in get_file_contents', () => {
    const tools = listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain(STUB_NAME);
    // The built-in is registered at module
    // load.
    expect(names).toContain('get_file_contents');
  });

  it('registerTool overwrites an existing tool with the same name', () => {
    const replacement: ToolHandler = async () => 'replacement';
    registerTool({
      name: STUB_NAME,
      handler: replacement,
      description: 'Replaced.',
      kind: 'builtin',
    });
    expect(getTool(STUB_NAME)?.handler).toBe(replacement);
    expect(getTool(STUB_NAME)?.description).toBe('Replaced.');
  });

  it('get_file_contents is registered as kind: builtin at module load', () => {
    // 5c: the built-in marker is part of
    // the public contract — the Settings
    // UI uses it to render builtin cards
    // differently from custom ones
    // (no Edit / Delete buttons).
    const tool = getTool('get_file_contents');
    expect(tool).toBeDefined();
    expect(tool?.kind).toBe('builtin');
    expect(tool?.customConfig).toBeUndefined();
  });
});

describe('toolRegistry.executeToolCall', () => {
  it('runs the handler with parsed arguments and returns a result', async () => {
    const result = await executeToolCall({
      toolCallId: 'call_1',
      name: STUB_NAME,
      arguments: '{"foo":"bar","n":42}',
    });
    expect(result.toolCallId).toBe('call_1');
    expect(result.output).toBe('called with {"foo":"bar","n":42}');
    // The stub returns a JSON-ish string
    // but it doesn't start with `{` after
    // the prefix, so classifyOutput should
    // call it 'text'. Actually 'called with
    // ...' starts with 'c', so it's
    // definitely 'text'.
    expect(result.kind).toBe('text');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns kind: error for an unknown tool name', async () => {
    const result = await executeToolCall({
      toolCallId: 'call_2',
      name: 'no_such_tool',
      arguments: '{}',
    });
    expect(result.kind).toBe('error');
    expect(result.output).toMatch(/Unknown tool 'no_such_tool'/);
    // The error message should also list
    // the available tools so the model
    // can self-correct.
    expect(result.output).toMatch(/Available tools:/);
  });

  it('falls back to an empty object when arguments is invalid JSON', async () => {
    const result = await executeToolCall({
      toolCallId: 'call_3',
      name: STUB_NAME,
      arguments: '{not valid json',
    });
    // The stub receives `{}` and returns
    // a deterministic string.
    expect(result.output).toBe('called with {}');
    expect(result.kind).toBe('text');
  });

  it('treats an empty arguments string as an empty object', async () => {
    const result = await executeToolCall({
      toolCallId: 'call_4',
      name: STUB_NAME,
      arguments: '',
    });
    expect(result.output).toBe('called with {}');
  });

  it('coerces non-object JSON (arrays, scalars) to an empty object', async () => {
    const arrayResult = await executeToolCall({
      toolCallId: 'call_5a',
      name: STUB_NAME,
      arguments: '[1,2,3]',
    });
    expect(arrayResult.output).toBe('called with {}');

    const scalarResult = await executeToolCall({
      toolCallId: 'call_5b',
      name: STUB_NAME,
      arguments: '"just a string"',
    });
    expect(scalarResult.output).toBe('called with {}');

    const nullResult = await executeToolCall({
      toolCallId: 'call_5c',
      name: STUB_NAME,
      arguments: 'null',
    });
    expect(nullResult.output).toBe('called with {}');
  });

  it('catches a thrown error from the handler and returns kind: error', async () => {
    const thrower: ToolHandler = async () => {
      throw new Error('boom');
    };
    registerTool({
      name: 'thrower',
      handler: thrower,
      description: 'Throws on purpose.',
      kind: 'builtin',
    });

    const result = await executeToolCall({
      toolCallId: 'call_6',
      name: 'thrower',
      arguments: '{}',
    });
    expect(result.kind).toBe('error');
    expect(result.output).toMatch(/'thrower' failed: boom/);
    // Even on error we measure duration;
    // it's typically 0 but the field is
    // present.
    expect(typeof result.durationMs).toBe('number');
  });

  it('classifies a JSON-object output as kind: json', async () => {
    const jsonHandler: ToolHandler = async () =>
      '{"answer":42,"list":[1,2,3]}';
    registerTool({
      name: 'json_tool',
      handler: jsonHandler,
      description: 'Returns JSON.',
      kind: 'builtin',
    });
    const result = await executeToolCall({
      toolCallId: 'call_7',
      name: 'json_tool',
      arguments: '{}',
    });
    expect(result.kind).toBe('json');
    expect(result.output).toBe('{"answer":42,"list":[1,2,3]}');
  });

  it('classifies a JSON-array output as kind: json', async () => {
    const arrHandler: ToolHandler = async () => '[1,2,3]';
    registerTool({
      name: 'arr_tool',
      handler: arrHandler,
      description: 'Returns an array.',
      kind: 'builtin',
    });
    const result = await executeToolCall({
      toolCallId: 'call_8',
      name: 'arr_tool',
      arguments: '{}',
    });
    expect(result.kind).toBe('json');
  });

  it('classifies a JSON-scalar output as kind: text', async () => {
    // The output starts with `"` (a JSON
    // string). It's valid JSON, but the
    // top-level value is a string, not an
    // object/array, so classifyOutput
    // should return 'text'.
    const scalarHandler: ToolHandler = async () => '"hello"';
    registerTool({
      name: 'scalar_tool',
      handler: scalarHandler,
      description: 'Returns a string.',
      kind: 'builtin',
    });
    const result = await executeToolCall({
      toolCallId: 'call_9',
      name: 'scalar_tool',
      arguments: '{}',
    });
    expect(result.kind).toBe('text');
  });

  it('classifies free-form text (not JSON) as kind: text', async () => {
    const result = await executeToolCall({
      toolCallId: 'call_10',
      name: STUB_NAME,
      arguments: '{}',
    });
    expect(result.kind).toBe('text');
  });

  // --- 5b-7: per-tool enable/disable -----------------------

  it('runs the handler when isEnabled is not provided (5b-6 default)', async () => {
    // Backwards-compat: the `isEnabled` arg is
    // optional. When absent, the registry
    // assumes "all enabled" (the 5b-6
    // behaviour). This test pins the
    // optional-arg contract — if someone
    // accidentally makes it required, this
    // will fail.
    const result = await executeToolCall({
      toolCallId: 'call_11',
      name: STUB_NAME,
      arguments: '{}',
    });
    expect(result.kind).toBe('text');
    expect(result.output).toBe('called with {}');
  });

  it('runs the handler when isEnabled(name) returns true', async () => {
    const isEnabled = () => true;
    const result = await executeToolCall(
      {
        toolCallId: 'call_12',
        name: STUB_NAME,
        arguments: '{}',
      },
      isEnabled,
    );
    expect(result.kind).toBe('text');
    expect(result.output).toBe('called with {}');
  });

  it('short-circuits to kind: error when isEnabled(name) returns false', async () => {
    // Only this specific tool is disabled.
    // The predicate is consulted BEFORE the
    // registry lookup, so the handler is
    // NOT invoked.
    const isEnabled = (name: string) => name !== STUB_NAME;
    const result = await executeToolCall(
      {
        toolCallId: 'call_13',
        name: STUB_NAME,
        arguments: '{}',
      },
      isEnabled,
    );
    expect(result.kind).toBe('error');
    expect(result.output).toMatch(/disabled/);
    // The error message should mention the
    // tool name so the model can
    // self-correct (e.g. "the user disabled
    // this tool, let me try a different
    // approach").
    expect(result.output).toMatch(new RegExp(`'${STUB_NAME}'`));
    // No work was done — duration is 0.
    expect(result.durationMs).toBe(0);
  });

  it('does not invoke the handler when the tool is disabled', async () => {
    // Register a sentinel handler that
    // throws on purpose. If the disabled
    // check is broken, the throw will
    // surface as a different `kind: 'error'`
    // (the "handler threw" path) and the
    // test will fail to distinguish them.
    let invocations = 0;
    const sentinel: ToolHandler = async () => {
      invocations += 1;
      return 'should-not-reach';
    };
    registerTool({
      name: 'sentinel_tool',
      handler: sentinel,
      description: 'Counts invocations.',
      kind: 'builtin',
    });
    const result = await executeToolCall(
      {
        toolCallId: 'call_14',
        name: 'sentinel_tool',
        arguments: '{}',
      },
      () => false,
    );
    expect(result.kind).toBe('error');
    expect(invocations).toBe(0);
  });
});

// --- 5c: custom tool handlers -----------------------------------
//
// `registerCustomTool` builds a handler
// from a `LipiToolEntry` and registers
// it in the same registry the AI store
// uses. The shell handler calls
// `run_command`; the http handler calls
// `http_request`. Both substitute
// `{arg}` placeholders before calling
// the IPC.
//
// We test the handlers end-to-end
// (register → execute → assert the IPC
// was called with the right args, and
// the result is the formatted output).

describe('toolRegistry.registerCustomTool (5c)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('registers a shell tool that calls run_command with substituted placeholders', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'run_command') {
        return Promise.resolve({
          stdout: 'ok',
          stderr: '',
          exitCode: 0,
          cancelled: false,
        });
      }
      return Promise.resolve(undefined);
    });

    registerCustomTool({
      name: 'run_npm_test',
      description: 'Run npm test in a package.',
      kind: 'shell',
      command: 'npm',
      args: ['test', '--prefix', '{package_dir}'],
      argsSpec: [
        { name: 'package_dir', type: 'string', description: 'Path to the package.' },
      ],
    });

    const tool = getTool('run_npm_test');
    expect(tool).toBeDefined();
    expect(tool?.kind).toBe('shell');
    expect(tool?.customConfig?.name).toBe('run_npm_test');

    const result = await executeToolCall({
      toolCallId: 'shell_call_1',
      name: 'run_npm_test',
      arguments: '{"package_dir":"packages/core"}',
    });
    expect(result.kind).toBe('text');
    // The header includes the exit code
    // (always, even on success — the
    // model uses it to detect failures).
    expect(result.output).toMatch(/Exit code: 0/);
    expect(result.output).toMatch(/--- stdout ---\nok/);

    // The IPC was called with the
    // substituted argv.
    const runCall = invokeMock.mock.calls.find((c) => c[0] === 'run_command');
    expect(runCall).toBeDefined();
    const ipcArgs = (runCall?.[1] as { args: { program: string; args: string[] } }).args;
    expect(ipcArgs.program).toBe('npm');
    expect(ipcArgs.args).toEqual(['test', '--prefix', 'packages%2Fcore']);
  });

  it('registers an http tool that calls http_request with substituted placeholders', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'http_request') {
        return Promise.resolve({
          status: 200,
          headers: [['Content-Type', 'application/json']],
          body: '{"id":"PROJ-1","summary":"Fix bug"}',
        });
      }
      return Promise.resolve(undefined);
    });

    registerCustomTool({
      name: 'fetch_jira',
      description: 'Fetch a Jira issue.',
      kind: 'http',
      url: 'https://example.atlassian.net/rest/api/3/issue/{key}',
      method: 'GET',
      headers: { Authorization: 'Bearer fake' },
      argsSpec: [
        { name: 'key', type: 'string', description: 'Jira key, e.g. PROJ-123.' },
      ],
    });

    const result = await executeToolCall({
      toolCallId: 'http_call_1',
      name: 'fetch_jira',
      arguments: '{"key":"PROJ-1"}',
    });
    expect(result.kind).toBe('text');
    expect(result.output).toMatch(/Status: 200/);
    expect(result.output).toMatch(/Content-Type: application\/json/);
    expect(result.output).toMatch(/--- body ---/);
    expect(result.output).toMatch(/PROJ-1/);

    const httpCall = invokeMock.mock.calls.find((c) => c[0] === 'http_request');
    expect(httpCall).toBeDefined();
    const ipcArgs = (httpCall?.[1] as {
      args: { url: string; method: string; headers: Record<string, string> };
    }).args;
    // The `{key}` placeholder is
    // substituted.
    expect(ipcArgs.url).toBe('https://example.atlassian.net/rest/api/3/issue/PROJ-1');
    expect(ipcArgs.method).toBe('GET');
    expect(ipcArgs.headers).toEqual({ Authorization: 'Bearer fake' });
  });

  it('substitutes missing placeholders with an empty string (the command will fail)', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'run_command') {
        return Promise.resolve({
          stdout: '',
          stderr: '',
          exitCode: 0,
          cancelled: false,
        });
      }
      return Promise.resolve(undefined);
    });

    registerCustomTool({
      name: 'needs_path',
      description: 'Needs a path.',
      kind: 'shell',
      command: 'cat',
      args: ['{path}'],
      argsSpec: [
        { name: 'path', type: 'string', description: 'File path.' },
      ],
    });

    // Model passes a number, not a
    // string. The substitution still
    // works (we coerce), so the IPC
    // sees the stringified number.
    await executeToolCall({
      toolCallId: 'sub_1',
      name: 'needs_path',
      arguments: '{"path":42}',
    });
    const runCall = invokeMock.mock.calls.find((c) => c[0] === 'run_command');
    const ipcArgs = (runCall?.[1] as { args: { args: string[] } }).args;
    expect(ipcArgs.args).toEqual(['42']);

    // Model omits the arg entirely.
    await executeToolCall({
      toolCallId: 'sub_2',
      name: 'needs_path',
      arguments: '{}',
    });
    const runCalls = invokeMock.mock.calls.filter((c) => c[0] === 'run_command');
    const lastArgs = (runCalls[runCalls.length - 1]?.[1] as { args: { args: string[] } }).args;
    // Empty string substitution.
    expect(lastArgs.args).toEqual(['']);
  });

  it('formats a non-zero exit as a kind: text result with the captured output', async () => {
    // The Tauri `invoke` rejects on
    // serialised errors (the `RunCommandError`
    // enum on the Rust side). We throw
    // the same shape the real IPC would.
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'run_command') {
        const err = new Error('command exited with status 1') as Error & {
          kind: string;
          code: number;
          stdout: string;
          stderr: string;
        };
        err.kind = 'nonZeroExit';
        err.code = 1;
        err.stdout = 'tests passed: 3';
        err.stderr = 'tests failed: 1\n  ✗ test_foo';
        return Promise.reject(err);
      }
      return Promise.resolve(undefined);
    });

    registerCustomTool({
      name: 'test',
      description: 'Run tests.',
      kind: 'shell',
      command: 'npm',
      args: ['test'],
      argsSpec: [],
    });

    const result = await executeToolCall({
      toolCallId: 'nz_1',
      name: 'test',
      arguments: '{}',
    });
    // Non-zero exit is still 'text' —
    // the model is expected to read
    // the output, not just see a red
    // banner.
    expect(result.kind).toBe('text');
    expect(result.output).toMatch(/exited with code 1/);
    expect(result.output).toMatch(/tests passed: 3/);
    expect(result.output).toMatch(/tests failed: 1/);
  });

  it('formats a timeout as a kind: text result', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'run_command') {
        const err = new Error('timed out') as Error & {
          kind: string;
          seconds: number;
        };
        err.kind = 'timeout';
        err.seconds = 30;
        return Promise.reject(err);
      }
      return Promise.resolve(undefined);
    });

    registerCustomTool({
      name: 'long',
      description: 'Takes a while.',
      kind: 'shell',
      command: 'sleep',
      args: ['60'],
      argsSpec: [],
    });

    const result = await executeToolCall({
      toolCallId: 't_1',
      name: 'long',
      arguments: '{}',
    });
    expect(result.kind).toBe('text');
    expect(result.output).toMatch(/timed out after 30s/);
  });

  it('formats a non-2xx http response with the response body', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'http_request') {
        const err = new Error('HTTP 404') as Error & {
          kind: string;
          status: number;
          body: string;
        };
        err.kind = 'non2xx';
        err.status = 404;
        err.body = '{"errorMessages":["No issue found"]}';
        return Promise.reject(err);
      }
      return Promise.resolve(undefined);
    });

    registerCustomTool({
      name: 'fetch_x',
      description: 'Fetch X.',
      kind: 'http',
      url: 'https://example.com/x',
      method: 'GET',
      argsSpec: [],
    });

    const result = await executeToolCall({
      toolCallId: 'nx_1',
      name: 'fetch_x',
      arguments: '{}',
    });
    expect(result.kind).toBe('text');
    expect(result.output).toMatch(/HTTP 404/);
    expect(result.output).toMatch(/No issue found/);
  });

  it('registerCustomTool replaces an existing tool with the same name (customToolsStore reload)', async () => {
    registerCustomTool({
      name: 'foo',
      description: 'First version.',
      kind: 'shell',
      command: 'echo',
      args: ['v1'],
      argsSpec: [],
    });
    expect(getTool('foo')?.description).toBe('First version.');

    // The store re-registers on every
    // reload. We simulate a reload by
    // calling registerCustomTool again
    // with a different entry.
    registerCustomTool({
      name: 'foo',
      description: 'Second version.',
      kind: 'shell',
      command: 'echo',
      args: ['v2'],
      argsSpec: [],
    });
    expect(getTool('foo')?.description).toBe('Second version.');
    expect(getTool('foo')?.customConfig?.description).toBe('Second version.');
  });
});
