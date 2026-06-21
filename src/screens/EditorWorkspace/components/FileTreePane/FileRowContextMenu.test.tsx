/**
 * Tests for `FileRowContextMenu` — the
 * Decision #66 polished right-click
 * menu for the file tree.
 *
 * We use `createRoot` + `act` (from
 * react-dom/client + react-dom/test-utils)
 * because the menu mounts a real DOM
 * `<ul>` and listens to document-level
 * `mousedown` / `keydown` events.
 * `renderToStaticMarkup` is not enough
 * for the keyboard navigation tests.
 *
 * Mirrors the project's existing test
 * pattern (see
 * `useVoiceCapture.ondevice.test.tsx`).
 */

import { act, type ReactElement, type PropsWithChildren } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FileRowContextMenu,
  computeContextMenuPosition,
  type FileRowMenuItem,
} from './FileRowContextMenu';

// Test viewport — fixed so position
// math is deterministic.
const VIEWPORT = { width: 1024, height: 768 };

const SAMPLE_ITEMS: ReadonlyArray<FileRowMenuItem> = [
  { id: 'new-file', action: 'new-file', label: 'New file in folder…' },
  { id: 'rename', action: 'rename', label: 'Rename…' },
  {
    id: 'delete',
    action: 'delete',
    label: 'Delete…',
    destructive: true,
  },
];

interface RenderHandle {
  root: Root;
  container: HTMLDivElement;
  cleanup: () => void;
}

