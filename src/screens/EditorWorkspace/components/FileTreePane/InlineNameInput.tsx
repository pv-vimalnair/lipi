/**
 * InlineNameInput — the polished replacement for
 * `window.prompt` in the file-tree's "New File"
 * and "Rename" actions (Decision #66).
 *
 * Wraps the shared `Modal` primitive with a
 * labelled text input, two buttons
 * (Cancel / Create-or-Rename), and inline
 * validation feedback. Reuses the
 * `validateFileName` pure helper for the
 * rules.
 *
 * The caller passes a `mode` (`'new-file'`
 * or `'rename'`) and a list of existing
 * names. We pre-populate the input with
 * a sensible default (an unused
 * "untitled.txt" for new-file; the
 * current name for rename), and we
 * pre-select the basename (not the
 * extension) so the user can type to
 * replace it.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';

import { Button } from '@/shared/components/Button';
import { Modal } from '@/shared/components/Modal';
import { Stack } from '@/shared/components/Stack';

import {
  suggestNewFileName,
  validateFileName,
  type NameValidationResult,
} from './fileNameValidation';
import styles from './InlineNameInput.module.css';

export type InlineNameInputMode = 'new-file' | 'rename';

export interface InlineNameInputProps {
  /** Whether the modal is open. */
  open: boolean;
  /** The mode — drives the title, button label, and the default value. */
  mode: InlineNameInputMode;
  /**
   * Pre-populated value. For 'new-file' this
   * is the suggested fresh name
   * (`suggestNewFileName(existingNames)`).
   * For 'rename' this is the current
   * entry's name.
   */
  initialName: string;
  /**
   * The list of names that already exist in
   * the target directory. Used for the
   * collision check. For 'rename' the
   * caller MUST exclude the current name
   * from this set.
   */
  existingNames: ReadonlySet<string>;
  /**
   * Fired when the user confirms a valid
   * name. The parent runs the actual
   * create / rename mutation.
   */
  onConfirm: (name: string) => void;
  /** Fired when the user dismisses the modal. */
  onCancel: () => void;
}

export function InlineNameInput({
  open,
  mode,
  initialName,
  existingNames,
  onConfirm,
  onCancel,
}: InlineNameInputProps) {
  const [value, setValue] = useState(initialName);
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  // Reset internal state when the modal
  // opens. The caller passes a fresh
  // `initialName` each time it opens
  // (the parent re-derives the suggested
  // name), so we just sync to it.
  useEffect(() => {
    if (open) {
      setValue(initialName);
      setTouched(false);
    }
  }, [open, initialName]);

  // Pre-select the basename (everything
  // before the last dot) on open. For
  // new-file, the whole name is selected
  // (the user is typing a fresh name).
  // For rename, the basename is
  // selected (so the user can replace
  // the name without retyping the
  // extension).
  useEffect(() => {
    if (!open) return;
    const el = inputRef.current;
    if (!el) return;
    // Defer to the next tick so the
    // Modal's own focus effect (which
    // focuses the first focusable
    // child = the input) doesn't
    // race with the selection.
    const t = window.setTimeout(() => {
      el.focus();
      if (mode === 'rename') {
        const dot = value.lastIndexOf('.');
        const start = dot > 0 ? dot : value.length;
        el.setSelectionRange(0, start);
      } else {
        el.select();
      }
    }, 0);
    return () => window.clearTimeout(t);
    // `value` is intentionally omitted
    // — we only want to run the
    // selection on open, not on every
    // keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  // Validate the current value.
  // `touched` gates the inline error
  // message: the user shouldn't see
  // "Name cannot be empty" on first
  // mount, only after they've either
  // submitted or typed something
  // (which flips `touched` to true).
  const validation: NameValidationResult = validateFileName(
    value,
    existingNames,
  );
  const showError = touched && !validation.ok;
  const canSubmit = validation.ok;

  const handleChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value);
    setTouched(true);
  }, []);

  const handleSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setTouched(true);
      // Re-validate at submit time —
      // a stale `validation` from a
      // previous render is possible
      // if the user pasted and
      // submitted in the same frame.
      const v = validateFileName(value, existingNames);
      if (!v.ok) return;
      onConfirm(v.name);
    },
    [existingNames, onConfirm, value],
  );

  const title = mode === 'new-file' ? 'New file' : 'Rename';
  const confirmLabel = mode === 'new-file' ? 'Create' : 'Rename';

  return (
    <Modal
      open={open}
      onClose={onCancel}
      titleId={titleId}
      label={title}
      className={styles.modal}
    >
      <form onSubmit={handleSubmit} className={styles.form}>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        <Stack direction="column" gap={2}>
          <label className={styles.label} htmlFor="inline-name-input">
            Name
          </label>
          <input
            ref={inputRef}
            id="inline-name-input"
            type="text"
            className={styles.input}
            value={value}
            onChange={handleChange}
            aria-invalid={showError || undefined}
            aria-describedby={showError ? 'inline-name-error' : undefined}
            autoComplete="off"
            spellCheck={false}
            data-testid="inline-name-input"
          />
          {showError && (
            <p
              id="inline-name-error"
              role="alert"
              className={styles.error}
              data-testid="inline-name-error"
            >
              {validation.ok ? '' : validation.reason}
            </p>
          )}
        </Stack>
        <Stack direction="row" gap={2} align="end" justify="end">
          <Button variant="ghost" onClick={onCancel} type="button">
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={!canSubmit}
            data-testid="inline-name-confirm"
          >
            {confirmLabel}
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}

/**
 * Pick the right `initialName` for a given
 * mode + entry. Helper exported for
 * testability and to keep the parent's
 * `openX` callbacks tidy.
 *
 * - For 'new-file': a fresh suggested name
 *   (e.g. "untitled.txt" or
 *   "untitled (1).txt").
 * - For 'rename': the entry's current name
 *   (verbatim).
 */
export function initialNameFor(
  mode: InlineNameInputMode,
  existingNames: ReadonlySet<string>,
  currentName: string,
): string {
  if (mode === 'rename') return currentName;
  return suggestNewFileName(existingNames);
}
