/**
 * themeStore — the user's selected theme + crop position.
 *
 * Phase 4 of the theme feature. Replaces the local `useState`
 * that lived inside `ThemeSection` during Phase 3 — the picker
 * now reads from this store, and persistence survives a
 * restart.
 *
 * State shape (intentionally tiny):
 *   - `themeId`   — `ThemeId` literal union from themes.ts
 *   - `cropIndex` — 0..8 (9-position grid; default 4 = center)
 *   - `hydrated`  — false until `hydrate()` runs once on app
 *                   boot. While `false`, the picker falls back
 *                   to the bundled defaults so the UI never
 *                   flashes an empty selection.
 *
 * Persistence: localStorage key `lipi:theme:v1`. On hydrate
 * we validate the persisted values (themeId must be a known
 * id, cropIndex must be 0..8) and fall back to defaults if
 * either is bad — same defensive pattern as
 * voicePreferencesStore.
 *
 * Side effect: `setupThemePersistence()` subscribes to the
 * store and calls `applyThemeTokens(theme, cropIndex)` on
 * every change. That's the single source of truth for the
 * `--theme-img` / `--theme-img-crop` / `--theme-accent` /
 * `--theme-accent-soft` CSS variables on :root that the
 * TabStrip + (future) tree active-row read. Subscribe once at
 * app startup in `src/main.tsx`; the store's setter does NOT
 * call applyThemeTokens directly so the store stays a pure
 * state container.
 *
 * Why subscribe-from-outside vs. action-side effect?
 *   - Lets us swap the persistence + applyThemeTokens layer
 *     (e.g. for tests that want to observe store changes
 *     without writing to localStorage).
 *   - The same pattern as `setupVoicePreferencesPersistence`.
 */

import { create } from 'zustand';
import { logger } from '@/shared/logger';

import {
  DEFAULT_CROP_INDEX,
  DEFAULT_THEME_ID,
  THEMES,
  applyThemeTokens,
  findTheme,
  type ThemeId,
} from './themes';

const STORAGE_KEY = 'lipi:theme:v1';

export type { ThemeId };

interface PersistedState {
  themeId: ThemeId;
  cropIndex: number;
}

function isValidThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && THEMES.some((t) => t.id === v);
}

function isValidCropIndex(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 8;
}

function loadFromStorage(): PersistedState | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'themeId' in parsed &&
      'cropIndex' in parsed &&
      isValidThemeId((parsed as PersistedState).themeId) &&
      isValidCropIndex((parsed as PersistedState).cropIndex)
    ) {
      return {
        themeId: (parsed as PersistedState).themeId,
        cropIndex: (parsed as PersistedState).cropIndex,
      };
    }
    // Malformed entry — drop it so we don't keep failing on
    // every load. The user can re-pick from the Settings UI
    // and the next save will overwrite with a clean payload.
    return null;
  } catch {
    return null;
  }
}

function saveToStorage(state: PersistedState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    // Quota / private-mode failures are non-fatal — the user
    // just won't see their selection persist across reloads.
    // The store keeps the in-memory selection.
    logger.warn('[themeStore] failed to persist:', e);
  }
}

export interface ThemeState {
  themeId: ThemeId;
  cropIndex: number;
  hydrated: boolean;
  /** Pick a theme. Resets the crop to center so the new
   *  theme's "good crop" is the default view — carrying the
   *  previous crop across themes is more confusing than
   *  helpful (each theme's composition is different). */
  setThemeId: (id: ThemeId) => void;
  /** Pick a crop index (0..8). Does NOT change theme. */
  setCropIndex: (idx: number) => void;
  /** Reset crop to center for the active theme. */
  resetCrop: () => void;
  /** Idempotent. Called once at app startup. Reads
   *  localStorage and seeds the store; if storage is empty
   *  or malformed, falls back to the bundled defaults. */
  hydrate: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  themeId: DEFAULT_THEME_ID,
  cropIndex: DEFAULT_CROP_INDEX,
  hydrated: false,
  setThemeId: (themeId) => {
    // Defensive: a typo at the call site (`setThemeId('foo')`)
    // would otherwise persist garbage. The ThemeId literal
    // union gives compile-time safety; this guard catches
    // runtime paths (e.g. command-palette args) that bypass
    // the type system.
    if (!isValidThemeId(themeId)) return;
    // Picking a new theme resets the crop — same UX as
    // ThemeSection's local state had.
    set({ themeId, cropIndex: DEFAULT_CROP_INDEX });
  },
  setCropIndex: (cropIndex) => {
    if (!isValidCropIndex(cropIndex)) return;
    set({ cropIndex });
  },
  resetCrop: () => {
    set({ cropIndex: DEFAULT_CROP_INDEX });
  },
  hydrate: () => {
    if (get().hydrated) return;
    const persisted = loadFromStorage();
    set({
      themeId: persisted?.themeId ?? DEFAULT_THEME_ID,
      cropIndex: persisted?.cropIndex ?? DEFAULT_CROP_INDEX,
      hydrated: true,
    });
  },
}));

// ------------------------------------------------------------
// Persistence + side-effect wiring
// ------------------------------------------------------------

let persistenceSubscribed = false;

/**
 * Wire up persistence + CSS-variable side effects.
 *
 * Call ONCE at app startup (after `createRoot`). The store's
 * `hydrated` flag must be true before the side effect fires
 * — otherwise we'd overwrite a persisted selection with the
 * default on the very first render. The hydrate-then-subscribe
 * order matches the voicePreferences pattern.
 *
 * Two things happen on every store change:
 *   1. Save the new state to localStorage (debouncing is
 *      not needed — Zustand batches via microtask, and a
 *      single user click is one state change).
 *   2. Apply the new theme to :root CSS variables so the
 *      TabStrip repaints.
 */
export function setupThemePersistence(): void {
  if (persistenceSubscribed) return;
  persistenceSubscribed = true;

  // Apply the initial state immediately so the TabStrip is
  // themed even before any user interaction (and so we don't
  // flash the default theme if the user reloads mid-selection).
  const initial = useThemeStore.getState();
  applyInitialTokens(initial.themeId, initial.cropIndex);

  useThemeStore.subscribe((state) => {
    if (!state.hydrated) return;
    saveToStorage({ themeId: state.themeId, cropIndex: state.cropIndex });
    // applyThemeTokens is a no-op if document is undefined
    // (e.g. SSR test runner), but the call site guards
    // against that internally.
    const theme = findTheme(state.themeId);
    if (theme) {
      applyThemeTokens(theme, state.cropIndex);
    }
  });
}

/**
 * Apply the persisted-or-default theme tokens on first boot,
 * BEFORE `setupThemePersistence` subscribes. This guarantees
 * the TabStrip paints with the user's saved selection even if
 * the subscribe callback hasn't fired yet (it only fires on
 * subsequent changes, not the initial state).
 */
function applyInitialTokens(themeId: ThemeId, cropIndex: number): void {
  const theme = findTheme(themeId);
  if (!theme) return;
  applyThemeTokens(theme, cropIndex);
}

// ------------------------------------------------------------
// Selectors
// ------------------------------------------------------------
//
// Per Rule 6 (Zustand for cross-component state), consumers
// should pick the narrowest selector possible so unrelated
// store changes don't re-render them. The two selectors below
// cover 99% of the call sites.

export const themeSelectors = {
  themeId: (s: ThemeState) => s.themeId,
  cropIndex: (s: ThemeState) => s.cropIndex,
  hydrated: (s: ThemeState) => s.hydrated,
};