/**
 * FileRowContextMenu — the floating right-click
 * menu for a file-tree row (Decision #66 polish).
 *
 * Replaces the v1 `window.prompt('Enter 1, 2, or 3')`
 * action picker with a real `<ul role="menu">`
 * anchored at the click x/y. The menu:
 *
 *   - Renders above all other UI (z-index
 *     `var(--z-popover)`).
 *   - Auto-flips to the left if the click was
 *     near the right edge of the viewport.
 *   - Closes on outside click, ESC, or item
 *     activation.
 *   - Supports keyboard nav (arrow up/down,
 *     Enter to activate, Home / End to jump
 *     to first / last).
 *   - Items carry a typed `action` value
 *     (`'new-file' | 'rename' | 'delete'`).
 *     The parent wires each action to the
 *     appropriate modal.
 *
 * This component is purely presentational +
 * the floating-menu state machine. The
 * "new file" / "rename" / "delete" actions
 * are the PARENT's responsibility — we
 * just announce which one the user picked.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';

import styles from './FileRowContextMenu.module.css';

export type FileRowAction = 'new-file' | 'rename' | 'delete';

export interface FileRowMenuItem {
  /** Stable id, used for the React `key`. */
  id: string;
  /** The action this item triggers. */
  action: FileRowAction;
  /** Visible label. */
  label: string;
  /**
   * Optional destructive flag — items
   * marked destructive get a danger
   * colour on the label. The v1 menu
   * only has one destructive item
   * (Delete), but a future menu might
   * have a "Delete forever" or
   * "Empty trash" sub-action.
   */
  destructive?: boolean;
  /** Optional disabled flag. */
  disabled?: boolean;
}

export interface FileRowContextMenuProps {
  /**
   * The viewport x/y where the right-click
   * happened (from the contextmenu event's
   * `clientX` / `clientY`).
   */
  x: number;
  y: number;
  /** The items to render. Caller controls which actions are shown. */
  items: ReadonlyArray<FileRowMenuItem>;
  /**
   * Fired when the user picks an item
   * (mouse click or Enter on a focused
   * item). The menu auto-closes after
   * firing.
   */
  onPick: (action: FileRowAction) => void;
  /**
   * Fired when the user dismisses the
   * menu (ESC, click outside, item
   * activation). The parent uses this
   * to clear the local "menu is open"
   * state.
   */
  onDismiss: () => void;
  /**
   * Test seam — the menu reads the viewport
   * from `window.innerWidth` /
   * `window.innerHeight` by default.
   * Tests can pass a custom getter.
   */
  viewport?: () => { width: number; height: number };
}

const MENU_WIDTH = 220;
const MENU_HEIGHT_PER_ITEM = 28;
const MENU_PADDING = 8; // 4 top + 4 bottom
const VIEWPORT_EDGE_GUTTER = 8;

/**
 * Compute the menu's `left` / `top` from the
 * click point and the viewport. Auto-flips
 * to the left / up when the click was near
 * the right / bottom edge.
 *
 * Exported for testing.
 */
export function computeContextMenuPosition(
  clickX: number,
  clickY: number,
  itemCount: number,
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const menuHeight = MENU_PADDING + MENU_HEIGHT_PER_ITEM * itemCount;
  // Flip horizontally if the click was
  // near the right edge.
  const flipsX =
    clickX + MENU_WIDTH + VIEWPORT_EDGE_GUTTER > viewport.width;
  // Both branches clamp the LEFT to
  // the viewport right (so the menu
  // doesn't go off-screen on either
  // side). The flipped branch uses
  // `Math.max(GUTTER, clickX - MENU_WIDTH)`,
  // and if THAT result is still
  // larger than the available right
  // edge (a click way past the right
  // side of the viewport), we clamp
  // it again. The non-flipped branch
  // clamps to
  // `viewport.width - MENU_WIDTH - GUTTER`.
  const maxLeft = viewport.width - MENU_WIDTH - VIEWPORT_EDGE_GUTTER;
  const left = flipsX
    ? Math.max(
        VIEWPORT_EDGE_GUTTER,
        Math.min(maxLeft, clickX - MENU_WIDTH),
      )
    : Math.min(maxLeft, Math.max(VIEWPORT_EDGE_GUTTER, clickX));
  // Flip vertically if the click was near
  // the bottom edge.
  const flipsY = clickY + menuHeight + VIEWPORT_EDGE_GUTTER > viewport.height;
  const maxTop = viewport.height - menuHeight - VIEWPORT_EDGE_GUTTER;
  const top = flipsY
    ? Math.max(VIEWPORT_EDGE_GUTTER, Math.min(maxTop, clickY - menuHeight))
    : Math.min(maxTop, Math.max(VIEWPORT_EDGE_GUTTER, clickY));
  return { left, top };
}

