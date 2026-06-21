/**
 * tsConfigStore — Phase 7's bridge between the
 * workspace's `tsconfig.json` and Monaco's built-in
 * TypeScript language service.
 *
 * Monaco's TS service runs in a Web Worker (`ts.worker`)
 * and reads its own copy of `compilerOptions` from the
 * main thread via `typescriptDefaults.setCompilerOptions`.
 * We want the service to load the user's PROJECT settings
 * (so a project with `strict: false` doesn't suddenly see
 * red squiggles everywhere), but Monaco's worker doesn't
 * know about Tauri / `localStorage` / workspaces — it
 * reads whatever the main thread hands it. This store
 * is the main-thread side of that handoff:
 *
 *   1. The user opens a workspace → the editor pane
 *      dispatches `setFromWorkspace(workspaceRoot)`.
 *   2. The store checks for `<root>/tsconfig.json`
 *      (via the cheap `fs_path_exists` IPC).
 *   3. If present, it reads + parses the file
 *      (stripping `//` / `/* * /` comments — `tsconfig.json`
 *      supports them, real JSON.parse doesn't).
 *   4. It extracts `compilerOptions` + `include` /
 *      `exclude` arrays and stashes them in the store.
 *   5. The editor pane subscribes to the store and
 *      re-applies the compiler options to Monaco
 *      whenever they change (workspace switch,
 *      `tsconfig.json` edited externally + auto-saved,
 *      etc.).
 *
 * If no `tsconfig.json` exists, we fall back to a sane
 * default (`strict: true`, ES2022, React JSX, etc.) so
 * the user still gets intellisense on one-off scripts
 * and single-file projects.
 *
 * The store also subscribes to the `onFsChange` watcher
 * for the workspace root, debounced to 500ms (editors
 * often fire several events per save — the Rust drain
 * loop coalesces at 75ms but a few of those can still
 * land in quick succession when the file is renamed or
 * a tool regenerates it).
 */
import { create } from 'zustand';
import { pathExists, readFile } from '@/ipc/fs';
import { onFsChange, startWatch, stopWatch, type WatchHandle } from '@/ipc/fsWatcher';

/**
 * The minimal slice of Monaco's `CompilerOptions` shape
 * that the `tsconfig.json` parser is willing to copy
 * through. We keep this loose (`Record<string, unknown>`)
 * for the same reason Monaco itself does: the TS
 * compiler understands ~80 keys, new ones get added
 * in minor versions, and copying them by name would
 * leave us perpetually out of date.
 *
 * The store doesn't `set` Monaco's compiler options
 * itself — that's the editor pane's job (it has the
 * live Monaco handle). It just hands the parsed object
 * over and trusts Monaco to validate / apply it.
 */
export type TsCompilerOptions = Record<string, unknown>;

/**
 * The full `tsconfig.json` we care about: the
 * `compilerOptions` block + the `include` / `exclude`
 * glob arrays (we don't apply those directly — Monaco
 * uses its own model loading — but we surface them
 * via the store so a future "Files included" inspector
 * can read them).
 */
export interface ParsedTsConfig {
  compilerOptions: TsCompilerOptions;
  include: string[];
  exclude: string[];
  /** The raw JSON value, for any consumer that needs
   *  fields we don't model (e.g. `extends`, `references`,
   *  `ts-node` config). */
  raw: Record<string, unknown>;
}

interface TsConfigState {
  /** The active workspace root, or `null` if no
   *  workspace is open. Set by `setFromWorkspace`. */
  workspaceRoot: string | null;
  /** Absolute path to the discovered `tsconfig.json`,
   *  or `null` if the workspace doesn't have one
   *  (or no workspace is open). */
  tsconfigPath: string | null;
  /** The parsed `compilerOptions` block, or `null`
   *  if the file is missing / unparseable. The editor
   *  pane applies this to Monaco via
   *  `typescriptDefaults.setCompilerOptions(...)`. */
  compilerOptions: TsCompilerOptions | null;
  /** The full parsed config (includes the `include` /
   *  `exclude` arrays + the raw object), or `null`. */
  config: ParsedTsConfig | null;
  /** A monotonic epoch-ms timestamp the editor pane
   *  can watch as a "config changed" signal. Bumped
   *  on every successful `setFromWorkspace` and on
   *  every external `tsconfig.json` change. */
  updatedAt: number;

