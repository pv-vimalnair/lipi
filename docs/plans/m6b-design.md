# M6b — Per-tab state keying + v4 settings export/import (design)

**Date**: June 2026
**Phase**: M6b
**Status**: Design (accepted for implementation; **superseded by M6c** — see below)
**Supersedes**: the M6a v2 export format (which only had `currentPath` + `recents`)

> **Superseded by M6c** (`docs/superpowers/specs/2026-06-16-m6c-per-tab-state-design.md`).
> M6c extends `WorkspaceTabState` with `editorCursorByPath` + `fileTreeScrollAnchor`
> and bumps the settings export/import format from v4 to v5. The M6b non-goals list
> (per-tab font / theme / recents / tool / voice / git / search settings) is still
> authoritative; M6c is the minimal slice that picks up the scroll/cursor items.

## Goal

Extend the M6a multi-workspace tabs model so each tab remembers its own
file tree expansion / selection / open editor tabs / active editor tab
when the user switches between tabs. Also extend the v3 settings
export/import format to a v4 format that includes the per-tab state, and
ship a v3 → v4 import migration that wraps the old `currentPath` in a
single `WorkspaceTab` with empty per-tab state.

## Non-goals (M6b explicitly does not do)

- **Scroll position persistence.** The file tree and Monaco editor
  scroll positions are ephemeral UI state. Restoring them across a
  relaunch is a polish (M6c or later); M6b focuses on the structured
  "which files are open" and "which dirs are expanded" state.
- **Per-tab font size / theme / accessibility prefs.** These remain
  global per the SettingsProvider design. Per-tab font-size is a
  "different user, same workspace" feature and is not on the M6b
  roadmap.
- **Per-tab recents.** The recents list is a single global history of
  recently-opened workspaces. Per-workspace recents (e.g. "files
  recently opened in *this* workspace") is a future polish; M6b keeps
  recents global.
- **Per-tab tool / voice / git / search settings.** Tool policies and
  voice STT provider are user-global (the S2 / S3 v3 design). Git
  status follows the active workspace via the `useGitStatus.openRoot`
  wiring; it's a per-workspace fetch, not a per-tab state.

## The data model extension

### What goes on the `WorkspaceTab.state`

The pre-M6b `WorkspaceTab`:

```ts
interface WorkspaceTab {
  id: string;       // crypto.randomUUID()
  path: string;     // absolute folder path
  addedAt: number;  // Date.now()
}
```

M6b extends it to:

```ts
interface WorkspaceTabState {
  /** Directories the user has expanded in the file tree, as
   *  full absolute paths. Stored as a sorted array (not a
   *  Set) so it serialises cleanly to JSON. */
  expandedDirs: string[];
  /** Currently selected entry in the file tree (file or
   *  directory). `null` if nothing is selected. */
  selectedPath: string | null;
  /** File paths of the open editor tabs, in tab-strip order
   *  (left to right). Empty array if no editor tabs are open. */
  openEditorTabPaths: string[];
  /** The file path of the currently active editor tab, or
   *  `null` if no editor tab is active. */
  activeEditorTabPath: string | null;
}

interface WorkspaceTab {
  id: string;
  path: string;
  addedAt: number;
  state: WorkspaceTabState;  // NEW in M6b
}
```

The `state` field is always present (no `?:`) so consumers don't need
null-handling. On first M6b hydrate (no `state` field on a tab from a
pre-M6b install), the migration code synthesises an empty
`WorkspaceTabState` for each tab.

### What stays in the live (NOT-persisted) stores

The `useFileTreeStore` and `useEditorTabsStore` keep their existing
shapes but become "views" over the active tab's `state`. The live
stores are the source of truth for *during a session*; the persisted
`tab.state` field is the source of truth for *across sessions* (via
the `lipi:workspace:workspaces:v1` `localStorage` key).

- `useFileTreeStore.entriesByDir` — **stays global** (it's a per-path
  IPC cache, not per-tab state). Switching tabs doesn't drop the
  cache; if the user re-opens a previously-visited path, the cached
  entries are still there.
- `useFileTreeStore.expanded` / `useFileTreeStore.selectedPath` /
  `useFileTreeStore.rootPath` — **become views** over the active
  tab's `state.expandedDirs` / `state.selectedPath` / the tab's
  `path`. When the active tab changes, these are re-populated from
  the new tab's `state`.
- `useEditorTabsStore.tabs` / `useEditorTabsStore.order` /
  `useEditorTabsStore.activeId` — **become views** over the active
  tab's `state.openEditorTabPaths` / `activeEditorTabPath`. The
  `tabs` map (the `EditorTab` objects with `content`,
  `savedContent`, `load`) is rebuilt on tab switch by re-reading the
  file content from disk via `readFile` (the same path the existing
  `openFile` action takes).

The file tree hook (`useFileTree`) and editor tabs hook
(`useEditorTabs`) gain new "push active tab's state into the live
store" and "mirror live store changes back to the active tab's
state" wiring. The orchestrator is a single `useEffect` in
`useFileTree` that subscribes to `useWorkspaceStore` (already exists
in M6a for the rootPath re-root); we extend it to also push the
expanded / selected / scroll state.

## The v4 export format

The pre-M6b (v3) export:

```ts
interface LipiStateV3 {
  // v3 has no top-level `version` field — the magic
  // string "lipi-state" is the version marker.
  workspace: {
    currentPath: string | null;
    recents: string[];
  };
  voicePreferences: { provider: ...; language: string };
  toolSettings: { disabledToolNames: string[]; confirmationMode: ... };
}
```

M6b v4 export:

```ts
interface LipiStateV4 {
  /** Always 4. New top-level version field — v3 didn't
   *  have one (it used the "lipi-state" magic string as
   *  the version marker). */
  version: 4;
  workspace: {
    /** All open workspace tabs. Empty if no tabs are
     *  open. The `state` field is always present (no
     *  optional chaining needed). */
    workspaces: Array<{
      id: string;
      path: string;
      addedAt: number;
      state: {
        expandedDirs: string[];
        selectedPath: string | null;
        openEditorTabPaths: string[];
        activeEditorTabPath: string | null;
      };
    }>;
    /** The id of the active tab, or `null` if no tabs
     *  are open. */
    activeId: string | null;
    recents: string[];
  };
  voicePreferences: { provider: 'stub' | 'wispr' | 'ondevice' | 'webSpeech'; language: string };
  toolSettings: { disabledToolNames: string[]; confirmationMode: Record<string, 'deny' | 'allow_once' | 'allow_always'> };
}
```

The `currentPath` field is **gone** from the v4 export. The v3
import migration wraps `currentPath` in a single `WorkspaceTab` with
empty per-tab state. v3 exports from a pre-M6b install import into
v4 with the same "one open workspace" shape they had on export.

## The v3 → v4 import migration

The v4 import path handles two shapes:

1. **v4** (the new shape with `version: 4` and `workspace.workspaces[]`):
   use the imported `workspaces` + `activeId` directly, after
   shape-validating each tab's `state` (defensive against partial
   / corrupt data — same pattern as the v1 → v2 in-store migration
   in `workspaceStore`).

