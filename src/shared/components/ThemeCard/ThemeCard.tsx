/**
 * ThemeCard — a single theme option in the theme picker.
 *
 * Renders one of the five THEMES (Hickory Hollow / Whispering
 * Pines / Marigold Field / Wildflower Field / Quiet Valley)
 * as a clickable card showing the illustration, the theme name,
 * and a one-line mood description. The active card shows an
 * accent border + a checkmark badge.
 *
 * The illustration image is loaded via `theme.imageUrl` (which
 * Vite resolves to a hashed asset URL at build time). We pass
 * it through as a `background-image` on the art container so
 * the card stays self-contained — no need to import every PNG
 * from a parent component.
 *
 * The accent color is read from the theme and applied as a
 * CSS variable on the card root. The checkmark badge and the
 * focus ring pick it up via `var(--theme-accent)`. This is
 * the same single-source-of-truth pattern as the broader
 * theme system: write tokens, read tokens.
 *
 * Accessibility:
 *   - The card is a `<button>` so keyboard users can Tab to it
 *     and press Enter/Space to activate. This matches the
 *     Button / Switch primitive pattern in shared/components/.
 *   - `aria-pressed` reflects the current selection state.
 *   - The mood line is visible text (no aria-hidden decoration).
 *
 * Per Rule 4 (docs/ENGINEERING.md) we build from primitives —
 * `Stack` is used for vertical rhythm inside the meta block,
 * though we don't strictly need it here since the meta block
 * is only two stacked lines. Kept minimal on purpose.
 */

import { type Theme } from '@/shared/state/themes';
import styles from './ThemeCard.module.css';

export interface ThemeCardProps {
  /** The theme to display. Type matches the THEMES array in
   *  src/shared/state/themes.ts. */
  theme: Theme;
  /** Whether this theme is the current selection. Drives the
   *  active border + checkmark badge + aria-pressed. */
  isActive: boolean;
  /** Click / keyboard handler. The parent (theme picker)
   *  decides what "select" means — typically
   *  `themeStore.setThemeId(theme.id)`. */
  onSelect: (theme: Theme) => void;
}

/**
 * One theme card. Stateless — the parent owns selection state
 * and the actual store write. Keeping this dumb makes it
 * trivially testable and reusable (e.g. inside a future
 * Command Palette quick-switcher).
 */
export function ThemeCard({ theme, isActive, onSelect }: ThemeCardProps): JSX.Element {
  const onClick = () => onSelect(theme);
  return (
    <button
      type="button"
      className={styles.card}
      data-active={isActive || undefined}
      data-theme-id={theme.id}
      data-testid={`theme-card-${theme.id}`}
      aria-pressed={isActive}
      onClick={onClick}
      title={`${theme.name} — ${theme.mood}`}
      // Per-component accent override. The checkmark badge,
      // border, and focus ring all read from this CSS var, so
      // changing the theme just means swapping this one value.
      style={{
        // CSS custom properties on inline styles are passed
        // through to descendant rules; the .module.css below
        // reads these.
        ['--card-accent' as string]: theme.accent,
        ['--card-accent-soft' as string]: theme.accentSoft,
      }}
    >
      <div
        className={styles.art}
        style={{ backgroundImage: `url('${theme.imageUrl}')` }}
        aria-hidden="true"
      />
      <div className={styles.meta}>
        <div className={styles.name}>{theme.name}</div>
        <div className={styles.mood}>{theme.mood}</div>
      </div>
      {isActive && (
        // The checkmark badge sits in the top-right of the art
        // container. We render it conditionally so inactive
        // cards have zero extra DOM. The check uses an inline
        // SVG (no asset fetch) and inherits the per-card accent.
        <span
          className={styles.checkBadge}
          aria-hidden="true"
          data-testid={`theme-card-check-${theme.id}`}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </span>
      )}
    </button>
  );
}