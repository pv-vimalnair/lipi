/**
 * tourSteps — the declarative list of
 * onboarding-tour steps + the pure
 * helpers that decide whether the
 * tour should auto-start on launch.
 *
 * This file is the single source of
 * truth for:
 *   - the step list (order, copy,
 *     anchor selectors)
 *   - the "should the tour auto-start
 *     on this launch?" gate
 *
 * Why this is a separate file:
 *   - The `tourStore` is a dumb step
 *     machine. It doesn't know what
 *     the steps ARE, just how to
 *     advance the cursor. Keeping
 *     the step list out of the
 *     store means a new step is
 *     one entry here, not a store
 *     refactor.
 *   - The gate function is a pure
 *     function (decides from
 *     inputs), so it can be tested
 *     without a store. The same
 *     gate is used by the AppRoot
 *     to decide whether to call
 *     `tourStore.start()` after
 *     hydration.
 *
 * Anchor convention:
 *   - Each step names a
 *     `data-tour-target="<id>"`
 *     attribute on the DOM node
 *     the callout should point at.
 *   - The `center` placement means
 *     "no anchor — render a centered
 *     modal-style callout" (used
 *     for the intro / outro steps
 *     that don't highlight a
 *     specific UI element).
 *
 * Adding a step:
 *   1. Add a `data-tour-target="<id>"`
 *      to the target DOM node in the
 *      relevant screen.
 *   2. Add a `TourStep` entry to
 *      `TOUR_STEPS` below.
 *   3. The store and the overlay
 *      pick up the new step
 *      automatically.
 */

// (M6a: `useActivePath` is no
// longer needed here — the
// gate takes a precomputed
// `currentPath`.)

/** Where the callout is positioned
 *  relative to the anchor. The
 *  overlay component reads this
 *  and computes a callout rect. */
export type TourPlacement =
  | { kind: 'center' }
  | {
      kind: 'anchored';
      /** The value of the
       *  `data-tour-target`
       *  attribute on the DOM
       *  node the callout
       *  should point at. */
      target: string;
      /** Which side of the
       *  anchor the callout
       *  should appear on.
       *  The overlay flips
       *  to the opposite
       *  side automatically
       *  if the callout
       *  would clip the
       *  viewport. */
      side: 'top' | 'bottom' | 'left' | 'right';
    };

export interface TourStep {
  /** Stable id. Used as a
   *  React `key` and as the
   *  callout's `data-step-id`
   *  test attribute. */
  id: string;
  /** Short title. One or two
   *  words; renders as the
   *  callout heading. */
  title: string;
  /** Body copy. 1-2
   *  sentences. Kept short
   *  to fit the small
   *  callout. */
  body: string;
  /** Anchor + placement. */
  placement: TourPlacement;
}

/** The step list. Order matters —
 *  the user walks through them
 *  in declaration order. The
 *  overlay shows a "Step N of M"
 *  indicator derived from the
 *  position in this array. */
export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Lipi',
    body: "Lipi is a voice-first IDE. This short tour will show you the four panes you'll spend most of your time in.",
    placement: { kind: 'center' },
  },
  {
    id: 'fileTree',
    title: 'Your files',
    body: 'The file tree on the left shows your workspace. Right-click to create, rename, or delete files and folders.',
    placement: {
      kind: 'anchored',
      target: 'fileTree',
      side: 'right',
    },
  },
  {
    id: 'sidePanel',
    title: 'Source control, terminal, AI, search',
    body: 'The right-hand panel has four tabs: Source Control (git), Terminal, AI chat, and full-text search.',
    placement: {
      kind: 'anchored',
      target: 'sidePanel',
      side: 'left',
    },
  },
  {
    id: 'aiVoice',
    title: 'Talk to your code',
    body: 'Click the mic in the AI panel — or press Ctrl/Cmd+Shift+V — to dictate a message. Lipi transcribes and sends it to the AI.',
    placement: {
      kind: 'anchored',
      target: 'aiVoiceButton',
      side: 'top',
    },
  },
  {
    id: 'commandPalette',
    title: 'The command palette',
    body: 'Press Ctrl/Cmd+Shift+P to open the command palette. Every action in Lipi is reachable from there — including this tour.',
    placement: { kind: 'center' },
  },
  {
    id: 'outro',
    title: "You're set",
    body: "That's the tour. Use the command palette any time to revisit it (search for \"Restart onboarding tour\").",
    placement: { kind: 'center' },
  },
] as const;

/** Decide whether the tour should
 *  auto-start on this launch.
 *
 *  Mirrors the gate in
 *  `useFirstRunOnboarding`'s
 *  `computeShouldShow`: a
 *  returning user who has
 *  dismissed the tour should
 *  never see it again unless
 *  they ask.
 *
 *  Inputs are read at render time
 *  (not at module load) so the
 *  gate is correct in the face
 *  of the workspace store
 *  hydrating late.
 *
 *  The gate returns `true` only
 *  if ALL of:
 *   1. The tour store has
 *      hydrated (so we know
 *      the persisted dismiss
 *      flag).
 *   2. The user has not
 *      dismissed the tour on a
 *      previous launch.
 *   3. The user has a
 *      workspace open (the
 *      tour highlights editor
 *      features, so it's
 *      useless on the Welcome
 *      screen).
 *
 *  Future work: the tour is
 *  desktop-only today. On
 *  mobile, the file tree /
 *  side panel are replaced by
 *  the `MobileShell` tab bar,
 *  so the anchored steps
 *  wouldn't find their
 *  targets. A future K
 *  iteration can either gate
 *  by viewport or build a
 *  parallel mobile step list.
 */
export function computeTourShouldAutoStart(args: {
  tourHydrated: boolean;
  tourDismissed: boolean;
  workspaceHydrated: boolean;
  currentPath: string | null;
}): boolean {
  if (!args.tourHydrated) return false;
  if (!args.workspaceHydrated) return false;
  if (args.tourDismissed) return false;
  if (args.currentPath === null) return false;
  return true;
}

/** Convenience selector used by
 *  `useWorkspaceStore.getState()`
 *  callers. Returns the two
 *  workspace-store fields the
 *  gate needs. */
export function readWorkspaceGateFields(
  // M6a: the gate takes
  // plain primitives
  // — `hydrated` and
  // the precomputed
  // `currentPath`. The
  // store's
  // `workspaces` +
  // `activeId` shape
  // is hidden behind
  // the `useActivePath`
  // selector so the
  // gate can be
  // tested without
  // fabricating a
  // full `WorkspaceState`.
  args: {
    hydrated: boolean;
    currentPath: string | null;
  },
): { workspaceHydrated: boolean; currentPath: string | null } {
  return {
    workspaceHydrated: args.hydrated,
    currentPath: args.currentPath,
  };
}
