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

/**
 * A pending request for the editor pane to
 * reveal a specific line + column in the
 * next opened file. The search panel sets
 * this; the editor pane reads it on mount
 * and clears it after applying.
 *
 * The handoff is a store (not a custom
 * event) so it survives React's render
 * cycle. The pane is guaranteed to read it
 * after the file is loaded (the openFile
 * call triggers an active-tab change which
 * triggers a remount).
 */
export interface PendingReveal {
  path: string;
  line: number;
  column: number;
}

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

  /** Set the next reveal request. Pass `null` to clear. */
  setPendingReveal: (reveal: PendingReveal | null) => void;

  /** Read the pending reveal (without clearing it
   *  — the editor pane clears it via
   *  `setPendingReveal(null)` after applying). */
  pendingReveal: PendingReveal | null;
}

export const useEditorControllerStore = create<EditorControllerState>(
  (set) => ({
    editor: null,
    setEditor: (editor) => set({ editor }),
    pendingReveal: null,
    setPendingReveal: (reveal) => set({ pendingReveal: reveal }),
  }),
);
