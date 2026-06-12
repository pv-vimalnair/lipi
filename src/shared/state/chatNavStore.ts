/**
 * chatNavStore — the cross-screen
 * "jump from Activity Log to a
 * chat message" queue (5f).
 *
 * The Settings screen and the
 * EditorWorkspace (which hosts the
 * AIPanel) are different screens
 * with different mount cycles. We
 * can't pass props between them.
 * We can't use a `useEffect` on
 * mount to read a "current jump"
 * flag because the EditorWorkspace
 * is already mounted when the user
 * is on the Settings screen — the
 * jump would be ignored.
 *
 * The pattern: a tiny Zustand
 * store holding a `pendingJump`
 * record. The Settings screen
 * writes it (on row click); the
 * AIPanel reads it (on
 * `pendingJump` change). The
 * AIPanel is the ONLY consumer in
 * the EditorWorkspace — when it's
 * not mounted (no chat panel
 * visible), the jump sits in the
 * store waiting. When the AIPanel
 * mounts, its first `useEffect`
 * reads the current value and acts
 * on it.
 *
 * ## Expiry
 *
 * Jumps older than 30s are ignored.
 * This is a defense against a
 * far-stale jump causing a visual
 * flicker after a long idle (e.g.
 * the user backgrounded the tab,
 * came back, and a previous jump
 * from a different session is
 * still sitting in the store). The
 * `consumeJump()` action also
 * stamps a clear-on-read so a
 * stale jump never fires twice.
 *
 * ## Single in-flight jump
 *
 * The store holds at most ONE
 * `pendingJump` at a time. If the
 * user clicks two log rows in quick
 * succession, the second
 * overwrites the first. The first
 * jump is lost (we don't queue
 * them). This is fine for the
 * 5f use case — clicking two
 * rows in a row is an edge case
 * the user almost never hits, and
 * queuing would be over-engineering.
 *
 * ## Persistence
 *
 * NONE. The store is in-memory
 * only. A page reload clears any
 * pending jump (defensible: the
 * user reloads, the chat panel
 * re-mounts, the Activity Log
 * re-hydrates from localStorage,
 * the user can re-click). Adding
 * persistence here would be
 * over-engineering — a jump is a
 * transient intent, not a setting.
 */

import { create } from 'zustand';

/** Maximum age of a `pendingJump` that
 *  the AIPanel will honour. Older
 *  jumps are treated as stale and
 *  ignored. */
export const JUMP_MAX_AGE_MS = 30 * 1000;

/** A pending "scroll to this chat
 *  message and highlight the tool
 *  call" request. The Settings
 *  screen writes this on row
 *  click; the AIPanel consumes it
 *  via `consumeJump`. */
export interface PendingJump {
  /** The `id` of the assistant
   *  message to scroll to. */
  messageId: string;
  /** The `id` of the specific
   *  tool call to highlight
   *  within that message. (5b-6
   *  tool calls each have an
   *  `id`; the highlight target
   *  is the `ToolTrace` card
   *  for that call.) */
  toolCallId: string;
  /** Wall-clock time the jump
   *  was requested. The AIPanel
   *  checks `Date.now() -
   *  issuedAt` against
   *  `JUMP_MAX_AGE_MS` and
   *  ignores stale jumps. */
  issuedAt: number;
}

interface ChatNavState {
  pendingJump: PendingJump | null;

  /** Write a new pending jump.
   *  Overwrites any existing
   *  pending jump. */
  requestJump: (input: Omit<PendingJump, 'issuedAt'>) => void;

  /** Read the current pending
   *  jump AND clear it. Called by
   *  the AIPanel when it's about
   *  to act on the jump. The
   *  clear-on-read pattern
   *  prevents the same jump
   *  from firing twice (e.g. on
   *  re-mount). */
  consumeJump: () => PendingJump | null;

  /** Clear the pending jump
   *  WITHOUT reading it. Useful
   *  for tests and for the
   *  Settings screen to cancel a
   *  jump it just queued (if
   *  needed). */
  clearJump: () => void;
}

export const useChatNavStore = create<ChatNavState>((set, get) => ({
  pendingJump: null,

  requestJump: (input) => {
    set({
      pendingJump: {
        ...input,
        issuedAt: Date.now(),
      },
    });
  },

  consumeJump: () => {
    const current = get().pendingJump;
    set({ pendingJump: null });
    return current;
  },

  clearJump: () => {
    set({ pendingJump: null });
  },
}));

/** Selectors — keep these tiny so
 *  components can compose them. */
export const chatNavSelectors = {
  pendingJump: (s: ChatNavState) => s.pendingJump,
};