  /**
   * Find + read `<root>/tsconfig.json` and populate
   * the store. Idempotent — calling with the same
   * `root` we already have is a no-op. Safe to call
   * from a `useEffect` (it's the pattern the editor
   * pane uses to react to workspace-tab switches).
   *
   * Also starts the `onFsChange` watcher for `root`
   * (and tears down any watcher for a previous
   * workspace). The watcher re-runs `setFromWorkspace`
   * when the file changes on disk.
   */
  setFromWorkspace: (root: string) => Promise<void>;
  /** Clear the store back to the "no workspace"
   *  state. Called on workspace close. */
  clear: () => void;
}

/**
 * Strip `//` line comments and block comments
 * (`slash-star ... star-slash`) from a `tsconfig.json` body. TypeScript
 * supports both (they're stripped before the JSON
 * parse), and a user's hand-edited `tsconfig.json`
 * commonly has them.
 *
 * We do this with a tiny state machine rather than
 * a regex so we don't accidentally eat a `//` that
 * appears inside a string literal (e.g. a
 * `compilerOptions.paths` mapping). The state
 * machine tracks:
 *   - `inString`: whether we're inside a `"…"` (we
 *     don't process comments inside strings)
 *   - `escaped`: whether the previous char was a `\`
 *     (so the next `"` doesn't toggle `inString`)
 *
 * This is deliberately minimal — it doesn't handle
 * the full JSON5 spec (no single quotes, no trailing
 * commas). `tsconfig.json` in practice is either
 * pure JSON or JSON + the two comment styles, so this
 * is enough. Anything weirder gets a parse error and
 * the store falls back to defaults.
 */
