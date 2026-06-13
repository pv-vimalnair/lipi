/**
 * Settings v4 import / export — Phase M6b.
 *
 * v3 (S3) introduced the transactional
 * snapshot + restore apply, but kept
 * the v2 file shape (a single
 * `workspace.currentPath` + `recents`).
 * v4 is the file-shape upgrade for the
 * M6a/M6b multi-workspace-tabs world:
 * the `workspace` payload is now an
 * array of `WorkspaceTab` objects plus
 * an `activeId`, and each tab carries
 * its own per-tab `state` (file tree
 * expansion / selection / open editor
 * tabs / active editor tab).
 *
 * ## What IS exported
 *
 *   - `workspace` — `workspaces[]` +
 *     `activeId` + `recents`. The
 *     `workspaces[]` is the M6a tab
 *     array; each tab has a
 *     `WorkspaceTabState` (per-tab
 *     state keying, M6b).
 *   - `voicePreferences` — the STT
 *     provider selection (`'stub' |
 *     'wispr' | 'ondevice' |
 *     'webSpeech' | 'nativeDictation'`).
 *   - `toolSettings` — `disabledToolNames` +
 *     `confirmationMode` (unchanged
 *     from v3).
 *
 * ## What is NOT exported
 *
 *   Same as v3. v4 inherits the v3
 *   privacy scope verbatim — no
 *   keys, no audit log, no live
 *   transcript, no per-session
 *   state. The `customToolsStore`
 *   still lives in
 *   `<workspace>/lipi-tools.json`.
 *   The v3 privacy statement applies
 *   (re-exported below for the
 *   Settings UI).
 *
 * ## File format
 *
 *   {
 *     "format": "lipi-state",
 *     "version": 4,
 *     "exportedAt": "2026-06-13T...",
 *     "data": {
 *       "workspace": {
 *         "workspaces": [
 *           { "id": "uuid-1", "path": "C:/...", "addedAt": 1718262000000,
 *             "state": { "expandedDirs": [...], "selectedPath": ...,
 *                        "openEditorTabPaths": [...], "activeEditorTabPath": ... } }
 *         ],
 *         "activeId": "uuid-1",
 *         "recents": ["C:/..."]
 *       },
 *       "voicePreferences": { "provider": "wispr" },
 *       "toolSettings": { "disabledToolNames": [...], "confirmationMode": {...} }
 *     }
 *   }
 *
 * The magic string is the same as v2/v3
 * (`lipi-state`) — only the `version`
 * field discriminates. A v3 import path
 * auto-detects the missing `version`
 * field and runs a v3 → v4 migration in
 * memory.
 *
 * ## v3 → v4 migration on import
 *
 * A v3 file has `workspace.currentPath`
 * (a single string, the active
 * workspace) + `workspace.recents`. v4
 * has `workspace.workspaces[]` +
 * `workspace.activeId` +
 * `workspace.recents`. The import
 * migration:
 *
 *   1. If `currentPath` is a non-null
 *      string, wrap it in a single
 *      `WorkspaceTab` with a fresh
 *      `id` (`crypto.randomUUID()`),
 *      `addedAt = Date.now()`, and
 *      an empty `WorkspaceTabState`.
 *      Set `activeId` to the new
 *      tab's id.
 *   2. If `currentPath` is `null`, set
 *      `workspaces = []` and
 *      `activeId = null`.
 *   3. Carry the `recents` array over
 *      unchanged.
 *
 * The migration is in-memory only —
 * the v3 file on disk is not
 * rewritten. The user can re-export
 * after the import to get a v4 file.
 *
 * ## Import semantics
 *
 * Same as v3: **replace**, not merge.
 * The v4 file is the user's full
 * Lipi state on the source machine;
 * merging would silently combine
 * state from two sources, which is
 * surprising.
 *
 * The apply is **transactional**
 * (snapshot all three stores →
 * apply → restore on failure), the
 * same S3 design. v3 is the
 * documented "partial-on-error"
 * fallback; v4 is the default
 * going forward.
 *
 * ## Why a separate module from v2/v3?
 *
 * Same as the v2/v3 split:
 *   1. **Different file shape**: v3
 *      has `currentPath`; v4 has
 *      `workspaces[]` + `activeId`.
 *      Keeping them in the same file
 *      would force the v3 parser to
 *      accept a v4-shape input (and
 *      vice versa).
 *   2. **Different apply strategy**:
 *      v3 is partial-on-error
 *      (preserved on disk as a
 *      fallback); v4 is
 *      transactional (the default).
 *      v4's apply is in
 *      `settingsIOv4.apply.ts`;
 *      v3's apply is in
 *      `settingsIOv3.apply.ts`.
 *   3. **The Settings UI surface**:
 *      the "Privacy & data" card
 *      ships v4 by default. A
 *      future "advanced" menu can
 *      expose the v3 partial-on-error
 *      apply as a documented
 *      fallback for users who
 *      intentionally want it.
 */

