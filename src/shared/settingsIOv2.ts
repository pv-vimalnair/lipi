/**
 * Settings v2 import / export — Phase S2.
 *
 * The 5b v1 export (see `settingsIO.ts`) is
 * per-decision: just `toolSettings`. The v2 export
 * captures the **full Lipi state** the user would
 * want to carry between machines, while honouring
 * the privacy boundaries established by 5b v1 (no
 * AI keys, no audit log) and the per-machine
 * boundaries documented in HANDOFF §9.6 (no
 * capability flags, no live transcript state).
 *
 * ## What IS exported
 *
 *   - `workspace` — `currentPath` + `recents`.
 *     The list of folders the user has worked on.
 *   - `voicePreferences` — the STT provider
 *     selection (`'stub' | 'wispr' | 'ondevice' |
 *     'webSpeech' | 'nativeDictation'`).
 *   - `toolSettings` — `disabledToolNames` +
 *     `confirmationMode` (the 5b v1 payload,
 *     unchanged; v2 just lifts it to a sibling
 *     key in the `data` block).
 *
 * ## What is NOT exported
 *
 *   1. **OS-keychain API keys** (OpenAI, Anthropic,
 *      OpenRouter, Wispr). The keys are not in JS
 *      state at all — they're in the OS keychain
 *      (Decision #7). Even if a user wanted them
 *      in the file, the JS side has no way to read
 *      them. A user moving machines must re-enter
 *      their API keys; the Settings UI surfaces
 *      this in the "Privacy & data" copy below the
 *      import button.
 *   2. **`toolDecisionLogStore`** (the audit log).
 *      Per 5b v1: a per-machine record of "what
 *      did the model do here". Sharing it across
 *      machines would conflate audit trails. The
 *      log lives in `lipi:toolDecisionLog:v1`
 *      `localStorage`; v2 does not touch it.
 *   3. **`deviceEmulatorStore`**. Dev-only,
 *      session-only (`sessionStorage`).
 *   4. **`voiceCapabilitiesStore`**. Not
 *      persisted; build-time capability flag
 *      (`voicePlatformCapabilities`).
 *   5. **`voiceStore` / live transcript state**.
 *      The `useVoiceCapture` session state is
 *      intentionally ephemeral. A v2 file is a
 *      cold-start snapshot, not a session replay.
 *   6. **`customToolsStore`**. The user's custom
 *      tools live in `<workspace>/lipi-tools.json`
 *      — they're *workspace-scoped*, not global.
 *      The workspace folder is the v2 transfer
 *      medium for custom tools, not the v2 file.
 *   7. **`appStore`, `commandPaletteStore`,
 *      `chatNavStore`, `aboutStore`**. UI state,
 *      not settings.
 *   8. **`firstRunStore`**. Onboarding is
 *      per-machine, not a user preference.
 *
 * ## File format
 *
 * Same shape as the 5b v1 file but with a
 * different magic string and version:
 *
 *   {
 *     "format": "lipi-state",
 *     "version": 2,
 *     "exportedAt": "2026-06-12T...",
 *     "data": {
 *       "workspace": { "currentPath": "...", "recents": [...] },
 *       "voicePreferences": { "provider": "wispr" },
 *       "toolSettings": { "disabledToolNames": [...], "confirmationMode": {...} }
 *     }
 *   }
 *
 * The magic string `lipi-state` (vs the v1
 * `lipi-settings`) means a v1 file is rejected by
 * a v2 reader (and vice-versa) — the two are
 * different products.
 *
 * ## Import semantics
 *
 * Same as v1: **replace**, not merge. The v2 file
 * is the user's full Lipi state on the source
 * machine; merging would silently combine state
 * from two sources, which is surprising.
 *
 * The apply step is **destructive** and is
 * surfaced through the Settings "Danger zone" UI.
 * The 5a soft-delete + 5s-undo pattern is reused
 * for the `toolSettings` half (the existing
 * `lipi:toolSettings:undo:v1` buffer covers it);
 * the `workspace` and `voicePreferences` halves
 * are not undoable in this iteration (they're
 * cheap to re-apply manually if a user imports
 * the wrong file).
 *
 * ## Why a separate module from v1?
 *
 * Two reasons:
 *
 *   1. **Different surface**: v1 is one payload
 *      (`toolSettings`); v2 is three. Keeping them
 *      in the same file would force the v1 parser
 *      to handle v2-shape inputs (and vice versa)
 *      and create a confusing "what's the magic
 *      string for?" mental load.
 *   2. **Different UI**: v1 has its own
 *      export/import buttons in the 5b settings
 *      section. v2 lives in a "Privacy & data"
 *      Danger zone. Two modules → two UI surfaces
 *      → clear ownership.
 */

