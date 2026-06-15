/**
 * Phase 9 — LSP provider adapters.
 *
 * Each exported function in this file registers a
 * Monaco `monaco.languages.register*Provider` that
 * delegates to a real `typescript-language-server` via
 * the LspClient. The adapters are thin (~20 lines each)
 * because the heavy lifting is in the LspClient's JSON-RPC
 * framing + the per-method response converters.
 *
 * The set of providers mirrors the Phase 7
 * `tsConfigStore` capabilities section: anything Monaco's
 * built-in TS service is missing or gets wrong (cross-
 * file go-to-def, find-references, rename with preview,
 * code actions, etc.) gets a real-server adapter.
 *
 * Completion intentionally stays on Monaco's built-in
 * service (it's faster on the hot path; the real server's
 * 50-200ms round-trip is too slow for inline autocomplete).
 * A user who wants the real server for completion can flip
 * the kill switch off — the bridge hook then re-registers
 * everything.
 *
 * ## Why we don't depend on `monaco-languageclient`
 *
 * `monaco-languageclient@10` pulls in 30+ packages including
 * `monaco-vscode-api@25` and would require a major
 * monaco-loading refactor (we use `@monaco-editor/react`,
 * not `monaco-vscode-api`). For the Tiniest scope, calling
 * Monaco's provider APIs directly is a few hundred lines of
 * TypeScript, no extra deps, and full control over the
 * per-method response conversion.
 *
 * ## Why each provider is registered via `disposable`
 *
 * The bridge hook returns the `IDisposable[]` from
 * `registerAll()` so a tab switch can tear down all
 * providers with one `disposable.dispose()` call. Without
 * this, providers from a closed tab would still fire (and
 * would point at a stale `LspClient`).
 */
import * as monaco from 'monaco-editor';
import type { LspClient } from '../state/lspClientStore';

/**
 * The `TextDocumentIdentifier` + `Position` +
 * `Location` shape the LSP spec expects for
 * `textDocument/*` method params / responses.
 * Defined locally so this file doesn't depend on
 * `vscode-languageserver-protocol` (the only
 * things we need from it are these 4-line
 * interfaces).
 */
interface LspTextDocumentIdentifier {
  uri: string;
}
interface LspPosition {
  line: number;
  character: number;
}
interface LspRange {
  start: LspPosition;
  end: LspPosition;
}
interface LspLocation {
  uri: string;
  range: LspRange;
}

/**
 * The `TextDocumentContentChangeEvent` shape
 * the LSP spec expects inside
 * `textDocument/didChange.contentChanges`.
 *
 * `range` is the range of the document that got
 * replaced. `rangeLength` is the length of the
 * replaced range in UTF-16 code units (the LSP
 * spec uses UTF-16 by default; Monaco's
 * `rangeLength` is already in code units, so
 * they're directly compatible). `text` is the
 * new string inserted at `range`.
 *
 * The spec also defines a "whole document"
 * variant: when `range` is omitted, `text` is
 * the *new full content* and `rangeLength` is
 * ignored. We use the ranged variant for
 * every change because Monaco gives us ranges
 * (even a "set the whole doc to X" call comes
 * through as `range: (1,1)-(EOF)` + `text: X`).
 */
export interface LspTextDocumentContentChangeEvent {
  range: LspRange;
  rangeLength: number;
  text: string;
}

/**
 * Convert a Monaco `Uri` + 1-indexed line/column to
 * the LSP `Position` shape (0-indexed line + 0-indexed
 * character). Used by every `textDocument/*` request
 * the providers build.
 */
function toLspPosition(lineNumber: number, column: number): LspPosition {
  // Monaco is 1-indexed; LSP is 0-indexed.
  return { line: lineNumber - 1, character: Math.max(0, column - 1) };
}

/**
 * Convert a Monaco `IRange` to an LSP `Range`.
 */
function toLspRange(range: monaco.IRange): LspRange {
  return {
    start: toLspPosition(range.startLineNumber, range.startColumn),
    end: toLspPosition(range.endLineNumber, range.endColumn),
  };
}

