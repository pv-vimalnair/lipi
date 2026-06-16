# M6c — Per-tab cursor + file-tree scroll (design)

**Date**: 2026-06-16
**Phase**: M6c
**Status**: Design (accepted for implementation)
**Supersedes**: the M6b `WorkspaceTabState` four-field shape (adds 2 fields); the v4 export/import format (adds a v5 with a v4 → v5 migration)

## Goal

Extend the M6b per-tab state model so each workspace tab remembers
its **per-file editor cursor position** and its **file-tree scroll
anchor** when the user switches between tabs (and across app
relaunches). The settings export/import format is bumped from v4
to v5 to include the two new fields, and a v4 → v5 in-memory
migration is shipped alongside the existing v3 → v4 migration.

This is the third slice of the M6 multi-workspace tabs plan. M6a
shipped the data model + tab strip; M6b shipped per-tab state
keying for the four file-tree / editor-tab fields. M6c picks up
the two scroll/cursor items the M6b design doc explicitly parked.

## Non-goals (M6c explicitly does not do)

The M6b design's non-goals list (in `docs/plans/m6b-design.md`
lines 17–34) is still authoritative. M6c does **not** ship:

- Per-tab font size, per-tab theme, per-tab accessibility prefs.
- Per-tab recents (the recents list stays a single global history).
- Per-tab tool / voice / git / search settings.
- Per-tab Monaco language (the LSP `LspServerKind` is per-file
  via M6a's `kindForPath`, not per-tab state).

A future M6d (or whatever the next slice is called) can pick up
those items. M6c is the minimal slice that the M6b design doc
explicitly parked.

## The data model extension

### `WorkspaceTabState` (M6b → M6c)

```ts
export interface EditorCursor {
  /** 1-indexed, matches Monaco's `position.lineNumber`. */
  line: number;
  /** 1-indexed, matches Monaco's `position.column`. */
  column: number;
}

export interface WorkspaceTabState {
  // --- M6b fields (unchanged) ---
  expandedDirs: string[];
  selectedPath: string | null;
  openEditorTabPaths: string[];
  activeEditorTabPath: string | null;

  // --- M6c additions ---
  /**
   * Per-file cursor positions for the editor tabs in this
   * workspace tab. Keyed by absolute file path. The file
   * must be in `openEditorTabPaths` to be relevant; a path
   * in this map that is NOT in `openEditorTabPaths` is
   * stale and is pruned on hydrate.
   */
  editorCursorByPath: Record<string, EditorCursor>;

  /**
   * The path of the topmost visible file-tree row when the
   * user last looked at this tab. `null` if the tree has
   * never been scrolled, or if the tree is empty. Restored
   * on tab switch: the file tree scrolls so this path is
   * the topmost visible row (if the path still exists in
   * the tree).
   */
  fileTreeScrollAnchor: string | null;
}

export const EMPTY_TAB_STATE: WorkspaceTabState = {
  expandedDirs: [],
  selectedPath: null,
  openEditorTabPaths: [],
  activeEditorTabPath: null,
  editorCursorByPath: {},
  fileTreeScrollAnchor: null,
};
```

The two new fields are backwards-compatible with M6b: a v4
`WorkspaceTab` (or an in-memory M6b `WorkspaceTab`) that lacks
them is hydrated with the `EMPTY_TAB_STATE` defaults. This is
the same "permissive on the new field" pattern M6b established
(HANDOFF §9.23).

## The mirror-back architecture

The M6b pattern (Decision #81 / #83): `WorkspaceTab.state` is
the persisted source of truth; the live stores are the transient
view, kept in sync via two `useEffect` hooks per live store.
M6c adds two more live "transient views" — the editor cursor
(one per open file) and the file tree scroll position (one per
tab) — and each needs the same two hooks.

### Editor cursor (in `useEditorTabs.ts`)

**Rehydrate on tab switch.** When `activeId` changes, after the
M6b `replaceAll(openEditorTabPaths, tabs, activeEditorTabPath)`
runs, iterate over the open editor tabs and call
`editor.setPosition({lineNumber, column})` for each, using the
new tab's `editorCursorByPath`. After `setPosition`, call
`editor.revealPositionInCenterIfOutsideViewport(position)` so
the cursor is visible if it was off-screen. Skipping the call
leaves every editor at `Line 1, Column 1` after a tab switch.

**Mirror-back on cursor move.** Monaco's
`editor.onDidChangeCursorPosition` fires on every cursor move.
We subscribe once per editor instance. On fire, schedule a
debounced mirror-back via `scheduleCursorMirrorBack`:

- `requestIdleCallback` if available, else `setTimeout(500ms)`.
- A `Map<filePath, handle>` keyed by `tabId + '\0' + filePath`
  is maintained; if a new move arrives before the previous
  fires, the previous is cancelled and a new one is scheduled
  (trailing debounce).
- When the debounce fires, it calls
  `useWorkspaceStore.getState().setEditorCursor(tabId, filePath, cursor)`.
- The new `setEditorCursor` action does a partial-merge into
  `editorCursorByPath`: an immutable update of
  `state.workspaces[i].state.editorCursorByPath[filePath] = cursor`.

**Loop guard.** `onDidChangeCursorPosition` fires for both
user moves and programmatic `setPosition` calls. Two layers of
defence prevent the rehydrate-then-mirror-back infinite loop:

1. **Subscription-attached-after-rehydrate.** The subscription
   is created in a `useEffect` that runs after the M6b rehydrate
   `useEffect`. For the initial mount on a tab switch, the
   subscription is attached after `setPosition` is called inside
   the rehydrate effect, so it doesn't see the rehydrate move.
2. **Equality short-circuit in `setEditorCursor`.** The action
   reads the current `editorCursorByPath[filePath]` and returns
   early if `prev.line === incoming.line && prev.column === incoming.column`.

**Unsubscribe on unmount.** The `onDidChangeCursorPosition`
subscription is returned by Monaco and stored in a ref. When
the editor instance unmounts (tab close, workspace tab close,
app teardown), the subscription is disposed. The debounce
handle map is also cleared on unmount; **any pending writes
are flushed synchronously before the unsubscribe** (we don't
want to lose a cursor move the user just made before closing
the tab).

**Stale-entry prune.** Entries in `editorCursorByPath` whose
file is not in `openEditorTabPaths` are pruned on hydrate (a
single `Object.fromEntries(Object.entries(state.editorCursorByPath).filter(...))`
in the rehydrate effect). The hydrate-time prune is preferred
over per-close-action coordination: one place, simple, accepts
a few transient stale entries per tab.

### File tree scroll (in `useFileTree.ts`)

**DOM marker.** Every `<TreeNode>` row gets
`data-tree-path={node.path}`. This is a one-line change in
`TreeNode.tsx` and is the lookup key for both rehydrate and
mirror-back.

**Rehydrate on tab switch.** When `activeId` changes, after the
M6b `setExpandedAndSelected(expandedDirs, selectedPath)` runs,
wait one `requestAnimationFrame` for the tree to render with
the new expansions, then if the new tab's `fileTreeScrollAnchor`
is non-null, find the row for that path (via
`document.querySelector('[data-tree-path="..."]')`) and call
`row.scrollIntoView({ block: 'start' })` on it. `scrollIntoView`
is layout-agnostic (row heights aren't fixed) — preferred over
`scrollTo({top})` for the same reason M6c uses first-visible-path
over pixel offset.

If the first attempt doesn't find the row (the file tree's
`entriesByDir` cache is async), retry once on the next
`requestAnimationFrame` (cap retries at 2 to avoid infinite-loop
on permanent missing paths). After 2 failed attempts, silently
bail — no log, no toast, no error.

If the path is no longer in the tree (file deleted, directory
collapsed by another path), `scrollIntoView` silently does
nothing. The stale anchor stays in `fileTreeScrollAnchor` until
the next mirror-back overwrites it. We do not auto-prune on
hydrate (predictable behaviour: read = read, write = write;
no surprise mutations on read).

**Mirror-back on scroll.** A passive `scroll` listener on the
scrollable container, throttled to `requestAnimationFrame` (one
read per frame, max). On fire, find the topmost visible row
(first row whose `getBoundingClientRect().bottom >
containerRect.top + 1`), read its `data-tree-path`, and write
it via `useWorkspaceStore.setFileTreeScrollAnchor(tabId, path)`.

**No-op-storm guard.** If the topmost is `null` (empty tree),
we do **not** write `null` on every scroll event. We only
write on transitions: previous was non-null → current is
`null` (write `null`), or previous was `null` → current is
a path (write the path). The midpoint "both `null`" is
skipped.

### `useWorkspaceStore` action additions

```ts
useWorkspaceStore.setEditorCursor(
  tabId: string,
  filePath: string,
  cursor: EditorCursor,
): void;

useWorkspaceStore.setFileTreeScrollAnchor(
  tabId: string,
  anchor: string | null,
): void;
```

`setEditorCursor` does an immutable partial-merge into
`editorCursorByPath[filePath]`. The new field is a nested
object, so a dedicated action is clearer than overloading
the M6b `setTabState(tabId, partial)` (which is a top-level
merge). `setFileTreeScrollAnchor` *could* be expressed via
`setTabState` (it's a single primitive field), but a
dedicated action is more discoverable in the call sites.

### Mirror-back ordering

The M6b expansion rehydrate changes the tree's structure,
which changes row positions, which means the scroll anchor
restoration must run *after* the expansion rehydrate renders.
The `requestAnimationFrame` after `setExpandedAndSelected`
accounts for this. The mirror-back direction (scroll writes
`fileTreeScrollAnchor`; expansion writes `expandedDirs`) is
independent — they go to two different fields on the same
`WorkspaceTabState` object, no ordering conflict.

## The throttle (`scheduleCursorMirrorBack`)

```ts
function scheduleCursorMirrorBack(
  tabId: string,
  filePath: string,
  cursor: EditorCursor,
): void;
```

- Signature: 3 args. Side effect: writes to `useWorkspaceStore`
  after the throttle.
- Implementation: a module-level
  `Map<string, { kind: 'idle' | 'timeout', handle: number }>`
  keyed by `tabId + '\0' + filePath`. On each call, cancel any
  previous handle for that key (`cancelIdleCallback` or
  `clearTimeout`), then schedule a new one:
  ```ts
  if (typeof requestIdleCallback === 'function') {
    handle = requestIdleCallback(
      () => flushCursor(tabId, filePath, cursor),
      { timeout: 500 },
    );
  } else {
    handle = setTimeout(
      () => flushCursor(tabId, filePath, cursor),
      500,
    );
  }
  ```
- Flush: `useWorkspaceStore.getState().setEditorCursor(...)`,
  then remove the entry from the map.
- At unmount: iterate the map; for each entry, cancel the
  handle and call `flushCursor` synchronously.
- Why `requestIdleCallback` + 500ms timeout: `requestIdleCallback`
  schedules the callback when the browser is idle (between
  frames), but on a busy page (typing fast) idle can be 1-2
  seconds away. The `{ timeout: 500 }` option tells the browser
  "fire after 500ms even if not idle yet" — so a user who pauses
  typing for half a second gets the write. In test envs (jsdom)
  where `requestIdleCallback` is missing, the `setTimeout(500ms)`
  fallback fires after exactly 500ms.

## The v5 settings export / import format

The M6b design's Decision #84 ("format and version are separated")
applies. The format magic string is the same as v2/v3/v4
(`'lipi-state'`) — only the `version` field discriminates.
`version: 5` is the in-data version. This matches the v3 → v4
precedent exactly: the wire-format identifier is the magic
string, the version is the shape discriminator.

```ts
export const LIPI_STATE_V5_FORMAT = 'lipi-state';
export const LIPI_STATE_V5_VERSION = 5;

export interface ExportedWorkspaceTabV5 {
  id: string;
  path: string;
  addedAt: number;
  state: WorkspaceTabState;  // already has the 2 new fields
}

export interface ExportedWorkspaceV5 {
  workspaces: ExportedWorkspaceTabV5[];
  activeId: string | null;
  recents: string[];
}

export interface LipiStateV5Data {
  workspace: ExportedWorkspaceV5;
  voicePreferences: VoicePreferencesV2;
  toolSettings: ToolSettingsExportV2;
}

export interface LipiStateV5File {
  format: typeof LIPI_STATE_V5_FORMAT;
  version: typeof LIPI_STATE_V5_VERSION;
  exportedAt: string;
  data: LipiStateV5Data;
}
```

The `WorkspaceTabState` shape already includes the 2 new fields
(M6c extends the type once, M6b's type is a strict subset of
M6c's type). No need to fork the type.

### v4 → v5 in-memory migration

The M6b design's v3 → v4 migration pattern is reused exactly.
`parseLipiStateV5` auto-detects v4 input by inspecting
`version: 4` (the v4 discriminator) and runs the migration.
The migration (`migrateV4DataToV5`) fills in defaults for
the two new fields:

```ts
function migrateV4DataToV5(v4: LipiStateV4Data): LipiStateV5Data {
  return {
    workspace: {
      ...v4.workspace,
      workspaces: v4.workspace.workspaces.map((tab) => ({
        ...tab,
        state: {
          ...tab.state,
          editorCursorByPath: {},
          fileTreeScrollAnchor: null,
        },
      })),
    },
    voicePreferences: v4.voicePreferences,
    toolSettings: v4.toolSettings,
  };
}
```

Synthesise defaults for the new fields; preserve everything
else bit-for-bit. The v3 → v4 path is reused unchanged (v3
input → v4 → v5 in one pass). Note: `LipiStateV5Data` does
not carry `format` / `version` (those are on the file
wrapper, added by `buildLipiStateV5` and the parser).

### Migration chain

```ts
function parseLipiStateV5(input: unknown): LipiStateV5Data {
  if (looksLikeV3(input)) {
    return parseLipiStateV5(migrateV3DataToV4(input));
  }
  if (looksLikeV4(input)) {
    return migrateV4DataToV5(parseLipiStateV4(input));
  }
  if (!looksLikeV5(input)) {
    throw new Error('unknown format');
  }
  return validateV5(input);
}
```

A v3 file is migrated to v4, parsed as v4, then migrated to
v5 — three steps, each a pure function. The v3 → v4 path is
the M6b code, unchanged.

### Apply / preview / snapshot updates

- `applyLipiStateV5` replaces `applyLipiStateV4` (same
  transactional snapshot/restore design — Decision #67).
- `computeLipiStateV5ImportPreview` extends the M6b v4 preview
  with two new sub-sections under "per-tab state":
  `editorCursorByPath` (count of entries per tab) and
  `fileTreeScrollAnchor` (changed or unchanged per tab).
- `snapshotStoresForExport` produces a v5 snapshot. The two
  new fields are part of the `structuredClone` deep-copy.

### PrivacyDataCard UX

The card exports in v5 format. The format note shows
`LIPI_STATE_V5_FORMAT` + `LIPI_STATE_V5_VERSION`. The
migration notice ("imported as v3; wrapped in a single tab")
is still shown for v3 imports; a new "imported as v4;
per-tab scroll/cursor not present in the source" notice is
shown for v4 imports.

### Backward compatibility

- A v5 file is rejected by the v4 import path (`format`
  mismatch). The v4 install on a v5 file sees the v4 parser's
  `unknown format` error and the user gets the standard "wrong
  format" toast.
- A v4 file imports cleanly into v5 (the migration synthesises
  the missing fields).
- A v3 file imports cleanly into v5 (the v3 → v4 → v5 chain).

## Error handling

- **Rehydrate fails (path not in tree, no rows yet)**: silent.
  The `fileTreeScrollAnchor` stays in the persisted state; the
  user sees the tree at its default scroll. The next mirror-back
  overwrites the stale anchor on the user's next scroll. No log,
  no toast, no error.
- **Mirror-back throws (Zustand `set` throws)**: caught locally,
  logged via `console.warn` once per session (a module-level
  `Set<tabId>` de-dupes). The next mirror-back attempt is not
  blocked; the event is lost for that single fire.
- **`requestIdleCallback` missing + `setTimeout` unavail (test
  env)**: the throttle degrades to "synchronous flush on every
  move" via a feature-detect at module load. Tests that need to
  assert on the throttle can use the synchronous path.
- **Stale `editorCursorByPath` entry** (file closed): pruned on
  next hydrate (one `Object.fromEntries(...)` filter, in the
  rehydrate effect). The prune is at hydrate time, not on every
  `closeEditorTab` action — one place, simple, accepts a few
  transient stale entries per tab.
- **JSON parse failure on hydrate** (corrupted localStorage from
  a pre-M6c install with a partially-written v5 file): the
  existing M6b `hydrate` defensive try/catch (HANDOFF §9.23)
  catches this, falls back to `EMPTY_TAB_STATE`. The two new
  fields default to `{}` / `null` via the type's
  `EMPTY_TAB_STATE` constant.

## File changes (rough — refined in the implementation plan)

New files:
- `src/shared/settingsIOv5.ts` — v5 schema, builder, parser,
  privacy checker, filename suggester.
- `src/shared/settingsIOv5.apply.ts` — transactional apply.
- `src/shared/settingsIOv5.preview.ts` — import-preview diff.
- `src/shared/settingsIOv5.test.ts` — round-trip + migration +
  apply + preview tests.

Modified files:
- `src/screens/EditorWorkspace/state/useWorkspaceStore.ts` —
  extend `WorkspaceTabState`, add `EMPTY_TAB_STATE` defaults,
  add `setEditorCursor` + `setFileTreeScrollAnchor` actions,
  add hydrate-defaults for the two new fields.
- `src/screens/EditorWorkspace/hooks/useEditorTabs.ts` —
  add rehydrate + mirror-back for the editor cursor.
- `src/screens/EditorWorkspace/hooks/useEditorTabs.test.tsx` —
  add M6c tests (cursor restore, throttle, loop guard, flush
  on unmount, stale prune).
- `src/screens/EditorWorkspace/hooks/useFileTree.ts` — add
  rehydrate + mirror-back for the file-tree scroll anchor.
- `src/screens/EditorWorkspace/hooks/useFileTree.test.tsx` —
  add M6c tests (scroll restore, topmost path write, fallback
  when path missing, no-op-storm guard).
- `src/screens/EditorWorkspace/state/useWorkspaceStore.test.ts` —
  add tests for `setEditorCursor`, `setFileTreeScrollAnchor`,
  `EMPTY_TAB_STATE` defaults.
- `src/screens/EditorWorkspace/components/FileTreePane/TreeNode.tsx`
  — add `data-tree-path` attribute to each row.
- `src/screens/EditorWorkspace/components/FileTreePane/FileTreePane.test.tsx`
  — add a test that asserts `data-tree-path` is present.
- `src/screens/SettingsProvider/components/PrivacyDataCard.tsx`
  — export in v5 format; show v4-imported-as-v5 notice.
- `src/shared/settingsIOv2.ts` (M6a code) — unchanged but its
  v3 / v4 path is reused by v5; no edits to v2 / v3 / v4 code
  itself.
- `src/screens/EditorWorkspace/components/EditorWorkspace.tsx`
  (or whatever renders the dev marker) — titlebar `dev · M6b`
  → `dev · M6c`.
- `docs/plans/m6b-design.md` — add a "Superseded by M6c" line
  at the top (so future agents reading M6b's design see the
  M6c extension exists).
- `HANDOFF.md` — §9.46 / Phase M6c writeup (after the
  implementation lands).
- `CHANGELOG.md` — `[Unreleased — Phase M6c — Per-tab cursor +
  file-tree scroll]` section.

No changes:
- `src-tauri/` — no Rust changes.
- `tauri.conf.json` / `Cargo.toml` / `Cargo.lock` — no Tauri /
  Cargo dep changes.
- `docs/RELEASING.md` / CI workflows — no release-pipeline
  changes.

## Decisions (the architectural calls)

- **#167** — `WorkspaceTabState` is extended with the two new
  fields `editorCursorByPath: Record<string, {line, column}>`
  and `fileTreeScrollAnchor: string | null`. The M6b invariant
  "all per-tab state is in `WorkspaceTabState`" (Decision #81)
  is preserved. The M6b-design-doc parked items (per-tab font,
  per-tab theme, per-tab recents, per-tab tool / voice / git /
  search settings) remain parked; M6c is the minimal slice.
- **#168** — The editor cursor mirror-back is throttled with
  `requestIdleCallback` (500ms timeout) or `setTimeout(500ms)`
  in test envs. A trailing-debounce per `tabId+filePath` ensures
  the store only sees a write after the user pauses typing. The
  flush-on-unmount is synchronous so a cursor move made just
  before a tab close is never lost.
- **#169** — The file-tree scroll anchor is the topmost-visible
  *path* (not a pixel offset). The rehydrate scrolls the
  matching row into the topmost slot via `scrollIntoView({block:
  'start'})`, which is layout-agnostic. Stale anchors (path no
  longer in the tree) silently fall back; the anchor is not
  auto-pruned on read.
- **#170** — The v5 export format is `format: 'lipi-state'` /
  `version: 5`. The format magic string is unchanged from
  v2/v3/v4 — only the `version` field discriminates. The v4 →
  v5 migration is an in-memory transformation in
  `parseLipiStateV5` — the parser auto-detects v4 input by
  `version: 4` and migrates before validation. A v3 file goes
  through the v3 → v4 → v5 chain in one import call. There is
  no separate `parseLipiStateV4` path; v4 files go through the
  same v5 import path.
- **#171** — The M6b loop-guard pattern (Decision #83 — one-way
  mirror-back from live store to persisted state) is preserved
  for the two new fields. The editor cursor's `setEditorCursor`
  action has an equality short-circuit to avoid no-op writes;
  the file-tree scroll mirror-back has a transition-only write
  to avoid `null`-storms on an empty tree.

## Open questions (none blocking — M6c ships without answers)

- **Q1**: Should `editorCursorByPath` be pruned on
  `closeEditorTab` action (in addition to hydrate-time prune)?
  (M6c says no — hydrate-time is enough. A user who closes a
  file and reopens the same tab will see the prune happen on
  the rehydrate. Closing a file does not switch tabs, so the
  stale entry never becomes visible.)
- **Q2**: Should the per-file cursor persist across
  `discard` / `stageAll` git operations? (M6c says yes — the
  cursor is keyed by file path, not by git status. A user who
  discards a file's local changes and reopens the file will
  see the cursor at the same line/col. The file *content* is
  reset, but the cursor position is the user's mental model of
  "where I was looking," which is independent of the file's
  contents.)
- **Q3**: Should the file-tree scroll anchor be reset when
  the user explicitly collapses all directories? (M6c says
  no — collapsing is a user choice; the anchor stays. The
  next time the user expands the same directories, the
  scroll will restore. The pre-collapsed scroll position is
  the user's last-known good state, not a stale one.)
