/**
 * Typed IPC wrapper for the AI provider registry
 * (Phase 5a), the streaming chat proxy
 * (Phase 5b-1 / 5b-2), and the tool-call
 * surface (Phase 5b-4).
 *
 * Mirrors `src-tauri/src/ai.rs` and
 * `src-tauri/src/chat.rs`. Components import
 * from `@/ipc`, never from `@tauri-apps/api/core`
 * directly (Rule 4).
 *
 * The 5a surface is read-only: a static list of
 * providers and a cheap "which of the 3 have keys"
 * check. The 5b-1 / 5b-2 additions added the
 * streaming chat invoke + cancellation + the
 * three `ai://*` event subscriptions. The 5b-4
 * additions extended the `ChatChunkPayload`
 * union with a `toolCall` variant for
 * function-calling events.
 *
 * The Rust side serialises payloads as camelCase
 * discriminated unions with a `kind` tag.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/**
 * The static list of supported AI providers, as
 * returned by `ai_list_providers`. The Rust side
 * hardcodes the provider metadata (id, base URLs,
 * default model, available models, key URL); the
 * frontend renders one Settings card per entry.
 *
 * The two `*_compatible_base_url` fields are stored
 * but unused in 5a; 5b uses them to route the
 * streaming request. The frontend can ignore them
 * for the Settings UI.
 */
export interface ProviderInfo {
  /** Stable id (e.g. "openai"). Used as the keychain
   *  user-name and the `provider` parameter to AI
   *  IPC commands. Never rename without a key
   *  migration. */
  id: string;
  /** Human-readable display name (e.g. "OpenAI"). */
  displayName: string;
  /** OpenAI-compatible `/v1/chat/completions` base
   *  URL. `null` if the provider doesn't speak it. */
  openaiCompatibleBaseUrl: string | null;
  /** Anthropic-compatible `/v1/messages` base URL.
   *  `null` if the provider doesn't speak it. */
  anthropicCompatibleBaseUrl: string | null;
  /** Default model id for chat completions from
   *  this provider. */
  defaultModel: string;
  /** Hardcoded model list shown in the UI picker. */
  availableModels: string[];
  /** Short blurb shown on the Settings card. */
  description: string;
  /** Link to the provider's API-key page. */
  keyUrl: string;
}

/**
 * Returns the static list of supported AI providers.
 * The Settings screen calls this on mount. The list
 * never changes between Tauri restarts, so the result
 * is safe to cache in a Zustand store and re-read
 * only on screen re-mount.
 */
export async function aiListProviders(): Promise<ProviderInfo[]> {
  return invoke<ProviderInfo[]>('ai_list_providers');
}

/**
 * Returns the ids of providers that have a key in
 * the keychain. Used by the Settings screen to render
 * the "Configured" / "Not configured" badges without
 * three separate `secretsHasApiKey` round-trips.
 *
 * On keychain error for a specific provider, that
 * provider is silently omitted from the result. The
 * Settings screen will surface the error in detail
 * when the user clicks that card (a separate
 * `secretsHasApiKey` call).
 */
export async function aiGetConfiguredProviders(): Promise<string[]> {
  return invoke<string[]>('ai_get_configured_providers');
}

// --- Phase 5b-3: streaming chat IPC --------------------------------------
//
// The streaming chat is an event-driven pipeline,
// not a request/response:
//   1. JS calls `aiChatStream(...)` which returns
//      a `requestId` synchronously.
//   2. The Rust side spawns a task that emits
//      `ai://chunk` events tagged with that
//      `requestId` (1+ per assistant token).
//   3. When the stream is over (or cancelled or
//      errored), the Rust side emits `ai://done`
//      (always) and optionally `ai://error`
//      (on early failure).
//   4. JS subscribes to the three event names
//      ONCE at app startup (in `aiStore.ts`) and
//      demuxes by `requestId`.
//
// The JS side NEVER has to know about SSE
// framing, transport, or cancellation tokens —
// those are all in `src-tauri/src/chat.rs`.