function renderMenu(
  ui: ReactElement<PropsWithChildren<unknown>>,
): RenderHandle {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return {
    root,
    container,
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function fireKey(target: Element | null, key: string): void {
  if (!target) throw new Error('fireKey: target is null');
  act(() => {
    const evt = new KeyboardEvent('keydown', { key, bubbles: true });
    target.dispatchEvent(evt);
  });
}

function fireMouseDownOn(target: Element | null): void {
  if (!target) throw new Error('fireMouseDownOn: target is null');
  act(() => {
    const evt = new MouseEvent('mousedown', { bubbles: true });
    target.dispatchEvent(evt);
  });
}

describe('computeContextMenuPosition', () => {
  it('places the menu at the click point when there is room', () => {
    const r = computeContextMenuPosition(100, 100, 3, VIEWPORT);
    expect(r.left).toBe(100);
    // 8 (padding) + 28 (per item) * 3 = 92 px tall
    // click y was 100; menu height 92; 100+92=192 < 768
    // → no flip
    expect(r.top).toBe(100);
  });

  it('flips to the left when the click is near the right edge', () => {
    // Click at x=900. Menu width 220. 900+220+8 > 1024.
    const r = computeContextMenuPosition(900, 100, 3, VIEWPORT);
    // Flipped left → x = 900 - 220 = 680
    expect(r.left).toBe(680);
    expect(r.top).toBe(100);
  });

  it('flips up when the click is near the bottom edge', () => {
    // Click at y=700. Menu height 92. 700+92+8 > 768.
    const r = computeContextMenuPosition(100, 700, 3, VIEWPORT);
    expect(r.left).toBe(100);
    // Flipped up → y = 700 - 92 = 608
    expect(r.top).toBe(608);
  });

  it('clamps to the viewport right when fully past the edge', () => {
    // Click at x=5000 (way past the right
    // edge of a 1024-wide viewport).
    // The flipped position would be
    // 4780, which is still way past
    // the right edge — we clamp to
    // `maxLeft = 1024 - 220 - 8 = 796`
    // so the menu is still on-screen.
    const r = computeContextMenuPosition(5000, 100, 3, VIEWPORT);
    expect(r.left).toBe(VIEWPORT.width - 220 - 8);
  });
});

describe('FileRowContextMenu', () => {
  let handle: RenderHandle | null = null;

  beforeEach(() => {
    // jsdom's default innerWidth / innerHeight
    // are 1024 / 768 — set them explicitly so
    // any code path that reads from `window`
    // is in lockstep with the test viewport.
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: VIEWPORT.width,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: VIEWPORT.height,
    });
  });

  afterEach(() => {
    handle?.cleanup();
    handle = null;
  });

  it('renders all 3 items with the right roles and labels', () => {
    const onPick = vi.fn();
    const onDismiss = vi.fn();
    handle = renderMenu(
      <FileRowContextMenu
        x={100}
        y={100}
        items={SAMPLE_ITEMS}
        onPick={onPick}
        onDismiss={onDismiss}
        viewport={() => VIEWPORT}
      />,
    );

    const menu = handle.container.querySelector('[role="menu"]');
    expect(menu).toBeTruthy();
    const items = handle.container.querySelectorAll('[role="menuitem"]');
    expect(items.length).toBe(3);
    expect(items[0].textContent).toBe('New file in folder…');
    expect(items[1].textContent).toBe('Rename…');
    expect(items[2].textContent).toBe('Delete…');
  });

  it('marks destructive items with data-destructive', () => {
    const onPick = vi.fn();
    const onDismiss = vi.fn();
    handle = renderMenu(
      <FileRowContextMenu
        x={100}
        y={100}
        items={SAMPLE_ITEMS}
        onPick={onPick}
        onDismiss={onDismiss}
        viewport={() => VIEWPORT}
      />,
    );
    const items = handle.container.querySelectorAll('[role="menuitem"]');
    expect(items[0].getAttribute('data-destructive')).toBeNull();
    expect(items[1].getAttribute('data-destructive')).toBeNull();
    expect(items[2].getAttribute('data-destructive')).toBe('true');
  });

  it('fires onPick with the right action on Enter', () => {
    const onPick = vi.fn();
    const onDismiss = vi.fn();
    handle = renderMenu(
      <FileRowContextMenu
        x={100}
        y={100}
        items={SAMPLE_ITEMS}
        onPick={onPick}
        onDismiss={onDismiss}
        viewport={() => VIEWPORT}
      />,
    );
    const items = handle.container.querySelectorAll('[role="menuitem"]');
    // The first item is the initial focus.
    // Pressing Enter on it fires the action.
    fireKey(items[0], 'Enter');
    expect(onPick).toHaveBeenCalledWith('new-file');
  });

  it('fires onPick with the right action on Space', () => {
    const onPick = vi.fn();
    const onDismiss = vi.fn();
    handle = renderMenu(
      <FileRowContextMenu
        x={100}
        y={100}
        items={SAMPLE_ITEMS}
        onPick={onPick}
        onDismiss={onDismiss}
        viewport={() => VIEWPORT}
      />,
    );
    const items = handle.container.querySelectorAll('[role="menuitem"]');
    // ArrowDown to advance to the second
    // item, then Space to activate it.
    const menu = handle.container.querySelector('[role="menu"]');
    if (!menu) throw new Error('Menu not found');
    fireKey(menu, 'ArrowDown');
    fireKey(items[1], ' ');
    expect(onPick).toHaveBeenCalledWith('rename');
  });

  it('ArrowUp / ArrowDown skip disabled items', () => {
    const onPick = vi.fn();
    const onDismiss = vi.fn();
    const itemsWithDisabled: ReadonlyArray<FileRowMenuItem> = [
      { id: 'rename', action: 'rename', label: 'Rename…' },
      { id: 'new-file', action: 'new-file', label: 'New file…', disabled: true },
      { id: 'delete', action: 'delete', label: 'Delete…', destructive: true },
    ];
    handle = renderMenu(
      <FileRowContextMenu
        x={100}
        y={100}
        items={itemsWithDisabled}
        onPick={onPick}
        onDismiss={onDismiss}
        viewport={() => VIEWPORT}
      />,
    );
    const menu = handle.container.querySelector('[role="menu"]');
    if (!menu) throw new Error('Menu not found');
    // Initial focus is on the first
    // non-disabled item, which is item 0
    // (Rename). ArrowDown should skip
    // item 1 (disabled) and land on
    // item 2 (Delete).
    fireKey(menu, 'ArrowDown');
    const items = handle.container.querySelectorAll('[role="menuitem"]');
    fireKey(items[2], 'Enter');
    expect(onPick).toHaveBeenCalledWith('delete');
  });

  it('mousedown on an item fires onPick with that action', () => {
    const onPick = vi.fn();
    const onDismiss = vi.fn();
    handle = renderMenu(
      <FileRowContextMenu
        x={100}
        y={100}
        items={SAMPLE_ITEMS}
        onPick={onPick}
        onDismiss={onDismiss}
        viewport={() => VIEWPORT}
      />,
    );
    const items = handle.container.querySelectorAll('[role="menuitem"]');
    // The mousedown is fired on the
    // 3rd item (Delete). The component
    // also listens to a document-level
    // mousedown for outside-click
    // dismissal — the mousedown on an
    // item is stopped from propagating
    // so the dismissal listener doesn't
    // fire.
    fireMouseDownOn(items[2]);
    expect(onPick).toHaveBeenCalledWith('delete');
  });

  it('mousedown outside the menu fires onDismiss', () => {
    const onPick = vi.fn();
    const onDismiss = vi.fn();
    handle = renderMenu(
      <FileRowContextMenu
        x={100}
        y={100}
        items={SAMPLE_ITEMS}
        onPick={onPick}
        onDismiss={onDismiss}
        viewport={() => VIEWPORT}
      />,
    );
    // Click somewhere outside the menu.
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    try {
      fireMouseDownOn(outside);
      expect(onDismiss).toHaveBeenCalled();
    } finally {
      outside.remove();
    }
  });

  it('Escape fires onDismiss', () => {
    const onPick = vi.fn();
    const onDismiss = vi.fn();
    handle = renderMenu(
      <FileRowContextMenu
        x={100}
        y={100}
        items={SAMPLE_ITEMS}
        onPick={onPick}
        onDismiss={onDismiss}
        viewport={() => VIEWPORT}
      />,
    );
    fireKey(document.body, 'Escape');
    expect(onDismiss).toHaveBeenCalled();
  });

  it('Home / End jump to the first / last item', () => {
    const onPick = vi.fn();
    const onDismiss = vi.fn();
    handle = renderMenu(
      <FileRowContextMenu
        x={100}
        y={100}
        items={SAMPLE_ITEMS}
        onPick={onPick}
        onDismiss={onDismiss}
        viewport={() => VIEWPORT}
      />,
    );
    const menu = handle.container.querySelector('[role="menu"]');
    if (!menu) throw new Error('Menu not found');
    fireKey(menu, 'End');
    const items = handle.container.querySelectorAll('[role="menuitem"]');
    fireKey(items[2], 'Enter');
    expect(onPick).toHaveBeenCalledWith('delete');
  });
});
