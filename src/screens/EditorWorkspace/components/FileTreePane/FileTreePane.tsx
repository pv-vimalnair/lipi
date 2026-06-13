import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';

import { Button } from '@/shared/components/Button';
import type { FsEntry } from '@/ipc';
import { FsError } from '@/ipc';
import { PaneShell } from '../PaneShell';

import {
  fileTreeSelectors,
  useFileTreeStore,
  type FileTreeStatus,
} from '../../state/fileTreeStore';
import { useFileTree, useFileTreeWatcher } from '../../hooks/useFileTree';
import {
  ConfirmDestructiveModal,
  FileRowContextMenu,
  InlineNameInput,
  initialNameFor,
  type FileRowAction,
  type FileRowMenuItem,
  type InlineNameInputMode,
} from './index';
import styles from './FileTreePane.module.css';

const INDENT_PX = 12; // matches --space-3

/**
 * File tree / project explorer pane. Phase 2b:
 *   - "Open folder" header action calls the native picker.
 *   - Selected root is read into the store and rendered recursively.
 *   - Directories lazy-load their children on first expand.
 *   - Click a file: log the path.
 *   - Right-click a row: opens a floating context menu
 *     (`FileRowContextMenu`) with 2-3 items
 *     (New File in this folder / Rename / Delete for
 *     dirs; Rename / Delete for files). The picked
 *     action opens a purpose-built modal:
 *     `InlineNameInput` for name entry
 *     (replaces the v1 `window.prompt`) and
 *     `ConfirmDestructiveModal` for the delete gate
 *     (replaces the v1 `window.confirm`). See
 *     Decision #66 in HANDOFF for the v1 → v2
 *     polish history.
 */
export function FileTreePane() {
  const status = useFileTreeStore(fileTreeSelectors.status);
  const rootPath = useFileTreeStore(fileTreeSelectors.rootPath);
  const { openFolder, close } = useFileTree();

  return (
    <PaneShell
      label="Explorer"
      area="tree"
      headerAction={
        rootPath ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={close}
            aria-label="Close folder"
          >
            Close
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={openFolder}
            aria-label="Open folder"
          >
            Open…
          </Button>
        )
      }
    >
      <div data-tour-target="fileTree" style={{ height: '100%' }}>
        {status.kind === 'idle' || status.kind === 'opening' ? (
          <div className={styles.placeholder}>
            <p>No folder open.</p>
            <Button variant="primary" size="sm" onClick={openFolder}>
              Open folder…
            </Button>
          </div>
        ) : status.kind === 'error' ? (
          <div className={styles.placeholder} role="alert">
            <p>Couldn't read folder:</p>
            <code>{status.message}</code>
          </div>
        ) : (
          <TreeRoot rootPath={status.rootPath ?? rootPath ?? ''} />
        )}
      </div>
    </PaneShell>
  );
}

interface TreeRootProps {
  rootPath: string;
}

