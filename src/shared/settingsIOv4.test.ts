/**
 * Tests for the v4 schema, parser,
 * builder, and serialiser.
 *
 * The v4 schema is the M6b upgrade
 * to the v2/v3 file format: a v4
 * file has a `workspaces[]` array
 * of `WorkspaceTab` objects plus an
 * `activeId`, and each tab carries
 * its own per-tab `state`. The
 * parser auto-detects v3 input
 * (no `version` field, has
 * `workspace.currentPath`) and
 * runs an in-memory v3 → v4
 * migration.
 *
 * The schema, builder, and
 * serialiser are pure (no store
 * imports, no IO) so they can be
 * tested in isolation. The apply
 * and preview modules have their
 * own test files.
 */
import { describe, expect, it } from 'vitest';

import {
  buildLipiStateV4,
  LIPI_STATE_V4_FORMAT,
  LIPI_STATE_V4_VERSION,
  migrateV3DataToV4,
  parseLipiStateV4,
  serialiseLipiStateV4,
  serialisedFileLooksPrivateV4,
  suggestLipiStateV4Filename,
  type LipiStateV4Data,
  type LipiStateV4File,
} from './settingsIOv4';

function emptyTab(path: string) {
  return {
    id: `tab-${path}`,
    path,
    addedAt: 1000,
    state: {
      expandedDirs: [] as string[],
      selectedPath: null,
      openEditorTabPaths: [] as string[],
      activeEditorTabPath: null,
      editorCursorByPath: {},
      fileTreeScrollAnchor: null,
    },
  };
}

const sampleData: LipiStateV4Data = {
  workspace: {
    workspaces: [
      {
        id: 'tab-1',
        path: 'C:/Users/me/proj1',
        addedAt: 1000,
        state: {
          expandedDirs: ['C:/Users/me/proj1/src'],
          selectedPath: 'C:/Users/me/proj1/src/index.ts',
          openEditorTabPaths: ['C:/Users/me/proj1/src/index.ts'],
          activeEditorTabPath: 'C:/Users/me/proj1/src/index.ts',
          editorCursorByPath: {},
          fileTreeScrollAnchor: null,
        },
      },
      emptyTab('C:/Users/me/proj2'),
    ],
    activeId: 'tab-1',
    recents: ['C:/Users/me/proj1', 'C:/Users/me/proj2'],
  },
  voicePreferences: { provider: 'wispr' },
  toolSettings: {
    disabledToolNames: ['run_shell_command'],
    confirmationMode: { run_shell_command: 'always_confirm' },
  },
};

describe('LIPI_STATE_V4_VERSION + LIPI_STATE_V4_FORMAT', () => {
  it('has version 4 and the lipi-state magic string', () => {
    expect(LIPI_STATE_V4_VERSION).toBe(4);
    expect(LIPI_STATE_V4_FORMAT).toBe('lipi-state');
  });
});

describe('buildLipiStateV4', () => {
  it('builds a v4 file with the right magic + version + ISO timestamp', () => {
    const file = buildLipiStateV4(sampleData, new Date('2026-06-13T10:00:00Z'));
    expect(file.format).toBe('lipi-state');
    expect(file.version).toBe(4);
    expect(file.exportedAt).toBe('2026-06-13T10:00:00.000Z');
    expect(file.data).toEqual(sampleData);
  });
});

describe('serialiseLipiStateV4', () => {
  it('produces a pretty-printed JSON string with a trailing newline', () => {
    const file = buildLipiStateV4(sampleData);
    const s = serialiseLipiStateV4(file);
    expect(s.endsWith('\n')).toBe(true);
    expect(s).toContain('"version": 4');
    expect(s).toContain('"format": "lipi-state"');
    // Pretty-printed: 2-space indent.
    expect(s).toMatch(/\n {2}"format"/);
  });

  it('round-trips through parseLipiStateV4', () => {
    const file = buildLipiStateV4(sampleData);
    const text = serialiseLipiStateV4(file);
    const parsed = parseLipiStateV4(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.sourceFormat).toBe('v4');
    expect(parsed.data).toEqual(sampleData);
  });
});

describe('suggestLipiStateV4Filename', () => {
  it('produces a YYYY-MM-DD filename with the v4 prefix', () => {
    const name = suggestLipiStateV4Filename(new Date('2026-06-13T10:00:00Z'));
    expect(name).toBe('lipi-state-v4-2026-06-13.json');
  });
});

