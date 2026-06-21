/**
 * toolDecisionLogStore — the persistent log
 * of every `[Deny] / [Run once] / [Always
 * allow]` click the user makes on a
 * custom-tool confirmation modal (5e).
 *
 * This is an OBSERVATIONAL log — it has no
 * effect on tool execution. The store is
 * separate from `toolSettingsStore` (which
 * holds the user's policies) and
 * `aiStore` (which owns the runtime state)
 * for two reasons:
 *   1. **Different concern**: settings are
 *      preferences; the log is a history.
 *      Conflating them would force
 *      `clearMessages`-style "wipe
 *      everything" to be careful about
 *      preserving policies.
 *   2. **Different access patterns**:
 *      settings are read on every tool
 *      call; the log is read only when the
 *      user opens the Settings screen.
 *      Keeping them separate lets the
 *      hot path (tool execution) stay
 *      lean.
 *
 * ## Storage
 *
 * Persisted to localStorage under
 * `lipi:toolDecisionLog:v1`. We use a
 * `subscribe` (NOT Zustand `persist`
 * middleware) so the format is versioned
 * and the hydration is explicit. The
 * "v1" suffix gives us an upgrade path —
 * a future v2 can detect a missing key,
 * fall back to defaults, and migrate.
 *
 * Persistence is a "best effort" —
 * failures (Safari private mode, quota
 * exceeded) are caught and logged to
 * `console.warn`. The in-memory state
 * still works; the log just doesn't
 * survive a page reload.
 *
 * ## Capacity
 *
 * The log is bounded to **500 entries**
 * (Phase 5e — locked per user call).
 * When a new entry pushes the count over
 * 500, the OLDEST entry is dropped
 * (ring-buffer semantics). This caps the
 * worst-case localStorage usage at ~1MB
 * (each entry is typically 200-500 bytes
 * after args truncation). Bumping the cap
 * is a one-line constant change in 5e+;
 * we deliberately ship the lower value
 * to keep the localStorage footprint
 * modest for users on tight quotas.
 *
 * ## Args preview
 *
 * Tool arguments are truncated to 2KB
 * before being recorded. Tool args are
 * typically 100-200 bytes; 2KB is
 * 10x headroom and bounds worst-case
 * storage. The full args are still in
 * the live `pendingConfirmation` until
 * the user clicks; we record the
 * truncated preview for history, not the
 * raw value.
 *
 * ## What is NOT recorded
 *
 * - The result of a tool call (output
 *   text, exit code, duration) — that's
 *   already in the chat thread (5b-6)
 *   and the tool trace.
 * - Stale decisions (the resolver bailed
 *   because the requestId was stale) —
 *   nothing actually happened, so
 *   nothing to log.
 * - Disabled tools (the AI store refuses
 *   to execute them — no decision to
 *   record).
 *
 * ## Thread safety
 *
 * Single-threaded JS. The store is the
 * only writer; the Settings screen is
 * the only reader. No mutexes needed.
 */

import { create } from 'zustand';
import { logger } from '@/shared/logger';

const STORAGE_KEY = 'lipi:toolDecisionLog:v1';

/** Maximum number of decision records
 *  kept in the log. Older entries are
 *  dropped on overflow. */
export const DECISION_LOG_CAPACITY = 500;

/** Maximum number of bytes in a single
 *  record's `argsPreview`. Tool args
 *  larger than this are truncated with a
 *  trailing `…(truncated)`. */
export const ARGS_PREVIEW_MAX_BYTES = 2 * 1024;

/** A single tool-call decision event.
 *  Immutable once written — the log
 *  is append-only (the only mutation
 *  is `clearLog`, which wipes the whole
 *  list). */
