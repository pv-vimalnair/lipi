/**
 * CustomTools — the source of truth for
 * user-defined custom tools (5c).
 *
 * The user's custom tools live in a JSON
 * file at the root of the open workspace:
 * `<workspace>/lipi-tools.json`. This
 * store is the runtime view of that file:
 *   - `load(workspaceRoot)` reads the
 *     file via the Rust `read_lipi_tools`
 *     IPC and seeds the in-memory
 *     `tools` array.
 *   - `addTool` / `updateTool` /
 *     `removeTool` mutate the in-memory
 *     array.
 *   - `save()` writes the in-memory array
 *     back to the file via the Rust
 *     `write_lipi_tools` IPC.
 *
 * On every load / save / add / update /
 * remove, the store re-registers the
 * tools with the JS `toolRegistry` (via
 * `registerCustomTool`). This keeps the
 * registry in sync with the on-disk file
 * without the registry having to know
 * about the store.
 *
 * ## Why a separate store from `toolSettingsStore`?
 *
 * Two reasons:
 *   1. **Different persistence layer**:
 *      `toolSettingsStore` is a per-tool
 *      enable/disable set that lives in
 *      `localStorage` (per-user, per-
 *      device). `customToolsStore` is a
 *      list of tool DEFINITIONS that
 *      lives in `lipi-tools.json` (per-
 *      workspace, per-repo). Mixing the
 *      two would force a single store to
 *      hydrate from two sources.
 *   2. **Different lifecycle**:
 *      `toolSettingsStore` is global
 *      (toggles apply to all workspaces).
 *      `customToolsStore` is workspace-
 *      scoped (different repos have
 *      different custom tools). The
 *      `load(workspaceRoot)` action makes
 *      that explicit.
 *
 * ## `workspaceRoot` source
 *
 * The workspace root comes from the
 * workspace store (TBD — the
 * `gitOpen` IPC returns it on workspace
 * open; the AI store uses it for
 * `fsReadFile` and will pass it to
 * `customToolsStore.load` in 5c's
 * follow-up work). 5c's MVP doesn't
 * depend on the workspace store
 * directly — callers pass the root
 * explicitly to `load` / `save`.
 *
 * ## The "no file" state
 *
 * The Rust side's `read_lipi_tools`
 * returns an empty `LipiToolsFile` if
 * the file doesn't exist (it does NOT
 * propagate `NotFound` as an error).
 * This is the "first run" path: the
 * user opens a workspace, the file
 * doesn't exist yet, the store starts
 * with an empty list. The Settings
 * screen renders the empty state with
 * a "Create your first custom tool"
 * button.
 *
 * ## Concurrency / dirty state
 *
 * 5c doesn't do optimistic concurrency
 * (no in-memory dirty flag, no merge
 * logic on save). The store is the
 * single source of truth; every edit
 * writes the full file. A future
 * version can add an `fs2` advisory
 * lock on the Rust side to prevent
 * concurrent writes from external
 * editors (e.g. `vim` editing the
 * file while the user is editing in
 * the Settings UI).
 */

import { create } from 'zustand';

import { readLipiTools, writeLipiTools, type LipiToolEntry, type LipiToolsFile } from '@/ipc';
import { registerCustomTool } from '@/screens/EditorWorkspace/state/toolRegistry';

interface CustomToolsState {
  /** The in-memory list of custom tools.
   *  Indexed by `name` via `toolsByName`
   *  for O(1) lookup. */
  tools: LipiToolEntry[];

  /** The currently-open workspace root,
   *  or `null` if no workspace is open
   *  (or `load` hasn't been called yet).
   *  The Settings screen uses this to
   *  render "no workspace" vs "empty
   *  file" states differently. */
  workspaceRoot: string | null;

  /** The last error from `load` / `save`,
   *  or `null` if the last call
   *  succeeded. The Settings screen
   *  surfaces this as an `ErrorBanner`
   *  above the cards. The store does
   *  NOT clear the error automatically
   *  — it stays until the next
   *  successful call. */
  lastError: string | null;

