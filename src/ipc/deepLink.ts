/**
 * Phase I — typed IPC for the `app://lipi.open?path=...`
 * deep-link scheme.
 *
 * The shape of this file mirrors the rest of `@/ipc/*`:
 * typed wrappers over `invoke()` + the Tauri event bus.
 * Components and hooks import from here, never from
 * `@tauri-apps/api/*` directly (Rule 4).
 *
 * Two surfaces:
 *  - `getUserDirs()` reads the platform's home, Documents,
 *    and Desktop directories (Rust `get_user_dirs` command).
 *    The frontend uses this to validate that an incoming
 *    deep-link path actually points at a user-owned location
 *    (security boundary — see Decision #52).
 *  - `onDeepLink(handler)` subscribes to the `lipi://deep-link`
 *    event that the Rust `setup` callback re-emits when the OS
 *    hands the app a URL. The handler receives the raw URL
 *    string (e.g. `"app://lipi.open?path=C%3A%5CUsers%5Cfoo"`).
 *
 * The pure URL → `OpenUrlResult` parsing lives in this file too
 * (the `parseOpenUrl` helper) so the path-validation rules can
 * be unit-tested without a Tauri runtime.
 */
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';

export interface UserDirs {
  /** The user's home dir, canonical form (`%USERPROFILE%` on
   *  Windows, `$HOME` on macOS / Linux). Never null. */
  home: string;
  /** The user's Documents dir, if it exists. */
  documents: string | null;
  /** The user's Desktop dir, if it exists. */
  desktop: string | null;
}

export const DEEP_LINK_EVENT = 'lipi://deep-link';

/** Read the user's home, Documents, and Desktop dirs.
 *  Throws on IPC failure (extremely unlikely — the command
 *  never errors in practice). */
export async function getUserDirs(): Promise<UserDirs> {
  return await invoke<UserDirs>('get_user_dirs');
}

/** Subscribe to incoming `app://lipi.open?path=...` URLs.
 *  Returns an unsubscribe function. Same shape as the
 *  Tauri `listen()` API so callers can compose with the
 *  rest of the event-bus code. */
export async function onDeepLink(
  handler: (rawUrl: string) => void,
): Promise<() => void> {
  const webview = getCurrentWebview();
  const unlisten = await webview.listen<string>(DEEP_LINK_EVENT, (event) => {
    handler(event.payload);
  });
  return unlisten;
}

// ---------------------------------------------------------------------------
// Pure URL parsing + path validation. No Tauri runtime required.
// Exported so the test file can drive the rules directly.
// ---------------------------------------------------------------------------

/** The two reasons a path can be rejected. The friendly
 *  message is generated in the hook (it has the user dirs
 *  in scope and can show a contextual banner). */
export type PathRejectionReason =
  /** The `path` query field is missing, empty, or not a string. */
  | 'missing-path'
  /** The path contains `..` after URL-decoding (path traversal). */
  | 'path-traversal'
  /** The path is not absolute. */
  | 'not-absolute'
  /** The path is not under the user's home / Documents / Desktop. */
  | 'outside-user-dirs'
  /** The path couldn't be URL-decoded (percent-encoded garbage). */
  | 'decode-failed';

export type OpenUrlResult =
  | { kind: 'ok'; path: string }
  | { kind: 'reject'; reason: PathRejectionReason };

/** Parse `app://lipi.open?path=<urlencoded>` and validate the
 *  path against the user's home / Documents / Desktop. Returns
 *  either a validated `path` or a structured rejection reason. */
