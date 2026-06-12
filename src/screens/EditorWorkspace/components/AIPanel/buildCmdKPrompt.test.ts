/**
 * Tests for `buildCmdKPrompt.ts` — the prompt
 * template for the Cmd-K inline edit flow
 * (5b-5).
 *
 * Coverage:
 *   - Happy path: the system prompt includes
 *     the editor-role and the "no preamble"
 *     rules; the user message embeds the
 *     selection (in a fenced block) and the
 *     instruction.
 *   - Empty selection returns an `empty-selection`
 *     error result (no throwing).
 *   - Empty / whitespace-only instruction
 *     returns an `empty-instruction` error
 *     result.
 *   - Whitespace in the selection is preserved
 *     exactly (the fenced block is verbatim).
 */

import { describe, expect, it } from 'vitest';

import { buildCmdKPrompt } from './buildCmdKPrompt';

describe('buildCmdKPrompt (5b-5)', () => {
  it('produces a system prompt with the editor role and the no-preamble rule', () => {
    const r = buildCmdKPrompt('const x = 1;', 'add a JSDoc comment');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.systemPrompt).toMatch(/editor/i);
    expect(r.systemPrompt).toMatch(/ONLY/i);
  });

  it('embeds the selection in a fenced block and the instruction on its own line', () => {
    const r = buildCmdKPrompt(
      'const x = 1;\nconst y = 2;',
      'add a JSDoc comment',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.userMessage).toContain('```');
    expect(r.userMessage).toContain('const x = 1;\nconst y = 2;');
    expect(r.userMessage).toContain('Instruction: add a JSDoc comment');
  });

  it('preserves whitespace in the selection verbatim (the fenced block is literal)', () => {
    const r = buildCmdKPrompt('  indented\n    more indented', 'strip leading whitespace');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The selection sits between the two
    // backticks with the same indentation as
    // the input — no reformatting.
    expect(r.userMessage).toMatch(/```\n  indented\n    more indented\n```/);
  });

  it('rejects an empty selection with empty-selection', () => {
    const r = buildCmdKPrompt('', 'add a JSDoc comment');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('empty-selection');
  });

  it('rejects a whitespace-only selection with empty-selection', () => {
    const r = buildCmdKPrompt('   \n\t  ', 'add a JSDoc comment');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('empty-selection');
  });

  it('rejects an empty instruction with empty-instruction', () => {
    const r = buildCmdKPrompt('const x = 1;', '');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('empty-instruction');
  });

  it('rejects a whitespace-only instruction with empty-instruction', () => {
    const r = buildCmdKPrompt('const x = 1;', '   \n  ');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('empty-instruction');
  });
});
