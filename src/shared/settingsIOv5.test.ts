/**
 * Tests for the v5 schema, parser,
 * builder, and serialiser.
 *
 * The v5 schema is the M6c upgrade to
 * the v4 file format: a v5 file's
 * `WorkspaceTabState` carries the 2
 * new per-tab fields — `editorCursorByPath`
 * (per-file cursor memory) and
 * `fileTreeScrollAnchor` (the topmost
 * visible file-tree row's path). The
 * parser auto-detects v4 input and
 * runs an in-memory v4 → v5 migration
 * (synthesising empty defaults for the
 * 2 new fields). v3 input is
 * auto-migrated to v4 (via the v4
 * parser) and then to v5.
 */
import { describe, expect, it } from 'vitest';

import {
  buildLipiStateV5,
  LIPI_STATE_V5_FORMAT,
  LIPI_STATE_V5_VERSION,
  migrateV4DataToV5,
  parseLipiStateV5,
  serialiseLipiStateV5,
  serialisedFileLooksPrivateV5,
  suggestLipiStateV5Filename,
  type LipiStateV5Data,
} from './settingsIOv5';

function tabWithCursorState(path: string) {
  return {
    id: `tab-${path}`,
    path,
    addedAt: 1000,
    state: {
      expandedDirs: [] as string[],
      selectedPath: null as string | null,
      openEditorTabPaths: [] as string[],
      activeEditorTabPath: null as string | null,
      editorCursorByPath: {
        [`${path}/index.ts`]: { line: 5, column: 3 },
      },
      fileTreeScrollAnchor: `${path}/src`,
    },
  };
}

const sampleData: LipiStateV5Data = {
  workspace: {
    workspaces: [tabWithCursorState('C:/proj1'), tabWithCursorState('C:/proj2')],
    activeId: 'tab-C:/proj1',
    recents: ['C:/proj1', 'C:/proj2'],
  },
  voicePreferences: { provider: 'wispr' },
  toolSettings: {
    disabledToolNames: ['run_shell_command'],
    confirmationMode: { run_shell_command: 'always_confirm' },
  },
};

describe('LIPI_STATE_V5_VERSION + LIPI_STATE_V5_FORMAT', () => {
  it('has version 5 and the lipi-state magic string', () => {
    expect(LIPI_STATE_V5_VERSION).toBe(5);
    expect(LIPI_STATE_V5_FORMAT).toBe('lipi-state');
  });
});

describe('buildLipiStateV5', () => {
  it('builds a v5 file with the right magic + version + ISO timestamp', () => {
    const file = buildLipiStateV5(sampleData, new Date('2026-06-16T10:00:00Z'));
    expect(file.format).toBe('lipi-state');
    expect(file.version).toBe(5);
    expect(file.exportedAt).toBe('2026-06-16T10:00:00.000Z');
    expect(file.data).toEqual(sampleData);
  });
});

describe('serialiseLipiStateV5', () => {
  it('produces a pretty-printed JSON string with a trailing newline', () => {
    const file = buildLipiStateV5(sampleData);
    const s = serialiseLipiStateV5(file);
    expect(s.endsWith('\n')).toBe(true);
    expect(s).toContain('"version": 5');
    expect(s).toContain('"format": "lipi-state"');
    expect(s).toMatch(/\n  "format"/);
  });

  it('round-trips through parseLipiStateV5', () => {
    const file = buildLipiStateV5(sampleData);
    const parsed = parseLipiStateV5(serialiseLipiStateV5(file));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.sourceFormat).toBe('v5');
    expect(parsed.data).toEqual(sampleData);
  });
});

describe('suggestLipiStateV5Filename', () => {
  it('produces a YYYY-MM-DD filename with the v5 prefix', () => {
    const name = suggestLipiStateV5Filename(new Date('2026-06-16T10:00:00Z'));
    expect(name).toBe('lipi-state-v5-2026-06-16.json');
  });
});