export function stripJsonComments(input: string): string {
  let out = '';
  let i = 0;
  const n = input.length;
  let inString = false;
  let escaped = false;
  while (i < n) {
    const c = input[i];
    const next = i + 1 < n ? input[i + 1] : '';
    if (inString) {
      out += c;
      if (escaped) {
        escaped = false;
      } else if (c === '\\') {
        escaped = true;
      } else if (c === '"') {
        inString = false;
      }
      i++;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      i++;
      continue;
    }
    if (c === '/' && next === '/') {
      // Line comment — skip to end of line.
      i += 2;
      while (i < n && input[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      // Block comment — skip to `*/`.
      i += 2;
      while (i < n && !(input[i] === '*' && input[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Parse a `tsconfig.json` string. Returns `null` if
 * the body is unparseable JSON (after comment
 * stripping) or doesn't have the expected shape. The
 * caller treats `null` as "no compilerOptions from
 * the file" and falls back to defaults.
 */
export function parseTsConfig(raw: string): ParsedTsConfig | null {
  let value: unknown;
  try {
    value = JSON.parse(stripJsonComments(raw));
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const obj = value as Record<string, unknown>;
  const compilerOptions =
    obj.compilerOptions && typeof obj.compilerOptions === 'object'
      ? (obj.compilerOptions as TsCompilerOptions)
      : {};
  const include = Array.isArray(obj.include)
    ? obj.include.filter((s): s is string => typeof s === 'string')
    : [];
  const exclude = Array.isArray(obj.exclude)
    ? obj.exclude.filter((s): s is string => typeof s === 'string')
    : [];
  return { compilerOptions, include, exclude, raw: obj };
}

const TSCONFIG_FILENAME = 'tsconfig.json';
/** Debounce window for the `onFsChange` watcher.
 *  Picked to be longer than the Rust drain loop's
 *  75ms coalesce (so a single save is one event) but
 *  short enough to feel "live" in the editor. */
const FS_CHANGE_DEBOUNCE_MS = 500;

/** Debounce a `setFromWorkspace` call. Returns a
 *  `trigger` that schedules the call and a `cancel`
 *  that drops any pending call. We use this for the
 *  `onFsChange` watcher so a burst of events
 *  (rename + write + chmod) doesn't trigger 3
 *  re-reads. */
function debouncer() {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    trigger(fn: () => void) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, FS_CHANGE_DEBOUNCE_MS);
    },
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

export const useTsConfigStore = create<TsConfigState>((set, get) => {
  // The fs-watcher bookkeeping. The store owns the
  // current `WatchHandle` and the unlisten function
  // for `onFsChange`. Both are torn down on workspace
  // switch and on `clear()`.
  let watchHandle: WatchHandle | null = null;
  let watchUnlisten: (() => void) | null = null;
  const debounce = debouncer();

  async function tearDownWatch() {
    debounce.cancel();
    if (watchUnlisten) {
      try {
        watchUnlisten();
      } catch {
        // The Tauri `listen` unlisten is idempotent and
        // synchronous; an error here means the listener
        // was already gone. Move on.
      }
      watchUnlisten = null;
    }
    if (watchHandle) {
      try {
        await stopWatch(watchHandle.id);
      } catch {
        // The watcher may have been auto-removed by
        // a workspace close that deleted the dir; not
        // an error for us.
      }
      watchHandle = null;
    }
  }

  async function setUpWatch(root: string) {
    try {
      watchHandle = await startWatch(root);
    } catch {
      // `startWatch` can fail if `root` doesn't exist
      // any more (e.g. the user closed the workspace
      // mid-load). The store falls back to "no
      // live updates" — the next `setFromWorkspace`
      // call will retry. We log in dev only to avoid
      // spamming the prod console for a transient
      // condition.
      watchHandle = null;
      if (import.meta.env.DEV) {
        console.warn(
          `[tsConfigStore] startWatch failed for ${root}; external edits will not auto-reload.`,
        );
      }
      return;
    }
    watchUnlisten = await onFsChange((payload) => {
      // We only care about changes that touch our
      // specific file — the watcher is a directory
      // watcher, and other files in the workspace
      // change frequently.
      if (
        payload.watchedPath !== root &&
        !payload.paths.some((p) => p.endsWith(`/${TSCONFIG_FILENAME}`))
      ) {
        return;
      }
      debounce.trigger(() => {
        void get().setFromWorkspace(root);
      });
    });
  }

  return {
    workspaceRoot: null,
    tsconfigPath: null,
    compilerOptions: null,
    config: null,
    updatedAt: 0,

    setFromWorkspace: async (root) => {
      const { workspaceRoot } = get();
      // No-op short-circuit: same workspace, nothing
      // has bumped `updatedAt` since last call.
      if (workspaceRoot === root) return;

      // Workspace switch — tear down the old watcher
      // and start a new one.
      await tearDownWatch();

      const candidate = joinPath(root, TSCONFIG_FILENAME);
      let path: string | null = null;
      let config: ParsedTsConfig | null = null;
      try {
        if (await pathExists(candidate)) {
          const file = await readFile(candidate);
          const parsed = parseTsConfig(file.content);
          if (parsed) {
            path = candidate;
            config = parsed;
          }
          // Unparseable file → fall through to defaults.
          // We don't surface an error to the editor
          // (that would be a different feature — a
          // "tsconfig.json is broken" toast).
        }
      } catch {
        // `readFile` can throw (permission denied,
        // file vanished between `pathExists` and
        // `readFile`, etc.). Same fallback: no config
        // from the file.
      }

      set({
        workspaceRoot: root,
        tsconfigPath: path,
        compilerOptions: config?.compilerOptions ?? null,
        config,
        updatedAt: Date.now(),
      });

      // Start watching the new root. We do this
      // AFTER the store update so the debounced
      // re-read can read the new state correctly.
      void setUpWatch(root);
    },

    clear: () => {
      void tearDownWatch();
      set({
        workspaceRoot: null,
        tsconfigPath: null,
        compilerOptions: null,
        config: null,
        updatedAt: Date.now(),
      });
    },
  };
});

/** Tiny helper to join paths without pulling in
 *  `node:path` (the renderer doesn't have it). Handles
 *  both Windows backslashes and POSIX forward
 *  slashes by always inserting a single separator.
 *  The Rust side normalises either way. */
function joinPath(...parts: string[]): string {
  return parts
    .map((p, i) => {
      if (i === 0) return p.replace(/[/\\]+$/, '');
      return p.replace(/^[/\\]+|[/\\]+$/g, '');
    })
    .filter((p) => p.length > 0)
    .join(/[/\\]/.test(parts[0] ?? '') ? '/' : '\\');
}
