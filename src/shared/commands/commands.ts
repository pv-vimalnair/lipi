/**
 * commandPalette commands — the data-driven
 * registry that backs the
 * `Cmd-Shift-P` /
 * `Ctrl-Shift-P` launcher.
 *
 * Design notes:
 *
 * 1. **Data, not code.** Every command
 *    is a plain object with a `run`
 *    function. The modal renders this
 *    list, filters it, and executes
 *    `run()`. Adding a new command is
 *    one entry here, no UI changes.
 *
 * 2. **Cross-screen surface.** The
 *    palette needs to do things
 *    regardless of which screen is
 *    active (open Settings from the
 *    editor, switch back from
 *    Settings, etc.). The store +
 *    modal live in `src/shared/` and
 *    the registry lives here too. Per
 *    Rule 3 (screen-folder layout)
 *    the registry is shared data,
 *    not a screen-local state.
 *
 * 3. **`isEnabled` predicate.** Some
 *    commands only make sense in
 *    certain contexts ("Cancel
 *    current stream" is only
 *    enabled while a stream is in
 *    flight; "Reload custom tools"
 *    only when a workspace is
 *    open; "New chat" only when
 *    no stream is in flight). The
 *    predicate is called at render
 *    time so disabled commands are
 *    visible-but-greyed-out (the
 *    user can see they exist, just
 *    can't run them — same pattern
 *    as VS Code's palette).
 *
 * 4. **`isDev` flag.** Dev-only
 *    commands (currently just
 *    "Toggle device emulator")
 *    are filtered out in prod
 *    builds. The filter is a
 *    simple `import.meta.env.DEV`
 *    check in the modal's render
 *    path, not at module load —
 *    keeps dev commands greppable
 *    in the registry.
 *
 * 5. **`group` field.** Used by the
 *    modal to group commands
 *    visually (Settings / Chat /
 *    Dev). Same group renders
 *    together; the filter does NOT
 *    preserve group order across
 *    groups (commands are sorted
 *    by their own order in the
 *    array, then grouped at
 *    render time).
 *
 * 6. **`run()` returns `void |
 *    Promise<void>`.** The modal
 *    doesn't await — fire-and-
 *    forget. Most commands are
 *    synchronous state writes; a
 *    few (e.g. reload custom tools)
 *    kick off async work. Errors
 *    are reported by the called
 *    store (e.g.
 *    `customToolsStore.lastError`)
 *    — the palette itself doesn't
 *    need a try/catch.
 *
 * 7. **Order matters.** The
 *    registry is iterated in
 *    declaration order. The
 *    "first match wins" mental
 *    model — put common commands
 *    (Settings, New chat,
 *    Switch provider) at the top
 *    so the fuzzy filter's first
 *    hit is the right one.
 */

import { useAppStore } from '@/shared/state/appStore';
import { useAboutStore } from '@/shared/state/aboutStore';
import { useAiStore } from '@/screens/EditorWorkspace/state/aiStore';
import { useDeviceEmulatorStore } from '@/dev/state/deviceEmulatorStore';
import { useFirstRunStore } from '@/shared/state/firstRunStore';
import { useTourStore } from '@/shared/state/tourStore';
import { useToolDecisionLogStore } from '@/shared/state/toolDecisionLogStore';
import { useToolSettingsStore } from '@/shared/state/toolSettingsStore';
import { useCustomToolsStore } from '@/shared/state/customToolsStore';
import { useVoicePreferencesStore } from '@/shared/state/voicePreferencesStore';
import { useVoiceCapabilitiesStore } from '@/shared/state/voiceCapabilitiesStore';
import {
  useWorkspaceStore,
  workspaceSelectors,
} from '@/shared/state/workspaceStore';
import { openWorkspace } from '@/screens/Welcome';

