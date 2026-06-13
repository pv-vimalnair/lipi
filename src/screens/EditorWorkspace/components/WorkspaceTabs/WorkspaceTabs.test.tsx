/**
 * Tests for `WorkspaceTabs` —
 * the desktop tab strip that
 * lives directly under the
 * titlebar.
 *
 * We use a real DOM render
 * (`createRoot` + `act`) for
 * ALL assertions. This is
 * deliberate: Zustand's
 * selector runs via
 * `useSyncExternalStore`, which
 * uses `getServerSnapshot`
 * during SSR (and
 * `renderToStaticMarkup` IS
 * SSR). The server snapshot
 * is the store's INITIAL
 * state, not the current
 * state, so any setState
 * performed after the store's
 * `create()` call (e.g. in a
 * test's `beforeEach` or as a
 * test setup step) would not
 * be visible to a
 * server-rendered component.
 * DOM rendering avoids this
 * trap — the live subscription
 * picks up the current state.
 *
 * The `useWorkspaceStore` is
 * reset in `beforeEach` so the
 * tests don't share state.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import {
  createWorkspaceTab,
  useWorkspaceStore,
} from '@/shared/state/workspaceStore';
import { WorkspaceTabs } from './WorkspaceTabs';

// Mock the IPC fs module so
// `pickFolder` is a controllable
// stub. The other tests don't
// call `pickFolder`, so the
// mock being active for the
// whole file is safe.
const pickFolderMock = vi.hoisted(() => vi.fn().mockResolvedValue(null));
vi.mock('@/ipc/fs', () => ({ pickFolder: pickFolderMock }));

function reset(): void {
  localStorage.clear();
  useWorkspaceStore.setState({
    hydrated: true,
    workspaces: [],
    activeId: null,
    recents: [],
    status: { kind: 'idle' },
  });
}

function makeTab(path: string, id: string) {
  return createWorkspaceTab(path, id, 1000);
}

/** Mount `WorkspaceTabs` into a
 *  fresh DOM container and
 *  return the container so the
 *  test can query it. The
 *  caller is responsible for
 *  `unmount()` + `container.remove()`. */
function mount(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(WorkspaceTabs));
  });
  return { container, root };
}

beforeEach(() => {
  reset();
  pickFolderMock.mockReset();
  pickFolderMock.mockResolvedValue(null);
});
afterEach(reset);

describe('WorkspaceTabs', () => {
  it('renders nothing when no workspaces are open', () => {
    const { container, root } = mount();
    try {
      // The strip
      // returns
      // `null`
      // from
      // the
      // component
      // (no
      // `role="tablist"`
      // element
      // is
      // emitted
      // at
      // all).
      expect(container.querySelector('[role="tablist"]')).toBeNull();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('renders one pill per workspace', () => {
    useWorkspaceStore.setState({
      workspaces: [
        makeTab('/projects/lipi', 't1'),
        makeTab('/projects/other', 't2'),
      ],
      activeId: 't1',
    });
    const { container, root } = mount();
    try {
      // The strip's
      // `role` is
      // `tablist`
      // and the
      // pills are
      // `role="tab"`.
      expect(container.querySelector('[role="tablist"]')).toBeTruthy();
      expect(container.querySelectorAll('[role="tab"]')).toHaveLength(2);
      // The pill
      // labels are
      // the
      // basenames
      // of the
      // paths.
      expect(container.textContent).toMatch(/lipi/);
      expect(container.textContent).toMatch(/other/);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('marks the active tab with `data-active="true"` and `aria-selected="true"`', () => {
    useWorkspaceStore.setState({
      workspaces: [
        makeTab('/projects/lipi', 't1'),
        makeTab('/projects/other', 't2'),
      ],
      activeId: 't2',
    });
    const { container, root } = mount();
    try {
      // Both
      // pills
      // exist;
      // the
      // active
      // one
      // has
      // `data-active="true"`.
      const activeTabs = container.querySelectorAll('[data-active="true"]');
      expect(activeTabs).toHaveLength(1);
      const selectedTabs = container.querySelectorAll(
        '[aria-selected="true"]',
      );
      expect(selectedTabs).toHaveLength(1);
      // The
      // "other"
      // pill is
      // the
      // active
      // one.
      expect(activeTabs[0]?.getAttribute('data-testid')).toBe(
        'workspace-tab-t2',
      );
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('clicking a tab dispatches setActive', () => {
    useWorkspaceStore.setState({
      workspaces: [
        makeTab('/projects/lipi', 't1'),
        makeTab('/projects/other', 't2'),
      ],
      activeId: 't1',
    });
    const { container, root } = mount();
    try {
      // The
      // second
      // tab
      // is
      // t2.
      // Click
      // it
      // (the
      // tab
      // pill,
      // not
      // the
      // close
      // button).
      const t2Pill = container.querySelector(
        '[data-testid="workspace-tab-t2"]',
      ) as HTMLElement;
      expect(t2Pill).toBeTruthy();
      act(() => {
        t2Pill.click();
      });
      expect(useWorkspaceStore.getState().activeId).toBe('t2');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('clicking the × button dispatches close with the right tab id', () => {
    useWorkspaceStore.setState({
      workspaces: [
        makeTab('/projects/lipi', 't1'),
        makeTab('/projects/other', 't2'),
      ],
      activeId: 't1',
    });
    const { container, root } = mount();
    try {
      const closeBtn = container.querySelector(
        '[data-testid="workspace-tab-close-t2"]',
      ) as HTMLElement;
      expect(closeBtn).toBeTruthy();
      act(() => {
        closeBtn.click();
      });
      // t2 was
      // not
      // active,
      // so
      // active
      // is
      // still
      // t1 and
      // t2 is
      // removed.
      expect(useWorkspaceStore.getState().activeId).toBe('t1');
      expect(
        useWorkspaceStore
          .getState()
          .workspaces.find((w) => w.id === 't2'),
      ).toBeUndefined();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('clicking the + button calls pickFolder and opens a tab for the chosen path', async () => {
    // Configure the hoisted mock
    // to resolve with a chosen
    // path. Reset to null in
    // beforeEach via the
    // `mockReset` below.
    pickFolderMock.mockResolvedValueOnce('/projects/picked');
    useWorkspaceStore.setState({
      workspaces: [makeTab('/projects/lipi', 't1')],
      activeId: 't1',
    });
    const { container, root } = mount();
    try {
      const addBtn = container.querySelector(
        '[data-testid="workspace-tab-add"]',
      ) as HTMLElement;
      expect(addBtn).toBeTruthy();
      await act(async () => {
        addBtn.click();
        // Let
        // the
        // awaited
        // pickFolder
        // resolve
        // and
        // the
        // open()
        // action
        // run.
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(pickFolderMock).toHaveBeenCalled();
      // The
      // picked
      // path
      // is
      // now
      // a
      // tab.
      const tabs = useWorkspaceStore.getState().workspaces;
      expect(tabs.some((t) => t.path === '/projects/picked')).toBe(true);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});
