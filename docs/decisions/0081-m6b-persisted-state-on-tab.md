# ADR #81 — M6b: `WorkspaceTab.state` is the persisted source of truth for per-tab UI state; live stores are transient views synced via mirror-back

**Date**: June 2026
**Phase**: M6b (Per-tab state keying + v4 settings export / import)
**Status**: Accepted
**Supersedes**: n/a (M6a had a flat per-store global state — `useFileTreeStore.expandedDirs` and `useEditorTabsStore.tabs` were the only state; the M6b "persisted on the tab" model is the first place we have per-tab state)
**Deciders**: project lead (Vimal Nair)

## Context

M6a shipped multi-workspace tabs as a data model + tab strip. M6a is a *narrow* data model: each tab is `{ id, path, addedAt }` — the tab identifies the workspace folder, and the file-tree + editor state are stored in the *live* Zustand stores (`useFileTreeStore.expandedDirs`, `useEditorTabsStore.tabs`), not on the tab. The live stores are global (one `expandedDirs` set, one `tabs` record) — when the user switches tabs, the file-tree hook re-roots to the new path (so the rows in the tree change) and the editor-tabs hook loads the new file's content, but the *expansion state* and the *open editor tabs* are not keyed per tab.

The result: a user who expands `src/components/` in tab A, switches to tab B, expands `tests/`, switches back to tab A, sees `src/components/` collapsed. The expansion state "leaked" from tab B to tab A. Worse, if the user closes a tab without re-activating it (e.g. closes the active tab while two tabs are open, the surviving tab's `expandedDirs` are now the ones from the just-closed tab's last-viewed path), the expansion state can be wrong *while the surviving tab is the active one*. The pre-M6a "single workspace" model hid this bug (there was only one workspace, so there was only one expansion set); M6a exposed it.

The architectural question is: where does the per-tab UI state live? Three options were considered.

The two stores (file tree, editor tabs) are also the *only* state that varies per tab — the recents list, the voice preferences, the tool settings, the theme are global (one per user, not one per tab). The M6b "per-tab state" model is specifically about the two stores.

## The options considered

1. **State on the live stores, "save" on tab switch.** The two live stores are unchanged. When the user switches tabs, the current values are saved to a "last-known per-tab" cache, the new tab's cached values are loaded, and the live stores are replaced. The cache is persisted to localStorage. Selected against: the cache and the live stores are two sources of truth for the same data, and a "save on tab switch" design has a stale-write window (if the user switches tabs fast — e.g. clicks three tabs in quick succession — the third tab's "load" runs before the first tab's "save" finishes, and the first tab's state is lost). The bug is fixable with a write-through cache, but the cache is a new concept (the live stores have to know about it) and the cache's "which tab am I the saved state for" keying is exactly the per-tab keying we're trying to design.

2. **State on the live stores, autosave on every mutation.** The two live stores are unchanged. Every mutation (`toggle`, `select`, `openFile`, `closeTab`, `activate`) also writes to a "per-tab state" map keyed by `tabId`. When the user switches tabs, the new tab's values are loaded from the map. The map is persisted to localStorage. Selected against: this is option 1 with a write-through cache, but the cache is now *in the same store* as the live values (or a sibling store with a "currentTabId" pointer). The two-source-of-truth problem is gone, but the per-tab map has to be loaded on app boot (hydrate from localStorage) and reconciled with the live stores' initial state — the two stores need a "what's the initial expandedDirs / tabs for this tab?" question answered at boot, and the answer is "read from the per-tab map, but if the map is empty, use the store's existing initial state". The reconciliation is non-trivial, and the live stores have to grow a "subscribe to a per-tab map" pattern that's not idiomatic for Zustand.

3. **State on the `WorkspaceTab`, live stores are transient views.** The new `WorkspaceTab.state: WorkspaceTabState` field is the *persisted source of truth*. The two live stores are unchanged in shape (they still hold `expandedDirs` and `tabs`), but they are now the *transient view* of the active tab's state. Two `useEffect` hooks (one in `useFileTree`, one in `useEditorTabs`) own the synchronisation: a "tab switch rehydration" effect reads the new active tab's `state` and pushes it into the live stores, and a "mutation mirror-back" effect subscribes to the live stores' changes and pushes the new live values back into the active tab's `state` via `useWorkspaceStore.setTabState(tabId, partial)`. The user interactions only ever flow into the live stores; the persisted state is the *destination* of the mirror-back, not the source. Selected.

## Decision

### D1. `WorkspaceTab.state` is the persisted source of truth

