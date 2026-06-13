/**
 * fileNameValidation — pure helpers for the file-tree's
 * inline name input (Decision #66).
 *
 * Extracted from the React component so the rules
 * ("no empty", "no slashes", "no reserved names",
 * "doesn't already exist") are unit-testable in
 * isolation. The component renders the result; the
 * logic lives here.
 *
 * Why a separate module: a UI input that has to be
 * unit-tested with a React renderer is a slow test
 * surface (jsdom, hooks, refs). Pushing the rules to
 * a pure function lets us cover the matrix in
 * milliseconds with plain `expect(...)` calls.
 */

const INVALID_NAME_CHARS = /[\\/:*?"<>|\u0000]/;

/**
 * A short list of reserved names that
 * would never make sense in the file
 * tree. Windows is the strictest
 * (CON, PRN, AUX, NUL, COM1..COM9,
 * LPT1..LPT9) but we share the list
 * with the POSIX side — a macOS user
 * with a .gitattributes that syncs
 * to a Windows box would hit the
 * same wall.
 */
const RESERVED_WINDOWS_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);

/**
 * Maximum name length. Windows
 * MAX_PATH is 260 but the FILENAME
 * max is 255. POSIX is also 255
 * (NAME_MAX). We share 255 across
 * platforms for consistency.
 */
export const MAX_NAME_LENGTH = 255;

export type NameValidationResult =
  | { ok: true; name: string }
  | { ok: false; reason: string };

/**
 * Validate a user-typed name. Returns
 * a discriminated union: success with
 * the trimmed/cleaned name, or failure
 * with a human-readable reason (which
 * the input renders inline).
 *
 * The rules:
 *   1. Not empty after trim.
 *   2. Not a single dot or double dot
 *      ("." or "..") — those are
 *      filesystem navigation entries,
 *      not real names.
 *   3. No path separators or other
 *      characters illegal on Windows
 *      (the strictest filesystem we
 *      support; POSIX is a strict
 *      subset).
 *   4. Not a reserved Windows device
 *      name.
 *   5. Not in `existingNames` (the
 *      caller is responsible for
 *      case-sensitive vs. case-insensitive
 *      comparison — we keep it
 *      case-insensitive because the
 *      underlying `createFile` /
 *      `renameEntry` IPC calls would
 *      reject a case-only-collision
 *      rename on Windows).
 *   6. Length <= MAX_NAME_LENGTH.
 *
 * Note: we do NOT split the "rename"
 * and "new-file" validation paths —
 * the rules are identical. The
 * `existingNames` list is filtered by
 * the caller (rename excludes the
 * current name; new-file excludes
 * everything in the parent dir).
 */
export function validateFileName(
  input: string,
  existingNames: ReadonlySet<string>,
): NameValidationResult {
  const name = input.trim();
  if (name.length === 0) {
    return { ok: false, reason: 'Name cannot be empty.' };
  }
  if (name === '.' || name === '..') {
    return { ok: false, reason: 'Name cannot be "." or "..".' };
  }
  if (name.length > MAX_NAME_LENGTH) {
    return {
      ok: false,
      reason: `Name is too long (${name.length} > ${MAX_NAME_LENGTH}).`,
    };
  }
  if (INVALID_NAME_CHARS.test(name)) {
    return {
      ok: false,
      reason: 'Name cannot contain \\ / : * ? " < > | or control characters.',
    };
  }
  if (RESERVED_WINDOWS_NAMES.has(name.split('.')[0].toUpperCase())) {
    return {
      ok: false,
      reason: `"${name.split('.')[0]}" is a reserved system name.`,
    };
  }
  // Case-insensitive collision check —
  // Windows is case-insensitive; macOS
  // HFS+ is case-insensitive by default;
  // ext4 is case-sensitive but a sync
  // to a Windows share would collide.
  // We keep the case-insensitive check
  // on all platforms to match the
  // strictest target.
  const probe = name.toLowerCase();
  for (const existing of existingNames) {
    if (existing.toLowerCase() === probe) {
      return {
        ok: false,
        reason: `A file or folder named "${existing}" already exists.`,
      };
    }
  }
  // Trim trailing dots and spaces
  // (Windows refuses to create files
  // whose names end in `.` or space).
  const cleaned = name.replace(/[.\s]+$/, '');
  if (cleaned.length === 0) {
    return {
      ok: false,
      reason: 'Name cannot be only dots or spaces.',
    };
  }
  return { ok: true, name: cleaned };
}

/**
 * Suggest a fresh file name that
 * doesn't collide with `existingNames`.
 * Used for the "New File" inline
 * input: when the user opens the
 * menu, the input is pre-populated
 * with "untitled.txt" — if that
 * already exists, "untitled (1).txt",
 * then "untitled (2).txt", etc.
 *
 * The base is "untitled" and the
 * extension is whatever the caller
 * supplies (default `.txt`). A
 * caller that wants a Markdown
 * file passes `.md`.
 *
 * Exported for testability.
 */
export function suggestNewFileName(
  existingNames: ReadonlySet<string>,
  extension: string = '.txt',
): string {
  const ext = extension.startsWith('.') ? extension : `.${extension}`;
  const base = 'untitled';
  if (!existingNames.has(`${base}${ext}`)) {
    return `${base}${ext}`;
  }
  let i = 1;
  // Hard cap to avoid an infinite loop
  // on a folder with a million
  // "untitled (N).txt" files — at 10k
  // we give up and return the bare
  // "untitled" + the loop count, which
  // the user can edit.
  while (i < 10_000) {
    const candidate = `${base} (${i})${ext}`;
    if (!existingNames.has(candidate)) return candidate;
    i += 1;
  }
  return `${base}-${Date.now()}${ext}`;
}