import type { WorkspaceTabState } from '@/shared/state/workspaceStore';
import type { ConfirmationMode } from '@/shared/state/toolSettingsStore';
import type { VoiceProviderId } from '@/shared/state/voicePreferencesStore';

import type { LipiStateV2Data } from './settingsIOv2';

/** Bump this when the on-disk shape changes
 *  in a breaking way. The v3 parser also
 *  recognises this number (v3 rejects unknown
 *  versions; v4 accepts v3 by running the
 *  in-memory migration). */
export const LIPI_STATE_V4_VERSION = 4;

/** Magic string. Same as v2/v3 — the
 *  `version` field discriminates. */
export const LIPI_STATE_V4_FORMAT = 'lipi-state';

/** One exported workspace tab. Mirrors
 *  the `WorkspaceTab` shape from
 *  `workspaceStore`, re-declared here
 *  (not imported) so this module
 *  doesn't pull the Zustand runtime
 *  into a test that only cares about
 *  JSON shape. The `state` field is
 *  always present (no `?:`) — the v3
 *  → v4 import migration synthesises
 *  an empty `WorkspaceTabState` for
 *  any tab that doesn't have one. */
export interface ExportedWorkspaceTabV4 {
  id: string;
  path: string;
  addedAt: number;
  state: WorkspaceTabState;
}

/** The `workspace` payload — mirrors
 *  the M6a/M6b `workspaceStore` state
 *  for the three persisted fields. */
export interface ExportedWorkspaceV4 {
  workspaces: ExportedWorkspaceTabV4[];
  activeId: string | null;
  recents: string[];
}

/** The `voicePreferences` payload —
 *  same as v3. */
export interface ExportedVoicePreferencesV4 {
  provider: VoiceProviderId;
}

/** The `toolSettings` payload — same
 *  as v3. */
export interface ExportedToolSettingsV4 {
  disabledToolNames: string[];
  confirmationMode: Record<string, ConfirmationMode>;
}

/** The `data` block of a v4 export
 *  file. New keys can be added in
 *  future versions without bumping
 *  `LIPI_STATE_V4_VERSION` — the
 *  parser only reads the keys it
 *  knows. */
export interface LipiStateV4Data {
  workspace: ExportedWorkspaceV4;
  voicePreferences: ExportedVoicePreferencesV4;
  toolSettings: ExportedToolSettingsV4;
}

/** The full file shape. */
export interface LipiStateV4File {
  format: typeof LIPI_STATE_V4_FORMAT;
  version: typeof LIPI_STATE_V4_VERSION;
  /** ISO-8601 timestamp. Informational
   *  only — the parser does NOT use
   *  it. */
  exportedAt: string;
  data: LipiStateV4Data;
}

/** Result of attempting to parse a v4
 *  file. Same shape as the v2/v3
 *  `ParseResult`. */
export type LipiStateV4ParseResult =
  | { ok: true; data: LipiStateV4Data; sourceFormat: 'v3' | 'v4' }
  | { ok: false; error: LipiStateV4ParseError };

