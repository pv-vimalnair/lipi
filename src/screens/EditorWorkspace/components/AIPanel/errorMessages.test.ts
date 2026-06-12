/**
 * Tests for `errorMessages.ts` — the friendly
 * title/hint mapper used by `ErrorBanner` in
 * 5b-5.
 *
 * Coverage:
 *   - All 7 known ErrorKinds map to a non-empty
 *     title and a non-empty hint (no raw Rust
 *     error strings leak through to the user).
 *   - The `http` variant pulls the status code
 *     out of the raw `message` and surfaces it
 *     in both the title and the hint.
 *   - The `cancelled` variant has its own short
 *     copy (the user already knows what they did
 *     — the banner is just a quiet "Stopped").
 *   - Unknown `errorKind` values fall back to a
 *     generic "Something went wrong" title and
 *     include the raw message in the hint.
 */

import { describe, expect, it } from 'vitest';

import { getFriendlyError } from './errorMessages';

describe('getFriendlyError (5b-5)', () => {
  it('returns a title and hint for every known ErrorKind', () => {
    const kinds = [
      'auth',
      'rateLimit',
      'transport',
      'parse',
      'server',
      'http',
      'cancelled',
    ];
    for (const kind of kinds) {
      const r = getFriendlyError(kind, 'HTTP 401: whatever');
      expect(r.title.length, `title for ${kind} should be non-empty`).toBeGreaterThan(0);
      expect(r.hint.length, `hint for ${kind} should be non-empty`).toBeGreaterThan(0);
    }
  });

  it('auth kind points the user to Settings', () => {
    const r = getFriendlyError('auth', 'HTTP 401: Incorrect API key provided.');
    expect(r.title).toBe('Invalid API key');
    expect(r.hint).toMatch(/Settings/);
  });

  it('rateLimit kind tells the user to wait', () => {
    const r = getFriendlyError('rateLimit', 'HTTP 429: Rate limit reached');
    expect(r.title).toBe('Rate limit hit');
    expect(r.hint).toMatch(/wait/i);
  });

  it('cancelled kind is a quiet "Stopped" with no actionable hint', () => {
    const r = getFriendlyError('cancelled', 'cancelled by user');
    expect(r.title).toBe('Stopped');
    expect(r.hint).toMatch(/cancel/i);
  });

  it('http kind includes the status code in the title and hint', () => {
    const r = getFriendlyError('http', 'HTTP 404: model not found');
    expect(r.title).toContain('404');
    expect(r.hint).toContain('404');
  });

  it('unknown kinds fall back to a generic title and use the raw message as the hint', () => {
    const r = getFriendlyError('mystery', 'something exploded');
    expect(r.title).toBe('Something went wrong');
    expect(r.hint).toContain('something exploded');
  });
});
