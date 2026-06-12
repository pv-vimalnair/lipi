/**
 * Modal — a centered, dialog-style overlay.
 *
 * Phase 5b-5 adds this as a shared primitive because
 * the first consumer is `CmdKModal` (inline edit),
 * but every future centered overlay (e.g. the command
 * palette in 5b-6, the diff view in 5b-7, the API-key
 * prompt in 5c) will reuse it.
 *
 * Per Rule 4 (component reuse) this lives in
 * `src/shared/components/Modal/` and is exported
 * through `src/shared/components/index.ts`.
 *
 * Behaviour:
 *   - Backdrop covers the viewport with a
 *     semi-transparent dark layer.
 *   - Clicking the backdrop calls `onClose`.
 *   - ESC calls `onClose` (the `keydown` listener
 *     is attached to the panel root, not the
 *     document — so other modals can be stacked).
 *   - Focus is moved to the first focusable child
 *     on open. Tab/Shift+Tab cycle within the
 *     panel — the focus does not leak to the page
 *     behind the modal.
 *   - `aria-modal="true"` + `role="dialog"` +
 *     `aria-labelledby={titleId}` for screen
 *     readers. The CALLER supplies `titleId` and
 *     puts it on the title element inside the
 *     panel — Modal doesn't assume a title node
 *     shape.
 *
 * Non-goals (so we don't bloat this primitive):
 *   - Animation. 5b-5 doesn't animate; a later
 *     phase can add a `data-state="entering" /
 *     "exiting"` data-attribute and CSS transitions.
 *   - Modal stacking. 5b-5 has only one modal
 *     open at a time. If we ever need stacking,
 *     we'll add a portal + a counter-based
 *     stacking context. Not now.
 *   - Click-outside-of-panel-but-not-backdrop. The
 *     backdrop IS the outside; there's no
 *     distinction in 5b-5.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import styles from './Modal.module.css';

export interface ModalProps {
  /** Whether the modal is open. When false, nothing is rendered. */
  open: boolean;
  /**
   * Called when the user dismisses the modal
   * (ESC, backdrop click, or a focusable "Close"
   * button the caller renders). NOT called on
   * programmatic state changes — the modal
   * itself is stateless.
   */
  onClose: () => void;
  /**
   * `id` of the title element inside the
   * panel. Wired to `aria-labelledby` so
   * screen readers announce the title when
   * the modal opens. The CALLER must put this
   * id on a single element (usually an
   * `<h2>` or a `<span>` at the top of the
   * panel). The Modal uses `React.useId` to
   * generate a stable id when the caller
   * doesn't supply one.
   */
  titleId?: string;
  /**
   * Visible label for the modal (also used
   * as the default `aria-label` fallback if
   * `titleId` is not set). Not rendered as
   * DOM text — the caller renders their own
   * title. Exists for clarity in dev tools
   * and for the auto-generated `titleId`.
   */
  label?: string;
  /** The panel content. */
  children: ReactNode;
  /**
   * Extra class for the panel (not the
   * backdrop). Use to widen the panel
   * (e.g. `CmdKModal` sets a wider
   * `min-width` here).
   */
  className?: string;
  /**
   * If true, click-on-backdrop does NOT
   * close the modal. Defaults to false
   * (click-to-close is the standard
   * behaviour). ESC still closes.
   */
  disableBackdropClose?: boolean;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Find the first / last focusable element inside a
 * root. Returns `null` if there are no focusable
 * descendants. Tab/Shift+Tab cycling wraps from
 * the last element to the first and vice versa.
 */
function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    (el) =>
      !el.hasAttribute('aria-hidden') &&
      el.offsetParent !== null,
  );
}

export function Modal({
  open,
  onClose,
  titleId,
  label,
  children,
  className,
  disableBackdropClose = false,
}: ModalProps) {
  const fallbackTitleId = useId();
  const resolvedTitleId = titleId ?? fallbackTitleId;
  const panelRef = useRef<HTMLDivElement>(null);
  // Capture the element that had focus before the
  // modal opened, so we can restore focus on
  // close. This is the recommended a11y pattern —
  // a modal that traps focus and doesn't return
  // focus to its trigger is hostile to keyboard
  // users.
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Move focus into the panel on open. Runs after
  // the panel is mounted (i.e. after the
  // `if (!open) return null`).
  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = getFocusable(panel);
    if (focusables.length > 0) {
      focusables[0].focus();
    } else {
      // No focusable descendants — focus the
      // panel itself so keyboard events still
      // reach the keydown handler.
      panel.setAttribute('tabindex', '-1');
      panel.focus();
    }
    return () => {
      // Restore focus to the element that had
      // it before the modal opened. Only do
      // this if that element is still in the
      // DOM (e.g. we don't want to call
      // `.focus()` on a stale node that's been
      // unmounted).
      const prev = previouslyFocusedRef.current;
      if (prev && document.contains(prev)) {
        prev.focus();
      }
    };
  }, [open]);

  // Focus trap: cycle Tab / Shift+Tab within the
  // panel. If focus is somehow outside (e.g. the
  // user clicked into the backdrop), pull it back
  // to the first focusable on the next interaction.
  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = getFocusable(panel);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !panel.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !panel.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [onClose],
  );

  const handleBackdropClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      // Only fire when the click target is the
      // backdrop itself, not a child of the
      // panel. (We could check `e.target !==
      // e.currentTarget` instead — same
      // effect.)
      if (disableBackdropClose) return;
      if (e.target === e.currentTarget) onClose();
    },
    [disableBackdropClose, onClose],
  );

  if (!open) return null;

  return (
    <div
      className={styles.backdrop}
      onMouseDown={handleBackdropClick}
      data-modal-open
    >
      <div
        ref={panelRef}
        className={`${styles.panel} ${className ?? ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={resolvedTitleId}
        aria-label={label}
        onKeyDown={handleKeyDown}
      >
        {/* `headerId` is exposed via a hidden span
            when the caller doesn't render their
            own title. Otherwise the caller's
            element with `id={titleId}` is the
            accessible name. */}
        {!titleId && label && (
          <span id={resolvedTitleId} className={styles.srOnly}>
            {label}
          </span>
        )}
        {children}
      </div>
    </div>
  );
}
