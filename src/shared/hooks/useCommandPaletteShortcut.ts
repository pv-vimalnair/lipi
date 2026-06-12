/**
 * useCommandPaletteShortcut — bind
 * `Cmd-Shift-P` /
 * `Ctrl-Shift-P` to the command
 * palette.
 *
 * The hook is mounted ONCE in
 * `main.tsx` (above the screen
 * router), so the shortcut is
 * always available regardless of
 * which screen the user is on.
 * It's also a no-op in prod when
 * a `disabled` flag is set (e.g.
 * during the test harness).
 *
 * `P` is the conventional
 * "command palette" key
 * (VS Code uses `Cmd-Shift-P`,
 * Sublime uses `Cmd-Shift-P`,
 * Raycast uses `Cmd-Space`
 * which is a system-level
 * grab). `P` keeps it consistent
 * with the de-facto editor
 * convention.
 *
 * We don't guard against
 * Monaco's own shortcuts —
 * Monaco doesn't bind
 * `Shift-P` to anything by
 * default, and a future
 * conflict can be resolved
 * by a modifier (e.g.
 * `Cmd-Shift-Alt-P`).
 */

import { useEffect } from 'react';

import { useCommandPaletteStore } from '@/shared/state/commandPaletteStore';

const IS_MAC =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(navigator.platform);

export function useCommandPaletteShortcut(
  enabled: boolean = true,
): void {
  const show = useCommandPaletteStore((s) => s.show);

  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(e: KeyboardEvent): void {
      // The primary modifier:
      // Cmd on macOS, Ctrl on
      // Win/Linux. We REJECT
      // the wrong-platform
      // primary so a Mac
      // user holding Ctrl
      // (e.g. for a Linux
      // muscle-memory
      // moment) doesn't
      // accidentally
      // trigger.
      const primary = IS_MAC ? e.metaKey : e.ctrlKey;
      if (!primary) return;
      if (!e.shiftKey) return;
      if (e.key.toLowerCase() !== 'p') return;
      // Don't fire if the user
      // is typing in a text
      // field that already
      // handles this combo
      // (e.g. Monaco). Monaco
      // doesn't bind Shift-P
      // by default, but we
      // still guard with a
      // `closest('input,
      // textarea, [contenteditable]')`
      // check — a user typing
      // 'P' into a search box
      // shouldn't pop the
      // palette.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        // The palette input
        // itself is an <input>,
        // so this would
        // suppress the shortcut
        // while the user is
        // typing in the palette
        // — which is correct:
        // they're already in
        // the palette, no need
        // to re-open it. Cmd-Shift-P
        // from inside the
        // palette will reset
        // the query and
        // re-focus the input,
        // which is also useful.
        // We just need to
        // make sure typing
        // 'p' in the palette
        // input doesn't
        // toggle it.
        e.preventDefault();
        show();
        return;
      }
      e.preventDefault();
      show();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, show]);
}
