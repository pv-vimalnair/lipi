/**
 * Barrel file for the FileTreePane folder.
 * Exports the screen component and the
 * decision-#66 polish helpers (the
 * context menu, the inline name input,
 * the confirm-destructive modal) so a
 * future test or refactor can import
 * them via the folder rather than the
 * individual files.
 */

export { FileTreePane } from './FileTreePane';
export type { FileTreeStatus } from './FileTreePane';

// Decision #66 polish — exported for
// future tests and for callers that
// want to reuse the inline name input
// (e.g. a future "New folder" inline
// editor would import the same
// component).
export { FileRowContextMenu, computeContextMenuPosition } from './FileRowContextMenu';
export type { FileRowContextMenuProps, FileRowMenuItem, FileRowAction } from './FileRowContextMenu';
export { InlineNameInput, initialNameFor } from './InlineNameInput';
export type { InlineNameInputProps, InlineNameInputMode } from './InlineNameInput';
export { ConfirmDestructiveModal } from './ConfirmDestructiveModal';
export type {
  ConfirmDestructiveModalProps,
  ConfirmDestructiveKind,
} from './ConfirmDestructiveModal';
export { validateFileName, suggestNewFileName, MAX_NAME_LENGTH } from './fileNameValidation';
export type { NameValidationResult } from './fileNameValidation';