function TreeRoot({ rootPath }: TreeRootProps) {
  const entries = useFileTreeStore(fileTreeSelectors.entriesFor(rootPath));
  const { ensureLoaded, refresh, startWatch, stopWatchOnHandle } =
    useFileTree();
  const loadedOnce = useRef(false);
  const watchHandleRef = useRef<{ id: number; path: string } | null>(null);
  // Subscribe to fs://changed for the
  // lifetime of the tree. The hook
  // debounces per-directory on the JS
  // side and skips directories the user
  // hasn't loaded yet.
  useFileTreeWatcher(refresh);

  // Trigger the initial load when the root first mounts in 'ready'.
  // The store's load action is idempotent (returns early if cached).
  useEffect(() => {
    if (!loadedOnce.current) {
      loadedOnce.current = true;
      void ensureLoaded(rootPath);
    }
    // Start a Rust watcher for the root.
    // The Rust side is idempotent — a
    // duplicate startWatch returns the
    // existing handle. We still track
    // the handle in a ref so we can
    // stop it on teardown.
    let cancelled = false;
    void startWatch(rootPath)
      .then((handle) => {
        if (cancelled) {
          void stopWatchOnHandle(handle);
        } else {
          watchHandleRef.current = handle;
        }
      })
      .catch(() => {
        // Watcher start failed (e.g. the
        // directory was deleted between
        // open and watch). The store's
        // status will show the underlying
        // read error if it matters.
      });
    return () => {
      cancelled = true;
      if (watchHandleRef.current) {
        void stopWatchOnHandle(watchHandleRef.current);
        watchHandleRef.current = null;
      }
    };
  }, [ensureLoaded, rootPath, startWatch, stopWatchOnHandle]);

  if (!entries) {
    return (
      <div className={styles.placeholder}>
        <span>Loading…</span>
      </div>
    );
  }

  return (
    <ul
      className={styles.tree}
      role="tree"
      aria-label="Project files"
      data-testid="file-tree"
    >
      {entries.map((entry) => (
        <TreeNode
          key={entry.path}
          entry={entry}
          depth={0}
          rootPath={rootPath}
        />
      ))}
    </ul>
  );
}

interface TreeNodeProps {
  entry: FsEntry;
  depth: number;
  rootPath: string;
}

