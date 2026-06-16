/**
 * EditorPane — M6c editor cursor
 * rehydrate + mirror-back tests.
 *
 * These tests pin the M6c contract:
 *
 *   1. **First model mount restores saved
 *      cursor** — pre-populate
 *      `editorCursorByPath[path]`, mount
 *      `<ActiveEditor path=path ...>`, fire
 *      the `onDidChangeModel` callback, assert
 *      the fake `editor.setPosition` was
 *      called with the saved cursor.
 *   2. **Rehydrate is suppressed in
 *      mirror-back** — when the rehydrate
 *      calls `setPosition`, the
 *      `onDidChangeCursorPosition` that
 *      follows must NOT schedule a
 *      mirror-back (the rehydrate itself
 *      would round-trip through the store).
 *   3. **onDidChangeCursorPosition schedules
 *      a mirror-back** — fire the
 *      `onDidChangeCursorPosition` callback
 *      with a new position, advance timers,
 *      assert `editorCursorByPath[path]` has
 *      the new position.
 *   4. **Multiple cursor moves coalesce** —
 *      N moves in the debounce window, advance
 *      timers, assert the final value is
 *      written.
 *   5. **Flush on unmount** — call
 *      `onDidChangeCursorPosition` with a new
 *      position, unmount before the 500ms
 *      fires, assert the write landed
 *      synchronously via the unmount
 *      cleanup's `_flushPendingCursor` call.
 *
 * Test infra follows the existing
 * `EditorPane.test.tsx` pattern: capture
 * the `onMount` callback and feed it a
 * fake editor with spyable methods. We
 * mock `@monaco-editor/react` to provide
 * the editor ref + subscription plumbing.
 */

