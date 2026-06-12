import type { KeyboardEvent } from 'react';

import { IconButton } from '@/shared/components/IconButton';
import {
  editorTabsSelectors,
  isDirty,
  useEditorTabsStore,
  type EditorTab,
} from '../../state/editorTabsStore';
import { useEditorTabs } from '../../hooks/useEditorTabs';
import styles from './TabStrip.module.css';

interface TabStripProps {
  /** Visual variant: 'top' (default) for above the editor, 'bottom' for terminal-like. */
  position?: 'top' | 'bottom';
}

/**
 * Tab strip above the Monaco editor. Phase 2c keeps it minimal:
 * each tab shows name + dirty dot + close button. Reordering,
 * drag-to-detach, etc. are explicitly out of scope until D5.
 */
export function TabStrip({ position = 'top' }: TabStripProps) {
  const order = useEditorTabsStore(editorTabsSelectors.order);
  const tabs = useEditorTabsStore(editorTabsSelectors.tabs);
  const activeId = useEditorTabsStore(editorTabsSelectors.activeId);
  const activate = useEditorTabsStore((s: ReturnType<typeof useEditorTabsStore.getState>) => s.activate);
  const { closeTab } = useEditorTabs();

  if (order.length === 0) return null;

  return (
    <div
      className={styles.strip}
      data-position={position}
      role="tablist"
      aria-label="Open files"
    >
      {order.map((id: string) => {
        const tab = tabs[id];
        if (!tab) return null;
        const active = id === activeId;
        return (
          <TabStripItem
            key={id}
            tab={tab}
            active={active}
            onActivate={() => activate(id)}
            onClose={(e) => {
              e.stopPropagation();
              closeTab(id);
            }}
          />
        );
      })}
    </div>
  );
}

interface TabStripItemProps {
  tab: EditorTab;
  active: boolean;
  onActivate: () => void;
  onClose: (e: React.MouseEvent) => void;
}

function TabStripItem({
  tab,
  active,
  onActivate,
  onClose,
}: TabStripItemProps) {
  const dirty = isDirty(tab);

  const handleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onActivate();
    } else if (e.key === 'Delete' || (e.key === 'w' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      onClose(e as unknown as React.MouseEvent);
    }
  };

  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      className={styles.tab}
      data-active={active || undefined}
      data-dirty={dirty || undefined}
      data-testid={`tab-${tab.id}`}
      onClick={onActivate}
      onKeyDown={handleKey}
      title={tab.path}
    >
      <span className={styles.dot} aria-hidden="true" data-dirty={dirty || undefined} />
      <span className={styles.name}>{tab.displayName}</span>
      <IconButton
        variant="subtle"
        size="sm"
        aria-label={`Close ${tab.displayName}`}
        onClick={onClose}
        className={styles.close}
      >
        ×
      </IconButton>
    </div>
  );
}
