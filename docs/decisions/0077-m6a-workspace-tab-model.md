# ADR #77 — M6a: `workspaces + activeId` is the v2 internal store shape; `useActivePath` is the canonical derived helper

**Date**: June 2026
**Phase**: M6a (Multi-workspace tabs: data model + tab strip)
**Status**: Accepted
**Supersedes**: n/a (the pre-M6a single-`currentPath` shape)
**Deciders**: project lead (Vimal Nair)

## Context

The pre-M6a `useWorkspaceStore` tracked a single `currentPath: string | null` — the "one open workspace" model. M6 is multi-workspace tabs (open 2+ folders side by side in the same window). The architectural decision is: how do we represent "the user has 2+ workspaces open and tab 1 is active" in the store?

The three options considered:

1. **Replace `currentPath` with a single `currentPath` field that's a path** — i.e. revert the data model to handle the "tab" concept at the UI layer only. Rejected: the user wants to come back to their multi-tab setup on relaunch (i.e. persistence), and the file tree / search / git / recents all need to know which tab is active. Keeping "tab" as a UI concept forces every consumer to reach into a separate "tabs" store and reconcile — too much coupling.

2. **Add a new `tabs` field on top of `currentPath`** — keep the old shape for backward compat, add `tabs: Tab[]` and `activeTabId: string | null` for the new shape. Rejected: two ways to ask the same question ("which workspace is the user in?") means every consumer can pick the wrong one and the answer can disagree. We want a single source of truth.

3. **Replace `currentPath` with `workspaces: WorkspaceTab[]` + `activeId: string | null`** — the new shape is the only shape. A `WorkspaceTab` is `{ id, path, addedAt }`. The active tab's path is derived. Selected.

## Decision

### D1. The v2 store shape is `workspaces + activeId`

```ts
interface WorkspaceTab {
  id: string;       // crypto.randomUUID()
  path: string;     // absolute folder path
  addedAt: number;  // Date.now()
}

interface WorkspaceState {
  workspaces: WorkspaceTab[];
  activeId: string | null;
  // ... the rest of the pre-M6a fields (recents, status, hydrated)
}
```

The `id` is a UUID (not the path) so the tab stays identifiable across rename / move — the canonical tab key in all persistence keys, all recents, and all in-store subscriptions is the `id`. The `path` is the human-facing label and the only thing persisted in the v2 export shape.

### D2. `useActivePath(state)` is the canonical derived helper

```ts
export function useActivePath(
  state: Pick<WorkspaceState, 'workspaces' | 'activeId'>,
): string | null {
  if (!state.activeId) return null;
  const tab = state.workspaces.find((w) => w.id === state.activeId);
  return tab?.path ?? null;
}
```

`useActivePath` is exported as a regular function (not a hook) so it can be called from non-React code (tests, `useActivePathSelector`, the `useWorkspaceSync` hook, the `settingsIOv3.apply.ts` apply path, etc.). The React-side hook is `useActivePathSelector()`:

```ts
export function useActivePathSelector(): string | null {
  return useActivePath(useWorkspaceStore.getState());
}
```

The existing `workspaceSelectors.currentPath` now points to `useActivePath` so the 5 pre-M6a consumers that read `useWorkspaceStore(s => s.currentPath)` are migrated to `useWorkspaceStore(workspaceSelectors.currentPath)` with no API change at the call site — the selector is a function, and the function is the derived helper.

### D3. New code should use `useActivePath` or `useActivePathSelector` directly

The `workspaceSelectors.currentPath` is a backward-compat shim. New code should use `useActivePathSelector()` for components (subscribes + re-renders) or `useActivePath(useWorkspaceStore.getState())` for one-shot reads in non-React code (the helper function accepts the whole state object, not just the workspaces, so it works from any context where the store is reachable).

### D4. The v2 export format keeps `workspace.currentPath`

The user's exported `lipi-state` JSON still has a `workspace.currentPath` field, the same as before. The apply path (both v2 and v3) reconstructs a `WorkspaceTab` from the imported `currentPath` so the v2/v3 export format stays compatible with the new v2 internal store. M6b's v4 export format will extend the `workspace` section to a `workspaces[]` array with per-tab state; the v3 → v4 import migration will wrap the old `currentPath` in a `WorkspaceTab` with empty per-tab state.

### D5. The `tourSteps.ts` `readWorkspaceGateFields` helper is decoupled

