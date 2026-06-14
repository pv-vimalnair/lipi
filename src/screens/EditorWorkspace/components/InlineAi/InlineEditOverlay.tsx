/**
 * InlineEditOverlay — the floating React UI for
 * the Phase 8 `Cmd+K` inline AI edit flow.
 *
 *   ┌─────────────────────────────────────────────────┐
 *   │ ⌥ Edit selection                                 │
 *   │                                                  │
 *   │ [ idle ]                                         │
 *   │   ┌────────────────────────────────────────────┐ │
 *   │   │ add a JSDoc comment above each const       │ │
 *   │   └────────────────────────────────────────────┘ │
 *   │  Enter to submit  ·  Esc to cancel               │
 *   │                                                  │
 *   │ [ streaming ]                                    │
 *   │   ⏳ AI is editing…                              │
 *   │                                                  │
 *   │ [ done ]                                         │
 *   │   ┌─ After ───────────────────────────────────┐ │
 *   │   │ /  rewritten text /                        │ │
 *   │   └────────────────────────────────────────────┘ │
 *   │   [ Tab ] Accept   [ Esc ] Reject                │
 *   │                                                  │
 *   │ [ error ]                                        │
 *   │   ✗ Something went wrong.                        │
 *   │   [ Try again ]                                  │
 *   └─────────────────────────────────────────────────┘
 *
 * The component renders into a Monaco
 * `IContentWidget` (Phase 8 — see
 * `useInlineEditOverlay.ts`). It is itself a plain
 * React component; the hook is responsible for
 * placing the DOM node in the right spot and
 * driving Monaco's redraw.
 *
 * The component is a pure consumer of
 * `inlineEditStore` + `aiStore`: it does not import
 * `monaco-editor` and does not know about the
 * editor's API. The `accept()` action in the store
 * is the only thing that talks to Monaco (via the
 * `editorControllerStore`).
 *
 * Per Rule 6 (section isolation) the component
 * never imports `EditorPane.tsx` or
 * `EditorWorkspace.tsx` — it is the hook, not the
 * component, that knows about the editor instance.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';

import { Button } from '@/shared/components';
import { useAiStore } from '../../state/aiStore';
import {
  useInlineEditStore,
  type InlineEditStatus,
} from '../../state/inlineEditStore';
import { getFriendlyError } from '../AIPanel/errorMessages';
import { buildInlineEditPrompt } from './buildInlineEditPrompt';
import styles from './InlineEditOverlay.module.css';

/**
 * Inline error copy for client-side validation
 * (empty instruction). The AI's errors come from
 * the aiStore and are surfaced via
 * `getFriendlyError()` (same as the chat panel).
 */
const PROMPT_ERROR_COPY: Record<string, string> = {
  'empty-selection': 'No text selected.',
  'empty-instruction': 'Type an instruction first.',
};

export interface InlineEditOverlayProps {
  /**
   * The monaco range to anchor the overlay at.
   * The hook reads the live editor's viewport
   * coordinates from this; the component itself
   * does not need it, but exposing it as a prop
   * keeps the component easy to test (a test
   * fixture can pass a known range without
   * having to spin up monaco).
   */
  anchorRange: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  } | null;
}

/**
 * Render the overlay's 3-state body. The
 * `selection` field on the store is the source of
 * truth — when it's null the overlay is hidden,
 * and the parent (`useInlineEditOverlay`) tears
 * down the content widget.
 */
