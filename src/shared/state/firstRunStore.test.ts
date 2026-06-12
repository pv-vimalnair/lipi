/**
 * Tests for `useFirstRunStore` —
 * the "have we shown the no-API-key
 * interstitial yet?" flag.
 *
 * Per project convention, one test
 * file per store. We test the store
 * in isolation — no React, no Tauri
 * mocks.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  STORAGE_KEY_DISMISSED,
  useFirstRunStore,
} from './firstRunStore';

function reset(): void {
  localStorage.clear();
  useFirstRunStore.setState({
    hydrated: false,
    dismissed: false,
  });
}

describe('useFirstRunStore', () => {
  beforeEach(reset);
  afterEach(reset);

  it('starts un-hydrated, not dismissed', () => {
    const s = useFirstRunStore.getState();
    expect(s.hydrated).toBe(false);
    expect(s.dismissed).toBe(false);
  });

  describe('hydrate', () => {
    it('hydrates to dismissed=false when localStorage is empty', () => {
      useFirstRunStore.getState().hydrate();
      const s = useFirstRunStore.getState();
      expect(s.hydrated).toBe(true);
      expect(s.dismissed).toBe(false);
    });

    it('hydrates to dismissed=true when localStorage says "true"', () => {
      localStorage.setItem(STORAGE_KEY_DISMISSED, 'true');
      useFirstRunStore.getState().hydrate();
      const s = useFirstRunStore.getState();
      expect(s.hydrated).toBe(true);
      expect(s.dismissed).toBe(true);
    });

    it('hydrates to dismissed=false for any non-"true" string', () => {
      // Defensive: we only ever
      // write 'true' or 'false',
      // but if something else
      // ended up in the slot
      // (manual edit, a buggy
      // earlier version), we
      // should treat it as "not
      // dismissed" rather than
      // silently lock the user
      // out of the interstitial.
      localStorage.setItem(STORAGE_KEY_DISMISSED, 'yes');
      useFirstRunStore.getState().hydrate();
      expect(useFirstRunStore.getState().dismissed).toBe(false);
    });

    it('is idempotent — calling twice leaves the same state', () => {
      useFirstRunStore.getState().hydrate();
      const first = useFirstRunStore.getState();
      useFirstRunStore.getState().hydrate();
      const second = useFirstRunStore.getState();
      expect(second.hydrated).toBe(true);
      expect(second.dismissed).toBe(first.dismissed);
    });

    it('does not throw when localStorage is unavailable (private mode)', () => {
      // Simulate a quota /
      // SecurityError by making
      // getItem throw. readDismissed
      // swallows the error and
      // returns false, so the
      // store still hydrates.
      const orig = localStorage.getItem;
      localStorage.getItem = () => {
        throw new Error('SecurityError: storage disabled');
      };
      try {
        expect(() =>
          useFirstRunStore.getState().hydrate(),
        ).not.toThrow();
        const s = useFirstRunStore.getState();
        expect(s.hydrated).toBe(true);
        expect(s.dismissed).toBe(false);
      } finally {
        localStorage.getItem = orig;
      }
    });
  });

  describe('dismiss', () => {
    it('flips dismissed to true and persists', () => {
      useFirstRunStore.getState().hydrate();
      useFirstRunStore.getState().dismiss();
      const s = useFirstRunStore.getState();
      expect(s.dismissed).toBe(true);
      expect(localStorage.getItem(STORAGE_KEY_DISMISSED)).toBe('true');
    });

    it('is idempotent — calling twice still ends at dismissed=true', () => {
      useFirstRunStore.getState().hydrate();
      useFirstRunStore.getState().dismiss();
      useFirstRunStore.getState().dismiss();
      expect(useFirstRunStore.getState().dismissed).toBe(true);
    });
  });

  describe('reset', () => {
    it('flips dismissed back to false and persists', () => {
      useFirstRunStore.getState().hydrate();
      useFirstRunStore.getState().dismiss();
      expect(useFirstRunStore.getState().dismissed).toBe(true);

      useFirstRunStore.getState().reset();
      const s = useFirstRunStore.getState();
      expect(s.dismissed).toBe(false);
      expect(localStorage.getItem(STORAGE_KEY_DISMISSED)).toBe('false');
    });
  });
});
