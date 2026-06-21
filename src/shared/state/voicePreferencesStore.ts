/**
 * voicePreferencesStore — the user's voice STT provider
 * preference (M2b + M2c mobile).
 *
 * M2b ships two providers: `'wispr'` (the headline
 * path; real WebSocket to Flow) and `'stub'` (the M2a
 * debug placeholder). M2c desktop adds `'ondevice'`
 * (Whisper via Rust cpal+whisper). M2c mobile adds
 * `'webSpeech'` (the WebView's `window.SpeechRecognition`
 * — the M2c mobile shim; see Decision #46 and
 * `docs/decisions/0046-m2c-mobile-shim.md`).
 *
 * The store holds the CURRENT preference. The
 * `VoiceButton` reads it on mount and re-renders when
 * it changes, so the Command Palette can flip the
 * provider on the fly.
 *
 * M2c mobile also adds a `language` field (BCP-47,
 * e.g. `'en-US'`, `'en'`, `'de-DE'`, `'default'`).
 * Persisted, single setting. Used by the
 * `'webSpeech'` and `'ondevice'` providers — Wispr
 * picks its own server-side language detection and
 * the stub ignores it. The Web Speech orchestrator
 * forwards the value to `recognition.lang`; the
 * on-device orchestrator forwards it to
 * `stt_start_listening`'s IPC arg.
 *
 * Persistence: localStorage (`lipi:voicePreferences:v1`).
 * The preference survives reloads — a user who set
 * 'stub' for debugging keeps 'stub' after a restart.
 *
 * M3 update: the literal union was renamed from
 * `VoiceProvider` to `VoiceProviderId` (Decision #48
 * — see HANDOFF §9.9). The M3 `VoiceSession`
 * interface is the new polymorphism point, and the
 * `VoiceProvider` *interface* that lived in
 * `src/voice/types.ts` was deleted in this PR. We
 * import the renamed union from `@/voice` so the
 * local alias and the canonical id are guaranteed
 * to stay in sync.
 */

import { create } from 'zustand';

import type { VoiceProviderId } from '@/voice';
import { logger } from '@/shared/logger';

const STORAGE_KEY = 'lipi:voicePreferences:v1';

export type { VoiceProviderId };

const DEFAULT_PROVIDER: VoiceProviderId = 'wispr';

/**
 * The default `language` for providers that consume
 * the value. `'en-US'` is the lowest-common-denominator
 * every speech engine supports (Chromium's Web Speech,
 * Apple's SFSpeechRecognizer, whisper.cpp's
 * multilingual models). The user can change it in the
 * Settings screen — Q1 in the architecture summary.
 */
export const DEFAULT_LANGUAGE = 'en-US';

interface PersistedState {
  provider: VoiceProviderId;
  language: string;
}

function isValidProvider(v: unknown): v is VoiceProviderId {
  return (
    v === 'stub' ||
    v === 'wispr' ||
    v === 'ondevice' ||
    v === 'webSpeech' ||
    v === 'nativeDictation'
  );
}

/**
 * A non-empty BCP-47-ish string. We don't strictly
 * validate the shape (the Web Speech API accepts
 * loose forms like `'en'` and Apple's framework
 * accepts `'en-US'` and `'zh-Hans'`); we just make
 * sure the persisted value is a non-empty string
 * so a malformed localStorage entry falls back to
 * the default rather than corrupting the store.
 */
function isValidLanguage(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 35;
}

function loadFromStorage(): PersistedState | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'provider' in parsed &&
      isValidProvider((parsed as PersistedState).provider)
    ) {
      // The `language` field is M2c-mobile — older
      // payloads pre-date it. We treat a missing or
      // malformed value as "use the default" and
      // back-fill on the next save. The store's
      // `language` is the field the UI / orchestrator
      // read; the persisted form just needs to
      // survive the round-trip.
      const persistedLang = (parsed as PersistedState).language;
      return {
        provider: (parsed as PersistedState).provider,
        language: isValidLanguage(persistedLang)
          ? persistedLang
          : DEFAULT_LANGUAGE,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function saveToStorage(state: PersistedState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    // Quota / private-mode failures are non-fatal.
    logger.warn('[voicePreferences] failed to persist:', e);
  }
}

export interface VoicePreferencesState {
  provider: VoiceProviderId;
  language: string;
  hydrated: boolean;
  setProvider: (p: VoiceProviderId) => void;
  /**
   * M2c mobile: update the BCP-47 language tag. The
   * Web Speech orchestrator forwards it to
   * `recognition.lang`; the on-device orchestrator
   * forwards it to `stt_start_listening`. Wispr and
   * stub ignore it (server-side / no model). A
   * malformed value (empty / non-string) is silently
   * rejected — we never write garbage to the store.
   */
  setLanguage: (lang: string) => void;
  hydrate: () => void;
}

export const useVoicePreferencesStore = create<VoicePreferencesState>((set, get) => ({
  provider: DEFAULT_PROVIDER,
  language: DEFAULT_LANGUAGE,
  hydrated: false,
  setProvider: (provider) => {
    set({ provider });
  },
  setLanguage: (lang) => {
    if (!isValidLanguage(lang)) {
      // Defensive: a malformed value would break
      // the Web Speech orchestrator's
      // `recognition.lang` assignment. The user-
      // facing Settings screen validates before
      // calling; this is belt-and-braces.
      return;
    }
    set({ language: lang });
  },
  hydrate: () => {
    if (get().hydrated) return;
    const persisted = loadFromStorage();
    set({
      provider: persisted?.provider ?? DEFAULT_PROVIDER,
      language: persisted?.language ?? DEFAULT_LANGUAGE,
      hydrated: true,
    });
  },
}));

let persistenceSubscribed = false;
/** Wire up persistence. Call once at app startup. */
export function setupVoicePreferencesPersistence(): void {
  if (persistenceSubscribed) return;
  persistenceSubscribed = true;
  useVoicePreferencesStore.subscribe((state) => {
    if (!state.hydrated) return;
    saveToStorage({ provider: state.provider, language: state.language });
  });
}

export const voicePreferencesSelectors = {
  provider: (s: VoicePreferencesState) => s.provider,
  language: (s: VoicePreferencesState) => s.language,
};
