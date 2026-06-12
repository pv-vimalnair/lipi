/**
 * cmdKStore — Zustand store for the Cmd-K
 * inline edit modal (5b-5).
 *
 * Per Rule 3 (screen-folder layout) this lives
 * in `src/screens/EditorWorkspace/state/`,
 * NOT in `src/shared/state/`. Only the
 * EditorWorkspace's CmdKModal + the global
 * Cmd-K keyboard handler in EditorWorkspace
 * read it.
 *
 * Per Rule 6 (section isolation) the store is
 * the SINGLE hand-off point between the
 * keyboard handler (in EditorWorkspace) and
 * the modal (in AIPanel). The handler never
 * imports the modal; it just calls
 * `useCmdKStore.getState().open(selection)`.
 * The modal never imports the AI store
 * directly — it reads the AI store at submit
 * time and at the `done` transition (via
 * `useEffect`), so the modal stays a pure
 * consumer of the cmdKStore + the aiStore.
 *
 * The store is intentionally small — just
 * what's needed to drive the modal's UI.
 * Streaming state (the "AI is editing..."
 * spinner) and the assistant message's id
 * (for reading the result) live here.
 */

import { create } from 'zustand';

/**
 * The captured text + range from the Monaco
 * editor at the moment the user hit Cmd-K.
 * The `range` is in Monaco's `IRange` shape
 * (1-indexed line and column; both
 * inclusive). We store both fields because
 * "Apply" needs the range to do
 * `editor.executeEdits()` and the modal
 * needs the text to display the "Before"
 * preview.
 *
 * Typed as a plain object (not Monaco's
 * `IRange` directly) to keep this store
 * monaco-agnostic.
 */
export interface CmdKSelection {
  text: string;
  range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
}

export type CmdKStatus =
  | 'idle' // modal open, user typing the instruction
  | 'streaming' // submitted; waiting for ai://done
  | 'done' // ai://done arrived; showing the result + Apply/Reject
  | 'error'; // ai://error arrived; showing an error banner

interface CmdKState {
  /**
   * Whether the modal is open. The CmdKModal
   * component is ALWAYS mounted; this is the
   * flag the modal reads to render the
   * `Modal` primitive. Default false (closed).
   */
  open: boolean;
  /**
   * The captured selection at the moment the
   * user hit Cmd-K. `null` when the modal is
   * closed or when the user hit Cmd-K with no
   * selection (the handler bails in that case
   * but the field is still nullable for type
   * safety).
   */
  selection: CmdKSelection | null;
  /**
   * The instruction the user typed into the
   * modal's textarea. Cleared on close.
   */
  instruction: string;
  /**
   * The id of the assistant message we're
   * currently waiting on (set in the `send`
   * call, used to read the message out of
   * the aiStore when `done` arrives). Null
   * when no request is in flight.
   */
  streamingMessageId: string | null;
  /** Modal lifecycle status. */
  status: CmdKStatus;

  /** Open the modal with a captured selection. */
  openCmdK: (selection: CmdKSelection) => void;
  /** Close the modal and reset all transient
   *  state. Safe to call when already closed. */
  closeCmdK: () => void;
  /** Update the instruction text (controlled
   *  textarea binding). */
  setInstruction: (instruction: string) => void;
  /** Mark the request as submitted and
   *  remember which assistant message we
   *  expect to see stream in. */
  setStreaming: (streamingMessageId: string) => void;
  /** Mark the request as completed; the
   *  modal switches to its result view. */
  setDone: () => void;
  /** Mark the request as errored; the modal
   *  shows an error banner. */
  setError: () => void;
  /** Reset to `idle` from the `error` state
   *  (the "Try again" button on the error
   *  view). Keeps the selection and
   *  instruction so the user doesn't lose
   *  their typing. */
  resetToIdle: () => void;
}

export const useCmdKStore = create<CmdKState>((set) => ({
  open: false,
  selection: null,
  instruction: '',
  streamingMessageId: null,
  status: 'idle',

  openCmdK: (selection) => {
    // 5b-5: open the modal with a fresh state.
    // We do NOT preserve the previous
    // instruction across opens (a fresh
    // selection deserves a fresh prompt).
    set({
      open: true,
      selection,
      instruction: '',
      streamingMessageId: null,
      status: 'idle',
    });
  },

  closeCmdK: () => {
    set({
      open: false,
      selection: null,
      instruction: '',
      streamingMessageId: null,
      status: 'idle',
    });
  },

  setInstruction: (instruction) => set({ instruction }),

  setStreaming: (streamingMessageId) =>
    set({ streamingMessageId, status: 'streaming' }),

  setDone: () => set({ status: 'done' }),

  setError: () => set({ status: 'error' }),

  resetToIdle: () =>
    set((s) =>
      s.status === 'error'
        ? { status: 'idle', streamingMessageId: null }
        : s,
    ),
}));
