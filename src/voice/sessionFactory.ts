/**
 * sessionFactory — M3 single dispatch point for the five
 * STT providers.
 *
 * Replaces the M2a/b/c 4-branch `if/else` ladder in
 * `useVoiceCapture.start()` (lines 344-356 of the pre-M3
 * file). The hook now does:
 *
 *   ```ts
 *   const handle = await voiceSessionFactories[provider](opts);
 *   const session = handle.session;
 *   session.onStateChange((s) => voiceStore.setState(s));
 *   session.onTranscription((e) => voiceStore.appendTranscript(e));
 *   session.onError((err) => voiceStore.setLastError(err));
 *   ```
 *
 * That's the entire start path. There is no per-provider
 * branching left in the hook.
 *
 * Why a `Record<VoiceProviderId, ...>` and not a switch
 * statement: TypeScript exhaustively type-checks the keys
 * of the record, so adding a 6th provider (e.g. a Whisper
 * C++ backend) is a one-line addition to the union + the
 * record, and the compiler flags every factory function
 * that needs to be updated.
 *
 * Construction-injection seams per provider (for tests):
 *   - stub:           no injection; nothing to fake
 *   - wispr:          `webSocketCtor` (default `globalThis.WebSocket`)
 *   - ondevice:       `sttStartOverride` / `sttStopOverride`,
 *                     `subscribeTranscript` / `subscribeError`
 *                     (all in `VoiceSessionFactoryOptions`)
 *   - webSpeech:      `webSpeechCtor` / `windowOverride`
 *   - nativeDictation: stub; no injection
 */

import { createNativeDictationSession } from './sessions/nativeDictationSession';
import { createOnDeviceSession } from './sessions/onDeviceSession';
import { createStubSession } from './sessions/stubSession';
import { createWebSpeechSession } from './sessions/webSpeechSession';
import { createWisprSession } from './sessions/wisprSession';
import type { TranscriptSubscription } from './session';
import type {
  VoiceMode,
  VoiceProviderConfig,
  VoiceProviderId,
} from './types';

/** Options every factory receives. Provider-specific seams
 *  live under their own `*Override` keys (so adding a 6th
 *  provider only adds a new optional key, no breaking change). */
export interface VoiceSessionFactoryOptions {
  /** The active voice mode. Immutable for the lifetime of the session. */
  readonly mode: VoiceMode;
  /** The user-supplied provider config (API keys, language, etc.). */
  readonly config?: VoiceProviderConfig;
  /** Abort signal. When fired, the session MUST stop, emit
   *  a `VoiceSessionError('aborted' | 'cancelled')`, and
   *  transition to `state === 'closed'`. The same signal is
   *  surfaced through `VoiceSessionHandle.abort()` so the
   *  consumer has one cancellation API. */
  readonly signal: AbortSignal;
  /** BCP-47 language tag (e.g. "en-US"). `undefined` = auto-detect. */
  readonly language?: string;

  /* --- wispr --- */
  /** Override the WebSocket constructor (test seam). */
  readonly webSocketCtor?: typeof WebSocket;

  /* --- ondevice --- */
  /** Override `sttStartListening` (test seam). */
  readonly sttStartOverride?: (opts: {
    sessionId: string;
    language?: string;
  }) => Promise<void>;
  /** Override `sttStopListening` (test seam). */
  readonly sttStopOverride?: (sessionId: string) => Promise<void>;
  /** Override the transcript subscription (test seam). */
  readonly subscribeTranscript?: (
    handler: (event: { sessionId: string; text: string; isFinal: boolean; confidence?: number; timestamp: number }) => void,
  ) => TranscriptSubscription;
  /** Override the error subscription (test seam). */
  readonly subscribeError?: (
    handler: (event: { sessionId: string; code: string; message: string; retryable: boolean }) => void,
  ) => TranscriptSubscription;

  /* --- webSpeech --- */
  /** Override the SpeechRecognition constructor (test seam). */
  readonly webSpeechCtor?: new () => unknown;
  /** Override the global window (test seam). */
  readonly windowOverride?: {
    SpeechRecognition?: new () => unknown;
    webkitSpeechRecognition?: new () => unknown;
  };
}

/** The factory contract. Every provider implements this. */
export type VoiceSessionFactory = (
  opts: VoiceSessionFactoryOptions,
) => Promise<import('./session').VoiceSessionHandle>;

/** The single dispatch point. Exhaustively type-checked by
 *  TypeScript — adding a new `VoiceProviderId` value without
 *  adding a factory is a compile error. */
export const voiceSessionFactories: Record<VoiceProviderId, VoiceSessionFactory> = {
  stub: createStubSession,
  wispr: createWisprSession,
  ondevice: createOnDeviceSession,
  webSpeech: createWebSpeechSession,
  nativeDictation: createNativeDictationSession,
};

/** Re-export so consumers can `import { type VoiceSession } from '@/voice'`. */
export type { VoiceSession, VoiceSessionError, VoiceSessionErrorCode, VoiceSessionHandle, VoiceSessionState } from './session';
export { voiceSessionErrorMessage } from './session';