export interface Command {
  /** Unique id. Used for `data-cmd`
   * attributes in tests. Format:
   * `group.action`, e.g.
   * `'settings.open'`,
   * `'chat.new'`. */
  id: string;
  /** Primary label, shown on the
   * row. */
  title: string;
  /** Secondary label, shown
   * dimmer below the title.
   * Used for the category /
   * hint. */
  subtitle?: string;
  /** Visual group. Commands in
   * the same group render
   * contiguously in the list
   * (with a small header). */
  group: 'Settings' | 'Chat' | 'AI' | 'Tools' | 'Voice' | 'Help' | 'Dev';
  /** Extra search terms. The
   * title is always searched;
   * `keywords` adds synonyms
   * ("api", "key", "openai"
   * etc.). */
  keywords?: string[];
  /** Optional keyboard shortcut
   * hint, rendered on the
   * right of the row. We
   * store the raw key names
   * and the modal renders
   * them as the platform's
   * symbol set (Cmd on Mac,
   * Ctrl on Win/Linux).
   * The palette's own
   * shortcut
   * (Cmd-Shift-P) is NOT
   * shown here — it's
   * implicit in the
   * input placeholder. */
  shortcut?: string[];
  /** Dev-only. Filtered out
   * in prod builds. */
  isDev?: boolean;
  /** Context predicate. Called
   * at render time (every
   * keystroke). When `false`,
   * the row renders dimmed
   * and Enter is a no-op. */
  isEnabled?: () => boolean;
  /** The action. The modal
   * calls this on Enter /
   * click. */
  run: () => void | Promise<void>;
}

const isStreaming = (): boolean => {
  return useAiStore.getState().requestStatus.kind === 'streaming';
};

const hasWorkspace = (): boolean => {
  return useCustomToolsStore.getState().workspaceRoot !== null;
};

