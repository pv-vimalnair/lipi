/**
 * triggerInlineEdit — the single entry point for
 * opening the inline AI edit flow (Phase 8).
 *
 * Both the global `Cmd+K` / `Ctrl+K` keyboard
 * binding (in `EditorWorkspace.tsx`) and the
 * Command Palette's `'inlineEdit.open'` command
 * call this function. Extracting it into its own
 * module avoids the circular dependency that
 * would otherwise arise (the palette lives in
 * `src/shared/`, the keyboard binding lives in
 * `src/screens/EditorWorkspace/`, and the
 * inlineEditStore also lives in the screen
 * folder — pulling the keyboard handler into
 * `shared/` would violate Rule 3; pulling the
 * palette's command list into the screen folder
 * would violate Rule 6).
 *
 * The function is the same as the original
 * `handleCmdK` closure: read the live Monaco
 * editor from the `editorControllerStore`,
 * extract the current selection, and dispatch
 * `inlineEditStore.open(sel)`. Returns `true` if
 * the trigger succeeded (a non-empty selection
 * was captured), `false` otherwise. Callers
 * ignore the return value; we expose it so the
 * test suite can assert the gating behaviour
 * (no editor / no selection → return false).
 */

import { useEditorControllerStore } from './editorControllerStore';
import { useInlineEditStore } from './inlineEditStore';

/**
 * The hand-rolled monaco surface used to read
 * the live selection. Same pattern as
 * `EditorWorkspace.tsx`'s old `handleCmdK`.
 */
interface MonacoEditorLike {
  getSelection: () => unknown;
  getModel: () => {
    getValueInRange: (sel: unknown) => string;
  } | null;
}

export function triggerInlineEdit(): boolean {
  const editor = useEditorControllerStore.getState().editor as
    | MonacoEditorLike
    | null;
  if (!editor) return false;
  const sel = editor.getSelection();
  if (!sel) return false;
  const model = editor.getModel();
  if (!model) return false;
  const text = model.getValueInRange(sel);
  if (!text) return false;
  // The selection shape is monaco's `IRange`
  // (1-indexed start/end line + column) which
  // lines up with our hand-rolled
  // `InlineEditSelection.range` type.
  const range = sel as {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
  useInlineEditStore.getState().open({ text, range });
  return true;
}
