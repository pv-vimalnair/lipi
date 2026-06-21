/**
 * firstRunStore — the "have we shown the
 * no-API-key interstitial yet?" flag.
 *
 * Per Rule 3 (screen-folder layout),
 * this lives in `src/shared/state/`
 * because it's read by the AppRoot
 * router and the Welcome screen and
 * written by the command palette's
 * "Reopen first-run setup" command.
 * Per Rule 6 (section isolation), no
 * screen imports another; they all
 * read THIS store.
 *
 * The store is intentionally tiny:
 * one boolean. The intent is "did
 * the user explicitly tell us to
 * stop showing this?" — distinct
 * from "does the user have at
 * least one key configured?", which
 * is a separate concern (read on
 * demand via `aiGetConfiguredProviders`,
 * not persisted). The two together
 * gate the interstitial:
 *
 *   show = !dismissed && configuredProviders.length === 0
 *
 * `hydrated` flips to `true` after
 * the first read from `localStorage`,
 * matching the same pattern as
 * `workspaceStore` so the AppRoot
 * can render a placeholder while
 * the value is loading.
 *
 * Persistence key: `lipi:firstRun:v1`.
 * Bumping the version (`:v1` →
 * `:v2`) deliberately wipes the
 * stored flag — a future "we
 * redesigned the interstitial,
 * show it again to everyone" can
 * ride that bump.
 */

import { create } from 'zustand';
import { logger } from '@/shared/logger';

const STORAGE_KEY_DISMISSED = 'lipi:firstRun:v1';

// Re-exported below for tests
// (mirrors the workspaceStore
// pattern).
export { STORAGE_KEY_DISMISSED };

interface FirstRunState {
  /** Whether the store has finished
   * its first `localStorage` read.
   * Until this is `true`, callers
   * should not make visibility
   * decisions (the value might
   * still flip from `false` to
   * `true` on hydration). */
  hydrated: boolean;
  /** Whether the user has explicitly
   * dismissed the first-run
   * interstitial. `true` = don't
   * show it again. */
  dismissed: boolean;

  /** Read from `localStorage` and
   * set `hydrated` to `true`.
   * Idempotent. Called once at
   * app startup (from
   * `AppRoot`). */
  hydrate: () => void;
  /** Mark the interstitial as
   * dismissed. Persists
   * immediately. Used by:
   *  - the "Skip for now" button
   *  - the "Add a key" CTA (the
   *    user is now headed to
   *    Settings; showing the
   *    interstitial a second time
   *    after they save a key is
   *    redundant)
   *  - the command palette's
   *    "Reopen first-run setup"
   *    command (via `reset()`). */
  dismiss: () => void;
  /** Clear the dismissal flag and
   * persist. Used by the command
   * palette's "Reopen first-run
   * setup" command — the user is
   * asking to see the
   * interstitial again, so we
   * re-arm it. */
  reset: () => void;
}

function readDismissed(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DISMISSED);
    if (raw === null) return false;
    return raw === 'true';
  } catch {
    // Corrupt / quota / private mode
    // — fail open (don't show the
    // interstitial if we can't
    // read the flag; the gate in
    // AppRoot will still keep it
    // quiet when the keychain
    // reports configured
    // providers).
    return false;
  }
}

function writeDismissed(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY_DISMISSED, value ? 'true' : 'false');
  } catch (e) {
    // Quota exceeded, private mode,
    // etc. Persistence is
    // best-effort — the in-memory
    // store still works for this
    // session.
    if (import.meta.env.DEV) {
      logger.warn(
        '[firstRunStore] failed to persist dismissed',
        value,
        e,
      );
    }
  }
}

export const useFirstRunStore = create<FirstRunState>((set, get) => ({
  hydrated: false,
  dismissed: false,
  hydrate: () => {
    if (get().hydrated) return;
    set({
      hydrated: true,
      dismissed: readDismissed(),
    });
  },
  dismiss: () => {
    set({ dismissed: true });
    writeDismissed(true);
  },
  reset: () => {
    set({ dismissed: false });
    writeDismissed(false);
  },
}));

/** Selectors — keep these tiny so components can compose them. */
export const firstRunSelectors = {
  hydrated: (s: FirstRunState) => s.hydrated,
  dismissed: (s: FirstRunState) => s.dismissed,
};
