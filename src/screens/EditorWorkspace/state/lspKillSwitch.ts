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
const STORAGE_KEY = 'lipi:lsp:useRealServer:v1';

/**
 * The default value when no entry exists in
 * localStorage. `true` = use the real
 * `typescript-language-server` when available.
 * The settings card mirrors this default in its
 * toggle UI.
 */
const DEFAULT_USE_REAL_SERVER = true;

/**
 * Read the kill switch flag. Returns the persisted
 * value, or the default (`true`) if the key is
 * missing / unreadable / not a boolean.
 */
export function getUseRealServer(): boolean {
  if (typeof localStorage === 'undefined') return DEFAULT_USE_REAL_SERVER;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_USE_REAL_SERVER;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    // Malformed value — fall back to default.
    return DEFAULT_USE_REAL_SERVER;
  } catch {
    return DEFAULT_USE_REAL_SERVER;
  }
}

/**
 * Write the kill switch flag. Failures (Safari
 * private mode, quota exceeded) are non-fatal —
 * the in-memory value of `getUseRealServer` will
 * be stale until the next successful write.
 */
export function setUseRealServer(value: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
  } catch (e) {
    // Best-effort — log to the dev console so a
    // debugging session can see the failure.
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[lspKillSwitch] failed to persist:', e);
    }
  }
}
