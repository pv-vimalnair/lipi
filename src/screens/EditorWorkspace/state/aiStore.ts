/**
 * AI chat state for the EditorWorkspace.
 *
 * Per Rule 3 (screen-folder layout), this store is
 * screen-local — `src/screens/EditorWorkspace/state/`,
 * NOT in `src/shared/`. Only the EditorWorkspace's
 * AI tab reads it today. (If a future phase moves
 * the AI panel to a global location — e.g. a
 * command-bar overlay — we'd lift the store to
 * `src/shared/state/`. Until then, screen-local.)
 *
 * Per Rule 5 (best-practice defaults), the request
 * lifecycle is modelled with a discriminated union
 * so "idle / streaming / error" are first-class
 * states. We deliberately do NOT use an
 * `isStreaming + hasError` boolean soup.
 *
 * Per Rule 6 (section isolation), this file owns the
 * data. The `AIPanel` component reads selectors and
 * calls `send` / `stop`. There is no `useAI` hook
 * facade — the IPC calls happen in this
 * store's actions directly, since they're trivial
 * one-liners (the event demux is the only non-trivial
 * part, and that's a module-level subscription).
 *
 * ## Demux model
 *
 * The store subscribes to `ai://chunk`, `ai://done`,
 * and `ai://error` ONCE at module load. Each event
 * carries a `requestId` envelope; the callback
 * matches it against the current `activeRequestId`
 * and either:
 *   - chunk with `kind: 'delta'` → append
 *     `payload.text` to the streaming assistant
 *     message's `content` (5b-4 onwards; was
 *     ignored in 5b-3)
 *   - chunk with `kind: 'toolCall'` → append
 *     `{ id, name, input }` to the streaming
 *     assistant message's `toolCalls` array
 *     (5b-4)
 *   - chunk with `kind: 'error'` → mid-stream
 *     error; surface as the same banner as
 *     `ai://error`
 *   - done → seal the streaming message
 *     (`streaming: false`) and reset
 *     `requestStatus` to `'idle'`
 *   - error → set `requestStatus` to `{ kind:
 *     'error', ... }` and seal the streaming
 *     placeholder
 *
 * Unknown `requestId`s (e.g. from a previous
 * session whose requestId was the same — extremely
 * unlikely with 32 hex chars) are silently
 * ignored. We log a `console.warn` in dev so the
 * issue surfaces during testing.
 *
 * ## 5b-3 → 5b-4 evolution
 *
 * 5b-3 ("append on done") deliberately ignored
 * delta chunks; the assistant message stayed
 * empty during the request and was finalised
 * (still empty) on `done`. 5b-4 changes this:
 * deltas append to the streaming message in
 * real time, and the message is finalised on
 * `done` with its accumulated content.
 *
 * 5b-4 also adds the `toolCalls` per-message
 * array. The Rust adapter assembles the
 * per-tool JSON argument byte-by-byte and
 * emits a single `toolCall` chunk per completed
 * tool. The store appends each chunk to the
 * streaming message's `toolCalls` array. The
 * `AIPanel` renders each tool as a collapsible
 * trace line under the assistant message.
 */

import { create } from 'zustand';

import {
  aiChatStream,
  aiCancelStream,
  aiGetConfiguredProviders,
  aiListProviders,
  onAiChunk,
  onAiDone,
  onAiError,
  type ChatChunkPayload,
  type ChatMessageArgs,
  type CustomToolSpec,
  type DoneEnvelope,
  type ErrorEnvelope,
  type ProviderInfo,
} from '@/ipc';
import { useCustomToolsStore } from '@/shared/state/customToolsStore';
import { useToolSettingsStore } from '@/shared/state/toolSettingsStore';
import { setupToolSettingsPersistence } from '@/shared/state/toolSettingsStore';
import { useToolDecisionLogStore } from '@/shared/state/toolDecisionLogStore';
import { setupToolDecisionLogPersistence } from '@/shared/state/toolDecisionLogStore';
import {
  useVoicePreferencesStore,
  setupVoicePreferencesPersistence,
} from '@/shared/state/voicePreferencesStore';
import { useVoiceCapabilitiesStore } from '@/shared/state/voiceCapabilitiesStore';
import { listTools, getTool } from './toolRegistry';
import { logger } from '@/shared/logger';

/**
 * A single tool call attached to an assistant
 * message. Mirrors the Rust
 * `ChatDelta::ToolCall { id, name, input }`
 * shape. Stored on `ChatMessage.toolCalls`
 * (5b-4).
 *
 * `input` is the concatenated JSON argument
 * string as it arrived over the wire — we do
 * NOT parse it on the client (the model may
 * have hallucinated; the renderer shows the
 * raw JSON for transparency). A future phase
 * may parse it for tool execution.
 */
export interface ToolCall {
  /** Provider-assigned id (OpenAI `call_…`,
   *  Anthropic `toolu_…`). */
  id: string;
  /** Function name, e.g. `'get_weather'`. */
  name: string;
  /** Concatenated JSON argument string. */
  input: string;
}

/**
 * 5b-6: the local execution state of a tool
 * call. Stored on the same `ToolCall` object
 * as the wire payload — `ToolCall.status`
 * tracks the lifecycle of the execution, and
 * `ToolCall.result` is filled in once the
 * `toolRegistry` handler returns.
 *
 * Status machine:
 *   - `pending`: the model emitted the call
 *     and we haven't started executing it
 *     yet. Initial state.
 *   - `running`: the `toolRegistry.execute()`
 *     promise is in flight. The renderer
 *     shows a spinner.
 *   - `done`: the handler returned
 *     successfully. `result` is populated
 *     with `output` (the result content) and
 *     `durationMs` (wall-clock time the
 *     handler took).
 *   - `error`: the handler threw or returned
 *     an error. `result.error` carries the
 *     message. We still append a tool result
 *     message to the thread so the model
 *     can see the error and react (e.g.
 *     "the file doesn't exist — let me
 *     try a different path").
 *   - `skipped`: the tool name is not in the
 *     registry. We don't try to execute it
 *     and don't send a tool result for it
 *     (sending a "I don't know how to do
 *     that" result would just confuse the
 *     model). The model will see that no
 *     result came back and stop calling it.
 */
export type ToolCallStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'error'
  | 'skipped';

/**
 * 5b-6: the result of executing a tool call.
 * `error` is set when the handler threw;
 * `output` is the successful result content.
 * `kind` is a coarse classification the
 * renderer uses to colour the result preview
 * (`'text'`, `'json'`, `'error'`).
 */
export interface ToolResult {
  /** The tool call's id (the one we echoed
   *  back in the `toolCallId` of the result
   *  message). */
  toolCallId: string;
  /** The result content as a string. For
   *  `kind: 'error'`, this is the error
   *  message. For `kind: 'json'`, this is
   *  the pretty-printed JSON. For
   *  `kind: 'text'`, it's the raw output. */
  output: string;
  /** `'text' | 'json' | 'error'`. */
  kind: 'text' | 'json' | 'error';
  /** Wall-clock duration of the handler
   *  call in milliseconds. `undefined` for
   *  `skipped` calls. */
  durationMs?: number;
}

/**
 * A single message in the chat thread. Mirrors
 * `ChatMessageArgs` for the user/assistant/system
 * triumvirate, but also has a stable client-side
 * `id` so React can key the list correctly and
 * we can update a specific message in place
 * (streaming render).
 */
export interface ChatMessage {
  /** Client-side stable id, e.g. `msg_<12 hex chars>`. */
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  /**
   * Full text content. For an in-flight
   * streaming assistant message, this is the
   * accumulator that `ai://chunk` deltas
   * append to in real time. For a tool result
   * message, this is the result content.
   */
  content: string;
  /**
   * True if this assistant message is still
   * being streamed. The renderer shows a
   * "▌" cursor at the end of streaming
   * messages. False for user / system /
   * tool messages and for finalised
   * assistant messages.
   */
  streaming: boolean;
  /**
   * Tool calls the model emitted as part of
   * this assistant message (5b-4 / 5b-6).
   * Empty for user / system / tool messages
   * and for assistant messages that didn't
   * call any tools. The renderer shows one
   * `ToolTrace` per entry, under the message
   * text.
   *
   * Tool calls arrive AFTER the model's text
   * deltas (the model writes "let me check
   * the weather" then emits a tool call),
   * so `toolCalls` is populated mid-stream
   * and grows over the request lifetime.
   * 5b-6 adds `status` and `result` to each
   * entry — the `ToolTrace` UI uses them to
   * show "running… / ✓ done (12ms) / ✗ error".
   */
  toolCalls: Array<ToolCall & {
    /** 5b-6: local execution state. Starts
     *  at `'pending'`. See `ToolCallStatus`. */
    status: ToolCallStatus;
    /** 5b-6: populated when `status` is
     *  `'done'` or `'error'`. */
    result?: ToolResult;
  }>;
  /**
   * 5b-6: present on tool result messages
   * (`role: 'tool'`). The id of the call
   * this is the result of (echoed back
   * to the provider in the follow-up
   * request). Tool result messages are
   * NOT rendered in the chat thread —
   * they're inlined into the parent
   * assistant message's `toolCalls[i].result`
   * for display.
   */
  toolCallId?: string;
}

