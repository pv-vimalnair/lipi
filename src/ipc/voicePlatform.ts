/**
 * Typed IPC wrapper for `voice_platform_get_capabilities`
 * (M2c mobile — Decision #46).
 *
 * Mirrors the `VoicePlatformCapabilities` struct in
 * `src-tauri/src/voice_platform.rs` 1:1. The JSON
 * shape is enforced by the Rust side's
 * `#[serde(rename_all = "camelCase")]` attribute on the
 * struct, so the JS side reads the same camelCase keys
 * the Rust side serialises.
 *
 * The function is one-shot — the capabilities are
 * process-lifetime-stable (the OS doesn't change for the
 * lifetime of the app). The `src/voice/capabilities.ts`
 * wrapper caches the result so the Command Palette's
 * `isEnabled` predicates can read it synchronously via
 * the `useVoiceCapabilitiesStore` Zustand store.
 *
 * Per Rule 4, components import from `@/ipc`, never
 * from `@tauri-apps/api/core` directly.
 */
import { invoke } from '@tauri-apps/api/core';

/**
 * The coarse OS family. The Rust side only needs a
 * coarse bucket (Windows / macOS / Linux / iOS /
 * Android) for capability gating; the more granular
 * Tauri "platform" string (e.g. `macos-aarch64`) is
 * intentionally NOT exposed here.
 */
export type OsFamily =
  | 'windows'
  | 'macos'
  | 'linux-gtk'
  | 'ios'
  | 'android'
  | 'other';

/**
 * What STT backends the current build can use.
 * Read once at app startup; the value doesn't change
 * for the lifetime of the process.
 *
 *   `ondevice`         M2c desktop Whisper path is wired
 *                      here. True on Windows / macOS /
 *                      Linux+gtk; false on iOS / Android
 *                      (the M2c mobile path uses the
 *                      OS-native STT).
 *   `webSpeech`        The WebView exposes
 *                      `window.SpeechRecognition`. True on
 *                      Windows (WebView2), macOS (WKWebView),
 *                      iOS (WKWebView); false on Linux
 *                      (WebKitGTK doesn't ship it) and
 *                      Android (Chromium build strips it).
 *   `nativeDictation`  The deferred iOS Swift / Android
 *                      Kotlin plugin is present. Always
 *                      false on the current Windows-only
 *                      build; flipped true by a future
 *                      Xcode / Android Studio session.
 *   `osFamily`         The OS family, for diagnostics
 *                      and for the future iOS / Android
 *                      plugin discovery.
 */
export interface VoicePlatformCapabilities {
  ondevice: boolean;
  webSpeech: boolean;
  nativeDictation: boolean;
  osFamily: OsFamily;
}

/**
 * Read the platform's STT capability flags. Pure
 * compile-time decision on the Rust side (no I/O,
 * no async, no state). Throws on IPC failure
 * (extremely unlikely — the command is registered
 * at build time and never errors in practice).
 */
export async function voicePlatformGetCapabilities(): Promise<VoicePlatformCapabilities> {
  return await invoke<VoicePlatformCapabilities>('voice_platform_get_capabilities');
}