2. **v3** (the old shape with `workspace.currentPath` and no `version`):
   wrap the `currentPath` in a single `WorkspaceTab` with empty
   per-tab state, set `activeId` to the new tab's id, and apply.

The detect step is the `version === 4` check. v3 data doesn't have
the `version` field at all (the magic string `"lipi-state"` is the
version marker), so the `version !== 4` branch is the v3 migration
path.

The transactional snapshot + restore pattern from S3 (the v3
import) is preserved in v4: `applyLipiStateV4` does the same
snapshot all three stores → apply each → restore on failure
pattern. The previews (`computeLipiStateImportPreview`) are
extended to surface the per-tab changes (a v3 import into a v4
install will preview as "currentPath: /old/path →
workspaces[0].path: /old/path" so the user sees what they're
applying).

## The in-store persistence (M6b side of the workspace store)

The M6a v2 persistence keys are:

- `lipi:workspace:workspaces:v1` — the tab array
- `lipi:workspace:activeId:v1` — the active tab id
- `lipi:workspace:recents:v1` — the recents list

M6b keeps the same keys — the data model is a strict superset of
M6a, and the v1 → v2 in-store migration from M6a still works for
a user coming from pre-M6a. The new M6b in-store migration is the
"tab has no `state` field" case: on hydrate, if a tab from the v1
key has no `state` field, synthesise an empty `WorkspaceTabState`
for it. After the first M6b hydrate, every tab has a `state`.

