/**
 * useVirtualKeyboard — translate `window.visualViewport`
 * changes into a `--keyboard-height` CSS variable.
 *
 * Phase M5. The on-screen keyboard on iOS / Android
 * doesn't fire a `window.resize` event in WebKit /
 * Chromium; the only reliable signal is the
 * `visualViewport.resize` and `visualViewport.scroll`
 * events. When the keyboard opens, `visualViewport.height`
 * shrinks (and `visualViewport.offsetTop` shifts to
 * account for the page being scrolled). We compute:
 *
 *   keyboardHeight = max(0, window.innerHeight - visualViewport.height)
 *
 * and write it to `document.documentElement.style.setProperty(
 *   '--keyboard-height', `${keyboardHeight}px`
 * )`. The `MobileShell`'s tab bar uses
 * `padding-bottom: calc(var(--safe-bottom) + var(--keyboard-height, 0px))`
 * so the tab bar rises above the keyboard instead of
 * being hidden under it.
 *
 * The hook is safe to call in any environment — if
 * `visualViewport` is undefined (old browsers, jsdom),
 * the effect no-ops. The CSS variable defaults to
 * `0px` in stylesheets so the desktop / non-mobile
 * layouts are unaffected.
 */
import { useEffect } from 'react';

/** Property name on `documentElement.style` for the
 *  computed keyboard height. Exported so CSS tests
 *  can assert the same name. */
export const KEYBOARD_HEIGHT_CSS_VAR = '--keyboard-height';

/** Pure: compute the keyboard height from the two
 *  viewport measurements. `Math.max(0, …)` defends
 *  against the rare case where the OS briefly
 *  reports `visualViewport.height > innerHeight`
 *  during an animation. */
export function computeKeyboardHeight(
  windowInnerHeight: number,
  visualViewportHeight: number,
): number {
  return Math.max(0, windowInnerHeight - visualViewportHeight);
}

/** Pure: write the keyboard height to the
 *  `documentElement`'s inline style. Returns the
 *  previous value so tests can assert the
 *  side-effect. */
export function applyKeyboardHeight(
  doc: Document,
  heightPx: number,
): string {
  const prev = doc.documentElement.style.getPropertyValue(KEYBOARD_HEIGHT_CSS_VAR);
  doc.documentElement.style.setProperty(
    KEYBOARD_HEIGHT_CSS_VAR,
    `${heightPx}px`,
  );
  return prev;
}

export function useVirtualKeyboard(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const viewport = window.visualViewport;
    if (!viewport) return;
    if (typeof document === 'undefined') return;

    const update = (): void => {
      const h = computeKeyboardHeight(window.innerHeight, viewport.height);
      applyKeyboardHeight(document, h);
    };

    // Set the initial value (in case the keyboard
    // was already up when the component mounted —
    // e.g. a deep-link cold-start into the editor
    // with a focused input).
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      // Reset to 0 on unmount so a re-mount in a
      // different part of the tree doesn't inherit a
      // stale keyboard height from the unmounted
      // sibling.
      applyKeyboardHeight(document, 0);
    };
  }, []);
}
