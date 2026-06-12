/**
 * Tests for the settings import/export
 * module (5b).
 *
 * Coverage:
 *   - `parseSettingsFile` happy path:
 *     round-trips a fresh export.
 *   - `parseSettingsFile` rejects:
 *     - bad JSON (not-json)
 *     - non-object top-level (wrong-shape)
 *     - wrong format magic (wrong-format)
 *     - missing version (wrong-shape)
 *     - version too new (unsupported-version)
 *     - version too old (unsupported-version)
 *     - non-object data block (wrong-shape)
 *     - missing toolSettings (invalid-data)
 *     - disabledToolNames not array (invalid-data)
 *     - disabledToolNames with non-strings (invalid-data)
 *     - confirmationMode not object (invalid-data)
 *     - confirmationMode with invalid mode (invalid-data)
 *   - `buildSettingsFile` produces a
 *     valid file with the current
 *     timestamp.
 *   - `serialiseSettingsFile` produces
 *     valid JSON (round-trips through
 *     `parseSettingsFile`).
 *   - `suggestFilename` uses the local
 *     date.
 *   - empty-state round-trip (no
 *     disabled tools, no custom
 *     policies).
 *   - large round-trip (100 disabled
 *     tools + 100 policies).
 *   - file size sanity (a typical
 *     export is well under 10KB).
 *
 * We test the IO functions in
 * isolation — no store, no DOM,
 * no Tauri. Pure functions, pure
 * tests.
 */

import { describe, expect, it } from 'vitest';
import {
  SETTINGS_FILE_FORMAT,
  SETTINGS_FILE_VERSION,
  buildSettingsFile,
  parseSettingsFile,
  serialiseSettingsFile,
  suggestFilename,
  type ExportedToolSettings,
} from './settingsIO';

function sampleSettings(): ExportedToolSettings {
  return {
    disabledToolNames: ['get_file_contents', 'run_npm_test'],
    confirmationMode: {
      run_npm_test: 'always_confirm',
      read_file: 'per_call',
    },
  };
}

