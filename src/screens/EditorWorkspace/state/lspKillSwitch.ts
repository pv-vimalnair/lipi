/**
 * Phase 9 — LSP kill switch.
 *
 * The settings card flips this flag, the bridge hook
 * reads it on mount, and the user can fall back to
 * Monaco's Phase 7 built-in TS service if the LSP
 * server isn't installed or the workspace is on a
 * low-memory machine.
 *
 * ## Why a standalone localStorage key (not a Zustand
 *   field)
 *
 * The kill switch is a per-user, per-install setting
 * — it doesn't change while a request is in flight,
 * doesn't interact with the AI store, and doesn't
 * need to be observed by anything except the bridge
 * hook + the settings card. Putting it in a Zustand
 * store (or in `toolSettingsStore` v3) would force
 * a v2→v3 migration on the existing tool-settings
 * persistence layer; the localStorage key is a
 * one-liner read/write with no schema migration.
 *
 * ## Why no migration version on the key
 *
 * The flag is a plain boolean — there is nothing
 * to migrate. A future schema change (e.g.
 * per-workspace rather than global) can move the
 * storage key + add a forward-migration in this
 * module without breaking existing users (the
 * "missing key" path returns the default
 * `useRealServer: true`).
 */

/** Master kill switch (Phase 9): use the real `typescript-language-server`
 * for go-to-def / refs / rename / etc. */
const STORAGE_KEY = 'lipi:lsp:useRealServer:v1';

/**
 * The default value when no entry exists in
 * localStorage. `true` = use the real
 * `typescript-language-server` when available.
 * The settings card mirrors this default in its
 * toggle UI.
 */
const DEFAULT_USE_REAL_SERVER = true;

/** Phase 9.6 sub-toggle: use the real server *also* for
 * `textDocument/completion`. The default is `false` because
 * the real server's 50-200ms round-trip is too slow for the
 * autocomplete hot path (Monaco's built-in TS service is
 * 5-20ms). Users can opt in via the settings card. */
const STORAGE_KEY_COMPLETION = 'lipi:lsp:useRealServerForCompletion:v1';

/**
 * Default for the completion sub-toggle. `false` =
 * the real server is NOT used for completion (the
 * faster built-in is). The settings card mirrors
 * this default in its toggle UI.
 */
const DEFAULT_USE_REAL_SERVER_FOR_COMPLETION = false;

/**
 * Read the master kill switch flag. Returns the
 * persisted value, or the default (`true`) if the
 * key is missing / unreadable / not a boolean.
 */
export function getUseRealServer(): boolean {
  return readBool(STORAGE_KEY, DEFAULT_USE_REAL_SERVER);
}

/**
 * Write the master kill switch flag. Failures (Safari
 * private mode, quota exceeded) are non-fatal —
 * the in-memory value of `getUseRealServer` will
 * be stale until the next successful write.
 */
export function setUseRealServer(value: boolean): void {
  writeBool(STORAGE_KEY, value, 'useRealServer');
}

/**
 * Read the completion sub-toggle flag. Returns the
 * persisted value, or the default (`false`) if the
 * key is missing / unreadable / not a boolean.
 *
 * Independent of the master kill switch: the user
 * can have the master on (real server for go-to-def
 * / etc.) but keep completion on the built-in.
 */
export function getUseRealServerForCompletion(): boolean {
  return readBool(STORAGE_KEY_COMPLETION, DEFAULT_USE_REAL_SERVER_FOR_COMPLETION);
}

/**
 * Write the completion sub-toggle flag. Same
 * best-effort semantics as `setUseRealServer`.
 */
export function setUseRealServerForCompletion(value: boolean): void {
  writeBool(STORAGE_KEY_COMPLETION, value, 'useRealServerForCompletion');
}

/**
 * Internal helper: read a boolean flag from
 * `localStorage` with a default fallback. Returns
 * the default if the runtime has no `localStorage`
 * (SSR, sandboxed iframes) or the value is missing /
 * malformed.
 */
function readBool(key: string, defaultValue: boolean): boolean {
  if (typeof localStorage === 'undefined') return defaultValue;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return defaultValue;
  } catch {
    return defaultValue;
  }
}

/**
 * Internal helper: write a boolean flag to
 * `localStorage`. Failures are logged (DEV) but
 * otherwise non-fatal.
 */
function writeBool(key: string, value: boolean, name: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, value ? 'true' : 'false');
  } catch (e) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn(`[lspKillSwitch] failed to persist ${name}:`, e);
    }
  }
}
