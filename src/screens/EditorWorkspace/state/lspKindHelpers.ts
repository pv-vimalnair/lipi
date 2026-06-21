/**
 * LSP kind helpers — pure functions and constants
 * for server kind resolution. Extracted from
 * lspClientStore.ts (Phase 10 / Issue #8).
 *
 * No Zustand, no IPC — just extension→kind mapping
 * and kind predicates.
 */

import type { LspServerKind } from './lspTypes';

/**
 * The set of server kinds the *current* build wires up.
 */
export const SUPPORTED_LSP_SERVER_KINDS: readonly LspServerKind[] = [
  'typescript',
  'rust_analyzer',
  'pyright',
] as const;

/**
 * The kinds the *inferrer* recognises.
 * Wider than `SUPPORTED_LSP_SERVER_KINDS`.
 */
const KNOWN_LSP_SERVER_KINDS: readonly LspServerKind[] = [
  'typescript',
  'rust_analyzer',
  'pyright',
] as const;

/**
 * Phase 9.2f — per-kind `DocumentSelector` for
 * Monaco provider registration.
 */
export const KIND_TO_LANGUAGE_IDS: Record<
  LspServerKind,
  readonly string[]
> = {
  typescript: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
  rust_analyzer: ['rust'],
  pyright: ['python'],
  unknown: [],
};

/**
 * Map a file URI to a language-server kind.
 * Extension-based, not language-id-based.
 */
export function inferServerKind(uri: string): LspServerKind {
  const queryStart = uri.search(/[?#]/);
  const pathOnly = queryStart === -1 ? uri : uri.slice(0, queryStart);
  const lastDot = pathOnly.lastIndexOf('.');
  const lastSlash = Math.max(
    pathOnly.lastIndexOf('/'),
    pathOnly.lastIndexOf('\\'),
  );
  if (lastDot <= lastSlash) {
    return 'unknown';
  }
  const ext = pathOnly.slice(lastDot).toLowerCase();
  switch (ext) {
    case '.ts':
    case '.tsx':
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return 'typescript';
    case '.rs':
      return 'rust_analyzer';
    case '.py':
    case '.pyi':
      return 'pyright';
    default:
      return 'unknown';
  }
}

/**
 * `true` when the bridge should actually spawn a child for `kind`.
 */
export function isSupportedKind(kind: LspServerKind): boolean {
  return (SUPPORTED_LSP_SERVER_KINDS).includes(
    kind,
  );
}

/**
 * `true` when `kind` is a known real server (not `'unknown'`).
 */
export function isKnownKind(kind: LspServerKind): boolean {
  return (KNOWN_LSP_SERVER_KINDS).includes(kind);
}

/**
 * Phase 9.2d — composite key for per-workspace maps.
 * Encodes `(workspaceRoot, kind)` as `${root}//${kind}`.
 */
export function workspaceKindKey(
  workspaceRoot: string,
  kind: LspServerKind,
): string {
  return `${workspaceRoot}//${kind}`;
}

/**
 * Phase 9.2d — parse a `workspaceKindKey` back into its parts.
 */
export function parseWorkspaceKindKey(
  key: string,
): { workspaceRoot: string; kind: LspServerKind } | null {
  const sep = key.lastIndexOf('//');
  if (sep === -1) return null;
  const root = key.slice(0, sep);
  const kind = key.slice(sep + 2);
  if (
    kind === 'typescript' ||
    kind === 'rust_analyzer' ||
    kind === 'pyright' ||
    kind === 'unknown'
  ) {
    return { workspaceRoot: root, kind };
  }
  return null;
}