export const COMMANDS: readonly Command[] = [
  // -- Settings / navigation ----------------------------------
  {
    id: 'settings.open',
    title: 'Open Settings',
    subtitle: 'AI provider keys, tool policy, activity log',
    group: 'Settings',
    keywords: ['preferences', 'config', 'gear'],
    run: () => {
      useAppStore.getState().setActiveScreen('settings');
    },
  },
  {
    id: 'settings.close',
    title: 'Go to Editor',
    subtitle: 'Back to the workspace',
    group: 'Settings',
    keywords: ['back', 'home', 'editor'],
    run: () => {
      useAppStore.getState().setActiveScreen('editor');
    },
  },

  // -- Workspace ----------------------------------------------
  // "Open Folder" launches the
  // native folder picker. The
  // hook in `@/screens/Welcome`
  // owns the picker + status
  // transitions; the palette
  // just calls it. Available
  // from any screen.
  {
    id: 'workspace.open',
    title: 'Open Folder…',
    subtitle: 'Pick a workspace folder to open',
    group: 'Settings',
    keywords: ['folder', 'pick', 'browse', 'open'],
    shortcut: ['Cmd', 'Shift', 'O'],
    run: () => {
      // The openWorkspace
      // function lives in
      // the Welcome screen
      // because the picker
      // is a Welcome-screen
      // concern (it's how
      // the Welcome
      // screen exits). The
      // palette reuses
      // the same function.
      void openWorkspace();
    },
  },
  {
    id: 'workspace.close',
    title: 'Close Folder',
    subtitle: 'Back to the Welcome screen',
    group: 'Settings',
    keywords: ['close', 'unload', 'leave'],
    isEnabled: () =>
      workspaceSelectors.currentPath(useWorkspaceStore.getState()) !==
      null,
    run: () => {
      useWorkspaceStore.getState().close();
      // The main router will
      // pick up the new
      // currentPath and
      // switch from the
      // editor back to the
      // Welcome screen
      // automatically.
    },
  },

  // Reopen the first-run
  // "no API key" interstitial.
  // Useful when:
  //   - the user dismissed
  //     it accidentally and
  //     wants to come back to
  //     it
  //   - the user is on the
  //     Welcome screen with
  //     a workspace open, the
  //     panel is hidden by
  //     the gate, but they
  //     want to see the
  //     onboarding copy
  //     anyway (e.g. a friend
  //     asking "what does
  //     this say?")
  //   - we change the gate
  //     logic later and the
  //     user wants to re-arm
  //     it manually
  //
  // The command always
  // clears the dismissed
  // flag and forces a re-
  // render. The visible
  // panel still depends on
  // the gate (no workspace,
  // no configured keys);
  // the user is told the
  // panel won't appear in
  // those other contexts
  // by leaving the command
  // always enabled.
  {
    id: 'firstRun.openSetup',
    title: 'Reopen first-run setup',
    subtitle:
      'Show the "add an API key" panel again (only visible on Welcome with no keys)',
    group: 'Settings',
    keywords: [
      'onboarding',
      'welcome',
      'key',
      'api',
      'first',
      'run',
      'setup',
      'reset',
    ],
    run: () => {
      useFirstRunStore.getState().reset();
      // If the user happens
      // to be in a workspace
      // and the gate would
      // keep the panel
      // hidden, route them
      // to the Welcome
      // screen too so they
      // can see the panel
      // they just re-armed.
      const path = workspaceSelectors.currentPath(
        useWorkspaceStore.getState(),
      );
      if (path !== null) {
        useWorkspaceStore.getState().close();
      }
    },
  },

  // -- K (onboarding tour) ------------------------------------
  // The tour is auto-shown
  // the first time the user
  // opens a workspace. This
  // command is the "show it
  // again" entry point —
  // useful when the user
  // dismissed the tour
  // halfway through, or when
  // a returning user wants
  // to refresh their memory
  // of where things are.
  //
  // The command always
  // starts the tour from
  // step 0 (even if the
  // previous run was on
  // step 3). The v1 step
  // cursor is not persisted,
  // so the user always
  // restarts from the top.
  {
    id: 'tour.restart',
    title: 'Restart onboarding tour',
    subtitle: 'Show the welcome tour again (walks through the four panes)',
    group: 'Help',
    keywords: [
      'tour',
      'onboarding',
      'walkthrough',
      'guide',
      'show',
      'me',
      'around',
      'help',
      'tutorial',
    ],
    run: () => {
      useTourStore.getState().start();
    },
  },

  // -- Chat ---------------------------------------------------
  {
    id: 'chat.new',
    title: 'New chat',
    subtitle: 'Clear the AI conversation',
    group: 'Chat',
    keywords: ['reset', 'clear', 'conversation'],
    // Disabled while a stream is
    // in flight — the AI store's
    // `clearMessages` already
    // refuses in that state, but
    // the user-facing message
    // ("Stop the current request
    // first…") is more useful as
    // a dimmed-row hint than a
    // silent no-op.
    isEnabled: () => !isStreaming(),
    run: () => {
      useAiStore.getState().clearMessages();
    },
  },
  {
    id: 'chat.cancel',
    title: 'Cancel current stream',
    subtitle: 'Stop the AI mid-response',
    group: 'Chat',
    keywords: ['stop', 'abort', 'interrupt'],
    isEnabled: () => isStreaming(),
    run: () => {
      void useAiStore.getState().stop();
    },
  },

  // -- AI provider --------------------------------------------
  {
    id: 'ai.provider.openai',
    title: 'Switch AI provider: OpenAI',
    subtitle: 'Use gpt-4o-mini (or your configured model)',
    group: 'AI',
    keywords: ['openai', 'gpt', 'chatgpt'],
    run: () => {
      useAiStore.getState().setProvider('openai');
    },
  },
  {
    id: 'ai.provider.anthropic',
    title: 'Switch AI provider: Anthropic',
    subtitle: 'Use claude-3-5-sonnet (or your configured model)',
    group: 'AI',
    keywords: ['anthropic', 'claude'],
    run: () => {
      useAiStore.getState().setProvider('anthropic');
    },
  },

  // -- Tools --------------------------------------------------
  {
    id: 'tools.reset',
    title: 'Reset all tool settings',
    subtitle: 'Re-enable every tool and clear their policies (5-second undo)',
    group: 'Tools',
    keywords: ['reset', 'defaults', 'policy', 'wipe'],
    // The store itself no-ops
    // when there's nothing to
    // clear, but the row is
    // always shown so the user
    // can discover the action.
    isEnabled: () => {
      const s = useToolSettingsStore.getState();
      return (
        s.disabledToolNames.length > 0 ||
        Object.keys(s.confirmationMode).length > 0
      );
    },
    run: () => {
      useToolSettingsStore.getState().clearAllSettings();
    },
  },
  {
    id: 'tools.log.clear',
    title: 'Clear activity log',
    subtitle: 'Wipe the tool-call decision history (5-second undo)',
    group: 'Tools',
    keywords: ['log', 'history', 'clear', 'wipe'],
    isEnabled: () => useToolDecisionLogStore.getState().records.length > 0,
    run: () => {
      useToolDecisionLogStore.getState().clearLog();
    },
  },
  {
    id: 'tools.reload',
    title: 'Reload custom tools from lipi-tools.json',
    subtitle: 'Re-read the workspace tools file and re-register everything',
    group: 'Tools',
    keywords: ['reload', 'refresh', 'custom', 'workspace', 'lipi-tools'],
    isEnabled: () => hasWorkspace(),
    run: async () => {
      const root = useCustomToolsStore.getState().workspaceRoot;
      if (root) {
        await useCustomToolsStore.getState().load(root);
      }
    },
  },

  // -- Help ----------------------------------------------------
  // F.5/F.6: Show the About modal. Reachable via the
  // Command Palette as well as the native Help > About
  // menu (F.4) — both call into the same `useAboutStore`
  // action, so the user has the same surface from either
  // entry point.
  {
    id: 'help.about',
    title: 'About Lipi',
    subtitle: 'Version, license, project links',
    group: 'Help',
    keywords: ['about', 'version', 'license', 'help', 'info'],
    run: () => {
      useAboutStore.getState().show();
    },
  },

  // -- Dev ----------------------------------------------------
  {
    id: 'dev.emulator.toggle',
    title: 'Toggle device emulator',
    subtitle: 'Show / hide the mobile device emulator strip (M1)',
    group: 'Dev',
    keywords: ['mobile', 'emulator', 'responsive', 'device'],
    isDev: true,
    shortcut: ['Cmd', 'Shift', 'D'],
    run: () => {
      useDeviceEmulatorStore.getState().toggle();
    },
  },
  // -- Voice (M2b) --------------------------------------------
  // The STT provider picker. The default is 'wispr'; the
  // 'stub' entry is a debug fallback that returns a
  // recognisable placeholder. 'ondevice' is reserved
  // for M2c and is shown only as a "not yet wired" hint
  // (a no-op for now).
  {
    id: 'voice.provider.wispr',
    title: 'Use Wispr Flow for voice input',
    subtitle: 'Switch the STT provider to Wispr (default; real transcription)',
    group: 'Voice',
    keywords: ['voice', 'stt', 'speech', 'wispr', 'flow', 'dictation', 'mic'],
    run: () => {
      useVoicePreferencesStore.getState().setProvider('wispr');
    },
  },
  {
    id: 'voice.provider.stub',
    title: 'Use stub provider for voice input',
    subtitle: 'Switch the STT provider to the M2a debug stub (no real transcription)',
    group: 'Voice',
    keywords: ['voice', 'stt', 'speech', 'stub', 'debug', 'placeholder', 'mic'],
    run: () => {
      useVoicePreferencesStore.getState().setProvider('stub');
    },
  },
  // M2c desktop: the on-device Whisper
  // provider. The `isEnabled` predicate greys
  // the row on platforms where the Rust side
  // reports `ondevice: false` (iOS / Android
  // once we ship a Tauri build for them; on
  // current desktop targets it's always
  // true). Surfaced here for symmetry with
  // `voice.provider.wispr` — the user can
  // switch without leaving the Command
  // Palette.
  {
    id: 'voice.provider.ondevice',
    title: 'Use on-device (Whisper) for voice input',
    subtitle:
      'Switch the STT provider to the M2c on-device Whisper path. Requires a model in Settings → Voice.',
    group: 'Voice',
    keywords: [
      'voice',
      'stt',
      'speech',
      'ondevice',
      'on-device',
      'whisper',
      'local',
      'offline',
      'dictation',
      'mic',
    ],
    isEnabled: () =>
      useVoiceCapabilitiesStore.getState().capabilities?.ondevice === true,
    run: () => {
      useVoicePreferencesStore.getState().setProvider('ondevice');
    },
  },
  // M2c mobile: the Web Speech shim. The
  // `isEnabled` predicate reads from the
  // `useVoiceCapabilitiesStore` (hydrated at
  // app startup); the row is briefly greyed
  // while the IPC is in flight, then enables
  // on platforms where the WebView exposes
  // `window.SpeechRecognition` (Windows /
  // macOS / iOS). The `subtitle` is a privacy
  // callout — see Decision #46 risk R3.
  {
    id: 'voice.provider.webspeech',
    title: 'Use browser speech engine for voice input',
    subtitle:
      "Switch the STT provider to the WebView's SpeechRecognition. Sends audio to the browser's vendor server (Google on Chromium, Apple on WebKit).",
    group: 'Voice',
    keywords: [
      'voice',
      'stt',
      'speech',
      'browser',
      'webspeech',
      'webkit',
      'chromium',
      'dictation',
      'mic',
    ],
    isEnabled: () =>
      useVoiceCapabilitiesStore.getState().capabilities?.webSpeech === true,
    run: () => {
      useVoicePreferencesStore.getState().setProvider('webSpeech');
    },
  },
];

