/**
 * Voice commit grammar — Phase M4.
 *
 * The M4 voice command lets the user say
 * "commit ..." into the AIPanel composer and have
 * the transcript parsed into a git commit
 * message. This module is the single source of
 * truth for "is this transcript a commit command,
 * and if so, what's the message?".
 *
 * Why a hand-rolled parser and not an LLM:
 *   - The grammar is small and predictable; the
 *     user expects "commit with message X" to
 *     commit X verbatim. An LLM might reword X,
 *     add context the user didn't ask for, or
 *     decide "this looks like a commit, let me
 *     write a better message" — which is exactly
 *     what we DON'T want for a voice command.
 *   - The parser is fast, offline, and
 *     deterministic. No API key required, no
 *     network round-trip, no surprise costs.
 *   - Tests are pure functions over strings; we
 *     don't need to mock an LLM.
 *
 * Recognised patterns (all case-insensitive,
 * leading/trailing whitespace stripped):
 *
 *   commit with message <msg>       -> { kind: 'commit', message: <msg> }
 *   commit message <msg>           -> { kind: 'commit', message: <msg> }
 *   commit saying <msg>            -> { kind: 'commit', message: <msg> }
 *   commit that says <msg>         -> { kind: 'commit', message: <msg> }
 *   commit all                     -> { kind: 'commit', message: '' }
 *                                       (caller should reject / prompt)
 *   commit                         -> { kind: 'commit', message: '' }
 *                                       (caller should reject / prompt)
 *   <anything else>                -> { kind: 'not-commit' }
 *
 * The "commit" / "commit all" cases resolve to an
 * empty message. The caller (useVoiceCapture's
 * onFinal callback in M4) treats an empty message
 * as a "what should the commit say?" error and
 * surfaces a friendly toast; we don't auto-prompt
 * here because the user might be in a dictation
 * flow where the rest of the utterance is meant
 * for the AI.
 *
 * Filler-word tolerance: STT often emits "um",
 * "uh", and trailing/leading noise. We strip a
 * small set of common fillers from the front of
 * the message. This is a small, conservative
 * normalisation — we don't try to be clever.
 */

export type CommitParseResult =
  | { readonly kind: 'commit'; readonly message: string }
  | { readonly kind: 'not-commit' };

/**
 * Filler words we strip from the START of the
 * message (after the trigger phrase). Lowercase
 * for case-insensitive comparison. We only strip
 * one filler at a time — we don't want to
 * accidentally delete the user's "but" / "so"
 * that starts the actual message.
 */
const FILLER_PREFIXES = [
  'um',
  'uh',
  'uhh',
  'umm',
  'er',
  'ah',
  'like',
  'okay so',
  'ok so',
  'so',
] as const;

/**
 * Trigger phrases. Order matters: we test the
 * longer / more specific patterns first so that
 * "commit with message X" doesn't get swallowed
 * by a prefix-matching "commit X" pattern. The
 * grammar is "the first phrase in this list that
 * matches, wins".
 */
const TRIGGERS: ReadonlyArray<string> = [
  // Multi-word triggers (tested first)
  'commit with message',
  'commit with the message',
  'commit message',
  'commit that says',
  'commit that reads',
  'commit saying',
  // The bare "commit X" prefix is risky — "commit
  // changes" might be a dictation, not a commit.
  // We only match it when the remainder looks
  // message-like (no leading "to" / "the changes" /
  // other non-message phrases). For M4 the
  // simpler and safer choice is: NO bare "commit"
  // prefix — users must say "commit with
  // message" or similar. This is documented in
  // the Settings → Voice → Commands panel.
  //
  // Single-word triggers (tested last)
  'commit all',
  'commit',
];

/**
 * Phrases that are "bare commits" — they have no
 * message body. The caller treats an empty
 * message as a "what should the commit say?"
 * error.
 */
const BARE_TRIGGERS: ReadonlySet<string> = new Set(['commit', 'commit all']);

/**
 * Parse a transcript and return either a commit
 * intent (with the message body) or "this isn't a
 * commit command". Pure function, no side effects.
 *
 * The caller should call this on the FINAL
 * transcript of a recording (not partials — the
 * grammar is too strict for streaming).
 */
export function parseCommitCommand(transcript: string): CommitParseResult {
  const trimmed = transcript.trim();
  if (trimmed.length === 0) return { kind: 'not-commit' };

  const lower = trimmed.toLowerCase();

  for (const phrase of TRIGGERS) {
    // Find the trigger phrase in the lowercased
    // transcript, tolerating internal whitespace
    // runs. We use a regex that allows `phrase`
    // word tokens separated by `\s+` (one or
    // more whitespace characters). The regex
    // matches against `lower` and we cap it at
    // a `^` start so we only match at the
    // beginning of the string.
    //
    // Why a regex and not `startsWith`:
    //   `startsWith('commit with message')` fails
    //   on `'commit  with  message'` (double
    //   spaces). A regex with `\s+` between
    //   tokens matches all common STT noise.
    //
    // Why we don't preserve the regex's matched
    // range as a slice of `lower`: the message
    // body in the original transcript (with its
    // original casing and any newlines) lives in
    // `trimmed`, not `lower`. We compute the
    // offset in `trimmed` by matching the regex
    // AGAINST `trimmed` too — same regex matches
    // both, so the indexOf math is consistent.
    const pattern = '^' + phrase.split(' ').join('\\s+');
    const re = new RegExp(pattern);
    const match = re.exec(lower);
    if (!match) continue;

    // Slice the ORIGINAL transcript (not
    // `lower`) from the end of the match to
    // preserve casing and any newlines in the
    // message body. The `lower` regex gave us
    // the match length; we apply the same
    // length to `trimmed` (they have the same
    // character positions because we only
    // normalised case, not whitespace — and
    // the original `lower = trimmed.toLowerCase()`
    // preserves every character position).
    const remainder = trimmed.slice(match[0].length).trim();
    const cleaned = stripFillerPrefix(remainder);

    if (BARE_TRIGGERS.has(phrase) || cleaned.length === 0) {
      // Bare commit OR the user said e.g.
      // "commit with message" with nothing after.
      // The caller decides what to do with an
      // empty message (we don't auto-prompt
      // because the user might be in a dictation
      // flow).
      return { kind: 'commit', message: '' };
    }
    return { kind: 'commit', message: cleaned };
  }

  return { kind: 'not-commit' };
}

/**
 * Strip a single filler word from the START of
 * the message. Conservative: only exact whole-word
 * matches, only at the start, only one filler.
 * The remaining text is returned with its original
 * casing preserved.
 */
function stripFillerPrefix(text: string): string {
  const lower = text.toLowerCase();
  for (const filler of FILLER_PREFIXES) {
    if (lower === filler) return '';
    if (lower.startsWith(filler + ' ')) {
      return text.slice(filler.length + 1);
    }
    if (lower.startsWith(filler + ', ')) {
      return text.slice(filler.length + 2);
    }
  }
  return text;
}

/**
 * Human-readable description of the grammar, for
 * the Settings → Voice → Commands panel. Each
 * line is a "say this, get this" example. Kept
 * here (not in i18n) because the M4 surface is
 * small and English-only.
 */
export const COMMIT_GRAMMAR_HELP: ReadonlyArray<{ example: string; result: string }> = [
  { example: '"commit with message fix login bug"', result: 'Commit: "fix login bug"' },
  { example: '"commit saying add the new feature"', result: 'Commit: "add the new feature"' },
  { example: '"commit message refactor voice flow"', result: 'Commit: "refactor voice flow"' },
  { example: '"commit"', result: 'Empty message (caller shows "what should the commit say?")' },
];
