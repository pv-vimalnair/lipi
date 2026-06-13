/**
 * calloutSize — pure helper that
 * picks a sensible callout size
 * for a given step.
 *
 * Some steps have longer body
 * copy than others. The fixed
 * CALLOUT_DEFAULT_WIDTH ×
 * CALLOUT_DEFAULT_HEIGHT from
 * `placement.ts` is a 320×180
 * callout, which fits ~2 short
 * sentences. Steps with longer
 * body copy (the AI / voice step)
 * need a taller callout to avoid
 * clipping.
 *
 * The v1 rule is simple: if the
 * body is over 100 chars, bump
 * the height. A v2 polish could
 * measure with a hidden DOM
 * node, but the body lengths
 * are bounded by the
 * `tourSteps.test.ts`
 * `it('bodies are short (under
 * 200 chars)')` invariant, so
 * a simple char-count heuristic
 * is enough.
 */

import {
  CALLOUT_DEFAULT_HEIGHT,
  CALLOUT_DEFAULT_WIDTH,
} from './placement';
import type { TourStep } from './tourSteps';

const LONG_BODY_THRESHOLD = 100;
const LONG_BODY_HEIGHT = 220;
const VERY_LONG_BODY_THRESHOLD = 160;
const VERY_LONG_BODY_HEIGHT = 260;

export function computeCalloutSize(step: TourStep): {
  width: number;
  height: number;
} {
  const length = step.body.length;
  if (length >= VERY_LONG_BODY_THRESHOLD) {
    return { width: CALLOUT_DEFAULT_WIDTH, height: VERY_LONG_BODY_HEIGHT };
  }
  if (length >= LONG_BODY_THRESHOLD) {
    return { width: CALLOUT_DEFAULT_WIDTH, height: LONG_BODY_HEIGHT };
  }
  return {
    width: CALLOUT_DEFAULT_WIDTH,
    height: CALLOUT_DEFAULT_HEIGHT,
  };
}
