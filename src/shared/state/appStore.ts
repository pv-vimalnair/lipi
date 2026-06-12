/**
 * App-level navigation state.
 *
 * Per Rule 3 (screen-folder layout), this store lives
 * in `src/shared/state/` because multiple screens read
 * and write it — it's the only store that spans screens.
 *
 * The router in `main.tsx` consults TWO things to decide
 * what to render:
 * 1. `useWorkspaceStore.currentPath` — if `null`, the
 *    user hasn't opened a folder yet → show the Welcome
 *    screen. If non-null, the user is in the editor.
 * 2. `useAppStore.activeScreen` — the "overlay" on top:
 *    `editor` is the default; `settings` opens the AI
 *    provider config. The Welcome screen can also
 *    overlay settings (no folder open + click the ⚙).
 *
 * Per Rule 6 (section isolation), screens never import
 * each other directly. They communicate via this store.
 */

import { create } from 'zustand';

export type Screen = 'editor' | 'settings' | 'welcome';

interface AppState {
  activeScreen: Screen;
  setActiveScreen: (screen: Screen) => void;
}

export const useAppStore = create<AppState>((set) => ({
  activeScreen: 'welcome',
  setActiveScreen: (screen) => set({ activeScreen: screen }),
}));

/** Selectors — keep these tiny so components can compose them. */
export const appSelectors = {
  activeScreen: (s: AppState) => s.activeScreen,
};
