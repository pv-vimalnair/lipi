/**
 * useOpenFolderShortcut —
 * bind `Cmd-Shift-O` /
 * `Ctrl-Shift-O` to the
 * workspace opener.
 *
 * The hook is mounted ONCE
 * in `main.tsx` (alongside
 * the command-palette
 * shortcut hook), so the
 * shortcut is always
 * available regardless of
 * which screen the user is
 * on.
 *
 * The shortcut is the same
 * one bound to the
 * "Open Folder…" command
 * in the command palette
 * (registry entry
 * `workspace.open`). The
 * shortcut hint in the
 * palette row matches
 * what the hook binds.
 *
 * Why a dedicated hook
 * instead of running
 * everything through the
 * palette? Two reasons:
 *
 * 1. The picker is a
 *    native dialog. It's
 *    most ergonomic as a
 *    one-shot shortcut —
 *    "press O, pick
 *    folder, done". The
 *    palette adds an
 *    extra keystroke and a
 *    modal in the middle.
 * 2. The palette
 *    modal would
 *    be visible
 *    behind the
 *    native
 *    picker,
 *    which is
 *    ugly. A
 *    dedicated
 *    shortcut
 *    skips the
 *    palette
 *    entirely.
 *
 * We REJECT the
 * wrong-platform primary
 * (the same logic as
 * `useCommandPaletteShortcut`).
 * Monaco doesn't bind
 * `Shift-O` to anything
 * by default; a future
 * conflict can be
 * resolved with a
 * different modifier.
 */

import { useEffect } from 'react';

import { openWorkspace } from '@/screens/Welcome';

const IS_MAC =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(navigator.platform);

export function useOpenFolderShortcut(enabled: boolean = true): void {
  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(e: KeyboardEvent): void {
      const primary = IS_MAC ? e.metaKey : e.ctrlKey;
      if (!primary) return;
      if (!e.shiftKey) return;
      // `e.code === 'KeyO'` is
      // more reliable than
      // `e.key === 'o'`
      // because it
      // ignores the
      // user's keyboard
      // layout (a
      // Dvorak user
      // pressing the
      // physical O
      // key still
      // triggers this).
      if (e.code !== 'KeyO') return;
      // Suppress the
      // shortcut if the
      // user is
      // actively typing
      // in an input /
      // textarea /
      // contenteditable
      // (e.g. a search
      // box).
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      // The picker is async;
      // we fire-and-forget.
      void openWorkspace();
    }
    window.addEventListener('keydown', onKeyDown);
    return () =>
      window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
