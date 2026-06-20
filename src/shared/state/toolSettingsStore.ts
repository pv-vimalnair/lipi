/**
 * ToolSettings — the source of truth for which
 * built-in tools the user has enabled (5b-7)
 * + the per-tool invocation policy (5d).
 *
 * The store holds two things:
 *   1. `disabledToolNames` — the negative
 *      set of tools the user has turned off
 *      (5b-7).
 *   2. `confirmationMode` — a per-tool
 *      invocation policy that gates the
 *      executor with a user prompt (5d).
 *      `always_confirm` is the default;
 *      silent execution is an explicit
 *      per-tool opt-in.
 *
 * ## Why a separate store from `aiStore`?
 *
 * Three reasons:
 *   1. **Lifecycle independence**: the user
 *      may toggle tools while no AI request
 *      is in flight (e.g. they disabled
 *      `get_file_contents` in the morning and
 *      are writing code in the afternoon). The
 *      settings need to persist across
 *      `clearMessages` and screen navigations.
 *   2. **Shared by the AI store and the
 *      Settings screen**: a screen-local
 *      store (per Rule 3) would force the AI
 *      store to import the Settings screen's
 *      store, breaking section isolation.
 *   3. **localStorage round-trip**: the user
 *      expects "I disabled this last session,
 *      it's still disabled" — the persistence
 *      layer is a side effect, not the main
 *      state, so a dedicated store is the
 *      cleanest place to put it.
 *
 * ## Persistence + migration
 *
 * The store persists to `localStorage` under
 * the key `lipi:toolSettings:v2` (5d). v1 had
 * only `disabledToolNames`; 5d added
 * `confirmationMode`, so we bumped the key
 * and added a forward-migration in
 * `hydrate()`: if v2 is absent but v1 is
 * present, copy the disabled set into v2 with
 * an empty `confirmationMode` and leave v1
 * intact (no destructive delete — easier to
 * roll back if a regression surfaces).
 *
 * We do the round-trip with a `subscribe`
 * (NOT a Zustand `persist` middleware) so the
 * storage format is versioned and the
 * hydration is explicit. The "v2" suffix
 * gives us an upgrade path for 5d+ — a
 * future v3 would read v2 + transform.
 *
 * Persistence is a "best effort" — failures
 * (Safari private mode, quota exceeded) are
 * caught and logged to `console.warn`. The
 * in-memory state still works; the user's
 * settings just don't survive a page reload.
 *
 * ## The "all enabled" + "confirm before running" defaults
 *
 * On a fresh install, the store seeds itself
 * with `disabledToolNames: []` and
 * `confirmationMode: {}`. The
 * `isEnabled(name)` selector returns `true`
 * for any tool not in the disabled set; the
 * `getConfirmationMode(name)` selector
 * returns `'always_confirm'` for any tool
 * not in the map. That keeps newly-added
 * built-in and custom tools behind an
 * explicit user decision until the user
 * opts a specific tool into silent runs.
 *
 * ## Tool names
 *
 * The tool name strings are the same ones
 * used as map keys in the JS `toolRegistry`
 * (e.g. `'get_file_contents'`). They match
 * the `name` field of the Rust
 * `TOOL_CATALOGUE` entries exactly — the
 * Settings screen shows the description
 * (from the JS `RegisteredTool.description`)
 * and the controls are bound to the name.
 * The Rust side never sees the JS
 * description; the descriptions are UI-only.
 *
 * 5c added custom user-defined tools — they
 * register with the same `registerTool` API
 * and the Settings screen picks them up
 * automatically (the Settings section
 * iterates `listTools()` from the JS
 * `toolRegistry`). The confirmation policy
 * applies to them too — a `run_npm_deploy`
 * shell tool defaults to `'always_confirm'`
 * just like a built-in, and the user can
 * set it to `'always_allow'` from the same
 * Settings card.
 */

import { create } from 'zustand';
import type { ExportedToolSettings } from '@/shared/settingsIO';

const STORAGE_KEY = 'lipi:toolSettings:v2';
/** v1 is read on the 5d migration but never
 *  written or deleted — leaving it in place
 *  makes the migration reversible (a v1
 *  reader can still load the old state). */
