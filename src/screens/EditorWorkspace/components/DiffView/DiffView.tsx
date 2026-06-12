import { useCallback } from 'react';
import { DiffEditor, loader } from '@monaco-editor/react';

import { Button, IconButton } from '@/shared/components';
import { inferLanguage } from '@/shared/utils/inferLanguage';
import { PaneShell } from '../PaneShell';
import { useGitStatus } from '../../hooks/useGitStatus';
import { useDiff } from '../../hooks/useDiff';
import { useGitStore } from '../../state/gitStore';
import styles from './DiffView.module.css';

// Same Monaco loader config as EditorPane — we need the bundled
// monaco-editor/esm/vs/editor/editor.api for DiffEditor to find
// its peers.
loader.config({
  paths: {
    vs: new URL(
      'monaco-editor/esm/vs/editor/editor.api',
      import.meta.url,
    ).toString(),
  },
});

/**
 * DiffView — side panel's per-file diff (Phase 3c-2).
 *
 * Renders a Monaco `DiffEditor` with `original` = the blob from
 * HEAD and `modified` = the worktree content. Both are passed in
 * `FileDiff` from the Rust side. For binary files (`isBinary: true`)
 * or files that don't exist in HEAD (`old === null` for an
 * untracked file) or don't exist in the worktree (`new === null`
 * for a deletion), we render a placeholder instead of the editor
 * — Monaco would render garbled text for binary blobs, and the
 * "blank side" for added/deleted files is well-known to be more
 * confusing than a label.
 *
 * Header: file basename + back chevron that clears `activeDiffPath`
 * (returning the user to the file list) + Discard button (gated on
 * `unstaged: true`, since 3c-1 only ships unstaged discard).
 *
 * On successful discard, the `useGitStatus` hook refreshes the
 * file list, and the diff panel re-fetches its own diff so the
 * view catches up to the new state.
 */
export function DiffView() {
  const activePath = useGitStore((s) => s.activeDiffPath);
  const setActiveDiffPath = useGitStore((s) => s.setActiveDiffPath);
  const { status, refresh: refreshDiff, discard } = useDiff(activePath);
  const { refresh: refreshStatus } = useGitStatus();

  const closeDiff = useCallback(() => {
    setActiveDiffPath(null);
  }, [setActiveDiffPath]);

  const onDiscard = useCallback(async () => {
    await discard();
    // File list should drop the file (or move it from unstaged to
    // staged-add). The diff view itself re-fetches internally.
    await refreshStatus();
  }, [discard, refreshStatus]);

  // When the file is fully cleaned up by the discard, `status`
  // becomes `error` because the file is gone from the worktree and
  // HEAD — the Rust diff returns `isDeleted = true`, which is fine,
  // but the diff would visually be (old = HEAD content, new = '').
  // We let that through: the user just discarded, they want to see
  // what was there.

  // We need the ChangedFile entry to know whether the file is
  // currently unstaged (so we can show the Discard button). We pull
  // it from the git store.
  const activeChangedFile = useGitStore((s) => {
    if (!activePath) return null;
    if (s.status.kind !== 'ready') return null;
    return (
      s.status.status.changedFiles.find((c) => c.path === activePath) ?? null
    );
  });

  return (
    <PaneShell
      label="Source Control"
      hint="Diff"
      area="side"
      headerAction={
        <div className={styles.headerActions}>
          {activePath && activeChangedFile?.unstaged && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void onDiscard()}
              aria-label="Discard changes to this file"
              title="Discard unstaged changes"
            >
              Discard
            </Button>
          )}
          <IconButton
            variant="subtle"
            size="sm"
            aria-label="Back to changed files"
            title="Back"
            onClick={closeDiff}
          >
            ←
          </IconButton>
        </div>
      }
    >
      <Body
        status={status}
        path={activePath}
        onRetry={refreshDiff}
      />
    </PaneShell>
  );
}

interface BodyProps {
  status: ReturnType<typeof useDiff>['status'];
  path: string | null;
  onRetry: () => Promise<void>;
}

function Body({ status, path, onRetry }: BodyProps) {
  if (path === null) {
    return (
      <div className={styles.placeholder}>
        <span>No file selected</span>
      </div>
    );
  }
  switch (status.kind) {
    case 'idle':
      return (
        <div className={styles.placeholder}>
          <span>Loading diff…</span>
        </div>
      );
    case 'loading':
      return (
        <div className={styles.placeholder}>
          <span>Reading diff…</span>
        </div>
      );
    case 'error':
      return (
        <div className={styles.placeholder} role="alert">
          <span className={styles.errorTitle}>Couldn’t read diff</span>
          <span className={styles.placeholderHint}>{status.message}</span>
          <div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void onRetry()}
              aria-label="Retry loading diff"
            >
              Retry
            </Button>
          </div>
        </div>
      );
    case 'ready':
      return <ReadyDiff diff={status.diff} />;
  }
}

interface ReadyDiffProps {
  diff: import('@/ipc').FileDiff;
}

function ReadyDiff({ diff }: ReadyDiffProps) {
  const baseName = basename(diff.path);

  if (diff.isBinary) {
    return (
      <div className={styles.placeholder}>
        <span className={styles.binaryTitle}>Binary file</span>
        <span className={styles.placeholderHint}>
          {baseName} — binary diffs aren’t shown.
        </span>
      </div>
    );
  }

  if (diff.isNew) {
    return (
      <div className={styles.placeholder}>
        <span className={styles.binaryTitle}>Untracked file</span>
        <span className={styles.placeholderHint}>
          {baseName} isn’t in HEAD. Use Discard to delete it.
        </span>
        <div className={styles.placeholderDiff}>
          <DiffEditor
            original=""
            modified={diff.new ?? ''}
            language={inferLanguage(diff.path)}
            theme="vs-dark"
            options={{
              readOnly: true,
              renderSideBySide: false,
              minimap: { enabled: false },
              fontSize: 12,
              fontFamily:
                'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              automaticLayout: true,
            }}
          />
        </div>
      </div>
    );
  }

  if (diff.isDeleted) {
    return (
      <div className={styles.placeholder}>
        <span className={styles.binaryTitle}>Deleted file</span>
        <span className={styles.placeholderHint}>
          {baseName} was deleted from the worktree.
        </span>
        <div className={styles.placeholderDiff}>
          <DiffEditor
            original={diff.old ?? ''}
            modified=""
            language={inferLanguage(diff.path)}
            theme="vs-dark"
            options={{
              readOnly: true,
              renderSideBySide: false,
              minimap: { enabled: false },
              fontSize: 12,
              fontFamily:
                'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              automaticLayout: true,
            }}
          />
        </div>
      </div>
    );
  }

  // Standard modified file — show the side-by-side diff.
  return (
    <div className={styles.diffHost}>
      <DiffEditor
        original={diff.old ?? ''}
        modified={diff.new ?? ''}
        language={inferLanguage(diff.path)}
        theme="vs-dark"
        options={{
          readOnly: true,
          renderSideBySide: true,
          minimap: { enabled: false },
          fontSize: 12,
          fontFamily:
            'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          automaticLayout: true,
        }}
      />
    </div>
  );
}

function basename(p: string): string {
  const idx = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return idx >= 0 ? p.slice(idx + 1) : p;
}
