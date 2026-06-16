/**
 * Settings v5 import / export — Phase M6c.
 *
 * The wire-format magic string is
 * unchanged from v2/v3/v4
 * (`'lipi-state'`) — only the
 * `version` field discriminates.
 * v5 adds two new fields to
 * `WorkspaceTabState`:
 *   - `editorCursorByPath` (a
 *     per-file cursor position)
 *   - `fileTreeScrollAnchor`
 *     (the topmost visible
 *     file-tree row's path)
 *
 * The v5 parser auto-detects v4
 * input (version 4) and runs an
 * in-memory v4 → v5 migration; v3
 * input is auto-migrated to v4
 * (via the v4 `migrateV3DataToV4`)
 * and then to v5.
 *
 * See
 * `docs/superpowers/specs/2026-06-16-m6c-per-tab-state-design.md`
 * for the design.
 */

import type { WorkspaceTabState } from '@/shared/state/workspaceStore';
import type { ConfirmationMode } from '@/shared/state/toolSettingsStore';
import type { VoiceProviderId } from '@/shared/state/voicePreferencesStore';

import { parseLipiStateV4, type LipiStateV4Data } from './settingsIOv4';

export const LIPI_STATE_V5_VERSION = 5;
export const LIPI_STATE_V5_FORMAT = 'lipi-state';

export interface ExportedWorkspaceTabV5 {
  id: string;
  path: string;
  addedAt: number;
  state: WorkspaceTabState;
}

export interface ExportedWorkspaceV5 {
  workspaces: ExportedWorkspaceTabV5[];
  activeId: string | null;
  recents: string[];
}

export interface ExportedVoicePreferencesV5 {
  provider: VoiceProviderId;
}

export interface ExportedToolSettingsV5 {
  disabledToolNames: string[];
  confirmationMode: Record<string, ConfirmationMode>;
}

export interface LipiStateV5Data {
  workspace: ExportedWorkspaceV5;
  voicePreferences: ExportedVoicePreferencesV5;
  toolSettings: ExportedToolSettingsV5;
}

export interface LipiStateV5File {
  format: typeof LIPI_STATE_V5_FORMAT;
  version: typeof LIPI_STATE_V5_VERSION;
  exportedAt: string;
  data: LipiStateV5Data;
}

export type LipiStateV5ParseResult =
  | { ok: true; data: LipiStateV5Data; sourceFormat: 'v3' | 'v4' | 'v5' }
  | { ok: false; error: LipiStateV5ParseError };

export type LipiStateV5ParseError =
  | { kind: 'not-json'; message: string }
  | { kind: 'wrong-shape'; message: string }
  | { kind: 'wrong-format'; message: string }
  | { kind: 'unsupported-version'; message: string }
  | { kind: 'invalid-data'; message: string };

export function buildLipiStateV5(
  state: LipiStateV5Data,
  now: Date = new Date(),
): LipiStateV5File {
  return {
    format: LIPI_STATE_V5_FORMAT,
    version: LIPI_STATE_V5_VERSION,
    exportedAt: now.toISOString(),
    data: state,
  };
}

export function serialiseLipiStateV5(file: LipiStateV5File): string {
  return JSON.stringify(file, null, 2) + '\n';
}

export function suggestLipiStateV5Filename(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `lipi-state-v5-${y}-${m}-${d}.json`;
}

export function serialisedFileLooksPrivateV5(serialised: string): boolean {
  const forbiddenSubstrings = [
    'sk-',
    'sk-ant-',
    'sk-or-',
    'lipi:toolDecisionLog:v1',
    'lipi:dev:deviceEmulator',
    '"isUtteranceEnd"',
    '"sessionId":',
  ];
  return forbiddenSubstrings.every((s) => !serialised.includes(s));
}

// -----------------------------------------------------------------
// Runtime validation helpers
// -----------------------------------------------------------------

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

function validateEditorCursor(
  raw: unknown,
  path: string,
): { line: number; column: number } {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${path} is not an object`);
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.line !== 'number') {
    throw new Error(`${path}.line is not a number`);
  }
  if (typeof r.column !== 'number') {
    throw new Error(`${path}.column is not a number`);
  }
  return { line: r.line, column: r.column };
}

function validateEditorCursorByPath(
  raw: unknown,
  path: string,
): Record<string, { line: number; column: number }> {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${path} is not an object`);
  }
  const out: Record<string, { line: number; column: number }> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] = validateEditorCursor(v, `${path}.${k}`);
  }
  return out;
}