const STORAGE_KEY_V1 = 'lipi:toolSettings:v1';
/** 5a: soft-delete undo buffer. When
 *  `clearAllSettings()` is called, the
 *  pre-clear state is copied here
 *  (to localStorage, NOT just in-memory
 *  — see below for the rationale).
 *  A subsequent `undoClearAllSettings()`
 *  restores from this buffer and deletes
 *  the buffer; `discardUndoAllSettings()`
 *  drops the buffer.
 *
 *  Why localStorage (not in-memory like
 *  the 5h decision log):
 *
 *  Tool settings are persistent — a
 *  page reload during the 5-second
 *  undo window should NOT silently
 *  drop the clear (the user took
 *  an explicit action; we honour
 *  it). With in-memory, a reload
 *  would restore the old settings
 *  AND drop the undo buffer — the
 *  user's "I just reset this"
 *  intent is lost. localStorage
 *  keeps the clear effect AND
 *  the undo buffer across reloads
 *  (the toast UI is gone after a
 *  reload, but `undoClearAllSettings`
 *  can still be called from the
 *  settings store on the next
 *  render). The 5s UI timer is
 *  still the "auto-commit"
 *  signal — after 5s the UI
 *  discards the undo buffer.
 *
 *  Cost: one extra `setItem` per
 *  clear (a few hundred bytes).
 *  The cost of an in-memory
 *  alternative (silent loss
 *  of the reset on reload) is
 *  worse. */
const STORAGE_KEY_UNDO = 'lipi:toolSettings:undo:v1';

/** The three policies. The numeric value is
 *  not exposed to the wire; we only ever
 *  compare against the string union. */
export type ConfirmationMode =
  | 'always_allow'
  | 'always_confirm'
  | 'per_call';

/** The default policy applied to any tool
 *  not in `confirmationMode`. Picked for
 *  least privilege: the model can propose
 *  a tool call, but the user approves it
 *  before it touches files, processes, or
 *  the network. */
const DEFAULT_CONFIRMATION_MODE: ConfirmationMode = 'always_confirm';

interface PersistedStateV1 {
  disabledToolNames: string[];
}

interface PersistedStateV2 {
  disabledToolNames: string[];
  /** Per-tool policy. Tools not in the
   *  map use `DEFAULT_CONFIRMATION_MODE`
   *  (currently `'always_confirm'`). */
  confirmationMode: Record<string, ConfirmationMode>;
}

/** Strict runtime check for a `ConfirmationMode`
 *  value. Defends against a v1 file with
 *  a junk value getting into the map. */
function isConfirmationMode(v: unknown): v is ConfirmationMode {
  return (
    v === 'always_allow' ||
    v === 'always_confirm' ||
    v === 'per_call'
  );
}

function loadFromStorage(): PersistedStateV2 | null {
  if (typeof localStorage === 'undefined') return null;
  // 5d: read v2 first; if absent, attempt
  // a v1 → v2 migration.
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'disabledToolNames' in parsed &&
        Array.isArray((parsed as PersistedStateV2).disabledToolNames) &&
        (parsed as PersistedStateV2).disabledToolNames.every(
          (n) => typeof n === 'string',
        ) &&
        'confirmationMode' in parsed &&
        typeof (parsed as PersistedStateV2).confirmationMode === 'object' &&
        (parsed as PersistedStateV2).confirmationMode !== null &&
        Object.values((parsed as PersistedStateV2).confirmationMode).every(
          isConfirmationMode,
        )
      ) {
        return parsed as PersistedStateV2;
      }
      // v2 present but malformed — fall
      // through to defaults. We do NOT
      // delete a malformed v2 (a future
      // debugging session may want to see
      // it).
      return null;
    }
    // No v2 — try v1.
    const rawV1 = localStorage.getItem(STORAGE_KEY_V1);
    if (!rawV1) return null;
    const parsedV1 = JSON.parse(rawV1) as unknown;
    if (
      typeof parsedV1 === 'object' &&
      parsedV1 !== null &&
      'disabledToolNames' in parsedV1 &&
      Array.isArray((parsedV1 as PersistedStateV1).disabledToolNames) &&
      (parsedV1 as PersistedStateV1).disabledToolNames.every(
        (n) => typeof n === 'string',
      )
    ) {
      return {
        disabledToolNames: (parsedV1 as PersistedStateV1).disabledToolNames,
        confirmationMode: {},
      };
    }
    return null;
  } catch {
    return null;
  }
}

