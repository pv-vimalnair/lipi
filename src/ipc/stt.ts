/**
 * Typed IPC wrapper for the Rust on-device STT commands.
 *
 * Mirrors `src-tauri/src/stt.rs` (model lifecycle) and
 * `src-tauri/src/stt_capture.rs` (mic capture + inference).
 *
 * ## Two-layer event model
 *
 * The Rust side emits three Tauri events to the main window:
 *
 *   `stt://download-progress`  payload: DownloadProgressEvent
 *                                (id, received, total, done)
 *   `stt://transcript`         payload: TranscriptEvent
 *                                (kind, text, sequence, timestamp,
 *                                 isUtteranceEnd, language?)
 *   `stt://error`              payload: SttErrorPayload
 *                                (kind, message)
 *
 * The JS side subscribes once per event (in the
 * `useVoiceCapture` hook for `transcript` + `error`, in
 * the `VoiceSettings` component for `download-progress`)
 * and demuxes by `sessionId` / `id`. The event names
 * mirror the existing `ai://*` and `terminal://*`
 * namespaces so the `listen()` calls all use the same
 * `<service>://<event>` pattern (see `terminal.ts` and
 * `ai.ts`).
 *
 * ## Why a typed error class (not a discriminated string)
 *
 * Same pattern as `GitError` in `git.ts`: the Rust
 * `SttError` enum serialises to a `{ kind, message }`
 * JSON object, and the JS wrapper reconstructs a
 * `SttError` class instance on the way in. The
 * `VoiceError` in `src/voice/types.ts` reuses these
 * codes (Decision #24 — single taxonomy of error
 * strings for the voice subsystem).
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import type { TranscriptionEvent } from '@/voice/types';

/**
 * One entry in the curated model list. Mirrors the
 * `SttModelDescriptor` struct in `src-tauri/src/stt.rs`.
 *
 *   `id`          — stable id; what `installModel` /
 *                   `setActiveModel` accept
 *   `displayName` — human-readable; what the Settings
 *                   card renders
 *   `sizeBytes`   — approximate on-disk size
 *   `language`    — "en" or "multilingual"
 *   `url`         — the download URL (pinned HF commit
 *                   in production)
 *   `sha256`      — expected SHA-256 of the downloaded
 *                   file. The Rust side verifies on
 *                   install completion; mismatches fail
 *                   the install.
 */
export interface SttModelDescriptor {
  id: string;
  displayName: string;
  sizeBytes: number;
  language: 'en' | 'multilingual';
  url: string;
  sha256: string;
}

/**
 * Payload of the `stt://download-progress` event. The
 * Settings card renders a progress bar from
 * `received / total`; the `done: true` event is the
 * signal to move the model from "Installing" to
 * "Installed".
 */
export interface DownloadProgressEvent {
  id: string;
  received: number;
  total: number;
  done: boolean;
}

/**
 * Payload of the `stt://transcript` event. The Rust
 * `TranscriptEvent` struct serialises to a JSON shape
 * that is structurally identical to the
 * `TranscriptionEvent` interface in
 * `src/voice/types.ts`. We re-export the canonical
 * type under a local alias so the IPC layer's
 * `TranscriptEvent` reads naturally in this file.
 *
 * The Rust side is the source of truth for the wire
 * shape; the voice store reads the same `event.kind`
 * for Wispr events and on-device events.
 */
export type TranscriptEvent = TranscriptionEvent;

/**
 * Error shape from the Rust `SttError` enum. We
 * deliberately match the kebab-case `kind` strings
 * from `#[serde(tag = "kind", rename_all = "kebab-case")]`
 * — see `SttError` in `src-tauri/src/stt.rs`.
 */
export interface SttErrorPayload {
  kind:
    | 'no-active-model'
    | 'unknown-model'
    | 'model-file-missing'
    | 'download-failed'
    | 'checksum-mismatch'
    | 'io'
    | 'inference'
    | 'no-input-device'
    | 'permission-denied'
    | 'cancelled';
  message: string;
}

export class SttError extends Error {
  readonly payload: SttErrorPayload;

  constructor(payload: SttErrorPayload) {
    super(`[${payload.kind}] ${payload.message}`);
    this.name = 'SttError';
    this.payload = payload;
  }
}

function asSttError(err: unknown): SttError {
  if (err instanceof SttError) return err;
  if (
    typeof err === 'object' &&
    err !== null &&
    'kind' in err &&
    typeof (err as { kind: unknown }).kind === 'string'
  ) {
    return new SttError(err as SttErrorPayload);
  }
  return new SttError({ kind: 'io', message: String(err) });
}

/**
 * Optional `stt_start_listening` arg. The Rust side
 * defaults every field to "let the system decide" when
 * the JS sends `undefined`. `language` is only consulted
 * for multilingual models; `maxDurationMs` clamps the
 * session length.
 */
export interface ListenOptions {
  language?: string;
  maxDurationMs?: number;
}

/**
 * Return the curated list of STT models. The Settings
 * panel renders one card per entry. The list is
 * static for a given build (it lives in `stt.rs`'s
 * `CURATED_MODELS` const); it does NOT need to be
 * called repeatedly.
 */
