/**
 * Tests for `fileNameValidation` — the pure
 * helpers that back the #66 polished file-tree
 * context menu's inline name input.
 *
 * Mirrors the project's existing test style
 * (see `useFileTree.test.ts`): pure function,
 * plain `expect`, no React renderer.
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_NAME_LENGTH,
  suggestNewFileName,
  validateFileName,
} from './fileNameValidation';

describe('validateFileName', () => {
  it('accepts a simple lowercase name', () => {
    const r = validateFileName('hello.txt', new Set());
    expect(r).toEqual({ ok: true, name: 'hello.txt' });
  });

  it('trims surrounding whitespace', () => {
    const r = validateFileName('  hello.txt  ', new Set());
    expect(r).toEqual({ ok: true, name: 'hello.txt' });
  });

  it('rejects an empty name', () => {
    const r = validateFileName('', new Set());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/empty/i);
  });

  it('rejects a whitespace-only name', () => {
    const r = validateFileName('   ', new Set());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/empty/i);
  });

  it('rejects "." and ".."', () => {
    expect(validateFileName('.', new Set()).ok).toBe(false);
    expect(validateFileName('..', new Set()).ok).toBe(false);
  });

  it('rejects names containing path separators', () => {
    for (const ch of ['/', '\\']) {
      const r = validateFileName(`a${ch}b`, new Set());
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/\\ \/ : \* \?|control/);
    }
  });

  it('rejects names containing the full set of illegal characters', () => {
    for (const ch of [':', '*', '?', '"', '<', '>', '|', '\u0000']) {
      const r = validateFileName(`a${ch}b`, new Set());
      expect(r.ok).toBe(false);
    }
  });

  it('rejects names longer than MAX_NAME_LENGTH', () => {
    const long = 'a'.repeat(MAX_NAME_LENGTH + 1);
    const r = validateFileName(long, new Set());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/too long/i);
  });

  it('accepts a name at exactly MAX_NAME_LENGTH', () => {
    const at = 'a'.repeat(MAX_NAME_LENGTH);
    const r = validateFileName(at, new Set());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.name.length).toBe(MAX_NAME_LENGTH);
  });

  it('rejects reserved Windows device names (CON, PRN, AUX, NUL)', () => {
    for (const reserved of ['CON', 'PRN', 'AUX', 'NUL']) {
      const r = validateFileName(reserved, new Set());
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/reserved/);
    }
  });

  it('rejects reserved COM/LPT names with extensions', () => {
    const r = validateFileName('COM1.txt', new Set());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/reserved/);
  });

  it('rejects names that already exist (case-sensitive)', () => {
    const r = validateFileName('hello.txt', new Set(['hello.txt']));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/already exists/);
  });

  it('rejects names that already exist (case-insensitive collision)', () => {
    // The probe is lowercase, the existing
    // is mixed-case — Windows would
    // treat these as the same file.
    const r = validateFileName('Hello.TXT', new Set(['HELLO.txt']));
    expect(r.ok).toBe(false);
  });

  it('strips trailing dots and spaces (Windows refuses them)', () => {
    const r = validateFileName('hello.txt...   ', new Set());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.name).toBe('hello.txt');
  });

  it('rejects a name that is only dots/spaces after trimming', () => {
    const r = validateFileName('...   ', new Set());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/dots|spaces/);
  });

  it('accepts a folder name with a dot inside (but not at the end)', () => {
    const r = validateFileName('my.folder', new Set());
    expect(r).toEqual({ ok: true, name: 'my.folder' });
  });
});

describe('suggestNewFileName', () => {
  it('returns "untitled.txt" when nothing collides', () => {
    expect(suggestNewFileName(new Set())).toBe('untitled.txt');
  });

  it('returns "untitled (1).txt" when "untitled.txt" exists', () => {
    expect(suggestNewFileName(new Set(['untitled.txt']))).toBe(
      'untitled (1).txt',
    );
  });

  it('skips to the next free number', () => {
    const taken = new Set(['untitled.txt', 'untitled (1).txt']);
    expect(suggestNewFileName(taken)).toBe('untitled (2).txt');
  });

  it('handles a custom extension', () => {
    expect(suggestNewFileName(new Set(), '.md')).toBe('untitled.md');
  });

  it('handles a custom extension without a leading dot', () => {
    expect(suggestNewFileName(new Set(), 'log')).toBe('untitled.log');
  });

  it('picks the right number when the custom-extension base collides', () => {
    const taken = new Set(['notes.md', 'untitled.md']);
    expect(suggestNewFileName(taken, '.md')).toBe('untitled (1).md');
  });

  it('falls back to a timestamped name after 10k collisions', () => {
    // Build a set of 10k colliding names.
    const taken = new Set<string>();
    taken.add('untitled.txt');
    for (let i = 1; i < 10_000; i++) {
      taken.add(`untitled (${i}).txt`);
    }
    const result = suggestNewFileName(taken);
    // After the 10k cap, we bail out
    // with a `-<timestamp>.txt`
    // name — we don't pin the exact
    // timestamp but we assert it has
    // the bail-out shape.
    expect(result).toMatch(/^untitled-\d+\.txt$/);
  });
});
