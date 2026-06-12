import { useCallback, useMemo, type MouseEvent } from 'react';

import { Button, IconButton } from '@/shared/components';
import { changeKindBadge, changeKindLabel, gitDiscard } from '@/ipc';
import type { ChangedFile } from '@/ipc';
import { PaneShell } from '../PaneShell';

import {
  gitSelectors,
  useGitStore,
  type GitPanelStatus,
} from '../../state/gitStore';
import { useGitStatus } from '../../hooks/useGitStatus';
import styles from './GitPanel.module.css';

/**
 * GitPanel — side-panel view of the active repo's status (Phase 3b).
 *
 *   - Branch chip + ahead/behind (real revwalk lands later; 0/0 is the
 *     placeholder for now).
 *   - Changed files list with single-letter `changeKindBadge`s and
 *     labels. Clicking a file will open it in 3c (no-op here).
 *   - "Refresh" button in the header re-fetches status.
 *
 * First-class states (Rule 5):
 *   - idle          → no folder opened
 *   - opening       → probing the repo
 *   - not-a-repo    → folder is not a git working tree
 *   - loading       → fetching status
 *   - ready         → render the data
 *   - error         → show the message + retry
 *
 * Reuses `PaneShell`, `Button`, and `IconButton` (Rule 4).
 */
export function GitPanel() {
  const status = useGitStore(gitSelectors.status);
  const isRefreshing = useGitStore(gitSelectors.isRefreshing);
  const { refresh } = useGitStatus();

  return (
    <PaneShell
      label="Source Control"
      hint="Git"
      area="side"
      headerAction={
        <IconButton
          variant="subtle"
          size="sm"
          aria-label="Refresh git status"
          title="Refresh"
          onClick={() => void refresh()}
          disabled={status.kind === 'idle'}
        >
          ⟳
        </IconButton>
      }
    >
      <Body status={status} isRefreshing={isRefreshing} onRetry={refresh} />
    </PaneShell>
  );
}

interface BodyProps {
  status: GitPanelStatus;
  isRefreshing: boolean;
  onRetry: () => Promise<void>;
}

function Body({ status, isRefreshing, onRetry }: BodyProps) {
  switch (status.kind) {
    case 'idle':
      return (
        <div className={styles.placeholder}>
          <span>No folder opened</span>
          <span className={styles.placeholderHint}>
            Open a folder in the explorer to see git status.
          </span>
        </div>
      );
    case 'opening':
      return (
        <div className={styles.placeholder}>
          <span>Opening repository…</span>
        </div>
      );
    case 'not-a-repo':
      return (
        <div className={styles.placeholder}>
          <span>Not a git repository</span>
          <span className={styles.placeholderHint}>
            <code className={styles.path}>{status.rootPath}</code>
            <br />
            Initialise one to see changes here.
          </span>
        </div>
      );
    case 'loading':
      return (
        <div className={styles.placeholder}>
          <span>Reading status…</span>
        </div>
      );
    case 'error':
      return (
        <div className={styles.placeholder} role="alert">
          <span className={styles.errorTitle}>Couldn’t read git status</span>
          <span className={styles.placeholderHint}>{status.message}</span>
          <div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void onRetry()}
              aria-label="Retry git status"
            >
              Retry
            </Button>
          </div>
        </div>
      );
    case 'ready':
      return <ReadyView isRefreshing={isRefreshing} onRetry={onRetry} />;
  }
}

interface ReadyViewProps {
  isRefreshing: boolean;
  onRetry: () => Promise<void>;
}

function ReadyView({ isRefreshing, onRetry }: ReadyViewProps) {
  const status = useGitStore(gitSelectors.status);
  // Re-narrow for TS — the parent Body already gated on 'ready'.
  if (status.kind !== 'ready') return null;

  const branch = status.status.branch;
  const ahead = status.status.ahead;
  const behind = status.status.behind;
  const isClean = status.status.isClean;
  const files = status.status.changedFiles;
  const stagedCount = useMemo(
    () => files.filter((f) => f.staged).length,
    [files],
  );
  const unstagedCount = useMemo(
    () => files.filter((f) => f.unstaged).length,
    [files],
  );

  return (
    <div className={styles.root} data-refreshing={isRefreshing || undefined}>
      <BranchHeader
        branch={branch}
        isDetached={status.status.isDetached}
        ahead={ahead}
        behind={behind}
      />
      <SummaryBar
        staged={stagedCount}
        unstaged={unstagedCount}
        isClean={isClean}
        onRefresh={() => void onRetry()}
        isRefreshing={isRefreshing}
      />
      {isClean ? (
        <div className={styles.placeholder}>
          <span>No changes</span>
          <span className={styles.placeholderHint}>
            Working tree is clean.
          </span>
        </div>
      ) : (
        <ChangedFilesList files={files} />
      )}
    </div>
  );
}

interface BranchHeaderProps {
  branch: string | null;
  isDetached: boolean;
  ahead: number;
  behind: number;
}

