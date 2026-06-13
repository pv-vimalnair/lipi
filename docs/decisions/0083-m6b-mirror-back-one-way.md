# ADR #83 — M6b: mirror-back is one-way (live store → persisted state); the persisted state is the destination, not the source

**Date**: June 2026
**Phase**: M6b (Per-tab state keying + v4 settings export / import)
**Status**: Accepted
**Supersedes**: n/a (M6a had no per-tab state, so no mirror-back; the M6b "live store is the source, persisted state is the destination" model is the first mirror-back in the codebase)
**Deciders**: project lead (Vimal Nair)

## Context

Decision #81 establishes that `WorkspaceTab.state` is the persisted source of truth and the two live stores (`useFileTreeStore`, `useEditorTabsStore`) are the transient view. The decision leaves a design question unanswered: in what direction does the data flow?

The two options are:

1. **Persisted state is the source, live store is hydrated from it.** The persisted state is the "what the data is" record. The live store is "what the data looks like right now". On every state change, the persisted state is updated; the live store is *also* updated, but it's a derived view of the persisted state. This is the "store-of-record + derived view" pattern, common in Redux / unidirectional data flow. A user who clicks a directory updates the persisted state first; the live store is a side-effect of the persisted state change.

2. **Live store is the source, persisted state is shadowed from it.** The live store is the "what the data is right now" record. The persisted state is "what the data was the last time the user clicked something". On every state change, the live store is updated; the persisted state is *also* updated, but it's a passive shadow of the live store. This is the "write-through cache" pattern, common in databases / reactive systems. A user who clicks a directory updates the live store first; the persisted state is a side-effect of the live store change.

The two patterns are symmetric — they both keep the two views in sync — but the *direction* of the primary write is opposite. Option 1 makes the persisted state the canonical "user clicked X" record (the live store is downstream); option 2 makes the live store the canonical "user clicked X" record (the persisted state is downstream).

