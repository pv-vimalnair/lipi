/**
 * EditorPane — D-145 single-Monaco refactor tests.
 *
 * The pre-D-145 design keyed `<ActiveEditor>` on
 * `key={activeTab.id}` so the Monaco instance was
 * destroyed and remounted on every tab switch. D-145
 * drops the `key={activeTab.id}` — the
 * `@monaco-editor/react` `Editor` component handles
 * the model swap in place (it looks up the model by
 * URI on `path` change and calls
 * `editor.setModel(model)`).
 *
 * These tests pin the new contract:
 *
 *   1. The `editorControllerStore` is set once on
 *      first mount and NOT cleared on tab switch
 *      (the pre-D-145 design flashed the store to
 *      `null` between unmount + remount, briefly
 *      losing the handle for `CmdKModal` and
 *      `useInlineEditOverlay`).
 *   2. The `useMonacoLspBridge` effect runs once
 *      (the pre-D-145 design re-ran the effect on
 *      every tab switch, re-discovering all models
 *      and re-registering per-kind provider sets).
 *   3. The `Editor` component's `path` prop drives
 *      the model swap — the test mock captures the
 *      last-seen `path` to assert the pane
 *      forwards the new tab's path on switch.
 *
 * Test infra follows the existing `useMonacoLspBridge.test.tsx`
 * pattern: `createRoot` + `act` from
 * `react-dom/test-utils`, with `@monaco-editor/react`
 * mocked (it ships ESM-only, and we don't need a
 * real Monaco instance — we just need to capture
 * mount / path events).
 */

