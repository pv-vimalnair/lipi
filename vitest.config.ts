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
  },
});
