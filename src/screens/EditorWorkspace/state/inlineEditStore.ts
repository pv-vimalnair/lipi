/**
 * inlineEditStore — Zustand store for Phase 8's
 * `Cmd+K` inline AI edit flow.
 *
 * This replaces the Phase 5b-5 `cmdKStore` (which
 * drove a modal popup). Phase 8 turns the same flow
 * into an inline UX: the store holds the captured
 * selection + the AI's streaming proposal + the
 * status, and the new `InlineEditOverlay` component
 * (rendered as a Monaco `IContentWidget`) reads it.
 * Tab accepts, Esc rejects.
 *
 * Per Rule 3 (screen-folder layout) this lives in
 * `src/screens/EditorWorkspace/state/`, not in
 * `src/shared/state/`. Only EditorWorkspace's
 * `EditorWorkspace.tsx` (global Cmd-K handler),
 * `EditorPane.tsx` (mounts the overlay via the
 * `useInlineEditOverlay` hook), and `AIPanel`
 * (command palette wiring) read it.
 *
 * Per Rule 6 (section isolation) this is the single
 * hand-off point between the global Cmd-K handler
 * (which captures the selection) and the inline
 * overlay (which renders the prompt + accept/reject
 * UI). The handler never imports the overlay; the
 * overlay never imports the global handler. Both
 * touch the same Zustand store.
 *
 * The store is intentionally monaco-agnostic (same
 * as the rest of the codebase): the `range` field
 * is a plain `{ startLineNumber, startColumn,
 * endLineNumber, endColumn }` object, not
 * `monaco.IRange`. The `accept()` action reads the
 * live editor from `editorControllerStore` and
 * calls `executeEdits` on the typed-cast instance
 * at the call site.
 */

import { create } from 'zustand';
import { useEditorControllerStore } from './editorControllerStore';

/**
 * The captured text + range from the Monaco
 * editor at the moment the user hit Cmd-K. The
 * `range` is in Monaco's `IRange` shape
 * (1-indexed, end-exclusive) but typed as a plain
 * object to keep this store monaco-agnostic.
 */
export interface InlineEditSelection {
  text: string;
  range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
}

export type InlineEditStatus =
  | 'idle' // overlay open, user typing the instruction
  | 'streaming' // submitted; waiting for ai://done
  | 'done' // ai://done arrived; showing the result + Accept / Reject
  | 'error'; // ai://error arrived; showing an error banner

/**
 * The surface `accept()` needs to call on the live
 * editor. We type the editor's API minimally here
 * (and in `editorControllerStore`) so the store
 * stays monaco-agnostic — the same hand-rolled
 * structural-type pattern Phase 5b-5 used.
 */
interface EditorLike {
  executeEdits: (
    source: string,
    edits: Array<{
      range: InlineEditSelection['range'];
      text: string;
      forceMoveMarkers?: boolean;
    }>,
  ) => unknown;
  pushUndoStop: () => void;
}

interface InlineEditState {
  /**
   * The captured selection at the moment the
   * user hit Cmd-K. `null` when the overlay is
   * closed or when the user hit Cmd-K with no
   * selection (the handler bails in that case,
   * but the field is nullable for type safety).
   */
  selection: InlineEditSelection | null;
  /**
   * The instruction the user typed into the
   * overlay's prompt input. Cleared on close.
   */
  instruction: string;
  /** The id of the assistant message we're
   *  currently waiting on (set when the overlay
   *  submits, used to read the message out of
   *  the aiStore when `done` arrives). */
  streamingMessageId: string | null;
  /** Overlay lifecycle status. */
  status: InlineEditStatus;
  /**
   * The sealed AI proposal text, captured at the
   * `streaming` → `done` transition. `null` until
   * the message seals. The `accept()` action reads
   * this to call `editor.executeEdits`. The
   * `InlineEditOverlay` reads this to show the
   * "After" preview.
   */
  proposal: string | null;
  /**
   * The most recent error. Set by `fail()` from
   * the aiStore's `requestStatus` (kind=error)
   * transition. Rendered by the overlay's error
   * view; `null` when there's no error.
   */
  error: { kind: string; message: string } | null;

