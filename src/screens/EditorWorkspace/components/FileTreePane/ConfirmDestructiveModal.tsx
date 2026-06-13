/**
 * ConfirmDestructiveModal — the polished
 * replacement for `window.confirm` in the
 * file-tree's "Delete" action (Decision #66).
 *
 * Wraps the shared `Modal` primitive with a
 * title + body + Cancel / Delete button
 * pair. The Delete button uses
 * `variant="danger"`. The body varies based
 * on whether the target is a file or a
 * folder ("and all its contents" for
 * folders).
 *
 * The parent owns the actual delete IPC
 * call — this component is just the
 * confirm gate.
 */

import { useId } from 'react';

import { Button } from '@/shared/components/Button';
import { Modal } from '@/shared/components/Modal';
import { Stack } from '@/shared/components/Stack';

import styles from './ConfirmDestructiveModal.module.css';

export type ConfirmDestructiveKind = 'file' | 'folder';

export interface ConfirmDestructiveModalProps {
  /** Whether the modal is open. */
  open: boolean;
  /** The kind of entry being deleted — drives the body copy. */
  kind: ConfirmDestructiveKind;
  /** The name of the entry being deleted. */
  name: string;
  /**
   * Optional second-line context (e.g.
   * "this file is open in the editor"
   * or "X children will also be
   * removed"). Not rendered if omitted.
   */
  detail?: string;
  /** Fired when the user confirms. */
  onConfirm: () => void;
  /** Fired when the user cancels. */
  onCancel: () => void;
}

export function ConfirmDestructiveModal({
  open,
  kind,
  name,
  detail,
  onConfirm,
  onCancel,
}: ConfirmDestructiveModalProps) {
  const titleId = useId();
  const verb = kind === 'folder' ? 'Delete folder' : 'Delete file';
  // The body intentionally uses the
  // entry's actual name in quotes —
  // the v1 `window.confirm` copy is
  // too terse to spot the wrong target
  // on a long-named row.
  const body =
    kind === 'folder'
      ? `Delete folder "${name}" and all its contents? This cannot be undone.`
      : `Delete "${name}"? This cannot be undone.`;

  return (
    <Modal
      open={open}
      onClose={onCancel}
      titleId={titleId}
      label={verb}
      className={styles.modal}
    >
      <h2 id={titleId} className={styles.title}>
        {verb}
      </h2>
      <p className={styles.body} data-testid="confirm-destructive-body">
        {body}
      </p>
      {detail && <p className={styles.detail}>{detail}</p>}
      <Stack direction="row" gap={2} align="end" justify="end">
        <Button variant="ghost" onClick={onCancel} type="button">
          Cancel
        </Button>
        <Button
          variant="danger"
          onClick={onConfirm}
          type="button"
          data-testid="confirm-destructive-confirm"
        >
          Delete
        </Button>
      </Stack>
    </Modal>
  );
}