The `open()`, `close()`, `setActive()` actions continue to work as
in M6a. The `open()` action's new-tab path now initialises `state`
to an empty `WorkspaceTabState` (not `undefined`). The `close()`
action does not touch `state` (the closed tab's `state` goes away
with the tab; closing is not forgetting — see Decision #80).

The file tree / editor hooks gain a new responsibility: every
mutation to `useFileTreeStore` (or `useEditorTabsStore`) is
mirrored back to the active tab's `state` in the workspace store,
so the persisted `tab.state` is always in sync with the live
view. The mirror uses the workspace store's
`setTabState(tabId, state)` action (a new action in M6b).

## The mirror mechanism

The M6b mirror is a single `useEffect` in each hook:

```ts
// useFileTree.ts (M6b addition)
useEffect(() => {
  // Push the active tab's state into the live store.
  const applyActiveTabState = () => {
    const state = useWorkspaceStore.getState();
    const activeId = state.activeId;
    if (!activeId) return;
    const tab = state.workspaces.find((w) => w.id === activeId);
    if (!tab) return;
    setExpanded(new Set(tab.state.expandedDirs));
    setSelected(tab.state.selectedPath);
  };
  applyActiveTabState();
  return useWorkspaceStore.subscribe(applyActiveTabState);
}, [setExpanded, setSelected]);
```

And the mirror-back is on the file tree store's actions
(`toggleExpanded`, `select`): the actions call the workspace store's
`setTabState(tabId, { ...next, expandedDirs: [...], selectedPath: ... })`
to keep the persisted state in sync.

The same pattern applies to `useEditorTabsStore`: an effect pushes
the active tab's `state.openEditorTabPaths` / `state.activeEditorTabPath`
into the live `order` / `activeId` on tab switch, and the live store's
actions (`upsertTab`, `close`, `activate`) mirror back to the
workspace store.

## The active editor tab rehydration

When the user switches to a tab that has `state.openEditorTabPaths: ['a.ts', 'b.ts']`
and `state.activeEditorTabPath: 'a.ts'`, the M6b orchestrator:

1. Sets `useEditorTabsStore.order` to `['a.ts', 'b.ts']` and
   `activeId` to `'a.ts'`.
2. For each path in `order`, optimistically creates an `EditorTab`
   with `load: { kind: 'loading' }` and dispatches `readFile(path)`
   to populate `content` / `savedContent` / `load`.
3. When the `readFile` resolves, calls `tabFromLoaded(path, loaded)`
   and `upsertTab(...)` to seal the tab with the actual content.
4. If the file no longer exists on disk (the user deleted it
   between sessions), the `readFile` rejects with `FsError { kind:
   'NotFound' }` — the orchestrator surfaces this as a tab with
   `load: { kind: 'error', message: 'NotFound: ...' }` and a
   "file missing" badge. The tab is NOT auto-closed; the user
   decides.

This rehydration is the same path the file tree takes when the user
clicks a file in the tree: `upsertTab({...loading}) → readFile →
tabFromLoaded → upsertTab({...loaded})`. The M6b orchestrator
just calls this in a loop for each path in `order`.

## The persistence file format

The workspace store's persistence keys are unchanged. The tab
serialisation now includes the `state` field:

```json
// localStorage "lipi:workspace:workspaces:v1"
[
  {
    "id": "uuid-1",
    "path": "C:/Users/me/proj1",
    "addedAt": 1718262000000,
    "state": {
      "expandedDirs": ["C:/Users/me/proj1/src", "C:/Users/me/proj1/src/components"],
      "selectedPath": "C:/Users/me/proj1/src/index.ts",
      "openEditorTabPaths": ["C:/Users/me/proj1/src/index.ts", "C:/Users/me/proj1/src/App.tsx"],
      "activeEditorTabPath": "C:/Users/me/proj1/src/index.ts"
    }
  },
  {
    "id": "uuid-2",
    "path": "C:/Users/me/proj2",
    "addedAt": 1718262100000,
    "state": {
      "expandedDirs": [],
      "selectedPath": null,
      "openEditorTabPaths": [],
      "activeEditorTabPath": null
    }
  }
]
```

A pre-M6b tab (no `state` field) is also valid JSON; the M6b
hydrate synthesises an empty `WorkspaceTabState` for it.

## The v4 settings export file format

The exported `lipi-state-v4.json` (the new file extension signals
the v4 format; v3 files were `lipi-state.json`):

```json
{
  "version": 4,
  "workspace": {
    "workspaces": [
      {
        "id": "uuid-1",
        "path": "C:/Users/me/proj1",
        "addedAt": 1718262000000,
        "state": {
          "expandedDirs": [...],
          "selectedPath": "...",
          "openEditorTabPaths": [...],
          "activeEditorTabPath": "..."
        }
      }
    ],
    "activeId": "uuid-1",
    "recents": ["C:/Users/me/proj1", "C:/Users/me/proj2"]
  },
  "voicePreferences": { "provider": "wispr", "language": "en-US" },
  "toolSettings": {
    "disabledToolNames": [],
    "confirmationMode": { "git.commit": "allow_always" }
  }
}
```

The v3 import path detects the missing `version` field (or
`version === 3` for forward compat with any v3 file a user might
manually re-version) and runs the v3 → v4 migration: wrap
`workspace.currentPath` in a single tab with empty per-tab state.

## The command palette (M6b additions)

M6b doesn't add new command palette entries — the existing
`workspace.open` / `workspace.close` / `Open Recent` commands work
as in M6a. M6b's "per-tab state" is implicit in the tab model;
the user doesn't need explicit "remember this tab" / "forget this
tab" actions.

## What ships in this PR

1. **`workspaceStore` extension**:
   - `WorkspaceTab` gets a `state: WorkspaceTabState` field.
   - `createWorkspaceTab(path, id?, addedAt?)` now also initialises
     `state` to an empty `WorkspaceTabState` (or accepts a
     `state` argument for tests / migrations).
   - `hydrate()` adds an in-store migration: any tab without a
     `state` field gets an empty `WorkspaceTabState` (defensive
     against a pre-M6b tab in the v1 `localStorage` key).
   - New action `setTabState(tabId, partial: Partial<WorkspaceTabState>)`
     — the file tree / editor hooks call this to mirror live changes
     back to the persisted state.
   - New action `replaceTabState(tabId, state: WorkspaceTabState)` —
     the file tree / editor hooks call this on tab switch to push
     the new tab's state into the live view.
   - `WorkspaceTabState` type and `EMPTY_TAB_STATE` constant
     exported for tests / migrations.

2. **`useFileTree` mirror**:
   - New `useEffect` in `useFileTree` that subscribes to
     `useWorkspaceStore` and pushes the active tab's
     `state.expandedDirs` / `state.selectedPath` into
     `useFileTreeStore` on tab switch.
   - `useFileTreeStore.toggleExpanded` / `select` actions are
     wrapped in a hook-level orchestrator that mirrors back to
     `useWorkspaceStore.setTabState(...)`. (The store itself stays
     pure; the mirror is in the hook, per Rule 6.)

3. **`useEditorTabs` mirror**:
   - New `useEffect` in `useEditorTabs` (or a new
     `useEditorTabsRehydrate` hook in `hooks/`) that subscribes to
     `useWorkspaceStore` and rehydrates the live `order` / `activeId`
     from the active tab's `state.openEditorTabPaths` /
     `state.activeEditorTabPath`, and re-reads each open file's
     content from disk.
   - The `useEditorTabsStore.upsertTab` / `close` / `activate`
     actions are wrapped in a hook-level orchestrator that mirrors
     back to `useWorkspaceStore.setTabState(...)`.

4. **`settingsIOv4` module**:
   - `src/shared/settingsIOv4.ts` — the v4 schema (TypeScript types
     + JSON shape validators).
   - `src/shared/settingsIOv4.apply.ts` — `applyLipiStateV4(data)`
     that snapshots all three stores, runs the per-store apply
     (workspace, voicePreferences, toolSettings), and restores on
     failure. Handles both v4 (`version: 4`) and v3 (no `version`,
     `currentPath` shape) inputs.
   - `src/shared/settingsIOv4.preview.ts` — the diff preview
     generator. Surfaces per-tab changes (a v3 import into a v4
     install previews as "currentPath: /old → workspaces[0].path:
     /old").
   - `src/shared/settingsIOv4.serialize.ts` — the export writer.
     Writes `{ version: 4, workspace: { workspaces, activeId,
     recents }, voicePreferences, toolSettings }` to a file.
   - `src/shared/settingsIOv4.parse.ts` — the import reader.
     Parses both v3 and v4, returns a v4-normalised shape with a
     `sourceFormat: 'v3' | 'v4'` field for the preview.

5. **`PrivacyDataCard` v4 wiring**:
   - "Export" button calls `writeLipiStateV4()` instead of
     `writeLipiStateV3()`.
   - "Import" file picker calls `parseLipiState(input)` (which
     auto-detects v3 vs v4) and then `applyLipiStateV4(parsed)`
     instead of `applyLipiStateV3()`.
   - The "wrong format" error message is updated to mention v3
     and v4 explicitly.

6. **Tests**:
   - `workspaceStore.test.ts` — 6 new tests for the M6b
     additions: hydrate synthesises empty `state` for pre-M6b tabs;
     `setTabState` updates the right tab; `replaceTabState` is a
     strict replace; `setTabState` on a non-existent tab is a
     no-op; `EMPTY_TAB_STATE` is the canonical empty; new-tab
     initialisation in `open()` uses `EMPTY_TAB_STATE`.
   - `useFileTree.test.ts` (new) — tests the mirror: tab switch
     pushes the new tab's expanded / selected into the file tree
     store; toggle mirrors back to the active tab's state;
     closing the active tab resets the file tree store; switching
     to a tab that has never been visited gets an empty view.
   - `useEditorTabs.test.ts` (new) — tests the mirror: tab switch
     rehydrates the open editor tabs; close mirrors back;
     activate mirrors back; closing a tab that's not in the
     active tab's `state.openEditorTabPaths` doesn't touch the
     persisted state.
   - `settingsIOv4.apply.test.ts` (new) — tests the v3 → v4
     migration, the v4 native import, the transactional
     snapshot / restore, the per-store apply failure paths.
   - `settingsIOv4.preview.test.ts` (new) — tests the per-tab
     preview.
   - `settingsIOv4.serialize.test.ts` (new) — tests the v4
     export shape.
   - `settingsIOv4.parse.test.ts` (new) — tests the v3 vs v4
     detection.

7. **CHANGELOG + HANDOFF + 4 new decisions**:
   - CHANGELOG: new "Added (M6b — per-tab state keying + v4
     settings export/import)" entry.
   - HANDOFF: §6 status line updated, new §9.23, candidate
     unbuilt-phases list updated.
   - Decisions:
     - **#81** — `WorkspaceTab.state` is the canonical per-tab
       state; live stores are a "view" over it.
     - **#82** — File tree and editor tab live stores mirror
       back to the active tab's state on every mutation.
     - **#83** — v4 export format drops `currentPath`; v3
       import wraps it in a single tab with empty state.
     - **#84** — Editor tab content is NOT persisted; only the
       file paths and the active tab are. Re-opening a tab
       re-reads the file from disk.

## Files touched (rough estimate)

- `src/shared/state/workspaceStore.ts` — +50 LoC (state field,
  helpers, setTabState, replaceTabState, hydrate synthesis)
- `src/shared/state/workspaceStore.test.ts` — +6 tests, +~80 LoC
- `src/screens/EditorWorkspace/hooks/useFileTree.ts` — +60 LoC
  (mirror effect, mirror-back orchestrator)
- `src/screens/EditorWorkspace/hooks/useFileTree.test.ts` (new) —
  ~150 LoC, 6-8 tests
- `src/screens/EditorWorkspace/hooks/useEditorTabs.ts` — +50 LoC
  (mirror effect, mirror-back orchestrator, rehydration)
- `src/screens/EditorWorkspace/hooks/useEditorTabs.test.ts` (new)
  — ~150 LoC, 6-8 tests
- `src/shared/settingsIOv4.ts` (new) — ~80 LoC (types + validators)
- `src/shared/settingsIOv4.apply.ts` (new) — ~150 LoC
- `src/shared/settingsIOv4.preview.ts` (new) — ~100 LoC
- `src/shared/settingsIOv4.serialize.ts` (new) — ~50 LoC
- `src/shared/settingsIOv4.parse.ts` (new) — ~80 LoC
- 4 new test files for the IOv4 module — ~300 LoC, 25 tests
- `src/screens/SettingsProvider/components/PrivacyDataCard.tsx` —
  +20 LoC (v4 wiring)
- `src/shared/settingsIOv3.apply.ts` — keep for backward-compat
  reads (if a user opens an old v3 file the v4 apply handles it)
- `src/shared/settingsIOv3.preview.ts` — same
- `src/shared/settingsIOv3.serialize.ts` — same
- `src/shared/settingsIOv3.parse.ts` — same
- `CHANGELOG.md` — new entry, ~150 LoC
- `HANDOFF.md` — §6 + §9.23 + candidate list, ~200 LoC
- 4 new decision files, ~100 LoC each
- `docs/ENGINEERING.md` — update the data-flow section to
  mention the mirror

Total: ~2000-2500 LoC, ~50 new tests. Same shape as M6a in
size.

## Risks

- **R1**: A tab's `state.expandedDirs` is a `string[]` (sorted
  for stable JSON), not a `Set<string>`. The live store uses a
  `Set<string>` for O(1) membership tests. The mirror must
  convert: `new Set(array)` on push, `[...set].sort()` on
  mirror-back. The sort key is platform-independent (we sort
  by full path, which is a `string`). Both directions are
  tested.