export type LipiStateV4ParseError =
  | { kind: 'not-json'; message: string }
  | { kind: 'wrong-shape'; message: string }
  | { kind: 'wrong-format'; message: string }
  | { kind: 'unsupported-version'; message: string }
  | { kind: 'invalid-data'; message: string };

/** Pure: build a v4 file from the
 *  in-memory state. The caller reads
 *  each store via
 *  `useXxxStore.getState()` and
 *  passes the payload in. This
 *  module does NOT import the
 *  stores — keeps the IO layer
 *  dependency-free and the test
 *  pure. */
export function buildLipiStateV4(
  state: LipiStateV4Data,
  now: Date = new Date(),
): LipiStateV4File {
  return {
    format: LIPI_STATE_V4_FORMAT,
    version: LIPI_STATE_V4_VERSION,
    exportedAt: now.toISOString(),
    data: state,
  };
}

/** Serialise a v4 file to a
 *  pretty-printed JSON string. Same
 *  convention as v2/v3 (two-space
 *  indent + trailing newline). */
export function serialiseLipiStateV4(file: LipiStateV4File): string {
  return JSON.stringify(file, null, 2) + '\n';
}

/** Suggest a filename for the
 *  download. Format:
 *    lipi-state-YYYY-MM-DD.json
 *  Same convention as the v2/v3
 *  `suggestFilename`, with a
 *  different prefix so v4 files are
 *  visually distinct in Finder /
 *  Explorer. */
export function suggestLipiStateV4Filename(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `lipi-state-v4-${y}-${m}-${d}.json`;
}

/** Pure: check whether a serialised
 *  v4 file looks like it might leak
 *  keys or audit data. Same
 *  forbidden-substring backstop as
 *  v2 — the privacy check is
 *  defence-in-depth, not a
 *  substitute for code review. */
export function serialisedFileLooksPrivateV4(serialised: string): boolean {
  const forbiddenSubstrings = [
    'sk-',                       // OpenAI key prefix
    'sk-ant-',                   // Anthropic key prefix
    'sk-or-',                    // OpenRouter key prefix
    'lipi:toolDecisionLog:v1',   // audit log key
    'lipi:dev:deviceEmulator',   // dev emulator key
    '"isUtteranceEnd"',          // live transcript event
    '"sessionId":',              // live session id
  ];
  return forbiddenSubstrings.every((s) => !serialised.includes(s));
}

// -----------------------------------------------------------------
// Runtime validation helpers
// -----------------------------------------------------------------
// (Same pattern as `settingsIOv2.ts`:
// strict, throw-on-shape-problem
// helpers, the parser catches and
// surfaces as a typed
// `invalid-data` error.)

function isVoiceProviderId(v: unknown): v is VoiceProviderId {
  return (
    v === 'stub' ||
    v === 'wispr' ||
    v === 'ondevice' ||
    v === 'webSpeech' ||
    v === 'nativeDictation'
  );
}

function isConfirmationMode(v: unknown): v is ConfirmationMode {
  return (
    v === 'always_allow' ||
    v === 'always_confirm' ||
    v === 'per_call'
  );
}

