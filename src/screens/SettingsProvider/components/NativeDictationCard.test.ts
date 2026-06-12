/**
 * Tests for `NativeDictationCard`'s pure helper.
 *
 * The component itself is a thin fetch + render
 * over `getNativeDictationContract`; testing the
 * full component needs RTL which isn't in the
 * project's dep set. We cover the pure helper
 * `nativeDictationStatusBlurb(status)` so the
 * `not-applicable` / `inert` / `active` branches
 * are pinned to their user-facing copy.
 */
import { describe, expect, it } from 'vitest';

import { nativeDictationStatusBlurb } from './NativeDictationCard';

describe('nativeDictationStatusBlurb', () => {
  it('not-applicable mentions both iOS and Android', () => {
    const s = nativeDictationStatusBlurb('not-applicable');
    expect(s).toMatch(/iOS/);
    expect(s).toMatch(/Android/);
  });

  it('inert mentions the plugin binding is pending', () => {
    const s = nativeDictationStatusBlurb('inert');
    expect(s).toMatch(/binding/i);
    expect(s).toMatch(/pending|not yet/i);
  });

  it('active is a one-liner "active" message', () => {
    const s = nativeDictationStatusBlurb('active');
    expect(s).toMatch(/active/i);
  });
});
