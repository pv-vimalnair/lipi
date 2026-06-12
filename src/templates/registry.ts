/**
 * Phase J — the registry of workspace starter templates.
 *
 * The display surface for the Welcome screen's "Template
 * gallery": each card shows one template's name, a one-line
 * description, and a "Create" button. The actual file
 * bodies live in Rust (`src-tauri/src/templates.rs`); the
 * JS side only ships the metadata here so the gallery can
 * render without round-tripping to Rust.
 *
 * Adding a new template is a two-step process:
 *   1. Add a `WorkspaceTemplate` entry below.
 *   2. Add the matching `Template` const + body in
 *      `src-tauri/src/templates.rs`. Both must agree on
 *      the `id` (the registry tests assert the union).
 *
 * The registry's `id` is the single source of truth for
 * the gallery; the Rust side rejects unknown ids with
 * `TemplateError::UnknownId`.
 */

export type WorkspaceTemplateId =
  | 'react-vite'
  | 'tauri-rust'
  | 'node-api'
  | 'python-venv'
  | 'go-module';

export interface WorkspaceTemplate {
  /** Stable id, mirrored in Rust. */
  id: WorkspaceTemplateId;
  /** Card title. */
  name: string;
  /** One-line description, ~10 words. */
  description: string;
  /** Display-only file count badge. The real count
   *  is computed by Rust at apply time. */
  fileCount: number;
}

export const WORKSPACE_TEMPLATES: readonly WorkspaceTemplate[] = [
  {
    id: 'react-vite',
    name: 'React + Vite + TypeScript',
    description: 'Modern React app with Vite dev server and TypeScript.',
    fileCount: 9,
  },
  {
    id: 'tauri-rust',
    name: 'Tauri 2 + React + Rust',
    description: 'Cross-platform desktop app with Rust backend and React UI.',
    fileCount: 12,
  },
  {
    id: 'node-api',
    name: 'Node.js + TypeScript API',
    description: 'Zero-dep HTTP API on Node 20 with TypeScript.',
    fileCount: 6,
  },
  {
    id: 'python-venv',
    name: 'Python with venv',
    description: 'Python 3.12 project with venv and pytest.',
    fileCount: 6,
  },
  {
    id: 'go-module',
    name: 'Go module',
    description: 'Go 1.22 module with a `main` and a `_test.go`.',
    fileCount: 5,
  },
] as const;

/** Look up a template by id. Returns `undefined` for
 *  unknown ids (callers should fall back to a generic
 *  error). */
export function workspaceTemplateById(
  id: WorkspaceTemplateId,
): WorkspaceTemplate | undefined {
  return WORKSPACE_TEMPLATES.find((t) => t.id === id);
}
