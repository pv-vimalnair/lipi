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
 * Send `textDocument/didChange` for a full-content
 * replacement. The LSP spec supports incremental
 * changes (a `range` + `text`), but Monaco's
 * `onDidChangeContent` event only gives us the new
 * full text — and `typescript-language-server`
 * handles the full-content variant fine.
 */
export async function sendDidChange(
  client: LspClient,
  model: monaco.editor.ITextModel,
): Promise<void> {
  await client.notify('textDocument/didChange', {
    textDocument: {
      uri: model.uri.toString(),
      version: model.getVersionId(),
    },
    contentChanges: [{ text: model.getValue() }],
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
 * Register all the LSP-driven providers on the
 * given Monaco instance. Returns the list of
 * `IDisposable`s the bridge hook holds onto so a
 * tab switch can tear them all down.
 */
export function registerLspProviders(
  client: LspClient,
  monacoApi: typeof monaco,
  selector: string[] = [],
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
  return disposables;
}