import type { ConfirmationMode } from '@/shared/state/toolSettingsStore';
import type { VoiceProviderId } from '@/shared/state/voicePreferencesStore';

/** Bump this when the on-disk shape changes in a
 *  breaking way. A v3 file would either be read
 *  by a future parser (forward compat) or
 *  rejected with a clear error. */
export const LIPI_STATE_V2_VERSION = 2;

/** Magic string. Identifies "this is a Lipi
 *  state file" without trusting the extension.
 *  Distinct from the 5b v1 magic string
 *  (`lipi-settings`) so a v1 file is rejected by
 *  a v2 reader. */
export const LIPI_STATE_V2_FORMAT = 'lipi-state';

/** The `workspace` payload — mirrors the
 *  `workspaceStore` state for the two persisted
 *  fields. Re-declared here (not imported from
 *  the store) so this module doesn't pull the
 *  whole Zustand runtime into a test that only
 *  cares about JSON shape. */
export interface ExportedWorkspaceV2 {
  currentPath: string | null;
  recents: string[];
}

/** The `voicePreferences` payload — mirrors the
 *  `voicePreferencesStore` state. */
export interface ExportedVoicePreferencesV2 {
  provider: VoiceProviderId;
}

/** The `toolSettings` payload — same as the 5b
 *  v1 `ExportedToolSettings`. The interface is
 *  duplicated here rather than imported from
 *  `settingsIO.ts` because the two files own
 *  distinct file shapes and should not
 *  cross-couple: a v2 reader must not
 *  accidentally accept a v1 `data` block (the
 *  field set is different). */
export interface ExportedToolSettingsV2 {
  disabledToolNames: string[];
  confirmationMode: Record<string, ConfirmationMode>;
}

/** The `data` block of a v2 export file. New
 *  keys can be added in future versions without
 *  bumping `LIPI_STATE_V2_VERSION` — the parser
 *  only reads the keys it knows. */
export interface LipiStateV2Data {
  workspace: ExportedWorkspaceV2;
  voicePreferences: ExportedVoicePreferencesV2;
  toolSettings: ExportedToolSettingsV2;
}

/** The full file shape. */
export interface LipiStateV2File {
  format: typeof LIPI_STATE_V2_FORMAT;
  version: typeof LIPI_STATE_V2_VERSION;
  /** ISO-8601 timestamp. Informational only —
   *  the parser does NOT use it. */
  exportedAt: string;
  data: LipiStateV2Data;
}

/** Result of attempting to parse a v2 file. Same
 *  shape as the 5b v1 `ParseResult` so the
 *  Settings UI can reuse the error-rendering
 *  pattern. */
export type LipiStateV2ParseResult =
  | { ok: true; data: LipiStateV2Data }
  | { ok: false; error: LipiStateV2ParseError };

export type LipiStateV2ParseError =
  | { kind: 'not-json'; message: string }
  | { kind: 'wrong-shape'; message: string }
  | { kind: 'wrong-format'; message: string }
  | { kind: 'unsupported-version'; message: string }
  | { kind: 'invalid-data'; message: string };

/** Pure: build a v2 file from the in-memory
 *  state. The caller reads each store via
 *  `useXxxStore.getState()` and passes the
 *  payload in. This module does NOT import
 *  the stores — keeps the IO layer
 *  dependency-free and the test pure. */
export function buildLipiStateV2(
  state: LipiStateV2Data,
  now: Date = new Date(),
): LipiStateV2File {
  return {
    format: LIPI_STATE_V2_FORMAT,
    version: LIPI_STATE_V2_VERSION,
    exportedAt: now.toISOString(),
    data: state,
  };
}

/** Serialise a v2 file to a pretty-printed JSON
 *  string. Same convention as the 5b v1
 *  `serialiseSettingsFile` (two-space indent +
 *  trailing newline). */