  /** Open the overlay with a captured selection.
   *  Resets the previous instruction (a fresh
   *  selection deserves a fresh prompt). */
  open: (selection: InlineEditSelection) => void;
  /** Update the instruction text (controlled
   *  input binding). */
  setInstruction: (instruction: string) => void;
  /** Mark the request as submitted and remember
   *  which assistant message we expect to see
   *  stream in. */
  beginStream: (streamingMessageId: string) => void;
  /** Mark the request as completed; the overlay
   *  switches to its result view (Accept /
   *  Reject). `proposal` is the AI's sealed
   *  text. */
  sealProposal: (proposal: string) => void;
  /** Mark the request as errored; the overlay
   *  shows an error banner. */
  fail: (kind: string, message: string) => void;
  /** Reset to `idle` from the `error` state
   *  (the "Try again" button on the error
   *  view). Keeps the selection + instruction
   *  so the user doesn't lose their typing. */
  resetToIdle: () => void;
  /** Accept the AI's proposal: call
   *  `editor.executeEdits` to replace the
   *  captured range with the proposal text,
   *  bracket the edit with `pushUndoStop()` so
   *  a single Cmd+Z undoes the whole change,
   *  and clear the store. */
  accept: () => void;
  /** Reject the AI's proposal: clear the store
   *  WITHOUT calling `executeEdits`. The
   *  overlay's decoration + content widget
   *  auto-unmount via the `selection` dep
   *  going back to null. */
  reject: () => void;
  /** Dismiss the overlay without a decision
   *  (e.g. user clicks elsewhere). Alias for
   *  `reject` — both clear the store without
   *  calling `executeEdits`. Kept as a separate
   *  action so a future decision-log entry can
   *  distinguish "user rejected" from "user
   *  dismissed". */
  close: () => void;
}

/**
 * Bracket the AI edit with `pushUndoStop()` calls
 * so a single `Cmd+Z` cleanly undoes the whole
 * change. Without the leading `pushUndoStop`, the
 * user's pre-Cmd-K typing is in the same undo
 * group as the AI replacement, and `Cmd+Z` would
 * either undo nothing (if the user typed nothing
 * since) or only the typing (which leaves the
 * user looking at the AI's text, not the
 * original). With both stops, the AI's edit is
 * its own undoable step.
 *
 * The function is inlined here (rather than as
 * a module-level helper) so the test surface can
 * mock the `editorControllerStore` per-test.
 */
function applyProposalToEditor(
  selection: InlineEditSelection,
  proposal: string,
): void {
  const editor = useEditorControllerStore.getState().editor as
    | EditorLike
    | null;
  if (!editor) {
    // Defensive: the store should never be
    // in `done` without an editor (the global
    // Cmd-K handler gates on `editor != null`),
    // but a tab switch in the middle of a
    // stream could leave us in this state.
    // Log + bail rather than throw — the user's
    // pending edit is just lost, not corrupted.
    if (import.meta.env.DEV) {
      console.warn(
        '[inlineEditStore] accept() called with no live editor; the AI edit was not applied.',
      );
    }
    return;
  }
  editor.pushUndoStop();
  editor.executeEdits(
    'lipi-ai-inline',
    [
      {
        range: selection.range,
        text: proposal,
        forceMoveMarkers: true,
      },
    ],
  );
  editor.pushUndoStop();
}

export const useInlineEditStore = create<InlineEditState>((set, get) => ({
  selection: null,
  instruction: '',
  streamingMessageId: null,
  status: 'idle',
  proposal: null,
  error: null,

  open: (selection) => {
    set({
      selection,
      instruction: '',
      streamingMessageId: null,
      status: 'idle',
      proposal: null,
      error: null,
    });
  },

  setInstruction: (instruction) => set({ instruction }),

  beginStream: (streamingMessageId) =>
    set({ streamingMessageId, status: 'streaming', error: null }),

  sealProposal: (proposal) =>
    set({ status: 'done', proposal }),

  fail: (kind, message) =>
    set({ status: 'error', error: { kind, message } }),

  resetToIdle: () =>
    set((s) =>
      s.status === 'error'
        ? { status: 'idle', streamingMessageId: null, error: null }
        : s,
    ),

  accept: () => {
    const { selection, proposal } = get();
    if (!selection || !proposal) return;
    applyProposalToEditor(selection, proposal);
    set({
      selection: null,
      instruction: '',
      streamingMessageId: null,
      status: 'idle',
      proposal: null,
      error: null,
    });
  },

  reject: () => {
    set({
      selection: null,
      instruction: '',
      streamingMessageId: null,
      status: 'idle',
      proposal: null,
      error: null,
    });
  },

  close: () => {
    set({
      selection: null,
      instruction: '',
      streamingMessageId: null,
      status: 'idle',
      proposal: null,
      error: null,
    });
  },
}));