describe('parseLipiStateV5 — v5 native input', () => {
  it('parses a v5 file (version 5) and returns sourceFormat: v5', () => {
    const file = buildLipiStateV5(sampleData);
    const parsed = parseLipiStateV5(serialiseLipiStateV5(file));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.sourceFormat).toBe('v5');
    expect(parsed.data).toEqual(sampleData);
  });

  it('rejects JSON that is not an object', () => {
    const r = parseLipiStateV5('"hello"');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('wrong-shape');
  });

  it('rejects a wrong-format file', () => {
    const r = parseLipiStateV5('{"format":"other","version":5}');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('wrong-format');
  });

  it('rejects a version higher than 5 (e.g. 6) as unsupported', () => {
    const r = parseLipiStateV5(
      JSON.stringify({ format: 'lipi-state', version: 6, data: {} }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('unsupported-version');
  });

  it('rejects a missing data block', () => {
    const r = parseLipiStateV5(
      JSON.stringify({ format: 'lipi-state', version: 5 }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('wrong-shape');
  });

  it('rejects a workspace tab whose editorCursorByPath is not an object', () => {
    const bad = buildLipiStateV5({
      ...sampleData,
      workspace: {
        ...sampleData.workspace,
        workspaces: [
          {
            id: 'tab-1',
            path: 'C:/proj',
            addedAt: 1,
            state: {
              ...tabWithCursorState('C:/proj').state,
              // @ts-expect-error — intentionally wrong shape for the test
              editorCursorByPath: 'not-an-object',
            },
          },
        ],
        activeId: 'tab-1',
        recents: [],
      },
    });
    const r = parseLipiStateV5(serialiseLipiStateV5(bad));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('invalid-data');
  });
});

describe('parseLipiStateV5 — v4 input (auto-migrated)', () => {
  it('migrates a v4 file (version 4) by synthesising the 2 new fields', () => {
    // Build a v4 file shape (version 4) by hand.
    const v4Data = {
      workspace: {
        workspaces: [
          {
            id: 'tab-1',
            path: 'C:/proj',
            addedAt: 1,
            state: {
              expandedDirs: ['C:/proj/src'],
              selectedPath: 'C:/proj/src/index.ts',
              openEditorTabPaths: ['C:/proj/src/index.ts'],
              activeEditorTabPath: 'C:/proj/src/index.ts',
              // NO editorCursorByPath, NO fileTreeScrollAnchor
            },
          },
        ],
        activeId: 'tab-1',
        recents: ['C:/proj'],
      },
      voicePreferences: { provider: 'wispr' },
      toolSettings: { disabledToolNames: [], confirmationMode: {} },
    };
    const v4File = JSON.stringify({
      format: 'lipi-state',
      version: 4,
      exportedAt: '2026-06-16T00:00:00Z',
      data: v4Data,
    });
    const r = parseLipiStateV5(v4File);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sourceFormat).toBe('v4');
    expect(r.data.workspace.workspaces[0]!.state.editorCursorByPath).toEqual({});
    expect(r.data.workspace.workspaces[0]!.state.fileTreeScrollAnchor).toBeNull();
  });
});

describe('parseLipiStateV5 — v3 input (auto-migrated via v4)', () => {
  it('migrates a v3 file (no version field, has workspace.currentPath) by going v3 → v4 → v5', () => {
    const v3Data = {
      workspace: { currentPath: 'C:/proj', recents: ['C:/proj'] },
      voicePreferences: { provider: 'wispr' },
      toolSettings: { disabledToolNames: [], confirmationMode: {} },
    };
    const v3File = JSON.stringify({ format: 'lipi-state', data: v3Data });
    const r = parseLipiStateV5(v3File);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sourceFormat).toBe('v3');
    // Wrapped into a single tab, with the 2 new fields defaulted.
    expect(r.data.workspace.workspaces).toHaveLength(1);
    expect(r.data.workspace.workspaces[0]!.state.editorCursorByPath).toEqual({});
    expect(r.data.workspace.workspaces[0]!.state.fileTreeScrollAnchor).toBeNull();
  });
});

describe('migrateV4DataToV5', () => {
  it('preserves the 4 M6b fields and adds the 2 M6c fields with empty defaults', () => {
    const v4 = {
      workspace: {
        workspaces: [
          {
            id: 'tab-1',
            path: 'C:/proj',
            addedAt: 1,
            state: {
              expandedDirs: ['a'],
              selectedPath: 'b',
              openEditorTabPaths: ['c'],
              activeEditorTabPath: 'c',
              editorCursorByPath: {},
              fileTreeScrollAnchor: null,
            },
          },
        ],
        activeId: 'tab-1',
        recents: [],
      },
      voicePreferences: { provider: 'wispr' as const },
      toolSettings: {
        disabledToolNames: [] as string[],
        confirmationMode: {} as Record<string, 'always_allow' | 'always_confirm' | 'per_call'>,
      },
    };
    const v5 = migrateV4DataToV5(v4);
    expect(v5.workspace.workspaces[0]!.state).toEqual({
      expandedDirs: ['a'],
      selectedPath: 'b',
      openEditorTabPaths: ['c'],
      activeEditorTabPath: 'c',
      editorCursorByPath: {},
      fileTreeScrollAnchor: null,
    });
  });
});

describe('serialisedFileLooksPrivateV5', () => {
  it('returns true for a typical v5 file (no forbidden substrings)', () => {
    const s = serialiseLipiStateV5(buildLipiStateV5(sampleData));
    expect(serialisedFileLooksPrivateV5(s)).toBe(true);
  });

  it('returns false if a known API-key prefix is in the serialised output', () => {
    const s = serialiseLipiStateV5(buildLipiStateV5(sampleData)).replace(
      'wispr',
      'sk-ant-XXXX',
    );
    expect(serialisedFileLooksPrivateV5(s)).toBe(false);
  });
});
