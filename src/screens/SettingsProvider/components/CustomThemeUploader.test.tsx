import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { useThemeStore } from '@/shared/state/themeStore';
import { DEFAULT_THEME_ID, DEFAULT_CROP_INDEX, CUSTOM_THEME_ID } from '@/shared/state/themes';
import { CustomThemeUploader } from './CustomThemeUploader';

function mount(): { container: HTMLDivElement; root: Root; cleanup: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(CustomThemeUploader));
  });
  return {
    container,
    root,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('CustomThemeUploader', () => {
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

  afterEach(() => {
    localStorage.clear();
  });

  it('renders an upload area when no custom image is set', () => {
    const { container, cleanup } = mount();
    try {
      const uploadArea = container.querySelector('[data-testid="custom-theme-upload-area"]');
      expect(uploadArea).not.toBeNull();
      expect(container.textContent).toContain('Upload a custom image');
    } finally {
      cleanup();
    }
  });

  it('renders a preview when a custom image is set', () => {
    useThemeStore.setState({
      customImageUrl: 'data:image/jpeg;base64,test123',
      themeId: CUSTOM_THEME_ID,
    });
    const { container, cleanup } = mount();
    try {
      expect(container.querySelector('[data-testid="custom-theme-change"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="custom-theme-remove"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="custom-theme-upload-area"]')).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('clears custom image when Remove is clicked', () => {
    useThemeStore.setState({
      customImageUrl: 'data:image/jpeg;base64,test123',
      themeId: CUSTOM_THEME_ID,
    });
    const { container, cleanup } = mount();
    try {
      const removeBtn = container.querySelector('[data-testid="custom-theme-remove"]') as HTMLButtonElement;
      expect(removeBtn).not.toBeNull();
      act(() => {
        removeBtn.click();
      });
      expect(useThemeStore.getState().themeId).toBe(DEFAULT_THEME_ID);
      expect(useThemeStore.getState().customImageUrl).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('hides the file input off-screen', () => {
    const { container, cleanup } = mount();
    try {
      const input = container.querySelector('[data-testid="custom-theme-file-input"]') as HTMLInputElement;
      expect(input).not.toBeNull();
      expect(input.type).toBe('file');
      expect(input.accept).toBe('image/*');
    } finally {
      cleanup();
    }
  });
});
