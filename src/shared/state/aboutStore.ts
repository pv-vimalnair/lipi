/**
 * aboutStore — UI-state primitive for the F.5 About modal.
 *
 * Holds a single boolean `isOpen`. The About modal reads
 * it; the host (main.tsx) renders the modal unconditionally
 * with this flag as the `open` prop.
 *
 * Triggers (in priority order, the first one wins per open):
 *   1. Help > About menu item (F.4) — Rust emits a
 *      `lipi://menu` event with commandId `menu.help.about`.
 *      A listener in `useMenuEvents` calls `showAbout()`.
 *   2. Command Palette "Show about Lipi" entry (F.6) — its
 *      `run` action calls `showAbout()` directly.
 *   3. Any future surface (e.g. a footer link, a status-bar
 *      click target) that wants to open About.
 *
 * No persistence — `isOpen` resets to `false` on app
 * restart, which is the right behaviour (we don't want a
 * modal popping up the next time the user opens the app).
 *
 * No `data-testid` or hooks like `useShallow` here — the
 * store is one boolean and the modal subscribes with a
 * selector, so a re-render only fires on the actual flip.
 */

import { create } from 'zustand';

interface AboutState {
  isOpen: boolean;
  show: () => void;
  hide: () => void;
}

export const useAboutStore = create<AboutState>((set) => ({
  isOpen: false,
  show: () => set({ isOpen: true }),
  hide: () => set({ isOpen: false }),
}));

export const aboutSelectors = {
  isOpen: (s: AboutState) => s.isOpen,
  show: (s: AboutState) => s.show,
  hide: (s: AboutState) => s.hide,
};
