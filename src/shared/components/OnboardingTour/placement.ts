/**
 * placement — pure helpers that
 * compute where the tour callout
 * should be rendered given a
 * viewport, an anchor rect, and a
 * desired callout size.
 *
 * The helpers are pure (no DOM,
 * no React) so they can be unit-
 * tested in isolation. The
 * `OnboardingTour` component is a
 * thin wrapper that:
 *   1. reads the anchor's
 *      `getBoundingClientRect()`,
 *   2. calls these helpers,
 *   3. renders the result.
 *
 * Why a separate file (not in
 * tourSteps.ts): the step list is
 * declarative data (title, body,
 * target). The placement math is
 * algorithmic. Separating them
 * keeps the data file small and
 * the algorithm file focused.
 */

import type { TourPlacement } from './tourSteps';

/** Rectangle in viewport-relative
 *  coordinates (the same shape
 *  `DOMRect` has, but pure
 *  TypeScript so the helpers can
 *  be called without a browser). */
export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Viewport size, in CSS pixels. */
export interface Viewport {
  width: number;
  height: number;
}

/** Where the callout should be
 *  placed + its size. The
 *  `OnboardingTour` renders the
 *  callout at `(left, top)` with
 *  the given `width` and
 *  `height`. If `flipped` is
 *  `true`, the callout was placed
 *  on the OPPOSITE side of the
 *  anchor from the requested
 *  side (because the requested
 *  side would have clipped the
 *  viewport). The component uses
 *  this to render the arrow on
 *  the correct side. */
export interface CalloutLayout {
  top: number;
  left: number;
  width: number;
  height: number;
  /** The side the callout was
   *  ACTUALLY placed on. The
   *  component uses this to
   *  position the arrow
   *  correctly. */
  side: 'top' | 'bottom' | 'left' | 'right' | 'center';
  /** True when the requested
   *  side was flipped because
   *  the callout would have
   *  clipped the viewport. */
  flipped: boolean;
}

const CALLOUT_GAP_PX = 12;
/** How much padding the callout
 *  keeps from the viewport
 *  edge. Prevents the callout
 *  from sticking to the screen
 *  edge. */
const VIEWPORT_PADDING_PX = 16;
export const CALLOUT_DEFAULT_WIDTH = 320;
export const CALLOUT_DEFAULT_HEIGHT = 180;

/** Place a callout next to an
 *  anchored step.
 *
 *  The algorithm:
 *   1. Try the requested side.
 *   2. If the callout would clip
 *      the viewport, flip to the
 *      opposite side.
 *   3. If the opposite side
 *      ALSO clips, fall back to
 *      centering the callout.
 *
 *  Centering-on-fail is the
 *  right v1 behaviour: the user
 *  always sees the callout,
 *  even if the layout is
 *  awkward. A v2 polish could
 *  add more sophisticated
 *  placement (slide the callout
 *  to stay in viewport, etc.)
 *  but the v1 trade-off is
 *  "never lose the callout
 *  off-screen."
 */
export function computeAnchoredLayout(
  anchor: Rect,
  placement: Extract<TourPlacement, { kind: 'anchored' }>,
  viewport: Viewport,
  calloutSize: { width: number; height: number } = {
    width: CALLOUT_DEFAULT_WIDTH,
    height: CALLOUT_DEFAULT_HEIGHT,
  },
): CalloutLayout {
  const { width: cw, height: ch } = calloutSize;
  const result = placeOnSide(
    anchor,
    placement.side,
    cw,
    ch,
    viewport,
  );
  if (result === null) {
    const opposite = flipSide(placement.side);
    if (opposite === null) {
      return centerLayout(viewport, calloutSize);
    }
    const flipped = placeOnSide(anchor, opposite, cw, ch, viewport);
    if (flipped === null) {
      return centerLayout(viewport, calloutSize);
    }
    return {
      top: clampTop(flipped.top, ch, viewport.height),
      left: clampLeft(flipped.left, cw, viewport.width),
      width: cw,
      height: ch,
      side: opposite,
      flipped: true,
    };
  }
  return {
    top: clampTop(result.top, ch, viewport.height),
    left: clampLeft(result.left, cw, viewport.width),
    width: cw,
    height: ch,
    side: placement.side,
    flipped: false,
  };
}