/**
 * The current state of the request lifecycle.
 * Discriminated union — only one of these at
 * a time. `idle` means "no request in flight,
 * no error to display"; `streaming` means
 * "waiting for `ai://done`"; `executingTools`
 * (5b-6) means "the last assistant message
 * emitted tool calls and we're running them
 * on the JS side — the chat panel is busy";
 * `error` means "the last request failed; the
 * error banner is visible until the user sends
 * another message or dismisses it".
 */
export type RequestStatus =
  | { kind: 'idle' }
  | { kind: 'streaming' }
  /** 5b-6: the model emitted tool calls and
   *  the JS-side `toolRegistry` is executing
   *  them. After they finish, the store
   *  fires a follow-up `aiChatStream` with
   *  the results and transitions to
   *  `'streaming'`. */
  | { kind: 'executingTools'; round: number }
  /** 5d: the tool-loop is paused because a
   *  user-defined custom tool's policy is
   *  `'always_confirm'` or `'per_call'` and
   *  the user has not yet responded. The
   *  store has set `pendingConfirmation`
   *  to a non-null record; the
   *  `ConfirmToolCallModal` reads that
   *  record and renders the prompt. When
   *  the user clicks [Deny] / [Run once] /
   *  [Always allow], the store resolves
   *  the prompt and the loop continues
   *  (or aborts the call). */
  | { kind: 'awaitingConfirmation' }
  | { kind: 'error'; errorKind: string; message: string };

/**
 * 5d: the record describing the in-flight
 * confirmation prompt. Read by
 * `ConfirmToolCallModal` to render the
 * pretty-printed args; mutated by
 * `resolveConfirmation()` to either
 * (a) record the result and re-enter the
 * tool-loop, or (b) record a synthetic
 * error result and re-enter the tool-loop.
 *
 * `requestId` is the active chat-stream
 * requestId (the call must belong to the
 * in-flight stream — stale confirmations
 * for a cancelled stream are silently
 * dropped by `resolveConfirmation`).
 */
export interface PendingConfirmation {
  toolCallId: string;
  toolName: string;
  /** The tool description, pre-fetched at
   *  pause time so the modal doesn't
   *  re-read the registry on every
   *  render. */
  toolDescription: string;
  /** Pretty-printed JSON of the parsed
   *  args. Pre-stringified for the same
   *  reason. */
  argsJson: string;
  /** The id of the `assistantMessage` that
   *  owns the tool call (used to find
   *  the call entry to update). */
  assistantMessageId: string;
  /** The `requestId` of the in-flight
   *  chat stream. Used by the resolver
   *  to verify the call is still live. */
  requestId: string;
  /** The tool-execution round this
   *  confirmation belongs to. Used by
   *  the resolver to know which call to
   *  look up in the message thread. */
  round: number;
}

/**
 * 5b-6: the maximum number of tool-execution
 * rounds allowed per user message. After this
 * is hit, the store surfaces a friendly error
 * ("The AI asked for too many tool rounds — try
 * a simpler question") and the loop exits.
 * 3 is a generous limit — most useful
 * tool-using flows complete in 1-2 rounds.
 */
export const MAX_TOOL_ROUNDS = 3;

interface AiState {
  /** All chat messages, oldest first. */
  messages: ChatMessage[];
  /**
   * The `requestId` returned by the most recent
   * `aiChatStream` call. Used by the event
   * demux to filter incoming `ai://*` events.
   * `null` when no request is in flight.
   */
  activeRequestId: string | null;
  /** The current request lifecycle state. */
  requestStatus: RequestStatus;
  /**
   * 5b-6: the current tool-execution round
   * count. Starts at `0` and increments
   * each time the model emits a tool call
   * that we execute. Capped at
   * `MAX_TOOL_ROUNDS`. Reset to `0` when
   * a new user message starts.
   */
  toolRound: number;
  /**
   * 5d: the in-flight confirmation prompt,
   * or `null` if no tool is awaiting
   * approval. While this is non-null, the
   * `requestStatus` is `'awaitingConfirmation'`
   * and the tool-loop is paused. The
   * `ConfirmToolCallModal` reads this and
   * calls `resolveConfirmation()` on
   * button click. Cleared on `clearMessages`,
   * on `stop()`, and on a stale
   * confirmation race (the user pauses to
   * decide, then the stream is cancelled
   * — see `resolveConfirmation`).
   */
  pendingConfirmation: PendingConfirmation | null;
  /** The model id to use for new requests. */
  model: string;
  /** The provider id to use for new requests. */
  provider: string;
  /** The full provider list, loaded lazily. */
  providers: ProviderInfo[];
  /**
   * The set of provider ids that currently have
   * a key in the keychain. `undefined` until the
   * first `loadProviders()` call. The store
   * doesn't auto-load this — `AIPanel` calls
   * `loadProviders` on mount.
   */
  configuredProviders: string[] | undefined;

  /** Send a new user message and start streaming.
   * 5b-6: returns the id of the new streaming
   * assistant message (so the execution loop
   * can track it across rounds). Returns
   * `null` on validation or setup failure. */
  send: (text: string) => Promise<string | null>;
  /**
   * Send a system-prompted user message (5b-5).
   * Used by the CmdKModal where the caller wants
   * to set the model's role/behavior via a system
   * message (e.g. "You are a precise code editor")
   * and the actual task via a user message. The
   * resulting `messages` array sent to the
   * provider is `[system, user]` — the
   * CmdKModal uses this to inject the editor
   * role without polluting the chat-thread
   * state.
   *
   * Returns the id of the new streaming
   * assistant message (so the caller can
   * read the response when `ai://done`
   * arrives), or `null` on setup failure
   * (no message was appended in that case).
   *
   * Behaves like `send` for all other
   * concerns (no-op if a request is already
   * in flight, seals the streaming message
   * on transport error, etc.).
   */
  sendEdit: (args: {
    systemPrompt: string;
    userMessage: string;
  }) => Promise<string | null>;
  /**
   * Stop the in-flight request (if any). No-op
   * if no request is in flight. The store
   * doesn't wait for `ai://done` after this —
   * the Rust side will emit `done` shortly.
   */
  stop: () => Promise<void>;
  /** Clear the error banner (when in `'error'` state). */
  clearError: () => void;
  /** Change the model for future requests. */
  setModel: (model: string) => void;
  /** Change the provider for future requests. */
  setProvider: (provider: string) => void;
  /**
   * Load the provider list and the configured-set
   * from the keychain. Call this from the
   * AIPanel's `useEffect(() => loadProviders(),
   * [])` so the model picker has data.
   */
  loadProviders: () => Promise<void>;
  /**
   * Reset the chat thread to empty. Used by a
   * "New chat" button in 5c.
   */
  clearMessages: () => void;
  /**
   * 5d: resolve the in-flight confirmation
   * prompt. Called by
   * `ConfirmToolCallModal` when the user
   * clicks [Deny] / [Run once] / [Always
   * allow].
   *
   * The decision is one of:
   *   - `'deny'` — record a synthetic
   *     `kind: 'error'` result on the call
   *     and resume the tool-loop (the
   *     model sees the denial and
   *     self-corrects).
   *   - `'allow_once'` — execute the call
   *     now without changing the policy.
   *     For `per_call` tools, the round
   *     flag is also set so subsequent
   *     calls of the same tool in the
   *     same round proceed silently.
   *   - `'allow_always'` — set the
   *     tool's `confirmationMode` to
   *     `'always_allow'` and execute the
   *     call. The user won't be prompted
   *     for this tool again until they
   *     change the policy.
   *
   * If the in-flight `requestId` no longer
   * matches the `activeRequestId` (e.g.
   * the user cancelled the stream while
   * the modal was open), the call is a
   * no-op — the stale prompt is cleared
   * and the tool-loop is not re-entered.
   *
   * `editedArgsJson` is the
   * 5c edit-args-before-run
   * hook: when the user has
   * edited the JSON in the
   * confirmation modal, the
   * modal passes the edited
   * value here. The store
   * writes it to the
   * `ToolCall.input` field
   * before execution so:
   *   1. The follow-up stream
   *      sees the edited args
   *      in its `tool` message
   *      (replay uses edited
   *      values, not the
   *      model's).
   *   2. The activity log
   *      records the edited
   *      args.
   *   3. The ToolTrace UI
   *      shows the executed
   *      args.
   * Pass `undefined` (the
   * default) to execute the
   * model's original args
   * unchanged. The store
   * does NOT validate the
   * JSON here — the modal
   * has already done that
   * (the Run/Allow buttons
   * are disabled when
   * invalid). If the caller
   * passes invalid JSON,
   * the tool executor's own
   * parse step will produce
   * a sensible error.
   */
  resolveConfirmation: (
    decision: 'deny' | 'allow_once' | 'allow_always',
    editedArgsJson?: string,
  ) => void;
}

/**
 * Generate a client-side message id. We don't
 * need cryptographic randomness here — just
 * uniqueness within a session so React keys
 * are stable.
 */
function genMessageId(): string {
  const n = Math.floor(Math.random() * 0xffffffff);
  return `msg_${n.toString(16).padStart(8, '0')}`;
}

/**
 * 5d: pretty-print a JSON string for
 * display in the `ConfirmToolCallModal`.
 * Falls back to the raw string if
 * parsing fails (the model may have
 * emitted invalid JSON — we still
 * want to show the user SOMETHING).
 */