function TreeNode({ entry, depth, rootPath }: TreeNodeProps) {
  const isExpanded = useFileTreeStore(fileTreeSelectors.isExpanded(entry.path));
  const children = useFileTreeStore(fileTreeSelectors.entriesFor(entry.path));
  const selectedPath = useFileTreeStore(fileTreeSelectors.selectedPath);
  const { toggle, select, create, delete: deleteOp, rename, startWatch, stopWatchOnHandle } = useFileTree();
  // Local error string — kept here so the error
  // surfaces next to the row that caused it. A
  // full toast/notification system is out of
  // scope for this feature.
  const [rowError, setRowError] = useState<string | null>(null);
  // Per-directory watcher handle.
  // Tracked here so we can stop the
  // watcher on collapse or unmount.
  const watchHandleRef = useRef<{ id: number; path: string } | null>(null);

  const isSelected = selectedPath === entry.path;
  const isDir = entry.isDir;

  // --- Decision #66 polish: state machine
  // for the right-click menu + the 2 modals.
  // The 3 pieces of UI are mutually
  // exclusive (only one can be open at a
  // time), and the parent's existing
  // `runMutation` is the common path for
  // surfacing errors next to the row.
  type MenuState = { x: number; y: number; entry: FsEntry } | null;
  const [menu, setMenu] = useState<MenuState>(null);
  type NameInputState = {
    mode: InlineNameInputMode;
    initialName: string;
    existingNames: Set<string>;
    // The entry the action targets. For
    // 'new-file' this is the directory
    // we're creating in (i.e. the row
    // that was right-clicked, which is
    // itself a directory). For 'rename'
    // this is the entry being renamed.
    target: FsEntry;
  } | null;
  const [nameInput, setNameInput] = useState<NameInputState>(null);
  type ConfirmState = {
    kind: 'file' | 'folder';
    name: string;
    target: FsEntry;
  } | null;
  const [confirm, setConfirm] = useState<ConfirmState>(null);

  // The existing entries for the
  // directory the action will land
  // in. For 'new-file' on a directory
  // row, this is the directory's
  // children. For 'rename' on a file
  // row, this is the file's parent's
  // children (excluding the file
  // itself). For 'rename' on a
  // directory row, this is the
  // directory's parent's children
  // (excluding the directory itself).
  const collectExistingNames = useCallback(
    (parentPath: string, excludeName?: string): Set<string> => {
      const all = useFileTreeStore.getState().entriesByDir;
      const entries = all[parentPath] ?? [];
      const out = new Set<string>();
      for (const e of entries) {
        if (excludeName !== undefined && e.name === excludeName) continue;
        out.add(e.name);
      }
      return out;
    },
    [],
  );

  // Build the menu items. Folders get 3
  // items (New File in this folder /
  // Rename / Delete); files get 2 (Rename
  // / Delete).
  const menuItems: ReadonlyArray<FileRowMenuItem> = isDir
    ? [
        { id: 'new-file', action: 'new-file', label: 'New file in folder…' },
        { id: 'rename', action: 'rename', label: 'Rename…' },
        {
          id: 'delete',
          action: 'delete',
          label: 'Delete…',
          destructive: true,
        },
      ]
    : [
        { id: 'rename', action: 'rename', label: 'Rename…' },
        {
          id: 'delete',
          action: 'delete',
          label: 'Delete…',
          destructive: true,
        },
      ];

  const handleMenuPick = useCallback(
    (action: FileRowAction) => {
      const m = menu;
      setMenu(null);
      if (!m) return;
      // Compute the target parent for the
      // resulting action. For 'new-file'
      // on a folder row, the parent is the
      // folder itself. For all other
      // actions, the parent is the entry's
      // parent (the row above it).
      const target = m.entry;
      if (action === 'new-file') {
        if (!isDir) return; // unreachable: new-file is only on folder rows
        const existing = collectExistingNames(target.path);
        setNameInput({
          mode: 'new-file',
          initialName: initialNameFor('new-file', existing, target.name),
          existingNames: existing,
          target,
        });
      } else if (action === 'rename') {
        const parent = isDir ? parentOf(target.path) : parentOf(target.path);
        // For a top-level file/dir, the
        // parent is the root, and the
        // root's children live under
        // `rootPath` in the store. We
        // handle that by always reading
        // the existing-names set from
        // the entry's parent path.
        const existing = collectExistingNames(parent, target.name);
        setNameInput({
          mode: 'rename',
          initialName: target.name,
          existingNames: existing,
          target,
        });
      } else if (action === 'delete') {
        setConfirm({
          kind: isDir ? 'folder' : 'file',
          name: target.name,
          target,
        });
      }
    },
    [collectExistingNames, isDir, menu],
  );

  const handleNameConfirm = useCallback(
    (name: string) => {
      const ni = nameInput;
      setNameInput(null);
      if (!ni) return;
      if (ni.mode === 'new-file') {
        const parent = ni.target.path;
        const newPath = joinPath(parent, name);
        void runMutation(() => create(newPath));
      } else {
        // rename
        const parent = parentOf(ni.target.path) ?? '';
        const newPath = joinPath(parent, name);
        if (newPath === ni.target.path) return; // no-op
        void runMutation(() => rename(ni.target.path, newPath));
      }
    },
    [nameInput],
  );

  const handleConfirmDelete = useCallback(() => {
    const c = confirm;
    setConfirm(null);
    if (!c) return;
    void runMutation(() => deleteOp(c.target.path));
  }, [confirm]);

  const handleClick = () => {
    setRowError(null);
    if (isDir) {
      void toggle(entry.path);
    } else {
      select(entry.path);
    }
  };

  const handleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    } else if (e.key === 'ArrowRight' && isDir && !isExpanded) {
      e.preventDefault();
      void toggle(entry.path);
    } else if (e.key === 'ArrowLeft' && isDir && isExpanded) {
      e.preventDefault();
      void toggle(entry.path);
    }
  };

  const handleContextMenu = (e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    setRowError(null);
    select(entry.path);
    setMenu({ x: e.clientX, y: e.clientY, entry });
  };

  const runMutation = async (fn: () => Promise<void>) => {
    try {
      await fn();
      setRowError(null);
    } catch (err) {
      const msg =
        err instanceof FsError
          ? `${err.payload.kind}: ${err.payload.detail}`
          : String(err);
      setRowError(msg);
    }
  };

  // Start a watcher when this directory is
  // expanded; stop it when collapsed or
  // unmounted. The root has its own
  // watcher (started in `TreeRoot`); we
  // skip the start here for depth === 0
  // to avoid registering twice.
  useEffect(() => {
    if (!isDir || !isExpanded) return;
    if (depth === 0) return; // root is watched by TreeRoot
    let cancelled = false;
    void startWatch(entry.path)
      .then((handle) => {
        if (cancelled) {
          void stopWatchOnHandle(handle);
        } else {
          watchHandleRef.current = handle;
        }
      })
      .catch(() => {
        // Same swallow as the root.
      });
    return () => {
      cancelled = true;
      if (watchHandleRef.current) {
        void stopWatchOnHandle(watchHandleRef.current);
        watchHandleRef.current = null;
      }
    };
  }, [
    depth,
    entry.path,
    isDir,
    isExpanded,
    startWatch,
    stopWatchOnHandle,
  ]);

  return (
    <li role="none" className={styles.node}>
      <div
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={isDir ? isExpanded : undefined}
        aria-selected={isSelected}
        tabIndex={isSelected || (selectedPath === null && depth === 0) ? 0 : -1}
        className={styles.row}
        data-selected={isSelected || undefined}
        data-kind={isDir ? 'dir' : 'file'}
        style={{ paddingLeft: `${depth * INDENT_PX + 8}px` }}
        onClick={handleClick}
        onKeyDown={handleKey}
        onContextMenu={handleContextMenu}
      >
        <span className={styles.chevron} aria-hidden="true">
          {isDir ? (isExpanded ? '▾' : '▸') : ''}
        </span>
        <span className={styles.icon} aria-hidden="true">
          {isDir ? (isExpanded ? '📂' : '📁') : '📄'}
        </span>
        <span className={styles.name}>{entry.name}</span>
      </div>
      {rowError && (
        <div
          className={styles.rowError}
          role="alert"
          data-testid="file-tree-row-error"
        >
          {rowError}
        </div>
      )}
      {isDir && isExpanded && children && (
        <ul role="group" className={styles.children}>
          {children.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              rootPath={rootPath}
            />
          ))}
        </ul>
      )}
      {/* Decision #66 polish — the floating
       * right-click menu + the 2 modals.
       * They're mounted at the row level
       * (not the tree root) so the menu
       * can be opened on any row without
       * lifting state. Only one is open
       * at a time, gated by the
       * conditional renders. */}
      {menu && (
        <FileRowContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onPick={handleMenuPick}
          onDismiss={() => setMenu(null)}
        />
      )}
      {nameInput && (
        <InlineNameInput
          open
          mode={nameInput.mode}
          initialName={nameInput.initialName}
          existingNames={nameInput.existingNames}
          onConfirm={handleNameConfirm}
          onCancel={() => setNameInput(null)}
        />
      )}
      {confirm && (
        <ConfirmDestructiveModal
          open
          kind={confirm.kind}
          name={confirm.name}
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirm(null)}
        />
      )}
    </li>
  );
}

/**
 * Return the parent directory of a file path, or
 * the empty string if the path has no parent
 * (which the menu treats as "no parent to act in"
 * — shouldn't happen in practice for tree rows).
 */
function parentOf(path: string): string {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (idx <= 0) return '';
  return path.slice(0, idx);
}

/**
 * Join a parent directory and a child name with
 * the platform separator. The Rust side
 * normalises the result, so we just need a
 * sensible join — we pick `\` on Windows-likely
 * inputs (any path containing a `\`) and `/`
 * otherwise.
 */
function joinPath(parent: string, child: string): string {
  if (!parent) return child;
  const sep = parent.includes('\\') ? '\\' : '/';
  const trimmed = parent.endsWith(sep) ? parent.slice(0, -1) : parent;
  return `${trimmed}${sep}${child}`;
}

// Re-export the discriminated union shape so consumers can pattern-match.
export type { FileTreeStatus };
