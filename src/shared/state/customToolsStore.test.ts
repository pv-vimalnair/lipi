/**
 * Tests for the `customToolsStore` (5c).
 *
 * Scope:
 *   - default state (empty list, no
 *     workspace, no error)
 *   - `load` from the Rust IPC: happy
 *     path, error path, file-not-found
 *     (the Rust side returns an empty
 *     file, NOT an error)
 *   - `addTool`: writes to the file,
 *     registers the tool, validation
 *     errors (empty name, bad chars,
 *     duplicate name, kind-specific
 *     missing fields)
 *   - `updateTool`: replaces by name,
 *     preserves order for unrelated
 *     entries
 *   - `removeTool`: filters by name,
 *     no-op for unknown name
 *   - `save` with no workspace open:
 *     errors and sets `lastError`
 *
 * The Rust IPC is mocked; the
 * `toolRegistry` is the real one (it
 * has a module-level singleton that
 * we read from for the "tool got
 * registered" assertions).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deregisterCustomTool,
  getTool,
  listTools,
} from '@/screens/EditorWorkspace/state/toolRegistry';
import { useCustomToolsStore } from './customToolsStore';

// --- Mocks for the new IPCs -----------------------------------
//
// `customToolsStore` calls `readLipiTools`
// and `writeLipiTools` from `@/ipc`. Both
// are thin wrappers over Tauri's
// `invoke`. We mock the underlying
// `invoke` directly so the store sees
// the same shape it would see in
// production.

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

// --- Helpers --------------------------------------------------

function makeShellEntry(name: string): import('@/ipc').LipiToolEntry {
  return {
    name,
    description: `Shell tool ${name}.`,
    kind: 'shell',
    command: 'echo',
    args: ['hello', '{arg}'],
    argsSpec: [{ name: 'arg', type: 'string', description: 'A string arg.' }],
  };
}

function makeHttpEntry(name: string): import('@/ipc').LipiToolEntry {
  return {
    name,
    description: `HTTP tool ${name}.`,
    kind: 'http',
    url: 'https://example.com/{arg}',
    method: 'GET',
    headers: { Authorization: 'Bearer fake' },
    argsSpec: [{ name: 'arg', type: 'string', description: 'A string arg.' }],
  };
}

function setupReadMock(tools: import('@/ipc').LipiToolEntry[]): void {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'read_lipi_tools') {
      return Promise.resolve({ version: 1, tools });
    }
    if (cmd === 'write_lipi_tools') {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(undefined);
  });
}

beforeEach(() => {
  invokeMock.mockReset();
  // Reset the store between tests —
  // the store is module-level and
  // state would otherwise leak.
  useCustomToolsStore.setState({
    tools: [],
    workspaceRoot: null,
    lastError: null,
    loaded: false,
    loading: false,
    saving: false,
  });
  for (const tool of listTools()) {
    if (tool.kind !== 'builtin') {
      deregisterCustomTool(tool.name);
    }
  }
});

// --- Tests ----------------------------------------------------

describe('customToolsStore default state', () => {
  it('starts with an empty list, no workspace, no error', () => {
    const s = useCustomToolsStore.getState();
    expect(s.tools).toEqual([]);
    expect(s.workspaceRoot).toBeNull();
    expect(s.lastError).toBeNull();
    expect(s.loaded).toBe(false);
    expect(s.loading).toBe(false);
    expect(s.saving).toBe(false);
  });

  it('getTool returns undefined for an unknown name', () => {
    expect(useCustomToolsStore.getState().getTool('nope')).toBeUndefined();
  });
});

describe('customToolsStore.load', () => {
  it('hydrates from the IPC and re-registers tools with the registry', async () => {
    const tools = [makeShellEntry('run_npm_test'), makeHttpEntry('fetch_jira')];
    setupReadMock(tools);

    await useCustomToolsStore.getState().load('/tmp/workspace');

    const s = useCustomToolsStore.getState();
    expect(s.tools).toEqual(tools);
    expect(s.workspaceRoot).toBe('/tmp/workspace');
    expect(s.loaded).toBe(true);
    expect(s.lastError).toBeNull();
    // The read IPC was called with
    // the workspace root.
    const readCall = invokeMock.mock.calls.find((c) => c[0] === 'read_lipi_tools');
    expect(readCall).toBeDefined();
    expect(readCall?.[1]).toEqual({ workspaceRoot: '/tmp/workspace' });
    expect(getTool('run_npm_test')?.kind).toBe('shell');
    expect(getTool('fetch_jira')?.kind).toBe('http');
  });

  it('deregisters stale custom tools when loading a new workspace file', async () => {
    setupReadMock([makeShellEntry('foo')]);
    await useCustomToolsStore.getState().load('/tmp/workspace-a');
    expect(getTool('foo')).toBeDefined();

    setupReadMock([makeShellEntry('bar')]);
    await useCustomToolsStore.getState().load('/tmp/workspace-b');

    expect(getTool('foo')).toBeUndefined();
    expect(getTool('bar')).toBeDefined();
  });

  it('handles an empty file (the Rust side returns the empty default, not an error)', async () => {
    setupReadMock([]);
    await useCustomToolsStore.getState().load('/tmp/workspace');
    expect(useCustomToolsStore.getState().tools).toEqual([]);
    expect(useCustomToolsStore.getState().lastError).toBeNull();
  });

  it('sets lastError on IPC failure and still marks loaded (so the UI does not loop)', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'read_lipi_tools') {
        return Promise.reject(new Error('disk on fire'));
      }
      return Promise.resolve(undefined);
    });
    await useCustomToolsStore.getState().load('/tmp/workspace');
    const s = useCustomToolsStore.getState();
    expect(s.lastError).toMatch(/Failed to load lipi-tools\.json.*disk on fire/);
    expect(s.loaded).toBe(true);
    expect(s.tools).toEqual([]);
  });
});

describe('customToolsStore.addTool', () => {
  beforeEach(() => {
    setupReadMock([]);
  });

  it('adds a new tool, registers it, and writes the file', async () => {
    await useCustomToolsStore.getState().load('/tmp/workspace');
    const entry = makeShellEntry('run_npm_test');
    await useCustomToolsStore.getState().addTool(entry);

    const s = useCustomToolsStore.getState();
    expect(s.tools).toEqual([entry]);
    expect(s.lastError).toBeNull();

    // The write IPC was called with
    // the file shape.
    const writeCall = invokeMock.mock.calls.find((c) => c[0] === 'write_lipi_tools');
    expect(writeCall).toBeDefined();
    const ipcArgs = (writeCall?.[1] as {
      workspaceRoot: string;
      file: { version: number; tools: import('@/ipc').LipiToolEntry[] };
    });
    expect(ipcArgs.workspaceRoot).toBe('/tmp/workspace');
    expect(ipcArgs.file.version).toBe(1);
    expect(ipcArgs.file.tools).toEqual([entry]);
  });

  it('rejects an empty tool name', async () => {
    await useCustomToolsStore.getState().load('/tmp/workspace');
    await expect(
      useCustomToolsStore.getState().addTool({
        ...makeShellEntry(''),
        name: '',
      }),
    ).rejects.toThrow(/name is required/);
    // No file write happened.
    const writeCalls = invokeMock.mock.calls.filter((c) => c[0] === 'write_lipi_tools');
    expect(writeCalls).toHaveLength(0);
  });

  it('rejects a tool name with invalid identifier chars', async () => {
    await useCustomToolsStore.getState().load('/tmp/workspace');
    await expect(
      useCustomToolsStore.getState().addTool(makeShellEntry('has space')),
    ).rejects.toThrow(/valid identifier/);
  });

  it('rejects a duplicate tool name', async () => {
    await useCustomToolsStore.getState().load('/tmp/workspace');
    await useCustomToolsStore.getState().addTool(makeShellEntry('foo'));
    await expect(
      useCustomToolsStore.getState().addTool(makeShellEntry('foo')),
    ).rejects.toThrow(/already used/);
  });

  it('rejects a shell tool with no command', async () => {
    await useCustomToolsStore.getState().load('/tmp/workspace');
    await expect(
      useCustomToolsStore.getState().addTool({
        ...makeShellEntry('no_cmd'),
        command: '',
      }),
    ).rejects.toThrow(/Shell tools require a 'command' field/);
  });

  it('rejects an http tool with no url', async () => {
    await useCustomToolsStore.getState().load('/tmp/workspace');
    await expect(
      useCustomToolsStore.getState().addTool({
        ...makeHttpEntry('no_url'),
        url: '',
      }),
    ).rejects.toThrow(/HTTP tools require a 'url' field/);
  });
});

describe('customToolsStore.updateTool', () => {
  beforeEach(() => {
    setupReadMock([makeShellEntry('foo'), makeShellEntry('bar')]);
  });

  it('replaces an existing tool by name and writes the file', async () => {
    await useCustomToolsStore.getState().load('/tmp/workspace');
    const updated: import('@/ipc').LipiToolEntry = {
      ...makeShellEntry('foo'),
      description: 'Updated description.',
    };
    await useCustomToolsStore.getState().updateTool(updated);

    const s = useCustomToolsStore.getState();
    // Order preserved — `foo` keeps
    // its position, `bar` is
    // untouched.
    expect(s.tools.map((t) => t.name)).toEqual(['foo', 'bar']);
    expect(s.tools[0].description).toBe('Updated description.');
    // Write happened.
    const writeCall = invokeMock.mock.calls.find((c) => c[0] === 'write_lipi_tools');
    expect(writeCall).toBeDefined();
  });

  it('renames a tool and deregisters the old handler', async () => {
    await useCustomToolsStore.getState().load('/tmp/workspace');
    expect(getTool('foo')).toBeDefined();

    const renamed: import('@/ipc').LipiToolEntry = {
      ...makeShellEntry('renamed_foo'),
      description: 'Renamed description.',
    };
    await useCustomToolsStore.getState().updateTool(renamed, 'foo');

    const s = useCustomToolsStore.getState();
    expect(s.tools.map((t) => t.name)).toEqual(['renamed_foo', 'bar']);
    expect(getTool('foo')).toBeUndefined();
    expect(getTool('renamed_foo')?.customConfig?.description).toBe('Renamed description.');
  });
});

describe('customToolsStore.removeTool', () => {
  beforeEach(() => {
    setupReadMock([makeShellEntry('foo'), makeShellEntry('bar')]);
  });

  it('removes a tool by name and writes the file', async () => {
    await useCustomToolsStore.getState().load('/tmp/workspace');
    expect(getTool('foo')).toBeDefined();
    await useCustomToolsStore.getState().removeTool('foo');
    const s = useCustomToolsStore.getState();
    expect(s.tools.map((t) => t.name)).toEqual(['bar']);
    expect(getTool('foo')).toBeUndefined();
    expect(getTool('bar')).toBeDefined();
    const writeCall = invokeMock.mock.calls.find((c) => c[0] === 'write_lipi_tools');
    expect(writeCall).toBeDefined();
  });

  it('can re-add a removed tool with fresh registry config', async () => {
    await useCustomToolsStore.getState().load('/tmp/workspace');
    await useCustomToolsStore.getState().removeTool('foo');
    expect(getTool('foo')).toBeUndefined();

    const replacement = {
      ...makeShellEntry('foo'),
      description: 'Fresh replacement.',
    };
    await useCustomToolsStore.getState().addTool(replacement);

    expect(getTool('foo')?.customConfig?.description).toBe('Fresh replacement.');
    expect(useCustomToolsStore.getState().tools.map((t) => t.name)).toEqual(['bar', 'foo']);
  });

  it('is a no-op for an unknown name', async () => {
    await useCustomToolsStore.getState().load('/tmp/workspace');
    invokeMock.mockClear();
    await useCustomToolsStore.getState().removeTool('nope');
    // No write should have happened.
    const writeCalls = invokeMock.mock.calls.filter((c) => c[0] === 'write_lipi_tools');
    expect(writeCalls).toHaveLength(0);
    // The list is unchanged.
    expect(useCustomToolsStore.getState().tools.map((t) => t.name)).toEqual(['foo', 'bar']);
  });
});

describe('customToolsStore.save (no workspace)', () => {
  it('errors and sets lastError when no workspace is open', async () => {
    await expect(useCustomToolsStore.getState().save()).rejects.toThrow(/No workspace/);
    expect(useCustomToolsStore.getState().lastError).toMatch(/No workspace/);
  });
});
