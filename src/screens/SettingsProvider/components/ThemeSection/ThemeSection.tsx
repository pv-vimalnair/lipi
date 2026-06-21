/**
 * ThemeSection — the Appearance → Theme block in Settings.
 *
 * One Settings card that combines:
 *   1. A grid of ThemeCards (5 bundled themes + optional custom).
 *      Clicking a card sets the active theme.
 *   2. A CustomThemeUploader — upload and crop your own image.
 *   3. A FreeCropPicker — continuous drag viewport for the active
 *      theme illustration.
 */

import {
  THEMES,
  buildCustomTheme,
  isCustomTheme,
  type Theme,
  type ThemeId,
} from '@/shared/state/themes';
import { themeSelectors, useThemeStore } from '@/shared/state/themeStore';
import { FreeCropPicker } from '@/shared/components/FreeCropPicker';
import { ThemeCard } from '@/shared/components/ThemeCard';
import { CustomThemeUploader } from '../CustomThemeUploader';

import styles from './ThemeSection.module.css';

export function ThemeSection(): JSX.Element {
  const themeId = useThemeStore(themeSelectors.themeId);
  const cropIdx = useThemeStore(themeSelectors.cropIndex);
  const cropX = useThemeStore(themeSelectors.cropX);
  const cropY = useThemeStore(themeSelectors.cropY);
  const customImageUrl = useThemeStore(themeSelectors.customImageUrl);
  const setThemeId = useThemeStore((s) => s.setThemeId);
  const setCropIndex = useThemeStore((s) => s.setCropIndex);
  const setCropPosition = useThemeStore((s) => s.setCropPosition);
  const resetCrop = useThemeStore((s) => s.resetCrop);

  const activeTheme: Theme = isCustomTheme(themeId)
    ? buildCustomTheme(customImageUrl ?? '')
    : (THEMES.find((t) => t.id === themeId) ?? THEMES[0]);

  const customTheme: Theme | null = customImageUrl
    ? buildCustomTheme(customImageUrl)
    : null;

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
            onSelect={(t) => setThemeId(t.id as ThemeId)}
          />
        ))}
        {customTheme && (
          <ThemeCard
            key={customTheme.id}
            theme={customTheme}
            isActive={isCustomTheme(themeId)}
            onSelect={(t) => setThemeId(t.id as ThemeId)}
          />
        )}
      </div>

      <div className={styles.customSection}>
        <h3 className={styles.frameHeading}>Custom theme</h3>
        <p className={styles.frameLede}>
          Upload your own image and we&apos;ll help you crop it to fit the view
          tab. The image is stored locally on your device.
        </p>
        <CustomThemeUploader />
      </div>

      <div className={styles.frame}>
        <h3 className={styles.frameHeading}>Frame your view</h3>
        <p className={styles.frameLede}>
          Tabs are small, so the scene is cropped to fit. Drag the viewport
          to choose exactly which part of the image feels right — the
          leaves, the horizon, the figure. Your choice is saved with the
          theme and follows you across sessions.
        </p>
        <FreeCropPicker
          themeImageUrl={activeTheme.imageUrl}
          cropX={cropX}
          cropY={cropY}
          activeCropIndex={cropIdx}
          onCropPositionChange={setCropPosition}
          onCropIndexChange={setCropIndex}
          onReset={resetCrop}
        />
        <button
          type="button"
          className={styles.resetLink}
          onClick={resetCrop}
          disabled={cropX === 50 && cropY === 50}
          data-testid="frame-reset"
        >
          Reset to center
        </button>
      </div>
    </section>
  );
}
