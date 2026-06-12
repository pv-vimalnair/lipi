/**
 * Typed IPC wrapper for the Rust virtual-filesystem commands.
 *
 * Every call into the Tauri shell goes through a function in this file
 * (or its siblings in `src/ipc/`). Components never call `invoke()`
 * directly — that keeps the Rust contract in one place and makes it
 * trivial to mock for tests or swap providers later.
 *
 * The shapes here are the contract — keep them in lockstep with the
 * `#[derive(Serialize)]` types in `src-tauri/src/fs.rs` and the
 * command signatures in `src-tauri/src/lib.rs`.
 */

import { invoke } from '@tauri-apps/api/core';

export interface FsEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modifiedMs: number;
}

export type FileEncoding = 'utf-8' | 'binary';

export interface FileContent {
  content: string;
  encoding: FileEncoding;
}

/** Tauri error shape serialised from `src-tauri/src/fs.rs::FsError`. */
export interface FsErrorPayload {
  kind:
    | 'NotFound'
    | 'PermissionDenied'
    | 'NotADirectory'
    | 'NotAFile'
    | 'TooLarge'
    | 'AlreadyExists'
    | 'Io';
  detail: string;
}

export class FsError extends Error {
  readonly payload: FsErrorPayload;

  constructor(payload: FsErrorPayload) {
    super(`[${payload.kind}] ${payload.detail}`);
    this.name = 'FsError';
    this.payload = payload;
  }
}

/** Narrow an unknown thrown value into an `FsError` if it matches. */
function asFsError(err: unknown): FsError {
  if (err instanceof FsError) return err;
  if (
    typeof err === 'object' &&
    err !== null &&
    'kind' in err &&
    typeof (err as { kind: unknown }).kind === 'string'
  ) {
    return new FsError(err as FsErrorPayload);
  }
  return new FsError({ kind: 'Io', detail: String(err) });
}

export async function readDir(path: string): Promise<FsEntry[]> {
  try {
    return await invoke<FsEntry[]>('fs_read_dir', { path });
  } catch (err) {
    throw asFsError(err);
  }
}

export async function readFile(path: string): Promise<FileContent> {
  try {
    return await invoke<FileContent>('fs_read_file', { path });
  } catch (err) {
    throw asFsError(err);
  }
}

export async function writeFile(path: string, content: string): Promise<void> {
  try {
    await invoke<void>('fs_write_file', { path, content });
  } catch (err) {
    throw asFsError(err);
  }
}

/** Open the native folder picker. Returns the chosen path or `null`
 *  if the user cancelled. */
export async function pickFolder(): Promise<string | null> {
  try {
    return await invoke<string | null>('fs_pick_folder');
  } catch (err) {
    throw asFsError(err);
  }
}

/**
 * Create an empty file at `path`. Refuses if a
 * file already exists at that path — the JS
 * call site is expected to pick a fresh name
 * (we do not auto-suffix `-1` etc., that's the
 * UI's job — the FileTreePane's "new file"
 * affordance should generate a unique name).
 */
export async function createFile(path: string): Promise<void> {
  try {
    await invoke<void>('fs_create_file', { path });
  } catch (err) {
    throw asFsError(err);
  }
}

/**
 * Delete a file or directory. Directories are
 * deleted recursively (matches `rm -rf`). Refuses
 * if the path doesn't exist — a stale UI button
 * shouldn't silently succeed and mask a deeper
 * problem.
 */
export async function deleteEntry(path: string): Promise<void> {
  try {
    await invoke<void>('fs_delete_entry', { path });
  } catch (err) {
    throw asFsError(err);
  }
}

/**
 * Rename (move) a file or directory within the
 * same filesystem. Refuses if the source doesn't
 * exist or the destination already exists. We
 * intentionally do NOT do a copy+delete fallback
 * across volumes — the UI's rename flow is
 * intra-workspace only.
 */
export async function renameEntry(from: string, to: string): Promise<void> {
  try {
    await invoke<void>('fs_rename_entry', { from, to });
  } catch (err) {
    throw asFsError(err);
  }
}
