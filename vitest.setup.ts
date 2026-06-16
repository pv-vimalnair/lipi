/**
 * Vitest setup file — runs once per
 * test file before any tests execute.
 *
 * Sets `IS_REACT_ACT_ENVIRONMENT = true`
 * on `globalThis` so React's `act()` and
 * the upcoming `React.act()` know they're
 * running inside a test environment. Without
 * this flag, React logs
 * "The current testing environment is
 * not configured to support act(...)"
 * warnings on every state update wrapped
 * in `act()`.
 *
 * The flag is read at import time, so
 * the assignment must happen before
 * any React import — which is why this
 * lives in a `setupFiles` entry, not in
 * an `it()` / `beforeEach()` block.
 *
 * Per React's docs:
 * https://react.dev/reference/react/act#testing
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Polyfill `CSS.escape` for jsdom. jsdom
 * does not implement the CSSOM escape
 * helpers; the spec'd `CSS.escape` is
 * used by the M6c file-tree scroll
 * rehydrate to safely embed a file
 * path (which may contain special
 * characters like `.` or `\`) inside
 * an attribute selector. The polyfill
 * follows the spec algorithm at
 * https://drafts.csswg.org/cssom/#serialize-an-identifier.
 */
function polyfillCssEscape(value: string): string {
  if (value === '') return '';
  let result = '';
  const length = value.length;
  for (let i = 0; i < length; i++) {
    const charCode = value.charCodeAt(i);
    if (
      charCode === 0x0000 ||
      (charCode >= 0x0001 && charCode <= 0x001f) ||
      charCode === 0x007f ||
      (i === 0 && charCode >= 0x0030 && charCode <= 0x0039) ||
      (i === 1 &&
        charCode >= 0x0030 &&
        charCode <= 0x0039 &&
        value.charCodeAt(0) === 0x002d)
    ) {
      result += `\\${charCode.toString(16)} `;
      continue;
    }
    if (
      (charCode >= 0x0030 && charCode <= 0x0039) ||
      (charCode >= 0x0041 && charCode <= 0x005a) ||
      (charCode >= 0x0061 && charCode <= 0x007a) ||
      charCode === 0x005f
    ) {
      result += value[i];
      continue;
    }
    result += `\\${value[i]}`;
  }
  return result;
}

interface GlobalWithCss {
  CSS?: { escape: (value: string) => string };
}
const g = globalThis as unknown as GlobalWithCss;
if (typeof g.CSS?.escape !== 'function') {
  g.CSS = { escape: polyfillCssEscape };
}