function validateV3Workspace(
  raw: unknown,
  path: string,
): import('./settingsIOv2').ExportedWorkspaceV2 {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${path} is not an object`);
  }
  const r = raw as Record<string, unknown>;
  if (!('currentPath' in r)) {
    throw new Error(`${path}.currentPath is missing`);
  }
  if (r.currentPath !== null && typeof r.currentPath !== 'string') {
    throw new Error(`${path}.currentPath is not a string or null`);
  }
  if (!('recents' in r)) {
    throw new Error(`${path}.recents is missing`);
  }
  if (!Array.isArray(r.recents)) {
    throw new Error(`${path}.recents is not an array`);
  }
  if (!r.recents.every((p) => typeof p === 'string')) {
    throw new Error(`${path}.recents contains non-strings`);
  }
  return {
    currentPath: r.currentPath as string | null,
    recents: r.recents as string[],
  };
}

function validateWorkspaceTabState(
  raw: unknown,
  path: string,
): WorkspaceTabState {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${path} is not an object`);
  }
  const r = raw as Record<string, unknown>;
  // M6b: expandedDirs is an
  // array of strings (sorted
  // for stable JSON).
  if (!('expandedDirs' in r)) {
    throw new Error(`${path}.expandedDirs is missing`);
  }
  if (!Array.isArray(r.expandedDirs)) {
    throw new Error(`${path}.expandedDirs is not an array`);
  }
  if (!r.expandedDirs.every((d) => typeof d === 'string')) {
    throw new Error(`${path}.expandedDirs contains non-strings`);
  }
  // selectedPath is a string or
  // null.
  if (!('selectedPath' in r)) {
    throw new Error(`${path}.selectedPath is missing`);
  }
  if (r.selectedPath !== null && typeof r.selectedPath !== 'string') {
    throw new Error(`${path}.selectedPath is not a string or null`);
  }
  // openEditorTabPaths is an
  // array of strings.
  if (!('openEditorTabPaths' in r)) {
    throw new Error(`${path}.openEditorTabPaths is missing`);
  }
  if (!Array.isArray(r.openEditorTabPaths)) {
    throw new Error(`${path}.openEditorTabPaths is not an array`);
  }
  if (!r.openEditorTabPaths.every((p) => typeof p === 'string')) {
    throw new Error(`${path}.openEditorTabPaths contains non-strings`);
  }
  // activeEditorTabPath is a
  // string or null.
  if (!('activeEditorTabPath' in r)) {
    throw new Error(`${path}.activeEditorTabPath is missing`);
  }
  if (
    r.activeEditorTabPath !== null &&
    typeof r.activeEditorTabPath !== 'string'
  ) {
    throw new Error(`${path}.activeEditorTabPath is not a string or null`);
  }
  return {
    expandedDirs: r.expandedDirs as string[],
    selectedPath: r.selectedPath as string | null,
    openEditorTabPaths: r.openEditorTabPaths as string[],
    activeEditorTabPath: r.activeEditorTabPath as string | null,
  };
}

function validateWorkspaceTab(
  raw: unknown,
  path: string,
): ExportedWorkspaceTabV4 {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${path} is not an object`);
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string') {
    throw new Error(`${path}.id is not a string`);
  }
  if (typeof r.path !== 'string') {
    throw new Error(`${path}.path is not a string`);
  }
  if (typeof r.addedAt !== 'number') {
    throw new Error(`${path}.addedAt is not a number`);
  }
  // M6b: the `state` field is
  // always present in a v4
  // export. A v3 → v4 migration
  // synthesises an empty
  // WorkspaceTabState for
  // any tab that didn't have
  // one. (The v3 export
  // format doesn't have a
  // `state` field at all —
  // the v3 import path in
  // `parseLipiStateV4`
  // synthesises empty states
  // for the wrapped v3 tab.)
  if (!('state' in r)) {
    throw new Error(`${path}.state is missing`);
  }
  const state = validateWorkspaceTabState(r.state, `${path}.state`);
  return {
    id: r.id,
    path: r.path,
    addedAt: r.addedAt,
    state,
  };
}

function validateWorkspace(
  raw: unknown,
  path: string,
): ExportedWorkspaceV4 {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${path} is not an object`);
  }
  const r = raw as Record<string, unknown>;
  if (!('workspaces' in r)) {
    throw new Error(`${path}.workspaces is missing`);
  }
  if (!Array.isArray(r.workspaces)) {
    throw new Error(`${path}.workspaces is not an array`);
  }
  const workspaces: ExportedWorkspaceTabV4[] = [];
  for (let i = 0; i < r.workspaces.length; i++) {
    workspaces.push(
      validateWorkspaceTab(r.workspaces[i], `${path}.workspaces[${i}]`),
    );
  }
  if (!('activeId' in r)) {
    throw new Error(`${path}.activeId is missing`);
  }
  if (r.activeId !== null && typeof r.activeId !== 'string') {
    throw new Error(`${path}.activeId is not a string or null`);
  }
  if (!('recents' in r)) {
    throw new Error(`${path}.recents is missing`);
  }
  if (!Array.isArray(r.recents)) {
    throw new Error(`${path}.recents is not an array`);
  }
  if (!r.recents.every((p) => typeof p === 'string')) {
    throw new Error(`${path}.recents contains non-strings`);
  }
  return {
    workspaces,
    activeId: r.activeId as string | null,
    recents: r.recents as string[],
  };
}

