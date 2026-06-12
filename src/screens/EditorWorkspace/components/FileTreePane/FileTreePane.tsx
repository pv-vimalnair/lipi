import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';

import { Button } from '@/shared/components/Button';
import type { FsEntry } from '@/ipc';
import { PaneShell } from '../PaneShell';

import {
  fileTreeSelectors,
  useFileTreeStore,
  type FileTreeStatus,
} from '../../state/fileTreeStore';
import { useFileTree } from '../../hooks/useFileTree';
import styles from './FileTreePane.module.css';

const INDENT_PX = 12; // matches --space-3

/**
 * File tree / project explorer pane. Phase 2b:
 *   - "Open folder" header action calls the native picker.
 *   - Selected root is read into the store and rendered recursively.
 *   - Directories lazy-load their children on first expand.
 *   - Click a file: log the path. (Phase 2c will open it in the editor.)
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
            loading={status.kind === 'opening'}
            aria-label="Open folder"
          >
            Open
          </Button>
        )
      }
    >
      <TreeBody />
    </PaneShell>
  );
}

function TreeBody() {
  const status = useFileTreeStore(fileTreeSelectors.status);

  switch (status.kind) {
    case 'idle':
      return (
        <div className={styles.placeholder}>
          <span>No folder opened</span>
          <span className={styles.placeholderHint}>
            Click <strong>Open</strong> to choose one.
          </span>
        </div>
      );
    case 'opening':
      return (
        <div className={styles.placeholder}>
          <span>Choose a folder…</span>
        </div>
      );
    case 'loading':
      return (
        <div className={styles.placeholder}>
          <span>Loading…</span>
        </div>
      );
    case 'error':
      return (
        <div className={styles.placeholder} role="alert">
          <span className={styles.errorTitle}>Couldn’t read this folder</span>
          <span className={styles.placeholderHint}>{status.message}</span>
        </div>
      );
    case 'ready': {
      const rootPath = status.rootPath;
      return <TreeRoot rootPath={rootPath} />;
    }
  }
}

interface TreeRootProps {
  rootPath: string;
}

function TreeRoot({ rootPath }: TreeRootProps) {
  const entries = useFileTreeStore(fileTreeSelectors.entriesFor(rootPath));
  const { ensureLoaded } = useFileTree();
  const loadedOnce = useRef(false);

  // Trigger the initial load when the root first mounts in 'ready'.
  // The store's load action is idempotent (returns early if cached).
  useEffect(() => {
    if (!loadedOnce.current) {
      loadedOnce.current = true;
      void ensureLoaded(rootPath);
    }
  }, [ensureLoaded, rootPath]);

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
  const { toggle, select } = useFileTree();

  const isSelected = selectedPath === entry.path;
  const isDir = entry.isDir;

  const handleClick = () => {
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
      >
        <span className={styles.chevron} aria-hidden="true">
          {isDir ? (isExpanded ? '▾' : '▸') : ''}
        </span>
        <span className={styles.icon} aria-hidden="true">
          {isDir ? (isExpanded ? '📂' : '📁') : '📄'}
        </span>
        <span className={styles.name}>{entry.name}</span>
      </div>
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

// Re-export the discriminated union shape so consumers can pattern-match.
export type { FileTreeStatus };