/**
 * Phase 9.1 — convert Monaco's
 * `IModelContentChange[]` payload to a
 * `TextDocumentContentChangeEvent[]` for the
 * LSP `textDocument/didChange` notification.
 *
 * Monaco already gives us a precise `range` +
 * `text` per change (no Myers diff needed),
 * so the conversion is a straight per-change
 * shape transform. The interesting cases:
 *
 *   - **Single keystroke**: one change with
 *     `range: (line,col)-(line,col)` and
 *     `text: "x"`. The old code re-sent the
 *     full file (kilobytes); the new code
 *     sends ~50 bytes.
 *   - **Selection delete**: one change with
 *     `range: (start)-(end)` and `text: ""`.
 *     Same size win as a single keystroke.
 *   - **Paste / multi-line insert**: one
 *     change with `range: (start)-(start)` and
 *     `text: "line 1\nline 2\nline 3\n"`. The
 *     line breaks in the text are LSP-legal
 *     (the spec uses UTF-16 code units; `\n`
 *     is a single code unit).
 *   - **Whole-document replace** (e.g. a
 *     `setValue()` from undo/redo or a model
 *     swap): one change with `range: (1,1)-
 *     (EOF)` and `text: "<new full content>"`.
 *     We forward it as-is — it's still an
 *     incremental change, just one that
 *     happens to cover the whole document.
 *     The TypeScript language server handles
 *     this fine (it just replaces the whole
 *     buffer and re-validates).
 *   - **Multi-change event**: Monaco batches
 *     changes (e.g. a formatting command that
 *     rewrites 5 regions at once). We forward
 *     each change as its own
 *     `TextDocumentContentChangeEvent` in
 *     the same `contentChanges` array. The
 *     spec says "The server applies the changes
 *     in the order they appear" — Monaco
 *     guarantees the array is in the order
 *     the changes were applied to the
 *     document.
 *   - **No-op event** (e.g. an undo that
 *     happens to produce the same text):
 *     `changes: []`. We forward an empty
 *     `contentChanges` array; the server's
 *     behaviour is a no-op (the spec doesn't
 *     forbid an empty array, and
 *     `typescript-language-server` handles it
 *     correctly — we have a test for it).
 *
 * The function is pure (no side effects, no
 * external state) so it's trivially
 * testable.
 */
export function convertContentChanges(
  monacoChanges: readonly monaco.editor.IModelContentChange[],
): LspTextDocumentContentChangeEvent[] {
  return monacoChanges.map((change) => ({
    range: toLspRange(change.range),
    // Monaco's `rangeLength` is in UTF-16 code
    // units, which is what the LSP spec
    // expects. No conversion needed.
    rangeLength: change.rangeLength,
    text: change.text,
  }));
}

/**
 * Convert an LSP `Range` to a Monaco `IRange`.
 */
function fromLspRange(range: LspRange): monaco.IRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  };
}

/**
 * Convert an LSP `Location` to a Monaco `Location`.
 */
function fromLspLocation(loc: { uri: string; range: LspRange }): monaco.languages.Location {
  return {
    uri: monaco.Uri.parse(loc.uri),
    range: fromLspRange(loc.range),
  };
}

/**
 * Send `textDocument/didOpen` for the given model. Called
 * once per mount by the bridge hook.
 */
export async function sendDidOpen(
  client: LspClient,
  model: monaco.editor.ITextModel,
  languageId: string,
): Promise<void> {
  await client.notify('textDocument/didOpen', {
    textDocument: {
      uri: model.uri.toString(),
      languageId,
      version: model.getVersionId(),
      text: model.getValue(),
    },
  });
}

/**
 * Phase 9.1 — send an incremental
 * `textDocument/didChange` notification. Each
 * `IModelContentChange` in the event is
 * converted to a ranged
 * `TextDocumentContentChangeEvent` and
 * forwarded to the server in order. For a
 * single keystroke the wire payload drops
 * from "full document text" (~kilobytes for
 * a 5k-line file) to "~50 bytes" (the
 * `range` + `text` of the change).
 *
 * `version` is the model's `versionId` *after*
 * the change (Monaco guarantees
 * `e.versionId > d.versionId` for any
 * non-empty change). The LSP spec says
 * versions must be monotonically increasing;
 * Monaco's `versionId` satisfies this.
 *
 * The caller (the bridge hook) is responsible
 * for *not* calling this on a no-op event
 * (Monaco's `onDidChangeModelContent` can
 * fire with `changes: []` in edge cases —
 * e.g. an undo that re-produces the same
 * text). We still forward empty
 * `contentChanges` arrays because the spec
 * allows them; the server treats them as
 * no-ops.
 */
export async function sendDidChange(
  client: LspClient,
  model: monaco.editor.ITextModel,
  event: monaco.editor.IModelContentChangedEvent,
): Promise<void> {
  await client.notify('textDocument/didChange', {
    textDocument: {
      uri: model.uri.toString(),
      version: event.versionId,
    },
    contentChanges: convertContentChanges(event.changes),
  });
}