  /** `true` once the in-memory `tools`
   *  reflect the on-disk state. The
   *  Settings screen uses this to avoid
   *  showing a "loading…" spinner after
   *  mount (we hydrate synchronously in
   *  `load` — the file is small). */
  loaded: boolean;

  /** `true` between `load` start and
   *  resolution. Currently the
   *  Settings screen doesn't need
   *  this (the load is fast enough
   *  to be effectively synchronous
   *  for the user) but the field is
   *  here for future async reads. */
  loading: boolean;

  /** `true` between `save` start and
   *  resolution. The Settings screen
   *  disables the Save button while
   *  this is true. */
  saving: boolean;

  /** Look up a tool by name. Returns
   *  `undefined` if the tool doesn't
   *  exist in the current set. */
  getTool: (name: string) => LipiToolEntry | undefined;

  /** Read the `lipi-tools.json` from
   *  the given workspace root and
   *  seed the in-memory `tools`. Also
   *  re-registers every tool with the
   *  JS `toolRegistry`. */
  load: (workspaceRoot: string) => Promise<void>;

  /** Add a new tool. The store
   *  auto-generates the file write
   *  (the in-memory list IS the
   *  source of truth — the file is
   *  just persistence). */
  addTool: (entry: LipiToolEntry) => Promise<void>;

  /** Update an existing tool (matched
   *  by `entry.name`). The previous
   *  entry is REPLACED, not merged —
   *  the user passes the full new
   *  entry. */
  updateTool: (entry: LipiToolEntry) => Promise<void>;

  /** Remove a tool by name. No-op if
   *  the tool doesn't exist. */
  removeTool: (name: string) => Promise<void>;

  /** Internal: write the in-memory
   *  list to the file. Called by
   *  `addTool` / `updateTool` /
   *  `removeTool`. Exposed publicly
   *  for tests. */
  save: () => Promise<void>;
}

/**
 * Lightweight validator for an entry
 * before we hand it to the Rust side
 * for `write_lipi_tools`. The Rust
 * side also validates, but doing it
 * client-side gives a faster error
 * response (no IPC round-trip on a
 * duplicate-name mistake) and lets
 * the editor surface a useful message
 * before the user closes the dialog.
 *
 * `siblings` should be the CURRENT
 * list of tools (NOT including the
 * entry being validated). The caller
 * is responsible for excluding the
 * entry's own name for the
 * `updateTool` case (so an
 * unchanged-name update doesn't
 * collide with itself).
 *
 * Returns `null` if the entry is
 * valid; otherwise an error message
 * suitable for surfacing in the UI.
 */
function validateEntry(
  entry: LipiToolEntry,
  siblings: LipiToolEntry[],
): string | null {
  if (!entry.name || entry.name.trim().length === 0) {
    return "Tool name is required.";
  }
  // Identifier shape — letters,
  // digits, underscores; must start
  // with a letter or underscore. This
  // matches what the JSON Schema
  // generator on the Rust side
  // accepts (and what the placeholder
  // substitution in `toolRegistry`
  // matches against). We don't
  // restrict length here (no reason
  // to — the schema accepts whatever
  // the user types).
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(entry.name)) {
    return `Tool name '${entry.name}' must be a valid identifier (letters, digits, underscores; must start with a letter or underscore).`;
  }
  if (entry.kind !== 'shell' && entry.kind !== 'http') {
    return `Tool kind must be 'shell' or 'http' (got '${entry.kind}').`;
  }
  // Kind-specific required fields.
  if (entry.kind === 'shell' && (!entry.command || entry.command.trim().length === 0)) {
    return "Shell tools require a 'command' field.";
  }
  if (entry.kind === 'http' && (!entry.url || entry.url.trim().length === 0)) {
    return "HTTP tools require a 'url' field.";
  }
  // Duplicate-name check. For
  // `addTool` (`isNew: true`),
  // every duplicate is a hard
  // error. For `updateTool`
  // (`isNew: false`), we already
  // pre-filtered `siblings` to
  // exclude the entry's own name
  // (see `updateTool` below), so
  // any remaining match IS a
  // collision with a different
  // tool.
  const dupes = siblings.filter((s) => s.name === entry.name);
  if (dupes.length > 0) {
    return `Tool name '${entry.name}' is already used by another tool.`;
  }
  return null;
}