function saveToStorage(state: PersistedStateV2): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    // Quota / private-mode failures are
    // non-fatal. The in-memory state still
    // works; the user's choices just don't
    // survive a reload.
    console.warn('[toolSettings] failed to persist:', e);
  }
}

/**
 * 5b: shared helper for the
 * replace-with-undo pattern. Used by
 * `clearAllSettings` (5a) and
 * `applyImportedSettings` (5b) — both
 * actions snapshot the pre-change state
 * to the undo buffer, then flip the
 * live state. Kept as a module-level
 * function (not a closure) so it's
 * testable in isolation and so the two
 * callers stay in lock-step.
 *
 * `set` and `get` are passed in (not
 * closed over) so this can be called
 * from inside the `create((set, get)
 * => ({ ... }))` object literal.
 */
function replaceWithUndo(
  get: () => ToolSettingsState,
  set: (
    partial:
      | Partial<ToolSettingsState>
      | ((state: ToolSettingsState) => Partial<ToolSettingsState>),
  ) => void,
  next: ExportedToolSettings,
): void {
  const s = get();
  // Snapshot the pre-change state.
  // Same shape we persist in the
  // main key — symmetric, easy to
  // round-trip.
  const snapshot: PersistedStateV2 = {
    disabledToolNames: s.disabledToolNames,
    confirmationMode: s.confirmationMode,
  };
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_UNDO, JSON.stringify(snapshot));
    }
  } catch (e) {
    // localStorage failure on a
    // non-critical path — log and
    // continue. The replace still
    // takes effect in-memory and
    // will be re-attempted on every
    // subsequent save. The user
    // simply won't be able to undo
    // (no buffer).
    console.warn('[toolSettings] failed to write undo buffer:', e);
  }
  // Apply the new state. Persistence
  // is wired below `subscribe` — the
  // next render triggers a save with
  // the new value.
  set({
    disabledToolNames: next.disabledToolNames,
    confirmationMode: next.confirmationMode,
    pendingUndo: true,
  });
}

interface ToolSettingsState {
  /** Set of tool names the user has DISABLED.
   *  All other registered tools are enabled. */
  disabledToolNames: string[];
  /** Per-tool invocation policy. Tools not in
   *  the map use `DEFAULT_CONFIRMATION_MODE`
   *  (`'always_confirm'`). */
  confirmationMode: Record<string, ConfirmationMode>;
  /** True once we've attempted the localStorage
   *  hydration. The Settings screen can use this
   *  to avoid a "flash of defaults" on mount
   *  (currently the defaults are the same as
   *  the persisted state would be, so no flash;
   *  this flag is here for future use). */
  hydrated: boolean;
  /** 5a: `true` while a clear is pending
   *  review (the 5s undo window). Cleared
   *  by `discardUndoAllSettings()` or
   *  `undoClearAllSettings()`. Hydrated
   *  from the undo buffer on startup. */
  pendingUndo: boolean;

  /** Whether the named tool is currently enabled. */
  isEnabled: (name: string) => boolean;

  /** Look up the policy for a tool. Tools
   *  not in the map return the default
   *  (`'always_confirm'`). */
  getConfirmationMode: (name: string) => ConfirmationMode;

  /** 5d: pure predicate consulted by the
   *  AI store's tool-loop. Returns `true`
   *  if the call should be parked behind a
   *  user prompt. `confirmedForRound` is a
   *  one-shot flag the caller passes for
   *  the `per_call` policy: if the user
   *  already approved this exact call once
   *  this round, the predicate returns
   *  `false`. */
  shouldConfirm: (
    name: string,
    confirmedForRound: boolean,
  ) => boolean;

  /** Enable a tool (no-op if already enabled). */
  setEnabled: (name: string, enabled: boolean) => void;