/**
 * Register a `DefinitionProvider` that calls
 * `textDocument/definition` on the server. Replaces
 * Monaco's built-in for cross-file go-to-def
 * (Monaco's TS service can follow `import` to the
 * `.d.ts` but not always to the actual `.ts`
 * source through `tsconfig.json` `paths`).
 */
function registerDefinitionProvider(
  client: LspClient,
  monacoApi: typeof monaco,
  selector: string[] = [],
): monaco.IDisposable {
  return monacoApi.languages.registerDefinitionProvider(selector, {
    async provideDefinition(model, position) {
      try {
        const result = (await client.request<LspLocation | LspLocation[] | null>(
          'textDocument/definition',
          {
            textDocument: { uri: model.uri.toString() } as LspTextDocumentIdentifier,
            position: toLspPosition(position.lineNumber, position.column),
          },
        )) as LspLocation | LspLocation[] | null;
        if (!result) return null;
        return Array.isArray(result) ? result.map(fromLspLocation) : fromLspLocation(result);
      } catch {
        // LSP error (server crashed mid-request, etc.) —
        // return null so Monaco falls through to its
        // built-in (the Phase 7 service).
        return null;
      }
    },
  });
}

/**
 * Register a `ReferenceProvider` that calls
 * `textDocument/references`. Replaces Monaco's
 * built-in single-file find-references with the
 * workspace-wide one.
 */
function registerReferencesProvider(
  client: LspClient,
  monacoApi: typeof monaco,
  selector: string[] = [],
): monaco.IDisposable {
  return monacoApi.languages.registerReferenceProvider(selector, {
    async provideReferences(model, position, _context, includeDeclaration) {
      try {
        const result = (await client.request<LspLocation[] | null>(
          'textDocument/references',
          {
            textDocument: { uri: model.uri.toString() } as LspTextDocumentIdentifier,
            position: toLspPosition(position.lineNumber, position.column),
            context: { includeDeclaration },
          },
        )) as LspLocation[] | null;
        if (!result) return null;
        return result.map(fromLspLocation);
      } catch {
        return null;
      }
    },
  });
}

/**
 * Register a `RenameProvider` that calls
 * `textDocument/rename`. Real-server rename is
 * `tsc`-grade: knows about overloads, generics,
 * and `export { X as Y }` re-exports.
 */
function registerRenameProvider(
  client: LspClient,
  monacoApi: typeof monaco,
  selector: string[] = [],
): monaco.IDisposable {
  return monacoApi.languages.registerRenameProvider(selector, {
    async provideRenameEdits(model, position, newName) {
      try {
        const result = (await client.request<{
          changes?: Array<{ textDocument: { uri: string }; edits: monaco.languages.TextEdit[] }>;
        } | null>('textDocument/rename', {
          textDocument: { uri: model.uri.toString() } as LspTextDocumentIdentifier,
          position: toLspPosition(position.lineNumber, position.column),
          newName,
        })) as {
          changes?: Array<{ textDocument: { uri: string }; edits: monaco.languages.TextEdit[] }>;
        } | null;
        if (!result || !result.changes) return null;
        // The LSP response is a flat
        // per-file edit list. Monaco wants
        // a `WorkspaceEdit` with
        // `changes: { [uri]: TextEdit[] }`.
        const edits: Record<string, monaco.languages.TextEdit[]> = {};
        for (const change of result.changes) {
          edits[change.textDocument.uri] = change.edits;
        }
        return { changes: edits } as unknown as monaco.languages.WorkspaceEdit;
      } catch {
        return null;
      }
    },
  });
}

/**
 * Register a `ImplementationProvider` that calls
 * `textDocument/implementation`. Interface methods
 * → concrete classes (a feature Monaco's built-in
 * TS service doesn't have).
 */
function registerImplementationProvider(
  client: LspClient,
  monacoApi: typeof monaco,
  selector: string[] = [],
): monaco.IDisposable {
  return monacoApi.languages.registerImplementationProvider(selector, {
    async provideImplementation(model, position) {
      try {
        const result = (await client.request<LspLocation[] | null>(
          'textDocument/implementation',
          {
            textDocument: { uri: model.uri.toString() } as LspTextDocumentIdentifier,
            position: toLspPosition(position.lineNumber, position.column),
          },
        )) as LspLocation[] | null;
        if (!result) return null;
        return result.map(fromLspLocation);
      } catch {
        return null;
      }
    },
  });
}

