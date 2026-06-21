/**
 * themeStore — the user's selected theme + crop position.
 *
 * Phase 4 of the theme feature. Replaces the local `useState`
 * that lived inside `ThemeSection` during Phase 3 — the picker
 * now reads from this store, and persistence survives a
 * restart.
 *
 * State shape (intentionally tiny):
 *   - `themeId`       — `ThemeId` literal union from themes.ts
 *   - `cropIndex`     — 0..8 (9-position grid; default 4 = center)
 *   - `cropX` / `cropY` — continuous background-position percentages
 *   - `hydrated`      — false until `hydrate()` runs once on app boot
 *   - `customImageUrl` — data URL for user's custom theme image
 *
 * Persistence: localStorage key `lipi:theme:v1`. On hydrate
 * we validate the persisted values and fall back to defaults if
 * either is bad — same defensive pattern as
 * voicePreferencesStore.
 *
 * Side effect: `setupThemePersistence()` subscribes to the
 * store and calls `applyThemeTokens(theme, cropX, cropY)` on
 * every change.
 */

import { create } from 'zustand';
import { logger } from '@/shared/logger';

import {
  CROP_POSITIONS,
  CUSTOM_THEME_ID,
  DEFAULT_CROP_INDEX,
  DEFAULT_THEME_ID,
  THEMES,
  applyThemeTokens,
  buildCustomTheme,
  clearCustomThemeImage,
  findTheme,
  isCustomTheme,
  loadCustomThemeImage,
  saveCustomThemeImage,
  type ThemeId,
} from './themes';

const STORAGE_KEY = 'lipi:theme:v1';

export type { ThemeId };

interface PersistedState {
  themeId: ThemeId;
  cropIndex: number;
  cropX: number;
  cropY: number;
}

function isValidThemeId(v: unknown): v is ThemeId {
  return (
    typeof v === 'string' &&
    (v === CUSTOM_THEME_ID || THEMES.some((t) => t.id === v))
  );
}

function isValidCropIndex(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 8;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(100, v));
}

function loadFromStorage(): PersistedState | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const p = parsed as Record<string, unknown>;
    if (!isValidThemeId(p.themeId)) return null;

    // New format: has explicit cropX / cropY
    if (typeof p.cropX === 'number' && typeof p.cropY === 'number') {
      const ci =
        typeof p.cropIndex === 'number' &&
        (p.cropIndex === -1 || isValidCropIndex(p.cropIndex))
          ? p.cropIndex
          : DEFAULT_CROP_INDEX;
      return {
        themeId: p.themeId as ThemeId,
        cropIndex: ci,
        cropX: clamp01(p.cropX),
        cropY: clamp01(p.cropY),
      };
    }

    // Old format: only themeId + cropIndex (0..8).
    // Derive cropX / cropY from the preset grid.
    if (!isValidCropIndex(p.cropIndex)) return null;
    const pos = CROP_POSITIONS[p.cropIndex as number];
    return {
      themeId: p.themeId as ThemeId,
      cropIndex: p.cropIndex as number,
      cropX: parseFloat(pos.x),
      cropY: parseFloat(pos.y),
    };
  } catch {
    return null;
  }
}

function saveToStorage(state: PersistedState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    // Quota / private-mode failures are non-fatal.
    logger.warn('[themeStore] failed to persist:', e);
  }
}