function prettyJson(s: string): string {
  if (!s) return '';
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

/**
 * 5b-6: convert a local `ChatMessage` to the
 * wire-format `ChatMessageArgs`. The local
 * type carries execution state on `toolCalls`
 * (status, result) that we don't want to
 * send to the provider; this helper strips
 * those down to the canonical wire fields.
 *
 * For tool result messages, we set
 * `toolCallId` from the local `toolCallId`
 * and `content` from the result. For
 * assistant messages, we include `toolCalls`
 * so the provider sees the model's previous
 * tool calls (and can pair them with the
 * result messages we're about to send).
 */
function messageToArgs(m: ChatMessage): ChatMessageArgs {
  const args: ChatMessageArgs = {
    role: m.role,
    content: m.content,
  };
  if (m.toolCalls.length > 0) {
    args.toolCalls = m.toolCalls.map((tc) => ({
      id: tc.id,
      name: tc.name,
      arguments: tc.input,
    }));
  }
  if (m.toolCallId) {
    args.toolCallId = m.toolCallId;
  }
  return args;
}

// --- 5b-6: tool execution loop ---------------------------------------------
//
// The execution loop is the core of the
// tool-using agent flow. After every
// `ai://done`, the store checks the last
// assistant message for unexecuted tool
// calls. If any are present and we haven't
// hit the cap, we:
//   1. Mark them 'running' and flip
//      `requestStatus` to `'executing-tools'`.
//   2. Look up each tool's handler in
//      the registry and run them in
//      parallel (Promise.all). Each
//      handler is a pure async function
//      `(args) => string` (or a thrown
//      error).
//   3. Update each call with its result
//      (`status: 'done' | 'error'`,
//      `result: { output, kind, durationMs }`).
//   4. Append a `role: 'tool'` message
//      to the thread for each call (the
//      result content + `toolCallId`).
//   5. Start a follow-up `aiChatStream`
//      with the updated thread — the
//      model will see the results and
//      either respond with text or emit
//      more tool calls (recursive).
//
// The loop is driven by `onAiDone` above
// + this `runToolExecutionRound` helper.
// The `executeToolCall` dependency is
// injected via the module-level
// `getToolExecutor` indirection so tests
// can swap it out for a mock without
// reaching into module state.

/**
 * 5b-6: the signature of a single tool's
 * handler. The registry's `executeToolCall`
 * (in `toolRegistry.ts`) is the thin
 * wrapper that wraps the handler in a
 * try/catch and returns the
 * `ToolExecutionResult`. The store calls
 * `executeToolCall` with the call's id +
 * name + JSON argument string; the
 * registry looks up the handler, runs it,
 * and returns the result + duration.
 *
 * The store doesn't call handlers
 * directly — it goes through the
 * registry so the registry owns the
 * try/catch + timing logic. This
 * signature mirrors `executeToolCall`'s
 * shape exactly.
 */
export type ToolExecutor = (
  args: { toolCallId: string; name: string; arguments: string },
) => Promise<{
  output: string;
  kind: 'text' | 'json' | 'error';
  durationMs: number;
}>;

/**
 * Module-level indirection for the tool
 * executor. Set once at module load (in
 * `registerToolExecutor` below) and used
 * by `runToolExecutionRound`. Tests call
 * `registerToolExecutor` to inject a
 * mock.
 */
let _toolExecutor: ToolExecutor | null = null;

/**
 * Register the tool executor. Called
 * once at app startup (from
 * `EditorWorkspace.tsx`'s
 * `useEffect(() => { registerToolExecutor(executeToolCall); }, [])`).
 * In production, this is the real
 * `executeToolCall` from `toolRegistry.ts`.
 * In tests, this is a mock that returns
 * deterministic results.
 */
export function registerToolExecutor(executor: ToolExecutor): void {
  _toolExecutor = executor;
}

/**
 * 5b-7: snapshot the user's enabled tool
 * set for a single `aiChatStream` request.
 * Returns the names of all registered tools
 * that are NOT in the `disabledToolNames`
 * set on the `toolSettingsStore`. This list
 * is what we send to the Rust side as
 * `enabledToolNames` — the Rust side uses
 * it to filter the `tools: [...]` array
 * sent to the model.
 *
 * We snapshot on every `send()` / follow-up
 * so a mid-request toggle applies to the
 * NEXT request, not the in-flight one (the
 * in-flight one already had the tool list
 * declared when the Rust task started
 * reading the request body).
 *
 * `listTools()` is dynamic — it includes
 * 5c+ custom tools when they register
 * themselves. We always pass the FRESH
 * list, not a cached one.
 */
function getEnabledToolNamesSnapshot(): string[] {
  const disabled = useToolSettingsStore.getState().disabledToolNames;
  const disabledSet = new Set(disabled);
  return listTools()
    .filter((t) => !disabledSet.has(t.name))
    .map((t) => t.name);
}

/**
 * 5c: snapshot the user's custom tool
 * definitions for a single
 * `aiChatStream` request. Returns the
 * `LipiToolEntry` list from the
 * `customToolsStore`, projected into
 * the `CustomToolSpec` shape the Rust
 * side wants (name / description /
 * args). The actual command / url /
 * body fields are stripped — those are
 * only for the JS executor, not the
 * provider tool declaration.
 *
 * The `enabledToolNames` filter still
 * applies on the Rust side: a custom
 * tool whose name is not in the
 * enabled list is invisible to the
 * model. The store doesn't pre-filter
 * here — let the Rust side make the
 * final decision so the wire format
 * is a faithful snapshot of the
 * runtime state.
 *
 * We snapshot on every `send()` /
 * follow-up / `sendEdit()` so a
 * mid-request edit to `lipi-tools.json`
 * applies to the NEXT request, not
 * the in-flight one.
 */
function getCustomToolSpecsSnapshot(): CustomToolSpec[] {
  const entries = useCustomToolsStore.getState().tools;
  return entries.map((e) => ({
    name: e.name,
    description: e.description,
    // 5c: the runtime `LipiToolArgSpec.type`
    // is the wire string. The Rust side
    // accepts any string, but the provider
    // schema only knows `'string'`. We
    // pass it through as-is — a 5d+
    // enhancement can narrow this.
    args: e.argsSpec.map((a) => ({
      name: a.name,
      type: a.type as 'string',
      description: a.description,
    })),
  }));
}

/**
 * 5b-6: execute a single round of tool
 * calls and start a follow-up stream.
 * This is the body of the tool-execution
 * loop. It's split out of `onAiDone` so
 * it can be unit-tested directly.
 *
 * Steps:
 *   1. Transition the store to
 *      `'executing-tools'` and mark
 *      the calls `'running'`.
 *   2. Execute all `pendingCallIds` in
 *      parallel.
 *   3. Update each call with its result
 *      and append a `role: 'tool'`
 *      message per call.
 *   4. Start a follow-up stream with
 *      the updated thread.
 *
 * Errors are non-fatal: a single failed
 * tool just gets `status: 'error'` and
 * its result is still sent to the model
 * so it can react.
 */
async function runToolExecutionRound(
  messagesBefore: ChatMessage[],
  assistantMessageId: string,
  pendingCallIds: string[],
  round: number,
): Promise<void> {
  // 1. Mark status + calls running.
  useAiStore.setState({
    requestStatus: { kind: 'executingTools', round },
    activeRequestId: null,
    messages: messagesBefore.map((m) =>
      m.id === assistantMessageId
        ? {
            ...m,
            toolCalls: m.toolCalls.map((tc) =>
              pendingCallIds.includes(tc.id)
                ? { ...tc, status: 'running' as const }
                : tc,
            ),
          }
        : m,
    ),
    toolRound: round,
  });

  // 2. Execute all calls in parallel.
  // If no executor is registered
  // (e.g. in a test that didn't
  // call `registerToolExecutor`),
  // fall back to a "skipped" stub
  // so the loop doesn't crash.
  //
  // 5b-7: we snapshot the enabled-tool
  // predicate ONCE per round, not per
  // call, so a mid-round toggle doesn't
  // partially apply. The predicate comes
  // from the shared `toolSettingsStore`
  // — the Settings screen is the source
  // of truth. The Rust side ALSO filters
  // the `tools: [...]` array sent to the
  // model (so a disabled tool is invisible
  // to the model) but this is the
  // belt-and-braces check for the
  // "user toggled off mid-stream" race.
  const isToolEnabled = (name: string) =>
    useToolSettingsStore.getState().isEnabled(name);
  // 5d: per-tool confirmation policy. We
  // ALSO need to know the active
  // `requestId` so the modal resolver can
  // verify the call is still live. We
  // snapshot the policy predicate the
  // same way (once per round) so a
  // mid-round policy change doesn't
  // partially apply.
  const shouldConfirmTool = (
    name: string,
    confirmedForRound: boolean,
  ): boolean =>
    useToolSettingsStore
      .getState()
      .shouldConfirm(name, confirmedForRound);
  const executor: ToolExecutor =
    _toolExecutor ??
    (async ({ name }) => ({
      output: `No executor registered for tool '${name}'`,
      kind: 'error' as const,
      durationMs: 0,
    }));

  // Find the call objects we need
  // to execute.
  const callsToExecute =
    messagesBefore
      .find((m) => m.id === assistantMessageId)
      ?.toolCalls.filter((tc) => pendingCallIds.includes(tc.id)) ?? [];

  // 5d: PAUSE-ON-CONFIRM. If any call in
  // this round needs user approval, park
  // the round BEFORE entering the
  // parallel executor. We pick the FIRST
  // call that needs confirmation (in
  // tool-call order — the order the
  // model emitted them) and surface a
  // modal. The remaining calls in the
  // round are held in
  // `pendingCallIds`-equivalent state
  // (the `assistantMessageId` +
  // `pendingCallIds` arguments don't
  // change — the next invocation of
  // `runToolExecutionRound` will re-read
  // them and re-execute).
  //
  // For `per_call` policy, we
  // pre-mark the call as "confirmed for
  // this round" in a local set so
  // re-entry doesn't re-prompt for the
  // same call. The set is reset on a
  // new `send()` (via the existing
  // `toolRound: 0` reset).
  //
  // `activeRequestId` is null at this
  // point (the round's `setState` at
  // the top of this function set it
  // to null, AND `ai://done` had
  // already arrived). We need a
  // stable id to put on the prompt so
  // the resolver can verify liveness
  // — the `lastStreamRequestId` set
  // by `send()` / `sendEdit()` is
  // the source.
  const currentRequestId = lastStreamRequestId;
  const firstToConfirm = callsToExecute.find(
    (tc) =>
      isToolEnabled(tc.name) &&
      shouldConfirmTool(tc.name, isToolConfirmedForRound(tc.name)),
  );
  if (firstToConfirm && currentRequestId) {
    // Park the round. We do NOT mark
    // the call as `status: 'running'`
    // — keep it at its previous
    // status (which is the default
    // `'pending'`) so the ToolTrace
    // renders the call with a clear
    // "awaiting your approval" hint.
    // (Future 5d+ polish: add a
    // `'awaiting_confirmation'`
    // status.)
    useAiStore.setState({
      requestStatus: { kind: 'awaitingConfirmation' },
      pendingConfirmation: {
        toolCallId: firstToConfirm.id,
        toolName: firstToConfirm.name,
        toolDescription:
          getTool(firstToConfirm.name)?.description ?? '',
        argsJson: prettyJson(firstToConfirm.input),
        assistantMessageId,
        requestId: currentRequestId,
        round,
      },
    });
    return;
  }

  const results = await Promise.all(
    callsToExecute.map(async (tc) => {
      // 5b-7: per-tool enable/disable. The
      // user can disable a tool from the
      // Settings screen; we consult the
      // snapshot of the enabled predicate
      // before invoking the executor. The
      // executor (the real `executeToolCall`
      // from `toolRegistry`) ALSO has its
      // own disabled-check, so a tool that
      // the user just toggled off is
      // double-gated.
      if (!isToolEnabled(tc.name)) {
        return {
          id: tc.id,
          output: `Tool '${tc.name}' is disabled. Enable it in Settings → AI Tools to allow the model to use it.`,
          kind: 'error' as const,
          durationMs: 0,
        };
      }
      try {
        const { output, kind, durationMs } = await executor({
          toolCallId: tc.id,
          name: tc.name,
          arguments: tc.input,
        });
        return { id: tc.id, output, kind, durationMs };
      } catch (e) {
        // Defensive — the executor is
        // supposed to catch its own
        // errors, but if it throws,
        // we still want a result so
        // the model can react.
        const message = e instanceof Error ? e.message : String(e);
        return {
          id: tc.id,
          output: `Tool '${tc.name}' threw: ${message}`,
          kind: 'error' as const,
          durationMs: 0,
        };
      }
    }),
  );

  // 3. Update the call entries with
  // their results and append a
  // `role: 'tool'` message per call.
  // We type the empty `toolCalls`
  // array explicitly because TS
  // would otherwise infer `never[]`
  // and complain when assigning
  // back to the store (the new
  // `ToolCall` shape has mandatory
  // `status` / `result` fields —
  // see the `ToolCall` interface
  // above).
  const toolResultMessages: ChatMessage[] = results.map((r) => ({
    id: genMessageId(),
    role: 'tool',
    content: r.output,
    streaming: false,
    toolCalls: [] as ChatMessage['toolCalls'],
    toolCallId: r.id,
  }));

  // Build the new messages array
  // and the thread for the
  // follow-up stream. The thread
  // is the FULL thread up to and
  // including the assistant
  // message we just executed
  // tools for, PLUS the tool
  // result messages.
  const updatedMessages = useAiStore.getState().messages.map((m) =>
    m.id === assistantMessageId
      ? {
          ...m,
          toolCalls: m.toolCalls.map((tc) => {
            const r = results.find((res) => res.id === tc.id);
            if (!r) return tc;
            return {
              ...tc,
              status: r.kind === 'error' ? ('error' as const) : ('done' as const),
              result: {
                toolCallId: tc.id,
                output: r.output,
                kind: r.kind,
                durationMs: r.durationMs,
              },
            };
          }),
        }
      : m,
  );

  useAiStore.setState({
    messages: [...updatedMessages, ...toolResultMessages],
  });

  // 4. Start a follow-up stream.
  // 5d: factored to `startFollowUpStream`
  // so the confirmation resolver can
  // re-use it (the 5b-6 happy path is
  // identical to the "last call in
  // the round was a confirmed allow"
  // path). The caller passes the
  // messages list AS IT STANDS (already
  // includes the tool result messages);
  // the helper appends the new
  // assistant placeholder and starts
  // the stream.
  await startFollowUpStream(
    [...updatedMessages, ...toolResultMessages],
  );
}

/**
 * 5d: apply a confirmation decision
 * and resume the tool-loop. Called
 * from the `resolveConfirmation` store
 * action after the user clicks
 * [Deny] / [Run once] / [Always allow].
 *
 * The flow is:
 *   1. Find the call entry in the
 *      assistant message and compute
 *      its result (synthetic error
 *      for `deny`, real executor
 *      output for `allow_*`).
 *   2. Patch the call entry with the
 *      result and clear
 *      `pendingConfirmation`.
 *   3. If THIS call was the only one
 *      in the round, start the
 *      follow-up stream directly. If
 *      there are other calls in the
 *      same round, re-enter
 *      `runToolExecutionRound` with
 *      the still-pending call ids
 *      (the resolver is a
 *      single-call-at-a-time model —
 *      each click executes ONE call
 *      and re-enters the loop, which
 *      may park again on the next
 *      `shouldConfirm: true` call).
 *
 * For `per_call` policy, the
 * `allow_once` decision marks the
 * tool as "confirmed for this
 * round" in a local set so the
 * re-entry of `runToolExecutionRound`
 * doesn't re-prompt for the same
 * call. The set is held in a
 * module-level `WeakSet`/`Set` —
 * the simpler choice is a
 * `Set<toolCallId>` cleared at the
 * end of the round (after the
 * follow-up stream starts).
 */
async function applyConfirmationAndResume(
  pending: PendingConfirmation,
  decision: 'deny' | 'allow_once' | 'allow_always',
  /**
   * 5c: the args JSON that should be
   * executed. Normally the resolver
   * passes the same string it logged
   * (the model's original if the
   * user didn't edit, or the
   * user's edited version if they
   * did). We write it to
   * `call.input` before the executor
   * runs so the audit trail,
   * ToolTrace, and follow-up stream
   * all see the executed args.
   *
   * `deny` short-circuits before
   * this matters — we never
   * execute a denied call.
   */
  executedArgsJson: string,
): Promise<void> {
  const state = useAiStore.getState();
  // Stale check — the user cancelled
  // or the stream errored while the
  // modal was open. The caller already
  // cleared the prompt; we just
  // abort. (We use
  // `lastStreamRequestId` for the same
  // reason as the resolver — by the
  // time we're parked,
  // `activeRequestId` is `null`.)
  if (pending.requestId !== lastStreamRequestId) {
    return;
  }

  // Find the call entry to update.
  const call = state.messages
    .find((m) => m.id === pending.assistantMessageId)
    ?.toolCalls.find((tc) => tc.id === pending.toolCallId);
  if (!call) {
    // The call vanished from the
    // message thread (e.g. the user
    // cleared messages — though
    // `clearMessages` refuses during
    // `'awaitingConfirmation'`, this
    // is a defensive check). Clear
    // the prompt and abort.
    useAiStore.setState({ pendingConfirmation: null });
    return;
  }

  // 5c: write the executed args
  // back to `call.input` so the
  // audit trail (activity log,
  // ToolTrace, follow-up stream
  // tool message) all reflect
  // what actually ran. This is
  // a no-op when the user
  // didn't edit (the resolver
  // falls back to the original
  // `pending.argsJson`, which
  // is the pretty-printed
  // version of the same
  // string).
  //
  // We do this BEFORE the
  // executor runs so the
  // executor sees the edited
  // args (the executor takes
  // `arguments: call.input`).
  if (
    decision !== 'deny' &&
    executedArgsJson !== call.input
  ) {
    useAiStore.setState((s) => ({
      messages: s.messages.map((m) =>
        m.id !== pending.assistantMessageId
          ? m
          : {
              ...m,
              toolCalls: m.toolCalls.map((tc) =>
                tc.id !== pending.toolCallId
                  ? tc
                  : { ...tc, input: executedArgsJson },
              ),
            },
      ),
    }));
  }

  // Step 1: compute the result.
  let output: string;
  let kind: 'text' | 'json' | 'error';
  let durationMs: number;
  if (decision === 'deny') {
    output = `Tool '${pending.toolName}' was denied by the user.`;
    kind = 'error';
    durationMs = 0;
  } else {
    // Execute the call now. The
    // executor is the JS
    // `toolRegistry` (same as the
    // 5b-6 happy path). The
    // `isEnabled` predicate is
    // consulted for symmetry with
    // the happy path, but the
    // modal only opens for
    // ENABLED tools, so this is
    // always `true` here.
    const executor: ToolExecutor =
      _toolExecutor ??
      (async ({ name }) => ({
        output: `No executor registered for tool '${name}'`,
        kind: 'error' as const,
        durationMs: 0,
      }));
    // The executor parses `call.input`
    // itself (the JS `toolRegistry`'s
    // `executeToolCall` does the JSON
    // parse + fallback to `{}` for
    // malformed inputs — we don't
    // re-parse here).
    const start = Date.now();
    try {
      const r = await executor({
        toolCallId: call.id,
        name: pending.toolName,
        // 5c: pass the
        // EXECUTED args, not
        // the stale
        // `call.input` (the
        // stale reference
        // still holds the
        // model's original
        // — we just
        // overwrote the
        // store's copy). The
        // executor parses
        // this string.
        arguments: executedArgsJson,
      });
      output = r.output;
      kind = r.kind;
      durationMs = r.durationMs;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      output = `Tool '${pending.toolName}' threw: ${message}`;
      kind = 'error';
      durationMs = Date.now() - start;
    }
  }

  // Step 2: patch the call entry +
  // append a `role: 'tool'`
  // message. We mirror the 5b-6
  // happy path exactly so the
  // follow-up stream sees the
  // same shape.
  const toolResultMessage: ChatMessage = {
    id: genMessageId(),
    role: 'tool',
    content: output,
    streaming: false,
    toolCalls: [] as ChatMessage['toolCalls'],
    toolCallId: call.id,
  };
  const updatedMessages = useAiStore.getState().messages.map((m) =>
    m.id === pending.assistantMessageId
      ? {
          ...m,
          toolCalls: m.toolCalls.map((tc) =>
            tc.id === call.id
              ? {
                  ...tc,
                  status: kind === 'error' ? ('error' as const) : ('done' as const),
                  result: {
                    toolCallId: call.id,
                    output,
                    kind,
                    durationMs,
                  },
                }
              : tc,
          ),
        }
      : m,
  );

  // If this was the LAST pending
  // call in the round, clear
  // `pendingConfirmation` and
  // start the follow-up stream
  // directly. Otherwise, mark
  // the call as
  // `confirmedForRound: true`
  // (for `per_call` tools) and
  // re-enter `runToolExecutionRound`
  // for the remaining calls.
  const remainingCallIds = updatedMessages
    .find((m) => m.id === pending.assistantMessageId)
    ?.toolCalls.filter(
      (tc) =>
        tc.id !== call.id &&
        tc.result === undefined,
    )
    .map((tc) => tc.id) ?? [];

  if (remainingCallIds.length === 0) {
    // All calls in the round are
    // resolved. Start the
    // follow-up stream.
    useAiStore.setState({
      messages: [...updatedMessages, toolResultMessage],
      pendingConfirmation: null,
    });
    await startFollowUpStream([
      ...updatedMessages,
      toolResultMessage,
    ]);
  } else {
    // More calls in the round —
    // re-enter the loop.
    // We mark THIS tool as
    // confirmed-for-round so a
    // `per_call` policy doesn't
    // re-prompt for the same call.
    if (decision === 'allow_once' || decision === 'allow_always') {
      markToolConfirmedForRound(pending.toolName);
    }
    useAiStore.setState({
      messages: [...updatedMessages, toolResultMessage],
      pendingConfirmation: null,
    });
    await runToolExecutionRound(
      [...updatedMessages, toolResultMessage],
      pending.assistantMessageId,
      remainingCallIds,
      pending.round,
    );
  }
}

/**
 * 5d: per-round "user already approved
 * this tool" set. Cleared on a new
 * `send()` (the existing
 * `set({ toolRound: 0 })` path is
 * extended in `send` / `sendEdit`).
 *
 * Module-level (NOT store state) so
 * `runToolExecutionRound` can read it
 * without depending on the store.
 * The set is small (≤ the number of
 * distinct tools called in a single
 * round — typically 1-2).
 */
let confirmedForRound = new Set<string>();

/**
 * 5d: the requestId of the most
 * recently-started `ai_chat_stream`
 * invoke. We need a stable id to put
 * on the `pendingConfirmation` record
 * (the modal resolver checks it
 * against `activeRequestId` to detect
 * a stale decision — the in-flight
 * stream was cancelled while the
 * modal was open).
 *
 * `activeRequestId` is NOT sufficient:
 * by the time `runToolExecutionRound`
 * parks the round, `ai://done` has
 * already arrived and the store has
 * cleared `activeRequestId` to `null`.
 * The round itself also sets
 * `activeRequestId: null` at the top
 * (to "release" the active stream for
 * the follow-up). So we capture the
 * id at the `send()` / `sendEdit()`
 * point and use THAT for the prompt.
 */
let lastStreamRequestId: string | null = null;
function markToolConfirmedForRound(toolName: string): void {
  confirmedForRound.add(toolName);
}
function clearConfirmedForRound(): void {
  confirmedForRound = new Set();
}
function isToolConfirmedForRound(toolName: string): boolean {
  return confirmedForRound.has(toolName);
}

/**
 * 5d: start the follow-up stream after
 * a tool round finishes. Factored out
 * of `runToolExecutionRound` so the
 * confirmation resolver can re-use it
 * when the LAST call in a round
 * resolves. The behaviour is
 * identical to the 5b-6 happy path.
 *
 * The caller passes the FULL messages
 * list AS IT STANDS — i.e. already
 * including the round's tool result
 * message(s). The helper appends the
 * new assistant placeholder and starts
 * the follow-up stream against this
 * thread.
 */
async function startFollowUpStream(
  messagesForThread: ChatMessage[],
): Promise<void> {
  const state = useAiStore.getState();
  const followUpPlaceholder: ChatMessage = {
    id: genMessageId(),
    role: 'assistant',
    content: '',
    streaming: true,
    toolCalls: [],
  };
  // Build the thread for the
  // follow-up stream. We use the
  // messages we were handed
  // (which already include the
  // tool result message(s) — they're
  // the input to the model's next
  // turn).
  const threadForFollowUp: ChatMessageArgs[] = [
    ...messagesForThread.map(messageToArgs),
  ];

  useAiStore.setState({
    messages: [...messagesForThread, followUpPlaceholder],
    requestStatus: { kind: 'streaming' },
    activeRequestId: null,
  });

  try {
    const requestId = await aiChatStream({
      provider: state.provider,
      model: state.model || undefined,
      messages: threadForFollowUp,
      enabledToolNames: getEnabledToolNamesSnapshot(),
      customTools: getCustomToolSpecsSnapshot(),
    });
    // 5d: capture for confirmation
    // prompts (the follow-up stream
    // can ALSO trigger a confirmation
    // if the model calls a
    // `per_call` / `always_confirm`
    // tool).
    lastStreamRequestId = requestId;
    useAiStore.setState({ activeRequestId: requestId });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    useAiStore.setState((s) => ({
      requestStatus: {
        kind: 'error',
        errorKind: 'transport',
        message: `Failed to start follow-up stream: ${message}`,
      },
      activeRequestId: null,
      messages: s.messages.map((m) =>
        m.streaming ? { ...m, streaming: false } : m,
      ),
    }));
  }
  // Clear the per-round confirmation
  // set AFTER the follow-up stream
  // starts (or fails) — the round
  // is done.
  clearConfirmedForRound();
}

// --- Module-level event subscription --------------------------------------
//
// We subscribe to the three `ai://*` events ONCE
// at module load. The callbacks route to the
// store via a small helper that grabs the
// current `activeRequestId` from the store's
// `getState()`. This avoids the Zustand
// subscription boilerplate in the store actions
// (which would be fragile — the store would
// need to track its own subscription ID and
// expose an unlisten function, which doesn't
// fit the action-based API).
//
// The subscriptions are fire-and-forget. If they
// fail (e.g. the event name is wrong on the
// Rust side), the error is logged to console
// but doesn't crash the app — `AIPanel` will
// just appear "stuck" (a request in flight
// forever, no events arriving). That's a
// debuggable failure mode, not a crash.
//
// We use a `let` binding for the unlisten
// functions so tests / hot-reload can call
// them if needed (currently not exposed).
//
// `subscribed` is a flag to prevent
// double-subscription in dev hot-reload.

let subscribed = false;

function setupSubscriptions(getState: () => AiState) {
  if (subscribed) return;
  subscribed = true;

  onAiChunk((envelope) => {
    const state = getState();
    // Demux by requestId: ignore events for
    // requests we don't own (e.g. a previous
    // session's stream that finished after we
    // moved on). 32 hex chars is enough
    // entropy that collisions are negligible.
    if (envelope.requestId !== state.activeRequestId) {
      if (import.meta.env.DEV) {
        logger.warn(
          '[aiStore] ai://chunk for unknown requestId',
          envelope.requestId,
        );
      }
      return;
    }
    const payload: ChatChunkPayload = envelope.payload;
    if (payload.kind === 'error') {
      // Mid-stream error (vs `ai://error` which
      // is pre-chunk). Surface as the same
      // banner.
      useAiStore.setState({
        requestStatus: {
          kind: 'error',
          errorKind: payload.errorKind,
          message: payload.message,
        },
        // Seal the streaming message. The
        // accumulated deltas and tool
        // calls are kept as-is — the
        // user can see the partial
        // response.
        messages: state.messages.map((m) =>
          m.streaming ? { ...m, streaming: false } : m,
        ),
        activeRequestId: null,
      });
    } else if (payload.kind === 'done') {
      // The Rust side emits a `done` chunk in
      // addition to the `ai://done` event.
      // Both arrive within a few ms; the
      // event-handler below (onAiDone) is
      // the authoritative "stream is over"
      // signal. We seal the streaming
      // message here as well as a
      // belt-and-braces (in case `ai://done`
      // arrives but the in-flight chunk
      // processing is delayed by a
      // microtask).
      useAiStore.setState({
        messages: state.messages.map((m) =>
          m.streaming ? { ...m, streaming: false } : m,
        ),
      });
    } else if (payload.kind === 'delta') {
      // 5b-4: real-time streaming render.
      // Append `payload.text` to the
      // streaming assistant message's
      // `content`. We only touch the
      // LAST message (the one with
      // `streaming: true`) and only if
      // it exists. If the demux somehow
      // fires for a request whose
      // placeholder was cleared, the
      // delta is dropped (and logged in
      // dev).
      const lastIdx = state.messages.length - 1;
      const last = lastIdx >= 0 ? state.messages[lastIdx] : undefined;
      if (last && last.streaming) {
        useAiStore.setState({
          messages: state.messages.map((m, i) =>
            i === lastIdx && m.streaming
              ? { ...m, content: m.content + payload.text }
              : m,
          ),
        });
      } else if (import.meta.env.DEV) {
        // No streaming placeholder — the
        // delta is orphaned. This can
        // happen if the user cancelled
        // (the placeholder was sealed in
        // the `stop()` action) but a
        // trailing chunk still arrived.
        // Silently drop.
        logger.warn(
          '[aiStore] ai://chunk delta arrived with no streaming placeholder',
        );
      }
    } else if (payload.kind === 'toolCall') {
      // 5b-4 → 5b-6: tool-call chunks. Append
      // `{ id, name, input, status: 'pending' }`
      // to the streaming assistant message's
      // `toolCalls` array. The `status: 'pending'`
      // (5b-6) marks the call as "queued —
      // execution loop hasn't picked it up yet".
      // The execution loop transitions it to
      // `'running'` → `'done'` | `'error'` |
      // `'skipped'` once it processes the call.
      const lastIdx = state.messages.length - 1;
      const last = lastIdx >= 0 ? state.messages[lastIdx] : undefined;
      if (last && last.streaming) {
        useAiStore.setState({
          messages: state.messages.map((m, i) =>
            i === lastIdx && m.streaming
              ? {
                  ...m,
                  toolCalls: [
                    ...m.toolCalls,
                    {
                      id: payload.id,
                      name: payload.name,
                      input: payload.input,
                      status: 'pending' as const,
                    },
                  ],
                }
              : m,
          ),
        });
      } else if (import.meta.env.DEV) {
        logger.warn(
          '[aiStore] ai://chunk toolCall arrived with no streaming placeholder',
        );
      }
    }
  });

  onAiDone((envelope: DoneEnvelope) => {
    const state = getState();
    if (envelope.requestId !== state.activeRequestId) {
      if (import.meta.env.DEV) {
        logger.warn(
          '[aiStore] ai://done for unknown requestId',
          envelope.requestId,
        );
      }
      // 5d: a stale `ai://done` (the user
      // cancelled the stream, or the
      // modal's prompt was open) is
      // implicitly a clear of any
      // pending confirmation. Drop
      // the prompt if it belongs to
      // the same requestId; if it
      // belongs to a different
      // requestId, leave it alone (it
      // belongs to a different
      // stream).
      if (
        state.pendingConfirmation &&
        state.pendingConfirmation.requestId === envelope.requestId
      ) {
        useAiStore.setState({ pendingConfirmation: null });
      }
      return;
    }
    // Seal the streaming message. The
    // accumulated deltas + tool calls
    // are kept as-is — the user sees
    // the full response. We do NOT
    // transition to 'idle' yet — the
    // execution loop (5b-6) might need
    // to take over if the assistant
    // emitted tool calls. See below.
    const sealed = state.messages.map((m) =>
      m.streaming ? { ...m, streaming: false } : m,
    );
    // Find the last assistant message
    // (the one we just sealed).
    const lastAssistant = [...sealed]
      .reverse()
      .find((m) => m.role === 'assistant');
    // Should always exist — every
    // `send` appends an assistant
    // placeholder, so the one we
    // just sealed is the last. Be
    // defensive.
    if (!lastAssistant) {
      useAiStore.setState({
        requestStatus: { kind: 'idle' },
        activeRequestId: null,
        messages: sealed,
      });
      return;
    }
    // 5b-6: tool-execution loop.
    //   1. If the last assistant message
    //      has `pending` tool calls, the
    //      model asked us to run them.
    //      We need to:
    //        a) transition to
    //           `'executing-tools'`
    //        b) mark the calls `'running'`
    //        c) execute them (Promise.all)
    //        d) append the result messages
    //           to the local thread
    //        e) start a follow-up stream
    //           with the updated thread
    //   2. If the assistant has no
    //      tool calls, OR the previous
    //      round already finished
    //      executing them, OR we've
    //      hit the cap — transition to
    //      'idle' and we're done.
    const pendingCalls = lastAssistant.toolCalls.filter(
      (tc) => tc.status === 'pending',
    );
    if (
      pendingCalls.length > 0 &&
      state.toolRound < MAX_TOOL_ROUNDS
    ) {
      // Kick off the next tool round.
      // We do this async — the
      // synchronous portion of this
      // handler just transitions the
      // status and marks the calls
      // running. The async portion
      // (execute + send follow-up)
      // happens in a void Promise.
      // We `.catch` so a thrown error
      // in the loop doesn't propagate
      // to the runtime as an unhandled
      // rejection — instead it surfaces
      // as a friendly transport error
      // in the chat thread.
      void runToolExecutionRound(
        sealed,
        lastAssistant.id,
        pendingCalls.map((tc) => tc.id),
        state.toolRound + 1,
      ).catch((e) => {
        const message = e instanceof Error ? e.message : String(e);
        useAiStore.setState((s) => ({
          requestStatus: {
            kind: 'error',
            errorKind: 'transport',
            message: `Tool loop failed: ${message}`,
          },
          activeRequestId: null,
          messages: s.messages.map((m) =>
            m.streaming ? { ...m, streaming: false } : m,
          ),
        }));
      });
      return;
    }
    if (pendingCalls.length > 0 && state.toolRound >= MAX_TOOL_ROUNDS) {
      // Hit the cap. The assistant
      // wanted more tools, but we
      // refuse. Surface a friendly
      // error so the user knows
      // what happened.
      useAiStore.setState({
        requestStatus: {
          kind: 'error',
          errorKind: 'toolLoop',
          message:
            'The AI asked for too many tool rounds — try a simpler question.',
        },
        activeRequestId: null,
        messages: sealed,
      });
      return;
    }
    // No pending tools, or all
    // tools already executed on a
    // previous round — just clear
    // the lifecycle state.
    useAiStore.setState({
      requestStatus: { kind: 'idle' },
      activeRequestId: null,
      messages: sealed,
    });
  });

  onAiError((envelope: ErrorEnvelope) => {
    const state = getState();
    if (envelope.requestId !== state.activeRequestId) {
      if (import.meta.env.DEV) {
        logger.warn(
          '[aiStore] ai://error for unknown requestId',
          envelope.requestId,
        );
      }
      return;
    }
    useAiStore.setState({
      requestStatus: {
        kind: 'error',
        errorKind: envelope.kind,
        message: envelope.message,
      },
      activeRequestId: null,
      messages: state.messages.map((m) =>
        m.streaming ? { ...m, streaming: false } : m,
      ),
    });
  });
}

/**
 * The Zustand store. The `set` callback is the
 * only way to update state; the event
 * subscription above calls `useAiStore.setState`
 * directly to demux events.
 */
export const useAiStore = create<AiState>((set, get) => ({
  messages: [],
  activeRequestId: null,
  requestStatus: { kind: 'idle' },
  toolRound: 0,
  pendingConfirmation: null,
  model: '',
  provider: 'openai',
  providers: [],
  configuredProviders: undefined,

  async send(text) {
    const trimmed = text.trim();
    if (!trimmed) return null;

    // If we're in an error state, clear it —
    // sending a new message is the user's
    // "ack" of the error. We also reset
    // `toolRound` to 0 — this is a new
    // user-initiated turn, so the
    // execution loop counter starts
    // fresh (5b-6).
    const current = get();
    if (current.requestStatus.kind === 'error') {
      set({ requestStatus: { kind: 'idle' }, toolRound: 0 });
    } else if (current.requestStatus.kind === 'idle') {
      // Reset on a fresh send too (defensive
      // — e.g. user clicked Send after a
      // long idle period and toolRound was
      // left at a non-zero value by a bug).
      set({ toolRound: 0 });
    }
    // 5d: a new user turn is a new
    // "round" for the `per_call`
    // confirmation policy. Clear the
    // per-round "already approved"
    // set so a `per_call` tool
    // re-prompts on the first call
    // of this turn.
    clearConfirmedForRound();
    if (current.requestStatus.kind === 'streaming') {
      // The user clicked Send while a
      // previous request is still in
      // flight. The current 5b-3 model
      // is to ignore the new send (no
      // queueing). 5b-4 may add a
      // "queue" affordance.
      if (import.meta.env.DEV) {
        logger.warn(
          '[aiStore] send() ignored: a request is already in flight',
        );
      }
      return null;
    }
    if (current.requestStatus.kind === 'executingTools') {
      // 5b-6: a tool-execution round is in
      // progress (the model emitted a call
      // and the JS-side registry is running
      // it). Wait for it to finish before
      // sending a new message — otherwise
      // the new send would orphan the
      // in-flight tools and the store's
      // toolRound counter would desync.
      if (import.meta.env.DEV) {
        logger.warn(
          '[aiStore] send() ignored: a tool-execution round is in progress',
        );
      }
      return null;
    }

    // Append the user message and an empty
    // streaming assistant placeholder. The
    // placeholder is the message we'll
    // append deltas + tool calls to during
    // the stream, and seal on `ai://done`.
    const userMessage: ChatMessage = {
      id: genMessageId(),
      role: 'user',
      content: trimmed,
      streaming: false,
      toolCalls: [],
    };
    const assistantPlaceholder: ChatMessage = {
      id: genMessageId(),
      role: 'assistant',
      content: '',
      streaming: true,
      toolCalls: [],
    };

    // Build the `messages` array the Rust
    // side expects. We pass the *previous*
    // thread plus the new user message —
    // the assistant placeholder is local
    // only (the Rust side will generate the
    // assistant's response; we just track
    // it on the client for the render).
    //
    // 5b-6: we also include the
    // `tool_calls` (assistant) and
    // `tool_call_id` (tool result) fields
    // from the local message store, so a
    // long-running chat thread carries its
    // tool-execution history forward across
    // requests. (The local message store
    // already has the assistant's previous
    // tool calls and the tool result
    // messages we appended — we just
    // shape them for the wire.)
    const threadForRust: ChatMessageArgs[] = [
      ...current.messages
        .filter((m) => !m.streaming) // exclude the empty placeholder
        .map(messageToArgs),
      { role: 'user', content: trimmed },
    ];

    // Optimistic state update: append the
    // user message and the assistant
    // placeholder, set requestStatus, but
    // DON'T set activeRequestId yet — we
    // get that from the invoke result. The
    // events arriving before
    // activeRequestId is set will be
    // dropped (they're for the new request
    // we don't know about yet). That's
    // fine — the Rust side doesn't start
    // streaming until we call invoke, and
    // invoke returns before the first
    // chunk.
    set({
      messages: [...current.messages, userMessage, assistantPlaceholder],
      requestStatus: { kind: 'streaming' },
      activeRequestId: null,
    });

    try {
      const requestId = await aiChatStream({
        provider: current.provider,
        model: current.model || undefined,
        messages: threadForRust,
        // 5b-7: per-tool enable/disable. The
        // Rust side uses this to filter the
        // `tools: [...]` array sent to the
        // model — a disabled tool is invisible
        // to the model from the very first
        // chunk. We snapshot at send-time so
        // the model knows what it can call
        // BEFORE the first token lands.
        enabledToolNames: getEnabledToolNamesSnapshot(),
        // 5c: custom tools. The Rust side
        // merges these with the built-in
        // tool catalogue and declares the
        // combined set to the model. We
        // snapshot the current
        // `customToolsStore` state so the
        // model sees whatever the user has
        // configured at send-time.
        customTools: getCustomToolSpecsSnapshot(),
      });
      // 5d: remember the requestId at
      // module scope. We need it on
      // the `pendingConfirmation` record
      // so the resolver can verify
      // liveness; `activeRequestId` is
      // cleared to `null` once
      // `ai://done` arrives, so it
      // can't carry the id across
      // the round.
      lastStreamRequestId = requestId;
      // The Rust side has the requestId
      // and will start emitting events
      // any moment. Set activeRequestId
      // so the event callbacks can demux.
      set({ activeRequestId: requestId });
      return assistantPlaceholder.id;
    } catch (e) {
      // Setup error (Tauri command not
      // registered, IPC channel closed,
      // etc.). Surface as a chat-thread
      // error and seal the placeholder.
      const message = e instanceof Error ? e.message : String(e);
      set((s) => ({
        requestStatus: {
          kind: 'error',
          errorKind: 'transport',
          message: `Failed to start chat: ${message}`,
        },
        activeRequestId: null,
        messages: s.messages.map((m) =>
          m.streaming ? { ...m, streaming: false } : m,
        ),
      }));
      return null;
    }
  },

  async sendEdit({ systemPrompt, userMessage }) {
    // 5b-5: parallel to `send()` but with an
    // explicit system prompt. Used by the
    // CmdKModal to inject "you are an editor,
    // reply with ONLY the rewritten text"
    // without polluting the chat-thread state.
    //
    // We return the new assistant
    // placeholder's id so the caller can
    // read the response when `ai://done`
    // arrives. Returns `null` on validation
    // or setup failure (in which case no
    // message was appended to the store).
    const trimmed = userMessage.trim();
    if (!trimmed) return null;
    if (!systemPrompt.trim()) return null;

    const current = get();
    if (current.requestStatus.kind === 'streaming') {
      // A request is already in flight.
      // The chat-panel `send` returns
      // silently; we follow the same
      // pattern (CmdKModal disables its
      // submit button while streaming, so
      // this is a belt-and-braces).
      if (import.meta.env.DEV) {
        logger.warn(
          '[aiStore] sendEdit() ignored: a request is already in flight',
        );
      }
      return null;
    }
    if (current.requestStatus.kind === 'error') {
      // Ack the previous error so the
      // banner goes away.
      set({ requestStatus: { kind: 'idle' } });
    }
    // 5d: a new sendEdit is a new
    // "round" for the `per_call`
    // confirmation policy. Clear
    // the per-round "already
    // approved" set so a `per_call`
    // tool re-prompts on the first
    // call of this turn. (Even
    // though `sendEdit` is a
    // one-shot editor flow and
    // unlikely to trigger tool
    // calls, the symmetry with
    // `send` is cheap.)
    clearConfirmedForRound();

    const userMsg: ChatMessage = {
      id: genMessageId(),
      role: 'user',
      content: trimmed,
      streaming: false,
      toolCalls: [],
    };
    const assistantPlaceholder: ChatMessage = {
      id: genMessageId(),
      role: 'assistant',
      content: '',
      streaming: true,
      toolCalls: [],
    };

    // The Rust side gets the system +
    // user messages only (no history
    // bleed-through — this is a
    // single-shot edit, not a chat
    // continuation).
    const threadForRust: ChatMessageArgs[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: trimmed },
    ];

    set({
      messages: [...current.messages, userMsg, assistantPlaceholder],
      requestStatus: { kind: 'streaming' },
      activeRequestId: null,
    });

    try {
      const requestId = await aiChatStream({
        provider: current.provider,
        model: current.model || undefined,
        messages: threadForRust,
        // 5b-7: see `send` for the semantics.
        // Cmd-K edits also go through the
        // same model, so the user's tool
        // preferences apply here too.
        enabledToolNames: getEnabledToolNamesSnapshot(),
        // 5c: see `send` for the semantics.
        // Cmd-K edits see the same custom
        // tool set as the chat panel.
        customTools: getCustomToolSpecsSnapshot(),
      });
      // 5d: same as `send` — capture
      // the id for the confirmation
      // prompt.
      lastStreamRequestId = requestId;
      set({ activeRequestId: requestId });
      // Return the placeholder id so the
      // caller can subscribe to its
      // streaming state.
      return assistantPlaceholder.id;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      set((s) => ({
        requestStatus: {
          kind: 'error',
          errorKind: 'transport',
          message: `Failed to start edit: ${message}`,
        },
        activeRequestId: null,
        messages: s.messages.map((m) =>
          m.streaming ? { ...m, streaming: false } : m,
        ),
      }));
      return null;
    }
  },

  async stop() {
    const current = get();
    if (current.requestStatus.kind !== 'streaming') return;
    if (!current.activeRequestId) return;
    const requestId = current.activeRequestId;
    // Optimistically flip to idle; the
    // Rust side will emit `ai://done`
    // with `cancelled: true` shortly,
    // but the user already sees the
    // panel revert. We do NOT seal
    // the streaming message here —
    // `ai://done` will do that, so
    // the message keeps its
    // accumulated deltas (5b-4) or
    // remains empty (5b-3).
    set({ requestStatus: { kind: 'idle' } });
    try {
      await aiCancelStream(requestId);
    } catch (e) {
      // If cancel failed (e.g. the
      // request already finished), we
      // don't have a great recovery
      // path — the Rust side will
      // eventually emit `ai://done`
      // and clear the state. Log
      // and move on.
      if (import.meta.env.DEV) {
        logger.warn('[aiStore] ai_cancel_stream failed', e);
      }
    }
  },

  clearError() {
    set((s) => {
      if (s.requestStatus.kind !== 'error') return s;
      // 5b-6: also reset toolRound
      // when the user dismisses an
      // error from a too-many-rounds
      // failure. A new user message
      // should start with a clean
      // counter.
      return { requestStatus: { kind: 'idle' }, toolRound: 0 };
    });
  },

  setModel(model) {
    set({ model });
  },

  setProvider(provider) {
    // When the provider changes, clear
    // the model (the old model is
    // probably not in the new
    // provider's availableModels
    // list). The AIPanel will reset
    // the model to the new
    // provider's default via a
    // `useEffect`.
    set({ provider, model: '' });
  },

  async loadProviders() {
    try {
      const [providers, configured] = await Promise.all([
        aiListProviders(),
        aiGetConfiguredProviders(),
      ]);
      const current = get();
      set({
        providers,
        configuredProviders: configured,
        // If the current provider is not
        // configured, fall back to the
        // first configured one (or
        // the first provider if
        // none are configured). If
        // the model is empty, default
        // it to the (new) provider's
        // default.
        provider:
          configured.includes(current.provider)
            ? current.provider
            : (configured[0] ?? current.provider),
        model:
          current.model ||
          (providers.find((p) => p.id === current.provider) ?? providers[0])
            ?.defaultModel ||
          '',
      });
    } catch (e) {
      // IPC failed. Don't crash — the
      // AIPanel will show an empty
      // picker. Log to dev console.
      if (import.meta.env.DEV) {
        logger.warn('[aiStore] loadProviders failed', e);
      }
    }
  },

  clearMessages() {
    // Only clear if no request is in
    // flight (a `clearMessages` during
    // a stream would orphan the
    // Rust-side request — the events
    // would arrive but find no
    // `activeRequestId` match and
    // be dropped). 5b-6: also refuse
    // during `'executing-tools'` —
    // the in-flight tools would be
    // orphaned and the follow-up
    // stream (if any) would fire
    // against an empty thread.
    // 5d: also refuse during
    // `'awaitingConfirmation'` — the
    // pending tool call is a real
    // in-flight state (the user is
    // about to make a decision that
    // we still need to apply).
    const current = get();
    if (
      current.requestStatus.kind === 'streaming' ||
      current.requestStatus.kind === 'executingTools' ||
      current.requestStatus.kind === 'awaitingConfirmation'
    ) {
      return;
    }
    set({
      messages: [],
      requestStatus: { kind: 'idle' },
      toolRound: 0,
      pendingConfirmation: null,
    });
  },

  // --- 5d: confirmation resolver --------------------------------
  //
  // Re-enters the tool-loop after the
  // user has decided on a paused call.
  // The flow is:
  //   1. The user clicks one of the three
  //      buttons in `ConfirmToolCallModal`.
  //   2. The modal calls
  //      `useAiStore.getState().resolveConfirmation(decision)`.
  //   3. The store validates the in-flight
  //      request (if the stream was
  //      cancelled, drop the decision and
  //      clear the prompt).
  //   4. The store records the result for
  //      the tool call (or executes the
  //      call now) and resumes the
  //      tool-loop via a helper.
  //
  // We re-use the same result-recording
  // and follow-up-stream logic as the
  // 5b-6 happy path — the only difference
  // is whether the call was already
  // executed (allow) or the result is
  // synthetic (deny). The helper
  // `applyConfirmationAndResume` below
  // factors out the common path.
  resolveConfirmation(decision, editedArgsJson) {
    const state = get();
    const pending = state.pendingConfirmation;
    if (!pending) return; // Defensive.
    // Stale-confirmation race: the user
    // was deciding when a NEW `send()`
    // ran (which would have cleared the
    // prompt already — this is
    // belt-and-braces) or when the
    // store's `activeRequestId` rolled
    // over to a different stream. The
    // `pending.requestId` was captured
    // at parking time; if it no longer
    // matches `lastStreamRequestId`,
    // the decision is stale. (We use
    // `lastStreamRequestId` instead of
    // `activeRequestId` because the
    // latter is `null` once
    // `ai://done` arrives — see the
    // parking code for context.)
    if (pending.requestId !== lastStreamRequestId) {
      set({ pendingConfirmation: null });
      return;
    }
    // 5c: resolve the "executed args"
    // for this decision. If the
    // caller passed a non-empty
    // `editedArgsJson`, that's the
    // args the user wants executed
    // (and the args the model will
    // see in the follow-up tool
    // message). Otherwise, fall
    // back to the model's original
    // (the modal's
    // `pending.argsJson` is the
    // pretty-printed version of
    // `call.input`).
    //
    // We deliberately do NOT
    // validate the JSON here —
    // the modal has already done
    // that (the Run/Allow buttons
    // are disabled when invalid).
    // If the caller passes invalid
    // JSON, the executor's own
    // parse step will produce a
    // sensible error.
    //
    // We also use this for the
    // activity log (5e) — the log
    // records the EXECUTED args,
    // not the model's original,
    // so a future audit / replay
    // sees what actually ran.
    const executedArgsJson =
      editedArgsJson !== undefined && editedArgsJson !== ''
        ? editedArgsJson
        : pending.argsJson;
    // 5e: record the decision in the
    // persistent log BEFORE delegating
    // to the resume helper. The log
    // is observational — it doesn't
    // affect the tool call's
    // outcome — but we want a record
    // to land even if the resume
    // helper throws (the call still
    // happened, the user still
    // decided, we should still
    // remember). The store truncates
    // `argsPreview` to 2KB.
    useToolDecisionLogStore
      .getState()
      .recordDecision({
        toolName: pending.toolName,
        decision,
        argsPreview: executedArgsJson,
        requestId: pending.requestId,
        assistantMessageId: pending.assistantMessageId,
        // 5f: required for the
        // "jump to chat from
        // Activity Log row"
        // feature — the AIPanel
        // uses this to highlight
        // the specific tool trace
        // within the message.
        toolCallId: pending.toolCallId,
      });
    // 5d: apply the decision. Side
    // effect: for `allow_always`,
    // promote the tool's policy to
    // `always_allow`.
    if (decision === 'allow_always') {
      useToolSettingsStore
        .getState()
        .setConfirmationMode(pending.toolName, 'always_allow');
    }
    // The rest of the path (record the
    // result, append the tool result
    // message, start the follow-up
    // stream) is identical to the 5b-6
    // happy path. We delegate to a
    // helper to keep the resolver
    // readable. The 5c helper
    // signature adds
    // `executedArgsJson` so the
    // helper can write it to
    // `call.input` before the
    // executor runs.
    void applyConfirmationAndResume(
      pending,
      decision,
      executedArgsJson,
    );
  },
}));

