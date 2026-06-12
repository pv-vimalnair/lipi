/**
 * Settings import / export — 5b.
 *
 * The user can take a snapshot of their local
 * tool settings (which tools are disabled, and
 * their per-tool confirmation policy) to a
 * JSON file, and import one back. The point is
 * portability across machines — e.g. a user
 * configures their policies on a desktop, dumps
 * them to a `lipi-settings.json` in a USB stick,
 * copies to a laptop, imports.
 *
 * ## Scope — what is and isn't in the file
 *
 * Only the **tool settings** are exported. Three
 * things are intentionally NOT:
 *
 *   1. `toolDecisionLogStore`
 *      (`lipi:toolDecisionLog:v1`). The
 *      activity log is a per-machine audit
 *      trail. Sharing it (or even restoring it
 *      to a different machine) would conflate
 *      "what the model did here" with "what
 *      the model did there". The user
 *      explicitly asked for "settings" — the
 *      log isn't a setting.
 *   2. `deviceEmulatorStore`
 *      (`lipi:dev:deviceEmulator:v1`,
 *      sessionStorage). Dev-only, session-only.
 *      Not a setting.
 *   3. The `lipi:toolSettings:undo:v1` undo
 *      buffer from 5a. It's transient recovery
 *      state — the "Reset all" soft-delete
 *      snapshot. If the user exported while
 *      an undo was pending, importing the
 *      file on another machine would carry a
 *      stale buffer that doesn't correspond
 *      to anything on that machine. Drop it.
 *
 * The OS-keychain API keys are obviously NOT
 * included — they're not even in JS.
 *
 * ## File format
 *
 * A schema-versioned wrapper around the data
 * payload. The format is self-describing so a
 * future Lipi version (or a third-party tool)
 * can identify the file even if the data
 * shape changes:
 *
 *   {
 *     "format": "lipi-settings",
 *     "version": 1,
 *     "exportedAt": "2026-06-11T14:30:00.000Z",
 *     "data": {
 *       "toolSettings": {
 *         "disabledToolNames": [...],
 *         "confirmationMode": {...}
 *       }
 *     }
 *   }
 *
 * `format` is a magic string. We refuse to
 * parse anything that doesn't have it (a user
 * accidentally picking the wrong file is the
 * main risk; the magic string is the guard).
 *
 * `version` is a monotonically increasing
 * integer. The current parser only knows how
 * to read `version: 1`. A future v2 file would
 * either be read by a future parser (forward
 * compat) or rejected with a "this file is
 * from a newer Lipi" error.
 *
 * `exportedAt` is informational only. The
 * parser does NOT use it for anything (we
 * could check "is this older than the local
 * state?" but that's a UX feature, not a
 * correctness one).
 *
 * `data` is the only field the parser reads.
 * New keys can be added to `data` in future
 * versions without bumping `version` (the
 * parser only reads the keys it knows).
 *
 * ## Import semantics
 *
 * Import is **replace**, not merge. The user
 * is transferring a known-good configuration
 * (probably their own, exported on another
 * machine). Merge would silently combine
 * per-tool entries from two sources, which is
 * surprising — "I imported my desktop's
 * settings, why is `run_npm_test` still
 * showing my old policy?".
 *
 * Import is destructive (it overwrites local
 * state), so the UI surfaces it through the
 * Danger Zone and wraps the actual write in
 * the 5a soft-delete + 5s-undo pattern. The
 * pre-import state goes into the existing
 * `lipi:toolSettings:undo:v1` buffer; the UI
 * can `undoClearAllSettings()` to restore
 * it.
 *
 * ## Why a separate module from the store?
 *
 * The store owns "what is the current state".
 * This module owns "how do you read / write it
 * to a file". The store shouldn't know about
 * `Blob`s, `<a download>` links, or
 * schema-versioned wrappers — those are IO
 * concerns. Conversely, this module doesn't
 * touch `localStorage` (the store does that)
 * or the live store state (the caller does
 * that). This split keeps both sides
 * testable: the store is a pure-state machine,
 * this module is a pure-function IO
 * library.
 */

import type { ConfirmationMode } from '@/shared/state/toolSettingsStore';

