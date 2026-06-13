/**
 * Tests for the pure tour-step
 * definitions + the `computeTourShouldAutoStart`
 * gate. Per project convention
 * (Rule 4), we test the pure
 * logic in isolation — no React,
 * no Tauri mocks.
 */

import { describe, expect, it } from 'vitest';

import {
  TOUR_STEPS,
  computeTourShouldAutoStart,
  readWorkspaceGateFields,
} from './tourSteps';

describe('TOUR_STEPS', () => {
  it('has at least 2 steps (a single-step tour is a settings page)', () => {
    expect(TOUR_STEPS.length).toBeGreaterThanOrEqual(2);
  });

  it('every step has a non-empty id, title, and body', () => {
    for (const step of TOUR_STEPS) {
      expect(step.id.length).toBeGreaterThan(0);
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.body.length).toBeGreaterThan(0);
    }
  });

  it('every step id is unique', () => {
    const ids = TOUR_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every anchored step has a non-empty target', () => {
    for (const step of TOUR_STEPS) {
      if (step.placement.kind === 'anchored') {
        expect(step.placement.target.length).toBeGreaterThan(0);
        expect(['top', 'bottom', 'left', 'right']).toContain(
          step.placement.side,
        );
      }
    }
  });

  it('at least one step is centered (the intro)', () => {
    expect(
      TOUR_STEPS.some((s) => s.placement.kind === 'center'),
    ).toBe(true);
  });

  it('titles are short (under 40 chars)', () => {
    // Coach-mark callouts are
    // narrow. Long titles wrap
    // and look bad. The gate
    // enforces the design
    // constraint.
    for (const step of TOUR_STEPS) {
      expect(step.title.length).toBeLessThan(40);
    }
  });

  it('bodies are short (under 200 chars)', () => {
    for (const step of TOUR_STEPS) {
      expect(step.body.length).toBeLessThan(200);
    }
  });
});

describe('computeTourShouldAutoStart', () => {
  const baseArgs = {
    tourHydrated: true,
    tourDismissed: false,
    workspaceHydrated: true,
    currentPath: '/Users/me/projects/lipi',
  };

  it('returns true when all four preconditions are met', () => {
    expect(computeTourShouldAutoStart(baseArgs)).toBe(true);
  });

  it('returns false when the tour store has not hydrated yet', () => {
    expect(
      computeTourShouldAutoStart({
        ...baseArgs,
        tourHydrated: false,
      }),
    ).toBe(false);
  });

  it('returns false when the user has dismissed the tour on a previous launch', () => {
    expect(
      computeTourShouldAutoStart({
        ...baseArgs,
        tourDismissed: true,
      }),
    ).toBe(false);
  });

  it('returns false when the workspace store has not hydrated yet', () => {
    expect(
      computeTourShouldAutoStart({
        ...baseArgs,
        workspaceHydrated: false,
      }),
    ).toBe(false);
  });

  it('returns false when no workspace is open (the tour is for the editor, not the Welcome screen)', () => {
    expect(
      computeTourShouldAutoStart({
        ...baseArgs,
        currentPath: null,
      }),
    ).toBe(false);
  });

  it('returns false when BOTH tour-dismissed AND no-workspace (the negative cases compound correctly)', () => {
    expect(
      computeTourShouldAutoStart({
        tourHydrated: true,
        tourDismissed: true,
        workspaceHydrated: true,
        currentPath: null,
      }),
    ).toBe(false);
  });
});

describe('readWorkspaceGateFields', () => {
  it('reads hydrated and currentPath from a workspace store snapshot', () => {
    const snapshot = {
      hydrated: true,
      currentPath: '/Users/me/proj',
    };
    expect(readWorkspaceGateFields(snapshot)).toEqual({
      workspaceHydrated: true,
      currentPath: '/Users/me/proj',
    });
  });

  it('returns the no-workspace state correctly', () => {
    expect(
      readWorkspaceGateFields({
        hydrated: true,
        currentPath: null,
      }),
    ).toEqual({
      workspaceHydrated: true,
      currentPath: null,
    });
  });
});
