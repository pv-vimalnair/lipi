/**
 * ThemeSection — the Appearance → Theme block in Settings.
 *
 * One Settings card that combines:
 *   1. A grid of 5 ThemeCards (Hickory Hollow, Whispering
 *      Pines, Marigold Field, Wildflower Field, Quiet Valley).
 *      Clicking a card sets the active theme.
 *   2. A CropPicker — 9-position frame selector for the active
 *      theme illustration. The crop is a CSS-variable swap on
 *      :root; the underlying image asset is reused as-is.
 *
 * The selection state lives in `useState` for now. Phase 4
 * (state persistence) will replace these with hooks into the
 * `themeStore` Zustand store — same interface, so the JSX
 * stays unchanged. Persistence + hydration to localStorage is
 * the only delta.
 *
 * Per Rule 4 (no new components without owner confirmation),
 * ThemeCard + CropPicker are existing primitives in
 * `src/shared/components/`. ThemeSection composes them; it
 * does not redefine the picker UI.
 *
 * Per Rule 6, state stays in the component for now; we will
 * move to Zustand when persistence is wired.
 */

import {
  DEFAULT_CROP_INDEX,
  THEMES,
  type Theme,
  type ThemeId,
} from '@/shared/state/themes';
import { themeSelectors, useThemeStore } from '@/shared/state/themeStore';
import { CropPicker } from '@/shared/components/CropPicker';
import { ThemeCard } from '@/shared/components/ThemeCard';

import styles from './ThemeSection.module.css';

/**
 * Self-contained Theme section. Reads from `useThemeStore` so
 * the picker survives reloads (Phase 4). The store's setter
 * side-effects — writing to localStorage and pushing CSS
 * variables onto :root — happen automatically inside the
 * store's subscribe (see `setupThemePersistence`), so this
 * component is a pure view.
 *
 * Per Rule 6, we pick narrow selectors so unrelated store
 * changes (none expected today, but future-proof) don't
 * re-render this section.
 */
export function ThemeSection(): JSX.Element {
  const themeId = useThemeStore(themeSelectors.themeId);
  const cropIdx = useThemeStore(themeSelectors.cropIndex);
  const setThemeId = useThemeStore((s) => s.setThemeId);
  const setCropIndex = useThemeStore((s) => s.setCropIndex);
  const resetCrop = useThemeStore((s) => s.resetCrop);

  // The picker needs the *active* theme's image to populate
  // each crop thumb's preview. Defense-in-depth: if a future
  // theme id is added to the picker but the store's load
  // doesn't recognise it, fall back to the first theme.
  const activeTheme: Theme =
    THEMES.find((t) => t.id === themeId) ?? THEMES[0];

  return (
    <section className={styles.section} data-testid="theme-section">
      <h2 className={styles.heading}>Theme</h2>
      <p className={styles.lede}>
        Paint your selected view tab with a scene from a 1980s nature
        print. Each theme is one illustration, one mood, one accent —
        picked once, set everywhere. The illustration only paints the
        active view tab; the rail, tree, and editor stay neutral so your
        code stays the focus.
      </p>

      <div
        className={styles.grid}
        role="radiogroup"
        aria-label="Available themes"
      >
        {THEMES.map((theme) => (
          <ThemeCard
            key={theme.id}
            theme={theme}
            isActive={theme.id === themeId}
            // The store's setThemeId resets the crop to center
            // on its own — no extra logic needed here. We pass
            // a function that takes the Theme so the ThemeCard
            // signature doesn't change.
            onSelect={(t) => setThemeId(t.id as ThemeId)}
          />
        ))}
      </div>

      <div className={styles.frame}>
        <h3 className={styles.frameHeading}>Frame your view</h3>
        <p className={styles.frameLede}>
          Tabs are small, so the scene is cropped to fit. Pick the part of
          the image that feels most like the mood you want — the leaves,
          the horizon, the figure. Your choice is saved with the theme
          and follows you across sessions.
        </p>
        <CropPicker
          themeImageUrl={activeTheme.imageUrl}
          activeCropIndex={cropIdx}
          onCropChange={setCropIndex}
        />
        <button
          type="button"
          className={styles.resetLink}
          onClick={resetCrop}
          disabled={cropIdx === DEFAULT_CROP_INDEX}
          data-testid="frame-reset"
        >
          Reset to center
        </button>
      </div>
    </section>
  );
}