export async function sttListModels(): Promise<SttModelDescriptor[]> {
  try {
    return await invoke<SttModelDescriptor[]>('stt_list_models');
  } catch (err) {
    throw asSttError(err);
  }
}

/**
 * Return the ids of models currently installed on
 * disk. With `m2c-native` off (the dev build), this
 * returns every curated model; with the feature on,
 * it returns only models whose file actually exists
 * and is non-empty.
 */
export async function sttListInstalledModels(): Promise<string[]> {
  try {
    return await invoke<string[]>('stt_list_installed_models');
  } catch (err) {
    throw asSttError(err);
  }
}

/**
 * Returns `true` if the user has a model configured
 * as active. The `useVoiceCapture` hook short-circuits
 * the `'ondevice'` provider to "provider not configured"
 * if this is `false` (and shows a Settings link).
 */
export async function sttIsAvailable(): Promise<boolean> {
  try {
    return await invoke<boolean>('stt_is_available');
  } catch (err) {
    throw asSttError(err);
  }
}

/**
 * Install (download) a model. Emits `stt://download-progress`
 * events at ~4 Hz with `{ id, received, total, done }`.
 * The caller should subscribe to those events BEFORE
 * calling this (the `done: true` event may arrive in
 * <100 ms for a small model on a fast connection).
 *
 * The function resolves when the install completes
 * (file on disk + SHA-256 verified). With
 * `m2c-native` off, the resolve is immediate and
 * `done: true` is emitted as the only event.
 */
export async function sttInstallModel(id: string): Promise<void> {
  try {
    await invoke<void>('stt_install_model', { id });
  } catch (err) {
    throw asSttError(err);
  }
}

/**
 * Remove an installed model. Idempotent. If the
 * removed model was the active one, the active
 * preference is cleared.
 */
export async function sttRemoveModel(id: string): Promise<void> {
  try {
    await invoke<void>('stt_remove_model', { id });
  } catch (err) {
    throw asSttError(err);
  }
}

/**
 * Set the active model. Validates that the id is in
 * the curated list AND (with `m2c-native` on) that
 * the file is on disk.
 */
export async function sttSetActiveModel(id: string): Promise<void> {
  try {
    await invoke<void>('stt_set_active_model', { id });
  } catch (err) {
    throw asSttError(err);
  }
}

/**
 * Start a capture session. Returns the `sessionId`
 * for demuxing events. The caller is responsible for
 * subscribing to `stt://transcript` / `stt://error`
 * BEFORE calling this (transcript events arrive
 * 200 ms after this returns in the stub; they
 * arrive in <50 ms after the corresponding
 * `sttStopListening` call in the real path).
 *
 * Throws `SttError('no-active-model')` if the user
 * hasn't picked a model yet — the caller should
 * gate the call behind `sttIsAvailable()`.
 */
export async function sttStartListening(
  opts?: ListenOptions,
): Promise<string> {
  try {
    return await invoke<string>('stt_start_listening', { opts });
  } catch (err) {
    throw asSttError(err);
  }
}

/**
 * Stop a capture session. Idempotent (calling stop on
 * an unknown session is a no-op). The corresponding
 * `stt://transcript` event will arrive shortly after
 * (200 ms in the stub path; after inference completes
 * in the real path).
 */
export async function sttStopListening(sessionId: string): Promise<void> {
  try {
    await invoke<void>('stt_stop_listening', { sessionId });
  } catch (err) {
    throw asSttError(err);
  }
}

// --- Event subscription helpers --------------------------------------
//
// We expose typed wrappers around `listen()` so the
// components don't need to know the event name strings.
// Same pattern as `terminal.ts` — the wrapper returns
// the `UnlistenFn` so the caller can `unlisten()` on
// unmount.

/** Subscribe to `stt://download-progress` events.
 *  Returns the unlisten function. The callback is
 *  called once per progress event (and exactly once
 *  with `done: true` per `sttInstallModel` call). */
export async function onSttDownloadProgress(
  cb: (event: DownloadProgressEvent) => void,
): Promise<UnlistenFn> {
  return await listen<DownloadProgressEvent>(
    'stt://download-progress',
    (e) => cb(e.payload),
  );
}

/** Subscribe to `stt://transcript` events for all
 *  sessions. The caller demuxes by `event.payload`'s
 *  identifying fields (M2c desktop always emits a
 *  single final per session — no `sessionId` is
 *  embedded in the payload because the MVP allows
 *  one open session at a time). */
export async function onSttTranscript(
  cb: (event: TranscriptEvent) => void,
): Promise<UnlistenFn> {
  return await listen<TranscriptEvent>('stt://transcript', (e) =>
    cb(e.payload),
  );
}

/** Subscribe to `stt://error` events. The payload
 *  mirrors `SttErrorPayload`; the JS side typically
 *  re-wraps this in a `SttError` for the voice
 *  store's error UI. */
export async function onSttError(
  cb: (event: SttErrorPayload) => void,
): Promise<UnlistenFn> {
  return await listen<SttErrorPayload>('stt://error', (e) =>
    cb(e.payload),
  );
}
