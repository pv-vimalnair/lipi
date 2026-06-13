/**
 * Tests for the v4 import
 * preview (`computeLipiStateV4ImportPreview`)
 * and the human-friendly
 * diff labels
 * (`previewDiffLabelV4`).
 *
 * The v4 preview is the v3
 * preview's analogue for the
 * multi-workspace-tabs world.
 * It surfaces per-tab
 * differences
 * (workspaces[] + per-tab
 * state) plus the v3-style
 * recents / voice / tool
 * settings diffs.
 */
import { describe, expect, it } from 'vitest';

import type { LipiStateV4Data } from './settingsIOv4';
import {
  computeLipiStateV4ImportPreview,
  previewDiffLabelV4,
} from './settingsIOv4.preview';

function tabWithState(
  path: string,
  id: string,
  state: {
    expandedDirs?: string[];
    selectedPath?: string | null;
    openEditorTabPaths?: string[];
    activeEditorTabPath?: string | null;
  } = {},
) {
  return {
    id,
    path,
    addedAt: 1000,
    state: {
      expandedDirs: state.expandedDirs ?? [],
      selectedPath: state.selectedPath ?? null,
      openEditorTabPaths: state.openEditorTabPaths ?? [],
      activeEditorTabPath: state.activeEditorTabPath ?? null,
    },
  };
}

const baseCurrent: LipiStateV4Data = {
  workspace: {
    workspaces: [tabWithState('C:/p1', 'cur-1')],
    activeId: 'cur-1',
    recents: ['C:/p1'],
  },
  voicePreferences: { provider: 'stub' },
  toolSettings: {
    disabledToolNames: [],
    confirmationMode: {},
  },
};

describe('computeLipiStateV4ImportPreview — no-op', () => {
  it('returns isNoOp: true when the current and incoming are identical', () => {
    const r = computeLipiStateV4ImportPreview(baseCurrent, baseCurrent);
    expect(r.isNoOp).toBe(true);
    expect(r.changeCount).toBe(0);
    expect(r.diffs).toEqual([]);
  });
});

describe('computeLipiStateV4ImportPreview — workspace.workspaces', () => {
  it('surfaces added tabs (paths in incoming not in current)', () => {
    const incoming: LipiStateV4Data = {
      ...baseCurrent,
      workspace: {
        ...baseCurrent.workspace,
        workspaces: [
          ...baseCurrent.workspace.workspaces,
          tabWithState('C:/p2', 'in-2'),
        ],
      },
    };
    const r = computeLipiStateV4ImportPreview(baseCurrent, incoming);
    const tabsDiff = r.diffs.find((d) => d.path === 'workspace.workspaces');
    expect(tabsDiff).toBeDefined();
    expect(tabsDiff!.after).toEqual({ added: ['C:/p2'], removed: [] });
  });

  it('surfaces removed tabs (paths in current not in incoming)', () => {
    const incoming: LipiStateV4Data = {
      ...baseCurrent,
      workspace: {
        ...baseCurrent.workspace,
        workspaces: [], // remove the only tab
        activeId: null,
      },
    };
    const r = computeLipiStateV4ImportPreview(baseCurrent, incoming);
    const tabsDiff = r.diffs.find((d) => d.path === 'workspace.workspaces');
    expect(tabsDiff).toBeDefined();
    expect(tabsDiff!.after).toEqual({ added: [], removed: [] });
    expect(tabsDiff!.before).toEqual({ added: [], removed: ['C:/p1'] });
  });

  it('surfaces both added and removed tabs in one diff row', () => {
    const incoming: LipiStateV4Data = {
      ...baseCurrent,
      workspace: {
        ...baseCurrent.workspace,
        workspaces: [tabWithState('C:/p2', 'in-2')], // removed p1, added p2
        activeId: 'in-2',
      },
    };
    const r = computeLipiStateV4ImportPreview(baseCurrent, incoming);
    const tabsDiff = r.diffs.find((d) => d.path === 'workspace.workspaces');
    expect(tabsDiff).toBeDefined();
    expect(tabsDiff!.after).toEqual({ added: ['C:/p2'], removed: [] });
    expect(tabsDiff!.before).toEqual({ added: [], removed: ['C:/p1'] });
  });
});

