import { describe, expect, it, beforeEach } from 'vitest';
import {
  useThemeStore,
  themeSelectors,
  setupThemePersistence,
} from './themeStore';
import {
  DEFAULT_CROP_INDEX,
  DEFAULT_THEME_ID,
  CROP_LABELS,
} from './themes';

describe('themeStore', () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset to defaults so each test starts from a known state.
    // `setState` is the standard Zustand escape hatch used by
    // voicePreferencesStore.test.ts (same pattern).
    useThemeStore.setState({
      themeId: DEFAULT_THEME_ID,
      cropIndex: DEFAULT_CROP_INDEX,
      hydrated: false,
    });
  });

  it('defaults to hickory-hollow + center crop', () => {
    expect(useThemeStore.getState().themeId).toBe('hickory-hollow');
    expect(useThemeStore.getState().cropIndex).toBe(DEFAULT_CROP_INDEX);
  });

  it('setThemeId updates the theme id', () => {
    useThemeStore.getState().setThemeId('whispering-pines');
    expect(useThemeStore.getState().themeId).toBe('whispering-pines');
  });

  it('setThemeId resets the crop to center (each theme gets a fresh view)', () => {
    useThemeStore.getState().setCropIndex(2); // top-right
    expect(useThemeStore.getState().cropIndex).toBe(2);
    useThemeStore.getState().setThemeId('marigold-field');
    expect(useThemeStore.getState().themeId).toBe('marigold-field');
    // Center is index 4 — same as DEFAULT_CROP_INDEX.
    expect(useThemeStore.getState().cropIndex).toBe(DEFAULT_CROP_INDEX);
  });

  it('setThemeId silently rejects invalid ids (defensive)', () => {
    useThemeStore.getState().setThemeId('whispering-pines');
    // `setThemeId` is typed as ThemeId at the call site, but
    // a runtime path (e.g. command palette args) could
    // bypass the type system. The store's guard catches it.
     
    useThemeStore.getState().setThemeId('not-a-real-theme' as unknown as any);
    expect(useThemeStore.getState().themeId).toBe('whispering-pines');
  });

  it('setCropIndex updates the crop index', () => {
    useThemeStore.getState().setCropIndex(7); // bottom
    expect(useThemeStore.getState().cropIndex).toBe(7);
  });

  it('setCropIndex rejects out-of-range values (defensive)', () => {
    useThemeStore.getState().setCropIndex(0);
    useThemeStore.getState().setCropIndex(-1);
    expect(useThemeStore.getState().cropIndex).toBe(0);
    useThemeStore.getState().setCropIndex(9);
    expect(useThemeStore.getState().cropIndex).toBe(0);
    // Non-integers are also rejected.
    useThemeStore.getState().setCropIndex(2.5);
    expect(useThemeStore.getState().cropIndex).toBe(0);
  });

  it('setCropIndex rejects non-number values (defensive)', () => {
    useThemeStore.getState().setCropIndex(3);
     
    useThemeStore.getState().setCropIndex('4' as unknown as any);
    expect(useThemeStore.getState().cropIndex).toBe(3);
  });

  it('resetCrop returns to center', () => {
    useThemeStore.getState().setCropIndex(8);
    useThemeStore.getState().resetCrop();
    expect(useThemeStore.getState().cropIndex).toBe(DEFAULT_CROP_INDEX);
  });

  it('hydrate reads persisted state', () => {
    localStorage.setItem(
      'lipi:theme:v1',
      JSON.stringify({ themeId: 'quiet-valley', cropIndex: 2 }),
    );
    useThemeStore.getState().hydrate();
    expect(useThemeStore.getState().themeId).toBe('quiet-valley');
    expect(useThemeStore.getState().cropIndex).toBe(2);
  });

  it('hydrate ignores malformed JSON', () => {
    localStorage.setItem('lipi:theme:v1', '{not valid json');
    useThemeStore.getState().hydrate();
    expect(useThemeStore.getState().themeId).toBe(DEFAULT_THEME_ID);
    expect(useThemeStore.getState().cropIndex).toBe(DEFAULT_CROP_INDEX);
  });

  it('hydrate ignores an unknown theme id', () => {
    localStorage.setItem(
      'lipi:theme:v1',
      JSON.stringify({ themeId: 'made-up-theme', cropIndex: 4 }),
    );
    useThemeStore.getState().hydrate();
    expect(useThemeStore.getState().themeId).toBe(DEFAULT_THEME_ID);
  });

  it('hydrate ignores an out-of-range crop index', () => {
    localStorage.setItem(
      'lipi:theme:v1',
      JSON.stringify({ themeId: 'hickory-hollow', cropIndex: 99 }),
    );
    useThemeStore.getState().hydrate();
    expect(useThemeStore.getState().cropIndex).toBe(DEFAULT_CROP_INDEX);
  });

  it('hydrate ignores a payload with the wrong shape (missing fields)', () => {
    localStorage.setItem('lipi:theme:v1', JSON.stringify({ foo: 'bar' }));
    useThemeStore.getState().hydrate();
    expect(useThemeStore.getState().themeId).toBe(DEFAULT_THEME_ID);
  });

  it('hydrate is idempotent', () => {
    localStorage.setItem(
      'lipi:theme:v1',
      JSON.stringify({ themeId: 'marigold-field', cropIndex: 5 }),
    );
    useThemeStore.getState().hydrate();
    expect(useThemeStore.getState().themeId).toBe('marigold-field');
    // Mutating localStorage after hydrate has no effect —
    // the store keeps the hydrated value.
    localStorage.setItem(
      'lipi:theme:v1',
      JSON.stringify({ themeId: 'quiet-valley', cropIndex: 0 }),
    );
    useThemeStore.getState().hydrate();
    expect(useThemeStore.getState().themeId).toBe('marigold-field');
  });

  it('hydrated flag flips to true after a successful hydrate', () => {
    expect(useThemeStore.getState().hydrated).toBe(false);
    useThemeStore.getState().hydrate();
    expect(useThemeStore.getState().hydrated).toBe(true);
  });

  it('persists on setThemeId after setupThemePersistence', () => {
    useThemeStore.getState().hydrate();
    setupThemePersistence();
    useThemeStore.getState().setThemeId('whispering-pines');
    const stored = localStorage.getItem('lipi:theme:v1');
    // Note: setThemeId resets crop to center, so the
    // persisted payload includes cropIndex: 4.
    expect(stored).toBe(
      JSON.stringify({ themeId: 'whispering-pines', cropIndex: DEFAULT_CROP_INDEX }),
    );
  });

  it('persists on setCropIndex after setupThemePersistence', () => {
    useThemeStore.getState().hydrate();
    setupThemePersistence();
    useThemeStore.getState().setCropIndex(7);
    const stored = localStorage.getItem('lipi:theme:v1');
    expect(stored).toBe(
      JSON.stringify({ themeId: DEFAULT_THEME_ID, cropIndex: 7 }),
    );
  });

  it('selector returns the current themeId', () => {
    useThemeStore.getState().setThemeId('wildflower-field');
    expect(themeSelectors.themeId(useThemeStore.getState())).toBe(
      'wildflower-field',
    );
  });

  it('selector returns the current cropIndex', () => {
    useThemeStore.getState().setCropIndex(6);
    expect(themeSelectors.cropIndex(useThemeStore.getState())).toBe(6);
  });

  it('accepts all 9 crop positions', () => {
    for (let i = 0; i < CROP_LABELS.length; i++) {
      useThemeStore.getState().setCropIndex(i);
      expect(useThemeStore.getState().cropIndex).toBe(i);
    }
  });

  it('accepts all 5 theme ids', () => {
    const themeIds = [
      'hickory-hollow',
      'whispering-pines',
      'marigold-field',
      'wildflower-field',
      'quiet-valley',
    ] as const;
    for (const id of themeIds) {
      useThemeStore.getState().setThemeId(id);
      expect(useThemeStore.getState().themeId).toBe(id);
    }
  });
});