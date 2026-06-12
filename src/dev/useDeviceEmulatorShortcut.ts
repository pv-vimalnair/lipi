/**
 * useDeviceEmulatorShortcutWhenDev —
 * bind `Cmd-Shift-D` /
 * `Ctrl-Shift-D` to the device
 * emulator toggle (M1).
 *
 * The hook is a no-op when
 * `isDev` is `false`. The
 * editor workspace always
 * calls this hook (React's
 * rule of hooks — every
 * call must be at the
 * top level, never inside
 * an `if`); the gating
 * lives INSIDE the effect,
 * so the listener is never
 * registered in a prod
 * build.
 *
 * `D` is the convention for
 * "Developer" (Chrome
 * DevTools uses `Cmd-Shift-I`
 * to open DevTools;
 * `Cmd-Shift-D` mirrors that
 * "show developer overlay"
 * intent).
 *
 * We don't guard against
 * conflicts with Monaco's
 * own shortcuts — Monaco
 * doesn't bind `Shift-D` to
 * anything by default, and
 * a future conflict can be
 * resolved by a modifier
 * (e.g. `Cmd-Shift-Alt-D`).
 */

import { useEffect } from 'react';
import { useDeviceEmulatorStore } from './state/deviceEmulatorStore';

const IS_MAC =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(navigator.platform);

export function useDeviceEmulatorShortcutWhenDev(isDev: boolean): void {
  const toggle = useDeviceEmulatorStore((s) => s.toggle);

  useEffect(() => {
    // Production no-op:
    // never register the
    // listener. Saves a
    // global keydown
    // handler in the
    // prod bundle.
    if (!isDev) return;

    function onKeyDown(e: KeyboardEvent): void {
      // The primary
      // modifier: Cmd on
      // macOS, Ctrl on
      // Win/Linux.
      const primary = IS_MAC ? e.metaKey : e.ctrlKey;
      // Reject if the
      // wrong-platform
      // primary is held.
      if (!primary) return;
      // Shift is required
      // (matches the
      // "devtools-style"
      // `Cmd-Shift-X`
      // convention).
      if (!e.shiftKey) return;
      // The non-modifier
      // key (case-
      // insensitive).
      if (e.key.toLowerCase() !== 'd') return;
      e.preventDefault();
      toggle();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isDev, toggle]);
}