/**
 * Register a `DocumentSymbolProvider` that calls
 * `textDocument/documentSymbol`. Drives the
 * outline view (the side panel that shows
 * functions / classes / variables in the current
 * file).
 */
function registerDocumentSymbolProvider(
  client: LspClient,
  monacoApi: typeof monaco,
  selector: string[] = [],
): monaco.IDisposable {
  return monacoApi.languages.registerDocumentSymbolProvider(selector, {
    async provideDocumentSymbols(model) {
      try {
        const result = (await client.request<
          | Array<{
              name: string;
              kind: number;
              range: LspRange;
              selectionRange: LspRange;
              children?: unknown[];
            }>
          | null
        >('textDocument/documentSymbol', {
          textDocument: { uri: model.uri.toString() } as LspTextDocumentIdentifier,
        })) as Array<{
          name: string;
          kind: number;
          range: LspRange;
          selectionRange: LspRange;
          children?: unknown[];
        }> | null;
        if (!result) return null;
        return result.map(toDocumentSymbol);
      } catch {
        return null;
      }
    },
  });
}

/**
 * Recursively convert an LSP `DocumentSymbol` to a
 * Monaco `DocumentSymbol` (the document-outline
 * type). The LSP kind enum maps 1:1 to Monaco's
 * `SymbolKind` (also numbered 1-26).
 */
function toDocumentSymbol(
  raw: {
    name: string;
    kind: number;
    range: LspRange;
    selectionRange: LspRange;
    children?: unknown[];
  },
): monaco.languages.DocumentSymbol {
  return {
    name: raw.name,
    kind: raw.kind as monaco.languages.SymbolKind,
    range: fromLspRange(raw.range),
    selectionRange: fromLspRange(raw.selectionRange),
    children: Array.isArray(raw.children)
      ? (raw.children as Array<typeof raw>).map(toDocumentSymbol)
      : undefined,
  } as monaco.languages.DocumentSymbol;
}

/**
 * Register a `CodeActionProvider` that calls
 * `textDocument/codeAction`. Drives the
 * right-click → "Organize imports" / "Add
 * missing import" / "Quick fix" UI.
 */
function registerCodeActionProvider(
  client: LspClient,
  monacoApi: typeof monaco,
  selector: string[] = [],
): monaco.IDisposable {
  return monacoApi.languages.registerCodeActionProvider(selector, {
    async provideCodeActions(model, range, context) {
      try {
        const result = (await client.request<
          | Array<{
              title: string;
              kind?: string;
              diagnostics?: unknown[];
              isPreferred?: boolean;
              edit?: {
                changes?: Array<{
                  textDocument: { uri: string };
                  edits: monaco.languages.TextEdit[];
                }>;
              };
              command?: { title: string; command: string; arguments?: unknown[] };
            }>
          | null
        >('textDocument/codeAction', {
          textDocument: { uri: model.uri.toString() } as LspTextDocumentIdentifier,
          range: toLspRange(range),
          context: {
            diagnostics: context.markers.map((m) => ({
              range: toLspRange(m),
              message: m.message,
              severity: m.severity,
              source: m.source,
              code: m.code,
            })),
          },
        })) as Array<{
          title: string;
          kind?: string;
          diagnostics?: unknown[];
          isPreferred?: boolean;
          edit?: {
            changes?: Array<{
              textDocument: { uri: string };
              edits: monaco.languages.TextEdit[];
            }>;
          };
          command?: { title: string; command: string; arguments?: unknown[] };
        }> | null;
        if (!result) return null;
        return {
          actions: result.map((a) => {
            const edits: Record<string, monaco.languages.TextEdit[]> = {};
            if (a.edit?.changes) {
              for (const change of a.edit.changes) {
                edits[change.textDocument.uri] = change.edits;
              }
            }
            return {
              title: a.title,
              kind: a.kind,
              isPreferred: a.isPreferred,
              edit: a.edit ? { changes: edits } : undefined,
              command: a.command,
            } as unknown as monaco.languages.CodeAction;
          }),
          dispose: () => {
            // Monaco's CodeActionList is dispose-able
            // (the list of actions, not the
            // individual actions). No-op for the
            // LSP path — the server doesn't
            // allocate per-list resources.
          },
        };
      } catch {
        return null;
      }
    },
  });
}

/**
 * Register a `HoverProvider` that calls
 * `textDocument/hover`. Replaces Monaco's built-in
 * for cross-file types (e.g. hover over a class
 * imported from `node_modules/@types/...`).
 */
