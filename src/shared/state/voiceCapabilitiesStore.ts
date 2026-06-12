/**
 * voiceCapabilitiesStore — M2c mobile (Decision #46).
 *
 * A tiny Zustand store that holds the platform's
 * STT capability flags (ondevice, webSpeech,
 * nativeDictation, osFamily). Hydrated once at
 * app startup from the `voice_platform_get_capabilities`
 * IPC; the value is process-lifetime-stable so we
 * do NOT persist it to localStorage.
 *
 * Why a store (and not a one-shot `getCapabilities()`
 * helper):
 *   - The Command Palette's `isEnabled` predicates
 *     are called on every keystroke and need
 *     SYNCHRONOUS access. The IPC is async, the
 *     result is read-mostly, and there's no other
 *     write side — a Zustand store is the
 *     minimal-shape fit (same pattern as
 *     `voicePreferencesStore`).
 *   - The `capabilities` field starts as `null`
 *     and flips to a populated `VoicePlatformCapabilities`
 *     once the IPC resolves. The Command Palette
 *     predicates use the `?.` chain so the rows
 *     are briefly greyed-out (during the few-ms
 *     hydration window) and then enable
 *     automatically when the IPC resolves.
 *
 * Why no persistence:
 *   - The OS doesn't change for the lifetime of
 *     a Tauri application (one binary per platform).
 *     Persisting the flags would just add startup
 *     cost and a "stale cache" failure mode with
 *     no real upside.
 *   - Mirrors the rationale for the
 *     `voiceStore` (Decision #39 — ephemeral
 *     state is NOT persisted).
 */

import { create } from 'zustand';
import { getVoicePlatformCapabilities } from '@/voice/capabilities';
import type { VoicePlatformCapabilities } from '@/ipc/voicePlatform';

export interface VoiceCapabilitiesState {
  /**
   * The platform's STT capability flags, or `null`
   * before the hydration IPC resolves. The Command
   * Palette's `isEnabled` predicates do
   * `useVoiceCapabilitiesStore.getState().capabilities?.webSpeech === true`
   * — the `?.` chain returns `undefined` when
   * `capabilities` is `null`, which is `!== true`,
   * which means the row stays disabled until
   * hydration completes.
   */
  capabilities: VoicePlatformCapabilities | null;

  /**
   * Hydrate the store. Idempotent: subsequent calls
   * are no-ops (the IPC is process-lifetime-cached
   * in `@/voice/capabilities.ts` and the result
   * is process-lifetime-stable).
   *
   * Call once at app startup, next to
   * `setupVoicePreferencesPersistence()`.
   */
  hydrate: () => Promise<void>;
}

export const useVoiceCapabilitiesStore = create<VoiceCapabilitiesState>((set, get) => ({
  capabilities: null,
  hydrate: async (): Promise<void> => {
    // Idempotency: a second call (e.g. the dev
    // StrictMode double-effect, or a future
    // re-mount) is a no-op. The underlying IPC is
    // cached in `@/voice/capabilities.ts` so we
    // don't pay the round-trip twice.
    if (get().capabilities !== null) return;
    try {
      const caps = await getVoicePlatformCapabilities();
      set({ capabilities: caps });
    } catch {
      // The Rust side never errors in practice —
      // the command is a pure compile-time
      // decision. We deliberately swallow the
      // error and leave `capabilities: null` so
      // the Command Palette's predicates stay
      // safe (they read `?.webSpeech` and get
      // `undefined`).
      //
      // A console.warn gives a developer a clue
      // that something is wrong without flooding
      // the user.
      console.warn('[voiceCapabilities] hydrate failed; capabilities will stay null');
    }
  },
}));

export const voiceCapabilitiesSelectors = {
  capabilities: (s: VoiceCapabilitiesState) => s.capabilities,
};
