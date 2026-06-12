import type { CSSProperties } from 'react';
import styles from './StatusBar.module.css';

export interface StatusBarProps {
  branch?: string;
  position?: { line: number; col: number };
  encoding?: string;
  language?: string;
  /** Phase 2c: when the active editor tab has unsaved changes. */
  dirty?: boolean;
}

const wrapperStyle: CSSProperties = {
  gridArea: 'statusbar',
};

/**
 * Bottom status bar. In later phases this will be live-wired to the editor
 * (cursor position, language), git (branch, dirty marker), and a streaming
 * AI badge. For Phase 2c it adds an unsaved indicator sourced from the
 * editor tabs store.
 */
export function StatusBar({
  branch = 'main',
  position = { line: 1, col: 1 },
  encoding = 'UTF-8',
  language = 'Plain Text',
  dirty = false,
}: StatusBarProps) {
  return (
    <footer className={styles.bar} style={wrapperStyle} role="contentinfo">
      <div className={styles.section}>
        <span className={styles.item} title="Git branch">
          <BranchIcon /> {branch}
        </span>
      </div>
      <div className={styles.spacer} />
      <div className={styles.section}>
        {dirty && (
          <span
            className={`${styles.item} ${styles.dirty}`}
            data-testid="statusbar-dirty"
            title="This file has unsaved changes (Ctrl+S)"
          >
            ● unsaved
          </span>
        )}
        <span className={styles.item}>{language}</span>
        <span className={styles.item}>Ln {position.line}, Col {position.col}</span>
        <span className={styles.item}>{encoding}</span>
      </div>
    </footer>
  );
}

function BranchIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="currentColor"
      aria-hidden="true"
      style={{ marginRight: 'var(--space-1)' }}
    >
      <path d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.493 2.493 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z" />
    </svg>
  );
}
