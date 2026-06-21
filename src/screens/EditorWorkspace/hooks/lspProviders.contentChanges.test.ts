/**
 * Phase 9.1 — `convertContentChanges` unit tests.
 *
 * The helper is a pure function: it takes Monaco's
 * `IModelContentChange[]` payload and converts
 * each change to a ranged LSP
 * `TextDocumentContentChangeEvent`. No Monaco
 * runtime, no LSP client, no IPC — just a
 * per-change shape transform.
 *
 * ## Why we don't need to mock `monaco-editor`
 *
 * The helper only uses Monaco *types*
 * (`IModelContentChange`, `IRange`). The test
 * inputs are plain object literals cast to
 * the types. We `import type` for the type
 * aliases (so the test compiles) and never
 * touch the runtime — no `vi.mock` needed.
 */
import { describe, expect, it } from 'vitest';
import type * as monaco from 'monaco-editor';
import { convertContentChanges } from './lspProviders';

// Cast helper so the test inputs read as
// plain object literals without a noisy
// `as` everywhere.
type Change = monaco.editor.IModelContentChange;
const change = (c: {
  range: monaco.IRange;
  rangeLength: number;
  text: string;
}): Change => c as unknown as Change;

describe('convertContentChanges', () => {
  it('converts a single character insert', () => {
    // Typing "x" at line 3, col 5 of an
    // existing file: range is a single point
    // (start == end), text is "x".
    const result = convertContentChanges([
      change({
        range: {
          startLineNumber: 3,
          startColumn: 5,
          endLineNumber: 3,
          endColumn: 5,
        },
        rangeLength: 0,
        text: 'x',
      }),
    ]);
    expect(result).toEqual([
      {
        range: {
          start: { line: 2, character: 4 },
          end: { line: 2, character: 4 },
        },
        rangeLength: 0,
        text: 'x',
      },
    ]);
  });

  it('converts a single character delete (range is non-empty, text is empty)', () => {
    // Selecting "x" at line 3, cols 5-6 and
    // hitting Backspace: range covers the
    // character, text is "".
    const result = convertContentChanges([
      change({
        range: {
          startLineNumber: 3,
          startColumn: 5,
          endLineNumber: 3,
          endColumn: 6,
        },
        rangeLength: 1,
        text: '',
      }),
    ]);
    expect(result).toEqual([
      {
        range: {
          start: { line: 2, character: 4 },
          end: { line: 2, character: 5 },
        },
        rangeLength: 1,
        text: '',
      },
    ]);
  });

  it('converts a range replace (selection typed over)', () => {
    // Select "foo" (cols 5-8) and type "bar".
    const result = convertContentChanges([
      change({
        range: {
          startLineNumber: 1,
          startColumn: 5,
          endLineNumber: 1,
          endColumn: 8,
        },
        rangeLength: 3,
        text: 'bar',
      }),
    ]);
    expect(result).toEqual([
      {
        range: {
          start: { line: 0, character: 4 },
          end: { line: 0, character: 7 },
        },
        rangeLength: 3,
        text: 'bar',
      },
    ]);
  });

  it('converts a multi-line paste (range is a point, text contains newlines)', () => {
    // Paste 3 lines at the start of line 2.
    // The text is "line 1\nline 2\nline 3\n".
    const result = convertContentChanges([
      change({
        range: {
          startLineNumber: 2,
          startColumn: 1,
          endLineNumber: 2,
          endColumn: 1,
        },
        rangeLength: 0,
        text: 'line 1\nline 2\nline 3\n',
      }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('line 1\nline 2\nline 3\n');
    // Range is a single point (the paste
    // position), LSP-legal. The server
    // expands it to 3 new lines.
    expect(result[0].range).toEqual({
      start: { line: 1, character: 0 },
      end: { line: 1, character: 0 },
    });
  });

  it('forwards multi-change events as multiple LSP changes (in order)', () => {
    // Monaco batches changes (e.g. a
    // formatter that rewrites 2 regions at
    // once). We forward each as its own
    // change, in the same order.
    const result = convertContentChanges([
      change({
        range: {
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 1,
          endColumn: 5,
        },
        rangeLength: 4,
        text: 'AAAA',
      }),
      change({
        range: {
          startLineNumber: 5,
          startColumn: 1,
          endLineNumber: 5,
          endColumn: 5,
        },
        rangeLength: 4,
        text: 'BBBB',
      }),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('AAAA');
    expect(result[0].range).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 0, character: 4 },
    });
    expect(result[1].text).toBe('BBBB');
    expect(result[1].range).toEqual({
      start: { line: 4, character: 0 },
      end: { line: 4, character: 4 },
    });
  });

  it('forwards an empty change list as an empty array', () => {
    // Monaco can fire with `changes: []` in
    // edge cases (e.g. an undo that
    // re-produces the same text). We
    // forward an empty array — the spec
    // doesn't forbid it; the server treats
    // it as a no-op.
    const result = convertContentChanges([]);
    expect(result).toEqual([]);
  });

  it('forwards a full-document replace as a single range covering the whole document', () => {
    // A `model.setValue("new content")` from
    // undo/redo or a model swap comes
    // through as a single change with range
    // = (1,1)-(lineCount+1, 1) and
    // text = "new content". We forward as-is
    // — it's still an incremental change
    // (the spec accepts any range), just
    // one that happens to cover the whole
    // document.
    const result = convertContentChanges([
      change({
        range: {
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 10,
          endColumn: 1,
        },
        rangeLength: 50,
        text: 'new content',
      }),
    ]);
    expect(result).toEqual([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 9, character: 0 },
        },
        rangeLength: 50,
        text: 'new content',
      },
    ]);
  });

  it('preserves UTF-16 surrogate pairs in `text` (no length conversion)', () => {
    // LSP `text` is a UTF-16 string; `rangeLength`
    // is in UTF-16 code units. Monaco's
    // `rangeLength` is also in code units. We
    // forward verbatim — the helper does no
    // string manipulation that could split a
    // surrogate pair.
    const emoji = '😀'; // U+1F600 — 2 UTF-16 code units (surrogate pair)
    const result = convertContentChanges([
      change({
        range: {
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 1,
          endColumn: 1,
        },
        rangeLength: 0,
        text: emoji,
      }),
    ]);
    expect(result[0].text).toBe(emoji);
    // Length is 0 (insertion, not replacement).
    expect(result[0].rangeLength).toBe(0);
  });

  it('preserves tab characters and CRLF line endings in `text`', () => {
    // `\t` and `\r\n` are 1 and 2 code units
    // respectively; the spec counts both.
    const result = convertContentChanges([
      change({
        range: {
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 1,
          endColumn: 1,
        },
        rangeLength: 0,
        text: 'a\tb\r\nc',
      }),
    ]);
    expect(result[0].text).toBe('a\tb\r\nc');
  });

  it('does not mutate the input array', () => {
    const input: Change[] = [
      change({
        range: {
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 1,
          endColumn: 2,
        },
        rangeLength: 1,
        text: 'x',
      }),
    ];
    const before = JSON.stringify(input);
    convertContentChanges(input);
    const after = JSON.stringify(input);
    expect(after).toBe(before);
  });

  it('returns a new array (not the same reference) so React/Zustand subscribers see a new object', () => {
    // The bridge's `didChange` flow does
    // NOT use this array as a state value
    // (the wire payload is plain JSON), but
    // returning a new array is a good
    // contract for "pure function" callers.
    const input: Change[] = [
      change({
        range: {
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 1,
          endColumn: 1,
        },
        rangeLength: 0,
        text: 'a',
      }),
    ];
    const out = convertContentChanges(input);
    expect(out).not.toBe(input);
  });
});
