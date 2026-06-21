/**
 * Tests for the per-(tabId, filePath)
 * trailing-debounce cursor mirror-back
 * helper used by `EditorPane`'s
 * `ActiveEditor`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EMPTY_TAB_STATE,
  useWorkspaceStore,
} from '@/shared/state/workspaceStore';

import {
  _flushPendingCursor,
  _resetCursorSchedulesForTests,
  scheduleCursorMirrorBack,
} from './scheduleCursorMirrorBack';

describe('scheduleCursorMirrorBack', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useWorkspaceStore.setState({
      hydrated: true,
      workspaces: [
        {
          id: 'tab-1',
          path: 'C:/proj',
          addedAt: 1,
          state: { ...EMPTY_TAB_STATE, editorCursorByPath: {} },
        },
      ],
      activeId: 'tab-1',
      recents: [],
      status: { kind: 'ready', path: 'C:/proj' },
    });
  });

  afterEach(() => {
    _resetCursorSchedulesForTests();
    vi.useRealTimers();
  });

  it('writes the cursor to editorCursorByPath after the debounce', () => {
    scheduleCursorMirrorBack('tab-1', 'C:/proj/index.ts', { line: 5, column: 3 });
    expect(
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
      useWorkspaceStore.getState().workspaces[0]!.state.editorCursorByPath,
    ).toEqual({});
    vi.advanceTimersByTime(500);
    expect(
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
      useWorkspaceStore.getState().workspaces[0]!.state.editorCursorByPath,
    ).toEqual({
      'C:/proj/index.ts': { line: 5, column: 3 },
    });
  });

  it('throttles multiple moves in the same debounce window (trailing debounce)', () => {
    for (let line = 1; line <= 10; line++) {
      scheduleCursorMirrorBack('tab-1', 'C:/proj/a.ts', { line, column: 1 });
    }
    vi.advanceTimersByTime(500);
    // Only the final value is written.
    expect(
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
      useWorkspaceStore.getState().workspaces[0]!.state.editorCursorByPath,
    ).toEqual({
      'C:/proj/a.ts': { line: 10, column: 1 },
    });
  });

  it('dispose flushes a pending write synchronously', () => {
    const dispose = scheduleCursorMirrorBack('tab-1', 'C:/proj/a.ts', {
      line: 7,
      column: 2,
    });
    // The 500ms debounce hasn't fired yet.
    expect(
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
      useWorkspaceStore.getState().workspaces[0]!.state.editorCursorByPath,
    ).toEqual({});
    dispose();
    // After dispose, the write is synchronously flushed.
    expect(
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
      useWorkspaceStore.getState().workspaces[0]!.state.editorCursorByPath,
    ).toEqual({
      'C:/proj/a.ts': { line: 7, column: 2 },
    });
    // Advancing timers does not double-write.
    vi.advanceTimersByTime(500);
    expect(
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
      useWorkspaceStore.getState().workspaces[0]!.state.editorCursorByPath,
    ).toEqual({
      'C:/proj/a.ts': { line: 7, column: 2 },
    });
  });

  it('dispose is a no-op when no write is pending', () => {
    scheduleCursorMirrorBack('tab-1', 'C:/proj/a.ts', { line: 1, column: 1 });
    vi.advanceTimersByTime(500);
    // Write fired.
    const before =
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
      useWorkspaceStore.getState().workspaces[0]!.state.editorCursorByPath;
    const flushed = _flushPendingCursor('tab-1', 'C:/proj/a.ts');
    // No schedule pending anymore.
    expect(flushed).toBe(false);
    const after =
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
      useWorkspaceStore.getState().workspaces[0]!.state.editorCursorByPath;
    expect(after).toBe(before);
  });

  it('multiple files in the same tab are debounced independently', () => {
    scheduleCursorMirrorBack('tab-1', 'C:/proj/a.ts', { line: 1, column: 1 });
    scheduleCursorMirrorBack('tab-1', 'C:/proj/b.ts', { line: 2, column: 2 });
    vi.advanceTimersByTime(500);
    expect(
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
      useWorkspaceStore.getState().workspaces[0]!.state.editorCursorByPath,
    ).toEqual({
      'C:/proj/a.ts': { line: 1, column: 1 },
      'C:/proj/b.ts': { line: 2, column: 2 },
    });
  });
});
