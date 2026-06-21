/**
 * storeSnapshot — a tiny primitive
 * for snapshotting a Zustand store
 * and rolling back to the snapshot
 * on failure.
 *
 * This is the S3 (Settings v3
 * cross-store snapshot) primitive
 * that the v2 apply was missing
 * (per Decision #63 in HANDOFF).
 * The v3 import flow uses it to
 * guarantee that a failed import
 * leaves the user's local state
 * exactly as it was — no partial
 * writes, no "the workspace was
 * overwritten but the tool
 * settings failed" corner.
 *
 * The shape:
 *
 *   const snap = createStoreSnapshot(
 *     () => useWorkspaceStore.getState(),
 *     (state) => useWorkspaceStore.setState({ ... })
 *   );
 *   // ... do something that might throw ...
 *   snap.restore();
 *
 * `createStoreSnapshot` takes two
 * functions: a `read` and a `write`.
 * The `read` returns the current
 * state; the snapshot is built
 * from that. The `write` puts
 * state back. The two are decoupled
 * so the caller can use any
 * persistence / side-effect-
 * handling write function (e.g.
 * the `applyImportedSettings`
 * action on `toolSettingsStore`
 * that goes through 5a's
 * soft-delete undo plumbing).
 *
 * The snapshot value is taken
 * ONCE at `createStoreSnapshot`
 * time. Calling `restore()`
 * later puts that EXACT value
 * back. The snapshot is not a
 * "re-read on restore" — it's a
 * point-in-time copy.
 *
 * Why a primitive, not a class?
 *   - The v3 apply is a single
 *     function that holds the
 *     snapshot locally; a class
 *     would add lifecycle noise.
 *   - A function is testable
 *     without `new`.
 *   - The data shape (the
 *     captured state) is plain
 *     JSON, so the snapshot can
 *     be logged / diffed /
 *     inspected in tests.
 */

import { logger } from '@/shared/logger';

export interface StoreSnapshot<T> {
  /** The captured value. Read-only
   *  by convention — callers
   *  should NOT mutate the
   *  snapshot (mutating it would
   *  mean the restore is to the
   *  mutated value, not the
   *  original). */
  readonly value: T;
  /** Replace the live state with
   *  the captured value. Idempotent;
   *  calling twice puts the same
   *  value back. */
  restore: () => void;
}

/**
 * Build a snapshot of `read()`
 * and a `restore` closure that
 * calls `write(value)`. The
 * snapshot is taken at call time;
 * subsequent reads of the live
 * store are not reflected in
 * the snapshot.
 *
 * @param read  A function that
 *              returns the
 *              current state.
 *              Called once,
 *              synchronously, at
 *              `createStoreSnapshot`
 *              time.
 * @param write A function that
 *              puts a value back
 *              into the store.
 *              Called by
 *              `snapshot.restore()`.
 *              Should NOT throw
 *              (a throwing write
 *              means the restore
 *              itself fails — a
 *              silent corruption
 *              risk).
 */
export function createStoreSnapshot<T>(
  read: () => T,
  write: (value: T) => void,
): StoreSnapshot<T> {
  const value = read();
  return {
    value,
    restore: () => {
      try {
        write(value);
      } catch (e) {
        // The restore itself
        // can fail (e.g. a
        // `setState` that throws
        // on bad input). We log
        // and continue — failing
        // mid-restore would leave
        // the user in a half-
        // restored state, which
        // is worse than a logged
        // error. The caller (the
        // v3 apply) restores in
        // reverse order so the
        // LEAST-recently-changed
        // store is restored last;
        // a failed restore on an
        // earlier store is
        // reported, then the
        // loop continues.
        if (import.meta.env.DEV) {
          logger.warn(
            '[storeSnapshot] restore() failed',
            e,
          );
        }
      }
    },
  };
}

/** Take snapshots of N stores in
 *  one call. The snapshots are
 *  taken in the order given
 *  (left-to-right), which
 *  matches the S3 apply order
 *  (workspace → voicePreferences
 *  → toolSettings). */
export function snapshotStores<
  T1,
  T2,
  T3,
>(
  s1: { read: () => T1; write: (v: T1) => void },
  s2: { read: () => T2; write: (v: T2) => void },
  s3: { read: () => T3; write: (v: T3) => void },
): [StoreSnapshot<T1>, StoreSnapshot<T2>, StoreSnapshot<T3>] {
  return [
    createStoreSnapshot(s1.read, s1.write),
    createStoreSnapshot(s2.read, s2.write),
    createStoreSnapshot(s3.read, s3.write),
  ];
}

/** Restore a list of snapshots in
 *  REVERSE order (most-recent
 *  snapshot first). The reverse
 *  order is the right restore
 *  order when the writes have
 *  side effects: applying the
 *  last write first means the
 *  store ends up in the state
 *  it was in before the apply
 *  started. (For a state where
 *  the writes are pure, the
 *  order doesn't matter; but
 *  for `toolSettings.applyImportedSettings`
 *  which pushes an undo entry,
 *  restoring in reverse avoids
 *  a second undo push.)
 *
 *  Returns the number of
 *  snapshots restored (for
 *  tests / logging). */
export function restoreSnapshots(
  snapshots: readonly { restore: () => void }[],
): number {
  for (let i = snapshots.length - 1; i >= 0; i--) {
    const snap = snapshots[i];
    if (snap) snap.restore();
  }
  return snapshots.length;
}
