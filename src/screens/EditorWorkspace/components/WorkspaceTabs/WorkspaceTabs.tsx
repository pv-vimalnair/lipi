import { useCallback } from 'react';
import { useWorkspaceStore, workspaceSelectors } from '@/shared/state/workspaceStore';
import { pickFolder } from '@/ipc/fs';
import { IconButton } from '@/shared/components/IconButton';
import type { WorkspaceTab } from '@/shared/state/workspaceStore';
import styles from './WorkspaceTabs.module.css';

const wrapperStyle = { gridArea: 'tabs' } as const;

/**
 * WorkspaceTabs — the desktop-side
 * tab strip that lives directly
 * under the titlebar. One tab
 * per open workspace. Click a
 * tab to make it active; click
 * the × on a tab to close it
 * (closes the active tab if no
 * tab id is provided); click
 * the `+` to add a new tab via
 * the folder picker.
 *
 * The strip is hidden on mobile
 * (the MobileShell has its own
 * tab bar) and when no
 * workspaces are open (the
 * editor is not visible — the
 * Welcome screen is the only
 * thing mounted). The strip
 * itself decides visibility via
 * the `workspaces.length > 0`
 * check so callers don't need
 * to know.
 *
 * M6a (June 2026): this is the
 * first surface that surfaces
 * the M6a tab model. The
 * underlying data lives in
 * `useWorkspaceStore` —
 * `workspaces` + `activeId`.
 * The M6b phase will add
 * per-tab state (file tree
 * expansion, editor tabs,
 * etc.); for M6a, switching
 * tabs re-renders the file
 * tree against the new
 * active path.
 */
export function WorkspaceTabs(): JSX.Element | null {
  const workspaces = useWorkspaceStore(workspaceSelectors.workspaces);
  const activeId = useWorkspaceStore(workspaceSelectors.activeId);
  const setActive = useWorkspaceStore((s) => s.setActive);
  const close = useWorkspaceStore((s) => s.close);
  const open = useWorkspaceStore((s) => s.open);

  const onAddTab = useCallback(async () => {
    try {
      const chosen = await pickFolder();
      if (chosen) {
        open(chosen);
      }
    } catch (e) {
      // The picker itself
      // surfaces errors;
      // we just log
      // unexpected
      // failures in DEV
      // so the user can
      // see them in the
      // console.
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.error('[WorkspaceTabs] pickFolder failed', e);
      }
    }
  }, [open]);

  if (workspaces.length === 0) {
    return null;
  }

  return (
    <div
      className={styles.strip}
      style={wrapperStyle}
      role="tablist"
      aria-label="Open workspaces"
    >
      <div className={styles.row}>
        {workspaces.map((w) => (
          <WorkspaceTabPill
            key={w.id}
            tab={w}
            isActive={w.id === activeId}
            onSelect={() => setActive(w.id)}
            onClose={() => close(w.id)}
          />
        ))}
        <IconButton
          variant="subtle"
          size="sm"
          onClick={onAddTab}
          className={styles.addButton}
          aria-label="Open another folder in a new tab"
          title="Open another folder in a new tab"
          data-testid="workspace-tab-add"
        >
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
          </svg>
        </IconButton>
      </div>
    </div>
  );
}

interface WorkspaceTabPillProps {
  tab: WorkspaceTab;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
}

function WorkspaceTabPill({
  tab,
  isActive,
  onSelect,
  onClose,
}: WorkspaceTabPillProps): JSX.Element {
  return (
    <div
      className={styles.tab}
      data-active={isActive}
      role="tab"
      aria-selected={isActive}
      onClick={onSelect}
      onAuxClick={(e) => {
        // Middle-click closes
        // the tab — the
        // standard
        // browser-tab
        // affordance.
        if (e.button === 1) {
          e.preventDefault();
          onClose();
        }
      }}
      title={tab.path}
      data-testid={`workspace-tab-${tab.id}`}
    >
      <span className={styles.tabLabel}>{basename(tab.path)}</span>
      <button
        type="button"
        className={styles.closeButton}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label={`Close ${basename(tab.path)}`}
        data-testid={`workspace-tab-close-${tab.id}`}
      >
        <svg
          viewBox="0 0 24 24"
          width="12"
          height="12"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
        </svg>
      </button>
    </div>
  );
}

/** Pull the last path segment
 *  (the folder name) for the
 *  tab label. Falls back to
 *  the full path if there's
 *  no separator (a relative
 *  path with no `/` in it —
 *  unusual, but safe to
 *  handle). */
function basename(path: string): string {
  const m = path.match(/[^/\\]+$/);
  return m ? m[0] : path;
}
