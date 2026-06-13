/**
 * Tests for `useTourStore` — the
 * step machine for the onboarding
 * tour.
 *
 * Per project convention, one test
 * file per store. We test the store
 * in isolation — no React, no Tauri
 * mocks.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  STORAGE_KEY_DISMISSED,
  useTourStore,
} from './tourStore';

function reset(): void {
  localStorage.clear();
  useTourStore.setState({
    hydrated: false,
    dismissed: false,
    currentStep: null,
  });
}

describe('useTourStore', () => {
  beforeEach(reset);
  afterEach(reset);

  it('starts un-hydrated, not dismissed, no active step', () => {
    const s = useTourStore.getState();
    expect(s.hydrated).toBe(false);
    expect(s.dismissed).toBe(false);
    expect(s.currentStep).toBe(null);
  });

  describe('hydrate', () => {
    it('hydrates to dismissed=false when localStorage is empty', () => {
      useTourStore.getState().hydrate();
      const s = useTourStore.getState();
      expect(s.hydrated).toBe(true);
      expect(s.dismissed).toBe(false);
    });

    it('hydrates to dismissed=true when localStorage says "true"', () => {
      localStorage.setItem(STORAGE_KEY_DISMISSED, 'true');
      useTourStore.getState().hydrate();
      const s = useTourStore.getState();
      expect(s.hydrated).toBe(true);
      expect(s.dismissed).toBe(true);
    });

    it('hydrates to dismissed=false for any non-"true" string', () => {
      // Defensive: we only ever
      // write 'true' or 'false',
      // but if something else ended
      // up in the slot (manual edit,
      // a buggy earlier version), we
      // should treat it as "not
      // dismissed" rather than
      // silently auto-showing the
      // tour to a user who never
      // asked for it.
      localStorage.setItem(STORAGE_KEY_DISMISSED, 'yes');
      useTourStore.getState().hydrate();
      expect(useTourStore.getState().dismissed).toBe(false);
    });

    it('is idempotent — calling twice leaves the same state', () => {
      useTourStore.getState().hydrate();
      const first = useTourStore.getState();
      useTourStore.getState().hydrate();
      const second = useTourStore.getState();
      expect(second.hydrated).toBe(true);
      expect(second.dismissed).toBe(first.dismissed);
    });

    it('does not throw when localStorage is unavailable (private mode)', () => {
      // Simulate a quota /
      // SecurityError by making
      // getItem throw.
      const original = Storage.prototype.getItem;
      Storage.prototype.getItem = () => {
        throw new Error('SecurityError');
      };
      try {
        expect(() =>
          useTourStore.getState().hydrate(),
        ).not.toThrow();
        // Fail-closed: when we
        // can't read, treat as
        // "dismissed" so the tour
        // doesn't auto-show in
        // private mode.
        expect(useTourStore.getState().dismissed).toBe(true);
      } finally {
        Storage.prototype.getItem = original;
      }
    });
  });

  describe('start', () => {
    it('sets currentStep to 0 and clears dismissed', () => {
      useTourStore.setState({ dismissed: true });
      useTourStore.getState().start();
      const s = useTourStore.getState();
      expect(s.currentStep).toBe(0);
      expect(s.dismissed).toBe(false);
    });

    it('persists dismissed=false to localStorage', () => {
      localStorage.setItem(STORAGE_KEY_DISMISSED, 'true');
      useTourStore.getState().hydrate();
      useTourStore.getState().start();
      expect(localStorage.getItem(STORAGE_KEY_DISMISSED)).toBe(
        'false',
      );
    });

    it('starts at step 0 even if the tour was previously at step 3', () => {
      useTourStore.setState({ currentStep: 3 });
      useTourStore.getState().start();
      expect(useTourStore.getState().currentStep).toBe(0);
    });
  });

  describe('next / prev / finish', () => {
    it('next() advances by 1 from step 0', () => {
      useTourStore.getState().start();
      useTourStore.getState().next();
      expect(useTourStore.getState().currentStep).toBe(1);
    });

    it('next() is a no-op when the tour is not active', () => {
      useTourStore.setState({ currentStep: null });
      useTourStore.getState().next();
      expect(useTourStore.getState().currentStep).toBe(null);
    });

    it('next() does NOT clamp — the overlay component decides when to finish', () => {
      // The store is a dumb
      // +1. The component is
      // responsible for calling
      // finish() on the last step.
      // This keeps the store
      // decoupled from the step
      // list length.
      useTourStore.setState({ currentStep: 4 });
      useTourStore.getState().next();
      expect(useTourStore.getState().currentStep).toBe(5);
    });

    it('prev() retreats by 1 from step 2', () => {
      useTourStore.setState({ currentStep: 2 });
      useTourStore.getState().prev();
      expect(useTourStore.getState().currentStep).toBe(1);
    });

    it('prev() is a no-op on step 0', () => {
      useTourStore.setState({ currentStep: 0 });
      useTourStore.getState().prev();
      expect(useTourStore.getState().currentStep).toBe(0);
    });

    it('prev() is a no-op when the tour is not active', () => {
      useTourStore.setState({ currentStep: null });
      useTourStore.getState().prev();
      expect(useTourStore.getState().currentStep).toBe(null);
    });

    it('finish() clears currentStep and persists dismissed=true', () => {
      useTourStore.getState().start();
      useTourStore.getState().finish();
      const s = useTourStore.getState();
      expect(s.currentStep).toBe(null);
      expect(s.dismissed).toBe(true);
      expect(localStorage.getItem(STORAGE_KEY_DISMISSED)).toBe(
        'true',
      );
    });

    it('finish() is safe to call when the tour is not active', () => {
      useTourStore.setState({ currentStep: null });
      expect(() => useTourStore.getState().finish()).not.toThrow();
      expect(useTourStore.getState().dismissed).toBe(true);
    });
  });

  describe('_computeNextStep (pure helper)', () => {
    it('returns 0 when current is null (start of tour)', () => {
      expect(
        useTourStore.getState()._computeNextStep(null, 5),
      ).toBe(0);
    });

    it('returns current+1 when there are more steps', () => {
      expect(
        useTourStore.getState()._computeNextStep(2, 5),
      ).toBe(3);
    });

    it('returns null when on the last step (the overlay calls finish() instead)', () => {
      expect(
        useTourStore.getState()._computeNextStep(4, 5),
      ).toBe(null);
    });
  });

  describe('_computePrevStep (pure helper)', () => {
    it('returns null when current is null', () => {
      expect(useTourStore.getState()._computePrevStep(null)).toBe(
        null,
      );
    });

    it('returns null when on step 0', () => {
      expect(useTourStore.getState()._computePrevStep(0)).toBe(
        null,
      );
    });

    it('returns current-1 when on a later step', () => {
      expect(useTourStore.getState()._computePrevStep(2)).toBe(1);
    });
  });

  describe('integration — full tour lifecycle', () => {
    it('start → next × 4 → finish clears state and persists dismissed', () => {
      localStorage.removeItem(STORAGE_KEY_DISMISSED);
      useTourStore.getState().start();
      expect(useTourStore.getState().currentStep).toBe(0);
      useTourStore.getState().next();
      useTourStore.getState().next();
      useTourStore.getState().next();
      useTourStore.getState().next();
      expect(useTourStore.getState().currentStep).toBe(4);
      useTourStore.getState().finish();
      expect(useTourStore.getState().currentStep).toBe(null);
      expect(useTourStore.getState().dismissed).toBe(true);
      expect(localStorage.getItem(STORAGE_KEY_DISMISSED)).toBe(
        'true',
      );
    });

    it('start → next → prev → finish: state is consistent', () => {
      useTourStore.getState().start();
      useTourStore.getState().next();
      expect(useTourStore.getState().currentStep).toBe(1);
      useTourStore.getState().prev();
      expect(useTourStore.getState().currentStep).toBe(0);
      useTourStore.getState().finish();
      expect(useTourStore.getState().currentStep).toBe(null);
      expect(useTourStore.getState().dismissed).toBe(true);
    });
  });
});