function validateVoicePreferences(
  raw: unknown,
  path: string,
): ExportedVoicePreferencesV4 {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${path} is not an object`);
  }
  const r = raw as Record<string, unknown>;
  if (!('provider' in r)) {
    throw new Error(`${path}.provider is missing`);
  }
  if (!isVoiceProviderId(r.provider)) {
    throw new Error(
      `${path}.provider has invalid value ${JSON.stringify(r.provider)}`,
    );
  }
  return { provider: r.provider };
}

function validateToolSettings(
  raw: unknown,
  path: string,
): ExportedToolSettingsV4 {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${path} is not an object`);
  }
  const r = raw as Record<string, unknown>;
  if (!('disabledToolNames' in r)) {
    throw new Error(`${path}.disabledToolNames is missing`);
  }
  if (!Array.isArray(r.disabledToolNames)) {
    throw new Error(`${path}.disabledToolNames is not an array`);
  }
  if (!r.disabledToolNames.every((n) => typeof n === 'string')) {
    throw new Error(`${path}.disabledToolNames contains non-strings`);
  }
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

/**
 * Detect whether `raw` looks like a
 * v3 file (the pre-M6b S2/S3 shape).
 *
 * v3 distinguishing marks:
 *   1. `format === 'lipi-state'`
 *   2. The `data.workspace` block
 *      has `currentPath` (not
 *      `workspaces`).
 *   3. The top-level `version`
 *      field is missing OR is the
 *      number 2 or 3. (A v4 file
 *      has `version: 4`.)
 *
 * Returns `true` if all three
 * hold; `false` otherwise. (A
 * top-level `version: 4` is the
 * canonical v4 discriminator —
 * anything else that passes the
 * first two checks is treated as
 * v3.)
 */
function looksLikeV3(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  const r = raw as Record<string, unknown>;
  if (r.format !== LIPI_STATE_V4_FORMAT) return false;
  if (typeof r.data !== 'object' || r.data === null) return false;
  const data = r.data as Record<string, unknown>;
  if (typeof data.workspace !== 'object' || data.workspace === null) {
    return false;
  }
  const ws = data.workspace as Record<string, unknown>;
  return 'currentPath' in ws;
}

/**
 * Pure: normalise a v3 `LipiStateV2Data`
 * to a v4 `LipiStateV4Data`. The
 * migration wraps `workspace.currentPath`
 * in a single `WorkspaceTab` with a
 * fresh `id` and an empty
 * `WorkspaceTabState`. The
 * `recents` array carries over
 * unchanged.
 *
 * Exported for testability (the v4
 * preview and apply both need to
 * run the migration; the test
 * pins the v3 → v4 mapping
 * behaviour).
 */
export function migrateV3DataToV4(
  v3: LipiStateV2Data,
  now: number = Date.now(),
  randomId: () => string = () => crypto.randomUUID(),
): LipiStateV4Data {
  const tab =
    v3.workspace.currentPath !== null
      ? [
          {
            id: randomId(),
            path: v3.workspace.currentPath,
            addedAt: now,
            state: {
              expandedDirs: [] as string[],
              selectedPath: null,
              openEditorTabPaths: [] as string[],
              activeEditorTabPath: null,
            },
          },
        ]
      : [];
  return {
    workspace: {
      workspaces: tab,
      activeId: tab[0]?.id ?? null,
      recents: v3.workspace.recents,
    },
    voicePreferences: v3.voicePreferences,
    toolSettings: v3.toolSettings,
  };
}