/**
 * A single message in the chat thread. The shape
 * mirrors `ChatMessage` in `src-tauri/src/chat.rs`.
 *
 * `name` is optional (used by some providers for
 * multi-user chats; typically absent). The Rust
 * side accepts it but OpenAI ignores it; Anthropic
 * errors if you set a `name` and it doesn't match
 * its conventions.
 *
 * 5b-6 additions: `toolCalls` and `toolCallId` for
 * the tool-execution loop. The model emits tool
 * calls (assistant messages carry the `toolCalls`
 * array); the JS-side registry executes each tool
 * and sends the result back as a follow-up message
 * with `role: 'tool'` and `toolCallId: <the original
 * call's id>`. The Rust side converts this internal
 * shape into the provider's wire format (OpenAI:
 * direct passthrough; Anthropic: assistant tool
 * calls → `tool_use` content blocks, tool result
 * → `user` role with `tool_result` content blocks).
 */
export interface ChatMessageArgs {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  /**
   * 5b-6: present on assistant messages that
   * emitted one or more tool calls. The order
   * matches the order the model decided to
   * invoke the tools in. Each entry's `id`
   * is the provider-assigned id; the
   * `toolCallId` on the corresponding result
   * message echoes this back.
   */
  toolCalls?: AssistantToolCallArgs[];
  /**
   * 5b-6: present on tool result messages
   * (`role: 'tool'`). The id of the call this
   * is the result of — the JS side reads it
   * from the original `ToolCallPayload.id`.
   */
  toolCallId?: string;
}

/**
 * 5b-6: a tool call attached to an assistant
 * message. Mirrors `AssistantToolCall` in
 * `src-tauri/src/chat.rs`. The JS side sends
 * these back in follow-up requests so the
 * provider knows "this assistant message had
 * these tool calls" (the model uses the id to
 * map a result message back to the call).
 */
export interface AssistantToolCallArgs {
  /** Provider-assigned id. OpenAI: `call_…`,
   *  Anthropic: `toolu_…`. */
  id: string;
  /** Function name, e.g. `'get_file_contents'`. */
  name: string;
  /** Concatenated JSON argument string. May
   *  be `''` for no-arg tools; may not be
   *  valid JSON if the model hallucinated. */
  arguments: string;
}

/**
 * A user-defined custom tool (5c). The JS
 * `customToolsStore` is the source of truth at
 * runtime; the `customTools` field on
 * `ChatStreamArgs` carries a denormalised
 * snapshot of the current contents of
 * `lipi-tools.json` to the Rust side so the
 * model can see the custom tool definitions.
 *
 * Mirrors `CustomToolSpec` in
 * `src-tauri/src/custom_tool.rs`. The two
 * sides are kept in sync by hand for the MVP.
 *
 * 5c scope: only `'shell' | 'http'` tool
 * kinds. The `args` list is a tiny type
 * system — only `'string'` for 5c. Future
 * `'number' | 'boolean' | 'enum'` arg types
 * are 5d+ additions.
 */
export interface CustomToolArg {
  /** Argument name (e.g. `'path'`). Must
   *  match a `{name}` placeholder in the
   *  tool's command/url template.
   *  Case-sensitive. The `customToolsStore`
   *  validates identifier shape on save. */
  name: string;
  /** Argument type. Only `'string'` in 5c. */
  type: 'string';
  /** Human-readable description shown to
   *  the model in the tool's JSON Schema. */
  description: string;
}

/**
 * The wire shape of a custom tool as it
 * crosses the JS↔Rust boundary. The Rust
 * side doesn't see the tool's
 * `command`/`url`/etc. (only the JS
 * executor needs those) — it only needs
 * enough to build the provider-specific
 * tool declaration. The full tool
 * configuration (including the
 * command/url/headers) lives in
 * `lipi-tools.json` and is loaded by the
 * `customToolsStore` at app start.
 */
export interface CustomToolSpec {
  /** Tool name (e.g. `'run_npm_test'`).
   *  Must be unique across the registry.
   *  The `customToolsStore` enforces this
   *  on save. */
  name: string;
  /** Human-readable description shown to
   *  the model in the tool's JSON Schema. */
  description: string;
  /** Ordered list of arguments. The order
   *  is preserved in the generated JSON
   *  Schema (matters for the Anthropic
   *  tool spec). */
  args: CustomToolArg[];
}

