/**
 * Tests for `buildInlineEditPrompt.ts` — the
 * prompt template for the Phase 8 `Cmd+K` inline
 * AI edit flow. Carries over the same coverage
 * from the 5b-5 `buildCmdKPrompt` test file
 * (happy path, whitespace preservation, empty
 * selection + empty instruction rejection) and
 * re-runs it against the renamed function.
 */

import { describe, expect, it } from 'vitest';

import { buildInlineEditPrompt } from './buildInlineEditPrompt';

describe('buildInlineEditPrompt (Phase 8)', () => {
  it('produces a system prompt with the editor role and the no-preamble rule', () => {
    const r = buildInlineEditPrompt(
      'const x = 1;',
      'add a JSDoc comment',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.systemPrompt).toMatch(/editor/i);
    expect(r.systemPrompt).toMatch(/ONLY/i);
  });

  it('embeds the selection in a fenced block and the instruction on its own line', () => {
    const r = buildInlineEditPrompt(
      'const x = 1;\nconst y = 2;',
      'add a JSDoc comment',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.userMessage).toContain('```');
    expect(r.userMessage).toContain('const x = 1;\nconst y = 2;');
    expect(r.userMessage).toContain(
      'Instruction: add a JSDoc comment',
    );
  });

  it('preserves whitespace in the selection verbatim (the fenced block is literal)', () => {
    const r = buildInlineEditPrompt(
      '  indented\n    more indented',
      'strip leading whitespace',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The selection sits between the two
    // backticks with the same indentation as
    // the input — no reformatting.
    expect(r.userMessage).toMatch(
      /```\n {2}indented\n {4}more indented\n```/,
    );
  });

  it('rejects an empty selection with empty-selection', () => {
    const r = buildInlineEditPrompt('', 'add a JSDoc comment');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('empty-selection');
  });

  it('rejects a whitespace-only selection with empty-selection', () => {
    const r = buildInlineEditPrompt('   \n\t  ', 'add a JSDoc comment');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('empty-selection');
  });

  it('rejects an empty instruction with empty-instruction', () => {
    const r = buildInlineEditPrompt('const x = 1;', '');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('empty-instruction');
  });

  it('rejects a whitespace-only instruction with empty-instruction', () => {
    const r = buildInlineEditPrompt('const x = 1;', '   \n  ');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('empty-instruction');
  });
});
