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
 * ## Phase 9.2e — per-kind kill switch
 *
 * The v1 shape was a single global `useRealServer:
 * boolean`. Phase 9.2e replaces it with a
 * per-kind `useRealServerByKind: Record<LspServerKind,
 * boolean>` so the user can disable, say,
 * `pyright` (e.g. they don't have it installed
 * and the install hint is annoying) without
 * disabling the TS or rust-analyzer servers.
 *
 * The v1 key (`lipi:lsp:useRealServer:v1`) is
 * preserved as a *fallback*. On the first read
 * of `getUseRealServerByKind` after upgrading:
 *   - If the v2 record exists, use it.
 *   - Else if the v1 boolean exists, seed the
 *     v2 record from it (applied to every
 *     supported kind).
 *   - Else default every kind to `true` (the
 *     v1 default).
 *
 * Once the v2 record is seeded, the v1 key is
 * left in place (a future cleanup slice can
 * delete it). New writes only touch the v2
 * key.
 */

import type { LspServerKind } from '@/ipc/lsp';
import { logger } from '@/shared/logger';

/** Master kill switch (Phase 9 v1, now superseded
 *  by the per-kind `useRealServerByKind` v2 record).
 *  Read in `getUseRealServerByKind` for the v1→v2
 *  migration; not written by this module any
 *  more. Kept here so a future cleanup slice can
 *  `localStorage.removeItem('lipi:lsp:useRealServer:v1')`
 *  after detecting a populated v2 record. */
const STORAGE_KEY_V1 = 'lipi:lsp:useRealServer:v1';

/** Phase 9.2e — per-kind kill switch. The value
 *  is a JSON object: `{ "typescript": true,
 *  "rust_analyzer": true, "pyright": false, ... }`.
 *  Kinds that aren't in the record default to
 *  `true` (the v1 default). */
const STORAGE_KEY_V2 = 'lipi:lsp:useRealServerByKind:v1';

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
 * 5-20ms). Users can opt in via the settings card.
 *
 * Phase 9.2e — completion is *not* per-kind. It's a global
 * sub-toggle. If the user enables completion for
 * `typescript`, they get it for every kind they have
 * enabled (rust-analyzer, pyright, etc.) — the
 * per-kind kill switch determines which kinds are
 * enabled at all; the completion sub-toggle determines
 * whether the *enabled* kinds' completion is real-server
 * or built-in. */
const STORAGE_KEY_COMPLETION = 'lipi:lsp:useRealServerForCompletion:v1';

/**
 * Default for the completion sub-toggle. `false` =
 * the real server is NOT used for completion (the
 * faster built-in is). The settings card mirrors
 * this default in its toggle UI.
 */
const DEFAULT_USE_REAL_SERVER_FOR_COMPLETION = false;

/**
 * Read the per-kind kill switch. Returns the
 * persisted value for the requested kind, or the
 * default (`true`) if:
 *   - The runtime has no `localStorage` (SSR,
 *     sandboxed iframes), or
 *   - The v2 record is missing / unreadable / not
 *     an object, or
 *   - The v2 record doesn't have a key for this
 *     kind (a newly added kind defaults to `true`).
 *
 * On the first read after upgrading, if the v2
 * record is missing but the v1 boolean exists,
 * the v2 record is seeded from the v1 value
 * (applied to every kind). After seeding, the v2
 * record is the source of truth.
 */
export function getUseRealServer(kind: LspServerKind): boolean {
  const record = readRecord();
  const value = record[kind];
  if (typeof value === 'boolean') return value;
  return DEFAULT_USE_REAL_SERVER;
}

/**
 * Read the full per-kind record. Returns
 * an empty partial record if the v2 record
 * is missing / unreadable. Kinds not in the
 * returned record default to `true` (the v1
 * default).
 *
 * The return type is `Partial<Record<LspServerKind,
 * boolean>>` (not `Record<LspServerKind,
 * boolean>`) because the record is sparse — a
 * freshly-installed user has *no* v2 record at
 * all, and a user who only flipped the rust-analyzer
 * kind has a record with just one key. Callers that
 * need a full default for every kind should
 * `getUseRealServer(kind)` per-kind instead.
 */
