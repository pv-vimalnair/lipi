/**
 * buildInlineEditPrompt — the prompt template for
 * the `Cmd+K` inline AI edit flow (Phase 8).
 *
 * This replaces the Phase 5b-5 `buildCmdKPrompt`
 * (kept the same shape — same system prompt, same
 * `Result` type, same validation errors — and just
 * renamed). The function still returns a `Result`
 * rather than throwing so the caller (the new
 * `InlineEditOverlay` component) can surface a
 * friendly inline error without a try/catch. The
 * two failure modes are the same:
 *   - empty selection (defense in depth — the
 *     global Cmd-K handler bails in that case)
 *   - empty instruction (the user submitted
 *     without typing an instruction)
 *
 * Per Rule 3 (screen-folder layout) this lives in
 * `src/screens/EditorWorkspace/components/InlineAi/`
 * — the same folder as the new overlay. The 5b-5
 * file under `AIPanel/` is now dead and will be
 * deleted alongside the modal.
 */

export type BuildInlineEditPromptError =
  | 'empty-selection'
  | 'empty-instruction';

export type BuildInlineEditPromptResult =
  | {
      ok: true;
      systemPrompt: string;
      userMessage: string;
    }
  | {
      ok: false;
      error: BuildInlineEditPromptError;
    };

/**
 * The system prompt. Model-agnostic — OpenAI
 * and Anthropic both honour a system-role
 * message. Kept short and prescriptive ("return
 * ONLY the rewritten text") so the model doesn't
 * add pleasantries that would break the inline
 * edit's "Apply" flow (which expects the raw
 * rewrite as the message body).
 */
const SYSTEM_PROMPT = [
  'You are a precise code and text editor.',
  'The user will give you a block of text and an instruction.',
  'Reply with ONLY the rewritten text \u2014 no preamble, no explanation, no markdown fences.',
  'Preserve the language, indentation, and line endings of the original.',
].join(' ');

/**
 * Build the two-message prompt for the inline
 * edit flow. The selection is embedded in a
 * fenced block so the model can see whitespace
 * exactly; the instruction is on its own line.
 */
export function buildInlineEditPrompt(
  selectionText: string,
  instruction: string,
): BuildInlineEditPromptResult {
  if (!selectionText || !selectionText.trim()) {
    return { ok: false, error: 'empty-selection' };
  }
  if (!instruction || !instruction.trim()) {
    return { ok: false, error: 'empty-instruction' };
  }
  const userMessage = [
    'Original:',
    '```',
    selectionText,
    '```',
    '',
    `Instruction: ${instruction.trim()}`,
    '',
    'Rewritten:',
  ].join('\n');
  return { ok: true, systemPrompt: SYSTEM_PROMPT, userMessage };
}