describe('computeLipiStateV4ImportPreview — per-tab state', () => {
  it('surfaces per-tab expandedDirs changes for matching tabs (matched by path)', () => {
    const current: LipiStateV4Data = {
      ...baseCurrent,
      workspace: {
        ...baseCurrent.workspace,
        workspaces: [
          tabWithState('C:/p1', 'cur-1', { expandedDirs: ['C:/p1/old'] }),
        ],
      },
    };
    const incoming: LipiStateV4Data = {
      ...baseCurrent,
      workspace: {
        ...baseCurrent.workspace,
        workspaces: [
          tabWithState('C:/p1', 'in-1', {
            expandedDirs: ['C:/p1/new', 'C:/p1/old'],
          }),
        ],
      },
    };
    const r = computeLipiStateV4ImportPreview(current, incoming);
    const dirsDiff = r.diffs.find((d) =>
      d.path.includes('state.expandedDirs'),
    );
    expect(dirsDiff).toBeDefined();
    expect(dirsDiff!.after).toEqual({ added: ['C:/p1/new'], removed: [] });
    expect(dirsDiff!.before).toEqual({ added: [], removed: [] });
  });

  it('surfaces per-tab selectedPath changes', () => {
    const current: LipiStateV4Data = {
      ...baseCurrent,
      workspace: {
        ...baseCurrent.workspace,
        workspaces: [
          tabWithState('C:/p1', 'cur-1', { selectedPath: 'C:/p1/old.ts' }),
        ],
      },
    };
    const incoming: LipiStateV4Data = {
      ...baseCurrent,
      workspace: {
        ...baseCurrent.workspace,
        workspaces: [
          tabWithState('C:/p1', 'in-1', { selectedPath: 'C:/p1/new.ts' }),
        ],
      },
    };
    const r = computeLipiStateV4ImportPreview(current, incoming);
    const selDiff = r.diffs.find((d) =>
      d.path.includes('state.selectedPath'),
    );
    expect(selDiff).toBeDefined();
    expect(selDiff!.before).toBe('C:/p1/old.ts');
    expect(selDiff!.after).toBe('C:/p1/new.ts');
  });

  it('surfaces per-tab openEditorTabPaths changes', () => {
    const current: LipiStateV4Data = {
      ...baseCurrent,
      workspace: {
        ...baseCurrent.workspace,
        workspaces: [
          tabWithState('C:/p1', 'cur-1', {
            openEditorTabPaths: ['C:/p1/old.ts'],
          }),
        ],
      },
    };
    const incoming: LipiStateV4Data = {
      ...baseCurrent,
      workspace: {
        ...baseCurrent.workspace,
        workspaces: [
          tabWithState('C:/p1', 'in-1', {
            openEditorTabPaths: ['C:/p1/new.ts', 'C:/p1/old.ts'],
          }),
        ],
      },
    };
    const r = computeLipiStateV4ImportPreview(current, incoming);
    const openDiff = r.diffs.find((d) =>
      d.path.includes('state.openEditorTabPaths'),
    );
    expect(openDiff).toBeDefined();
    expect(openDiff!.after).toEqual({
      added: ['C:/p1/new.ts'],
      removed: [],
    });
    expect(openDiff!.before).toEqual({
      added: [],
      removed: [],
    });
  });

  it('surfaces per-tab activeEditorTabPath changes', () => {
    const current: LipiStateV4Data = {
      ...baseCurrent,
      workspace: {
        ...baseCurrent.workspace,
        workspaces: [
          tabWithState('C:/p1', 'cur-1', {
            activeEditorTabPath: 'C:/p1/a.ts',
          }),
        ],
      },
    };
    const incoming: LipiStateV4Data = {
      ...baseCurrent,
      workspace: {
        ...baseCurrent.workspace,
        workspaces: [
          tabWithState('C:/p1', 'in-1', {
            activeEditorTabPath: 'C:/p1/b.ts',
          }),
        ],
      },
    };
    const r = computeLipiStateV4ImportPreview(current, incoming);
    const actDiff = r.diffs.find((d) =>
      d.path.includes('state.activeEditorTabPath'),
    );
    expect(actDiff).toBeDefined();
    expect(actDiff!.before).toBe('C:/p1/a.ts');
    expect(actDiff!.after).toBe('C:/p1/b.ts');
  });

  it('does NOT surface per-tab state for a tab that is "removed"', () => {
    // The tabs[] diff already
    // covers the "removed"
    // case. Per-tab state
    // diffs would be
    // redundant (the tab is
    // gone in the incoming
    // data, so the
    // comparison would be
    // against a tab that
    // doesn't exist in the
    // incoming array).
    const current: LipiStateV4Data = {
      ...baseCurrent,
      workspace: {
        ...baseCurrent.workspace,
        workspaces: [
          tabWithState('C:/p1', 'cur-1', {
            expandedDirs: ['C:/p1/a', 'C:/p1/b'],
            selectedPath: 'C:/p1/a.ts',
            openEditorTabPaths: ['C:/p1/a.ts', 'C:/p1/b.ts'],
            activeEditorTabPath: 'C:/p1/a.ts',
          }),
        ],
      },
    };
    const incoming: LipiStateV4Data = {
      ...baseCurrent,
      workspace: {
        ...baseCurrent.workspace,
        workspaces: [], // remove the tab
        activeId: null,
      },
    };
    const r = computeLipiStateV4ImportPreview(current, incoming);
    // The tabs[] diff is
    // the only diff for
    // this change.
    const tabsDiff = r.diffs.find((d) => d.path === 'workspace.workspaces');
    expect(tabsDiff).toBeDefined();
    // No per-tab state
    // diffs for the
    // removed tab.
    expect(
      r.diffs.find((d) => d.path.includes('state.')),
    ).toBeUndefined();
  });
});