/** Place a callout centered in
 *  the viewport (for steps with
 *  `placement.kind === 'center'`). */
export function computeCenterLayout(
  viewport: Viewport,
  calloutSize: { width: number; height: number } = {
    width: CALLOUT_DEFAULT_WIDTH,
    height: CALLOUT_DEFAULT_HEIGHT,
  },
): CalloutLayout {
  return centerLayout(viewport, calloutSize);
}

function placeOnSide(
  anchor: Rect,
  side: 'top' | 'bottom' | 'left' | 'right',
  calloutWidth: number,
  calloutHeight: number,
  viewport: Viewport,
): { top: number; left: number } | null {
  let top: number;
  let left: number;
  switch (side) {
    case 'top':
      top = anchor.top - calloutHeight - CALLOUT_GAP_PX;
      left = anchor.left + anchor.width / 2 - calloutWidth / 2;
      break;
    case 'bottom':
      top = anchor.top + anchor.height + CALLOUT_GAP_PX;
      left = anchor.left + anchor.width / 2 - calloutWidth / 2;
      break;
    case 'left':
      top = anchor.top + anchor.height / 2 - calloutHeight / 2;
      left = anchor.left - calloutWidth - CALLOUT_GAP_PX;
      break;
    case 'right':
      top = anchor.top + anchor.height / 2 - calloutHeight / 2;
      left = anchor.left + anchor.width + CALLOUT_GAP_PX;
      break;
  }
  return fitsInViewport(top, left, calloutWidth, calloutHeight, viewport)
    ? { top, left }
    : null;
}

function fitsInViewport(
  top: number,
  left: number,
  width: number,
  height: number,
  viewport: Viewport,
): boolean {
  // The check is "the rect would
  // be FULLY inside the viewport
  // with at least VIEWPORT_PADDING
  // pixels of margin on each
  // side." A side that fully
  // fits is preferred; a side
  // that would clip triggers a
  // flip.
  return (
    top >= VIEWPORT_PADDING_PX &&
    left >= VIEWPORT_PADDING_PX &&
    top + height <= viewport.height - VIEWPORT_PADDING_PX &&
    left + width <= viewport.width - VIEWPORT_PADDING_PX
  );
}

function clampTop(
  top: number,
  height: number,
  viewportHeight: number,
): number {
  const min = VIEWPORT_PADDING_PX;
  const max = Math.max(
    min,
    viewportHeight - height - VIEWPORT_PADDING_PX,
  );
  return Math.max(min, Math.min(max, top));
}

function clampLeft(
  left: number,
  width: number,
  viewportWidth: number,
): number {
  const min = VIEWPORT_PADDING_PX;
  const max = Math.max(
    min,
    viewportWidth - width - VIEWPORT_PADDING_PX,
  );
  return Math.max(min, Math.min(max, left));
}

function centerLayout(
  viewport: Viewport,
  calloutSize: { width: number; height: number },
): CalloutLayout {
  const top = clampTop(
    viewport.height / 2 - calloutSize.height / 2,
    calloutSize.height,
    viewport.height,
  );
  const left = clampLeft(
    viewport.width / 2 - calloutSize.width / 2,
    calloutSize.width,
    viewport.width,
  );
  return {
    top,
    left,
    width: calloutSize.width,
    height: calloutSize.height,
    side: 'center',
    flipped: false,
  };
}

function flipSide(
  side: 'top' | 'bottom' | 'left' | 'right',
): 'top' | 'bottom' | 'left' | 'right' | null {
  switch (side) {
    case 'top':
      return 'bottom';
    case 'bottom':
      return 'top';
    case 'left':
      return 'right';
    case 'right':
      return 'left';
  }
}

// Export the constants so the
// component and tests can read
// the same defaults.
export const ONBOARDING_TOUR_DEFAULTS = {
  CALLOUT_GAP_PX,
  VIEWPORT_PADDING_PX,
  CALLOUT_DEFAULT_WIDTH,
  CALLOUT_DEFAULT_HEIGHT,
} as const;
