/**
 * CmdKModal — the inline-edit modal driven by the
 * `Cmd-K` / `Ctrl-K` keyboard shortcut (5b-5).
 *
 *   ┌─ Edit selection ────────────────────────────┐
 *   │  Before                                      │
 *   │  ┌────────────────────────────────────────┐  │
 *   │  │ const x = 1;                           │  │
 *   │  │ const y = 2;                           │  │
 *   │  └────────────────────────────────────────┘  │
 *   │                                              │
 *   │  ┌────────────────────────────────────────┐  │
 *   │  │ add a JSDoc comment above each const   │  │
 *   │  └────────────────────────────────────────┘  │
 *   │                          [ Cancel ] [ Ask AI ]│
 *   └──────────────────────────────────────────────┘
 *
 * Flow:
 *   1. The global Cmd-K handler in
 *      `EditorWorkspace` reads the current Monaco
 *      selection and calls `cmdKStore.openCmdK(sel)`.
 *   2. The modal is always mounted; it reads
 *      `cmdKStore.open` and renders the `Modal`
 *      primitive accordingly.
 *   3. The user types an instruction and hits
 *      "Ask AI". We call `aiStore.sendEdit({...})`
 *      which returns the new streaming assistant
 *      message id. We store that id in
 *      `cmdKStore.streamingMessageId` so the modal
 *      knows which message to read when the
 *      stream ends.
 *   4. The modal's `useEffect` watches the
 *      aiStore's `messages` array: when the
 *      message with id `streamingMessageId` flips
 *      to `streaming: false`, we move the
 *      cmdKStore to `'done'` and read the
 *      assistant's `content` for the result view.
 *   5. The result view shows a 2-pane "Before /
 *      After" layout with `Apply` / `Reject`
 *      buttons. `Apply` reads the live Monaco
 *      editor from `editorControllerStore` and
 *      calls `executeEdits` to replace the
 *      captured range with the AI's text. `Reject`
 *      just closes the modal.
 *
 * Per Rule 6 (section isolation) this component
 * never imports `monaco-editor` — it talks to the
 * live editor through `editorControllerStore` and
 * calls `executeEdits` on the typed-cast instance.
 * The whole "talk to Monaco" surface is a single
 * `applyToEditor(text)` helper at the bottom of
 * the file.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';

import { Button, Modal, Stack } from '@/shared/components';
import { useAiStore } from '../../state/aiStore';
import { useCmdKStore } from '../../state/cmdKStore';
import { useEditorControllerStore } from '../../state/editorControllerStore';
import { getFriendlyError } from './errorMessages';
import { buildCmdKPrompt } from './buildCmdKPrompt';
import styles from './CmdKModal.module.css';

/**
 * The friendly text shown for inline validation
 * errors (empty instruction). One per
 * `BuildCmdKPromptError`.
 */
const PROMPT_ERROR_COPY: Record<string, string> = {
  'empty-selection': 'No text selected.',
  'empty-instruction': 'Type an instruction first.',
};