  /** Set the policy for a tool. If `mode`
   *  equals the default, the entry is
   *  removed from the map (keeps the
   *  persisted JSON small). */
  setConfirmationMode: (name: string, mode: ConfirmationMode) => void;

  /** Bulk enable all known tools (clear the
   *  disabled set). */
  enableAll: () => void;

  /** Bulk disable the named set (the user
   *  passes the names to disable). Tools not
   *  in the argument are left unchanged. */
  disableMany: (names: string[]) => void;

  /** Internal: hydrate from localStorage.
   *  Called once at app startup. */
  hydrate: () => void;

  /** 5a: soft-delete every tool setting.
   *  Mirrors 5h's decision-log pattern:
   *  the pre-clear snapshot is stashed
   *  in `lipi:toolSettings:undo:v1` so
   *  the user can `undoClearAllSettings()`
   *  within the UI's 5s window. The
   *  clear itself writes the empty
   *  state to the main storage key
   *  immediately (the user took
   *  an explicit action — we honour
   *  it across reloads).
   *
   *  No-op if the current state is
   *  already empty (nothing to
   *  undo). */
  clearAllSettings: () => void;

  /** 5a: restore the pre-clear snapshot
   *  from the undo buffer. No-op if
   *  the buffer is empty (clear
   *  already committed or never
   *  happened). */
  undoClearAllSettings: () => void;

  /** 5a: drop the undo buffer. Called
   *  by the UI's 5s timer when the
   *  user doesn't click "Undo". */
  discardUndoAllSettings: () => void;

  /** 5a: selector for the undo buffer.
   *  `true` means there is a clear
   *  pending review. The Settings
   *  screen uses this to show the
   *  undo toast. */
  hasPendingUndo: () => boolean;

  /** 5b: apply an imported tool-settings
   *  payload (from a parsed export file).
   *  Replace semantics, with the 5a
   *  soft-delete + 5s-undo pattern
   *  wrapping the write. The caller
   *  is responsible for having
   *  validated the payload via
   *  `parseSettingsFile()` first. */
  applyImportedSettings: (imported: ExportedToolSettings) => void;
}