export interface DecisionRecord {
  /** Stable id, used as the React key
   *  when rendering the log. We use
   *  `crypto.randomUUID()` which is
   *  available in modern browsers and
   *  Tauri webviews; for tests we
   *  accept any string. */
  id: string;
  /** Wall-clock time the decision was
   *  recorded, in ms since epoch. */
  timestamp: number;
  /** The tool's `name` (e.g.
   *  `'run_npm_test'`). Stored as a
   *  plain string for fast filtering
   *  via `getRecentForTool`. */
  toolName: string;
  /** The user's choice. 5g adds
   *  the 4th value `'revert'` for
   *  the inline-Undo action on
   *  an `allow_always` row: the
   *  user reverts a previous
   *  Always-allow policy, so
   *  the tool falls back to
   *  per-call confirmation. The
   *  record carries the
   *  `toolName` (no tool call
   *  id) so we use a
   *  well-known sentinel
   *  `requestId` and
   *  `assistantMessageId` (see
   *  the SettingsProvider code
   *  that creates the revert
   *  record). */
  decision: 'deny' | 'allow_once' | 'allow_always' | 'revert';
  /** Truncated JSON of the parsed args
   *  (max `ARGS_PREVIEW_MAX_BYTES`).
   *  Pre-truncated at write time so
   *  the storage layer doesn't have to
   *  know about byte limits. */
  argsPreview: string;
  /** The chat-stream `requestId` that
   *  the decision belongs to. For
   *  cross-referencing with the chat
   *  thread (future "jump to chat"
   *  feature). */
  requestId: string;
  /** The id of the `assistantMessage`
   *  that owned the tool call. Same
   *  cross-referencing purpose. */
  assistantMessageId: string;
  /** 5f: the `id` of the specific
   *  `toolCall` (within that
   *  assistant message) that the
   *  user decided on. Required
   *  for the "jump to chat from
   *  Activity Log row" feature:
   *  the AIPanel highlights this
   *  specific tool trace, not
   *  just the parent message. */
  toolCallId: string;
}

interface PersistedState {
  records: DecisionRecord[];
}

/** Truncate a string to at most
 *  `maxBytes` UTF-8 bytes. We measure
 *  bytes (not characters) to keep the
 *  localStorage footprint predictable
 *  — a 2KB character cap could be
 *  6KB+ in storage for emoji-heavy
 *  strings.
 *
 *  The truncation is appending a
 *  `…(truncated)` marker so the user
 *  can tell at a glance that the
 *  preview is partial. */
export function truncateArgsPreview(
  s: string,
  maxBytes: number = ARGS_PREVIEW_MAX_BYTES,
): string {
  if (!s) return '';
  // `TextEncoder` gives us a clean
  // UTF-8 byte length without the
  // `Blob`-or-`Buffer` browser-vs-
  // Node mismatch.
  const enc = new TextEncoder();
  const bytes = enc.encode(s);
  if (bytes.length <= maxBytes) return s;
  // Slice the input to leave room
  // for the marker. The marker is
  // 12 UTF-8 bytes
  // (`…(truncated)`); we use it as
  // a soft cap and re-encode the
  // FINAL output to verify the
  // total doesn't exceed the
  // limit. The Math.max guards
  // against `maxBytes` being
  // smaller than the marker (in
  // which case we just emit the
  // marker alone).
  const marker = '…(truncated)';
  const markerBytes = enc.encode(marker);
  // Reserve at least 0 bytes for
  // the body (the marker can
  // dominate on a tiny cap).
  const cut = Math.max(0, maxBytes - markerBytes.length);
  const sliced = bytes.slice(0, cut);
  // `TextDecoder` with `fatal: false`
  // (the default) replaces malformed
  // sequences with U+FFFD — acceptable
  // for a preview. We then
  // re-verify the final byte count
  // and trim the body if the marker
  // tip pushes us over.
  let decoded = new TextDecoder().decode(sliced);
  let combined = decoded + marker;
  let combinedBytes = enc.encode(combined);
  while (combinedBytes.length > maxBytes && decoded.length > 0) {
    // Trim the last char of the
    // body and re-check.
    decoded = decoded.slice(0, -1);
    combined = decoded + marker;
    combinedBytes = enc.encode(combined);
  }
  return combined;
}

function loadFromStorage(): PersistedState | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'records' in parsed &&
      Array.isArray((parsed as PersistedState).records)
    ) {
      // Validate every record. We
      // drop malformed entries (rather
      // than rejecting the whole file)
      // — a single corrupt row from a
      // past-version bug shouldn't
      // wipe the entire history.
      const valid = (
        parsed as PersistedState
      ).records.filter(isDecisionRecord);
      return { records: valid };
    }
    return null;
  } catch {
    return null;
  }
}

