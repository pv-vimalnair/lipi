/**
 * Voice module — public surface.
 *
 * Consumers should import from `@/voice`, not from the
 * individual files, so the implementation can swap out
 * (Wispr, on-device, future providers) without changing
 * consumer code.
 *
 * M3 update: the four function-style `transcribeViaX`
 * entry points and the four `*Error` classes are GONE.
 * Use the `VoiceSession` API instead — the canonical
 * entry is `voiceSessionFactories[provider](opts)`
 * (returns a `Promise<VoiceSessionHandle>`). See
 * `src/voice/session.ts` for the interface, the
 * `src/voice/sessions/` directory for the per-provider
 * factories, and HANDOFF §9.9 for the migration writeup.
 */

// M3: the canonical `VoiceSession` interface, error
// class, state machine, and factory registry. Consumers
// import these from `@/voice` rather than reaching into
// the per-provider files.
export type {
  VoiceSession,
  VoiceSessionErrorCode,
  VoiceSessionHandle,
  VoiceSessionState,
  TranscriptSubscription,
} from './session';
export { VoiceSessionError, voiceSessionErrorMessage } from './session';
export type {
  VoiceSessionFactory,
  VoiceSessionFactoryOptions,
} from './sessionFactory';
export { voiceSessionFactories } from './sessionFactory';

// M3: the provider id union (renamed from the M2a
// `VoiceProvider` literal — see HANDOFF Decision #48).
export type {
  VoiceMode,
  VoiceProviderConfig,
  VoiceProviderId,
  TranscriptionEvent,
  VoiceCommand,
} from './types';

// M2b: PCM capture (raw 16kHz / 16-bit / mono). Used
// by the wispr session factory under the hood. Exposed
// here so the tests can drive the helpers without a
// circular import.
export {
  startPcmCapture,
  float32ToInt16,
  encodeInt16AsBase64,
  WISPR_SAMPLE_RATE_HZ,
  PCM_CHUNK_MS,
  PCM_CHUNK_SAMPLES,
  PCM_CHANNELS,
  type PcmCaptureHandle,
  type PcmCaptureOptions,
} from './pcmCapture';

// M4: voice commit grammar. Parses a transcript
// into a `{ kind: 'commit', message }` intent or
// `{ kind: 'not-commit' }`. Consumed by the
// AIPanel's voice-onFinal hook (M4) — the AIPanel
// calls `parseCommitCommand(transcript)` after
// every successful capture and, on a `commit`
// intent, fires `gitCommit(...)` via the
// `@/ipc/git` wrapper.
export {
  parseCommitCommand,
  COMMIT_GRAMMAR_HELP,
  type CommitParseResult,
} from './commitGrammar';

// M2c mobile: cached capability accessor. The
// `useVoiceCapabilitiesStore` reads this on
// hydration; the `WebSpeechCard` and the Command
// Palette's `isEnabled` predicates read from the
// store. Tests use `__resetVoicePlatformCapabilitiesCacheForTests`
// to clear the in-process cache.
export {
  getVoicePlatformCapabilities,
  __resetVoicePlatformCapabilitiesCacheForTests,
} from './capabilities';
