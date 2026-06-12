/**
 * webSpeechTypes — minimal local types for the
 * W3C Web Speech API (`SpeechRecognition`).
 *
 * ## Why a local type, not `lib.dom.d.ts`
 *
 * The Web Speech API is non-standard: it's a
 * W3C Community Group draft that never made it
 * to WICG/REC, and TypeScript's `lib.dom.d.ts`
 * deliberately does NOT ship the
 * `SpeechRecognition` / `webkitSpeechRecognition`
 * types. The `window` augmentation below is the
 * established workaround — see
 * `typescript/lib#33311` and the long-standing
 * MDN guidance.
 *
 * We keep the types MINIMAL (only the fields the
 * orchestrator reads) and tag them as
 * `interface` (not `class`) so the WebView
 * constructor and the test fake have the same
 * type. The orchestrator never calls any method
 * outside this list.
 *
 * We do NOT re-declare `webkitSpeechRecognition`
 * separately — the `window` augmentation below
 * puts both `SpeechRecognition` and
 * `webkitSpeechRecognition` on the same
 * constructor type so the orchestrator's
 * `window.SpeechRecognition ?? window.webkitSpeechRecognition`
 * feature-detect is type-checked.
 *
 * The `continuous` and `interimResults` flags are
 * documented as deprecated in the W3C Community
 * Group spec. The orchestrator sets both to
 * `false` for V1; see HANDOFF §9.7 risk R2 for
 * the future-Chromium-collapse mitigation.
 */

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  readonly length: number;
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult:
    | ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => unknown)
    | null;
  onerror:
    | ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => unknown)
    | null;
  onend: ((this: SpeechRecognition, ev: Event) => unknown) | null;
  onstart: ((this: SpeechRecognition, ev: Event) => unknown) | null;
  onaudiostart: ((this: SpeechRecognition, ev: Event) => unknown) | null;
  onaudioend: ((this: SpeechRecognition, ev: Event) => unknown) | null;
  onnomatch:
    | ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => unknown)
    | null;
  start(): void;
  stop(): void;
  abort(): void;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
}

/**
 * Re-export the local types so the orchestrator
 * (and the test files) can import them from a
 * single place without redeclaring the
 * `declare global` block.
 */
export type {
  SpeechRecognition,
  SpeechRecognitionEvent,
  SpeechRecognitionErrorEvent,
  SpeechRecognitionResultList,
  SpeechRecognitionResult,
  SpeechRecognitionAlternative,
};
