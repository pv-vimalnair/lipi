/**
 * tourStore — the "have we shown the
 * onboarding tour yet?" flag + the
 * current step in the tour.
 *
 * Per Rule 3 (screen-folder layout),
 * this lives in `src/shared/state/`
 * because the tour overlay is mounted
 * once at the AppRoot level (overlays
 * Welcome AND Editor) and reads
 * cross-screen state. Per Rule 6
 * (section isolation), no screen
 * imports another; they all read THIS
 * store (via the `data-tour-target`
 * anchors they expose to the
 * overlay).
 *
 * The store is a small step machine:
 *   - `hydrated`: whether the first
 *     `localStorage` read has run.
 *   - `dismissed`: whether the user
 *     has explicitly closed the tour
 *     (Skip or Finish). Once
 *     dismissed, the tour does not
 *     auto-start on next launch.
 *   - `currentStep`: 0-based index
 *     into the step list. `null`
 *     means the tour is not active.
 *
 * The state model intentionally
 * conflates "dismissed" and "step
 * index = 0 + not visible". The
 * dismiss flag exists so that a
 * returning user does NOT see the
 * first step again unless they ask
 * for it (the "Restart onboarding
 * tour" command palette entry).
 *
 * The store does NOT know the total
 * step count. The overlay component
 * is the consumer of the step list
 * (it owns the position math, the
 * anchor lookups, the "last step"
 * callout copy). The store only
 * knows how to advance / retreat
 * indices. The `next()` action
 * advances by 1; whether the new
 * index is the last step is a
 * component concern (it reads
 * `TOUR_STEPS.length` and shows
 * "Finish" instead of "Next" when
 * the user is on the last step).
 * This decoupling means adding a
 * new step to `tourSteps.ts` does
 * not require touching the store.
 *
 * Persistence:
 *   - `lipi:tour:dismissed:v1` —
 *     boolean, the dismiss flag.
 *     Bumping the version
 *     (`:v1` → `:v2`) deliberately
 *     wipes the flag — a future
 *     "we redesigned the tour,
 *     show it again to everyone"
 *     can ride that bump.
 *
 *   The current step is NOT persisted.
 *     The tour is meant to be a
 *     single-session experience; if
 *     the user kills the app mid-
 *     tour, they restart from step 0
 *     next launch. Persisting the
 *     step would mean a user who
 *     dismissed the app for 5
 *     minutes on step 3 of 5 comes
 *     back to step 3 — but the
 *     dismissed flag was set so
 *     they wouldn't see anything
 *     at all. Persisting both is a
 *     contradiction; we keep
 *     "dismissed" and drop
 *     "currentStep".
 */

import { create } from 'zustand';
import { logger } from '@/shared/logger';

const STORAGE_KEY_DISMISSED = 'lipi:tour:dismissed:v1';

// Re-exported below for tests
// (mirrors the workspaceStore +
// firstRunStore pattern).
export { STORAGE_KEY_DISMISSED };

export type TourStepIndex = number;

interface TourState {
  /** Whether the store has finished
   * its first `localStorage` read.
   * Until this is `true`, callers
   * should not make visibility
   * decisions (the value might
   * still flip from `false` to
   * `true` on hydration). */
  hydrated: boolean;
  /** Whether the user has explicitly
   * closed the tour (Skip / Finish).
   * `true` = don't auto-show it
   * again on next launch. */
  dismissed: boolean;
  /** The current step in the tour,
   * or `null` if the tour is not
   * active. 0-based. */
  currentStep: TourStepIndex | null;

