/**
 * Tests for the command-palette command
 * registry + fuzzy filter.
 *
 * The store tests are colocated in
 * `commandPaletteStore.test.ts` (one
 * file per store, project convention).
 *
 * We test the pure `filterCommands`
 * function directly — no need to spin
 * up a React tree. The store tests
 * cover the React-side effects (open /
 * hide / selectedIndex reset on query
 * change).
 */

import { describe, expect, it, vi } from 'vitest';

// The command registry imports
// `useAiStore`, which calls
// `setupSubscriptions` on module
// load. That wires up Tauri's
// `listen()` for `ai://chunk`
// etc. We mock `@tauri-apps/api`
// so the import doesn't crash in
// the test environment (the same
// pattern is used by
// `aiStore.test.ts`).
//
// `vi.hoisted` is required because
// `vi.mock` is hoisted to the
// very top of the file, BEFORE
// the `const invokeMock = ...`
// declarations. Without
// `hoisted`, the factory would
// try to read a `const` that's
// still in its TDZ and throw
// "Cannot access X before
// initialization".
const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

import { COMMANDS, filterCommands } from './commands';

describe('command palette — filterCommands', () => {
  it('empty query returns the full list in registry order', () => {
    const result = filterCommands('');
    expect(result.map((r) => r.command.id)).toEqual(
      COMMANDS.map((c) => c.id),
    );
    expect(result.every((r) => r.score === 0)).toBe(true);
  });

  it('whitespace-only query is treated as empty', () => {
    const result = filterCommands('   ');
    expect(result).toHaveLength(COMMANDS.length);
  });

  it('exact title prefix match ranks first', () => {
    // "New" should match "New chat" as a
    // title prefix (score 0), beating any
    // subsequence match elsewhere.
    const result = filterCommands('New');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].command.id).toBe('chat.new');
    expect(result[0].score).toBe(0);
  });

  it('exact title match is still high-ranked', () => {
    // "Switch AI provider: OpenAI" —
    // looking up "openai" should match
    // the keyword "openai" with score 4
    // and the title with subsequence
    // score 2. Title wins.
    const result = filterCommands('openai');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].command.id).toBe('ai.provider.openai');
  });

  it('keyword matches still surface commands not in the title', () => {
    // "config" is only in the keywords
    // for `settings.open`, not in its
    // title.
    const result = filterCommands('config');
    expect(result.map((r) => r.command.id)).toContain('settings.open');
  });

  it('multi-term query: every term must match', () => {
    // "clear log" — both terms must
    // hit somewhere. "Clear activity
    // log" matches "clear" in title
    // and "log" in title.
    const result = filterCommands('clear log');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].command.id).toBe('tools.log.clear');
  });

  it('multi-term query: a non-matching term excludes the command', () => {
    // "clear xyz" — no command has
    // anything matching "xyz", so the
    // result is empty.
    const result = filterCommands('clear xyz');
    expect(result).toEqual([]);
  });

  it('is case-insensitive', () => {
    const upper = filterCommands('OPENAI');
    const lower = filterCommands('openai');
    expect(upper.map((r) => r.command.id)).toEqual(
      lower.map((r) => r.command.id),
    );
  });

  it('returns commands in stable registry order within the same score tier', () => {
    // "switch" appears in two
    // commands ("Switch AI
    // provider: OpenAI" and
    // "Switch AI provider:
    // Anthropic"). Both should
    // match; the OpenAI one comes
    // first in the registry, so it
    // comes first in the result.
    const result = filterCommands('switch');
    const openaiIdx = result.findIndex(
      (r) => r.command.id === 'ai.provider.openai',
    );
    const anthropicIdx = result.findIndex(
      (r) => r.command.id === 'ai.provider.anthropic',
    );
    expect(openaiIdx).toBeGreaterThanOrEqual(0);
    expect(anthropicIdx).toBeGreaterThanOrEqual(0);
    expect(openaiIdx).toBeLessThan(anthropicIdx);
  });

  it('subsequence match: chars must appear in order', () => {
    // "nwc" should match
    // "New chat" (n at 0, w at
    // 1, c at 4) — yes. The
    // subsequence matcher is
    // case-insensitive.
    const result = filterCommands('nwc');
    expect(result.map((r) => r.command.id)).toContain('chat.new');
  });

  it('no matches returns an empty list', () => {
    const result = filterCommands('xyzzy');
    expect(result).toEqual([]);
  });

  it('matches on subtitle text', () => {
    // "Re-enable" appears in
    // `tools.reset` subtitle but
    // not its title.
    const result = filterCommands('re-enable');
    expect(result.map((r) => r.command.id)).toContain('tools.reset');
  });

  it('groups are well-formed (every command declares a group)', () => {
    // Defensive: every
    // command in the
    // registry must
    // declare a group so
    // the modal can
    // render section
    // headers without
    // missing one.
    for (const cmd of COMMANDS) {
      expect(['Settings', 'Chat', 'AI', 'Tools', 'Voice', 'Help', 'Dev']).toContain(
        cmd.group,
      );
    }
  });

  it('dev commands are flagged', () => {
    // The dev-only commands
    // should be flagged. We
    // currently only have
    // one: the device
    // emulator toggle.
    const devCommands = COMMANDS.filter((c) => c.isDev);
    expect(devCommands.map((c) => c.id)).toEqual(['dev.emulator.toggle']);
  });

  it('every command has a non-empty id, title, and run function', () => {
    for (const cmd of COMMANDS) {
      expect(cmd.id).toBeTruthy();
      expect(cmd.title).toBeTruthy();
      expect(typeof cmd.run).toBe('function');
    }
  });

  it('command ids are unique', () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('command palette — workspace commands', () => {
  it('includes the Open Folder command with the global shortcut', () => {
    const open = COMMANDS.find((c) => c.id === 'workspace.open');
    expect(open).toBeDefined();
    expect(open?.title).toMatch(/open folder/i);
    expect(open?.shortcut).toEqual(['Cmd', 'Shift', 'O']);
  });

  it('includes the Close Folder command', () => {
    const close = COMMANDS.find((c) => c.id === 'workspace.close');
    expect(close).toBeDefined();
    expect(close?.title).toMatch(/close folder/i);
  });

  it('Close Folder is enabled only when a workspace is open', async () => {
    const {
      useWorkspaceStore,
    } = await import('@/shared/state/workspaceStore');
    useWorkspaceStore.setState({
      currentPath: null,
      hydrated: true,
      recents: [],
      status: { kind: 'idle' },
    });
    const close = COMMANDS.find((c) => c.id === 'workspace.close');
    expect(close?.isEnabled?.()).toBe(false);
    useWorkspaceStore.setState({ currentPath: '/x' });
    expect(close?.isEnabled?.()).toBe(true);
  });
});

describe('command palette — getRecentsCommands', () => {
  // Importing here (not
  // top-level) so the
  // workspace store is set
  // up only when this
  // describe runs. The
  // store is a module-
  // level singleton;
  // tests in this describe
  // share state.
  it('returns an empty array when there are no recents', async () => {
    const {
      useWorkspaceStore,
    } = await import('@/shared/state/workspaceStore');
    const { getRecentsCommands } = await import('./commands');
    useWorkspaceStore.setState({ recents: [] });
    expect(getRecentsCommands()).toEqual([]);
  });

  it('returns one command per recents entry, in order', async () => {
    const {
      useWorkspaceStore,
    } = await import('@/shared/state/workspaceStore');
    const { getRecentsCommands } = await import('./commands');
    useWorkspaceStore.setState({
      recents: ['/a', '/b', '/c'],
    });
    const cmds = getRecentsCommands();
    expect(cmds.map((c) => c.id)).toEqual([
      'workspace.recent.0',
      'workspace.recent.1',
      'workspace.recent.2',
    ]);
    expect(cmds[0]?.title).toMatch(/\/a$/);
    expect(cmds[1]?.title).toMatch(/\/b$/);
  });

  it('recents commands have stable ids so React keys do not churn', async () => {
    const {
      useWorkspaceStore,
    } = await import('@/shared/state/workspaceStore');
    const { getRecentsCommands } = await import('./commands');
    useWorkspaceStore.setState({ recents: ['/a', '/b'] });
    const ids1 = getRecentsCommands().map((c) => c.id);
    // Simulate a re-render
    // (the list didn't
    // change).
    const ids2 = getRecentsCommands().map((c) => c.id);
    expect(ids1).toEqual(ids2);
  });
});

describe('command palette — firstRun commands', () => {
  it('includes the "Reopen first-run setup" command', () => {
    const cmd = COMMANDS.find((c) => c.id === 'firstRun.openSetup');
    expect(cmd).toBeDefined();
    expect(cmd?.title).toMatch(/reopen/i);
    expect(cmd?.title).toMatch(/first-run|first run|setup/i);
  });

  it('"Reopen first-run setup" resets the firstRun store and closes the workspace', async () => {
    const { useFirstRunStore } = await import(
      '@/shared/state/firstRunStore'
    );
    const { useWorkspaceStore } = await import(
      '@/shared/state/workspaceStore'
    );
    useFirstRunStore.setState({ dismissed: true, hydrated: true });
    useWorkspaceStore.setState({
      currentPath: '/Users/me/projects/lipi',
      hydrated: true,
      recents: ['/Users/me/projects/lipi'],
      status: { kind: 'ready', path: '/Users/me/projects/lipi' },
    });
    const cmd = COMMANDS.find((c) => c.id === 'firstRun.openSetup');
    expect(cmd).toBeDefined();
    cmd?.run();
    // The dismissed flag is
    // cleared (so the panel
    // can re-show), and the
    // workspace is closed
    // (so the gate's
    // currentPath === null
    // condition is met
    // too).
    expect(useFirstRunStore.getState().dismissed).toBe(false);
    expect(useWorkspaceStore.getState().currentPath).toBeNull();
  });

  it('"Reopen first-run setup" is enabled even when no workspace is open', () => {
    // The command is always
    // runnable — the visible
    // panel still depends on
    // the gate, so a user can
    // re-arm the flag at any
    // time even if the panel
    // is currently hidden.
    const cmd = COMMANDS.find((c) => c.id === 'firstRun.openSetup');
    expect(cmd?.isEnabled?.() ?? true).toBe(true);
  });
});

describe('command palette — help.about command (F.6)', () => {
  it('registers an "About Lipi" command in the Help group', () => {
    const cmd = COMMANDS.find((c) => c.id === 'help.about');
    expect(cmd).toBeDefined();
    expect(cmd?.title).toMatch(/about lipi/i);
    expect(cmd?.group).toBe('Help');
  });

  it('"About Lipi" opens the aboutStore modal', async () => {
    const { useAboutStore } = await import('@/shared/state/aboutStore');
    // Reset before the assertion - other tests may
    // have left it open.
    useAboutStore.getState().hide();
    expect(useAboutStore.getState().isOpen).toBe(false);
    const cmd = COMMANDS.find((c) => c.id === 'help.about');
    expect(cmd).toBeDefined();
    cmd?.run();
    expect(useAboutStore.getState().isOpen).toBe(true);
    // Clean up
    useAboutStore.getState().hide();
  });

  it('"About Lipi" is always enabled (no isEnabled predicate needed)', () => {
    const cmd = COMMANDS.find((c) => c.id === 'help.about');
    // The user should be able to open About from
    // anywhere — no context gate.
    expect(cmd?.isEnabled?.() ?? true).toBe(true);
  });

  it('"about" is a fuzzy match (subsequence in title)', () => {
    const result = filterCommands('about');
    const ids = result.map((r) => r.command.id);
    expect(ids).toContain('help.about');
  });
});