/** Type guard for a single
 *  `DecisionRecord`. Defends against
 *  a v1 file with junk values (e.g.
 *  `decision: 'maybe'` from a future
 *  version that this build doesn't
 *  understand). */
function isDecisionRecord(v: unknown): v is DecisionRecord {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.timestamp === 'number' &&
    typeof r.toolName === 'string' &&
    (r.decision === 'deny' ||
      r.decision === 'allow_once' ||
      r.decision === 'allow_always' ||
      r.decision === 'revert') &&
    typeof r.argsPreview === 'string' &&
    typeof r.requestId === 'string' &&
    typeof r.assistantMessageId === 'string' &&
    // 5f: toolCallId is now
    // required. Records
    // persisted BEFORE 5f
    // (5e-era) won't have it;
    // the `loadFromStorage`
    // caller drops them via
    // this validator.
    typeof r.toolCallId === 'string'
  );
}

function saveToStorage(state: PersistedState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    // Quota / private-mode failures
    // are non-fatal. The in-memory
    // state still works; the log
    // just doesn't survive a reload.
    logger.warn('[toolDecisionLog] failed to persist:', e);
  }
}

interface ToolDecisionLogState {
  /** The recorded decisions, newest
   *  first. Bounded by
   *  `DECISION_LOG_CAPACITY`. */
  records: DecisionRecord[];
  /** True once we've attempted the
   *  localStorage hydration. The
   *  Settings screen can use this to
   *  avoid a "flash of empty" on
   *  mount (currently the empty
   *  state is the same as a freshly-
   *  hydrated empty state, so no
   *  flash; this flag is here for
   *  future use). */
  hydrated: boolean;

  /** 5h: soft-delete buffer.
   *  When `clearLog()` is
   *  called, the current
   *  `records` are moved here
   *  (instead of being
   *  discarded). The Settings
   *  UI reads `lastCleared`
   *  to decide whether to
   *  show an "Undo" toast. A
   *  subsequent `undoClear()`
   *  restores the buffer back
   *  to `records`. A second
   *  `clearLog()` (with no
   *  undo in between)
   *  overwrites this buffer
   *  (the earlier clear is
   *  final, the new clear is
   *  now the one with an
   *  undo available).
   *
   *  In-memory only: a page
   *  reload drops the buffer.
   *  This is intentional — the
   *  undo window is short (5s
   *  in the UI) and persisting
   *  the buffer to
   *  localStorage would
   *  grow the footprint. */
  lastCleared: DecisionRecord[] | null;

  /** Append a new decision to the
   *  log. The new record becomes
   *  `records[0]`; the rest shift
   *  down. If the post-append size
   *  exceeds `DECISION_LOG_CAPACITY`,
   *  the OLDEST entry is dropped.
   *
   *  Returns the id of the new
   *  record (convenient for tests
   *  and for callers that want to
   *  scroll-to-row). */
  recordDecision: (record: Omit<DecisionRecord, 'id' | 'timestamp'>) => string;

  /** Soft-delete the log. The
   *  current `records` are moved
   *  into `lastCleared`; a
   *  subsequent `undoClear()`
   *  restores them. The Settings
   *  UI shows an Undo toast for
   *  5 seconds; after the timeout
   *  (managed in the UI), the UI
   *  calls `discardUndo()` to
   *  free the buffer. (The store
   *  itself doesn't time the
   *  undo — that's a UI concern.)
   *
   *  If the log is already empty,
   *  this is a no-op (no undo
   *  offered for an empty log). */
  clearLog: () => void;

  /** Restore the records from
   *  `lastCleared` and clear the
   *  buffer. No-op if there's
   *  nothing to undo. */
  undoClear: () => void;

  /** Drop the soft-delete buffer
   *  without restoring. Called by
   *  the UI when the 5-second
   *  undo window expires. No-op
   *  if there's nothing buffered. */
  discardUndo: () => void;

  /** Return the records for a single
   *  tool, newest first. Useful for
   *  a future "see all decisions for
   *  `run_npm_deploy`" view (not in
   *  5e). */
  getRecentForTool: (toolName: string) => DecisionRecord[];

  /** Return the most recent N
   *  records, newest first. The
   *  Settings screen calls this with
   *  a UI cap (e.g. 50 visible at a
   *  time) so the React tree doesn't
   *  render 500 rows. */
  getRecent: (limit?: number) => DecisionRecord[];

