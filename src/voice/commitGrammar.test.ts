/**
 * commitGrammar — tests.
 *
 * Pure function, table-driven tests. We don't need
 * a render or DOM; just the parser.
 */

import { describe, expect, it } from 'vitest';
import { parseCommitCommand } from './commitGrammar';

describe('parseCommitCommand', () => {
  describe('recognised triggers', () => {
    it('parses "commit with message X" -> commit X', () => {
      expect(parseCommitCommand('commit with message fix login bug')).toEqual({
        kind: 'commit',
        message: 'fix login bug',
      });
    });

    it('parses "commit with the message X" -> commit X', () => {
      expect(parseCommitCommand('commit with the message add dark mode')).toEqual({
        kind: 'commit',
        message: 'add dark mode',
      });
    });

    it('parses "commit message X" -> commit X', () => {
      expect(parseCommitCommand('commit message refactor voice flow')).toEqual({
        kind: 'commit',
        message: 'refactor voice flow',
      });
    });

    it('parses "commit that says X" -> commit X', () => {
      expect(parseCommitCommand('commit that says bump version to 1.0')).toEqual({
        kind: 'commit',
        message: 'bump version to 1.0',
      });
    });

    it('parses "commit that reads X" -> commit X', () => {
      expect(parseCommitCommand('commit that reads initial commit')).toEqual({
        kind: 'commit',
        message: 'initial commit',
      });
    });

    it('parses "commit saying X" -> commit X', () => {
      expect(parseCommitCommand('commit saying add the new feature')).toEqual({
        kind: 'commit',
        message: 'add the new feature',
      });
    });
  });

  describe('case insensitivity', () => {
    it('handles uppercase "COMMIT WITH MESSAGE X"', () => {
      expect(parseCommitCommand('COMMIT WITH MESSAGE foo bar')).toEqual({
        kind: 'commit',
        message: 'foo bar',
      });
    });

    it('handles mixed case "Commit With Message X"', () => {
      expect(parseCommitCommand('Commit With Message foo bar')).toEqual({
        kind: 'commit',
        message: 'foo bar',
      });
    });
  });

  describe('whitespace tolerance', () => {
    it('trims leading whitespace', () => {
      expect(parseCommitCommand('   commit with message hello')).toEqual({
        kind: 'commit',
        message: 'hello',
      });
    });

    it('trims trailing whitespace', () => {
      expect(parseCommitCommand('commit with message hello   ')).toEqual({
        kind: 'commit',
        message: 'hello',
      });
    });

    it('handles extra spaces between trigger words', () => {
      expect(parseCommitCommand('commit  with  message  foo')).toEqual({
        kind: 'commit',
        message: 'foo',
      });
    });
  });

  describe('filler words', () => {
    it('strips leading "um"', () => {
      expect(parseCommitCommand('commit with message um fix the bug')).toEqual({
        kind: 'commit',
        message: 'fix the bug',
      });
    });

    it('strips leading "uh"', () => {
      expect(parseCommitCommand('commit message uh add tests')).toEqual({
        kind: 'commit',
        message: 'add tests',
      });
    });

    it('strips leading "so"', () => {
      expect(parseCommitCommand('commit saying so bump version')).toEqual({
        kind: 'commit',
        message: 'bump version',
      });
    });

    it('strips leading "okay so"', () => {
      expect(parseCommitCommand('commit with message okay so fix the bug')).toEqual({
        kind: 'commit',
        message: 'fix the bug',
      });
    });
  });

  describe('casing preservation in message', () => {
    it('preserves a proper noun in the message', () => {
      // "LipI" should be preserved; only the
      // trigger phrase is lowercased for matching.
      expect(parseCommitCommand('commit with message add LipI support')).toEqual({
        kind: 'commit',
        message: 'add LipI support',
      });
    });

    it('preserves an acronym in the message', () => {
      expect(parseCommitCommand('commit message use API v2')).toEqual({
        kind: 'commit',
        message: 'use API v2',
      });
    });
  });

  describe('bare commit', () => {
    it('"commit" -> empty message (caller decides)', () => {
      expect(parseCommitCommand('commit')).toEqual({
        kind: 'commit',
        message: '',
      });
    });

    it('"commit all" -> empty message (caller decides)', () => {
      expect(parseCommitCommand('commit all')).toEqual({
        kind: 'commit',
        message: '',
      });
    });

    it('"commit with message" (no body) -> empty message', () => {
      expect(parseCommitCommand('commit with message')).toEqual({
        kind: 'commit',
        message: '',
      });
    });
  });

  describe('non-commit utterances', () => {
    it('returns not-commit for plain dictation', () => {
      expect(parseCommitCommand('fix the login bug please')).toEqual({
        kind: 'not-commit',
      });
    });

    it('returns not-commit for AI chat', () => {
      expect(parseCommitCommand('explain how the voice flow works')).toEqual({
        kind: 'not-commit',
      });
    });

    it('returns not-commit for empty string', () => {
      expect(parseCommitCommand('')).toEqual({ kind: 'not-commit' });
    });

    it('returns not-commit for whitespace-only', () => {
      expect(parseCommitCommand('   ')).toEqual({ kind: 'not-commit' });
    });

    it('does not match "commit" as a substring in dictation', () => {
      // "they commit to the plan" is dictation, not a command
      expect(parseCommitCommand('they commit to the plan')).toEqual({
        kind: 'not-commit',
      });
    });
  });

  describe('multi-line messages', () => {
    it('preserves internal newlines in the message', () => {
      // The STT may emit real newlines if the
      // user pauses between lines. We accept
      // them and pass them through to git commit
      // (git allows multi-line commit messages
      // via -m <msg>).
      const result = parseCommitCommand(
        'commit with message subject line\n\nbody line one\nbody line two',
      );
      expect(result.kind).toBe('commit');
      if (result.kind === 'commit') {
        expect(result.message).toBe('subject line\n\nbody line one\nbody line two');
      }
    });
  });
});
