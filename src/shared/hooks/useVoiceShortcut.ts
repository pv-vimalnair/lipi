/**
 * useVoiceShortcut — M5 a11y.
 *
 * Global keyboard shortcut to toggle the
 * voice capture. The default binding is
 *   - macOS: Cmd+Shift+V
 *   - Windows / Linux: Ctrl+Shift+V
 *
 * The shortcut is intentionally a "global"
 * one (registered on `window`, not on the
 * Composer or a specific element) because:
 *   - the user may have focus anywhere
 *     (file tree, code editor, command
 *     palette, even outside Lipi if the
 *     WebView isn't focused — Tauri
 *     forwards `window` events from the
 *     OS-level keymap);
 *   - power users will hit the shortcut
 *     without first clicking the mic
 *     button;
 *   - screen-reader users navigating by
 *     keyboard have no other way to start
 *     a recording.
 *
 * Why we suppress the shortcut while
 * the user is typing in an editable
 * element (INPUT / TEXTAREA / contentEditable):
 *   - The shortcut is bound to
 *     Shift+Cmd/Ctrl+V. Browsers DO have
 *     a default "paste" binding on
 *     Ctrl/Cmd+V (without shift), but a
 *     user who hits Shift+Cmd+V in the
 *     textarea would expect either
 *     "paste with formatting" (Word-style)
 *     or "nothing". Triggering a mic
 *     capture in that context is
 *     surprising.
 *   - The Mic shortcut is a "global
 *     action" key, not an editing key —
 *     it should only fire when the user
 *     is NOT mid-typing. We detect the
 *     "mid-typing" state by checking
 *     `document.activeElement` against
 *     the standard editable roles.
 *
 * What we DO NOT do:
 *   - We don't override the existing
 *     Cmd+V / Ctrl+V paste binding.
 *   - We don't add a Settings toggle for
 *     the shortcut (M5 scope — the binding
 *     is fixed). Settings-driven keymap
 *     is a future M-phase.
 *   - We don't fire the shortcut when an
 *     IME composition is in progress
 *     (the `isComposing` flag on
 *     keyboard events). Hitting Cmd+V
 *     while typing a CJK character would
 *     otherwise trigger mid-composition.
 *
 * Test surface:
 *   - The hook is a pure event-listener
 *     over a `ref` of an imperative
 *     `start`/`stop` API. Tests fake the
 *     `keydown` event and assert the
 *     `start` / `stop` calls.
 *   - The "is the user typing?" check
 *     is a separate pure function
 *     (`isEditableElement`) — easier to
 *     unit-test in isolation.
 */

import { useEffect } from 'react';

/** The default binding: Shift + Meta (mac) /
 *  Control (others). Resolved at runtime so
 *  the same hook works on every platform. */
function shortcutMatches(event: KeyboardEvent): boolean {
  if (!event.shiftKey) return false;
  // Ignore key auto-repeat: a held Shift+Cmd+V
  // would fire repeatedly. We only want the
  // first press. `event.repeat` is the standard
  // flag.
  if (event.repeat) return false;
  // IME composition in progress — defer.
  if (event.isComposing) return false;
  // Some browsers emit `keyCode 86` (V) on the
  // synthetic KeyboardEvent; we match on `key`
  // (case-insensitive) because that's the modern
  // API and works in jsdom.
  if (event.key.toLowerCase() !== 'v') return false;
  const isMac =
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  if (isMac) {
    return event.metaKey && !event.ctrlKey && !event.altKey;
  }
  return event.ctrlKey && !event.metaKey && !event.altKey;
}

/** True if `event.target` is inside an
 *  editable element where the shortcut
 *  would be surprising. We check
 *  `tagName` (lowercased) and the
 *  `isContentEditable` property, which
 *  is the standard for rich-text editors
 *  (Monaco, Slate, etc.).
 *
 *  Why we DON'T treat <select> as
 *  editable: a select dropdown is not a
 *  text-typing context — the user is
 *  navigating options with arrow keys,
 *  not typing. The voice shortcut is
 *  meant for "I'm about to speak into
 *  the editor" gestures; pressing it
 *  while a select is open would be
 *  surprising in a different way.
 */
export function isEditableElement(
  target: EventTarget | null,
): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'textarea') return true;
  if (tag === 'input') {
    // For <input>, only the text-like
    // types count as "editable". A
    // checkbox or button shouldn't
    // suppress the shortcut.
    const type = (target as HTMLInputElement).type.toLowerCase();
    return (
      type === 'text' ||
      type === 'search' ||
      type === 'email' ||
      type === 'password' ||
      type === 'tel' ||
      type === 'url' ||
      type === '' // <input> with no type defaults to text
    );
  }
  // The standard `isContentEditable` property
  // is a DOM getter that returns true for any
  // element where the `contenteditable` attribute
  // is set to a truthy value. In jsdom v29 the
  // getter is unimplemented (returns undefined),
  // so we fall back to checking the IDL property
  // directly: `target.contentEditable === 'true'`
  // covers the common case. The "inherit" value
  // is treated as non-editable for our purposes —
  // a user who hasn't explicitly opted in to
  // editing shouldn't have the shortcut
  // suppressed.
  if (target.isContentEditable) return true;
  if (typeof target.contentEditable === 'string') {
    const ce = target.contentEditable.toLowerCase();
    if (ce === 'true' || ce === 'plaintext-only' || ce === 'caret') {
      return true;
    }
  }
  return false;
}

export interface UseVoiceShortcutOptions {
  /** Imperative API to invoke. The hook
   *  calls `start()` if the voice is
   *  currently idle / errored, or
   *  `stop()` if it's recording /
   *  requesting. The API is what
   *  `useVoiceCapture()` returns. */
  start: () => Promise<void> | void;
  stop: () => Promise<void> | void;
  /** Current status, used to decide
   *  start vs. stop. The same shape as
   *  `voiceStore.status`. */
  status: 'idle' | 'requesting' | 'recording' | 'transcribing' | 'error';
  /** Disable the shortcut entirely
   *  (e.g. when the AI provider isn't
   *  configured and there's no point
   *  starting a recording). The
   *  Composer wires this to its own
   *  `disabled` prop. */
  enabled?: boolean;
}

export function useVoiceShortcut({
  start,
  stop,
  status,
  enabled = true,
}: UseVoiceShortcutOptions): void {
  useEffect(() => {
    if (!enabled) return;

    const handler = (event: KeyboardEvent) => {
      if (!shortcutMatches(event)) return;
      // Don't fire while the user is
      // mid-typing — would be surprising
      // and could break their paste flow.
      if (isEditableElement(event.target)) return;
      // We've decided to handle the key —
      // prevent the browser's default so
      // we don't also trigger a paste or
      // a menu.
      event.preventDefault();
      event.stopPropagation();
      if (status === 'recording' || status === 'requesting') {
        void stop();
      } else if (status === 'idle' || status === 'error') {
        // 'transcribing' is a no-op — the
        // hook is busy. Re-pressing the
        // shortcut during transcribing
        // should NOT abort the WS — the
        // user has to wait for the
        // transcript.
        void start();
      }
    };

    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
    };
  }, [enabled, status, start, stop]);
}