export function InlineEditOverlay(_props: InlineEditOverlayProps) {
  const selection = useInlineEditStore((s) => s.selection);
  const instruction = useInlineEditStore((s) => s.instruction);
  const status = useInlineEditStore((s) => s.status);
  const proposal = useInlineEditStore((s) => s.proposal);
  const error = useInlineEditStore((s) => s.error);
  const streamingMessageId = useInlineEditStore(
    (s) => s.streamingMessageId,
  );

  const setInstruction = useInlineEditStore(
    (s) => s.setInstruction,
  );
  const beginStream = useInlineEditStore((s) => s.beginStream);
  const sealProposal = useInlineEditStore(
    (s) => s.sealProposal,
  );
  const fail = useInlineEditStore((s) => s.fail);
  const resetToIdle = useInlineEditStore(
    (s) => s.resetToIdle,
  );
  const accept = useInlineEditStore((s) => s.accept);
  const reject = useInlineEditStore((s) => s.reject);

  const sendEdit = useAiStore((s) => s.sendEdit);
  const messages = useAiStore((s) => s.messages);

  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // --- Focus the input when the overlay opens -----------------------
  //
  // The user just hit Cmd+K with a selection; the
  // natural next action is to start typing. We
  // focus the textarea on the `selection` transition
  // from null → non-null. The transition from
  // `idle` to `streaming` does NOT focus (the user
  // is no longer interacting with the input).
  useEffect(() => {
    if (selection && status === 'idle') {
      // queueMicrotask: the DOM node is mounted
      // by the time the microtask runs.
      queueMicrotask(() => {
        inputRef.current?.focus();
      });
    }
  }, [selection, status]);

  // --- Streaming -> Done / Error transition -------------------------
  //
  // Same pattern as the 5b-5 modal: when the
  // message with id `streamingMessageId` seals
  // (`streaming: false`), we move the inlineEditStore
  // to `'done'` and capture the proposal text.
  // The `done` error path flips to `'error'`.
  useEffect(() => {
    if (status !== 'streaming') return;
    if (!streamingMessageId) return;
    const target = messages.find(
      (m) => m.id === streamingMessageId,
    );
    if (!target) return;
    if (!target.streaming) {
      sealProposal(target.content);
    }
  }, [messages, sealProposal, status, streamingMessageId]);

  // Watch the aiStore's `requestStatus` — if it
  // flips to `error` while we're streaming, the
  // inlineEditStore goes to `'error'` too. We pull
  // both the kind and the message so the overlay
  // can show the same friendly copy as the chat
  // panel.
  const aiRequestStatus = useAiStore((s) => s.requestStatus);
  useEffect(() => {
    if (status !== 'streaming') return;
    if (aiRequestStatus.kind === 'error') {
      fail(aiRequestStatus.errorKind, aiRequestStatus.message);
    }
  }, [aiRequestStatus, fail, status]);

  // --- Submit handler (Enter in the textarea) -----------------------
  //
  // Enter submits (no Shift+Enter for the
  // overlay's instruction field — it's a
  // single-line prompt). We validate locally
  // (no point firing the IPC for an empty
  // instruction) and then hand off to
  // `aiStore.sendEdit`. The streaming effect
  // above flips the inlineEditStore to `'done'`
  // when the message seals.
  const handleSubmit = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault();
      setLocalError(null);
      if (!selection) {
        setLocalError(PROMPT_ERROR_COPY['empty-selection']);
        return;
      }
      const built = buildInlineEditPrompt(
        selection.text,
        instruction,
      );
      if (!built.ok) {
        setLocalError(
          PROMPT_ERROR_COPY[built.error] ?? 'Invalid input.',
        );
        return;
      }
      setLocalError(null);
      void sendEdit({
        systemPrompt: built.systemPrompt,
        userMessage: built.userMessage,
      }).then(
        (messageId) => {
          if (messageId) {
            beginStream(messageId);
          }
          // If sendEdit returned null, the
          // aiStore's `requestStatus` has
          // already flipped to error — the
          // `requestStatus` effect above will
          // move the inlineEditStore to
          // `'error'` on its own.
        },
        (err: unknown) => {
          // Defensive — sendEdit shouldn't
          // reject (errors flow through
          // `requestStatus`), but in case
          // it does, surface it.
          const message =
            err instanceof Error
              ? err.message
              : 'Failed to send the edit request.';
          fail('network', message);
        },
      );
    },
    [beginStream, fail, instruction, selection, sendEdit],
  );

  // --- Textarea key handling ----------------------------------------
  //
  // We intercept `Enter` (submit) but DO NOT
  // intercept `Esc` or `Tab` here — both are
  // registered as Monaco `editor.addCommand`
  // bindings on the editor itself (Phase 8
  // wiring in `useInlineEditOverlay`), so the
  // editor's keydown service sees them first
  // and the textarea never receives the event
  // when the Monaco editor has focus.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  // --- Render --------------------------------------------------------
  //
  // The component renders nothing when the
  // overlay is closed (`selection === null`).
  // The hook tears down the content widget at
  // the same time, so the DOM is clean.
  if (!selection) return null;

  return (
    <div
      className={styles.root}
      data-status={status}
      role="dialog"
      aria-label="Edit selection with AI"
    >
      <div className={styles.header}>
        <span className={styles.headerIcon} aria-hidden="true">
          ⌥
        </span>
        <span className={styles.headerTitle}>
          Edit selection
        </span>
        {status === 'done' && (
          <span
            className={styles.headerHint}
            aria-hidden="true"
          >
            Tab to accept · Esc to reject
          </span>
        )}
      </div>

      {status === 'idle' && (
        <IdleBody
          instruction={instruction}
          localError={localError}
          onInstruction={setInstruction}
          onKeyDown={handleKeyDown}
          inputRef={inputRef}
          onSubmit={handleSubmit}
        />
      )}

      {status === 'streaming' && <StreamingBody />}

      {status === 'done' && (
        <DoneBody
          proposal={proposal ?? ''}
          onAccept={accept}
          onReject={reject}
        />
      )}

      {status === 'error' && error && (
        <ErrorBody
          errorKind={error.kind}
          message={error.message}
          onRetry={resetToIdle}
          onDismiss={reject}
        />
      )}
    </div>
  );
}