The new `WorkspaceTab.state: WorkspaceTabState` field is the canonical, persisted record of a tab's UI state. The four fields (`expandedDirs`, `selectedPath`, `openEditorTabPaths`, `activeEditorTabPath`) are the minimum set of "the user came back to this tab and the view is exactly how they left it". The four are deliberately the minimum — per-tab scroll position, per-tab font size, per-tab theme, per-tab recents, per-tab git / tool / voice settings are all parked in M6c (see Decision #81 follow-up note). The `WorkspaceTabState` interface and the `EMPTY_TAB_STATE` constant are exported from `workspaceStore.ts`.

The `state` field is on the `WorkspaceTab` (not on the `WorkspaceState`), so each tab has its own `state` and switching tabs swaps the entire `state` record. The `workspaces: WorkspaceTab[]` array is the "list of tabs, each with their own state"; the `useWorkspaceStore` is the "container of the list". The two live stores (`useFileTreeStore`, `useEditorTabsStore`) do not know about tabs — they hold the active tab's state, full stop.

The `hydrate` step is defensive about pre-M6b tabs persisted under the v2 key: any tab row that lacks a `state` field (or has a partial / corrupt one) is normalised to `EMPTY_TAB_STATE` on read. The three shape fields (`id`, `path`, `addedAt`) are still strictly validated — only the new `state` field is permissive. The pre-M6a binary is still able to read the v2 key (it sees the v2 shape, the `state` field is extra data that the pre-M6a binary ignores); the M6b binary is able to read both the v2-pre-M6b shape (defensively normalises) and the v2-M6b shape (uses the `state` field directly).

### D2. The two live stores are transient views

`useFileTreeStore.expandedDirs` and `useEditorTabsStore.tabs` are the *transient view* of the active tab's state, not the source of truth. The two stores are unchanged in shape (no new fields), and they continue to be the "what does the file tree / editor render right now" data. The two stores do not know about tabs — they are unaware that the data came from a `WorkspaceTab.state` record.

The benefit of the transient-view model is that the two stores are still simple, single-purpose stores. The file-tree store is "the current view of the file tree" — same as pre-M6b. The editor-tabs store is "the current open editor tabs" — same as pre-M6b. The "per-tab" keying is an external concern, owned by `useFileTree` and `useEditorTabs` (the two hook files that already bridge `useWorkspaceStore` and the two live stores).

The two new actions — `setExpandedAndSelected` on `useFileTreeStore` and `replaceAll` on `useEditorTabsStore` — are the *batch replacement* APIs that the rehydration effects use to swap the live state in one store update (rather than `setExpanded` per row + `setSelected` + ...). The actions are "replace the live values", not "merge" — the rehydration is a full swap, not an additive update.

### D3. Two `useEffect` hooks own the synchronisation

`useFileTree.ts` and `useEditorTabs.ts` each grow two `useEffect` hooks:

1. **Tab switch rehydration.** The effect subscribes to `useWorkspaceStore` and, on every change to the active tab's id, reads the new active tab's `state` and pushes it into the respective live store. For the file tree, the push is `useFileTreeStore.setExpandedAndSelected(state.expandedDirs, state.selectedPath)`. For the editor tabs, the push is `useEditorTabsStore.replaceAll(state.openEditorTabPaths, tabs, state.activeEditorTabPath)` (plus a re-read of each file's content from disk — the persisted state holds only the path, not the file content, so the editor's contents are guaranteed to be fresh).

2. **Mutation mirror-back.** The effect subscribes to the live store's changes (via `useFileTreeStore.subscribe` / `useEditorTabsStore.subscribe`) and, on every change, pushes the new live values into the active tab's `state` via `useWorkspaceStore.setTabState(tabId, partial)`. The mirror-back is intentionally one-way: the live store is the *source* of the mirror-back (it changed), the persisted state is the *destination* (it gets updated to match).

The two effects are colocated with their respective live store, not in `useWorkspaceStore`. The mirror-back is a "this live store mirrors to this persisted field" concern; it lives in the hook that owns the live store. `useWorkspaceStore` knows nothing about the live stores; the live stores know nothing about the persisted state. The "two views of the same data" pattern is owned by the two hook files.