  /** Read from `localStorage` and
   * set `hydrated` to `true`.
   * Idempotent. Called once at
   * app startup (from
   * `AppRoot`). */
  hydrate: () => void;
  /** Start the tour from step 0.
   * Clears the `dismissed` flag
   * (so the tour re-shows even if
   * the user previously dismissed
   * it) and sets `currentStep` to
   * 0. Used by the "Restart
   * onboarding tour" command
   * palette entry. */
  start: () => void;
  /** Advance to the next step. If
   * the tour is not active, this
   * is a no-op. The component is
   * responsible for clamping
   * against the total step count
   * (when the user clicks "Next"
   * on the last step, the
   * component calls `finish()`
   * instead). */
  next: () => void;
  /** Go back to the previous step.
   * No-op if on step 0 or not
   * active. */
  prev: () => void;
  /** Mark the tour as dismissed
   * and clear `currentStep`. Used
   * by the Skip / Finish buttons
   * AND by the ESC / backdrop-
   * click dismiss paths. */
  finish: () => void;
  /** Internal: pure helper that
   * decides what `currentStep`
   * should be after a `next()`
   * call. Exposed for tests. The
   * `totalSteps` argument is the
   * step list length — the store
   * itself doesn't know it
   * (decoupling; see file header). */
  _computeNextStep: (
    current: TourStepIndex | null,
    totalSteps: number,
  ) => TourStepIndex | null;
  /** Internal: pure helper that
   * decides what `currentStep`
   * should be after a `prev()`
   * call. Exposed for tests. */
  _computePrevStep: (
    current: TourStepIndex | null,
  ) => TourStepIndex | null;
}

function readDismissed(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DISMISSED);
    if (raw === null) return false;
    return raw === 'true';
  } catch {
    // Corrupt / quota / private mode
    // — fail closed (don't auto-show
    // the tour if we can't read the
    // flag). The "Restart tour"
    // command still works in this
    // session.
    return true;
  }
}

function writeDismissed(value: boolean): void {
  try {
    localStorage.setItem(
      STORAGE_KEY_DISMISSED,
      value ? 'true' : 'false',
    );
  } catch (e) {
    if (import.meta.env.DEV) {
      logger.warn(
        '[tourStore] failed to persist dismissed',
        value,
        e,
      );
    }
  }
}

export const useTourStore = create<TourState>((set, get) => ({
  hydrated: false,
  dismissed: false,
  currentStep: null,
  hydrate: () => {
    if (get().hydrated) return;
    set({
      hydrated: true,
      dismissed: readDismissed(),
    });
  },
  start: () => {
    // Clear the dismissed flag so
    // the next launch can re-show
    // the tour (the user asked for
    // it via "Restart tour" — they
    // want it back). We do NOT
    // persist this; the in-session
    // start is enough to mount the
    // overlay. If the user dismisses
    // mid-tour, `finish()` will
    // re-persist `dismissed: true`.
    writeDismissed(false);
    set({
      currentStep: 0,
      dismissed: false,
    });
  },
  next: () => {
    const current = get().currentStep;
    if (current === null) return;
    // The overlay component owns
    // the total step count; when
    // the user clicks "Next" on
    // the last step, the overlay
    // calls `finish()` directly
    // (rather than going through
    // `next()` and having the
    // store clamp). This means
    // `next()` is a pure
    // unconditional +1 — safe
    // because the overlay has
    // already decided this is
    // not the last step.
    set({ currentStep: current + 1 });
  },
  prev: () => {
    const current = get().currentStep;
    if (current === null) return;
    if (current <= 0) return;
    set({ currentStep: current - 1 });
  },
  finish: () => {
    set({ currentStep: null });
    writeDismissed(true);
    set({ dismissed: true });
  },
  _computeNextStep: (current, totalSteps) => {
    if (current === null) return 0;
    const next = current + 1;
    if (next >= totalSteps) return null;
    return next;
  },
  _computePrevStep: (current) => {
    if (current === null) return null;
    if (current <= 0) return null;
    return current - 1;
  },
}));

/** Selectors — keep these tiny so components can compose them. */
export const tourSelectors = {
  hydrated: (s: TourState) => s.hydrated,
  dismissed: (s: TourState) => s.dismissed,
  currentStep: (s: TourState) => s.currentStep,
};
