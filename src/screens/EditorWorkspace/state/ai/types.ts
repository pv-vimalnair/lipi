/**
 * AI store types — extracted from aiStore.ts for
 * decomposition (Phase 10 / Issue #7).
 *
 * All shared type definitions used across the AI
 * chat store live here. The store's actions and
 * module-level code remain in `aiStore.ts`.
 */

import type { ProviderInfo } from '@/ipc';

/**
 * A single tool call attached to an assistant
 * message. Mirrors the Rust
 * `ChatDelta::ToolCall { id, name, input }`
 * shape. Stored on `ChatMessage.toolCalls`
 * (5b-4).
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
 * call.
 */
export type ToolCallStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'error'
  | 'skipped';

/**
 * 5b-6: the result of executing a tool call.
 */
export interface ToolResult {
  /** The tool call's id. */
  toolCallId: string;
  /** The result content as a string. */
  output: string;
  /** `'text' | 'json' | 'error'`. */
  kind: 'text' | 'json' | 'error';
  /** Wall-clock duration in ms. */
  durationMs?: number;
}

/**
 * A single message in the chat thread.
 */
export interface ChatMessage {
  /** Client-side stable id, e.g. `msg_<12 hex chars>`. */
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  /** Full text content (or streaming accumulator). */
  content: string;
  /** True while the assistant message is being streamed. */
  streaming: boolean;
  /** Tool calls emitted by the model (5b-4 / 5b-6). */
  toolCalls: Array<ToolCall & {
    status: ToolCallStatus;
    result?: ToolResult;
  }>;
  /** Present on tool result messages (`role: 'tool'`). */
  toolCallId?: string;
}

/**
 * The current state of the request lifecycle.
 * Discriminated union.
 */
export type RequestStatus =
  | { kind: 'idle' }
  | { kind: 'streaming' }
  | { kind: 'executingTools'; round: number }
  | { kind: 'awaitingConfirmation' }
  | { kind: 'error'; errorKind: string; message: string };

/**
 * 5d: the record describing the in-flight
 * confirmation prompt.
 */
export interface PendingConfirmation {
  toolCallId: string;
  toolName: string;
  toolDescription: string;
  argsJson: string;
  assistantMessageId: string;
  requestId: string;
  round: number;
}

/**
 * 5b-6: the signature of a single tool's handler.
 */
export type ToolExecutor = (
  args: { toolCallId: string; name: string; arguments: string },
) => Promise<{
  output: string;
  kind: 'text' | 'json' | 'error';
  durationMs: number;
}>;

/**
 * 5b-6: the maximum number of tool-execution
 * rounds allowed per user message.
 */
export const MAX_TOOL_ROUNDS = 3;

/**
 * The full AI store state interface (state + actions).
 */
export interface AiState {
  messages: ChatMessage[];
  activeRequestId: string | null;
  requestStatus: RequestStatus;
  toolRound: number;
  pendingConfirmation: PendingConfirmation | null;
  model: string;
  provider: string;
  providers: ProviderInfo[];
  configuredProviders: string[] | undefined;

  send: (text: string) => Promise<string | null>;
  sendEdit: (args: {
    systemPrompt: string;
    userMessage: string;
  }) => Promise<string | null>;
  stop: () => Promise<void>;
  clearError: () => void;
  setModel: (model: string) => void;
  setProvider: (provider: string) => void;
  loadProviders: () => Promise<void>;
  clearMessages: () => void;
  resolveConfirmation: (
    decision: 'deny' | 'allow_once' | 'allow_always',
    editedArgsJson?: string,
  ) => void;
}
