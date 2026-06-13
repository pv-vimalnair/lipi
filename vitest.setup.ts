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
