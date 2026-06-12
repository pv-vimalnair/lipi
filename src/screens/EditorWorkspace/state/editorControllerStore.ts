/**
 * editorControllerStore — a tiny screen-local Zustand
 * store that holds the live Monaco editor instance
 * so features outside the editor pane (e.g. the
 * `CmdKModal` in 5b-5) can talk to it.
 *
 * Per Rule 3 (screen-folder layout) this is in
 * `src/screens/EditorWorkspace/state/`, NOT in
 * `src/shared/state/`. Only the EditorWorkspace
 * needs the handle today; the only consumer is
 * `AIPanel/CmdKModal.tsx` and the only writer is
 * `EditorPane/EditorPane.tsx`.
 *
 * Per Rule 6 (section isolation) this is the
 * single hand-off point between the editor
 * (Monaco-coupled) and the rest of the screen
 * (Monaco-agnostic). The CmdKModal never imports
 * `monaco-editor` or `@monaco-editor/react` —
 * it reads the live `IStandaloneCodeEditor`
 * instance from this store and calls
 * `getSelection()` / `getModel()` /
 * `executeEdits()` on it directly.
 *
 * The type is `unknown` from the store's
 * perspective (we don't want the store to pull
 * in the monaco types — the store would then
 * fail to load in test environments that mock
 * monaco differently). Consumers cast to
 * `monaco.editor.IStandaloneCodeEditor` at the
 * call site.
 */

import { create } from 'zustand';

interface EditorControllerState {
  /**
   * The live Monaco editor instance, or `null`
   * if no editor is mounted (e.g. on mobile,
   * or before the user has opened a file). Set
   * by `EditorPane` on `onMount` and cleared
   * on `onUnmount` (via the cleanup return
   * of the mount `useEffect`).
   *
   * Typed as `unknown` here to keep the store
   * free of the `monaco-editor` import.
   * Consumers cast.
   */
  editor: unknown | null;

  /** Replace the editor instance. Pass `null` to
   *  clear (e.g. on tab switch). */
  setEditor: (editor: unknown | null) => void;
}

export const useEditorControllerStore = create<EditorControllerState>(
  (set) => ({
    editor: null,
    setEditor: (editor) => set({ editor }),
  }),
);
