/**
 * useHaptics — fire a haptic pulse at a chosen intensity.
 *
 * Phase M5. Three helpers exposed:
 *   - `light()`  — tab switches, subtle confirmations
 *   - `medium()` — voice start, commit, save
 *   - `heavy()`  — destructive actions (delete, discard)
 *
 * The hook is just a stable callback wrapper over
 * the `@/ipc/haptics` `haptic(intensity)` call. We
 * don't expose a `haptic(i)` directly because the UI
 * should pick a semantic intensity, not a raw one —
 * if a future "ultra" intensity lands, every callsite
 * that picked the right semantic will keep working.
 *
 * Calls are fire-and-forget. A failed IPC call
 * (e.g. the desktop build that somehow doesn't have
 * the command) is swallowed with a one-time console
 * warning; the UI should never block on a haptic.
 */

import { useCallback } from 'react';

import { haptic, type HapticIntensity } from '@/ipc';
import { logger } from '@/shared/logger';

let warned = false;

/** Pure: fire one haptic pulse. Exported for the
 *  test file so the catch-and-warn logic is
 *  testable without rendering a React tree. The
 *  one-shot warning is module-scoped state (it
 *  resets when the module is unloaded, e.g. on
 *  test re-run). */
export async function fireHaptic(intensity: HapticIntensity): Promise<void> {
  try {
    await haptic(intensity);
  } catch (e) {
    if (!warned) {
      logger.warn('useHaptics: haptic IPC unavailable; future calls will be silent', e);
      warned = true;
    }
  }
}

export interface UseHapticsResult {
  light: () => void;
  medium: () => void;
  heavy: () => void;
}

export function useHaptics(): UseHapticsResult {
  const light = useCallback(() => {
    void fireHaptic('light');
  }, []);
  const medium = useCallback(() => {
    void fireHaptic('medium');
  }, []);
  const heavy = useCallback(() => {
    void fireHaptic('heavy');
  }, []);
  return { light, medium, heavy };
}
