/**
 * errorMessages — friendly copy for the 7 ErrorKind
 * variants the Rust chat pipeline can emit
 * (5b-2 — see `chat.rs` for the source list).
 *
 * 5b-5 introduced this helper so the `ErrorBanner`
 * can show a title that names the failure mode
 * ("Invalid API key", "Rate limit hit") plus a
 * one-line hint pointing the user to the right
 * action ("Open Settings to update your key",
 * "Wait a moment and try again"). 5b-3 rendered
 * the raw `errorKind` + `message` strings, which
 * leaked implementation details ("HTTP 401:
 * Incorrect API key provided") and never told the
 * user what to DO.
 *
 * This file is a pure function — no JSX, no
 * imports, easy to test. `ErrorBanner.tsx` calls
 * `getFriendlyError(errorKind, message)` and
 * renders the result. A future phase can add
 * locale strings (i18n) by replacing the return
 * values with `t('error.auth.title')` etc.; the
 * shape stays the same.
 *
 * The 7+1 kinds, in order of likely frequency:
 *   - 'auth'        — 401 / 403 from the provider
 *   - 'rateLimit'   — 429
 *   - 'transport'   — DNS, TLS, connection refused
 *   - 'parse'       — model returned unexpected JSON
 *   - 'server'      — 5xx from the provider
 *   - 'http'        — any other non-2xx (e.g. 400 bad request)
 *   - 'cancelled'   — user pressed Stop
 *   - 'toolLoop'    — 5b-6: model asked for too many
 *                    tool-execution rounds (over
 *                    `MAX_TOOL_ROUNDS`). This is a
 *                    client-side error kind; the Rust
 *                    side never emits it.
 *
 * Any unknown `errorKind` (forward compatibility)
 * falls back to a generic "Something went wrong"
 * title + the raw `message` as the hint, so the
 * user still sees something useful.
 */

export interface FriendlyError {
  /** Short, bold title (e.g. "Invalid API key"). */
  title: string;
  /**
   * One-line action-oriented hint (e.g. "Open
   * Settings to update your key"). Empty
   * string when there's nothing actionable to
   * say.
   */
  hint: string;
}

/**
 * Map an ErrorKind + the raw provider message
 * to a title + hint pair. Pure — easy to test.
 *
 * The `message` argument is included so the
 * `http` variant can extract the status code
 * (e.g. "HTTP 400: …") and surface it in the
 * hint. For all other variants the raw message
 * is intentionally NOT shown — the title + hint
 * carry enough context.
 */
export function getFriendlyError(
  errorKind: string,
  message: string,
): FriendlyError {
  switch (errorKind) {
    case 'auth':
      return {
        title: 'Invalid API key',
        hint: 'Open Settings to update your key.',
      };
    case 'rateLimit':
      return {
        title: 'Rate limit hit',
        hint: 'Wait a moment and try again.',
      };
    case 'transport':
      return {
        title: 'Network error',
        hint: 'Check your internet connection and try again.',
      };
    case 'parse':
      return {
        title: 'Unexpected response',
        hint: 'The provider returned something we couldn\u2019t parse \u2014 try again or switch models.',
      };
    case 'server':
      return {
        title: 'Provider issue',
        hint: 'The provider is having a rough time \u2014 try again in a few minutes.',
      };
    case 'http': {
      // Try to surface the status code. The Rust
      // side formats it as `HTTP <status>: …`.
      const m = /^HTTP\s+(\d{3})/i.exec(message);
      const status = m?.[1];
      return {
        title: status ? `Request failed (HTTP ${status})` : 'Request failed',
        hint: status
          ? `HTTP ${status} \u2014 try again or check the model id.`
          : 'Try again or check the model id.',
      };
    }
    case 'cancelled':
      return {
        title: 'Stopped',
        hint: 'You cancelled the response.',
      };
    case 'toolLoop':
      return {
        title: 'Too many tool rounds',
        hint: 'The AI asked to run more tools than the safety limit allows \u2014 try a simpler question.',
      };
    default:
      return {
        title: 'Something went wrong',
        hint: message || 'Try again. If the problem persists, check the dev tools console.',
      };
  }
}