- **R2**: The `state.openEditorTabPaths` is an ordered list
  (left to right in the editor tab strip). The live store
  uses `order: string[]` for the same purpose. The mirror
  is a direct array copy — no transformation needed. The
  `activeEditorTabPath` is one of the paths in
  `openEditorTabPaths`, but we persist it separately for
  the "no editor tab is open" case (`activeEditorTabPath:
  null` while `openEditorTabPaths: []`).
- **R3**: When the user closes a tab, the live editor tabs
  store should also close the editor tabs that were in
  that tab's `state.openEditorTabPaths`. M6a's `close(tabId)`
  action is the orchestrator: it calls
  `useWorkspaceStore.setTabState(tabId, prevState)` for each
  tab, then `set({ workspaces: nextWorkspaces })`. The live
  stores see the `activeId` change to a different tab and
  rehydrate from the new active tab's state. The closed
  tab's state is gone with the tab; the live stores don't
  need to be told "close the editor tabs that were in the
  closed tab" because the rehydration on the next active
  change drops the closed tab's editor tabs.
- **R4**: The file tree's `entriesByDir` cache is NOT
  per-tab. After a relaunch, the cache is empty (it was
  rehydrated from `useFileTreeStore` initial state, which
  is `{ entriesByDir: {} }`). The file tree re-loads on
  tab switch via the existing `useFileTree` effect. This
  is the same as the M6a behaviour (re-load on tab
  switch). The "tab switch is fast" UX is preserved by
  caching the entries for paths the user has visited
  during the session (not just the active path's
  expansions).
