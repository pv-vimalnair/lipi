import type { ReactNode } from 'react';
import styles from './PaneShell.module.css';

export interface PaneShellProps {
  label: string;
  hint?: string;
  area: string;
  /** Optional action element rendered in the header (e.g. "Open folder").
   *  Rule 4: pass shared components in, never reimplement chrome. */
  headerAction?: ReactNode;
  children?: ReactNode;
}

/**
 * Common empty-state wrapper for the 3 desktop panes. Each pane is a CSS
 * Grid area; this component just gives a consistent header + body layout
 * so future content drops in without re-deriving the chrome.
 */
export function PaneShell({
  label,
  hint,
  area,
  headerAction,
  children,
}: PaneShellProps) {
  return (
    <section
      className={styles.pane}
      style={{ gridArea: area }}
      aria-label={label}
    >
      <header className={styles.header}>
        <div className={styles.headerText}>
          <span className={styles.label}>{label}</span>
          {hint && <span className={styles.hint}>{hint}</span>}
        </div>
        {headerAction && (
          <div className={styles.headerAction}>{headerAction}</div>
        )}
      </header>
      <div className={styles.body}>
        {children ?? <div className={styles.empty}>Coming in a later phase</div>}
      </div>
    </section>
  );
}