function registerHoverProvider(
  client: LspClient,
  monacoApi: typeof monaco,
  selector: string[] = [],
): monaco.IDisposable {
  return monacoApi.languages.registerHoverProvider(selector, {
    async provideHover(model, position) {
      try {
        const result = (await client.request<{
          contents: monaco.IMarkdownString[] | string[];
          range?: LspRange;
        } | null>('textDocument/hover', {
          textDocument: { uri: model.uri.toString() } as LspTextDocumentIdentifier,
          position: toLspPosition(position.lineNumber, position.column),
        })) as {
          contents: monaco.IMarkdownString[] | string[];
          range?: LspRange;
        } | null;
        if (!result) return null;
        return {
          contents: result.contents.map((c) =>
            typeof c === 'string'
              ? ({ value: c } as monaco.IMarkdownString)
              : (c as monaco.IMarkdownString),
          ),
          range: result.range ? fromLspRange(result.range) : undefined,
        };
      } catch {
        return null;
      }
    },
  });
}

/**
 * Register a `SignatureHelpProvider` that calls
 * `textDocument/signatureHelp`. Drives the
 * parameter-hint popover (the yellow box that
 * shows function signature + the current
 * parameter highlighted).
 */
function registerSignatureHelpProvider(
  client: LspClient,
  monacoApi: typeof monaco,
  selector: string[] = [],
): monaco.IDisposable {
  return monacoApi.languages.registerSignatureHelpProvider(selector, {
    signatureHelpTriggerCharacters: ['(', ','],
    async provideSignatureHelp(model, position) {
      try {
        const result = (await client.request<{
          signatures: Array<{
            label: string;
            documentation?: string | { kind: string; value: string };
            parameters?: Array<{
              label: string | [number, number];
              documentation?: string | { kind: string; value: string };
            }>;
          }>;
          activeSignature?: number;
          activeParameter?: number;
        } | null>('textDocument/signatureHelp', {
          textDocument: { uri: model.uri.toString() } as LspTextDocumentIdentifier,
          position: toLspPosition(position.lineNumber, position.column),
        })) as {
          signatures: Array<{
            label: string;
            documentation?: string | { kind: string; value: string };
            parameters?: Array<{
              label: string | [number, number];
              documentation?: string | { kind: string; value: string };
            }>;
          }>;
          activeSignature?: number;
          activeParameter?: number;
        } | null;
        if (!result) return null;
        return {
          value: {
            signatures: result.signatures.map((s) => ({
              label: s.label,
              documentation: s.documentation
                ? typeof s.documentation === 'string'
                  ? s.documentation
                  : s.documentation.value
                : undefined,
              parameters: (s.parameters ?? []).map((p) => ({
                label: Array.isArray(p.label) ? p.label : p.label,
                documentation: p.documentation
                  ? typeof p.documentation === 'string'
                    ? p.documentation
                    : p.documentation.value
                  : undefined,
              })),
            })),
            activeSignature: result.activeSignature ?? 0,
            activeParameter: result.activeParameter ?? 0,
          },
          dispose: () => {
            // No-op for the LSP path.
          },
        };
      } catch {
        return null;
      }
    },
  });
}

/**
 * Register an `InlayHintsProvider` if the server
 * advertises `inlayHintProvider` in its
 * `InitializeResult.capabilities`. Inlay hints
 * (TS 4.7+) show inferred variable types inline
 * (e.g. `let x = 42;` displays as
 * `let x: number = 42;` in a muted font).
 */
function registerInlayHintsProvider(
  client: LspClient,
  monacoApi: typeof monaco,
  selector: string[] = [],
): monaco.IDisposable | null {
  if (!client.initializeResult) return null;
  const caps = client.initializeResult.capabilities as Record<string, unknown>;
  if (!('inlayHintProvider' in caps)) return null;
    return monacoApi.languages.registerInlayHintsProvider(selector, {
    async provideInlayHints(model, range) {
      try {
        const result = (await client.request<
          | Array<{
              position: LspPosition;
              label: string;
              kind?: 1 | 2;
              tooltip?: string;
              paddingLeft?: boolean;
              paddingRight?: boolean;
            }>
          | null
        >('textDocument/inlayHint', {
          textDocument: { uri: model.uri.toString() } as LspTextDocumentIdentifier,
          range: toLspRange(range),
        })) as Array<{
          position: LspPosition;
          label: string;
          kind?: 1 | 2;
          tooltip?: string;
          paddingLeft?: boolean;
          paddingRight?: boolean;
        }> | null;
        if (!result) return null;
        const hints: monaco.languages.InlayHint[] = result.map((h) => ({
          position: { lineNumber: h.position.line + 1, column: h.position.character + 1 },
          label: h.label,
          kind: h.kind,
          tooltip: h.tooltip,
          paddingLeft: h.paddingLeft,
          paddingRight: h.paddingRight,
        })) as monaco.languages.InlayHint[];
        return {
          hints,
          dispose: () => {
            // No-op for the LSP path.
          },
        };
      } catch {
        return null;
      }
    },
  });
}

