/**
 * Tests for the pure `computeShouldShow`
 * gate in
 * `useFirstRunOnboarding`.
 *
 * The hook itself is a React
 * component (it uses
 * `useEffect` + `useState`),
 * and we don't ship
 * `@testing-library/react`
 * in this project (per Rule
 * 4). The pure gate function
 * is the part of the hook
 * that does the actual
 * decision-making, so we
 * test it in isolation. The
 * surrounding `useEffect`
 * (keychain IPC + state
 * updates) is trivial glue
 * that will be exercised
 * end-to-end when the panel
 * is mounted in AppRoot.
 */

import { describe, expect, it } from 'vitest';

import { computeShouldShow } from './useFirstRunOnboarding';

describe('computeShouldShow', () => {
  it('returns false when firstRun store has not hydrated yet', () => {
    expect(
      computeShouldShow({
        hydrated: false,
        dismissed: false,
        currentPath: null,
        configuredProviders: [],
      }),
    ).toBe(false);
  });

  it('returns false when the user has dismissed the panel', () => {
    expect(
      computeShouldShow({
        hydrated: true,
        dismissed: true,
        currentPath: null,
        configuredProviders: [],
      }),
    ).toBe(false);
  });

  it('returns false when a workspace is open (panel belongs on Welcome only)', () => {
    expect(
      computeShouldShow({
        hydrated: true,
        dismissed: false,
        currentPath: '/Users/me/projects/lipi',
        configuredProviders: [],
      }),
    ).toBe(false);
  });

  it('returns false when the configured-providers list has not been read yet', () => {
    // The IPC is in flight;
    // we don't want to flash
    // the panel based on
    // stale or null state.
    expect(
      computeShouldShow({
        hydrated: true,
        dismissed: false,
        currentPath: null,
        configuredProviders: null,
      }),
    ).toBe(false);
  });

  it('returns true when all preconditions are met and no key is configured', () => {
    expect(
      computeShouldShow({
        hydrated: true,
        dismissed: false,
        currentPath: null,
        configuredProviders: [],
      }),
    ).toBe(true);
  });

  it('returns false when at least one provider IS configured (user has been onboarded)', () => {
    expect(
      computeShouldShow({
        hydrated: true,
        dismissed: false,
        currentPath: null,
        configuredProviders: ['openai'],
      }),
    ).toBe(false);
  });

  it('returns false when the keychain IPC failed (sentinel value)', () => {
    // When the IPC call
    // throws, the hook sets
    // configuredProviders
    // to ['__unknown__'] to
    // mean "tried, failed,
    // treat as unknown".
    // The gate must NOT
    // show the panel in
    // that case.
    expect(
      computeShouldShow({
        hydrated: true,
        dismissed: false,
        currentPath: null,
        configuredProviders: ['__unknown__'],
      }),
    ).toBe(false);
  });
});