export function FileRowContextMenu({
  x,
  y,
  items,
  onPick,
  onDismiss,
  viewport,
}: FileRowContextMenuProps) {
  // Track the focused index for arrow-key
  // navigation. Starts at 0 (the first
  // enabled item). We resolve the actual
  // item from the `items` array on each
  // render — disabled items are skipped
  // when the user arrows past them.
  const initialFocusIndex = items.findIndex((it) => !it.disabled);
  const [focusIndex, setFocusIndex] = useState(
    initialFocusIndex === -1 ? 0 : initialFocusIndex,
  );
  const listRef = useRef<HTMLUListElement>(null);
  // The "active" item is the one the
  // pointer is currently over. The
  // focused index (from keyboard) takes
  // precedence when set, but mouse
  // hover also updates focus so
  // keyboard and mouse are aligned.
  const getViewport = useCallback(
    () =>
      viewport
        ? viewport()
        : { width: window.innerWidth, height: window.innerHeight },
    [viewport],
  );

  // Move focus to the focused index
  // when it changes (so arrow keys
  // visually track the active row).
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const itemEls = list.querySelectorAll<HTMLLIElement>(
      `[role="menuitem"]:not([aria-disabled="true"])`,
    );
    const target = itemEls[focusIndex] as HTMLElement | undefined;
    if (target) target.focus();
  }, [focusIndex]);

  // Outside-click + ESC dismissal.
  // The mousedown listener is on
  // `document`; a mousedown on the menu
  // itself is stopped from propagating
  // (so a click on a menu item counts
  // as "inside" and activates the
  // item, not as "outside" and
  // dismisses).
  useEffect(() => {
    const handleMouseDown = (e: globalThis.MouseEvent) => {
      const list = listRef.current;
      if (!list) return;
      if (e.target instanceof Node && list.contains(e.target)) return;
      onDismiss();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onDismiss();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onDismiss]);

  const handleListKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLUListElement>) => {
      // Find the next / prev ENABLED
      // item, wrapping. We don't
      // deselect the focused item —
      // the menu is always focused on
      // one of its items.
      const move = (delta: number) => {
        const len = items.length;
        if (len === 0) return;
        let i = focusIndex;
        for (let step = 0; step < len; step += 1) {
          i = (i + delta + len) % len;
          if (!items[i].disabled) {
            setFocusIndex(i);
            return;
          }
        }
      };
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        move(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        move(-1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        const first = items.findIndex((it) => !it.disabled);
        if (first !== -1) setFocusIndex(first);
      } else if (e.key === 'End') {
        e.preventDefault();
        for (let i = items.length - 1; i >= 0; i -= 1) {
          if (!items[i].disabled) {
            setFocusIndex(i);
            return;
          }
        }
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const item = items[focusIndex];
        if (item && !item.disabled) {
          onPick(item.action);
        }
      }
    },
    [focusIndex, items, onPick],
  );

  const handleItemMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLLIElement>, item: FileRowMenuItem) => {
      // `mousedown` (not `click`) so the
      // dismissal listener (which also
      // fires on `mousedown`) is stopped
      // from dismissing the menu before
      // the action fires.
      e.preventDefault();
      e.stopPropagation();
      if (item.disabled) return;
      onPick(item.action);
    },
    [onPick],
  );

  const { left, top } = computeContextMenuPosition(
    x,
    y,
    items.length,
    getViewport(),
  );

  return (
    <ul
      ref={listRef}
      className={styles.menu}
      role="menu"
      aria-label="File row actions"
      style={{ left: `${left}px`, top: `${top}px` }}
      onKeyDown={handleListKeyDown}
      data-testid="file-row-context-menu"
    >
      {items.map((item, i) => {
        const isFocused = i === focusIndex;
        return (
          <li
            key={item.id}
            role="menuitem"
            tabIndex={isFocused ? 0 : -1}
            aria-disabled={item.disabled || undefined}
            data-destructive={item.destructive || undefined}
            data-testid={`file-row-menu-item-${item.action}`}
            className={styles.item}
            onMouseDown={(e) => handleItemMouseDown(e, item)}
            onMouseEnter={() => setFocusIndex(i)}
          >
            {item.label}
          </li>
        );
      })}
    </ul>
  );
}
