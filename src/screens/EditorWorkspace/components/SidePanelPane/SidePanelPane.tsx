import { useState } from 'react';

import { GitPanel } from '../GitPanel';
import { DiffView } from '../DiffView';
import { TerminalPanel } from '../TerminalPanel';
import { AIPanel } from '../AIPanel';
import { SearchPanel } from '../SearchPanel';
import { gitSelectors, useGitStore } from '../../state/gitStore';
import styles from './SidePanelPane.module.css';

/**
 * Side panel — tabbed (Source Control | Terminal | AI).
 *
 * Phase 3b mounted the GitPanel as the default view.
 * Phase 3c-2 added the DiffView: when the user clicks a
 * file in the changed-files list, the panel swaps to render
 * the per-file diff (this takes priority over the tabs —
 * the user is in a focused task and we don't want to yank
 * the tab bar in front of them).
 * Phase 4b adds tabs (Source Control | Terminal) for the
 * non-diff case. The active tab is local state for now;
 * 4c may need to lift it if multi-tab terminals want to
 * coexist with the Source Control tab.
 * Phase 5b-3 adds the AI tab (third in the row). The AI
 * panel is screen-local to EditorWorkspace; it shares the
 * panel chrome via `PaneShell` (Rule 4).
 *
 * The tab bar lives in this component, NOT in either child
 * panel, because (a) only one tab is visible at a time and
 * the tab bar needs to render only when not in a diff view,
 * and (b) the panels are otherwise independent (Rule 4 —
 * each is a self-contained unit that can be reused).
 */

type Tab = 'git' | 'terminal' | 'ai' | 'search';

export function SidePanelPane() {
  const activeDiffPath = useGitStore(gitSelectors.activeDiffPath);
  const [tab, setTab] = useState<Tab>('git');

  // Diff view wins over tabs — when the user is looking at
  // a file diff, we don't show the tab bar. The DiffView
  // header has its own back chevron to return to the
  // previous tab.
  if (activeDiffPath) {
    return <DiffView />;
  }

  return (
    <div
      className={styles.root}
      style={{ gridArea: 'side' }}
      data-tour-target="sidePanel"
    >
      <div className={styles.tabBar} role="tablist" aria-label="Side panel">
        <TabButton
          active={tab === 'git'}
          onClick={() => setTab('git')}
          label="Source Control"
        />
        <TabButton
          active={tab === 'search'}
          onClick={() => setTab('search')}
          label="Search"
        />
        <TabButton
          active={tab === 'terminal'}
          onClick={() => setTab('terminal')}
          label="Terminal"
        />
        <TabButton
          active={tab === 'ai'}
          onClick={() => setTab('ai')}
          label="AI"
        />
      </div>
      <div className={styles.panel}>
        {tab === 'git' ? (
          <GitPanel />
        ) : tab === 'search' ? (
          <SearchPanel />
        ) : tab === 'terminal' ? (
          <TerminalPanel />
        ) : (
          <AIPanel />
        )}
      </div>
    </div>
  );
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  label: string;
}

function TabButton({ active, onClick, label }: TabButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={styles.tab}
      data-active={active || undefined}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
