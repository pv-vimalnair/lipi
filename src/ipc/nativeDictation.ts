/**
 * Phase NPS — typed IPC for `get_native_dictation_contract`.
 *
 * Mirrors the Rust contract in
 * `src-tauri/src/native_dictation.rs`. The JS side
 * uses this to render a "Native dictation plugin
 * contract" panel in the Settings voice card — a
 * self-documenting UI showing every IPC method the
 * future iOS Swift / Android Kotlin plugins must
 * implement, the event names they'll emit on, and
 * the error kinds the JS side will receive.
 *
 * On desktop the contract comes back with
 * `status: 'not-applicable'` (the `#[cfg]` arm on
 * the Rust side returns `NotApplicable` for any
 * non-mobile target). The Settings UI reads that
 * and shows "This setting is only available on
 * iOS / Android" instead of crashing.
 */
import { invoke } from '@tauri-apps/api/core';

/** Mirrors the Rust `ContractStatus` enum
 *  (`#[serde(rename_all = "kebab-case")]`). */
export type ContractStatus = 'active' | 'inert' | 'not-applicable';

/** Mirrors the Rust `NativeDictationErrorKind` enum
 *  (kebab-case). The JS-side `useVoiceCapture` hook
 *  maps each kind to a user-facing message
 *  (mirroring the desktop `SttErrorKind` mapping). */
export type NativeDictationErrorKind =
  | 'permission-denied'
  | 'no-input-device'
  | 'backend'
  | 'timeout'
  | 'unknown';

export interface ContractMethod {
  name: string;
  purpose: string;
  signature: string;
}

export interface ContractEvents {
  transcript: string;
  error: string;
}

export interface NativeDictationContract {
  plugin_name: string;
  status: ContractStatus;
  events: ContractEvents;
  methods: ContractMethod[];
  error_kinds: NativeDictationErrorKind[];
}

/** Call the Rust `get_native_dictation_contract`
 *  command. The result is cached by Tauri's IPC
 *  layer for the session, so re-calling in the same
 *  mount is essentially free. The Settings voice
 *  card calls this once on mount. */
export async function getNativeDictationContract(): Promise<NativeDictationContract> {
  return invoke<NativeDictationContract>('get_native_dictation_contract');
}

/** Pure: human-friendly label for a contract status.
 *  Used in the Settings UI. Extracted for testability. */
export function contractStatusLabel(status: ContractStatus): string {
  switch (status) {
    case 'active':
      return 'Ready (plugin binding present)';
    case 'inert':
      return 'Contract ready, plugin binding pending';
    case 'not-applicable':
      return 'Only available on iOS / Android';
  }
}

/** Pure: human-friendly label for an error kind.
 *  Mirrors the `useVoiceCapture` hook's existing
 *  `voiceSessionErrorMessage` mapping for
 *  consistency. */
export function errorKindLabel(kind: NativeDictationErrorKind): string {
  switch (kind) {
    case 'permission-denied':
      return 'Microphone access was blocked. Enable it in your OS settings.';
    case 'no-input-device':
      return 'No speech-recognition engine is available on this device.';
    case 'backend':
      return 'The speech engine reported an error. Try again.';
    case 'timeout':
      return 'The 30-second capture limit was hit. Tap to start a new session.';
    case 'unknown':
      return 'The speech engine reported an unknown error.';
  }
}