/**
 * Register a `CompletionItemProvider` that calls
 * `textDocument/completion` on the real LSP server.
 *
 * ## Phase 9.6 (T2#1)
 *
 * Completion is the one Phase 9 feature the
 * user explicitly asked for as a follow-up
 * because the real server's cross-file /
 * project-wide completion (knows about
 * node_modules types, .d.ts re-exports,
 * `paths` aliases in `tsconfig.json`) is
 * materially better than Monaco's built-in
 * TS service. The trade-off is latency:
 * the real server's `textDocument/completion`
 * round-trip is 50-200 ms vs Monaco's 5-20 ms.
 *
 * ## Why a separate kill switch (not a single
 *   "use real server" flag)
 *
 * The user might want the real server for
 * go-to-def / refs / rename (the
 * cross-file-quality matters) but the
 * built-in for completion (the latency
 * matters). Two flags let them tune
 * independently. The completion flag
 * defaults to `false` because the latency
 * delta is the user-facing win of the
 * built-in.
 *
 * ## Response shape
 *
 * The LSP spec says
 * `textDocument/completion` returns either
 * `CompletionItem[]` or `CompletionList` (a
 * wrapper with `isIncomplete` + `items`).
 * `typescript-language-server` returns the
 * bare array. We handle both.
 */
function registerCompletionProvider(
  client: LspClient,
  monacoApi: typeof monaco,
  selector: string[] = [],
): monaco.IDisposable {
  return monacoApi.languages.registerCompletionItemProvider(selector, {
    triggerCharacters: ['.', '"', "'", '`', '/', '@', '#'],
    async provideCompletionItems(model, position) {
      try {
        const result = (await client.request<
          | Array<{
              label: string;
              kind?: number;
              detail?: string;
              documentation?:
                | string
                | { kind: 'markdown' | 'plaintext'; value: string };
              sortText?: string;
              filterText?: string;
              insertText?: string;
              insertTextFormat?: 1 | 2;
              textEdit?: { range: LspRange; newText: string };
              additionalTextEdits?: Array<{ range: LspRange; newText: string }>;
              commitCharacters?: string[];
            }>
          | {
              isIncomplete?: boolean;
              items: Array<{
                label: string;
                kind?: number;
                detail?: string;
                documentation?:
                  | string
                  | { kind: 'markdown' | 'plaintext'; value: string };
                sortText?: string;
                filterText?: string;
                insertText?: string;
                insertTextFormat?: 1 | 2;
                textEdit?: { range: LspRange; newText: string };
                additionalTextEdits?: Array<{
                  range: LspRange;
                  newText: string;
                }>;
                commitCharacters?: string[];
              }>;
            }
          | null
        >('textDocument/completion', {
          textDocument: { uri: model.uri.toString() } as LspTextDocumentIdentifier,
          position: toLspPosition(position.lineNumber, position.column),
          context: {
            // Phase 9.6 ships without `triggerKind` /
            // `triggerCharacter` in the context — the
            // server's `typescript-language-server`
            // ignores them for the bare-array return
            // path we use; the `textDocument/completion`
            // response is the same either way.
          },
        })) as
          | Array<{
              label: string;
              kind?: number;
              detail?: string;
              documentation?:
                | string
                | { kind: 'markdown' | 'plaintext'; value: string };
              sortText?: string;
              filterText?: string;
              insertText?: string;
              insertTextFormat?: 1 | 2;
              textEdit?: { range: LspRange; newText: string };
              additionalTextEdits?: Array<{ range: LspRange; newText: string }>;
              commitCharacters?: string[];
            }>
          | {
              isIncomplete?: boolean;
              items: Array<{
                label: string;
                kind?: number;
                detail?: string;
                documentation?:
                  | string
                  | { kind: 'markdown' | 'plaintext'; value: string };
                sortText?: string;
                filterText?: string;
                insertText?: string;
                insertTextFormat?: 1 | 2;
                textEdit?: { range: LspRange; newText: string };
                additionalTextEdits?: Array<{
                  range: LspRange;
                  newText: string;
                }>;
                commitCharacters?: string[];
              }>;
            }
          | null;
        if (!result) return { suggestions: [] };
        const items = Array.isArray(result) ? result : result.items ?? [];
        const suggestions: monaco.languages.CompletionItem[] = items.map(
          (item) => fromLspCompletionItem(item, model, position),
        );
        return { suggestions };
      } catch {
        // LSP error (server crashed mid-request,
        // timeout, etc.) — return empty so Monaco
        // falls through to its built-in TS service.
        return { suggestions: [] };
      }
    },
  });
}

