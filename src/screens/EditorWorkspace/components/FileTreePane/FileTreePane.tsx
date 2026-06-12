import { useEffect, useRef, useState } from 'react';
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
import styles from './FileTreePane.module.css';

const INDENT_PX = 12; // matches --space-3

/**
 * File tree / project explorer pane. Phase 2b:
 *   - "Open folder" header action calls the native picker.
 *   - Selected root is read into the store and rendered recursively.
 *   - Directories lazy-load their children on first expand.
 *   - Click a file: log the path.
 *   - Right-click a row: opens a context menu with
 *     New File / Rename / Delete. The v1 menus use
 *     `window.prompt` for the name input and
 *     `window.confirm` for the destructive confirm —
 *     a real inline editor / modal confirm is a
 *     follow-up polish phase, not part of this
 *     feature.
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
    const target = isDir ? entry.path : parentOf(entry.path);
    if (!target) return;
    // Pick the action via a confirm-style prompt.
    // v1 uses native `window.prompt` / `confirm` —
    // see the file's header comment. The label
    // tells the user what kind of entity they're
    // creating the new item inside.
    const choice = window.prompt(
      isDir
        ? `Action for "${entry.name}" (folder):\n  1. New File in this folder\n  2. Rename\n  3. Delete\n\nEnter 1, 2, or 3 (Cancel = no-op).`
        : `Action for "${entry.name}" (file):\n  1. Rename\n  2. Delete\n\nEnter 1 or 2 (Cancel = no-op).`,
      '',
    );
    if (choice === null) return;
    const c = choice.trim();
    if (isDir) {
      if (c === '1') {
        const name = window.prompt('New file name:', 'untitled.txt');
        if (!name) return;
        const newPath = joinPath(target, name);
        void runMutation(() => create(newPath));
      } else if (c === '2') {
        const newName = window.prompt('Rename to:', entry.name);
        if (!newName || newName === entry.name) return;
        const newPath = joinPath(parentOf(entry.path) ?? '', newName);
        void runMutation(() => rename(entry.path, newPath));
      } else if (c === '3') {
        if (!window.confirm(`Delete folder "${entry.name}" and all its contents? This cannot be undone.`)) return;
        void runMutation(() => deleteOp(entry.path));
      }
    } else {
      if (c === '1') {
        const newName = window.prompt('Rename to:', entry.name);
        if (!newName || newName === entry.name) return;
        const newPath = joinPath(target, newName);
        void runMutation(() => rename(entry.path, newPath));
      } else if (c === '2') {
        if (!window.confirm(`Delete "${entry.name}"? This cannot be undone.`)) return;
        void runMutation(() => deleteOp(entry.path));
      }
    }
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