- **R5**: The v3 → v4 import migration synthesises a
  fresh `id` (UUID) for the wrapped tab. The pre-M6b
  `currentPath` is the only state preserved; the new tab
  has empty per-tab state. A user who imports a v3
  export will see the same "one open workspace" shape
  they had on export, plus the recents list. The
  `recents` field is unchanged from v3.
- **R6**: The `version: 4` field is a strict discriminator
  in the v4 import path. A v3 import has no `version`
  field, so the import path detects it by the absence
  of `version` and runs the v3 migration. A v3 import
  that someone manually added a `version: 3` field to
  is handled the same way (the `version === 4` check
  is the discriminator; anything else is "v3 or
  unknown"). The S3 v3 parser already did this with
  the magic string `"lipi-state"`, but the v4 path
  uses the `version` field directly (cleaner).
- **R7**: A pre-M6b v2 export file (the
  `settingsIOv2.apply.ts` shape) has the same
  `currentPath` + `recents` shape as v3. The v3 → v4
  migration handles both: any input without `version: 4`
  is treated as v3 (or older). The v2 import path
  itself stays in the codebase as a fallback for v2
  files (defensive — a user might have an old v2 file
  on disk).
- **R8**: The M6a v2 export format kept `currentPath`
  in the workspace shape. The M6b v4 export format
  drops it. A user who has a pre-M6b v3 export file
  on disk and tries to import it into a v4 install
  will see the v3 → v4 migration banner ("imported
  as v3; wrapping in a single tab"). The user can
  cancel the import before clicking Apply (the v3 →
  v4 preview is shown). The migration is transparent
  to the user; the workspace they had on export is
  the workspace they have on import.

## Open questions (none blocking — M6b ships without answers)

- **Q1**: Should the file tree's scroll position be
  persisted? (M6b says no; the scroll position is
  ephemeral.) A future polish phase could add a
  "remember last scroll position per directory" feature
  if the user complains.
- **Q2**: Should the editor cursor position be
  persisted per tab? (M6b says no; the file is
  re-read from disk and Monaco defaults to
  `Line 1, Column 1`.) A future polish could store
  `cursor: { line, column }` per tab in
  `WorkspaceTabState`.
- **Q3**: Should the per-tab `state` be migrated
  backward (v4 → v3) for users who want to share
  their setup with a pre-M6b install? (M6b says
  no — pre-M6b is a dead end.) The v4 export
  format is the canonical "share" format; v3 is a
  legacy read-only shape.