// Wire up the module-level event
// subscription. We do this once at
// module load. `getState` is the
// store's getter — the callbacks
// always see the latest state.
setupSubscriptions(useAiStore.getState);

// 5b-7: hydrate the toolSettings store
// from localStorage on startup, and wire
// the persistence subscription so every
// toggle survives a page reload. This
// runs once at module load — the same
// pattern as the AI event subscriptions
// above.
useToolSettingsStore.getState().hydrate();
setupToolSettingsPersistence();

// 5e: hydrate the decision log store.
// Same module-load pattern as the
// settings store. The log is
// observational; the only writer is
// `resolveConfirmation` (below).
useToolDecisionLogStore.getState().hydrate();
setupToolDecisionLogPersistence();

// M2b: hydrate the voice preferences store
// (STT provider choice). Same module-load
// pattern.
useVoicePreferencesStore.getState().hydrate();
setupVoicePreferencesPersistence();

// M2c mobile: hydrate the voice capabilities
// store. The Command Palette's `isEnabled`
// predicates need synchronous access to the
// platform's STT capability flags (e.g. to
// grey-out "Use browser speech engine" on
// Linux where WebKitGTK doesn't ship
// `SpeechRecognition`). We fire-and-forget the
// hydration promise — the store's `capabilities`
// field starts as `null` and flips to populated
// once the IPC resolves. The Command Palette's
// predicates use `?.webSpeech` so the brief
// `null` window is harmless (the row stays
// disabled until hydration completes). The IPC
// itself is one round-trip and the result is
// process-lifetime-cached in `@/voice/capabilities`,
// so the cost is one call at startup. See
// Decision #46 (`docs/decisions/0046-m2c-mobile-shim.md`)
// for the full design.
void useVoiceCapabilitiesStore.getState().hydrate();

// --- Selectors ------------------------------------------------------------

/** Tiny selectors so components can compose. */
export const aiSelectors = {
  messages: (s: AiState) => s.messages,
  requestStatus: (s: AiState) => s.requestStatus,
  activeRequestId: (s: AiState) => s.activeRequestId,
  model: (s: AiState) => s.model,
  provider: (s: AiState) => s.provider,
  providers: (s: AiState) => s.providers,
  configuredProviders: (s: AiState) => s.configuredProviders,
  /**
   * The currently-selected `ProviderInfo`, or
   * `undefined` if the provider id doesn't
   * match any in the loaded list. The
   * `AIPanel` uses this to render the model
   * picker options.
   */
  currentProvider: (s: AiState) =>
    s.providers.find((p) => p.id === s.provider),
};