export const useCustomToolsStore = create<CustomToolsState>((set, get) => ({
  tools: [],
  workspaceRoot: null,
  lastError: null,
  loaded: false,
  loading: false,
  saving: false,

  getTool: (name) => get().tools.find((t) => t.name === name),

  load: async (workspaceRoot) => {
    set({ loading: true, lastError: null, workspaceRoot });
    try {
      const file: LipiToolsFile = await readLipiTools(workspaceRoot);
      set({ tools: file.tools, loaded: true, loading: false });
      // Re-register every tool with the
      // registry. This is a full
      // re-register (not a delta) — the
      // store is the source of truth, so
      // any drift between the registry
      // and the file is corrected by
      // this load.
      for (const entry of file.tools) {
        registerCustomTool(entry);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      set({
        lastError: `Failed to load lipi-tools.json: ${message}`,
        loaded: true, // mark loaded so the UI doesn't loop on "loading…"
        loading: false,
      });
    }
  },

  addTool: async (entry) => {
    const err = validateEntry(entry, get().tools);
    if (err) {
      set({ lastError: err });
      throw new Error(err);
    }
    set((s) => ({ tools: [...s.tools, entry], lastError: null }));
    // The tool becomes callable
    // immediately (the registry
    // doesn't wait for the file
    // write). If the save fails, the
    // next `load` will re-derive the
    // correct state.
    registerCustomTool(entry);
    await get().save();
  },

  updateTool: async (entry) => {
    // For an update, we pre-filter the
    // sibling list to exclude the
    // entry's own name — a rename
    // that doesn't collide is fine.
    // We then pass `isNew: false` to
    // the validator so a name that
    // *is* in `siblings` (after the
    // filter) is the only thing
    // that triggers a duplicate
    // error.
    const siblings = get().tools.filter((t) => t.name !== entry.name);
    const err = validateEntry(entry, siblings);
    if (err) {
      set({ lastError: err });
      throw new Error(err);
    }
    set((s) => ({
      tools: s.tools.map((t) => (t.name === entry.name ? entry : t)),
      lastError: null,
    }));
    registerCustomTool(entry);
    await get().save();
  },

  removeTool: async (name) => {
    // Short-circuit if the name
    // isn't in the current set —
    // removes should be idempotent
    // and not write the file when
    // nothing changed.
    const before = get().tools;
    const after = before.filter((t) => t.name !== name);
    if (before.length === after.length) {
      return;
    }
    set({ tools: after, lastError: null });
    // We don't have a "deregister" in
    // the registry — the tool stays
    // registered but the store no
    // longer returns it. To make the
    // "removed" state observable, we
    // also re-register every remaining
    // tool (a no-op for them, but
    // ensures the registry reflects
    // the on-disk state).
    for (const entry of get().tools) {
      registerCustomTool(entry);
    }
    await get().save();
  },

  save: async () => {
    const root = get().workspaceRoot;
    if (!root) {
      const message = 'No workspace open — cannot save lipi-tools.json.';
      set({ lastError: message });
      throw new Error(message);
    }
    set({ saving: true, lastError: null });
    try {
      const file: LipiToolsFile = {
        version: 1,
        tools: get().tools,
      };
      await writeLipiTools(root, file);
      set({ saving: false });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      set({ lastError: `Failed to save lipi-tools.json: ${message}`, saving: false });
      throw e;
    }
  },
}));

/**
 * Hydration hook (5c). 5c doesn't
 * auto-load on app start (the
 * workspace is opened lazily). The
 * caller (currently the Settings
 * screen's `useEffect` mount) calls
 * `load(workspaceRoot)` when it has
 * a workspace to load from.
 */
export async function setupCustomToolsPersistence(workspaceRoot: string): Promise<void> {
  await useCustomToolsStore.getState().load(workspaceRoot);
}