export function serialiseLipiStateV2(file: LipiStateV2File): string {
  return JSON.stringify(file, null, 2) + '\n';
}

/** Suggest a filename for the download. Format:
 *    lipi-state-YYYY-MM-DD.json
 *  Same convention as the 5b v1
 *  `suggestFilename`, with a different prefix
 *  so v1 and v2 files are visually distinct in
 *  Finder / Explorer. */
export function suggestLipiStateV2Filename(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `lipi-state-${y}-${m}-${d}.json`;
}

/** Strict runtime check for a
 *  `VoiceProviderId`. Mirrors the union in
 *  `voicePreferencesStore` (deliberately
 *  duplicated so this module is
 *  dependency-free). */
function isVoiceProviderId(v: unknown): v is VoiceProviderId {
  return (
    v === 'stub' ||
    v === 'wispr' ||
    v === 'ondevice' ||
    v === 'webSpeech' ||
    v === 'nativeDictation'
  );
}

/** Strict runtime check for a
 *  `ConfirmationMode`. Mirrors the one in
 *  `toolSettingsStore` (same reason as
 *  `isVoiceProviderId`). */
function isConfirmationMode(v: unknown): v is ConfirmationMode {
  return (
    v === 'always_allow' ||
    v === 'always_confirm' ||
    v === 'per_call'
  );
}

function validateWorkspace(
  raw: unknown,
  path: string,
): ExportedWorkspaceV2 {
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

function validateVoicePreferences(
  raw: unknown,
  path: string,
): ExportedVoicePreferencesV2 {
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
): ExportedToolSettingsV2 {
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

/** Parse a v2 file (the result of
 *  `FileReader.readAsText` on a user-picked
 *  `.json`). Returns a tagged union; we
 *  deliberately don't throw — the UI shows a
 *  specific error to the user, and
 *  `try/catch`-based error handling is a worse
 *  UX. */
export function parseLipiStateV2(text: string): LipiStateV2ParseResult {
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
  if (r.format !== LIPI_STATE_V2_FORMAT) {
    return {
      ok: false,
      error: {
        kind: 'wrong-format',
        message: `Not a Lipi state v2 file (expected format "${LIPI_STATE_V2_FORMAT}", got ${JSON.stringify(r.format)})`,
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
  if (r.version !== LIPI_STATE_V2_VERSION) {
    return {
      ok: false,
      error: {
        kind: 'unsupported-version',
        message: `Unsupported version (this build understands only ${LIPI_STATE_V2_VERSION}, got ${r.version})`,
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
  // 3. Validate each sub-payload. The
  //    `validate` helpers throw on shape
  //    problems; we catch and surface a typed
  //    `invalid-data` error.
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
    };
  } catch (e) {
    return {
      ok: false,
      error: {
        kind: 'invalid-data',
        message:
          e instanceof Error ? e.message : 'Invalid Lipi state data',
      },
    };
  }
}

/** User-facing privacy statement for the v2
 *  Settings UI. The string is exported (not
 *  inlined in the component) so a copy change
 *  is a one-line edit and the wording can be
 *  unit-tested. */
export const LIPI_STATE_V2_PRIVACY_STATEMENT = [
  'This export contains:',
  '  • Your current workspace and recent workspaces (file paths only).',
  '  • Your STT provider choice.',
  '  • Your tool enable/disable set and per-tool confirmation policy.',
  '',
  'It does NOT contain:',
  '  • Your AI provider API keys (OpenAI, Anthropic, OpenRouter).',
  '  • Your Wispr Flow API key.',
  '  • The audit log of model decisions.',
  '  • Live transcript or session state.',
  '  • Custom tools (those live in your workspace folder).',
  '',
  'You will need to re-enter your API keys on the new machine.',
].join('\n');

/** Pure: check whether a serialised v2 file
 *  looks like it might leak keys or audit
 *  data. Used by the export builder's
 *  self-test path (a debug log if anything
 *  unexpected appears in the output) and by
 *  the test suite to pin the privacy scope. */
export function serialisedFileLooksPrivate(serialised: string): boolean {
  // The privacy check is a defence-in-depth
  // smoke test: it asserts the serialised JSON
  // does NOT contain any of the storage keys
  // we deliberately exclude. A real leak would
  // still need a code review to catch; this
  // check is a backstop, not a substitute.
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
