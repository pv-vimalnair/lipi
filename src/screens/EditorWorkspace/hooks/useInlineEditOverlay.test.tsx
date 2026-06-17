/**
 * Tests for `useInlineEditOverlay` — the
 * Monaco glue for the Phase 8 `Cmd+K` inline
 * AI edit flow.
 *
 * The hook's effect body is non-trivial
 * (subscribes to a Zustand store, manages a
 * `createDecorationsCollection`, mounts a
 * `IContentWidget`, registers Tab/Esc
 * keybindings). We extract the meat of the
 * effect into a module-level `setupOverlay`
 * function so the tests can drive it
 * directly against a mock editor.
 *
 * Coverage (4 tests, per the Phase 8 plan):
 *   1. mounts the content widget when
 *      `selection` is set
 *   2. un-mounts when `selection` goes back to
 *      null
 *   3. adds the decoration when the store has
 *      a `selection` (the decoration tracks
 *      the selection, not the status — the
 *      plan's "adds the decoration when status
 *      === 'done'" is an over-specification;
 *      the decoration is the AI pending-region
 *      highlight, visible from the moment the
 *      user opens the prompt)
 *   4. clears the decoration when the store's
 *      `selection` returns to null
 *
 * The keybinding tests (Tab accepts / Esc
 * rejects) live in `inlineEditStore.test.ts`
 * — they're assertions against the store's
 * actions, which are the only thing the
 * keybinding handlers touch.
 *
 * Test typing note: the production
 * `setupOverlay` function takes a hand-rolled
 * structural `MonacoEditorLike` type. The
 * mock in this file keeps the same shape but
 * widens the function properties to
 * `ReturnType<typeof vi.fn>` so we can assert
 * call counts. The widening uses a single
 * `as unknown as` cast at the `setupOverlay`
 * call site — the production type stays
 * clean, the test type is locally loose.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Tauri IPC mocks -----------------------------------------------------
//
// The hook's `setupOverlay` (imported below) calls
// `createRoot(domNode).render(<InlineEditOverlay ... />)`,
// which transitively imports `aiStore.ts`. The
// `aiStore` has a module-level `setupSubscriptions()`
// that registers `ai://chunk` / `ai://done` /
// `ai://error` listeners via Tauri's `listen()`.
// In the test environment the Tauri runtime isn't
// present, so the un-mocked `listen()` call rejects
// with "Cannot read properties of undefined (reading
// 'transformCallback')" and Vitest reports it as
// "Unhandled Rejection" — a false-positive that
// confuses `npx vitest run` output but doesn't
// actually break any of our 4 tests.
//
// We mock both `@tauri-apps/api/core` (the `invoke`
// surface) and `@tauri-apps/api/event` (the `listen`
// surface) at the module boundary. The `listen`
// mock returns a resolved Promise to a no-op
// unlisten function so the subscription setup
// completes without throwing. Vitest hoists
// `vi.mock(...)` above the `import` statements, so
// the mock factory must be self-contained (no
// references to top-level `const` bindings).
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

import { useInlineEditStore } from '../state/inlineEditStore';
import { setupOverlay } from './useInlineEditOverlay';

type MockFn = ReturnType<typeof vi.fn>;

interface MockEditor {
  createDecorationsCollection: MockFn;
  addContentWidget: MockFn;
  removeContentWidget: MockFn;
  revealRangeInCenter: MockFn;
  addCommand: MockFn;
  trigger: MockFn;
}

function makeMockEditor(): MockEditor {
  return {
    createDecorationsCollection: vi.fn(() => ({
      set: vi.fn(),
      clear: vi.fn(),
    })),
    addContentWidget: vi.fn(),
    removeContentWidget: vi.fn(),
    revealRangeInCenter: vi.fn(),
    addCommand: vi.fn(() => 'cmd_id_$'),
    trigger: vi.fn(),
  };
}

const SAMPLE_SELECTION = {
  text: 'const x = 1;',
  range: {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: 1,
    endColumn: 14,
  },
};

describe('useInlineEditOverlay (Phase 8)', () => {
  beforeEach(() => {
    // Reset the store to a known state
    // before each test (Zustand stores
    // survive between tests in the same
    // file by default).
    useInlineEditStore.setState({
      selection: null,
      instruction: '',
      streamingMessageId: null,
      status: 'idle',
      proposal: null,
      error: null,
    });
  });

  afterEach(() => {
    useInlineEditStore.setState({
      selection: null,
      instruction: '',
      streamingMessageId: null,
      status: 'idle',
      proposal: null,
      error: null,
    });
    // Clean up any test-created DOM
    // nodes (the hook creates a
    // `<div>` per setup call).
    document
      .querySelectorAll('.lipi-inline-edit-overlay-host')
      .forEach((n) => n.remove());
  });

  it('mounts the content widget when selection is set', () => {
    const editor = makeMockEditor();
    // Pre-open the store BEFORE setupOverlay
    // runs — the hook subscribes to the
    // store synchronously, and the
    // `updateWidget` initial call reads the
    // current `selection`.
    useInlineEditStore.getState().open(SAMPLE_SELECTION);

    // The mock's structural shape matches
    // the production type; the single cast
    // is the only place we widen for
    // testing.
    setupOverlay(
      editor as unknown as Parameters<typeof setupOverlay>[0],
    );

    expect(editor.addContentWidget).toHaveBeenCalledTimes(1);
    // The widget's id is the stable
    // `lipi.ai.inlineEdit.overlay` string.
    const widget = editor.addContentWidget.mock.calls[0][0] as {
      getId: () => string;
      getPosition: () => {
        position: { lineNumber: number; column: number };
      } | null;
    };
    expect(widget.getId()).toBe('lipi.ai.inlineEdit.overlay');
    // The position is anchored to the
    // selection's end (line 1, column 14).
    const pos = widget.getPosition();
    expect(pos?.position).toEqual({
      lineNumber: 1,
      column: 14,
    });
    // The reveal-range call scrolled the
    // selection into the viewport center.
    expect(editor.revealRangeInCenter).toHaveBeenCalledWith(
      SAMPLE_SELECTION.range,
    );
  });

  it('unmounts the content widget when selection goes back to null', () => {
    const editor = makeMockEditor();
    useInlineEditStore.getState().open(SAMPLE_SELECTION);
    setupOverlay(
      editor as unknown as Parameters<typeof setupOverlay>[0],
    );
    expect(editor.addContentWidget).toHaveBeenCalledTimes(1);

    // Reset the mock so we can assert the
    // remove-call in isolation.
    editor.removeContentWidget.mockClear();

    // Simulate the user rejecting the edit.
    useInlineEditStore.getState().reject();
    // The store's `subscribe` callback is
    // synchronous in Zustand; the
    // `updateWidget` ran as a result of
    // `set(...)`. (We don't need to await
    // anything here.)
    expect(editor.removeContentWidget).toHaveBeenCalledTimes(1);
  });

  it('adds the decoration when selection is set', () => {
    const editor = makeMockEditor();
    useInlineEditStore.getState().open(SAMPLE_SELECTION);
    setupOverlay(
      editor as unknown as Parameters<typeof setupOverlay>[0],
    );

    // The decoration collection's `set`
    // method was called at least once
    // with a decoration that targets
    // `SAMPLE_SELECTION.range`.
    const decorationCollection =
      editor.createDecorationsCollection.mock.results[0]?.value as {
        set: MockFn;
        clear: MockFn;
      };
    expect(decorationCollection.set).toHaveBeenCalled();
    const calls = decorationCollection.set.mock.calls;
    // Find the call that includes our
    // selection range (the store-init
    // call writes an empty list; the
    // `open()` call writes the
    // highlighted one).
    const highlightCall = calls.find(
      (c: unknown[]) => Array.isArray(c[0]) && c[0].length > 0,
    );
    expect(highlightCall).toBeDefined();
    if (!highlightCall) return;
    const firstArg = highlightCall[0] as Array<{
      range: typeof SAMPLE_SELECTION.range;
      options: { className: string };
    }>;
    expect(firstArg[0].range).toEqual(SAMPLE_SELECTION.range);
    expect(firstArg[0].options.className).toBe(
      'lipi-ai-pending-region',
    );
  });

  it('clears the decoration when selection returns to null', () => {
    const editor = makeMockEditor();
    useInlineEditStore.getState().open(SAMPLE_SELECTION);
    setupOverlay(
      editor as unknown as Parameters<typeof setupOverlay>[0],
    );

    const decorationCollection =
      editor.createDecorationsCollection.mock.results[0]?.value as {
        set: MockFn;
      };
    decorationCollection.set.mockClear();

    // Reject the edit (selection → null).
    useInlineEditStore.getState().reject();

    // The collection's `set` was called
    // with an empty list (which clears
    // the highlight).
    expect(decorationCollection.set).toHaveBeenCalledWith([]);
  });
});