export function parseOpenUrl(
  rawUrl: string,
  userDirs: UserDirs,
): OpenUrlResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { kind: 'reject', reason: 'missing-path' };
  }

  // Scheme must be `app`. (The plugin already filters, but
  // defense-in-depth: an unfiltered URL with a different scheme
  // would silently pass otherwise.)
  if (url.protocol !== 'app:') {
    return { kind: 'reject', reason: 'missing-path' };
  }

  // The authority can be anything (we don't use it for routing),
  // but we do require a path or query — a bare `app://lipi.open`
  // is a no-op and should be rejected.
  const encodedPath = url.searchParams.get('path');
  if (encodedPath === null || encodedPath === '') {
    return { kind: 'reject', reason: 'missing-path' };
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(encodedPath);
  } catch {
    return { kind: 'reject', reason: 'decode-failed' };
  }

  // Reject path traversal before any further work.
  if (decoded.includes('..')) {
    return { kind: 'reject', reason: 'path-traversal' };
  }

  // Must be absolute (drive letter on Windows, `/` prefix on Unix).
  if (!isAbsolutePath(decoded)) {
    return { kind: 'reject', reason: 'not-absolute' };
  }

  // Normalise: collapse repeated slashes, strip a trailing slash
  // so `C:\foo\` and `C:\foo` compare equal.
  const normalised = normalisePath(decoded);

  // Must be under the user's home (always) or Documents / Desktop
  // (if they exist). The Rust side already returns canonical
  // paths (no symlinks, no `\\?\` prefix), so a case-insensitive
  // startsWith on Windows is safe.
  const allowedRoots: string[] = [userDirs.home];
  if (userDirs.documents) allowedRoots.push(userDirs.documents);
  if (userDirs.desktop) allowedRoots.push(userDirs.desktop);

  const inside = allowedRoots.some((root) =>
    pathStartsWith(normalised, root),
  );
  if (!inside) {
    return { kind: 'reject', reason: 'outside-user-dirs' };
  }

  return { kind: 'ok', path: normalised };
}

function isAbsolutePath(p: string): boolean {
  // Windows: `C:\` or `C:/` or `\\server\share`
  if (/^[A-Za-z]:[\\/]/.test(p)) return true;
  if (p.startsWith('\\\\')) return true;
  // Unix: starts with `/`
  if (p.startsWith('/')) return true;
  return false;
}

function normalisePath(p: string): string {
  // Collapse runs of either separator to a single
  // backslash (so comparison against Windows-style
  // `userDirs` is reliable regardless of the path the
  // OS handed us). Strip a trailing separator but keep
  // the drive root like `C:\`.
  let out = p.replace(/[\\/]+/g, '\\');
  if (out.length > 3 && out.endsWith('\\')) {
    out = out.slice(0, -1);
  }
  return out;
}

/** Case-insensitive startsWith when the root looks
 *  Windows-style (contains a backslash or a drive
 *  letter), case-sensitive elsewhere. The `userDirs` we
 *  get from Rust are canonical (no symlinks, no `\\?\`
 *  prefix), so a straight string compare is reliable. */
function pathStartsWith(path: string, root: string): boolean {
  const normPath = path.replace(/[\\/]+/g, '\\');
  const normRoot = root.replace(/[\\/]+/g, '\\');
  // Drive-letter root (`C:\...`) is always Windows, so
  // case-insensitive compare. A root that has backslashes
  // is also Windows-style.
  if (/^[A-Za-z]:/.test(normRoot) || normRoot.includes('\\')) {
    return normPath.toLowerCase().startsWith(normRoot.toLowerCase());
  }
  return normPath.startsWith(normRoot);
}

/** User-facing one-liner for a rejection reason. The hook
 *  uses this to populate the `WorkspaceStatus.error` banner. */
export function friendlyRejectionReason(reason: PathRejectionReason): string {
  switch (reason) {
    case 'missing-path':
      return 'The deep link did not include a path to open.';
    case 'path-traversal':
      return "The deep link path contained '..' and was rejected for safety.";
    case 'not-absolute':
      return 'The deep link path must be an absolute path.';
    case 'outside-user-dirs':
      return 'The deep link path is outside your Documents, Desktop, or home folder.';
    case 'decode-failed':
      return "The deep link path couldn't be decoded.";
  }
}
