/* eslint-disable @typescript-eslint/no-non-null-assertion -- test assertions are guarded by prior expect().toBeDefined() */
/**
 * Tests for the v5 import preview. The v4
 * preview is the template; v5 extends the
 * per-tab preview with the 2 M6c fields.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { EMPTY_TAB_STATE, useWorkspaceStore } from '@/shared/state/workspaceStore';

import { type LipiStateV5Data } from './settingsIOv5';
import { computeLipiStateV5ImportPreview } from './settingsIOv5.preview';

const sampleData: LipiStateV5Data = {
  workspace: {
    workspaces: [
      {
        id: 'tab-1',
        path: 'C:/imported',
        addedAt: 1000,
        state: {
          ...EMPTY_TAB_STATE,
          editorCursorByPath: {
            'C:/imported/index.ts': { line: 10, column: 1 },
          },
          fileTreeScrollAnchor: 'C:/imported/src',
        },
      },
    ],
    activeId: 'tab-1',
    recents: ['C:/imported'],
  },
  voicePreferences: { provider: 'wispr' },
  toolSettings: { disabledToolNames: [], confirmationMode: {} },
};

describe('computeLipiStateV5ImportPreview', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      hydrated: true,
      workspaces: [],
      activeId: null,
      recents: [],
      status: { kind: 'idle' },
    });
  });

  it('emits a per-tab diff row for the new fileTreeScrollAnchor field', () => {
    // Seed the live state with the same tab (different
    // fileTreeScrollAnchor) so the diff is non-empty.
    useWorkspaceStore.setState({
      hydrated: true,
      workspaces: [
        {
          id: 'tab-1',
          path: 'C:/imported',
          addedAt: 1000,
          state: {
            ...EMPTY_TAB_STATE,
            fileTreeScrollAnchor: 'C:/imported/old',
          },
        },
      ],
      activeId: 'tab-1',
      recents: ['C:/imported'],
      status: { kind: 'ready', path: 'C:/imported' },
    });
    const current = useWorkspaceStore.getState();
    const preview = computeLipiStateV5ImportPreview(
      {
        workspace: {
          workspaces: current.workspaces.map((w) => ({
            id: w.id,
            path: w.path,
            addedAt: w.addedAt,
            state: w.state,
          })),
          activeId: current.activeId,
          recents: current.recents,
        },
        voicePreferences: { provider: 'stub' },
        toolSettings: { disabledToolNames: [], confirmationMode: {} },
      },
      sampleData,
    );
    const fileTreeScrollAnchorDiff = preview.diffs.find(
      (d) =>
        d.path ===
        'workspace.workspaces[path=C:/imported].state.fileTreeScrollAnchor',
    );
    expect(fileTreeScrollAnchorDiff).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
    expect(fileTreeScrollAnchorDiff!.before).toBe('C:/imported/old');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
    expect(fileTreeScrollAnchorDiff!.after).toBe('C:/imported/src');
  });

  it('emits a per-tab diff row for the editorCursorByPath entry count', () => {
    // Seed with 0 cursor entries; sample has 1 -- count diff.
    useWorkspaceStore.setState({
      hydrated: true,
      workspaces: [
        {
          id: 'tab-1',
          path: 'C:/imported',
          addedAt: 1000,
          state: { ...EMPTY_TAB_STATE, editorCursorByPath: {} },
        },
      ],
      activeId: 'tab-1',
      recents: ['C:/imported'],
      status: { kind: 'ready', path: 'C:/imported' },
    });
    const current = useWorkspaceStore.getState();
    const preview = computeLipiStateV5ImportPreview(
      {
        workspace: {
          workspaces: current.workspaces.map((w) => ({
            id: w.id,
            path: w.path,
            addedAt: w.addedAt,
            state: w.state,
          })),
          activeId: current.activeId,
          recents: current.recents,
        },
        voicePreferences: { provider: 'stub' },
        toolSettings: { disabledToolNames: [], confirmationMode: {} },
      },
      sampleData,
    );
    const cursorCountDiff = preview.diffs.find(
      (d) =>
        d.path ===
        'workspace.workspaces[path=C:/imported].state.editorCursorByPath',
    );
    expect(cursorCountDiff).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
    expect(cursorCountDiff!.before).toEqual({ count: 0 });
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
    expect(cursorCountDiff!.after).toEqual({ count: 1 });
  });

  it('reports isNoOp = true when current and incoming are identical', () => {
    const preview = computeLipiStateV5ImportPreview(sampleData, sampleData);
    expect(preview.isNoOp).toBe(true);
    expect(preview.changeCount).toBe(0);
  });
});
