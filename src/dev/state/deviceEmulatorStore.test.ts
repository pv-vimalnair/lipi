/**
 * Tests for `deviceEmulatorStore`
 * (M1).
 *
 * Covered:
 *   - Default state: off
 *   - `setEnabled(true)` flips and
 *     writes to sessionStorage
 *   - `setEnabled(false)` flips
 *     and writes
 *   - `toggle` flips
 *   - `hydrate` reads back the
 *     persisted value
 *   - Hydrate on an empty
 *     session defaults to off
 *   - In-memory state is the
 *     canonical source (writes
 *     don't depend on a re-
 *     read)
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useDeviceEmulatorStore } from './deviceEmulatorStore';

const SESSION_KEY = 'lipi:dev:deviceEmulator:v1';

function resetStore() {
  useDeviceEmulatorStore.setState({
    enabled: false,
    hydrated: false,
  });
}

function resetSession() {
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(SESSION_KEY);
  }
}

beforeEach(() => {
  resetStore();
  resetSession();
});

afterEach(() => {
  resetStore();
  resetSession();
});

describe('deviceEmulatorStore', () => {
  describe('defaults', () => {
    it('starts disabled', () => {
      expect(useDeviceEmulatorStore.getState().enabled).toBe(false);
    });
  });

  describe('setEnabled', () => {
    it('flips the in-memory state', () => {
      useDeviceEmulatorStore.getState().setEnabled(true);
      expect(useDeviceEmulatorStore.getState().enabled).toBe(true);
    });

    it('writes "1" to sessionStorage when enabled', () => {
      useDeviceEmulatorStore.getState().setEnabled(true);
      expect(sessionStorage.getItem(SESSION_KEY)).toBe('1');
    });

    it('writes "0" to sessionStorage when disabled', () => {
      useDeviceEmulatorStore.getState().setEnabled(false);
      expect(sessionStorage.getItem(SESSION_KEY)).toBe('0');
    });

    it('is idempotent (writing the same value is a no-op for the UI)', () => {
      useDeviceEmulatorStore.getState().setEnabled(true);
      useDeviceEmulatorStore.getState().setEnabled(true);
      expect(useDeviceEmulatorStore.getState().enabled).toBe(true);
      expect(sessionStorage.getItem(SESSION_KEY)).toBe('1');
    });
  });

  describe('toggle', () => {
    it('flips false → true → false', () => {
      expect(useDeviceEmulatorStore.getState().enabled).toBe(false);
      useDeviceEmulatorStore.getState().toggle();
      expect(useDeviceEmulatorStore.getState().enabled).toBe(true);
      expect(sessionStorage.getItem(SESSION_KEY)).toBe('1');
      useDeviceEmulatorStore.getState().toggle();
      expect(useDeviceEmulatorStore.getState().enabled).toBe(false);
      expect(sessionStorage.getItem(SESSION_KEY)).toBe('0');
    });
  });

  describe('hydrate', () => {
    it('reads the persisted value back', () => {
      sessionStorage.setItem(SESSION_KEY, '1');
      useDeviceEmulatorStore.getState().hydrate();
      expect(useDeviceEmulatorStore.getState().enabled).toBe(true);
      expect(useDeviceEmulatorStore.getState().hydrated).toBe(true);
    });

    it('defaults to disabled when nothing is stored', () => {
      // sessionStorage is
      // empty (resetSession in
      // beforeEach).
      useDeviceEmulatorStore.getState().hydrate();
      expect(useDeviceEmulatorStore.getState().enabled).toBe(false);
      expect(useDeviceEmulatorStore.getState().hydrated).toBe(true);
    });

    it('is a no-op when called twice', () => {
      sessionStorage.setItem(SESSION_KEY, '1');
      useDeviceEmulatorStore.getState().hydrate();
      // The dev now toggles
      // to off — that
      // writes "0" to
      // sessionStorage.
      useDeviceEmulatorStore.getState().setEnabled(false);
      expect(sessionStorage.getItem(SESSION_KEY)).toBe('0');
      // A second hydrate
      // should NOT
      // re-read from
      // sessionStorage
      // and re-enable —
      // the in-memory
      // state is the
      // canonical source
      // for this session.
      useDeviceEmulatorStore.getState().hydrate();
      expect(useDeviceEmulatorStore.getState().enabled).toBe(false);
    });
  });
});