The actions the mirror-back uses are `useWorkspaceStore.setTabState(tabId, partial)` (a *partial merge* — the live store sends only the changed fields, the persisted state merges them) and `useWorkspaceStore.replaceTabState(tabId, state)` (a *full replace* — used by the rehydration effects when the new active tab's state should overwrite the previous tab's mirror-back). The two actions are intentionally distinct: a partial merge is a "live state mutation" (the persisted state is updated to match the live state), a full replace is a "tab switch" (the persisted state is wholesale replaced by the new tab's saved state).

### D4. User interactions only ever flow into the live store

The two `useEffect` hooks in `useFileTree` and `useEditorTabs` that fire on user clicks (`toggle`, `select`, `openFile`, `closeTab`, `activate`) are unchanged from M6a — they call the live store's `set*` actions, not `useWorkspaceStore.setTabState`. The user clicks *do not* go through `useWorkspaceStore` first; they go through the live store, and the mirror-back effect *observes* the live store change and updates the persisted state. The benefit is that the user-facing click handlers don't need to know about the persisted state — they continue to call `useFileTreeStore.toggle(...)` and `useEditorTabsStore.openFile(...)`, the same APIs as M6a.

The persistence is "passive" — it doesn't intercept the user interactions, it observes them. The observation is synchronous (the mirror-back effect fires on the next microtask after the live store change), so the persisted state is always in sync with the live state within one tick. There is no debounce, no save-on-close, no "I switched tabs and lost my last click" race. The only async surface is the editor file content re-read on tab switch (the file content is not in the persisted state), which is the same async read that's been there since M2a.

### D5. The four fields are the minimum; per-tab polish is M6c

The four fields are deliberately the minimum set of "this tab should look how I left it" fields. The following fields were considered and parked in M6c:

- **Per-tab scroll position.** The file tree's vertical scroll position and the editor's vertical scroll position. A user who scrolls deep in tab A, switches to tab B, scrolls deeper, switches back, would expect the scroll to be at A's saved position. Parked: the editor's scroll is owned by Monaco (per-editor `model`), and the file tree's scroll is owned by `FileTreePane`'s scroll container — both are not currently part of any store, and adding them requires a "scroll on mount" effect in both components. M6b ships without per-tab scroll; the user gets "tab switches re-root the file tree" and "tab switches re-read editor contents", but the scroll resets to the top. M6c will add the scroll to `WorkspaceTabState` and the mirror-back effect in both components.

- **Per-tab font size.** The editor's font size. A user who wants 14px in tab A and 18px in tab B (e.g. for a small data file in tab A and a long code file in tab B) would expect the font size to switch. Parked: the font size is a global setting (in `settingsStore` / `useEditorSettingsStore`), and per-tab font size requires either a per-Model Monaco option or a per-tab Monaco instance. M6b ships global font size; M6c will add per-tab.

- **Per-tab theme.** The editor's theme. A user who wants light in tab A and dark in tab B would expect the theme to switch. Parked: same as font size — the theme is global, and per-tab theme requires per-tab Monaco. M6b ships global theme; M6c will add per-tab.

- **Per-tab recents.** The recents list is currently global (one `recents: string[]` array in `useWorkspaceStore`). Per-tab recents would be "the paths I've recently opened in *this* tab". Parked: the M6a decision was that recents are global, and M6b doesn't widen the recents model. M6c will revisit.

- **Per-tab git / tool / voice settings.** The git repo (or "is this a git repo?"), the tool confirmation mode (always_confirm / on_demand), and the voice provider (wispr / stub). Parked: these are per-workspace-user settings, not per-tab-UI settings. M6b doesn't widen the settings model; M6c will revisit.

The four fields M6b ships are the *four that don't require a component or store change to mount* — they're all "list of paths" or "single path" data, and the mirror-back is "set the field in the persisted state, push it into the live store, done". The five parked fields all require either a Monaco-level change (font size, theme, scroll) or a wider decision (recents, settings). The M6b "minimum" is what fits in a single sync pass; the M6c "polish" is what requires per-feature design.

## Consequences

### Positive

- **Simplicity.** The two live stores are unchanged in shape; the "per-tab keying" is a concern of the two hook files, not the stores. The stores continue to be single-purpose, single-source-of-truth, easy-to-test.
- **No race conditions.** The mirror-back is a "live store → persisted state" effect, fired on every change. The rehydration is a "new active tab's state → live store" effect, fired on every active-id change. The two effects are colocated and the user interactions only ever flow into the live store, so there is no "which one is the source of truth at this moment" question.
- **The persisted state is always in sync.** The mirror-back is synchronous (the effect fires on the next microtask after the live store change), so the persisted state matches the live state within one tick. A user who closes the app immediately after clicking a directory will see the click persisted.
- **The M6a data model is unchanged for non-per-tab state.** The recents list, the active id, the workspace list shape, the `id` / `path` / `addedAt` fields are all unchanged. The M6b addition is purely the new `state` field; the rest of the store is M6a's store.
- **Backwards compatibility is defensive.** A pre-M6b binary reading the v2 key sees the extra `state` field as unknown data and ignores it. An M6b binary reading a v2-pre-M6b shape (no `state` field) defensively normalises to `EMPTY_TAB_STATE`. A user with both binaries side-by-side will not see a "selected row is `undefined`" crash.

### Negative

- **The mirror-back is "live store → persisted state" only.** The mirror-back is a one-way flow; the persisted state cannot push back into the live store directly. The rehydration effect handles the "persisted state → live store" path (on tab switch), but only on tab switch — there is no "external mutation of the persisted state" path. A user who manually edits the localStorage to set `selectedPath` will not see the live store update until the next tab switch. This is fine for the current use case (the localStorage is not user-editable in the UI), but a future "import a settings file that changes per-tab state" feature would need a "trigger a rehydration for the active tab" API.
- **The mirror-back is one tick behind.** The mirror-back effect fires on the next microtask after the live store change, not synchronously inside the same render. A user who clicks a directory, then closes the app, then opens it again *might* see the click un-persisted (the app close fires before the microtask runs). In practice, the gap is microseconds, and the next "user gesture" (mouse, keyboard) is enough to fire the microtask — but a user who closes the app within one microsecond of a click would lose the click. This is the same risk as any "save on mutation" model, and it's acceptable for this UX.
- **The four fields are a moving target.** M6c will add at least five more fields, and each addition requires a "synthesise a default for old tabs" decision. The hydrate step is now responsible for "any tab that doesn't have field X, set X to its default" for every field in `WorkspaceTabState`. The pattern is "validate, fall back to default, don't drop the tab" — the same pattern as the v1 → v2 in-store migration, applied at the per-field granularity. The pattern is well-understood (Decision #79), but each new field is a new test case in the workspace store's hydrate test.

## Implementation notes

- The `WorkspaceTabState` interface and the `EMPTY_TAB_STATE` constant are exported from `workspaceStore.ts` (Decision #82's v4 export shape re-exports them). The interface is intentionally a plain object (no class, no Map) — it has to be JSON-serialisable for the localStorage writeJson helper and the v4 export.
- The two `useEffect` hooks in `useFileTree` and `useEditorTabs` use `useWorkspaceStore.subscribe((state, prev) => { ... })` for the rehydration (fires on `activeId` change) and `useFileTreeStore.subscribe((state, prev) => { ... })` / `useEditorTabsStore.subscribe((state, prev) => { ... })` for the mirror-back (fires on any live store change). The Zustand `subscribe` API takes a `(state, prev) => void` selector and is the canonical way to react to store changes in a hook. The subscribe returns an unsubscribe function, which the effect returns from its cleanup phase.
- The `setTabState` action is a partial merge: `set((state) => ({ workspaces: state.workspaces.map((w) => w.id === tabId ? { ...w, state: { ...w.state, ...partial } } : w) }))`. The `replaceTabState` action is a full replace: `set((state) => ({ workspaces: state.workspaces.map((w) => w.id === tabId ? { ...w, state } : w) }))`. Both actions are no-ops if `tabId` is not found in `workspaces` (the `map` returns the original array element unchanged).
- The editor-tabs rehydration reads file content from disk via the existing `readFile` IPC command (`useEditorTabsStore.openFile(path)` opens a file and reads it). The rehydration effect loops over `state.openEditorTabPaths` and calls `openFile(path)` for each, then `activate(state.activeEditorTabPath)` to set the active tab. The order matters: `openFile` adds to the live store, `activate` sets the active one. The effect is idempotent — re-running on the same state is a no-op (the same paths are opened, the same activation is set).
- The file-tree rehydration uses `setExpandedAndSelected(state.expandedDirs, state.selectedPath)`. The effect does *not* call `setRoot` — the file tree's root is the active tab's path, and the root is set by the M6a `useEffect` in `useFileTree` that subscribes to the active path (the "M6a file tree reactivity" section in the CHANGELOG). The rehydration only sets the expansion + selection within the already-rooted tree.

## References

- `src/shared/state/workspaceStore.ts` — the `WorkspaceTabState` interface, `EMPTY_TAB_STATE`, `setTabState`, `replaceTabState`, `useActiveTabState`
- `src/screens/EditorWorkspace/state/fileTreeStore.ts` — the `setExpandedAndSelected` action
- `src/screens/EditorWorkspace/state/editorTabsStore.ts` — the `replaceAll` action
- `src/screens/EditorWorkspace/hooks/useFileTree.ts` — the rehydration + mirror-back `useEffect` hooks
- `src/screens/EditorWorkspace/hooks/useEditorTabs.ts` — the rehydration + mirror-back `useEffect` hooks
- `src/shared/state/workspaceStore.test.ts` — the per-tab state + persistence tests
- `src/screens/SettingsProvider/components/PrivacyDataCard.tsx` — the v4 export/import UI
- `HANDOFF.md §9.23` — the M6b per-phase writeup
- `CHANGELOG.md` "Added (M6b — Per-tab state keying + v4 settings export / import)" — the user-facing summary
- `docs/decisions/0082-m6b-v4-export-v3-migration.md` — the v4 export shape + v3 → v4 import migration
- `docs/decisions/0083-m6b-mirror-back-one-way.md` — the mirror-back direction (this ADR's D4)
- `docs/decisions/0084-m6b-format-version-separation.md` — the `format` / `version` separation + the deep-clone snapshot

---

*Last touched: M6b (June 2026). See `CHANGELOG.md` "Unreleased" for the user-facing summary.*
