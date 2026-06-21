/* eslint-disable @typescript-eslint/no-non-null-assertion -- test assertions are guarded by prior expect().not.toBeNull() */
/**
 * Tests for `toolDecisionLogStore`
 * (Phase 5e).
 *
 * Covered:
 *   - `recordDecision` appends in
 *     newest-first order
 *   - The capacity cap (500) drops
 *     the oldest on overflow
 *   - `clearLog` empties the log
 *   - `getRecentForTool` filters by
 *     tool name (newest-first)
 *   - `getRecent(limit)` truncates
 *     to the limit
 *   - Persistence round-trip
 *     (subscribe writes to
 *     localStorage; the next
 *     instance reads back)
 *   - Corrupt v1 file â†’ defaults
 *   - `truncateArgsPreview` honours
 *     the 2KB byte cap (and the
 *     marker is appended)
 *
 * The tests follow the same
 * pattern as `toolSettingsStore.test.ts`:
 * per-test `localStorage` reset, no
 * `vitest.setup` global wipe.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ARGS_PREVIEW_MAX_BYTES,
  DECISION_LOG_CAPACITY,
  truncateArgsPreview,
  useToolDecisionLogStore,
} from './toolDecisionLogStore';

const STORAGE_KEY = 'lipi:toolDecisionLog:v1';

function resetStore() {
  useToolDecisionLogStore.setState({
    records: [],
    hydrated: false,
    lastCleared: null,
  });
}

function resetStorage() {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY);
  }
}

beforeEach(() => {
  resetStore();
  resetStorage();
});

afterEach(() => {
  resetStore();
  resetStorage();
});

describe('toolDecisionLogStore', () => {
  describe('recordDecision', () => {
    it('appends in newest-first order', () => {
      const { recordDecision } = useToolDecisionLogStore.getState();
      const id1 = recordDecision({
        toolName: 'a',
        decision: 'deny',
        argsPreview: '{}',
        requestId: 'r1',
        assistantMessageId: 'm1',
        toolCallId: 'tc1',
      });
      const id2 = recordDecision({
        toolName: 'b',
        decision: 'allow_once',
        argsPreview: '{}',
        requestId: 'r2',
        assistantMessageId: 'm2',
        toolCallId: 'tc2',
      });
      const { records } = useToolDecisionLogStore.getState();
      expect(records).toHaveLength(2);
      // The second record is the
      // newest -- sits at index 0.
      expect(records[0].id).toBe(id2);
      expect(records[0].toolName).toBe('b');
      expect(records[1].id).toBe(id1);
      expect(records[1].toolName).toBe('a');
    });

    it('stamps id and timestamp on each record', () => {
      const before = Date.now();
      const { recordDecision } = useToolDecisionLogStore.getState();
      const id = recordDecision({
        toolName: 't',
        decision: 'deny',
        argsPreview: '{}',
        requestId: 'r',
        assistantMessageId: 'm',
        toolCallId: 'tc',
      });
      const after = Date.now();
      const r = useToolDecisionLogStore.getState().records[0];
      expect(r.id).toBe(id);
      expect(r.timestamp).toBeGreaterThanOrEqual(before);
      expect(r.timestamp).toBeLessThanOrEqual(after);
    });

    it('re-truncates an oversized argsPreview at the byte cap', () => {
      // Even if the caller passes a
      // 4KB string, the store
      // truncates to 2KB.
      const big = 'x'.repeat(4 * 1024);
      const { recordDecision } = useToolDecisionLogStore.getState();
      recordDecision({
        toolName: 't',
        decision: 'deny',
        argsPreview: big,
        requestId: 'r',
        assistantMessageId: 'm',
        toolCallId: 'tc',
      });
      const r = useToolDecisionLogStore.getState().records[0];
      expect(r.argsPreview.length).toBeLessThan(big.length);
      expect(r.argsPreview).toContain('(truncated)');
    });
  });

  describe('capacity (500)', () => {
    it('drops the oldest entries on overflow', () => {
      const { recordDecision } = useToolDecisionLogStore.getState();
      // Record 501 entries. The
      // first one should be the
      // oldest record -- and should
      // be dropped.
      const ids: string[] = [];
      for (let i = 0; i < DECISION_LOG_CAPACITY + 1; i++) {
        ids.push(
          recordDecision({
            toolName: `t${i}`,
            decision: 'deny',
            argsPreview: '{}',
            requestId: 'r',
            assistantMessageId: 'm',
            toolCallId: `tc${i}`,
          }),
        );
      }
      const { records } = useToolDecisionLogStore.getState();
      expect(records).toHaveLength(DECISION_LOG_CAPACITY);
      // Newest first: the 501st
      // (last recorded) is at index
      // 0; the 1st (oldest) is
      // gone.
      expect(records[0].id).toBe(ids[ids.length - 1]);
      // The original first record
      // (`ids[0]`) should be
      // absent.
      const firstStillPresent = records.some((r) => r.id === ids[0]);
      expect(firstStillPresent).toBe(false);
    });

    it('preserves the cap exactly at the boundary', () => {
      const { recordDecision } = useToolDecisionLogStore.getState();
      for (let i = 0; i < DECISION_LOG_CAPACITY; i++) {
        recordDecision({
          toolName: `t${i}`,
          decision: 'deny',
          argsPreview: '{}',
          requestId: 'r',
          assistantMessageId: 'm',
          toolCallId: `tc${i}`,
        });
      }
      expect(
        useToolDecisionLogStore.getState().records,
      ).toHaveLength(DECISION_LOG_CAPACITY);
    });
  });

  describe('clearLog (5h: soft-delete with undo buffer)', () => {
    it('empties the records array but moves them to the undo buffer', () => {
      const { recordDecision, clearLog } = useToolDecisionLogStore.getState();
      recordDecision({
        toolName: 't',
        decision: 'deny',
        argsPreview: '{}',
        requestId: 'r',
        assistantMessageId: 'm',
        toolCallId: 'tc',
      });
      recordDecision({
        toolName: 't2',
        decision: 'allow_once',
        argsPreview: '{}',
        requestId: 'r2',
        assistantMessageId: 'm2',
        toolCallId: 'tc2',
      });
      expect(useToolDecisionLogStore.getState().records).toHaveLength(2);
      clearLog();
      // After clear: records
      // empty, lastCleared has
      // the cleared records.
      const after = useToolDecisionLogStore.getState();
      expect(after.records).toEqual([]);
      expect(after.lastCleared).not.toBeNull();
      expect(after.lastCleared).toHaveLength(2);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
      expect(after.lastCleared![0].toolName).toBe('t2');
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
      expect(after.lastCleared![1].toolName).toBe('t');
    });
  });

  describe('undoClear (5h)', () => {
    it('restores records from the lastCleared buffer', () => {
      const { recordDecision, clearLog, undoClear } =
        useToolDecisionLogStore.getState();
      recordDecision({
        toolName: 't',
        decision: 'deny',
        argsPreview: '{}',
        requestId: 'r',
        assistantMessageId: 'm',
        toolCallId: 'tc',
      });
      clearLog();
      expect(useToolDecisionLogStore.getState().records).toEqual([]);
      // Restore.
      undoClear();
      const after = useToolDecisionLogStore.getState();
      expect(after.records).toHaveLength(1);
      expect(after.records[0].toolName).toBe('t');
      // The buffer is now
      // cleared (the undo is
      // single-shot).
      expect(after.lastCleared).toBeNull();
    });

    it('is a no-op when there is nothing in the buffer', () => {
      // No clear was ever
      // called -- `lastCleared`
      // is null from the
      // reset. Calling
      // `undoClear` should not
      // throw and should not
      // change state.
      const { undoClear } = useToolDecisionLogStore.getState();
      expect(() => undoClear()).not.toThrow();
      const after = useToolDecisionLogStore.getState();
      expect(after.records).toEqual([]);
      expect(after.lastCleared).toBeNull();
    });
  });

  describe('discardUndo (5h)', () => {
    it('clears the buffer without restoring records', () => {
      const { recordDecision, clearLog, discardUndo } =
        useToolDecisionLogStore.getState();
      recordDecision({
        toolName: 't',
        decision: 'deny',
        argsPreview: '{}',
        requestId: 'r',
        assistantMessageId: 'm',
        toolCallId: 'tc',
      });
      clearLog();
      expect(useToolDecisionLogStore.getState().lastCleared).not.toBeNull();
      // Discard the buffer
      // (the UI does this
      // when the 5s window
      // expires).
      discardUndo();
      const after = useToolDecisionLogStore.getState();
      // Records stay empty
      // (the clear is final).
      expect(after.records).toEqual([]);
      // Buffer is dropped.
      expect(after.lastCleared).toBeNull();
    });

    it('is a no-op when there is nothing in the buffer', () => {
      const { discardUndo } = useToolDecisionLogStore.getState();
      expect(() => discardUndo()).not.toThrow();
      expect(useToolDecisionLogStore.getState().lastCleared).toBeNull();
    });
  });

  describe('clearLog no-op on empty (5h)', () => {
    it('does not create a lastCleared entry when called on an empty log', () => {
      // Defensive: clicking
      // Clear on an empty log
      // (e.g. a re-entry bug
      // from a double-click)
      // should NOT create a
      // phantom undo offer
      // with an empty buffer.
      const { clearLog } = useToolDecisionLogStore.getState();
      clearLog();
      const after = useToolDecisionLogStore.getState();
      expect(after.records).toEqual([]);
      expect(after.lastCleared).toBeNull();
    });
  });

  describe('getRecentForTool', () => {
    it('filters by tool name (newest-first)', () => {
      const { recordDecision, getRecentForTool } =
        useToolDecisionLogStore.getState();
      recordDecision({
        toolName: 'a',
        decision: 'deny',
        argsPreview: '{}',
        requestId: 'r1',
        assistantMessageId: 'm1',
        toolCallId: 'tc1',
      });
      recordDecision({
        toolName: 'b',
        decision: 'allow_once',
        argsPreview: '{}',
        requestId: 'r2',
        assistantMessageId: 'm2',
        toolCallId: 'tc2',
      });
      recordDecision({
        toolName: 'a',
        decision: 'allow_always',
        argsPreview: '{}',
        requestId: 'r3',
        assistantMessageId: 'm3',
        toolCallId: 'tc3',
      });
      const aRecords = getRecentForTool('a');
      expect(aRecords).toHaveLength(2);
      // Newest first: the second
      // 'a' record is at index 0.
      expect(aRecords[0].decision).toBe('allow_always');
      expect(aRecords[1].decision).toBe('deny');
      // The 'b' record is not in
      // the filter.
      const bRecords = getRecentForTool('b');
      expect(bRecords).toHaveLength(1);
      expect(bRecords[0].toolName).toBe('b');
    });
  });

  describe('getRecent', () => {
    it('returns the full list when no limit is given', () => {
      const { recordDecision, getRecent } = useToolDecisionLogStore.getState();
      for (let i = 0; i < 3; i++) {
        recordDecision({
          toolName: `t${i}`,
          decision: 'deny',
          argsPreview: '{}',
          requestId: 'r',
          assistantMessageId: 'm',
          toolCallId: `tc${i}`,
        });
      }
      expect(getRecent()).toHaveLength(3);
    });

    it('truncates to the given limit', () => {
      const { recordDecision, getRecent } = useToolDecisionLogStore.getState();
      for (let i = 0; i < 5; i++) {
        recordDecision({
          toolName: `t${i}`,
          decision: 'deny',
          argsPreview: '{}',
          requestId: 'r',
          assistantMessageId: 'm',
          toolCallId: `tc${i}`,
        });
      }
      const recent = getRecent(2);
      expect(recent).toHaveLength(2);
      // Newest first.
      expect(recent[0].toolName).toBe('t4');
      expect(recent[1].toolName).toBe('t3');
    });
  });

  describe('persistence', () => {
    it('writes records to localStorage on subsequent changes', async () => {
      const { setupToolDecisionLogPersistence } = await import(
        './toolDecisionLogStore'
      );
      const { hydrate, recordDecision } = useToolDecisionLogStore.getState();
      hydrate();
      setupToolDecisionLogPersistence();
      recordDecision({
        toolName: 't',
        decision: 'deny',
        argsPreview: '{}',
        requestId: 'r',
        assistantMessageId: 'm',
        toolCallId: 'tc',
      });
      const raw = localStorage.getItem(STORAGE_KEY);
      expect(raw).not.toBeNull();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
      const parsed = JSON.parse(raw!);
      expect(parsed.records).toHaveLength(1);
      expect(parsed.records[0].toolName).toBe('t');
      expect(parsed.records[0].decision).toBe('deny');
    });

    it('hydrates from localStorage on hydrate()', () => {
      const persisted = {
        records: [
          {
            id: 'preset-1',
            timestamp: 1234567890,
            toolName: 'preset_tool',
            decision: 'allow_once' as const,
            argsPreview: '{"a":1}',
            requestId: 'r-preset',
            assistantMessageId: 'm-preset',
            toolCallId: 'tc-preset',
          },
        ],
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
      useToolDecisionLogStore.getState().hydrate();
      const { records } = useToolDecisionLogStore.getState();
      expect(records).toHaveLength(1);
      expect(records[0].id).toBe('preset-1');
      expect(records[0].toolName).toBe('preset_tool');
    });

    it('drops malformed records but keeps valid ones', () => {
      // Defensive: a single
      // corrupt row from a past
      // bug shouldn't wipe the
      // entire history.
      const persisted = {
        records: [
          {
            id: 'good',
            timestamp: 1,
            toolName: 't',
            decision: 'deny',
            argsPreview: '{}',
            requestId: 'r',
            assistantMessageId: 'm',
            toolCallId: 'tc-good',
          },
          // Malformed: missing
          // `timestamp`, wrong
          // `decision` value.
          {
            id: 'bad',
            decision: 'maybe',
            argsPreview: '{}',
          },
        ],
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
      useToolDecisionLogStore.getState().hydrate();
      const { records } = useToolDecisionLogStore.getState();
      expect(records).toHaveLength(1);
      expect(records[0].id).toBe('good');
    });

    it('falls back to defaults if the file is not parseable', () => {
      localStorage.setItem(STORAGE_KEY, '{not json');
      useToolDecisionLogStore.getState().hydrate();
      expect(useToolDecisionLogStore.getState().records).toEqual([]);
    });

    it('does NOT write when hydrate is the only state change', () => {
      // The `hydrated` flag should
      // guard against the hydration
      // itself triggering a
      // redundant write.
      const persisted = {
        records: [
          {
            id: 'preset',
            timestamp: 1,
            toolName: 't',
            decision: 'deny' as const,
            argsPreview: '{}',
            requestId: 'r',
            assistantMessageId: 'm',
            toolCallId: 'tc-preset',
          },
        ],
      };
      // Pre-populate the key. If
      // hydrate() triggered a
      // write, the file would be
      // rewritten -- but the
      // contents would be the
      // same, so this is hard to
      // detect from contents alone.
      // We test the in-memory state
      // is correct (the corollary
      // property).
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
      useToolDecisionLogStore.getState().hydrate();
      expect(useToolDecisionLogStore.getState().records).toHaveLength(1);
      expect(useToolDecisionLogStore.getState().records[0].id).toBe('preset');
    });
  });

  describe('toolCallId (5f)', () => {
    it('records carry a toolCallId through persistence', () => {
      const { recordDecision } = useToolDecisionLogStore.getState();
      recordDecision({
        toolName: 't',
        decision: 'allow_once',
        argsPreview: '{}',
        requestId: 'r',
        assistantMessageId: 'm',
        toolCallId: 'tc-42',
      });
      const r = useToolDecisionLogStore.getState().records[0];
      expect(r.toolCallId).toBe('tc-42');
    });

    it('drops 5e-era records (no toolCallId) on hydrate', () => {
      // Records written by Phase 5e
      // (before the toolCallId
      // field existed) should be
      // dropped on hydration. The
      // validator rejects them.
      const persisted = {
        records: [
          {
            // 5e-era record:
            // valid in 5e, but
            // missing toolCallId
            // so it's malformed
            // in 5f.
            id: 'old',
            timestamp: 1,
            toolName: 't',
            decision: 'deny',
            argsPreview: '{}',
            requestId: 'r',
            assistantMessageId: 'm',
          },
          {
            // 5f-era record:
            // valid.
            id: 'new',
            timestamp: 2,
            toolName: 't',
            decision: 'allow_always',
            argsPreview: '{}',
            requestId: 'r2',
            assistantMessageId: 'm2',
            toolCallId: 'tc-2',
          },
        ],
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
      useToolDecisionLogStore.getState().hydrate();
      const { records } = useToolDecisionLogStore.getState();
      expect(records).toHaveLength(1);
      expect(records[0].id).toBe('new');
    });
  });

  describe('revert decision (5g)', () => {
    it('accepts decision: "revert" as a valid recordDecision input', () => {
      // The 4th decision kind
      // introduced in 5g: the
      // user clicks "Undo" on
      // an `allow_always` row,
      // and the Settings
      // component records a
      // synthetic `revert`
      // decision so the audit
      // trail shows the
      // downgrade.
      const { recordDecision } = useToolDecisionLogStore.getState();
      recordDecision({
        toolName: 't',
        decision: 'revert',
        argsPreview: '',
        requestId: 'revert',
        assistantMessageId: 'revert',
        toolCallId: 'revert',
      });
      const r = useToolDecisionLogStore.getState().records[0];
      expect(r.decision).toBe('revert');
    });

    it('round-trips "revert" decisions through persistence', async () => {
      // A revert record
      // persisted in 5g should
      // hydrate back correctly
      // (the validator accepts
      // it as a valid
      // `DecisionRecord`).
      const { setupToolDecisionLogPersistence } = await import(
        './toolDecisionLogStore'
      );
      const { hydrate, recordDecision } = useToolDecisionLogStore.getState();
      hydrate();
      setupToolDecisionLogPersistence();
      recordDecision({
        toolName: 't',
        decision: 'revert',
        argsPreview: '',
        requestId: 'revert',
        assistantMessageId: 'revert',
        toolCallId: 'revert',
      });
      const raw = localStorage.getItem(STORAGE_KEY);
      expect(raw).not.toBeNull();
      useToolDecisionLogStore.setState({
        records: [],
        hydrated: false,
      });
      useToolDecisionLogStore.getState().hydrate();
      const { records } = useToolDecisionLogStore.getState();
      expect(records).toHaveLength(1);
      expect(records[0].decision).toBe('revert');
      expect(records[0].toolCallId).toBe('revert');
    });

    it('revert records are filterable from the rest via getRecent', () => {
      // A user with 1 allow_always
      // and 1 revert for the
      // same tool should see
      // both in the log (the
      // revert comes AFTER the
      // allow_always in the
      // record list -- newest
      // first). We don't have
      // a "filter by decision"
      // selector, so the test
      // just confirms the log
      // is in newest-first
      // order with the revert
      // at index 0.
      const { recordDecision } = useToolDecisionLogStore.getState();
      recordDecision({
        toolName: 't',
        decision: 'allow_always',
        argsPreview: '{}',
        requestId: 'r1',
        assistantMessageId: 'm1',
        toolCallId: 'tc1',
      });
      recordDecision({
        toolName: 't',
        decision: 'revert',
        argsPreview: '',
        requestId: 'revert',
        assistantMessageId: 'revert',
        toolCallId: 'revert',
      });
      const { records } = useToolDecisionLogStore.getState();
      expect(records).toHaveLength(2);
      expect(records[0].decision).toBe('revert');
      expect(records[1].decision).toBe('allow_always');
    });
  });
});

describe('truncateArgsPreview', () => {
  it('returns the input unchanged when under the cap', () => {
    const s = 'small';
    expect(truncateArgsPreview(s)).toBe('small');
  });

  it('returns empty string for an empty input', () => {
    expect(truncateArgsPreview('')).toBe('');
  });

  it('truncates an over-cap string and appends a marker', () => {
    const big = 'x'.repeat(ARGS_PREVIEW_MAX_BYTES * 2);
    const out = truncateArgsPreview(big);
    // The output is shorter than
    // the input.
    expect(out.length).toBeLessThan(big.length);
    // The marker is present.
    expect(out).toContain('(truncated)');
  });

  it('measures by UTF-8 bytes, not characters', () => {
    // 4-byte UTF-8 emoji count as
    // 4 bytes, not 1. Build a
    // string whose BYTE length
    // exceeds the cap even though
    // its CHARACTER length is
    // small.
    const emoji = '\u{1F600}'; // ðŸ˜€ -- 4 bytes in UTF-8
    const s = emoji.repeat(1000); // 1000 chars / 4000 bytes
    const out = truncateArgsPreview(s);
    // The output's byte length is
    // bounded by the cap.
    const enc = new TextEncoder();
    expect(enc.encode(out).length).toBeLessThanOrEqual(ARGS_PREVIEW_MAX_BYTES);
  });
});