  /** Internal: hydrate from
   *  localStorage. Called once at
   *  app startup. */
  hydrate: () => void;
}

export const useToolDecisionLogStore = create<ToolDecisionLogState>(
  (set, get) => ({
    records: [],
    hydrated: false,
    lastCleared: null,

    recordDecision: (input) => {
      const id =
        typeof crypto !== 'undefined' &&
        typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `dec_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const record: DecisionRecord = {
        id,
        timestamp: Date.now(),
        ...input,
        // Defensive: the caller should
        // already have truncated, but
        // we double-truncate here so
        // the storage layer can never
        // see an oversized string.
        argsPreview: truncateArgsPreview(input.argsPreview),
      };
      set((s) => {
        // Newest first. The new
        // record is at index 0; the
        // old rest shifts down by 1.
        // After the shift, if the
        // length exceeds capacity,
        // drop the tail.
        const next = [record, ...s.records];
        if (next.length > DECISION_LOG_CAPACITY) {
          next.length = DECISION_LOG_CAPACITY;
        }
        return { records: next };
      });
      return id;
    },

    clearLog: () => {
      // 5h: soft-delete. The
      // current records are
      // moved into the
      // `lastCleared` buffer
      // instead of being
      // discarded, so the
      // user can undo. The
      // UI is responsible for
      // showing the undo
      // toast and timing the
      // 5-second window (the
      // store doesn't know
      // about time).
      //
      // Edge case: if the
      // log is already empty,
      // we don't offer an
      // undo (there's nothing
      // to undo). This is
      // also defensive against
      // a re-entry bug where
      // the UI double-clicks
      // the Clear button.
      const current = get().records;
      if (current.length === 0) return;
      set({
        records: [],
        lastCleared: current,
      });
    },

    undoClear: () => {
      // Restore the records
      // from the buffer. If
      // the buffer is null
      // (either nothing was
      // cleared, or the
      // undo window
      // expired), this is
      // a no-op.
      const buffer = get().lastCleared;
      if (buffer === null) return;
      set({
        records: buffer,
        lastCleared: null,
      });
    },

    discardUndo: () => {
      // Drop the buffer
      // without restoring.
      // Called by the UI
      // when the 5-second
      // window expires. We
      // DON'T touch
      // `records` here — the
      // clear has already
      // taken effect; this
      // is purely "release
      // the soft-delete
      // memory".
      const buffer = get().lastCleared;
      if (buffer === null) return;
      set({ lastCleared: null });
    },

    getRecentForTool: (toolName) => {
      return get().records.filter((r) => r.toolName === toolName);
    },

    getRecent: (limit) => {
      const all = get().records;
      if (limit === undefined || limit >= all.length) return all;
      return all.slice(0, limit);
    },

    hydrate: () => {
      if (get().hydrated) return;
      const persisted = loadFromStorage();
      set({
        records: persisted?.records ?? [],
        hydrated: true,
      });
    },
  }),
);

// Wire up persistence: every state
// change (after the initial hydration)
// writes to localStorage. The
// `hydrated` flag guards against the
// hydration itself triggering a
// redundant write.
let persistenceSubscribed = false;
export function setupToolDecisionLogPersistence(): void {
  if (persistenceSubscribed) return;
  persistenceSubscribed = true;
  useToolDecisionLogStore.subscribe((state) => {
    if (!state.hydrated) return;
    saveToStorage({ records: state.records });
  });
}

/** Selectors — keep these tiny so
 *  components can compose them. */
export const toolDecisionLogSelectors = {
  records: (s: ToolDecisionLogState) => s.records,
  hydrated: (s: ToolDecisionLogState) => s.hydrated,
  recordCount: (s: ToolDecisionLogState) => s.records.length,
  getRecent:
    (limit?: number) =>
    (s: ToolDecisionLogState): DecisionRecord[] => {
      if (limit === undefined || limit >= s.records.length) return s.records;
      return s.records.slice(0, limit);
    },
  getRecentForTool:
    (toolName: string) =>
    (s: ToolDecisionLogState): DecisionRecord[] =>
      s.records.filter((r) => r.toolName === toolName),
};
