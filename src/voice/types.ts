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

/** Lifecycle state of a single voice capture session. */
export type VoiceSessionState =
  | 'idle'
  | 'requesting-permission'
  | 'connecting'
  | 'listening'
  | 'processing'
  | 'error'
  | 'denied';

/**
 * A single streaming transcription update. Providers emit `partial` events
 * as the user speaks (low confidence, fast feedback) and one `final` event
 * per utterance (high confidence, replaces all partials).
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
}

/** A recognized voice command (Phase M4). The LLM does the heavy lifting. */
export interface VoiceCommand {
  readonly raw: string;
  readonly intent: string;
  readonly args: Record<string, string | number | boolean>;
}

/** Runtime error from the provider, normalized across Wispr and on-device. */
export interface VoiceError {
  readonly code:
    | 'permission-denied'
    | 'mic-unavailable'
    | 'network'
    | 'auth'
    | 'provider'
    | 'aborted'
    | 'unknown';
  readonly message: string;
  /** Original provider error, if any. Useful for logging; never shown raw to users. */
  readonly cause?: unknown;
  /** True if the user can retry without changing anything. */
  readonly retryable: boolean;
}

/** The contract every voice provider must implement. */
export interface VoiceProvider {
  /** Stable identifier for logging / settings UI. */
  readonly id: 'wispr' | 'on-device-ios' | 'on-device-android' | 'on-device-desktop';

  /** Human-readable label for the settings UI. */
  readonly label: string;

  /** Whether this provider is available on the current platform right now. */
  isAvailable(): Promise<boolean>;

  /** Whether the user has already granted microphone permission. */
  hasPermission(): Promise<boolean>;

  /**
   * Request microphone permission. On web, this triggers the browser prompt.
   * On native (Tauri), it dispatches to the OS permission dialog.
   */
  requestPermission(): Promise<boolean>;

  /**
   * Open a capture session. The returned session owns the mic stream and
   * the network connection. The caller MUST call `session.close()` to
   * release both — leaking a session will leave the mic indicator on.
   */
  startSession(opts: { mode: VoiceMode; language?: string }): Promise<VoiceSession>;

  /**
   * Suggested order for the settings UI "voice provider" picker.
   * Lower = preferred. Wispr beats on-device on quality, but on-device
   * is the always-works fallback.
   */
  readonly priority: number;
}

/** An open voice capture session. Emit-only events; one session = one mic stream. */
export interface VoiceSession {
  /** Current session state. Subscribe via `onStateChange`. */
  readonly state: VoiceSessionState;

  /** Active mode. Immutable for the lifetime of the session. */
  readonly mode: VoiceMode;

  /** Subscribe to state transitions. Returns an unsubscribe function. */
  onStateChange(listener: (state: VoiceSessionState) => void): () => void;

  /** Subscribe to transcription events (partials + finals). */
  onTranscription(listener: (event: TranscriptionEvent) => void): () => void;

  /**
   * Subscribe to errors. Fires once per error; the session is then in
   * the `error` state and the caller should call `close()` and decide
   * whether to retry.
   */
  onError(listener: (err: VoiceError) => void): () => void;

  /**
   * Force the provider to emit any pending partials as a final event.
   * Useful when the user pauses speaking; we don't want to wait for the
   * provider's own silence threshold.
   */
  flush(): Promise<void>;

  /**
   * Stop capture and tear down mic + network. After `close()`, the session
   * is unusable; call `provider.startSession()` for a new one.
   */
  close(): Promise<void>;
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
