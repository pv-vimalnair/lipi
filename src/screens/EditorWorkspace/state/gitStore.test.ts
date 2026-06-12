/**
 * gitStore — tests for the M4 commit lifecycle.
 *
 * Pure Zustand store, no React. The selectors
 * (esp. `isCommitToastVisible`) depend on
 * `Date.now()`, so we use vitest's fake timers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gitSelectors, useGitStore } from './gitStore';

describe('gitStore — M4 commit lifecycle', () => {
  beforeEach(() => {
    // Reset to initial state. We don't have a
    // reset action in the store (it's a UI state
    // store; reset is set by the host), so we
    // call it directly.
    useGitStore.getState().reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with commitStatus = idle and no lastCommit', () => {
    const s = useGitStore.getState();
    expect(s.commitStatus).toBe('idle');
    expect(s.lastCommit).toBeNull();
    expect(s.commitError).toBeNull();
  });

  it('setCommitRunning transitions to running and clears lastCommit + error', () => {
    // Seed an old success to make sure running
    // clears it.
    useGitStore.getState().setCommitSuccess({
      sha: 'a'.repeat(40),
      shortSha: 'aaaaaaa',
    });
    useGitStore.getState().setCommitRunning();
    const s = useGitStore.getState();
    expect(s.commitStatus).toBe('running');
    expect(s.lastCommit).toBeNull();
    expect(s.commitError).toBeNull();
  });

  it('setCommitSuccess stores short + full SHA with a timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T07:00:00Z'));
    useGitStore.getState().setCommitSuccess({
      sha: 'a'.repeat(40),
      shortSha: 'aaaaaaa',
    });
    const s = useGitStore.getState();
    expect(s.commitStatus).toBe('success');
    expect(s.lastCommit).toEqual({
      sha: 'a'.repeat(40),
      shortSha: 'aaaaaaa',
      at: Date.parse('2026-06-12T07:00:00Z'),
    });
    expect(s.commitError).toBeNull();
  });

  it('setCommitError transitions to error and stores the message', () => {
    useGitStore.getState().setCommitError('nothing to commit');
    const s = useGitStore.getState();
    expect(s.commitStatus).toBe('error');
    expect(s.commitError).toBe('nothing to commit');
    expect(s.lastCommit).toBeNull();
  });

  it('clearCommitResult returns to idle', () => {
    useGitStore.getState().setCommitSuccess({
      sha: 'b'.repeat(40),
      shortSha: 'bbbbbbb',
    });
    useGitStore.getState().clearCommitResult();
    const s = useGitStore.getState();
    expect(s.commitStatus).toBe('idle');
    expect(s.lastCommit).toBeNull();
    expect(s.commitError).toBeNull();
  });

  describe('isCommitToastVisible selector', () => {
    it('is true within 5s of a successful commit', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-12T07:00:00Z'));
      useGitStore.getState().setCommitSuccess({
        sha: 'c'.repeat(40),
        shortSha: 'ccccccc',
      });
      // 3 seconds in, still visible
      vi.setSystemTime(new Date('2026-06-12T07:00:03Z'));
      expect(gitSelectors.isCommitToastVisible(useGitStore.getState())).toBe(true);
    });

    it('is false after 5s of a successful commit', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-12T07:00:00Z'));
      useGitStore.getState().setCommitSuccess({
        sha: 'd'.repeat(40),
        shortSha: 'ddddddd',
      });
      // 6 seconds in, hidden
      vi.setSystemTime(new Date('2026-06-12T07:00:06Z'));
      expect(gitSelectors.isCommitToastVisible(useGitStore.getState())).toBe(false);
    });

    it('is false when status is not success', () => {
      useGitStore.getState().setCommitError('nope');
      expect(gitSelectors.isCommitToastVisible(useGitStore.getState())).toBe(false);
      useGitStore.getState().setCommitRunning();
      expect(gitSelectors.isCommitToastVisible(useGitStore.getState())).toBe(false);
    });
  });
});
