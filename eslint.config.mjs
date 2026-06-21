/**
 * ESLint flat config for Lipi.
 *
 * Starts with the `recommended` ruleset (no
 * type-checking). Type-aware rules will be
 * enabled incrementally once the codebase is
 * clean. Run `npx eslint src/` to check,
 * `npx eslint src/ --fix` for auto-fixable issues.
 *
 * CI: `npm run lint`
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Global ignores.
  {
    ignores: [
      'dist/',
      'node_modules/',
      'src-tauri/',
      'scripts/',
      '*.config.*',
      'vitest.setup.ts',
      '.mocks/',
      'website/',
    ],
  },
  // Base JS rules.
  js.configs.recommended,
  // TypeScript rules (non-type-aware for now).
  ...tseslint.configs.recommended,
  // Global linter options.
  {
    linterOptions: {
      // Don't error on `eslint-disable` comments
      // that reference rules not in this config
      // (e.g. `react-hooks/exhaustive-deps` from
      // before ESLint was set up). These will be
      // cleaned up incrementally.
      reportUnusedDisableDirectives: 'off',
    },
  },
  // Project-specific overrides.
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      // Enforce `no-console` — the project uses
      // `@/shared/logger` for production logging.
      'no-console': 'warn',

      // Allow underscore-prefixed unused args.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // Allow `@ts-expect-error` with description.
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description' },
      ],

      // Warn on non-null assertions (controlled usage).
      '@typescript-eslint/no-non-null-assertion': 'warn',

      // The codebase uses `any` in test mocks for
      // deliberately testing invalid inputs. Warn in
      // production code, off in test files.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  // Test files: relaxed rules.
  {
    files: ['src/**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
);