/**
 * Parse a v4 file (the result of
 * `FileReader.readAsText` on a
 * user-picked `.json`). Returns a
 * tagged union; we deliberately
 * don't throw — the UI shows a
 * specific error to the user, and
 * `try/catch`-based error handling
 * is a worse UX.
 *
 * Auto-detects v3 vs v4: a v3 file
 * (no `version` field, has
 * `workspace.currentPath`) is
 * normalised to v4 in-memory via
 * `migrateV3DataToV4`. The result
 * includes a `sourceFormat: 'v3' |
 * 'v4'` field so the preview /
 * apply can show a "this is a v3
 * file, importing as v4" notice
 * to the user.
 */
export function parseLipiStateV4(text: string): LipiStateV4ParseResult {
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
  // 2. Top-level shape.
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
  if (r.format !== LIPI_STATE_V4_FORMAT) {
    return {
      ok: false,
      error: {
        kind: 'wrong-format',
        message: `Not a Lipi state file (expected format "${LIPI_STATE_V4_FORMAT}", got ${JSON.stringify(r.format)})`,
      },
    };
  }
  // 3. Version discriminator.
  //    v3 has no `version` field
  //    (or `version: 2` or
  //    `version: 3`); v4 has
  //    `version: 4`. We accept
  //    v3 and run the in-memory
  //    migration. A `version: 5`
  //    (or any other unknown) is
  //    rejected with an explicit
  //    "unsupported-version"
  //    error.
  if (typeof r.version === 'number') {
    if (r.version === 4) {
      // Native v4 path.
    } else if (r.version === 2 || r.version === 3) {
      // v3 path — fall through
      // to the v3 migration.
    } else {
      return {
        ok: false,
        error: {
          kind: 'unsupported-version',
          message: `Unsupported version (this build understands v3 and v4, got v${r.version})`,
        },
      };
    }
  } else {
    // No `version` field — treat
    // as v3. The v3 export
    // format doesn't have one
    // (the magic string
    // "lipi-state" is the
    // version marker).
  }
  // 4. v3 detection + migration.
  if (looksLikeV3(raw)) {
    if (typeof r.data !== 'object' || r.data === null) {
      return {
        ok: false,
        error: {
          kind: 'wrong-shape',
          message: 'data block is missing or not an object',
        },
      };
    }
    try {
      // Validate the v3
      // data block
      // directly (don't
      // re-use the v2
      // parser, which
      // only accepts
      // `version: 2`).
      // The v3 data
      // shape is the
      // same as v2
      // except the
      // `workspace` block
      // has `currentPath`
      // (no `workspaces[]`).
      const v3Data = r.data as Record<string, unknown>;
      const v3Workspace = validateV3Workspace(
        v3Data.workspace,
        'data.workspace',
      );
      const v3Voice = validateVoicePreferences(
        v3Data.voicePreferences,
        'data.voicePreferences',
      );
      const v3Tools = validateToolSettings(
        v3Data.toolSettings,
        'data.toolSettings',
      );
      return {
        ok: true,
        data: migrateV3DataToV4({
          workspace: v3Workspace,
          voicePreferences: v3Voice,
          toolSettings: v3Tools,
        }),
        sourceFormat: 'v3',
      };
    } catch (e) {
      return {
        ok: false,
        error: {
          kind: 'invalid-data',
          message:
            e instanceof Error ? e.message : 'Invalid Lipi state v3 data',
        },
      };
    }
  }
  // 5. v4 native path.
  if (typeof r.data !== 'object' || r.data === null) {
    return {
      ok: false,
      error: {
        kind: 'wrong-shape',
        message: 'data block is missing or not an object',
      },
    };
  }
  try {
    const data = r.data as Record<string, unknown>;
    const workspace = validateWorkspace(data.workspace, 'data.workspace');
    const voicePreferences = validateVoicePreferences(
      data.voicePreferences,
      'data.voicePreferences',
    );
    const toolSettings = validateToolSettings(
      data.toolSettings,
      'data.toolSettings',
    );
    return {
      ok: true,
      data: { workspace, voicePreferences, toolSettings },
      sourceFormat: 'v4',
    };
  } catch (e) {
    return {
      ok: false,
      error: {
        kind: 'invalid-data',
        message:
          e instanceof Error ? e.message : 'Invalid Lipi state v4 data',
      },
    };
  }
}