describe('computeLipiStateV4ImportPreview — workspace.activeId', () => {
  it('surfaces activeId changes as a path diff (human-readable)', () => {
    const incoming: LipiStateV4Data = {
      ...baseCurrent,
      workspace: {
        ...baseCurrent.workspace,
        workspaces: [
          tabWithState('C:/p1', 'cur-1'),
          tabWithState('C:/p2', 'in-2'),
        ],
        activeId: 'in-2',
      },
    };
    const r = computeLipiStateV4ImportPreview(baseCurrent, incoming);
    const actDiff = r.diffs.find((d) => d.path === 'workspace.activeId');
    expect(actDiff).toBeDefined();
    // The diff is the
    // path, not the id.
    expect(actDiff!.before).toBe('C:/p1');
    expect(actDiff!.after).toBe('C:/p2');
  });
});

describe('computeLipiStateV4ImportPreview — recents, voice, tool settings', () => {
  it('surfaces recents changes', () => {
    const incoming: LipiStateV4Data = {
      ...baseCurrent,
      workspace: {
        ...baseCurrent.workspace,
        recents: ['C:/p2', 'C:/p1'],
      },
    };
    const r = computeLipiStateV4ImportPreview(baseCurrent, incoming);
    const recentsDiff = r.diffs.find((d) => d.path === 'workspace.recents');
    expect(recentsDiff).toBeDefined();
  });

  it('surfaces voicePreferences.provider changes', () => {
    const incoming: LipiStateV4Data = {
      ...baseCurrent,
      voicePreferences: { provider: 'wispr' },
    };
    const r = computeLipiStateV4ImportPreview(baseCurrent, incoming);
    const voiceDiff = r.diffs.find(
      (d) => d.path === 'voicePreferences.provider',
    );
    expect(voiceDiff).toBeDefined();
    expect(voiceDiff!.before).toBe('stub');
    expect(voiceDiff!.after).toBe('wispr');
  });

  it('surfaces toolSettings.disabledToolNames changes', () => {
    const incoming: LipiStateV4Data = {
      ...baseCurrent,
      toolSettings: {
        disabledToolNames: ['new_tool'],
        confirmationMode: {},
      },
    };
    const r = computeLipiStateV4ImportPreview(baseCurrent, incoming);
    const toolsDiff = r.diffs.find(
      (d) => d.path === 'toolSettings.disabledToolNames',
    );
    expect(toolsDiff).toBeDefined();
  });

  it('surfaces per-tool confirmationMode changes', () => {
    const incoming: LipiStateV4Data = {
      ...baseCurrent,
      toolSettings: {
        disabledToolNames: [],
        confirmationMode: { run_shell_command: 'per_call' },
      },
    };
    const r = computeLipiStateV4ImportPreview(baseCurrent, incoming);
    const modeDiff = r.diffs.find((d) =>
      d.path === 'toolSettings.confirmationMode.run_shell_command',
    );
    expect(modeDiff).toBeDefined();
  });
});

