/**
 * buildCmdKPrompt — the prompt template for the
 * `Cmd-K` inline edit flow (5b-5).
 *
 * The user hits Cmd-K with a text selection in
 * the editor. The CmdKModal opens, shows the
 * selection, and asks for an instruction ("add
 * error handling", "convert to async", etc.). On
 * submit, we build a system + user prompt that
 * tells the model: "you are a precise code/text
 * editor, here's the original text and an
 * instruction, reply with ONLY the rewritten
 * text".
 *
 * The returned `systemPrompt` is sent as the
 * first message with `role: 'system'`, and the
 * `userMessage` is sent as the next message
 * with `role: 'user'`. (The aiStore's
 * `send()` accepts a `messages` array — the
 * CmdKModal will splice the system message
 * in.)
 *
 * The function returns a `Result` rather than
 * throwing so the caller can surface a friendly
 * inline error ("Type an instruction first")
 * without a try/catch. The two failure modes
 * are:
 *   - empty selection (the user opened the
 *     modal somehow with no text selected —
 *     shouldn't happen in practice, the global
 *     Cmd-K handler bails in that case, but
 *     defense in depth)
 *   - empty instruction (the user submitted
 *     without typing an instruction)
 */

export type BuildCmdKPromptError =
  | 'empty-selection'
  | 'empty-instruction';

export type BuildCmdKPromptResult =
  | {
      ok: true;
      systemPrompt: string;
      userMessage: string;
    }
  | {
      ok: false;
      error: BuildCmdKPromptError;
    };

/**
 * The system prompt. Model-agnostic — OpenAI
 * and Anthropic both honour a system-role
 * message. Kept short and prescriptive ("return
 * ONLY the rewritten text") so the model doesn't
 * add pleasantries that would break
 * CmdKModal's "Apply" flow (which expects the
 * raw rewrite as the message body).
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
export function buildCmdKPrompt(
  selectionText: string,
  instruction: string,
): BuildCmdKPromptResult {
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
