# ADR #84 — M6b: separate `format` and `version` fields; the v4 export snapshot is a deep clone (point-in-time)

**Date**: June 2026
**Phase**: M6b (Per-tab state keying + v4 settings export / import)
**Status**: Accepted
**Supersedes**: n/a (M6b is the first settings version with two format/version fields; the v3 schema had only `version`)
**Deciders**: project lead (Vimal Nair)

## Context

The M6b v4 settings file has two new metadata fields at the top level: `format` and `version`. The v3 schema had only `version`. The two fields are intentionally distinct:

- `format` is a string constant that identifies the *wire format* of the file. It's the on-disk shape, the "how is this file laid out" answer. For v4, the format is `'lipi-state-v4'`. A future v5 file would have `format: 'lipi-state-v5'` (a different layout, e.g. with new top-level fields, a new data-block shape, or a renamed wrapper).
- `version` is a number that identifies the *data schema* inside the file. It's the "what's in the data block" answer. For v4, the version is `4` (matches the format). A future v5 file would have `version: 5` (a new data schema, e.g. with a renamed field, a new field, or a deprecated field removed).

The two fields are *not* the same thing. A future v5 file could have `format: 'lipi-state-v5'` with `version: 4` (a wire-format change, the data schema is unchanged — e.g. a new top-level field for the export timestamp moved to a different place, but the data block is still v4). Or it could have `format: 'lipi-state-v4'` with `version: 5` (a data-schema change, the wire format is unchanged — e.g. the data block has a new field, but the wrapper is still `{ format, version, exportedAt, data }`).

The v4 file is the first time the codebase has two metadata fields. The v3 file had only `version: 3`, and the v3 parser was "if `version === 3`, parse as v3; else, error". The v4 file has `format: 'lipi-state-v4'` + `version: 4`, and the v4 parser is "if `format === 'lipi-state-v4'` and `version === 4`, parse as v4; else, try v3 migration; else, error".

The decision to separate `format` and `version` is a forward-compatibility decision. The v3 file's `version: 3` was overloaded — it meant "the wire format is v3 AND the data schema is v3", and the two were always the same. The v4 file's `format + version` separates the two, so a future v5 wire format can be detected separately from a future v5 data schema. The v4 file is the first step in the "settings format versioning is two-dimensional" direction.

The second part of this decision is the deep-clone snapshot. The v4 export's `data` block is a *deep clone* of the live stores' state, not a *reference* into the live stores. The deep-clone is a "point-in-time snapshot" guarantee: the user can export their settings, the live stores can change (the user can close a tab, open a new file, switch tabs), and the exported JSON still reflects the state at the time of export. The deep-clone is the "the export is a true snapshot, not a live reference" guarantee.

## The options considered

1. **Single `version` field, overloaded.** The v3 file's `version: 3` is the only metadata field. The v4 file's `version: 4` is the only metadata field. The wire format and the data schema are coupled (a file with `version: 4` is both a v4 wire format and a v4 data schema). Selected against: the coupling means a future v5 wire format (e.g. with a new top-level field) would have to be a new "data schema" too, even if the data block is unchanged. The coupling is fine for the v1 → v2 → v3 → v4 progression (each version is a new wire format AND a new data schema), but it's restrictive for future changes (a wire-format-only change or a data-schema-only change would have to bump the version, breaking the v4 file's parser).

2. **Two fields, `format` + `version`.** The v4 file has `format: 'lipi-state-v4'` + `version: 4`. The two fields are distinct metadata, and the parser checks both. Selected.

