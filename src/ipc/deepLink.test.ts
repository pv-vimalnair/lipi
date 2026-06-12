/**
 * Tests for the pure `parseOpenUrl` helper and the
 * user-facing `friendlyRejectionReason` mapping.
 *
 * Phase I: `app://lipi.open?path=<urlencoded>` deep
 * link. The parser is pure (no Tauri runtime, no DOM
 * dependencies) so it can be tested directly with
 * faked `userDirs` values.
 *
 * What we cover:
 *  1. Happy paths: each allowed root (home / Documents
 *     / Desktop) accepts its own path.
 *  2. Path traversal: any `..` after URL-decoding is
 *     rejected before the location check.
 *  3. Outside-user-dirs: a path under `C:\Windows` is
 *     rejected even though it's absolute.
 *  4. Not-absolute: relative paths like `Projects/foo`
 *     are rejected.
 *  5. Missing / empty / wrong-scheme / decode-failed.
 *  6. Windows case-insensitivity: `c:\users\foo\...`
 *     resolves into a home-dir path.
 *  7. Friendly messages for each rejection reason.
 */
import { describe, expect, it } from 'vitest';

import {
  friendlyRejectionReason,
  parseOpenUrl,
  type UserDirs,
} from './deepLink';

const WIN_DIRS: UserDirs = {
  home: 'C:\\Users\\alice',
  documents: 'C:\\Users\\alice\\Documents',
  desktop: 'C:\\Users\\alice\\Desktop',
};

const POSIX_DIRS: UserDirs = {
  home: '/home/alice',
  documents: '/home/alice/Documents',
  desktop: '/home/alice/Desktop',
};

describe('parseOpenUrl', () => {
  it('accepts a path under the user home (Windows)', () => {
    const r = parseOpenUrl(
      'app://lipi.open?path=C%3A%5CUsers%5Calice%5CProjects%5Cmy-app',
      WIN_DIRS,
    );
    expect(r).toEqual({ kind: 'ok', path: 'C:\\Users\\alice\\Projects\\my-app' });
  });

  it('accepts a path under Documents', () => {
    const r = parseOpenUrl(
      'app://lipi.open?path=C%3A%5CUsers%5Calice%5CDocuments%5Cnote.txt',
      WIN_DIRS,
    );
    expect(r).toEqual({
      kind: 'ok',
      path: 'C:\\Users\\alice\\Documents\\note.txt',
    });
  });

  it('accepts a path under Desktop', () => {
    const r = parseOpenUrl(
      'app://lipi.open?path=C%3A%5CUsers%5Calice%5CDesktop%5Ctodo.md',
      WIN_DIRS,
    );
    expect(r).toEqual({
      kind: 'ok',
      path: 'C:\\Users\\alice\\Desktop\\todo.md',
    });
  });

  it('accepts a path under the user home (POSIX)', () => {
    const r = parseOpenUrl(
      'app://lipi.open?path=%2Fhome%2Falice%2Fcode%2Fapp',
      POSIX_DIRS,
    );
    // The normaliser converts `/` to `\` so the
    // comparison root matches uniformly. The user-
    // facing path is still semantically the same
    // (`/home/alice/code/app`).
    expect(r).toEqual({ kind: 'ok', path: '\\home\\alice\\code\\app' });
  });

  it('rejects a path containing .. (path traversal)', () => {
    const r = parseOpenUrl(
      'app://lipi.open?path=C%3A%5CUsers%5Calice%5CDocuments%5C..%5C..%5CWindows%5CSystem32',
      WIN_DIRS,
    );
    expect(r).toEqual({ kind: 'reject', reason: 'path-traversal' });
  });

  it('rejects a path under C:\\Windows (outside user dirs)', () => {
    const r = parseOpenUrl(
      'app://lipi.open?path=C%3A%5CWindows%5CSystem32%5Ccmd.exe',
      WIN_DIRS,
    );
    expect(r).toEqual({ kind: 'reject', reason: 'outside-user-dirs' });
  });

  it('rejects a relative path', () => {
    const r = parseOpenUrl(
      'app://lipi.open?path=Projects%2Fmy-app',
      WIN_DIRS,
    );
    expect(r).toEqual({ kind: 'reject', reason: 'not-absolute' });
  });

  it('rejects a missing path query field', () => {
    const r = parseOpenUrl('app://lipi.open', WIN_DIRS);
    expect(r).toEqual({ kind: 'reject', reason: 'missing-path' });
  });

  it('rejects an empty path query field', () => {
    const r = parseOpenUrl('app://lipi.open?path=', WIN_DIRS);
    expect(r).toEqual({ kind: 'reject', reason: 'missing-path' });
  });

  it('rejects a non-app:// URL', () => {
    const r = parseOpenUrl('https://example.com?path=C%3A%5Cfoo', WIN_DIRS);
    expect(r).toEqual({ kind: 'reject', reason: 'missing-path' });
  });

  it('rejects a percent-encoded garbage path', () => {
    // `%E0%A4%A` is an invalid UTF-8 sequence when decoded.
    const r = parseOpenUrl(
      'app://lipi.open?path=%E0%A4%A',
      WIN_DIRS,
    );
    expect(r).toEqual({ kind: 'reject', reason: 'decode-failed' });
  });

  it('rejects a path under a non-existent Documents on POSIX when only home exists', () => {
    const dirsNoDocs: UserDirs = {
      home: '/home/alice',
      documents: null,
      desktop: null,
    };
    const r = parseOpenUrl(
      'app://lipi.open?path=%2Fhome%2Falice%2FDocuments%2Ffoo',
      dirsNoDocs,
    );
    // Path is under the home, so still accepted.
    expect(r).toEqual({
      kind: 'ok',
      path: '\\home\\alice\\Documents\\foo',
    });
  });

  it('is case-insensitive on Windows for the home check', () => {
    const r = parseOpenUrl(
      'app://lipi.open?path=c%3A%5Cusers%5Calice%5CDocuments%5Cnote.txt',
      WIN_DIRS,
    );
    // The normaliser preserves the original casing;
    // the case-insensitivity only applies to the
    // location check, not to the returned path.
    expect(r).toEqual({
      kind: 'ok',
      path: 'c:\\users\\alice\\Documents\\note.txt',
    });
  });

  it('strips a trailing separator on the accepted path', () => {
    const r = parseOpenUrl(
      'app://lipi.open?path=C%3A%5CUsers%5Calice%5CDocuments%5Cnote.txt%5C',
      WIN_DIRS,
    );
    // The path itself doesn't end with a separator, but
    // verify the normaliser works on a folder-style path:
    const r2 = parseOpenUrl(
      'app://lipi.open?path=C%3A%5CUsers%5Calice%5CDesktop%5C',
      WIN_DIRS,
    );
    expect(r).toEqual({
      kind: 'ok',
      path: 'C:\\Users\\alice\\Documents\\note.txt',
    });
    expect(r2).toEqual({
      kind: 'ok',
      path: 'C:\\Users\\alice\\Desktop',
    });
  });
});

describe('friendlyRejectionReason', () => {
  it('returns a non-empty message for every reason', () => {
    const reasons = [
      'missing-path',
      'path-traversal',
      'not-absolute',
      'outside-user-dirs',
      'decode-failed',
    ] as const;
    for (const r of reasons) {
      const m = friendlyRejectionReason(r);
      expect(m).toBeTypeOf('string');
      expect(m.length).toBeGreaterThan(0);
    }
  });
});