export const useToolSettingsStore = create<ToolSettingsState>((set, get) => ({
  disabledToolNames: [],
  confirmationMode: {},
  hydrated: false,
  pendingUndo: false,

  isEnabled: (name) => !get().disabledToolNames.includes(name),

  getConfirmationMode: (name) => {
    const mode = get().confirmationMode[name];
    return mode ?? DEFAULT_CONFIRMATION_MODE;
  },

  shouldConfirm: (name, confirmedForRound) => {
    // Disabled tools are gated separately
    // by the AI store's `isEnabled` check;
    // we don't double-prompt here.
    if (!get().isEnabled(name)) return false;
    const mode = get().confirmationMode[name] ?? DEFAULT_CONFIRMATION_MODE;
    switch (mode) {
      case 'always_allow':
        return false;
      case 'always_confirm':
        return true;
      case 'per_call':
        // The round-keyed flag is the
        // "user already approved this
        // exact call once in the current
        // round" signal. We treat the
        // call as already-confirmed;
        // a subsequent round re-prompts.
        return !confirmedForRound;
    }
  },

  setEnabled: (name, enabled) => {
    set((s) => {
      const currentlyDisabled = s.disabledToolNames.includes(name);
      if (enabled && currentlyDisabled) {
        // Enable: remove from disabled set.
        return { disabledToolNames: s.disabledToolNames.filter((n) => n !== name) };
      }
      if (!enabled && !currentlyDisabled) {
        // Disable: add to disabled set.
        return { disabledToolNames: [...s.disabledToolNames, name] };
      }
      // No-op: already in the desired state.
      return s;
    });
  },

  setConfirmationMode: (name, mode) => {
    set((s) => {
      // If the new mode is the default,
      // drop the entry from the map to
      // keep the persisted JSON small.
      if (mode === DEFAULT_CONFIRMATION_MODE) {
        if (!(name in s.confirmationMode)) return s;
        const { [name]: _drop, ...rest } = s.confirmationMode;
        return { confirmationMode: rest };
      }
      // Otherwise set / overwrite.
      if (s.confirmationMode[name] === mode) return s;
      return {
        confirmationMode: {
          ...s.confirmationMode,
          [name]: mode,
        },
      };
    });
  },

  enableAll: () => {
    set({ disabledToolNames: [] });
  },

  disableMany: (names) => {
    set((s) => {
      const set_ = new Set(s.disabledToolNames);
      for (const n of names) set_.add(n);
      return { disabledToolNames: Array.from(set_) };
    });
  },

  hydrate: () => {
    if (get().hydrated) return;
    const persisted = loadFromStorage();
    // 5a: also read the undo buffer so a
    // page reload during the 5s window
    // keeps the toast showing (and
    // preserves the buffer the user
    // can still click "Undo" against).
    // No timer survives a reload — the
    // UI re-arms the 5s on mount.
    let pendingUndo = false;
    if (typeof localStorage !== 'undefined') {
      pendingUndo = localStorage.getItem(STORAGE_KEY_UNDO) !== null;
    }
    set({
      disabledToolNames: persisted?.disabledToolNames ?? [],
      confirmationMode: persisted?.confirmationMode ?? {},
      hydrated: true,
      pendingUndo,
    });
  },

  // 5a: soft-delete + undo for "Reset all
  // tool settings". See the action-level
  // JSDoc above and the STORAGE_KEY_UNDO
  // header for the rationale on the
  // localStorage-backed undo buffer.
  //
  // 5b: the same replace-with-undo
  // pattern is reused by
  // `applyImportedSettings`. Both
  // actions (a) snapshot the pre-
  // change state to the undo buffer,
  // (b) flip the live state to the
  // new value, (c) set `pendingUndo:
  // true` so the UI shows the 5s
  // toast. The shared helper
  // `replaceWithUndo` (declared
  // below as a closure that captures
  // `get`/`set`) keeps the two
  // callers in lock-step.

  /**
   * 5b: apply an imported tool-settings
   * payload (from a parsed export file)
   * to the live state. Replace
   * semantics, with the 5a soft-delete
   * + 5s-undo pattern wrapping the
   * write — the pre-import state is
   * stashed in `lipi:toolSettings:undo:v1`
   * so the user can `undoClearAllSettings()`
   * within the 5s window.
   *
   * The caller (UI) is responsible for
   * having validated the payload via
   * `parseSettingsFile()` first. This
   * action assumes the input is
   * well-formed. (The validation in
   * `loadFromStorage` would catch any
   * slip-through, but the caller should
   * not pass garbage here.)
   *
   * No-op semantics: if the imported
   * payload equals the current state,
   * the action is a no-op (no undo
   * toast). Rationale: if a user
   * imports their own exported
   * settings on the same machine,
   * the import is functionally a
   * no-op and the undo toast would
   * be confusing.
   */
  applyImportedSettings: (imported: ExportedToolSettings) => {
    const s = get();
    // Skip the undo dance if the import
    // is a no-op. Deep-equal on the
    // two fields. `confirmationMode`
    // is a plain Record — we can't
    // rely on reference equality, so
    // we compare key sets + values.
    if (imported.disabledToolNames.length === s.disabledToolNames.length) {
      const sameDisabled = imported.disabledToolNames.every(
        (n, i) => n === s.disabledToolNames[i],
      );
      const sameMode =
        Object.keys(imported.confirmationMode).length ===
          Object.keys(s.confirmationMode).length &&
        Object.entries(imported.confirmationMode).every(
          ([k, v]) => s.confirmationMode[k] === v,
        );
      if (sameDisabled && sameMode) return;
    }
    // The shared `replaceWithUndo`
    // helper handles the
    // snapshot-then-write dance.
    replaceWithUndo(get, set, imported);
  },

  clearAllSettings: () => {
    const s = get();
    // No-op if there's nothing to clear —
    // we don't want a "Reset" button to
    // pop an empty undo toast and confuse
    // the user.
    if (s.disabledToolNames.length === 0) {
      // But if `confirmationMode` has
      // non-default entries, those are
      // also worth clearing. So check
      // both before returning.
      const hasAny = Object.values(s.confirmationMode).some(
        (m) => m !== DEFAULT_CONFIRMATION_MODE,
      );
      if (!hasAny) return;
    }
    // Stash the pre-clear snapshot in
    // the undo buffer + flip the live
    // state. Shared with
    // `applyImportedSettings` (5b)
    // via the `replaceWithUndo`
    // module-level helper.
    replaceWithUndo(get, set, {
      disabledToolNames: [],
      confirmationMode: {},
    });
  },

  undoClearAllSettings: () => {
    if (typeof localStorage === 'undefined') {
      // No storage — nothing to undo.
      set({ pendingUndo: false });
      return;
    }
    const raw = localStorage.getItem(STORAGE_KEY_UNDO);
    if (!raw) {
      // No buffer — the clear was
      // already committed (5s timer
      // ran) or never happened.
      set({ pendingUndo: false });
      return;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'disabledToolNames' in parsed &&
        Array.isArray((parsed as PersistedStateV2).disabledToolNames) &&
        (parsed as PersistedStateV2).disabledToolNames.every(
          (n) => typeof n === 'string',
        ) &&
        'confirmationMode' in parsed &&
        typeof (parsed as PersistedStateV2).confirmationMode === 'object' &&
        (parsed as PersistedStateV2).confirmationMode !== null &&
        Object.values((parsed as PersistedStateV2).confirmationMode).every(
          isConfirmationMode,
        )
      ) {
        // Restore + drop the buffer.
        // The `subscribe` save will
        // overwrite the main key on
        // the next render.
        set({
          disabledToolNames: (parsed as PersistedStateV2).disabledToolNames,
          confirmationMode: (parsed as PersistedStateV2).confirmationMode,
          pendingUndo: false,
        });
        localStorage.removeItem(STORAGE_KEY_UNDO);
        return;
      }
      // Malformed buffer — drop it
      // defensively. We do NOT
      // auto-restore junk; the user
      // gets a "reset" effect.
      console.warn('[toolSettings] malformed undo buffer — dropping');
      localStorage.removeItem(STORAGE_KEY_UNDO);
      set({ pendingUndo: false });
    } catch (e) {
      // JSON parse failure —
      // same defensive drop.
      console.warn('[toolSettings] undo buffer parse failed:', e);
      localStorage.removeItem(STORAGE_KEY_UNDO);
      set({ pendingUndo: false });
    }
  },

  discardUndoAllSettings: () => {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY_UNDO);
    }
    set({ pendingUndo: false });
  },

  hasPendingUndo: () => get().pendingUndo,
}));

