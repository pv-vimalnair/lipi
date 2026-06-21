/**
 * LSP client store types — extracted from
 * lspClientStore.ts for decomposition (Phase 10 / Issue #8).
 *
 * All shared type definitions used across the LSP
 * subsystem live here.
 */

import type { LspServerKind } from '@/ipc/lsp';

/** Re-export for consumers that import from this file. */
export type { LspServerKind } from '@/ipc/lsp';

/**
 * The lifecycle status of an LSP server for a given workspace.
 */
export type LspStatus = 'stopped' | 'starting' | 'ready' | 'error';

/** Per-workspace crash details. */
export interface LspCrashInfo {
  stderrTail: string;
  exitStatus: number | null;
  crashedAt: number;
  consecutiveCrashes: number;
  respawnInMs: number | null;
}

/**
 * Phase 9.7 — the live "Server output" panel entry.
 */
export interface LspOutputEntry {
  lines: string[];
  partialLine: string;
  updatedAt: number;
  maxLines: number;
}

/**
 * A JSON-RPC 2.0 message — request, response, or notification.
 */
export type JsonRpcMessage =
  | {
      jsonrpc: '2.0';
      id: number | string;
      method: string;
      params?: unknown;
    }
  | {
      jsonrpc: '2.0';
      id: number | string;
      result?: unknown;
      error?: { code: number; message: string; data?: unknown };
    }
  | {
      jsonrpc: '2.0';
      method: string;
      params?: unknown;
    };

/**
 * A pending in-flight request.
 */
export interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  method: string;
}

/**
 * The wire shape that `monaco-languageclient` consumes.
 */
export interface LspTransport {
  read(): Promise<JsonRpcMessage | null>;
  write(message: JsonRpcMessage): Promise<void>;
  close(): Promise<void>;
}

/** Phase 9.2d — parsed composite key. */
export interface ParsedWorkspaceKindKey {
  workspaceRoot: string;
  kind: LspServerKind;
}
