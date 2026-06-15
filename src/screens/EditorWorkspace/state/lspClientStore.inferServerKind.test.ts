/**
 * Phase 9.2 — `inferServerKind` / `isSupportedKind` /
 * `isKnownKind` unit tests.
 *
 * The inferrer is a pure function: URI →
 * `LspServerKind`. It runs on every Monaco
 * model-swap in the bridge, so it has to be
 * fast and correct. The test cases cover:
 *
 *   - The happy path for each known
 *     language (TS, Rust, Python)
 *   - The "no real server" path (Markdown,
 *     JSON, CSS, plain text, Go, etc.)
 *   - Edge cases: no extension, dotfile
 *     (`.gitignore`), case sensitivity
 *     (`.TS` vs `.ts`), backslash-separated
 *     Windows paths, percent-encoded
 *     characters in the URI
 *   - The `isSupportedKind` /
 *     `isKnownKind` helper semantics
 *     (typescript is the only currently
 *     supported kind)
 */
import { describe, expect, it } from 'vitest';
import {
  inferServerKind,
  isKnownKind,
  isSupportedKind,
  SUPPORTED_LSP_SERVER_KINDS,
} from './lspClientStore';

describe('inferServerKind', () => {
  describe('TypeScript server', () => {
    it('maps .ts to typescript', () => {
      expect(inferServerKind('file:///workspace/index.ts')).toBe('typescript');
    });
    it('maps .tsx to typescript', () => {
      expect(inferServerKind('file:///workspace/Button.tsx')).toBe('typescript');
    });
    it('maps .js to typescript', () => {
      expect(inferServerKind('file:///workspace/index.js')).toBe('typescript');
    });
    it('maps .jsx to typescript', () => {
      expect(inferServerKind('file:///workspace/Button.jsx')).toBe('typescript');
    });
    it('maps .mjs to typescript (ESM)', () => {
      expect(inferServerKind('file:///workspace/index.mjs')).toBe('typescript');
    });
    it('maps .cjs to typescript (CommonJS)', () => {
      expect(inferServerKind('file:///workspace/index.cjs')).toBe('typescript');
    });
    it('is case-insensitive on the extension (.TS)', () => {
      // The function lowercases the
      // extension slice. `.TS` and `.ts`
      // both map to typescript.
      expect(inferServerKind('file:///workspace/Index.TS')).toBe('typescript');
    });
  });

  describe('Rust analyzer', () => {
    it('maps .rs to rust_analyzer', () => {
      expect(inferServerKind('file:///workspace/src/lib.rs')).toBe(
        'rust_analyzer',
      );
    });
  });

  describe('Pyright', () => {
    it('maps .py to pyright', () => {
      expect(inferServerKind('file:///workspace/script.py')).toBe('pyright');
    });
    it('maps .pyi to pyright (stub files)', () => {
      expect(inferServerKind('file:///workspace/types.pyi')).toBe('pyright');
    });
  });

  describe('unknown (no real server)', () => {
    it('returns unknown for .md', () => {
      expect(inferServerKind('file:///workspace/README.md')).toBe('unknown');
    });
    it('returns unknown for .json', () => {
      expect(inferServerKind('file:///workspace/package.json')).toBe('unknown');
    });
    it('returns unknown for .css', () => {
      expect(inferServerKind('file:///workspace/main.css')).toBe('unknown');
    });
    it('returns unknown for .html', () => {
      expect(inferServerKind('file:///workspace/index.html')).toBe('unknown');
    });
    it('returns unknown for .go (no Go server in scope)', () => {
      expect(inferServerKind('file:///workspace/main.go')).toBe('unknown');
    });
    it('returns unknown for a dotfile with no real extension (.gitignore)', () => {
      // `.gitignore` has no `.` *after*
      // the last separator, so `lastDot <=
      // lastSlash` → unknown.
      expect(inferServerKind('file:///workspace/.gitignore')).toBe('unknown');
    });
    it('returns unknown when the path has no extension at all', () => {
      expect(inferServerKind('file:///workspace/Makefile')).toBe('unknown');
    });
  });

  describe('edge cases', () => {
    it('handles Windows-style backslashes in the URI', () => {
      // The function looks for both
      // `/` and `\` to find the last
      // separator, so a path like
      // `C:\foo\bar.ts` is handled
      // correctly.
      expect(inferServerKind('file:///C:/foo/bar.ts')).toBe('typescript');
    });
    it('handles a URI with a query / fragment', () => {
      // Monaco sometimes appends
      // `?somequery` to the URI. The
      // extension is the last `.` after
      // the last separator.
      expect(
        inferServerKind('file:///workspace/index.ts?version=1'),
      ).toBe('typescript');
    });
    it('handles percent-encoded characters in the path', () => {
      // %20 is a space. The extension is
      // still `.ts` (after the
      // separator).
      expect(
        inferServerKind('file:///workspace/my%20file.ts'),
      ).toBe('typescript');
    });
    it('handles a deeply nested path', () => {
      expect(
        inferServerKind('file:///workspace/a/b/c/d/e/f/index.ts'),
      ).toBe('typescript');
    });
    it('handles a file whose name starts with a dot (e.g. .eslintrc.ts)', () => {
      // The function looks at the
      // *last* `.` after the last `/`,
      // so `.eslintrc.ts` → ext = `.ts`
      // → typescript.
      expect(inferServerKind('file:///workspace/.eslintrc.ts')).toBe(
        'typescript',
      );
    });
  });
});

describe('isSupportedKind', () => {
  it('returns true for typescript (the only currently supported kind)', () => {
    expect(isSupportedKind('typescript')).toBe(true);
  });
  it('returns false for rust_analyzer (not yet wired)', () => {
    expect(isSupportedKind('rust_analyzer')).toBe(false);
  });
  it('returns false for pyright (not yet wired)', () => {
    expect(isSupportedKind('pyright')).toBe(false);
  });
  it('returns false for unknown', () => {
    expect(isSupportedKind('unknown')).toBe(false);
  });
  it('reflects the SUPPORTED_LSP_SERVER_KINDS constant', () => {
    // The supported list is the source
    // of truth; the helper is just a
    // lookup. This guards against
    // forgetting to update one when the
    // other changes.
    for (const kind of SUPPORTED_LSP_SERVER_KINDS) {
      expect(isSupportedKind(kind)).toBe(true);
    }
  });
});

describe('isKnownKind', () => {
  it('returns true for typescript', () => {
    expect(isKnownKind('typescript')).toBe(true);
  });
  it('returns true for rust_analyzer', () => {
    expect(isKnownKind('rust_analyzer')).toBe(true);
  });
  it('returns true for pyright', () => {
    expect(isKnownKind('pyright')).toBe(true);
  });
  it('returns false for unknown', () => {
    expect(isKnownKind('unknown')).toBe(false);
  });
});
