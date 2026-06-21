import { useCallback } from 'react';
import type { CSSProperties } from 'react';
import styles from './TitleBar.module.css';
import { fileTreeSelectors, useFileTreeStore } from '../../state/fileTreeStore';
import { useAppStore } from '@/shared/state/appStore';
import { IconButton } from '@/shared/components/IconButton';
import { TrialBadge } from '@/shared/components/TrialBadge';
import { useThemeStore, themeSelectors } from '@/shared/state/themeStore';
import { THEMES } from '@/shared/state/themes';

export interface TitleBarProps {
  title?: string;
  subtitle?: string;
  /**
   * Whether to show the ⚙ settings button. Default `true`.
   * Settings has its own screen; the titlebar on the
   * Settings screen has no use for the gear (you're
   * already in Settings).
   */
  showSettingsButton?: boolean;
}

const wrapperStyle: CSSProperties = {
  gridArea: 'titlebar',
};

/**
 * In-DOM titlebar (the OS-native one comes from Tauri 2's window
 * decorations). When a folder is open, shows the absolute root path
 * as a muted breadcrumb next to the brand.
 */
export function TitleBar({
  title = 'Lipi',
  subtitle,
  showSettingsButton = true,
}: TitleBarProps) {
  const status = useFileTreeStore(fileTreeSelectors.status);
  const rootPath =
    status.kind === 'ready' || status.kind === 'loading'
      ? status.rootPath
      : null;
  const setActiveScreen = useAppStore((s) => s.setActiveScreen);
  const currentThemeId = useThemeStore(themeSelectors.themeId);
  const setThemeId = useThemeStore((s) => s.setThemeId);

  const onSettings = () => setActiveScreen('settings');

  const onCycleTheme = useCallback(() => {
    const idx = THEMES.findIndex((t) => t.id === currentThemeId);
    const next = THEMES[(idx + 1) % THEMES.length];
    setThemeId(next.id as 'hickory-hollow' | 'whispering-pines' | 'marigold-field' | 'wildflower-field' | 'quiet-valley');
  }, [currentThemeId, setThemeId]);

  return (
    <header className={styles.bar} style={wrapperStyle} role="banner">
      <div className={styles.left}>
        <span className={styles.mark} aria-hidden="true">
          {/* Devanagari "लिपि" — a stylized ligature. Pure SVG so it scales. */}
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M3 18h2v-2H3v2zm0-4h2v-2H3v2zm0-4h2V8H3v2zm0-4h2V4H3v2zm4 12h14v-2H7v2zm0-4h14v-2H7v2zm0-4h14V8H7v2zm0-4h14V4H7v2z" />
          </svg>
        </span>
        <span className={styles.title}>{title}</span>
        {rootPath && (
          <span
            className={styles.subtitle}
            title={rootPath}
            data-testid="titlebar-root"
          >
            {rootPath}
          </span>
        )}
        {!rootPath && subtitle && (
          <span className={styles.subtitle}>{subtitle}</span>
        )}
      </div>
      <div className={styles.center} />
      <div className={styles.right}>
        {/* Phase 3: the trial-status badge. Renders
            nothing for the default state (>7 days,
            active, etc.) and a colored pill for the
            "needs attention" states. The badge is a
            <button> that navigates to the License
            activation screen on click. */}
        <TrialBadge />
        {showSettingsButton && (
          <>
            <span className={styles.dragBlocker}>
              <IconButton
                variant="subtle"
                size="sm"
                onClick={onCycleTheme}
                aria-label="Cycle theme"
                title="Cycle theme"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  {/* Palette / brush icon for theme cycling */}
                  <path d="M12 2C6.49 2 2 6.49 2 12s4.49 10 10 10a2.5 2.5 0 0 0 2.5-2.5c0-.61-.23-1.2-.64-1.67a.528.528 0 0 1-.13-.33c0-.29.24-.5.53-.5H16c3.31 0 6-2.69 6-6 0-4.96-4.49-9-10-9zm-5.5 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" />
                </svg>
              </IconButton>
            </span>
            <span className={styles.dragBlocker}>
              <IconButton
                variant="subtle"
                size="sm"
                onClick={onSettings}
                aria-label="Open AI provider settings"
                title="AI provider settings"
              >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="currentColor"
                aria-hidden="true"
              >
                {/* A simple gear / cog icon. The "settings" affordance. */}
                <path d="M19.14 12.94c.04-.31.06-.62.06-.94 0-.32-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.31-.07.62-.07.94 0 .32.02.63.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 0 1 8.4 12 3.6 3.6 0 0 1 12 8.4a3.6 3.6 0 0 1 3.6 3.6 3.6 3.6 0 0 1-3.6 3.6z" />
              </svg>
            </IconButton>
          </span>
          </>
        )}
      </div>
    </header>
  );
}
