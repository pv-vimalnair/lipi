/**
 * Voice module — public surface.
 *
 * Consumers should import from `@/voice`, not from the individual files,
 * so the implementation can swap out (Wispr, on-device, future
 * providers) without changing consumer code.
 */

// M3 (deferred): the session-based streaming API
// design. The interfaces are defined in
// `./types.ts` for the future M3 work; M2b doesn't
// use them — the M2b path uses the function-style
// `transcribeViaWispr()` from `./wisprClient`.
// Re-exported here so future M3 code can import
// the contract from `@/voice`.
export type {
  VoiceProvider,
  VoiceSession,
  VoiceSessionState,
  TranscriptionEvent,
  VoiceCommand,
  VoiceError,
  VoiceMode,
  VoiceProviderConfig,
} from './types';

// M2b: low-level Wispr WS client. The hook imports
// `transcribeViaWispr` directly — it doesn't need
// the M3 streaming-session abstractions yet.
export {
  transcribeViaWispr,
  rmsVolume,
  wisprErrorMessage,
  WisprClientError,
  LIPI_APP_CONTEXT,
  WISPR_DEFAULT_TIMEOUT_MS,
  WISPR_WS_ENDPOINT,
  type WisprClientOptions,
  type WisprClientErrorCode,
  type WisprAppContext,
} from './wisprClient';

// M2b: PCM capture (raw 16kHz / 16-bit / mono, for
// Wispr). The M2a `MediaRecorder` path lives in
// `useVoiceCapture.ts`; the PCM path is exported here
// so the hook can use it without a circular import.
export {
  startPcmCapture,
  float32ToInt16,
  encodeInt16AsBase64,
  pcmCaptureErrorMessage,
  PcmCaptureError,
  WISPR_SAMPLE_RATE_HZ,
  PCM_CHUNK_MS,
  PCM_CHUNK_SAMPLES,
  PCM_CHANNELS,
  type PcmCaptureHandle,
  type PcmCaptureOptions,
  type PcmCaptureErrorCode,
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