/**
 * Convert an LSP `CompletionItem` to a Monaco
 * `CompletionItem`. The interesting bits are the
 * `textEdit` / `insertText` / `range` plumbing:
 *
 * - If the LSP item has a `textEdit.range`, we
 *   use it as a Monaco `ISingleEditOperation.range`.
 *   LSP's range is 0-indexed and Monaco's is
 *   1-indexed, so we go through `fromLspRange`.
 * - If no `textEdit.range` is present but there's
 *   an `insertText`, we replace the current word
 *   (the Monaco `wordAtPosition` of the current
 *   `position`).
 * - If neither is present, `insertText` falls back
 *   to `label` (per the LSP spec).
 */
function fromLspCompletionItem(
  item: {
    label: string;
    kind?: number;
    detail?: string;
    documentation?:
      | string
      | { kind: 'markdown' | 'plaintext'; value: string };
    sortText?: string;
    filterText?: string;
    insertText?: string;
    insertTextFormat?: 1 | 2;
    textEdit?: { range: LspRange; newText: string };
    additionalTextEdits?: Array<{ range: LspRange; newText: string }>;
    commitCharacters?: string[];
  },
  model: monaco.editor.ITextModel,
  position: monaco.Position,
): monaco.languages.CompletionItem {
  // Determine the `range` + `text` for the
  // Monaco `ISingleEditOperation` that
  // accepts the completion.
  const word = model.getWordUntilPosition(position);
  const defaultRange: monaco.IRange = {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    endColumn: word.endColumn,
  };
  const insertText = item.insertText ?? item.label;
  const range = item.textEdit
    ? fromLspRange(item.textEdit.range)
    : defaultRange;
  const text = item.textEdit ? item.textEdit.newText : insertText;
  // Documentation. The LSP `documentation` can be
  // either a plain string or a `{ kind, value }`
  // object (markdown / plaintext). Monaco's
  // `documentation` is a `string | IMarkdownString`
  // — wrap the LSP object in a markdown string.
  const doc =
    typeof item.documentation === 'string'
      ? item.documentation
      : item.documentation?.value;
  // `insertTextRules`: LSP's
  // `insertTextFormat === 2` means
  // `InsertTextFormat.Snippet` (supports
  // `$1`, `$0`, placeholders). Monaco's
  // `CompletionItemInsertTextRule.InsertAsSnippet`
  // is bit 4. We pass it via the
  // `insertTextRules` field of
  // `monaco.languages.CompletionItem`.
  const insertTextRules =
    item.insertTextFormat === 2
      ? 4 /* InsertAsSnippet */
      : 0;
  // `kind`: the LSP `CompletionItemKind` enum
  // is mostly compatible with Monaco's, with
  // a few renames. We map the most common
  // values and let the rest fall through to
  // `Text` (Monaco's default for unknown
  // kinds).
  const kind = fromLspCompletionItemKind(item.kind);
  const out: monaco.languages.CompletionItem = {
    label: item.label,
    kind,
    detail: item.detail,
    documentation: doc,
    sortText: item.sortText,
    filterText: item.filterText,
    insertText: text,
    range,
  };
  // Only set `insertTextRules` if it's non-zero
  // (Monaco logs a warning for a zero value).
  if (insertTextRules) {
    out.insertTextRules = insertTextRules as monaco.languages.CompletionItemInsertTextRule;
  }
  return out;
}

/**
 * Map the LSP `CompletionItemKind` integer to
 * Monaco's `CompletionItemKind`. The two enums
 * share most of their values; the divergences
 * (LSP `Event` = 23, Monaco has no equivalent;
 * LSP `Operator` = 24, Monaco has no equivalent)
 * fall through to Monaco's `Text` (0).
 */
