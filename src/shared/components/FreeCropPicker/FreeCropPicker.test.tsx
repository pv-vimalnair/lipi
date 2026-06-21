/**
 * FreeCropPicker tests.
 *
 * Covers:
 *   - Basic rendering (viewport, presets, readout, reset)
 *   - Preset grid click calls onCropIndexChange
 *   - Reset button calls onReset
 *   - Keyboard arrow keys adjust cropX/cropY via onCropPositionChange
 *
 * Uses renderToStaticMarkup for pure-DOM rendering assertions
 * and a createRoot + act harness for interactive tests (same
 * convention as VoiceButton.test.tsx).
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { FreeCropPicker } from './FreeCropPicker';

const IMG = 'https://example.com/theme.jpg';

function makeProps(overrides: Partial<React.ComponentProps<typeof FreeCropPicker>> = {}) {
  return {
    themeImageUrl: IMG,
    cropX: 50,
    cropY: 50,
    activeCropIndex: 4,
    onCropPositionChange: vi.fn(),
    onCropIndexChange: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  };
}

describe('FreeCropPicker — rendering', () => {
  it('renders the picker wrapper', () => {
    const html = renderToStaticMarkup(<FreeCropPicker {...makeProps()} />);
    expect(html).toContain('data-testid="free-crop-picker"');
  });

  it('renders the preview area with the theme image', () => {
    const html = renderToStaticMarkup(<FreeCropPicker {...makeProps()} />);
    expect(html).toContain('data-testid="free-crop-preview"');
    expect(html).toContain(IMG);
  });

  it('renders the viewport with slider role', () => {
    const html = renderToStaticMarkup(<FreeCropPicker {...makeProps()} />);
    expect(html).toContain('data-testid="free-crop-viewport"');
    expect(html).toContain('role="slider"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="100"');
  });

  it('renders the position readout', () => {
    const html = renderToStaticMarkup(
      <FreeCropPicker {...makeProps({ cropX: 37, cropY: 62 })} />,
    );
    expect(html).toContain('data-testid="free-crop-readout"');
    expect(html).toContain('37%, 62%');
  });

  it('renders the reset button', () => {
    const html = renderToStaticMarkup(<FreeCropPicker {...makeProps()} />);
    expect(html).toContain('data-testid="free-crop-reset"');
  });

  it('renders all 9 preset buttons', () => {
    const html = renderToStaticMarkup(<FreeCropPicker {...makeProps()} />);
    expect(html).toContain('data-testid="free-crop-presets"');
    for (let i = 0; i < 9; i++) {
      expect(html).toContain(`data-testid="free-crop-preset-${i}"`);
    }
  });

  it('disables reset when already at center (50, 50)', () => {
    const html = renderToStaticMarkup(
      <FreeCropPicker {...makeProps({ cropX: 50, cropY: 50 })} />,
    );
    const resetBtn = html.match(
      /<button[^>]*data-testid="free-crop-reset"[^>]*>/,
    )?.[0] ?? '';
    expect(resetBtn).toContain('disabled');
  });

  it('enables reset when not at center', () => {
    const html = renderToStaticMarkup(
      <FreeCropPicker {...makeProps({ cropX: 30, cropY: 70 })} />,
    );
    const resetBtn = html.match(
      /<button[^>]*data-testid="free-crop-reset"[^>]*>/,
    )?.[0] ?? '';
    expect(resetBtn).not.toContain('disabled');
  });
});

describe('FreeCropPicker — interactions', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  function render(props: ReturnType<typeof makeProps>) {
    root = createRoot(container);
    act(() => {
      root.render(<FreeCropPicker {...props} />);
    });
    return props;
  }

  it('clicking a preset calls onCropIndexChange', () => {
    const props = render(makeProps());
    const preset = container.querySelector(
      '[data-testid="free-crop-preset-6"]',
    ) as HTMLButtonElement;
    expect(preset).not.toBeNull();
    act(() => {
      preset.click();
    });
    expect(props.onCropIndexChange).toHaveBeenCalledWith(6);
  });

  it('clicking the reset button calls onReset', () => {
    const props = render(makeProps({ cropX: 30, cropY: 70 }));
    const resetBtn = container.querySelector(
      '[data-testid="free-crop-reset"]',
    ) as HTMLButtonElement;
    expect(resetBtn).not.toBeNull();
    act(() => {
      resetBtn.click();
    });
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  it('ArrowRight key on viewport calls onCropPositionChange with increased x', () => {
    const props = render(makeProps({ cropX: 50, cropY: 50 }));
    const viewport = container.querySelector(
      '[data-testid="free-crop-viewport"]',
    ) as HTMLDivElement;
    expect(viewport).not.toBeNull();
    act(() => {
      viewport.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
    });
    expect(props.onCropPositionChange).toHaveBeenCalledWith(52, 50);
  });

  it('ArrowLeft key on viewport calls onCropPositionChange with decreased x', () => {
    const props = render(makeProps({ cropX: 50, cropY: 50 }));
    const viewport = container.querySelector(
      '[data-testid="free-crop-viewport"]',
    ) as HTMLDivElement;
    act(() => {
      viewport.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
      );
    });
    expect(props.onCropPositionChange).toHaveBeenCalledWith(48, 50);
  });

  it('ArrowDown key on viewport calls onCropPositionChange with increased y', () => {
    const props = render(makeProps({ cropX: 50, cropY: 50 }));
    const viewport = container.querySelector(
      '[data-testid="free-crop-viewport"]',
    ) as HTMLDivElement;
    act(() => {
      viewport.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      );
    });
    expect(props.onCropPositionChange).toHaveBeenCalledWith(50, 52);
  });

  it('ArrowUp key on viewport calls onCropPositionChange with decreased y', () => {
    const props = render(makeProps({ cropX: 50, cropY: 50 }));
    const viewport = container.querySelector(
      '[data-testid="free-crop-viewport"]',
    ) as HTMLDivElement;
    act(() => {
      viewport.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }),
      );
    });
    expect(props.onCropPositionChange).toHaveBeenCalledWith(50, 48);
  });

  it('Shift+ArrowRight uses a larger step (10)', () => {
    const props = render(makeProps({ cropX: 50, cropY: 50 }));
    const viewport = container.querySelector(
      '[data-testid="free-crop-viewport"]',
    ) as HTMLDivElement;
    act(() => {
      viewport.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowRight',
          shiftKey: true,
          bubbles: true,
        }),
      );
    });
    expect(props.onCropPositionChange).toHaveBeenCalledWith(60, 50);
  });

  it('arrow keys clamp to 0-100', () => {
    const props = render(makeProps({ cropX: 0, cropY: 100 }));
    const viewport = container.querySelector(
      '[data-testid="free-crop-viewport"]',
    ) as HTMLDivElement;
    act(() => {
      viewport.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
      );
      viewport.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      );
    });
    expect(props.onCropPositionChange).toHaveBeenCalledWith(0, 100);
  });
});