export function getUseRealServerByKind(): Partial<
  Record<LspServerKind, boolean>
> {
  return readRecord();
}

/**
 * Write the per-kind record. Best-effort: failures
 * (Safari private mode, quota exceeded) are
 * non-fatal and logged (DEV).
 *
 * The input is a `Partial` record — callers can
 * pass just the kinds they want to flip and the
 * rest of the v2 record is preserved (the
 * `setUseRealServer(kind, value)` convenience
 * helper does the read-merge-write dance for
 * callers that only want to flip a single kind).
 */
export function setUseRealServerByKind(
  value: Partial<Record<LspServerKind, boolean>>,
): void {
  writeJson(STORAGE_KEY_V2, value, 'useRealServerByKind');
}

/**
 * Convenience: write a single kind's value. Reads
 * the current record, updates the kind, writes
 * back. Idempotent.
 */
export function setUseRealServer(
  kind: LspServerKind,
  value: boolean,
): void {
  const current = readRecord();
  setUseRealServerByKind({ ...current, [kind]: value });
}

/**
 * Internal helper: read the v2 record. On a cold
 * read (v2 missing but v1 present), seed v2 from
 * v1 (one-time migration). The v1 key is left in
 * place; the v2 record is the source of truth
 * going forward.
 */
function readRecord(): Partial<Record<LspServerKind, boolean>> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY_V2);
    if (raw !== null) {
      // Try to parse as a record. We don't
      // validate the contents strictly — any
      // object with boolean-valued keys is
      // accepted. The `getUseRealServer(kind)`
      // accessor coerces non-boolean values to
      // the default at read time.
      const parsed: unknown = JSON.parse(raw);
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed)
      ) {
        return parsed as Partial<Record<LspServerKind, boolean>>;
      }
      // Malformed: fall through to the v1
      // fallback (or the default).
    }
    // v2 missing or malformed — try the v1
    // fallback. We only do the migration
    // *write* if v1 exists, so a cold install
    // (no v1, no v2) doesn't pollute
    // localStorage with a default-valued
    // record.
    const v1Raw = localStorage.getItem(STORAGE_KEY_V1);
    if (v1Raw === 'true' || v1Raw === 'false') {
      const v1Value: boolean = v1Raw === 'true';
      // Seed v2 from v1. Pre-fill every
      // supported kind with the v1 value
      // (the v1 default was global, so the
      // migration applies it to every kind).
      const seeded: Record<LspServerKind, boolean> = {
        typescript: v1Value,
        rust_analyzer: v1Value,
        pyright: v1Value,
        unknown: v1Value,
      };
      // Best-effort write. We *don't* delete
      // the v1 key — a future cleanup slice
      // can prune it. Leaving v1 in place is
      // safe (the next read will see v2
      // populated and skip the migration).
      try {
        localStorage.setItem(
          STORAGE_KEY_V2,
          JSON.stringify(seeded),
        );
      } catch {
        // ignore — the in-memory copy is
        // still returned to the caller.
      }
      return seeded;
    }
    // No v2, no v1 — return an empty record
    // (per-kind default is `true` at the
    // accessor).
    return {};
  } catch {
    // localStorage access threw (e.g. some
    // browsers throw on `getItem` from a
    // sandboxed iframe). Return the empty
    // record; the accessors will use the
    // per-kind default.
    return {};
  }
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
    logger.warn(`[lspKillSwitch] failed to persist ${name}:`, e);
  }
}

/**
 * Internal helper: write a JSON value to
 * `localStorage`. Failures are logged (DEV) but
 * otherwise non-fatal.
 */
function writeJson(
  key: string,
  value: unknown,
  name: string,
): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    logger.warn(`[lspKillSwitch] failed to persist ${name}:`, e);
  }
}
