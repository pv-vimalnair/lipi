/**
 * Welcome screen — barrel.
 *
 * Exports the public surface of the Welcome screen:
 * - `<Welcome />` — the screen component.
 * - `useOpenWorkspace` — the hook that bridges the
 *   "Open Folder" UI to the Tauri filesystem.
 * - `openWorkspace` — the pure control flow that
 *   `useOpenWorkspace` wraps. Exported for callers
 *   outside the Welcome screen that need to open a
 *   folder without rendering a React tree (e.g. the
 *   command palette's "Open Folder…" command).
 */
export { Welcome } from './Welcome';
export { useOpenWorkspace, openWorkspace } from './hooks/useOpenWorkspace';
