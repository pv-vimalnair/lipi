/**
 * Tests for the S2 v2 settings IO module.
 *
 * The module is pure (no IO, no store imports),
 * so the tests are pure. Coverage:
 *
 *   1. Round-trip — `build` then `parse` of a
 *      fixture returns the same `data`.
 *   2. Error branches — every `ParseError` kind
 *      (not-json, wrong-shape, wrong-format,
 *      unsupported-version, invalid-data).
 *   3. Wire shape — the magic string and version
 *      are present in the output.
 *   4. Filename — the suggested filename
 *      matches the convention.
 *   5. Privacy — the serialised output does not
 *      contain any of the excluded storage keys
 *      or known key prefixes.
 *   6. Per-sub-payload validation — each of the
 *      three sub-payloads (workspace, voice,
 *      toolSettings) has its own invalid-data
 *      path.
 */
import { describe, expect, it } from 'vitest';

import {
  buildLipiStateV2,
  LIPI_STATE_V2_FORMAT,
  LIPI_STATE_V2_PRIVACY_STATEMENT,
  LIPI_STATE_V2_VERSION,
  parseLipiStateV2,
  serialiseLipiStateV2,
  serialisedFileLooksPrivate,
  suggestLipiStateV2Filename,
  type LipiStateV2Data,
} from './settingsIOv2';

const FIXTURE: LipiStateV2Data = {
  workspace: {
    currentPath: 'C:/Users/dev/proj',
    recents: ['C:/Users/dev/proj', 'C:/Users/dev/other'],
  },
  voicePreferences: { provider: 'wispr' },
  toolSettings: {
    disabledToolNames: ['run_shell_command'],
    confirmationMode: {
      get_file_contents: 'always_allow',
      run_shell_command: 'always_confirm',
    },
  },
};

describe('buildLipiStateV2 + parseLipiStateV2 round-trip', () => {
  it('round-trips a fixture unchanged', () => {
    const built = buildLipiStateV2(FIXTURE);
    const s = serialiseLipiStateV2(built);
    const parsed = parseLipiStateV2(s);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data).toEqual(FIXTURE);
    }
  });

  it('sets format to "lipi-state" and version to 2', () => {
    const built = buildLipiStateV2(FIXTURE);
    expect(built.format).toBe(LIPI_STATE_V2_FORMAT);
    expect(built.version).toBe(LIPI_STATE_V2_VERSION);
  });

  it('records an exportedAt timestamp (parseable ISO-8601)', () => {
    const built = buildLipiStateV2(FIXTURE, new Date('2026-06-12T10:00:00Z'));
    expect(built.exportedAt).toBe('2026-06-12T10:00:00.000Z');
  });
});

describe('parseLipiStateV2 error branches', () => {
  it('rejects non-JSON with kind: "not-json"', () => {
    const r = parseLipiStateV2('not json at all');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('not-json');
    }
  });

  it('rejects non-object top-level with kind: "wrong-shape"', () => {
    const r = parseLipiStateV2(JSON.stringify('a string'));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('wrong-shape');
    }
  });

  it('rejects the v1 magic string with kind: "wrong-format"', () => {
    const v1Shape = {
      format: 'lipi-settings',
      version: 1,
      exportedAt: '2026-06-12T10:00:00.000Z',
      data: { toolSettings: { disabledToolNames: [], confirmationMode: {} } },
    };
    const r = parseLipiStateV2(JSON.stringify(v1Shape));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('wrong-format');
    }
  });

  it('rejects a non-integer version with kind: "wrong-shape"', () => {
    const r = parseLipiStateV2(
      JSON.stringify({
        format: 'lipi-state',
        version: 2.5,
        exportedAt: '...',
        data: FIXTURE,
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('wrong-shape');
    }
  });

  it('rejects a future version with kind: "unsupported-version"', () => {
    const r = parseLipiStateV2(
      JSON.stringify({
        format: 'lipi-state',
        version: 99,
        exportedAt: '...',
        data: FIXTURE,
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('unsupported-version');
    }
  });

  it('rejects an older version with kind: "unsupported-version"', () => {
    const r = parseLipiStateV2(
      JSON.stringify({
        format: 'lipi-state',
        version: 1,
        exportedAt: '...',
        data: FIXTURE,
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('unsupported-version');
    }
  });

  it('rejects a missing data block with kind: "wrong-shape"', () => {
    const r = parseLipiStateV2(
      JSON.stringify({
        format: 'lipi-state',
        version: 2,
        exportedAt: '...',
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('wrong-shape');
    }
  });

  it('rejects a workspace with non-string recents with kind: "invalid-data"', () => {
    const r = parseLipiStateV2(
      JSON.stringify({
        format: 'lipi-state',
        version: 2,
        exportedAt: '...',
        data: {
          ...FIXTURE,
          workspace: { currentPath: null, recents: [123] },
        },
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('invalid-data');
    }
  });

  it('rejects an invalid voice provider with kind: "invalid-data"', () => {
    const r = parseLipiStateV2(
      JSON.stringify({
        format: 'lipi-state',
        version: 2,
        exportedAt: '...',
        data: {
          ...FIXTURE,
          voicePreferences: { provider: 'bogus' },
        },
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('invalid-data');
    }
  });

  it('rejects an invalid confirmationMode value with kind: "invalid-data"', () => {
    const r = parseLipiStateV2(
      JSON.stringify({
        format: 'lipi-state',
        version: 2,
        exportedAt: '...',
        data: {
          ...FIXTURE,
          toolSettings: {
            disabledToolNames: [],
            confirmationMode: { foo: 'nope' },
          },
        },
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('invalid-data');
    }
  });
});

describe('serialiseLipiStateV2', () => {
  it('pretty-prints with 2-space indent and a trailing newline', () => {
    const s = serialiseLipiStateV2(buildLipiStateV2(FIXTURE));
    expect(s).toContain('\n  "format"');
    expect(s.endsWith('\n')).toBe(true);
  });
});

describe('suggestLipiStateV2Filename', () => {
  it('uses the local date with a "lipi-state-" prefix', () => {
    const f = suggestLipiStateV2Filename(new Date(2026, 5, 12)); // June 12, 2026 (month is 0-indexed)
    expect(f).toBe('lipi-state-2026-06-12.json');
  });
  it('zero-pads the month and day', () => {
    const f = suggestLipiStateV2Filename(new Date(2026, 0, 5));
    expect(f).toBe('lipi-state-2026-01-05.json');
  });
});

describe('privacy scope', () => {
  it('the serialised file does not contain any of the forbidden key prefixes', () => {
    const s = serialiseLipiStateV2(buildLipiStateV2(FIXTURE));
    expect(serialisedFileLooksPrivate(s)).toBe(true);
  });

  it('a serialised file with a smuggled `sk-` key is flagged', () => {
    // A defence-in-depth smoke test: even if a
    // future contributor accidentally added a
    // field that contains an `sk-` prefix, the
    // `serialisedFileLooksPrivate` function would
    // catch it. The build path does not embed
    // anything matching the prefix; the test
    // pins the contract.
    const polluted = serialiseLipiStateV2(buildLipiStateV2(FIXTURE)) +
      '\n/* leaked: sk-abc... */';
    expect(serialisedFileLooksPrivate(polluted)).toBe(false);
  });

  it('the privacy statement mentions keys are NOT exported', () => {
    expect(LIPI_STATE_V2_PRIVACY_STATEMENT).toMatch(/does NOT contain/i);
    expect(LIPI_STATE_V2_PRIVACY_STATEMENT).toMatch(/API key/i);
  });
});
