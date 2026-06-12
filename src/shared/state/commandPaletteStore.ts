/**
 * commandPaletteStore — Zustand store for
 * the global `Cmd-Shift-P` /
 * `Ctrl-Shift-P` command palette.
 *
 * The palette is a cross-screen surface:
 * the EditorWorkspace, the Settings
 * screen, and the future Welcome screen
 * all need a launcher that can navigate
 * to any of them, plus a fast path to
 * common in-screen actions (clear chat,
 * cancel stream, toggle device emulator,
 * etc.).
 *
 * Per Rule 3 (screen-folder layout), this
 * store lives in `src/shared/state/`
 * because the keyboard shortcut is
 * mounted in `main.tsx` (above the
 * screen router) and the modal is also
 * mounted in `main.tsx`. The store is
 * the single hand-off point between the
 * two.
 *
 * The store holds only UI state — the
 * commands themselves are defined in a
 * separate `commands.ts` registry (data
 * + handlers, not state).
 */

import { create } from 'zustand';

interface CommandPaletteState {
  /** Whether the palette modal is open.
   * The modal is ALWAYS mounted in
   * `main.tsx`; this flag toggles
   * its visibility. Default `false`. */
  open: boolean;
  /**
   * The current search query. The
   * modal binds an `<input>` to this
   * field; the filter is computed in
   * the modal (it reads the command
   * registry at render time).
   */
  query: string;
  /**
   * The index of the currently
   * highlighted result. `0`-based.
   * Reset to `0` on every query
   * change so the user always starts
   * at the top of the filtered list
   * (a common pattern in launchers
   * like Spotlight / VS Code's
   * palette). Default `0`.
   */
  selectedIndex: number;
  /** Open the palette, clearing any
   * stale query and selection. The
   * keyboard handler calls this on
   * `Cmd-Shift-P`. */
  show: () => void;
  /** Close the palette. The modal
   * calls this on Escape, on backdrop
   * click, and after a command is
   * executed (palette is one-shot). */
  hide: () => void;
  /** Set the current search query.
   * Also resets `selectedIndex` to
   * `0` — see the field's JSDoc. */
  setQuery: (q: string) => void;
  /**
   * Move the highlight up or down.
   * The modal's keyboard handler
   * calls this on `ArrowUp` /
   * `ArrowDown`. The store clamps
   * the index into the
   * `[-1, length-1]` range — `-1`
   * is "no selection" (a
   * common pattern in macOS's
   * Spotlight when the user has
   * typed but no command matches;
   * the Enter key is then a no-op).
   * The store does NOT clamp to
   * the actual filtered list —
   * the modal does that, since the
   * store doesn't know the list
   * length (commands are external
   * data).
   */
  moveSelection: (delta: 1 | -1) => void;
  /**
   * Set the selection to a specific
   * index. Used when the user
   * hovers / focuses a row with
   * the mouse.
   */
  setSelection: (index: number) => void;
}

export const useCommandPaletteStore = create<CommandPaletteState>(
  (set) => ({
    open: false,
    query: '',
    selectedIndex: 0,
    show: () => set({ open: true, query: '', selectedIndex: 0 }),
    hide: () => set({ open: false }),
    setQuery: (q) => set({ query: q, selectedIndex: 0 }),
    moveSelection: (delta) =>
      set((s) => ({ selectedIndex: s.selectedIndex + delta })),
    setSelection: (index) => set({ selectedIndex: index }),
  }),
);

/** Selectors — keep these tiny so components can compose them. */
export const commandPaletteSelectors = {
  open: (s: CommandPaletteState) => s.open,
  query: (s: CommandPaletteState) => s.query,
  selectedIndex: (s: CommandPaletteState) => s.selectedIndex,
};