// --- Idle body ----------------------------------------------------------

interface IdleBodyProps {
  instruction: string;
  localError: string | null;
  onInstruction: (text: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSubmit: () => void;
  inputRef: React.MutableRefObject<HTMLTextAreaElement | null>;
}

/**
 * The default body: a single-line instruction
 * input + a "Ask AI" button. The user can also
 * press Enter to submit (handled by the parent's
 * `onKeyDown`).
 */
function IdleBody({
  instruction,
  localError,
  onInstruction,
  onKeyDown,
  onSubmit,
  inputRef,
}: IdleBodyProps) {
  return (
    <div className={styles.body}>
      <textarea
        ref={inputRef}
        className={styles.input}
        value={instruction}
        onChange={(e) => onInstruction(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Describe the change (e.g. 'add a JSDoc comment above each const')"
        rows={1}
        aria-label="Edit instruction"
      />
      {localError && (
        <div className={styles.localError} role="alert">
          {localError}
        </div>
      )}
      <div className={styles.footer}>
        <span className={styles.hint}>
          Enter to submit · Esc to cancel
        </span>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={onSubmit}
          disabled={instruction.trim().length === 0}
          aria-label="Ask AI"
          title="Ask AI (Enter)"
        >
          Ask AI
        </Button>
      </div>
    </div>
  );
}

// --- Streaming body ----------------------------------------------------

/**
 * The "AI is editing…" view. We render a spinner
 * (a CSS animation on the `streamingDot` class) +
 * a status label. The text in the body is read
 * from the streaming message in the aiStore, but
 * per the Phase 8 plan the user explicitly chose
 * to wait for the full response before showing
 * the diff — so during `streaming` we ONLY show
 * the spinner, not the partial text. (The
 * aiStore's `messages` array is the canonical
 * place where the text accumulates.)
 */
function StreamingBody() {
  return (
    <div className={styles.body} aria-busy="true">
      <div className={styles.streaming}>
        <span
          className={styles.streamingDot}
          aria-hidden="true"
        />
        <span className={styles.streamingText}>
          AI is editing…
        </span>
      </div>
    </div>
  );
}

// --- Done body ---------------------------------------------------------

interface DoneBodyProps {
  proposal: string;
  onAccept: () => void;
  onReject: () => void;
}

/**
 * The result view. Renders the AI's proposal
 * text in a `<pre>` block (preserves whitespace
 * and uses the monospace font). The Accept /
 * Reject buttons at the bottom match the
 * keyboard shortcuts (Tab / Esc) — the hint
 * text in the header reminds the user.
 */
function DoneBody({ proposal, onAccept, onReject }: DoneBodyProps) {
  return (
    <div className={styles.body}>
      <div className={styles.afterLabel}>After</div>
      <pre className={styles.proposal}>{proposal}</pre>
      <div className={styles.footer}>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onReject}
          aria-label="Reject"
          title="Reject (Esc)"
        >
          Reject
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={onAccept}
          aria-label="Accept"
          title="Accept (Tab)"
        >
          Accept
        </Button>
      </div>
    </div>
  );
}

// --- Error body --------------------------------------------------------

interface ErrorBodyProps {
  errorKind: string;
  message: string;
  onRetry: () => void;
  onDismiss: () => void;
}

/**
 * The error view. Renders the friendly title +
 * hint from `getFriendlyError()` (same copy as
 * the AIPanel's error banner) plus a "Try again"
 * button (which flips the store back to `idle`,
 * preserving the user's instruction + selection)
 * and a "Dismiss" button (which clears the
 * store).
 */
function ErrorBody({
  errorKind,
  message,
  onRetry,
  onDismiss,
}: ErrorBodyProps) {
  const friendly = getFriendlyError(errorKind, message);
  return (
    <div className={styles.body} role="alert">
      <div className={styles.errorRow}>
        <span
          className={styles.errorIcon}
          aria-hidden="true"
        >
          ✗
        </span>
        <div className={styles.errorText}>
          <span className={styles.errorTitle}>
            {friendly.title}
          </span>
          {friendly.hint && (
            <span className={styles.errorHint}>
              {friendly.hint}
            </span>
          )}
        </div>
      </div>
      <div className={styles.footer}>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onDismiss}
          aria-label="Dismiss"
          title="Dismiss"
        >
          Dismiss
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={onRetry}
          aria-label="Try again"
          title="Try again"
        >
          Try again
        </Button>
      </div>
    </div>
  );
}

// Re-export the status type so the hook can refer
// to it without re-importing the store.
export type { InlineEditStatus };