/**
 * Filter the command list against a
 * search query. Pure function for
 * testability.
 *
 * Matching strategy: fuzzy subsequence.
 * Every char in the query must appear in
 * the haystack in order, case-
 * insensitive. Spaces in the query
 * split the haystack into "terms" and
 * EVERY term must match somewhere
 * (title, subtitle, or keywords). Empty
 * query returns the full list
 * unchanged.
 *
 * Why subsequence and not a real fuzzy
 * library (fuse.js, fzf):
 *   - Lipi has a small fixed command
 *     set (currently 10). A subsequence
 *     matcher is O(query*haystack),
 *     which is sub-millisecond at this
 *     scale.
 *   - No dependency, no bundle bloat.
 *   - Predictable: a subsequence of
 *     "tnsl" matches "Clear activity
 *     log" (cl-t), or "Open Settings"
 *     (se-t-tin-gs → no), etc. The
 *     user can rely on the prefix-fall-
 *     back behaviour (we score exact
 *     prefix matches higher, see
 *     below).
 *
 * Scoring: lower = better.
 *   - exact title prefix match: 0
 *   - exact title match: 1
 *   - any subsequence in title: 2
 *   - any subsequence in subtitle: 3
 *   - any subsequence in keywords: 4
 *   - no match: omitted
 *
 * Within a score tier, the original
 * registry order is preserved
 * (registry order is the "common
 * commands first" priority).
 */