export function CmdKModal() {
  const open = useCmdKStore((s) => s.open);
  const selection = useCmdKStore((s) => s.selection);
  const instruction = useCmdKStore((s) => s.instruction);
  const status = useCmdKStore((s) => s.status);
  const streamingMessageId = useCmdKStore(
    (s) => s.streamingMessageId,
  );
  const setInstruction = useCmdKStore((s) => s.setInstruction);
  const closeCmdK = useCmdKStore((s) => s.closeCmdK);
  const setStreaming = useCmdKStore((s) => s.setStreaming);
  const setDone = useCmdKStore((s) => s.setDone);
  const setError = useCmdKStore((s) => s.setError);
  const resetToIdle = useCmdKStore((s) => s.resetToIdle);

  const sendEdit = useAiStore((s) => s.sendEdit);
  const aiRequestStatus = useAiStore((s) => s.requestStatus);
  // We re-read messages on every store change so
  // the streaming/done effect fires. Cheap because
  // the messages array is small and Zustand
  // re-renders are scoped.
  const messages = useAiStore((s) => s.messages);

  // Local UI state. The `localError` is for
  // client-side validation (empty instruction);
  // the `aiError` mirrors the aiStore's
  // `requestStatus` (kind=error) and is rendered
  // via the same ErrorBanner copy as the chat
  // panel.
  const [localError, setLocalError] = useState<string | null>(null);
  const instructionRef = useRef<HTMLTextAreaElement>(null);

  // --- Submit handler ---------------------------------------------------
  //
  // The "Ask AI" button. We validate locally
  // (no point firing the IPC for an empty
  // instruction) and then hand off to
  // `aiStore.sendEdit`. The streaming effect
  // below flips the cmdKStore to `'done'`
  // when the message seals.
  const handleSubmit = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      setLocalError(null);
      if (!selection) {
        setLocalError(PROMPT_ERROR_COPY['empty-selection']);
        return;
      }
      const built = buildCmdKPrompt(selection.text, instruction);
      if (!built.ok) {
        setLocalError(
          PROMPT_ERROR_COPY[built.error] ?? 'Invalid input.',
        );
        return;
      }
      setLocalError(null);
      const messageId = await sendEdit({
        systemPrompt: built.systemPrompt,
        userMessage: built.userMessage,
      });
      if (messageId) {
        setStreaming(messageId);
      } else {
        // Setup failure (provider not
        // configured, Tauri command failed,
        // etc.). The aiStore has already
        // flipped `requestStatus` to error
        // — the streaming-effect below will
        // pick that up and flip cmdKStore
        // accordingly.
      }
    },
    [instruction, selection, sendEdit, setStreaming],
  );

  // --- Streaming -> Done / Error transition ----------------------------
  //
  // Watch the aiStore's `messages` array: when
  // the message with id `streamingMessageId`
  // transitions from `streaming: true` to
  // `streaming: false`, we move the cmdKStore
  // to `'done'`. We also listen to the
  // aiStore's `requestStatus`: if it flips
  // to `error` while we're streaming, we
  // flip cmdKStore to `'error'`.
  useEffect(() => {
    if (status !== 'streaming') return;
    if (!streamingMessageId) return;
    const target = messages.find((m) => m.id === streamingMessageId);
    if (!target) return;
    if (!target.streaming) {
      // Sealed. Move to done.
      setDone();
    }
  }, [messages, setDone, status, streamingMessageId]);

  useEffect(() => {
    if (status !== 'streaming') return;
    if (aiRequestStatus.kind === 'error') {
      setError();
    }
  }, [aiRequestStatus, setError, status]);

  // --- The assistant's response text (for the result view) --------------
  //
  // Read from the aiStore's messages array. We
  // only render the "After" pane when status
  // is 'done' or 'error' (during streaming the
  // "After" pane is the "AI is editing…"
  // spinner).
  const assistantContent = useMemo(() => {
    if (!streamingMessageId) return '';
    const m = messages.find((msg) => msg.id === streamingMessageId);
    return m?.content ?? '';
  }, [messages, streamingMessageId]);

  // --- Apply / Reject handlers -----------------------------------------
  //
  // Apply reads the editor from the controller
  // store, calls `executeEdits` to replace the
  // captured range with the assistant's text,
  // and closes the modal. Reject just closes.
  const handleApply = useCallback(() => {
    if (!selection) return;
    applyToEditor(selection.range, assistantContent);
    closeCmdK();
  }, [assistantContent, closeCmdK, selection]);

  const handleReject = useCallback(() => {
    closeCmdK();
  }, [closeCmdK]);

  const handleTryAgain = useCallback(() => {
    setLocalError(null);
    resetToIdle();
  }, [resetToIdle]);

  return (
    <Modal
      open={open}
      onClose={closeCmdK}
      label="Edit selection"
      className={styles.panelOverride}
    >
      <header className={styles.header}>
        <h2 className={styles.title} id="cmdk-modal-title">
          Edit selection
        </h2>
        <p className={styles.subtitle}>
          {selection
            ? `${selection.text.length} character${
                selection.text.length === 1 ? '' : 's'
              } selected`
            : 'No selection'}
        </p>
      </header>
      {selection && (
        <Stack direction="column" gap={3} className={styles.body}>
          {status !== 'done' && status !== 'error' && (
            <>
              <label className={styles.sectionLabel} htmlFor="cmdk-before">
                Before
              </label>
              <pre
                id="cmdk-before"
                className={styles.selectionPreview}
                aria-readonly="true"
              >
                {selection.text}
              </pre>
              <form onSubmit={handleSubmit} className={styles.form}>
                <label
                  className={styles.sectionLabel}
                  htmlFor="cmdk-instruction"
                >
                  What should the AI do?
                </label>
                <textarea
                  ref={instructionRef}
                  id="cmdk-instruction"
                  className={styles.promptArea}
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="e.g. add a JSDoc comment, convert to async, refactor into a single function\u2026"
                  rows={3}
                  autoFocus
                  disabled={status === 'streaming'}
                />
                {localError && (
                  <div className={styles.localError} role="alert">
                    {localError}
                  </div>
                )}
                {status === 'streaming' && (
                  <div className={styles.streamingHint} role="status">
                    <span className={styles.spinner} aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </span>
                    AI is editing&hellip;
                  </div>
                )}
                <div className={styles.actions}>
                  <Button
                    type="button"
                    variant="secondary"
                    size="md"
                    onClick={closeCmdK}
                    disabled={status === 'streaming'}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    size="md"
                    loading={status === 'streaming'}
                    disabled={
                      status === 'streaming' ||
                      !instruction.trim() ||
                      !selection.text.trim()
                    }
                  >
                    Ask AI
                  </Button>
                </div>
              </form>
            </>
          )}
          {(status === 'done' || status === 'error') && (
            <ResultView
              beforeText={selection.text}
              afterText={assistantContent}
              error={aiRequestStatus}
              onApply={handleApply}
              onReject={handleReject}
              onTryAgain={handleTryAgain}
            />
          )}
        </Stack>
      )}
    </Modal>
  );
}

