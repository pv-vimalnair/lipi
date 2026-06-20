/**
 * Typed IPC wrapper for the Rust workspace
 * text-search command. See
 * `src-tauri/src/workspace_search.rs` for the
 * Rust side and the design notes (no ripgrep
 * sidecar, hand-rolled walker, cancellable via
 * a per-request search id).
 *
 * The JS side just relays the options and
 * result; the heavy lifting is in Rust.
 */

import { invoke } from '@tauri-apps/api/core';

export interface SearchOptions {
  /** The substring to search for. Required. */
  query: string;
  /** Absolute path to the directory to search. */
  rootPath: string;
  /** File / directory names to ignore, in addition
   *  to the Rust default ignore set. */
  extraIgnores?: string[];
  /** When true, the search is case-insensitive. */
  caseInsensitive?: boolean;
  /** Max number of matches to return. Defaults
   *  to 1_000 in Rust if omitted. */
  maxResults?: number;
  /** Optional unique id that can be cancelled through
   *  `workspaceSearchCancel`. */
  searchId?: string;
}

export interface SearchMatch {
  /** Absolute path to the file. */
  path: string;
  /** 1-based line number. */
  line: number;
  /** 1-based column number. */
  column: number;
  /** The full line text (no trailing newline). */
  lineText: string;
}

export interface SearchResult {
  matches: SearchMatch[];
  filesScanned: number;
  truncated: boolean;
}

/** Tauri error shape serialised from
 *  `src-tauri/src/workspace_search.rs::SearchError`. */
export interface SearchErrorPayload {
  kind: 'NotFound' | 'NotADirectory' | 'InvalidQuery' | 'Io' | 'Cancelled';
  detail: string;
}

export class SearchError extends Error {
  readonly payload: SearchErrorPayload;
  constructor(payload: SearchErrorPayload) {
    super(`[${payload.kind}] ${payload.detail}`);
    this.name = 'SearchError';
    this.payload = payload;
  }
}

function asSearchError(err: unknown): SearchError {
  if (err instanceof SearchError) return err;
  if (
    typeof err === 'object' &&
    err !== null &&
    'kind' in err &&
    typeof (err as { kind: unknown }).kind === 'string'
  ) {
    return new SearchError(err as SearchErrorPayload);
  }
  return new SearchError({ kind: 'Io', detail: String(err) });
}

/**
 * Run a workspace search. Throws
 * `SearchError` on a typed error payload,
 * otherwise wraps unknown errors as
 * `{ kind: 'Io', detail: String(err) }`.
 */
export async function workspaceSearch(
  opts: SearchOptions,
): Promise<SearchResult> {
  try {
    return await invoke<SearchResult>('workspace_search', { opts });
  } catch (err) {
    throw asSearchError(err);
  }
}

/** Request cancellation of a running workspace search.
 *  Returns true when the cancellation token was recorded. */
export async function workspaceSearchCancel(searchId: string): Promise<boolean> {
  return await invoke<boolean>('workspace_search_cancel', { searchId });
}