/**
 * The request body for `ai_chat_stream`. Pass the
 * full thread (NOT just the new user message) —
 * the Rust side is stateless about the thread;
 * the `aiStore` is the source of truth.
 *
 * 5b-7 additions:
 *   - `enabledToolNames` — per-tool enable/disable
 *     whitelist. The JS `toolSettingsStore` is the
 *     source of truth (the user toggles tools on
 *     the Settings screen); the AI store snapshots
 *     the current state on every `send()` and passes
 *     it through. The Rust side uses it to filter
 *     the `tools: [...]` array sent to the provider,
 *     so a disabled tool is invisible to the model.
 *     An absent / empty array means "all enabled"
 *     (the legacy default — see `chat.rs`'s
 *     `is_tool_enabled` for the exact semantics).
 *
 * 5c additions:
 *   - `customTools` — denormalised snapshot of the
 *     current `customToolsStore` state. The Rust
 *     side merges these on top of the built-in
 *     `TOOL_CATALOGUE` and shapes them per-provider
 *     (OpenAI: `{type:"function", function:{…}}`,
 *     Anthropic: `{name, description, input_schema}`).
 *     The actual EXECUTION of a custom tool happens
 *     on the JS side (in `toolRegistry`); the Rust
 *     side only sees the shape definition.
 */
export interface ChatStreamArgs {
  /** One of `'openai' | 'anthropic' | 'openrouter'`. */
  provider: string;
  /**
   * Model id (e.g. `'gpt-4o-mini'`). Optional — if
   * omitted, the Rust side uses the provider's
   * `defaultModel` from `aiListProviders()`.
   */
  model?: string;
  /** The full chat thread, oldest first. */
  messages: ChatMessageArgs[];
  /**
   * 5b-7: names of tools the model is allowed
   * to call. The JS `toolSettingsStore` collects
   * this from the user; the AI store snapshots
   * it on every `send()` and passes it through.
   * An empty array is the "all enabled" default
   * (backwards-compat for code paths that don't
   * know about 5b-7 yet — the Rust side treats
   * this as "no filter"). The wire field is
   * `enabledToolNames` (camelCase); the Rust
   * struct is `enabled_tool_names`.
   */
  enabledToolNames?: string[];
  /**
   * 5c: per-request custom tool list. The JS
   * `customToolsStore` is the source of truth
   * for which custom tools exist; this is a
   * denormalised snapshot of the current
   * `lipi-tools.json` contents. Empty /
   * undefined = no custom tools (the default
   * for code paths that don't know about 5c
   * yet). The `enabledToolNames` filter still
   * applies — a custom tool whose name is not
   * in the whitelist is invisible to the
   * model. The wire field is `customTools`
   * (camelCase); the Rust struct is
   * `custom_tools`.
   */
  customTools?: CustomToolSpec[];
}

/**
 * A complete tool call (5b-4). The model has
 * decided to invoke the named function with
 * the given JSON argument. Mirrors
 * `ChatDelta::ToolCall` on the Rust side.
 *
 * The Rust adapter assembles the `input` JSON
 * byte-by-byte from the provider's streaming
 * protocol — by the time we receive this
 * payload, `input` is the fully concatenated
 * JSON string. We do NOT parse it on the
 * Rust side; the JS side may want to display
 * it raw (for transparency) or parse it
 * (for execution).
 *
 * The `id` is provider-assigned (OpenAI:
 * `call_…`, Anthropic: `toolu_…`). The JS
 * side uses this as the React `key` for
 * the per-message tool trace and (in a
 * future phase) as the id to map a
 * follow-up "tool result" message back to
 * the original call.
 */
export interface ToolCallPayload {
  kind: 'toolCall';
  /** Provider-assigned id. */
  id: string;
  /** Function name, e.g. `'get_weather'`. */
  name: string;
  /**
   * Concatenated JSON argument string. May
   * be `''` for no-arg tools, or invalid JSON
   * if the model hallucinated. The JS side
   * should `JSON.parse` with a try/catch
   * when it wants to execute the tool.
   */
  input: string;
}

/**
 * The `ai://chunk` event payload. The `payload`
 * field is a discriminated union with a `kind`
 * tag — the same shape `ChatDelta` has on the
 * Rust side.
 *
 * 5b-4 added `ToolCall` to the union. The
 * store's demux appends `toolCall` to the
 * current streaming assistant message's
 * `toolCalls` array.
 */
