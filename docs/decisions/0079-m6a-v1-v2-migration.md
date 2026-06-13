# ADR #79 — M6a: v1 → v2 persistence migration is in-store, idempotent, and drops the v1 keys only on success

**Date**: June 2026
**Phase**: M6a (Multi-workspace tabs: data model + tab strip)
**Status**: Accepted
**Supersedes**: n/a (the pre-M6a v1 persistence)
**Deciders**: project lead (Vimal Nair)

## Context

The pre-M6a `useWorkspaceStore` persisted two `localStorage` keys under the `lipi:` namespace:
- `lipi:workspace:v1` — a single `currentPath: string | null`.
- `lipi:workspace:recents:v1` — an array of paths.

M6a replaces the single-`currentPath` model with `workspaces: WorkspaceTab[]` + `activeId: string | null` (Decision #77). The new v2 keys are:
- `lipi:workspace:workspaces:v1` — the tab array.
- `lipi:workspace:activeId:v1` — the active tab id or `null`.
- `lipi:workspace:recents:v1` — **unchanged** from v1 (the recents key is the same shape; only the `workspaces` and `activeId` keys are new).

The architectural question is: how do we migrate an existing user's data from the v1 shape to the v2 shape, and what's the right "safety net" for users who have multiple Lipi binaries running side-by-side (e.g. a dev session and a packaged build)?

The three options considered:

1. **A one-shot migration script** that runs at app startup, reads the v1 keys, writes the v2 keys, and deletes the v1 keys. Simple, but it has a window of failure (if the user has an old binary and a new binary running, the migration might fire on the new binary, then the old binary's `setState` could re-write the v1 key with stale data).

2. **Lazy / on-read migration** that only runs the v1 → v2 conversion in memory, never touching the v1 keys. Pro: the v1 keys are always there as a fallback. Con: the v2 keys are never written, so the v1 → v2 transition never actually happens — every hydrate re-reads the v1 keys.

3. **In-store migration on first hydrate**: if the v2 `workspaces` key is absent, read the v1 keys, build the v2 state in memory, write the v2 keys, and drop the v1 keys (only on success). The v2 keys become the only source of truth. Selected.

## Decision

### D1. The migration is in-store, in `useWorkspaceStore.hydrate()`

The migration logic is part of the store's `hydrate()` action. The structure:

```ts
hydrate: () => {
  if (get().hydrated) return;

  // Step 1: read the v2 keys.
  const workspacesRaw = readJson<unknown>(STORAGE_KEY_WORKSPACES_V2);
  const activeIdRaw = readJson<unknown>(STORAGE_KEY_ACTIVE_ID_V2);
  const recentsRaw = readJson<unknown>(STORAGE_KEY_RECENTS_V2);

  // ... validate the v2 shape, build the `workspaces` and `activeId`
  //     and `recents` from the v2 keys ...

  // Step 2: if the v2 `workspaces` key is absent, try to migrate
  // from the v1 keys.
  const v2WorkspacesKeyPresent =
    readJson<unknown>(STORAGE_KEY_WORKSPACES_V2) !== null;
  if (!v2WorkspacesKeyPresent) {
    const v1CurrentRaw = readJson<unknown>(STORAGE_KEY_CURRENT_V1);
    const v1RecentsRaw = readJson<unknown>(STORAGE_KEY_RECENTS_V1);
    const v1Current: string | null =
      typeof v1CurrentRaw === 'string' ? v1CurrentRaw : null;
    const v1Recents: string[] = Array.isArray(v1RecentsRaw)
      ? v1RecentsRaw.filter((r): r is string => typeof r === 'string')
      : [];
    if (v1Current || v1Recents.length > 0) {
      // ... build the v2 state from the v1 values ...
      // ... write the v2 keys ...
      removeJson(STORAGE_KEY_CURRENT_V1);
    }
  }

  set({ hydrated: true, workspaces, activeId, recents, status: ... });
};
```

The "v2 workspaces key is absent" check is the signal that the migration is needed. After the first M6a hydrate, the v1 keys are gone and the v2 keys are the only source of truth. The `open()`, `close()`, and `setActive()` actions write to the v2 keys only — the v1 key is never re-written by the new code.

### D2. The v1 keys are dropped only on a successful migration

The v1 keys are dropped (via `removeJson(STORAGE_KEY_CURRENT_V1)`) only after the v2 keys are written. If the v2 write fails (e.g. `localStorage` quota exceeded), the v1 keys are left in place, and the next hydrate re-attempts the migration. The "drop on success" is the right time to clean up the old shape: a successful write is the proof that the new shape is now the source of truth.

The pre-M6a v1 keys are LEFT IN PLACE if the migration is not needed (i.e. the v2 keys are already there). This is a defensive measure in case a user has both an old binary and a new binary running side-by-side — the old binary's last `currentPath` write would otherwise be lost, but the new binary's read-side migration handles that by re-reading the v1 key if the v2 key is gone (which it isn't, so the v1 key is dormant).

### D3. The migration is defensive about partial / corrupt data

Each tab row is shape-checked (`id` string, `path` string, `addedAt` number) and malformed rows are dropped — a single corrupt row from a future version's bug doesn't wipe the whole tab list. The active id is validated against the tab list and falls back to the first tab if it doesn't match (the user sees their last-open workspace). Missing-but-tabs-present is recovered by picking the first tab. Recents are filtered to strings only.

The v1 → v2 wrap is also defensive: if the v1 `currentPath` is `null` (the pre-M6a "no workspace open" state), the v2 workspaces is `[]` and the v2 activeId is `null` — same shape as a fresh install. The user with no workspace open gets the same "Welcome screen" experience as a new user.

### D4. The migration is idempotent

Re-running the migration on the same v1 data produces the same v2 state. The migration's only side effect (besides the in-memory `set`) is the v2 key writes and the v1 key removal. After the first successful migration, the v1 keys are gone and the v2 keys are the only source of truth — the migration's "if v2 workspaces key is absent" check short-circuits on subsequent hydrates.

If a user has both an old binary and a new binary running, the old binary's last `currentPath` write would re-introduce the v1 key. The new binary's next hydrate sees the v2 keys (which it wrote earlier) and the v1 key (which the old binary just wrote), but the v2 keys take priority (the "v2 workspaces key is absent" check is false, so the migration is skipped). The v1 key is dormant but harmless.

## Consequences

### Positive

- The migration is a single read-and-write, atomic from the user's perspective. There's no "loading" state, no progress bar, no two-step apply.
- The v1 keys are dropped on success, so the user's `localStorage` doesn't accumulate dead keys.
- The migration is defensive about partial / corrupt data. A user with a corrupt v1 key (e.g. half-written by an interrupted save) gets a sane v2 state, not a wipe.
- The migration is idempotent and side-by-side safe. A user with both an old binary and a new binary running doesn't lose data to a race condition.
- The migration is in-store (not a separate script), so the new code path is the only place that knows about the v1 shape. A future "v2 → v3" migration adds another `if (!v2WorkspacesKeyPresent)` check (or whatever the new shape is) in the same `hydrate()` function.

### Negative

- The migration is a one-shot, in-memory transition. There's no rollback path — if the user wants to go back to the v1 binary, the v1 keys are gone. The "side-by-side" path is forward-only (M6a binary → v1 binary would see the v2 keys as garbage, not as a v1 `currentPath`). The v1 binary's `setState` would re-write the v1 key on its next state change, but the user's M6a tabs are lost in that direction. This is acceptable: the v1 binary is the *old* binary, and rolling back to it is a deliberate action, not a normal use case.
- The migration's defensive validation adds ~30 LoC to `hydrate()`. The complexity is justified by the side-by-side safety and the corrupt-data tolerance.
- The v1 keys are dropped on success. If the user wants to inspect the v1 data (e.g. to debug a migration issue), they have a one-shot window: the v1 keys exist between the first M6a hydrate and the first write that the migration does. After that, the v1 keys are gone. We don't expose a "preserve v1 keys" flag; the user can manually copy the v1 key's value from DevTools before triggering a state change.

## Implementation notes

- The v1 key (`STORAGE_KEY_CURRENT_V1 = 'lipi:workspace:v1'`) is preserved in the store's exports so a future "diagnostic" tool can read it. The apply path (`settingsIOv3.apply.ts`) imports the v1 key only in its documentation comment — the actual import shape is `currentPath: string | null` (the v2 export shape), not the v1 key.
- The migration logic is wrapped in a `if (!v2WorkspacesKeyPresent)` check, not a "if v1 keys present" check. The latter would re-fire on every hydrate if a user has both binaries running; the former fires exactly once.
- The `removeJson(STORAGE_KEY_CURRENT_V1)` call is the last step in the migration block. If the `writeJson(STORAGE_KEY_WORKSPACES_V2)` call above it throws (e.g. quota exceeded), the `removeJson` is not reached, so the v1 keys are left in place. The next hydrate re-attempts the migration. The "drop on success" semantics is the safety net.
- The migration's recents merge logic is `for (const p of v1Recents) { if (!merged.includes(p)) merged.push(p); }` — a dedup, not a sort. The order is "v2 recents first (already sorted newest-first by the v2 `open` action), then v1 recents appended in their v1 order". This is intentional: the v2 recents are the most recent (they were just written), and the v1 recents are older (they were written by the pre-M6a binary). The merged list is the v2 list with the v1 list appended, which preserves the "newest first" ordering.

## References

- `src/shared/state/workspaceStore.ts` — the `hydrate()` action, the v1 / v2 storage keys, the migration logic
- `src/shared/state/workspaceStore.test.ts` — the 21 tests for the v2 shape, including the v1 → v2 migration tests
- `src/shared/settingsIOv3.apply.ts` — the apply path (also reconstructs a `WorkspaceTab` from the imported `currentPath`, the inverse of the migration)
- `HANDOFF.md §9.22` — "M6a — SHIPPED" callout
- `CHANGELOG.md` "Added (M6a — Multi-workspace tabs: data model + tab strip)" — the "Persistence migration" section

---

*Last touched: M6a (June 2026). See `CHANGELOG.md` "Unreleased" for the user-facing summary.*
