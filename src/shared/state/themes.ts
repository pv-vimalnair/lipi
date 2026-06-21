/**
 * Theme definitions + crop position constants for the IDE tab art.
 *
 * Per Rule 1, all components read theme tokens from CSS variables
 * (--theme-img, --theme-img-crop, --theme-accent, --theme-accent-soft)
 * set on :root by the themeStore. This file owns the static data —
 * the Theme interface, the THEMES list, and the CROP_POSITIONS
 * constants. The themeStore.ts file (one level deeper) handles
 * persistence + side effects.
 *
 * Image assets live in `@/shared/assets/themes/` and are loaded
 * via `import.meta.glob` so we don't have to enumerate every
 * file in source code — Vite handles hashing + bundling + URL
 * rewrites at build time. Missing assets fail-fast at module load
 * with a clear error pointing to the missing filename.
 *
 * The Theme interface is a `readonly` shape — every field is
 * stable for the life of the app. Accent + accentSoft are
 * written to :root via the themeStore; the React picker (in
 * SettingsProvider) reads THEMES directly from this module.
 *
 * Naming: vintage/place-name conventions (Hickory Hollow, Quiet
 * Valley). The "Wildflower Field" image happens to be daisies on
 * a blue sky, but the name evokes a 30-40-year-old botanical
 * print rather than a literal floral description. See HANDOFF
 * §9 for the naming rationale.
 */

export interface Theme {
  /** Stable id used for persistence + CSS class names. */
  id: string;
  /** Display name shown in the picker. */
  name: string;
  /** Short mood line: "<time of day> · <feeling> · <descriptor>". */
  mood: string;
  /**
   * Resolved URL string for the illustration. Vite rewrites this
   * at build time to the hashed asset URL. Written to
   * `--theme-img` on :root via the themeStore; the active tab's
   * CSS reads it via `background-image: var(--theme-img)`.
   */
  imageUrl: string;
  /** Hex accent color — active-tab stripe + active tree-row bg. */
  accent: string;
  /** Soft accent surface color, used behind selected rows / chips. */
  accentSoft: string;
}

// Eagerly load every theme asset as a hashed URL string.
// `query: '?url'` tells Vite to return the URL (not the file
// contents), and `eager: true` makes the import synchronous so
// THEMES is a plain const usable at module scope. The cast to
// `Record<string, string>` reflects the actual runtime shape;
// Vite types `import.meta.glob` loosely so a structural cast
// is the standard pattern (see Vite docs §"import.meta.glob").
const themeImages = import.meta.glob<string>(
  '@/shared/assets/themes/*.{png,jpg}',
  { eager: true, query: '?url', import: 'default' },
) as Record<string, string>;

/**
 * Resolve a theme image filename to its Vite-hashed URL.
 * Throws at module load if the asset is missing — fail-fast
 * beats a silently broken theme card at runtime.
 */
function img(filename: string): string {
  const key = `/src/shared/assets/themes/${filename}`;
  const url = themeImages[key];
  if (!url) {
    throw new Error(
      `[themes] Missing theme image: ${filename}. ` +
        `Drop the file into src/shared/assets/themes/ ` +
        `and reference it from THEMES in src/shared/state/themes.ts.`,
    );
  }
  return url;
}

export const THEMES: readonly Theme[] = [
  {
    id: 'hickory-hollow',
    name: 'Hickory Hollow',
    mood: 'October · warm · nostalgic',
    imageUrl: img('01-hickory-hollow.jpg'),
    accent: '#8a5a2a',
    accentSoft: '#f0e8d4',
  },
  {
    id: 'whispering-pines',
    name: 'Whispering Pines',
    mood: 'Midnight · still · deep focus',
    imageUrl: img('02-whispering-pines.jpg'),
    accent: '#3a5a3a',
    accentSoft: '#d8e4d4',
  },
  {
    id: 'marigold-field',
    name: 'Marigold Field',
    mood: 'Noon · golden · alive',
    imageUrl: img('03-marigold-field.jpg'),
    accent: '#b8862a',
    accentSoft: '#f4e6c0',
  },
  {
    id: 'wildflower-field',
    name: 'Wildflower Field',
    mood: 'May morning · fresh · light',
    imageUrl: img('04-wildflower-field.jpg'),
    accent: '#4a6a8a',
    accentSoft: '#dce4ec',
  },
  {
    id: 'quiet-valley',
    name: 'Quiet Valley',
    mood: 'Afternoon · still · timeless',
    imageUrl: img('05-quiet-valley.jpg'),
    accent: '#3a6a4a',
    accentSoft: '#d4e2d0',
  },
] as const;

/**
 * Literal union of theme ids. Useful for Zustand store typing
 * so a typo at the call site (`setTheme('whisphering-pines')`)
 * fails at compile time rather than falling back to "no theme".
 * Includes 'custom' for user-uploaded theme images.
 */
export const CUSTOM_THEME_ID = 'custom' as const;
export type ThemeId = (typeof THEMES)[number]['id'] | typeof CUSTOM_THEME_ID;

export const DEFAULT_THEME_ID: ThemeId = 'hickory-hollow';

const CUSTOM_IMAGE_STORAGE_KEY = 'lipi:theme:custom-image';

export function isCustomTheme(id: string): boolean {
  return id === CUSTOM_THEME_ID;
}

