/**
 * capabilities — cached wrapper around the
 * `voice_platform_get_capabilities` IPC (M2c mobile).
 *
 * The result is process-lifetime-stable: the OS
 * doesn't change for the lifetime of a Tauri
 * application (it's a single-target build, one binary
 * per platform — see `voice_platform.rs` for the
 * full design). We resolve once on the first call and
 * keep the resulting promise.
 *
 * Consumers should use the `useVoiceCapabilitiesStore`
 * Zustand store (hydrated once at app startup) for
 * synchronous reads inside React render. This
 * function is the low-level building block the store
 * uses during hydration, and is also exported for
 * the (rare) case where a non-React surface needs the
 * capabilities without going through the store.
 *
 * Per the locked decision Q4 in the architecture
 * summary: a tiny store, hydrated at app startup, is
 * the canonical access path. The ad-hoc
 * `getVoicePlatformCapabilities()` exists for tests
 * and for surfaces that don't go through React
 * (e.g. a future Cmd-K modal that's not a hook).
 */

import {
  voicePlatformGetCapabilities,
  type VoicePlatformCapabilities,
} from '@/ipc/voicePlatform';

/**
 * The single in-flight + resolved promise. We
 * resolve once on the first call and never re-fetch
 * for the lifetime of the process.
 */
let cached: Promise<VoicePlatformCapabilities> | null = null;

/**
 * Return the platform's STT capability flags. The
 * underlying IPC is invoked at most once per process;
 * subsequent calls return the cached promise.
 *
 * Throws only on IPC failure (which the Rust side
 * never errors on in practice — the command is a
 * pure compile-time decision). The cache survives
 * a rejection: a rejected promise will stay cached
 * as a rejected promise. We deliberately do NOT
 * reset the cache on failure; the user can fix the
 * underlying issue (rebuild the app) and the cache
 * will be naturally cleared on process restart.
 */
export function getVoicePlatformCapabilities(): Promise<VoicePlatformCapabilities> {
  if (cached === null) {
    cached = voicePlatformGetCapabilities();
  }
  return cached;
}

/**
 * Test-only escape hatch. Resets the cache to null
 * so the next `getVoicePlatformCapabilities()` call
 * re-invokes the IPC. Production code never needs
 * this; the cache is intentionally process-lifetime.
 */
export function __resetVoicePlatformCapabilitiesCacheForTests(): void {
  cached = null;
}
