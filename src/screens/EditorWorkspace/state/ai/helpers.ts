/**
 * AI store helpers — pure functions extracted
 * from aiStore.ts for decomposition (Phase 10 / Issue #7).
 */

import type { ChatMessageArgs, CustomToolSpec } from '@/ipc';
import { useCustomToolsStore } from '@/shared/state/customToolsStore';
import { useToolSettingsStore } from '@/shared/state/toolSettingsStore';
import { listTools } from '../toolRegistry';
import type { ChatMessage } from './types';

/**
 * Generate a client-side message id. We don't
 * need cryptographic randomness — just
 * uniqueness within a session so React keys
 * are stable.
 */
export function genMessageId(): string {
  const n = Math.floor(Math.random() * 0xffffffff);
  return `msg_${n.toString(16).padStart(8, '0')}`;
}

/**
 * 5d: pretty-print a JSON string for display
 * in the `ConfirmToolCallModal`. Falls back
 * to the raw string if parsing fails.
 */
export function prettyJson(s: string): string {
  if (!s) return '';
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

/**
 * 5b-6: convert a local `ChatMessage` to the
 * wire-format `ChatMessageArgs`. Strips local
 * execution state (status, result) from
 * toolCalls.
 */
export function messageToArgs(m: ChatMessage): ChatMessageArgs {
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

/**
 * 5b-7: snapshot the user's enabled tool set
 * for a single `aiChatStream` request.
 */
export function getEnabledToolNamesSnapshot(): string[] {
  const disabled = useToolSettingsStore.getState().disabledToolNames;
  const disabledSet = new Set(disabled);
  return listTools()
    .filter((t) => !disabledSet.has(t.name))
    .map((t) => t.name);
}

/**
 * 5c: snapshot the user's custom tool definitions
 * for a single `aiChatStream` request.
 */
export function getCustomToolSpecsSnapshot(): CustomToolSpec[] {
  const entries = useCustomToolsStore.getState().tools;
  return entries.map((e) => ({
    name: e.name,
    description: e.description,
    args: e.argsSpec.map((a) => ({
      name: a.name,
      type: a.type,
      description: a.description,
    })),
  }));
}
