/* eslint-disable @typescript-eslint/no-non-null-assertion -- test assertions are guarded by prior expect().toBeDefined() */
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
  CUSTOM_THEME_ID,
} from './themes';

describe('themeStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useThemeStore.setState({
      themeId: DEFAULT_THEME_ID,
      cropIndex: DEFAULT_CROP_INDEX,
      cropX: 50,
      cropY: 50,
      hydrated: false,
      customImageUrl: null,
    });
  });

  it('defaults to hickory-hollow + center crop', () => {
    expect(useThemeStore.getState().themeId).toBe('hickory-hollow');
    expect(useThemeStore.getState().cropIndex).toBe(DEFAULT_CROP_INDEX);
    expect(useThemeStore.getState().cropX).toBe(50);
    expect(useThemeStore.getState().cropY).toBe(50);
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
    expect(useThemeStore.getState().cropIndex).toBe(DEFAULT_CROP_INDEX);
    expect(useThemeStore.getState().cropX).toBe(50);
    expect(useThemeStore.getState().cropY).toBe(50);
  });

  it('setThemeId silently rejects invalid ids (defensive)', () => {
    useThemeStore.getState().setThemeId('whispering-pines');
    useThemeStore.getState().setThemeId('not-a-real-theme' as unknown as any);
    expect(useThemeStore.getState().themeId).toBe('whispering-pines');
  });

  it('setCropIndex updates the crop index', () => {
    useThemeStore.getState().setCropIndex(7); // bottom
    expect(useThemeStore.getState().cropIndex).toBe(7);
  });

  it('setCropIndex also updates cropX and cropY from the preset grid', () => {
    useThemeStore.getState().setCropIndex(2); // top-right → 100%, 0%
    expect(useThemeStore.getState().cropX).toBe(100);
    expect(useThemeStore.getState().cropY).toBe(0);
    useThemeStore.getState().setCropIndex(3); // left → 0%, 50%
    expect(useThemeStore.getState().cropX).toBe(0);
    expect(useThemeStore.getState().cropY).toBe(50);
  });

  it('setCropIndex rejects out-of-range values (defensive)', () => {
    useThemeStore.getState().setCropIndex(0);
    useThemeStore.getState().setCropIndex(-1);
    expect(useThemeStore.getState().cropIndex).toBe(0);
    useThemeStore.getState().setCropIndex(9);
    expect(useThemeStore.getState().cropIndex).toBe(0);
    useThemeStore.getState().setCropIndex(2.5);
    expect(useThemeStore.getState().cropIndex).toBe(0);
  });

  it('setCropIndex rejects non-number values (defensive)', () => {
    useThemeStore.getState().setCropIndex(3);
    useThemeStore.getState().setCropIndex('4' as unknown as any);
    expect(useThemeStore.getState().cropIndex).toBe(3);
  });

  it('setCropPosition sets cropX, cropY and marks cropIndex as -1', () => {
    useThemeStore.getState().setCropPosition(37.5, 62.3);
    expect(useThemeStore.getState().cropX).toBe(37.5);
    expect(useThemeStore.getState().cropY).toBe(62.3);
    expect(useThemeStore.getState().cropIndex).toBe(-1);
  });

  it('setCropPosition clamps values to 0-100', () => {
    useThemeStore.getState().setCropPosition(-10, 150);
    expect(useThemeStore.getState().cropX).toBe(0);
    expect(useThemeStore.getState().cropY).toBe(100);
  });

  it('resetCrop returns to center', () => {
    useThemeStore.getState().setCropIndex(8);
    useThemeStore.getState().resetCrop();
    expect(useThemeStore.getState().cropIndex).toBe(DEFAULT_CROP_INDEX);
    expect(useThemeStore.getState().cropX).toBe(50);
    expect(useThemeStore.getState().cropY).toBe(50);
  });

  it('hydrate reads persisted state', () => {
    localStorage.setItem(
      'lipi:theme:v1',
      JSON.stringify({ themeId: 'quiet-valley', cropIndex: 2 }),
    );
    useThemeStore.getState().hydrate();
    expect(useThemeStore.getState().themeId).toBe('quiet-valley');
    expect(useThemeStore.getState().cropIndex).toBe(2);
    expect(useThemeStore.getState().cropX).toBe(100);
    expect(useThemeStore.getState().cropY).toBe(0);
  });

  it('hydrate reads persisted state with new format (cropX/cropY)', () => {
    localStorage.setItem(
      'lipi:theme:v1',
      JSON.stringify({
        themeId: 'quiet-valley',
        cropIndex: -1,
        cropX: 37,
        cropY: 62,
      }),
    );
    useThemeStore.getState().hydrate();
    expect(useThemeStore.getState().themeId).toBe('quiet-valley');
    expect(useThemeStore.getState().cropIndex).toBe(-1);
    expect(useThemeStore.getState().cropX).toBe(37);
    expect(useThemeStore.getState().cropY).toBe(62);
  });

  it('hydrate ignores malformed JSON', () => {
    localStorage.setItem('lipi:theme:v1', '{not valid json');
    useThemeStore.getState().hydrate();
    expect(useThemeStore.getState().themeId).toBe(DEFAULT_THEME_ID);
    expect(useThemeStore.getState().cropIndex).toBe(DEFAULT_CROP_INDEX);
    expect(useThemeStore.getState().cropX).toBe(50);
    expect(useThemeStore.getState().cropY).toBe(50);
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
    const stored = JSON.parse(localStorage.getItem('lipi:theme:v1')!);
    expect(stored.themeId).toBe('whispering-pines');
    expect(stored.cropIndex).toBe(DEFAULT_CROP_INDEX);
    expect(stored.cropX).toBe(50);
    expect(stored.cropY).toBe(50);
  });

  it('persists on setCropIndex after setupThemePersistence', () => {
    useThemeStore.getState().hydrate();
    setupThemePersistence();
    useThemeStore.getState().setCropIndex(7);
    const stored = JSON.parse(localStorage.getItem('lipi:theme:v1')!);
    expect(stored.themeId).toBe(DEFAULT_THEME_ID);
    expect(stored.cropIndex).toBe(7);
    expect(stored.cropX).toBe(50);
    expect(stored.cropY).toBe(100);
  });

  it('persists on setCropPosition after setupThemePersistence', () => {
    useThemeStore.getState().hydrate();
    setupThemePersistence();
    useThemeStore.getState().setCropPosition(25, 75);
    const stored = JSON.parse(localStorage.getItem('lipi:theme:v1')!);
    expect(stored.themeId).toBe(DEFAULT_THEME_ID);
    expect(stored.cropIndex).toBe(-1);
    expect(stored.cropX).toBe(25);
    expect(stored.cropY).toBe(75);
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

  it('selector returns cropX and cropY', () => {
    useThemeStore.getState().setCropPosition(25, 75);
    expect(themeSelectors.cropX(useThemeStore.getState())).toBe(25);
    expect(themeSelectors.cropY(useThemeStore.getState())).toBe(75);
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

  it('switching from preset to custom keeps correct state', () => {
    useThemeStore.getState().setCropIndex(5);
    expect(useThemeStore.getState().cropX).toBe(100);
    expect(useThemeStore.getState().cropY).toBe(50);
    useThemeStore.getState().setCropPosition(42, 88);
    expect(useThemeStore.getState().cropIndex).toBe(-1);
    expect(useThemeStore.getState().cropX).toBe(42);
    expect(useThemeStore.getState().cropY).toBe(88);
    useThemeStore.getState().setCropIndex(0);
    expect(useThemeStore.getState().cropX).toBe(0);
    expect(useThemeStore.getState().cropY).toBe(0);
    expect(useThemeStore.getState().cropIndex).toBe(0);
  });

  it('accepts the custom theme id', () => {
    useThemeStore.getState().setThemeId(CUSTOM_THEME_ID);
    expect(useThemeStore.getState().themeId).toBe(CUSTOM_THEME_ID);
  });

  it('setCustomImage saves data URL and switches to custom theme', () => {
    const dataUrl = 'data:image/jpeg;base64,/9j/4AAQtest';
    useThemeStore.getState().setCustomImage(dataUrl);
    expect(useThemeStore.getState().themeId).toBe(CUSTOM_THEME_ID);
    expect(useThemeStore.getState().customImageUrl).toBe(dataUrl);
    expect(useThemeStore.getState().cropIndex).toBe(DEFAULT_CROP_INDEX);
    expect(useThemeStore.getState().cropX).toBe(50);
    expect(useThemeStore.getState().cropY).toBe(50);
    expect(localStorage.getItem('lipi:theme:custom-image')).toBe(dataUrl);
  });

  it('clearCustomImage removes image and resets to default theme', () => {
    const dataUrl = 'data:image/jpeg;base64,/9j/4AAQtest';
    useThemeStore.getState().setCustomImage(dataUrl);
    expect(useThemeStore.getState().themeId).toBe(CUSTOM_THEME_ID);
    useThemeStore.getState().clearCustomImage();
    expect(useThemeStore.getState().themeId).toBe(DEFAULT_THEME_ID);
    expect(useThemeStore.getState().customImageUrl).toBeNull();
    expect(localStorage.getItem('lipi:theme:custom-image')).toBeNull();
  });

  it('hydrate loads custom image from localStorage', () => {
    const dataUrl = 'data:image/jpeg;base64,/9j/4AAQhydrate';
    localStorage.setItem('lipi:theme:custom-image', dataUrl);
    localStorage.setItem(
      'lipi:theme:v1',
      JSON.stringify({ themeId: CUSTOM_THEME_ID, cropIndex: DEFAULT_CROP_INDEX }),
    );
    useThemeStore.getState().hydrate();
    expect(useThemeStore.getState().customImageUrl).toBe(dataUrl);
    expect(useThemeStore.getState().themeId).toBe(CUSTOM_THEME_ID);
  });

  it('hydrate loads null custom image when no image is stored', () => {
    useThemeStore.getState().hydrate();
    expect(useThemeStore.getState().customImageUrl).toBeNull();
  });

  it('setCustomImage resets crop to center', () => {
    useThemeStore.getState().setCropIndex(7);
    const dataUrl = 'data:image/jpeg;base64,/9j/4AAQcrop';
    useThemeStore.getState().setCustomImage(dataUrl);
    expect(useThemeStore.getState().cropIndex).toBe(DEFAULT_CROP_INDEX);
    expect(useThemeStore.getState().cropX).toBe(50);
    expect(useThemeStore.getState().cropY).toBe(50);
  });

  it('selector returns customImageUrl', () => {
    expect(themeSelectors.customImageUrl(useThemeStore.getState())).toBeNull();
    const dataUrl = 'data:image/jpeg;base64,/9j/4AAQsel';
    useThemeStore.getState().setCustomImage(dataUrl);
    expect(themeSelectors.customImageUrl(useThemeStore.getState())).toBe(dataUrl);
  });
});