The pre-M6a helper accepted a `Pick<WorkspaceState, 'hydrated' | 'workspaces' | 'activeId'>` argument (it only needed `hydrated` and `currentPath`, but the typing leaked the internal store shape). M6a refactors it to accept a plain `{ hydrated: boolean; currentPath: string | null }` object — the onboarding-tour gate no longer depends on the store's internals. The call site computes `currentPath` via `useActivePath(useWorkspaceStore.getState())` and passes it in. This is a small but important decoupling: the gate's logic is reusable in non-store contexts (e.g. a future test that doesn't want to spin up a full Zustand store).

## Consequences

### Positive

- Single source of truth: there's exactly one way to ask "which tab is the user in?" (`useActivePath(state)`), and every consumer goes through it.
- The pre-M6a `currentPath` access pattern continues to work via the derived selector — no big-bang migration of every consumer.
- The M6b "per-tab state" extension is a data-model addition, not a refactor. We add per-tab state by adding a `state: { ... }` field to `WorkspaceTab`; the `workspaces + activeId` shape doesn't change.
- Persistence keys are well-named: `lipi:workspace:workspaces:v1` reads as "the workspaces key" (plural); `lipi:workspace:activeId:v1` reads as "the active id key". No more "currentPath" ambiguity.
- The `id` is a UUID, not a path, so the tab is stable across rename / move. The user can rename a folder on disk and the tab still points to it (via the same `id`).
- Recents are still strings, so the v2 / v3 export `workspace.recents` field is unchanged.

### Negative

- The pre-M6a `s.currentPath` direct access pattern is no longer a valid state field — TypeScript catches the mistake at compile time, but a developer who bypasses the selector (e.g. `useWorkspaceStore.getState().currentPath`) will silently get `undefined`. The migration to `workspaceSelectors.currentPath` is mechanical, but a future "raw store access" lint rule could enforce the selector pattern.
- The `WorkspaceTab` has a `Date.now()` `addedAt` that's a wall-clock value. If the user has two tabs with the same `addedAt` (e.g. from a v1 → v2 migration that wraps the v1 `currentPath` in a tab), the M6b "most recent" tiebreaker needs another rule (probably: the tab with the smaller `id` wins on tie, because UUIDs are sortable by time).
- The v2 store shape is a different surface than the v2 export shape. The internal `workspaces[]` is not the same as the exported `currentPath` (the export shape is `currentPath` + `recents`, not `workspaces[] + activeId` until v4). The asymmetry is a footgun: a developer who reads the v2 export JSON and looks for `workspaces[]` will be confused. We mitigate with the `readLipiState` / `writeLipiState` helpers in `settingsIOv3.apply.ts` — they're the canonical translation layer, and the v4 shape will be a strict superset of v3 (so v3 imports still work in v4, with the v4 reader mapping `currentPath` → a single `WorkspaceTab` with empty state).

## Implementation notes

- The `pickType` argument to `useActivePath` is `Pick<WorkspaceState, 'workspaces' | 'activeId'>`, not `WorkspaceState`. This lets the helper be called from any state-shaped object (the real store, a mock in a test, a plain object in a `useMemo`, etc.) without forcing the caller to construct a full `WorkspaceState`.
- The `useActivePathSelector` hook calls `useActivePath(useWorkspaceStore.getState())`. This is correct for a single render — `getState()` returns the current state, and the selector returns the active path. There's a subtle re-render subtlety: if the store updates but the active path stays the same, the component still re-renders (because `useSyncExternalStore` doesn't have a `useMemo`-like dedup for the inline selector). For most components this is fine (re-rendering once on a tab switch is the right cadence); for high-frequency updates, the caller can wrap the selector with `useShallow` (Zustand) or `memo` (React).
- The `openWorkspace(path)` helper in `useOpenWorkspace.ts` is the single bridge between the picker and the store — it calls `useWorkspaceStore.getState().open(chosen)` on the picker result. The store's `open` action handles the dedup-and-activate logic (if the path is already open, just re-activate the existing tab and bump recents; if not, add a new tab + make it active). The helper is in the Welcome screen folder because the picker is a Welcome-screen concern; the Command Palette reuses it via the same `openWorkspace` import.

## References

- `src/shared/state/workspaceStore.ts` — the new v2 store, `useActivePath`, `useActivePathSelector`, `workspaceSelectors`
- `src/shared/state/workspaceStore.test.ts` — the 21 new tests for the v2 shape
- `src/shared/hooks/useWorkspaceSync.ts` — `sync()` uses `useActivePath(state)` for both arguments
- `src/shared/settingsIOv3.apply.ts` — `read` returns `{ currentPath: useActivePath(s), recents: [...] }`; `write` reconstructs a `WorkspaceTab` from the imported `currentPath`
- `src/screens/EditorWorkspace/components/SearchPanel/SearchPanel.tsx` — uses `workspaceSelectors.currentPath` (the derived selector)
- `src/screens/SettingsProvider/SettingsProvider.tsx` — same
- `src/main.tsx` — same
- `src/screens/SettingsProvider/components/PrivacyDataCard.tsx` — `useActivePath(ws)` in the export snapshot
- `src/shared/components/OnboardingTour/tourSteps.ts` — `readWorkspaceGateFields` accepts a plain `{ hydrated, currentPath }` object
- `HANDOFF.md §9.22` — "M6a — SHIPPED" callout
- `CHANGELOG.md` "Added (M6a — Multi-workspace tabs: data model + tab strip)"

---

*Last touched: M6a (June 2026). See `CHANGELOG.md` "Unreleased" for the user-facing summary.*
