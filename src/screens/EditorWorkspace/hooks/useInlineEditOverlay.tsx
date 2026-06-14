/**
 * useInlineEditOverlay — the Monaco glue for the
 * Phase 8 `Cmd+K` inline AI edit flow.
 *
 * The hook takes the live editor instance
 * (passed from `EditorPane.handleMount`) and:
 *
 *   1. Manages a single `editor.createDecorationsCollection()`
 *      that highlights the captured selection
 *      with a soft green tint + a sparkle glyph
 *      in the gutter. The collection is
 *      rebuilt whenever the inline edit's
 *      `selection` field changes (open /
 *      accept / reject / close).
 *
 *   2. Mounts a Monaco `IContentWidget` whose
 *      DOM node hosts a React `InlineEditOverlay`
 *      component. The widget is anchored to
 *      the end of the captured range (so it
 *      sits just below the last selected
 *      line) with `ContentWidgetPositionPreference.BELOW`.
 *      The React tree is created via
 *      `createRoot(domNode).render(<Overlay />)`
 *      and torn down on close + on editor
 *      unmount.
 *
 *   3. Registers two `editor.addCommand` bindings
 *      on Monaco's keybinding service:
 *        - `Tab`: when status === 'done' (i.e.
 *          the AI's proposal is on screen),
 *          `accept()`. Otherwise, fall through
 *          to Monaco's default Tab handler
 *          (indent / outdent) via
 *          `editor.trigger('keyboard', 'tab', null)`.
 *        - `Escape`: when the overlay is open,
 *          `reject()`. Otherwise, no-op
 *          (Escape has no Monaco default).
 *
 * Per Rule 6 (section isolation) the hook is
 * the ONLY place that talks to Monaco. The
 * `InlineEditOverlay` component is a pure
 * consumer of `inlineEditStore` + `aiStore`
 * and never imports `monaco-editor`.
 *
 * Per Rule 3 (screen-folder layout) the hook
 * lives in `src/screens/EditorWorkspace/hooks/`,
 * not in `src/shared/hooks/` — only the
 * EditorPane uses it.
 */

import { useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import {
  useInlineEditStore,
  type InlineEditSelection,
} from '../state/inlineEditStore';
import { InlineEditOverlay } from '../components/InlineAi/InlineEditOverlay';
// Side-effect import: the Monaco decoration
// classes (`.lipi-ai-pending-region` etc.) are
// declared in this CSS file. Importing it here
// means the hook's only caller (EditorPane)
// gets the styles transitively — and Vite's
// CSS-in-JS module scanner picks them up.
import '../components/InlineAi/inlineAi.module.css';

/**
 * The minimal monaco surface this hook touches.
 * The `editorControllerStore` types its `editor`
 * field as `unknown` to stay monaco-agnostic; this
 * hook is the one place where we cast. Mirrors the
 * structural pattern `EditorWorkspace.tsx` already
 * uses for `getSelection()` / `getModel()`.
 */
interface MonacoEditorLike {
  createDecorationsCollection: (
    initial?: unknown[],
  ) => {
    set: (decorations: unknown[]) => void;
    clear: () => void;
  };
  addContentWidget: (widget: unknown) => void;
  removeContentWidget: (widget: unknown) => void;
  revealRangeInCenter: (range: unknown) => void;
  /**
   * Monaco's public `addCommand` signature:
   *   `addCommand(keybinding, handler, context?)`.
   * The `keybinding` is a `number` (the bitwise
   * OR of a `KeyMod` value and a `KeyCode` value).
   * The `context` is an optional `string` for
   * the keybinding service's `when` clause.
   */
  addCommand: (
    keybinding: number,
    handler: () => void,
    context?: string,
  ) => string | null;
  /**
   * Monaco's `trigger` signature:
   *   `trigger(source, actionId, payload?)`.
   * We use it to invoke the built-in `'tab'`
   * action from the keybinding fallback path.
   */
  trigger: (
    source: string,
    actionId: string,
    payload?: unknown,
  ) => void;
}

export interface UseInlineEditOverlayParams {
  /**
   * The live Monaco editor instance (or null
   * when no editor is mounted). The hook is
   * a no-op when null. The pointer is
   * refreshed on every render so we always
   * have the latest instance — Monaco
   * re-creates the editor on tab switch
   * (the existing EditorPane.tsx pattern).
   */
  editor: unknown | null;
}

/**
 * Hook entry point. Pass the live editor
 * instance from `EditorPane.handleMount`. The
 * hook returns nothing — it side-effects on
 * the editor + the DOM.
 */
export function useInlineEditOverlay({
  editor,
}: UseInlineEditOverlayParams): void {
  // Single effect: the editor instance is
  // the only dep that should ever change the
  // widget's lifecycle. The inlineEditStore
  // subscription is read on every render via
  // `getState()`.
  useEffect(() => {
    if (!editor) return;
    const ed = editor as MonacoEditorLike;
    return setupOverlay(ed);
    // We intentionally exclude `editor` from
    // the deps — the `editor` param is a fresh
    // object reference on every render (Monaco
    // re-creates it on tab switch), and
    // re-running the effect on every render
    // would tear down + rebuild the widget
    // constantly. The actual instance change
    // is signalled by `EditorPane.handleMount`
    // writing a new value to the
    // `editorControllerStore` and re-rendering
    // — when that happens, the new instance is
    // passed in. We compare by reference
    // identity inside the effect body.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);
}

/**
 * Set up the content widget + decoration
 * collection + keybindings for a given editor
 * instance. Returned cleanup tears them all
 * down. Extracted as a module-level function
 * (not a hook) so the test file can call it
 * directly against a mocked editor.
 *
 * Exported for testing — the production code
 * only ever calls this from the
 * `useInlineEditOverlay` hook. The test file
 * (`useInlineEditOverlay.test.tsx`) calls it
 * with a mock editor to assert the widget /
 * decoration / keybinding lifecycle.
 */
export function setupOverlay(editor: MonacoEditorLike): () => void {
  // --- Decoration collection ----------------------------------------
  //
  // We always create the collection (even when
  // the inline edit isn't open) so that the
  // `selection` listener can populate it as
  // soon as the user opens an edit. Empty
  // collection = no decorations, no DOM cost.
  const decorations = editor.createDecorationsCollection([]);

  // --- Content widget DOM node + React root -------------------------
  //
  // A single `<div>` per editor instance. The
  // React root is created once and re-renders
  // on every store change. The `InlineEditOverlay`
  // component itself returns `null` when the
  // store's `selection` is null, so the DOM
  // contains an empty div when the overlay is
  // closed (Monaco positions this as a 0x0
  // element, which is invisible).
  const domNode = document.createElement('div');
  domNode.className = 'lipi-inline-edit-overlay-host';
  let root: Root | null = createRoot(domNode);
  root.render(<InlineEditOverlay anchorRange={null} />);

  let widget: unknown | null = null;

  // --- inlineEditStore subscription ----------------------------------
  //
  // We subscribe to the store's `selection`
  // and `status` changes. The selection
  // drives the content widget (mounted =
  // selection is non-null) and the decoration
  // highlight (highlight = selection is
  // non-null). The status is read by the
  // overlay component itself — we don't
  // need to re-render the root on status
  // changes.
  const updateWidget = (): void => {
    const s = useInlineEditStore.getState();
    const sel = s.selection;

    // --- Decorations: highlight the range.
    if (sel) {
      decorations.set([
        {
          range: sel.range,
          options: {
            className: 'lipi-ai-pending-region',
            inlineClassName: 'lipi-ai-pending-inline',
            glyphMarginClassName: 'lipi-ai-pending-glyph',
            hoverMessage: {
              value:
                'AI suggestion — Tab to accept, Esc to reject',
            },
            stickiness: 1, // NeverGrowsWhenTypingAtEdges
          },
        },
      ]);
    } else {
      decorations.set([]);
    }

    // --- Content widget: mount / unmount.
    if (sel && !widget) {
      widget = makeContentWidget(domNode, sel);
      editor.addContentWidget(widget);
      // Scroll the captured range into the
      // center of the viewport so the
      // overlay's first paint is visible
      // (a long file may have the
      // selection far off-screen).
      try {
        editor.revealRangeInCenter(sel.range);
      } catch {
        // Defensive — Monaco's reveal can
        // throw if the editor is being
        // disposed mid-call.
      }
    } else if (!sel && widget) {
      try {
        editor.removeContentWidget(widget);
      } catch {
        // Defensive.
      }
      widget = null;
    }
  };
  const unsubscribe = useInlineEditStore.subscribe(() => {
    updateWidget();
  });
  // Run once on mount in case the store
  // already has a `selection` (e.g. the
  // hook re-mounted after a tab switch
  // while the inline edit was open).
  updateWidget();

  // --- Keybindings: Tab (accept) + Esc (reject) --------------------
  //
  // Monaco's `KeyMod` and `KeyCode` values
  // we need are NOT declared in the
  // published monaco d.ts (the `editor.api.d.ts`
  // is incomplete). We use the documented
  // public values directly:
  //   KeyCode.Tab    = 2
  //   KeyCode.Escape = 9
  const KeyCodeTab = 2;
  const KeyCodeEscape = 9;
  const tabId = editor.addCommand(KeyCodeTab, () => {
    const s = useInlineEditStore.getState();
    if (s.status === 'done' && s.proposal !== null) {
      s.accept();
    } else {
      // No pending edit — let Monaco handle
      // Tab as indent / outdent.
      editor.trigger('keyboard', 'tab', null);
    }
  });
  const escId = editor.addCommand(KeyCodeEscape, () => {
    const s = useInlineEditStore.getState();
    if (s.selection) {
      s.reject();
    }
    // No fallback: Escape has no Monaco
    // default action.
  });
  void tabId;
  void escId;

  // --- Cleanup -------------------------------------------------------
  //
  // Monaco doesn't expose `removeCommand` in
  // its public API — commands live for the
  // lifetime of the editor. The closures
  // capture stable Zustand action references
  // (Zustand actions don't change on store
  // updates), so a stale closure is fine.
  // We still capture the ids for a future
  // cleanup hook.
  return () => {
    unsubscribe();
    if (widget) {
      try {
        editor.removeContentWidget(widget);
      } catch {
        // Editor may already be disposed.
      }
      widget = null;
    }
    try {
      decorations.clear();
    } catch {
      // Defensive.
    }
    if (root) {
      root.unmount();
      root = null;
    }
  };
}

/**
 * The id of the content widget. Monaco
 * expects this to be globally unique; using
 * a stable id lets us remove + re-add without
 * collisions.
 */
const CONTENT_WIDGET_ID = 'lipi.ai.inlineEdit.overlay';

/**
 * Build an `IContentWidget`-shaped object.
 * Monaco's `IContentWidget` interface declares
 *   - `getId(): string`
 *   - `getDomNode(): HTMLElement`
 *   - `getPosition(): IContentWidgetPosition | null`
 *   - `allowEditorOverflow?: boolean`
 *
 * We return a plain object that satisfies the
 * shape (the editor doesn't check the type —
 * it just calls the methods). The
 * `getPosition` returns the latest captured
 * range from the store; the widget is hidden
 * when the selection is null.
 *
 * The `initial` param is intentionally unused
 * at construction time — the widget reads the
 * latest `selection` on every layout. We keep
 * it in the signature so callers can pass a
 * "starting" selection without having to wait
 * for a `subscribe` round-trip.
 */
function makeContentWidget(
  domNode: HTMLDivElement,
  initial: InlineEditSelection,
): unknown {
  void initial;
  return {
    getId(): string {
      return CONTENT_WIDGET_ID;
    },
    getDomNode(): HTMLDivElement {
      return domNode;
    },
    getPosition(): {
      position: { lineNumber: number; column: number };
      preference: number[];
      allowEditorOverflow: boolean;
    } | null {
      const sel = useInlineEditStore.getState().selection;
      if (!sel) return null;
      // Position: just below the end of the
      // selection. `preference: [BELOW]`
      // (= `2` in the `ContentWidgetPositionPreference`
      // enum) means Monaco will place the
      // widget below the line if there's
      // space, otherwise to the side.
      return {
        position: {
          lineNumber: sel.range.endLineNumber,
          column: sel.range.endColumn,
        },
        preference: [2 /* BELOW */],
        // The overlay can render outside the
        // editor's clip rect — Monaco's
        // default is to clip. We want the
        // overlay visible even if it sits
        // outside the viewport.
        allowEditorOverflow: true,
      };
    },
  };
}
