/**
 * Phase 9.6 — `lspProviders` completion adapter unit
 * tests. We test the conversion of LSP
 * `CompletionItem[]` and `CompletionList` responses
 * to Monaco `CompletionItem` suggestions, the
 * `triggerCharacters` set, and the
 * `{ includeCompletion: ... }` opt-in path of
 * `registerLspProviders`.
 *
 * The real Monaco provider machinery is not
 * exercised (we mock `monaco-editor`); the
 * adapter's pure helper functions
 * (`fromLspCompletionItem`,
 * `fromLspCompletionItemKind`) are tested
 * indirectly by capturing the `provideCompletionItems`
 * function the adapter registers with Monaco's
 * `registerCompletionItemProvider`, then calling
 * it with a fake model + position.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Minimal fake of `monaco-editor`. The adapter
// uses `monaco.languages.registerCompletionItemProvider`
// (captured), `monaco.languages.CompletionItemKind`
// (mirrored as integers), and `monaco.languages.CompletionItemInsertTextRule`
// (mirrored as `4 = InsertAsSnippet`).
const registeredProviders: Array<{
  selector: string[];
  provider: {
    triggerCharacters?: string[];
    provideCompletionItems: (
      model: unknown,
      position: { lineNumber: number; column: number },
    ) => Promise<unknown>;
  };
}> = [];

vi.mock('monaco-editor', () => {
  // Mirror the Monaco 0.52.2 enum values
  // used by the adapter.
  const CompletionItemKind = {
    Text: 0,
    Method: 1,
    Function: 2,
    Constructor: 3,
    Field: 4,
    Variable: 5,
    Class: 6,
    Interface: 7,
    Module: 8,
    Property: 9,
    Event: 10,
    Operator: 11,
    Unit: 12,
    Value: 13,
    Enum: 14,
    Keyword: 15,
    Snippet: 16,
    Color: 17,
    File: 18,
    Reference: 19,
    Folder: 20,
    TypeParameter: 21,
    User: 22,
    Issue: 23,
  } as const;
  // The other provider registrations the
  // adapter makes. We only assert on the
  // `registerCompletionItemProvider` calls
  // (captured in `registeredProviders`); the
  // other registrations are no-op stubs.
  const noopDisposable = { dispose: () => {} };
  const noopProvider = () => noopDisposable;
  return {
    languages: {
      CompletionItemKind,
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
      registerDefinitionProvider: noopProvider,
      registerReferenceProvider: noopProvider,
      registerRenameProvider: noopProvider,
      registerImplementationProvider: noopProvider,
      registerDocumentSymbolProvider: noopProvider,
      registerCodeActionProvider: noopProvider,
      registerHoverProvider: noopProvider,
      registerSignatureHelpProvider: noopProvider,
      registerInlayHintsProvider: noopProvider,
      registerCompletionItemProvider: (
        selector: string[],
        provider: {
          triggerCharacters?: string[];
          provideCompletionItems: (
            model: unknown,
            position: { lineNumber: number; column: number },
          ) => Promise<unknown>;
        },
      ) => {
        registeredProviders.push({ selector, provider });
        return noopDisposable;
      },
    },
    editor: {
      IRange: class {},
    },
  };
});

import * as monaco from 'monaco-editor';

interface LspClientLike {
  request: <T>(method: string, params: unknown) => Promise<T>;
}

function makeFakeClient(
  response: unknown,
  error: Error | null = null,
): { client: LspClientLike; captured: { method: string; params: unknown }[] } {
  const captured: { method: string; params: unknown }[] = [];
  const client: LspClientLike = {
    request: vi.fn(async (method: string, params: unknown) => {
      captured.push({ method, params });
      if (error) throw error;
      return response as never;
    }),
  };
  return { client, captured };
}

function makeFakeModel(text: string): monaco.editor.ITextModel {
  // We only need a few methods. Cast
  // through unknown so the `monaco.editor`
  // namespace doesn't complain about the
  // missing methods (the adapter only
  // touches the few we provide).
  return {
    uri: { toString: () => 'file:///workspace/a/index.ts' },
    getValue: () => text,
    getWordUntilPosition: (position: { lineNumber: number; column: number }) => {
      // The fake model is one line.
      const line = text.split('\n')[position.lineNumber - 1] ?? '';
      const beforeCursor = line.slice(0, position.column - 1);
      const match = beforeCursor.match(/[\w$]*$/);
      const word = match ? match[0] : '';
      const start = position.column - word.length;
      return {
        startColumn: start,
        endColumn: position.column,
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
      };
    },
  } as unknown as monaco.editor.ITextModel;
}

beforeEach(() => {
  registeredProviders.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('lspProviders — completion adapter (Phase 9.6)', () => {
  it('converts a bare-array LSP CompletionItem[] to Monaco suggestions', async () => {
    // Import the module under test AFTER the
    // mocks are installed (vitest hoists
    // `vi.mock`, so the import resolves
    // against the mocks).
    const { registerLspProviders } = await import('./lspProviders');
    const { client } = makeFakeClient([
      {
        label: 'myFunction',
        kind: 3, // Function in LSP
        detail: '(x: number) => string',
        documentation: 'A function',
        insertText: 'myFunction(${1:arg})',
        insertTextFormat: 2, // Snippet
      },
      {
        label: 'myClass',
        kind: 7, // Class in LSP
        insertText: 'myClass',
      },
    ]);
    registerLspProviders(client as never, monaco, ['typescript'], {
      includeCompletion: true,
    });
    expect(registeredProviders).toHaveLength(1);
    const { provider } = registeredProviders[0];
    expect(provider.triggerCharacters).toEqual(['.', '"', "'", '`', '/', '@', '#']);
    const model = makeFakeModel('my');
    const result = (await provider.provideCompletionItems(model, {
      lineNumber: 1,
      column: 3,
    })) as { suggestions: monaco.languages.CompletionItem[] };
    expect(result.suggestions).toHaveLength(2);
    // First item: function with snippet
    // insertTextRules.
    expect(result.suggestions[0].label).toBe('myFunction');
    expect(result.suggestions[0].kind).toBe(
      monaco.languages.CompletionItemKind.Function,
    );
    expect(result.suggestions[0].detail).toBe('(x: number) => string');
    expect(result.suggestions[0].documentation).toBe('A function');
    expect(result.suggestions[0].insertText).toBe('myFunction(${1:arg})');
    expect(result.suggestions[0].insertTextRules).toBe(4);
    // Range: word at position "my" → columns
    // 1-3.
    expect(result.suggestions[0].range).toEqual({
      startLineNumber: 1,
      endLineNumber: 1,
      startColumn: 1,
      endColumn: 3,
    });
    // Second item: class, no snippet, no
    // documentation, no detail.
    expect(result.suggestions[1].label).toBe('myClass');
    expect(result.suggestions[1].kind).toBe(
      monaco.languages.CompletionItemKind.Class,
    );
    expect(result.suggestions[1].insertText).toBe('myClass');
    expect(result.suggestions[1].insertTextRules).toBeUndefined();
  });

  it('handles LSP CompletionList (wrapper) responses', async () => {
    const { registerLspProviders } = await import('./lspProviders');
    const { client } = makeFakeClient({
      isIncomplete: false,
      items: [
        { label: 'foo', kind: 6 /* Variable */, insertText: 'foo' },
        { label: 'bar', kind: 6, insertText: 'bar' },
      ],
    });
    registerLspProviders(client as never, monaco, ['typescript'], {
      includeCompletion: true,
    });
    const { provider } = registeredProviders[0];
    const model = makeFakeModel('');
    const result = (await provider.provideCompletionItems(model, {
      lineNumber: 1,
      column: 1,
    })) as { suggestions: monaco.languages.CompletionItem[] };
    expect(result.suggestions).toHaveLength(2);
    expect(result.suggestions[0].label).toBe('foo');
    expect(result.suggestions[1].label).toBe('bar');
  });

  it('uses textEdit.range when present (overrides word-at-position)', async () => {
    const { registerLspProviders } = await import('./lspProviders');
    const { client } = makeFakeClient([
      {
        label: 'myConst',
        kind: 21, // TypeParameter in LSP (used as a sentinel)
        insertText: 'myConst',
        textEdit: {
          // Range is 0-indexed. We use
          // `fromLspRange` internally to
          // convert to Monaco's 1-indexed
          // range.
          range: {
            start: { line: 0, character: 5 },
            end: { line: 0, character: 7 },
          },
          newText: 'myConst',
        },
      },
    ]);
    registerLspProviders(client as never, monaco, ['typescript'], {
      includeCompletion: true,
    });
    const { provider } = registeredProviders[0];
    const model = makeFakeModel('abc my old text');
    const result = (await provider.provideCompletionItems(model, {
      lineNumber: 1,
      column: 8,
    })) as { suggestions: monaco.languages.CompletionItem[] };
    expect(result.suggestions[0].insertText).toBe('myConst');
    // 0-indexed LSP range (5,7) → 1-indexed
    // Monaco range (6,8).
    expect(result.suggestions[0].range).toEqual({
      startLineNumber: 1,
      endLineNumber: 1,
      startColumn: 6,
      endColumn: 8,
    });
  });

  it('falls back to empty suggestions on null / errors (lets Monaco use the built-in)', async () => {
    const { registerLspProviders } = await import('./lspProviders');
    // Case 1: null response
    const { client: client1 } = makeFakeClient(null);
    registerLspProviders(client1 as never, monaco, ['typescript'], {
      includeCompletion: true,
    });
    const { provider: p1 } = registeredProviders[0];
    const r1 = (await p1.provideCompletionItems(makeFakeModel(''), {
      lineNumber: 1,
      column: 1,
    })) as { suggestions: monaco.languages.CompletionItem[] };
    expect(r1.suggestions).toEqual([]);
    // Case 2: server error
    registeredProviders.length = 0;
    const { client: client2, captured: cap2 } = makeFakeClient(null, new Error('boom'));
    registerLspProviders(client2 as never, monaco, ['typescript'], {
      includeCompletion: true,
    });
    const { provider: p2 } = registeredProviders[0];
    const r2 = (await p2.provideCompletionItems(makeFakeModel(''), {
      lineNumber: 1,
      column: 1,
    })) as { suggestions: monaco.languages.CompletionItem[] };
    expect(r2.suggestions).toEqual([]);
    // The error path still called
    // `client.request` (the throw happens
    // inside the try).
    expect(cap2).toHaveLength(1);
  });

  it('does NOT register the completion provider when includeCompletion is false (default)', async () => {
    const { registerLspProviders } = await import('./lspProviders');
    const { client } = makeFakeClient([]);
    // Default: includeCompletion: undefined →
    // falsy → provider is NOT registered.
    registerLspProviders(client as never, monaco, ['typescript']);
    // The adapter only registered the
    // non-completion providers. We assert
    // by checking the call is rejected
    // (no provider entry was pushed for
    // completion).
    // Note: `registeredProviders` only
    // captures `registerCompletionItemProvider`
    // calls. If the adapter didn't call it,
    // the array is empty.
    expect(registeredProviders).toHaveLength(0);
    // Explicit false also skips.
    registerLspProviders(client as never, monaco, ['typescript'], {
      includeCompletion: false,
    });
    expect(registeredProviders).toHaveLength(0);
  });

  it('maps LSP documentation {kind, value} objects to plain strings for Monaco', async () => {
    const { registerLspProviders } = await import('./lspProviders');
    const { client } = makeFakeClient([
      {
        label: 'foo',
        kind: 6,
        insertText: 'foo',
        documentation: {
          kind: 'markdown',
          value: '**bold** docs',
        },
      },
    ]);
    registerLspProviders(client as never, monaco, ['typescript'], {
      includeCompletion: true,
    });
    const { provider } = registeredProviders[0];
    const result = (await provider.provideCompletionItems(makeFakeModel(''), {
      lineNumber: 1,
      column: 1,
    })) as { suggestions: monaco.languages.CompletionItem[] };
    expect(result.suggestions[0].documentation).toBe('**bold** docs');
  });
});
