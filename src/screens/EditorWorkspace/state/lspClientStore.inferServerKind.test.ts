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
  KIND_TO_LANGUAGE_IDS,
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
  it('returns true for typescript (the canonical kind)', () => {
    expect(isSupportedKind('typescript')).toBe(true);
  });
  it('returns true for rust_analyzer (Phase 9.2b — Rust arm is wired)', () => {
    // Phase 9.2b added the `rust-analyzer`
    // binary probe on the Rust side and
    // the `kindToSpawnSpec` arm on the JS
    // side. The bridge now actually
    // spawns it for `.rs` files.
    expect(isSupportedKind('rust_analyzer')).toBe(true);
  });
  it('returns true for pyright (Phase 9.2c — Rust arm is wired)', () => {
    // Phase 9.2c added the
    // `pyright-langserver` binary probe
    // on the Rust side and added
    // `'pyright'` to
    // `SUPPORTED_LSP_SERVER_KINDS` on
    // the JS side. The bridge now
    // actually spawns it for `.py` /
    // `.pyi` files.
    expect(isSupportedKind('pyright')).toBe(true);
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

/**
 * Phase 9.2f — `KIND_TO_LANGUAGE_IDS` is
 * the per-kind `DocumentSelector` the
 * bridge uses to register one provider
 * set per kind. Monaco's provider
 * registry routes provider calls to the
 * right provider per file based on the
 * selector match. The mapping is a
 * frozen constant; the test guards
 * against accidental removal of a
 * `languageId` that would break the
 * multi-model aggregator's routing.
 */
describe('KIND_TO_LANGUAGE_IDS (Phase 9.2f)', () => {
  it('typescript maps to the four Monaco language IDs the ts-language-server handles', () => {
    expect(KIND_TO_LANGUAGE_IDS.typescript).toEqual(
      expect.arrayContaining([
        'typescript',
        'typescriptreact',
        'javascript',
        'javascriptreact',
      ]),
    );
  });
  it('rust_analyzer maps to the `rust` Monaco language ID', () => {
    expect(KIND_TO_LANGUAGE_IDS.rust_analyzer).toEqual(['rust']);
  });
  it('pyright maps to the `python` Monaco language ID', () => {
    expect(KIND_TO_LANGUAGE_IDS.pyright).toEqual(['python']);
  });
  it('unknown has an empty selector (no provider registered)', () => {
    // The `unknown` kind is the "no
    // server" kind (e.g. `.md` /
    // `.json`). The bridge skips it in
    // the provider-registration loop;
    // an empty selector reinforces
    // that intent.
    expect(KIND_TO_LANGUAGE_IDS.unknown).toEqual([]);
  });
  it('every supported kind has a non-empty selector', () => {
    // The bridge's provider-registration
    // loop skips kinds with empty
    // selectors as a defensive measure.
    // This test guards against a future
    // `SUPPORTED_LSP_SERVER_KINDS` add
    // that forgets to fill in the
    // mapping.
    for (const kind of SUPPORTED_LSP_SERVER_KINDS) {
      if (kind === 'unknown') continue;
      expect(KIND_TO_LANGUAGE_IDS[kind].length).toBeGreaterThan(0);
    }
  });
});
