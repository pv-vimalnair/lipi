/// <reference types="vitest" />
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const SRC_DIR = resolve(fileURLToPath(import.meta.url), '..', 'src');

/**
 * Vitest config — Phase 5b-3.
 *
 * - Uses the jsdom environment for tests
 *   that touch `document` / `window`
 *   (the chat-thread tests in 5b-4+ will).
 * - Mirrors `tsconfig.json`'s `paths` alias
 *   (`@/*` → `src/*`) via `resolve.alias`.
 *   We use `node:path.resolve` instead of
 *   `new URL(..., import.meta.url).pathname`
 *   because the latter produces a
 *   `file://`-prefixed string on Windows
 *   that vite's resolver chokes on.
 * - Globals (`describe`, `it`, `expect`)
 *   are NOT enabled by default — the 5b-3
 *   tests import them explicitly. This
 *   avoids pulling vitest types into the
 *   global scope for non-test code.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': SRC_DIR,
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.{ts,tsx}'],
    // The `IS_REACT_ACT_ENVIRONMENT` global
    // tells React that we're inside an
    // act()-aware test runner. Without
    // this, React logs
    // "The current testing environment is
    // not configured to support act(...)"
    // warnings on every state update.
    // The setting is read at import time,
    // so it has to be set before any React
    // import — which means it has to be
    // set in the config, not in a
    // `setupFiles` script. (Vitest exposes
    // a `setupFiles` option, but the env
    // flag is read earlier than the
    // `setupFiles` hooks fire.)
    setupFiles: ['./vitest.setup.ts'],
  },
});
