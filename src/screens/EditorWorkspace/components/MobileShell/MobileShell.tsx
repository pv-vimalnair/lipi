import { useState } from 'react';

import { useHaptics } from '@/shared/hooks/useHaptics';
import { useVirtualKeyboard } from '@/shared/hooks/useVirtualKeyboard';

import { MobileTopBar } from './MobileTopBar';
import styles from './MobileShell.module.css';

type MobileTab = 'files' | 'edit' | 'voice' | 'git';

const TABS: ReadonlyArray<{ id: MobileTab; label: string; icon: string }> = [
  { id: 'files', label: 'Files', icon: 'M3 4h7v7H3zM12 4h9v4h-9zM12 10h9v11h-9zM3 13h7v8H3z' },
  { id: 'edit', label: 'Edit', icon: 'M14.06 2.94l3 3L8 15H5v-3l9.06-9.06M14.06 2.94a2 2 0 112.83 2.83l-1.42-1.42 1.42 1.42-9.9 9.9-4.24.71.71-4.24 9.9-9.9z' },
  { id: 'voice', label: 'Voice', icon: 'M12 1a4 4 0 014 4v6a4 4 0 11-8 0V5a4 4 0 014-4zm6 10a6 6 0 11-12 0H4a8 8 0 007 7.93V22h2v-3.07A8 8 0 0020 11h-2z' },
  { id: 'git', label: 'Git', icon: 'M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.493 2.493 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5z' },
];

/**
 * Mobile responsive shell. The desktop 3-pane layout doesn't translate to
 * a 360px viewport; this stacks each region vertically with a bottom
 * tab bar. The 4 tabs are: Files, Edit, Voice, Git — Voice is the
 * headline tab and the one users will hit first on a phone.
 *
 * M1 (2026-06-11) additions:
 *   - Real `<MobileTopBar />`
 *     (status bar + app bar)
 *     at the top, with
 *     `padding-top:
 *     var(--safe-top)`. The
 *     token is set by the
 *     `DeviceEmulator` per-
 *     device and on real
 *     devices by Tauri's
 *     `env(safe-area-inset-top)`.
 *   - Touch UX baseline
 *     applied to the tab
 *     bar:
 *       - 48px min tab
 *         height (already
 *         in 5a-era)
 *       - 56px min tab
 *         bar height
 *         (already)
 *       - `touch-action:
 *         manipulation`
 *         to kill iOS
 *         double-tap-zoom
 *       - `user-select:
 *         none` to
 *         prevent long-
 *         press text
 *         selection
 *       - `tap-highlight-color:
 *         transparent`
 *         to kill the
 *         gray tap
 *         flash on
 *         Android Chrome
 *       - Active-state
 *         background
 *         (already)
 *   - The body for each tab
 *     is still a placeholder
 *     (Files/Edit/Voice/Git
 *     tabs wire to the real
 *     panes in 3a-3c/5d-5e
 *     work — not in M1).
 *     M1's job is the SHELL:
 *     chrome, safe areas,
 *     touch targets.
 */
export function MobileShell() {
  const [tab, setTab] = useState<MobileTab>('edit');
  // M5: write `--keyboard-height` to
  // `documentElement` when the on-screen keyboard
  // opens, and fire a light haptic on tab switch.
  useVirtualKeyboard();
  const haptics = useHaptics();

  return (
    <div className={styles.shell}>
      <MobileTopBar />
      <div className={styles.content}>
        {tab === 'files' && (
          <div className={styles.placeholder}>
            <strong>Files</strong>
            <span>File tree comes in Phase 2</span>
          </div>
        )}
        {tab === 'edit' && (
          <div className={styles.placeholder}>
            <strong>Editor</strong>
            <span>Monaco arrives in Phase 2</span>
          </div>
        )}
        {tab === 'voice' && (
          <div className={styles.placeholder}>
            <strong>Voice</strong>
            <span>Wispr Flow + on-device STT arrive in Phase M3</span>
            <button className={styles.micButton} type="button" disabled>
              <span className={styles.micDot} />
              Tap to speak
            </button>
          </div>
        )}
        {tab === 'git' && (
          <div className={styles.placeholder}>
            <strong>Git</strong>
            <span>Status, diff, commit — Phase 3</span>
          </div>
        )}
      </div>
      <nav className={styles.tabBar} aria-label="Primary">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`${styles.tab} ${tab === t.id ? styles.tabActive : ''}`}
            onClick={() => {
              if (tab !== t.id) haptics.light();
              setTab(t.id);
            }}
            aria-current={tab === t.id ? 'page' : undefined}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d={t.icon} />
            </svg>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
