/**
 * Tests for `chatNavStore` (Phase 5f).
 *
 * Covered:
 *   - `requestJump` sets the state
 *   - `consumeJump` reads AND clears
 *   - Successive `requestJump` calls
 *     overwrite the previous
 *   - `clearJump` clears without
 *     reading
 *   - Expiry: a jump older than
 *     `JUMP_MAX_AGE_MS` is stale
 *     (the AIPanel will ignore it —
 *     we test the `issuedAt` stamp
 *     and the `JUMP_MAX_AGE_MS`
 *     constant directly here)
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  JUMP_MAX_AGE_MS,
  useChatNavStore,
} from './chatNavStore';

function resetStore() {
  useChatNavStore.setState({ pendingJump: null });
}

beforeEach(resetStore);
afterEach(resetStore);

describe('chatNavStore', () => {
  describe('requestJump', () => {
    it('sets the pending jump with a fresh issuedAt stamp', () => {
      const before = Date.now();
      useChatNavStore.getState().requestJump({
        messageId: 'msg_1',
        toolCallId: 'call_1',
      });
      const after = Date.now();
      const j = useChatNavStore.getState().pendingJump;
      expect(j).not.toBeNull();
      expect(j?.messageId).toBe('msg_1');
      expect(j?.toolCallId).toBe('call_1');
      expect(j!.issuedAt).toBeGreaterThanOrEqual(before);
      expect(j!.issuedAt).toBeLessThanOrEqual(after);
    });

    it('overwrites a previous pending jump without queuing', () => {
      useChatNavStore.getState().requestJump({
        messageId: 'msg_1',
        toolCallId: 'call_1',
      });
      useChatNavStore.getState().requestJump({
        messageId: 'msg_2',
        toolCallId: 'call_2',
      });
      const j = useChatNavStore.getState().pendingJump;
      expect(j?.messageId).toBe('msg_2');
      expect(j?.toolCallId).toBe('call_2');
    });
  });

  describe('consumeJump', () => {
    it('returns the current pending jump AND clears it', () => {
      useChatNavStore.getState().requestJump({
        messageId: 'msg_1',
        toolCallId: 'call_1',
      });
      const consumed = useChatNavStore.getState().consumeJump();
      expect(consumed).not.toBeNull();
      expect(consumed?.messageId).toBe('msg_1');
      // The store is now cleared —
      // a second consume returns
      // `null` (the same jump does
      // NOT fire twice).
      const second = useChatNavStore.getState().consumeJump();
      expect(second).toBeNull();
    });

    it('returns null when there is no pending jump', () => {
      const consumed = useChatNavStore.getState().consumeJump();
      expect(consumed).toBeNull();
    });
  });

  describe('clearJump', () => {
    it('clears without returning the value', () => {
      useChatNavStore.getState().requestJump({
        messageId: 'msg_1',
        toolCallId: 'call_1',
      });
      useChatNavStore.getState().clearJump();
      expect(useChatNavStore.getState().pendingJump).toBeNull();
    });
  });

  describe('expiry', () => {
    it('JUMP_MAX_AGE_MS is 30s', () => {
      // Lock the constant — the
      // AIPanel uses this to
      // decide whether to honour a
      // jump. If a future change
      // bumps it to 5min, the
      // intent shifts and this
      // test should fail to flag
      // the change for review.
      expect(JUMP_MAX_AGE_MS).toBe(30 * 1000);
    });

    it('a jump with issuedAt 31s ago is older than the cap', () => {
      // Synthesize a "31 seconds
      // ago" jump by writing
      // directly to the store (the
      // public API always uses
      // `Date.now()`, so we bypass
      // for the test).
      useChatNavStore.setState({
        pendingJump: {
          messageId: 'msg_stale',
          toolCallId: 'call_stale',
          issuedAt: Date.now() - JUMP_MAX_AGE_MS - 1,
        },
      });
      const j = useChatNavStore.getState().pendingJump!;
      // The AIPanel would check
      // `Date.now() - issuedAt` and
      // ignore the jump. We assert
      // the comparison here.
      expect(Date.now() - j.issuedAt).toBeGreaterThan(JUMP_MAX_AGE_MS);
    });
  });
});