3. **No metadata, just a hash.** The v4 file has no `format` or `version` field; the parser identifies the file by a content hash or a magic number. Selected against: the hash-based identification is opaque (the user can't tell at a glance what version their file is), and the magic number is essentially a renamed `format` field (a single integer or string that identifies the wire format). The hash/magic-number model is the same as option 1 or 2, just with a different field name — the design question is "do we have one field or two?", not "do we have a field or a hash?".

The deep-clone decision has fewer options:

1. **Reference into the live stores.** The v4 export's `data` block is a reference into the live stores' state. A `JSON.stringify` of the reference produces a snapshot, but the snapshot is a *shallow* copy — the inner objects (the `WorkspaceTab.state` objects) are still references into the live stores. A user who exports their settings, then closes a tab, then looks at the exported JSON, would see the closed tab's state in the JSON (because the inner object is a reference). Selected against: the export is supposed to be a point-in-time snapshot, not a live reference. A user who exports their settings, shares the file with a colleague, and then changes their own settings would expect the shared file to be the *exported* state, not the *current* state. The reference model breaks that expectation.

2. **Deep clone (point-in-time).** The v4 export's `data` block is a deep clone of the live stores' state. The clone is performed before the `JSON.stringify` (or as part of the build step), and the clone uses `structuredClone` (or an equivalent) for plain objects. The exported JSON is a true point-in-time snapshot — the user can change their settings after the export, and the exported JSON is unchanged. Selected.

3. **Deep clone via `JSON.parse(JSON.stringify(...))`.** The deep clone is performed via the "JSON round-trip" trick: `JSON.parse(JSON.stringify(liveState))` produces a deep clone because `JSON.stringify` produces a new object graph and `JSON.parse` parses it into a new object graph. The trick is correct for plain JSON-serialisable data, and the v4 settings are plain JSON-serialisable (no Maps, no Sets, no class instances, no functions). The trick is simpler than `structuredClone` (no browser-compat concerns, no edge cases with `Date` or `RegExp`), and the v4 settings don't have any of the `structuredClone` edge cases. Selected.

The `JSON.parse(JSON.stringify(...))` trick is a well-known idiom for deep-cloning plain JSON-serialisable data. The trick is O(N) in the size of the data, and the v4 settings are small (a few paths, a few booleans, a few per-tab states). The trick is correct (the round-trip produces a new object graph with no references to the original), and the trick is simple (no new dependency, no `structuredClone` polyfill, no `klona` / `lodash.cloneDeep` import).

## Decision

### D1. The v4 file has two metadata fields: `format` + `version`

The v4 file wrapper:

```ts
export const LIPI_STATE_V4_FORMAT = 'lipi-state-v4';
export const LIPI_STATE_V4_VERSION = 4;

export interface LipiStateV4File {
  format: typeof LIPI_STATE_V4_FORMAT;  // 'lipi-state-v4'
  version: typeof LIPI_STATE_V4_VERSION; // 4
  exportedAt: string;                    // ISO 8601
  data: LipiStateV4Data;
}
```

The v4 data block:

```ts
export interface LipiStateV4Data {
  format: typeof LIPI_STATE_V4_FORMAT;
  version: typeof LIPI_STATE_V4_VERSION;
  workspace: ExportedWorkspaceV4;
  voicePreferences: VoicePreferencesV2;
  toolSettings: ToolSettingsExportV2;
}
```

The `format` field is a string constant (`LIPI_STATE_V4_FORMAT = 'lipi-state-v4'`). The string is *not* derived from the `version` number — it's a separate constant that names the wire format. A future v5 file would have `format: 'lipi-state-v5'` (a new constant in a new module), and a future v5-data-only file would have `format: 'lipi-state-v4'` + `version: 5` (the wire format is unchanged, the data schema is bumped).

The `version` field is a number (`LIPI_STATE_V4_VERSION = 4`). The number is the data schema version, and it's distinct from the `format` string. The two fields are checked independently: a v4 parser checks `format === 'lipi-state-v4'` AND `version === 4`. A future v5 parser would check `format === 'lipi-state-v5'` AND `version === 5`. A v4-data-on-v5-format file (hypothetical) would be a v5 parser's "format matches, version is lower than expected, try a v4 parser" case.

The `exportedAt` field is a string (ISO 8601). The field is *not* part of the `format` or `version` — it's a per-export timestamp that doesn't change the wire format or the data schema. The field is the only top-level field that's expected to change on every export (the rest of the wrapper is constant across exports of the same format/version).

The `data` field is the actual settings payload. The `data` block has its own `format` + `version` (the data-block format/version, which for v4 happens to match the wrapper's format/version, but could diverge in a future format). The `data.format` is redundant with the wrapper's `format` for v4 (both are `'lipi-state-v4'`), but the redundancy is intentional: a future v5 wrapper could have a v4 data block (`data.format === 'lipi-state-v4'`, `data.version === 4`) if the v5 wire format is a wrapper-only change. The data-block format/version is the "what's in the data block" answer, the wrapper's format/version is the "what's the wire format" answer.

### D2. The parser checks both fields; the migration ignores them

The `parseLipiStateV4` function:

1. JSON-parses the input.
2. Checks `parsed.format === LIPI_STATE_V4_FORMAT` AND `parsed.data.format === LIPI_STATE_V4_FORMAT` AND `parsed.version === LIPI_STATE_V4_VERSION` AND `parsed.data.version === LIPI_STATE_V4_VERSION`. If all four match, the input is a v4 file and the parser proceeds to v4 validation.
3. If any of the four don't match, the parser inspects the input for v3-shaped signals (a `currentPath` field, no `workspaces[]` array, a `version` of 2 or 3, or no `version` at all). If the input is v3-shaped, the parser runs the v3 → v4 migration (Decision #82) and proceeds to v4 validation.
4. If the input is neither v4-shaped nor v3-shaped, the parser throws a `SettingsParseError` with `code: 'unsupported-version'` and a human-readable message ("expected `format: 'lipi-state-v4'` and `version: 4`, got `format: …` and `version: …`").

The migration step ignores the wrapper's `format` and `version` fields — the migration is a "this is a v3 file, transform it to a v4 file" operation, and the transformation produces a v4-shaped object regardless of the input's wrapper format/version. A v3 file with `format: 'lipi-state-v3'` (hypothetical) and a v3 file with no `format` field are both migrated identically — the migration is "v3 data → v4 data", not "v3 wrapper → v4 wrapper".

The v4 export's `format` and `version` fields are *always* set to the v4 constants — the export code is `format: LIPI_STATE_V4_FORMAT, version: LIPI_STATE_V4_VERSION`. The export doesn't accept a "export with a custom format" parameter, because the export is always the *current* format (the v4 format), not a "round-trip to an older format" operation.

### D3. The export snapshot is a deep clone via `JSON.parse(JSON.stringify(...))`

The `snapshotStoresForExport` function in `PrivacyDataCard.tsx` (and the equivalent in any future export call site) produces a `LipiStateV4Data` object by:

1. Reading the current state of the three target stores (`useWorkspaceStore`, `useVoicePreferencesStore`, `useToolSettingsStore`).
2. Building a draft `LipiStateV4Data` object with the live values (e.g. `workspaces: useWorkspaceStore.getState().workspaces.map((w) => ({ id: w.id, path: w.path, addedAt: w.addedAt, state: { ...w.state } }))`).
3. Deep-cloning the draft via `JSON.parse(JSON.stringify(draft))` — the round-trip trick that produces a new object graph with no references to the live stores.
4. Returning the deep clone as the `LipiStateV4Data` for the export.

The deep-clone is performed *after* the draft is built, not during the draft. The draft uses spread syntax (`{ ...w.state }`) to copy the top-level fields of the per-tab state, but the spread is a *shallow* copy — the inner arrays (`expandedDirs`, `openEditorTabPaths`) are still references to the live arrays. The `JSON.parse(JSON.stringify(draft))` step is what makes the clone *deep* — the JSON round-trip produces a new object graph with no references to the original.

The deep-clone is the "the export is a true point-in-time snapshot" guarantee. A user who exports their settings, then closes a tab, then looks at the exported JSON, would see the *exported* tab list (the one that was open at export time), not the *current* tab list (the one that's open now). The deep-clone is the "the export is a snapshot, not a live reference" guarantee.

The `JSON.parse(JSON.stringify(...))` trick is the chosen deep-clone method. The trick is correct for plain JSON-serialisable data (the v4 settings are plain objects, arrays, strings, numbers, booleans, and `null` — no Maps, no Sets, no class instances, no functions, no `Date`s, no `RegExp`s). The trick is O(N) in the size of the data, and the v4 settings are small (a few paths, a few booleans, a few per-tab states). The trick is simple (no new dependency, no `structuredClone` polyfill, no `klona` / `lodash.cloneDeep` import).

### D4. The deep-clone is performed once, at export time, not at parse time

The export's deep-clone is performed at export time (in `snapshotStoresForExport`), not at parse time (in `parseLipiStateV4`). The export's deep-clone is the "the export is a snapshot" guarantee; the parse's deep-clone would be the "the parsed data is a snapshot" guarantee, but the parsed data is already a fresh object graph (the `JSON.parse` in `parseLipiStateV4` produces a new object graph from the JSON string — there are no live references in the parsed data).

The export's deep-clone is the only clone that matters: the export reads from the live stores (which have live references), the parse reads from a JSON string (which has no live references). The export needs to break the live references (via the deep-clone); the parse doesn't (the JSON string is already a fresh object graph).

The export's deep-clone is also the *only* place where the live stores' data is "captured" for the export. A future "live export" feature (e.g. a "share my current state" button that produces a URL with the settings inline) would also need the deep-clone — the live stores' data is the source, the URL's query string is the destination, and the deep-clone is the bridge.

### D5. The v4 export is the canonical "settings snapshot" format

The v4 export is the *only* settings snapshot format in M6b. There is no "v4 with secrets" export, no "v4 with file contents" export, no "v4 with debug info" export. The v4 export is the canonical "user-visible settings" format — the format the PrivacyDataCard's "Export" button produces, the format the PrivacyDataCard's "Import" button consumes, the format the v4 preview diffs against.

A future "v4 with secrets" or "v4 with file contents" export would be a new format — a new `format: 'lipi-state-v4-with-secrets'` or `format: 'lipi-state-v4-with-files'`. The format would be a *new* format (not a v4 variant), and the parser would check the format string and route to the new parser. The v4 parser would *not* accept a "v4 with secrets" file (the format string doesn't match), and the "v4 with secrets" parser would *not* accept a plain v4 file (the format string doesn't match). The two parsers are distinct, the two formats are distinct, the two file shapes are distinct.

The decision to have a single v4 format (no variants) is a "ship the minimum, add variants when needed" decision. The minimum is the user-visible settings (paths, recents, preferences, tool settings). The variants (secrets, file contents) are out of scope for M6b — secrets are stored in the OS keychain (never exported), file contents are on disk (not in the export). The variants would be added in a future phase if a use case emerges (e.g. a "share my workspace with a colleague, including my open editor tabs' file contents" feature).

## Consequences

### Positive

- **The v4 file is forward-compatible.** A future v5 wire format can be detected separately from a future v5 data schema. The two are coupled in v4 (both are "v4"), but they're decoupled in the schema (the `format` and `version` fields are distinct). A future v5 wire format with v4 data (`format: 'lipi-state-v5'`, `version: 4`) would be a v5-format-v4-data file, and the v5 parser would route to the v4 data parser. The decoupling is the "settings format versioning is two-dimensional" direction.
- **The export is a true point-in-time snapshot.** A user who exports their settings, then changes their settings, then looks at the exported JSON, would see the *exported* settings, not the *current* settings. The deep-clone is the "the export is a snapshot" guarantee.
- **The deep-clone is a well-known idiom.** The `JSON.parse(JSON.stringify(...))` trick is a standard JavaScript idiom for deep-cloning plain JSON-serialisable data. The trick is correct for the v4 settings (no edge cases like `Date`, `RegExp`, `Map`, `Set`), and the trick is O(N) in the size of the data. The trick is simpler than `structuredClone` (no browser-compat concerns) and `lodash.cloneDeep` (no new dependency).
- **The v4 export is the canonical "settings snapshot" format.** The v4 export is the *only* settings snapshot format — no variants, no "v4 with secrets" or "v4 with files". The single format is the "ship the minimum" decision; the variants are out of scope for M6b.
- **The `format` constant is exported.** `LIPI_STATE_V4_FORMAT` is exported from `settingsIOv4.ts` and is used by the PrivacyDataCard's UI to display the format name in the format note. The constant is a single source of truth for the format string — the parser, the export, and the UI all reference the same constant.

### Negative

- **The `format` field is redundant with `version` for v4.** The v4 file's `format: 'lipi-state-v4'` and `version: 4` are both "v4" — the `format` string is just `'lipi-state-' + version`. The redundancy is intentional (a future v5 file could have a different format/version split), but for v4 the two fields carry the same information. The redundancy is the cost of the forward-compatibility design.
- **The deep-clone is a `JSON.parse(JSON.stringify(...))` round-trip.** The trick is correct for plain JSON-serialisable data, but it's *not* correct for non-JSON-serialisable data (e.g. `Date`, `RegExp`, `Map`, `Set`, class instances). The v4 settings don't have any of these edge cases (the data block is plain objects, arrays, strings, numbers, booleans, and `null`), but a future setting that introduces a `Date` (e.g. a "last-modified timestamp" field) would be silently corrupted by the round-trip (`Date` becomes a string). The corruption is silent (no error, just a wrong type), and the corruption would only be caught by a test that asserts on the field's type. The mitigation is the `validate…` functions in the v4 module — the validator runs after the deep-clone and would catch the type mismatch (e.g. `validateWorkspaceTabState` checks `addedAt: number`, not `addedAt: Date`). The validator is the safety net.
- **The deep-clone is O(N) in the size of the data.** The cost is negligible for the current v4 settings (a few paths, a few booleans, a few per-tab states), but a future setting that adds a large field (e.g. a "recently-opened files" list with thousands of entries) would have a larger O(N) cost. The mitigation is the future "push only the diff" mirror-back (Decision #83's D4 negative note) — the future mirror-back would push only the changed field, not the full state, reducing the O(N) cost to O(diff size). The mitigation is a future optimisation, not a M6b concern.
- **The v4 export is the *only* settings snapshot format.** A future "v4 with secrets" or "v4 with file contents" export would be a new format (not a v4 variant), and the new format would have to be parsed by a new parser. The new format is a "fork" of the v4 format, and the fork has to be maintained alongside v4. The fork is a future concern, not a M6b concern, but the fork's existence is a reminder that the "single v4 format" decision is a "ship the minimum" decision — a future use case could justify a fork.

## Implementation notes

- The `LIPI_STATE_V4_FORMAT` and `LIPI_STATE_V4_VERSION` constants are exported from `src/shared/settingsIOv4.ts`. The constants are used by `parseLipiStateV4` (for the v4 detection check), by `serialiseLipiStateV4` (for the export), by `suggestLipiStateV4Filename` (for the suggested filename), and by `PrivacyDataCard.tsx` (for the format note in the UI). The constants are the single source of truth for the v4 format string and version number.
- The `format` field on the data block (`LipiStateV4Data.format`) is a *duplicate* of the wrapper's `format` field (`LipiStateV4File.format`). The duplication is intentional: the data block's `format` is the "what's in the data block" answer, the wrapper's `format` is the "what's the wire format" answer. For v4, the two are the same, but a future v5 wire format with a v4 data block would have different values for the two fields. The duplication is a future-proofing decision.
- The deep-clone is performed via `JSON.parse(JSON.stringify(draft))`. The round-trip is wrapped in a try/catch: a `JSON.stringify` failure (e.g. a circular reference, which shouldn't happen for the v4 settings) would throw a `TypeError`, and the try/catch re-throws as a `SettingsExportError` with a human-readable message. The error is caught by the PrivacyDataCard's `onExport` handler and rendered as an "Export failed: <message>" toast.
- The deep-clone is performed *after* the draft is built, not during. The draft uses spread syntax (`{ ...w.state }`) to copy the top-level fields, and the JSON round-trip is the deep-clone. The two-step is intentional: the spread syntax is faster than the JSON round-trip for the top-level copy, and the JSON round-trip is the *only* way to deep-clone the inner arrays. The two-step is "shallow copy for the top level, deep clone for the inner arrays".
- The deep-clone is performed *only* for the export, not for the parse. The parse's input is a JSON string, and `JSON.parse(string)` produces a new object graph with no live references. The parse doesn't need a deep-clone. The export is the only place where the live stores' data is "captured", and the export is the only place where the deep-clone is needed.

## References

- `src/shared/settingsIOv4.ts` — the v4 schema, the `LIPI_STATE_V4_FORMAT` and `LIPI_STATE_V4_VERSION` constants, the parser
- `src/shared/settingsIOv4.apply.ts` — the transactional apply
- `src/screens/SettingsProvider/components/PrivacyDataCard.tsx` — the v4 export/import UI, the `snapshotStoresForExport` function, the deep-clone via `JSON.parse(JSON.stringify(...))`
- `src/shared/settingsIOv4.test.ts` — the 23 tests for v4 schema + the `format` / `version` checks
- `HANDOFF.md §9.23` — the M6b per-phase writeup
- `CHANGELOG.md` "Added (M6b — Per-tab state keying + v4 settings export / import)" — the user-facing summary
- `docs/decisions/0081-m6b-persisted-state-on-tab.md` — the `WorkspaceTab.state` data model
- `docs/decisions/0082-m6b-v4-export-v3-migration.md` — the v4 export shape + v3 → v4 import migration
- `docs/decisions/0083-m6b-mirror-back-one-way.md` — the mirror-back direction

---

*Last touched: M6b (June 2026). See `CHANGELOG.md` "Unreleased" for the user-facing summary.*
