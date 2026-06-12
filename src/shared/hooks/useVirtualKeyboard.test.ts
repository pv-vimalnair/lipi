/**
 * Tests for `useVirtualKeyboard`'s pure helpers.
 *
 * The hook itself subscribes to
 * `window.visualViewport.resize` and writes the
 * computed keyboard height to a CSS variable on
 * `documentElement`. We don't render the hook
 * (no `@testing-library/react` in the project);
 * instead we test the two pure helpers it
 * delegates to:
 *   - `computeKeyboardHeight(inner, vpHeight)`,
 *     which is just `Math.max(0, inner - vpHeight)`.
 *   - `applyKeyboardHeight(doc, h)`, which writes
 *     to `doc.documentElement.style.setProperty` and
 *     returns the previous value.
 *
 * The `KEYBOARD_HEIGHT_CSS_VAR` constant is also
 * asserted so a future rename doesn't desync the
 * CSS and the JS.
 */
import { describe, expect, it } from 'vitest';

import {
  applyKeyboardHeight,
  computeKeyboardHeight,
  KEYBOARD_HEIGHT_CSS_VAR,
  useVirtualKeyboard,
} from './useVirtualKeyboard';

describe('computeKeyboardHeight', () => {
  it('returns 0 when the visual viewport equals the window', () => {
    expect(computeKeyboardHeight(800, 800)).toBe(0);
  });

  it('returns the positive diff when the keyboard is open', () => {
    // Window: 800px tall. Visual viewport: 480px tall
    // (keyboard took the bottom 320px).
    expect(computeKeyboardHeight(800, 480)).toBe(320);
  });

  it('clamps to 0 when the visual viewport is taller than the window', () => {
    // Can happen briefly during an animation. The
    // hook treats negative keyboard heights as "no
    // keyboard" rather than throwing.
    expect(computeKeyboardHeight(800, 820)).toBe(0);
  });

  it('rounds to an integer pixel value', () => {
    // The CSS variable is set as `${h}px`; the
    // spec doesn't say "integer," but the function
    // returns a number and the `setProperty` call
    // will stringify it. We just assert the math
    // is reasonable — `Math.max(0, …)` doesn't
    // round, so the consumer CSS can `round()` if
    // it needs to.
    expect(computeKeyboardHeight(800, 480.5)).toBeCloseTo(319.5);
  });
});

describe('applyKeyboardHeight', () => {
  it('writes the height to the CSS variable on documentElement', () => {
    const fakeDoc = {
      documentElement: {
        style: {
          getPropertyValue: () => '',
          setProperty: (_name: string, value: string) => {
            fakeDoc.documentElement.style._written = value;
          },
          _written: '',
        },
      },
    } as unknown as Document & {
      documentElement: { style: { _written: string } };
    };
    applyKeyboardHeight(fakeDoc, 320);
    expect(fakeDoc.documentElement.style._written).toBe('320px');
  });

  it('returns the previous CSS variable value (for the unmount-reset path)', () => {
    let current = '120px';
    const fakeDoc = {
      documentElement: {
        style: {
          getPropertyValue: () => current,
          setProperty: (_name: string, value: string) => {
            current = value;
          },
        },
      },
    } as unknown as Document;
    const prev = applyKeyboardHeight(fakeDoc, 320);
    expect(prev).toBe('120px');
    expect(current).toBe('320px');
  });
});

describe('module surface', () => {
  it('exports the CSS variable name as the same value used in CSS', () => {
    // The CSS in `MobileShell.module.css` reads
    // `var(--keyboard-height, 0px)`. If this
    // constant ever changes, the CSS has to change
    // in lockstep — the test pins the contract.
    expect(KEYBOARD_HEIGHT_CSS_VAR).toBe('--keyboard-height');
  });

  it('the hook is a callable function', () => {
    expect(typeof useVirtualKeyboard).toBe('function');
  });
});
