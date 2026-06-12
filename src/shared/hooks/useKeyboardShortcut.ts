/**
 * useKeyboardShortcut — bind a global keyboard combo to a handler.
 *
 * Phase 2c adds Ctrl+S to save. D5 will add Ctrl+K (inline edit),
 * Ctrl+Shift+P (command palette), and others. Every keybinding in
 * the app should go through this hook so they all use one
 * (configurable-in-future) keymap.
 *
 * Rule 4 (shared primitives): the hook lives in `src/shared/hooks/`
 * because every screen that has actions will want it.
 *
 * Matching is case-insensitive for the letter key, but exact for
 * modifiers. `meta` is Cmd on macOS and Ctrl on Win/Linux —
 * auto-detected via the platform. `ctrl` and `cmd` are explicit
 * aliases for "I mean the platform's primary modifier".
 */

import { useEffect } from 'react';

export interface ShortcutSpec {
  /** True if Ctrl should be held (Win/Linux Ctrl, or Cmd on macOS). */
  ctrl?: boolean;
  /** True if Cmd should be held (macOS Cmd, or Ctrl on Win/Linux).
   *  Use this OR `ctrl` — not both. */
  cmd?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** The non-modifier key, e.g. 's', 'S', 'Enter', 'ArrowRight'. */
  key: string;
}

export type ShortcutHandler = (event: KeyboardEvent) => void;

/** True when the user is on macOS. Lazy-eval so SSR doesn't break. */
function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad/.test(navigator.platform);
}

function isPrimaryHeld(spec: ShortcutSpec, e: KeyboardEvent): boolean {
  const mac = isMac();
  // Treat `ctrl` and `cmd` as synonyms for "the platform primary".
  const wantsPrimary = spec.ctrl || spec.cmd;
  if (!wantsPrimary) return !e.ctrlKey && !e.metaKey;
  return mac ? e.metaKey : e.ctrlKey;
}

function matches(spec: ShortcutSpec, e: KeyboardEvent): boolean {
  if (e.altKey !== !!spec.alt) return false;
  if (e.shiftKey !== !!spec.shift) return false;
  if (!isPrimaryHeld(spec, e)) return false;
  // Use `e.key` (handles "Enter", "ArrowRight", "?", etc.) and
  // compare case-insensitively for letter keys.
  if (e.key.toLowerCase() !== spec.key.toLowerCase()) return false;
  return true;
}

/**
 * Bind a handler to a shortcut while the component is mounted.
 * Pass `enabled: false` to temporarily disable without unmounting.
 */
export function useKeyboardShortcut(
  spec: ShortcutSpec,
  handler: ShortcutHandler,
  options: { enabled?: boolean } = {},
): void {
  const enabled = options.enabled !== false;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      // Don't fire while the user is typing in a text field — Monaco,
      // chat prompt, settings inputs all need to keep their own keys.
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      const isMonacoEditorSurface = !!t?.closest('.monaco-editor');
      // For Ctrl+S specifically, Monaco is the right context — we DO
      // want to save. So only skip non-Monaco text inputs.
      if (
        !isMonacoEditorSurface &&
        (tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable)
      ) {
        return;
      }
      if (matches(spec, e)) {
        e.preventDefault();
        handler(e);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [spec.alt, spec.shift, spec.ctrl, spec.cmd, spec.key, enabled, handler]);
}