export function loadCustomThemeImage(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(CUSTOM_IMAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveCustomThemeImage(dataUrl: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CUSTOM_IMAGE_STORAGE_KEY, dataUrl);
  } catch {
    // Quota exceeded — non-fatal, the image just won't persist.
  }
}

export function clearCustomThemeImage(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(CUSTOM_IMAGE_STORAGE_KEY);
  } catch {
    // Non-fatal.
  }
}

export function buildCustomTheme(imageUrl: string): Theme {
  return {
    id: CUSTOM_THEME_ID,
    name: 'Custom',
    mood: 'Your image · your mood',
    imageUrl,
    accent: '#1a1d23',
    accentSoft: '#2a2d33',
  };
}

/**
 * 9 crop positions for the active-tab image. Index 0 = top-left,
 * index 4 = center (the default), index 8 = bottom-right. The
 * values are CSS `background-position` percentages — they're
 * written to `--theme-img-crop` on :root via the themeStore
 * and the active tab reads them via `background-position:
 * var(--theme-img-crop)`.
 *
 * Lightweight by design: a single CSS variable swap is ~1
 * assignment vs. an actual image crop (which would require a
 * canvas, a cropper UI, and per-theme canvas code — far more
 * than the 10%-of-dev-attention budget this feature is
 * allowed). Per the docs/plans/theme-feature.md design
 * decision, the user picks a "view" of the image, not a
 * crop; the underlying image asset is reused as-is.
 */
export const CROP_POSITIONS: ReadonlyArray<{ x: string; y: string }> = [
  { x: '0%',   y: '0%'   },
  { x: '50%',  y: '0%'   },
  { x: '100%', y: '0%'   },
  { x: '0%',   y: '50%'  },
  { x: '50%',  y: '50%'  },
  { x: '100%', y: '50%'  },
  { x: '0%',   y: '100%' },
  { x: '50%',  y: '100%' },
  { x: '100%', y: '100%' },
];

export const DEFAULT_CROP_INDEX = 4; // center

export const CROP_LABELS: ReadonlyArray<string> = [
  'Top-left', 'Top', 'Top-right',
  'Left', 'Center', 'Right',
  'Bottom-left', 'Bottom', 'Bottom-right',
];

/** Look up a theme by id. Returns undefined if the id is unknown. */
export function findTheme(id: string): Theme | undefined {
  return THEMES.find((t) => t.id === id);
}

/** Safely fetch a crop position by index, falling back to center. */
export function cropAt(idx: number): { x: string; y: string } {
  return CROP_POSITIONS[idx] ?? CROP_POSITIONS[DEFAULT_CROP_INDEX];
}

// ============================================================
// CSS-variable bridge
// ============================================================
//
// Phase 4 will introduce a Zustand `themeStore` that owns the
// active theme + crop and persists them to localStorage. The
// store's setter will call `applyThemeTokens()` whenever state
// changes, so the active tab (and any other consumer of the
// theme tokens) re-paints without a component-level rerender.
//
// For Phase 3 — before the store exists — ThemeSection owns the
// selection state and calls `applyThemeTokens()` itself in a
// `useEffect`. The two paths converge on the same function:
// there's exactly one place in the codebase that knows how to
// translate a Theme + crop index into CSS variables on :root,
// and that's this file.
//
// The variable names mirror what the mock's CSS already reads:
//   --theme-img         url() for the active illustration
//   --theme-img-crop    "x% y%" for background-position
//   --theme-accent      hex accent (active-tab stripe + dirty dot)
//   --theme-accent-soft rgba accent at ~16% alpha (active tree row)
//
// We don't unset them on teardown — CSS variables are
// session-global and resetting them to "" can leave
// `background-image: url("")` which some browsers
// interpret as "use the parent's image". Leaving the last value
// in place is the safer default. Phase 4's store hydrate() will
// always re-apply on app boot, so the values are always set.

const ROOT_STYLE_PROPS = [
  '--theme-img',
  '--theme-img-crop',
  '--theme-accent',
  '--theme-accent-soft',
] as const;

/** Write the active theme + crop to :root CSS variables.
 *  Safe to call repeatedly; reads nothing from React state.
 *
 *  Two call signatures:
 *    applyThemeTokens(theme, cropIndex)   — preset grid lookup
 *    applyThemeTokens(theme, cropX, cropY) — continuous position */
export function applyThemeTokens(
  theme: Theme,
  cropIndexOrX: number,
  cropY?: number,
): void {
  if (typeof document === 'undefined') return;
  const pos =
    cropY !== undefined
      ? { x: `${cropIndexOrX}%`, y: `${cropY}%` }
      : cropAt(cropIndexOrX);
  const soft = hexToRgba(theme.accent, 0.18);
  const root = document.documentElement.style;
  root.setProperty('--theme-img', `url('${theme.imageUrl}')`);
  root.setProperty('--theme-img-crop', `${pos.x} ${pos.y}`);
  root.setProperty('--theme-accent', theme.accent);
  root.setProperty('--theme-accent-soft', soft);
}

/** Convert "#rrggbb" → "rgba(r, g, b, a)". Throws on bad input
 *  — callers pass values we own (THEMES), so this is a
 *  defensive check, not a runtime guard. */
function hexToRgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) {
    throw new Error(`[themes] bad accent hex: ${hex}`);
  }
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Re-export the CSS variable names so test code (or future
// callers that want to write a custom accent at runtime) can
// reference them without hardcoding strings.
export const THEME_CSS_VARS = ROOT_STYLE_PROPS;