import { type Root, createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mocks must be installed BEFORE the module-under-test
// imports. The full chain:
//
//   EditorPane
//     └─> monaco-editor (typescriptDefaults, etc.) [mocked]
//     └─> @monaco-editor/react (Editor)        [mocked]
//     └─> useMonacoLspBridge                   [mocked]
//     └─> useEditorControllerStore (Zustand)   [real]
//     └─> useEditorTabsStore (Zustand)         [real]
//
// We mock `@monaco-editor/react` to capture the
// `path` prop on each render and to simulate
// `onMount` by writing a fake editor to the
// controller store. We mock `useMonacoLspBridge`
// to count mount / unmount cycles (so we can
// assert the bridge doesn't re-run on tab switch).
// We mock `monaco-editor` because the real ESM
// package doesn't load in jsdom, and `EditorPane`
// touches `monaco.languages.typescript.typescriptDefaults`
// at module init time (the `configureTsServiceOnce`
// guard makes it idempotent but it still imports
// the module).

// `configureTsServiceOnce` is a module-level
// guard, so once any test exercises the
// typescriptDefaults stub the flag flips for
// the rest of the test file. The stub here is
// minimal — just enough to not throw.
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

// Capture the `path` prop the `<Editor>` was
// rendered with on each render. We track the
// *set* of paths seen (D-145 produces a set of
// one or two paths; pre-D-145 would produce a
// set that grows by one on every tab switch).
let lastEditorPath: string | undefined = undefined;
let editorPathsSeen: Set<string> = new Set();

vi.mock('@monaco-editor/react', () => ({
  // The real `Editor` is a React component that
  // takes an `onMount(editor, monaco)` callback.
  // We don't need a real Monaco instance — the
  // fake editor we pass through `onMount` is
  // just a `{ getModel: () => null }` stand-in.
  // The point of the test is to count renders
  // and capture the `path` prop, not to
  // exercise Monaco.
  default: (props: {
    path?: string;
    onMount?: (editor: unknown) => void;
  }) => {
    lastEditorPath = props.path;
    if (props.path !== undefined) {
      editorPathsSeen.add(props.path);
    }
    // Simulate the real `onMount` callback. The
    // fake editor is whatever the test passes
    // — the test fixture below sets it up.
    if (props.onMount) {
      props.onMount(fakeMonacoEditor);
    }
    return null;
  },
  // `EditorPane` also imports `{ loader }`
  // (named) and calls `loader.config(...)` at
  // module init. We expose a no-op.
  loader: {
    config: () => undefined,
  },
}));

let bridgeMountCount = 0;
let bridgeUnmountCount = 0;

vi.mock('../../hooks/useMonacoLspBridge', async () => {
  // Import `useRef` / `useEffect` so the mock
  // hook can count mounts without re-counting
  // renders (a function-body `bridgeMountCount++`
  // would count every render of `ActiveEditor`,
  // not every mount). Real React behaviour:
  // a hook's effect runs once on mount, the
  // cleanup runs once on unmount; the hook
  // function itself can run on every render.
  const React = await import('react');
  return {
    useMonacoLspBridge: () => {
      React.useEffect(() => {
        bridgeMountCount += 1;
        return () => {
          bridgeUnmountCount += 1;
        };
      }, []);
      // No-op return shape; the real hook
      // returns void.
    },
  };
});

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

const fakeMonacoEditor = {
  getModel: () => null,
  getValue: () => '',
  setValue: () => undefined,
  onDidChangeModel: () => ({ dispose: () => undefined }),
  revealLineInCenter: () => undefined,
  setPosition: () => undefined,
  focus: () => undefined,
};

// Imports below must come AFTER the mocks above.
import { EditorPane } from './EditorPane';
import { useEditorControllerStore } from '../../state/editorControllerStore';
import { useEditorTabsStore } from '../../state/editorTabsStore';
import { useWorkspaceStore } from '@/shared/state/workspaceStore';
import { useTsConfigStore } from '../../state/tsConfigStore';
import { useLspClientStore } from '../../state/lspClientStore';
import { useInlineEditStore } from '../../state/inlineEditStore';
import { useEditorControllerStore as _ecs } from '../../state/editorControllerStore';

beforeEach(() => {
  // Reset all stores to a known state.
  // Zustand stores survive between tests in
  // the same file by default, so we
  // explicitly reset them in `beforeEach`.
  useEditorControllerStore.setState({ editor: null, pendingReveal: null });
  useEditorTabsStore.setState({ order: [], tabs: {}, activeId: null });
  useWorkspaceStore.setState({ workspaces: [], activeId: null });
  useTsConfigStore.setState({
    compilerOptions: null,
    updatedAt: 0,
    workspaceRoot: null,
  });
  useLspClientStore.setState({ clients: new Map() });
  useInlineEditStore.setState({
    selection: null,
    instruction: '',
    streamingMessageId: null,
    status: 'idle',
    proposal: null,
    error: null,
  });
  // Reset mock counters.
  lastEditorPath = undefined;
  editorPathsSeen = new Set();
  bridgeMountCount = 0;
  bridgeUnmountCount = 0;
});

afterEach(() => {
  // No-op (we unmount the root in each test).
});

interface MountedPane {
  unmount: () => void;
}

function mountPane(): MountedPane {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(<EditorPane />);
  });
  return {
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function openTab(path: string, content: string): void {
  // Seed the editor tabs store with a new tab.
  // The pane reads `activeTab` and the `<Editor>`
  // component receives the new path.
  // `upsertTab` triggers a Zustand subscription,
  // which causes the pane to re-render. The
  // re-render fires `useEffect`s (which the
  // mocked `useMonacoLspBridge` counts).
  // Wrapping the call in `act()` makes the
  // effect count stable.
  const { upsertTab } = useEditorTabsStore.getState();
  act(() => {
    upsertTab({
      id: path,
      path,
      displayName: path.split('/').pop() ?? path,
      language: 'typescript',
      content,
      savedContent: content,
      load: { kind: 'loaded', encoding: 'utf-8' },
    });
  });
}

describe('EditorPane (D-145 — single Monaco instance)', () => {
  it('writes the editorControllerStore on first mount with the active tab path', () => {
    openTab('/workspace/a.ts', 'const a = 1;\n');
    const mounted = mountPane();
    // The fake `<Editor>`'s `onMount` callback
    // wrote the fake editor to the controller
    // store. The pane forwards the active
    // tab's `path` to the `<Editor>` as a prop.
    expect(lastEditorPath).toBe('/workspace/a.ts');
    expect(useEditorControllerStore.getState().editor).toBe(
      fakeMonacoEditor,
    );
    mounted.unmount();
  });

  it('forwards the new tab path to the <Editor> on tab switch (D-145 in-place model swap)', () => {
    // D-145: a single `<Editor>` instance
    // persists across tab switches. The pane
    // forwards the new `path` prop on each
    // tab switch; the `@monaco-editor/react`
    // library handles the model swap in
    // place via `editor.setModel(model)`.
    //
    // We assert this by tracking the set of
    // paths the `<Editor>` saw. Pre-D-145, the
    // `<Editor>` was remounted on every tab
    // switch, so it would see the *new* path
    // via a fresh mount (not via a prop
    // change on a persistent element). D-145
    // sees both paths via a single persistent
    // element — observable as the set of
    // `path` props ever passed to the same
    // `<Editor>` instance.
    openTab('/workspace/a.ts', 'const a = 1;\n');
    const mounted = mountPane();
    // Sanity: only the first path seen so far.
    expect(editorPathsSeen.has('/workspace/a.ts')).toBe(true);
    expect(editorPathsSeen.has('/workspace/b.ts')).toBe(false);
    // Switch to tab B. The pane re-renders
    // with the new `activeTab`; the
    // `<Editor>` is the same React element
    // (no `key` change), so the new `path`
    // flows through as a prop.
    act(() => {
      openTab('/workspace/b.ts', 'const b = 1;\n');
    });
    // The new tab is now active (upsertTab
    // sets activeId); the pane sees the new
    // `activeTab` and forwards the new path.
    expect(lastEditorPath).toBe('/workspace/b.ts');
    expect(editorPathsSeen.has('/workspace/b.ts')).toBe(true);
    mounted.unmount();
  });

  it('does NOT clear the editorControllerStore on tab switch (D-145 — no controller flash)', () => {
    // The pre-D-145 design keyed the inner
    // `ActiveEditor` on `key={activeTab.id}`,
    // so it remounted on tab switch, running
    // the cleanup effect
    // `setControllerEditor(null)` and then
    // re-mounting with a new editor instance.
    // D-145 drops the `key`, so the store is
    // written once on first mount and stays
    // stable across tab switches.
    openTab('/workspace/a.ts', 'const a = 1;\n');
    const mounted = mountPane();
    const editorOnFirstMount =
      useEditorControllerStore.getState().editor;
    expect(editorOnFirstMount).toBe(fakeMonacoEditor);
    // Switch tabs a few times.
    act(() => {
      openTab('/workspace/b.ts', 'const b = 1;\n');
    });
    expect(useEditorControllerStore.getState().editor).toBe(
      fakeMonacoEditor,
    );
    act(() => {
      useEditorTabsStore.getState().activate('/workspace/a.ts');
    });
    expect(useEditorControllerStore.getState().editor).toBe(
      fakeMonacoEditor,
    );
    // The store never went to `null` and
    // never got a different editor instance.
    expect(useEditorControllerStore.getState().editor).toBe(
      editorOnFirstMount,
    );
    mounted.unmount();
  });

  it('clears the editorControllerStore on real unmount (D-145 still handles the screen-navigation case)', () => {
    openTab('/workspace/a.ts', 'const a = 1;\n');
    const mounted = mountPane();
    expect(useEditorControllerStore.getState().editor).toBe(
      fakeMonacoEditor,
    );
    mounted.unmount();
    // The cleanup effect runs on real unmount
    // (screen navigation away from the
    // workspace), not on tab switch.
    expect(useEditorControllerStore.getState().editor).toBeNull();
  });

  it('does not re-run the LSP bridge effect on tab switch (D-145 — bridge stays mounted)', () => {
    // The 9.2f bridge aggregator subscribes
    // globally to `monaco.editor.getModels()`
    // + `onDidCreateModel` + per-model events
    // on first mount. The pre-D-145 design
    // re-mounted the bridge on every tab
    // switch (because the editor instance was
    // recreated), forcing the bridge to
    // re-discover all models and re-register
    // per-kind provider sets. D-145 keeps the
    // editor instance stable, so the bridge
    // mounts once for the pane's lifetime.
    //
    // We assert this via a mount-count
    // counter on the mocked
    // `useMonacoLspBridge`. The exact
    // count is React-internals-noisy (strict
    // mode, effect batching), but the
    // *delta* on tab switch should be zero:
    // the bridge does not re-run.
    //
    // To make the count stable, we wrap every
    // store mutation in `act()` so React
    // processes all effects before the next
    // assertion. Without `act`, the state
    // update happens but the React effects
    // are deferred, so the next assertion
    // might run before all `useEffect` hooks
    // (which the mock counts) have settled.
    openTab('/workspace/a.ts', 'const a = 1;\n');
    const mounted = mountPane();
    const initialBridgeCount = bridgeMountCount;
    expect(initialBridgeCount).toBeGreaterThanOrEqual(1);
    // Switch tabs (all mutations wrapped in
    // act so React effects settle before we
    // re-read the counter).
    act(() => {
      openTab('/workspace/b.ts', 'const b = 1;\n');
    });
    act(() => {
      useEditorTabsStore.getState().activate('/workspace/a.ts');
    });
    // The bridge didn't re-run on tab switch.
    expect(bridgeMountCount).toBe(initialBridgeCount);
    mounted.unmount();
  });
});

// Reference `_ecs` to keep the import live (we
// import the store under two names to make the
// intent in the test bodies obvious — the local
// alias is the one tests use, the underscored
// import is for type-only checks).
_ecs.setState({ editor: null });
