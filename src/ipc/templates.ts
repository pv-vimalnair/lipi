/**
 * Phase J — typed IPC for `apply_template`.
 *
 * The Rust side (`src-tauri/src/templates.rs`) takes a
 * template id + an empty destination directory and
 * expands the template's inlined files into it
 * atomically. The JS hook `useApplyTemplate` is the
 * primary caller; this file is the typed seam so the
 * hook doesn't have to import `invoke` directly (Rule 4).
 *
 * Errors propagate as the `TemplateError` wire shape
 * (the Rust side serialises the variant's `Display` form
 * as a single string — see `templates.rs`'s
 * `Serialize for TemplateError`).
 */
import { invoke } from '@tauri-apps/api/core';

import type { WorkspaceTemplateId } from '@/templates/registry';

export interface ApplyTemplateResult {
  /** Display paths of the files that were created, in
   *  the order they were written. Used by the hook to
   *  show a "Created N files" toast. */
  createdPaths: string[];
  /** The template id that was applied (mirrors the
   *  input — kept for symmetry + future logging). */
  templateId: WorkspaceTemplateId;
}

export async function applyTemplate(
  templateId: WorkspaceTemplateId,
  destDir: string,
): Promise<ApplyTemplateResult> {
  return await invoke<ApplyTemplateResult>('apply_template', {
    templateId,
    destDir,
  });
}