The pre-M6b code was option 1 in a degenerate form: the live stores *were* the source of truth, the localStorage was a passive shadow written on every mutation (via `useStorePersist` middleware that subscribed to the live store's changes and wrote to localStorage). The M6b code has to choose: continue option 1 with the new per-tab state, or switch to option 2 (which is a "use the live store as the source, the persisted state as a shadow" pattern, but now the persisted state is a `WorkspaceTab.state` rather than a localStorage key).

## The options considered

1. **Option 1: persisted state is the source, live store is hydrated.** The user click handlers call `useWorkspaceStore.setTabState(tabId, partial)` first. The `setTabState` action updates the persisted state. The `setTabState` action *also* updates the live store (the action reaches into the live store and calls `useFileTreeStore.setExpandedAndSelected(...)` or `useEditorTabsStore.replaceAll(...)`). The two stores are updated in one go, atomically. Selected against: this is the "the action knows about both stores" pattern — the action is a side-effect orchestrator, not a "set a field" primitive. The action has to import both live stores, has to know which fields go to which live store, and has to handle the "tab switched, don't push to live store, just update the persisted state" case. The action's complexity is high, and the live store updates are a side effect of the persisted state update (a "primary write to A, side effect to B" pattern), which is hard to test (the test has to assert on both stores).

2. **Option 2: live store is the source, persisted state is shadowed.** The user click handlers call the live store's `set*` actions (unchanged from M6a). The `useFileTree` and `useEditorTabs` hooks grow `useEffect` subscriptions that observe the live store's changes and push them into the persisted state via `useWorkspaceStore.setTabState(tabId, partial)`. The persisted state is updated as a *side effect* of the live store change. Selected.

3. **Two-way binding.** The user click handlers update both stores (option 1). The hooks also subscribe to the live store (option 2). The two writes race, and the "last writer wins" rule is the only consistency guarantee. Selected against: this is option 1 + option 2, with no clear winner. The race is a "the hook wrote A to the persisted state, the user click handler wrote A to the persisted state, both wrote the same value" — a benign race — but the race is not always benign (a user who clicks "select row X" and "select row Y" in quick succession could see the persisted state end up with X while the live store has Y, or vice versa). The two-way binding is option 1 with the option 2 effect fighting it; the only way to resolve the fight is to pick a winner, which is option 1 or option 2.

The pre-M6b code was option 1 in a degenerate form (the live store *was* the source of truth, the localStorage was a shadow). The M6b code is option 2 — a "live store is the source, persisted state is a shadow" pattern, generalised from localStorage-shadow to WorkspaceTabState-shadow. The generalisation is a refactor, not a redesign.

## Decision

### D1. The mirror-back is one-way: live store → persisted state

The user click handlers in `useFileTree` and `useEditorTabs` (and the `FileTreePane` and `EditorTabs` components) call the live store's `set*` actions, exactly as they did in M6a. The handlers do not call `useWorkspaceStore.setTabState` directly — the persisted state is updated as a side effect of the live store change, via a `useEffect` subscription in the hook that owns the live store.

The two `useEffect` subscriptions (one in `useFileTree`, one in `useEditorTabs`) are the *only* writers to `useWorkspaceStore.setTabState`. The mirror-back is owned by the two hook files, not by the user click handlers, not by the live store, not by `useWorkspaceStore`. The mirror-back is a "this live store mirrors to this persisted field" concern; it lives in the hook that owns the live store.

The two subscriptions are `useLiveStore.subscribe((state, prev) => { ... })` — Zustand's native subscribe API. The subscription fires on every state change, and the body of the subscription is "read the relevant field(s) from the live state, push them into the active tab's `state` via `useWorkspaceStore.setTabState(activeId, { ...fields })`". The subscription is a "live store changed → persisted state updated" effect, period.

The "live store → persisted state" direction is the mirror-back. The "persisted state → live store" direction is the rehydration (Decision #81's D3 #1). The two directions are *distinct* effects in *distinct* hooks:

- **Rehydration (persisted → live).** `useWorkspaceStore.subscribe((state, prev) => { if (state.activeId !== prev.activeId) { rehydrateFromTab(state.workspaces.find(w => w.id === state.activeId)!.state) } })` — fires on `activeId` change, pushes the new tab's state into the live store.
- **Mirror-back (live → persisted).** `useLiveStore.subscribe((state, prev) => { if (state.field !== prev.field) { useWorkspaceStore.setTabState(activeId, { field: state.field }) } })` — fires on any live store change, pushes the new live value into the active tab's state.

The two effects are colocated (in the same hook file) and use the same Zustand subscribe API, but they are distinct effects with distinct triggers (active id change vs. live store change). A reader of the code can see the two effects and understand: "the rehydration is 'when the user switches tabs, the new tab's state goes into the live store'; the mirror-back is 'when the user clicks something, the live store change goes into the persisted state'". The two effects are the "two views of the same data" pattern in its most explicit form.

### D2. The user click handlers don't know about the persisted state

The user click handlers — `toggle`, `select`, `openFile`, `closeTab`, `activate` — are unchanged from M6a. They call the live store's `set*` actions, exactly as they did in M6a. The handlers do not import `useWorkspaceStore`; the handlers do not call `setTabState`; the handlers do not know that the persisted state exists.

The benefit is that the user click handlers are *simple*. A handler is "read the click, mutate the live store, done". The mirror-back is a concern of the hook, not the handler. A new contributor adding a new click handler doesn't have to remember "and also update the persisted state" — the mirror-back effect fires automatically on the live store change.

The cost is that the user click handlers are *implicit* about the persistence. A reader of the handler has to know "the live store change is mirrored back to the persisted state by an effect in the same hook file" — the persistence is not visible in the handler's body. The implicit persistence is documented in the handler's JSDoc (e.g. `/** Toggle the expansion state of a directory row. Persists to the active tab's `state.expandedDirs` via the mirror-back effect in `useFileTree`. */`), and the implicit persistence is testable (a test that toggles a row, then reads `useWorkspaceStore.getState().workspaces[…].state.expandedDirs`, sees the toggle reflected).

The trade-off is "explicit but verbose" (option 1: every handler calls both stores) vs. "implicit but simple" (option 2: every handler calls one store, the mirror-back is a separate effect). The implicit-but-simple model is selected because the verbose model has too many "and also update the persisted state" calls in the handlers, and the implicit-but-simple model is well-understood (it's the same pattern as the localStorage write-through middleware that's been in the codebase since v1).

### D3. The mirror-back is synchronous within one tick

The mirror-back effect fires on the *next microtask* after the live store change, not synchronously inside the live store's `set` call. The next-microtask timing is the Zustand subscribe API's default — `subscribe((state, prev) => { ... })` fires after React's render cycle, not inside it.

The benefit is that the mirror-back doesn't cause an extra render. The user click handler calls `useFileTreeStore.toggle(...)` → the live store updates → React schedules a re-render → the re-render happens → the subscribe callback fires → the persisted state updates → the localStorage write happens. The user sees the click reflected in the UI on the first re-render; the persistence happens on the next microtask, after the user has already seen the change.

The cost is that the mirror-back is *one microtask behind*. A user who clicks a directory, then immediately closes the app (within one microsecond), could see the click un-persisted. In practice, the gap is microseconds, and the next "user gesture" (mouse, keyboard) is enough to fire the microtask — but a user who closes the app within one microsecond of a click would lose the click. This is the same risk as any "save on mutation" model, and it's acceptable for this UX.

The alternative is a synchronous mirror-back (the subscribe callback fires inside the `set` call, before React's render). The synchronous model is faster (no microtask gap), but it has two issues: (a) the subscribe callback's setTabState call could trigger another subscribe callback (if setTabState changes the live store, which it doesn't — but the risk is real), and (b) the synchronous model makes the mirror-back a "primary write to A, side effect to B" pattern (option 1), which is the model this ADR is moving away from. The next-microtask model is selected.

### D4. The mirror-back is "always push the current live state, never compute a diff"

The mirror-back effect's body is `useWorkspaceStore.setTabState(activeId, { expandedDirs: state.expandedDirs, selectedPath: state.selectedPath })` — a *full push* of the current live state, not a *computed diff* of "what changed since the last mirror-back". The full-push model is simpler (the effect's body is "read the live state, push it into the persisted state, done") and is correct (the persisted state is always equal to the live state, modulo the one-microtask gap).

The alternative is a "compute the diff" model: the effect subscribes to the live store, computes "what changed since the last push" (e.g. `state.expandedDirs.symmetricDifference(prev.expandedDirs)`), and pushes only the diff (`setTabState(activeId, { expandedDirs: nextExpandedDirs })` with the new set, not the old set). The diff model is faster (less data to push through Zustand and into localStorage), but it has two issues: (a) the diff is computed inside the subscribe callback, which fires after the live store has already changed — the "diff" is "the current state minus the previous state", and the "current state" is the new value, so the diff is just "set the field to the new value" — the diff is a no-op, (b) the diff model is harder to test (the test has to assert on the diff, not on the value).

The full-push model is selected. The cost (more data to push through Zustand and into localStorage) is negligible — the persisted state is a small object (a few paths, a few booleans), and the localStorage write is O(state size), which is O(few paths). The benefit (simpler effect, simpler test) is significant.

### D5. The mirror-back handles the "tab switched, live store is being rehydrated" race

The mirror-back and the rehydration are two effects that both touch the live store and the persisted state. The rehydration *pushes* the new tab's persisted state into the live store. The mirror-back *observes* the live store change and pushes the new live state into the persisted state. The two effects can race: the rehydration is in the middle of pushing state into the live store (a series of `setExpandedAndSelected` / `replaceAll` calls), and the mirror-back observes one of those calls and pushes the *partial* state back into the persisted state (overwriting the new tab's persisted state with a partial live state).

The fix is a "is the rehydration in progress?" flag. The rehydration effect sets a flag (`isRehydratingRef.current = true`) at the start, runs the live store updates, then clears the flag (`isRehydratingRef.current = false`). The mirror-back effect checks the flag at the start: if the flag is set, the mirror-back skips the push (the rehydration is in progress, the live store is being updated *by the rehydration*, the mirror-back should not overwrite the persisted state with the partial live state). The flag is a `useRef` (not a `useState`) because the flag is not part of the render — it's a "this effect is in progress" marker, owned by the effect.

The flag is a small piece of imperative state in a hook that's otherwise pure-declarative. The flag is justified because the alternative — a "is the live store change from the rehydration or from the user?" check in the mirror-back — requires the rehydration to set a "this update is from the rehydration" marker on the live store's state, which is a mutation of the live store's shape (an extra `__rehydrating: true` field), which is a much bigger change than a `useRef` in the hook. The `useRef` is the minimal change.

The flag is also documented: the rehydration effect's JSDoc says "sets `isRehydratingRef.current = true` for the duration of the rehydration; the mirror-back effect checks the flag and skips the push if the flag is set". A reader of the code can see the flag and understand: "this is a 'rehydration in progress' marker, the mirror-back respects it".

## Consequences

### Positive

- **The user click handlers are simple.** A handler is "read the click, mutate the live store, done". The handler doesn't import `useWorkspaceStore`, doesn't call `setTabState`, doesn't know about the persisted state. A new contributor adding a new click handler doesn't have to remember "and also update the persisted state" — the mirror-back effect fires automatically.
- **The mirror-back is automatic.** Every live store change is mirrored back to the persisted state, with no "save" button, no debounce, no reload. The user sees the click reflected in the UI on the first re-render; the persistence happens on the next microtask.
- **The two live stores are unchanged in shape.** The mirror-back is owned by the two hook files, not by the live stores. The live stores are still single-purpose, single-source-of-truth, easy-to-test. The mirror-back is an *external* concern, owned by the hooks that bridge the live stores and the persisted state.
- **The persisted state is always in sync (modulo the one-microtask gap).** The mirror-back is a "live store changed → persisted state updated" effect, fired on every change. The user clicks, the live store changes, the mirror-back fires, the persisted state updates, the localStorage writes. The persisted state matches the live state within one tick.
- **The pre-M6b pattern is preserved.** The M6b mirror-back is a generalisation of the pre-M6b localStorage write-through middleware — the "live store is the source, the storage is a shadow" pattern, but now the storage is a `WorkspaceTab.state` field rather than a localStorage key. The pre-M6b pattern is well-understood (it's been in the codebase since v1), and the M6b generalisation is a "swap the storage target" refactor, not a redesign.

### Negative

- **The mirror-back is one microtask behind.** A user who clicks a directory, then closes the app within one microsecond, could see the click un-persisted. The risk is negligible in practice (the gap is microseconds, and any user gesture fires the microtask), but it's a real risk for a "close immediately after click" pattern. The alternative is a synchronous mirror-back, which is faster but introduces option-1-style side-effect issues (see D3).
- **The `isRehydratingRef` is a small piece of imperative state.** The flag is justified (see D5), but it's a deviation from the "the hook is pure-declarative" pattern. The flag is documented (the rehydration effect's JSDoc), and the flag is tested (a test that switches tabs and asserts on the persisted state after the switch sees the *new* tab's state, not a partial live state). The test is the safety net.
- **The mirror-back is a "live store → persisted state" only direction.** The persisted state cannot push back into the live store directly (the rehydration is the only "persisted state → live store" path, and it only fires on tab switch). A user who manually edits the localStorage to set `selectedPath` will not see the live store update until the next tab switch. This is fine for the current use case (the localStorage is not user-editable in the UI), but a future "import a settings file that changes per-tab state" feature would need a "trigger a rehydration for the active tab" API. The "import" feature is in the M6b scope, and the import uses the rehydration effect — the apply function calls a "force rehydration for the new active tab" action, which is the "trigger a rehydration" API. The API is the existing rehydration effect, with an explicit "the active tab's state has changed externally, rehydrate" trigger.
- **The mirror-back pushes the full live state, not a diff.** The full-push model is simpler (see D4) but pushes more data through Zustand and into localStorage. The cost is negligible (the persisted state is small), but the full-push model is a "read all the live state, write all the persisted state" pattern, which is O(state size) on every change. A future "very large workspace with thousands of expanded directories" optimisation would push only the diff — but M6b's four fields are all "list of paths" or "single path" data, and the lists are small (a user rarely has more than 20 expanded directories in a tree, 10 open editor tabs, etc.). The full-push is fine for M6b.

## Implementation notes

- The mirror-back effect uses `useLiveStore.subscribe` (Zustand's native subscribe API). The subscribe callback's signature is `(state, prev) => void`. The callback is "read the relevant field(s) from the new state, push them into the active tab's `state` via `useWorkspaceStore.setTabState(activeId, partial)`". The callback is intentionally not a "compute the diff" callback (see D4) — it's a "read the new state, push it" callback.
- The mirror-back effect is *not* a "fire on every change" callback. The effect's body is wrapped in a "should I push?" check: `if (state.field !== prev.field) useWorkspaceStore.setTabState(activeId, { field: state.field })`. The check is the diff-by-equality: if the field didn't change, the push is a no-op. The check is cheap (a single reference equality check, no deep equality) and avoids the "push the same value to the persisted state" overhead.
- The `isRehydratingRef` is a `useRef<boolean>(false)` in the hook. The rehydration effect sets the ref to `true` at the start (before the live store updates), runs the live store updates, then sets the ref to `false` (in a `try/finally` to ensure the ref is cleared even if the live store updates throw). The mirror-back effect checks the ref at the start: if the ref is `true`, the mirror-back returns early (the rehydration is in progress, the live store is being updated *by the rehydration*, the mirror-back should not push). The ref is not part of the render (it's a `useRef`, not a `useState`), so changing the ref does not trigger a re-render.
- The mirror-back effect's "what to push" is `setTabState(activeId, { expandedDirs, selectedPath })` for the file tree and `setTabState(activeId, { openEditorTabPaths, activeEditorTabPath })` for the editor tabs. The two effects push *only* the fields they own — the file-tree effect pushes the file-tree fields, the editor-tabs effect pushes the editor-tabs fields. The two effects don't overlap (the file-tree effect doesn't push `openEditorTabPaths`, the editor-tabs effect doesn't push `expandedDirs`).
- The mirror-back effect's "read the active tab's id" is `useWorkspaceStore.getState().activeId` — a synchronous read of the current active tab's id. The id is read inside the subscribe callback (not captured at subscribe time) so the mirror-back always uses the *current* active tab, not the active tab at subscribe time. A user who switches tabs while the mirror-back is in flight will see the push go to the *new* active tab, not the old one — this is the correct behaviour (the live store is the new tab's live state, the persisted state should be the new tab's persisted state).

## References

- `src/shared/state/workspaceStore.ts` — the `setTabState` action
- `src/screens/EditorWorkspace/state/fileTreeStore.ts` — the live file-tree state
- `src/screens/EditorWorkspace/state/editorTabsStore.ts` — the live editor-tabs state
- `src/screens/EditorWorkspace/hooks/useFileTree.ts` — the mirror-back effect for the file tree
- `src/screens/EditorWorkspace/hooks/useEditorTabs.ts` — the mirror-back effect for the editor tabs
- `src/shared/state/workspaceStore.test.ts` — the per-tab state + persistence tests
- `HANDOFF.md §9.23` — the M6b per-phase writeup
- `CHANGELOG.md` "Added (M6b — Per-tab state keying + v4 settings export / import)" — the user-facing summary
- `docs/decisions/0081-m6b-persisted-state-on-tab.md` — the `WorkspaceTab.state` data model
- `docs/decisions/0082-m6b-v4-export-v3-migration.md` — the v4 export shape + v3 → v4 import migration
- `docs/decisions/0084-m6b-format-version-separation.md` — the `format` / `version` separation + the deep-clone snapshot

---

*Last touched: M6b (June 2026). See `CHANGELOG.md` "Unreleased" for the user-facing summary.*
