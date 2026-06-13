/**
 * Tests for the pure placement
 * helpers in `placement.ts`.
 * These are the algorithmic core
 * of the tour callout positioning.
 */

import { describe, expect, it } from 'vitest';

import {
  ONBOARDING_TOUR_DEFAULTS,
  type Rect,
  type Viewport,
  computeAnchoredLayout,
  computeCenterLayout,
} from './placement';

const VIEWPORT_1080P: Viewport = { width: 1920, height: 1080 };

function rect(
  top: number,
  left: number,
  width: number,
  height: number,
): Rect {
  return { top, left, width, height };
}

describe('computeAnchoredLayout — right side', () => {
  it('places the callout to the right of a centered anchor', () => {
    const anchor = rect(400, 800, 200, 100);
    const layout = computeAnchoredLayout(
      anchor,
      { kind: 'anchored', target: 'foo', side: 'right' },
      VIEWPORT_1080P,
    );
    // Right of anchor + gap.
    expect(layout.left).toBe(
      anchor.left + anchor.width + ONBOARDING_TOUR_DEFAULTS.CALLOUT_GAP_PX,
    );
    // Vertically centered on the anchor.
    expect(layout.top).toBe(
      anchor.top + anchor.height / 2 - layout.height / 2,
    );
    expect(layout.side).toBe('right');
    expect(layout.flipped).toBe(false);
  });
});

describe('computeAnchoredLayout — left side', () => {
  it('places the callout to the left of a centered anchor', () => {
    const anchor = rect(400, 800, 200, 100);
    const layout = computeAnchoredLayout(
      anchor,
      { kind: 'anchored', target: 'foo', side: 'left' },
      VIEWPORT_1080P,
    );
    // Left of anchor - callout width - gap.
    expect(layout.left).toBe(
      anchor.left - layout.width - ONBOARDING_TOUR_DEFAULTS.CALLOUT_GAP_PX,
    );
    expect(layout.side).toBe('left');
    expect(layout.flipped).toBe(false);
  });
});

describe('computeAnchoredLayout — top side', () => {
  it('places the callout above the anchor', () => {
    const anchor = rect(400, 800, 200, 100);
    const layout = computeAnchoredLayout(
      anchor,
      { kind: 'anchored', target: 'foo', side: 'top' },
      VIEWPORT_1080P,
    );
    // Above anchor - callout height - gap.
    expect(layout.top).toBe(
      anchor.top - layout.height - ONBOARDING_TOUR_DEFAULTS.CALLOUT_GAP_PX,
    );
    // Horizontally centered on the anchor.
    expect(layout.left).toBe(
      anchor.left + anchor.width / 2 - layout.width / 2,
    );
    expect(layout.side).toBe('top');
    expect(layout.flipped).toBe(false);
  });
});

describe('computeAnchoredLayout — bottom side', () => {
  it('places the callout below the anchor', () => {
    const anchor = rect(400, 800, 200, 100);
    const layout = computeAnchoredLayout(
      anchor,
      { kind: 'anchored', target: 'foo', side: 'bottom' },
      VIEWPORT_1080P,
    );
    // Below anchor + height + gap.
    expect(layout.top).toBe(
      anchor.top + anchor.height + ONBOARDING_TOUR_DEFAULTS.CALLOUT_GAP_PX,
    );
    expect(layout.side).toBe('bottom');
    expect(layout.flipped).toBe(false);
  });
});

describe('computeAnchoredLayout — flip on viewport clip', () => {
  it('flips to the opposite side when the requested side would clip', () => {
    // Anchor near the top of the
    // viewport, far to the right
    // (so the centered "top" callout
    // would clip the top). The flip
    // goes to "bottom" which is
    // clear.
    const anchor = rect(20, 1500, 200, 50);
    const layout = computeAnchoredLayout(
      anchor,
      { kind: 'anchored', target: 'foo', side: 'top' },
      VIEWPORT_1080P,
    );
    expect(layout.side).toBe('bottom');
    expect(layout.flipped).toBe(true);
  });

  it('falls back to centered layout when both sides would clip', () => {
    // A huge anchor that
    // dominates the viewport.
    // Placing next to it on any
    // side would clip; the
    // fallback is centered.
    const anchor = rect(0, 0, 1920, 1080);
    const layout = computeAnchoredLayout(
      anchor,
      { kind: 'anchored', target: 'foo', side: 'right' },
      VIEWPORT_1080P,
    );
    expect(layout.side).toBe('center');
    expect(layout.flipped).toBe(false);
  });
});

describe('computeCenterLayout', () => {
  it('centers the callout in the viewport', () => {
    const layout = computeCenterLayout(VIEWPORT_1080P);
    expect(layout.top).toBe(
      VIEWPORT_1080P.height / 2 - layout.height / 2,
    );
    expect(layout.left).toBe(
      VIEWPORT_1080P.width / 2 - layout.width / 2,
    );
    expect(layout.side).toBe('center');
    expect(layout.flipped).toBe(false);
  });

  it('uses a custom callout size when provided', () => {
    const layout = computeCenterLayout(VIEWPORT_1080P, {
      width: 200,
      height: 100,
    });
    expect(layout.width).toBe(200);
    expect(layout.height).toBe(100);
    expect(layout.top).toBe(VIEWPORT_1080P.height / 2 - 50);
    expect(layout.left).toBe(VIEWPORT_1080P.width / 2 - 100);
  });
});

describe('clamping (padding from viewport edges)', () => {
  it('clamps the callout within the viewport when the math overflows', () => {
    // Anchor with a left
    // position that would push
    // the centered "right" callout
    // off the right edge.
    const anchor = rect(400, 1900, 10, 10);
    const layout = computeAnchoredLayout(
      anchor,
      { kind: 'anchored', target: 'foo', side: 'right' },
      VIEWPORT_1080P,
    );
    // The callout must not
    // overflow the viewport's
    // right edge (minus padding).
    expect(
      layout.left + layout.width,
    ).toBeLessThanOrEqual(
      VIEWPORT_1080P.width - ONBOARDING_TOUR_DEFAULTS.VIEWPORT_PADDING_PX,
    );
  });
});
