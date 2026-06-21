/**
 * Structured logger — thin wrapper around `console` with level filtering
 * and optional DEV-gating.
 *
 * All production logging in the app should go through this module instead
 * of calling `console.warn` / `console.error` directly. In production
 * builds, `warn` and `debug` are no-ops (the calls are tree-shaken by
 * Vite's `import.meta.env.DEV` dead-code elimination when wrapped in the
 * guard helpers). `error` always logs — it's for real failures that need
 * visibility in production.
 *
 * Usage:
 *   import { logger } from '@/shared/logger';
 *   logger.warn('[themeStore] failed to persist:', e);
 *   logger.error('[terminalStore] subscription failed:', err);
 *
 * The logger is a plain object (not a class) so it can be mocked in tests
 * via `vi.spyOn(logger, 'warn')`.
 */

const IS_DEV = import.meta.env.DEV;

export const logger = {
  /**
   * Debug-level message. Only logs in development; tree-shaken in
   * production builds. Use for verbose diagnostic output that is
   * only useful during development.
   */
  debug(...args: unknown[]): void {
    if (IS_DEV) {
       
      console.debug(...args);
    }
  },

  /**
   * Warning-level message. Only logs in development; tree-shaken in
   * production builds. Use for recoverable issues (persistence
   * failures, hydration fallbacks, IPC unavailability).
   */
  warn(...args: unknown[]): void {
    if (IS_DEV) {
      // eslint-disable-next-line no-console
      console.warn(...args);
    }
  },

  /**
   * Error-level message. Always logs — even in production. Use for
   * real failures that need visibility (render errors, IPC failures
   * that affect user-visible functionality, data corruption).
   */
  error(...args: unknown[]): void {
     
    console.error(...args);
  },
};
