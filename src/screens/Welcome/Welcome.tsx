/**
 * Welcome screen — the
 * first thing a user sees
 * when Lipi is launched with
 * no workspace open.
 *
 * Per Rule 3 (screen-folder
 * layout), this lives in
 * `src/screens/Welcome/`. It
 * reads the workspace store
 * (shared) and writes to it
 * via `open()` / `close()`.
 * It does NOT call Tauri
 * directly — the
 * `useOpenWorkspace` hook
 * (in this same folder)
 * wraps the `pickFolder()`
 * IPC call with the
 * workspace-store
 * transition.
 *
 * The screen's job is small
 * and deliberately so:
 *
 * - Show the app name + a
 *   one-line value prop.
 * - A primary "Open Folder"
 *   button.
 * - A "Recent" list with the
 *   last 5 paths the user
 *   opened. Clicking a
 *   recent re-opens it
 *   (without going through
 *   the native picker).
 * - An error banner if the
 *   last picker / open
 *   attempt failed.
 *
 * The screen is keyed on
 * `hydrated` — it renders a
 * minimal loading state
 * until `useWorkspaceStore`
 * has finished reading from
 * `localStorage`. This
 * prevents a one-frame
 * flash of the hero when
 * there's actually a saved
 * workspace to open.
 */

import type { ReactNode } from 'react';

import { Button } from '@/shared/components/Button/Button';
import { Stack } from '@/shared/components/Stack/Stack';
import {
  useWorkspaceStore,
  workspaceSelectors,
} from '@/shared/state/workspaceStore';

import { useOpenWorkspace } from './hooks/useOpenWorkspace';

import styles from './Welcome.module.css';

interface WelcomeProps {
  /** Optional slot for
   * secondary actions
   * (e.g. "Open Settings"
   * link in the top-right).
   * The host (`AppRoot`)
   * passes this in so the
   * Welcome screen doesn't
   * import the global
   * `useAppStore` directly
   * — keeps the screen
   * self-contained. */
  renderActions?: () => ReactNode;
  /**
   * Optional first-run panel,
   * rendered above the hero.
   * The host (`AppRoot`)
   * computes the gate
   * conditions (firstRun
   * store + keychain IPC)
   * and passes either a
   * rendered `<FirstRunOnboarding />`
   * or `null`. Keeping the
   * gate logic in the host
   * means the Welcome screen
   * doesn't import the
   * `useFirstRunOnboarding`
   * hook or the keychain IPC
   * — same isolation rule
   * as `renderActions`.
   */
  firstRunPanel?: ReactNode;
}

export function Welcome({
  renderActions,
  firstRunPanel,
}: WelcomeProps): JSX.Element {
  const hydrated = useWorkspaceStore(workspaceSelectors.hydrated);
  const recents = useWorkspaceStore(workspaceSelectors.recents);
  const status = useWorkspaceStore(workspaceSelectors.status);

  const open = useOpenWorkspace();

  // We do NOT block the
  // hero on `hydrated` —
  // we show it
  // unconditionally. The
  // hero is the right
  // content for the
  // "no workspace" state
  // even during the brief
  // hydration window. The
  // only side-effect of
  // not waiting is that
  // the recents list may
  // pop in a frame after
  // the rest, which is
  // fine.
  //
  // We DO gate the
  // "open" button on
  // `!status.opening` so
  // the user can't
  // double-fire the
  // native picker.
  const isOpening = status.kind === 'opening';
  const errorMessage = status.kind === 'error' ? status.message : null;

  return (
    <main className={styles.root} aria-labelledby="welcome-title">
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.logo} aria-hidden="true">
            L
          </span>
          <span className={styles.brandName}>Lipi</span>
        </div>
        {renderActions?.()}
      </header>

      {firstRunPanel}

      <Stack
        direction="column"
        align="center"
        gap={12}
        className={styles.hero}
      >
        <Stack
          direction="column"
          align="center"
          gap={4}
          className={styles.heroBody}
        >
          <h1 id="welcome-title" className={styles.title}>
            A voice-first IDE for everyone
          </h1>
          <p className={styles.subtitle}>
            Open a folder to start. Lipi reads your code, runs your tools,
            and keeps the rest of your machine out of the way.
          </p>
        </Stack>

        <div className={styles.cta}>
          <Button
            variant="primary"
            size="lg"
            onClick={() => {
              void open();
            }}
            loading={isOpening}
            aria-keyshortcuts="Control+Shift+O Meta+Shift+O"
          >
            Open Folder
          </Button>
        </div>

        {errorMessage !== null && (
          <div
            role="alert"
            className={styles.error}
            data-testid="welcome-error"
          >
            {errorMessage}
          </div>
        )}
      </Stack>

      {hydrated && recents.length > 0 && (
        <section
          className={styles.recentsSection}
          aria-labelledby="welcome-recents-title"
        >
          <h2 id="welcome-recents-title" className={styles.recentsTitle}>
            Recent
          </h2>
          <ul className={styles.recentsList}>
            {recents.map((path) => (
              <li
                key={path}
                className={styles.recentsItem}
              >
                <button
                  type="button"
                  className={styles.recentButton}
                  onClick={() => {
                    void open(path);
                  }}
                  disabled={isOpening}
                  title={path}
                >
                  <span className={styles.recentIcon} aria-hidden="true">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    >
                      <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.379a1.5 1.5 0 0 1 1.06.44L8 4.5h4.5A1.5 1.5 0 0 1 14 6v5.5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5v-7Z" />
                    </svg>
                  </span>
                  <span className={styles.recentPath}>{path}</span>
                </button>
                <button
                  type="button"
                  className={styles.recentRemove}
                  aria-label={`Remove ${path} from recents`}
                  onClick={() => {
                    useWorkspaceStore.getState().removeRecent(path);
                  }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden="true"
                  >
                    <path d="M3 3l8 8M11 3l-8 8" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className={styles.footer}>
        <span className={styles.footerHint}>
          Tip: press <kbd>Ctrl/Cmd + Shift + P</kbd> for the command palette
        </span>
      </footer>
    </main>
  );
}
