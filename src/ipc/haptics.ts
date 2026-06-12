/**
 * Phase M5 — typed IPC for `haptic`.
 *
 * The Rust side (`src-tauri/src/lib.rs`'s `haptic`
 * command) is a no-op on desktop and a deferred
 * mobile-bridge call on iOS / Android. The JS side
 * fires the call regardless of platform; the Rust
 * `#[cfg(mobile)]` split is the
 * platform-dispatch point. We do NOT add a
 * `isTauriMobile` guard in JS — that would couple
 * the UI to the platform, and the v1 build doesn't
 * ship a mobile runtime anyway.
 *
 * The three intensities (`light` / `medium` / `heavy`)
 * mirror the iOS `UIImpactFeedbackGenerator` and
 * Android `HapticFeedbackConstants` scales. UI calls
 * `light` on tab switches, `medium` on voice-start /
 * commit, `heavy` on destructive actions.
 */
import { invoke } from '@tauri-apps/api/core';

export type HapticIntensity = 'light' | 'medium' | 'heavy';

export async function haptic(intensity: HapticIntensity): Promise<void> {
  await invoke('haptic', { intensity });
}
