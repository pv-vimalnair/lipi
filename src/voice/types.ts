/**
 * Voice-to-Code module — type definitions.
 *
 * Scope of this file: define the SHAPE of the voice system so M2 (capture)
 * and M3 (Wispr + on-device providers) can be built against a stable
 * contract. Implementations live in sibling files (e.g. `WisprClient.ts`,
 * `OnDeviceSTT.ts` in later phases). This file is dependency-free.
 *
 * Why interfaces, not classes, for the core types:
 *   - React components consume them via props; classes add no value.
 *   - Tests can mock them without inheritance gymnastics.
 *   - The Tauri Rust side will serialize the same JSON shape across IPC.
 */

/** What the user is speaking into. Drives where the transcription lands. */
export type VoiceMode = 'dictation' | 'chat' | 'command';

/** M3: the literal union of provider ids. Replaces the M2a
 *  `VoiceProvider` literal union from
 *  `src/shared/state/voicePreferencesStore.ts:44` (renamed
 *  to avoid the collision with the M3-era `VoiceProvider`
 *  *interface* that was scaffolding and is now deleted — see
 *  Decision #48 in HANDOFF.md). */
export type VoiceProviderId =
  | 'stub'
  | 'wispr'
  | 'ondevice'
  | 'webSpeech'
  | 'nativeDictation';

/**
 * A single streaming transcription update. Providers emit `partial` events
 * as the user speaks (low confidence, fast feedback) and one `final` event
 * per utterance (high confidence, replaces all partials).
 *
 * M3: added `sessionId` for the iOS Swift / Android Kotlin
 * plugin contracts (a Tauri `Channel<TranscriptEvent>` may
 * carry events for multiple concurrent sessions; the JS-side
 * factory demuxes by this field). The Rust side sets it on
 * every `stt://transcript` event (5-line change in
 * `src-tauri/src/stt_capture.rs`); the Wispr + Web Speech
 * paths leave it undefined (their protocol is one-session-at-
 * a-time and the JS side knows the id from the factory
 * closure).
 */
export interface TranscriptionEvent {
  readonly kind: 'partial' | 'final';
  readonly text: string;
  /** Provider's own confidence score, 0..1. `undefined` if not reported. */
  readonly confidence?: number;
  /** Monotonic sequence number within the current session. */
  readonly sequence: number;
  /** Wall-clock timestamp (ms since epoch) when the provider emitted this. */
  readonly timestamp: number;
  /** True for the last `final` event of a session. */
  readonly isUtteranceEnd?: boolean;
  /** Detected spoken language (BCP-47, e.g. "en-US"). Provider-dependent. */
  readonly language?: string;
  /** The session id this event belongs to. Set by the
   *  Rust on-device path; `undefined` for the Wispr and
   *  Web Speech paths (their factories own the id
   *  internally and demux on the JS side). */
  readonly sessionId?: string;
}

/** A recognized voice command (Phase M4). The LLM does the heavy lifting. */
export interface VoiceCommand {
  readonly raw: string;
  readonly intent: string;
  readonly args: Record<string, string | number | boolean>;
}

/**
 * User-supplied configuration for a provider. The keyring is the only
 * place these should ever live at rest; in-memory copies are short-lived.
 */
export interface VoiceProviderConfig {
  /** The Wispr API key. Ignored by on-device providers. */
  readonly wisprApiKey?: string;
  /** BCP-47 language tag, e.g. "en-US". `undefined` = auto-detect. */
  readonly language?: string;
}
