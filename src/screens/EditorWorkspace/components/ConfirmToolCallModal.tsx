import { useCallback, useEffect, useRef, useState } from 'react';
import { useAiStore } from '../state/aiStore';
import { listTools } from '../state/toolRegistry';
import { confirmAlwaysAllowTool } from '@/shared/toolPolicyWarnings';
import styles from './ConfirmToolCallModal.module.css';

/**
 * 5d: confirmation prompt for user-defined
 * tools whose `confirmationMode` requires
 * approval.
 *
 * 5c: the modal is also a tool-call
 * *review* surface — the user can edit
 * the args JSON before approving. The
 * edit is written back to the
 * `ToolCall.input` field before
 * execution, so:
 *   1. The follow-up stream sees the
 *      edited args in its `tool`
 *      message (replay uses edited
 *      values, not the model's).
 *   2. The activity log (5e) records
 *      the edited args.
 *
 * Three decisions:
 *   - [Deny]               — `kind: 'deny'`
 *   - [Run once]           — `kind: 'allow_once'`
 *   - [Always allow]       — `kind: 'allow_always'`
 *
 * The labels reflect the per-round semantics
 * of `per_call` (Run once means "this
 * exact call in this round") and the
 * permanent semantics of `always_confirm`
 * (Always allow demotes the tool's policy
 * to `always_allow`).
 *
 * The "Run once" button is the primary
 * action (blue) because in 5d the modal
 * is the EXPECTED flow, not the
 * surprising one. Users add custom
 * tools precisely because they want the
 * AI to call them — denying should
 * require an extra click.
 *
 * ## Edit semantics (5c)
 *
 * The args are presented as a pretty-
 * printed JSON in a `<textarea>`. We
 * don't try to render a typed form per
 * parameter — the tool registry doesn't
 * expose JSON Schemas to JS, and a
 * typed form would be hostile to tools
 * with nested/array args. A textarea
 * works for any tool.
 *
 * Live JSON validation:
 *   - On every keystroke, we try
 *     `JSON.parse(argsText)`. If it
 *     throws, we show the error inline
 *     and disable the "Run once" /
 *     "Always allow" buttons.
 *   - "Deny" is always enabled — the
 *     user can always refuse the
 *     call, regardless of args
 *     validity.
 *
 * "Reset to model's version" link:
 *   - Visible only when the user has
 *     edited the args. Clicking it
 *     restores the original
 *     `pending.argsJson`. Doesn't
 *     auto-close the modal.
 *
 * Why the modal seeds from
 * `pending.argsJson` (pretty-printed)
 * rather than `call.input` (raw
 * concatenated string): the user sees
 * what the model produced in the
 * human-readable form we already
 * computed in 5d. Saving a re-parse
 * round-trip on every open.
 */