describe('previewDiffLabelV4', () => {
  it('formats workspace.workspaces with added/removed counts', () => {
    const label = previewDiffLabelV4({
      path: 'workspace.workspaces',
      before: { added: [], removed: ['/old'] },
      after: { added: ['/new'], removed: [] },
    });
    expect(label).toContain('Workspace tabs:');
    expect(label).toContain('+1 new');
    expect(label).toContain('-1 removed');
  });

  it('formats workspace.activeId with paths', () => {
    const label = previewDiffLabelV4({
      path: 'workspace.activeId',
      before: 'C:/old',
      after: 'C:/new',
    });
    expect(label).toBe('Active workspace: C:/old → C:/new');
  });

  it('formats per-tab expandedDirs with the tab path as a header', () => {
    const label = previewDiffLabelV4({
      path: 'workspace.workspaces[path=C:/p1].state.expandedDirs',
      before: { added: [], removed: ['C:/p1/old'] },
      after: { added: ['C:/p1/new'], removed: [] },
    });
    expect(label).toContain('Tab C:/p1');
    expect(label).toContain('+ C:/p1/new');
    expect(label).toContain('- C:/p1/old');
  });

  it('formats per-tab openEditorTabPaths with the tab path as a header', () => {
    const label = previewDiffLabelV4({
      path: 'workspace.workspaces[path=C:/p1].state.openEditorTabPaths',
      before: { added: [], removed: [] },
      after: { added: ['C:/p1/a.ts'], removed: [] },
    });
    expect(label).toContain('Tab C:/p1');
    expect(label).toContain('+ C:/p1/a.ts');
  });

  it('formats per-tab selectedPath with an arrow', () => {
    const label = previewDiffLabelV4({
      path: 'workspace.workspaces[path=C:/p1].state.selectedPath',
      before: 'C:/p1/old.ts',
      after: 'C:/p1/new.ts',
    });
    expect(label).toContain('Tab C:/p1');
    expect(label).toContain('C:/p1/old.ts');
    expect(label).toContain('C:/p1/new.ts');
  });

  it('formats per-tab activeEditorTabPath with an arrow', () => {
    const label = previewDiffLabelV4({
      path: 'workspace.workspaces[path=C:/p1].state.activeEditorTabPath',
      before: 'C:/p1/a.ts',
      after: 'C:/p1/b.ts',
    });
    expect(label).toContain('Tab C:/p1');
    expect(label).toContain('C:/p1/a.ts');
    expect(label).toContain('C:/p1/b.ts');
  });

  it('formats recents with added/removed counts', () => {
    const label = previewDiffLabelV4({
      path: 'workspace.recents',
      before: { added: [], removed: ['/old'] },
      after: { added: ['/new'], removed: [] },
    });
    expect(label).toContain('Recents list:');
    expect(label).toContain('+1 new');
    expect(label).toContain('-1 removed');
  });

  it('formats voicePreferences.provider with an arrow', () => {
    const label = previewDiffLabelV4({
      path: 'voicePreferences.provider',
      before: 'stub',
      after: 'wispr',
    });
    expect(label).toBe('Voice provider: stub → wispr');
  });

  it('formats toolSettings.disabledToolNames with per-tool bullets', () => {
    const label = previewDiffLabelV4({
      path: 'toolSettings.disabledToolNames',
      before: { added: [], removed: ['a'] },
      after: { added: ['b', 'c'], removed: [] },
    });
    expect(label).toContain('+ b');
    expect(label).toContain('+ c');
    expect(label).toContain('- a');
  });

  it('formats per-tool confirmationMode changes with the tool name', () => {
    const label = previewDiffLabelV4({
      path: 'toolSettings.confirmationMode.run_shell_command',
      before: 'always_confirm',
      after: 'per_call',
    });
    expect(label).toBe(
      'Tool "run_shell_command" confirmation: always_confirm → per_call',
    );
  });

  it('falls back to a generic arrow for unknown paths', () => {
    const label = previewDiffLabelV4({
      path: 'someFutureField.value',
      before: 'a',
      after: 'b',
    });
    expect(label).toContain('someFutureField.value');
    expect(label).toContain('a → b');
  });
});
