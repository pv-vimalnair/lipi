/**
 * deviceEmulatorStore — the dev-only
 * "show the mobile device
 * emulator" toggle (M1).
 *
 * Mounted only on `import.meta.env.DEV`
 * builds (the wrapping component
 * gates on `isDev` before
 * rendering). When `enabled` is
 * true, the `DeviceEmulator`
 * component renders a row of 8
 * scaled-down `MobileShell` instances
 * inside CSS device frames
 * (notch + home indicator + corner
 * radius), so the dev can see
 * how the layout holds up across
 * the top phones / tablets without
 * leaving the desktop dev
 * environment.
 *
 * ## Why sessionStorage
 *
 * The toggle is dev-only and
 * session-scoped: a page reload
 * is treated as "start of new
 * debug session" and the
 * emulator stays enabled if it
 * was enabled at the end of
 * the previous session. We use
 * `sessionStorage` (not
 * `localStorage`) for two
 * reasons:
 *
 *   1. `localStorage` is per-
 *      origin and survives
 *      forever — a stale
 *      "enabled" flag from a
 *      past debugging session
 *      would surprise the dev
 *      next time they open the
 *      app for non-emulator
 *      work.
 *   2. `sessionStorage` is per-
 *      tab and per-session — a
 *      new browser window /
 *      tab is a clean slate.
 *      A `Cmd-Shift-D` in the
 *      new tab follows the
 *      expected "I want the
 *      emulator off" path
 *      (toggle it back on
 *      explicitly).
 *
 * In-memory state is the
 * canonical source. We mirror
 * to sessionStorage on every
 * `setEnabled` and hydrate
 * from sessionStorage on
 * first read.
 *
 * ## Why a single `enabled` flag
 *   (not a `selectedDeviceId`)
 *
 * The 5d-era plan called for a
 * "preview many devices at
 * once" emulator (the current
 * `DeviceEmulator` renders all
 * 8 side-by-side). That's the
 * right design for the
 * "compare layout" use case
 * (a dev wants to see if a
 * change breaks iPhone SE
 * AND Galaxy S24 — they
 * shouldn't have to pick one
 * to check). M1 keeps the
 * "all 8 at once" model. A
 * future "single-device zoom"
 * is a small additive change
 * — add a `selectedDeviceId`
 * field, render the
 * single-device view at a
 * larger scale, and a "back
 * to compare" button.
 */

import { create } from 'zustand';

const SESSION_KEY = 'lipi:dev:deviceEmulator:v1';

interface DeviceEmulatorState {
  enabled: boolean;
  hydrated: boolean;

  setEnabled: (next: boolean) => void;
  toggle: () => void;
  hydrate: () => void;
}

function readSession(): boolean | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw === '1') return true;
    if (raw === '0') return false;
    return null;
  } catch {
    return null;
  }
}

function writeSession(enabled: boolean): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(SESSION_KEY, enabled ? '1' : '0');
  } catch {
    // Quota / private-mode
    // failures are
    // non-fatal — the
    // in-memory state
    // still works; the
    // setting just
    // doesn't survive a
    // reload.
  }
}

export const useDeviceEmulatorStore = create<DeviceEmulatorState>(
  (set, get) => ({
    enabled: false,
    hydrated: false,

    setEnabled: (next) => {
      writeSession(next);
      set({ enabled: next });
    },

    toggle: () => {
      const next = !get().enabled;
      writeSession(next);
      set({ enabled: next });
    },

    hydrate: () => {
      if (get().hydrated) return;
      const stored = readSession();
      // Default to `false` (off)
      // when nothing is
      // stored. The dev has
      // to opt in.
      set({
        enabled: stored ?? false,
        hydrated: true,
      });
    },
  }),
);

export const deviceEmulatorSelectors = {
  enabled: (s: DeviceEmulatorState) => s.enabled,
  hydrated: (s: DeviceEmulatorState) => s.hydrated,
};