// Wire up persistence: every state change
// (after the initial hydration) writes to
// localStorage. The `hydrated` flag guards
// against the hydration itself triggering a
// redundant write.
let persistenceSubscribed = false;
export function setupToolSettingsPersistence(): void {
  if (persistenceSubscribed) return;
  persistenceSubscribed = true;
  useToolSettingsStore.subscribe((state) => {
    if (!state.hydrated) return;
    saveToStorage({
      disabledToolNames: state.disabledToolNames,
      confirmationMode: state.confirmationMode,
    });
  });
}

/** Selectors — keep these tiny so components can compose them. */
export const toolSettingsSelectors = {
  disabledToolNames: (s: ToolSettingsState) => s.disabledToolNames,
  confirmationMode: (s: ToolSettingsState) => s.confirmationMode,
  isEnabled: (s: ToolSettingsState, name: string) => !s.disabledToolNames.includes(name),
  getConfirmationMode: (
    s: ToolSettingsState,
    name: string,
  ): ConfirmationMode =>
    s.confirmationMode[name] ?? DEFAULT_CONFIRMATION_MODE,
  shouldConfirm: (
    s: ToolSettingsState,
    name: string,
    confirmedForRound: boolean,
  ) => {
    if (s.disabledToolNames.includes(name)) return false;
    const mode = s.confirmationMode[name] ?? DEFAULT_CONFIRMATION_MODE;
    switch (mode) {
      case 'always_allow':
        return false;
      case 'always_confirm':
        return true;
      case 'per_call':
        return !confirmedForRound;
    }
  },
};