export function ConfirmToolCallModal(): JSX.Element | null {
  const pending = useAiStore((s) => s.pendingConfirmation);
  const resolve = useAiStore((s) => s.resolveConfirmation);
  // Refs for keyboard focus management.
  const denyRef = useRef<HTMLButtonElement>(null);
  const runOnceRef = useRef<HTMLButtonElement>(null);
  const allowAlwaysRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 5c: editable args state. The
  // local `argsText` is the source
  // of truth for what's in the
  // textarea; `parseError` is
  // derived from it (try/catch on
  // every change). The state is
  // reseeded when a NEW
  // `pendingConfirmation` arrives
  // (different tool call) — the
  // `useEffect` below handles the
  // reseed. We deliberately do NOT
  // reseed on every `pending` change
  // (e.g. when the user resolves
  // and the same `pending` clears,
  // we don't want to flash a stale
  // value).
  const [argsText, setArgsText] = useState<string>('');
  const [parseError, setParseError] = useState<string | null>(null);
  // Track whether the textarea
  // has been seeded for the
  // current `pendingConfirmation`.
  // We need this because the
  // first `useEffect` run on
  // mount would otherwise try to
  // seed from a `null` pending.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  useEffect(() => {
    if (!pending) {
      setSeededFor(null);
      return;
    }
    if (seededFor !== pending.toolCallId) {
      // New tool call — seed from
      // the pending args. The
      // `parseError` will be
      // recomputed by the validator
      // effect below.
      setArgsText(pending.argsJson);
      setParseError(null);
      setSeededFor(pending.toolCallId);
    }
  }, [pending, seededFor]);
  // Live JSON validation. Recompute
  // on every `argsText` change.
  useEffect(() => {
    if (argsText.trim() === '') {
      // Empty is invalid — the
      // tool needs at least a JSON
      // value. We don't show an
      // error message; we just
      // disable the buttons. A
      // subtle "(empty)" hint
      // shows in the textarea
      // area.
      setParseError('Empty');
      return;
    }
    try {
      JSON.parse(argsText);
      setParseError(null);
    } catch (e) {
      setParseError(
        e instanceof Error ? e.message : 'Invalid JSON',
      );
    }
  }, [argsText]);
  // Whether the user has edited
  // away from the model's version.
  // Used to show the "Reset to
  // model's version" link.
  const isEdited = pending ? argsText !== pending.argsJson : false;
  // Buttons are disabled when
  // the JSON doesn't parse.
  // Deny is always enabled.
  const canRun = parseError === null;

  // Auto-focus the primary action on open
  // so the user can press Enter to confirm.
  // (The textarea doesn't steal focus —
  // the user can opt into editing by
  // clicking it.)
  useEffect(() => {
    if (pending && runOnceRef.current) {
      runOnceRef.current.focus();
    }
  }, [pending]);

  // Escape key = Deny. The modal
  // intentionally has no click-outside-to-
  // dismiss (an accidental click while
  // typing a long prompt could let the
  // model run a shell command).
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        resolve('deny');
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
    };
  }, [pending, resolve]);

  const onDeny = useCallback(() => resolve('deny'), [resolve]);
  const onAllowOnce = useCallback(() => {
    if (!canRun) return;
    // Pass the edited JSON
    // through. The store writes
    // it back to `call.input`
    // before execution. If the
    // user didn't edit, this
    // is the same as the
    // pending's `argsJson`.
    resolve('allow_once', canRun ? argsText : undefined);
  }, [resolve, canRun, argsText]);
  const onAllowAlways = useCallback(() => {
    if (!canRun || !pending) return;
    if (!confirmAlwaysAllowTool(pending.toolName)) return;
    resolve('allow_always', canRun ? argsText : undefined);
  }, [resolve, canRun, pending, argsText]);
  const onResetToModel = useCallback(() => {
    if (!pending) return;
    setArgsText(pending.argsJson);
    setParseError(null);
    // Refocus the textarea
    // so the user can keep
    // editing (or move on).
    textareaRef.current?.focus();
  }, [pending]);

  if (!pending) return null;

  // Look up the tool kind for the badge.
  // Built-in tools report
  // `kind: 'builtin'`; custom tools
  // report `'shell'` or `'http'`. The
  // helper is `listTools()` from the
  // JS `toolRegistry` (5c).
  const kind =
    listTools().find((t) => t.name === pending.toolName)?.kind ?? 'builtin';

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      data-testid="confirm-tool-call-backdrop"
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-tool-call-title"
        data-testid="confirm-tool-call-modal"
      >
        <div className={styles.header}>
          <span
            className={styles.kindBadge}
            data-kind={kind}
            data-testid="confirm-tool-call-kind"
          >
            {kind}
          </span>
          <div
            id="confirm-tool-call-title"
            className={styles.title}
            data-testid="confirm-tool-call-title"
          >
            Run <code>{pending.toolName}</code>?
          </div>
        </div>
        <div className={styles.body}>
          {pending.toolDescription && (
            <p
              className={styles.description}
              data-testid="confirm-tool-call-description"
            >
              {pending.toolDescription}
            </p>
          )}
          <div
            className={styles.argsLabel}
            data-testid="confirm-tool-call-args-label-row"
          >
            <span>Arguments</span>
            {isEdited && (
              <button
                type="button"
                className={styles.argsReset}
                onClick={onResetToModel}
                data-testid="confirm-tool-call-args-reset"
              >
                Reset to model&apos;s version
              </button>
            )}
          </div>
          <textarea
            ref={textareaRef}
            className={styles.args}
            data-invalid={parseError ? 'true' : undefined}
            value={argsText}
            onChange={(e) => setArgsText(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            rows={Math.min(12, Math.max(4, argsText.split('\n').length))}
            aria-label="Tool call arguments (JSON)"
            aria-invalid={parseError ? 'true' : 'false'}
            aria-describedby={
              parseError ? 'confirm-tool-call-args-error' : undefined
            }
            data-testid="confirm-tool-call-args"
          />
          {parseError && (
            <div
              id="confirm-tool-call-args-error"
              className={styles.argsError}
              role="alert"
              data-testid="confirm-tool-call-args-error"
            >
              Invalid JSON: {parseError}
            </div>
          )}
        </div>
        <div className={styles.footer}>
          <span className={styles.footerHint}>
            {isEdited
              ? 'Edits will be sent to the tool as the executed arguments.'
              : 'The model wants to call this tool. Choose how to handle it.'}
          </span>
          <button
            ref={denyRef}
            type="button"
            className={styles.btn}
            data-confirm="danger"
            onClick={onDeny}
            data-testid="confirm-tool-call-deny"
          >
            Deny
          </button>
          <button
            ref={runOnceRef}
            type="button"
            className={styles.btn}
            data-confirm="primary"
            onClick={onAllowOnce}
            disabled={!canRun}
            data-testid="confirm-tool-call-allow-once"
          >
            Run once
          </button>
          <button
            ref={allowAlwaysRef}
            type="button"
            className={styles.btn}
            onClick={onAllowAlways}
            disabled={!canRun}
            data-testid="confirm-tool-call-allow-always"
          >
            Always allow
          </button>
        </div>
      </div>
    </div>
  );
}