describe('parseLipiStateV4 — v4 native input', () => {
  it('parses a v4 file (version 4) and returns sourceFormat: v4', () => {
    const file = buildLipiStateV4(sampleData);
    const parsed = parseLipiStateV4(serialiseLipiStateV4(file));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.sourceFormat).toBe('v4');
    expect(parsed.data).toEqual(sampleData);
  });

  it('rejects JSON that is not an object', () => {
    const r = parseLipiStateV4('"hello"');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('wrong-shape');
  });

  it('rejects a wrong-format file', () => {
    const r = parseLipiStateV4('{"format":"other","version":4}');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('wrong-format');
  });

  it('rejects an unsupported version (e.g. 5)', () => {
    const r = parseLipiStateV4(
      JSON.stringify({ format: 'lipi-state', version: 5, data: {} }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('unsupported-version');
  });

  it('rejects a missing data block', () => {
    const r = parseLipiStateV4(
      JSON.stringify({ format: 'lipi-state', version: 4 }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('wrong-shape');
  });

  it('rejects invalid data (workspace.workspaces not an array)', () => {
    const r = parseLipiStateV4(
      JSON.stringify({
        format: 'lipi-state',
        version: 4,
        data: {
          workspace: { workspaces: 'not-an-array', activeId: null, recents: [] },
          voicePreferences: { provider: 'wispr' },
          toolSettings: { disabledToolNames: [], confirmationMode: {} },
        },
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('invalid-data');
  });

  it('rejects invalid data (state field missing on a tab)', () => {
    const r = parseLipiStateV4(
      JSON.stringify({
        format: 'lipi-state',
        version: 4,
        data: {
          workspace: {
            workspaces: [
              { id: 't1', path: 'C:/x', addedAt: 1000 /* no state field */ },
            ],
            activeId: 't1',
            recents: [],
          },
          voicePreferences: { provider: 'wispr' },
          toolSettings: { disabledToolNames: [], confirmationMode: {} },
        },
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('invalid-data');
  });

  it('rejects invalid data (state.expandedDirs is not an array)', () => {
    const r = parseLipiStateV4(
      JSON.stringify({
        format: 'lipi-state',
        version: 4,
        data: {
          workspace: {
            workspaces: [
              {
                id: 't1',
                path: 'C:/x',
                addedAt: 1000,
                state: {
                  expandedDirs: 'not-an-array',
                  selectedPath: null,
                  openEditorTabPaths: [],
                  activeEditorTabPath: null,
                },
              },
            ],
            activeId: 't1',
            recents: [],
          },
          voicePreferences: { provider: 'wispr' },
          toolSettings: { disabledToolNames: [], confirmationMode: {} },
        },
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('invalid-data');
  });

  it('rejects invalid data (selectedPath is not a string or null)', () => {
    // Build a valid v4 file, then mutate the
    // serialised JSON to have a non-string
    // selectedPath.
    const raw = JSON.parse(serialiseLipiStateV4(buildLipiStateV4(sampleData)));
    raw.data.workspace.workspaces[0].state.selectedPath = 42;
    const r = parseLipiStateV4(JSON.stringify(raw));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('invalid-data');
  });
});

describe('parseLipiStateV4 — v3 → v4 migration', () => {
  // A v3 file is the S2/S3
  // export format: no
  // `version` field (or
  // `version: 2` or 3), and
  // the workspace has a
  // `currentPath` instead of
  // a `workspaces[]` array.
  const v3 = {
    format: 'lipi-state',
    version: 2, // could be 2, 3, or absent
    exportedAt: '2026-06-12T...',
    data: {
      workspace: {
        currentPath: 'C:/Users/me/proj',
        recents: ['C:/Users/me/proj', 'C:/Users/me/other'],
      },
      voicePreferences: { provider: 'wispr' },
      toolSettings: {
        disabledToolNames: ['run_shell_command'],
        confirmationMode: { run_shell_command: 'always_confirm' },
      },
    },
  };

  it('parses a v3 file and runs the in-memory v3 → v4 migration', () => {
    const text = JSON.stringify(v3);
    const parsed = parseLipiStateV4(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.sourceFormat).toBe('v3');
    // The migration wraps
    // currentPath in a single
    // tab with empty per-tab
    // state.
    expect(parsed.data.workspace.workspaces).toHaveLength(1);
    expect(parsed.data.workspace.workspaces[0]!.path).toBe('C:/Users/me/proj');
    expect(parsed.data.workspace.workspaces[0]!.state).toEqual({
      expandedDirs: [],
      selectedPath: null,
      openEditorTabPaths: [],
      activeEditorTabPath: null,
      editorCursorByPath: {},
      fileTreeScrollAnchor: null,
    });
    expect(parsed.data.workspace.activeId).toBe(
      parsed.data.workspace.workspaces[0]!.id,
    );
    // recents carries over.
    expect(parsed.data.workspace.recents).toEqual([
      'C:/Users/me/proj',
      'C:/Users/me/other',
    ]);
    // voice + tool settings
    // carry over.
    expect(parsed.data.voicePreferences).toEqual({ provider: 'wispr' });
    expect(parsed.data.toolSettings).toEqual({
      disabledToolNames: ['run_shell_command'],
      confirmationMode: { run_shell_command: 'always_confirm' },
    });
  });

  it('handles a v3 file with currentPath = null (empty workspaces[])', () => {
    const v3Empty = {
      ...v3,
      data: {
        ...v3.data,
        workspace: { currentPath: null, recents: [] },
      },
    };
    const parsed = parseLipiStateV4(JSON.stringify(v3Empty));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.sourceFormat).toBe('v3');
    expect(parsed.data.workspace.workspaces).toEqual([]);
    expect(parsed.data.workspace.activeId).toBeNull();
    expect(parsed.data.workspace.recents).toEqual([]);
  });

  it('handles a v3 file with no `version` field (S2 magic-string-only)', () => {
    const v3NoVersion = { ...v3 };
    delete (v3NoVersion as { version?: number }).version;
    const parsed = parseLipiStateV4(JSON.stringify(v3NoVersion));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.sourceFormat).toBe('v3');
  });

  it('handles a v3 file with explicit `version: 3`', () => {
    const v3Explicit = { ...v3, version: 3 };
    const parsed = parseLipiStateV4(JSON.stringify(v3Explicit));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.sourceFormat).toBe('v3');
  });

  it('rejects a v3 file with invalid inner data (e.g. recents contains non-strings)', () => {
    const v3Bad = {
      ...v3,
      data: {
        ...v3.data,
        workspace: { currentPath: 'C:/x', recents: [42] },
      },
    };
    const parsed = parseLipiStateV4(JSON.stringify(v3Bad));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.kind).toBe('invalid-data');
  });
});

describe('migrateV3DataToV4 (pure)', () => {
  it('wraps currentPath in a single tab with empty state', () => {
    const v3 = {
      workspace: { currentPath: 'C:/x', recents: ['C:/x'] },
      voicePreferences: { provider: 'wispr' as const },
      toolSettings: {
        disabledToolNames: [],
        confirmationMode: {},
      },
    };
    const v4 = migrateV3DataToV4(v3, 1000, () => 'fixed-id');
    expect(v4.workspace.workspaces).toHaveLength(1);
    expect(v4.workspace.workspaces[0]!.id).toBe('fixed-id');
    expect(v4.workspace.workspaces[0]!.path).toBe('C:/x');
    expect(v4.workspace.workspaces[0]!.addedAt).toBe(1000);
    expect(v4.workspace.workspaces[0]!.state).toEqual({
      expandedDirs: [],
      selectedPath: null,
      openEditorTabPaths: [],
      activeEditorTabPath: null,
      editorCursorByPath: {},
      fileTreeScrollAnchor: null,
    });
    expect(v4.workspace.activeId).toBe('fixed-id');
    expect(v4.workspace.recents).toEqual(['C:/x']);
  });

  it('handles currentPath = null (no tabs)', () => {
    const v3 = {
      workspace: { currentPath: null, recents: [] },
      voicePreferences: { provider: 'stub' as const },
      toolSettings: {
        disabledToolNames: [],
        confirmationMode: {},
      },
    };
    const v4 = migrateV3DataToV4(v3);
    expect(v4.workspace.workspaces).toEqual([]);
    expect(v4.workspace.activeId).toBeNull();
  });
});

describe('serialisedFileLooksPrivateV4', () => {
  it('passes for a clean v4 file', () => {
    const file = buildLipiStateV4(sampleData);
    const s = serialiseLipiStateV4(file);
    expect(serialisedFileLooksPrivateV4(s)).toBe(true);
  });

  it('flags a leaked OpenAI key', () => {
    const dirty: LipiStateV4File = {
      ...buildLipiStateV4(sampleData),
      data: {
        ...sampleData,
        workspace: {
          ...sampleData.workspace,
          recents: [...sampleData.workspace.recents, 'sk-12345'],
        },
      },
    };
    expect(serialisedFileLooksPrivateV4(serialiseLipiStateV4(dirty))).toBe(false);
  });
});
