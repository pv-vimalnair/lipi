/**
 * Tests for the S3 store-snapshot
 * primitive. Per project convention
 * (Rule 4), we test the pure logic
 * in isolation — no React, no Tauri
 * mocks. The `read` / `write` closures
 * are simple in-test functions, not
 * real Zustand stores.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  createStoreSnapshot,
  restoreSnapshots,
  snapshotStores,
} from './storeSnapshot';

describe('createStoreSnapshot', () => {
  it('captures the value at create time', () => {
    let value = 'a';
    const snap = createStoreSnapshot(
      () => value,
      (v) => {
        value = v;
      },
    );
    expect(snap.value).toBe('a');
  });

  it('does NOT re-read on restore — restore uses the captured value', () => {
    // The point of the test: the
    // snapshot is a point-in-time
    // copy, not a "re-read and
    // write" closure. If we
    // change the underlying value
    // after creating the snapshot
    // and then call restore(), the
    // ORIGINAL value (not the new
    // one) is written.
    let value = 'a';
    const snap = createStoreSnapshot(
      () => value,
      (v) => {
        value = v;
      },
    );
    value = 'b';
    snap.restore();
    expect(value).toBe('a');
  });

  it('is idempotent — calling restore twice puts the same value back', () => {
    let value = 'a';
    const snap = createStoreSnapshot(
      () => value,
      (v) => {
        value = v;
      },
    );
    value = 'b';
    snap.restore();
    snap.restore();
    expect(value).toBe('a');
  });

  it('captures a deep object reference (mutating the live object post-snapshot does not change the captured value)', () => {
    // The snapshot is taken by
    // reference. If the caller
    // later mutates the live
    // object's properties, the
    // snapshot reflects those
    // mutations. This is
    // deliberate: the v3 apply
    // does a `setState({...})`
    // which REPLACES the state,
    // it does not mutate the
    // previous state in place.
    // A caller that mutates in
    // place is breaking the
    // contract.
    type State = { items: string[] };
    const live: State = { items: ['a', 'b'] };
    const snap = createStoreSnapshot<State>(
      () => live,
      (v) => {
        live.items = v.items;
      },
    );
    live.items.push('c');
    expect(snap.value.items).toEqual(['a', 'b', 'c']);
    snap.restore();
    expect(live.items).toEqual(['a', 'b', 'c']);
  });

  it('calls the write function with the captured value', () => {
    const write = vi.fn();
    const snap = createStoreSnapshot(
      () => ({ count: 7 }),
      write,
    );
    snap.restore();
    expect(write).toHaveBeenCalledWith({ count: 7 });
  });
});

describe('snapshotStores', () => {
  it('returns a 3-tuple of snapshots', () => {
    const [a, b, c] = snapshotStores(
      { read: () => 'A', write: () => {} },
      { read: () => 'B', write: () => {} },
      { read: () => 'C', write: () => {} },
    );
    expect(a.value).toBe('A');
    expect(b.value).toBe('B');
    expect(c.value).toBe('C');
  });

  it('restoring all three restores the captured values', () => {
    const writes: string[] = [];
    const [a, b, c] = snapshotStores(
      { read: () => 'A', write: (v) => writes.push(`write A=${v}`) },
      { read: () => 'B', write: (v) => writes.push(`write B=${v}`) },
      { read: () => 'C', write: (v) => writes.push(`write C=${v}`) },
    );
    // Simulate a partial apply: A
    // and B got new values, C
    // failed.
    restoreSnapshots([a, b, c]);
    expect(writes).toEqual([
      'write C=C',
      'write B=B',
      'write A=A',
    ]);
  });
});

describe('restoreSnapshots', () => {
  it('restores in REVERSE order (last → first)', () => {
    const writes: string[] = [];
    const list = [
      { restore: () => writes.push('first') },
      { restore: () => writes.push('second') },
      { restore: () => writes.push('third') },
    ];
    restoreSnapshots(list);
    expect(writes).toEqual(['third', 'second', 'first']);
  });

  it('returns the number of snapshots restored', () => {
    const list = [
      { restore: () => {} },
      { restore: () => {} },
    ];
    expect(restoreSnapshots(list)).toBe(2);
  });

  it('handles an empty list (returns 0)', () => {
    expect(restoreSnapshots([])).toBe(0);
  });
});