/** Bump this when the on-disk shape changes
 *  in a breaking way. A v2 file would either
 *  be read by a future parser (forward
 *  compat) or rejected with a clear error. */
export const SETTINGS_FILE_VERSION = 1;

/** Magic string. Identifies "this is a Lipi
 *  settings file" without trusting the
 *  extension. We refuse to parse anything
 *  that doesn't have it. */
export const SETTINGS_FILE_FORMAT = 'lipi-settings';

/** Tool-settings payload — the same shape
 *  `toolSettingsStore` persists under
 *  `lipi:toolSettings:v2`. Re-declared here
 *  (not imported from the store) so the
 *  IO module doesn't pull the whole
 *  Zustand runtime into a test that
 *  only cares about JSON shape. */
export interface ExportedToolSettings {
  disabledToolNames: string[];
  confirmationMode: Record<string, ConfirmationMode>;
}

/** The `data` block of an export file. New
 *  keys can be added here in future
 *  versions without bumping
 *  `SETTINGS_FILE_VERSION` — the parser
 *  only reads the keys it knows. */
export interface SettingsFileData {
  toolSettings: ExportedToolSettings;
}

/** The full file shape. */
export interface SettingsFile {
  format: typeof SETTINGS_FILE_FORMAT;
  version: typeof SETTINGS_FILE_VERSION;
  /** ISO-8601 timestamp. Informational
   *  only — the parser does NOT use
   *  it. */
  exportedAt: string;
  data: SettingsFileData;
}

/** Result of attempting to parse a
 *  settings file. Tagged union so the
 *  UI can show a specific error
 *  message instead of a generic
 *  "bad file" toast. */
export type ParseResult =
  | { ok: true; data: ExportedToolSettings }
  | { ok: false; error: ParseError };

export type ParseError =
  | { kind: 'not-json'; message: string }
  | { kind: 'wrong-shape'; message: string }
  | { kind: 'wrong-format'; message: string }
  | { kind: 'unsupported-version'; message: string }
  | { kind: 'invalid-data'; message: string };

/** Strict runtime check for a
 *  `ConfirmationMode` value. Mirrors
 *  the one in `toolSettingsStore`
 *  (deliberately duplicated — keep
 *  the IO module free of runtime
 *  dependencies on the store). */
function isConfirmationMode(v: unknown): v is ConfirmationMode {
  return (
    v === 'always_allow' ||
    v === 'always_confirm' ||
    v === 'per_call'
  );
}

/** Validate an `ExportedToolSettings`
 *  payload. Returns the (typed) value
 *  if valid, or throws. Used by the
 *  parser after it's confirmed the
 *  shape and version. */