export interface ScoredCommand {
  command: Command;
  score: number;
}

/**
 * Build a one-shot list of
 * `Open Recent (N)` commands
 * from the current
 * `workspaceStore.recents`
 * list. Read at render time
 * (not module load) so the
 * palette reflects the
 * latest recents. Returns
 * an empty array when there
 * are no recents.
 *
 * The IDs are stable
 * (`workspace.recent.<index>`)
 * so React keys don't churn
 * as the list re-orders.
 */
export function getRecentsCommands(): readonly Command[] {
  const recents = workspaceSelectors.recents(
    useWorkspaceStore.getState(),
  );
  return recents.map((path, index) => ({
    id: `workspace.recent.${index}`,
    title: `Open Recent: ${path}`,
    subtitle: 'Re-open this workspace',
    group: 'Settings' as const,
    keywords: ['recent', 'open', 'workspace', path],
    run: () => {
      void openWorkspace(path);
    },
  }));
}

function subsequenceMatch(needle: string, haystack: string): boolean {
  let i = 0;
  const n = needle.length;
  for (let j = 0; j < haystack.length; j++) {
    if (i >= n) return true;
    if (needle[i] === haystack[j]) i++;
  }
  return i >= n;
}

export function filterCommands(query: string): ScoredCommand[] {
  const q = query.trim().toLowerCase();
  if (q === '') {
    return COMMANDS.map((command) => ({ command, score: 0 }));
  }
  // Split by whitespace — every
  // chunk must match SOMEWHERE
  // in the command.
  const terms = q.split(/\s+/).filter((t) => t.length > 0);
  const out: ScoredCommand[] = [];
  for (const command of COMMANDS) {
    const title = command.title.toLowerCase();
    const subtitle = (command.subtitle ?? '').toLowerCase();
    const keywords = (command.keywords ?? []).map((k) => k.toLowerCase());
    let matched = true;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const term of terms) {
      let termMatched = false;
      // Title: most important
      if (subsequenceMatch(term, title)) {
        termMatched = true;
        if (title === term) {
          bestScore = Math.min(bestScore, 1);
        } else if (title.startsWith(term)) {
          bestScore = Math.min(bestScore, 0);
        } else {
          bestScore = Math.min(bestScore, 2);
        }
      }
      // Subtitle
      if (subsequenceMatch(term, subtitle)) {
        termMatched = true;
        bestScore = Math.min(bestScore, 3);
      }
      // Keywords
      for (const kw of keywords) {
        if (subsequenceMatch(term, kw)) {
          termMatched = true;
          bestScore = Math.min(bestScore, 4);
          break;
        }
      }
      if (!termMatched) {
        matched = false;
        break;
      }
    }
    if (matched) {
      out.push({ command, score: bestScore });
    }
  }
  // Stable sort by score, then by
  // original registry order.
  return out
    .map((sc, idx) => ({ ...sc, _idx: idx }))
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return a._idx - b._idx;
    })
    .map(({ command, score }) => ({ command, score }));
}