import { type Root, createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('monaco-editor', () => ({
  languages: {
    typescript: {
      typescriptDefaults: {
        setCompilerOptions: () => undefined,
        setDiagnosticsOptions: () => undefined,
      },
      javascriptDefaults: {
        setCompilerOptions: () => undefined,
      },
      ScriptTarget: { ES2020: 7 },
      ModuleKind: { ESNext: 199 },
      ModuleResolutionKind: { NodeJs: 2 },
      JsxEmit: { ReactJSX: 4 },
    },
  },
}));

interface FakeSubscription {
  dispose: () => void;
}

interface FakeMonacoEditor {
  getModel: () => { uri: { path: string } } | null;
  getValue: () => string;
  setValue: (s: string) => void;
  onDidChangeModel: (cb: () => void) => FakeSubscription;
  onDidChangeCursorPosition: (
    cb: (e: { position: { lineNumber: number; column: number } }) => void,
  ) => FakeSubscription;
  revealLineInCenter: (line: number) => void;
  revealPositionInCenterIfOutsideViewport: (pos: {
    lineNumber: number;
    column: number;
  }) => void;
  setPosition: (pos: { lineNumber: number; column: number }) => void;
  getPosition: () => { lineNumber: number; column: number } | null;
  focus: () => void;
  _fireModelChange: () => void;
  _fireCursorChange: (line: number, column: number) => void;
}

let lastEditor: FakeMonacoEditor | null = null;

function makeFakeEditor(
  initialModelPath: string | null,
): FakeMonacoEditor {
  let modelPath: string | null = initialModelPath;
  let position: { lineNumber: number; column: number } | null = null;
  const modelListeners: Array<() => void> = [];
  const cursorListeners: Array<
    (e: { position: { lineNumber: number; column: number } }) => void
  > = [];
  const setPositionCalls: Array<{ lineNumber: number; column: number }> = [];

  return {
    getModel: () =>
      modelPath === null ? null : { uri: { path: modelPath } },
    getValue: () => '',
    setValue: () => undefined,
    onDidChangeModel: (cb) => {
      modelListeners.push(cb);
      return { dispose: () => undefined };
    },
    onDidChangeCursorPosition: (cb) => {
      cursorListeners.push(cb);
      return { dispose: () => undefined };
    },
    revealLineInCenter: () => undefined,
    revealPositionInCenterIfOutsideViewport: () => undefined,
    setPosition: (pos) => {
      setPositionCalls.push(pos);
      position = pos;
    },
    getPosition: () => position,
    focus: () => undefined,
    _fireModelChange: () => {
      for (const l of modelListeners) l();
    },
    _fireCursorChange: (line, column) => {
      for (const l of cursorListeners) l({ position: { lineNumber: line, column } });
    },
  };
}

vi.mock('@monaco-editor/react', () => ({
  default: (props: { path?: string; onMount?: (e: unknown) => void }) => {
    // Simulate mount with whatever fake editor the
    // test fixture installed.
    if (props.onMount) {
      props.onMount(lastEditor);
    }
    return null;
  },
  loader: { config: () => undefined },
}));

vi.mock('../../hooks/useMonacoLspBridge', () => ({
  useMonacoLspBridge: () => undefined,
}));

vi.mock('../../hooks/useInlineEditOverlay', () => ({
  useInlineEditOverlay: () => undefined,
}));

vi.mock('../../hooks/useEditorTabs', () => ({
  useEditorTabs: () => ({
    saveActive: vi.fn(async () => undefined),
    setContent: vi.fn(),
  }),
}));

vi.mock('@/shared/hooks', () => ({
  useKeyboardShortcut: () => undefined,
}));

import { EditorPane } from './EditorPane';
import { EMPTY_TAB_STATE, useWorkspaceStore } from '@/shared/state/workspaceStore';
import { useEditorTabsStore } from '../../state/editorTabsStore';
import { _resetCursorSchedulesForTests } from './scheduleCursorMirrorBack';

const FAKE_PATH = 'C:/proj/index.ts';

function seedActiveTab(editorCursorByPath: Record<string, { line: number; column: number }>) {
  useWorkspaceStore.setState({
    hydrated: true,
    workspaces: [
      {
        id: 'tab-1',
        path: 'C:/proj',
        addedAt: 1,
        state: {
          ...EMPTY_TAB_STATE,
          openEditorTabPaths: [FAKE_PATH],
          editorCursorByPath,
        },
      },
    ],
    activeId: 'tab-1',
    recents: ['C:/proj'],
    status: { kind: 'ready', path: 'C:/proj' },
  });
  // EditorPane reads the active tab from the
  // editor tabs store, not the workspace store.
  // The cursor test mirrors the existing
  // EditorPane.test.tsx pattern: seed the editor
  // tabs store with a tab at the fake path, and
  // mark it as the active one.
  useEditorTabsStore.setState({
    order: [FAKE_PATH],
    tabs: {
      [FAKE_PATH]: {
        id: FAKE_PATH,
        path: FAKE_PATH,
        displayName: FAKE_PATH.split('/').pop() ?? FAKE_PATH,
        language: 'typescript',
        content: 'const x = 1;\n',
        savedContent: 'const x = 1;\n',
        load: { kind: 'loaded', encoding: 'utf-8' },
      },
    },
    activeId: FAKE_PATH,
  });
}

describe('EditorPane — M6c editor cursor', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    _resetCursorSchedulesForTests();
    vi.useRealTimers();
    useWorkspaceStore.setState({
      hydrated: false,
      workspaces: [],
      activeId: null,
      recents: [],
      status: { kind: 'idle' },
    });
    lastEditor = null;
    useEditorTabsStore.setState({ order: [], tabs: {}, activeId: null });
  });

  it('restores the saved cursor on first model mount', () => {
    seedActiveTab({ [FAKE_PATH]: { line: 12, column: 4 } });
    const editor = makeFakeEditor(FAKE_PATH);
    lastEditor = editor;

    act(() => {
      root.render(<EditorPane />);
    });

    // The store has the saved cursor; mount-time
    // triggers `onMount` → `onDidChangeModel` fires →
    // the cursor-rehydrate branch runs.
    act(() => {
      editor._fireModelChange();
    });

    // Verify: the editor was repositioned. We can't
    // assert on the `setPosition` call count directly
    // (the fake doesn't capture), but we can verify
    // that the editor's position is now the saved one.
    expect(editor.getPosition()).toEqual({
      lineNumber: 12,
      column: 4,
    });
  });

  it('rehydrate suppresses the mirror-back for that one tick', () => {
    seedActiveTab({ [FAKE_PATH]: { line: 12, column: 4 } });
    const editor = makeFakeEditor(FAKE_PATH);
    lastEditor = editor;

    act(() => {
      root.render(<EditorPane />);
    });

    // Fire the model change (triggers rehydrate).
    act(() => {
      editor._fireModelChange();
    });

    // Fire a cursor change IMMEDIATELY after — the
    // rehydrate's suppressNextCursorChange.current
    // should swallow this one event.
    act(() => {
      editor._fireCursorChange(1, 1);
    });

    vi.advanceTimersByTime(500);

    // The store should NOT have a (1,1) write — the
    // rehydrate's setPosition triggered the
    // onDidChangeCursorPosition, but the suppress
    // flag short-circuited the mirror-back.
    const after =
      useWorkspaceStore.getState().workspaces[0]!.state.editorCursorByPath;
    // The pre-populated (12, 4) is still there (we
    // didn't touch the store during the test).
    expect(after).toEqual({ [FAKE_PATH]: { line: 12, column: 4 } });
  });

  it('onDidChangeCursorPosition schedules a mirror-back after the debounce', () => {
    seedActiveTab({});
    const editor = makeFakeEditor(FAKE_PATH);
    lastEditor = editor;

    act(() => {
      root.render(<EditorPane />);
    });

    // Fire a cursor change.
    act(() => {
      editor._fireCursorChange(7, 2);
    });

    // The 500ms debounce hasn't fired yet.
    expect(
      useWorkspaceStore.getState().workspaces[0]!.state.editorCursorByPath,
    ).toEqual({});

    vi.advanceTimersByTime(500);

    // The store now has the new position.
    expect(
      useWorkspaceStore.getState().workspaces[0]!.state.editorCursorByPath,
    ).toEqual({ [FAKE_PATH]: { line: 7, column: 2 } });
  });

  it('multiple cursor moves in the debounce window coalesce to the final value', () => {
    seedActiveTab({});
    const editor = makeFakeEditor(FAKE_PATH);
    lastEditor = editor;

    act(() => {
      root.render(<EditorPane />);
    });

    for (let line = 1; line <= 10; line++) {
      act(() => {
        editor._fireCursorChange(line, 1);
      });
    }

    vi.advanceTimersByTime(500);

    expect(
      useWorkspaceStore.getState().workspaces[0]!.state.editorCursorByPath,
    ).toEqual({ [FAKE_PATH]: { line: 10, column: 1 } });
  });

  it('unmount flushes the pending cursor synchronously', () => {
    seedActiveTab({});
    const editor = makeFakeEditor(FAKE_PATH);
    lastEditor = editor;

    act(() => {
      root.render(<EditorPane />);
    });

    // Fire a cursor change.
    act(() => {
      editor._fireCursorChange(42, 7);
    });

    // The 500ms debounce hasn't fired yet.
    expect(
      useWorkspaceStore.getState().workspaces[0]!.state.editorCursorByPath,
    ).toEqual({});

    // Unmount before the timer fires. The cleanup
    // calls `_flushPendingCursor` synchronously.
    act(() => {
      root.unmount();
    });

    // The write is persisted.
    expect(
      useWorkspaceStore.getState().workspaces[0]!.state.editorCursorByPath,
    ).toEqual({ [FAKE_PATH]: { line: 42, column: 7 } });
  });
});