function validateToolSettings(
  raw: unknown,
  path: string,
): ExportedToolSettings {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${path} is not an object`);
  }
  const r = raw as Record<string, unknown>;
  // disabledToolNames: string[]
  if (!('disabledToolNames' in r)) {
    throw new Error(`${path}.disabledToolNames is missing`);
  }
  if (!Array.isArray(r.disabledToolNames)) {
    throw new Error(`${path}.disabledToolNames is not an array`);
  }
  if (!r.disabledToolNames.every((n) => typeof n === 'string')) {
    throw new Error(`${path}.disabledToolNames contains non-strings`);
  }
  // confirmationMode: Record<string, ConfirmationMode>
  if (!('confirmationMode' in r)) {
    throw new Error(`${path}.confirmationMode is missing`);
  }
  if (typeof r.confirmationMode !== 'object' || r.confirmationMode === null) {
    throw new Error(`${path}.confirmationMode is not an object`);
  }
  const cm = r.confirmationMode as Record<string, unknown>;
  for (const [tool, mode] of Object.entries(cm)) {
    if (!isConfirmationMode(mode)) {
      throw new Error(
        `${path}.confirmationMode.${tool} has invalid value ${JSON.stringify(mode)}`,
      );
    }
  }
  return {
    disabledToolNames: r.disabledToolNames as string[],
    confirmationMode: cm as Record<string, ConfirmationMode>,
  };
}

/** Parse a settings file (the result of
 *  `FileReader.readAsText` on a user-
 *  picked `.json`).
 *
 *  Returns a tagged union. We deliberately
 *  don't throw — the UI needs to show
 *  a specific error to the user, and
 *  "the file is bad" via `try/catch` is
 *  a worse UX than a discriminated
 *  union. */
export function parseSettingsFile(text: string): ParseResult {
  // 1. JSON parse.
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return {
      ok: false,
      error: {
        kind: 'not-json',
        message:
          e instanceof Error
            ? `Not valid JSON: ${e.message}`
            : 'Not valid JSON',
      },
    };
  }
  // 2. Top-level shape: object with the
  //    four known fields.
  if (typeof raw !== 'object' || raw === null) {
    return {
      ok: false,
      error: {
        kind: 'wrong-shape',
        message: 'Top-level value is not an object',
      },
    };
  }
  const r = raw as Record<string, unknown>;
  if (r.format !== SETTINGS_FILE_FORMAT) {
    return {
      ok: false,
      error: {
        kind: 'wrong-format',
        message: `Not a Lipi settings file (expected format "${SETTINGS_FILE_FORMAT}", got ${JSON.stringify(r.format)})`,
      },
    };
  }
  if (typeof r.version !== 'number' || !Number.isInteger(r.version)) {
    return {
      ok: false,
      error: {
        kind: 'wrong-shape',
        message: 'version is missing or not an integer',
      },
    };
  }
  if (r.version > SETTINGS_FILE_VERSION) {
    return {
      ok: false,
      error: {
        kind: 'unsupported-version',
        message: `File is from a newer Lipi (version ${r.version}, this build understands up to ${SETTINGS_FILE_VERSION})`,
      },
    };
  }
  if (r.version < SETTINGS_FILE_VERSION) {
    // Old file — attempt a forward-
    // compat read. v1 is the only
    // version we ship today, so this
    // branch is dead code for now
    // but is here for the future
    // when v2 lands. The pattern is:
    //   v1 → read as-is
    //   v0 → reject (no such version)
    //   v2+ → rejected above
    // Add `if (r.version === 1) ...`
    // branches here when a v2 lands.
    return {
      ok: false,
      error: {
        kind: 'unsupported-version',
        message: `File is from an older Lipi (version ${r.version}, this build understands ${SETTINGS_FILE_VERSION})`,
      },
    };
  }
  if (typeof r.data !== 'object' || r.data === null) {
    return {
      ok: false,
      error: {
        kind: 'wrong-shape',
        message: 'data block is missing or not an object',
      },
    };
  }
  // 3. Validate the toolSettings payload.
  try {
    const data = r.data as Record<string, unknown>;
    const toolSettings = validateToolSettings(
      data.toolSettings,
      'data.toolSettings',
    );
    return { ok: true, data: toolSettings };
  } catch (e) {
    return {
      ok: false,
      error: {
        kind: 'invalid-data',
        message:
          e instanceof Error ? e.message : 'Invalid tool settings data',
      },
    };
  }
}

/** Build a `SettingsFile` from the
 *  current tool settings. Pure
 *  function — no side effects. The
 *  caller (UI) decides what to do
 *  with the file (download as
 *  `Blob`, etc.). */
export function buildSettingsFile(
  toolSettings: ExportedToolSettings,
  now: Date = new Date(),
): SettingsFile {
  return {
    format: SETTINGS_FILE_FORMAT,
    version: SETTINGS_FILE_VERSION,
    exportedAt: now.toISOString(),
    data: {
      toolSettings,
    },
  };
}

/** Serialise a `SettingsFile` to a
 *  pretty-printed JSON string. Pretty-
 *  printed so a user can open the
 *  file in a text editor and see
 *  what they're importing. Two-space
 *  indent matches the rest of the
 *  project's JSON conventions
 *  (`tsconfig`, `package.json`,
 *  `vite.config.ts`). */
export function serialiseSettingsFile(file: SettingsFile): string {
  return JSON.stringify(file, null, 2) + '\n';
}

/** Suggest a filename for the
 *  download. Format:
 *    lipi-settings-YYYY-MM-DD.json
 *  The date is the local date
 *  (not UTC) so the file is
 *  recognisable in Finder /
 *  Explorer without timezone math.
 *  Two files exported on the same
 *  day get the same name; the
 *  browser appends `(1)` / `(2)`
 *  for collisions. */
export function suggestFilename(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `lipi-settings-${y}-${m}-${d}.json`;
}