// --- Result view -------------------------------------------------------
//
// Shown when the AI has finished (or errored).
// The "Before" / "After" panes are side-by-side
// for a quick eyeball check; Apply / Reject are
// the only actions. The "After" pane is empty
// when the response was an error.

interface ResultViewProps {
  beforeText: string;
  afterText: string;
  /** 5b-6: typed against the canonical
   *  `RequestStatus` from the store, so
   *  adding new variants (e.g.
   *  `'executingTools'` in 5b-6) doesn't
   *  require updating this prop. */
  error: import('../../state/aiStore').RequestStatus;
  onApply: () => void;
  onReject: () => void;
  onTryAgain: () => void;
}

function ResultView({
  beforeText,
  afterText,
  error,
  onApply,
  onReject,
  onTryAgain,
}: ResultViewProps) {
  const isError = error.kind === 'error';
  const friendly = isError
    ? getFriendlyError(error.errorKind, error.message)
    : null;
  return (
    <>
      <div className={styles.resultSplit}>
        <div className={styles.resultPane}>
          <span className={styles.sectionLabel}>Before</span>
          <pre className={styles.selectionPreview}>{beforeText}</pre>
        </div>
        <div className={styles.resultPane}>
          <span className={styles.sectionLabel}>After</span>
          {isError ? (
            <div className={styles.errorPane} role="alert">
              <div className={styles.errorTitle}>{friendly?.title}</div>
              <div className={styles.errorHint}>{friendly?.hint}</div>
            </div>
          ) : (
            <pre className={styles.selectionPreview}>{afterText}</pre>
          )}
        </div>
      </div>
      <div className={styles.actions}>
        {isError ? (
          <>
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={onReject}
            >
              Close
            </Button>
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={onTryAgain}
            >
              Try again
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={onReject}
            >
              Reject
            </Button>
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={onApply}
            >
              Apply
            </Button>
          </>
        )}
      </div>
    </>
  );
}

// --- applyToEditor ----------------------------------------------------
//
// The single point of contact with the live
// Monaco editor. We cast `unknown` to the
// monaco editor type and call `executeEdits`
// + `pushUndoStop` so the edit is a single
// undoable step. The cast is safe because
// the controller store is only ever written
// by `EditorPane` with the real instance.

interface MonacoEditorLike {
  executeEdits: (
    source: string,
    edits: Array<{
      range: {
        startLineNumber: number;
        startColumn: number;
        endLineNumber: number;
        endColumn: number;
      };
      text: string;
      forceMoveMarkers?: boolean;
    }>,
  ) => unknown;
  pushUndoStop: () => void;
}

function applyToEditor(
  range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  },
  text: string,
): void {
  const editor = useEditorControllerStore.getState().editor as
    | MonacoEditorLike
    | null;
  if (!editor) {
    // The editor pane is not mounted (e.g.
    // we're on mobile, or the user closed
    // the file mid-edit). Log and bail —
    // there's nothing to apply to.
    if (import.meta.env.DEV) {
      console.warn(
        '[CmdKModal] applyToEditor: no editor in controller store',
      );
    }
    return;
  }
  editor.executeEdits('lipi-cmd-k', [
    { range, text, forceMoveMarkers: true },
  ]);
  // Make the apply one undoable step
  // (executeEdits pushes an undo stop
  // automatically; pushUndoStop ensures
  // the change is merged into the
  // previous edit if the user is mid-typing).
  editor.pushUndoStop();
}
