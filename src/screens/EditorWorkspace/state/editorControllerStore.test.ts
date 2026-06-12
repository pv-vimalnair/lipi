/**
 * Tests for `editorControllerStore.ts` — the
 * tiny Zustand store that hands the live
 * Monaco editor instance from `EditorPane`
 * to other panes (the CmdKModal in 5b-5).
 *
 * The store is intentionally minimal — set
 * the editor, read the editor, null it on
 * unmount. We test the bare contract.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { useEditorControllerStore } from './editorControllerStore';

describe('editorControllerStore (5b-5)', () => {
  beforeEach(() => {
    useEditorControllerStore.setState({ editor: null });
  });

  it('starts with editor = null', () => {
    expect(useEditorControllerStore.getState().editor).toBeNull();
  });

  it('setEditor stores the editor instance (any value — the store is monaco-agnostic)', () => {
    // The store deliberately types the
    // field as `unknown` so it doesn't pull
    // in `monaco-editor`. We pass a fake
    // stand-in to confirm the round-trip
    // works.
    const fakeEditor = { executeEdits: () => true };
    useEditorControllerStore.getState().setEditor(fakeEditor);
    expect(useEditorControllerStore.getState().editor).toBe(
      fakeEditor,
    );
  });

  it('setEditor(null) clears the handle (e.g. on tab switch)', () => {
    useEditorControllerStore
      .getState()
      .setEditor({ executeEdits: () => true });
    useEditorControllerStore.getState().setEditor(null);
    expect(useEditorControllerStore.getState().editor).toBeNull();
  });
});
