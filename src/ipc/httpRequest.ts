/**
 * Typed IPC wrapper for the `http_request`
 * Tauri command (Phase 5c).
 *
 * The JS `toolRegistry` calls this for any
 * `kind: 'http'` custom tool. The Rust side
 * uses `reqwest` to send the request, enforces
 * a hard timeout, and returns the response
 * body / status / headers to the JS side.
 *
 * Mirrors `src-tauri/src/http.rs`. Components
 * import from `@/ipc`, never from
 * `@tauri-apps/api/core` directly (Rule 4).
 *
 * ## Why a Rust IPC, not the browser's `fetch`?
 *
 * Tauri's webview sandbox doesn't allow
 * arbitrary `fetch` (CORS, mixed-content,
 * arbitrary headers like `Authorization`).
 * Going through Rust `reqwest` gives us full
 * control: any URL, any headers, any method,
 * any body. The security model stays in Rust
 * where the user can audit it.
 */

import { invoke } from '@tauri-apps/api/core';

/**
 * Args for `http_request`. The JS
 * `toolRegistry` builds this from a custom
 * tool's `url` template + the model's
 * substituted args, plus the user-configured
 * method / headers / body from
 * `lipi-tools.json`.
 */
export interface HttpRequestArgs {
  /** URL with optional `{arg}` placeholders
   *  already substituted by the JS side. Must
   *  be a valid absolute `http://` or
   *  `https://` URL. (We don't support
   *  `file://`, `data:`, etc. — 5c is an
   *  internet fetcher.) */
  url: string;
  /** Method. Defaults to `'GET'` if not
   *  set. 5c supports any method reqwest does
   *  (`GET`, `POST`, `PUT`, `PATCH`,
   *  `DELETE`, `HEAD`, `OPTIONS`). */
  method?: string;
  /** Headers. Empty object = no extra
   *  headers. The `Content-Type` header is
   *  *not* auto-set; if the user wants
   *  `application/json` they should set it
   *  explicitly. */
  headers?: Record<string, string>;
  /** Request body (raw string). Empty
   *  string = no body. The user is
   *  responsible for serialising JSON or
   *  other formats themselves; 5c is a dumb
   *  pipe. */
  body?: string;
  /** Per-call timeout (seconds). Omit to use
   *  the Rust default (30s). 5d+ may surface
   *  this as a per-tool field. */
  timeoutSecs?: number;
  /** Per-call response-body cap (bytes).
   *  Omit to use the Rust default (1 MiB).
   *  Bodies larger than this are truncated
   *  with a `<truncated>` marker so the
   *  model still gets something useful. */
  maxBodyBytes?: number;
}

/**
 * The response shape. Returned on the happy
 * path (2xx). Non-2xx are serialised as
 * `HttpRequestError` to the JS side — the
 * `toolRegistry` catches those and converts
 * them into a `kind: 'error'` tool result for
 * the model to react to.
 */
export interface HttpRequestResult {
  /** HTTP status (e.g. 200, 404). Always
   *  populated, even on the error path. */
  status: number;
  /** Headers as a flat `[name, value][]`
   *  (HashMap doesn't serialise
   *  deterministically). The Rust side caps
   *  the count at 50 to keep the payload
   *  bounded. */
  headers: [string, string][];
  /** Truncated response body (UTF-8 lossy if
   *  the server lied about charset). */
  body: string;
}

/**
 * The error variants the Rust side can
 * return. Discriminated union on `kind` —
 * the `toolRegistry` switches on the
 * discriminator to format a model-friendly
 * error message. The `message` field is the
 * human-readable display string; the `body`
 * field (only on `non2xx`) includes the
 * server's error response so the model can
 * react.
 */
export type HttpRequestError =
  | { kind: 'invalidUrl'; message: string; url: string }
  | {
      kind: 'invalidHeaderName';
      message: string;
      name: string;
    }
  | {
      kind: 'invalidHeaderValue';
      message: string;
      name: string;
    }
  | { kind: 'network'; message: string }
  | {
      kind: 'non2xx';
      message: string;
      status: number;
      body: string;
    }
  | { kind: 'timeout'; message: string; seconds: number };

/**
 * Send an HTTP request. Used by the JS
 * `toolRegistry` for any `kind: 'http'`
 * custom tool.
 *
 * The Rust side enforces a hard timeout
 * (30s default) and a max-body cap (1 MiB
 * default). Both are configurable via the
 * args.
 *
 * Throws ONLY for setup failures the JS side
 * can't pre-validate (e.g. Tauri command not
 * registered, IPC channel closed). All
 * runtime errors (non-2xx, timeout, network
 * failure) come back as `HttpRequestError`
 * values, not thrown exceptions.
 */
export async function httpRequest(
  args: HttpRequestArgs,
): Promise<HttpRequestResult> {
  return invoke<HttpRequestResult>('http_request', { args });
}
