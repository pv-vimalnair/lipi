/**
 * Tests for the S3 import
 * preview helper. Per project
 * convention (Rule 4), we test
 * the pure logic in isolation —
 * no React, no Tauri mocks.
 */

import { describe, expect, it } from 'vitest';

import { computeLipiStateImportPreview } from './settingsIOv3.preview';
import type { LipiStateV2Data } from './settingsIOv2';

const BASE: LipiStateV2Data = {
  workspace: {
    currentPath: 'C:/Users/me/proj',
    recents: ['C:/Users/me/proj', 'C:/Users/me/other'],
  },
  voicePreferences: { provider: 'stub' },
  toolSettings: {
    disabledToolNames: ['run_shell_command'],
    confirmationMode: { run_shell_command: 'always_confirm' },
  },
};

describe('computeLipiStateImportPreview', () => {
  it('returns isNoOp:true when current and incoming are identical', () => {
    const preview = computeLipiStateImportPreview(BASE, BASE);
    expect(preview.isNoOp).toBe(true);
    expect(preview.changeCount).toBe(0);
    expect(preview.diffs).toEqual([]);
  });

  it('reports a workspace.currentPath change', () => {
    const preview = computeLipiStateImportPreview(BASE, {
      ...BASE,
      workspace: { ...BASE.workspace, currentPath: 'D:/new/proj' },
    });
    expect(preview.isNoOp).toBe(false);
    expect(preview.diffs).toContainEqual({
      path: 'workspace.currentPath',
      before: 'C:/Users/me/proj',
      after: 'D:/new/proj',
    });
  });

  it('reports a workspace.currentPath: null → string change', () => {
    const preview = computeLipiStateImportPreview(
      { ...BASE, workspace: { ...BASE.workspace, currentPath: null } },
      BASE,
    );
    expect(preview.diffs).toContainEqual({
      path: 'workspace.currentPath',
      before: null,
      after: 'C:/Users/me/proj',
    });
  });

  it('reports added + removed recents', () => {
    const preview = computeLipiStateImportPreview(BASE, {
      ...BASE,
      workspace: {
        ...BASE.workspace,
        recents: ['C:/Users/me/proj', 'C:/Users/another'],
      },
    });
    const recentsDiff = preview.diffs.find(
      (d) => d.path === 'workspace.recents',
    );
    expect(recentsDiff).toBeDefined();
    expect(recentsDiff!.after).toEqual({ added: ['C:/Users/another'], removed: [] });
    expect(recentsDiff!.before).toEqual({ added: [], removed: ['C:/Users/me/other'] });
  });

  it('reports a voicePreferences.provider change', () => {
    const preview = computeLipiStateImportPreview(BASE, {
      ...BASE,
      voicePreferences: { provider: 'wispr' },
    });
    expect(preview.diffs).toContainEqual({
      path: 'voicePreferences.provider',
      before: 'stub',
      after: 'wispr',
    });
  });

  it('reports an added disabled tool', () => {
    const preview = computeLipiStateImportPreview(BASE, {
      ...BASE,
      toolSettings: {
        ...BASE.toolSettings,
        disabledToolNames: ['run_shell_command', 'new_tool'],
      },
    });
    const diff = preview.diffs.find(
      (d) => d.path === 'toolSettings.disabledToolNames',
    );
    expect(diff).toBeDefined();
    expect(diff!.after).toEqual({ added: ['new_tool'], removed: [] });
  });

  it('reports a removed disabled tool', () => {
    const preview = computeLipiStateImportPreview(
      BASE,
      {
        ...BASE,
        toolSettings: {
          ...BASE.toolSettings,
          disabledToolNames: [],
        },
      },
    );
    const diff = preview.diffs.find(
      (d) => d.path === 'toolSettings.disabledToolNames',
    );
    expect(diff).toBeDefined();
    expect(diff!.before).toEqual({ added: [], removed: ['run_shell_command'] });
  });

  it('reports a per-tool confirmationMode change', () => {
    const preview = computeLipiStateImportPreview(BASE, {
      ...BASE,
      toolSettings: {
        ...BASE.toolSettings,
        confirmationMode: { run_shell_command: 'per_call' },
      },
    });
    expect(preview.diffs).toContainEqual({
      path: 'toolSettings.confirmationMode.run_shell_command',
      before: 'always_confirm',
      after: 'per_call',
    });
  });

  it('reports a confirmationMode tool that exists in incoming but not in current', () => {
    const preview = computeLipiStateImportPreview(BASE, {
      ...BASE,
      toolSettings: {
        ...BASE.toolSettings,
        confirmationMode: {
          run_shell_command: 'always_confirm',
          new_tool: 'always_allow',
        },
      },
    });
    expect(preview.diffs).toContainEqual({
      path: 'toolSettings.confirmationMode.new_tool',
      before: null,
      after: 'always_allow',
    });
  });

  it('reports a confirmationMode tool that exists in current but not in incoming (was: x, now: null)', () => {
    const preview = computeLipiStateImportPreview(
      {
        ...BASE,
        toolSettings: {
          ...BASE.toolSettings,
          confirmationMode: {
            run_shell_command: 'always_confirm',
            old_tool: 'always_allow',
          },
        },
      },
      BASE,
    );
    expect(preview.diffs).toContainEqual({
      path: 'toolSettings.confirmationMode.old_tool',
      before: 'always_allow',
      after: null,
    });
  });

  it('changeCount matches diffs.length', () => {
    const preview = computeLipiStateImportPreview(BASE, {
      ...BASE,
      workspace: { currentPath: 'D:/other', recents: [] },
      voicePreferences: { provider: 'wispr' },
      toolSettings: {
        disabledToolNames: ['a', 'b'],
        confirmationMode: { a: 'always_allow' },
      },
    });
    expect(preview.changeCount).toBe(preview.diffs.length);
    expect(preview.changeCount).toBeGreaterThan(0);
  });
});
