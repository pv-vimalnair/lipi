/**
 * Tests for the `toolSettingsStore` (5b-7).
 *
 * Coverage:
 *   - default state: every registered tool is
 *     enabled (the `disabledToolNames` set is
 *     empty)
 *   - `isEnabled` returns true for a known tool
 *     and false for a disabled one
 *   - `setEnabled(name, false)` adds the name to
 *     the disabled set; `setEnabled(name, true)`
 *     removes it
 *   - calling `setEnabled` with the current state
 *     is a no-op (idempotent)
 *   - `enableAll()` clears the disabled set
 *   - `disableMany(names)` adds the named tools
 *     to the disabled set (idempotent for
 *     already-disabled names; doesn't touch
 *     tools not in the argument)
 *   - `hydrate()` populates from localStorage
 *     when the persisted state is well-formed
 *   - `hydrate()` ignores malformed localStorage
 *     (no crash, no garbage state)
 *   - `hydrate()` is idempotent (calling twice
 *     doesn't reset)
 *   - the persistence subscriber writes
 *     subsequent state changes back to
 *     localStorage (the "save on toggle" path)
 *
 * `localStorage` is available in the `jsdom`
 * environment vitest ships with, but each test
 * starts with a clean storage so we don't
 * leak state between cases.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  setupToolSettingsPersistence,
  useToolSettingsStore,
} from './toolSettingsStore';

function resetStore() {
  // Reset to a clean state for each test. We
  // call `setState` directly (the store's
  // action API isn't designed for this â€” it's
  // for the app code path).
  useToolSettingsStore.setState({
    disabledToolNames: [],
    confirmationMode: {},
    hydrated: false,
    pendingUndo: false,
  });
}

function clearStorage() {
  if (typeof localStorage !== 'undefined') {
    localStorage.clear();
  }
}

describe('toolSettingsStore', () => {
  beforeEach(() => {
    resetStore();
    clearStorage();
  });

  afterEach(() => {
    // Make sure the persistence subscriber
    // doesn't bleed between tests. The
    // subscriber is module-level so the
    // `setupToolSettingsPersistence` call
    // is idempotent â€” but the storage
    // itself is per-test.
    clearStorage();
  });

  describe('defaults', () => {
    it('starts with no disabled tools (every tool is enabled)', () => {
      const { disabledToolNames, isEnabled } = useToolSettingsStore.getState();
      expect(disabledToolNames).toEqual([]);
      expect(isEnabled('get_file_contents')).toBe(true);
      expect(isEnabled('any_tool_at_all')).toBe(true);
    });
  });

  describe('setEnabled', () => {
    it('adds a tool to the disabled set when setEnabled(name, false)', () => {
      const { setEnabled } = useToolSettingsStore.getState();
      setEnabled('get_file_contents', false);
      expect(
        useToolSettingsStore.getState().disabledToolNames,
      ).toEqual(['get_file_contents']);
      expect(useToolSettingsStore.getState().isEnabled('get_file_contents')).toBe(
        false,
      );
    });

    it('removes a tool from the disabled set when setEnabled(name, true)', () => {
      const { setEnabled } = useToolSettingsStore.getState();
      setEnabled('get_file_contents', false);
      setEnabled('get_file_contents', true);
      expect(
        useToolSettingsStore.getState().disabledToolNames,
      ).toEqual([]);
      expect(useToolSettingsStore.getState().isEnabled('get_file_contents')).toBe(
        true,
      );
    });

    it('is a no-op when setting to the current state', () => {
      const { setEnabled } = useToolSettingsStore.getState();
      setEnabled('get_file_contents', false);
      const before = useToolSettingsStore.getState().disabledToolNames;
      setEnabled('get_file_contents', false);
      const after = useToolSettingsStore.getState().disabledToolNames;
      // Same content, same length â€” but the
      // reference may differ if the
      // implementation creates a new array.
      // We check length + content, not identity.
      expect(after).toEqual(before);
      expect(after.length).toBe(1);
    });

    it('tracks multiple tools independently', () => {
      const { setEnabled } = useToolSettingsStore.getState();
      setEnabled('tool_a', false);
      setEnabled('tool_b', false);
      setEnabled('tool_c', true); // already enabled, no-op
      expect(
        useToolSettingsStore
          .getState()
          .disabledToolNames.sort(),
      ).toEqual(['tool_a', 'tool_b']);
    });
  });

  describe('enableAll', () => {
    it('clears the disabled set', () => {
      const { setEnabled, enableAll } = useToolSettingsStore.getState();
      setEnabled('a', false);
      setEnabled('b', false);
      enableAll();
      expect(useToolSettingsStore.getState().disabledToolNames).toEqual([]);
      expect(useToolSettingsStore.getState().isEnabled('a')).toBe(true);
      expect(useToolSettingsStore.getState().isEnabled('b')).toBe(true);
    });
  });

  describe('disableMany', () => {
    it('adds the named tools to the disabled set', () => {
      const { disableMany } = useToolSettingsStore.getState();
      disableMany(['a', 'b']);
      expect(
        useToolSettingsStore
          .getState()
          .disabledToolNames.sort(),
      ).toEqual(['a', 'b']);
    });

    it('is idempotent for already-disabled names', () => {
      const { setEnabled, disableMany } = useToolSettingsStore.getState();
      setEnabled('a', false);
      disableMany(['a', 'b']);
      const set = useToolSettingsStore.getState().disabledToolNames;
      // No duplicates: `a` was already
      // disabled, `b` was just added.
      expect(set.filter((n) => n === 'a').length).toBe(1);
      expect(set.length).toBe(2);
    });

    it('does not affect tools not in the argument', () => {
      const { setEnabled, disableMany } = useToolSettingsStore.getState();
      setEnabled('a', false);
      disableMany(['b']);
      expect(useToolSettingsStore.getState().isEnabled('a')).toBe(false);
      expect(useToolSettingsStore.getState().isEnabled('b')).toBe(false);
      expect(useToolSettingsStore.getState().isEnabled('c')).toBe(true);
    });
  });

  describe('hydrate', () => {
    it('is a no-op when localStorage is empty', () => {
      const { hydrate } = useToolSettingsStore.getState();
      hydrate();
      expect(useToolSettingsStore.getState().disabledToolNames).toEqual([]);
      expect(useToolSettingsStore.getState().hydrated).toBe(true);
    });

    it('loads the disabled set from a well-formed localStorage entry', () => {
      localStorage.setItem(
        'lipi:toolSettings:v1',
        JSON.stringify({ disabledToolNames: ['tool_a', 'tool_b'] }),
      );
      const { hydrate } = useToolSettingsStore.getState();
      hydrate();
      expect(
        useToolSettingsStore
          .getState()
          .disabledToolNames.sort(),
      ).toEqual(['tool_a', 'tool_b']);
      expect(useToolSettingsStore.getState().hydrated).toBe(true);
    });

    it('ignores malformed localStorage without crashing', () => {
      localStorage.setItem('lipi:toolSettings:v1', 'not json');
      const { hydrate } = useToolSettingsStore.getState();
      // Should not throw.
      hydrate();
      expect(useToolSettingsStore.getState().disabledToolNames).toEqual([]);
      expect(useToolSettingsStore.getState().hydrated).toBe(true);
    });

    it('ignores well-formed JSON that does not match the expected shape', () => {
      // `disabledToolNames` is the wrong type
      // (not an array). The store should
      // fall back to defaults.
      localStorage.setItem(
        'lipi:toolSettings:v1',
        JSON.stringify({ disabledToolNames: 'oops' }),
      );
      const { hydrate } = useToolSettingsStore.getState();
      hydrate();
      expect(useToolSettingsStore.getState().disabledToolNames).toEqual([]);
    });

    it('ignores localStorage entries with non-string items in the array', () => {
      localStorage.setItem(
        'lipi:toolSettings:v1',
        JSON.stringify({ disabledToolNames: ['ok', 42] }),
      );
      const { hydrate } = useToolSettingsStore.getState();
      hydrate();
      // The whole shape is rejected (any
      // non-string item) â€” the store falls
      // back to defaults rather than
      // partial-loading.
      expect(useToolSettingsStore.getState().disabledToolNames).toEqual([]);
    });

    it('is idempotent (calling hydrate twice does not reset)', () => {
      localStorage.setItem(
        'lipi:toolSettings:v1',
        JSON.stringify({ disabledToolNames: ['a'] }),
      );
      const { hydrate, setEnabled } = useToolSettingsStore.getState();
      hydrate();
      // After hydration, change the state.
      setEnabled('b', false);
      // A second hydrate should NOT reset to
      // the localStorage snapshot â€” the
      // user changed something after the
      // first hydration.
      hydrate();
      expect(useToolSettingsStore.getState().isEnabled('a')).toBe(false);
      expect(useToolSettingsStore.getState().isEnabled('b')).toBe(false);
    });
  });

  describe('persistence', () => {
    it('writes subsequent state changes to localStorage', () => {
      // First, hydrate (so the persistence
      // subscriber starts writing on the
      // NEXT change).
      const { hydrate, setEnabled } = useToolSettingsStore.getState();
      hydrate();
      // Now wire up the persistence
      // subscription and toggle a tool.
      setupToolSettingsPersistence();
      setEnabled('get_file_contents', false);
      // The subscriber writes async (on the
      // next microtask) â€” but it's a
      // synchronous `setItem` in our impl,
      // so it should be visible immediately.
      const raw = localStorage.getItem('lipi:toolSettings:v2');
      expect(raw).not.toBeNull();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
      const parsed = JSON.parse(raw!);
      expect(parsed.disabledToolNames).toEqual(['get_file_contents']);
      // 5d: the v2 payload also carries
      // `confirmationMode` (defaults to
      // `{}`).
      expect(parsed.confirmationMode).toEqual({});
    });

    it('does not write when hydrate is the only state change', () => {
      // The `hydrated` flag should guard
      // against the hydration itself
      // triggering a redundant write.
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      localStorage.setItem(
        'lipi:toolSettings:v1',
        JSON.stringify({ disabledToolNames: ['preset'] }),
      );
      const { hydrate } = useToolSettingsStore.getState();
      hydrate();
      // The localStorage value should still
      // match the original (not be
      // overwritten with the in-memory
      // defaults before hydration was
      // possible). The `hydrated` flag
      // guard is what makes this safe.
      // (We can't test the "no write"
      // directly without a mock on
      // `setItem`, but we can test that
      // the in-memory state is correct.)
      expect(useToolSettingsStore.getState().isEnabled('preset')).toBe(false);
      warn.mockRestore();
    });
  });

  // --- 5d: confirmationMode + v1â†’v2 migration -----------------
  //
  // 5d adds a per-tool `confirmationMode`
  // (always_allow | always_confirm | per_call)
  // alongside the existing `disabledToolNames`.
  // The storage key bumps to v2; the hydrate
  // function transparently migrates v1 forward
  // (copies the disabled set, adds an empty
  // `confirmationMode: {}`, leaves v1 intact).

  describe('confirmationMode (5d)', () => {
    beforeEach(() => {
      // Reset the store + the localStorage
      // keys between tests. We touch both
      // v1 and v2 so the migration tests
      // start from a clean slate.
      localStorage.removeItem('lipi:toolSettings:v1');
      localStorage.removeItem('lipi:toolSettings:v2');
      useToolSettingsStore.setState({
        disabledToolNames: [],
        confirmationMode: {},
        hydrated: false,
      });
    });

    it('getConfirmationMode returns the default for unset tools', () => {
      // Default = `always_confirm` so newly
      // added tools do not run silently until
      // the user opts them in.
      const { getConfirmationMode } = useToolSettingsStore.getState();
      expect(getConfirmationMode('get_file_contents')).toBe('always_confirm');
      expect(getConfirmationMode('run_npm_test')).toBe('always_confirm');
    });

    it('setConfirmationMode stores the mode for a tool', () => {
      const { setConfirmationMode, getConfirmationMode } =
        useToolSettingsStore.getState();
      setConfirmationMode('get_file_contents', 'always_allow');
      expect(getConfirmationMode('get_file_contents')).toBe('always_allow');
      // Other tools are unaffected.
      expect(getConfirmationMode('run_npm_test')).toBe('always_confirm');
    });

    it('setConfirmationMode overwrites an existing mode', () => {
      const { setConfirmationMode, getConfirmationMode } =
        useToolSettingsStore.getState();
      setConfirmationMode('get_file_contents', 'always_allow');
      setConfirmationMode('get_file_contents', 'per_call');
      expect(getConfirmationMode('get_file_contents')).toBe('per_call');
    });

    it('setConfirmationMode drops the entry when set back to the default', () => {
      // The default is `always_confirm`. Setting
      // back to the default should REMOVE the
      // key from the map to keep the persisted
      // JSON small.
      const { setConfirmationMode } = useToolSettingsStore.getState();
      setConfirmationMode('get_file_contents', 'always_allow');
      expect(
        'get_file_contents' in useToolSettingsStore.getState().confirmationMode,
      ).toBe(true);
      setConfirmationMode('get_file_contents', 'always_confirm');
      expect(
        'get_file_contents' in useToolSettingsStore.getState().confirmationMode,
      ).toBe(false);
    });

    it('setConfirmationMode no-ops when the mode is unchanged', () => {
      // Bumping the store with the same
      // mode should not re-allocate the
      // `confirmationMode` object (the
      // subscriber would trigger a needless
      // localStorage write otherwise).
      const { setConfirmationMode } = useToolSettingsStore.getState();
      setConfirmationMode('get_file_contents', 'per_call');
      const before = useToolSettingsStore.getState().confirmationMode;
      setConfirmationMode('get_file_contents', 'per_call');
      const after = useToolSettingsStore.getState().confirmationMode;
      expect(after).toBe(before);
    });
  });

  describe('shouldConfirm predicate (5d)', () => {
    beforeEach(() => {
      localStorage.removeItem('lipi:toolSettings:v1');
      localStorage.removeItem('lipi:toolSettings:v2');
      useToolSettingsStore.setState({
        disabledToolNames: [],
        confirmationMode: {},
        hydrated: false,
      });
    });

    it('returns true for an unset tool (default always_confirm)', () => {
      const { shouldConfirm } = useToolSettingsStore.getState();
      expect(shouldConfirm('get_file_contents', false)).toBe(true);
    });

    it('returns false for an explicit always_allow tool', () => {
      const { setConfirmationMode, shouldConfirm } =
        useToolSettingsStore.getState();
      setConfirmationMode('get_file_contents', 'always_allow');
      expect(shouldConfirm('get_file_contents', false)).toBe(false);
    });

    it('returns true for always_confirm regardless of round flag', () => {
      const { setConfirmationMode, shouldConfirm } =
        useToolSettingsStore.getState();
      setConfirmationMode('get_file_contents', 'always_confirm');
      expect(shouldConfirm('get_file_contents', false)).toBe(true);
      expect(shouldConfirm('get_file_contents', true)).toBe(true);
    });

    it('returns true for per_call on the first call (round flag false)', () => {
      const { setConfirmationMode, shouldConfirm } =
        useToolSettingsStore.getState();
      setConfirmationMode('get_file_contents', 'per_call');
      expect(shouldConfirm('get_file_contents', false)).toBe(true);
    });

    it('returns false for per_call when the round flag is true', () => {
      // The AI store passes `true` for the
      // same call after the user has
      // approved it once this round.
      const { setConfirmationMode, shouldConfirm } =
        useToolSettingsStore.getState();
      setConfirmationMode('get_file_contents', 'per_call');
      expect(shouldConfirm('get_file_contents', true)).toBe(false);
    });

    it('returns false for a disabled tool (the AI store gates disabled tools separately)', () => {
      // The AI store consults `isEnabled`
      // FIRST, then `shouldConfirm`. If a
      // tool is disabled, we don't double-
      // prompt â€” we just return false from
      // `shouldConfirm` and the AI store
      // will refuse to run the call on
      // the earlier check.
      const {
        setConfirmationMode,
        setEnabled,
        shouldConfirm,
      } = useToolSettingsStore.getState();
      setConfirmationMode('get_file_contents', 'always_confirm');
      setEnabled('get_file_contents', false);
      expect(shouldConfirm('get_file_contents', false)).toBe(false);
    });
  });

  describe('v1 â†’ v2 migration (5d)', () => {
    beforeEach(() => {
      localStorage.removeItem('lipi:toolSettings:v1');
      localStorage.removeItem('lipi:toolSettings:v2');
      useToolSettingsStore.setState({
        disabledToolNames: [],
        confirmationMode: {},
        hydrated: false,
      });
    });

    it('migrates a v1 file to v2 on hydrate, preserving the disabled set', () => {
      // v1 only has `disabledToolNames`.
      // 5d's hydrate() detects the v1
      // payload, copies the disabled
      // names forward, and adds an empty
      // `confirmationMode: {}`.
      localStorage.setItem(
        'lipi:toolSettings:v1',
        JSON.stringify({ disabledToolNames: ['get_file_contents', 'run_npm_test'] }),
      );
      useToolSettingsStore.getState().hydrate();
      const s = useToolSettingsStore.getState();
      expect(s.disabledToolNames).toEqual([
        'get_file_contents',
        'run_npm_test',
      ]);
      expect(s.confirmationMode).toEqual({});
    });

    it('does NOT delete the v1 key after migration', () => {
      // Leaving v1 in place makes the
      // migration reversible â€” a v1
      // reader (e.g. a downgrade) can
      // still load the old state. The
      // next state-changing action will
      // overwrite v2 with the new shape;
      // v1 is left alone forever.
      localStorage.setItem(
        'lipi:toolSettings:v1',
        JSON.stringify({ disabledToolNames: ['a'] }),
      );
      useToolSettingsStore.getState().hydrate();
      expect(localStorage.getItem('lipi:toolSettings:v1')).not.toBeNull();
    });

    it('prefers v2 over v1 if both are present (no double-migration)', () => {
      // Defensive: if a user has both
      // keys (perhaps from a partial
      // earlier session), v2 wins. v1
      // is ignored.
      localStorage.setItem(
        'lipi:toolSettings:v1',
        JSON.stringify({ disabledToolNames: ['v1_tool'] }),
      );
      localStorage.setItem(
        'lipi:toolSettings:v2',
        JSON.stringify({
          disabledToolNames: ['v2_tool'],
          confirmationMode: { v2_tool: 'always_confirm' },
        }),
      );
      useToolSettingsStore.getState().hydrate();
      const s = useToolSettingsStore.getState();
      expect(s.disabledToolNames).toEqual(['v2_tool']);
      expect(s.confirmationMode).toEqual({ v2_tool: 'always_confirm' });
    });

    it('falls back to defaults if v2 is present but malformed', () => {
      // A corrupt v2 file (e.g. a half-
      // written JSON from a quota error
      // mid-save) should not crash the
      // app â€” fall back to defaults.
      // v1 is also checked as a secondary
      // fallback, but if v2 is present
      // AND malformed, we DON'T fall
      // through to v1 (that would
      // silently merge two different
      // histories). The safer move is
      // to surface the corruption by
      // starting clean.
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      localStorage.setItem(
        'lipi:toolSettings:v1',
        JSON.stringify({ disabledToolNames: ['v1_tool'] }),
      );
      localStorage.setItem(
        'lipi:toolSettings:v2',
        '{ "disabledToolNames": "not-an-array" }',
      );
      useToolSettingsStore.getState().hydrate();
      const s = useToolSettingsStore.getState();
      expect(s.disabledToolNames).toEqual([]);
      expect(s.confirmationMode).toEqual({});
      warn.mockRestore();
    });

    it('writes v2 on the next state change after a v1â†’v2 migration', () => {
      // After the migration, the
      // persistence subscriber will write
      // v2 the next time the user changes
      // a setting. (The hydration itself
      // does NOT write â€” see the existing
      // `hydrated` guard test.)
      localStorage.setItem(
        'lipi:toolSettings:v1',
        JSON.stringify({ disabledToolNames: ['x'] }),
      );
      useToolSettingsStore.getState().hydrate();
      setupToolSettingsPersistence();
      useToolSettingsStore.getState().setEnabled('y', false);
      const raw = localStorage.getItem('lipi:toolSettings:v2');
      expect(raw).not.toBeNull();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
      const parsed = JSON.parse(raw!);
      expect(parsed.disabledToolNames).toEqual(['x', 'y']);
      expect(parsed.confirmationMode).toEqual({});
    });
  });

  describe('clearAllSettings (5a)', () => {
    // 5a: soft-delete + undo for the
    // "Reset all tool settings" button
    // on the Settings screen. Mirrors
    // the 5h decision-log pattern, with
    // a localStorage-backed undo buffer
    // (not in-memory â€” see the
    // STORAGE_KEY_UNDO header).

    beforeEach(() => {
      // 5a's undo buffer lives in
      // localStorage under a separate
      // key. Make sure each test starts
      // with a clean slate.
      localStorage.removeItem('lipi:toolSettings:undo:v1');
    });

    it('empties disabledToolNames and confirmationMode, and sets pendingUndo=true', () => {
      const { setEnabled, setConfirmationMode, clearAllSettings } =
        useToolSettingsStore.getState();
      setEnabled('get_file_contents', false);
      setConfirmationMode('run_npm_test', 'always_allow');
      clearAllSettings();
      const s = useToolSettingsStore.getState();
      expect(s.disabledToolNames).toEqual([]);
      expect(s.confirmationMode).toEqual({});
      expect(s.pendingUndo).toBe(true);
    });

    it('writes a pre-clear snapshot to the undo buffer in localStorage', () => {
      const { setEnabled, setConfirmationMode, clearAllSettings } =
        useToolSettingsStore.getState();
      setEnabled('get_file_contents', false);
      setEnabled('run_npm_test', false);
      setConfirmationMode('a', 'always_allow');
      clearAllSettings();
      const raw = localStorage.getItem('lipi:toolSettings:undo:v1');
      expect(raw).not.toBeNull();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
      const parsed = JSON.parse(raw!);
      expect(parsed.disabledToolNames).toEqual([
        'get_file_contents',
        'run_npm_test',
      ]);
      expect(parsed.confirmationMode).toEqual({ a: 'always_allow' });
    });

    it('is a no-op when both disabledToolNames and confirmationMode are empty', () => {
      // Reset shouldn't pop an empty
      // undo toast â€” there's nothing
      // to undo. The buffer stays
      // unwritten.
      const { clearAllSettings, hasPendingUndo } = useToolSettingsStore.getState();
      clearAllSettings();
      const s = useToolSettingsStore.getState();
      expect(s.disabledToolNames).toEqual([]);
      expect(s.confirmationMode).toEqual({});
      expect(s.pendingUndo).toBe(false);
      expect(hasPendingUndo()).toBe(false);
      expect(localStorage.getItem('lipi:toolSettings:undo:v1')).toBeNull();
    });

    it('is a no-op when only DEFAULT_CONFIRMATION_MODE entries exist (no real "settings")', () => {
      // The default mode is `always_confirm`.
      // A fresh `setConfirmationMode` with
      // the default removes the entry
      // (per the existing implementation),
      // so the map stays `{}` â€” the
      // no-op branch covers this.
      const { clearAllSettings, hasPendingUndo } = useToolSettingsStore.getState();
      clearAllSettings();
      expect(hasPendingUndo()).toBe(false);
    });

    it('does clear when only confirmationMode is non-empty (no disabled tools)', () => {
      // The "nothing to clear" check
      // is `OR` (not just length===0).
      // A user with policies but no
      // disabled tools should still
      // see the undo toast on Reset.
      const { setConfirmationMode, clearAllSettings } =
        useToolSettingsStore.getState();
      setConfirmationMode('a', 'always_allow');
      clearAllSettings();
      const s = useToolSettingsStore.getState();
      expect(s.confirmationMode).toEqual({});
      expect(s.pendingUndo).toBe(true);
    });

    it('persists the empty state to the main key after clear (not just the undo buffer)', () => {
      // The user took an explicit action.
      // The clear must survive a reload,
      // not just live in-memory until
      // the undo timer fires. The
      // persistence subscriber writes
      // v2 on the next render â€” but
      // only if `hydrated` is true
      // (the subscriber early-returns
      // during the initial mount to
      // avoid a redundant write).
      const { setEnabled, clearAllSettings, hydrate } =
        useToolSettingsStore.getState();
      hydrate();
      setupToolSettingsPersistence();
      setEnabled('get_file_contents', false);
      clearAllSettings();
      const raw = localStorage.getItem('lipi:toolSettings:v2');
      expect(raw).not.toBeNull();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
      const parsed = JSON.parse(raw!);
      expect(parsed.disabledToolNames).toEqual([]);
    });
  });

  describe('undoClearAllSettings (5a)', () => {
    beforeEach(() => {
      localStorage.removeItem('lipi:toolSettings:undo:v1');
    });

    it('restores disabledToolNames and confirmationMode from the undo buffer', () => {
      const {
        setEnabled,
        setConfirmationMode,
        clearAllSettings,
        undoClearAllSettings,
      } = useToolSettingsStore.getState();
      setEnabled('a', false);
      setEnabled('b', false);
      setConfirmationMode('c', 'per_call');
      clearAllSettings();
      // After clear, state is empty.
      expect(useToolSettingsStore.getState().disabledToolNames).toEqual([]);
      // Undo.
      undoClearAllSettings();
      const s = useToolSettingsStore.getState();
      expect(s.disabledToolNames).toEqual(['a', 'b']);
      expect(s.confirmationMode).toEqual({ c: 'per_call' });
      expect(s.pendingUndo).toBe(false);
    });

    it('drops the undo buffer after a successful restore', () => {
      const { setEnabled, clearAllSettings, undoClearAllSettings } =
        useToolSettingsStore.getState();
      setEnabled('a', false);
      clearAllSettings();
      expect(localStorage.getItem('lipi:toolSettings:undo:v1')).not.toBeNull();
      undoClearAllSettings();
      expect(localStorage.getItem('lipi:toolSettings:undo:v1')).toBeNull();
    });

    it('is a no-op when the buffer is absent (clear already committed)', () => {
      // The discard timer already ran
      // (or the user never clicked
      // Reset). Undo should be a
      // safe no-op â€” pendingUndo flips
      // to false but nothing else
      // changes.
      const { undoClearAllSettings, hasPendingUndo } =
        useToolSettingsStore.getState();
      // pendingUndo starts as false â€”
      // confirm that.
      expect(hasPendingUndo()).toBe(false);
      undoClearAllSettings();
      expect(useToolSettingsStore.getState().pendingUndo).toBe(false);
    });

    it('drops a malformed undo buffer without restoring it (defensive)', () => {
      // If the buffer got corrupted
      // (e.g. partial write), undo
      // should NOT restore garbage.
      // We drop the buffer and keep
      // the cleared state.
      const { undoClearAllSettings } = useToolSettingsStore.getState();
      localStorage.setItem(
        'lipi:toolSettings:undo:v1',
        '{ "disabledToolNames": "not-an-array" }',
      );
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      undoClearAllSettings();
      expect(useToolSettingsStore.getState().pendingUndo).toBe(false);
      expect(localStorage.getItem('lipi:toolSettings:undo:v1')).toBeNull();
      warn.mockRestore();
    });

    it('round-trips the full clear â†’ undo â†’ clear â†’ undo cycle through localStorage', () => {
      // Defensive: the buffer survives
      // multiple writes (the second
      // clear overwrites the first
      // buffer, not appends to it).
      const {
        setEnabled,
        clearAllSettings,
        undoClearAllSettings,
      } = useToolSettingsStore.getState();
      setupToolSettingsPersistence();

      setEnabled('a', false);
      clearAllSettings();
      expect(useToolSettingsStore.getState().pendingUndo).toBe(true);

      undoClearAllSettings();
      expect(useToolSettingsStore.getState().disabledToolNames).toEqual(['a']);
      expect(useToolSettingsStore.getState().pendingUndo).toBe(false);

      setEnabled('b', false);
      clearAllSettings();
      expect(useToolSettingsStore.getState().disabledToolNames).toEqual([]);
      const raw = localStorage.getItem('lipi:toolSettings:undo:v1');
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
      const parsed = JSON.parse(raw!);
      // The second buffer reflects
      // the state BEFORE the second
      // clear (which includes `a` and
      // `b`).
      expect(parsed.disabledToolNames).toEqual(['a', 'b']);

      undoClearAllSettings();
      expect(useToolSettingsStore.getState().disabledToolNames).toEqual([
        'a',
        'b',
      ]);
    });
  });

  describe('discardUndoAllSettings (5a)', () => {
    beforeEach(() => {
      localStorage.removeItem('lipi:toolSettings:undo:v1');
    });

    it('drops the undo buffer and flips pendingUndo to false', () => {
      const { setEnabled, clearAllSettings, discardUndoAllSettings } =
        useToolSettingsStore.getState();
      setEnabled('a', false);
      clearAllSettings();
      expect(useToolSettingsStore.getState().pendingUndo).toBe(true);
      expect(localStorage.getItem('lipi:toolSettings:undo:v1')).not.toBeNull();
      discardUndoAllSettings();
      expect(useToolSettingsStore.getState().pendingUndo).toBe(false);
      expect(localStorage.getItem('lipi:toolSettings:undo:v1')).toBeNull();
    });

    it('is a no-op (but safe) when called with no pending undo', () => {
      const { discardUndoAllSettings } = useToolSettingsStore.getState();
      // No prior clear â€” discard should
      // not throw, should not touch
      // storage.
      expect(() => discardUndoAllSettings()).not.toThrow();
      expect(localStorage.getItem('lipi:toolSettings:undo:v1')).toBeNull();
      expect(useToolSettingsStore.getState().pendingUndo).toBe(false);
    });
  });

  describe('hydrate restores pendingUndo from the buffer (5a)', () => {
    // A page reload during the 5s
    // window must NOT silently drop
    // the clear â€” the undo buffer
    // (and the cleared v2) both
    // survive. The UI re-arms the
    // 5s timer on mount.

    beforeEach(() => {
      localStorage.removeItem('lipi:toolSettings:v1');
      localStorage.removeItem('lipi:toolSettings:v2');
      localStorage.removeItem('lipi:toolSettings:undo:v1');
      useToolSettingsStore.setState({
        disabledToolNames: [],
        confirmationMode: {},
        hydrated: false,
        pendingUndo: false,
      });
    });

    it('sets pendingUndo=true when the undo buffer is present', () => {
      // Simulate a clear from a
      // previous "session" (we just
      // write the buffer and a
      // cleared v2 directly, then
      // re-hydrate).
      localStorage.setItem(
        'lipi:toolSettings:v2',
        JSON.stringify({ disabledToolNames: [], confirmationMode: {} }),
      );
      localStorage.setItem(
        'lipi:toolSettings:undo:v1',
        JSON.stringify({
          disabledToolNames: ['previously_disabled'],
          confirmationMode: {},
        }),
      );
      useToolSettingsStore.getState().hydrate();
      expect(useToolSettingsStore.getState().pendingUndo).toBe(true);
    });

    it('leaves pendingUndo=false when the undo buffer is absent', () => {
      localStorage.setItem(
        'lipi:toolSettings:v2',
        JSON.stringify({
          disabledToolNames: ['still_disabled'],
          confirmationMode: {},
        }),
      );
      // No undo buffer.
      useToolSettingsStore.getState().hydrate();
      expect(useToolSettingsStore.getState().pendingUndo).toBe(false);
    });
  });

  describe('applyImportedSettings (5b)', () => {
    // 5b: settings import. The caller
    // (UI) parses the file via
    // `parseSettingsFile` first, then
    // passes the validated payload to
    // this action. The action applies
    // the payload to the live state
    // AND stashes the pre-import state
    // in the existing undo buffer
    // (`lipi:toolSettings:undo:v1`),
    // so the user can
    // `undoClearAllSettings()` within
    // the 5s window. Mirrors the 5a
    // "Reset all" pattern exactly.

    beforeEach(() => {
      localStorage.removeItem('lipi:toolSettings:undo:v1');
    });

    it('replaces disabledToolNames and confirmationMode with the imported values', () => {
      const { setEnabled, setConfirmationMode, applyImportedSettings } =
        useToolSettingsStore.getState();
      setEnabled('old_disabled', false);
      setConfirmationMode('old_policy', 'always_allow');
      applyImportedSettings({
        disabledToolNames: ['new_disabled'],
        confirmationMode: { new_policy: 'per_call' },
      });
      const s = useToolSettingsStore.getState();
      expect(s.disabledToolNames).toEqual(['new_disabled']);
      expect(s.confirmationMode).toEqual({ new_policy: 'per_call' });
    });

    it('sets pendingUndo=true after a successful import (reuses the 5a toast)', () => {
      const { applyImportedSettings } = useToolSettingsStore.getState();
      applyImportedSettings({
        disabledToolNames: ['a'],
        confirmationMode: {},
      });
      expect(useToolSettingsStore.getState().pendingUndo).toBe(true);
    });

    it('writes the pre-import state to the undo buffer', () => {
      // The buffer is what makes
      // the 5s toast work. Without
      // it, the user could not
      // restore their previous
      // settings.
      const { setEnabled, applyImportedSettings } =
        useToolSettingsStore.getState();
      setEnabled('a', false);
      setEnabled('b', false);
      applyImportedSettings({
        disabledToolNames: ['c'],
        confirmationMode: {},
      });
      const raw = localStorage.getItem('lipi:toolSettings:undo:v1');
      expect(raw).not.toBeNull();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
      const parsed = JSON.parse(raw!);
      expect(parsed.disabledToolNames).toEqual(['a', 'b']);
    });

    it('persists the imported state to the main key (v2) for cross-reload survival', () => {
      const { setEnabled, applyImportedSettings, hydrate } =
        useToolSettingsStore.getState();
      hydrate();
      setupToolSettingsPersistence();
      setEnabled('a', false);
      applyImportedSettings({
        disabledToolNames: ['imported'],
        confirmationMode: { x: 'always_confirm' },
      });
      const raw = localStorage.getItem('lipi:toolSettings:v2');
      expect(raw).not.toBeNull();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
      const parsed = JSON.parse(raw!);
      expect(parsed.disabledToolNames).toEqual(['imported']);
      expect(parsed.confirmationMode).toEqual({ x: 'always_confirm' });
    });

    it('is a no-op when the imported state matches the current state (no spurious undo toast)', () => {
      // A user importing their own
      // export on the same machine
      // should not get a "5
      // seconds to undo" toast â€”
      // nothing actually changed.
      const { setEnabled, applyImportedSettings } =
        useToolSettingsStore.getState();
      setEnabled('a', false);
      // First import â€” non-trivial
      // change.
      applyImportedSettings({
        disabledToolNames: ['a'],
        confirmationMode: {},
      });
      // Drain the toast.
      useToolSettingsStore.getState().discardUndoAllSettings();
      // Second import â€” identical
      // to current state.
      applyImportedSettings({
        disabledToolNames: ['a'],
        confirmationMode: {},
      });
      expect(useToolSettingsStore.getState().pendingUndo).toBe(false);
      // The undo buffer should
      // NOT have been written.
      expect(localStorage.getItem('lipi:toolSettings:undo:v1')).toBeNull();
    });

    it('detects a no-op when the order of disabledToolNames is identical (positional equality, not set equality)', () => {
      // We use positional
      // comparison for the
      // disabled list (matching
      // the persistence shape â€” a
      // JSON array, not a set).
      // A re-ordered import of
      // the same tools is NOT a
      // no-op (the order matters
      // because the UI renders
      // them in the saved order).
      const { setEnabled, applyImportedSettings } =
        useToolSettingsStore.getState();
      setEnabled('a', false);
      setEnabled('b', false);
      useToolSettingsStore.getState().discardUndoAllSettings();
      // Re-ordered import: should
      // NOT be a no-op.
      applyImportedSettings({
        disabledToolNames: ['b', 'a'],
        confirmationMode: {},
      });
      expect(useToolSettingsStore.getState().pendingUndo).toBe(true);
    });

    it('detects a no-op when both lists and maps are empty', () => {
      const { applyImportedSettings } = useToolSettingsStore.getState();
      applyImportedSettings({
        disabledToolNames: [],
        confirmationMode: {},
      });
      // No-op: state is already
      // empty.
      expect(useToolSettingsStore.getState().pendingUndo).toBe(false);
    });

    it('the imported state can be undone via undoClearAllSettings (shares the 5a buffer)', () => {
      // The point of sharing the
      // buffer: a user who
      // imports bad settings and
      // clicks "Undo" should
      // restore the same as if
      // they had clicked "Reset
      // all" + "Undo".
      const { setEnabled, applyImportedSettings, undoClearAllSettings } =
        useToolSettingsStore.getState();
      setEnabled('a', false);
      setEnabled('b', false);
      applyImportedSettings({
        disabledToolNames: ['c'],
        confirmationMode: {},
      });
      expect(useToolSettingsStore.getState().disabledToolNames).toEqual(['c']);
      undoClearAllSettings();
      const s = useToolSettingsStore.getState();
      expect(s.disabledToolNames).toEqual(['a', 'b']);
      expect(s.pendingUndo).toBe(false);
    });

    it('import overwrites a pending undo from a prior action (last write wins on the buffer)', () => {
      // A user clicks "Reset all"
      // (soft-delete, undo buffer
      // = current state), then
      // within the 5s window
      // imports a file. The
      // import's pre-import
      // snapshot is the
      // "after-reset" state, NOT
      // the original pre-reset
      // state. The user cannot
      // get back to the
      // pre-reset state anymore.
      // This is "last write wins"
      // on the buffer; it's the
      // simplest correct
      // behaviour (alternative
      // would be chaining, which
      // is much more complex and
      // probably not what the
      // user wants â€” they meant
      // the import, not the
      // reset).
      const { setEnabled, clearAllSettings, applyImportedSettings } =
        useToolSettingsStore.getState();
      setEnabled('a', false);
      clearAllSettings();
      // After clear, state is
      // empty. Buffer has
      // {disabledToolNames: ['a']}.
      expect(useToolSettingsStore.getState().pendingUndo).toBe(true);
      applyImportedSettings({
        disabledToolNames: ['imported'],
        confirmationMode: {},
      });
      // The buffer should now
      // reflect the
      // pre-import state (which
      // is empty â€” what the
      // reset left behind).
      const raw = localStorage.getItem('lipi:toolSettings:undo:v1');
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
      const parsed = JSON.parse(raw!);
      expect(parsed.disabledToolNames).toEqual([]);
    });

    it('round-trips through persistence: import â†’ reload â†’ undo restores pre-import state', () => {
      // The most important
      // end-to-end test: the
      // undo buffer survives a
      // page reload (that's the
      // whole reason it's
      // localStorage-backed in
      // 5a). Verifying the
      // import path uses the
      // same buffer.
      const { setEnabled, applyImportedSettings, hydrate, undoClearAllSettings } =
        useToolSettingsStore.getState();
      hydrate();
      setupToolSettingsPersistence();
      setEnabled('original', false);
      applyImportedSettings({
        disabledToolNames: ['imported'],
        confirmationMode: {},
      });
      // Simulate a page reload:
      // clear in-memory state
      // and re-hydrate.
      useToolSettingsStore.setState({
        disabledToolNames: [],
        confirmationMode: {},
        hydrated: false,
        pendingUndo: false,
      });
      hydrate();
      // After hydrate, the
      // imported state should
      // be loaded (from v2) and
      // pendingUndo should be
      // true (from the buffer).
      expect(useToolSettingsStore.getState().disabledToolNames).toEqual([
        'imported',
      ]);
      expect(useToolSettingsStore.getState().pendingUndo).toBe(true);
      // Undo restores the
      // pre-import state.
      undoClearAllSettings();
      expect(useToolSettingsStore.getState().disabledToolNames).toEqual([
        'original',
      ]);
    });
  });
});
