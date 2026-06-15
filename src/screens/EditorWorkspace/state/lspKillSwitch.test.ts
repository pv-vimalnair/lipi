/**
 * Phase 9 / Phase 9.6 / Phase 9.2e — `lspKillSwitch`
 * unit tests. Covers the per-kind kill switch
 * (Phase 9.2e), the v1→v2 migration, the
 * completion sub-toggle (Phase 9.6), and the
 * defaults / malformed-value fallback for both.
 *
 * ## Shape
 *
 * Phase 9.2e replaced the v1 single-bool
 * `lipi:lsp:useRealServer:v1` with a v2
 * per-kind record at
 * `lipi:lsp:useRealServerByKind:v1`. The v1 key
 * is read on first access to seed the v2
 * record (forward migration); the v2 record is
 * the source of truth going forward.
 *
 * The completion sub-toggle
 * (`lipi:lsp:useRealServerForCompletion:v1`) is
 * unchanged — it's a global sub-toggle, not
 * per-kind.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getUseRealServer,
  getUseRealServerByKind,
  getUseRealServerForCompletion,
  setUseRealServer,
  setUseRealServerByKind,
  setUseRealServerForCompletion,
} from './lspKillSwitch';

const KEY_V1 = 'lipi:lsp:useRealServer:v1';
const KEY_V2 = 'lipi:lsp:useRealServerByKind:v1';
const KEY_COMPLETION = 'lipi:lsp:useRealServerForCompletion:v1';

beforeEach(() => {
  // Clean slate for every test. We can't
  // just `localStorage.clear()` because
  // some other suites share the same
  // jsdom instance — only the three keys
  // we own are reset.
  localStorage.removeItem(KEY_V1);
  localStorage.removeItem(KEY_V2);
  localStorage.removeItem(KEY_COMPLETION);
});

afterEach(() => {
  localStorage.removeItem(KEY_V1);
  localStorage.removeItem(KEY_V2);
  localStorage.removeItem(KEY_COMPLETION);
});

describe('lspKillSwitch — getUseRealServer(kind) (Phase 9.2e per-kind)', () => {
  it('returns the default `true` when no value is persisted for any kind', () => {
    expect(getUseRealServer('typescript')).toBe(true);
    expect(getUseRealServer('rust_analyzer')).toBe(true);
    expect(getUseRealServer('pyright')).toBe(true);
  });

  it('returns the persisted per-kind value when the v2 record is present', () => {
    setUseRealServerByKind({
      typescript: true,
      rust_analyzer: false,
      pyright: false,
      unknown: true,
    });
    expect(getUseRealServer('typescript')).toBe(true);
    expect(getUseRealServer('rust_analyzer')).toBe(false);
    expect(getUseRealServer('pyright')).toBe(false);
  });

  it('per-kind values are independent (flipping one does not affect another)', () => {
    setUseRealServer('rust_analyzer', false);
    expect(getUseRealServer('rust_analyzer')).toBe(false);
    expect(getUseRealServer('typescript')).toBe(true);
    expect(getUseRealServer('pyright')).toBe(true);
  });

  it('falls back to the default for a kind that is not in the v2 record', () => {
    setUseRealServerByKind({
      typescript: false,
      rust_analyzer: true,
      pyright: true,
      unknown: true,
    });
    // A hypothetical future kind ('gopls')
    // is not in the record — defaults to
    // `true` (the v1 default).
    expect(
      getUseRealServer('gopls' as Parameters<typeof getUseRealServer>[0]),
    ).toBe(true);
  });

  it('falls back to the default on a malformed v2 record', () => {
    localStorage.setItem(KEY_V2, 'not-json');
    expect(getUseRealServer('typescript')).toBe(true);
  });

  it('falls back to the default when v2 is an array (not a record)', () => {
    localStorage.setItem(KEY_V2, '[]');
    expect(getUseRealServer('typescript')).toBe(true);
  });
});

describe('lspKillSwitch — setUseRealServer(kind, value)', () => {
  it('persists a single kind without disturbing the others', () => {
    setUseRealServer('rust_analyzer', false);
    const record = getUseRealServerByKind();
    expect(record.rust_analyzer).toBe(false);
    // Other kinds aren't in the record yet
    // — they'll be set to their v1
    // default on read.
    expect(record.typescript).toBeUndefined();
  });

  it('round-trips: write + read returns the same value', () => {
    setUseRealServer('pyright', false);
    expect(getUseRealServer('pyright')).toBe(false);
    setUseRealServer('pyright', true);
    expect(getUseRealServer('pyright')).toBe(true);
  });
});

describe('lspKillSwitch — v1 → v2 migration (Phase 9.2e)', () => {
  it('seeds the v2 record from the v1 boolean when v2 is missing', () => {
    // Pre-9.2e user has the v1 key set to
    // `false` (they disabled the real
    // server globally).
    localStorage.setItem(KEY_V1, 'false');
    // First read: v2 missing, v1 present.
    // v2 should be seeded with every
    // supported kind = `false` (the v1
    // value).
    expect(getUseRealServer('typescript')).toBe(false);
    expect(getUseRealServer('rust_analyzer')).toBe(false);
    expect(getUseRealServer('pyright')).toBe(false);
    // v1 is left in place (a future
    // cleanup slice can delete it).
    expect(localStorage.getItem(KEY_V1)).toBe('false');
    // v2 is now populated.
    expect(localStorage.getItem(KEY_V2)).not.toBeNull();
  });

  it('seeds the v2 record with `true` when v1 is `true`', () => {
    localStorage.setItem(KEY_V1, 'true');
    expect(getUseRealServer('rust_analyzer')).toBe(true);
    expect(getUseRealServer('pyright')).toBe(true);
  });

  it('does NOT overwrite an existing v2 record (v1 → v2 only on cold read)', () => {
    // Pre-seed v2 with a custom per-kind
    // value.
    setUseRealServerByKind({
      typescript: true,
      rust_analyzer: false,
      pyright: true,
      unknown: true,
    });
    // Add a v1 key (e.g. a pre-9.2e user
    // who's been editing localStorage
    // directly — the migration should
    // NOT clobber the v2 record).
    localStorage.setItem(KEY_V1, 'false');
    expect(getUseRealServer('rust_analyzer')).toBe(false);
    expect(getUseRealServer('typescript')).toBe(true);
  });

  it('does not pollute localStorage when no v1 key exists (cold install)', () => {
    // No v1, no v2. First read should
    // return the default and NOT write
    // anything to v2.
    expect(getUseRealServer('typescript')).toBe(true);
    expect(localStorage.getItem(KEY_V2)).toBeNull();
  });
});

describe('lspKillSwitch — getUseRealServerForCompletion (Phase 9.6)', () => {
  it('returns the default `false` when no value is persisted', () => {
    expect(getUseRealServerForCompletion()).toBe(false);
  });

  it('returns `true` when "true" is persisted', () => {
    localStorage.setItem(KEY_COMPLETION, 'true');
    expect(getUseRealServerForCompletion()).toBe(true);
  });

  it('returns `false` when "false" is persisted', () => {
    localStorage.setItem(KEY_COMPLETION, 'false');
    expect(getUseRealServerForCompletion()).toBe(false);
  });

  it('falls back to the default on a malformed value', () => {
    localStorage.setItem(KEY_COMPLETION, 'yes');
    expect(getUseRealServerForCompletion()).toBe(false);
  });
});

describe('lspKillSwitch — setUseRealServerForCompletion (Phase 9.6)', () => {
  it('persists `true` as the string "true"', () => {
    setUseRealServerForCompletion(true);
    expect(localStorage.getItem(KEY_COMPLETION)).toBe('true');
    expect(getUseRealServerForCompletion()).toBe(true);
  });

  it('persists `false` as the string "false"', () => {
    setUseRealServerForCompletion(false);
    expect(localStorage.getItem(KEY_COMPLETION)).toBe('false');
    expect(getUseRealServerForCompletion()).toBe(false);
  });
});

describe('lspKillSwitch — independence of the two flags', () => {
  it('persists and reads the per-kind and completion flags independently', () => {
    setUseRealServer('typescript', true);
    setUseRealServerForCompletion(false);
    expect(getUseRealServer('typescript')).toBe(true);
    expect(getUseRealServerForCompletion()).toBe(false);

    // Flip just the completion flag.
    setUseRealServerForCompletion(true);
    expect(getUseRealServer('typescript')).toBe(true);
    expect(getUseRealServerForCompletion()).toBe(true);

    // Flip just the typescript kind.
    setUseRealServer('typescript', false);
    expect(getUseRealServer('typescript')).toBe(false);
    expect(getUseRealServerForCompletion()).toBe(true);
  });
});