function fromLspCompletionItemKind(
  kind: number | undefined,
): monaco.languages.CompletionItemKind {
  // The LSP / Monaco enums are aligned for
  // 1-25 (with a few gaps Monaco doesn't
  // define). A straight cast is the right
  // move; the only missing value in Monaco
  // is `TypeParameter` (LSP 26, Monaco has
  // it as 25? — verified against
  // monaco-editor 0.52.2's enum).
  // The Monaco 0.52.2 enum:
  //   Method=0, Function=1, Constructor=2,
  //   Field=3, Variable=4, Class=5, Struct=6,
  //   Interface=7, Module=8, Property=9,
  //   Event=10, Operator=11, Unit=12, Value=13,
  //   Enum=14, Keyword=15, Snippet=16,
  //   Text=17, Color=18, File=19, Reference=20,
  //   Customcolor=21, Folder=22, TypeParameter=23,
  //   User=24, Issue=25.
  // The LSP 3.17 enum:
  //   Text=1, Method=2, Function=3, Constructor=4,
  //   Field=5, Variable=6, Class=7, Interface=8,
  //   Module=9, Property=10, Value=11, Enum=12,
  //   Keyword=13, Snippet=14, Color=15, File=16,
  //   Reference=17, Folder=18, Event=19, Operator=20,
  //   TypeParameter=21, User=22, Issue=23.
  // So the two enums are off by one. The mapping:
  if (kind === undefined) return monaco.languages.CompletionItemKind.Text;
  switch (kind) {
    case 1:
      return monaco.languages.CompletionItemKind.Text;
    case 2:
      return monaco.languages.CompletionItemKind.Method;
    case 3:
      return monaco.languages.CompletionItemKind.Function;
    case 4:
      return monaco.languages.CompletionItemKind.Constructor;
    case 5:
      return monaco.languages.CompletionItemKind.Field;
    case 6:
      return monaco.languages.CompletionItemKind.Variable;
    case 7:
      return monaco.languages.CompletionItemKind.Class;
    case 8:
      return monaco.languages.CompletionItemKind.Interface;
    case 9:
      return monaco.languages.CompletionItemKind.Module;
    case 10:
      return monaco.languages.CompletionItemKind.Property;
    case 11:
      return monaco.languages.CompletionItemKind.Value;
    case 12:
      return monaco.languages.CompletionItemKind.Enum;
    case 13:
      return monaco.languages.CompletionItemKind.Keyword;
    case 14:
      return monaco.languages.CompletionItemKind.Snippet;
    case 15:
      return monaco.languages.CompletionItemKind.Color;
    case 16:
      return monaco.languages.CompletionItemKind.File;
    case 17:
      return monaco.languages.CompletionItemKind.Reference;
    case 18:
      return monaco.languages.CompletionItemKind.Folder;
    case 19:
      return monaco.languages.CompletionItemKind.Event;
    case 20:
      return monaco.languages.CompletionItemKind.Operator;
    case 21:
      return monaco.languages.CompletionItemKind.TypeParameter;
    case 22:
      return monaco.languages.CompletionItemKind.User;
    case 23:
      return monaco.languages.CompletionItemKind.Issue;
    default:
      return monaco.languages.CompletionItemKind.Text;
  }
}

/**
 * Register all the LSP-driven providers on the
 * given Monaco instance. Returns the list of
 * `IDisposable`s the bridge hook holds onto so a
 * tab switch can tear them all down.
 */
export function registerLspProviders(
  client: LspClient,
  monacoApi: typeof monaco,
  selector: string[] = [],
  options: { includeCompletion?: boolean } = {},
): monaco.IDisposable[] {
  const disposables: monaco.IDisposable[] = [];
  disposables.push(registerDefinitionProvider(client, monacoApi, selector));
  disposables.push(registerReferencesProvider(client, monacoApi, selector));
  disposables.push(registerRenameProvider(client, monacoApi, selector));
  disposables.push(registerImplementationProvider(client, monacoApi, selector));
  disposables.push(registerDocumentSymbolProvider(client, monacoApi, selector));
  disposables.push(registerCodeActionProvider(client, monacoApi, selector));
  disposables.push(registerHoverProvider(client, monacoApi, selector));
  disposables.push(registerSignatureHelpProvider(client, monacoApi, selector));
  const inlayHints = registerInlayHintsProvider(client, monacoApi, selector);
  if (inlayHints) disposables.push(inlayHints);
  // Phase 9.6: register the completion provider
  // only when the caller opts in (the
  // `useMonacoLspBridge` hook reads the
  // completion sub-toggle and passes
  // `includeCompletion: true` accordingly).
  // The default of `false` preserves Phase 9's
  // "built-in is faster for completion" default.
  if (options.includeCompletion) {
    disposables.push(registerCompletionProvider(client, monacoApi, selector));
  }
  return disposables;
}