function validateWorkspaceTabState(
  raw: unknown,
  path: string,
): WorkspaceTabState {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${path} is not an object`);
  }
  const r = raw as Record<string, unknown>;
  if (!('expandedDirs' in r)) {
    throw new Error(`${path}.expandedDirs is missing`);
  }
  if (!Array.isArray(r.expandedDirs)) {
    throw new Error(`${path}.expandedDirs is not an array`);
  }
  if (!r.expandedDirs.every((d) => typeof d === 'string')) {
    throw new Error(`${path}.expandedDirs contains non-strings`);
  }

  if (!('selectedPath' in r)) {
    throw new Error(`${path}.selectedPath is missing`);
  }
  if (r.selectedPath !== null && typeof r.selectedPath !== 'string') {
    throw new Error(`${path}.selectedPath is not a string or null`);
  }

  if (!('openEditorTabPaths' in r)) {
    throw new Error(`${path}.openEditorTabPaths is missing`);
  }
  if (!Array.isArray(r.openEditorTabPaths)) {
    throw new Error(`${path}.openEditorTabPaths is not an array`);
  }
  if (!r.openEditorTabPaths.every((p) => typeof p === 'string')) {
    throw new Error(`${path}.openEditorTabPaths contains non-strings`);
  }

  if (!('activeEditorTabPath' in r)) {
    throw new Error(`${path}.activeEditorTabPath is missing`);
  }
  if (
    r.activeEditorTabPath !== null &&
    typeof r.activeEditorTabPath !== 'string'
  ) {
    throw new Error(`${path}.activeEditorTabPath is not a string or null`);
  }

  if (!('editorCursorByPath' in r)) {
    throw new Error(`${path}.editorCursorByPath is missing`);
  }
  if (typeof r.editorCursorByPath !== 'object' || r.editorCursorByPath === null) {
    throw new Error(`${path}.editorCursorByPath is not an object`);
  }
  const editorCursorByPath = validateEditorCursorByPath(
    r.editorCursorByPath,
    `${path}.editorCursorByPath`,
  );

  if (!('fileTreeScrollAnchor' in r)) {
    throw new Error(`${path}.fileTreeScrollAnchor is missing`);
  }
  if (
    r.fileTreeScrollAnchor !== null &&
    typeof r.fileTreeScrollAnchor !== 'string'
  ) {
    throw new Error(`${path}.fileTreeScrollAnchor is not a string or null`);
  }

  return {
    expandedDirs: r.expandedDirs as string[],
    selectedPath: r.selectedPath as string | null,
    openEditorTabPaths: r.openEditorTabPaths as string[],
    activeEditorTabPath: r.activeEditorTabPath as string | null,
    editorCursorByPath,
    fileTreeScrollAnchor: r.fileTreeScrollAnchor as string | null,
  };
}

function validateWorkspaceTab(
  raw: unknown,
  path: string,
): ExportedWorkspaceTabV5 {
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
  if (!('state' in r)) {
    throw new Error(`${path}.state is missing`);
  }
  const state = validateWorkspaceTabState(r.state, `${path}.state`);
  return { id: r.id, path: r.path, addedAt: r.addedAt, state };
}

function validateWorkspace(
  raw: unknown,
  path: string,
): ExportedWorkspaceV5 {
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
  const workspaces: ExportedWorkspaceTabV5[] = [];
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
): ExportedVoicePreferencesV5 {
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
): ExportedToolSettingsV5 {
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

function looksLikeV3(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  const r = raw as Record<string, unknown>;
  if (r.format !== LIPI_STATE_V5_FORMAT) return false;
  if (typeof r.data !== 'object' || r.data === null) return false;
  const data = r.data as Record<string, unknown>;
  if (typeof data.workspace !== 'object' || data.workspace === null) {
    return false;
  }
  const ws = data.workspace as Record<string, unknown>;
  return 'currentPath' in ws;
}

function looksLikeV4(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  const r = raw as Record<string, unknown>;
  if (r.format !== LIPI_STATE_V5_FORMAT) return false;
  if (typeof r.data !== 'object' || r.data === null) return false;
  const data = r.data as Record<string, unknown>;
  if (typeof data.workspace !== 'object' || data.workspace === null) {
    return false;
  }
  const ws = data.workspace as Record<string, unknown>;
  return Array.isArray(ws.workspaces);
}

/**
 * Migrate a v4 `LipiStateV4Data` to a v5
 * `LipiStateV5Data` in memory. The 2
 * new fields are synthesised with
 * empty defaults; the v3 → v4 chain
 * is reused unchanged.
 */
export function migrateV4DataToV5(v4: LipiStateV4Data): LipiStateV5Data {
  return {
    workspace: {
      ...v4.workspace,
      workspaces: v4.workspace.workspaces.map((tab) => ({
        ...tab,
        state: {
          ...tab.state,
          editorCursorByPath: {},
          fileTreeScrollAnchor: null,
        },
      })),
    },
    voicePreferences: v4.voicePreferences,
    toolSettings: v4.toolSettings,
  };
}

export function parseLipiStateV5(text: string): LipiStateV5ParseResult {
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
  if (typeof raw !== 'object' || raw === null) {
    return {
      ok: false,
      error: { kind: 'wrong-shape', message: 'Top-level value is not an object' },
    };
  }
  const r = raw as Record<string, unknown>;
  if (r.format !== LIPI_STATE_V5_FORMAT) {
    return {
      ok: false,
      error: {
        kind: 'wrong-format',
        message: `Not a Lipi state file (expected format "${LIPI_STATE_V5_FORMAT}", got ${JSON.stringify(r.format)})`,
      },
    };
  }
  // Version discriminator.
  if (typeof r.version === 'number') {
    if (r.version === 5) {
      // Native v5 path — fall through.
    } else if (r.version === 2 || r.version === 3) {
      // v3 path — fall through to looksLikeV3.
    } else if (r.version === 4) {
      // v4 path — fall through to looksLikeV4.
    } else {
      return {
        ok: false,
        error: {
          kind: 'unsupported-version',
          message: `Unsupported version (this build understands v3, v4, and v5, got v${r.version})`,
        },
      };
    }
  }
  // v3 detection + migration via v4.
  // Same guard as v4: a v5 file with a `currentPath` field would
  // be malformed, but we keep the version guard for safety.
  if (r.version !== 4 && r.version !== 5 && looksLikeV3(raw)) {
    if (typeof r.data !== 'object' || r.data === null) {
      return {
        ok: false,
        error: { kind: 'wrong-shape', message: 'data block is missing or not an object' },
      };
    }
    try {
      // Validate the v3 fields by reusing the v4 parser
      // (parseLipiStateV4 accepts a v3 file and returns
      // the migrated v4 data).
      const v4Parse = parseLipiStateV4(text);
      if (!v4Parse.ok) {
        return {
          ok: false,
          error: {
            kind: 'invalid-data',
            message: v4Parse.error.message,
          },
        };
      }
      return { ok: true, data: migrateV4DataToV5(v4Parse.data), sourceFormat: 'v3' };
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
  // v4 detection + migration to v5.
  // A v5 file (version 5) also has `data.workspace.workspaces[]`
  // so `looksLikeV4` returns true for v5 input as well. We must
  // guard by `r.version !== 5` here so the v5 native path runs
  // first. (The version discriminator above only validates the
  // value; it does not skip the looksLike checks.)
  if (r.version !== 5 && looksLikeV4(raw)) {
    if (typeof r.data !== 'object' || r.data === null) {
      return {
        ok: false,
        error: { kind: 'wrong-shape', message: 'data block is missing or not an object' },
      };
    }
    try {
      const v4Parse = parseLipiStateV4(text);
      if (!v4Parse.ok) {
        return {
          ok: false,
          error: { kind: 'invalid-data', message: v4Parse.error.message },
        };
      }
      return { ok: true, data: migrateV4DataToV5(v4Parse.data), sourceFormat: 'v4' };
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
  // Native v5 path.
  if (typeof r.data !== 'object' || r.data === null) {
    return {
      ok: false,
      error: { kind: 'wrong-shape', message: 'data block is missing or not an object' },
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
      sourceFormat: 'v5',
    };
  } catch (e) {
    return {
      ok: false,
      error: {
        kind: 'invalid-data',
        message: e instanceof Error ? e.message : 'Invalid Lipi state v5 data',
      },
    };
  }
}
