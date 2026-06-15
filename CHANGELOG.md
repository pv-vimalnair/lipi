# Changelog

All notable changes to Lipi are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed (Phase 9.3 — Respawn-countdown poll → scoped 1 Hz ticker)

The `LanguageServerCard` settings UI used
to re-render the *whole* card 1×/sec while a
respawn was scheduled (just to update the
"Crashed Xs ago" + "Auto-restarting in Ns…"
labels). The 1 Hz tick was driven by a
card-root `setInterval` that re-ran every
selector in the card, every effect, and every
child. Phase 9.3 scopes the ticker to a tiny
`<RespawnCountdown>` sub-component so the
card stays idle.

- **`src/screens/SettingsProvider/components/LanguageServerCard.tsx`** —
  extracted `<RespawnCountdown>` (exported
  for unit testing). It owns a 1 Hz
  self-rescheduling `setTimeout` chain (no
  `setInterval`) that aligns to wall-clock
  second boundaries via
  `setTimeout(1000 - (Date.now() % 1000))`.
  Renders the full crash header
  ("Crashed Xs ago (exit code N) — M in a
  row. Auto-restarting in Ns…" or
  "Auto-restart disabled after M crashes —").
  The ticker is **opt-in**: only started
  when `respawnInMs !== null` (no respawn
  scheduled → no reason to tick).
- **`src/screens/SettingsProvider/components/LanguageServerCard.tsx`** —
  removed the card-level `setInterval` and
  `nowSec` `useState`. The card's 1 Hz
  re-render budget is now ~0 (it only
  re-renders when the store's
  `crashByWorkspace` map changes — which is
  the same as before Phase 9.3 for "no
  crash" or "crash fired" transitions).
- **`src/screens/SettingsProvider/components/LanguageServerCard.tsx`** —
  the inline crash header JSX was replaced
  with `<RespawnCountdown … />`. `formatAgo`
  is now a pure function taking
  `(ms, nowMs)` instead of
  `(ms, nowSec)`; the `nowMs` is read by the
  sub-component's ticker.
- **`src/screens/SettingsProvider/components/RespawnCountdown.test.tsx`**
  (new) — 10 unit tests for the
  sub-component: renders "Crashed 0s ago"
  on mount; renders "Auto-restarting in
  3s…" when `respawnInMs !== null`; does
  NOT start the ticker when no respawn is
  scheduled; renders "Auto-restart
  disabled" after 5+ consecutive crashes;
  updates the "Xs ago" label on each tick
  (verified with `vi.useFakeTimers`); stops
  the ticker when `respawnInMs` transitions
  from a number to `null` (respawn fired);
  cleans up the ticker on unmount (no
  leaked `setTimeout` — `vi.getTimerCount()
  === 0` after unmount); renders the
  `(exit code N)` + "N in a row"
  annotations; omits "N in a row" for the
  first crash; formats
  "Xs ago" / "Xm ago" / "Xh ago" at the
  right boundaries.
- **Test results**: `vitest` 1095/1095
  pass (was 1085 in Phase 9.1; +10 new
  countdown tests); `tsc --noEmit` clean;
  `cargo test` 350/350 pass (no Rust
  changes; this was a TS-only phase);
  `cargo build` clean.

### Changed (Phase 9.1 — Incremental `textDocument/didChange`)

The `typescript-language-server` integration
used to **re-send the full document text on
every keystroke** via
`textDocument/didChange` (the previous
`sendDidChange` helper had a
`contentChanges: [{ text: model.getValue() }]`
shape). The LSP spec supports *incremental*
changes — a `range` + `text` per edit — and
Monaco's `onDidChangeModelContent` callback
already gives us a precise
`IModelContentChange[]` (range, text,
rangeLength) for every edit, so the
re-send-the-whole-file path was pure
overhead. Phase 9.1 wires the incremental
path.

- **`src/screens/EditorWorkspace/hooks/lspProviders.ts`** —
  new pure helper `convertContentChanges(monacoChanges)`
  that maps each `IModelContentChange`
  to a ranged
  `LspTextDocumentContentChangeEvent`.
  Re-exported `LspTextDocumentContentChangeEvent`
  interface for the wire type. Helper is
  pure (no Monaco / LSP / IPC deps —
  just types).
- **`src/screens/EditorWorkspace/hooks/lspProviders.ts`** —
  `sendDidChange` now takes the full
  `IModelContentChangedEvent` (so we have
  `event.changes` and `event.versionId`)
  instead of just the model. The wire
  `version` is now the post-change
  `event.versionId` (was
  `model.getVersionId()` — same value, but
  the spec says version must be the
  *post*-change version and the event
  captures that explicitly).
- **`src/screens/EditorWorkspace/hooks/useMonacoLspBridge.tsx`** —
  the `onDidChangeModelContent`
  subscription passes the `event` to
  `sendDidChange`. No other behavior
  change.
- **`src/screens/EditorWorkspace/hooks/lspProviders.contentChanges.test.ts`**
  (new) — 11 unit tests for
  `convertContentChanges`:
  single-char insert, single-char delete,
  range replace, multi-line paste
  (text with `\n` chars), multi-change
  formatter event, empty `changes` array,
  whole-document replace, UTF-16 surrogate
  pair preservation, tab + CRLF
  preservation, no input mutation,
  fresh-array return.
- **`src/screens/EditorWorkspace/hooks/useMonacoLspBridge.test.tsx`** —
  4 new tests for the bridge's
  incremental `didChange` flow:
  keystroke → one
  `TextDocumentContentChangeEvent` with
  the inserted char (not the full
  document), 5 KiB file single-keystroke
  does NOT re-send the full file
  (wire size win), multi-change event
  is forwarded in order, empty `changes`
  array is forwarded as an empty
  `contentChanges` array.
- **Test results**: `vitest` 1085/1085
  pass (was 1070 in Phase 9.7; +11 diff
  helper + 4 bridge = 1085); `tsc --noEmit`
  clean; `cargo test` 350/350 pass;
  `cargo build` clean.

### Added (Phase 9.7 — LSP live server output panel)

The `LanguageServerCard` settings UI now has a
**collapsible "Server output" panel** that streams
the language server's stderr in real time. The
user can expand it (it defaults to collapsed) to
see what the server is logging — useful for
debugging "why is hover broken on this file" or
"is the server even seeing my `tsconfig.json`?"
without having to dig into the Rust logs.

- **`src-tauri/src/stdio.rs`** — extended
  `StdioHandle` with a **second stderr buffer**
  (`stderr_log_buffer`, 64 KiB ring) separate
  from the 8 KiB crash-tail one. The same stderr
  reader task that feeds the crash-tail buffer
  also feeds the log buffer and **emits a new
  `lsp://log` Tauri event** for each chunk of new
  bytes. The reader does the line-splitting? No —
  it pushes raw bytes; the JS side splits on
  arrival. UTF-8 lossy decode so a sliced
  multi-byte char becomes a replacement char (the
  same contract as the crash-tail decode).
- **`src-tauri/src/stdio.rs`** — added
  `LSP_LOG_EVENT` constant (`"lsp://log"`) and
  `LspLogPayload` struct (`{ handleId, chunk }`),
  with a round-trip serde test to pin the wire
  format.
- **`src-tauri/src/lib.rs`** — added a new
  `lsp_stdio_read_stderr_log` Tauri command
  (replay-drain; the JS side calls it once per
  workspace on first `handleId` registration to
  catch up on bytes the child wrote before the
  JS side subscribed to `lsp://log`).
- **`src/ipc/lsp.ts`** — added `LSP_LOG_EVENT`
  constant, `OnLspLogPayload` interface,
  `onLspLog` event listener, and
  `lspStdioReadStderrLog` typed wrapper.
- **`src/screens/EditorWorkspace/state/lspClientStore.ts`** —
  added a new `lspOutputByWorkspace: Map<string,
  LspOutputEntry>` slice (entries hold `lines:
  string[]`, `partialLine: string`, `maxLines:
  1000`, `updatedAt: number`). New `LspOutputEntry`
  type + `clearLspOutput(workspaceRoot)` action.
  The store subscribes to `onLspLog` exactly once
  (idempotent via a `logUnlisten` closure ref,
  torn down only by the test suite's
  `__resetLspClientStoreForTests` helper). The
  store does the line-splitting (`\n` boundaries,
  holding the trailing partial line in
  `partialLine` until the next chunk arrives) and
  the FIFO eviction (oldest line dropped when
  `lines.length > maxLines`).
- **`src/screens/SettingsProvider/components/LanguageServerCard.tsx`** —
  added a new `<details>`-style collapsible
  "Server output" panel with:
  - **Click-to-expand header** showing a line
    count (`"Server output (42 lines)"`).
  - **`Auto-scroll` checkbox** (default on) so
    the panel tracks the latest line as it
    streams. Off = manual scroll; the user can
    freeze a moment in time to copy it.
  - **`Clear` button** that calls
    `useLspClientStore.getState().clearLspOutput(workspaceRoot)`.
    The Rust log buffer is *not* touched (the
    child is still running, may write more).
  - **Empty state**: `"No output yet. The server
    logs to stderr on startup and on every
    parsed file. The panel updates in
    real-time."` so the user has a sanity check
    that the server is alive.
  - **Hidden when the kill switch is OFF** (the
    built-in Monaco TS service has no server to
    log).

- **`src/screens/EditorWorkspace/state/lspClientStore.test.ts`** —
  9 new tests for the live "Server output"
  panel: log event appends lines, log event
  holds a partial line until the next chunk,
  log event for unknown handleId is ignored,
  dispose clears the entry, `clearLspOutput`
  empties the in-memory panel (no IPC call),
  `clearLspOutput` is a no-op for unknown
  workspace, replay drain populates the panel
  with pre-subscription bytes, the line buffer
  is bounded by `maxLines` (FIFO eviction of
  oldest 5 lines when 1005 chunks are pushed).
- **`src-tauri/src/stdio.rs`** — 7 new tests for
  the log ring buffer + event wire format
  (mirroring the crash-tail tests but with the
  64 KiB cap): `lsp_log_event_name_is_stable`,
  `lsp_log_payload_serialises_camel_case`,
  `lsp_log_payload_round_trips_with_empty_chunk`,
  `push_stderr_log_below_cap_appends`,
  `push_stderr_log_at_cap_drops_oldest`,
  `push_stderr_log_empty_noop`,
  `stderr_log_buffer_cap_is_larger_than_crash_tail`.

**Test results:** 1070/1070 vitest pass
(+8 from Phase 9.5's 1062); 350/350 cargo pass
(+15 from Phase 9.5's 335, including 7 new
stdio tests for the log ring + 8 new TS tests
for the `lspOutputByWorkspace` slice +
`clearLspOutput` action); `tsc --noEmit` clean;
`cargo build` clean (no warnings — the
`LspLogPayload` struct / `stderr_log_buffer`
field / `stdio_read_stderr_log` function are
all read by the new Tauri command and JS
side, so the "never read" warnings from
Phase 9.5 are gone).

### Added (Phase 9.6 — Real-server completion adapter)

The `typescript-language-server` integration now
**also drives `textDocument/completion`** —
opt-in via a new sub-toggle in the
`LanguageServerCard` settings UI. The trade-off
is latency: Monaco's built-in TS service answers
completion in 5-20 ms; the real server's round-trip
is 50-200 ms. The real server is smarter
(`node_modules` types, `paths` aliases in
`tsconfig.json`, cross-file imports) — useful when
editing library code or non-trivial `tsconfig`
setups. The default is **off** (built-in is
faster for the hot path).

- **`lspKillSwitch.ts`** — extracted a shared
  `readBool` / `writeBool` helper; added
  `getUseRealServerForCompletion` /
  `setUseRealServerForCompletion` (default `false`,
  separate `localStorage` key
  `lipi:lsp:useRealServerForCompletion:v1`,
  independent of the master kill switch).
- **`lspProviders.ts`** — new
  `registerCompletionProvider(client, monaco, selector)`
  function (~190 lines including a
  `fromLspCompletionItem` converter + a
  `fromLspCompletionItemKind` enum mapper).
  Handles both LSP `CompletionItem[]` (the
  `typescript-language-server` shape) and
  `CompletionList` (the wrapper-with-`isIncomplete`
  shape) responses. `triggerCharacters` is
  `[".", '"', "'", "`", "/", "@", "#"]` to match
  what the real server expects. Errors and
  null responses fall through to `{ suggestions: [] }`
  so Monaco uses its built-in completion as a
  safety net.
- **`lspProviders.ts`** — `registerLspProviders`
  now takes an `options: { includeCompletion?: boolean }`
  arg (default `false`). When `true`, the
  completion provider is added to the disposable
  list.
- **`useMonacoLspBridge.tsx`** — reads
  `getUseRealServerForCompletion()` on mount and
  passes `{ includeCompletion: <bool> }` to
  `registerLspProviders`. Toggling the sub-toggle
  in the settings card will only take effect on
  the next file open (the bridge re-reads the
  toggle on each `(editor, workspaceRoot)` effect
  run).
- **`lspClientStore.ts`** — fixed a
  `startPromises` map leak in `dispose()` (the
  `dispose` path now clears the `startPromises`
  entry so a subsequent `getOrCreate` for the
  same workspace starts a fresh client instead
  of returning the now-disposed one's resolved
  promise). Also: `getOrCreate` now re-adds the
  client to the `clients` map when returning an
  inflight (already-resolved) promise after a
  `setState` reset (defensive — only happens
  in tests, but the fix is harmless in
  production).
- **`LanguageServerCard.tsx`** — new "Use real
  server for completion (slower, smarter)"
  toggle, hidden when the master kill switch is
  OFF (because then the real server isn't in
  use at all, so the sub-toggle is meaningless).
  Independent of the master kill switch.
- **`lspProviders.completion.test.ts`** (new, 6
  tests) — covers the conversion of bare
  `CompletionItem[]` responses, `CompletionList`
  wrapper responses, `textEdit.range`
  precedence over word-at-position, null /
  error fall-through, the `includeCompletion`
  opt-in flag, and the LSP documentation
  `{kind, value}` unwrap to a plain Monaco
  string.
- **`lspKillSwitch.test.ts`** (new, 13 tests) —
  covers the default values, malformed-value
  fallbacks, and the independence of the two
  `localStorage` keys.
- **`useMonacoLspBridge.test.tsx`** — 2 new
  tests verify the bridge passes
  `{ includeCompletion: false }` by default and
  `{ includeCompletion: true }` when the
  sub-toggle is on.
- **`LanguageServerCard.test.tsx`** — 2 new
  tests verify the sub-toggle is hidden when
  the master is off, and clicking the
  sub-toggle persists to `localStorage`.

**Test results:** 1055/1055 vitest pass
(+23 from Phase 9's 1032); 335/335 cargo pass;
`tsc --noEmit` clean.

### Added (Phase 9.5 — LSP crash recovery)

The `typescript-language-server` integration now
**survives crashes** without the user noticing
(except for a momentary stutter). When the language
server dies (segfault, OOM, crash on a malformed
file), the store:

1. flips the per-workspace status to `error`,
2. pops up a "Crashed" badge in the
   `LanguageServerCard` settings UI with the last
   ~100 lines of stderr,
3. **auto-respawns** the client on an exponential
   backoff ladder (1s, 2s, 4s, 8s, 16s, 30s, 30s,
   30s, ...) and gives up after 5 consecutive
   crashes so a broken workspace doesn't burn CPU
   forever,
4. tears down the Monaco providers and re-registers
   them on the new client so features (go-to-def,
   hover, rename, ...) just keep working.

- **`src-tauri/src/stdio.rs`** — added a per-handle
  `stderr_buffer` (8 KiB ring buffer, drained into
  by a `spawn_stderr_reader` task) and a
  `spawn_wait_task` that captures the child's exit
  status and emits a new `lsp://crashed` Tauri
  event with `{ handleId, exitStatus, stderrTail }`.
  Also added the `lsp_stdio_read_stderr` Tauri
  command (drains the ring buffer on demand) and a
  test for the ring buffer's eviction policy.
- **`src/ipc/lsp.ts`** — added
  `lspStdioReadStderr` (typed wrapper for the new
  command) and `onLspCrashed(handler)` (typed
  wrapper for the new event).
- **`src/screens/EditorWorkspace/state/lspClientStore.ts`**:
  - subscribes to `onLspCrashed` exactly once per
    store instance (idempotent via a
    `crashUnlisten` closure ref);
  - tracks the `handleId → workspaceRoot` reverse
    map so crash events route to the right
    workspace (handleIds are recycled by the mock
    counter, but the real Rust side uses UUID-like
    strings);
  - adds a `respawn(workspaceRoot)` action for
    the settings card's "Restart server" button —
    disposes the dead client, starts a fresh one,
    and resets the consecutive-crash counter (a
    manual restart is a "I know what I'm doing"
    signal);
  - implements the auto-respawn ladder in
    `scheduleRespawn` (1s, 2s, 4s, 8s, 16s, 30s,
    30s, 30s ...) with a 5-crash cap. Respects the
    kill switch — if the user turns the real server
    off mid-backoff, the pending respawn is
    cancelled;
  - also **fixes a latent `LspClient.shutdown()`
    bug**: the old code cleared the reader timer
    BEFORE awaiting the `shutdown` JSON-RPC
    response, which meant the response was never
    read and `await _request('shutdown', ...)`
    hung indefinitely. The fix is to
    fire-and-forget the `shutdown` / `exit`
    messages (`void this._request(...)`) and call
    `lspStdioClose` BEFORE clearing the timer.
  - exposes a test-only `__resetLspClientStoreForTests`
    action that clears the closure-scoped state
    (timers, handle map, crash listener, start
    promises) — necessary for vitest's
    beforeEach/afterEach to keep tests isolated.
- **`src/screens/EditorWorkspace/hooks/useMonacoLspBridge.tsx`**:
  adds `clientHandleId` to the `useEffect` dep
  list so a respawn (which produces a new
  handleId) tears down the old Monaco providers
  and re-registers on the new client. A
  `useRef` tracks the last handleId the effect
  registered against to avoid double-registering
  on the *initial* mount (the dep transitions
  from `null` to `'handle_xxx'` after the first
  `getOrCreate`).
- **`src/screens/SettingsProvider/components/LanguageServerCard.tsx`**:
  - shows a pulsing "Crashed" badge (respects
    `prefers-reduced-motion`) when the workspace
    has crash info;
  - displays the crash timestamp ("3s ago"),
    exit code, and consecutive-crash count;
  - shows either the auto-respawn countdown
    ("Auto-restarting in 2s...") or "Auto-restart
    disabled" if the kill switch is off;
  - renders a scrollable stderr-tail panel with
    a "Copy diagnostics" button for bug reports;
  - the existing "Restart server" button now
    calls `respawn` (forces an immediate restart
    and resets the backoff ladder).

**Test results:** 1062/1062 vitest pass
(+7 from Phase 9.6's 1055); 367/367 cargo pass
(+32, including 10 new stdio tests for the
stderr buffer and crash event); `tsc --noEmit`
clean.

### Changed (Phase 8 — Inline AI edits (Cmd+K))

The Phase 5b-5 modal-based `Cmd+K` flow is **gone**.
The same `Cmd+K` shortcut now opens an **inline
overlay** anchored to the user's selection in the
Monaco editor: a green-tinted highlight on the
selected range, a sparkle glyph in the gutter, a
small floating toolbar below the selection with
the instruction input, and a Tab / Esc keybinding
for accept / reject. The AI plumbing
(`aiStore.sendEdit`, Rust streaming, friendly
errors) is reused verbatim — Phase 8 is purely
frontend. See `HANDOFF.md` §9.32 for the full
writeup.

**`inlineEditStore` (Zustand)** — replaces
`cmdKStore`

- Renamed file: `state/cmdKStore.ts` →
  `state/inlineEditStore.ts`. Renamed exports:
  `useCmdKStore` → `useInlineEditStore`,
  `openCmdK` → `open`, `closeCmdK` → `reject`,
  `CmdKSelection` → `InlineEditSelection`,
  `CmdKStatus` → `InlineEditStatus`.
- New actions: `accept()` (calls
  `editor.executeEdits` + `editor.pushUndoStop`
  on the live editor from `editorControllerStore`,
  bracketing the AI edit with undo stops so a
  single `Cmd+Z` cleanly reverts the change),
  `reject()` (clears state without calling
  `executeEdits`), `close()` (alias for `reject`),
  `sealProposal(text)` (called by the
  `aiStore.messages` `streaming: false` watcher),
  `fail(kind, message)` (called by the
  `aiStore.requestStatus` error watcher).
- New fields: `proposal: string | null` (the
  sealed AI text, read by the overlay's "After"
  preview), `error: { kind, message } | null`
  (the error view's payload), `streamingMessageId`
  (renamed from the 5b-5 field of the same name).
- Removed: `setInstruction` is unchanged; the
  `setError` / `setDone` / `setStreaming` /
  `resetToIdle` actions are renamed / replaced
  by the new ones above (the rename is the
  only signature change; the per-action
  semantics match the 5b-5 actions of the same
  intent).
- 9 unit tests cover: idle start state, `open`
  clears previous instruction + sets selection,
  `setInstruction` updates, `beginStream`
  transitions to `streaming` + stores the
  message id, `sealProposal` transitions to
  `done` + stores the proposal, `fail`
  transitions to `error` + stores the error,
  `accept` calls `pushUndoStop → executeEdits →
  pushUndoStop` (the Phase 8 undo-bracket
  improvement) and clears state, `reject`
  clears state without `executeEdits`, `close`
  is an alias for `reject`.

**`InlineEditOverlay` (React component)**

- New
  `src/screens/EditorWorkspace/components/InlineAi/InlineEditOverlay.tsx`
  + `InlineEditOverlay.module.css` (and a
  side-effect-imported
  `inlineAi.module.css` for the Monaco
  decoration classes). The component renders
  into a Monaco `IContentWidget`'s DOM node
  (created by `useInlineEditOverlay`).
- 3 visual states (driven by
  `inlineEditStore.status`):
  - `idle` — single-line instruction input
    auto-focused, "Ask AI" button, Enter
    submits, Esc rejects.
  - `streaming` — 3-dot spinner + "AI is
    editing…" label (the partial streamed
    text is NOT shown — per the user's
    explicit "wait for the full response
    then show the diff" choice).
  - `done` — fixed-height `pre` preview of
    the AI's sealed proposal + Accept /
    Reject buttons. The header shows the
    `Tab / Esc` keybinding hint.
  - `error` — friendly error title + hint
    from `getFriendlyError()` (same copy as
    the AIPanel's ErrorBanner) + Try again
    / Dismiss buttons.
- All design tokens read from
  `src/shared/styles/tokens.css` (Rule 7):
  `--color-bg-elevated`, `--color-border-strong`,
  `--color-success`, `--color-danger`,
  `--color-info` / `--color-accent`,
  `--space-*`, `--radius-*`, `--font-*`.

**`useInlineEditOverlay` (Monaco glue hook)**

- New
  `src/screens/EditorWorkspace/hooks/useInlineEditOverlay.tsx`
  — the ONLY place in the codebase that
  talks to Monaco for the inline-edit flow
  (Rule 6). The hook takes the live editor
  from `editorControllerStore` (read on
  every render; the production wiring is
  in `EditorPane.handleMount`'s
  `useEffect`) and:
  1. Creates a
     `editor.createDecorationsCollection([])`
     that highlights the captured selection
     with `.lipi-ai-pending-region` (green
     tint + 2px left border), an inline
     `.lipi-ai-pending-inline` highlight
     for multi-line selections, and a
     `.lipi-ai-pending-glyph` (✦ sparkle
     in the gutter).
  2. Mounts a Monaco `IContentWidget`
     (id: `lipi.ai.inlineEdit.overlay`)
     whose DOM node hosts a
     `createRoot(...).render(<InlineEditOverlay .../>)`
     tree. The widget's `getPosition()` is
     anchored to `{ lineNumber:
     selection.range.endLineNumber, column:
     selection.range.endColumn }` with
     `preference: [BELOW]` so the overlay
     sits just below the last selected
     line. `allowEditorOverflow: true` so
     the overlay is visible even when it
     sits near the viewport edge.
  3. Registers two `editor.addCommand`
     bindings on Monaco's keybinding
     service:
     - `Tab` (KeyCode.Tab = 2) — when
       `status === 'done' && proposal !==
       null`, `accept()`. Otherwise, fall
       through to Monaco's default Tab
       handler via
       `editor.trigger('keyboard', 'tab', null)`.
     - `Escape` (KeyCode.Escape = 9) —
       when `selection` is non-null,
       `reject()`. Otherwise, no-op.
  4. Subscribes to `useInlineEditStore`
     and re-runs the widget / decoration
     update on every change. Returns a
     cleanup function that unmounts the
     React root, removes the content
     widget, clears the decoration
     collection, and unsubscribes from
     the store.
- 4 unit tests (in
  `hooks/useInlineEditOverlay.test.tsx`)
  exercise the `setupOverlay` function
  directly against a mock editor:
  mounts the widget when `selection` is
  set, unmounts when it goes null, adds
  the `.lipi-ai-pending-region` decoration
  on `open()`, clears it on `reject()`.

**`triggerInlineEdit` (shared entry point)**

- New `state/inlineEditTrigger.ts` exports
  a single function `triggerInlineEdit()`
  that reads the live editor from
  `editorControllerStore`, extracts the
  current selection, and dispatches
  `inlineEditStore.open(sel)`. Returns
  `false` when there's no editor / no
  selection (the caller can ignore the
  return — the global `Cmd+K` handler
  and the Command Palette both call
  this). Returning the result lets the
  test suite assert the gating.

**Global `Cmd+K` / `Ctrl+K` handler**

- `EditorWorkspace.tsx`'s `handleCmdK` is
  now a one-liner around
  `triggerInlineEdit()`. The
  `useKeyboardShortcut`'s `enabled`
  predicate is now `editor != null &&
  status === 'idle'` (previously was
  `true`); the `selection` field is read
  inside `triggerInlineEdit`, so an
  empty selection still bails (matching
  the 5b-5 UX).

**Command palette entry**

- New `inlineEdit.open` command in
  `src/shared/commands/commands.ts`
  (group: `AI`, shortcut: `['Cmd', 'K']`).
  The `run` handler is the same
  `triggerInlineEdit()` the keyboard
  binding uses; the `isEnabled`
  predicate mirrors the keyboard's gate
  (`editor != null && status === 'idle'`).
  The import is **lazy** (`await import(...)`)
  to avoid the cycle: `commands.ts`
  lives in `src/shared/`, but the
  trigger lives in the EditorWorkspace
  screen folder. The cost is ~1ms on
  the first run; subsequent runs are
  instant (module cache hit).

**Files deleted (Phase 5b-5 surface)**

- `src/screens/EditorWorkspace/components/AIPanel/CmdKModal.tsx`
  (replaced by `InlineEditOverlay.tsx`).
- `src/screens/EditorWorkspace/components/AIPanel/CmdKModal.module.css`
  (replaced by `InlineEditOverlay.module.css`).
- `src/screens/EditorWorkspace/components/AIPanel/buildCmdKPrompt.ts`
  (renamed + moved to
  `src/screens/EditorWorkspace/components/InlineAi/buildInlineEditPrompt.ts`).
- `src/screens/EditorWorkspace/components/AIPanel/buildCmdKPrompt.test.ts`
  (recreated at
  `components/InlineAi/buildInlineEditPrompt.test.ts`).
- `src/screens/EditorWorkspace/state/cmdKStore.ts`
  (replaced by `inlineEditStore.ts`).
- `src/screens/EditorWorkspace/state/cmdKStore.test.ts`
  (recreated as
  `state/inlineEditStore.test.ts`).
- `AIPanel.tsx` no longer imports or
  mounts `<CmdKModal />` (the modal
  was always mounted at the bottom of
  the panel tree; now nothing is
  mounted there for the inline-edit
  flow).

**Files modified**

- `src/screens/EditorWorkspace/EditorWorkspace.tsx`
  — import swap, handler one-liner,
  `enabled` predicate refinement.
- `src/screens/EditorWorkspace/components/AIPanel/AIPanel.tsx`
  — drop `CmdKModal` import + mount.
- `src/screens/EditorWorkspace/components/EditorPane/EditorPane.tsx`
  — add `useInlineEditOverlay({ editor:
  useEditorControllerStore(s => s.editor) })`
  in the `ActiveEditor` body. The hook
  sets up / tears down the overlay on
  every editor-instance change (tab
  switch).
- `src/shared/commands/commands.ts`
  — new `inlineEdit.open` command +
  lazy import for the trigger.

**Test / build status**

- `npx vitest run`: **1022 passed
  (1022)** across 79 test files (up
  from 1018 in Phase 7). The +4 is the
  9 new `inlineEditStore` tests minus
  the 9 deleted `cmdKStore` tests plus
  the 4 new `useInlineEditOverlay`
  tests.
- `npm run typecheck`: clean (no monaco
  types leak into the store; the store
  is monaco-agnostic as the rest of the
  codebase).
- `npm run build`: clean. The
  `InlineEditOverlay` + `useInlineEditOverlay`
  add ~5 KB raw / ~2 KB gzip to the
  index bundle. Monaco chunk sizes are
  unchanged from Phase 7.
- `cargo test --lib`: **329 passed
  (329)**. Unchanged (no Rust changes).
- 3 pre-existing benign unhandled
  rejections during `vitest run` from
  `aiStore.setupSubscriptions` calling
  Tauri's `listen('ai://chunk' | ...)`
  in the jsdom test environment. These
  are warnings (not test failures) and
  are unrelated to Phase 8.

### Added (Phase 7 — TypeScript intellisense via Monaco)

The editor now has real TypeScript language service:
**autocomplete, error squiggles, go-to-definition,
hover, and find-references** for `.ts` / `.tsx` files,
powered by Monaco's built-in TS service running in a
Web Worker. IntelliSense reads the workspace's
`tsconfig.json` automatically, so a project with
`strict: false` doesn't suddenly see red squiggles
everywhere. A workspace with no `tsconfig.json` falls
back to a sane default (`strict: true`, ES2020,
React JSX) so one-off scripts still get intellisense.
See `HANDOFF.md` §9.31 for the full writeup.

**Monaco language worker wiring (the Vite-side infra)**

- New `src/screens/EditorWorkspace/workers/getMonacoWorker.ts`
  registers `self.MonacoEnvironment.getWorker` to
  resolve the editor + language-service worker
  instances via Vite's `?worker` import syntax.
  Without this, Monaco tries to load workers from a
  CDN URL at runtime — fails offline and adds a
  startup cost we don't need.
- `main.tsx` side-effect-imports the worker
  registration before any `monaco-editor` module
  is evaluated (the order matters; see the comment
  in the file).
- `vite.config.ts` now has `optimizeDeps.include` for
  Monaco's ESM entry + the four worker entry points
  (TS, JSON, CSS, HTML) and `rollupOptions.output.manualChunks`
  to emit each language worker as its own chunk.
- Production build verified: `dist/assets/tsMode-*.js`
  (the TS service worker) is a 23 KB separate
  chunk; `dist/assets/index-*.js` is 750 KB / 212 KB
  gzip, basically unchanged from the pre-Phase-7
  baseline (the +5-10 MB worst case in the plan
  didn't materialise because Monaco only emits
  workers for languages the user actually opens).

**`fs_path_exists` Tauri command**

- New `fs_path_exists(path: String) -> bool` command
  in `src-tauri/src/fs.rs` (cheaper than a full
  `read_file` round-trip — no size probe, no
  encoding sniff). Registered in
  `tauri::generate_handler!` in `lib.rs`. Typed
  wrapper `pathExists` added to `src/ipc/fs.ts`.
- Three new Rust unit tests
  (`path_exists_returns_true_for_existing_file`,
  `path_exists_returns_true_for_existing_directory`,
  `path_exists_returns_false_for_missing_path`).

**`tsConfigStore` (Zustand)**

- New `src/screens/EditorWorkspace/state/tsConfigStore.ts`
  reads + parses the workspace's `tsconfig.json`
  (stripping `//` and `/* * /` comments first) and
  exposes the `compilerOptions` block to the editor.
- Subscribes to the existing `onFsChange` watcher
  for the workspace root (debounced 500 ms) so an
  external save of `tsconfig.json` hot-reloads the
  TS service with the new options.
- 17 new unit tests covering: comment-stripping
  edge cases (string-literal `//`, escaped quotes),
  `parseTsConfig` shape validation, missing file
  fallback, corrupted JSON fallback, no-op
  short-circuit on same root, workspace switch
  (stops old watcher + starts new), `clear()`
  teardown, debounced external-change re-read.

**`EditorPane` integration**

- `handleMount` now (1) one-time-configures
  `monaco.languages.typescript.typescriptDefaults`
  (target ES2020, ESNext modules, strict, ESM
  interop, React JSX, etc.) and
  `javascriptDefaults`, and (2) applies the
  discovered `compilerOptions` from
  `tsConfigStore` via
  `setCompilerOptions(...)`. The setup is
  guarded by a module-level `tsConfigured` flag
  so re-mounts (tab switches) are no-ops.
- A new `useEffect` subscribes to the active
  workspace tab's path and calls
  `tsConfigStore.setFromWorkspace(root)` (or
  `.clear()` on workspace close). A second
  `useEffect` re-applies the discovered config
  whenever the store's `updatedAt` bumps (e.g. on
  the fs-watcher's debounced re-read).

### Changed (Phase 6 — Daily-driver hardening)

The first `tauri build` whose **end-user install
directory is clean**: only `lipi.exe` and the NSIS
uninstaller, no project-lead helper CLIs. Daily-driver
status verified by `install → launch → screenshot →
uninstall` round-trip on a fresh
`C:\Users\Pv Vimal Nair\AppData\Local\Lipi\`. See
`HANDOFF.md` §10 for the full writeup.

**Helper CLIs are no longer shipped to users**

- `sign_license`, `rotate_updater_key`, and the
  production-readiness-pass `gen_license_keypair`
  CLIs are now gated behind a new `internal-tools`
  Cargo feature, OFF by default. The project lead
  builds them locally with
  `cargo build --features internal-tools`. End-user
  installs only contain `lipi.exe` and `uninstall.exe`.
- The source files for all three CLIs were moved
  from `src/bin/` to `src-tauri/tools/`. This is
  required because tauri-bundler 2.1.x walks
  `src/bin/` on disk in addition to reading
  `[[bin]]` entries, and ignores `required-features`
  for the disk-scanned bins (see
  [tauri#15325](https://github.com/tauri-apps/tauri/issues/15325)
  and [tauri#14379](https://github.com/tauri-apps/tauri/pull/14379)
  for the upstream bug + fix). The two-layer
  exclusion (gated + moved) is the only path that
  "just works" in tauri 2.1.x.

**MSI bundling temporarily disabled**

- `tauri.conf.json` now sets
  `bundle.targets = ["nsis"]` instead of `"all"`.
  The WiX-based MSI bundler fails with
  `LGHT0094 : Unresolved reference to symbol
  'WixUI:WixUI_InstallDir'` in 2.1.x — a real
  regression whose root cause has not yet been
  pinned down (the previous build, `bd922b5`,
  produced a working MSI). The NSIS installer
  is the primary distribution format for the
  daily-driver use case; MSI can be re-enabled
  after the underlying issue is fixed. Track in
  HANDOFF §10.

**On-device STT (`m2c-native` feature) — known limitation**

- LLVM 22.1.7 (clang + libclang), CMake 4.3.3,
  and Visual Studio 2022 Build Tools' MSVC 14.44
  are now installed on the project lead's Windows
  machine. The `cargo check --features m2c-native`
  build progresses through bindgen, compiles
  whisper.cpp via CMake, and reaches the final
  Rust link step.
- The build then fails with `error[E0080]:
  attempt to compute '1_usize - 264_usize'` in the
  generated `whisper_full_params` bindings. This
  is an incompatibility between
  `whisper-rs-sys 0.13.1` (pinned in `Cargo.toml`
  via `whisper-rs = "0.14"`) and the latest
  whisper.cpp upstream (which restructured
  `whisper_full_params` in a way the older
  bindgen can't see). The fix is a Cargo dep bump
  on `whisper-rs` / `whisper-rs-sys`, but that
  is deferred — the m2c-native path is a
  "future" feature, the current installer ships
  the M2c Rust code in stub mode (the user-facing
  voice flow is Web Speech, which is fully
  functional). Track in HANDOFF §10.

**Voice preferences + capabilities stores**

- `src/shared/state/voicePreferencesStore.ts` and
  `src/shared/state/voiceCapabilitiesStore.ts`
  (both with co-located `.test.ts` files) are
  the new in-app stores for the user's
  voice-mode preference (web-speech / on-device
  / auto) and the device's runtime STT
  capabilities (what mic / Web Speech / on-device
  model is available). Wired to the
  `SettingsProvider` (On-Device card, Web Speech
  card). See HANDOFF §10 for the data shape and
  the user-facing controls.

**Mobile STT shim (decision 0046)**

- `docs/plugins/lipi-stt-android/README.md` and
  `docs/plugins/lipi-stt-ios/README.md` capture
  the M2c mobile shim spec from decision 0046.
  The mobile STT path is gated behind the
  `lipi-stt-android` / `lipi-stt-ios` plugins
  and the existing Tauri mobile builds. The
  desktop code is unchanged — the shim is
  Tauri-mobile-only.

### Added (Production-readiness pass — `bd922b5`)

The first end-to-end `tauri build` run that produces
**shippable signed Windows installers** from real
production keypairs. Before this pass, `npm run
build:tauri` failed at four distinct points; after
it, the build runs clean and produces both `.msi`
and `.exe` installers plus their updater `.sig`
signatures. See `HANDOFF.md` §9.29 for the full
writeup.

**Code-side blockers resolved**

- **`@tauri-apps/cli` was missing from `package.json`.**
  Added `^2.1.0` as a devDependency (resolved to
  2.11.2). Without it, `npm run build:tauri`
  couldn't find the `tauri` binary and failed
  with `'tauri' is not recognized as an internal
  or external command`.

- **Icon files referenced in `tauri.conf.json`
  didn't exist.** The bundle config listed
  `icons/32x32.png`, `icons/128x128.png`,
  `icons/128x128@2x.png`, `icons/icon.icns`, and
  `icons/icon.ico`; none were in the repo.
  Generated the full set from
  `app-icon.svg` via `tauri icon` (also
  produced the Windows Store square tile sizes,
  iOS AppIcon set, and Android mipmap-anydpi
  layers as a side benefit).

- **`Cargo.toml` had no `default-run`.** Two
  explicit `[[bin]]` entries (`sign_license`,
  `rotate_updater_key`) disabled Cargo's
  auto-detection of `src/main.rs`. Added
  `default-run = "lipi"` so `cargo build` /
  `tauri build` know which binary is the app.

- **`open_devtools()` failed to compile in release.**
  The Tauri 2 crate `#[cfg]`-gates the method to
  debug builds only. Gated the call site with
  `#[cfg(debug_assertions)]`; the IPC command
  itself still exists in release (so the JS-side
  `invoke` doesn't error) but is a no-op.

**Production keypairs**

- **Updater signing keypair** lives in
  `src-tauri/keys/production/`. The private
  `.key` is git-ignored (and should be moved to
  the `TAURI_PROD_UPDATER_KEY` CI secret before
  the first release). The public `.key.pub` is
  committed and embedded in
  `tauri.conf.json`'s `plugins.updater.pubkey`.
  A separate dev keypair lives in
  `src-tauri/keys/dev/` for local builds (private
  git-ignored, public committed).

- **Production license keypair** is generated by
  the new `gen_license_keypair` CLI. The
  previous `licensing::PROD_PUBKEY` was a
  Phase 2 design-phase placeholder; it's now a
  real Ed25519 public key. The 64-char hex
  private key is in
  `src-tauri/keys/production/production-license.key.txt`
  (git-ignored) for local dev; move it to the
  `TAURI_PROD_LICENSE_KEY_HEX` CI secret before
  issuing any real licenses. Any old license
  keys signed with the previous private key are
  now invalid.

**Build-time env-var embedding**

`iap_oauth::read_oauth_credentials_from_env` now
prefers `option_env!`-embedded values over
runtime `std::env::var` reads. A production
build with `LIPI_MS_IAP_CLIENT_ID` /
`_CLIENT_SECRET` / `_TENANT_ID` set during
`cargo build` will have the secrets baked into
the binary (never on disk after the build, never
exposed via `process.env` inspection). Runtime
env vars remain a dev escape hatch — the
build-time value is preferred, the runtime value
is the fallback.

**New files**

- `build-with-key.ps1` — local-dev wrapper that
  sets `TAURI_SIGNING_PRIVATE_KEY` +
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` before
  `npm run build:tauri`. Run this on a Windows
  machine to produce a signed installer outside
  of CI.

- `src-tauri/src/bin/gen_license_keypair.rs` —
  one-shot CLI for generating a fresh Ed25519
  production license keypair. Prints the public
  key as a `const [u8; 32]` array (paste into
  `licensing::PROD_PUBKEY`) and the private key
  as a 64-char hex string (store in
  `TAURI_PROD_LICENSE_KEY_HEX`).

- `src-tauri/keys/README.md` — documents the
  keypair layout (which is the updater key,
  which is the license key), the build-time env
  vars, and the rotation procedure for each.

**Removed**

- `iap_oauth::clear_cache_for_tests` — was
  `#[cfg(test)]`-gated and never called. Dead
  code.

**Test results**

- `tsc --noEmit`: 0 errors
- `vitest`: 1001 passed across 77 files
- `cargo test --lib`: 326 passed / 0 failed
- `tauri build` (Windows): `lipi.exe` (raw
  executable) + `Lipi_0.0.2_x64_en-US.msi` (5.0
  MB MSI) + `Lipi_0.0.2_x64-setup.exe` (3.8 MB
  NSIS) + both installers' `.sig` files —
  clean, no warnings, no missing-pubkey errors.

### Added (Phase 4 — IAP receipt validation)

The final code-focused phase before public
distribution (see HANDOFF §6 "Current phase"
and §9.27 for the full writeup, and
`docs/plans/prod-p4-iap-validation-design.md`
for the design). After Phase 4, the IAP
"Restore from App Store" / "Restore from
Microsoft Store" flow is functional (the Phase
3 stub is gone), and the offline-licensing +
trial + IAP layers are all wired into the same
`LicenseStatusPayload` shape.

**Real IAP receipt validation**

(Implemented in `src-tauri/src/iap.rs`,
`iap_apple.rs`, `iap_microsoft.rs`,
`iap_keypair.rs`, and the corresponding
`src/ipc/iap.ts` + `src/ipc/licensing.ts`.)

- **Apple App Store `verifyReceipt` validation**
  — a new `iap_apple` module that implements
  Apple's `verifyReceipt` protocol (POST to
  `https://buy.itunes.apple.com/verifyReceipt`
  with the receipt + the app-specific shared
  secret; check `status == 0`; verify the
  `latest_receipt_info[0].product_id` matches
  the expected product ID for the requested
  plan; verify the `expires_date_ms` is in the
  future). The shared secret is read at build
  time from the `LIPI_APPLE_IAP_SHARED_SECRET`
  env var via `option_env!` so the binary
  never has the secret on disk in plaintext.
  If the env var is unset (dev build, CI
  without the secret), every call returns
  `iap-shared-secret-missing`.
- **Microsoft Store Broker API validation** —
  a new `iap_microsoft` module that parses
  the Microsoft receipt XML (via a minimal
  string-based parser, no external `xml` dep)
  and validates the `<ProductId>` +
  `<ExpirationDate>`. The OAuth flow is
  stubbed in Phase 4 (the production bearer
  token is read from `LIPI_MS_IAP_BEARER_TOKEN`); a
  full OAuth client-credentials flow is a
  v1.1 follow-up.
- **Per-machine Ed25519 keypair** — a new
  `iap_keypair` module that generates a fresh
  Ed25519 keypair on first IAP redemption,
  stores the privkey + pubkey in the OS
  keychain (under `app.lipi.ide /
  iap-privkey` + `app.lipi.ide / iap-pubkey`),
  and never lets the privkey leave the machine.
  This is the bridge between the IAP proof
  of payment (validated against Apple /
  Microsoft) and the local license binding
  (signed with the per-machine key).
- **Receipt-format dispatcher** — the
  `iap_redeem` Tauri command inspects the
  receipt format (JSON → Apple, XML →
  Microsoft) and dispatches to the matching
  platform validator. The IPC surface
  (`iap_redeem(receipt, plan)`) is unchanged
  from Phase 3; only the implementation
  changed. The dispatcher returns
  `iap-receipt-format-unrecognized` for any
  receipt that doesn't match a known format.
- **`LicensePayload.kid` extension** — the
  `LicensePayload` struct gets a new
  optional `kid` (key id) field that
  identifies which pubkey to use to verify
  the signature. `verify_license` dispatches
  on `kid`: `"trial"` → embedded trial
  pubkey, `"offline"` → embedded production
  pubkey, `"iap-local"` → per-machine pubkey
  from the keychain. Old v0.0.x licenses
  (without `kid`) are treated as `"trial"`
  for backward-compat.
- **New error variant `LicenseError::MissingLocalPubkey`**
  — returned when an IAP-issued license
  references a per-machine pubkey that's no
  longer in the keychain (OS reinstall,
  keychain wipe). The UI humanizes this
  reason with a "re-run the IAP flow"
  message.
- **Updated `humanizeInvalidReason`** — the
  helper now handles all the new `iap-*`
  reason codes (`iap-receipt-format-unrecognized`,
  `iap-sandbox-not-supported`,
  `iap-product-id-mismatch`,
  `iap-expired`, `iap-network-error`,
  `iap-keychain-error`,
  `iap-shared-secret-missing`,
  `iap-azure-credentials-missing`,
  `iap-future-purchase`, etc.) with
  user-friendly text. The Phase 3 stub
  reason (`iap-not-yet-implemented`) is
  kept as a backward-compat fallback.

**New files**

```
docs/plans/prod-p4-iap-validation-design.md
docs/decisions/0097-p4-iap-per-machine-keypair.md
docs/decisions/0098-p4-iap-receipt-format-routing.md
docs/decisions/0099-p4-iap-no-revalidation.md
src-tauri/src/iap_apple.rs
src-tauri/src/iap_microsoft.rs
src-tauri/src/iap_keypair.rs
```

**Changed files**

```
src-tauri/src/iap.rs                 # Rewrote as a real dispatcher
src-tauri/src/licensing.rs           # Added `kid` field + kid-based pubkey dispatch
src-tauri/src/bin/sign_license.rs    # Sets `kid = "offline"` on issued licenses
src-tauri/src/lib.rs                 # Wired up iap_apple, iap_microsoft, iap_keypair
src/ipc/iap.ts                       # Updated JSDoc with the new error reasons
src/ipc/iap.test.ts                  # Pinned the new error reasons
src/screens/SettingsProvider/components/LicenseCard.tsx
                                     # humanizeInvalidReason: added IAP reason paths
src/screens/SettingsProvider/components/LicenseCard.test.ts
                                     # 7 new tests for the IAP reason paths
```

**New tests**

- `src-tauri/src/iap_apple.rs` — 12 new tests
  (validate_apple_response: happy path,
  status code 21002/21004/21007/21010,
  product ID mismatch, expired, future
  purchase, empty latest_receipt_info,
  malformed purchase_date_ms; reason()
  helper for SharedSecretMissing + NetworkError).
- `src-tauri/src/iap_microsoft.rs` — 13
  new tests (parse_microsoft_response:
  product_id + purchase + expiration,
  error_code, missing fields;
  parse_iso8601_to_unix: epoch, 2024 date,
  leap year, too-short, invalid year;
  validate_microsoft_response: valid
  monthly, valid yearly, error response,
  product ID mismatch, expired, future
  purchase, missing product ID;
  reason() helper for AzureCredentialsMissing
  + NetworkError).
- `src-tauri/src/iap_keypair.rs` — 9 new
  tests (hex_lower: zero bytes, max byte,
  32 bytes; parse_hex_32: lowercase,
  uppercase, wrong length, non-hex, round
  trip; service_name).
- `src-tauri/src/iap.rs` — 13 new tests
  (dispatch_receipt: 6 cases including
  leading whitespace, unknown format,
  JSON with product_id, XML with Receipt;
  iap_redeem end-to-end with valid Apple
  + valid Microsoft + unknown format +
  expired + plan mismatch;
  ValidatedIapReceipt From conversions;
  random_jti; plan constants match
  licensing; IapKeypair hex encoding).
- `src-tauri/src/licensing.rs` — no new
  tests in Phase 4 (the `kid` dispatch is
  exercised by the existing tests + the
  new iap_redeem tests; no need to duplicate).
- `src/ipc/iap.test.ts` — 5 new tests
  (active status passthrough,
  iap-receipt-format-unrecognized,
  iap-expired, iap-product-id-mismatch,
  iap-sandbox-not-supported,
  iap-keychain-error).
- `src/screens/SettingsProvider/components/LicenseCard.test.ts`
  — 7 new tests for the new
  humanizeInvalidReason IAP paths.

**Total new tests**: 12 new TS tests
(5 iap.test.ts + 7 LicenseCard.test.ts) +
53 new Rust tests (12 iap_apple + 13
iap_microsoft + 9 iap_keypair + 13 iap +
6 pre-existing round-trip tests
re-exercised with the new `kid` field).

**Verification**

- `cargo test --lib`: 292 passed (up
  from 239).
- `npx vitest run`: 985 passed (up from
  973).
- `npx tsc --noEmit`: clean.
- `npm run build`: clean.
- `cargo check`: clean (no warnings).

### Added (Phase 4.1 — IAP v1.1 follow-ups)

A focused set of v1.1 follow-ups that
fill in items the Phase 4 design doc
explicitly deferred (see HANDOFF §6 "Current
phase: Phase 4.1 — IAP v1.1 follow-ups —
SHIPPED" + §9.28, and
`docs/plans/prod-p4-1-iap-followups-design.md`
for the design). The roadmap coding is now
truly complete; only the design doc
remained. The production-readiness roadmap
was already 100% complete (Phase 3, 5, 4
shipped in the previous turns); Phase 4.1
is a polish-and-completeness pass on the
IAP code path.

**Apple raw-receipt path**

(Implemented in `src-tauri/src/iap_apple.rs`
+ `src-tauri/src/iap.rs` + the corresponding
TS wrappers.)

- **`iap_redeem` now accepts raw base64
  receipts** in addition to the JSON
  response + raw XML formats. The
  `dispatch_receipt` function inspects the
  receipt's first non-whitespace character
  and a few structural markers to route to
  the right validator:
  - JSON response (`{`) → `ReceiptRoute::Apple`
    → `validate_apple_response` (parsed-response
    path, no HTTP call from the Rust side).
  - XML (`<`) → `ReceiptRoute::Microsoft` →
    `parse_microsoft_response` + the
    Microsoft OAuth flow.
  - Base64 (>= 100 chars, all `A-Za-z0-9+/=`) →
    `ReceiptRoute::AppleRaw` →
    `verify_apple_receipt` (the HTTP-calling
    entry point that POSTs to
    `buy.itunes.apple.com/verifyReceipt`).
- **`verify_apple_receipt` is no longer
  `#[allow(dead_code)]`** — it's the entry
  point for the raw-receipt case. The
  dispatcher calls it directly.

**Microsoft OAuth client-credentials flow**

(Implemented in `src-tauri/src/iap_oauth.rs`
+ `src-tauri/src/iap_microsoft.rs`.)

- **Replaced the static bearer token
  (`LIPI_MS_IAP_BEARER_TOKEN`) with a real
  OAuth client-credentials flow.** The new
  `iap_oauth` module:
  - Reads `LIPI_MS_IAP_CLIENT_ID`,
    `LIPI_MS_IAP_CLIENT_SECRET`, and
    `LIPI_MS_IAP_TENANT_ID` from the
    environment at call time.
  - Exchanges them for an access token at
    `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`
    with `grant_type=client_credentials`
    and `scope=https://api.store.microsoft.com/.default`.
  - Caches the access token in memory
    (process-local) for 55 minutes
    (Microsoft's 60-minute lifetime minus
    a 5-minute safety margin).
  - Transparently refreshes on the next
    call when the cache is empty or the
    token is expired.
  - Falls back to the static
    `LIPI_MS_IAP_BEARER_TOKEN` if the OAuth
    env vars are unset (dev escape hatch).
- **`verify_microsoft_receipt` now uses
  the cached OAuth token** instead of
  reading the env var. The static-token
  fallback is preserved as a dev-only
  escape hatch.
- **New error reasons:**
  - `iap-oauth-credentials-missing` (the
    OAuth env vars are unset AND no static
    fallback is configured).

**"Refresh from IAP" Tauri command**

(Implemented in `src-tauri/src/iap.rs` +
`src/ipc/iap.ts` +
`src/screens/License/components/IapRefreshFlow/IapRefreshFlow.tsx`.)

- **New `iap_refresh_license` Tauri
  command** that re-validates an IAP-issued
  license and extends its `exp` (e.g. after
  the user renews their subscription).
  The flow is:
  1. Load + verify the current license.
  2. Check the `kid` field. Only
     `kid = "iap-local"` licenses are
     refreshable (trial / offline-purchase
     licenses return
     `iap-refresh-not-applicable`).
  3. Validate the new receipt (re-uses
     `iap_redeem_inner` for routing).
  4. Compare the new `exp` to the current
     `exp`. If not later, return
     `iap-refresh-no-extension` (don't
     downgrade).
  5. Build a new `LicensePayload` with the
     new `exp`, sign with the same
     per-machine keypair, save.
- **New `iapRefreshLicense` TypeScript
  wrapper** in `src/ipc/iap.ts` with full
  JSDoc.
- **New "Refresh from IAP" button on
  `LicenseCard`** — only visible for
  IAP-issued licenses (detected via the
  new `licenseGetKid` IPC call).
- **New `IapRefreshFlow` wizard on the
  License activation screen** — a 3-step
  flow (paste → running → result) that
  walks the user through pasting the new
  receipt, shows the spinner, and displays
  the new expiration date.
- **New error reasons:**
  - `iap-license-missing` (no license in
    the keychain).
  - `iap-license-invalid` (the existing
    license failed verification).
  - `iap-license-load-failed` (keychain
    read error).
  - `iap-refresh-not-applicable` (the
    existing license is not IAP-issued).
  - `iap-refresh-no-extension` (the new
    receipt's `exp` is not later than the
    current `exp`).
  - `iap-refresh-failed` (sanity check
    for unexpected non-active statuses).

**TransferFlow IAP-license redirect**

(Implemented in
`src/screens/License/components/TransferFlow/TransferFlow.tsx`.)

- **For IAP-issued licenses, the
  TransferFlow result step now shows an
  IAP-specific message** instead of the
  existing email body. The user is told
  to cancel their IAP subscription on this
  machine and re-subscribe on the new one
  (IAP licenses are bound to a single
  machine, and the IAP receipt was paid on
  this machine's Apple ID, not the new
  machine's). The email-generation step is
  skipped (no email to send — the project
  lead can't help with IAP transfers).
- **The deactivation still happens** (so
  the IAP local keypair is cleared) — the
  result step just shows a different
  message.

**New `license_get_kid` Tauri command**

(Implemented in `src-tauri/src/licensing.rs`
+ `src/ipc/licensing.ts`.)

- **New `license_get_kid` Tauri command**
  that returns the `kid` of the current
  license. Returns `None` if there is no
  license in the keychain, or the license
  fails to verify. The UI uses this to
  determine if the license is IAP-issued
  (so it can show the "Refresh from IAP"
  button) vs trial or offline-purchase.

### Changed (Phase 4.1 — IAP v1.1 follow-ups)

- **`verify_apple_receipt` is now a public
  entry point** (removed
  `#[allow(dead_code)]`). The dispatcher
  calls it directly for raw base64
  receipts.
- **`verify_microsoft_receipt` now uses
  the OAuth client-credentials flow** (via
  the new `iap_oauth::get_access_token`
  function) instead of the static
  `LIPI_MS_IAP_BEARER_TOKEN` env var. The
  static-token fallback is preserved as a
  dev-only escape hatch.
- **`humanizeInvalidReason` in
  `LicenseCard.tsx` adds new branches** for
  the new IAP-refresh reason codes:
  `iap-refresh-not-applicable`,
  `iap-refresh-no-extension`,
  `iap-license-missing`,
  `iap-license-invalid`,
  `iap-license-load-failed`,
  `iap-refresh-failed`. Each maps to a
  user-friendly explanation.
- **The `LicenseCard` UI now shows a
  "Refresh from IAP" button** (only
  visible for IAP-issued licenses).
- **The `TransferFlow` UI now shows an
  IAP-specific message** for IAP-issued
  licenses (with the same deactivate
  confirmation flow, but a different
  result step).
- **The `License` activation screen now
  shows a new `IapRefreshFlow` wizard**
  (sibling of `TransferFlow`).

### Decisions (Phase 4.1 — IAP v1.1 follow-ups)

- **Decision #100 (Microsoft OAuth)**: The
  Microsoft bearer token is now obtained
  via the OAuth client-credentials flow
  instead of a static env var. The token
  is cached in-memory (process-local) for
  55 minutes and transparently refreshed.
  The static `LIPI_MS_IAP_BEARER_TOKEN` is
  preserved as a dev-only escape hatch.
  See `docs/decisions/0100-p4-1-ms-oauth.md`.
- **Decision #101 (Refresh license)**: The
  `iap_refresh_license` command is
  additive (no changes to the existing
  `iap_redeem` flow). It only works for
  IAP-issued licenses
  (`kid = "iap-local"`); other licenses
  return
  `iap-refresh-not-applicable`. The new
  receipt's `exp` must be later than the
  current `exp` (no downgrades). See
  `docs/decisions/0101-p4-1-refresh-license.md`.

### Tests (Phase 4.1 — IAP v1.1 follow-ups)

- `src-tauri/src/iap.rs`:
  - `dispatch_receipt_routes_base64_to_apple_raw`
  - `dispatch_receipt_routes_realistic_base64_to_apple_raw`
  - `dispatch_receipt_does_not_route_short_base64_to_apple_raw`
  - `dispatch_receipt_does_not_route_base64_with_non_base64_chars_to_apple_raw`
  - `dispatch_receipt_does_not_route_unicode_to_apple_raw`
  - `dispatch_receipt_does_not_route_xml_to_apple_raw`
  - `is_base64_receipt_accepts_long_alphanumeric`
  - `is_base64_receipt_accepts_long_with_special_chars`
  - `is_base64_receipt_rejects_short_strings`
  - `is_base64_receipt_rejects_non_base64_characters`
  - `refresh_license_error_reason_for_missing_license`
  - `refresh_license_error_reason_includes_kid`
  - `refresh_license_error_reason_includes_timestamps`
  - `refresh_license_kid_constants`
  - `refresh_license_new_payload_has_correct_structure`
  - `refresh_license_preserves_kid`
  (16 new tests)
- `src-tauri/src/iap_oauth.rs`:
  - `parse_token_response_extracts_access_token_and_expires_in`
  - `parse_token_response_rejects_missing_access_token`
  - `parse_token_response_rejects_missing_expires_in`
  - `parse_token_response_rejects_non_json_body`
  - `parse_token_response_rejects_empty_body`
  - `is_token_expired_returns_true_for_none`
  - `is_token_expired_returns_true_for_past_timestamp`
  - `is_token_expired_returns_false_for_fresh_token`
  - `is_token_expired_handles_zero_expiry`
  - `build_cached_token_uses_ttl_from_response`
  - `build_cached_token_caps_ttl_at_55_minutes`
  - `build_cached_token_uses_smaller_ttl_for_short_lived_tokens`
  - `build_token_url_replaces_tenant_placeholder`
  - `build_token_url_handles_empty_tenant`
  - `read_oauth_credentials_returns_none_when_all_unset`
  - `oauth_error_display_credentials_missing`
  - `oauth_error_display_exchange_failed`
  - `oauth_error_display_invalid_expires_in`
  (18 new tests)
- `src/ipc/iap.test.ts`:
  - `iapRefreshLicense > invokes the iap_refresh_license Tauri command with the receipt and plan`
  - `iapRefreshLicense > returns the active status with the new expiration`
  - `iapRefreshLicense > propagates iap-refresh-not-applicable for non-IAP licenses`
  - `iapRefreshLicense > propagates iap-refresh-no-extension for stale receipts`
  - `iapRefreshLicense > propagates iap-license-missing for absent licenses`
  - `iapRefreshLicense > propagates iap-license-invalid for tampered licenses`
  - `iapRefreshLicense > propagates iap-receipt-format-unrecognized when the new receipt is malformed`
  (7 new tests)
- `src/screens/SettingsProvider/components/LicenseCard.test.ts`:
  - `iap-refresh-not-applicable explains the command only works for IAP licenses`
  - `iap-refresh-no-extension explains the new receipt is not later`
  - `iap-license-missing tells the user to use the Restore from IAP button`
  - `iap-license-invalid tells the user to deactivate and re-activate`
  - `iap-license-load-failed mentions keychain permissions`
  - `iap-refresh-failed suggests trying again or pasting a license key`
  (6 new tests)
- `src/screens/License/components/TransferFlow/TransferFlow.test.tsx`:
  - `for an IAP-issued license, the result step shows the IAP-specific message`
  - `for an IAP-issued license, the result step skips the email generation`
  - `for a trial license, the result step shows the existing email body (backward-compat)`
  (3 new tests)

Totals: **50 new tests** (34 Rust + 16 TS).
Full vitest suite: 1001 passed (up from 985).
Full cargo test suite: 326 passed (up from 292).

### Verified (Phase 4.1)

- `npx vitest run`: 1001 passed (up from
  985).
- `cargo test --lib`: 326 passed (up from
  292).
- `npx tsc --noEmit`: clean.
- `npm run build`: clean.
- `cargo check`: clean (no warnings).

### Added (Phase 5 — Production release pipeline)

The last code-focused phase before public
distribution (see HANDOFF §6 "Current phase"
and §9.26 for the full writeup, and
`docs/plans/prod-p5-release-pipeline-design.md`
for the design). After Phase 5, shipping a
release to the public is a one-command
operation: `git tag vX.Y.Z && git push
--follow-tags`.

**The release pipeline**

(New at `.github/workflows/release.yml`. A
GitHub Actions workflow that builds the app
for all 3 desktop platforms in parallel,
signs each artifact, generates the
`updater.json`, and publishes a GitHub
Release.)

- **Matrix builds across macOS, Windows,
  Linux** — the workflow has 3 parallel
  build jobs, one per platform, each on a
  GitHub-hosted runner. The matrix runs
  in parallel; total wall time is ~25
  minutes.
- **Per-platform code signing** — macOS
  builds use `codesign` + `notarytool`
  (Apple notarization service); Windows
  builds use `signtool` (Authenticode);
  Linux builds use `dpkg-sig` for `.deb`.
  Code signing is opt-in (the project
  lead can ship an unsigned v0.1.0 with
  a "Unknown Publisher" warning if the
  cert isn't procured yet).
- **Updater artifact generation** —
  Tauri's `bundle.createUpdaterArtifacts:
  true` flag (now in `tauri.conf.json`)
  generates `.sig` files alongside each
  installer. The `updater-json` job reads
  the `.sig` files and produces
  `updater.json` with the right per-
  platform URLs + signatures.
- **GitHub Release publishing** — the
  `release` job uploads all 3 platforms'
  artifacts + `updater.json` to a GitHub
  Release tagged `vX.Y.Z`. The existing
  `tauri.conf.json` endpoint
  (`https://github.com/lipi-dev/lipi/releases/latest/download/updater.json`)
  auto-points to the new release.
- **Smoke test** — after publishing, the
  `smoke-test` job (matrix across 3 OSes)
  downloads each platform's binary and
  launches it in a CI runner. The
  process is monitored for 5 seconds;
  if it exits early, the release is
  considered broken (the project lead
  must unpublish the release, fix the
  bug, and re-tag).

**The CI guards**

(New at `.github/workflows/ci.yml`. The
on-PR / on-push-to-main CI that catches
the two most common "release went out
broken" bugs at PR time, not at customer
time.)

- **Version-mismatch guard** — fails the
  build if `package.json`,
  `src-tauri/Cargo.toml`, and
  `src-tauri/tauri.conf.json` have
  different version strings. Catches
  "I bumped one but forgot the other
  two" bugs.
- **Dev-keypair-reference guard** — fails
  the release workflow (not PR CI; that
  would block every merge to main until
  the project lead rotates the key) if
  `tauri.conf.json`'s
  `plugins.updater.pubkey` still matches
  the committed dev pubkey
  (`lipi-dev.key.pub`). Catches "I
  forgot to rotate the keypair" bugs at
  release time.
- **Test matrix across 3 OSes** — the
  test job runs the full vitest +
  cargo test + tsc + vite build + cargo
  check suite on all 3 platforms
  (macOS, Windows, Linux) in parallel.
  Catches platform-specific bugs
  (e.g. macOS Keychain vs Windows DPAPI
  edge cases).

**The `rotate_updater_key` CLI**

(Implemented at `src-tauri/src/bin/
rotate_updater_key.rs` with the pure
logic in
`src-tauri/src/rotate_updater_key.rs`.
A one-shot Rust binary that the project
lead runs from a terminal when rotating
the Tauri updater signing keypair.)

- Reads a new pubkey from a file
  (`.key.pub` produced by `tauri signer
  generate`).
- Validates the new pubkey (must be
  valid base64 + must look like a
  Tauri updater pubkey; the format is
  "untrusted comment: ..." on the
  first line, base64 on the second).
- Patches `tauri.conf.json`'s
  `plugins.updater.pubkey` field in
  place (creates the `plugins` /
  `updater` keys if missing).
- Prints a unified-diff to stdout for
  human review.
- Writes the patched JSON to
  `tauri.conf.json`.
- 14 unit tests cover argument
  parsing, pubkey validation, and
  JSON patching edge cases.

**The `updater_health` module**

(Implemented at `src-tauri/src/
updater_health.rs` and `src/ipc/
updaterHealth.ts`. A small Tauri
command that probes the updater
endpoint on demand so users on
restricted networks can self-diagnose
"the updater doesn't work" issues.)

- Single HTTP GET to the configured
  updater URL, 5-second timeout.
- Returns `Reachable { status }` on
  any 2xx/3xx response (including 404 —
  the host is alive even if the file
  isn't there yet).
- Returns `Unreachable { reason }` on
  a network error (timeout, connection
  refused, DNS failure, TLS failure).
- Wired into the **About modal** as a
  new "Updater" row in the meta `<dl>`,
  showing a green "✓ reachable" pill
  (or red "✗ unreachable" with the
  reason in the tooltip).
- 5 unit tests cover the success /
  failure paths + the serde wire
  format.

**The `RELEASING.md` doc**

(New at `docs/RELEASING.md`. A 5-step
process for shipping a release:
pre-flight, bump versions, tag, wait
for CI, verify. Includes a CI secrets
cheat sheet + a "how to generate the
production keypair" appendix.)

### Changed (Phase 5 — Production release pipeline)

- **`src-tauri/tauri.conf.json`** — added
  `bundle.createUpdaterArtifacts: true`
  (Tauri generates `.sig` files
  alongside installers) + a
  `bundle.macOS.minimumSystemVersion`
  field (10.15 Catalina, the minimum
  Tauri's WebKit requires).
- **`src/shared/components/AboutModal/
  AboutModal.tsx`** — added the
  "Updater" row in the meta `<dl>` that
  displays the `updater_health_check`
  result. Includes a new
  `UpdaterHealthPill` sub-component
  with 3 states (checking, reachable,
  unreachable).
- **`src-tauri/src/lib.rs`** — registered
  the new `updater_health_check` Tauri
  command + made the `rotate_updater_key`
  module public so the bin can use it.

### Decisions (Phase 5 — Production release pipeline)

- **#94-p5-prod-keypair**: ship a
  separate production updater keypair
  (don't reuse the dev keypair for
  releases). The dev keypair's password
  is in the repo; a public release
  signed with it would be the
  equivalent of "no signing".
- **#95-p5-update-server**: use GitHub
  Releases as the updater server (don't
  run our own S3 + CloudFront, dedicated
  server, etc.). GitHub Releases is
  free + integrated + fast enough for
  the v0.1.0 user base.
- **#96-p5-ci-platforms**: matrix builds
  across 3 OSes (macOS, Windows, Linux)
  in CI, not Docker cross-compilation.
  Each Tauri build needs a native
  toolchain; GitHub-hosted runners
  are platform-native + ephemeral +
  free for public repos.

### Tests (Phase 5 — Production release pipeline)

- **5 new Rust unit tests** in
  `src-tauri/src/updater_health.rs`
  (covering the HTTP probe's success /
  failure paths + the serde wire format).
- **14 new Rust unit tests** in
  `src-tauri/src/rotate_updater_key.rs`
  (covering argument parsing, pubkey
  validation, and JSON patching edge
  cases).
- **4 new TypeScript tests** in
  `src/ipc/updaterHealth.test.ts`
  (covering the IPC wrapper's wire
  shape + error propagation).
- **1 new test** in `src/shared/components/
  AboutModal/AboutModal.test.tsx`
  (verifying the new "Updater" row
  renders the checking pill in the
  initial state).
- **3 new tests** in `AboutModal.test.tsx`
  for the new `UpdaterHealthPill`
  sub-component (one per state:
  checking, reachable, unreachable).
- **Total: 27 new tests** (23 Rust + 8
  TypeScript). The full vitest suite
  (973 tests across 77 files) and the
  full cargo test suite (239 lib tests
  + 6 iap tests + 15 sign_license
  tests = 260 tests) pass cleanly.

### Added (Phase 3 — Subscription UX + offline-purchase flow)

The second step of the "Lipi to Paid Public Launch" roadmap
(see HANDOFF §6 "Current phase" and §9.25 for the full
writeup, and `docs/plans/prod-p3-subscription-ux-design.md`
for the design). Phase 2 shipped the offline-license
*primitives*; Phase 3 ships the **complete user-facing
subscription flow** on top of those primitives.

**The four new UI surfaces**

(All implemented in
`src/shared/components/{LicenseGate,TrialBadge,ExpiryBanner}/`
and `src/screens/License/components/{TransferFlow,PricingCard}/`.
The mapping from `LicenseStatus` to which surface renders
is in `src/shared/components/LicenseGate/licenseSurfaces.ts`,
a single pure function with 20 unit tests pinning every
state × surface cell.)

- **`LicenseGate`** — a full-screen block (when the status
  is `expired` or `invalid`) or a dismissable nag modal
  (when the status is `gracePeriod`). Mounted at the
  AppRoot level so it overlays every screen. The
  gate's dismissal state is in `sessionStorage` (per-
  session, not persisted), so the nag reappears on next
  launch.
- **`TrialBadge`** — a small pill in the title bar's right
  slot showing the current status. Three tones (red /
  amber / neutral) mapped to design tokens. Renders
  nothing for the "good standing" states (active > 7 days,
  unactivated).
- **`ExpiryBanner`** — a red horizontal banner between
  the title bar and the workspace tabs. Renders for the
  final-week trial (≤ 3 days remaining) and the grace
  period. Dismissable per-session.
- **"Transfer to a new machine"** — a 3-step wizard on
  the License activation screen (and a "Transfer" button
  on the LicenseCard in Settings) that deactivates the
  license on this machine and generates a pre-formatted
  email to send to the project lead for re-issuing on a
  new machine.
- **In-app paywall** — a 3-tier pricing card (Free trial,
  $5/month, $50/year) above the activation form. The
  paid tiers open the project website via the system
  browser (plain `<a target="_blank">`); the trial tier
  is non-interactive (the trial is auto-generated).

**The `iap_redeem` stub**

(Implemented in `src-tauri/src/iap.rs` and
`src/ipc/iap.ts`. The stub returns
`LicenseStatus::Invalid { reason:
"iap-not-yet-implemented: ..." }` for any input.)

- New Tauri command `iap_redeem(receipt, plan)` that the
  UI's "Restore from App Store" flow calls. Phase 4 will
  fill in the real Apple / Microsoft receipt validation
  behind the same command signature; the UI doesn't
  need to change.

**The `sign_license` CLI**

(Implemented in `src-tauri/src/bin/sign_license.rs` and
`[[bin]]` entry in `src-tauri/Cargo.toml`.)

- A separate Rust binary that the project lead runs from
  a terminal to issue production license keys from
  purchase emails. Takes `--plan <monthly|yearly>`,
  `--machine <64-char hex fingerprint>`, and
  `--out <path/to/license.txt>`. Reads the production
  private key from `TAURI_PROD_LICENSE_KEY_HEX` (32 hex
  chars) at invocation time — the key is never in
  source control. Builds a `LicensePayload`, signs it
  with the same `licensing::sign_payload` function as
  the trial-generation flow, and writes the
  `LIP1.…` key to `--out`. Returns 0 on success,
  non-zero (1-5) on failure.

**The "Activate a license" Command Palette entry**

(In `src/shared/commands/commands.ts`.)

- A new `license.openActivation` command in the
  "License" group. Reachable via `Cmd-Shift-P` (or
  `Ctrl-Shift-P`). Navigates to the License activation
  screen.

**The `'license'` route**

(In `src/shared/state/appStore.ts` and `src/main.tsx`.)

- A new `Screen` variant `'license'`. The License
  activation screen is now an overlay reachable from
  any screen (same isolation rule as Settings).

### Changed (Phase 3 — Subscription UX + offline-purchase flow)

- **`src/main.tsx`** — the `AppRoot` now mounts
  `<LicenseGate />` (so the gate overlays every screen)
  and the router has a new `activeScreen === 'license'`
  branch (renders `<License />`).
- **`src/screens/EditorWorkspace/EditorWorkspace.tsx`** —
  the editor now renders `<ExpiryBanner />` between the
  TitleBar and the WorkspaceTabs.
- **`src/screens/EditorWorkspace/components/TitleBar/TitleBar.tsx`** —
  the title bar now renders `<TrialBadge />` in its
  right slot.
- **`src/screens/License/License.tsx`** — the activation
  screen now renders `<PricingCard />` above the form
  and `<TransferFlow />` below the fingerprint section.
- **`src/screens/SettingsProvider/components/LicenseCard.tsx`** —
  the settings card now has a "Transfer to a new
  machine" button that navigates to the License screen.
- **`src/shared/commands/commands.ts`** — the `Command.group`
  union now includes `'License'`. The
  `commands.test.ts` test pins the new union member.

### Decisions (Phase 3 — Subscription UX + offline-purchase flow)

- **#89** — A single pure `licenseSurfaces` helper maps
  `LicenseStatus` to UI surfaces. The 4 new components
  (gate, badge, banner, transfer flow) are thin
  render-only wrappers.
- **#90** — Trial badge tone thresholds: red ≤ 3 days,
  amber ≤ 7 days, neutral > 7 days. Active with > 7
  days shows no badge.
- **#91** — Grace period is a dismissable nag modal, NOT
  a hard block. The hard block is reserved for `expired`
  and `invalid`. The nag's dismissal state is in
  `sessionStorage`.
- **#92** — A separate Rust `sign_license` CLI for
  production key issuance. The production private key
  is read from `TAURI_PROD_LICENSE_KEY_HEX` at
  invocation time (never in source control).
- **#93** — Ship the IAP `iap_redeem` command as a stub
  in Phase 3; Phase 4 fills in the real Apple / Microsoft
  receipt validation.

### Tests (Phase 3 — Subscription UX + offline-purchase flow)

- 20 unit tests for `licenseSurfaces` (every
  state × surface cell).
- 12 unit tests for `TrialBadge` (renders nothing for
  the "default" states, renders the right tone / label
  for each, click navigates to the License screen).
- 9 unit tests for `ExpiryBanner` (renders for trial ≤
  3 days + grace period; dismissable; "Activate now"
  navigates).
- 9 unit tests for `LicenseGate` (renders nothing for
  the "default" states, hard block for expired /
  invalid, nag for grace period, dismissal works, "I' do
  it later" click hides the nag).
- 5 unit tests for `TransferFlow` (initial step renders,
  confirm calls `deactivate` IPC, success step shows the
  email body, cancel returns to initial, grace-period
  plan shows in the email body).
- 9 unit tests for `PricingCard` (3 tiers, trial is
  non-clickable, monthly + yearly are clickable
  `<a target="_blank">` with the correct href).
- 3 unit tests for the `iapRedeem` TS wrapper (wire
  shape, "not yet implemented" reason, plan type
  narrowing).
- 5 Rust unit tests for `iap::iap_redeem` (empty
  receipt, non-empty receipt, monthly plan, yearly
  plan, unknown plan).
- 15 Rust unit tests for `sign_license` (plan duration
  for monthly / yearly / unknown, machine fingerprint
  validation for 64 / 63 / 65 / uppercase / non-hex /
  empty chars, plan validation, random JTI uniqueness).

Phase 3 total: **67 vitest tests + 20 Rust tests = 87
new tests.** Total project test count: 965 vitest + 246
Rust = 1211 tests, all passing.

### Added (Phase 2 — Offline licensing layer)

The first step of the "Lipi to Paid Public Launch" roadmap
(see HANDOFF §6 "Current phase" and §9.24 for the full
writeup, and `docs/plans/prod-p2-licensing-design.md` for
the design). Lipi now has an **offline-verifiable
subscription**: a license key is a JWS-style compact
signed document (`LIP1.<base64url(payload)>.<base64url(signature)>`)
using Ed25519. The Rust side embeds the public key
(production + trial) and verifies the signature offline —
no server round-trip, no phone-home, no revocation list.
This matches the project's "no backend, ever"
architectural rule (Decision #17) and the user's choice
to keep license validation offline for the paid-public-
launch roadmap.

**The license key shape**

(`docs/plans/prod-p2-licensing-design.md`, implemented
in `src-tauri/src/licensing.rs`):

- A license is `"LIP1." || base64url(payload_json) || "." || base64url(signature)`.
- The payload is JSON with seven fields: `format`
  (fixed `"lipi-license-v1"`), `plan` (`"trial" | "monthly" | "yearly"`),
  `iat` / `nbf` / `exp` (Unix timestamps), `sub` (the
  machine fingerprint — SHA-256 of
  `hostname || "\n" || username || "\n" || mac_address`,
  hex-encoded to 64 chars), and `jti` (a random per-license
  id, 16 random hex chars).
- The signature is Ed25519 (RFC 8032) over
  `"LIP1." || base64url(payload)`. The production
  public key is embedded as a `const [u8; 32]`; the
  trial public key is embedded as a separate const.
  The trial private key is also embedded (a deliberate
  trade-off: 14-day max `exp` bounds the worst case).
  The production private key is **not** embedded; it's
  stored in the project lead's CI secret store.

**The trial flow**

- A 14-day trial is auto-generated on the first
  `license_get_status` call after install. The trial
  payload is signed with the trial private key, and the
  resulting `LIP1.…` key is stored in the OS keychain
  (service `app.lipi.ide`, user `license`).
- The trial is overwritten when the user activates a
  paid license. A user who wants to "reset" the trial
  has to uninstall + reinstall (and lose their
  settings — this is a feature: it prevents trial-reset
  abuse).
- Re-generating the trial on `license_deactivate()` lets
  a user "transfer to a new machine" by deleting the
  current license, copying their settings, and
  reactivating on the new hardware (Phase 3 will
  polish this; Phase 2 is the minimum).

**Tauri commands** (`src-tauri/src/licensing.rs`):

- `license_get_status()` → `LicenseStatus`. Reads the
  keychain, verifies the signature, checks the
  machine fingerprint, and returns the derived status
  (`Unactivated` / `Active` / `GracePeriod` / `Expired`
  / `Trial` / `Invalid`).
- `license_activate(key)` → `LicenseStatus`. Verifies
  the pasted key, stores it in the keychain, returns
  the new status. On failure, returns
  `Invalid { reason }` without modifying the keychain.
- `license_deactivate()` → `LicenseStatus`. Deletes
  the keychain entry. The next `license_get_status`
  call auto-generates a new 14-day trial.
- `license_get_machine_fingerprint()` → `string`.
  Used by the activation screen so the user can
  include it in a "please issue me a license"
  support email.

**TS layer** (`src/ipc/licensing.ts`):

- The four IPC wrappers + the `LicenseStatusPayload`
  type mirror the Rust side. The `LicenseStatusPayload`
  is a tagged union (`{ kind: 'active', ... }` /
  `{ kind: 'invalid', reason: '...' }` / etc.) using
  camelCase JSON. The `src/shared/state/licenseStore.ts`
  Zustand store caches the status in memory (hydrate
  once at app startup, refresh on activate / deactivate,
  load machine fingerprint on demand).

**UI** (`src/screens/License/License.tsx` +
`src/screens/SettingsProvider/components/LicenseCard.tsx`):

- **Activation screen** (`License.tsx`): a single-column
  form with a labelled textarea for the key, an
  "Activate" button, a "Get a license →" link to the
  pricing page, and a machine-fingerprint display.
- **Settings card** (`LicenseCard.tsx`): the existing
  SettingsProvider's Privacy & data section now has a
  "License" card showing the current status, a
  "Show machine fingerprint" button, and a
  "Deactivate" button (with a confirm step).
- The full-screen gate (block the workspace when
  unactivated / expired) and the title-bar trial
  badge are Phase 3.

**Verification**

- `cargo test licensing` — **21 tests** covering the
  sign / verify round-trip, signature rejection on
  tampered payload, signature rejection on wrong
  signing key, malformed-key rejection, oversize
  field rejection, machine fingerprint shape + stability,
  status derivation for all six variants
  (active / grace / expired / trial / unactivated /
  invalid-not-yet-valid), keychain integration (mock
  keychain via the `keyring` crate's `MockCredentialBuilder`),
  and the trial generation flow.
- `npm test src/shared/state/licenseStore.test.ts` —
  **10 tests** covering the `null → populated`
  transition, hydrate idempotency, refresh
  non-idempotency, activate / deactivate IPC wiring,
  whitespace trimming on activate, machine fingerprint
  cache, and the `invalid` status surfacing on bad keys.
- `npm test src/screens/SettingsProvider/components/LicenseCard.test.ts` —
  **17 tests** covering the `statusLine` and
  `humanizeInvalidReason` pure helpers (singular /
  plural day wording, plan capitalisation, machine-
  mismatch / not-yet-valid / verification-failed /
  empty-key reason strings, and the unactivated
  fallback).
- `npm run typecheck` — clean.
- `npm run build` — clean (the existing pre-M6b
  chunk-size warnings are unchanged).
- `cargo check` — clean (no warnings).

**Threat model**

- The "no backend, ever" rule (Decision #17) means we
  cannot do online license validation. The trade-offs
  are documented in the design doc and Decision #85.
  In short: extracting the trial private key from the
  binary is bounded by the 14-day `exp`; a paid license
  is bound to a single machine by the `sub` (fingerprint)
  claim, and a tampered keychain entry fails signature
  verification on the next status call.
- We don't try to defend against debugger-driven
  bypasses or VM cloning. The threat model matches
  JetBrains / Sublime / every other desktop tool.

**Out of scope (Phase 2 does NOT do)**

- No payment processing (Phase 4).
- No IAP integration (App Store / Microsoft Store; Phase 4).
- No "transfer to new machine" UI flow (Phase 3).
- No team / per-seat / volume licensing (a future pricing tier).
- No license-server CLI tool (Phase 4's
  `sign_license --plan yearly --machine <fp>`).

### Added (M6b — Per-tab state keying + v4 settings export / import)

M6a shipped the tab *data model* and the tab *strip*; M6b ships the per-tab *state* — file-tree expansion, selected row, open editor tabs, active editor tab — persisted on the tab itself, so a user can switch to a different tab and come back to the exact same view. The settings export / import format is bumped to v4: the v3 single `workspace.currentPath` shape is replaced with a `workspace.workspaces[]` array of `{ id, path, addedAt, state: WorkspaceTabState }` rows, and the v3 → v4 import migration is automatic (a v3 file is detected on parse and migrated in-memory, so existing v3 exports continue to import seamlessly).

**Data model**
(`src/shared/state/workspaceStore.ts`):

- The M6a `WorkspaceTab` had three
  fields: `id`, `path`, `addedAt`.
  M6b adds a fourth: `state:
  WorkspaceTabState`. The state has
  four fields — `expandedDirs: string[]`,
  `selectedPath: string | null`,
  `openEditorTabPaths: string[]`,
  `activeEditorTabPath: string | null` —
  the minimum set of "the user came
  back to this tab and the view is
  exactly how they left it".
  `EMPTY_TAB_STATE` is the canonical
  zero value; `createWorkspaceTab(path,
  id, addedAt, state)` now takes an
  optional 4th argument defaulting to it.
- The four fields were chosen by audit;
  per-tab scroll position, font size,
  theme, recents, git / tool / voice
  settings are parked in M6c (see HANDOFF
  §6 "Next:") so the M6b data model can
  stabilise before the export shape is
  widened again.
- `useWorkspaceStore` gains two new
  actions: `setTabState(tabId, partial)`
  (a partial merge into the active
  tab's state — used by the mirror-back
  effects) and `replaceTabState(tabId,
  state)` (a full replace — used by the
  tab-switch rehydration effects).
- `useFileTreeStore` gains
  `setExpandedAndSelected(expanded,
  selectedPath)` (replaces the live
  expansion + selection atomically,
  used by the file-tree rehydration
  effect).
- `useEditorTabsStore` gains
  `replaceAll(order, tabs, activeId)`
  (replaces the open-tab order, the
  open-tab record, and the active tab
  atomically, used by the editor-tabs
  rehydration effect).
- `useActiveTabState(state)` is a
  derived helper that returns the active
  tab's `state` (or `EMPTY_TAB_STATE`
  if no tab is active) — the canonical
  way to read the persisted per-tab
  state for the current view.
- The `hydrate` step is defensive
  about pre-M6b tabs persisted under the
  v2 key: any tab row that lacks a
  `state` field (or has a partial /
  corrupt one) is normalised to
  `EMPTY_TAB_STATE` on read, so users
  with a pre-M6b binary plus an M6b
  binary side-by-side don't see a
  "selected row is `undefined`" crash.
  The three shape fields are still
  strictly validated (`id` string, `path`
  string, `addedAt` number); only the
  new `state` field is permissive
  (synthesise defaults, don't drop the
  tab).

**Mirror-back architecture**
(`useFileTree.ts`, `useEditorTabs.ts`):

- The `WorkspaceTab.state` is the
  *persisted source of truth* for
  per-tab UI state. The two live stores
  (`useFileTreeStore`,
  `useEditorTabsStore`) are the *live,
  transient view* of that state for the
  currently active tab. The two views
  stay in sync via two `useEffect`
  hooks, one in each hook file.
- **Tab switch rehydration.** When the
  active workspace tab changes
  (`activeId` updates), the new tab's
  `state` is read from
  `useWorkspaceStore.getState()` and
  pushed into the respective live
  stores. For the file tree, the live
  `setExpandedAndSelected` action
  replaces the live expansion +
  selection. For editor tabs, the live
  `replaceAll` action replaces the
  open-tab order, the open-tab record,
  and the active tab — and the
  rehydration also re-reads each file
  from disk via the existing `readFile`
  IPC command, so the editor's contents
  are guaranteed to be fresh (only the
  path is in the persisted state, not
  the file content).
- **Mutation mirror-back.** When user
  interactions (toggle a directory row,
  click a file row, open a new file in
  the editor, close an editor tab,
  activate a different editor tab)
  modify the live stores, those changes
  are immediately mirrored back to the
  active `WorkspaceTab.state` via the
  `useWorkspaceStore.setTabState(tabId,
  partial)` action. The mirror-back is
  a `useWorkspaceStore.subscribe` effect
  that fires on any change to the live
  store and forwards the new live values
  into the persisted state. The result
  is a one-way flow: user interactions
  → live store → persisted state, with
  the persistence automatically written
  by the existing localStorage writeJson
  helper inside the action.
- The end-to-end UX: open tab A, expand
  a deep tree, open three editor tabs,
  switch to tab B (with its own
  expansion + editor tabs), switch back
  to tab A — the file tree and editor
  tabs are exactly how they were left.
  No "save" button, no debounce, no
  reload.

**v4 settings export / import**
(`src/shared/settingsIOv4.ts`):

- New module exports
  `LipiStateV4Data` and `LipiStateV4File`
  (the on-disk JSON shape),
  `buildLipiStateV4` (assemble from
  live stores), `serialiseLipiStateV4`
  (JSON.stringify with a 2-space indent
  + trailing newline), the privacy
  checker `serialisedFileLooksPrivateV4`
  (returns `false` for v4 — by-design,
  v4 exports no API keys, no file
  contents, only paths + preferences),
  and `parseLipiStateV4` (parse + auto-
  detect v3 + migrate + validate).
- The v4 file wrapper is
  `{ format: 'lipi-state-v4', version: 4,
  exportedAt: <ISO 8601>, data:
  LipiStateV4Data }`; the data block is
  `{ format, version, workspace:
  ExportedWorkspaceV4, voicePreferences,
  toolSettings }` where
  `ExportedWorkspaceV4 = { workspaces:
  ExportedWorkspaceTabV4[], activeId:
  string | null, recents: string[] }`
  and `ExportedWorkspaceTabV4 = { id,
  path, addedAt, state: WorkspaceTabState
  }`. The `format` constant is
  `LIPI_STATE_V4_FORMAT`; the `version`
  is `LIPI_STATE_V4_VERSION`. See
  Decision #84 for why `format` and
  `version` are separated.
- The v3 → v4 import migration is
  in-memory and automatic: `parseLipiStateV4`
  inspects the `version` field on
  input, and any input that has
  `currentPath` (and no `workspaces[]`)
  is treated as v3 and migrated via
  `migrateV3DataToV4(data)` before
  validation. The migration wraps the
  v3 `currentPath` in a single
  `WorkspaceTab` with `EMPTY_TAB_STATE`,
  generates an id, and sets `activeId`
  to the new id (or `null` if
  `currentPath` was `null`). A v3 file
  and a v4 file go through the same
  import code — there is no separate
  `parseLipiStateV3` v4 path. The v3
  schema is validated by a dedicated
  `validateV3Workspace` function inside
  `settingsIOv4.ts` (it doesn't rely on
  `settingsIOv2.parseLipiStateV2`,
  which strictly enforces `version: 2`
  and would reject v3 input).
- The privacyDataCard's
  `snapshotStoresForExport` is
  refactored to produce a v4 snapshot
  with a deep-cloned per-tab state (so
  the snapshot is a true point-in-time
  copy, not a reference into the live
  store).

**Transactional apply**
(`src/shared/settingsIOv4.apply.ts`):

- `applyLipiStateV4(data: LipiStateV4Data)`
  is the canonical "import a v4
  settings file" function. It uses the
  same transactional design as the v3
  apply (Decision #67, S3):
  `snapshotStores()` → mutate the
  three target stores
  (`useWorkspaceStore`,
  `useVoicePreferencesStore`,
  `useToolSettingsStore`) →
  `restoreSnapshots()` on any error.
  The "any error" includes the
  validation errors thrown by the
  per-tab `validateWorkspaceTabState`
  + `validateWorkspaceTab` +
  `validateWorkspace` +
  `validateVoicePreferences` +
  `validateToolSettings` functions. A
  user who imports a corrupt v4 file
  gets an "Import failed" toast and
  their existing settings are
  unchanged.

**Preview diff**
(`src/shared/settingsIOv4.preview.ts`):

- `computeLipiStateV4ImportPreview(current,
  incoming) →
  LipiStateV4ImportPreview` returns
  five sections of incoming changes:
  workspace tabs (added / removed /
  changed per tab), per-tab state
  (detailed diff of `expandedDirs`
  added / removed, `selectedPath`
  changed, `openEditorTabPaths` added
  / removed, `activeEditorTabPath`
  changed), active tab (displayed as
  a path, not an id), recents (added /
  removed), voice preferences (changed
  boolean / string fields), tool
  settings (changed confirmation mode
  per tool).
- `previewDiffLabelV4(diff) → string`
  is the human-readable renderer
  used by the PrivacyDataCard's
  import preview block.

**PrivacyDataCard UX changes**
(`src/screens/SettingsProvider/components/PrivacyDataCard.tsx`):

- The card now exports in v4 format
  (`LIPI_STATE_V4_FORMAT` shown in
  the format note), imports via the
  v4 parser (which auto-detects v3
  files), and renders the v4 preview.
- If the imported file was a v3 file
  (auto-migrated), a `.migrationNotice`
  UI block appears under the format
  note explaining that the file was
  upgraded from v3 — "this file was
  exported from an earlier Lipi
  version; we'll import it as a v4
  file with empty per-tab state."
  The migration notice is opt-out:
  users can cancel the import if they
  don't want to bring forward empty
  per-tab state.

**No Rust changes.**
`cargo check` / `cargo test` unchanged.
M6b is a frontend-only phase.

**Titlebar**: now `dev · M6b`.

**Verification**:

- `npx tsc -b` — clean, 0 errors.
- `npx vitest run` — **874 / 874** pass
  (was 813).
- `npm run build` — clean, 720 KB JS /
  107 KB CSS, gzipped 203 KB / 18 KB.
- `cargo check` — clean (no Rust
  changes).

**Decisions** (the architectural calls):

- **#81** — `WorkspaceTab.state` is the
  persisted source of truth for
  per-tab UI state. The live stores
  (`useFileTreeStore`,
  `useEditorTabsStore`) are the
  transient view, synced via
  mirror-back `useEffect` hooks. M6b's
  four core fields are the minimum
  set; per-tab scroll position, font
  size, theme, recents, git / tool /
  voice settings are parked in M6c.
- **#82** — The v4 export shape
  extends v3's `workspace.currentPath`
  to a `workspace.workspaces[]` array
  of `{ id, path, addedAt, state }`
  rows. The v3 → v4 import migration
  is an in-memory transformation in
  `parseLipiStateV4` — the parser
  auto-detects v3 input by inspecting
  `version` and `currentPath` and
  migrates before validation. There is
  no separate `parseLipiStateV3`; v3
  files go through the same v4 import
  path.
- **#83** — The mirror-back is
  one-way: the live store is the
  current view, the persisted
  `WorkspaceTab.state` is the long-term
  storage, and user interactions only
  ever flow into the live store (the
  persisted state is the destination
  of the mirror-back). This is the
  opposite of the typical "live store
  hydrated from persistence on load"
  model; the persistence is a *shadow*
  of the live store, updated on every
  mutation. The benefit is that the
  live store stays simple (it doesn't
  need a persistence subscription),
  and the persisted state is always in
  sync (no debounce, no stale-write
  window).
- **#84** — The `format` and `version`
  fields are separated: `format` is
  the wire-format fingerprint
  (`'lipi-state-v4'`), `version` is the
  in-file data version (`4`). For v4
  they happen to match, but a future
  v5 file could have `format:
  'lipi-state-v5'` with `version: 4`
  (a data-only change) or `format:
  'lipi-state-v4'` with `version: 5`
  (a schema-only change). The v4
  snapshot in `snapshotStoresForExport`
  is a deep clone so the exported JSON
  is a true point-in-time snapshot, not
  a reference into the live store.

### Added (M6a — Multi-workspace tabs: data model + tab strip)

A workspace is now an open *tab* in the editor,
not a single global path. Users can open
multiple folders side by side, switch
between them with one click, close any of
them, and re-open a closed workspace from
the recents list (closing a tab is not
forgetting — it stays in recents). M6a
ships the data model and the surface; M6b
will add per-tab state (file tree
expansion, open editor tabs, scroll
position) so the user comes back to the
exact same view when they re-activate a
tab.

**Data model**
(`src/shared/state/workspaceStore.ts`):

- The single `currentPath: string | null`
  field is replaced with two fields:
  `workspaces: WorkspaceTab[]` and
  `activeId: string | null`. A
  `WorkspaceTab` is `{ id, path, addedAt }`
  where `id` is a `crypto.randomUUID()`,
  `path` is the absolute folder path on
  disk, and `addedAt` is the `Date.now()`
  when the tab was first added (used to
  break ties in "most recent" ordering).
- `useActivePath(state)` is the canonical
  derived helper for the path of the
  active tab (returns `null` when no tab
  is active). The existing
  `workspaceSelectors.currentPath` now
  points to `useActivePath`, so consumers
  that used to read
  `useWorkspaceStore(s => s.currentPath)`
  continue to work via
  `useWorkspaceStore(workspaceSelectors.currentPath)`.
- A new `useActivePathSelector()` hook
  subscribes to the store and re-renders
  on change — the React-side companion to
  the pure `useActivePath(state)` helper.
- `open(path)`, `close(tabId?)`, and
  `setActive(tabId)` are the three tab
  actions. `open` is a no-op-tab-add if
  the path is already open (it just
  re-activates the existing tab and bumps
  recents); `close` picks the next tab to
  the right of the closed one (or the
  last tab to the left, or `null` if
  there are no tabs left) when the
  closed tab was active; `setActive`
  switches tabs without mutating the
  list.
- Recents are unchanged in shape: an
  array of strings capped at
  `MAX_RECENTS` (5), deduped with the
  newest prepended. Closing a tab
  **preserves** its path in recents
  (closing is not forgetting).

**Persistence migration**
(in-store, idempotent, non-destructive):

- New v2 keys:
  `lipi:workspace:workspaces:v1` (the
  tab array), `lipi:workspace:activeId:v1`
  (the active tab id or `null`), and the
  unchanged recents key
  `lipi:workspace:recents:v1`.
- The pre-M6a v1 key
  `lipi:workspace:v1` (the single
  `currentPath` string or `null`) is read
  on first hydrate after M6a ships. If
  present, the store wraps it in a single
  `WorkspaceTab` and writes the v2 keys.
  The v1 key is then removed (a
  successful migration is the right time
  to drop the old shape).
- The migration is **defensive about
  partial / corrupt data**: each tab is
  shape-checked (`id` string, `path`
  string, `addedAt` number) and malformed
  rows are dropped; the active id is
  validated against the tab list and
  falls back to the first tab if it
  doesn't match; missing-but-tabs-present
  is recovered by picking the first tab.
- The migration only fires when the v2
  `workspaces` key is absent. After the
  first M6a hydrate, the v1 key is gone
  and the v2 keys are the only source of
  truth.

**`WorkspaceTabs` component**
(`src/screens/EditorWorkspace/components/WorkspaceTabs/`):

- One pill per open tab, rendered as a
  flex strip between the titlebar and the
  file tree.
- Click a pill to switch to that tab
  (dispatches `setActive(tabId)`). Click
  the `×` to close (dispatches
  `close(tabId)`). Middle-click also
  closes (the standard browser-tab
  affordance).
- The `+` button at the right end opens
  the native folder picker and adds a
  new tab for the chosen path (the
  `open()` action handles the
  dedup-and-activate logic).
- A11y: `role="tablist"` on the strip,
  `role="tab"` on each pill,
  `aria-selected={isActive}`,
  `aria-label="Open workspaces"`,
  `title={tab.path}` (the full path on
  hover), `aria-label="Close <name>"` on
  the close button.
- The strip returns `null` when no tabs
  are open — the editor is not visible
  in that state, the Welcome screen is
  the only thing mounted, and the strip
  would be visual noise.

**File tree reactivity** (`useFileTree.ts`):

- The hook subscribes to the
  `useWorkspaceStore` and re-roots the
  file tree to the new active path
  whenever the user switches tabs. The
  per-tab expansion state is global in
  M6a (M6b keys it per tab — see
  "Added (M6b — Per-tab state keying +
  v4 settings export / import)" below).

**Command Palette**:

- `workspace.open` ("Open Folder…")
  dispatches `useWorkspaceStore.getState().open(chosen)`,
  which adds a new tab (or re-activates
  the existing one for the same path).
- `workspace.close` ("Close Folder")
  dispatches `close()` (no arg = close
  the active tab). The router picks up
  the now-`null` active path and routes
  to the Welcome screen automatically.
- "Open Recent" commands call the same
  `openWorkspace(path)` helper, which
  goes through `open(path)`. Recent
  re-opens add a new tab if the path is
  not already open.

**Backward compatibility**:

- All pre-M6a consumers that read
  `useWorkspaceStore(s => s.currentPath)`
  are migrated to
  `useWorkspaceStore(workspaceSelectors.currentPath)`
  (the derived selector). The
  `settingsIOv2.apply.ts` and
  `settingsIOv3.apply.ts` v2 / v3
  settings import paths keep their
  `currentPath` field on the *export*
  shape (the user's exported
  `lipi-state` JSON still has a
  `workspace.currentPath` field, the
  same as before); the apply side
  reconstructs a `WorkspaceTab` from the
  imported `currentPath` so the v2/v3
  export format stays compatible with
  the new v2 internal store.
- `useActivePath` is the canonical
  replacement for direct
  `state.currentPath` access in *new*
  code. The 5 files that used to read
  `s.currentPath` directly are migrated
  in this PR: `main.tsx`, `SearchPanel.tsx`,
  `SettingsProvider.tsx`, `useWorkspaceSync.ts`,
  `PrivacyDataCard.tsx`. The helper
  function in `tourSteps.ts` is refactored
  to take a plain `{ hydrated, currentPath }`
  object instead of a `Pick<WorkspaceState, ...>`,
  decoupling the onboarding-tour gate
  from the internal store shape.

**Tests**:

- 21 new tests in
  `workspaceStore.test.ts` cover:
  - v1 → v2 migration (v1 keys absent → no
    migration; v1 current present → v2
    keys written + v1 key removed; v1
    recents merged into v2 recents;
    corrupt v1 values fall back to
    defaults; idempotent on second
    hydrate)
  - `open()` (new tab; existing path is a
    no-op-add; recents updated; status
    flipped to `ready`; persisted to v2
    keys)
  - `close()` (closes the active tab when
    no arg; the right-of-closed tab
    becomes active; falls back to the
    last-left tab; falls back to `null`;
    non-active close preserves active;
    closed path is preserved in recents)
  - `setActive()` (switches active; writes
    to v2 active key; no-op on unknown
    id)
  - `useActivePath` derived helper (null
    when no active; returns active tab's
    path; null when active id has no
    matching tab)
  - Persistence round-trip (v2 keys
    survive a store re-hydrate)
- 6 new tests in
  `WorkspaceTabs.test.tsx` cover the
  strip rendering, active-tab
  highlighting, click-to-switch, × to
  close, + to add via the picker, and
  the "no tabs → render nothing" guard.
  The tests use a real DOM render
  (`createRoot` + `act`) rather than
  `renderToStaticMarkup` because
  Zustand's `useSyncExternalStore` reads
  the *initial* state during SSR, which
  would miss the per-test
  `useWorkspaceStore.setState(...)`
  setup. Decision #78 documents the
  rationale.
- 18 test files were touched (not
  added) to migrate `setState({ currentPath: ... })`
  and `s.currentPath` reads to the new
  v2 shape (`workspaces` + `activeId`).
  Most of these are one-line
  `setState` updates in
  `settingsIOv2.apply.test.ts`,
  `settingsIOv3.apply.test.ts`,
  `useApplyTemplate.test.ts`,
  `useOpenWorkspace.test.ts`,
  `useDeepLinkRouting.test.ts`,
  `commands.test.ts`,
  `PrivacyDataCard.test.ts`.
- **Total vitest: 813 / 813** (was 791
  before this phase; +22 from
  `workspaceStore.test.ts` +6 from
  `WorkspaceTabs.test.tsx`; the rest are
  migrations of existing tests to the
  new shape).

**Files touched**:

- `src/shared/state/workspaceStore.ts` —
  rewritten: 696 insertions / 142
  deletions. New `WorkspaceTab` type,
  `workspaces` + `activeId` state,
  `useActivePath` / `useActivePathSelector`
  helpers, v1 → v2 migration logic,
  `open` / `close` / `setActive`
  actions, updated `workspaceSelectors`,
  v2 storage keys exported for tests.
- `src/shared/state/workspaceStore.test.ts` —
  482 insertions, +21 tests for the new
  shape.
- `src/screens/EditorWorkspace/components/WorkspaceTabs/WorkspaceTabs.tsx` +
  `.module.css` + `index.ts` — new
  component, ~200 LoC, with the
  accessibility wiring described above.
- `src/screens/EditorWorkspace/components/WorkspaceTabs/WorkspaceTabs.test.tsx` —
  new test file, 6 tests.
- `src/screens/EditorWorkspace/EditorWorkspace.tsx` +
  `EditorWorkspace.module.css` — mount
  `<WorkspaceTabs />` above
  `<FileTreePane />`; new `tabs` grid
  row in the CSS.
- `src/screens/EditorWorkspace/hooks/useFileTree.ts` —
  `useEffect` subscribes to
  `useWorkspaceStore` and re-roots the
  tree when the active tab changes.
- `src/main.tsx` —
  `workspaceSelectors.currentPath`.
- `src/screens/EditorWorkspace/components/SearchPanel/SearchPanel.tsx`
  — same selector migration.
- `src/screens/SettingsProvider/SettingsProvider.tsx`
  — same selector migration.
- `src/screens/SettingsProvider/components/PrivacyDataCard.tsx`
  + `.test.ts` — use `useActivePath(ws)`
  in the export snapshot; mock updated
  to provide `useActivePath` /
  `createWorkspaceTab`.
- `src/shared/components/OnboardingTour/tourSteps.ts` —
  `readWorkspaceGateFields` accepts a
  plain `{ hydrated, currentPath }`
  object.
- `src/shared/hooks/useWorkspaceSync.ts`
  — `sync()` uses `useActivePath(state)`
  for both arguments.
- `src/shared/settingsIOv2.apply.ts` +
  `.test.ts` — apply path reconstructs
  a `WorkspaceTab` from the imported
  `currentPath`.
- `src/shared/settingsIOv3.apply.ts` +
  `.test.ts` — same, plus the
  `readLipiState` / `writeLipiState`
  helpers export `currentPath` from
  `useActivePath(s)`.
- `src/shared/commands/commands.ts` +
  `.test.ts` — `workspace.open` and
  `workspace.close` go through the new
  `open()` / `close()` actions (the
  "Open Recent" commands call
  `openWorkspace(path)` which delegates
  to `open(chosen)`).
- `src/screens/Welcome/hooks/useOpenWorkspace.ts`
  + `.test.ts` + `useApplyTemplate.ts`
  + `.test.ts` — `resetStore` updates
  use the v2 shape.
- `src/shared/hooks/useDeepLinkRouting.test.ts` —
  same.

**No Rust changes.** `cargo check` /
`cargo test` unchanged. M6a is a
frontend-only phase.

**Titlebar**: now `dev · M6a`.

**Verification**:

- `npx tsc -b` — clean, 0 errors.
- `npx vitest run` — **813 / 813** pass
  (was 791).
- `npm run build` — clean, 700 KB JS /
  107 KB CSS, gzipped 201 KB / 18 KB.
- `cargo check` — clean (no Rust
  changes).

**Decisions** (the architectural calls):

- **#77** — `workspaces + activeId` is the
  v2 internal store shape. A derived
  `useActivePath(state)` helper is the
  canonical replacement for the old
  `currentPath` field. Export shape
  unchanged.
- **#78** — WorkspaceTabs tests use a
  real DOM render, not
  `renderToStaticMarkup`, because
  Zustand's `useSyncExternalStore` reads
  the *initial* state during SSR.
- **#79** — v1 → v2 migration is
  in-store, idempotent, and drops the
  v1 key only on success. The v1 keys
  are not re-written by the new code.
- **#80** — Closing a tab preserves its
  path in recents ("closed is not
  forgotten"). Re-opening a closed
  folder from recents is the canonical
  "I want this again" path.

**M6b** (SHIPPED, see "Added (M6b
— Per-tab state keying + v4 settings
export / import)" above and HANDOFF
§9.23): per-tab state keying (file tree
expansion, open editor tabs, active
editor tab, selected row) + v4 settings
export / import (the v3 export
`workspace.currentPath` shape extends
to a `workspace.workspaces[]` array
with per-tab state; the v3 → v4 import
migration is in-memory and automatic).
**M6c** (next, when scheduled): per-tab
UI polish (per-tab scroll position,
per-tab font size / theme, per-tab
recents, per-tab git / tool / voice
settings) — M6b deliberately ships the
four core fields, the polish fields are
a M6c follow-up. See HANDOFF §6 "Next:"
for the rationale.

### Added (File-tree mutations)

Right-click any file or folder in the
Explorer pane to create a new file inside
it, rename it, or delete it. The
mutations are handled by three new Rust
commands (debounced for atomicity, with a
`AlreadyExists` failure mode for
collision-safe renames).

**Rust** (`src-tauri/src/fs.rs` + `lib.rs`):
- `fs_create_file(path)` — creates an
  empty file. Creates missing parent
  directories. Refuses to overwrite
  existing files (returns
  `FsError::AlreadyExists`).
- `fs_delete_entry(path)` — deletes a
  file or directory (recursive for
  directories, matching `rm -rf`
  semantics). Refuses on missing path.
- `fs_rename_entry(from, to)` — moves a
  file or directory within the same
  filesystem. Refuses on missing source
  or existing destination.
- New `FsError::AlreadyExists(String)`
  variant. Tool registry's
  exhaustive-switch got a corresponding
  `AlreadyExists` case
  (`src/screens/EditorWorkspace/state/toolRegistry.ts`).

**JS IPC** (`src/ipc/fs.ts` + `fs.test.ts`):
- Typed wrappers `createFile`,
  `deleteEntry`, `renameEntry` with the
  same `try`/`catch as the read wrappers.
- `AlreadyExists` added to
  `FsErrorPayload.kind`.
- 13 IPC tests.

**Hook** (`useFileTree.ts` + test):
- Refactored to expose pure functions
  `parentDir`, `isDescendant`,
  `loadDirIntoStore`, `createInTree`,
  `deleteInTree`, `renameInTree` —
  testable without a React renderer (the
  project doesn't ship
  `@testing-library/react`).
- Hook now returns `create`, `delete`,
  `rename`, and a `refresh` action. The
  mutations refresh the parent directory
  on success; `delete` also clears the
  tree's selection if the deleted path
  was the selected one or an ancestor.
- 18 hook tests covering path helpers,
  IPC plumbing, selection bookkeeping,
  and error re-throws.

**UI** (`FileTreePane.tsx` + CSS):
- New `onContextMenu` handler on each
  row opens a coarse menu via
  `window.prompt` ("Action for X: 1. New
  File, 2. Rename, 3. Delete") and
  `window.prompt` / `window.confirm` for
  naming and destructive confirmation.
- Per-row inline error display
  (`.rowError` block) so the user sees
  why a rename failed (e.g. "name in
  use") without a toast system.
- **v1 limitation:** the native prompts
  are coarse. An inline row-editor +
  styled confirm modal are a follow-up
  polish phase, called out in the
  HANDOFF.

### Added (File watcher)

The Explorer pane now auto-refreshes
when files change on disk — `git pull`,
an external editor saving a file, the
user dragging a file in from Finder.
Driven by the `notify` crate
(cross-platform: ReadDirectoryChangesW
on Windows, FSEvents on macOS,
inotify on Linux) with a 75 ms burst-
coalesce window on the Rust side and a
150 ms per-directory debounce on the JS
side.

**Rust** (`src-tauri/src/fs_watcher.rs` +
`Cargo.toml` + `lib.rs`):
- New `notify = "6.1"` dependency.
- `fs_watch(path)` Tauri command: starts
  a non-recursive `RecommendedWatcher`
  for `path`, returns a `WatchHandle`
  `{id, path}`. Idempotent — re-registering
  the same path returns the existing
  handle. Spawns a Tokio drain task that
  coalesces bursts and emits `fs://changed`
  events.
- `fs_unwatch(id)` Tauri command: drops
  the watcher. Returns `false` if no
  watcher with that id (the JS side may
  call `fs_unwatch` twice on collapse —
  benign).
- `FsChangePayload` shape:
  `{kind: "create" | "modify" | "remove"
  | "any", paths: string[], watchedPath:
  string}`. `any` is used for
  multi-event bursts where per-path
  classification is unreliable
  (e.g. save+rename).
- 6 Rust unit tests, including real
  `notify` create + modify events on
  disk (not just wire-shape).

**JS IPC** (`src/ipc/fsWatcher.ts` +
test):
- Typed wrappers `startWatch`,
  `stopWatch`, `onFsChange`. Constant
  `FS_WATCHER_EVENT = "fs://changed"`.
- 5 IPC tests.

**Store** (`fileTreeStore.ts`):
- New `dropEntries(dirPath)` action so
  the watcher can clear stale entries
  on `Remove` events.

**Hook** (`useFileTree.ts` + test):
- New `startWatch` / `stopWatchOnHandle`
  actions on the hook's return.
- New pure function
  `decideFsChangeAction(payload,
  loadedPaths)` returns `'skip' |
  'drop' | 'refresh'` — extracted so
  tests can exercise the decision logic
  without a React renderer.
- New React hook `useFileTreeWatcher(refresh)`
  that subscribes to `onFsChange`,
  skips unloaded directories (so an
  external `git pull` into `.git/`
  doesn't fire spurious refreshes),
  drops entries on `Remove`, and
  debounces per directory.
- 5 new tests for `decideFsChangeAction`.

**UI** (`FileTreePane.tsx`):
- `TreeRoot` starts a watcher for the
  root on mount; tears it down on
  unmount (handles the open → close →
  reopen cycle correctly because
  `rootPath` changes).
- Each expanded directory `TreeNode`
  (depth > 0) starts its own watcher on
  expand and stops it on collapse or
  unmount.

### Added (Workspace search — Ctrl+Shift+F)

The side panel gains a "Search" tab
between Source Control and Terminal.
Type a query → debounced 200 ms
walk of the current workspace →
clickable results list → opens the
file at the matched line and column.

**Rust** (`src-tauri/src/workspace_search.rs`):
- New `workspace_search(opts)` Tauri
  command. Hand-rolled walker (no
  ripgrep sidecar — pure stdlib).
- Default ignore list (`.git`,
  `node_modules`, `dist`, `build`,
  `target`, `.venv`, etc.) with an
  `extra_ignores` override.
- Skips binary files via a NUL-byte
  probe (the existing
  `looks_like_text` in `fs.rs`, now
  `pub(crate)` so the new module can
  share it).
- Skips files larger than the editor
  cap (5 MB).
- 1,000-match hard cap (sets the
  `truncated` flag).
- 10,000-file scan cap.
- Case-insensitive mode is opt-in
  (`caseInsensitive: true`).
- `SearchError` enum:
  `{NotFound, NotADirectory, InvalidQuery, Io}`.
- 15 Rust unit tests.

**JS IPC** (`src/ipc/workspaceSearch.ts`):
- Typed wrapper with `SearchError`
  class and `asSearchError` helper.
- 5 IPC tests.

**Store** (`editorControllerStore.ts`):
- New `pendingReveal: PendingReveal | null`
  + `setPendingReveal` action —
  cross-pane handoff for "open this
  file at this line" requests. The
  SearchPanel sets it; `EditorPane`'s
  `onMount` reads it (when the path
  matches) and calls Monaco's
  `revealLineInCenter` + `setPosition`
  + `focus`, then clears it.
- 3 new store tests.

**UI** (`SearchPanel.tsx` + CSS):
- New side panel: query input, `Aa`
  case-insensitive toggle, results
  list with `path:line:col` + line
  text, summary line ("X matches in Y
  files"), truncation note, idle /
  searching / error / empty states.
- 200 ms debounce. Late results from
  a slow earlier search are dropped
  via a per-search `requestId`.
- Click a result → sets
  `pendingReveal` + opens the file.
- **v1 limitations:** no cancellation
  (a pathological workspace — e.g. a
  huge `node_modules` that wasn't
  ignored — blocks until done; ~30 s
  on a fast disk). `extra_ignores` is
  exact-name only (no glob support
  yet). Case-sensitive by default.
  All three are called out in the
  HANDOFF as follow-ups.

**SidePanelPane**: new "Search" tab
between Source Control and Terminal.

**Files touched:**
- `src-tauri/src/workspace_search.rs`
  — new (~530 LoC, 15 tests).
- `src-tauri/src/lib.rs` — `mod
  workspace_search` +
  `use workspace_search::workspace_search`
  + register in `invoke_handler!`.
- `src-tauri/src/fs.rs` —
  `looks_like_text` is now
  `pub(crate)`.
- `src/ipc/workspaceSearch.ts` — new
  IPC wrapper.
- `src/ipc/workspaceSearch.test.ts` —
  new, 5 tests.
- `src/ipc/index.ts` — re-export.
- `src/screens/EditorWorkspace/state/editorControllerStore.ts`
  — new `pendingReveal` + setter.
- `src/screens/EditorWorkspace/state/editorControllerStore.test.ts`
  — +3 tests.
- `src/screens/EditorWorkspace/components/EditorPane/EditorPane.tsx`
  — apply `pendingReveal` in
  `handleMount`.
- `src/screens/EditorWorkspace/components/SearchPanel/`
  — new (TSX + CSS + index).
- `src/screens/EditorWorkspace/components/SidePanelPane/SidePanelPane.tsx`
  — new "Search" tab.

**Tests added**: 5 IPC + 3 store + 15
Rust = **23 new tests**.

**Verify (all green):**
- TSC: clean
- Vitest: 53 files, 651 tests pass
  (was 52/643 before the search phase,
  +1 file + 8 tests).
- Vite build: clean
- Cargo test: 194/194 pass (was 179,
  +15 search tests).

**No new Cargo deps.** Pure stdlib on
the Rust side; the workspace search is
intentionally slower than ripgrep on
huge repos but adequate for typical
user workspaces and avoids a 5 MB
sidecar binary.

### Added (Recents-management polish)

The Welcome screen's recents header now exposes a
"Clear all" button that empties the recents list in one
click. The per-row "Remove" (×) button was already
wired; this completes the surface.

**UI** (`src/screens/Welcome/Welcome.tsx`,
`Welcome.module.css`):
- New `recentsHeader` row (flex, title left + button
  right) wraps the existing "Recent" title.
- New `recentsClearAll` button: 11 px uppercase,
  transparent by default, lighter on hover. The
  `aria-label` is "Clear all recent workspaces" for
  screen readers.
- New `shouldShowClearAll(recentsCount)` helper (also
  exported for the test file) returns `true` only when
  `recentsCount > 1` — a single-item "Clear all" is a
  footgun (the user probably wants to keep that one)
  and an empty list doesn't render the section at all.

**Behaviour**:
- Click → `useWorkspaceStore.getState().clearRecents()`
  → `recents: []` + `localStorage` (`lipi:workspace:recents:v1`)
  set to `[]`.
- `currentPath` is **preserved** (the open workspace
  is independent of the recents list — same contract
  as the per-row "Remove" button). The status flips
  to `{ kind: 'ready', path }` if a workspace was open.
- No-op when the list is already empty (the helper
  hides the button in that state anyway, so this
  branch is just belt-and-braces).

**Tests** (`src/screens/Welcome/Welcome.recents.test.ts`):
- 4 helper tests: empty / single / 2 / cap-and-beyond.
- 3 store-integration tests: open-three-then-clear
  (asserts the order is reversed by `dedupAndCap` and
  the list ends up empty), clear preserves
  `currentPath`, clear on an already-empty list is a
  no-op.
- **Total vitest: 539 / 539** (532 from baseline + 7
  new from this change).

**Files touched**:
- `src/screens/Welcome/Welcome.tsx` — new header row
  + button + `shouldShowClearAll` helper export
  (+~30 LoC).
- `src/screens/Welcome/Welcome.module.css` — new
  `.recentsHeader` + `.recentsClearAll` rules
  (+~30 LoC).
- `src/screens/Welcome/Welcome.recents.test.ts` —
  new test file (+~100 LoC, 7 tests).

**No Rust changes.** `cargo check` / `cargo test`
unchanged. The store's `clearRecents` action was
already implemented (it just wasn't surfaced in the
UI until now).

### Added (M5 — mobile polish: keyboard occlusion + haptics)

The M1 mobile shell shipped with a tab bar and
safe-area insets, but two iOS/Android polish items
remained deferred: the on-screen keyboard would
cover the bottom tab bar (a frequent footgun on
a 360px viewport), and there was no native
haptic feedback on tab switches / voice start /
destructive actions. M5 closes both gaps.

**`haptic` Tauri command** (Rust, no-op on
desktop, deferred-bridge placeholder on iOS /
Android via `#[cfg(mobile)]`).

- `src-tauri/src/lib.rs` — new
  `haptic(intensity)` command, registered in
  the `invoke_handler!` list. The `#[cfg]`
  split is the platform-dispatch point; the
  future iOS Swift / Android Kotlin plugins
  will replace the placeholder bodies with
  `SFImpactFeedbackGenerator` /
  `Vibrator.vibrate` calls.
- `HapticIntensity` enum: `light` / `medium` /
  `heavy` — mirrors the iOS
  `UIImpactFeedbackGenerator` and Android
  `HapticFeedbackConstants` scales. The JS
  side picks a semantic intensity, not a raw
  one (Decision #61).

**`useHaptics` + `useVirtualKeyboard` hooks**
(TS).

- `src/ipc/haptics.ts` — typed wrapper:
  `haptic('light' | 'medium' | 'heavy')`.
- `src/shared/hooks/useHaptics.ts` —
  `useHaptics()` returns `{light, medium,
  heavy}`. Pure helper `fireHaptic` exported
  for tests. Swallows IPC failures, one-shot
  console warn (the v1 contract: a haptic
  pulse is fire-and-forget; the UI never
  blocks on it).
- `src/shared/hooks/useVirtualKeyboard.ts`
  — `useVirtualKeyboard()` subscribes to
  `window.visualViewport.resize` /
  `.scroll`, writes `--keyboard-height` to
  `documentElement`. The CSS layer reads the
  variable (with a `0px` default) to push the
  tab bar above the keyboard. Pure helpers
  `computeKeyboardHeight` /
  `applyKeyboardHeight` exported for tests.
- `src/screens/EditorWorkspace/components/MobileShell/MobileShell.tsx`
  — mounts both hooks, fires `light` haptic
  on tab-switch (skipped when re-clicking the
  active tab).
- `src/screens/EditorWorkspace/components/MobileShell/MobileShell.module.css`
  — tab bar `padding-bottom: calc(var(--safe-bottom, 0px) + var(--keyboard-height, 0px))`.

**Tests**: +13 vitest (5 `useHaptics`, 8
`useVirtualKeyboard`).

**Verify**: tsc clean · vitest **552/552** (+13) ·
vite build clean · `cargo check` clean.

### Added (NPS — native-dictation plugin contract)

The M2c mobile shim registered a
`'nativeDictation'` factory stub in the
`voiceSessionFactories` registry (it throws
`'not-configured'` on start — see CHANGELOG
"Added (M3)"). The actual Swift `SFSpeechRecognizer`
and Kotlin `SpeechRecognizer` plugins are
deferred until a future session on a Mac with
Xcode 16+ / Linux with Android Studio Iguana+.
NPS ships the **contract** the plugins must
satisfy — a Rust-side facade and a typed JS
mirror — so the Settings UI can render the
contract today and the plugins plug in tomorrow
without JS-side changes.

**Rust side** (`src-tauri/src/native_dictation.rs`).

- `PLUGIN_NAME = "native-dictation"`,
  `METHOD_START` / `METHOD_STOP` / `METHOD_CANCEL`,
  `TRANSCRIPT_EVENT = "stt://transcript"`,
  `ERROR_EVENT = "stt://error"`.
- `NativeDictationErrorKind` enum (5 kinds:
  `permission-denied` / `no-input-device` /
  `backend` / `timeout` / `unknown`) — mirrors
  the desktop `SttErrorKind` so the JS-side
  `useVoiceCapture` hook can map them with the
  same `voiceSessionErrorMessage` helper.
- `ContractStatus` enum (`active` / `inert` /
  `not-applicable`) — `#[cfg(target_os =
  "ios" | "android")]` returns `inert` (contract
  is in tree, plugin binding is not yet
  implemented); every other target returns
  `not-applicable`. The `#[cfg]` split is the
  platform-dispatch point; the future
  Swift / Kotlin plugin replaces `inert` with
  `active` without touching the JS side.
- `get_native_dictation_contract` command
  returns the contract as typed JSON. The wire
  shape is asserted by the Rust test suite
  (kebab-case enum serialisation, plugin-name
  string, event names, three methods, five
  error kinds).
- **8 Rust unit tests** (contract strings,
  method / error-kind count, JSON serialisation
  kebab-case, error-kind deserialise round-trip).

**JS side** (`src/ipc/nativeDictation.ts`).

- Typed `NativeDictationContract` mirroring the
  Rust wire shape.
- `getNativeDictationContract()` IPC wrapper.
- `contractStatusLabel(status)` and
  `errorKindLabel(kind)` pure helpers (10
  tests).
- `src/screens/SettingsProvider/components/NativeDictationCard.tsx`
  + `.module.css` — a new Voice-section card
  that renders a status badge (colour-coded by
  `data-status`), a collapsible contract list
  (3 methods + 5 error kinds + 2 events), and
  pointers to
  `docs/plugins/lipi-stt-ios/README.md` and
  `docs/plugins/lipi-stt-android/README.md`.
  On desktop the card reads
  `status: 'not-applicable'` and shows
  "iOS / Android only"; the contract list
  still renders (same 3 methods + 5 error
  kinds on every platform; the difference is
  *which* platform's plugin implements it).
- 3 tests on the
  `nativeDictationStatusBlurb` helper.

**Mounted** in `SettingsProvider.tsx` right
after `WebSpeechCard`.

**Verify**: cargo check clean · cargo test
(NPS) 8/8 · tsc clean · vitest **565/565**
(+13) · vite build clean.

### Added (S2 — settings v2 export / import)

The 5b v1 export (`src/shared/settingsIO.ts`)
is per-decision: it captures just the
`toolSettings` payload. S2 ships the
**full-Lipi-state** counterpart: a single
schema-versioned JSON file that contains the
workspace (current + recents), the
voice-provider preference, and the tool
settings. Privacy scope: **no AI keys, no
audit log, no live transcript state, no
custom tools, no first-run flag** — pinned by
the `serialisedFileLooksPrivate` smoke test
and the `LIPI_STATE_V2_PRIVACY_STATEMENT`
string rendered in the Settings card (see
HANDOFF §9.15 for the full exclude list and
the rationale per item).

**Pure IO module** (`src/shared/settingsIOv2.ts`).

- `LIPI_STATE_V2_FORMAT = "lipi-state"`
  (distinct from 5b v1's `"lipi-settings"`
  so a v1 file is rejected by a v2 reader
  and vice versa).
- `LIPI_STATE_V2_VERSION = 2` (monotonically
  increasing; a v3 file would be rejected
  with a clear error).
- `LipiStateV2Data` interface: `workspace` +
  `voicePreferences` + `toolSettings`.
- `buildLipiStateV2` / `parseLipiStateV2` /
  `serialiseLipiStateV2` /
  `suggestLipiStateV2Filename` /
  `serialisedFileLooksPrivate` —
  all pure, all dependency-free (no store
  imports; the test for `build → serialise
  → parse → data` round-trips a fixture
  unchanged).

**Apply module** (`src/shared/settingsIOv2.apply.ts`).

- `applyLipiStateV2(data)` writes to the
  three stores: `useWorkspaceStore.setState`,
  `useVoicePreferencesStore.setState`, and
  `useToolSettingsStore.applyImportedSettings`
  (the 5b v1 action — reuses the 5a soft-delete
  + 5s-undo hook for the tool-settings half).
- Tagged-union `ApplyLipiStateV2Result` so the
  UI can show a specific error to the user if
  a sub-payload's apply throws.
- **Partial-on-error** semantics: if the
  tool-settings apply fails, the
  workspace / voice-preferences writes have
  already happened. Acceptable for v1: a
  cross-store snapshot / rollback is a v3
  concern (Decision #63).

**UI** (`src/screens/SettingsProvider/components/PrivacyDataCard.tsx` +
`.module.css`).

- New Settings "Privacy & data" card with the
  full privacy statement rendered as `<pre>`
  (so the multi-line text retains its
  breaks), an Export button (downloads a
  `lipi-state-YYYY-MM-DD.json`), and an Import
  button (file picker → parse → `window.confirm`
  → apply). Auto-clears success notice after
  3s, surfaces errors persistently.
- `snapshotStoresForExport()` — pure helper
  that reads the three stores via
  `useXxxStore.getState()` and clones the
  `recents` / `disabledToolNames` arrays and
  the `confirmationMode` record so the live
  state is never mutated through the
  snapshot. (Pinned by the test; the test
  caught a real bug where the original
  implementation passed a reference to the
  live `recents` array.)
- `parseErrorMessage(err)` — tagged-union
  to friendly-string helper.
- **Mounted** in `SettingsProvider.tsx`
  between `ToolSettingsBackupCard` and the
  5a danger zone.

**Tests**: +32 vitest (19 `settingsIOv2`, 5
`settingsIOv2.apply`, 8 `PrivacyDataCard`).

**Verify**: tsc clean · vitest **597/597**
(+32) · vite build clean.

### Added (Phase I — `app://lipi.open?path=...` deep-link scheme)

The OS can now hand Lipi a URL on launch or at runtime, and
Lipi validates the path and opens the matching workspace. The
path is strictly limited to user-owned directories (home,
Documents, Desktop) so a malicious link can never point at
`C:\Windows` or a sibling user's `~/Documents`.

**Rust** (`src-tauri/src/lib.rs`):
- Added `tauri-plugin-deep-link = "2"` to `Cargo.toml`.
- Registered the `app` scheme under
  `plugins.deep-link.desktop.schemes` in `tauri.conf.json`.
- The plugin's `on_open_url` listener (wired in the Tauri
  `setup` callback) re-emits each incoming URL as
  `lipi://deep-link` on the frontend event bus. The
  re-emission insulates the JS side from the plugin's
  internal `deep-link://new-url` event name.
- On Linux + Windows debug builds, the plugin's
  `register_all()` is called so the dev-launch picks up the
  scheme without a manual registry edit. Production
  installers register the scheme themselves.
- New `get_user_dirs() -> UserDirs` IPC command reads
  `$HOME` / `%USERPROFILE%` + `Documents` + `Desktop`,
  canonicalises them (resolves symlinks, strips the
  `\\?\` Windows extended-length prefix), and returns
  optional fields for the dirs that don't exist on the
  user's machine.

**JS** (`src/ipc/deepLink.ts`, `src/shared/hooks/useDeepLinkRouting.ts`):
- `getUserDirs()` IPC wrapper.
- `onDeepLink(handler)` subscribes to the `lipi://deep-link`
  event.
- `parseOpenUrl(rawUrl, userDirs)` is the pure URL →
  `OpenUrlResult` parser. Validates the path against the
  user-dirs allow-list (case-insensitive on Windows), rejects
  `..` traversal, non-absolute paths, and decoding failures.
- `useDeepLinkRouting()` mounts once at the app root
  (`main.tsx`), subscribes to the event, parses each URL,
  and either calls `openWorkspace(path)` or sets the
  workspace store's `status: error` with a friendly message.
- `friendlyRejectionReason(reason)` maps the 5
  `PathRejectionReason` variants to user-facing one-liners.

**Tests:**
- 15 unit tests in `src/ipc/deepLink.test.ts` (parser
  rules: happy paths per allowed root, path traversal,
  outside-user-dirs, non-absolute, missing/empty query,
  wrong scheme, decode-failure, case-insensitive Windows,
  trailing-separator normalisation, friendly-message
  smoke).
- 5 routing tests in
  `src/shared/hooks/useDeepLinkRouting.test.ts` (open path,
  missing-path error, traversal error, outside-user-dirs
  error, two-URL independence).
- **Total vitest: 524 / 524.**
- `cargo test --lib`: 146 / 146 (no Rust changes beyond
  plugin + command registration).

**Known limitations:**
- iOS / Android schemes are NOT registered in this build —
  the `#[cfg]` guards on `register_all()` skip mobile
  targets. Mobile deep-link support ships with the iOS /
  Android Swift / Kotlin plugins (Phase 7).
- A crash mid-`setup` could leave the `lipi://deep-link`
  event with no listener; the next app launch
  re-establishes it (no persistent state to corrupt).

### Added (Phase J — workspace templates gallery on Welcome)

A 5-card grid on the Welcome screen offers one-click
project creation: React + Vite, Tauri 2 + React + Rust,
Node.js + TypeScript API, Python with venv, Go module.
Each card opens the native folder picker, creates a
fresh subdir under the user's pick, expands the
template's inlined file list into it atomically, and
opens the new project as the active workspace.

**Rust** (`src-tauri/src/templates.rs`):
- 5 `Template` consts with inlined file bodies (~30 KB of
  source, no runtime FS dependency for the registry).
  Each `TemplateFile` is a `&'static str` pair
  (`rel_path`, `content`).
- `apply(template_id, dest) -> ApplyResult` is the
  public entry point. It writes every file into a
  staging subdir (`.lipi-template-staging-<rand>`)
  inside `dest` first, then renames each file to its
  final location. If anything fails, the staging dir is
  removed and `dest` is left untouched (atomic rollback).
- On the next `apply` call, any stale staging dir
  from a previous crash is cleaned up before the
  empty-dir check runs.
- `TemplateError` enum (`UnknownId`, `DestMissing`,
  `DestNotADir`, `DestNotEmpty`, `StagingIo`, `Partial`,
  `InvalidRelPath`) with `Serialize` / `Deserialize`
  impls for IPC symmetry.
- `apply_template` Tauri command is registered in
  `invoke_handler` and re-exports
  `templates::{apply, ApplyResult, TemplateError}`.
- 10 unit tests: 5-template registry shape, unique
  ids, every template has ≥1 file, every `rel_path` is
  well-formed (no `..`, no absolute), react-vite
  creates the expected files, tauri-rust includes the
  Rust bits, unknown id rejected, non-empty dest
  rejected, missing dest rejected, stale staging
  cleaned up.
- **Total `cargo test --lib`: 156 / 156.** (One
  pre-existing flake in `secrets::tests` races when
  run in parallel; passes in isolation and on retry.
  Unchanged by this PR — see the "Known limitations"
  callout in HANDOFF §9.11.)

**JS** (`src/templates/registry.ts`, `src/ipc/templates.ts`,
`src/screens/Welcome/hooks/useApplyTemplate.ts`,
`src/screens/Welcome/components/TemplateGallery/`):
- `WORKSPACE_TEMPLATES` registry (5 entries, the full
  plan set).
- `applyTemplate(id, destDir)` IPC wrapper for
  `apply_template`.
- `useApplyTemplate().start(id)` opens the picker,
  derives a fresh subdir (`react-vite-app` etc.),
  calls `applyTemplate`, and on success calls
  `openWorkspace(dest)`. Same shape as
  `useOpenWorkspace` (transient status, no
  double-fire, friendly error mapping).
- `TemplateGallery` is a 5-card grid rendered on the
  Welcome screen between the hero CTA and the recents
  list. Each card is a keyboard-focusable button with
  an `aria-label` and a `Create` secondary button.

**Tests:**
- 6 registry tests (`registry.test.ts`).
- 5 hook tests (`useApplyTemplate.test.ts`): happy
  path, user cancel, picker-throws, apply-throws,
  concurrent-call guard.
- 3 gallery tests (`TemplateGallery.test.ts`): module
  loads, registry has 5 entries, hook contract
  satisfied.
- **Total vitest: 532 / 532.**
- **Combined test delta (Phase I + J): +33 tests
  across vitest (519 → 532) and +10 across cargo
  (146 → 156).**

**Known limitations:**
- Templates are inlined in the Rust binary (~30 KB).
  A future "user templates" feature (a `~/.lipi/templates/`
  folder of `.zip` files) can co-exist with the
  built-ins; the registry would just gain a
  `get_user_templates()` accessor.
- The atomic-rollback story is "write-to-staging-then-
  rename-one-by-one." A crash between two renames
  leaves the destination partially populated. The
  `TemplateError::Partial` variant is reserved for a
  future iteration that swaps the in-place rename
  loop for a `MoveFileExW` / `renameat2` batch
  primitive. For v1 the recovery is "delete the
  destination and retry."

### Added (M2c desktop — on-device STT pipeline, stub build)

The third STT provider joins the lineup alongside
`'stub'` (M2a) and `'wispr'` (M2b): a new
`'ondevice'` provider that runs whisper.cpp
entirely on the user's machine — no audio ever
leaves the device, and the WebView's mic API is
not touched (the Rust side opens cpal directly).
The full provider-switch flow is end-to-end
tested with a deterministic stub; the real
`whisper-rs` integration is wired up behind a
Cargo feature flag and awaits a build environment
with `libclang.dll` (see Known limitations
below).

**Rust — model lifecycle**
(`src-tauri/src/stt.rs`): the curated Whisper
model list (`ggml-tiny.en`, `ggml-base.en`,
`ggml-small.en`, plus their multilingual
counterparts) with Hugging Face download URLs
and SHA-256 hashes, plus a Rust enum
`SttError` (`NoActiveModel`, `UnknownModel`,
`DownloadFailed`, `ChecksumMismatch`, …) that
serialises across the IPC boundary. 7 unit
tests cover the stub-mode behaviour of
`list_models`, `model_by_id`, the
active-model preference round-trip,
`is_model_installed` for missing files,
`list_installed_models`, and the
`is_available` ↔ `active_model_id` invariant.
**Real implementation** uses `reqwest` for
streaming downloads and `tokio::fs` for atomic
file replacement; **stub implementation** is
deterministic so the JS layer can be developed
and tested without a network.

**Rust — audio capture + inference**
(`src-tauri/src/stt_capture.rs`): the
`TranscriptEvent` wire shape (`kind`,
`text`, `sequence`, `timestamp`,
`is_utterance_end`, optional `language`),
hardened with 5 unit tests covering the
`serde(rename_all = "camelCase")` shape, the
`skip_serializing_if = "Option::is_none"`
language gate, the 16 kHz whisper sample rate
constant, the integer `samples_per_ms` math,
and the 30-second `DEFAULT_MAX_DURATION_MS`
cap. **Real implementation** (under
`#[cfg(feature = "m2c-native")]`) uses
`cpal::Stream` to capture mic audio at 16 kHz
mono Float32, buffers in a `tokio::sync::Mutex`,
and runs `whisper_full` on stop; **stub
implementation** simulates a 200 ms inference
delay and returns a placeholder transcript so
the UI can show the
`listening` → `transcribing` → `done` state
transitions during dev.

**Rust — Tauri commands** (`src-tauri/src/lib.rs`):
8 new commands wired into the handler —
`stt_list_models`, `stt_list_installed_models`,
`stt_is_available`, `stt_install_model`,
`stt_remove_model`, `stt_set_active_model`,
`stt_start_listening`, `stt_stop_listening` —
plus two event channels:
`stt://download-progress` (per-chunk
`{ modelId, bytesDownloaded, totalBytes }`
payload during install) and
`stt://transcript` / `stt://error` (the
final-result and failure channels for the
inference path).

**Frontend — typed IPC**
(`src/ipc/stt.ts`): the matching TS surface.
`SttError` is a typed JS class that maps Rust
error kinds to a stable TS API (so the hook
can `switch (err.code)` regardless of
provider). `DownloadProgressEvent`,
`SttErrorPayload`, `ListenOptions`,
`TranscriptEvent` are exported for downstream
use; `onSttDownloadProgress` /
`onSttTranscript` / `onSttError` are
unsubscribe functions returning the
Tauri-unlisten handle.

**Frontend — provider wrapper**
(`src/voice/onDeviceSTT.ts`): the JS-side
orchestrator. `transcribeViaOnDevice(opts)` is
a thin async wrapper that does
`isAvailable` → subscribe transcript + error
events → `startListening` → await transcript,
matching the shape of `transcribeViaWispr` so
the hook can swap providers with a one-line
change. The function takes an
`onSessionStart(sessionId)` callback so the
`useVoiceCapture` hook can stash the id in a
ref and call `sttStopListening(id)` from its
own Stop handler. `OnDeviceSttError` carries
the same `code` shape as `WisprClientError`
(`not-configured`, `permission-denied`,
`no-active-model`, `cancelled`, `timeout`,
`unsupported`, etc.) so the hook's
`switch (err.code)` is provider-agnostic.
A 60 s default timeout
(`ONDEVICE_DEFAULT_TIMEOUT_MS`) caps the
round-trip; the Rust side's
`DEFAULT_MAX_DURATION_MS` (30 s) caps the
audio length independently.

**Frontend — hook integration**
(`src/shared/hooks/useVoiceCapture.ts`): the
new `'ondevice'` branch in `start()` flips the
store to `recording`, kicks off
`requestAnimationFrame` for the duration
timer, and awaits `transcribeViaOnDevice`.
The `onSessionStart` callback stashes the
sessionId in `onDeviceSessionIdRef`; the
cleanup effect (and the `stop()` handler) call
`sttStopListening(id)` to release the mic.
Crucially, the on-device path does NOT touch
`navigator.mediaDevices.getUserMedia` — the
Rust side owns capture end-to-end, which
sidesteps the WebView mic API's cross-platform
quirks.

**Frontend — settings UI**
(`src/screens/SettingsProvider/components/OnDeviceCard.tsx` +
`.module.css`): a new "Or use on-device
speech-to-text" section in the existing
Settings → Voice screen (the Wispr card is
unchanged and still comes first). Lists the
curated models, shows installed / active /
not-installed status with model size and
language badge, and renders per-row
Install / Set active / Delete buttons. A live
progress bar listens to the
`stt://download-progress` event and updates in
real time during install. Toggling the
active model writes through to
`useVoicePreferencesStore` so the global
shortcut's voice button picks it up on next
start. No new top-level route was added —
the section lives inside the existing
SettingsProvider screen (decided in §9.7
of HANDOFF).

**Tests** (13 new):
- `src/voice/onDeviceSTT.test.ts` (9 tests):
  pre-flight `not-configured`, transcript
  resolution on a `final` event, partial-event
  resolution on `isUtteranceEnd`, Rust kind
  → `OnDeviceSttErrorCode` mapping for
  `permission-denied` / `no-active-model` /
  unknown, the 60 s `ONDEVICE_DEFAULT_TIMEOUT_MS`
  constant pin, the tiny-window timeout path,
  and the "no `startListening` if subscribe
  fails" guard.
- `src/shared/hooks/useVoiceCapture.ondevice.test.tsx`
  (4 tests): the on-device branch does NOT
  call `getUserMedia`, the transcript flows
  into the voice store on resolve, typed
  errors surface as `error` state, and
  `sttStopListening` is NOT called on cleanup
  when no session was ever started.

**Verified**:
- `tsc -b` — clean
- `vitest run` — 495/495 pass (482 prior + 13
  new M2c tests, in 34 files)
- `cargo check` — clean (stub mode,
  `m2c-native` feature off)
- `cargo test --lib` — 142/142 pass
  (includes 7 new `stt::*` tests and 5 new
  `stt_capture::*` tests)
- `npm run build` — clean (210 modules,
  648 KB bundle, 1.47 s)

### Known limitations

- **Real `whisper-rs` build not exercised in
  this sandbox.** Compiling `whisper-rs-sys`
  requires `libclang.dll` (Windows LLVM
  install) which is not present here. The
  real Rust path is gated behind the
  `m2c-native` Cargo feature and the
  dependencies (`cpal`, `whisper-rs`, `hound`)
  are present in `Cargo.toml` with correct
  features (`metal` / `cuda` / `vulkan`
  hardware accel); the code under
  `#[cfg(feature = "m2c-native")]` awaits a
  build environment with the Windows LLVM
  toolchain. To run the real path: install
  LLVM for Windows, then
  `cargo run --features m2c-native --release`
  (or `cargo build --features m2c-native`).
  Until then, the stub path delivers a fake
  transcript after a 200 ms delay so the
  full start→stop→transcript UI flow is
  testable in the sandbox.
- **Download progress events are stubbed.**
  When `m2c-native` is off, the install
  command returns a fake progress stream
  (0 % → 100 % over ~1 s) so the
  `OnDeviceCard` UI can be exercised. The
  real path uses `reqwest::Response::chunk`
  to emit per-chunk progress.
- **No model pre-bundled with the binary.**
  M2c users download on first use. The
  `OnDeviceCard` surfaces a one-time prompt
  ("Install ggml-tiny.en? ~75 MB") the first
  time they switch to the on-device provider.
- **`OnDeviceCard` is desktop-only.** The
  card is rendered inside the existing
  `SettingsProvider` screen, which is itself
  desktop-only. Mobile (iOS / Android)
  on-device STT is a separate phase (M2c
  mobile), scheduled after M2c desktop
  ships.

### Added (M2c mobile — on-device STT via Web Speech API + iOS/Android plugin contracts)

The fourth STT provider joins the lineup: a new
`'webSpeech'` provider that wraps the WebView's
`window.SpeechRecognition` (or
`window.webkitSpeechRecognition`). The shim
delivers a working voice→text path on Windows,
macOS, and iOS WebView with zero plugin work. The
iOS native (`SFSpeechRecognizer`) and Android
native (`SpeechRecognizer`) plugin contracts are
**fully documented in `docs/plugins/lipi-stt-ios/README.md`**
and **`docs/plugins/lipi-stt-android/README.md`**
but not yet implemented in Swift / Kotlin — those
land when a future session has Xcode 16+ or
Android Studio Iguana+. See Decision
`#46-m2c-mobile-shim.md` for the ADR; see Known
limitations for the deferred plugins.

**Rust — platform capability detection**
(`src-tauri/src/voice_platform.rs`): a new
`OsFamily` enum (`Windows | Macos | LinuxGtk |
Ios | Android | Other`) and a
`VoicePlatformCapabilities` struct (`ondevice:
bool`, `web_speech: bool`, `native_dictation:
bool`, `os_family: OsFamily`) with a
`get_capabilities()` function. The capability
flags are derived at compile time via
`#[cfg(target_os)]` on a single `const OS:
OsFamily` per build target; 4 new unit tests
cover the camelCase wire shape and the
OS-specific truthiness of each flag.

**Rust — IPC**
(`src-tauri/src/lib.rs`): a new
`voice_platform_get_capabilities` Tauri command
that exposes the capability struct to the
frontend via `invoke('voice_platform_get_capabilities', …)`.
No new Cargo dependencies.

**JS — typed IPC wrapper**
(`src/ipc/voicePlatform.ts`): a TypeScript
wrapper that mirrors the Rust struct shape
(`osFamily: 'windows' | 'macos' | 'linux-gtk' |
'ios' | 'android' | 'other'`, `webSpeech: boolean`,
`nativeDictation: boolean`); barrel re-exported
from `src/ipc/index.ts`.

**JS — cached capability accessor**
(`src/voice/capabilities.ts`): a process-lifetime
cache around `voicePlatformGetCapabilities()` so
the Command Palette's `isEnabled` predicates and
the `SettingsProvider` UI can read the flags
synchronously after the first IPC. Includes a
`__resetVoicePlatformCapabilitiesCacheForTests`
escape hatch for the test suite.

**JS — capability store**
(`src/shared/state/voiceCapabilitiesStore.ts`):
a tiny Zustand store (no persistence — the OS
doesn't change for the lifetime of a Tauri
application) with a `hydrate()` action called
once at app startup from `aiStore.ts`. The
Command Palette and `SettingsProvider` UI read
from it via the `useVoiceCapabilitiesStore`
hook.

**JS — Web Speech orchestrator**
(`src/voice/webSpeechSTT.ts`):
`transcribeViaWebSpeech()` follows the same
shape as `transcribeViaOnDevice` /
`transcribeViaWispr`: pre-flight
(`window.SpeechRecognition` feature-detect),
construct, wire `onresult` / `onerror` / `onend`,
`start()`, await. Error mapping from W3C
`SpeechRecognitionErrorEvent.error` strings to
a typed `WebSpeechSttErrorCode` union
(`permission-denied`, `no-speech`, `aborted`,
`network`, `service-not-allowed`, `bad-grammar`,
plus Lipi-side `no-webspeech` and `timeout`).
Constructor-injection seam (`webSpeechCtor`,
`windowOverride`) for the test suite. A minimal
`src/voice/webSpeechTypes.ts` augments
`Window` with the non-standard `SpeechRecognition`
and `webkitSpeechRecognition` constructors.

**JS — preferences store extension**
(`src/shared/state/voicePreferencesStore.ts`):
the `VoiceProvider` union gains `'webSpeech'`;
the store gains a `language: string` field
(default `'en-US'`) that flows through the
`useVoiceCapture` hook into the orchestrator's
`recognition.lang`. Persisted to
`lipi:voicePreferences:v1` localStorage with a
back-fill path for older payloads. M2c mobile V1
does not surface a language picker in the UI —
the value is stored + threaded for M3.

**JS — `useVoiceCapture` extension**
(`src/shared/hooks/useVoiceCapture.ts`): the
`UseVoiceCaptureOptions.provider` union gains
`'webSpeech'`; the hook's `start()` /
`startWebSpeechRecording()` path calls
`transcribeViaWebSpeech` with
`useVoicePreferencesStore.getState().language`
threaded through; the `stop()` path calls the
orchestrator's `abort()` handle (with the same
500ms fallback the desktop `ondevice` hook
uses per Decision #46 risk R5); the cleanup
effect aborts on unmount.

**JS — settings UI**
(`src/screens/SettingsProvider/components/WebSpeechCard.tsx`
+ `.module.css`): a new card that mirrors
`OnDeviceCard`'s header / capability badge /
lede / privacy callout / single-toggle shape,
rendered inside a new `<h3>` "Or use the
browser's built-in speech engine" subsection
in `SettingsProvider` (not a third radio in
the top section per Decision Q3). The
`TitleBar` subtitle bumps to
`'dev · phase M2c mobile'`. The capability
badge reads "Available" /
"Not available on this platform" from the
hydrated `useVoiceCapabilitiesStore`.

**JS — Command Palette**
(`src/shared/commands/commands.ts`): two new
commands —
`voice.provider.webspeech` and
`voice.provider.ondevice` — each gated by an
`isEnabled` predicate that reads from
`useVoiceCapabilitiesStore.getState().capabilities`
synchronously. The picker row greys out on
platforms where the capability is `false`.

**iOS / Android plugin contracts** — see
`docs/plugins/lipi-stt-ios/README.md` (Swift
`SFSpeechRecognizer` + `SFSpeechAudioBufferRecognitionRequest`)
and
`docs/plugins/lipi-stt-android/README.md`
(Kotlin `android.speech.SpeechRecognizer`).
Both contracts are
**markdown-only** in M2c mobile V1 — the user
has no Xcode 16+ / Android Studio Iguana+ in
the working environment. The Rust
`voice_platform.rs` already reports
`OsFamily::Ios` and `OsFamily::Android` with
`web_speech: false, native_dictation: true` so
the future plugins plug in without JS changes.

**Decision record** — `docs/decisions/0046-m2c-mobile-shim.md`
captures the four locked decisions (Q1 language
field, Q2 no custom consent dialog, Q3 mirror
On-device subsection, Q4 capability store +
hydrated-at-startup), the R1–R10 risks, and
the deferred Swift / Kotlin plugin note.

### Verified

- `tsc -b` — clean
- `vitest run` — 544/544 pass
  (includes 19 new `webSpeechSTT` tests, 6
  new `voicePlatformCapabilities` tests, 6
  new `voiceCapabilitiesStore` tests, 9 new
  `useVoiceCapture.webspeech` tests, 9
  extended `voicePreferencesStore` tests)
- `cargo check` — clean
- `cargo test --lib` — 146/146 pass
  (includes 4 new `voice_platform::*` tests)
- `npm run build` — clean (216 modules,
  657 KB bundle, 1.93 s)

### Known limitations

- **R1 — WebKitGTK (Linux) doesn't ship
  `SpeechRecognition` in the default build.**
  The capability report returns
  `web_speech: false` on Linux; the
  `WebSpeechCard` greys out and the Command
  Palette's `voice.provider.webspeech` entry
  is disabled. M3 can revisit if a future
  user asks for it (would need WebKitGTK
  rebuilt with `SPEECH_RECOGNITION=ENABLE`).
- **R2 — iOS Safari's `SpeechRecognition` is
  documented as not for production use.** The
  iOS arm of `voice_platform.rs` reports
  `web_speech: false, native_dictation: true`,
  gating the user onto the (future) Swift
  `SFSpeechRecognizer` plugin. Until that
  plugin lands, iOS users have no working STT
  provider; this is acceptable because the M2c
  mobile V1 is a *contract* — the iOS path
  only completes when a future session has
  Xcode.
- **R3 — Android system WebView strips
  `SpeechRecognition` in the production Google
  Play build of Chromium.** Same shape as R2:
  the Android arm reports
  `web_speech: false, native_dictation: true`
  and the future Kotlin `SpeechRecognizer`
  plugin is the production path.
- **R4 — Web Speech API is not in
  `lib.dom.d.ts`.** A minimal local type
  definition lives in
  `src/voice/webSpeechTypes.ts` and is
  imported by `webSpeechSTT.ts`. The
  `window.SpeechRecognition ?? window.webkitSpeechRecognition`
  feature-detect is the runtime check. Future
  TypeScript versions may add these types; the
  local types will then need to be removed
  (and a guarded `import type { ... } from
  'lib.dom.d.ts';` added).
- **R5 — Web Speech has no native "stop"
  signal.** `recognition.stop()` flushes
  whatever is buffered, but some browsers
  (notably older Chrome) leave the
  recognizer in a `STARTED` state for up to
  500 ms. The `useVoiceCapture` hook calls
  `recognition.stop()` first, then
  `recognition.abort()` after a 500 ms
  timeout if `onend` has not fired (mirrors
  the desktop `ondevice` hook's `stop()`
  branch).
- **R6 — No native "max duration" / "max
  silence" cap.** The hook's existing
  `maxDurationMs` cap (30 s default) is
  enforced on the JS side via a `setTimeout`
  that fires `recognition.abort()` at the
  deadline. This is a known limitation; the
  W3C spec doesn't have a built-in max
  duration. The 30 s cap is generous (the
  Web Speech API's VAD ends the session on
  silence, so most calls resolve in a few
  seconds).
- **R7 — Chromium-based browsers log a
  console warning when `SpeechRecognition` is
  used on an insecure origin.** Tauri's dev
  server uses `localhost` and the production
  build is a `tauri://` origin, which the
  WebView treats as secure. The console
  warning is a no-op but a noisy one; we do
  not silence it.
- **R8 — Web Speech is single-session per
  page.** Calling `recognition.start()` while
  a previous `recognition.start()` is in
  flight throws `InvalidStateError`. The
  `useVoiceCapture` hook guards on
  `isListening` and bails out (returns the
  in-flight `AbortController.signal` promise,
  unchanged).
- **R9 — `recognition.onresult` is the only
  signal we get for partials.** The M2c
  mobile V1 shim does not retry on `onerror`
  (it surfaces the typed `WebSpeechSttError`
  to the hook's error UI). M3 may add
  retry-on-transient.
- **R10 — The iOS / Android native plugin
  contracts assume the future session will
  land on the iOS 17 / Android API 24+
  floors.** If the floor changes, the
  contracts are still valid; only the `setup`
  block of each plugin needs an `#available`
  guard. The contracts are full per §8 of
  the architecture summary — a future session
  can land them in a single focused PR on a
  Mac / Linux box with Xcode 16+ / Android
  Studio Iguana+.
- **No language picker in V1 UI.** The
  `voicePreferencesStore.language` field is
  stored + threaded through the orchestrator,
  but the `WebSpeechCard` is a single toggle
  with no language dropdown. M3 will add the
  picker.
- **Capabilities are process-lifetime, not
  persisted.** If the user updates Tauri /
  switches Tauri-runtime between launches
  (e.g. a future dev mode that re-invokes the
  IPC), the capability flags are re-read on
  the next process launch. This is the right
  shape (the OS doesn't change for a single
  Tauri binary) but it means a future "lipi
  in a different webview origin" feature
  would need a hydration trigger.

### Added (M4 — voice-driven git commit)

The first mutating git command driven by voice. Speak
"commit with message fix: handle null body" and Lipi
stages everything in the worktree and creates a real
commit. The grammar is hand-rolled (no LLM in the
loop) so it's deterministic, offline, and testable.

**Rust — new mutating git commands** (`src-tauri/src/git.rs`):
`validate_commit_message` (length, NUL bytes, malformed
whitespace), `stage_all` (mirrors `git add -A` via
`current_dir(workdir) + git add -A .`; skips the call
when the worktree is clean and returns a
"no changes to commit" error so the JS side can show a
clean message), and `commit` (validates -> stages ->
runs `git commit -m <msg> --no-verify`; `--no-verify`
because the voice command is the user's explicit
intent — a `pre-commit` hook shouldn't silently
block). Returns a `CommitResult` with the full SHA
(`git rev-parse HEAD` after the commit) and a 7-char
short SHA. 12 new unit tests in the `git::tests` module
cover validation, staging on modified/untracked/clean
repos, commit success with simple and multi-line
messages, and the failure paths (empty message, clean
repo).

**IPC layer** (`src/ipc/git.ts`): typed wrappers
`gitStageAll` and `gitCommit` that match the Rust
`CommitResult` shape, plus the `CommitResult`
interface.

**Voice grammar** (`src/voice/commitGrammar.ts`): a
deterministic parser for commit utterances. Recognised
triggers are `commit with message`, `commit saying`,
`commit that says`, and a bare `commit`. Filler
prefixes (`um`, `uh`, `okay`, etc.) are stripped from
the start of the message. Multi-word triggers match
variable whitespace; the message body preserves
original casing and newlines (the STT may emit real
newlines for multi-line commits). 26 tests cover
recognised triggers, case-insensitivity, whitespace
tolerance, fillers, casing preservation, bare commits,
non-commit utterances, and multi-line messages.

**AIPanel integration** (`AIPanel.tsx`): the
composer's transcript effect first runs
`parseCommitCommand`. If the utterance is a commit
intent, the transcript is *not* merged into the
textarea — instead, `ipcGitCommit` is called. The
`gitStore` tracks the commit lifecycle (`idle` /
`running` / `success` / `error`), and a
`CommitStatusBanner` above the textarea surfaces the
result (with a 5-second auto-dismiss on success). The
Git panel is refreshed after the commit so the user
sees the new state.

### Added (M5 — voice accessibility)

Voice input is now usable without a mouse and is
screen-reader-aware.

**Global keyboard shortcut** (`useVoiceShortcut`):
`Cmd+Shift+V` (macOS) / `Ctrl+Shift+V` (Windows /
Linux) toggles the mic on the AI composer. The
shortcut is suppressed while the user is typing in
an editable field (`textarea`, text-like `input`,
`contenteditable`) so it doesn't intercept V presses
mid-sentence. Key-repeat is ignored and IME
composition is respected. 12 tests cover the pure
helpers `shortcutMatches` and `isEditableElement`.

**Live-region announcer** (`VoiceAnnouncer`): a
visually-hidden `aria-live="polite"` region mounted
at the app root. Subscribes to `useVoiceStore` and
emits a single, deduplicated human-readable
announcement for each state transition: "Microphone
permission requested" (requesting), "Recording, 0:05"
(recording, with the rounded duration), "Transcribing
audio" (transcribing), and the friendly error
message. Idle is silent so we don't spam screen
readers.

**Focus management**: after a voice session ends
(either naturally or via the commit path), focus is
returned to the composer textarea with the cursor
parked at the end of the new content. The textarea
placeholder and `aria-label` mention the
`Cmd+Shift+V` shortcut. A `KeyHint` chip sits next
to the voice button to make the shortcut visible to
sighted users.

**Architectural change**: the `VoiceButton` is now
"controlled" — it accepts a `controlledState` prop
so a single `useVoiceCapture` instance is owned by
the composer and shared between the button, the
keyboard shortcut, and the focus return logic. This
avoids two `getUserMedia` calls competing for the
mic.

### Added (M2a — voice capture pipeline: foundation)

The first slice of the voice-to-code pipeline. The full
Wispr Flow + on-device STT stack is split across M2b/M2c;
M2a is the foundation: the capture lifecycle, the UI, the
state machine, and the wiring into the AI chat composer.
The actual speech-to-text provider is a pluggable stub
that returns a recognisable placeholder so the user (and
tests) can verify the pipeline end-to-end without a real
STT backend.

**Voice store** (`src/shared/state/voiceStore.ts`): a
small Zustand store with a five-state machine
(`idle` / `requesting` / `recording` / `transcribing` /
`error`), the elapsed `durationMs`, the most recent
transcript, and the last user-facing error. Two pure
helpers exported alongside the store: `mergeTranscript`
(composes a new voice transcript with the existing
composer text, paragraph-broken when the previous text
doesn't end in a newline) and `formatDuration`
("M:SS" timer label).

**Capture hook** (`src/shared/hooks/useVoiceCapture.ts`):
the bridge between the store and the browser's audio
APIs. Calls `navigator.mediaDevices.getUserMedia({ audio: true })`
on `start()`, then constructs a `MediaRecorder` with the
platform's best-supported MIME type (audio/webm with
opus on desktop, audio/mp4 on iOS Safari), starts a
rAF-driven `durationMs` ticker, and on `stop()` releases
the mic tracks and runs the STT step. Three STT
providers are accepted via a `provider` option: `'stub'`
(M2a — returns a placeholder), `'wispr'` (M2b — throws
"not yet wired"), and `'ondevice'` (M2c — same).
Permission errors are mapped to friendly messages
(NotAllowedError -> "Microphone access was blocked...",
NotFoundError -> "No microphone was found...", etc.).

**Voice button** (`src/shared/components/VoiceButton/`):
the mic toggle on the AI composer. Four visual states
(idle, requesting with spinner, recording with red
pulsing background + M:SS timer, error with red border).
`aria-pressed` while recording, `aria-busy` while
requesting or transcribing, the last error message in
the `title` attribute for hover.

**Composer integration**: the AI panel's `<Composer>`
now renders a `<VoiceButton>` to the left of the Send
button. When a transcript lands in the store
(`useVoiceStore.transcript` flips to a non-empty value),
the composer's effect calls `mergeTranscript` and clears
the store so a re-render doesn't re-merge the same text.
The button is disabled when the provider isn't
configured (no key — there's no point recording a
message the user can't send) and during streaming /
tool execution.

**Bundle impact**: ~5.5 KB gzipped (618 KB total JS,
80 KB total CSS). No new dependencies, no Rust changes.

**Verified**: 381/381 tests pass (+32 for M2a: 14
voiceStore + 13 useVoiceCapture + 5 VoiceButton render).
`tsc`, `vite build`, `cargo check`, and
`cargo tauri build --debug` all clean. Bundles rebuilt:
`Lipi_0.0.2_x64_en-US.msi` (12.2 MB, WiX) +
`Lipi_0.0.2_x64-setup.exe` (7.3 MB, NSIS).

### Added (M2b — Wispr Flow WebSocket client)

The headline voice provider is now wired to Wispr Flow's
streaming WebSocket API. The microphone in the AI panel
captures speech, base64-encodes 16 kHz mono Int16 PCM
chunks, and streams them to Wispr's `/api/v1/dash/client_ws`
endpoint; the server returns a final transcript that's
merged into the composer (mirroring the M2a stub flow).

**Wispr API key storage** (`src/ipc/secrets.ts`,
`src-tauri/src/lib.rs`, `src-tauri/src/secrets.rs`).
A new `voice.wisprApiKey` field is accepted by the
existing OS keychain-backed secrets store, sitting
alongside the AI provider keys (`openai.apiKey`,
`anthropic.apiKey`, etc.). The Settings screen picks it
up via the new `WisprCard` component in the
`SettingsProvider` "Voice" section, with a password field
and a "Test connection" button (the button posts a 1-second
silent WS session to confirm the key is valid). A new
`secrets_get_api_key` Rust command (and the matching
`secretsGetApiKey` TS wrapper) lets the WebView fetch the
raw key at start time. The key is held in memory only for
the duration of one capture, dropped on `stop()`, and never
written to disk or sent anywhere except the Wispr
endpoint (see Decision #41 in HANDOFF).

**PCM audio capture** (`src/voice/pcmCapture.ts`). The
M2a `MediaRecorder` path produced encoded audio (Opus /
AAC inside a Blob); Wispr needs raw 16 kHz, 16-bit, mono
PCM. We swap to `AudioContext` + `ScriptProcessorNode`:
50 ms chunks of Float32, converted to Int16, base64-encoded
on demand for the WS frames. The chunk size (800 samples)
is small enough to feel live, large enough to keep the
per-chunk overhead <1%. The script processor is deprecated
but supported on every Tauri WebView target (WebView2,
WKWebView, WebKitGTK); an upgrade to `AudioWorkletNode` is
noted as Decision #42 in HANDOFF for a future phase that
needs lower scheduling jitter.

**Wispr WebSocket client** (`src/voice/wisprClient.ts`).
Pure-function `transcribeViaWispr(pcm, apiKey, opts?)` that
takes an `AsyncIterable<Int16Array>` of PCM chunks and an
API key, returns a `Promise<string>` of the final
transcript. Internally: opens the WS, sends an `auth`
frame with the key as `client_key=Bearer%20<key>` and the
`LIPI_APP_CONTEXT` payload (`{ name: 'Lipi', type: 'editor' }`),
streams one `append` per chunk with base64 PCM, RMS volume,
and a 0.05 s `packet_duration`, then sends a `commit` with
`total_packets` when the iterator ends. A re-arming
30-second timeout rejects with `WisprClientError` on
silence; auth errors map to a friendly message; close
events before a final resolve with the last partial or
`''` if the server was clean. Error codes are stable for
the UI to switch on (see `WisprClientErrorCode` and
`wisprErrorMessage`).

**Hook wiring** (`src/shared/hooks/useVoiceCapture.ts`).
`start()` branches on `provider`: `'wispr'` fetches the
key from the keychain (BEFORE opening the mic, so the
"no key" error doesn't trigger a permission prompt the
user has to dismiss), opens PCM capture, kicks off
`transcribeViaWispr`, and wires the resulting promise
back to the same 5-state machine (`requesting` →
`recording` → `transcribing` → `idle` / `error`). All M2a
invariants — generation guards, rAF ticker, cleanup on
unmount, key drop on stop — are preserved on the Wispr
path.

**VoiceButton default** (`src/shared/components/VoiceButton/VoiceButton.tsx`).
The default STT provider flips from `'stub'` to `'wispr'`.
A new `useVoicePreferencesStore` (Zustand + `localStorage`
under `lipi:voicePreferences:v1`) holds the user's choice
across sessions. The Command Palette's new **Voice**
group adds two toggle commands: "Voice: Use Wispr Flow"
and "Voice: Use Stub (debug)" so the stub provider is
still one keystroke away for engineers.

**Verified**: 429/429 tests pass (+48 for M2b: 8
pcmCapture + 12 wisprClient + 4 useVoiceCapture wispr
path + 4 voicePreferencesStore + 20 misc store /
commands / settings). `tsc`, `vite build`, `cargo check`,
and `cargo tauri build --debug` all clean. Bundles
rebuilt: `Lipi_0.0.2_x64_en-US.msi` + `Lipi_0.0.2_x64-setup.exe`.

### Added (F — icon, splash, About dialog, app menu)

The four cosmetic-polish pieces that bridge Lipi from "runs"
to "feels like a real product".

**Branded app icon.** The placeholder "L on dark slate"
icon is replaced by a hand-drawn monogram with the brand
gradient and an accent dot. The source of truth is
`src-tauri/icons/app-icon.svg` (a 1024x1024 SVG). Re-running
`cargo tauri icon` against the SVG regenerates the full
32-icon set (Windows ICO + macOS ICNS + iOS appiconset +
Android mipmap + Linux PNGs) without any rasterizer
dependency on the dev machine. Render script lives at
`src-tauri/icons/render-source.ps1`.

**Cold-start splash.** `index.html` now renders a
brand-matching CSS splash (gradient mark + "LIPI" wordmark)
from page load until React's first commit, then fades out
via a 200ms CSS transition triggered by setting the
`splash-done` class on `<html>`. Pure CSS, zero image
dependencies, no spinners.

**Native application menu.** A real OS menu bar is
registered via the Tauri 2 menu module (`src-tauri/src/menu.rs`).
On Windows / Linux: File / Edit / View / Window / Help. On
macOS the platform auto-generates a "Lipi" app menu with
About / Hide / Quit. The Edit submenu uses
`PredefinedMenuItem` for cut/copy/paste/select-all so the
OS handles clipboard routing for free. The Rust side does
not execute any action — it emits a `lipi://menu` event
with a `commandId` payload, and the frontend dispatches
through the same command-palette registry. This keeps the
action logic in one place.

**About dialog.** A new `AboutModal` (F.5) shows the
product name, live version (via a new `get_app_version` /
`open_devtools` IPC pair), brand mark, description, license,
and project URL. Reachable from two surfaces:
- **Help > About** in the native menu (routed by
  `useMenuEvents` to the same `useAboutStore.show()` action)
- **Command Palette > "About Lipi"** in the new
  `Help` group

Tests cover the modal's open/close, version rendering
placeholder, static metadata, brand mark presence, a11y
attributes, and the new palette entry. All 349 tests
pass.

### Added (B — distribution packaging)

Lipi now builds end-to-end on Windows.
`cargo tauri build --debug` produces
both a WiX `.msi` installer and an
NSIS `.exe` side-load installer,
verified working on the dev machine
on 2026-06-11:

- `Lipi_0.0.2_x64_en-US.msi` — 12.1 MB
- `Lipi_0.0.2_x64-setup.exe` — 7.3 MB

The Tauri bundler auto-downloads WiX
3.14 and NSIS 3.11 on first build
(cached in `%LOCALAPPDATA%`).

**Updater signing keypair is now real.**
A `lipi-dev` Ed25519 keypair was
generated with `cargo tauri signer
generate`. The **public** key is
committed in `tauri.conf.json`
(`plugins.updater.pubkey`) so
contributors can build out of the box.
The **private** key (`lipi-dev.key`)
is git-ignored and protected with the
hard-coded dev password
`lipi-dev-not-a-real-secret` (passed
via the `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
env var at build time). The pubkey is
embedded into the built `lipi.exe` so
the running app can verify future
updates. Production CI rotates the
keypair from a secret store; the dev
key has a known password and must
never sign a release.

**`<owner>` placeholders replaced.**
`tauri.conf.json` (homepage + updater
endpoint) and `Cargo.toml`
(repository) now use `lipi-dev/lipi`
as an honest pre-publication slug.
The real owner is a one-line swap at
publish time. The endpoints are still
non-functional (no `updater.json`
exists at the URL yet) — they're
config-time only, no runtime side
effects until a release is published.

**Persistence path validated for
packaging.** Confirmed via the build
that the `localStorage` keys
(`lipi:workspace:v1`,
`lipi:firstRun:v1`,
`lipi:toolSettings:v2`,
`lipi:toolDecisionLog:v1`,
`lipi:customTools:v1`) survive
packaging because Tauri 2 scopes
`localStorage` to the bundle id.
The data lives in
`%LOCALAPPDATA%\app.lipi.ide\EBWebView\Default\Local Storage\leveldb\`,
fully isolated from the dev
(`http://localhost:1420`) origin and
from other Tauri apps. Caveat: dev
and packaged apps have separate
`localStorage` partitions, so
settings made in dev do NOT appear in
the packaged app (correct behaviour,
but a footgun for testing — see
HANDOFF Decision #31).

**No code signing yet.** SignPath
(free for OSS) or Azure Trusted
Signing for Windows + Apple Developer
ID + notarization for macOS are a
future-publication task per Section 8
of HANDOFF. Unpacked installers will
trigger SmartScreen / Gatekeeper
warnings on first run; sign the
release build before publishing.

### Added (D — first-run no-API-key interstitial)

Lipi now intercepts new users on the
Welcome screen and prompts them to add
an API key before they hit the chat
panel and get a generic "Invalid API
key" error. The flow is:

1. On launch, if no workspace is
   open AND no provider key is
   configured AND the user hasn't
   dismissed the panel, a
   `<FirstRunOnboarding />` panel
   appears above the Welcome hero.
2. The CTA "Add OpenAI key" (or
   whatever the first provider
   is) routes to Settings AND
   persists the dismissal — the
   user is now in the right
   place, so we don't show the
   panel again.
3. The "Skip for now" link
   persists the dismissal but
   leaves the user on Welcome.
   They can re-open the panel
   later via the command
   palette's "Reopen first-run
   setup" command (which also
   closes the current workspace
   so the gate's
   `currentPath === null`
   condition is met).

This is a *soft* on-ramp — no
wizard, no progress bar, no
forced flow. The user can always
add keys later via Settings →
AI Providers (which already
existed in 5a).

- **`useFirstRunStore`** (new
  shared Zustand store).
  Two fields: `hydrated` and
  `dismissed`. The
  `dismissed` flag persists
  to `localStorage` under
  `lipi:firstRun:v1` (same
  `localStorage` + version
  pattern as
  `workspaceStore`).
  Actions: `hydrate()`,
  `dismiss()`, `reset()`.
  The `reset()` action is
  used by the command
  palette's "Reopen
  first-run setup" command
  to re-arm the flag.
- **`<FirstRunOnboarding />`**
  (new shared component, in
  `src/shared/components/FirstRunOnboarding/`).
  Pure presentational: takes
  `primary`, `onAdd`, `onSkip`
  as props. The primary CTA
  says "Add {provider} key"
  when a provider is
  available, or "Add a key"
  as a fallback. The "Skip
  for now" button is
  rendered alongside. The
  panel has an accent
  border (left-only) and a
  subtle gradient background
  to draw attention without
  looking like an error.
- **`useFirstRunOnboarding`**
  hook (new, in
  `src/shared/hooks/`). The
  gate logic: subscribes to
  `useFirstRunStore`,
  `useWorkspaceStore`, and
  the keychain IPC
  (`aiGetConfiguredProviders`).
  Exposes `{ show, primary,
  onAdd, onSkip }`. `show`
  is `true` exactly when:
    - `firstRun.hydrated`
    - `!firstRun.dismissed`
    - `currentPath === null`
    - `configuredProviders
       .length === 0`
  The `configuredProviders`
  state is fetched on demand
  (not in a separate store)
  because it changes out-of-
  band with our app — the
  user can add a key from
  the OS UI at any time.
  IPC failures are handled
  with a sentinel
  (`['__unknown__']`) so we
  never show the panel based
  on a stale error.
- **Command palette
  integration**: a new
  `firstRun.openSetup`
  command — "Reopen first-
  run setup" — lets a user
  manually re-arm the
  dismissed flag. Always
  enabled (the visible
  panel is still gated).
  The command also closes
  the current workspace so
  the user can see the
  panel they just re-armed.
- **`AppRoot` updates**:
  - Hydrates
    `useFirstRunStore` once
    on mount (same pattern
    as
    `useWorkspaceStore.hydrate`).
  - The Welcome screen now
    accepts a new optional
    `firstRunPanel` prop
    (slot pattern, mirroring
    `renderActions`).
    `AppRoot` computes the
    gate logic and passes
    either a rendered
    `<FirstRunOnboarding />`
    or `null`. The Welcome
    screen remains agnostic
    of the first-run
    concept.
- **Tests**: 26 new tests
  across 3 files (was 312,
  now 338):
  - `firstRunStore.test.ts`
    (9 tests): hydration,
    dismissal, persistence,
    idempotency, corrupt
    JSON fallback,
    private-mode fallback.
  - `FirstRunOnboarding.test.tsx`
    (7 tests): rendered
    HTML structure,
    primary CTA text,
    fallback text, click
    handlers (primary +
    skip), and the
    `__none__` sentinel
    path.
  - `useFirstRunOnboarding.test.ts`
    (7 tests): the pure
    `computeShouldShow` gate
    — every condition in
    the visibility contract
    (hydrated, dismissed,
    no workspace, no keys,
    IPC-failure sentinel).
  - `commands.test.ts` (3
    new tests, was 22, now
    25): the
    `firstRun.openSetup`
    command — exists in
    the registry, resets
    the firstRun store on
    `run()`, always
    enabled.
- **Verification**:
  - `npx tsc --noEmit` —
    clean.
  - `npx vitest run` —
    338/338 pass.
  - `npm run build` —
    clean, 182 modules
    (+1 for the new
    `FirstRunOnboarding`
    component), 76 kB CSS,
    592 kB JS.
  - `cargo check` — clean.

### Added (M1 — mobile-first responsive shell + top-8 device emulator)

- **`useDeviceEmulatorStore`** (new
  Zustand store, dev-only,
  `sessionStorage`-backed). A
  single `enabled` flag that
  shows / hides the device
  emulator strip. Bound to
  `Cmd-Shift-D` /
  `Ctrl-Shift-D` via the
  `useDeviceEmulatorShortcutWhenDev`
  hook (mounted in
  `EditorWorkspace`; the
  hook is a no-op in prod
  builds — the global
  keydown listener is never
  registered when
  `isDev === false`).
  `sessionStorage` (not
  `localStorage`) so a
  closed tab / new window
  is a clean slate.
- **Device-emulator strip
  rewrite**: each frame
  renders the LIVE
  `MobileShell` (the real
  mobile UX) scaled down
  via `transform: scale()`,
  with the device's
  `--safe-top` /
  `--safe-bottom` CSS
  variables applied to the
  frame's `screen` element
  so the `MobileShell`'s
  chrome (top bar + tab
  bar) lines up with the
  painted notch + home
  indicator. Each
  `MobileShell` is mounted
  via `createPortal` so the
  per-frame CSS variables
  are inherited (the
  MobileShell is a single
  shared component, so
  portal is the only way
  to scope its variables).
  Pointer events are
  blocked at the frame
  level — the emulator is
  a layout preview, not a
  runtime; clicking a tab
  in a scaled frame would
  change the state of
  that frame's local
  MobileShell (each has
  its own `useState`),
  which is confusing when
  the real app is hidden.
- **New
  `DeviceSpec.safeAreaTop` /
  `safeAreaBottom` fields
  in `src/dev/devices.ts`**:
  the safe-area insets the
  OS reports via
  `env(safe-area-inset-*)`,
  in UNSCALED CSS px. iPhone
  15 Pro: 47/34. iPhone SE
  3: 20/0 (hardware home
  button). Galaxy S24:
  24/22. Pixel 8: 30/24.
  iPad Air M2: 20/20. Etc.
  The new fields drive
  both the `MobileShell`'s
  chrome positioning AND
  the painted notch / home
  indicator on the device
  frame — they MUST agree
  for the preview to be
  visually accurate.
- **New `MobileTopBar`
  component** on the
  `MobileShell`:
  renders the OS status
  bar ("9:41", "5G",
  "100%") pushed down by
  `padding-top:
  var(--safe-top)`, plus
  a thin app bar with the
  "Lipi" title and a
  model badge. The badge
  reads the live
  `aiStore` provider +
  configured state.
- **Touch UX baseline on
  the mobile shell**:
  - 48px minimum tab
    height (kept
    from 5a)
  - `touch-action:
    manipulation` on
    tabs + app bar
    to kill iOS
    double-tap-zoom
  - `-webkit-tap-highlight-color:
    transparent` to
    kill the gray
    tap flash on
    Android Chrome
  - `user-select:
    none` on tab
    labels + app
    bar title (the
    user might
    swipe-down to
    reveal the OS
    notification
    center; we
    don't want
    the "Lipi"
    text to get
    selected)
  - `padding-bottom:
    var(--safe-bottom)`
    on the tab bar
    (kept from 5a)
  - `padding-top:
    var(--safe-top)`
    on the top bar
    (M1)
- **Files / Edit / Voice /
  Git tab bodies** are
  still placeholders
  (their panes are
  desktop-only — wiring
  them to mobile is
  3a-3c / 5d-5e work, not
  M1). M1's job is the
  SHELL: chrome, safe
  areas, touch targets.

### Verified

- `npx tsc --noEmit` — clean
- `npx vitest run` — **195/195
  pass** (12 files),
  including 9 new
  `deviceEmulatorStore`
  tests and 8 new
  `TOP_8_DEVICES` shape /
  invariant tests
- `npm run build` — clean
- `cargo check` — clean

### Added (Phase 5c — tool call review before run: edit args in the confirmation modal)

- **Editable args before run.** The
  `ConfirmToolCallModal` is now a
  *review* surface, not just a
  confirmation prompt. The user can
  edit the args JSON before approving
  a tool call. The 5d modal
  (`<pre>{pending.argsJson}</pre>`)
  is replaced by a `<textarea>` with:
  - **Live JSON validation** —
    `JSON.parse` runs in a `useEffect`
    on every keystroke. The
    "Run once" / "Always allow"
    buttons are disabled when the
    JSON doesn't parse. "Deny" stays
    always enabled (a stuck tool can
    always be refused, regardless of
    args validity).
  - **Inline error message** — when
    the JSON is invalid, a
    `role="alert"` region under the
    textarea shows the parse error.
    The textarea itself gets a red
    border via `data-invalid="true"`
    and a faint red glow.
  - **"Reset to model's version"
    link** — visible only when the
    user has edited. Clicking it
    reverts the textarea to the
    original `pending.argsJson`.
  - **Footer hint adapts** — when
    edited, the hint reads "Edits
    will be sent to the tool as the
    executed arguments." (vs the
    default "The model wants to call
    this tool. Choose how to handle
    it.").
  - **A11y hardening** — the
    textarea disables spellcheck,
    iOS auto-correct, and
    auto-capitalise (each can
    mutate JSON keys / quotes).
    `tab-size: 2` so hand-formatting
    is pleasant. `aria-invalid` and
    `aria-describedby` wire the
    error to the textarea for
    screen readers.
- **`resolveConfirmation(decision,
  editedArgsJson?)`** — the store's
  confirmation resolver now takes an
  optional second arg. The resolver
  computes the *executed args*:
  - If the caller passes a
    non-undefined `editedArgsJson`,
    that's the executed args.
  - Otherwise, the resolver falls
    back to `pending.argsJson` (the
    pretty-printed version that's
    pre-cached on the modal). This
    is backward compatible with 5d
    call sites that don't pass the
    second arg.
- **Write-back to `call.input`.**
  `applyConfirmationAndResume` writes
  the executed args back to the
  `ToolCall.input` field *before* the
  executor runs. This means:
  - The follow-up `ai://chunk` stream
    sees the executed args in the
    assistant message's `toolCalls`
    (replay uses edited values, not
    the model's).
  - The activity log (5e) records
    the executed args (the user can
    audit exactly what ran, not what
    the model emitted).
  - The ToolTrace UI (5b-6) shows
    the executed args in the call
    card.
  - Deny short-circuits the
    write-back (preserves the wire
    args for the ToolTrace audit
    display — the user can still
    see what the model wanted to
    run).
- **Executor sees executed args
  directly.** The executor call now
  passes the local `executedArgsJson`
  variable to `arguments:` (not the
  stale `call.input` reference,
  which was captured at the top of
  `applyConfirmationAndResume` and
  frozen before the write-back). The
  change is one line but easy to
  miss — the test suite guards it
  (regression test: "passes edited
  args to the executor").
- **Decision logging semantics**
  changed: the `argsPreview` field
  on a `DecisionRecord` now records
  the *executed* args, not the
  model's original. This makes
  the activity log the
  ground-truth audit trail of what
  actually ran.

### Verified

- `npx tsc --noEmit` — clean
- `npx vitest run` — **255/255
  pass** (13 files), including 7
  new `edit args before run (5c)`
  tests in `aiStore.test.ts`:
  - passes edited args to the
    executor (allow_once)
  - writes edited args back to
    call.input (audit trail sees
    executed args)
  - records edited args in the
    activity log (not the model
    original)
  - passes edited args to the
    executor on allow_always (and
    still promotes the policy)
  - does NOT write back to
    call.input on deny (no
    execution happened)
  - falls back to the model
    original when editedArgsJson
    is undefined (backward compat)
  - passes edited args through to
    the follow-up tool message
    (the model sees the edits)
- `npm run build` — clean
- `cargo check` — clean

### Added (Command palette — `Cmd-Shift-P` / `Ctrl-Shift-P` launcher)

- **Cross-screen launcher.** New
  `CommandPaletteModal` mounted
  in `main.tsx` (above the
  screen router) so the
  palette is always reachable
  regardless of which screen
  is active. Bound to
  `Cmd-Shift-P` /
  `Ctrl-Shift-P` via a new
  `useCommandPaletteShortcut`
  hook (also in
  `src/shared/hooks/`). The
  shortcut is suppressed when
  the user is typing in an
  `<input>` /
  `<textarea>` /
  `[contenteditable]` so it
  doesn't pop a modal over
  Monaco's editor.
- **Data-driven command
  registry.** New
  `src/shared/commands/commands.ts`
  defines a `Command`
  interface (`id`, `title`,
  `subtitle?`, `group`,
  `keywords?`, `shortcut?`,
  `isDev?`, `isEnabled?`,
  `run`) and a `COMMANDS`
  array. Adding a new command
  is one entry in the array —
  no UI changes needed.
  Initial command set (10):
  - **Open Settings** —
    `appStore.setActiveScreen('settings')`
  - **Go to Editor** —
    `appStore.setActiveScreen('editor')`
  - **New chat** —
    `aiStore.clearMessages()`,
    disabled while a stream is
    in flight
  - **Cancel current stream**
    — `aiStore.stop()`,
    enabled only while
    streaming
  - **Switch AI provider:
    OpenAI / Anthropic** —
    `aiStore.setProvider(…)`
  - **Reset all tool
    settings** —
    `toolSettingsStore.clearAllSettings()`,
    disabled when there's
    nothing to clear
  - **Clear activity log** —
    `toolDecisionLogStore.clearLog()`,
    disabled when the log is
    empty
  - **Reload custom tools
    from `lipi-tools.json`** —
    enabled only when a
    workspace is open
  - **Toggle device emulator**
    — dev-only
- **Fuzzy filter.**
  `filterCommands(query)` is a
  pure subsequence matcher —
  every char in the query
  must appear in the
  haystack in order, case-
  insensitive, across title +
  subtitle + keywords. Multi-
  term queries split on
  whitespace; every term must
  match somewhere. Scoring:
  exact-prefix title (0) <
  exact title (1) <
  subsequence in title (2) <
  subsequence in subtitle (3)
  < subsequence in keywords
  (4). Within a score tier,
  original registry order is
  preserved (common commands
  are declared first). No
  external fuzzy library —
  the command set is small
  (currently 10) and a
  subsequence matcher is
  sub-millisecond.
- **Context-aware
  `isEnabled` predicates.**
  Some commands are only
  meaningful in certain
  states ("Cancel stream" is
  only enabled while a stream
  is in flight; "New chat"
  is only enabled when no
  stream is in flight;
  "Reload custom tools" only
  when a workspace is open;
  "Reset all tool settings"
  only when there's
  something to reset). The
  predicates run on every
  render (every keystroke),
  so the row state is
  always up-to-date. Disabled
  rows render dimmed but
  stay focusable (with
  `aria-disabled="true"`) so
  screen-reader users can
  still hear "this command
  exists, just not now".
- **a11y.** The input has
  `role="combobox"` +
  `aria-expanded` +
  `aria-controls` +
  `aria-activedescendant`
  pointing at the currently
  highlighted row. The list
  is `role="listbox"`, each
  row is `role="option"` with
  `aria-selected`. Up/Down
  arrows move the highlight
  (clamped to the visible
  list, with auto-scroll-
  into-view via a
  `useEffect` that watches
  the clamped index). Enter
  runs the highlighted
  command. Escape closes (via
  the shared `Modal`
  primitive's built-in ESC
  handler). Home/End jump
  to top/bottom.
- **`useCommandPaletteStore`**
  (new, in
  `src/shared/state/`). Tiny
  UI-state primitive: `open`,
  `query`, `selectedIndex`,
  plus `show` / `hide` /
  `setQuery` /
  `moveSelection` /
  `setSelection`. `setQuery`
  resets `selectedIndex` to
  0 (launcher convention —
  the user always starts at
  the top after a query
  change). The store does
  NOT clamp the index; the
  modal does that against
  the filtered list length
  (and treats `selectedIndex
  < 0` as "no selection" for
  an empty result list).
- **Modal positioning.**
  Uses the shared `Modal`
  primitive with a
  narrower `className`
  override (480px instead of
  the default 520px). The
  list scrolls inside the
  modal's
  `max-height: 80vh`. z-index
  is 10000 (vs
  `ConfirmToolCallModal`'s
  9000) so the palette wins
  on conflicts.

### Verified

- `npx tsc --noEmit` — clean
- `npx vitest run` —
  **281/281 pass** (15
  files), including 16 new
  `filterCommands` tests in
  `src/shared/commands/commands.test.ts`
  and 10 new store tests in
  `src/shared/state/commandPaletteStore.test.ts`:
  - empty / whitespace
    query returns the full
    list
  - exact title prefix
    match ranks first
  - exact title match
    still high-ranked
  - keyword matches
    surface commands not
    in the title
  - multi-term query
    (every term must
    match)
  - non-matching term
    excludes the command
  - case-insensitive
  - stable registry order
    within a score tier
  - subsequence match
    (chars in order)
  - empty result for
    no-match query
  - subtitle text matches
  - well-formed groups
  - dev commands
    flagged
  - non-empty id / title /
    run function
  - unique command ids
  - store: show() opens
    and clears stale state
  - store: hide() closes
    but preserves query /
    selection
  - store: setQuery
    resets selectedIndex
  - store: setQuery('')
    also resets
  - store: moveSelection
    increments /
    decrements
  - store: moveSelection
    does NOT clamp (the
    modal does)
  - store: setSelection
    sets explicit index
  - store: full lifecycle
    (show → type →
    navigate → hide)
- `npm run build` — clean
- `cargo check` — clean

### Added (Open Folder / Welcome screen)

- **`useWorkspaceStore`** (new
  Zustand store in
  `src/shared/state/`). The
  cross-screen source of
  truth for "which folder
  is currently open". State:
  `hydrated`, `currentPath`,
  `recents` (capped at 5,
  most recent first, deduped),
  and a transient
  `status: 'idle' | 'opening'
  | 'ready' | 'error'`.
  Actions: `hydrate()` (reads
  from `localStorage` once,
  idempotent), `open(path)`
  (commits the path,
  prepends to recents,
  persists), `close()`
  (clears `currentPath` but
  preserves recents),
  `setStatus(status)` for
  transient UI, `clearRecents()`
  and `removeRecent(path)`.
  Storage keys:
  `lipi:workspace:v1` (the
  current path) and
  `lipi:workspace:recents:v1`
  (the recents list). Hydration
  validates the JSON shape —
  a corrupt `currentPath` is
  dropped to `null`, a
  non-array `recents` is
  dropped to `[]` (so a
  poisoned `localStorage`
  entry can't take down the
  router).
- **Welcome screen**
  (`src/screens/Welcome/`).
  Renders when
  `useWorkspaceStore.currentPath
  === null`. Body: brand
  mark, one-line value
  prop, primary "Open
  Folder" button (large,
  shows spinner on
  `status: 'opening'`),
  inline error banner on
  `status: 'error'`,
  recents list (capped at
  5, most recent first,
  with a per-row "remove"
  button that calls
  `removeRecent()`), and
  a footer hint about
  the command-palette
  shortcut. The screen
  receives a `renderActions`
  prop for the host
  (`AppRoot`) to inject
  top-right buttons (e.g.
  Settings) without the
  screen importing the
  app store directly.
- **`useOpenWorkspace()`**
  hook + `openWorkspace()`
  pure function (in
  `src/screens/Welcome/hooks/`).
  The single bridge between
  the "Open Folder" UI and
  the Tauri filesystem.
  Pure function holds the
  control flow (concurrent-
  open guard via
  `status.kind === 'opening'`,
  picker-throws → error
  banner, picker-returns-null
  → cancel-and-idle,
  success → `useWorkspaceStore.open(path)`)
  and the hook is a thin
  `useCallback` wrapper so
  the same logic is callable
  from the palette / Welcome
  button / future
  auto-restore flows. Native
  picker is the existing
  `fs_pick_folder` Rust
  command
  (`tauri-plugin-dialog`)
  re-exposed on the TS side
  as `pickFolder()`.
- **Two-axis router** in
  `src/main.tsx`. Priority:
  (1) `useAppStore.activeScreen === 'settings'`
  → `<SettingsProvider />`
  (overlays both bases);
  (2) `useWorkspaceStore.hydrated
  === false` → invisible
  boot placeholder (one-
  frame, prevents the hero
  from flashing when a
  saved workspace is about
  to load); (3)
  `useWorkspaceStore.currentPath
  === null` → `<Welcome />`;
  (4) otherwise →
  `<EditorWorkspace />`.
  The `appStore` `Screen`
  union is extended to add
  `'welcome'` (initial
  value) — the existing
  `'editor'` and `'settings'`
  values are kept. The
  Settings screen's back
  button now branches on
  `workspaceStore.currentPath`:
  back to `'welcome'` if
  no folder is open, back
  to `'editor'` otherwise.
- **Command palette gets
  three new commands**:
  `workspace.open` ("Open
  Folder…", bound to the
  new `Cmd-Shift-O` /
  `Ctrl-Shift-O` global
  shortcut), `workspace.close`
  ("Close Folder", enabled
  only when a folder is
  open), and a dynamic
  `workspace.recent.0..N`
  set — one per entry in
  `useWorkspaceStore.recents`,
  built at render time
  via a new
  `getRecentsCommands()`
  exported from
  `src/shared/commands/commands.ts`.
  The modal merges the
  static + dynamic lists
  and runs the same fuzzy
  subsequence scoring on
  both, so typing
  "recent" surfaces the
  recent entries. The
  palette's `useMemo`
  re-runs whenever
  `recents` changes
  (subscribed via
  `useWorkspaceStore`).
- **`useOpenFolderShortcut`**
  hook
  (`src/shared/hooks/`).
  Dedicated global
  `Cmd-Shift-O` /
  `Ctrl-Shift-O` listener
  that calls
  `openWorkspace()` directly,
  bypassing the palette
  modal — the picker is
  a native dialog and a
  dedicated shortcut is
  more ergonomic than
  going through a
  cross-screen modal. The
  shortcut is suppressed
  when the user is typing
  in an input / textarea
  / contenteditable. The
  `Command` registry's
  `workspace.open` entry
  advertises the same
  shortcut on its row, so
  the two surfaces stay
  in sync.
- **`useWorkspaceSync`**
  hook
  (`src/shared/hooks/`).
  The bridge that makes
  the new
  `useWorkspaceStore` the
  single source of truth
  for "which folder". On
  mount, it propagates the
  current workspace path
  to the three downstream
  stores that previously
  each tracked their own
  `rootPath` /
  `workspaceRoot`:
  `useFileTreeStore`
  (calls `setRoot(next)`
  or `reset()` for
  null), `useGitStore`
  (calls `setRoot(next)`),
  and `useCustomToolsStore`
  (sets `workspaceRoot`
  via `setState`). On
  subsequent
  `useWorkspaceStore`
  changes, the same
  propagation runs.
  `useFileTree.openFolder()`
  (the file tree's own
  "open" affordance) now
  pushes the chosen path
  to `useWorkspaceStore`
  first (so the recents
  list gets the path)
  before kicking off the
  file tree's lazy
  `readDir`.
- **`appStore` updated**:
  the `Screen` union grows
  from `'editor' | 'settings'`
  to `'editor' | 'settings'
  | 'welcome'`. The default
  `activeScreen` is now
  `'welcome'` (the router
  in `main.tsx` ignores it
  when a workspace is open;
  the welcome screen is the
  natural default for
  first-run anyway).
- **Welcome screen styles**:
  new
  `Welcome.module.css` —
  centred hero, folder
  glyphs (inline SVG, no
  asset files), per-row
  remove button that
  appears on hover /
  focus-within.
- **Settings header button**:
  `AppRoot` injects a
  ghost-variant "Settings"
  button into the Welcome
  screen header via
  `renderActions`, so the
  user can open the AI
  provider config from
  the Welcome screen (useful
  for first-run when they
  haven't set a key yet).
  The same `setActiveScreen('settings')`
  action that the
  editor's titlebar ⚙
  uses — no new code path.

### Verified

- All 312 tests pass
  (`npx vitest run`):
  - 20 new tests for
    `useWorkspaceStore`
    (hydrate, open, close,
    recents dedup, status,
    persistence round-trip,
    `removeRecent`)
  - 5 new tests for
    `openWorkspace()` (no-arg
    picker, with-arg path,
    user cancel, picker
    throws, concurrent-open
    guard)
  - 6 new tests for the
    palette's workspace
    commands + recents
- `npx tsc --noEmit` —
  clean
- `npm run build` — clean
- `cargo check` — clean
- Titlebar subtitle bumped
  from `dev · 5c` to
  `dev · welcome` in
  `EditorWorkspace.tsx`

### Known limitations

- The Welcome screen
  doesn't auto-restore
  the last workspace yet
  — it always shows the
  hero on first paint, and
  the workspace is
  re-opened via the recents
  list or a manual "Open
  Folder" click. A future
  phase will add a
  "Resume last workspace"
  button at the top of the
  recents list.
- The `useWorkspaceSync`
  hook is mounted in
  `AppRoot` and runs once.
  It has no test (mounting
  a React component in a
  Vitest harness requires
  `@testing-library/react`,
  which the project does
  not ship). The
  propagation logic is
  covered indirectly by
  the store tests (each
  downstream store's
  state-shape is verified
  after a `setRoot` call).

### Added (Phase 5a — bulk reset all tool settings with undo)

- **Soft-delete + undo for tool
  settings** in `toolSettingsStore`.
  Three new actions:
  `clearAllSettings()`,
  `undoClearAllSettings()`, and
  `discardUndoAllSettings()`. Mirrors
  the 5h activity-log pattern, but
  the undo buffer is
  `localStorage`-backed
  (`lipi:toolSettings:undo:v1`) —
  not in-memory — so a page reload
  during the 5s window doesn't
  silently drop the user's reset.
  Rationale in the
  `STORAGE_KEY_UNDO` JSDoc.
- **`hasPendingUndo()` selector**
  for the UI to react to the
  pending state.
- **No-op semantics**: a clear is
  a no-op when the current state
  is fully empty (no disabled
  tools AND only default-mode
  entries in `confirmationMode`)
  so the UI doesn't pop a
  confusing "Reset nothing"
  toast.
- **`pendingUndo` field** on the
  store, hydrated from the
  undo-buffer key on startup.
  Lets the UI re-arm the 5s
  timer on mount after a reload.
- **Danger Zone section** at the
  bottom of the Settings screen,
  with a single card
  ("Reset all tool settings") and
  a 5-second undo toast. The
  card uses the design system's
  `Button variant="danger"`
  variant and a thin
  `--color-danger` left border
  to signal "destructive" without
  screaming. The body text
  explains the soft-delete
  contract.
- The AI provider API keys
  (in the OS keychain) are NOT
  affected by this button — only
  the per-tool settings. This is
  called out in the section lede.
- 14 new store tests covering:
  soft-delete on a non-empty
  state, the empty-state
  no-op, the
  buffer-write path, restore +
  buffer-drop, no-op when the
  buffer is absent, malformed-
  buffer defensive drop, the
  full clear→undo→clear→undo
  cycle, `discardUndo` happy
  path + no-op, and the
  `hydrate()` round-trip
  (pendingUndo survives a
  reload, is `false` when the
  buffer is absent).

### Verified

- `npx tsc --noEmit` — clean
- `npx vitest run` — **210/210
  pass** (12 files), including
  the 14 new
  `toolSettingsStore` 5a tests
- `npm run build` — clean
- `cargo check` — clean

### Added (Phase 5b — settings export / import)

- **New module
  `src/shared/settingsIO.ts`**
  with the pure IO functions:
  `buildSettingsFile()`,
  `parseSettingsFile()`,
  `serialiseSettingsFile()`,
  `suggestFilename()`. Plus
  the schema-versioned
  envelope types
  (`SettingsFile`,
  `SettingsFileData`,
  `ExportedToolSettings`) and
  the `ParseResult` /
  `ParseError` tagged union
  (so the UI can show a
  specific error message
  instead of a generic
  "bad file" toast).
- **File format**:
  ```json
  {
    "format": "lipi-settings",
    "version": 1,
    "exportedAt": "2026-06-11T15:30:00.000Z",
    "data": {
      "toolSettings": {
        "disabledToolNames": [...],
        "confirmationMode": {...}
      }
    }
  }
  ```
  Pretty-printed with 2-space
  indent so a user can open
  the file in a text editor
  and see what they're
  importing. The `format`
  magic string is the first
  guard — a user accidentally
  picking the wrong file
  gets a clear "not a Lipi
  settings file" error
  before the parser even
  looks at the data.
- **Scope decision** (in the
  JSDoc): only the tool
  settings are exported. The
  activity log is per-machine
  audit trail, the device
  emulator flag is
  session-only, the undo
  buffer is transient
  recovery state — none of
  them belong in a portable
  settings file. The OS-
  keychain API keys are
  obviously not included
  (they're not even in JS).
- **`toolSettingsStore`**:
  new `applyImportedSettings()`
  action. Replace semantics
  (not merge — merging would
  silently combine per-tool
  entries from two sources,
  which is surprising). Goes
  through the same 5a soft-
  delete + 5s-undo pattern:
  the pre-import state is
  stashed in the existing
  `lipi:toolSettings:undo:v1`
  buffer, the user can
  `undoClearAllSettings()`
  within the 5s window to
  restore. No-op when the
  imported state matches the
  current state (no spurious
  undo toast for a
  round-trip on the same
  machine).
- **Shared helper
  `replaceWithUndo()`** in
  the store — module-level
  function that takes
  `(get, set, next)` and
  handles the
  snapshot-then-write dance.
  Used by both
  `clearAllSettings` (5a)
  and
  `applyImportedSettings`
  (5b), so the two
  destructive write paths
  stay in lock-step.
- **New "Backup & Restore"
  section** at the top of
  the Settings screen,
  above the Danger Zone
  (because it's the more
  common / less destructive
  action). Two buttons:
  `Export…` (downloads
  `lipi-settings-YYYY-MM-DD.json`
  via `Blob` + `<a download>`)
  and `Import…` (triggers a
  hidden file input).
  Import errors surface as
  a sticky red bar with the
  parser's specific message
  (e.g. "File is from a
  newer Lipi (version 2)").
  Success notices auto-
  dismiss after 3s. The
  undo toast is SHARED with
  the Danger Zone's "Reset
  all" — both go through
  `replaceWithUndo`, so
  there's a single
  consistent "5 seconds to
  undo" affordance.
- **28 new tests in
  `settingsIO.test.ts`**:
  happy-path round-trips
  (empty, non-empty, 100-
  tool + 100-policy),
  rejection paths (bad JSON,
  non-object top-level,
  wrong `format` magic,
  missing `version`,
  non-integer `version`,
  version too new, version
  too old, missing `data`,
  missing `toolSettings`,
  `disabledToolNames` not
  array, `disabledToolNames`
  with non-strings,
  `confirmationMode` not
  object, `confirmationMode`
  with invalid mode value),
  filename formatting
  (local date, zero-pad),
  file-size sanity (typical
  export < 10KB, 1000-tool
  export < 100KB), error-
  message human-readability
  (mentions the field name).
- **10 new tests in
  `toolSettingsStore.test.ts`**:
  `applyImportedSettings`
  replaces state, sets
  `pendingUndo`, writes the
  undo buffer, persists to
  v2, no-op on matching
  state, no-op on
  empty-to-empty, undo via
  the shared 5a buffer,
  last-write-wins on the
  undo buffer (a Reset
  followed by an Import
  leaves the buffer at the
  pre-Import state), the
  full round-trip through
  persistence (import →
  reload → undo restores
  pre-import state).

### Verified

- `npx tsc --noEmit` — clean
- `npx vitest run` — **248/248
  pass** (13 files; +28 in
  `settingsIO.test.ts`, +10
  in `toolSettingsStore.test.ts`)
- `npm run build` — clean
- `cargo check` — clean

### Added (Phase 5h — soft-delete with undo for Clear log)

- **Soft-delete with undo** in
  `toolDecisionLogStore`. The
  destructive `clearLog()` action
  no longer hard-deletes the
  records: it moves the current
  `records` array into a new
  `lastCleared` field, so the
  records can be restored via
  `undoClear()`. `clearLog()`
  on an empty log is a no-op
  (no phantom undo offer).
- **`undoClear()` and
  `discardUndo()` actions**:
  `undoClear()` restores the
  buffer and clears it
  (single-shot undo); both
  are no-ops when the buffer
  is null. `discardUndo()`
  drops the buffer without
  restoring — the UI calls
  this when the 5-second undo
  window expires.
- **Undo toast in the
  Settings UI**: clicking
  [Clear log] no longer shows
  a `window.confirm` dialog.
  Instead, the records are
  cleared immediately AND a
  small bar appears at the
  top of the Activity Log
  section: "Cleared N
  decisions. [Undo]". The
  toast has a 5-second
  window (matching industry
  conventions — Gmail's
  Undo Send, Notion's trash
  restore, Linear's archive
  undo). The bar uses
  `role="status"` +
  `aria-live="polite"` so
  screen readers announce
  it; the Undo button is a
  plain `<button>` with an
  accent colour and
  underline-on-hover for
  keyboard users.
- **In-memory only**: the
  undo buffer is not
  persisted to `localStorage`.
  A page reload drops the
  buffer. The trade-off is
  intentional: the window is
  short (5s), persisting the
  buffer would grow the
  storage footprint, and the
  reload case is the user
  walking away from the
  action — at that point the
  clear is final.

### Verified

- `npx tsc --noEmit` — clean
- `npx vitest run` — **177/177
  pass** (10 files), including
  4 new `toolDecisionLogStore`
  `clearLog` / `undoClear` /
  `discardUndo` tests
- `npm run build` — clean
- `cargo check` — clean

### Added (Phase 5g — inline revert for allow_always)

- **`DecisionRecord.decision` extended**
  with a 4th value `'revert'` for
  the inline Undo action. The
  validator and the existing
  `recordDecision` / `getRecent*`
  selectors are updated to accept
  it. Revert records use
  well-known sentinel ids
  (`'revert'`) for `requestId`,
  `assistantMessageId`, and
  `toolCallId` so they are
  distinguishable from real
  tool-call decisions in
  cross-referencing code.
- **`Unrevert` button on
  `allow_always` rows** in the
  Activity Log. A small ghost
  button (danger colour on
  hover/focus — signals
  "downgrades a previously-
  granted permission") next to
  the existing "Jump to chat"
  button. Only `allow_always`
  rows get the button (deny /
  allow_once don't change the
  policy, so there's nothing to
  revert). On click: sets the
  tool's policy to
  `'always_confirm'` (the safe
  default — principle of least
  privilege) AND records a
  synthetic `revert` decision
  so the audit trail shows
  "user reverted their
  always-allow for tool X at
  time T".
- **Revert badge style**: a
  neutral grey, NOT danger
  colour. The revert is a
  positive safety action
  (tightening permissions), not
  an error.

### Verified

- `npx tsc --noEmit` — clean
- `npx vitest run` — **172/172
  pass** (10 files), including
  3 new `toolDecisionLogStore`
  `revert` tests
- `npm run build` — clean
- `cargo check` — clean

### Added (Phase 5f — jump to chat from Activity Log row)

- **`chatNavStore`** (new Zustand store,
  in-memory only, no `localStorage`
  persistence). Holds a single
  `pendingJump` record
  (`{ messageId, toolCallId, issuedAt }`).
  The Settings screen writes
  (`requestJump`); the AIPanel reads
  (`consumeJump`). Clear-on-read
  prevents the same jump from firing
  twice; a 30-second expiry
  (`JUMP_MAX_AGE_MS`) defends against
  far-stale jumps causing a visual
  flicker after a long idle.
- **AIPanel jump wiring**: the AIPanel
  holds two `Ref<Map<id, HTMLElement>>`
  (one for messages, one for tool
  traces). Each rendered
  `MessageRow` / `ToolTrace`
  registers its element by id via
  a ref-callback. On `pendingJump`,
  the AIPanel looks up the matching
  elements, scrolls the message into
  view (`scrollIntoView({block:
  'center'})`), and adds a
  `data-jump-highlight` attribute
  for 2 seconds. CSS animates a
  soft two-pulse ring around both
  the message bubble and the
  tool-trace card. Honours
  `prefers-reduced-motion` (no
  animation, single soft outline).
- **`DecisionRecord.toolCallId`**
  (new required field). The
  `toolDecisionLogStore` validator
  now requires it; 5e-era records
  (without the field) are dropped on
  hydrate. The recording site in
  `aiStore.resolveConfirmation`
  stamps the id from the
  `PendingConfirmation` at decision
  time.
- **Settings → Editor transition on
  row click**: the
  `DecisionLogCards` component now
  writes a jump to `chatNavStore`
  AND calls
  `useAppStore.setActiveScreen('editor')`.
  Order matters: jump first, then
  switch screen, so the AIPanel's
  subscribe callback fires after
  the panel is mounted.
- **Per-row "Jump to chat" button**:
  a small ghost button at the end
  of each row's main line. Visible
  affordance (not a hidden
  click-anywhere target) so users
  don't accidentally navigate
  away from Settings. Keyboard
  accessible (Tab + Enter). The
  row also gets a thin left-border
  accent (`data-jumpable`) so the
  interactive rows are visually
  distinguishable at a glance.

### Added (K — onboarding tour)

A 6-step in-app tour that
walks the user through the
four panes the first time
they open a workspace.
Dismissable, restorable from
the command palette, and
fully keyboard-navigable.

**Store** (`src/shared/state/tourStore.ts`):
- New Zustand store with
  `hydrated`, `dismissed`, and
  `currentStep` fields.
- Persists `lipi:tour:dismissed:v1`
  to `localStorage`. The step
  cursor is NOT persisted —
  the tour is a per-session
  experience; a returning
  user either sees it (first
  launch) or doesn't
  (subsequent launches).
- `start()` clears the
  dismissed flag and
  sets `currentStep` to 0.
  `next()` / `prev()` advance
  the cursor (pure +1 / -1).
  `finish()` persists
  `dismissed: true`.
- `restore()` on a thrown
  write is swallowed with a
  DEV-mode console.warn
  (the snapshot primitive
  itself logs the failure;
  the store just doesn't
  crash the user mid-import).
- 25 store tests covering
  hydrate (incl. private-mode
  fail-closed), start / next /
  prev / finish, the pure
  `_computeNextStep` /
  `_computePrevStep` helpers,
  and a full lifecycle
  integration.

**Step list**
(`src/shared/components/OnboardingTour/tourSteps.ts`):
- 6 steps: welcome (centered)
  → fileTree (anchored right)
  → sidePanel (anchored left)
  → aiVoice (anchored top)
  → commandPalette (centered)
  → outro (centered).
- The `commandPalette` step
  is centered (not anchored)
  because the palette is only
  on screen when open, and
  the editor's UI has no
  single natural anchor for
  "where the palette lives".
  Centering keeps the callout
  visible without searching
  for a non-existent target.
- A pure `computeTourShouldAutoStart`
  gate — the auto-start
  effect calls it once both
  the tour store and the
  workspace store have
  hydrated. The gate returns
  `true` only when the user
  has a workspace open AND
  hasn't dismissed the tour
  on a previous launch.
- 15 step-list tests pinning
  the shape (id uniqueness,
  non-empty copy, title/body
  length caps, every anchored
  step has a target, at
  least one centered step).

**Placement math**
(`src/shared/components/OnboardingTour/placement.ts`):
- Pure `computeAnchoredLayout`
  places a callout next to
  a target rect, with auto-
  flip to the opposite side
  if the requested side
  would clip the viewport.
  Falls back to centered if
  BOTH sides would clip.
- `computeCenterLayout` for
  the `kind: 'center'`
  steps.
- The placement math
  takes the viewport as an
  explicit argument (no
  `window.innerWidth`
  fallback) so it's fully
  testable in a JSDOM
  environment.
- 9 placement tests covering
  each side, flip, fallback,
  and viewport clamping.

**Callout sizing**
(`src/shared/components/OnboardingTour/calloutSize.ts`):
- Pure helper: a step's
  callout grows in height
  with body length. Steps
  under 100 chars get the
  default 180px height;
  100–160 chars get 220px;
  over 160 chars get 260px.
  Pinned by the body-length
  invariant in
  `tourSteps.test.ts`
  (every body < 200 chars).

**Component**
(`src/shared/components/OnboardingTour/OnboardingTour.tsx`):
- The overlay renders a
  fixed-positioned backdrop
  with a centered or
  anchored callout. The
  callout has Prev / Skip /
  Next / Finish buttons (Prev
  disabled on step 0; Next
  becomes Finish on the last
  step; "No changes" path is
  not used here — the tour
  is always at least 6
  steps).
- Keyboard nav: `←` prev,
  `→` / `Enter` next /
  finish, `Esc` dismiss.
  Input / textarea /
  contentEditable targets
  swallow the keys so the
  user typing in the command
  palette's search box
  doesn't accidentally
  advance the tour.
- A `useAnchorRect` hook
  subscribes to the
  target's
  `getBoundingClientRect()`
  on scroll / resize via
  rAF. The callout follows
  the anchor if the user
  pans the editor mid-step.
- Backdrop click dismisses
  the tour (clicks inside
  the callout are stopped
  via `e.stopPropagation`).
- The auto-start effect
  runs once when both
  stores have hydrated.
  If the user closes the
  workspace mid-tour, an
  effect calls `finish()`
  automatically so the
  tour doesn't get stuck
  on a step.

**Command palette**
(`src/shared/commands/commands.ts`):
- New "Restart onboarding
  tour" entry in the
  **Help** group. Calls
  `useTourStore.getState().start()`.

**Anchors added** (4 sites):
- `data-tour-target="welcome.openFolder"`
  on the Welcome screen's
  primary "Open Folder" button.
- `data-tour-target="fileTree"`
  on the FileTreePane body
  (a `<div>` wrapping the
  existing tree render).
- `data-tour-target="sidePanel"`
  on the SidePanelPane root.
- `data-tour-target="aiVoiceButton"`
  on the AIPanel's
  `voiceCluster` span
  (the cluster that holds
  the VoiceButton).

**v1 limitations** (called
out for follow-up):
- The tour is desktop-only.
  On mobile the file tree
  / side panel are replaced
  by the MobileShell tab
  bar, so the anchored
  steps wouldn't find
  their targets. The
  centered steps still
  show; the anchored steps
  fall back to center. A
  future K iteration can
  gate by viewport or
  build a parallel mobile
  step list.
- No animations. The
  callouts appear / disappear
  instantly. A v2 polish
  could add 120ms fades.
  Skipped for v1 to keep
  the tour snappy (a 6-step
  tour with 720ms total
  animation delay is a
  noticeable cost for a
  "5 seconds to get
  oriented" feature).

**Tests added**: 25 store +
15 steps + 9 placement = **49
new tests**.

**Verify (all green):**
- TSC: clean
- Vitest: 56 files, 700
  tests pass (was 651 before
  the K phase, +5 files /
  +49 tests).
- Vite build: clean

### Added (S3 — settings v3 transactional import + preview)

The Privacy & data Settings
card's import flow is now
transactional: a snapshot
of all three stores is taken
before any write, and
restored on failure. A
field-level diff preview
shows the user exactly
what will change BEFORE
they commit. Decision #63
in HANDOFF §4 documents the
S2 → S3 deferred follow-up
shape; this phase delivers
it.

**Snapshot primitive**
(`src/shared/storeSnapshot.ts`):
- `createStoreSnapshot(read, write)`
  — takes a `read()` and a
  `write(value)` closure,
  captures the read result
  at call time, returns
  `{ value, restore }`. The
  `restore()` is tolerant of
  a throwing `write` (logs
  in DEV, continues; a
  half-restored state is
  worse than a logged
  error).
- `snapshotStores(s1, s2, s3)`
  — convenience for the
  S3 v3 apply's three-store
  case.
- `restoreSnapshots(snapshots)`
  — restores in REVERSE
  order. For `toolSettings`
  whose apply pushes a 5a
  undo entry, restoring in
  reverse avoids a second
  undo push on a
  10-second-old import.
- 10 tests covering the
  primitive, the
  3-tuple helper, and
  the reverse-order
  restore.

**v3 apply**
(`src/shared/settingsIOv3.apply.ts`):
- `applyLipiStateV3(data)` —
  snapshots all three
  stores, applies the v2
  payload, restores on
  any step throwing. The
  return shape is identical
  to the v2
  `ApplyLipiStateV2Result`
  so the UI doesn't need
  to change.
- Differences from v2:
  - Snapshots are taken
    BEFORE any write
    (v2 wrote sequentially
    and accepted a partial
    state on failure).
  - On any step throwing,
    the snapshots are
    restored in reverse
    order. The user's
    local state is
    guaranteed to end up
    exactly as it was.
  - The restore uses a
    direct `setState` (not
    `applyImportedSettings`)
    for the `toolSettings`
    half — a "no questions
    asked, put the state
    back" restore is not
    undoable in turn.
- The v2 `applyLipiStateV2`
  is preserved on disk as
  a documented fallback
  (the import strategy is
  a code-side decision, not
  a file-shape version).
- 6 tests covering the
  success path, all three
  failure modes (workspace,
  voice-preferences,
  tool-settings), and the
  "snapshot is point-in-time,
  post-snapshot store
  mutations don't leak into
  the restore" invariant.

**Import preview**
(`src/shared/settingsIOv3.preview.ts`):
- `computeLipiStateImportPreview(current, incoming)`
  returns `{ diffs, changeCount, isNoOp }`.
  Diffs cover:
  - `workspace.currentPath`
    (string diff)
  - `workspace.recents`
    (added / removed
    entries)
  - `voicePreferences.provider`
    (string diff)
  - `toolSettings.disabledToolNames`
    (added / removed
    tools)
  - `toolSettings.confirmationMode.<tool>`
    (per-tool changes;
    a tool that exists in
    one but not the other
    is surfaced as a
    `null` diff).
- 11 tests covering each
  field, the no-op case,
  and the changeCount
  invariant.

**PrivacyDataCard** (`src/screens/SettingsProvider/components/PrivacyDataCard.tsx`):
- New import flow:
  `parse → preview → confirm → apply`.
  The v2 `window.confirm`
  is replaced by an
  in-card preview block.
- "No changes" is a valid
  result: the file is
  identical to the
  current state. The
  preview shows a "No
  changes" message and
  the Apply button is
  disabled (a no-op apply
  is a wasted user
  gesture).
- A new `previewDiffLabel`
  pure helper formats a
  diff row for the UI
  (workspace path arrow,
  recents added / removed
  counts, voice provider
  arrow, per-tool
  confirmation arrow).
  8 new tests pin the
  wording.

**Tests added**: 10 snapshot
+ 6 v3 apply + 11 preview +
8 previewDiffLabel = **35
new tests**.

**Verify (all green):**
- TSC: clean
- Vitest: 59 files, 735
  tests pass (was 700
  before the S3 phase,
  +3 files / +35 tests).
- Vite build: clean

### Verified

- `npx tsc --noEmit` — clean
- `npx vitest run` — **169/169
  pass** (10 files), including 7
  new `chatNavStore` tests and 2
  new `toolDecisionLogStore`
  `toolCallId` tests
- `npm run build` — clean
- `cargo check` — clean

### Added (Decision #66 polish — file-tree right-click context menu)

The v1 file-tree
right-click menu
used `window.prompt`
for new-file /
rename name entry
and `window.confirm`
for the destructive
delete gate. That
flow was functional
but visually jarring
(native modal
breaking the app's
visual identity) and
inaccessible (no
keyboard nav, no
focus trap, no ARIA
roles). This phase
replaces it with 3
purpose-built
components, all
following Rule 4
(component reuse)
and Rule 7 (design
tokens). Decision
#66 in HANDOFF §4
documents the
"ship-the-feature-
now, polish-later"
tradeoff; this
phase delivers the
polish.

**Context menu** (new
`FileRowContextMenu`
in
`src/screens/EditorWorkspace/components/FileTreePane/FileRowContextMenu.tsx`):
a floating
`<ul role="menu">`
anchored at the
right-click
`clientX` /
`clientY`. Each item
carries a typed
`action: 'new-file' |
'rename' | 'delete'`
and an optional
`destructive` flag
(the Delete item).
The menu:
- Auto-flips to the
  left / up when the
  click was near the
  right / bottom
  edge of the
  viewport (pure
  helper
  `computeContextMenuPosition`,
  tested with 4
  edge cases: room
  available,
  near-right edge,
  near-bottom edge,
  far-past-right
  edge).
- Closes on
  outside-click
  (document-level
  `mousedown`),
  Escape, or item
  activation.
- Supports
  keyboard nav
  (arrow up / down
  to move, Enter
  or Space to
  activate, Home /
  End to jump to
  the first / last
  item). Disabled
  items are skipped
  when arrowing
  past them.
- Mouse hover
  updates the
  focused index,
  so the mouse and
  keyboard stay in
  lockstep (hovering
  item 3 then
  pressing Enter
  activates item 3).
- Renders a
  `data-destructive`
  attribute on
  destructive
  items so the CSS
  can paint them
  in the danger
  colour.

**Inline name input**
(new
`InlineNameInput`):
a modal that
reuses the shared
`Modal` primitive,
wrapping it with a
labelled text
input + Cancel /
Submit buttons.
Used for both
"New File" and
"Rename" actions
(driven by the
`mode: 'new-file' |
'rename'` prop).
Behaviour:
- Pre-populates
  with a sensible
  default
  (`suggestNewFileName(existingNames)`
  for new-file, the
  current name for
  rename).
- On `rename` mode,
  pre-selects the
  BASENAME (not the
  extension) on
  open, so the
  user can type to
  replace the name
  without retyping
  the extension.
  On `new-file`
  mode, pre-selects
  the whole value.
- Validates the
  input on every
  keystroke via
  the pure helper
  `validateFileName`
  (see below).
  The submit
  button is
  disabled when
  the value is
  invalid.
- Shows the
  inline error
  message only
  after the user
  has touched the
  input (avoids
  the "yelled at
  on first open"
  UX).
- Re-validates on
  submit (defends
  against a paste
  + submit in the
  same frame).

**Confirm destructive
modal** (new
`ConfirmDestructiveModal`):
a modal that
reuses the shared
`Modal` primitive,
wrapping it with a
title + body +
Cancel / Delete
button pair. Used
for the delete
gate. The Delete
button uses
`Button`'s
`variant="danger"`.
The body varies
based on `kind`:
- `'file'` →
  `Delete "foo.txt"? This cannot be undone.`
- `'folder'` →
  `Delete folder "bar" and all its contents? This cannot be undone.`

**Pure helpers**
(new
`fileNameValidation.ts`):
- `validateFileName(name, existingNames)` —
  a discriminated
  union: success
  with the trimmed
  / cleaned name,
  or failure with
  a human-readable
  reason. Rules:
  1. Not empty
     after trim.
  2. Not `.` or
     `..`.
  3. No path
     separators or
     other Windows-illegal
     characters
     (the strictest
     filesystem we
     support; POSIX
     is a subset).
  4. Not a reserved
     Windows device
     name (CON, PRN,
     AUX, NUL, COM1-9,
     LPT1-9).
  5. Not in
     `existingNames`
     (case-insensitive
     collision
     check — Windows
     and default-HFS+
     macOS are
     case-insensitive).
  6. Length <=
     `MAX_NAME_LENGTH`
     (255, the
     cross-platform
     max).
  7. Strips
     trailing dots
     / spaces
     (Windows
     refuses to
     create them).
- `suggestNewFileName(existingNames, extension)` —
  returns
  `untitled.txt`,
  `untitled (1).txt`,
  `untitled (2).txt`,
  ... up to a
  10k cap (after
  which it bails
  out with a
  timestamped
  fallback). The
  extension defaults
  to `.txt` and the
  caller can pass
  any other
  extension.

**Wiring.**
`FileTreePane`'s
`TreeNode` is the
only consumer.
The 4
`window.prompt`
calls and the 2
`window.confirm`
calls are gone.
The state machine
is 3 pieces of
state on
`TreeNode`:
- `menu: { x, y, entry } | null` — the floating menu
- `nameInput: { mode, initialName, existingNames, target } | null` — the inline name modal
- `confirm: { kind, name, target } | null` — the destructive confirm

The 3 states are
mutually exclusive
(only one can be
open at a time, by
conditional
render). The
existing
`runMutation` is
the common path
for surfacing
errors next to the
row.

**Test surface
(new tests, +56).**
- `fileNameValidation.test.ts`
  (24 tests) —
  `validateFileName`
  covers all 7
  rules +
  `suggestNewFileName`
  covers the
  collision counter
  + the 10k bail-out.
- `FileRowContextMenu.test.tsx`
  (20 tests) —
  `computeContextMenuPosition`
  covers 4 edge
  cases, the
  component covers
  rendering,
  destructive
  attribute, Enter
  / Space
  activation,
  ArrowUp / Down
  skipping
  disabled items,
  mousedown on
  item vs.
  outside, Escape
  dismissal, Home
  / End jumping.
- `InlineNameInput.test.tsx`
  (8 tests) —
  `initialNameFor`
  covers new-file
  + rename + the
  skip counter;
  the component
  covers title +
  button label per
  mode, initial
  value
  pre-population,
  submit button
  disabled when
  invalid (empty
  / collision),
  inline error
  hidden until
  touched.
- `ConfirmDestructiveModal.test.tsx`
  (8 tests) —
  title per kind,
  body per kind
  (with the
  HTML-escaped
  `&quot;` quotes),
  the "cannot be
  undone" warning,
  Cancel / Delete
  buttons, the
  optional `detail`
  line, the
  `data-testid`
  hooks.

**Verification.**
- `npx tsc -b` — clean
- `npx vitest run` —
  **791/791 pass**
  (was 735 before
  the #66 polish,
  +4 files / +56
  tests).
- `npm run build` —
  clean
- `cargo check` —
  clean (frontend-only
  phase)

### Added (Phase 9 — Real `typescript-language-server` via stdio pipe)

**Scope: "Phase 9 Tiniest"** —
4-6 hour path. User installs
`typescript-language-server`
globally (`npm i -g
typescript-language-server`),
Lipi spawns it as a child process
and pipes its stdio over Tauri
IPC. The frontend drives the
LSP via Monaco's built-in
`monaco.languages.register*Provider`
APIs — **no
`monaco-languageclient` dependency**
(pulled-in 30+ sub-packages and
would require a major Monaco-
loading refactor).

**New Rust stdio module** (`src-tauri/src/stdio.rs`)

- `lsp_run_stdio({ command, args, cwd? })` —
  spawn the child process,
  return a process-wide
  `handleId` (random hex)
  + the resolved command
  string.
- `lsp_stdio_read(handleId, maxBytes)` —
  drain up to `maxBytes`
  from the child's stdout
  buffer (returns a
  `Vec<u8>` so Tauri's
  `serde_wasm_bindgen`
  maps it cleanly to a
  `Uint8Array` on the JS
  side).
- `lsp_stdio_write(handleId, bytes)` —
  write a JSON-RPC frame
  to the child's stdin.
- `lsp_stdio_close(handleId)` —
  send `shutdown` +
  `exit`, then `kill()`
  the child.
- `lsp_check_available()` —
  probe for
  `typescript-language-server`
  on `PATH` (or in the
  nvm / pnpm shim
  directories) + return
  the install hint
  the user can copy
  + paste.
- 6 unit tests cover
  `random_hex`,
  IPC argument /
  result camelCase
  serde, error
  `kind` tag, and
  the install-hint
  string.

**`LspClient` (TypeScript class) + `useLspClientStore` (Zustand)**

- Per-workspace
  `LspClient` instance.
  `getOrCreate(workspaceRoot)`
  spawns the child (or
  reuses an existing one),
  runs the `initialize`
  JSON-RPC handshake,
  flips the per-workspace
  `LspStatus` to `ready`.
- `dispose(workspaceRoot)`
  sends `shutdown` +
  `exit` and `kill()`s
  the child.
- Polling reader loop
  (1 ms `setTimeout`
  yielding to the event
  loop) drains stdout
  via `lspStdioRead`
  and dispatches
  parsed JSON-RPC
  messages to the
  pending-request
  resolver or the
  message queue.
- Per-call request
  IDs are monotonic
  counters; pending
  requests are
  resolved on
  response, rejected
  on error or
  `dispose`.

**Monaco bridge hook** (`useMonacoLspBridge.tsx`)

- Mounted in
  `EditorPane` next
  to `useInlineEditOverlay`.
  Keyed by
  `(editor, workspaceRoot)`.
- Wires Monaco's
  `onDidChangeModelContent`
  → `textDocument/didChange`
  (full content
  replacement for
  simplicity; the
  LSP supports
  incremental edits
  but Monaco's event
  payload makes
  this easier).
- Wires Monaco's
  `onDidChangeModel`
  → `textDocument/didClose`
  (old URI) +
  `textDocument/didOpen`
  (new model).
- Calls
  `registerLspProviders(client, monaco, [model.getLanguageId()])`
  on mount; disposes
  the returned
  `IDisposable[]` on
  unmount.

**LSP provider adapters** (`lspProviders.ts`)

- Thin (~20 lines
  each) adapters
  for Monaco's
  built-in
  `monaco.languages.register*Provider`
  APIs: definition,
  references, rename,
  implementation,
  documentSymbol,
  codeAction, hover,
  signatureHelp,
  inlayHints. Each
  converts the
  Monaco provider
  interface to an
  LSP
  `textDocument/*`
  method call and
  converts the
  response back
  to Monaco types.
- Completion stays
  on Monaco's
  Phase 7 built-in
  service (the real
  server's 50-200ms
  round-trip is
  too slow for
  inline autocomplete).
- Inlay hints are
  guarded by
  `client.initializeResult.capabilities.inlayHintProvider`
  so we only register
  the provider if
  the server supports
  it.

**Kill switch** (`lspKillSwitch.ts`)

- `localStorage` key
  `lipi:lsp:useRealServer:v1`
  — the bridge hook
  reads it on mount
  and bails out
  when disabled.
  The settings card
  toggles it. Flipping
  it off disposes
  the live client
  so the child
  process is gone.
- localStorage (not
  Zustand / not
  `toolSettingsStore`
  v3) — a one-liner
  read/write with no
  schema migration.

**`LanguageServerCard` (Settings screen)**

- New card under
  Editor → Language
  Servers. Status
  badge (Stopped /
  Starting / Ready /
  Error) sourced
  from the LspClient
  store. Install hint
  when
  `lspCheckAvailable`
  reports
  `available: false`.
  Version line when
  available. Kill
  switch toggle.
  "Restart server"
  button (visible
  when a server is
  alive or starting).

**Tests**

- 4
  `lspClientStore`
  tests cover:
  `getOrCreate`
  spawns + flips
  to `ready`,
  same-workspace
  returns same
  client,
  `dispose`
  removes the
  client + flips
  status to
  `stopped`, spawn
  failure flips
  to `error`.
- 3
  `useMonacoLspBridge`
  tests cover: no-op
  when kill switch
  is off, creates
  client + registers
  providers when on,
  sends `didClose`
  + `didOpen` on
  model change.
- 3
  `LanguageServerCard`
  tests cover: Ready
  badge, install hint
  when CLI is
  missing, kill switch
  toggle persists to
  `localStorage`
  and disposes the
  live client.

**Verification.**
- `npx tsc --noEmit` —
  clean.
- `npx vitest run` —
  **1032/1032 pass**
  (was 1022 before
  Phase 9, +3 files
  / +10 tests).
- `cargo test --lib stdio` —
  **6/6 pass** (the
  new `stdio::tests`
  module).
- `npm run build` —
  clean (the bundle
  delta is the
  +~400 lines of
  Phase 9 source).

**Known limitations (Tiniest scope)**

- No incremental
  `didChange` —
  we re-send the
  full text on
  every edit.
  Negligible perf
  impact for files
  <10k lines, but
  a follow-up slice
  could compute
  the diff.
- No multi-server
  support (no
  `rust-analyzer`,
  no per-language
  server resolution
  beyond the hard-
  coded
  `typescript-language-server`
  command). The
  `LspClient` class
  + stdio IPC are
  server-agnostic;
  the only fixed
  part is the
  default command
  in
  `lspCheckAvailable`
  + the install
  hint.
- No LSP crash
  recovery — if
  the child process
  dies, the bridge
  logs the error
  and falls back
  to Monaco's
  Phase 7 built-in
  TS service. A
  "Restart server"
  button is the
  manual recovery
  path (the user
  doesn't have to
  restart Lipi).
- Completion
  intentionally
  stays on Monaco's
  built-in (see the
  rationale in
  `lspProviders.ts`'s
  header comment).

## [0.0.2] — 2026-06-09

### Added (Phase 5e — persistent per-decision activity log)

- **Per-decision activity log** (new
  `toolDecisionLogStore`, Zustand, separate from
  `toolSettingsStore` and `aiStore`): records every
  `[Deny] / [Run once] / [Always allow]` click the user
  makes on a custom-tool confirmation modal. Capacity
  **500 entries** (locked per user call — bumping the
  cap is a one-line constant change). Ring-buffer
  semantics: when the post-append size exceeds 500, the
  OLDEST entry is dropped.
- **Record shape**: `{ id, timestamp, toolName,
  decision, argsPreview, requestId,
  assistantMessageId }`. `argsPreview` is truncated
  to **2KB** (UTF-8 byte count, not character count) at
  write time — typical tool args are 100-200B, the 2KB
  cap is 10x headroom and bounds worst-case storage to
  ~1MB. `id` is `crypto.randomUUID()` (with a
  `Date.now() + random` fallback for older webviews /
  tests).
- **Recording point**: the AI store's
  `resolveConfirmation(decision)` action records a
  `DecisionRecord` BEFORE delegating to
  `applyConfirmationAndResume` — the log is
  observational and should land even if the resume
  helper throws. Stale decisions (the resolver bailed
  because the `requestId` was stale) are NOT recorded.
- **Localstorage key**: `lipi:toolDecisionLog:v1`
  (separate from `lipi:toolSettings:v2` — different
  concern, no version coupling). The hydration
  transparently drops malformed records (a single
  corrupt row from a past bug doesn't wipe the entire
  history).
- **Settings UI**: new "Activity Log" section below
  "Custom Tools", with a count badge ("N decisions" or
  "N decisions (cap reached)"), a [Clear log] button
  (irreversible in 5e, confirmed via `window.confirm`),
  and rows that show:
  - A color-coded decision badge (`deny` red,
    `allow_once` green, `allow_always` blue).
  - The tool name in monospace.
  - A relative timestamp ("just now", "5m ago",
    "yesterday", "2026-06-09") — no `Intl.DateTimeFormat`
    for portability.
  - An expandable `<details>` block with the truncated
    args preview.
  - The `assistantMessageId` as muted text (for the
    future "Jump to chat" feature).
  - Empty state when the log is empty: "No decisions
    recorded yet. They'll appear here as you use the
    chat."
- **Pagination**: at most **50 rows in the DOM** at a
  time. The store holds 500; older rows are off-screen
  but accessible via the [Show older] button which
  expands the limit by another 50. Keeps the React
  tree small for a setting the user rarely scrolls.
- **No "Jump to chat"** (deferred to 5f+ — needs
  AIPanel cross-store navigation).
- **No per-row "Revert allow_always" button** (deferred
  to 5f+).
- **No undo toast on Clear log** (deferred — 5e keeps
  the destructive action irreversible and the UI
  minimal).
- **Test coverage**: 18 new tests for
  `toolDecisionLogStore` (record/append, capacity
  enforcement at 500 + boundary, clear, getRecentForTool
  filter, getRecent limit, persistence round-trip,
  malformed-record filtering, corrupt v1 → defaults,
  hydrate-guard, 4 `truncateArgsPreview` tests
  including a UTF-8 byte-bound test) + 4 new tests for
  `aiStore` (deny records a deny entry, allow_once
  records, allow_always records AND promotes the
  policy, stale decision does NOT record).

### Verified

- `npm run typecheck` — clean.
- `npx vitest run` — 160/160 passing (was 138; +18 in
  `toolDecisionLogStore.test.ts` + +4 in
  `aiStore.test.ts`).
- `npm run build` — clean.
- `cargo check` (Rust side untouched in 5e, smoke check
  only) — clean.

### Added (Phase 5d — per-tool invocation allowlist)

- **Per-tool confirmation policy** (3 modes):
  `always_allow` (default — preserves 5c behaviour), `per_call`
  (ask once per assistant turn, then auto-approve subsequent
  calls of the same tool in the same turn), `always_confirm`
  (ask before every invocation, regardless of round state).
  Configured per-tool on the Settings → AI Tools cards; the
  segmented control appears next to the existing on/off switch.
- **Confirmation prompt modal** (`ConfirmToolCallModal`,
  mounted at the `EditorWorkspace` root): three buttons
  `[Deny]` (red), `[Run once]` (primary, auto-focused), and
  `[Always allow]`. The modal pretty-prints the call's
  arguments as JSON, shows the tool description, and renders
  a kind badge (`shell` / `http` / `builtin`). `Esc` key
  triggers Deny. Auto-focus the primary action on open so
  `Enter` approves.
- **Tool-loop pause/resume**: when a tool call needs
  confirmation, the `runToolExecutionRound` function parks
  the round BEFORE entering the parallel executor. The
  `RequestStatus` becomes `'awaitingConfirmation'`, and a
  new `pendingConfirmation` field on the AI store records
  the call id, name, description, args JSON, assistant
  message id, the original chat-stream requestId (used to
  detect stale decisions), and the round number. The user
  clicks a button → `resolveConfirmation(decision)` →
  `applyConfirmationAndResume` helper → either starts the
  follow-up stream (last call in the round) or re-enters
  `runToolExecutionRound` for the remaining calls (which
  may park again on the next `shouldConfirm: true` call).
- **Localstorage bump `lipi:toolSettings:v1` → `v2`**: the
  v2 payload carries both `disabledToolNames` (the existing
  set) and a new `confirmationMode` map (`Record<toolName,
  ConfirmationMode>`). The hydrate path transparently
  migrates a v1 file forward — copies the disabled names,
  adds an empty `confirmationMode: {}`, and LEAVES the v1
  key in place (a v1 reader can still load the old state).
  Tools not in the map use the default `always_allow`, so
  a v1 → v2 migration is a no-op for the user-visible
  behaviour.
- **New `RequestStatus` variant**: `'awaitingConfirmation'`.
  `clearMessages` now refuses during this state (the
  pending decision would be orphaned); the in-flight
  decision is preserved.
- **`toolRegistry.shouldConfirm(name, confirmedForRound)`
  predicate** + `toolSettingsSelectors.shouldConfirm`:
  pure function the AI store consults. Returns `false` for
  disabled tools, `true` for `always_confirm`, and for
  `per_call` returns the inverse of the round flag (a
  caller-side set marks a tool as "user already approved
  once this round").
- **`toolSettingsStore.setConfirmationMode(name, mode)`**:
  sets the policy. When set back to the default
  (`always_allow`), the entry is REMOVED from the map to
  keep the persisted JSON small. `applyConfirmationAndResume`
  calls this with `'always_allow'` when the user picks
  `[Always allow]` in the modal.
- **Test coverage**: 15 new tests for `toolSettingsStore`
  (5d predicate behaviour, v1→v2 migration, default-mode
  drops from the map, persistence round-trip) + 6 new
  tests for `aiStore` (park on `always_confirm`, deny
  records error and resumes, allow_once executes but
  leaves the policy unchanged, allow_always executes and
  promotes the policy, default `always_allow` does NOT
  park, `clearMessages` refuses during
  `'awaitingConfirmation'`, stale-requestId resolver
  bails).

### Key decisions

- **`per_call` semantics = "ask once per assistant turn"**:
  the user picks `per_call` for a tool the model might
  call repeatedly in a single response (e.g.
  `get_file_contents` called for 5 files). The modal
  surfaces once; subsequent calls of the same tool in
  the same round execute silently. The next `send()`
  re-prompts.
- **No click-outside-to-dismiss**: an accidental click
  while typing a long prompt could let the model run a
  shell command. Modal stays open until the user picks a
  button (or hits `Esc` for deny).
- **Stale-confirmation race protection**: the
  `pendingConfirmation` record carries the chat-stream
  `requestId` (captured at parking time in a module-level
  `lastStreamRequestId` set by `send()` / `sendEdit()`).
  The resolver drops the decision if the requestId has
  rolled over (a new send happened while the user was
  deciding). `activeRequestId` is NOT sufficient because
  it goes to `null` once `ai://done` arrives.
- **`v1` key left intact on migration**: a v1 reader
  (e.g. a downgrade) can still load the old state. The
  next state-changing action writes the v2 payload;
  `v1` is left alone forever.

### Verified

- `npm run typecheck` — clean.
- `npx vitest run` — 138/138 passing (32 in
  `toolSettingsStore.test.ts`, 41 in `aiStore.test.ts`).
- `npm run build` — clean (no TS / Vite errors).
- `cargo check` (Rust side untouched in 5d, smoke check
  only) — clean.

### Added (Phase 1b — Tauri shell on Windows)

- Installed Rust 1.96.0 (stable, MSVC ABI, minimal profile) via `rustup-init.exe`.
- Installed Visual Studio Build Tools v14.44.35207 (C++ workload) and
  Windows SDK 10.0.22621.0 at `C:\BuildTools\`.
- Installed Tauri CLI 2.11.2 via `cargo install tauri-cli --version "^2.0" --locked`.
- Wrote `src-tauri/` scaffold by hand (no `cargo tauri init`):
  - `Cargo.toml` (Tauri 2 + tauri-plugin-updater, release profile optimised for size)
  - `tauri.conf.json` (bundle ID `app.lipi.ide`, dev URL `http://localhost:1420`, 5 LLM hosts in CSP, 5 platforms targeted)
  - `build.rs` (Tauri build script)
  - `src/main.rs` (Windows entry)
  - `src/lib.rs` (`get_app_version` IPC command, updater plugin, title-set in `setup`)
  - `capabilities/default.json` (main window ACL)
  - `icons/` (32 icons generated via `cargo tauri icon` from a placeholder 1024×1024 "L" PNG)
- Verified: `cargo tauri dev` opens a native Tauri window showing the existing
  React EditorWorkspace shell, with the IPC bridge live (Tauri ↔ Vite ESTABLISHED on :1420).
- Updated `package.json` with `dev:tauri`, `build:tauri`, `preview:tauri`, `tauri` scripts.
- Updated HANDOFF.md (Section 3, 5, 6 + decisions #22–25) and README.md.
- Adopted 7 engineering rules in HANDOFF.md Section 10 (long-form in `docs/ENGINEERING.md`).

### Added (Phase 2a — virtual filesystem + IPC bridge)

- Rust module `src-tauri/src/fs.rs` with `FsEntry`, `FileContent`, `FsError` (tagged enum).
- `read_dir` (sorts dirs first, files second, both alphabetical), `read_file`
  (5 MB cap, NUL-byte → binary detection, UTF-8 returns), `write_file` (atomic,
  creates missing parent dirs).
- 4 Tauri commands: `fs_read_dir`, `fs_read_file`, `fs_write_file`,
  `fs_pick_folder` (uses `tauri-plugin-dialog`).
- TS wrapper `src/ipc/fs.ts` with `FsError` class and typed re-exports.
- 7 Rust unit tests, all pass.

### Added (Phase 2b — file tree UI)

- `src/screens/EditorWorkspace/state/fileTreeStore.ts` (Zustand):
  discriminated `FileTreeStatus` union (`idle` / `opening` / `loading` /
  `ready` / `error`), `rootPath`, `entriesByDir` cache, `expanded` set,
  `selectedPath`.
- `src/screens/EditorWorkspace/hooks/useFileTree.ts` — side effects
  (open folder, read dir, toggle, select).
- `FileTreePane` rewritten to use `PaneShell` + recursive `TreeNode` with
  keyboard navigation, aria attributes, and first-class empty / loading /
  error / non-folder states.
- `TitleBar` extended to read `rootPath` and show it as a breadcrumb.
- `PaneShell` got a new `headerAction` slot (used by the "Open folder" button).

### Added (Phase 2c — Monaco + tabs + dirty state + save)

- `src/shared/hooks/useKeyboardShortcut.ts` — generic, platform-aware
  (Cmd on macOS, Ctrl elsewhere), skips text inputs (with a Monaco exception
  for `Ctrl+S`).
- `src/shared/components/KeyHint/` — small `<kbd>`-style component that
  renders `⌘S` on macOS and `Ctrl+S` elsewhere.
- `editorTabsStore.ts` — Zustand store with `order`, `tabs`, `activeId`,
  `TabLoadStatus` discriminated union, `inferLanguage`, `inferDisplayName`.
- `useEditorTabs.ts` — `openFile` (uses `readFile`), `saveActive` (uses
  `writeFile`), `closeTab`, `setContent`.
- `TabStrip` — `EditorTab` items with name, dirty dot, close button, active state.
- `EditorPane` rewritten to host Monaco + `TabStrip`, wired to the store
  and `useKeyboardShortcut('mod+s', saveActive)`. Loads / saves via the
  Rust `fs` commands. Renders loading / error / binary / empty states.
- `StatusBar` got a `dirty` prop and a `● unsaved` indicator.
- `EditorWorkspace` orchestrator: `fileTreeStore.selectedPath` → `openFile`.
  (Rule 6: cross-section wiring is explicit at the screen level.)

### Added (Phase 3a — read-only git pipe)

- Rust module `src-tauri/src/git.rs` over `gix = "=0.78.0"` (pinned — see
  HANDOFF Decision #26 for the gix 0.79+ compile bug rationale).
  - `RepoHandle` (opaque handle = the repo's working tree path),
    `RepoStatus` snapshot, `ChangedFile` with `staged` / `unstaged` bits,
    `ChangeKind` discriminated union (Added / Modified / Deleted /
    Renamed / Copied / Untracked / TypeChange / Conflict), `GitError`
    tagged enum (NotARepository / Git).
  - `open_repo` re-opens cheaply on each call (gix is fast for read-only
    status); capped at 1000 changed files to bound memory.
  - Ahead/behind reported as `(0, 0)` for now (real `gix-revwalk` count
    is Phase 3b stretch).
  - 7 unit tests: open on a real repo, open fails on a non-repo, current
    branch = `main` after init, status on a clean repo is clean, modified
    file surfaces as unstaged, untracked file surfaces as Untracked,
    staged add surfaces as Added+staged.
- 3 Tauri commands: `git_open`, `git_status`, `git_current_branch`.
- TS wrapper `src/ipc/git.ts` with `gitOpen` / `gitStatus` /
  `gitCurrentBranch`, `GitError` class, `changeKindLabel` and
  `changeKindBadge` helpers.
- Verified: `cargo test --lib` → **14/14 pass** (7 fs + 7 git);
  `npm run typecheck` → 0 errors; `cargo tauri dev` → Tauri window
  opens, screenshot captured.
- 3a adds no UI surface by design (that's 3b's job).

### Known limitations

- No diff or discard yet — those land in 3c.
- No real ahead/behind count (returned as 0/0).
- No git UI in the side panel — that's 3b.
- `gix` is pinned to 0.78 (see Decision #26). When upstream fixes the
  non-exhaustive-match bug in gix-hash 0.23+, we can drop the pin and
  bump.

### Added (Phase 3b — GitPanel side panel UI)

- `src/screens/EditorWorkspace/state/gitStore.ts` (Zustand):
  `GitPanelStatus` discriminated union (`idle` / `opening` /
  `not-a-repo` / `loading` / `ready { status }` / `error { message }`),
  `rootPath`, `isRefreshing`, and 6 selectors (`status`, `rootPath`,
  `isRefreshing`, `changedFiles`, `branch`, `ahead`, `behind`, `isClean`).
- `src/screens/EditorWorkspace/hooks/useGitStatus.ts` — `openRoot`
  (probe with `gitOpen`, then `gitStatus`), `refresh` (re-fetch
  current root), `close`. Maps the `GitError(NotARepository)` case
  to the `not-a-repo` state; other errors land in `error`.
- `src/screens/EditorWorkspace/components/GitPanel/`:
  - `GitPanel.tsx` — PaneShell with `Source Control · Git` header
    and a refresh `IconButton`. Renders a `Body` switch over the
    6 statuses. In `ready` state, shows a `BranchHeader` (⎇ icon,
    branch name, ↑N / ↓N pills), a `SummaryBar` (e.g. "3 changes ·
    1 staged · 2 unstaged" + Refresh button), and a `ChangedFilesList`
    with one row per file: `changeKindBadge` (A / M / D / R / C / U /
    T / !) color-coded by `ChangeKind`, plus a left border in success
    or warning color based on `staged` / `unstaged` bits.
  - `GitPanel.module.css` — token-based styles (every value is
    `var(--space-*)`, `var(--color-*)`, `var(--font-*)`).
  - `index.ts` — barrel.
- `src/screens/EditorWorkspace/components/SidePanelPane/SidePanelPane.tsx`
  rewritten to mount `<GitPanel />` (replaces the empty placeholder).
- `src/screens/EditorWorkspace/EditorWorkspace.tsx` got the
  cross-store orchestrator: when `fileTreeStore.rootPath` changes,
  call `useGitStatus().openRoot(rootPath)`; when the file tree is
  closed, call `useGitStatus().close()`. Rule 6 satisfied: the
  `gitStore` and `fileTreeStore` never know about each other.
- `src/shared/styles/tokens.css` — added `--color-success-soft`,
  `--color-warning-soft`, `--color-danger-soft`,
  `--color-danger-strong-soft` for the badge backgrounds (so the
  component CSS contains no raw `rgba`).
- `src-tauri/src/lib.rs` re-exports `open_repo`, `status`, and the
  public types (`ChangeKind`, `ChangedFile`, `RepoHandle`, `RepoStatus`)
  so the integration test binary can hit them.
- `src-tauri/tests/git_status_smoke.rs` — 3 integration tests:
  - `open_and_status_round_trip_on_a_real_temp_repo` — spins up a
    fresh temp git repo, opens it, fetches status, asserts
    `branch == "main"`, `is_clean == true`, `is_detached == false`.
  - `status_kind_discriminator_is_exhaustively_named` — compile-time
    tripwire: a new `ChangeKind` variant without a `name` mapping
    breaks the build.
  - `changed_file_serialises_with_camel_case_field_names` — snapshots
    the JSON wire shape (camelCase fields, kebab-case `kind` enum)
    to catch any future serde-rename regression.
- Titlebar dev subtitle bumped from `dev · phase 2c` → `dev · phase 3b`.

### Verified (Phase 3b)

- `npm run typecheck` — 0 errors
- `cargo test --lib` — 14/14 pass (7 fs + 7 git)
- `cargo test --test git_status_smoke` — 3/3 pass
- `npm run build` (Vite) — 106 modules, 0 errors; CSS bundle
  20.83 kB (+6 kB from 3a, the GitPanel styles)
- `cargo tauri dev` — Tauri window opens, side panel renders the
  "No folder opened" empty state with a refresh ⟳ in the header
  (screenshot in `verify/screenshot_3b.png`)

### Known limitations

- No diff or discard yet — those land in 3c.
- No real ahead/behind count (returned as 0/0; real revwalk via
  `gix-revwalk` + `gix-commitgraph` is a 3c stretch).
- Clicking a file in the changed-files list is a no-op (3c wires
  this to the diff view).
- `gix` is pinned to 0.78 (see Decision #26).

### Added (Phase 3c-1 — diff + discard + real ahead-behind pipe)

No UI changes in 3c-1 by design — this sub-phase is the green pipe
that Phase 3c-2 will plug a `DiffView` component into. The pipe is
reachable from the JS side and is locked by 7 new unit tests + 3 new
integration tests.

- **Rust (`src-tauri/src/git.rs`):**
  - `FileDiff` struct: `(path, old, new, isBinary, isNew, isDeleted)`.
    `old == None` for untracked / staged-add, `new == None` for
    deleted. Both `None` for binary files (NUL-in-first-8-KB heuristic)
    so the JS side renders a placeholder.
  - `diff(handle, path)`: reads HEAD's blob via
    `gix::Repository::head_tree_id` + `Tree::lookup_entry_by_path` +
    `Object::try_into_blob`; reads the worktree version off disk;
    binary-detects both sides. Path is forward-slash-normalised for
    the tree lookup (Windows-safe).
  - `discard(handle, path)`: writes HEAD's blob back to the worktree
    for tracked files, or removes the file from disk for untracked /
    staged-add files. Idempotent: a click-discard-twice is a no-op.
  - **Real `ahead_behind`** via `gix::Repository::rev_walk([upstream])
    .with_hidden([local]).all()` (and the mirror for ahead). Both
    counts use `Walk::filter_map(Result::ok).count()` — gix 0.78's
    `Walk` yields `Result<Info, _>`, so a naive `.count()` would
    inflate counts on mid-walk errors. `upstream_id` resolves
    `branch@{u}` via `rev_parse_single`, with a graceful `(0, 0)`
    fallback when no upstream is configured.
  - 7 new unit tests covering: modified file diff (old + new),
    untracked diff (None + new), deleted diff (old + None), binary
    diff (both None), modified discard (restored), untracked discard
    (removed), and ahead-behind against a synthetic tracking branch
    built via `git update-ref refs/remotes/origin/main HEAD~1` +
    `branch.main.{remote,merge}` + `remote.origin.{url,fetch}`.
- **Tauri commands (`src-tauri/src/lib.rs`):** `git_diff(repo_id, path)`
  and `git_discard(repo_id, path)` registered in `invoke_handler!`.
  `lib.rs` re-exports `diff`, `discard`, `FileDiff` so the integration
  test binary can hit them.
- **TS IPC (`src/ipc/git.ts`):** `FileDiff` interface mirrors the
  Rust struct (camelCase, `null` for absent fields). `gitDiff(repoId,
  path)` and `gitDiscard(repoId, path)` typed wrappers. The wire
  shape is locked so Phase 3c-2's `DiffView` builds against a stable
  contract.
- **Integration tests (`src-tauri/tests/git_status_smoke.rs`):**
  3 new tests: `file_diff_serialises_with_camel_case_field_names`
  (locks the JSON wire shape), `discard_writes_head_blob_back_to_worktree`
  (full open → modify → discard → re-status roundtrip with status
  landing back on `is_clean == true`), `discard_is_idempotent_on_already_clean_files`
  (click-discard-twice case).

### Verified (Phase 3c-1)

- `npm run typecheck` — 0 errors
- `cargo test --lib` — **22/22 pass** (7 fs + 15 git, +7 from 3b)
- `cargo test --test git_status_smoke` — **6/6 pass** (+3 from 3b)
- `cargo build` — clean, no warnings introduced
- `npm run build` (Vite) — 106 modules, 0 errors
- `cargo tauri dev` — Tauri window opens, GitPanel renders the
  same 3b empty state (3c-1 is a no-op UI change by design; the
  new IPC commands are reachable but no component calls them yet)

### Added (Phase 3c-2 — Source Control UI: diff view + click-to-diff + per-file discard)

- `inferLanguage` extracted to `src/shared/utils/inferLanguage.ts`
  (was a private export of `editorTabsStore`). `editorTabsStore`
  re-exports it so all existing callers (and the new `DiffView`)
  share one source of truth. Rule 3 + Rule 4 cleanup.
- `gitStore` extended with `activeDiffPath: string | null` +
  `setActiveDiffPath(path)` action and the matching selector
  (Rule 5 — single source of truth, no `isShowingDiff: boolean`).
- New hook `useDiff(activePath)` in
  `screens/EditorWorkspace/hooks/useDiff.ts`. Owns the
  `gitDiff(repoRoot, path)` call; returns a discriminated
  `idle | loading | ready | error` status. In-flight loads are
  abandoned (via an `activePathRef` flag) if the user navigates
  away. Exposes `refresh()` and `discard()` so callers never
  import IPC types directly (Rule 6).
- New `DiffView` component (`<DiffView>/<DiffView>.tsx +
  .module.css + index.ts`). Renders Monaco's `DiffEditor`
  read-only, side-by-side, with `original = diff.old` and
  `modified = diff.new`. Placeholder UI for `isBinary` (no
  garbled Monaco), `isNew` (shows the new content only, with
  a hint), and `isDeleted` (shows the old content only, with a
  hint). Same Monaco `loader.config({ paths: { vs: ... } })`
  as `EditorPane` so the diff editor finds its bundled peers.
- `GitPanel`'s `ChangedFileRow` is now a real `<button>` (the
  main row area) that calls `setActiveDiffPath(file.path)`.
  Each row also gets a per-file `IconButton` (↺, `IconButton`
  variant="subtle" size="sm") that calls `gitDiscard` +
  `useGitStatus.refresh()`. The discard button is rendered
  only when `file.unstaged === true` (3c-1 only ships unstaged
  discard). `e.stopPropagation()` keeps the discard from also
  triggering the row click.
- `SidePanelPane` is a one-line ternary now:
  `activeDiffPath ? <DiffView /> : <GitPanel />`.
- `useGitStatus.close()` now also clears `activeDiffPath` so
  closing the file tree (e.g. via `EditorWorkspace`
  orchestrator) also dismisses any open diff view.
- `DiffView` header shows the file's basename + a "Discard"
  button (only when `activeChangedFile?.unstaged`) + a back
  chevron that calls `setActiveDiffPath(null)`. Reuses
  `Button` + `IconButton` + `PaneShell` (Rule 4).
- Titlebar subtitle: `dev · phase 3c-2`.
- All new + updated CSS uses only design tokens
  (`--space-*`, `--color-*`, `--radius-*`, `--font-*`); no
  raw hex, no magic numbers.

### Verified (Phase 3c-2)

- `npm run typecheck` — 0 errors
- `npm run build` — 111 modules transformed, no errors
  (the prior dynamic-import warning is gone since `gitDiscard`
  is now a static import in `GitPanel`)
- `cargo test --lib` — 22/22 passing (no Rust changes; pipe
  surface is the 3c-1 surface)
- `cargo test --test git_status_smoke` — 6/6 passing
- `cargo tauri dev` — Tauri window opens cleanly,
  titlebar shows `dev · phase 3c-2`, no console errors on
  first paint. (Full E2E click-to-diff + discard flow was
  not driven headlessly in the smoke; the underlying IPC
  pipe is locked by the 3c-1 integration tests.)

### Known limitations

- Phase 3c-2 only ships unstaged discard (the 3c-1 pipe
  intentionally only implements unstaged; staged discard
  lands in a later phase if you decide you want it).
- The Monaco `DiffEditor` is rendered read-only with no
  "revert hunks" / "stage hunk" affordances — that
  granularity lives in a future diff refinement phase.
- `gix` is still pinned to 0.78 (see Decision #26).
- 4b only supports one terminal session at a time. Multi-tab
  terminals (the typical IDE experience — open several
  terminals, switch between them, close one) ship in 4c.
- The headless UI smoke (click the Terminal tab → see
  xterm.js mount → type a command → see output) is
  **not** automatable in 4b's environment: Tauri webviews
  on Windows don't reliably receive `mouse_event` clicks
  from a different process, so the PowerShell UI-automation
  click that works for native Win32 controls doesn't reach
  the WebView2 content area. The pipe + wire shape are
  covered by 4a's 12 tests + 4b's 2 new tests; a human
  click in the dev window is the canonical 4b verification.

### Added (Phase 4b — embedded terminal UI)

- `@xterm/xterm` 5.5.0 + `@xterm/addon-fit` 0.10.0 mounted in
  a new `TerminalPanel` component. xterm.js's CSS imported
  once in `src/main.tsx` (Rule 3 — single source of truth for
  global styles).
- `src/screens/EditorWorkspace/components/TerminalPanel/`
  (new — 3 files, ~290 lines total):
  - `TerminalPanel.tsx` — the React tree for the side-panel
    terminal view. First-class states: idle (with `+ New
    terminal` button), opening (placeholder), error (with
    Retry button), exited (with `+ New terminal` button +
    the exit code), running (xterm.js mount with `×` close
    button in the header). The `RunningTerminal` sub-
    component owns the imperative xterm.js lifecycle
    (create / fit / observe resize / subscribe to data /
    dispose) and is keyed by `sessionId` so opening a
    second session remounts cleanly.
  - `TerminalPanel.module.css` — xterm.js wrapper with
    `data-ready` fade-in (avoids 0×0 flash on mount),
    placeholder styling for the first-class states, all
    tokens (no raw hex). xterm's dark theme matches the
    editor surface (#1e1e1e background).
  - `index.ts` — barrel.
- `src/screens/EditorWorkspace/hooks/useTerminal.ts`
  refactored: dropped `output: Uint8Array` (4a's
  accumulate-for-testing shape), added
  `setOutputSink(sink | null)`. The hook still owns the
  `onTerminalOutput` subscription (Rule 6) and demuxes by
  `sessionIdRef`; instead of accumulating bytes, it calls
  the sink callback. The TerminalPanel sets the sink to
  `(data) => term.write(data)` on mount and clears it on
  unmount. The status discriminator is unchanged.
- `src/screens/EditorWorkspace/components/SidePanelPane/`
  refactored to a tabbed view:
  - 32px tab bar at the top with "Source Control" and
    "Terminal" tabs. Active tab gets an accent-colored
    underline. Hover state, focus-visible outline, ARIA
    `role="tablist"` + `role="tab"` + `aria-selected`.
  - `DiffView` still takes priority over the tab bar:
    when the user is looking at a file diff, the tabs
    are hidden (the user is in a focused task; the
    DiffView's back chevron returns to the previous tab).
  - Active tab is local component state
    (`useState<Tab>('git')`); 4c will lift it to a store
    if multi-tab terminals need it.
  - `SidePanelPane.module.css` (new) — the tab bar
    styling + a `.panel > section` reset that overrides
    PaneShell's inline `gridArea: 'side'` (which is a
    no-op inside a flex parent anyway, but explicit is
    better).
- 2 new wire-shape tests in
  `src-tauri/tests/terminal_tauri_smoke.rs` (new file):
  - `open_result_wire_shape_is_camel_case` — opens a
    real PTY against a no-op sink, serialises the
    `OpenResult` to JSON, asserts `sessionId` (camelCase)
    is present and `session_id` (snake_case) is absent.
    This locks the JS↔Rust contract that the TS side
    (`src/ipc/terminal.ts -> OpenResult`) depends on; a
    regression here would break the React tree at
    runtime and TS wouldn't catch it.
  - `terminal_open_command_takes_an_args_wrapper` —
    locks the JS-sent `{ args: { rows, cols, shell } }`
    shape and verifies the empty-args case.

### Verified (Phase 4b)

- `npm run typecheck` — 0 errors
- `npm run build` — 123 modules transformed (was 113 in
  4a; +10 from `@xterm/xterm` + `@xterm/addon-fit`).
  Bundle: 490 KB JS / 28 KB CSS, gzipped 136 KB / 6.4 KB.
- `cargo test --lib` — 28/28 still passing (no Rust changes)
- `cargo test --test terminal_smoke` — 6/6 still passing
- `cargo test --test terminal_tauri_smoke` — 2/2 passing
  (new in 4b)
- `cargo test --test git_status_smoke` — 6/6 still passing
  (no regression in 3a/3b/3c-1/3c-2)
- `cargo tauri dev` smoke: Tauri window opens with the
  new tab bar (Source Control active by default, Terminal
  tab visible), titlebar reads `dev · phase 4b`, no
  console errors on first paint.

### Added (Phase 4c — multi-tab terminals + cross-platform shell polish)

- `src/screens/EditorWorkspace/state/terminalStore.ts` (new, ~210 lines) — Zustand
  store keyed by session id, the home of multi-session terminal state:
  - `sessions: Map<sessionId, TerminalEntry>` where `TerminalEntry = { id, status, index }`
    (`index` is a 1-based monotonic human label — `1`, `2`, `3` — for the tab strip).
  - `sessionOrder: sessionId[]` — insertion order, drives the tab strip
    order. The store re-creates the Map on every mutation so React consumers
    see a new reference (Zustand uses `Object.is` to detect changes).
  - `activeSessionId: string | null` — the session whose xterm.js mount is
    visible. A new session always becomes active (VS Code behaviour).
    Removing the active session falls back to the previous tab in the strip,
    then the new last, then `null`.
  - Sinks (output callbacks) live in a module-level
    `Map<sessionId, OutputSink>`, NOT in the store. Sinks are functions and
    change on every xterm.js mount; putting them in the store would cause
    spurious re-renders and is not serialisable.
  - Actions: `addSession`, `removeSession`, `setStatus`, `setActive`, `reset`.
  - Selectors: `sessions` (returns `TerminalEntry[]` in tab-strip order),
    `activeSessionId`, `activeEntry`, `hasSessions`, `entry(id)`.
  - **One-time global `onTerminalOutput` and `onTerminalExit` subscription**
    started by `ensureTerminalEventSubscription()` (idempotent). The store is
    the only place that demuxes IPC events to the right sink / store entry.
- `src/screens/EditorWorkspace/hooks/useTerminal.ts` refactored to consume the
  store. No more local state. New public API:
  - Read: `sessions`, `activeSessionId`, `activeStatus`, `hasSessions`.
  - Write: `start(opts?)` (returns the new session id, or `null` on IPC
    failure; on failure an `error-…` entry is added so the UI can show a
    failed tab), `close(sessionId)` (optimistic remove, then `terminalClose`),
    `setActive(sessionId)`, `setSink(sessionId, sink | null)`,
    `write(sessionId, data)`, `resize(sessionId, rows, cols)` (no store
    update — the React tree doesn't render the size, and updating would
    cause unnecessary re-renders), `getDefaultShell`.
  - The hook is still the **only** place in the React tree that imports
    from `@/ipc/terminal` (Rule 6 — single owner of the IPC layer). The
    store talks to `@/ipc/terminal` only inside the demuxer.
- `src/screens/EditorWorkspace/components/TerminalTabs/` (new — 3 files,
  ~140 lines total):
  - `TerminalTabs.tsx` — per-session tab strip rendered above the body.
    Each tab: shows the human index (`1`, `2`, `3`, …), has a `×` close
    button (stops propagation so it doesn't also activate the tab),
    has a `data-active` attribute for the accent underline, has a
    `data-status` attribute (`running` / `exited` / `error` /
    `opening` / `idle`) that drives the dimmed/opacity styling. Tooltip
    on each tab shows the active shell when running, the exit code when
    exited, the error message when errored. The whole strip is
    keyboard-navigable (`tabIndex={0}`, Enter/Space to activate).
  - `TerminalTabs.module.css` — tab strip styling. All tokens, no raw
    hex. The accent underline uses `--color-accent` (which falls back
    to `#0dbc79` if the token isn't defined). The `×` close button is
    hidden by default and revealed on hover or when the tab is active,
    matching VS Code's tab UX.
  - `index.ts` — barrel.
  - A `+` `IconButton` at the right end of the strip spawns a new
    session via `start()`.
- `src/screens/EditorWorkspace/components/TerminalPanel/TerminalPanel.tsx`
  refactored: renders `<TerminalTabs />` above the body when
  `hasSessions` is true. The body branches on `activeStatus`
  (idle / opening / error / exited / running). For the `running` state,
  the `RunningTerminal` sub-component is keyed by `sessionId` —
  switching tabs unmounts the old xterm.js and mounts a fresh one for
  the new session. Each xterm mount registers its `term.write` callback
  as the store sink for its session via `setSink(sessionId, sink)` and
  clears the sink on unmount. The `PaneShell` header hint shows the
  active session's shell when running (`cmd.exe`, `/bin/zsh`, etc.).
- Cross-platform shell polish: per-session shell is shown in the tab
  tooltip; the active session's shell is shown in the `PaneShell`
  header hint. The `pwsh.exe` setting on Windows is not yet exposed in
  a Settings screen — `default_shell()` already returns `cmd.exe`, and
  callers can pass `OpenOptions.shell = 'pwsh.exe'` to override.
  Surfacing this in a Settings UI is a Phase 5 task.
- 3 new tests in `src-tauri/tests/terminal_smoke.rs` (multi-session pipe):
  - `two_sessions_have_distinct_ids` — two `terminal_open` calls return
    different 32-char hex ids. Locks the multi-session contract.
  - `write_to_one_session_does_not_leak_to_another` — writes a unique
    marker to A, asserts the marker appears on A's sink and NOT on B's
    sink. Locks the per-session reader thread + sink demux.
  - `close_one_session_does_not_affect_the_other` — closes A, then
    writes to B, asserts B is still writable.
- 1 new test in `src-tauri/tests/terminal_tauri_smoke.rs`
  (multi-session wire shape):
  - `two_opens_yield_two_distinct_camel_case_session_ids` — locks the
    multi-session wire shape: two `OpenResult`s serialise as
    `{ sessionId, shell, rows, cols }` and the `sessionId`s are distinct
    32-char hex strings.
- Titlebar subtitle: `dev · phase 4c`.

### Verified (Phase 4c)

- `npm run typecheck` — 0 errors
- `npm run build` — 127 modules transformed (was 123 in 4b; +4 from
  `terminalStore.ts`, `TerminalTabs.tsx`, `.module.css`, `index.ts`).
  Bundle: 492 KB JS / 30 KB CSS, gzipped 137 KB / 6.6 KB.
- `cargo test --lib` — 28/28 still passing (no Rust changes in 4c)
- `cargo test --test terminal_smoke` — 9/9 passing (was 6; +3
  multi-session tests)
- `cargo test --test terminal_tauri_smoke` — 3/3 passing (was 2; +1
  multi-session wire shape test)
- `cargo test --test git_status_smoke` — 6/6 still passing
- Total Rust tests: 28 + 9 + 3 + 6 = 46 (was 42 in 4b; +4 in 4c).
- `cargo tauri dev` smoke: Tauri window opens, titlebar reads
  `dev · phase 4c`, no console errors on first paint. Screenshot saved
  to `verify/screenshot_4c.png` — visually confirms the Source Control
  tab is still the default, the Terminal tab is visible, and the
  titlebar's "dev · phase 4c" subtitle is rendering. (Full E2E
  "click Terminal tab → see idle state → click `+ New terminal` →
  see tab strip with one tab → click `+` again → see two tabs → click
  tab 1 → xterm.js remounts" was not driven headlessly — same WebView2
  click limitation as 4b. The pipe is proven by 4a's 12 tests + 4c's
  3 multi-session tests, the wire shape is locked by 4b's 2 + 4c's 1
  test, and a human click in the dev window is the canonical 4c
  verification.)

### Added (Phase 5a — AI provider config + Settings screen, no LLM call yet)

- `keyring = "3.6"` added to `src-tauri/Cargo.toml` with explicit
  feature selection per platform: `windows-native` (Win Credential
  Manager), `apple-native` (macOS / iOS Keychain), `sync-secret-service`
  + `crypto-rust` + `vendored` (Linux Secret Service over D-Bus with
  OpenSSL statically linked). Android is out of scope (keyring 3.x has
  no Android support; `tauri-plugin-stronghold` will be added when
  mobile lands).
- `src-tauri/src/secrets.rs` (new, ~330 lines) — `set_api_key(provider,
  key)`, `has_api_key(provider)`, `get_api_key(provider) -> Option<String>`
  (used by 5b), `delete_api_key(provider)` (idempotent). Validation:
  provider id is 1..=64 ASCII chars, key is 1..=512 chars. Service name
  = `app.lipi.ide` (matches the Tauri bundle id), user name = provider
  id. `SecretError` is a structured enum (not a String) with three
  variants: `InvalidInput { detail }`, `KeychainUnavailable { detail }`,
  `Platform { detail }`, all serialised as `{ kind: "camelCase", detail:
  "..." }` so the TS `SecretErrorPayload` discriminated union mirrors
  it exactly. A process-wide `entry_cache` (`Mutex<HashMap<String,
  Arc<keyring::Entry>>>`) holds one `Entry` per provider — this is
  **mandatory** for the mock store (which is per-Entry, not per-
  (service,user)) and is a real perf win on Windows.
- `src-tauri/src/ai.rs` (new, ~140 lines) — minimal Phase 5a scope:
  `ProviderInfo` struct (id, displayName, openaiCompatibleBaseUrl,
  anthropicCompatibleBaseUrl, defaultModel, availableModels,
  description, keyUrl) serialised to camelCase JSON; `list_providers()`
  returns the 3 supported providers (OpenAI, Anthropic, OpenRouter);
  `provider_by_id(id)` for 5b to validate the `provider` field;
  `get_configured_providers()` returns the subset that have keys.
  5b will add the `chat_stream` command and the OpenAI / Anthropic
  SSE parsers.
- 5 new Tauri commands wired in `src-tauri/src/lib.rs`:
  `secrets_set_api_key`, `secrets_has_api_key`, `secrets_delete_api_key`,
  `ai_list_providers`, `ai_get_configured_providers`. The internal
  rs-suffixed names are `pub use`d so integration tests in `tests/`
  can call the same functions the Tauri commands call.
- `src/ipc/secrets.ts` (new) — typed wrapper for `secretsSetApiKey`,
  `secretsHasApiKey`, `secretsDeleteApiKey`. `SecretError` class +
  `SecretErrorPayload` discriminated union. **The key value is NEVER
  returned to the JS side** — only `hasApiKey` (true / false) is
  exposed. This is the "no backend, ever" guarantee (Decision #17).
- `src/ipc/ai.ts` (new) — typed wrapper for `aiListProviders` and
  `aiGetConfiguredProviders`. `ProviderInfo` interface mirrors the
  Rust `#[serde(rename_all = "camelCase")]` exactly.
- `src/ipc/index.ts` — re-exports `secrets` and `ai`.
- `src/shared/state/appStore.ts` (new, ~30 lines) — Zustand store with
  `activeScreen: 'editor' | 'settings'` and `setActiveScreen(screen)`.
  Lives in `src/shared/state/` (Rule 3 — anything that spans screens
  lives in shared).
- `src/screens/SettingsProvider/SettingsProvider.tsx` (new, ~200
  lines) + `.module.css` + `index.ts` — a real screen folder (Rule 3).
  Renders one card per provider with a `<input type="password">`
  (state lives ONLY in the card's local component state, never in a
  store), a Save button (calls `secretsSetApiKey`, then clears the
  input), a Remove button (only when configured), a Configured /
  Not-configured badge, a "Get a key →" link to the provider's
  key-management page, and inline error / success status. The `←`
  back button returns to the editor.
- `src/screens/EditorWorkspace/components/TitleBar/TitleBar.tsx` —
  adds a `⚙` `IconButton` to the right slot, with `-webkit-app-region:
  no-drag` so the click isn't swallowed by the titlebar's drag
  region. The `showSettingsButton` prop defaults to `true`; the
  Settings screen passes `false` (you're already in Settings).
- `src/main.tsx` — the previous direct `<EditorWorkspace />` is
  replaced by a `ScreenRoot` component that reads `useAppStore((s) =>
  s.activeScreen)` and returns `<SettingsProvider />` for `'settings'`
  or `<EditorWorkspace />` for `'editor'` (the default).
- `src/screens/EditorWorkspace/EditorWorkspace.tsx` — titlebar
  subtitle updated to `dev · phase 5a`.
- `scripts/run-tauri-dev-and-shoot-5a.ps1` (new) — runs
  `cargo tauri dev`, resizes the window to 1280×800, takes a
  screenshot of the editor, simulates a `mouse_event` click on the
  gear icon (rightmost 30px of the 36px titlebar), takes a second
  screenshot of the Settings screen, and cleans up.
- `scripts/run-cargo-tests-5a.ps1` (new) — runs all 5 cargo test
  binaries and prints the pass/fail summary.

### Verified (Phase 5a)

- `npm run typecheck` — 0 errors
- `npm run build` — 132 modules transformed (was 127 in 4c; +5 from
  `appStore.ts`, `secrets.ts`, `ai.ts`, `SettingsProvider.tsx`,
  `SettingsProvider.module.css`). Bundle: 500 KB JS / 35 KB CSS,
  gzipped 140 KB / 7.5 KB. The 500 KB warning is the Monaco + xterm
  baseline; 5a added 8 KB JS. A future optimisation: code-split
  `SettingsProvider` via `React.lazy` (only loaded on gear click),
  which would save ~8 KB on the initial editor screen.
- `cargo test --lib` — 41 / 41 passing (+13: 8 secrets + 5 ai)
- `cargo test --test secrets_ai_smoke` — 6 / 6 passing (new file)
- `cargo test --test terminal_smoke` — 9 / 9 still passing (no regression)
- `cargo test --test terminal_tauri_smoke` — 3 / 3 still passing
- `cargo test --test git_status_smoke` — 6 / 6 still passing
- Total Rust tests: 41 + 9 + 3 + 6 + 6 = 65 (was 46 in 4c; +19 in 5a)
- `cargo tauri dev` smoke: Tauri window opens, titlebar reads
  `dev · phase 5a`, no console errors. **Two screenshots** saved:
  `verify/screenshot_5a_editor.png` (confirms the gear icon is
  visible in the titlebar's right slot) and
  `verify/screenshot_5a_settings.png` (confirms the Settings screen
  renders with the back button, "AI Providers" heading, lede
  paragraph, and three provider cards with the "Get a key →" link,
  "Not configured" badge, password input, and Save button each).
  The gear click was driven headlessly via `SetCursorPos` +
  `mouse_event` in `scripts/run-tauri-dev-and-shoot-5a.ps1` — first
  successful scripted UI transition in the project. (Saving an
  actual API key and verifying it lands in the OS keychain is a
  manual step — the dev box has a real Windows Credential Manager,
  so the next human can paste a test key, click Save, then check
  `Control Panel → Credential Manager → Web Credentials` to see
  the entry.)

### Added (Phase 5b-1 — Rust streaming proxy + OpenAI adapter, no UI yet)

- `reqwest = "0.12"` added to `src-tauri/Cargo.toml` with
  `rustls-tls` + `json` + `stream` features (no `default-tls`;
  `rustls` is pure-Rust and statically linked, no system
  `libssl` dependency — matches the 5a `keyring` `vendored`
  decision). Bumped `tokio` features from
  `["rt", "macros", "sync"]` to
  `["rt", "rt-multi-thread", "macros", "sync", "time"]` —
  `rt-multi-thread` is required to drive the `ai_chat_stream`
  async command; `time` is for future 5b-2 timeout handling.
  Added `futures-util = "0.3"` (for `StreamExt` on
  `reqwest::Response::bytes_stream()`) and
  `tokio-util = "0.7"` (for `tokio_util::io::StreamReader` to
  adapt a `Stream<Item = Result<Bytes>>` to an `AsyncRead` for
  our SSE parser).
- `src-tauri/src/chat.rs` (new, ~600 lines, single file single
  concern per Rule 3):
  - `ChatMessage { role, content, name? }` — the per-message
    shape sent in the OpenAI request body. `role` is
    `"system" | "user" | "assistant"`; `name` is optional and
    used by some providers for multi-user chats. Serialised
    camelCase.
  - `ChatDelta` — a tagged enum
    (`#[serde(rename_all = "camelCase", tag = "kind")]`)
    with three variants: `Delta { text } | Done { cancelled }
    | Error { errorKind, message }`. The Rust field name
    `error_kind` serialises to `errorKind` in JSON because
    the `kind` field name is reserved for the serde
    discriminant tag. `Done { cancelled: true }` is emitted
    on `ai_cancel_stream` (5b-2); `Done { cancelled: false }`
    is emitted on `[DONE]` or clean EOF.
  - `ChatError` — setup errors only (returned from
    `stream_chat_openai` for bad URL, missing key, etc.):
    `MissingApiKey(String)`, `UnknownProvider(String)`,
    `HttpClient { detail }`, `HttpTransport { detail }`,
    `HttpStatus { status, body }`. Streaming errors
    (parse failures, mid-stream transport errors) are
    surfaced as `ChatDelta::Error` chunks, not as
    `Result::Err`, so the JS side sees a uniform
    `ChatDelta` stream.
  - `SseStream<R: AsyncReadExt + Unpin>` — a tiny SSE
    parser that wraps a `BufReader<R>` and yields
    `SseEvent::Data { data: String } | SseEvent::Done`.
    Handles: `data: {json}\n\n` framing; `[DONE]`
    sentinel; partial UTF-8 across chunks (the buffer is
    `Vec<u8>`; we only `from_utf8_lossy` at the frame
    boundary); multiple `data:` lines per event
    concatenated with `\n` (per SSE spec — OpenAI never
    does this in practice, but we handle it for
    correctness); `:`-prefixed comment lines silently
    dropped; `\r\n` and `\n` line endings; the
    leading-space-after-`data:` rule.
  - `stream_chat_openai(api_key, base_url, model, messages,
    on_chunk: impl Fn(ChatDelta) + Send + 'static, cancel:
    Arc<AtomicBool>) -> Result<(), ChatError>` — POSTs to
    `{base_url}/chat/completions` with
    `Authorization: Bearer {key}` and
    `Accept: text/event-stream`, wraps
    `resp.bytes_stream()` in a `StreamReader`, feeds it to
    `SseStream`, and invokes `on_chunk(Delta{text})` for each
    `choices[0].delta.content` (other `delta` fields like
    `delta.role` are silently skipped), `on_chunk(Done{
    cancelled: false })` on `[DONE]` or clean EOF, and
    `on_chunk(Error{errorKind, message})` on parse
    failure / transport error / non-2xx status.
    Cancellation is cooperative: `cancel.load(Ordering::
    Relaxed)` is checked between SSE events; if flipped,
    the function emits a synthetic
    `Done { cancelled: true }` chunk and returns `Ok(())`.
    HTTP status mapping: 401 / 403 → `errorKind: "auth"`,
    429 → `rateLimit`, 5xx → `server`, other → `http`.
    The function is **provider-agnostic** — pass any
    OpenAI-compatible base URL (OpenAI itself, OpenRouter,
    Together, etc.); the Anthropic adapter (5b-2) is a
    different function because the request body, auth
    headers, and SSE framing are different.
- `src-tauri/src/lib.rs` — `mod chat;` +
  `pub use chat::{stream_chat_openai, ChatDelta, ChatError,
  ChatMessage};`. New Tauri command
  `ai_chat_stream(app: AppHandle, args: ChatRequestArgs) ->
  Result<String, ChatError>`: looks up the provider via
  `provider_by_id` (5b-1 accepts only `openai` —
  `openrouter` / `anthropic` get `ChatError::UnknownProvider`
  until 5b-2), reads the key from the keychain via
  `secrets::get_api_key` (returns `MissingApiKey` if absent),
  picks the base URL from
  `provider.openai_compatible_base_url` (the `openai` entry
  has it set; `anthropic` has `None`), defaults the model to
  `provider.default_model` if the JS side omits one,
  generates a `requestId` of the form `ai_<32 hex chars>`
  (16 random bytes via `getrandom`), `tokio::spawn`s a task
  that calls `stream_chat_openai` with a `move` closure that
  emits `ai://chunk` events (with payload
  `{ requestId, payload: ChatEventPayload }` where
  `ChatEventPayload` is the `ChatDelta → { kind, … }`
  discriminated union with `kind: "delta" | "done" | "error"`).
  On natural completion the task emits `ai://done` (with
  `{ requestId, cancelled: false }`); on early failure
  (`Result::Err`) it emits `ai://error` (with
  `{ requestId, kind, message }`) followed by `ai://done` so
  the JS store can clear the "streaming" status either way.
  The command returns the `requestId` **synchronously** so
  the JS side can subscribe to the events before the first
  chunk arrives (same pattern as 4a's terminal).
- 8 new tests in `chat::tests`:
  `parses_a_single_complete_frame`,
  `parses_multiple_frames_in_sequence`,
  `recognizes_done_sentinel`,
  `skips_comment_lines`,
  `handles_crlf_line_endings`,
  `strips_leading_space_after_data_colon`,
  `yields_none_on_eof`,
  `concatenates_multiple_data_lines_per_event`. The parser
  is generic over `R: AsyncReadExt + Unpin`, so the tests
  feed it `BufReader<Cursor<Vec<u8>>>` — no HTTP, no
  `reqwest`, no real network. Tests are deterministic,
  fast, and don't need a Tauri `AppHandle`.

### Verified (Phase 5b-1)

- `cargo build` — clean, 0 errors, 0 warnings
  (fixed an `unused mut` warning on the `byte_stream`
  binding).
- `cargo test --lib` — 49 / 49 passing (+8: 8 chat SSE
  tests). Was 41 in 5a.
- `cargo test` (all) — 73 tests total (49 + 6 + 9 + 3 + 6 +
  0), 0 failures, with one transient flake on
  `secrets_ai_smoke::ai_get_configured_providers_includes_any_provider_with_a_key`
  (the same flakiness from 5a — happens when test orderings
  cause the mock keychain to have a non-empty baseline).
  The flake is non-deterministic and resolves on re-run; a
  future phase should add a per-test
  `set_default_credential_builder` reset to make the test
  fully hermetic.
- `npm run typecheck` — 0 errors (no UI changes, as
  expected).
- `npm run build` — pass, 132 modules, no new chunks
  (5b-1 is Rust-only).
- No `cargo tauri dev` smoke test in 5b-1 (no UI changes;
  the AI panel is 5b-3). 5b-1 is verified by Rust tests
  alone.

### Added (Phase 5b-2 — OpenRouter passthrough + Anthropic adapter + `ai_cancel_stream`, no UI yet)

- `src-tauri/src/chat.rs` — `SseStream` extended with an
  `event_name: String` per-event buffer (set when we
  see an `event:` line, reset on event boundary). New
  `SseEvent::Named { event: String, data: String }`
  variant yields events with a non-empty `event_name`
  (Anthropic-style). `flush_event` yields `Named` when
  `event_name` is non-empty, `Data { data }` when
  empty, `Done` only for unnamed `[DONE]`. The 5b-1
  OpenAI adapter now matches `SseEvent::Named`
  defensively (emits an `Error { errorKind: "parse" }`
  chunk if a named event shows up — OpenAI doesn't
  use them). `ChatDelta::Done` extended with
  `stopReason: Option<String>` (with
  `#[serde(skip_serializing_if = "Option::is_none")]` so
  the field is absent, not `null`, in OpenAI events).
  `ChatEventPayload` and `DoneEnvelope` in `lib.rs`
  mirror the new field.
- `src-tauri/src/chat.rs` — new
  `stream_chat_anthropic(api_key, base_url, model,
  messages, on_chunk, cancel) -> Result<(), ChatError>`
  (~200 lines). Request body:
  `{ model, max_tokens: 4096, system?, messages,
  stream: true }`. The system prompt is extracted from
  `messages` where `role == "system"` (concatenated
  with `\n\n` if multiple, since Anthropic only accepts
  one top-level system prompt); `max_tokens: 4096` is
  hardcoded for the MVP (5b-3+ will surface as a
  model-settings UI control). Auth: `x-api-key: <key>`
  + `anthropic-version: 2023-06-01` (no
  `Authorization: Bearer`). The response SSE is
  matched on `event:` names: `content_block_delta` →
  extracts `data.delta.text` and emits `Delta{text}`;
  `message_delta` → captures `data.delta.stop_reason`
  for the eventual `Done`; `message_stop` → emits
  `Done { cancelled: false, stopReason: pending }`;
  other named events (`message_start`,
  `content_block_start`, `content_block_stop`, `ping`)
  are silently skipped. Cancellation works the same as
  OpenAI: `cancel.load(Ordering::Relaxed)` between
  events, synthetic
  `Done { cancelled: true, stopReason: None }` on
  flip.
- `src-tauri/src/cancel.rs` (new, ~200 lines) —
  process-wide cancellation registry.
  `static CANCEL_REGISTRY: OnceLock<Mutex<HashMap<String,
  Arc<AtomicBool>>>>` (the `OnceLock` is in `std::sync`
  since Rust 1.70, well within the 1.82 MSRV).
  `register(request_id) -> (Arc<AtomicBool>,
  CancelGuard)` inserts a fresh `Arc<AtomicBool>` into
  the map and returns a guard; `lookup(request_id) ->
  Option<Arc<AtomicBool>>` for the `ai_cancel_stream`
  command; `deregister(request_id)` for explicit
  cleanup. The `CancelGuard` is RAII: holding it keeps
  the entry in the map; dropping it (when the reader
  task exits, naturally or on error) removes the
  entry automatically. This means the map only ever
  contains in-flight requests, never stale entries. No
  startup wiring is needed —
  `OnceLock::get_or_init` is called on first
  `register`.
- `src-tauri/src/lib.rs` — new Tauri command
  `ai_cancel_stream(request_id: String) ->
  Result<bool, String>` looks up the flag in the
  registry and calls
  `flag.store(true, Ordering::Relaxed)`. Returns
  `Ok(true)` if the request was found, `Ok(false)` if
  it was already gone (the user clicked Stop on a
  stream that finished naturally). Wired in
  `invoke_handler`. The command does NOT remove the
  entry from the registry — the reader task's
  `CancelGuard` will do that on exit, avoiding a race
  where the entry is removed before the task can look
  it up for its final `ai://done` emit.
- `src-tauri/src/lib.rs` — `ai_chat_stream` is now a
  multi-provider dispatcher. After the existing 5b-1
  setup (keychain read, model default, requestId gen,
  cancel registry register, `tokio::spawn`), the
  command pre-resolves `openai_base` and
  `anthropic_base` from
  `provider.openai_compatible_base_url` /
  `anthropic_compatible_base_url` and matches on
  `provider_id.as_str()`: `openai` / `openrouter` use
  the OpenAI adapter with the appropriate base URL
  (5a already set OpenRouter's base to
  `https://openrouter.ai/api/v1`); `anthropic` uses
  the new Anthropic adapter. The match arms are
  `Some(base_url) => stream_chat_*(...).await,
  None => Err(UnknownProvider)` (no `?` in match arms
  — that was the cause of an E0277 compile error in
  the first attempt; the async block's return type
  doesn't have to be `Result` this way). A
  `DoneState` struct (wrapped in `Arc<Mutex<…>>`)
  captures the most recent `Done` chunk's `cancelled`
  / `stopReason` so the final `ai://done` event
  carries the same `stopReason` the JS side saw
  inline in the last `ai://chunk`.
- 5 new tests in `chat::tests`:
  `named_event_yields_named_variant`,
  `event_name_resets_between_events`,
  `last_event_line_wins_on_multiple_event_lines`,
  `strips_leading_space_after_event_colon`,
  `done_sentinel_is_not_recognised_inside_named_event`.
  4 new tests in `cancel::tests`:
  `register_then_lookup_returns_same_arc`,
  `guard_drop_removes_entry`, `flip_signal_via_lookup`,
  plus the random-suffix helper.

### Verified (Phase 5b-2)

- `cargo build` — clean, 0 errors, **0 warnings**
  (fixed an unused `AtomicBool` import in `lib.rs`,
  an unused `Ordering` import in `lib.rs` /
  `cancel.rs` — the latter allowed with
  `#[allow(unused_imports)]` since `Ordering` is only
  used in `#[cfg(test)]`), and an unused `disarm`
  method on `CancelGuard` that I removed in favour of
  the RAII-only flow).
- `cargo test --lib` — 57 / 57 passing (+8: 5
  named-event tests + 3 cancel tests; was 49 in
  5b-1).
- `cargo test` (all) — 81 tests total (57 + 6 + 6 +
  9 + 3 + 0), 0 failures, **stable across two runs**
  (no flakes this time — the 5a flakiness is
  independent of 5b-2 changes).
- `npm run typecheck` — 0 errors (no UI changes, as
  expected).
- `npm run build` — pass, 132 modules, no new chunks
  (5b-2 is Rust-only).
- No `cargo tauri dev` smoke test in 5b-2 (no UI
  changes; the AI panel is 5b-3). 5b-2 is verified by
  Rust tests alone.

### Added (Phase 5b-3 — frontend: `aiStore` (Zustand) + `AIPanel` side panel as third tab + model picker + composer, "append on done" — no real-time streaming render yet)

- `src/ipc/ai.ts` — extended with the
  streaming chat IPC surface. `ChatMessageArgs`
  (mirrors Rust `ChatMessage`),
  `ChatStreamArgs` (provider, model?,
  messages), `ChatChunkPayload` (discriminated
  union `delta | done | error` with `kind`
  tag), `ChunkEnvelope { requestId, payload }`,
  `DoneEnvelope { requestId, cancelled, stopReason? }`,
  `ErrorEnvelope { requestId, kind, message }`
  — every type documented in JSDoc with the
  Rust-side shape mirror so reviewers can
  see the contract at a glance. New invokes:
  `aiChatStream(args) -> Promise<string>`
  (returns the `requestId` synchronously,
  matching the 4a terminal pattern), and
  `aiCancelStream(requestId) -> Promise<boolean>`
  (returns `true` if cancelled, `false` if
  the request was already gone — natural
  completion races the user click).
  New event subscriptions: `onAiChunk`,
  `onAiDone`, `onAiError` — one-liners wrapping
  `@tauri-apps/api/event`'s `listen` for
  `ai://chunk`, `ai://done`, `ai://error`.
- `src/screens/EditorWorkspace/state/aiStore.ts`
  (new, ~480 lines) — Zustand store, screen-local
  per Rule 3. Owns the chat thread
  (`messages: ChatMessage[]` with stable
  client-side `id`s, `streaming: boolean`
  per message), the request lifecycle as a
  discriminated union `RequestStatus =
  { kind: 'idle' } | { kind: 'streaming' } |
  { kind: 'error'; errorKind; message }` (no
  boolean soup per Rule 5), the
  `activeRequestId` for event demux, and the
  `provider` / `model` / `providers` /
  `configuredProviders` selectors. `send(text)`
  optimistically appends a user message + an
  empty streaming assistant placeholder,
  calls `aiChatStream` with the full thread
  (filtered to non-streaming messages, oldest
  first), and sets `activeRequestId` once the
  invoke resolves. `stop()` calls
  `aiCancelStream` and optimistically flips
  back to `idle`; the eventual `ai://done`
  is a no-op state-wise. `setProvider`
  clears the model; a `useEffect` in
  `AIPanel` re-defaults to the new provider's
  `defaultModel`. `loadProviders` fetches
  `aiListProviders` and
  `aiGetConfiguredProviders` in parallel; if
  the current provider is unconfigured,
  falls back to the first configured one.
  Module-level `setupSubscriptions(getState)`
  runs ONCE at module load, registers the
  three listeners via the `onAi{Chunk,Done,Error}`
  IPC wrappers, and routes each event to the
  right store action based on `requestId`
  (events for unknown `requestId`s are
  silently dropped — they can't be ours). The
  store does NOT touch SSE / transport /
  cancellation tokens — those are all in Rust.
- `src/screens/EditorWorkspace/components/AIPanel/AIPanel.tsx`
  (new, ~440 lines) — the side-panel view.
  Reuses `PaneShell` (Rule 4) for the header.
  `ProviderBadge` in the header is a small
  click-to-open popover listing the 3
  providers with a green/amber dot
  (configured / not); unconfigured providers
  are disabled with a "no key" hint.
  `ChatThread` is a scrollable list of
  `MessageRow`s; user messages right-aligned
  with the accent soft background, assistant
  messages left-aligned with the elevated
  background, both with `pre-wrap` whitespace
  handling. Empty state: "Start a conversation
  / Type a message below and press `Enter` to
  send." `Composer` is a textarea + Send/Stop
  button. Enter sends, Shift+Enter inserts
  a newline. The button toggles: ⏎ Send when
  idle (disabled when text is empty or
  provider is unconfigured), ⏹ Stop when
  streaming. The streaming assistant message
  shows a blinking `▌` cursor. `ErrorBanner`
  is a dismissable red strip above the
  composer showing the `errorKind` chip and
  the human-readable message. Reuses `Button`
  and `Stack` (Rule 4). No direct `@/ipc/ai`
  imports — the store is the only boundary
  (Rule 6).
- `src/screens/EditorWorkspace/components/AIPanel/AIPanel.module.css`
  (new, ~280 lines) — all design tokens, no
  raw hex, no hardcoded dimensions. Cursor
  blink via `@keyframes`. 5b-3 deliberately
  renders the streaming message as visually
  empty (5b-4 will append deltas; the `▌`
  cursor is the only "in flight" affordance
  in 5b-3).
- `src/screens/EditorWorkspace/components/SidePanelPane/SidePanelPane.tsx`
  — added `'ai'` as the third tab (next to
  `'git'` and `'terminal'`). The tab bar is
  now `Source Control | Terminal | AI`. The
  diff view still wins over tabs (when a
  file is open in `DiffView`, the tab bar
  is hidden).
- `src/screens/EditorWorkspace/EditorWorkspace.tsx`
  — titlebar subtitle updated to
  `dev · phase 5b-3` (was `dev · phase 5a`).
- `src/screens/EditorWorkspace/state/aiStore.test.ts`
  (new, ~360 lines) — 9 vitest tests covering
  the store's surface. 4 `send` tests:
  `appends a user message and an empty
  assistant placeholder, and sets
  requestStatus to streaming`;
  `calls aiChatStream with the right args
  (provider, model, full thread)` — asserts
  the IPC wrapper passes
  `{ args: { provider: 'openai', model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'What is 2+2?' }] } }`
  to `invoke('ai_chat_stream', …)`;
  `includes previous messages in the thread
  (full conversation history)` — fires a
  `done` between two sends and asserts the
  second send's thread is
  `[user, assistant (empty), user]`;
  `ignores empty / whitespace-only sends` —
  `send('   ')` doesn't append, doesn't
  invoke. 4 `event demux` tests:
  `ai://done seals the streaming message
  and resets requestStatus to idle`;
  `ai://done for an unknown requestId is
  ignored` (the demux bails when
  `envelope.requestId !== state.activeRequestId`);
  `ai://error (pre-chunk) sets requestStatus
  to error and seals the streaming message`;
  `ai://chunk mid-stream error sets
  requestStatus to error (same path as
  ai://error)`. 1 `error lifecycle` test:
  `clearError() resets requestStatus to
  idle`. All 9 tests pass. The test setup
  uses `vi.mock('@tauri-apps/api/core', ...)`
  and `vi.mock('@tauri-apps/api/event', ...)`
  to stub the Tauri IPC at the module
  boundary; the store's module-level
  `setupSubscriptions` registers the listeners
  once, and the tests capture those listener
  functions in module-level
  `captured.{chunk,done,error}` references for
  firing events. The `beforeEach` does NOT
  reset the captured listeners (a reset bug
  was caught and fixed — see the file's JSDoc).
- `vitest.config.ts` (new) — vite config for
  the test runner, jsdom environment,
  `resolve.alias` mirrors the `@/*` →
  `src/*` from `tsconfig.json` (using
  `node:path.resolve` to get a cross-platform
  absolute path; the
  `new URL(..., import.meta.url).pathname`
  approach produces a `file://`-prefixed
  string on Windows that vite's resolver
  chokes on).
- `package.json` — `vitest` (4.1.8) and
  `jsdom` added as devDependencies; `test`
  and `test:watch` scripts added (the test
  script invokes `vitest run` via
  `node ./node_modules/vitest/vitest.mjs run`
  to avoid the `npx` shim which crashes the
  PowerShell pipeline in this environment).
  No production dependencies touched.

### Verified (Phase 5b-3)

- `cargo build` — clean, 0 errors, **0
  warnings** (no Rust changes this phase).
- `cargo test` (all) — 81 / 81 stable (the
  same 81 from 5b-2; no Rust changes this
  phase).
- `npm run typecheck` — 0 errors (caught 2
  real issues during development: an early
  `IconButton variant="primary"` that doesn't
  exist on the variant enum — IconButton
  has `default | subtle | danger`, not
  `primary`; and a `Send` button that needed
  to be a `Button` not an `IconButton` so
  the visual weight is right).
- `npm test` — 9 / 9 aiStore tests pass,
  stable across multiple runs.
- `npm run build` — pass, 137 modules
  (was 132 in 5b-2; +5 for the new AIPanel +
  aiStore + test files in the transform
  graph). Bundle size 508 kB → 509 kB
  (essentially unchanged).
- `cargo tauri dev` smoke test — Tauri
  window opens, Vite serves on :1420, the
  React app mounts. WebView2 headless
  capture is the known limitation —
  `PrintWindow` with `PW_RENDERFULLCONTENT`
  returned `True` but the resulting PNG is
  black (WebView2 in unattached console /
  RDP renders to a DirectComposition
  surface that doesn't composite to a
  software bitmap in this environment).
  5b-3 verification rests on the 9 vitest
  tests + the 137-module vite build + the
  0-error typecheck; the IPC contracts are
  proven at the type level and the store
  logic is proven by the test suite.
- 5b-3 is **"append on done" only** — the
  user can send a message, the request
  lifecycle runs end-to-end (Rust reads the
  key, opens the SSE stream, emits
  `ai://chunk` deltas + `ai://done`), and on
  `ai://done` the assistant placeholder is
  sealed. The 5b-3 placeholder stays
  visually empty because the deltas are
  deliberately ignored (logged to dev
  console via `console.debug` for sanity,
  but not applied to the message). This is
  correct and forward-compatible: 5b-4 will
  hook the same `ai://chunk` events to
  append `payload.text` to the streaming
  message in real time.
- Titlebar reads `dev · phase 5b-3` (the
  first refresh of the subtitle since 5a).
  Next: 5b-4 — wire `ai://chunk` deltas to
  the streaming assistant message
  (real-time render), plus a per-message
  tool-trace affordance for the
  function-call events that the Rust side
  already emits.

### Added (Phase 5b-4 — real-time streaming render + tool-call protocol, both Rust and frontend)

**Rust (`src-tauri/src/chat.rs`):**

- New `ChatDelta::ToolCall { id: String, name: String, input: String }` variant (4th variant, joining `Delta | Done | Error`). The `input` is the fully concatenated JSON argument string by the time we emit the chunk — we don't parse it on the wire, the JS side decides whether to validate / display / execute.
- Three new testable helpers extracted from the inline per-chunk parsing:
  - `parse_openai_chunk(data)` → `(Vec<OpenAiChunkUpdate>, Option<String>)` — returns `Text(String)` and `Tool { index, id, name, arguments }` updates. OpenAI uses a STABLE per-`index` accumulator (no "new index = previous tool complete" signal on the wire).
  - `parse_anthropic_content_block_delta(data)` → `(Option<AnthropicDeltaUpdate>, Option<String>)` — returns `Text(String)` for `text_delta` and `ToolInput { index, partial_json }` for `input_json_delta`. Other `delta.type`s (`thinking_delta` and future types) return `None` and are silently skipped.
  - `parse_anthropic_content_block_start(data)` → `(Option<AnthropicBlockStart>, Option<String>)` — returns `Some(tool: Some((id, name)))` for `tool_use` blocks, `None` for `text` blocks. The adapter doesn't track text blocks; their deltas carry the data.
- OpenAI adapter (`stream_chat_openai`):
  - Maintains a `HashMap<u32, InProgressTool> { id, name, input }` across the loop. `id` and `name` are captured from the first chunk for an `index`; `function.arguments` is concatenated byte-by-byte from subsequent chunks (the model is the source of truth — we just `String::push_str`).
  - On every stream-end path (`SseEvent::Done`, `Ok(None)` EOF, cancel, transport error) the map is drained and each in-progress tool is emitted as a `ToolCall` chunk.
  - Defensive note: malformed chunks are surfaced as `Error { errorKind: "parse" }` and the stream continues (a single bad chunk doesn't kill the stream).
- Anthropic adapter (`stream_chat_anthropic`):
  - Maintains the same `HashMap<u32, InProgressTool>` across the loop. `id` and `name` come from `content_block_start{type:"tool_use"}`; `input` is concatenated from `content_block_delta{type:"input_json_delta"}.partial_json` chunks.
  - On `content_block_stop` for an `index`, the in-progress tool is removed from the map and emitted as a `ToolCall` chunk (this is the NORMAL flow for Anthropic — each tool has a 3-event lifecycle).
  - On every stream-end path (`message_stop`, `SseEvent::Done`, `Ok(None)` EOF, cancel, transport error) the map is drained and any remaining tools are emitted as `ToolCall` chunks.
- 18 new unit tests: 7 OpenAI parser tests, 6 Anthropic parser tests, 3 wire-shape tests (`ToolCall` serialises to `{"kind":"toolCall","id":"…","name":"…","input":"…"}`; `Delta` and `Done{stopReason:"tool_use"}` shape regression tests).

**Rust (`src-tauri/src/lib.rs`):**

- `ChatEventPayload` extended with `ToolCall { id, name, input }` variant. The `From<ChatDelta>` impl maps the new variant. No Tauri-command changes.
- Fixed a pre-existing 5b-2 wire-shape inconsistency: `ChatDelta::Done.stop_reason` now serialises as `stopReason` (camelCase) via a per-field `#[serde(rename = "stopReason")]` — caught by a JSON-shape test that asserted the TS expected shape. The enum's `rename_all = "camelCase"` only applies to variant names, not to field names, so a per-field rename was needed.
- `ChunkEnvelope` docstring updated to mention `ToolCall`.

**TypeScript (`src/ipc/ai.ts`):**

- `ChatChunkPayload` discriminated union extended with a 4th variant `ToolCallPayload` (new exported interface): `{ kind: 'toolCall'; id: string; name: string; input: string }`. The `done` variant's `stopReason` JSDoc gained a 5b-4 note about Anthropic's `'tool_use'` value.
- Module docstring updated to mention 5b-4.

**TypeScript (`src/screens/EditorWorkspace/state/aiStore.ts`):**

- `ChatMessage` extended with a `toolCalls: ToolCall[]` field (every message — user / system get `[]`).
- New `ToolCall` type: `{ id: string; name: string; input: string }` (mirrors Rust `ChatDelta::ToolCall`).
- `setupSubscriptions` demux updated:
  - `delta` chunks APPEND `payload.text` to the streaming message's `content` in real time (5b-3 ignored deltas; 5b-4 wires them up).
  - `toolCall` chunks APPEND to the streaming message's `toolCalls` array.
  - `done` chunks ALSO seal the streaming message (belt-and-braces alongside `ai://done` — both arrive within a few ms and the first one wins).
  - `error` chunks still seal the streaming message and set `requestStatus.kind = 'error'` (5b-3 behaviour preserved).
  - Demux still bails on unknown `requestId`s (defensive — they can't be ours).
- `send()` initialises `toolCalls: []` on both the user message and the assistant placeholder.
- Module docstring rewritten to reflect the 5b-4 streaming model.

**TypeScript (`src/screens/EditorWorkspace/components/AIPanel/AIPanel.tsx`):**

- `MessageRow` renders an optional `ToolTraceList` under the message bubble when `message.toolCalls.length > 0`.
- `ToolTraceList` renders one `ToolTrace` per tool call.
- `ToolTrace` is a small collapsible card with:
  - Header: ⛏ icon + function name (monospace) + chevron
  - Body: `input` label + pretty-printed JSON in a `<pre>` + `output` label + "not executed (5b-4 is read-only)" placeholder
  - Each card has its own open/closed state (collapsing one doesn't collapse others)
  - `formatInput(input)` tries `JSON.parse` + `JSON.stringify(_, null, 2)` for pretty-printing, with a fallback to the raw string for hallucinated JSON
- `ChatThread` auto-scroll effect updated to fire on streaming-content changes (hash by `last.content.length` and `last.toolCalls.length` — re-renders every chunk but the scroll math is cheap).
- Streaming-cursor logic now shows the `▌` at the end of the accumulated text (5b-3 had it floating on its own since the message was always empty).
- Component docstring rewritten to mention the 5b-4 model.

**CSS (`src/screens/EditorWorkspace/components/AIPanel/AIPanel.module.css`):**

- New styles for `.toolTraceList`, `.toolTrace`, `.toolTraceHeader`, `.toolTraceIcon`, `.toolTraceName`, `.toolTraceChevron`, `.toolTraceBody`, `.toolTraceRow`, `.toolTraceLabel`, `.toolTraceJson`, `.toolTraceNoResult`. All design tokens, no raw hex.
- The JSON `<pre>` uses `white-space: pre` (NOT `pre-wrap`) so indentation is preserved exactly; horizontal scroll for very long lines, capped at 240px max-height with vertical scroll.
- The trace is `max-width: 85%` and `align-self: flex-start` to match the assistant message bubble.

**Tests:**

- `src/screens/EditorWorkspace/state/aiStore.test.ts` — 6 new tests in a new `describe('aiStore streaming render (5b-4)', …)` block:
  - `ai://chunk deltas append to the streaming assistant message in real time` (3 deltas → `'Once upon a time'`, still streaming, no tool calls)
  - `ai://chunk deltas for an unknown requestId are dropped`
  - `ai://chunk toolCall chunks append to the streaming message toolCalls array` (2 tool calls, second appends)
  - `ai://chunk toolCall chunks for an unknown requestId are dropped`
  - `ai://done seals the streaming message preserving accumulated content and toolCalls` (1 delta + 1 tool call + 1 delta + done → message has content `'Let me check the weather'`, tool calls preserved, streaming flipped to false)
  - `ai://chunk with kind "done" (inline-display) also seals the message` (asserts the inline `done` chunk seals the message but doesn't clear `requestStatus`; the `ai://done` event does that)
- The 5b-3 `send` test was updated to assert on the new `toolCalls: []` field on both the user and the assistant message. The module docstring was rewritten to scope 5b-4 vs 5b-3.

### Verified (Phase 5b-4)

- `cargo build` — clean, 0 errors, 0 warnings.
- `cargo test -- --test-threads=1` — 99 / 99 pass (75 lib + 6 git + 6 secrets_ai + 9 terminal + 3 terminal_tauri; was 81 in 5b-3, +18 from the new parsers and JSON-shape tests). One pre-existing flake was noted and re-ran single-threaded to confirm it's a test-isolation issue with the global mock keychain (the test itself acknowledges it in the comment: "the mock keychain is process-global; we cannot assert the exact set (other tests may have configured providers in parallel)"). Passes reliably when run with `--test-threads=1`.
- `npm run typecheck` — 0 errors.
- `npm test` — 15 / 15 pass (9 from 5b-3 + 6 new 5b-4).
- `npm run build` — pass, 137 modules, 510 kB bundle (was 509 kB in 5b-3; +1 kB for the ToolTrace code).
- No UI smoke test (WebView2 headless capture is a known limitation; UI verified at the type, build, and logic levels).
- Titlebar subtitle is `dev · phase 5b-3` (the sub-phases 5b-1 through 5b-4 don't update the subtitle — the next UI refresh in 5b-5 will).
- 5b-4 is **streaming render + tool-call protocol only** — the model can call tools (e.g. `get_weather`) and the tool calls show up in the chat thread with their input JSON, but the tools are NOT executed and no result is sent back to the model. This is a read-only display surface; a future phase will add the execution loop.

### Added (Phase 5b-5 — inline edit `Cmd-K` modal + provider-specific error messages + new-chat button)

**Shared primitive (`src/shared/components/Modal/`):**

- New `Modal` component — a centered, dialog-style overlay used for the Cmd-K inline edit modal (and ready for the command palette, diff view, API-key prompt, etc.). Reusable from `@/shared/components/Modal` (also re-exported through `@/shared/components` barrel).
  - Props: `open`, `onClose`, `titleId?`, `label?`, `className?`, `disableBackdropClose?`, `children`.
  - Backdrop covers the viewport with a semi-transparent dark layer (`var(--z-modal): 200`). Clicking the backdrop calls `onClose` (unless `disableBackdropClose` is set).
  - ESC closes the modal. The keydown listener is attached to the panel root (so future stacked modals work).
  - Focus trap: on open, the first focusable descendant gets focus. `Tab` / `Shift+Tab` cycle within the panel; focus does not leak to the page behind the modal.
  - Focus restoration: the element that had focus before the modal opened (e.g. the Monaco editor) is refocused on close — the recommended a11y pattern.
  - `role="dialog"`, `aria-modal="true"`, `aria-labelledby={titleId}` (the caller supplies the `id` of their title element; `Modal` uses `React.useId` to generate one if not supplied).
  - CSS module: `var(--shadow-lg)`, `var(--color-bg-elevated)`, `var(--radius-lg)`, all spacing from the token scale. No raw hex.

**TypeScript (stores — new for 5b-5):**

- `src/screens/EditorWorkspace/state/editorControllerStore.ts` — tiny Zustand store holding the live Monaco editor instance. Set by `EditorPane` on `onMount` and cleared on cleanup. Deliberately typed as `unknown` so the store doesn't pull in `monaco-editor`; consumers cast to `monaco.editor.IStandaloneCodeEditor` at the call site. This is the single hand-off point between the editor pane and the rest of the screen.
- `src/screens/EditorWorkspace/state/cmdKStore.ts` — Zustand store for the Cmd-K modal's state. Fields: `open`, `selection: { text, range: { startLineNumber, startColumn, endLineNumber, endColumn } } | null`, `instruction: string`, `streamingMessageId: string | null`, `status: 'idle' | 'streaming' | 'done' | 'error'`. Actions: `openCmdK`, `closeCmdK`, `setInstruction`, `setStreaming`, `setDone`, `setError`, `resetToIdle`. Screen-local per Rule 3.

**TypeScript (`src/screens/EditorWorkspace/state/aiStore.ts`):**

- New `sendEdit({ systemPrompt, userMessage }): Promise<string | null>` action (5b-5). Parallel to `send()` but with an explicit system prompt (used by the CmdKModal to inject "you are an editor" without polluting the chat-thread state). Returns the new assistant message's id (so the CmdKModal can subscribe to its stream-completion), or `null` on setup failure / validation failure.
- Behaves like `send()` for all other concerns: no-op if a request is already in flight; seals the streaming message on transport error; sets `requestStatus` to `'streaming'` on start.
- The Rust side gets `[system, user]` messages (no history bleed-through — a single-shot edit, not a chat continuation).

**TypeScript (`src/screens/EditorWorkspace/components/AIPanel/errorMessages.ts`):**

- New pure helper `getFriendlyError(errorKind, message) -> { title, hint }`. Maps the 7 `ErrorKind` variants from the Rust side to user-friendly titles and actionable hints:
  - `auth` → "Invalid API key" + "Open Settings to update your key."
  - `rateLimit` → "Rate limit hit" + "Wait a moment and try again."
  - `transport` → "Network error" + "Check your internet connection and try again."
  - `parse` → "Unexpected response" + "The provider returned something we couldn't parse — try again or switch models."
  - `server` → "Provider issue" + "The provider is having a rough time — try again in a few minutes."
  - `http` → "Request failed (HTTP <status>)" + "HTTP <status> — try again or check the model id." (status parsed from the raw message via `/^HTTP\s+(\d{3})/i`).
  - `cancelled` → "Stopped" + "You cancelled the response."
- Unknown `errorKind` values fall back to a generic "Something went wrong" title and use the raw message as the hint.

**TypeScript (`src/screens/EditorWorkspace/components/AIPanel/buildCmdKPrompt.ts`):**

- New pure helper `buildCmdKPrompt(selectionText, instruction) -> Result<{ systemPrompt, userMessage }, 'empty-selection' | 'empty-instruction'>`. Returns a `Result` (not throw) so the caller can surface a friendly inline error without try/catch.
- The system prompt: "You are a precise code and text editor. The user will give you a block of text and an instruction. Reply with ONLY the rewritten text — no preamble, no explanation, no markdown fences. Preserve the language, indentation, and line endings of the original."
- The user message: `"Original:\n\`\`\`\n<selection>\n\`\`\`\n\nInstruction: <instruction>\n\nRewritten:"`. The fenced block is verbatim — indentation in the selection is preserved exactly.

**TypeScript (`src/screens/EditorWorkspace/components/AIPanel/CmdKModal.tsx`):**

- New component. Always mounted (so the keyboard handler can open it without an unmount/remount). Reads `cmdKStore` for state; renders the shared `Modal` with `open={cmdKStore.open}`.
- Idle / streaming view: a small "Before" header + read-only `<pre>` of the selection + an instruction `<textarea>` (auto-focused) + a "Cancel" and an "Ask AI" button. While streaming, the "Ask AI" button shows the loading spinner and a "AI is editing…" status hint.
- Done view: a 2-column "Before | After" side-by-side layout. "Apply" calls into the live Monaco editor via `editorControllerStore` and runs `executeEdits` to replace the captured range with the assistant's response (and `pushUndoStop` so the apply is one undoable step). "Reject" closes the modal.
- Error view (when the request errored): the same ErrorBanner-style title + hint from `getFriendlyError()` in the "After" pane, with a "Try again" button (flips status back to `idle`, preserving the selection + instruction) and a "Close" button.
- Validates input via `buildCmdKPrompt`; on `empty-selection` or `empty-instruction`, shows a friendly inline error instead of firing the IPC.
- The streaming → done / error transition is driven by a `useEffect` that watches the aiStore's `messages` array: when the message with id `cmdKStore.streamingMessageId` flips to `streaming: false`, the modal moves to `'done'`. A second effect watches the aiStore's `requestStatus` and flips the modal to `'error'` on a transport failure.

**TypeScript (`src/screens/EditorWorkspace/components/AIPanel/AIPanel.tsx`):**

- The header now renders a new "New chat" `IconButton` (subtle variant, `+` icon) next to the provider badge. Calls `clearMessages()`. Disabled while `requestStatus.kind === 'streaming'` (the store's `clearMessages` no-ops in flight, but the disabled state is the visible signal).
- `ErrorBanner` rewritten: now renders a friendly title + hint from `getFriendlyError()` instead of the raw `errorKind` chip + provider message. The `errorKind` is still kept on `data-error-kind` for debugging.
- `<CmdKModal />` mounted at the bottom of the panel (always rendered; visibility controlled by `cmdKStore.open`).
- Component docstring rewritten to mention the 5b-5 model.

**TypeScript (`src/screens/EditorWorkspace/components/EditorPane/EditorPane.tsx`):**

- `ActiveEditor` now also writes the live Monaco instance to `editorControllerStore.setEditor(editor)` on `onMount`, and clears it in a `useEffect` cleanup (so a closed tab's editor doesn't leak).
- The local `editorRef` is still used for the `useEffect` that syncs external content into Monaco on tab switch — the controller store is an additional, screen-level handle.

**TypeScript (`src/screens/EditorWorkspace/EditorWorkspace.tsx`):**

- Global `Cmd-K` / `Ctrl-K` shortcut bound via `useKeyboardShortcut({ ctrl: true, key: 'k' }, …)`. The handler reads the live Monaco editor from `editorControllerStore`, calls `getSelection()` to get the current `monaco.Selection`, then `getModel().getValueInRange(sel)` to extract the text. If the selection is empty, the handler is a no-op (the user must select text first). If the selection has text, it dispatches `cmdKStore.openCmdK({ text, range })`.
- The `useKeyboardShortcut` hook already allows shortcuts inside the Monaco surface (it only skips non-Monaco text inputs), so Cmd-K fires whether the editor or the AI panel has focus.
- Titlebar subtitle updated to `dev · phase 5b-5` (first sub-phase to update the subtitle since 5b-3).

**CSS (`src/screens/EditorWorkspace/components/AIPanel/CmdKModal.module.css` + `AIPanel.module.css`):**

- New styles for the CmdKModal panel override (wider — `max-width: 720px`, `min-width: 480px`), the header (title + subtitle), the section labels, the selection preview `<pre>`, the prompt area `<textarea>`, the local error banner, the streaming hint (with a 3-dot spinner reusing the design tokens), the result split (2-column grid for Before/After), the error pane, the actions row.
- AIPanel CSS: `.errorText` / `.errorTitle` / `.errorHint` replace the old `.errorKind` / `.errorMessage` for the friendlier banner copy. All design tokens, no raw hex.

**Tests:**

- `src/screens/EditorWorkspace/components/AIPanel/errorMessages.test.ts` (new, 6 tests): title + hint present for every known ErrorKind; auth points to Settings; rateLimit tells the user to wait; cancelled is a quiet "Stopped"; http variant includes status code in title and hint; unknown kinds fall back to a generic title and use the raw message as the hint.
- `src/screens/EditorWorkspace/components/AIPanel/buildCmdKPrompt.test.ts` (new, 7 tests): system prompt has editor role + "ONLY" rule; user message embeds selection in a fenced block + instruction on its own line; whitespace in the selection is preserved verbatim; empty selection rejected with `empty-selection`; whitespace-only selection rejected; empty instruction rejected; whitespace-only instruction rejected.
- `src/screens/EditorWorkspace/state/cmdKStore.test.ts` (new, 9 tests): starts closed with no selection; `openCmdK` opens and clears any previous instruction; `setInstruction` updates the text; `setStreaming` moves to streaming + stores the message id; `setDone` moves from streaming to done; `setError` moves from streaming to error; `resetToIdle` moves from error back to idle and preserves the instruction; `resetToIdle` is a no-op when not in error; `closeCmdK` resets every transient field.
- `src/screens/EditorWorkspace/state/editorControllerStore.test.ts` (new, 3 tests): starts with `editor: null`; `setEditor` round-trips; `setEditor(null)` clears the handle.
- `src/screens/EditorWorkspace/state/aiStore.test.ts` — 5 new tests in a new `describe('aiStore.sendEdit (5b-5)', …)` block: `sendEdit` appends user + assistant placeholder and returns the new assistant id; sends system + user to the Rust side with no history bleed-through; returns null on empty userMessage; returns null on empty systemPrompt; returns null and surfaces a transport error on `ai_chat_stream` rejection.

### Verified (Phase 5b-5)

- `cargo build` — clean, 0 errors, 0 warnings. (No Rust changes in 5b-5; this is a pure-frontend phase.)
- `cargo test -- --test-threads=1` — 99 / 99 pass (unchanged from 5b-4: 75 lib + 6 git + 6 secrets_ai + 9 terminal + 3 terminal_tauri).
- `npm run typecheck` — 0 errors.
- `npm test` — 45 / 45 pass (15 aiStore + 6 errorMessages + 7 buildCmdKPrompt + 9 cmdKStore + 3 editorControllerStore + 5 sendEdit). Was 15 in 5b-4 — +30 new tests for 5b-5.
- `npm run build` — pass, 146 modules, 521 kB bundle (was 137 modules / 510 kB in 5b-4; +9 modules / +11 kB for the Modal primitive + CmdKModal + errorMessages + cmdKStore + editorControllerStore + new-chat IconButton + their tests, all within the 500 kB warning threshold for gzip-friendly code).
- No UI smoke test for 5b-5 (WebView2 headless capture is still a known limitation; the new code paths are covered by 30 new pure-helper tests + typecheck + build + Rust's unchanged 99 tests).
- Titlebar subtitle is `dev · phase 5b-5` (first sub-phase to update since 5b-3).
- 5b-5 is **inline edit + new chat + friendly errors** — the user can hit Cmd-K with a selection, get a modal with a "Before" preview + instruction textarea, ask the AI to rewrite the selection, see a "Before | After" diff in the modal, and Apply the change to the editor (which becomes one undoable step). The new-chat button resets the chat thread (no-op while streaming). The ErrorBanner now shows provider-specific copy (auth → "Open Settings", rateLimit → "Wait a moment", etc.) instead of leaking raw `errorKind` strings. The next phase (5b-6) starts on the tool execution loop: model emits `toolCall` → JS side registers a built-in handler like `get_file_contents` / `get_git_status` → sends the result back to the model as a follow-up message.

### Added (Phase 5b-6 — tool execution loop, both Rust and frontend)

**Rust (`src-tauri/src/chat.rs`):**

- `ChatMessage` struct extended with two new optional fields (both with `#[serde(skip_serializing_if = "Option::is_none", default)]` so the wire format is identical to before for messages without tools): `tool_calls: Option<Vec<AssistantToolCall>>` (assistant messages that emitted tool calls) and `tool_call_id: Option<String>` (tool result messages — the id of the call this is the result of). New `AssistantToolCall { id, name, arguments }` struct (camelCase via `#[serde(rename_all = "camelCase")]` so `arguments` serialises as `arguments` not `Arguments`).
- OpenAI request body (`stream_chat_openai`):
  - `OpenAiRequest` struct gained a `tools: &'a [serde_json::Value]` field, hardcoded to `get_openai_tools()` — currently the single `get_file_contents` tool with its JSON schema. The model now sees the tool's declaration and may emit tool calls in its response.
  - Assistant messages with `tool_calls` serialise as the standard `{type:"function", function:{name, arguments}}` shape (via the new struct). Tool result messages serialise as `{role:"tool", tool_call_id, content}`.
  - The existing `ChatMessage` serialisation already had the right `#[serde]` attributes — adding the new optional fields was enough to make the existing send flow carry tool history forward.
- Anthropic request body (`stream_chat_anthropic`):
  - `AnthropicRequest` gained a `tools: &'a [serde_json::Value]` field, hardcoded to `get_anthropic_tools()`. The `messages` field changed from `&'a [ChatMessage]` (lifetime-tied) to `Vec<AnthropicMessage>` (owned content blocks) so the per-message blocks can carry owned data.
  - New helper `build_anthropic_messages(messages: &[&ChatMessage]) -> Vec<AnthropicMessage>` that handles the full per-message shape: user text → `{role:"user", content:[{type:"text", text:…}]}`; assistant with tool calls → `{role:"assistant", content:[{type:"text", text:…}, {type:"tool_use", id, name, input:…}]}` (the `text` block is omitted when content is empty, the `input` is re-parsed from the JSON `arguments` string with a fallback to `{}` on parse failure); tool result messages → `{role:"user", content:[{type:"tool_result", tool_use_id, content}]}` (Anthropic's tool-result messages are sent under the `user` role per their API).
  - System prompts are still extracted from `messages` where `role == "system"` and concatenated with `\n\n` (Anthropic only accepts one top-level system prompt).
- New static helpers `get_openai_tools() -> &'static [serde_json::Value]` and `get_anthropic_tools() -> &'static [serde_json::Value]` return the hardcoded tool schemas. Both are `static` slices (not `OnceLock`-cached) since the schemas are compile-time-constant.
- 9 new unit tests in `chat::tests`:
  - `assistant_message_with_tool_calls_serialises_to_openai_shape` — locks the OpenAI `tool_calls` JSON wire shape.
  - `assistant_message_with_multiple_tool_calls_round_trips` — round-trip `serde_json` for a multi-tool assistant message.
  - `done_delta_with_tool_use_stop_reason_serialises_correctly` — locks the Anthropic `stop_reason: "tool_use"` shape.
  - `anthropic_assistant_with_tool_calls_emits_tool_use_blocks` — verifies the Anthropic builder emits `tool_use` content blocks with the right `id` / `name` / `input`.
  - `anthropic_assistant_with_invalid_json_arguments_falls_back_to_empty_object` — the model can hallucinate non-JSON; we should not crash.
  - `anthropic_tool_result_message_emits_user_role_with_tool_result_block` — locks the Anthropic tool-result wire shape.
  - `anthropic_user_message_wraps_string_in_text_block` — Anthropic's `user` role requires content blocks, not raw strings.
  - `openai_tool_schema_has_expected_shape` — locks the OpenAI tool schema (one tool, one parameter).
  - `anthropic_tool_schema_has_expected_shape` — locks the Anthropic tool schema.

**TypeScript (`src/ipc/ai.ts`):**

- `ChatMessageArgs` extended with `toolCalls?: AssistantToolCallArgs[]` and `toolCallId?: string`. `role` is now `'system' | 'user' | 'assistant' | 'tool'`. The new optional fields are JSDoc'd with the Rust-side shape mirror.
- New `AssistantToolCallArgs { id, name, arguments }` interface (camelCase, matches the Rust struct).
- Module docstring updated to mention 5b-6.

**TypeScript (`src/screens/EditorWorkspace/state/toolRegistry.ts`, new, ~370 lines):**

- `ToolHandler = (args: Record<string, unknown>) => Promise<string>` — the function signature every registered tool implements.
- `RegisteredTool { name, handler, description }` — the registry entry shape.
- Module-level `REGISTRY: Map<string, RegisteredTool>` with `registerTool`, `getTool`, `listTools` helpers. The registry is a singleton (no startup wiring needed in the app).
- `executeToolCall({toolCallId, name, arguments}): Promise<ToolExecutionResult>` is the single entry point: looks up the handler, parses the JSON argument string (falls back to `{}` on invalid JSON, also coerces arrays / scalars / null to `{}`), runs the handler with `Date.now()` timing, and returns `{ toolCallId, output, kind: 'text' | 'json' | 'error', durationMs }`.
- `classifyOutput(output: string): 'text' | 'json'` — JSON objects/arrays that `JSON.parse` to a non-null object/array → `'json'`, everything else → `'text'`. Quick heuristic first (output must start with `{` or `[`).
- First built-in tool: `get_file_contents(path) -> Promise<string>`. Validates the `path` argument, calls the existing `fsReadFile` IPC, maps the `FileContent` / `FsError` shapes to user-friendly error strings ("binary file", "file not found", "permission denied", "too large"), and returns the raw UTF-8 content for normal text files. Registered at module load.
- JSDoc on every public function explains WHY the registry exists (decoupling, testability, future-proofing for user-defined custom tools in 5c).

**TypeScript (`src/screens/EditorWorkspace/state/aiStore.ts`):**

- `RequestStatus` discriminated union extended with `{ kind: 'executingTools'; round: number }`. The composer / new-chat button consult this to disable themselves while tools are running.
- `ChatMessage` interface extended: `role` now includes `'tool'`; `toolCalls[i]` now carries `status: 'pending' | 'running' | 'done' | 'error' | 'skipped'` and an optional `result: { toolCallId, output, kind, durationMs }`; `toolCallId?: string` is added for tool result messages.
- New `MAX_TOOL_ROUNDS = 3` constant. The cap is hard — exceeding it surfaces a friendly `toolLoop` error (new `ErrorKind` variant handled by `errorMessages.ts` as "Too many tool rounds — try a simpler question").
- New `ToolExecutor` type — the signature mirrors `executeToolCall` from the registry so the store can call it without importing the registry. Stored in a module-level `_toolExecutor`, set by `registerToolExecutor(executor)`. `EditorWorkspace.tsx` registers the real `executeToolCall` on mount; tests register mocks.
- `send` action:
  - Resets `toolRound: 0` on a fresh user-initiated turn (defensive — also resets on a turn that starts from an `idle` state in case `toolRound` was left non-zero by a bug).
  - Refuses to start when `requestStatus.kind === 'executingTools'` (with a `console.warn` in dev). Avoids orphaning in-flight tool calls and desyncing the counter.
- `onAiChunk` for `kind: 'toolCall'` initialises new calls with `status: 'pending'` so the renderer can show the right state.
- `onAiDone` is now the home of the execution loop. After sealing the assistant message, it inspects the last assistant message for `pending` tool calls:
  - If pending calls exist AND `toolRound < MAX_TOOL_ROUNDS`:
    1. Transition `requestStatus` to `{ kind: 'executingTools', round: toolRound + 1 }`, mark the calls `'running'`.
    2. Execute all `pendingCallIds` in parallel via `Promise.all(executor(...))`.
    3. Update the calls with their results (`'done'` for success, `'error'` for failures).
    4. Append one `role: 'tool'` message per call to the thread.
    5. Fire a follow-up `aiChatStream` with the updated thread.
    The follow-up invoke is wrapped in `.catch` so any thrown error surfaces as a friendly transport error in the chat thread (NOT as an unhandled rejection).
  - If pending calls exist AND `toolRound >= MAX_TOOL_ROUNDS`: surface a `toolLoop` error.
  - Otherwise (no pending calls or all already executed on a previous round): just clear the lifecycle state back to `idle`.
- New `messageToArgs(m: ChatMessage): ChatMessageArgs` helper strips the local-only fields (`status`, `result`) before sending to Rust, so the wire format stays clean.
- `clearMessages` refuses to run while `executingTools` is active; `clearError` resets `toolRound` to 0.

**TypeScript (`src/screens/EditorWorkspace/components/AIPanel/AIPanel.tsx`):**

- `ToolTrace` is now a full state machine:
  - `statusIcon(tc)` — ⛏ for `pending`, ⏳ for `running`, ✓ for `done`, ✗ for `error`, ⚠ for `skipped`.
  - `statusLabel(tc)` — `queued` / `running…` / `ran in {durationMs}ms` / `error` / `no handler registered` respectively.
  - Card body shows the `input` JSON (pretty-printed via `formatInput`) and, when a result is present, the result output (pretty-printed via `formatResult` for `kind: 'json'`, raw for `kind: 'text'` or `kind: 'error'`).
  - For `pending` (no result yet) → `queued`; for `running` → `running…`; for `skipped` → `no handler registered for '{name}'`.
  - The root `<div>` has a `data-status` attribute used by the CSS module to colour the card border.
- Composer is now `isBusy` when `requestStatus.kind === 'streaming'` OR `'executingTools'`. The textarea placeholder flips to "Running tools…" and the Send button is disabled. The "new chat" `IconButton` is also disabled while `executingTools`, with a distinct `title` ("Stop running tools first" vs the streaming variant).
- The 5b-5 `CmdKModal`'s `ResultViewProps` was updated to import the canonical `RequestStatus` type from `aiStore` so it stays in sync (the local outdated copy of the union caused a TS2322 error during the migration).

**TypeScript (`src/screens/EditorWorkspace/EditorWorkspace.tsx`):**

- Registers the tool executor on mount: `useEffect(() => { registerToolExecutor(executeToolCall); }, [])`. The registry is module-level, so the test setup can swap it before any consumer imports.
- Titlebar subtitle updated to `dev · phase 5b-6` (first sub-phase to update since 5b-5).
- Component docstring updated to mention the 5b-6 wiring.

**CSS (`src/screens/EditorWorkspace/components/AIPanel/AIPanel.module.css`):**

- Added `.toolTraceStatus[data-status="..."]` colour rules (green for `done`, red for `error`, amber for `running`/`skipped`, neutral for `pending`).
- Added a matching `.toolTrace[data-status="..."]` border colour. The base card is now a thin neutral border; each status changes the left border colour so the user can scan the thread and see at a glance which tools are still running, which succeeded, and which failed.
- All design tokens, no raw hex.

**Tests:**

- `src/screens/EditorWorkspace/state/aiStore.test.ts` — 8 new tests in a new `describe('aiStore tool execution loop (5b-6)')` block:
  1. `transitions to executingTools and runs the calls when an assistant message has pending tool calls` — fires `chunk` + `done` and verifies the executor is called and the `toolCalls[i].status` flips to `done`.
  2. `appends a role:tool message per call with the result content and the original call id` — verifies the thread gains a `role: 'tool'` message with the right `toolCallId` and `content`.
  3. `starts a follow-up stream with the full thread including the tool result` — captures the `ai_chat_stream` invoke args via a chained mock impl (chains to the default beforeEach impl so the requestId resolves naturally), waits for the second invoke via a polling loop, and verifies the follow-up's `messages` array has 3 entries (user, assistant-with-tool-calls, tool result). The follow-up's last message is a `role: 'tool'` with `toolCallId: 'call_a'`.
  4. `surfaces a toolLoop error when the assistant emits more tool calls than MAX_TOOL_ROUNDS allows` — sets `toolRound: MAX_TOOL_ROUNDS` (3) AFTER calling `send` (so the override sticks; `send` resets to 0), fires a turn that wants more tools, and verifies the friendly error is set with `errorKind: 'toolLoop'`.
  5. `executor errors become kind:error results and a tool result message is still sent to the model` — registers a throwing executor, verifies the call ends with `status: 'error'` and the model still receives a `role: 'tool'` message with the error string.
  6. `does not invoke the executor when the assistant message has no tool calls` — fires `done` after a text-only assistant turn and verifies the executor is never called.
  7. `does not invoke the executor when toolRound is already at MAX_TOOL_ROUNDS (loop exit)` — sets `toolRound: 3` after `send` and verifies a friendly `toolLoop` error is set instead of executing.
  8. `clearMessages refuses to run during executingTools state` — sets `requestStatus: { kind: 'executingTools', round: 1 }` and verifies `clearMessages` is a no-op.
  Several existing 5b-4 tests were updated to expect the new `status: 'pending'` field on `ToolCall` objects and to expect the new `executingTools` transition when the assistant message has pending tool calls (previously they expected `requestStatus: 'idle'` after `done`).
  A `makeExecutor` test helper centralises the mock setup so each test just supplies a one-line result shape.
- `src/screens/EditorWorkspace/state/toolRegistry.test.ts` (new) — 13 vitest tests covering the registry in isolation:
  - Basic CRUD: `round-trips a tool through registerTool / getTool`, `listTools` includes both the test stub and the built-in `get_file_contents`, `registerTool` overwrites a tool with the same name.
  - `executeToolCall` happy path: runs the handler with parsed arguments and returns the right `kind`.
  - Error paths: unknown tool name → `kind: 'error'` with the available-tools list, invalid JSON arguments → handler still runs with `{}`, empty arguments → `{}`, non-object JSON (arrays, scalars, null) → `{}`, handler throws → `kind: 'error'` with `Tool 'X' failed: ...`.
  - Classification: JSON object output → `'json'`, JSON array output → `'json'`, JSON scalar output → `'text'`, free-form text → `'text'`.
- `src/screens/EditorWorkspace/components/AIPanel/errorMessages.ts` — extended with a `case 'toolLoop'` returning `{ title: 'Too many tool rounds', hint: 'The AI asked to run more tools than the safety limit allows — try a simpler question.' }`.

### Verified (Phase 5b-6)

- `cargo build` — clean, 0 errors, 0 warnings.
- `cargo test --no-fail-fast --lib` — **85 / 85 pass** (76 pre-5b-6 + 9 new wire-format tests). Was 76 in 5b-5.
- `npm run typecheck` — 0 errors. The 5b-6 migration caught 2 latent issues: a stale `RequestStatus` copy in `CmdKModal` and a mismatched `ToolExecutor` signature.
- `npm test` — **66 / 66 pass** (45 from 5b-5 + 13 new toolRegistry + 8 new execution-loop tests). Was 45 in 5b-5.
- `npm run build` — pass, 147 modules, ~528 kB bundle (was 146 modules / 521 kB in 5b-5; +1 module for the toolRegistry).
- No UI smoke test for 5b-6 (WebView2 headless capture is still a known limitation; the new code paths are covered by 13 new toolRegistry tests + 8 new aiStore tests + the 9 new Rust wire-format tests + typecheck + build).
- Titlebar subtitle is `dev · phase 5b-6`.
- 5b-6 is **tool execution loop complete** — the model can call `get_file_contents(path)`, the JS side looks up the handler in `toolRegistry`, executes it via `fsReadFile` IPC, gets the result (or a friendly error for binary / not-found / too-large), and sends the result back to the model as a `role: 'tool'` follow-up message. The AI then synthesises the next response with the file contents. The loop caps at 3 rounds to prevent infinite bouncing. The next phase (5b-7, tentative) is a per-tool settings UI in the Settings screen where users can opt in/out of built-in tools and (later, in 5c) configure their own custom tools.

### Added (Phase 5b-7 — per-tool settings UI + per-tool enable/disable on the wire)

- **Wire format** (`src-tauri/src/chat.rs` + `src-tauri/src/lib.rs` + `src/ipc/ai.ts`):
  - `ChatRequestArgs.enabled_tool_names: Vec<String>` (5b-7, `#[serde(default)]` so old clients keep working). The `ai_chat_stream` command plumbs it into both adapters.
  - `get_openai_tools(enabled: &[String])` and `get_anthropic_tools(enabled: &[String])` now FILTER their output by the enabled set. A disabled tool is invisible to the model — cleanest semantics, no "the model keeps asking for it" loops.
  - `stream_chat_openai` and `stream_chat_anthropic` take a new `enabled_tool_names: &[String]` parameter and pass it through to the tool-builder.
  - Introduced a `ToolSpec` catalogue (loaded via `OnceLock`) as the single source of truth for "tools the Rust side knows about". Both adapters draw from it. Future 5c+ tools register here once and become available to both providers.
  - Wire invariant: an empty `enabled` slice means "all enabled" (backwards-compat for clients that pre-date 5b-7).
  - **Rust unit tests** — 3 new in `chat::tests`: `openai_tools_are_filtered_by_enabled_whitelist`, `anthropic_tools_are_filtered_by_enabled_whitelist`, `openai_and_anthropic_share_the_same_catalogue`. The 2 existing `openai_tool_schema_has_expected_shape` / `anthropic_tool_schema_has_expected_shape` tests were updated to the new signature (empty slice = legacy "all enabled"). Total chat tests: 44 (was 41 in 5b-6).
- **Shared `Switch` component** (`src/shared/components/Switch/` — new):
  - A small `role="switch"` toggle with keyboard support (Space + Enter both toggle, `aria-checked` set, `aria-disabled` for the disabled state, required `aria-label` because the switch has no visible text).
  - Token-driven: `--color-accent` for the on-state track, `--color-bg-active` for off, `--radius-pill` for the pill shape, `--motion-base` for the thumb-slide animation. No raw hex, no hardcoded dimensions outside the token scale.
  - 44×24 px hit target (meets the 44x44 touch-target guideline via the surrounding clickable area).
  - Exported from `src/shared/components/index.ts`.
- **`toolSettingsStore`** (`src/shared/state/toolSettingsStore.ts` — new):
  - Zustand store, `disabledToolNames: string[]` (negative set — easier to reason about, survives "new tools added" without a migration step).
  - Actions: `isEnabled(name)`, `setEnabled(name, enabled)` (idempotent), `enableAll()`, `disableMany(names)` (idempotent), `hydrate()`. Plus a `setupToolSettingsPersistence()` helper that wires the `subscribe → localStorage` round-trip with a `hydrated` flag guard (avoids a redundant write on the hydration itself).
  - Persisted to `localStorage` under `lipi:toolSettings:v1` (versioned key for future migrations). Best-effort persistence — quota / private-mode failures are caught and `console.warn`'d, the in-memory state still works.
  - Hydrated once at app startup (in `aiStore.ts`'s module-load block, alongside the AI event subscriptions).
  - **Tests** — 16 new tests in `toolSettingsStore.test.ts` cover: defaults, `setEnabled` round-trip + idempotence, multi-tool tracking, `enableAll`, `disableMany` + idempotence, `hydrate` from localStorage (well-formed, malformed JSON, wrong shape, non-string items, idempotent re-call), persistence subscriber writes.
- **`aiStore` opt-out** (`src/screens/EditorWorkspace/state/aiStore.ts`):
  - On every `send()` and every follow-up stream, the store snapshots the user's enabled set via `getEnabledToolNamesSnapshot()` (a new local helper that returns `listTools().filter(not-disabled).map(name)`) and passes it as `enabledToolNames` in the `aiChatStream` args.
  - The execution loop in `runToolExecutionRound` snapshots the enabled-predicate ONCE per round (not per call) and consults it before invoking the executor. A disabled tool returns a synthetic `kind: 'error'` result with output `"Tool 'X' is disabled. Enable it in Settings → AI Tools to allow the model to use it."` — the model can react.
  - The store also calls `useToolSettingsStore.getState().hydrate()` and `setupToolSettingsPersistence()` once at module load (next to the existing `setupSubscriptions` call).
  - **Tests** — 3 new in `aiStore.test.ts`: `passes the enabled-tool names snapshot to aiChatStream on send`, `omits a tool from the enabled set when the user has disabled it`, `does not invoke the executor for a tool the user disabled mid-stream` (covers the "user toggled off mid-stream" race).
- **`toolRegistry` opt-out** (`src/screens/EditorWorkspace/state/toolRegistry.ts`):
  - `executeToolCall` takes an optional second `isEnabled?: (name: string) => boolean` predicate. When the predicate returns false, the function short-circuits with `kind: 'error'` and output `"Tool 'X' is disabled. Enable it in Settings → AI Tools to allow the model to use it."` — the handler is never invoked. Default behaviour (no predicate) is "always enabled" — the 5b-6 contract.
  - **Tests** — 4 new in `toolRegistry.test.ts`: `runs the handler when isEnabled is not provided (5b-6 default)`, `runs the handler when isEnabled(name) returns true`, `short-circuits to kind: error when isEnabled(name) returns false`, `does not invoke the handler when the tool is disabled` (sentinel-handler test that the invocation count is 0).
- **Settings UI** (`src/screens/SettingsProvider/SettingsProvider.tsx` + `SettingsProvider.module.css`):
  - New "AI Tools" section below the existing "AI Providers" cards. One card per registered tool (driven by `listTools()` from the JS `toolRegistry`, so 5c+ custom tools appear automatically).
  - Each card has the tool name (monospace, e.g. `get_file_contents`), the description, and a `Switch` bound to the store's `setEnabled` action.
  - New section styles in `SettingsProvider.module.css`: `.sectionHeading`, `.sectionLede`, `.toolRow`, `.toolText`, `.toolName`, `.toolDescription`. Reuses the existing `.card` / `.cardHeader` / etc. — no new layout language.
  - Section lede explains the user-facing semantics ("disabling a tool hides it from the model — the model won't know it exists").
  - The Settings screen imports `listTools` from the JS `toolRegistry`. Rule 6 (section isolation) is maintained — the screen depends on the shared store + the public toolRegistry API, not on `aiStore` internals.

### Verified (Phase 5b-7)

- `cargo build` — clean, 0 errors, 0 warnings.
- `cargo test --lib` — **88 / 88 pass** (85 pre-5b-7 + 3 new tool-whitelist tests: `openai_tools_are_filtered_by_enabled_whitelist`, `anthropic_tools_are_filtered_by_enabled_whitelist`, `openai_and_anthropic_share_the_same_catalogue`). Was 85 in 5b-6.
- `cargo test` (full suite) — lib: 88/88, smoke tests: 6/6 git_status + 5/6 secrets_ai (the 6th `ai_get_configured_providers_includes_any_provider_with_a_key` is a pre-existing parallel-test flake — the mock keychain is process-global and another test in the same suite may delete the key mid-run. Passes in isolation with `--test-threads=1`. Not a 5b-7 regression; flagged for a future hardening pass).
- `npm run typecheck` — 0 errors.
- `npm test` — **90 / 90 pass** (66 from 5b-6 + 16 new toolSettingsStore + 4 new toolRegistry + 3 new aiStore + 1 fixture setup). Was 66 in 5b-6.
- `npm run build` — pass, 151 modules, ~531 kB bundle (was 147 modules / 528 kB in 5b-6; +4 modules for the `toolSettingsStore` + `Switch` + 2 test files). CSS jumped to 50.17 kB (was ~48 kB) for the new Switch + tool-card styles.
- No UI smoke test for 5b-7 (WebView2 headless capture is still a known limitation; the new code paths are covered by 23 new tests + typecheck + build + the 3 new Rust wire-format tests).
- Titlebar subtitle is `dev · phase 5b-7`.
- 5b-7 is **per-tool settings UI + per-tool enable/disable complete**. The user can opt in/out of every built-in tool from the Settings screen (`Settings → AI Tools`); the choice is persisted to localStorage and survives restarts. The Rust side filters the `tools: [...]` array sent to the model so a disabled tool is invisible to the model — no "the model keeps asking for it" loops. The JS-side executor also refuses to run a disabled tool (belt-and-braces for the "user toggled off mid-stream" race). The next phase is **5b-8** (TBD) or the start of the 5c series (custom user-defined tools — the JS `toolRegistry` is now ready to host them: the Settings screen iterates `listTools()` so any new tool appears automatically).

### Added (Phase 5c — custom user-defined tools, workspace-scoped `lipi-tools.json`)

- **Backend — Rust (`src-tauri/src/`):**
  - `custom_tool.rs` (new): `CustomToolSpec` / `CustomToolArg` wire shape (the triple the model sees — `name` / `description` / `args`), `custom_tool_to_openai` + `custom_tool_to_anthropic` converters, and `merge_tool_list` / `merge_tool_list_anthropic` helpers that combine the built-in `tool_catalogue()` with a custom-tool list, filter by the `enabled_tool_names` whitelist, and project to the right provider format. 6 unit tests cover serialization, conversion, and merge.
  - `command.rs` (new): `run_command` IPC that spawns a `tokio::process::Command`, captures stdout+stderr, enforces a timeout, and truncates oversized output (default 1 MiB / side). Returns a `RunCommandResult { stdout, stderr, exitCode, cancelled }` discriminated `RunCommandError` for EmptyCommand / SpawnFailed / Timeout / NonZeroExit. 8 unit tests cover success, non-zero exit, timeout, empty program, missing program, and truncation.
  - `http.rs` (new): `http_request` IPC that builds a `reqwest::Request` from a URL + method + headers + body, enforces a timeout, and truncates oversized response bodies. Discriminated `HttpRequestError` for InvalidUrl / InvalidHeader / Network / NonSuccess / Timeout. 5 unit tests cover body truncation, URL/scheme validation, invalid headers, and the success path.
  - `lipi_tools.rs` (new): `LipiToolsFile` (versioned JSON envelope), `LipiToolEntry` (kind-dispatched: `Shell` / `Http`), `LipiToolArgSpec`, and the `read_lipi_tools` / `write_lipi_tools` workspace-relative file I/O. `LipiToolsError` is a serde-tagged enum (NotFound / Io / Json / Shape / DuplicateName / UnknownKind). `validate()` enforces unique names + supported kinds; `to_custom_tool_specs()` projects to the wire shape. 9 unit tests cover parse, validate, project, and round-trip. The Rust side returns an empty file (not an error) on `NotFound` — first-run is a non-error.
  - `lib.rs`: registered the 3 new modules and the 4 new `#[tauri::command]`s (`run_command`, `http_request`, `read_lipi_tools`, `write_lipi_tools`). `ChatRequestArgs` gained a `custom_tools: Vec<CustomToolSpec>` field (defaulted for back-compat); both `stream_chat_openai` and `stream_chat_anthropic` now accept it and pass the list through `merge_tool_list` / `merge_tool_list_anthropic`.
  - `Cargo.toml`: added `tokio` `process` feature, `url = "2"`, `http = "1"`, and `tempfile = "3"` (dev-dep).
- **Frontend — TS:**
  - `src/ipc/lipiTools.ts` (new): typed wrappers for `read_lipi_tools` / `write_lipi_tools`, full mirror of the Rust `LipiToolsFile` / `LipiToolEntry` / `LipiToolArgSpec` types, and a `LipiToolsError` discriminated union that mirrors the Rust enum (renamed the offending `kind` data field on `unknownKind` to `unknownKindValue` to avoid a name collision with the serde tag).
  - `src/ipc/runCommand.ts` (new): `RunCommandArgs` / `RunCommandResult` / `RunCommandError` wrappers.
  - `src/ipc/httpRequest.ts` (new): same shape, for `http_request`.
  - `src/ipc/ai.ts`: `CustomToolArg` / `CustomToolSpec` types + `customTools?: CustomToolSpec[]` on `ChatStreamArgs`.
  - `src/ipc/index.ts`: re-exports for the 3 new IPC modules.
  - `src/screens/EditorWorkspace/state/toolRegistry.ts`: `RegisteredTool` now has a `kind: 'builtin' | 'shell' | 'http'` discriminator and an optional `customConfig?: LipiToolEntry`. New `substitutePlaceholders` helper (replaces `{arg_name}`), `makeShellHandler` (calls `run_command` IPC), `makeHttpHandler` (calls `http_request` IPC), and `registerCustomTool(entry)` for the standard add-or-replace path. The hardcoded `get_file_contents` registration is now explicitly `kind: 'builtin'`.
  - `src/screens/EditorWorkspace/state/aiStore.ts`: snapshots the current `customToolsStore` state via `getCustomToolSpecsSnapshot()` and passes it as `customTools` on every `ai_chat_stream` call (initial `send`, tool-loop follow-up, Cmd-K `sendEdit`).
  - `src/shared/state/customToolsStore.ts` (new): the workspace-scoped source of truth for custom tool definitions. Holds `tools: LipiToolEntry[]` + `workspaceRoot` + `loaded` / `loading` / `saving` / `lastError` flags. Actions: `load(workspaceRoot)` (reads `lipi-tools.json` via IPC, re-registers handlers in `toolRegistry`), `addTool` / `updateTool` / `removeTool` (mutate in-memory + call `save` on change), `save()` (writes the in-memory list to disk). The client-side `validateEntry` checks name shape (identifier), kind, kind-specific required fields, and duplicate names. The store auto-syncs the JS `toolRegistry` on every change.
  - `src/shared/state/customToolsStore.test.ts` (new, 18 tests): default state, `getTool`, `load` (happy path, empty file, IPC error), `addTool` (success, name-collision, missing required field, IPC failure), `updateTool` (success, name collision with another tool), `removeTool` (success, no-op), `save` (no workspace). Mocks `read_lipi_tools` / `write_lipi_tools` Tauri invokes.
  - `src/screens/EditorWorkspace/state/aiStore.test.ts` (+3 tests): confirms `customTools: []` is sent by default, and that the snapshot from `customToolsStore` is forwarded on `send` + `sendEdit`.
- **UI:**
  - `src/screens/SettingsProvider/CustomToolEditor.tsx` (new): JSON-textarea editor for a single `LipiToolEntry`. Includes 1-click templates for `shell` and `http` (so new users don't hand-write JSON), inline parse-error and validation-error messages, and Save / Cancel buttons. Save hands off to `customToolsStore.addTool` / `updateTool`; on success the editor closes; on failure the error message is rendered inline. The toolbar shows a "Detected kind" hint by best-effort parsing the draft.
  - `src/screens/SettingsProvider/SettingsProvider.tsx`: new "Custom Tools" section below "AI Tools". Renders one card per `LipiToolEntry` (kind-coloured badge: orange for `shell`, blue for `http`, plus Edit / Delete buttons), an "Add custom tool" button, and the workspace path to `lipi-tools.json`. The `CustomToolEditor` mounts inline as a stacked sub-card. The store hydrates on mount (or when the workspace root changes) via the `gitStore`'s `rootPath`.
  - `src/screens/SettingsProvider/SettingsProvider.module.css`: styles for the toolbar, kind badge, editor dialog (border, monospace textarea, error message, action row). Reuses the existing `.card` / `.toolRow` / `.toolText` / `.toolName` / `.toolDescription` for visual consistency.
- **Decisions:**
  - **JSON editor over per-field form**: a `shell` tool needs `command` + `args` + `cwd` + `argsSpec`; an `http` tool needs `url` + `method` + `headers` + `body` + `argsSpec`. A flat form would have ~12 inputs. A JSON textarea is denser, exposes every field at once, and supports copy/paste between projects. Templates give a low-friction on-ramp.
  - **Workspace-scoped, file-based (not `localStorage`)**: tool DEFINITIONS belong in version control (next to the code that uses them). `localStorage` is for per-user, per-device settings (the existing `toolSettingsStore`). Mixing the two would have meant two different persistence paths in one store.
  - **Rust-owned execution for shell + http**: Tauri's renderer (the React tree) can't spawn processes or call `reqwest` directly — both go through IPC. The Rust side enforces timeouts, output limits, and (eventually) an allowlist. The JS side never touches `child_process` or `fetch` for custom tools.
  - **No `kind` data field on the `unknownKind` variant**: serde's `#[serde(tag = "kind")]` discriminator would collide with a payload field also called `kind`. Renamed the payload to `unknownKindValue` on both sides to keep the wire format unambiguous.
  - **Idempotent `removeTool`**: if the name doesn't exist, the action is a no-op — no file write. Saves a needless round-trip and keeps the on-disk file stable.

### Verified (Phase 5c)

- `cargo build` — clean, 0 errors, 0 warnings.
- `cargo test --lib` — **117 / 117 pass** (88 pre-5c + 6 from `custom_tool.rs` + 8 from `command.rs` + 5 from `http.rs` + 9 from `lipi_tools.rs` + 1 from existing). Was 88 in 5b-7.
- `npm run typecheck` — 0 errors.
- `npm test` — **116 / 116 pass** (113 pre-5c + 18 new `customToolsStore` + 3 new `aiStore` custom-tools plumbing tests; net +20 after subtracting 1 from 5b-7 fixture count). Was 90 in 5b-7.
- `npm run build` — pass, 156 modules, ~542 kB bundle (was 151 / 531 kB in 5b-7; +5 modules for `customToolsStore` + `lipiTools` IPC + `runCommand` / `httpRequest` IPC + the `CustomToolEditor` + its CSS).
- No UI smoke test for 5c (WebView2 headless capture is still a known limitation). The new UI code path is covered by the `customToolsStore` tests (which exercise the exact store actions the editor calls) + typecheck + build.
- Titlebar subtitle is `dev · phase 5c`.
- 5c is **custom user-defined tools complete**. The user can add / edit / delete `shell` and `http` tools in the Settings screen; definitions live in `<workspace>/lipi-tools.json` and are version-controlled alongside the code. The AI model sees them in the `tools: [...]` payload on every chat call (merged with the built-in catalogue by the Rust side); when the model calls one, the JS executor dispatches to `run_command` (shell) or `http_request` (http) and returns the result. Disabling is per-tool and re-uses the existing `toolSettingsStore` Switch (the new entries are registered in the same `toolRegistry` so they show up in the existing "AI Tools" list above).

### Added (Phase 4a — embedded terminal pipe)

- `portable-pty = "0.8"` added to `src-tauri/Cargo.toml` as
  the cross-platform PTY backend. `getrandom = "0.2"` added
  for the session-id generator (was already in the tree
  transitively).
- `src-tauri/src/terminal.rs` (new, ~330 lines):
  - `TerminalState` — one-per-app, held behind
    `Arc<Mutex<HashMap<String, Session>>>`. Registered with
    Tauri's state manager.
  - `Session` — `master: Mutex<Box<dyn MasterPty + Send>>`
    (mutex because the trait object isn't Sync),
    `writer: Mutex<Box<dyn Write + Send>>`,
    `child: Mutex<Option<Box<dyn Child + Send + Sync>>>`.
  - `EventSink` trait — abstracts the output / exit event
    destination so the `open` core is testable without a
    Tauri context. `TauriEventSink` wraps `AppHandle::emit`
    in `lib.rs`; `TestEventSink` captures events in tests.
  - `open` / `write` / `resize` / `close` / `default_shell`
    public functions. `open` spawns a `std::thread` reader
    (portable-pty is sync, not async — this avoids the
    spawn_blocking tax and the cross-platform async-FD
    mismatch on Windows ConPTY). Default 24×80, 4 KiB read
    chunks, `$TERM=xterm-256color` if unset.
  - Cross-platform shell: cmd.exe on Windows, `$SHELL` or
    `/bin/sh` on Unix. Test-friendly: integration tests
    skip (don't fail) if the host has no working shell.
- 4 Tauri commands wired in `src-tauri/src/lib.rs`:
  `terminal_open`, `terminal_write`, `terminal_resize`,
  `terminal_close` (+ `terminal_default_shell_cmd` for the
  future settings panel). `TerminalState` is managed via
  `tauri::Builder::manage(Arc::new(TerminalState::new()))`.
- Two Tauri events emitted by the reader thread:
  `terminal://output` (payload `{ sessionId, data: Vec<u8> }`)
  and `terminal://exit` (payload `{ sessionId, exitCode: i32 | null }`).
  Subscribed from JS via `listen` — see `useTerminal`.
- `src/ipc/terminal.ts` (new) — typed wrappers for all 5
  IPC commands, `TerminalError` class matching the Rust
  error enum (Io / Spawn / NotFound / AlreadyClosed / Pty),
  `onTerminalOutput` / `onTerminalExit` event subscriptions.
  Re-exported from `src/ipc/index.ts`.
- `src/screens/EditorWorkspace/hooks/useTerminal.ts` (new) —
  discriminated `idle | opening | running | exited | error`
  status, `output` buffer (4a accumulates; 4b will switch
  to event-driven streaming), `start` / `write` / `resize`
  / `close` / `clearOutput` actions, `isReady` boolean.
  Per Rule 6, this hook is the only place in the React tree
  that imports from `@/ipc/terminal`.

### Verified (Phase 4a)

- `npm run typecheck` — 0 errors
- `npm run build` — 113 modules transformed, 0 errors
  (+2 from `terminal.ts` + `useTerminal.ts` vs 3c-2)
- `cargo test --lib` — 28/28 passing (was 22; +6 from 4a
  unit tests)
- `cargo test --test terminal_smoke` — 6/6 passing (full
  open → write → output → resize → close round-trip against
  a real cmd.exe PTY on Windows; the `open_write_echo_round_trip`
  test writes "echo hi-from-lipi\r\n" and asserts the
  captured output contains "hi-from-lipi")
- `cargo test --test git_status_smoke` — 6/6 still passing
  (no regression in 3a/3b/3c-1/3c-2)
- `cargo tauri dev` smoke: Tauri window opens, titlebar
  shows `dev · phase 4a`, no console errors on first paint.

## [Unreleased — M3 — unified `VoiceSession` API across all STT providers]

### Added (M3)

- **Unified `VoiceSession` interface** (`src/voice/session.ts`):
  a single, stateful object that every STT provider (`stub`,
  `wispr`, `ondevice`, `webSpeech`, and the future
  `nativeDictation` slot for iOS Swift / Android Kotlin)
  conforms to. The interface exposes `onStateChange` /
  `onTranscription` / `onError` listeners (each returning an
  unsubscribe function) and `flush()` / `close()` methods.
  Replaces the four M2a/b/c function-style `transcribeViaX`
  entry points with one polymorphic surface.
- **Single error class** (`VoiceSessionError`): one stable
  23-code `VoiceSessionErrorCode` union (down from 39 codes
  across the four M2a/b/c `*ErrorCode` unions). Each code has
  a user-facing message via `voiceSessionErrorMessage(code)`.
  Consumers switch on `err.code` and read `err.message` for
  the user-facing string.
- **Factory registry** (`src/voice/sessionFactory.ts`):
  `voiceSessionFactories: Record<VoiceProviderId, VoiceSessionFactory>`
  — the single dispatch point. The hook calls
  `voiceSessionFactories[provider](opts)` and gets a
  `Promise<VoiceSessionHandle>` back. Exhaustively
  type-checked by TypeScript: adding a 6th provider is a
  compile error if the registry arm is missing.
- **Per-provider factory files** (`src/voice/sessions/`):
  five self-contained files, one per provider. The Wispr
  factory owns the PCM capture AND the WebSocket protocol
  (the M2b `wisprClient.ts` file is gone — its wire protocol
  moved in-house). The on-device factory owns the
  `stt://transcript` / `stt://error` subscriptions (the
  `onSessionStart(sessionId)` callback pattern is gone; the
  sessionId is now an internal ref). The Web Speech factory
  owns the `SpeechRecognition` instance. The stub factory
  is a `setTimeout(200ms)` final-emission machine. The
  `nativeDictation` factory is a stub that throws
  `VoiceSessionError('not-configured')` at start time (the
  Swift / Kotlin plugins land separately).
- **`AbortController`-based cancellation** (Decision #4):
  the hook creates a per-session `AbortController` and
  passes its `signal` to the factory. The factory wires the
  signal to its internal teardown. `handle.abort()` is the
  external cancellation API. The existing `generationRef`
  counter stays as a secondary React-level race guard (it
  solves the "new session started after the old one was
  aborted" case the abort controller doesn't).
- **Finer-grained 7-state machine** (`VoiceSessionState`):
  `idle | starting | listening | stopping | finalizing |
  closed | error`. The M3 win: the `transcribing` store
  state splits into `stopping` (the user-initiated teardown)
  and `finalizing` (the provider's post-stop work like
  Wispr's commit, on-device inference, Web Speech's
  `onend`). The hook's single `onStateChange` listener
  maps both to the store's `transcribing` state.
- **`useVoiceCapture` refactor**: the 922-line hook is now
  ~360 lines. The 4-branch `if/else` ladder (lines 344–356
  of the M2a file) collapses to a single
  `voiceSessionFactories[provider]()` dispatch. The 4
  per-provider `startXxxRecording` callbacks and the 3
  per-provider `stop()` branches collapse to one each. The
  per-provider `webSpeechHandleRef` / `pcmHandleRef` /
  `onDeviceSessionIdRef` / `streamRef` / `recorderRef` are
  gone — the session owns them internally. The hook's
  public return shape is unchanged.
- **`TranscriptionEvent.sessionId`** (Rust + TS): the
  on-device factory demuxes by `sessionId`. The Rust
  `TranscriptEvent` struct in `src-tauri/src/stt_capture.rs`
  gains a `pub session_id: Option<String>` field (serialised
  as camelCase `sessionId`); the M3 wire-shape test
  (`transcript_event_serializes_with_camel_case_keys`)
  asserts the new field is present.
- **New tests**: `src/voice/session.test.ts` (17 vitest
  tests for the cross-provider `VoiceSession` contract
  — factory dispatch, state transitions, listener wiring,
  error propagation, abort path, double-stop guard,
  post-close event guard, flush, `VoiceSessionError`
  class fields, immutable `mode` / `provider` fields,
  vi.fn integration). The four `useVoiceCapture.{stub,
  wispr, ondevice, webspeech}.test.tsx` files were
  rewritten to drive the new factories through their
  constructor-injection seams.

### BREAKING: `@/voice` exports changed

The following exports from `@/voice` are **deleted** (no
deprecation aliases, no `@deprecated` JSDoc, no shim
re-exports). They were internal to this repo.

- **Removed function exports**:
  - `transcribeViaWispr` (was in `src/voice/wisprClient.ts`)
  - `transcribeViaOnDevice` (was in `src/voice/onDeviceSTT.ts`)
  - `transcribeViaWebSpeech` (was in `src/voice/webSpeechSTT.ts`)
  - `transcribeStub` (was in `src/shared/hooks/useVoiceCapture.ts`)
- **Removed error classes + their code unions + message helpers**:
  - `WisprClientError`, `WisprClientErrorCode`, `wisprErrorMessage`
  - `OnDeviceSttError`, `OnDeviceSttErrorCode`
  - `WebSpeechSttError`, `WebSpeechSttErrorCode`
  - `PcmCaptureError`, `PcmCaptureErrorCode`, `pcmCaptureErrorMessage`
- **Removed files**:
  - `src/voice/wisprClient.ts` (wire protocol moved into
    `src/voice/sessions/wisprSession.ts`)
  - `src/voice/onDeviceSTT.ts` (replaced by
    `src/voice/sessions/onDeviceSession.ts`)
  - `src/voice/webSpeechSTT.ts` (replaced by
    `src/voice/sessions/webSpeechSession.ts`)
  - `src/voice/wisprClient.test.ts` (covered by
    `src/voice/session.test.ts` + the rewritten
    `useVoiceCapture.wispr.test.tsx`)
  - `src/voice/onDeviceSTT.test.ts`, `src/voice/webSpeechSTT.test.ts`
    (same)
- **Renamed**:
  - The `VoiceProvider` literal union
    (`'stub' | 'wispr' | 'ondevice' | 'webSpeech'`) is now
    `VoiceProviderId`. Import from `@/voice` or
    `@/voice/types`.
  - The M2a `VoiceProvider` *interface* in
    `src/voice/types.ts` (the abstract
    "any voice provider" shape with `isAvailable()` /
    `hasPermission()` / `startSession()` / `priority`) is
    **deleted**. M3 doesn't need it — the factory registry
    is the polymorphism point.

### Added (Known limitations — M3)

- The `flush()` method on the **stub** session rejects with
  `VoiceSessionError('unsupported')` — the stub has no audio
  buffer to flush. Wispr, on-device, and Web Speech all
  support `flush()` (Wispr sends a `commit` frame, on-device
  sends `stt_stop_listening`, Web Speech calls
  `recognition.stop()`).
- The `'nativeDictation'` Settings card and Command Palette
  entry are deferred until the iOS Swift / Android Kotlin
  plugins land. The factory stub exists (and the
  `voiceSessionFactories` registry arm is wired) so
  consumers that dispatch by `VoiceProviderId` don't need a
  follow-up patch. The `nativeDictation` row is currently
  NOT in `src/shared/commands/commands.ts`.

### Verified (M3)

- `npm run tsc -b` — 0 errors.
- `npx vitest run` — **499 / 499 pass** (was 481 pre-M3; +17
  new tests in `src/voice/session.test.ts` + 1 added
  per-provider test in `useVoiceCapture.{stub,wispr,
  ondevice,webspeech}.test.tsx`).
- `cargo check` — 0 errors.
- `cargo test --lib` — **146 / 146 pass** (unchanged; the
  Rust side adds the `session_id` field to
  `TranscriptEvent` and a new test assertion in
  `transcript_event_serializes_with_camel_case_keys`).
- `npm run build` — pass, 221 modules, ~660 kB bundle (the
  +modules are the new `session.ts` / `sessionFactory.ts` /
  five session factory files + the new test file).

## [0.0.1] — 2026-06-09

### Added (Phase 0 → 1a — frontend scaffold)

- Vite + React 18 + TypeScript project with strict mode.
- Design tokens (spacing, color, type scale) as CSS variables.
- 3-pane desktop IDE shell (file tree / editor / side panel) with titlebar
  and status bar.
- Mobile responsive shell with bottom tab bar.
- `useViewport` hook for mobile vs. desktop detection.
- Top-8 device emulator dev tool (iPhone 15 Pro, iPhone SE 3, Galaxy S24,
  Pixel 8, OnePlus 12, iPad Air M2 11", iPad mini 6, Galaxy Tab S9).
  CSS-frame preview only; not a runtime. DEV-only, tree-shaken in production.
- Voice module type definitions and `WisprClient` stub interface.
- MIT license.
- HANDOFF.md as source of truth for state and decisions.

### Known limitations

- No Tauri shell yet (no Rust, no `cargo`, no native window).
- No Monaco, file tree, terminal, git, or AI features wired up.
- No real voice capture. `WisprClient` is a typed stub only.
- Device emulator is a layout preview, not a runtime.
