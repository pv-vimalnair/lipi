# ADR #82 — M6b: v4 settings export shape; v3 → v4 import migration is in-memory + automatic in `parseLipiStateV4`

**Date**: June 2026
**Phase**: M6b (Per-tab state keying + v4 settings export / import)
**Status**: Accepted
**Supersedes**: n/a (v4 is a strict superset of v3 — the v3 import path is preserved inside the v4 module as a migration, not as a separate code path)
**Deciders**: project lead (Vimal Nair)

## Context

M6a shipped multi-workspace tabs as a data model + tab strip. The v3 settings export shape (Decision #67, S3) had a single `workspace.currentPath: string | null` — a flat "the one workspace the user has open" field. M6a changed the in-store shape to `workspaces: WorkspaceTab[]` + `activeId: string | null`, but the v3 export shape was kept (the export didn't have per-tab state to export, so the v3 shape was still a valid summary of the workspace).

M6b changes the in-store shape to add `state: WorkspaceTabState` on each tab. The v3 export shape can no longer represent the new data — the per-tab state is the user's "I switched to tab A, expanded a deep tree, opened three editor tabs, and I want the export to capture that" state, and the v3 shape has no field to put it. M6b needs a new export shape.

The new shape is "v4". The two questions are: what does v4 look like, and what happens to existing v3 files?

The v3 → v4 transition is the second v-N → v-N+1 transition in Lipi (the first was v1 → v2 in M6a). The two transitions are different in scope: v1 → v2 was an in-store migration (read the v1 key from localStorage, write the v2 keys), v3 → v4 is an export-format migration (read a v3 JSON file from disk, parse it, write a v4 JSON file). The two transitions are also different in *timing*: v1 → v2 fires once, on first hydrate after M6a ships, and never fires again. v3 → v4 fires on every import of a v3 file — a user with a v3 export from yesterday and an M6b build of Lipi can still import their v3 file, and the import is automatic.

The v3 → v4 import path is interesting because the v3 file is *not* v4 — it doesn't have `workspaces[]`, it has `currentPath`. The M6b import code has to handle two cases: a v4 file (parse as v4, validate, apply) and a v3 file (migrate to v4 in-memory, validate, apply). The two cases share the v4 validation, the v4 apply, the v4 preview, the v4 UI — only the parsing + migration is v3-specific.

## The options considered

1. **Two separate import paths: `parseLipiStateV3` + `parseLipiStateV4`.** The importer has a top-level `if (parsed.version === 4) return parseLipiStateV4(file); else return parseLipiStateV3(file);` and the v3 parse builds a v4-shaped object. The two parsers share the v4 validation + apply. Selected against: the v3 parse is a *migration* (a transformation), not a parser (it doesn't produce a v3-shaped object). The "two parsers" framing implies the v3 parse is a first-class output, but it isn't — the v3 parse is just a v3 → v4 migration. The "two parsers" framing also implies a v3 file can be exported as v3 (it can't — the v3 shape doesn't exist in the v4 build), so the v3 parse has no symmetric "export" path. The "two parsers" framing is more code than necessary.

2. **One parser: `parseLipiStateV4` with v3 detection + in-memory migration.** The parser is a single function that takes a JSON string, parses it, detects the version (via `version` field + `currentPath` presence), and either validates as v4 (if `version === 4`) or migrates from v3 (if `currentPath` is present) and then validates as v4. The migration happens inside the parser; the output is always a v4-shaped `LipiStateV4Data`. The v3 path is *only* the migration; there is no separate "v3 parse" code. Selected.

3. **Refuse v3 files.** The importer rejects v3 files with an "exported with an older version, please re-export" error. The user has to find their old Lipi binary, open it, re-export as v3 (the old binary can't export as v4), and then import the re-exported v3 file (which is the same v3 file they already had). This is the "no migration, just tell the user" approach. Selected against: the v3 file already on the user's disk is *the* export of their workspace; refusing to import it forces the user to install the old binary (a step that's not always possible — the old binary may not be available on the user's current OS), re-export, and then import. The "refuse" approach is a regression in UX.

The third option (refuse) is the worst — it loses data the user already saved. The first option (two parsers) is acceptable but has more code than the second. The second option is selected.

## Decision

### D1. v4 export shape extends v3's `workspace.currentPath` to `workspace.workspaces[]`

The v3 export shape:

```ts
interface ExportedWorkspaceV3 {
  currentPath: string | null;
  recents: string[];
}
```

The v4 export shape:

```ts
interface ExportedWorkspaceV4 {
  workspaces: ExportedWorkspaceTabV4[];   // supersedes currentPath
  activeId: string | null;                 // supersedes "currentPath !== null"
  recents: string[];                       // unchanged
}

interface ExportedWorkspaceTabV4 {
  id: string;
  path: string;
  addedAt: number;
  state: WorkspaceTabState;               // NEW in v4
}
```

The two new fields per tab (`id`, `addedAt`, `state`) are the M6a/M6b additions; the `path` is unchanged from v3 (the absolute folder path is the v3 `currentPath` and the v4 per-tab `path`). The `activeId` is a UUID; the v3 "is currentPath set?" is replaced by "is activeId set?" (the v3 "currentPath is the open workspace" semantics is now "activeId is the open tab, and the tab's `path` is the folder").

The `recents` array is unchanged in shape — it's still an array of absolute paths, capped at `MAX_RECENTS` (5), deduped, newest-first. M6b doesn't widen the recents model (per-tab recents is M6c, see Decision #81's D5).

The v4 file wrapper is `{ format: 'lipi-state-v4', version: 4, exportedAt: <ISO 8601>, data: LipiStateV4Data }`; the data block is `{ format: 'lipi-state-v4', version: 4, workspace: ExportedWorkspaceV4, voicePreferences, toolSettings }`. The `format` constant is `LIPI_STATE_V4_FORMAT`; the `version` is `LIPI_STATE_V4_VERSION`. See Decision #84 for why `format` and `version` are separated.

### D2. The v3 → v4 migration is in-memory + automatic in `parseLipiStateV4`

`parseLipiStateV4(json: string): LipiStateV4Data` is the single entry point for parsing a settings file. The function:

1. JSON-parses the input.
2. Inspects the `version` field (or its absence) and the `currentPath` field.
3. If the input has `version: 4` and a v4-shaped `data.workspace.workspaces` array, validates as v4 (the `validateWorkspace` + `validateWorkspaceTab` + `validateWorkspaceTabState` + `validateVoicePreferences` + `validateToolSettings` functions).
4. If the input has `version: 2`, `version: 3`, no `version`, or any v3-shaped signal (e.g. a `data.workspace.currentPath` field and no `data.workspace.workspaces` array), runs `migrateV3DataToV4(parsed)` to transform the v3 input into a v4-shaped object in-memory.
5. Re-validates the migrated object as v4.
6. Returns the validated `LipiStateV4Data`.

The v3 detection is *not* a single `if (parsed.version === 3)` check. The detection is "does the input look like v3?" — and v3 has multiple shapes:

- `version: 3` + `data.workspace.currentPath: string | null` (the canonical v3)
- `version: 2` + `data.workspace.currentPath: string | null` (a v2 file that was valid Lipi v2)
- No `version` field + `data.workspace.currentPath: string | null` (a v1 file that was the pre-S3 export shape)
- Any input where `data.workspace.currentPath` is present and `data.workspace.workspaces` is absent (a malformed v3, or a future v2-with-extra-fields, or a manually-edited JSON)

The detection is intentionally permissive: if the input has `currentPath` and not `workspaces`, it's v3-shaped and we migrate. The detection is in `parseLipiStateV4` itself (not in a separate `isV3File(parsed)` function), so the migration is a private detail of the parser — the rest of the codebase sees a v4-shaped `LipiStateV4Data` and doesn't need to know about the v3 history.

The v3 → v4 migration (`migrateV3DataToV4`) is a pure function: `v3Data → v4Data`. The function:

- Wraps `v3Data.data.workspace.currentPath` in a single `ExportedWorkspaceTabV4` with `EMPTY_TAB_STATE` (if `currentPath` is non-null). The id is generated via `crypto.randomUUID()`; the `addedAt` is `Date.now()`.
- Sets `v4Data.data.workspace.activeId` to the new tab's id (if `currentPath` was non-null) or `null` (if `currentPath` was null).
- Preserves `v3Data.data.workspace.recents` as `v4Data.data.workspace.recents` (unchanged).
- Preserves `v3Data.voicePreferences` and `v3Data.toolSettings` (unchanged — M6b doesn't widen voice or tool settings, see Decision #81's D5).
- Sets `v4Data.format` to `LIPI_STATE_V4_FORMAT` and `v4Data.version` to `4`.

The migrated data is then validated as v4. The v4 validation is *strict* — `validateWorkspaceTabState` rejects unknown fields, `validateWorkspaceTab` rejects unknown fields, `validateWorkspace` rejects unknown fields. The migration produces a v4-shaped object, so the validation passes.

### D3. There is no `parseLipiStateV3` in the v4 build

The v3 parse is a migration, not a parser. The v4 build does not export a `parseLipiStateV3` function (the `settingsIOv3.ts` module is gone — its functionality is now in `migrateV3DataToV4` inside `settingsIOv4.ts`). The reason is that "parsing v3" is a misleading API: the v3 file is *not* a valid v4 file, the v3 file is the *input* to a v3 → v4 migration. The function that consumes a v3 file is `parseLipiStateV4`, not `parseLipiStateV3` — the v4 parser is the one that detects the v3 shape and migrates.

The settingsIOv3 module is removed because:

- The v3 schema is not validated as v3 (it's migrated to v4 and validated as v4). A `parseLipiStateV3` function would have its own v3 validation, but the v3 validation is not used (the v3 input is migrated to v4 and the v4 validation is the one that runs). The v3 validation would be dead code.
- The v3 apply is not a thing (the v3 input is migrated to v4, and `applyLipiStateV4` is the one that applies). A `applyLipiStateV3` function would be a wrapper around `migrateV3DataToV4` + `applyLipiStateV4`, which is exactly what `parseLipiStateV4` + `applyLipiStateV4` already do. The wrapper would be dead code.
- The v3 build is the *result* of importing a v3 file, not a thing the v4 build produces. The v4 build exports v4. There is no "export as v3" path (a v4 build cannot downgrade an export).

The settingsIOv2 module is *kept* (it's still used by `migrateV3DataToV4` to validate the v3 schema as a *loose* schema, not as the strict v2 schema — see D4). The settingsIOv2 module is the *only* legacy settings module that survives the M6b transition; settingsIOv3 is gone.

### D4. The v3 schema is validated by a dedicated `validateV3Workspace` function, not by `settingsIOv2.parseLipiStateV2`

The v3 input has a v3 schema: `{ version: 2 | 3, data: { workspace: { currentPath: string | null, recents: string[] }, ... } }`. The schema is a *superset* of the v2 schema (v3 added `recents` to `workspace`, v2 had only `currentPath`). The `settingsIOv2.parseLipiStateV2` function strictly validates `version: 2` and rejects `version: 3` (or any non-2 version). The strict version check is correct for v2 (a v2 file must be a v2 file), but it's wrong for v3 (a v3 file is *not* a v2 file, even though the v3 schema is a superset of v2).

The fix is a dedicated `validateV3Workspace(workspace: unknown): { currentPath: string | null, recents: string[] }` function in `settingsIOv4.ts`. The function:

- Checks `workspace` is an object (not `null`, not a primitive).
- Checks `currentPath` is `string | null` (rejects `undefined`, primitives other than string, objects).
- Checks `recents` is an array of strings (rejects non-arrays, non-string elements).
- Returns the validated object.
- Throws a `SettingsParseError` with a human-readable message on any failure (e.g. `"v3 workspace.currentPath is 'string', expected 'string | null'"`).

The `migrateV3DataToV4` function uses `validateV3Workspace` to validate the v3 input *before* migrating. If the v3 input is corrupt (e.g. `currentPath` is a number), the validation throws and the migration doesn't run. The error message is the v3 error (the v4 error message would be misleading — the user is looking at a v3 file, not a v4 file).

The `settingsIOv2.parseLipiStateV2` is *not* called from the v4 build (the v3 → v4 migration uses `validateV3Workspace`, not `parseLipiStateV2`). The `settingsIOv2` module is kept because it's still used by the v2 in-store migration (the v1 → v2 in-store migration reads the v1 key from localStorage and writes the v2 keys; the v2 keys are validated by `settingsIOv2.parseLipiStateV2` to make sure the persisted v2 is actually a v2 — see Decision #79). The v2 module is the in-store migration validator; the v3 module is gone because the v3 file is the on-disk export, and the on-disk export is the v4 module's concern.

### D5. The migration is shown to the user in the UI

A v3 file imported via the PrivacyDataCard's import flow is detected as v3 (by the parser) and migrated to v4. The user is shown a `.migrationNotice` UI block under the format note explaining that the file was upgraded: "this file was exported from an earlier Lipi version; we'll import it as a v4 file with empty per-tab state." The notice is a one-line block (the format note is two lines, the migration notice is one line, the preview is the rest of the card).

The notice is informational, not a confirmation prompt. The user can still cancel the import (the "Cancel" button in the import flow). The notice is a "we did something with your file" disclosure — the user sees that the import is happening on a v3 file, not on a v4 file, and they see that the per-tab state is empty (because the v3 file had no per-tab state to migrate). The notice is opt-out: the user can cancel the import if they don't want to bring forward empty per-tab state.

The notice is the only UI difference between a v3 import and a v4 import. The rest of the import flow (file picker, JSON parse, validate, apply) is the same; the v3 case has the migration in the middle. The PrivacyDataCard's component code is unaware of v3 — the migration is a private detail of `parseLipiStateV4`; the component just renders the preview (which is the v4 preview) and the migration notice (which is a flag on the v4 preview's "this was migrated" property).

## Consequences

### Positive

- **v3 files continue to import.** A user with a v3 export from yesterday and an M6b build of Lipi can still import their v3 file. The migration is automatic — no "export as v3 from the old binary" round-trip, no "this file is from an older version" error.
- **One import code path.** The v3 import and the v4 import go through the same `parseLipiStateV4` + `applyLipiStateV4` + `computeLipiStateV4ImportPreview` + `previewDiffLabelV4` chain. The PrivacyDataCard's component code is unaware of the v3 history — it sees a v4-shaped preview and renders it. The v3 detection is a private detail of the parser.
- **The v3 schema is explicitly validated.** The `validateV3Workspace` function is dedicated to the v3 schema, and it produces a v3 error message (not a v4 error message). A user with a corrupt v3 file sees a v3 error, not a misleading "v4 workspace.workspaces is missing" error.
- **The export shape is a strict superset of the v3 shape.** The `recents` array is unchanged, the `path` field is unchanged, the `currentPath → workspaces[]` rename is the only structural change. A user who doesn't use per-tab state (only ever has one tab open, never opens more than one) can round-trip a v4 export → v3 import (via the migration) → v4 export without losing any data.

### Negative

- **The migration is in-memory, not on disk.** A user who imports a v3 file gets a v4 file in their `localStorage` after the apply — the original v3 file on disk is untouched. A user who re-imports the v3 file (e.g. they share it with a colleague) gets the same v4 import. The v3 file is never "upgraded in place" — the migration is a one-shot in-memory transformation in the parser, not a file-system operation. This is fine for the current use case (the v3 file is a one-time export, not a frequently-edited file), but a user who expects "import the v3 file and have it become a v4 file on disk" will be surprised.
- **The per-tab state is empty on v3 → v4 migration.** A v3 file has no per-tab state (it has only `currentPath` + `recents`). The v3 → v4 migration wraps `currentPath` in a single `WorkspaceTab` with `EMPTY_TAB_STATE`, so the migrated tab has no expansion, no selected row, no open editor tabs, no active editor tab. The user opens the migrated tab to a "fresh" view (file tree collapsed, no editor tabs open, no selected row). This is the *correct* behaviour (the v3 file has no per-tab state to migrate) but a user who expects "importing my v3 file gives me my old per-tab state" will be surprised. The `.migrationNotice` UI block warns them: "empty per-tab state".
- **The v3 detection is permissive.** The detection is "does the input have `currentPath` and not `workspaces[]`?" — a user who has a malformed JSON file that happens to have a `currentPath` field at the right place will be migrated (not rejected as a corrupt v3). The permissive detection is the right trade-off (rejecting a valid v3 file is worse than migrating a malformed file), but the migration's output is validated as v4 — a malformed input that *can't* be migrated to v4 (e.g. `currentPath: 42`) is rejected with a clear error message.
- **The v3 module is gone.** The `settingsIOv3.ts` module is removed from the codebase. The v3 export shape is now a *migrated input* to the v4 module, not a *first-class output* of the v3 module. A future contributor looking for "where is the v3 export code?" will be surprised — the v3 export is the v4 export with `EMPTY_TAB_STATE`. The decision is documented in the CHANGELOG (the "Removed" section of the M6b release notes, if there is one) and in the HANDOFF (§9.23 D3).

## Implementation notes

- The `migrateV3DataToV4` function is exported from `settingsIOv4.ts` for testability (the 23 tests in `settingsIOv4.test.ts` import it directly and assert on the migration output). The function is also called from `parseLipiStateV4` for the production import path. The testability is important — the v3 → v4 migration has 6 distinct cases (v3 with `currentPath: null`, v3 with `currentPath: string`, v2 with `currentPath: null`, v2 with `currentPath: string`, no version with `currentPath: null`, no version with `currentPath: string`), and each case has a dedicated test.
- The v3 detection is a private helper inside `parseLipiStateV4` (not a separate exported function). The detection is `if (data.workspace && 'currentPath' in data.workspace && !('workspaces' in data.workspace))` — a single line. The detection is intentionally not a separate function because the rest of the parser doesn't need to know about v3 (the parser returns a v4-shaped object regardless of input shape).
- The `parseLipiStateV4` function throws a `SettingsParseError` (a custom error class with a `code: 'parse' | 'validate' | 'migrate' | 'unsupported-version'` property) on any failure. The error is caught by the PrivacyDataCard's `onConfirmImport` handler and rendered as an "Import failed: <message>" toast. The error is *not* thrown to the user as a stack trace — the toast is a friendly one-line message with the underlying error in a `<details>` block for debugging.
- The v3 schema is intentionally loose: `currentPath` is `string | null`, `recents` is `string[]`. The schema is the M6a schema (the same shape as the v2 in-store migration's `workspace` field). A future v5 export shape could have a stricter v3 (e.g. `currentPath: string` only, no `null` — the "no workspace" state is represented by an empty `workspaces[]`, not by a `null` `currentPath`), but the M6b v3 detection is "v3 had `currentPath: string | null`" because that's the shape the M6a code produced.
- The migration's `EMPTY_TAB_STATE` is the canonical zero value (the same constant used in `workspaceStore.ts`'s `createWorkspaceTab`). The migration imports `EMPTY_TAB_STATE` from `workspaceStore.ts` to ensure the migrated tab and the freshly-created tab have the same shape. If `EMPTY_TAB_STATE` ever changes (e.g. a new field is added in M6c), the migration automatically picks up the new field.

## References

- `src/shared/settingsIOv4.ts` — the v4 schema, the parser, the v3 → v4 migration, the `validateV3Workspace` helper
- `src/shared/settingsIOv4.apply.ts` — the transactional apply
- `src/shared/settingsIOv4.preview.ts` — the human-readable preview
- `src/screens/SettingsProvider/components/PrivacyDataCard.tsx` — the v4 export/import UI + the `.migrationNotice` block
- `src/shared/settingsIOv4.test.ts` — the 23 tests for v4 schema + v3 → v4 migration
- `src/shared/settingsIOv4.apply.test.ts` — the 7 tests for transactional apply (including v3-migrated payloads)
- `src/shared/settingsIOv4.preview.test.ts` — the 13 tests for the preview (including v3-migrated payloads)
- `HANDOFF.md §9.23` — the M6b per-phase writeup
- `CHANGELOG.md` "Added (M6b — Per-tab state keying + v4 settings export / import)" — the user-facing summary
- `docs/decisions/0081-m6b-persisted-state-on-tab.md` — the `WorkspaceTab.state` data model
- `docs/decisions/0083-m6b-mirror-back-one-way.md` — the mirror-back direction
- `docs/decisions/0084-m6b-format-version-separation.md` — the `format` / `version` separation

---

*Last touched: M6b (June 2026). See `CHANGELOG.md` "Unreleased" for the user-facing summary.*
