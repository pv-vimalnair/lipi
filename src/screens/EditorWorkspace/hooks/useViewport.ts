import { useEffect, useState } from 'react';

/**
 * Viewport bucket. Mirrors the breakpoints in `src/shared/styles/tokens.css`:
 *   - `mobile`:  width <= 480px   (phones in portrait)
 *   - `tablet`:  width <= 900px   (phones landscape, small tablets)
 *   - `desktop`: everything else  (laptops, desktops, large tablets in landscape)
 *
 * Hooks into `window.matchMedia` so it does NOT cause a render storm on every
 * resize — only on actual breakpoint crossings.
 */
export type Viewport = 'mobile' | 'tablet' | 'desktop';

const MOBILE_MAX = 480;
const TABLET_MAX = 900;

function bucketFor(width: number): Viewport {
  if (width <= MOBILE_MAX) return 'mobile';
  if (width <= TABLET_MAX) return 'tablet';
  return 'desktop';
}

function readViewport(): Viewport {
  if (typeof window === 'undefined') return 'desktop';
  return bucketFor(window.innerWidth);
}

export function useViewport(): Viewport {
  const [viewport, setViewport] = useState<Viewport>(readViewport);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(`(max-width: ${MOBILE_MAX}px), (max-width: ${TABLET_MAX}px)`);
    const handler = () => setViewport(readViewport());
    handler();
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return viewport;
}

/** Convenience predicate for "is this a phone-class device". */
export function isMobile(v: Viewport): boolean {
  return v === 'mobile';
}
