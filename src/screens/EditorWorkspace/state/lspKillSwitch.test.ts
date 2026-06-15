/**
 * Phase 9 / Phase 9.6 — `lspKillSwitch` unit
 * tests. Covers the two boolean localStorage
 * flags:
 *   - `lipi:lsp:useRealServer:v1` (master kill
 *     switch; default `true`).
 *   - `lipi:lsp:useRealServerForCompletion:v1`
 *     (Phase 9.6 sub-toggle; default `false`).
 *
 * We test the read / write helpers directly
 * and verify the defaults, malformed-value
 * fallback, and independence of the two
 * flags.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getUseRealServer,
  getUseRealServerForCompletion,
  setUseRealServer,
  setUseRealServerForCompletion,
} from './lspKillSwitch';

const KEY = 'lipi:lsp:useRealServer:v1';
const KEY_COMPLETION = 'lipi:lsp:useRealServerForCompletion:v1';

beforeEach(() => {
  // Clean slate for every test. We can't
  // just `localStorage.clear()` because
  // some other suites share the same
  // jsdom instance — only the two keys we
  // own are reset.
  localStorage.removeItem(KEY);
  localStorage.removeItem(KEY_COMPLETION);
});

afterEach(() => {
  localStorage.removeItem(KEY);
  localStorage.removeItem(KEY_COMPLETION);
});

describe('lspKillSwitch — getUseRealServer (master)', () => {
  it('returns the default `true` when no value is persisted', () => {
    expect(getUseRealServer()).toBe(true);
  });

  it('returns `true` when "true" is persisted', () => {
    localStorage.setItem(KEY, 'true');
    expect(getUseRealServer()).toBe(true);
  });

  it('returns `false` when "false" is persisted', () => {
    localStorage.setItem(KEY, 'false');
    expect(getUseRealServer()).toBe(false);
  });

  it('falls back to the default on a malformed value', () => {
    localStorage.setItem(KEY, 'maybe');
    expect(getUseRealServer()).toBe(true);
  });
});

describe('lspKillSwitch — setUseRealServer (master)', () => {
  it('persists `true` as the string "true"', () => {
    setUseRealServer(true);
    expect(localStorage.getItem(KEY)).toBe('true');
    expect(getUseRealServer()).toBe(true);
  });

  it('persists `false` as the string "false"', () => {
    setUseRealServer(false);
    expect(localStorage.getItem(KEY)).toBe('false');
    expect(getUseRealServer()).toBe(false);
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
  it('persists and reads the master and completion flags independently', () => {
    setUseRealServer(true);
    setUseRealServerForCompletion(false);
    expect(getUseRealServer()).toBe(true);
    expect(getUseRealServerForCompletion()).toBe(false);

    // Flip just the completion flag.
    setUseRealServerForCompletion(true);
    expect(getUseRealServer()).toBe(true);
    expect(getUseRealServerForCompletion()).toBe(true);

    // Flip just the master flag.
    setUseRealServer(false);
    expect(getUseRealServer()).toBe(false);
    expect(getUseRealServerForCompletion()).toBe(true);
  });
});