function BranchHeader({ branch, isDetached, ahead, behind }: BranchHeaderProps) {
  const label = isDetached ? 'detached HEAD' : branch ?? 'unknown';
  return (
    <div className={styles.branchHeader}>
      <span className={styles.branchIcon} aria-hidden="true">
        ⎇
      </span>
      <span className={styles.branchName} title={label}>
        {label}
      </span>
      {(ahead > 0 || behind > 0) && (
        <span className={styles.aheadBehind}>
          {ahead > 0 && (
            <span className={styles.ahead} title={`${ahead} ahead of upstream`}>
              ↑{ahead}
            </span>
          )}
          {behind > 0 && (
            <span className={styles.behind} title={`${behind} behind upstream`}>
              ↓{behind}
            </span>
          )}
        </span>
      )}
    </div>
  );
}

interface SummaryBarProps {
  staged: number;
  unstaged: number;
  isClean: boolean;
  onRefresh: () => void;
  isRefreshing: boolean;
}

function SummaryBar({
  staged,
  unstaged,
  isClean,
  onRefresh,
  isRefreshing,
}: SummaryBarProps) {
  const total = staged + unstaged;
  return (
    <div className={styles.summary}>
      <span className={styles.summaryLabel}>
        {isClean ? 'Clean' : `${total} change${total === 1 ? '' : 's'}`}
      </span>
      {!isClean && (
        <span className={styles.summaryBreakdown}>
          {staged > 0 && (
            <span className={styles.staged} title="Staged changes">
              {staged} staged
            </span>
          )}
          {staged > 0 && unstaged > 0 && <span className={styles.dot}>·</span>}
          {unstaged > 0 && (
            <span className={styles.unstaged} title="Unstaged changes">
              {unstaged} unstaged
            </span>
          )}
        </span>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={onRefresh}
        loading={isRefreshing}
        aria-label="Refresh git status"
        className={styles.refreshButton}
      >
        Refresh
      </Button>
    </div>
  );
}

interface ChangedFilesListProps {
  files: ChangedFile[];
}

function ChangedFilesList({ files }: ChangedFilesListProps) {
  // Sort: staged first (in commit order), then unstaged, then untracked.
  // Group by stage. Display path relative to repo root.
  const sorted = useMemo(() => {
    const score = (f: ChangedFile) =>
      (f.staged ? 0 : 1) * 10 + (f.unstaged ? 0 : 1);
    return [...files].sort((a, b) => {
      const sa = score(a);
      const sb = score(b);
      if (sa !== sb) return sa - sb;
      return a.path.localeCompare(b.path);
    });
  }, [files]);

  return (
    <ul
      className={styles.fileList}
      aria-label="Changed files"
      data-testid="git-changed-files"
    >
      {sorted.map((f) => (
        <ChangedFileRow key={f.path} file={f} />
      ))}
    </ul>
  );
}

interface ChangedFileRowProps {
  file: ChangedFile;
}

function ChangedFileRow({ file }: ChangedFileRowProps) {
  // Show basename for compactness; full path is in the title attribute.
  const baseName = useMemo(() => {
    const idx = Math.max(
      file.path.lastIndexOf('\\'),
      file.path.lastIndexOf('/'),
    );
    return idx >= 0 ? file.path.slice(idx + 1) : file.path;
  }, [file.path]);

  const badge = changeKindBadge(file.kind);
  const label = changeKindLabel(file.kind);

  const setActiveDiffPath = useGitStore((s) => s.setActiveDiffPath);
  const { refresh } = useGitStatus();

  const onClick = useCallback(() => {
    setActiveDiffPath(file.path);
  }, [file.path, setActiveDiffPath]);

  // Per-row Discard (Phase 3c-2). Only visible for unstaged changes
  // because the Rust side in 3c-1 only implements unstaged discard.
  // Staged-only or staged+unstaged files don't get the button.
  const onDiscard = useCallback(
    async (e: MouseEvent) => {
      e.stopPropagation(); // don't trigger the row's onClick
      const rootPath = useGitStore.getState().rootPath;
      if (!rootPath) return;
      try {
        await gitDiscard(rootPath, file.path);
        await refresh();
      } catch (err) {
        // Surface in console for now; future phases add a toast system.
        // eslint-disable-next-line no-console
        console.error('[GitPanel] discard failed', err);
      }
    },
    [file.path, refresh],
  );

  return (
    <li
      className={styles.fileRow}
      data-staged={file.staged || undefined}
      data-unstaged={file.unstaged || undefined}
      data-kind={file.kind}
    >
      <button
        type="button"
        className={styles.fileRowMain}
        onClick={onClick}
        title={`Open diff for ${file.path}`}
        aria-label={`Open diff for ${file.path}`}
      >
        <span
          className={styles.badge}
          data-kind={file.kind}
          title={label}
          aria-label={label}
        >
          {badge}
        </span>
        <span className={styles.fileName} title={file.path}>
          {baseName}
        </span>
        {file.staged && file.unstaged && (
          <span
            className={styles.stageTag}
            title="Both staged and unstaged changes"
          >
            staged+unstaged
          </span>
        )}
      </button>
      {file.unstaged && (
        <IconButton
          variant="subtle"
          size="sm"
          className={styles.discardButton}
          onClick={onDiscard}
          aria-label={`Discard changes to ${baseName}`}
          title="Discard unstaged changes"
        >
          ↺
        </IconButton>
      )}
    </li>
  );
}

// Re-export the discriminated union shape so consumers can pattern-match.
export type { GitPanelStatus };
