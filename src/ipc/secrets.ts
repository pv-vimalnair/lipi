/**
 * Typed IPC wrapper for the OS-keychain-backed secrets
 * store (Phase 5a).
 *
 * Mirrors `src-tauri/src/secrets.rs`. Components import
 * from `@/ipc`, never from `@tauri-apps/api/core` directly
 * (Rule 4).
 *
 * The actual key value is NEVER returned to the JS side —
 * only `secretsHasApiKey` (true/false) is exposed for
 * "configured?" checks. The 5b chat proxy reads the key
 * in Rust via `secrets::get_api_key`, ships the HTTPS
 * request, and returns only the streamed response. Per
 * Decision #17 ("no backend, ever"), the key never
 * enters the JS bundle or any network request the JS
 * code makes.
 */

import { invoke } from '@tauri-apps/api/core';

/**
 * Tagged union mirroring the Rust `SecretError` enum.
 * Serialised to camelCase JSON by `#[serde(rename_all =
 * "camelCase", tag = "kind")]` on the Rust side.
 */
export type SecretErrorPayload =
  | { kind: 'invalidInput'; detail: string }
  | { kind: 'keychainUnavailable'; detail: string }
  | { kind: 'platform'; detail: string };

export class SecretError extends Error {
  readonly payload: SecretErrorPayload;

  constructor(payload: SecretErrorPayload) {
    super(`[${payload.kind}] ${payload.detail}`);
    this.name = 'SecretError';
    this.payload = payload;
  }
}

function asSecretError(err: unknown): SecretError {
  if (err instanceof SecretError) return err;
  if (
    typeof err === 'object' &&
    err !== null &&
    'kind' in err &&
    typeof (err as { kind: unknown }).kind === 'string'
  ) {
    return new SecretError(err as SecretErrorPayload);
  }
  return new SecretError({ kind: 'platform', detail: String(err) });
}

/**
 * Provider id. The static list of supported providers
 * lives in `src/ipc/ai.ts` (`aiListProviders`). The id
 * is the user-name in the OS keychain (service =
 * `app.lipi.ide`, user = `<id>`). We accept any
 * non-empty string at the IPC level so that adding a
 * new provider in `ai.rs` doesn't require a TS change
 * here — but the Settings UI only shows the 3 known
 * providers.
 */
export type ProviderId = string;
export type RendererReadableProviderId = 'wispr';

/**
 * Save (or overwrite) the API key for the given
 * provider. The key value is sent over the IPC bridge
 * ONE TIME — once the Rust side writes it to the
 * keychain, the JS code should clear its input field
 * and never store the value in React state.
 *
 * Throws `SecretError` on:
 *   - `invalidInput` (empty / overlong key or id)
 *   - `keychainUnavailable` (no Secret Service on
 *     Linux, Credential Manager locked on Windows, etc.)
 *   - `platform` (other keyring errors)
 */
export async function secretsSetApiKey(
  provider: ProviderId,
  key: string,
): Promise<void> {
  try {
    await invoke<void>('secrets_set_api_key', { provider, key });
  } catch (err) {
    throw asSecretError(err);
  }
}

/**
 * Returns `true` if the provider has a key in the
 * keychain, `false` if not. Cheap, non-secret-leaking.
 * The Settings screen calls this on mount and after
 * every save / delete to update the "Configured" badge.
 *
 * Throws `SecretError` if the keychain is broken
 * (e.g. unavailable). Callers should surface this as
 * a "Keychain unavailable — use environment variable
 * LIPI_<PROVIDER>_API_KEY" hint, which 5b will also
 * support.
 */
export async function secretsHasApiKey(
  provider: ProviderId,
): Promise<boolean> {
  try {
    return await invoke<boolean>('secrets_has_api_key', { provider });
  } catch (err) {
    throw asSecretError(err);
  }
}

/**
 * Delete the API key for the given provider.
 * Idempotent. Used by the Settings screen's
 * "Remove key" button.
 */
export async function secretsDeleteApiKey(
  provider: ProviderId,
): Promise<void> {
  try {
    await invoke<void>('secrets_delete_api_key', { provider });
  } catch (err) {
    throw asSecretError(err);
  }
}

/**
 * M2b: read the raw Wispr API key from the OS keychain.
 *
 * The AI provider keys (openai / anthropic / openrouter)
 * should NOT be read with this — they're consumed by the
 * Rust AI proxy and Decision #17 explicitly says the JS
 * side never sees the value. This command exists for
 * providers whose calls originate in the WebView. Today
 * that is Wispr Flow only, whose WebSocket is opened from
 * JS. Rust also enforces this allowlist, so direct renderer
 * IPC calls cannot fetch OpenAI / Anthropic / OpenRouter
 * keys.
 *
 * Returns `null` if the provider has no key in the
 * keychain. Throws `SecretError` on keychain errors.
 *
 * Threat model:
 *   - The key is exposed to the JS side, but only in the
 *     same trust boundary as the AI proxy: Lipi itself,
 *     running in the user's own WebView.
 *   - The caller MUST NOT log the key, send it to any
 *     URL other than the provider's own endpoint, or
 *     hold it in any global state. The Wispr integration
 *     (M2b) fetches it on `start()`, holds it in a local
 *     variable for the duration of the WebSocket call,
 *     and drops it on `stop()`.
 */
export async function secretsGetApiKey(
  provider: RendererReadableProviderId,
): Promise<string | null> {
  try {
    return await invoke<string | null>('secrets_get_api_key', { provider });
  } catch (err) {
    throw asSecretError(err);
  }
}
