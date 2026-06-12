import type { CSSProperties } from 'react';
import styles from './KeyHint.module.css';

export interface KeyHintProps {
  /** The key label, e.g. 'S' or 'Enter'. */
  label: string;
  /** Set true to indicate the primary modifier is held. Renders as
   *  `⌘` on macOS, `Ctrl` on Win/Linux. */
  primary?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** Override the auto-detected platform. */
  platform?: 'mac' | 'other';
  className?: string;
  style?: CSSProperties;
}

function detectPlatform(): 'mac' | 'other' {
  if (typeof navigator === 'undefined') return 'other';
  return /Mac|iPhone|iPad/.test(navigator.platform) ? 'mac' : 'other';
}

/** Visual hint for a keyboard shortcut. Renders the platform-correct
 *  modifier glyphs and a `<kbd>`-style chip for the key. */
export function KeyHint({
  label,
  primary = false,
  shift = false,
  alt = false,
  platform,
  className,
  style,
}: KeyHintProps) {
  const plat = platform ?? detectPlatform();
  const parts: string[] = [];
  if (primary) parts.push(plat === 'mac' ? '⌘' : 'Ctrl');
  if (alt) parts.push(plat === 'mac' ? '⌥' : 'Alt');
  if (shift) parts.push(plat === 'mac' ? '⇧' : 'Shift');
  parts.push(label);

  return (
    <span
      className={[styles.hint, className].filter(Boolean).join(' ')}
      style={style}
      aria-hidden="true"
    >
      {parts.map((p, i) => (
        <kbd key={i} className={styles.key}>
          {p}
        </kbd>
      ))}
    </span>
  );
}
