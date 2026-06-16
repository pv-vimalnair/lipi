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

  it('includes the new editorCursorByPath and fileTreeScrollAnchor sub-sections in the per-tab preview', () => {
    const preview = computeLipiStateV5ImportPreview(sampleData);
    expect(preview.workspaces).toHaveLength(1);
    const tabPreview = preview.workspaces[0]!;
    expect(tabPreview.editorCursorByPath).toEqual({
      'C:/imported/index.ts': { line: 10, column: 1 },
    });
    expect(tabPreview.fileTreeScrollAnchor).toBe('C:/imported/src');
  });

  it('reports per-tab cursor entry counts', () => {
    const preview = computeLipiStateV5ImportPreview(sampleData);
    const tabPreview = preview.workspaces[0]!;
    expect(tabPreview.editorCursorByPathCount).toBe(1);
  });

  it('marks a live-only tab as removed', () => {
    useWorkspaceStore.setState({
      hydrated: true,
      workspaces: [
        {
          id: 'live-only',
          path: 'C:/live',
          addedAt: 1,
          state: EMPTY_TAB_STATE,
        },
      ],
      activeId: 'live-only',
      recents: [],
      status: { kind: 'ready', path: 'C:/live' },
    });
    const preview = computeLipiStateV5ImportPreview(sampleData);
    const removed = preview.workspaces.find((w) => w.id === 'live-only');
    expect(removed).toBeDefined();
    expect(removed!.isRemoved).toBe(true);
    expect(removed!.isNew).toBe(false);
  });
});