export interface ThemeState {
  themeId: ThemeId;
  cropIndex: number;
  /** Continuous crop x position (0–100 CSS background-position %). */
  cropX: number;
  /** Continuous crop y position (0–100 CSS background-position %). */
  cropY: number;
  hydrated: boolean;
  customImageUrl: string | null;
  /** Pick a theme. Resets the crop to center. */
  setThemeId: (id: ThemeId) => void;
  /** Pick a crop index (0..8). Also updates cropX / cropY. */
  setCropIndex: (idx: number) => void;
  /** Set a continuous crop position. Sets cropIndex to -1
   *  (sentinel meaning "custom position"). */
  setCropPosition: (x: number, y: number) => void;
  /** Reset crop to center for the active theme. */
  resetCrop: () => void;
  /** Idempotent. Called once at app startup. */
  hydrate: () => void;
  /** Save a custom theme image data URL and switch to custom theme. */
  setCustomImage: (dataUrl: string) => void;
  /** Remove the custom theme image and reset to default theme. */
  clearCustomImage: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  themeId: DEFAULT_THEME_ID,
  cropIndex: DEFAULT_CROP_INDEX,
  cropX: 50,
  cropY: 50,
  hydrated: false,
  customImageUrl: null,
  setThemeId: (themeId) => {
    if (!isValidThemeId(themeId)) return;
    set({ themeId, cropIndex: DEFAULT_CROP_INDEX, cropX: 50, cropY: 50 });
  },
  setCropIndex: (cropIndex) => {
    if (!isValidCropIndex(cropIndex)) return;
    const pos = CROP_POSITIONS[cropIndex];
    set({
      cropIndex,
      cropX: parseFloat(pos.x),
      cropY: parseFloat(pos.y),
    });
  },
  setCropPosition: (x, y) => {
    set({ cropX: clamp01(x), cropY: clamp01(y), cropIndex: -1 });
  },
  resetCrop: () => {
    set({ cropIndex: DEFAULT_CROP_INDEX, cropX: 50, cropY: 50 });
  },
  hydrate: () => {
    if (get().hydrated) return;
    const persisted = loadFromStorage();
    const customImageUrl = loadCustomThemeImage();
    set({
      themeId: persisted?.themeId ?? DEFAULT_THEME_ID,
      cropIndex: persisted?.cropIndex ?? DEFAULT_CROP_INDEX,
      cropX: persisted?.cropX ?? 50,
      cropY: persisted?.cropY ?? 50,
      customImageUrl,
      hydrated: true,
    });
  },
  setCustomImage: (dataUrl) => {
    saveCustomThemeImage(dataUrl);
    set({
      customImageUrl: dataUrl,
      themeId: CUSTOM_THEME_ID,
      cropIndex: DEFAULT_CROP_INDEX,
      cropX: 50,
      cropY: 50,
    });
  },
  clearCustomImage: () => {
    clearCustomThemeImage();
    set({
      customImageUrl: null,
      themeId: DEFAULT_THEME_ID,
      cropIndex: DEFAULT_CROP_INDEX,
      cropX: 50,
      cropY: 50,
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
 * `hydrated` flag must be true before the side effect fires.
 */
export function setupThemePersistence(): void {
  if (persistenceSubscribed) return;
  persistenceSubscribed = true;

  const initial = useThemeStore.getState();
  applyInitialTokens(initial.themeId, initial.cropX, initial.cropY);

  useThemeStore.subscribe((state) => {
    if (!state.hydrated) return;
    saveToStorage({
      themeId: state.themeId,
      cropIndex: state.cropIndex,
      cropX: state.cropX,
      cropY: state.cropY,
    });
    let theme;
    if (isCustomTheme(state.themeId)) {
      if (!state.customImageUrl) return;
      theme = buildCustomTheme(state.customImageUrl);
    } else {
      theme = findTheme(state.themeId);
    }
    if (theme) {
      applyThemeTokens(theme, state.cropX, state.cropY);
    }
  });
}

function applyInitialTokens(
  themeId: ThemeId,
  cropX: number,
  cropY: number,
): void {
  let theme;
  if (isCustomTheme(themeId)) {
    const customImageUrl = loadCustomThemeImage();
    if (!customImageUrl) return;
    theme = buildCustomTheme(customImageUrl);
  } else {
    theme = findTheme(themeId);
  }
  if (!theme) return;
  applyThemeTokens(theme, cropX, cropY);
}

// ------------------------------------------------------------
// Selectors
// ------------------------------------------------------------

export const themeSelectors = {
  themeId: (s: ThemeState) => s.themeId,
  cropIndex: (s: ThemeState) => s.cropIndex,
  cropX: (s: ThemeState) => s.cropX,
  cropY: (s: ThemeState) => s.cropY,
  hydrated: (s: ThemeState) => s.hydrated,
  customImageUrl: (s: ThemeState) => s.customImageUrl,
};