describe('settingsIO', () => {
  describe('buildSettingsFile', () => {
    it('wraps the payload in the schema-versioned envelope', () => {
      const file = buildSettingsFile(sampleSettings());
      expect(file.format).toBe(SETTINGS_FILE_FORMAT);
      expect(file.version).toBe(SETTINGS_FILE_VERSION);
      expect(file.data.toolSettings).toEqual(sampleSettings());
    });

    it('records the export timestamp as an ISO-8601 string', () => {
      const now = new Date('2026-06-11T15:30:00.000Z');
      const file = buildSettingsFile(sampleSettings(), now);
      expect(file.exportedAt).toBe('2026-06-11T15:30:00.000Z');
    });

    it('defaults `now` to the current time (smoke check, not exact)', () => {
      const before = Date.now();
      const file = buildSettingsFile(sampleSettings());
      const after = Date.now();
      const ts = new Date(file.exportedAt).getTime();
      // The recorded timestamp should
      // be in [before, after]. We
      // allow 10ms of slop for the
      // cost of `new Date()`.
      expect(ts).toBeGreaterThanOrEqual(before - 10);
      expect(ts).toBeLessThanOrEqual(after + 10);
    });
  });

  describe('serialiseSettingsFile', () => {
    it('produces a valid JSON string that round-trips', () => {
      const file = buildSettingsFile(sampleSettings());
      const text = serialiseSettingsFile(file);
      // Trailing newline per
      // project convention.
      expect(text.endsWith('\n')).toBe(true);
      const parsed = parseSettingsFile(text);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.data).toEqual(sampleSettings());
      }
    });

    it('pretty-prints with 2-space indent (so the file is human-readable)', () => {
      const file = buildSettingsFile(sampleSettings());
      const text = serialiseSettingsFile(file);
      // The line `  "format"` (with
      // 2-space indent) should
      // appear in the output. We
      // check for the property +
      // indent combo, not the
      // whole line.
      expect(text).toMatch(/\n  "format":/);
    });
  });

  describe('parseSettingsFile (happy path)', () => {
    it('round-trips a non-empty tool-settings payload', () => {
      const original = sampleSettings();
      const text = serialiseSettingsFile(buildSettingsFile(original));
      const result = parseSettingsFile(text);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual(original);
      }
    });

    it('round-trips an empty tool-settings payload', () => {
      // Fresh install: no disabled
      // tools, no custom policies.
      // The export should still
      // work.
      const empty: ExportedToolSettings = {
        disabledToolNames: [],
        confirmationMode: {},
      };
      const text = serialiseSettingsFile(buildSettingsFile(empty));
      const result = parseSettingsFile(text);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual(empty);
      }
    });

    it('round-trips a large payload (100 tools, 100 policies)', () => {
      const big: ExportedToolSettings = {
        disabledToolNames: Array.from({ length: 100 }, (_, i) => `t${i}`),
        confirmationMode: Object.fromEntries(
          Array.from({ length: 100 }, (_, i) => [
            `p${i}`,
            i % 3 === 0
              ? 'always_allow'
              : i % 3 === 1
                ? 'always_confirm'
                : 'per_call',
          ]),
        ),
      };
      const text = serialiseSettingsFile(buildSettingsFile(big));
      const result = parseSettingsFile(text);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.disabledToolNames).toEqual(big.disabledToolNames);
        expect(result.data.confirmationMode).toEqual(big.confirmationMode);
      }
    });
  });

  describe('parseSettingsFile (rejections)', () => {
    it('rejects non-JSON text with kind: "not-json"', () => {
      const result = parseSettingsFile('not json at all');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('not-json');
      }
    });

    it('rejects a JSON null with kind: "wrong-shape"', () => {
      const result = parseSettingsFile('null');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('wrong-shape');
      }
    });

    it('rejects a JSON array (any non-object top-level is "wrong-format" because the magic check is the first guard)', () => {
      // The parser checks
      // `typeof raw !== 'object'`
      // FIRST, then `r.format !==
      // SETTINGS_FILE_FORMAT`. For
      // a JSON array, `typeof []`
      // is `'object'` in JS, so
      // the shape check passes —
      // we then fall through to
      // the magic check and
      // report `wrong-format`
      // (an array has no
      // `format` field). The
      // user gets a clear "this
      // isn't a Lipi settings
      // file" message either way.
      const result = parseSettingsFile('[]');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('wrong-format');
      }
    });

    it('rejects an object with the wrong `format` magic string', () => {
      const text = JSON.stringify({
        format: 'something-else',
        version: 1,
        data: { toolSettings: { disabledToolNames: [], confirmationMode: {} } },
      });
      const result = parseSettingsFile(text);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('wrong-format');
      }
    });

    it('rejects a missing `version` field', () => {
      const text = JSON.stringify({
        format: SETTINGS_FILE_FORMAT,
        data: { toolSettings: { disabledToolNames: [], confirmationMode: {} } },
      });
      const result = parseSettingsFile(text);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('wrong-shape');
      }
    });

    it('rejects a non-integer `version`', () => {
      const text = JSON.stringify({
        format: SETTINGS_FILE_FORMAT,
        version: 1.5,
        data: { toolSettings: { disabledToolNames: [], confirmationMode: {} } },
      });
      const result = parseSettingsFile(text);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('wrong-shape');
      }
    });

    it('rejects a version greater than SETTINGS_FILE_VERSION', () => {
      const text = JSON.stringify({
        format: SETTINGS_FILE_FORMAT,
        version: SETTINGS_FILE_VERSION + 1,
        data: { toolSettings: { disabledToolNames: [], confirmationMode: {} } },
      });
      const result = parseSettingsFile(text);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('unsupported-version');
      }
    });

    it('rejects a version less than SETTINGS_FILE_VERSION (forward compat path)', () => {
      // Today: version 0 doesn't
      // exist. If we ever ship a
      // v2, this branch handles
      // "user is reading an old
      // file with the new parser"
      // — the parser would need
      // to know how to read v1
      // explicitly. For now,
      // version 0 is rejected.
      const text = JSON.stringify({
        format: SETTINGS_FILE_FORMAT,
        version: 0,
        data: { toolSettings: { disabledToolNames: [], confirmationMode: {} } },
      });
      const result = parseSettingsFile(text);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('unsupported-version');
      }
    });

    it('rejects a missing `data` block', () => {
      const text = JSON.stringify({
        format: SETTINGS_FILE_FORMAT,
        version: SETTINGS_FILE_VERSION,
      });
      const result = parseSettingsFile(text);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('wrong-shape');
      }
    });

    it('rejects a missing `data.toolSettings`', () => {
      const text = JSON.stringify({
        format: SETTINGS_FILE_FORMAT,
        version: SETTINGS_FILE_VERSION,
        data: {},
      });
      const result = parseSettingsFile(text);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('invalid-data');
      }
    });

    it('rejects a non-array `disabledToolNames`', () => {
      const text = JSON.stringify({
        format: SETTINGS_FILE_FORMAT,
        version: SETTINGS_FILE_VERSION,
        data: {
          toolSettings: {
            disabledToolNames: 'not-an-array',
            confirmationMode: {},
          },
        },
      });
      const result = parseSettingsFile(text);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('invalid-data');
      }
    });

    it('rejects a `disabledToolNames` with non-string entries', () => {
      const text = JSON.stringify({
        format: SETTINGS_FILE_FORMAT,
        version: SETTINGS_FILE_VERSION,
        data: {
          toolSettings: {
            disabledToolNames: [1, 2, 3],
            confirmationMode: {},
          },
        },
      });
      const result = parseSettingsFile(text);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('invalid-data');
      }
    });

    it('rejects a non-object `confirmationMode`', () => {
      const text = JSON.stringify({
        format: SETTINGS_FILE_FORMAT,
        version: SETTINGS_FILE_VERSION,
        data: {
          toolSettings: {
            disabledToolNames: [],
            confirmationMode: 'not-an-object',
          },
        },
      });
      const result = parseSettingsFile(text);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('invalid-data');
      }
    });

    it('rejects a `confirmationMode` with an invalid mode value', () => {
      const text = JSON.stringify({
        format: SETTINGS_FILE_FORMAT,
        version: SETTINGS_FILE_VERSION,
        data: {
          toolSettings: {
            disabledToolNames: [],
            confirmationMode: { a: 'never-ask' },
          },
        },
      });
      const result = parseSettingsFile(text);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('invalid-data');
      }
    });

    it('error messages are human-readable (mention the field, not just the kind)', () => {
      // Defensive: a future
      // maintainer should be able
      // to debug a bad file from
      // the error message alone,
      // without having to attach
      // a debugger to the parser.
      const text = JSON.stringify({
        format: SETTINGS_FILE_FORMAT,
        version: SETTINGS_FILE_VERSION,
        data: {
          toolSettings: {
            disabledToolNames: 'not-an-array',
            confirmationMode: {},
          },
        },
      });
      const result = parseSettingsFile(text);
      if (!result.ok) {
        expect(result.error.message.length).toBeGreaterThan(0);
        // The message should
        // mention the offending
        // field name so the user
        // can fix the file by
        // hand if they want.
        expect(result.error.message).toContain('disabledToolNames');
      } else {
        // Fail the test if the
        // parser unexpectedly
        // accepted the bad input.
        expect(result.ok).toBe(false);
      }
    });
  });

  describe('suggestFilename', () => {
    it('uses the local date in YYYY-MM-DD form', () => {
      const date = new Date(2026, 5, 11); // June 11, 2026 (local)
      expect(suggestFilename(date)).toBe('lipi-settings-2026-06-11.json');
    });

    it('zero-pads single-digit months and days', () => {
      const date = new Date(2026, 0, 5); // Jan 5, 2026 (local)
      expect(suggestFilename(date)).toBe('lipi-settings-2026-01-05.json');
    });

    it('defaults `now` to the current time (smoke check)', () => {
      // The filename should
      // start with `lipi-settings-`
      // and end with `.json`. The
      // middle should be a
      // 10-char date string.
      expect(suggestFilename()).toMatch(
        /^lipi-settings-\d{4}-\d{2}-\d{2}\.json$/,
      );
    });
  });

  describe('file size sanity', () => {
    it('a typical export (a few disabled tools + a few policies) is well under 10KB', () => {
      // A few KB is well under
      // the 5MB localStorage
      // quota, so an exported
      // file is trivially
      // portable via clipboard,
      // email, USB stick.
      const text = serialiseSettingsFile(
        buildSettingsFile({
          disabledToolNames: ['a', 'b', 'c', 'd', 'e'],
          confirmationMode: {
            a: 'always_allow',
            b: 'always_confirm',
            c: 'per_call',
          },
        }),
      );
      expect(text.length).toBeLessThan(10_000);
    });

    it('even a 1000-tool export is well under 100KB', () => {
      // Sanity check: a power
      // user with 1000 disabled
      // tools + 1000 policies
      // would still produce a
      // file <100KB.
      const text = serialiseSettingsFile(
        buildSettingsFile({
          disabledToolNames: Array.from({ length: 1000 }, (_, i) => `t${i}`),
          confirmationMode: Object.fromEntries(
            Array.from({ length: 1000 }, (_, i) => [
              `p${i}`,
              i % 3 === 0
                ? 'always_allow'
                : i % 3 === 1
                  ? 'always_confirm'
                  : 'per_call',
            ]),
          ),
        }),
      );
      expect(text.length).toBeLessThan(100_000);
    });
  });
});
