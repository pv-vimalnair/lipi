/**
 * voicePreferencesStore — the user's voice STT provider
 * preference (M2b).
 *
 * M2b ships two providers: `'wispr'` (the headline
 * path; real WebSocket to Flow) and `'stub'` (the M2a
 * debug placeholder). `'ondevice'` is reserved for M2c.
 *
 * The store holds the CURRENT preference. The
 * `VoiceButton` reads it on mount and re-renders when
 * it changes, so the Command Palette can flip the
 * provider on the fly.
 *
 * Persistence: localStorage (`lipi:voicePreferences:v1`).
 * The preference survives reloads — a user who set
 * 'stub' for debugging keeps 'stub' after a restart.
 *
 * Why a separate store from the voiceStore:
 *   - The voiceStore is ephemeral state (current
 *     recording status + last transcript). It is
 *     deliberately NOT persisted (Decision #39).
 *   - The preferences store IS persisted and is
 *     unrelated to the in-flight recording.
 */

import { create } from 'zustand';

const STORAGE_KEY = 'lipi:voicePreferences:v1';

export type VoiceProvider = 'stub' | 'wispr' | 'ondevice';

const DEFAULT_PROVIDER: VoiceProvider = 'wispr';

interface PersistedState {
  provider: VoiceProvider;
}

function isValidProvider(v: unknown): v is VoiceProvider {
  return v === 'stub' || v === 'wispr' || v === 'ondevice';
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
      return parsed as PersistedState;
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
    console.warn('[voicePreferences] failed to persist:', e);
  }
}

export interface VoicePreferencesState {
  provider: VoiceProvider;
  hydrated: boolean;
  setProvider: (p: VoiceProvider) => void;
  hydrate: () => void;
}

export const useVoicePreferencesStore = create<VoicePreferencesState>((set, get) => ({
  provider: DEFAULT_PROVIDER,
  hydrated: false,
  setProvider: (provider) => {
    set({ provider });
  },
  hydrate: () => {
    if (get().hydrated) return;
    const persisted = loadFromStorage();
    set({
      provider: persisted?.provider ?? DEFAULT_PROVIDER,
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
    saveToStorage({ provider: state.provider });
  });
}

export const voicePreferencesSelectors = {
  provider: (s: VoicePreferencesState) => s.provider,
};