export type ChatChunkPayload =
  | { kind: 'delta'; text: string }
  | ToolCallPayload
  | {
      kind: 'done';
      cancelled: boolean;
      /**
       * Anthropic only. One of
       * `'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use'`.
       * `undefined` for OpenAI / OpenRouter and for
       * user-cancelled completions. `'tool_use'`
       * means the model finished its turn by
       * emitting one or more tool calls; the
       * corresponding `toolCall` chunks will
       * have arrived BEFORE this `done` chunk
       * (5b-4).
       */
      stopReason?: string;
    }
  | { kind: 'error'; errorKind: string; message: string };

/**
 * Envelope for every `ai://chunk` event. The
 * `requestId` is the same one returned by
 * `aiChatStream()`; the JS store demuxes by it.
 */
export interface ChunkEnvelope {
  requestId: string;
  payload: ChatChunkPayload;
}

/**
 * Envelope for the `ai://done` event. This is the
 * authoritative "stream is over" signal for the
 * JS store (separate from the per-chunk `done`
 * payload above, which is the inline-display
 * signal). Both fire on completion; the JS store
 * treats them as the same event.
 */
export interface DoneEnvelope {
  requestId: string;
  cancelled: boolean;
  /** See `ChatChunkPayload`'s `done.stopReason`. */
  stopReason?: string;
}

/**
 * Envelope for the `ai://error` event. Fires on
 * early failure (before the first chunk) — e.g.
 * the keychain read failed, the provider is
 * unknown, the request never made it out. Errors
 * that happen mid-stream surface as
 * `ai://chunk` events with `kind: 'error'`
 * instead.
 */
export interface ErrorEnvelope {
  requestId: string;
  kind: string;
  message: string;
}

/**
 * Open a streaming chat completion. Returns the
 * `requestId` synchronously so the caller can
 * subscribe to `ai://chunk` / `ai://done` /
 * `ai://error` BEFORE the first chunk arrives
 * (the provider's first event can come back in
 * <50ms; the JS subscription must be in place
 * first, or the chunk is lost).
 *
 * `aiChatStream` does NOT throw on the happy
 * path — it returns a `requestId` even if the
 * provider is mid-error. The Rust side surfaces
 * provider errors as `ai://error` events (or
 * `ai://chunk` events with `kind: 'error'`).
 *
 * Throws ONLY for setup failures the JS side
 * can pre-validate (e.g. Tauri command not
 * registered, IPC channel closed).
 */
export async function aiChatStream(args: ChatStreamArgs): Promise<string> {
  return invoke<string>('ai_chat_stream', { args });
}

/**
 * Cancel an in-flight chat stream. The Rust side
 * flips the cancel flag; the reader task emits
 * `ai://done` with `cancelled: true` on the next
 * SSE event check.
 *
 * Returns `true` if the request was found and
 * cancelled; `false` if it was already gone
 * (finished naturally before the user clicked
 * Stop, or the requestId is unknown). The JS
 * store treats `false` as a no-op.
 */
export async function aiCancelStream(requestId: string): Promise<boolean> {
  return invoke<boolean>('ai_cancel_stream', { requestId });
}

/**
 * Subscribe to `ai://chunk` events. Returns an
 * unlisten function. The store calls this ONCE at
 * app startup and demuxes by `requestId` in the
 * callback.
 */
export async function onAiChunk(
  cb: (envelope: ChunkEnvelope) => void,
): Promise<UnlistenFn> {
  return listen<ChunkEnvelope>('ai://chunk', (e) => cb(e.payload));
}

/**
 * Subscribe to `ai://done` events. The store
 * listens for these to clear the
 * "streaming…" status and persist the final
 * message.
 */
export async function onAiDone(
  cb: (envelope: DoneEnvelope) => void,
): Promise<UnlistenFn> {
  return listen<DoneEnvelope>('ai://done', (e) => cb(e.payload));
}

/**
 * Subscribe to `ai://error` events. Fires on
 * early failure (before the first chunk). The
 * store surfaces these as inline errors in the
 * chat thread.
 */
export async function onAiError(
  cb: (envelope: ErrorEnvelope) => void,
): Promise<UnlistenFn> {
  return listen<ErrorEnvelope>('ai://error', (e) => cb(e.payload));
}
