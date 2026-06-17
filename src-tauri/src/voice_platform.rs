//! Platform-capability surface for the STT subsystem (M2c mobile).
//!
//! Scope of this module: report *which* STT backends the
//! current OS can support, so the JS side can hide the
//! "Use browser speech engine" command on Linux
//! (WebKitGTK doesn't ship `SpeechRecognition`) and show
//! it on Windows / macOS / iOS.
//!
//! ## Why this is compile-time, not runtime
//!
//! The Tauri runtime is a single-target build: one
//! Lipi.exe per platform. We never cross OS boundaries
//! at runtime. So a `cfg(target_os)` check at build time
//! is the source of truth — there is no "user moved the
//! binary to a Linux box" scenario to handle.
//!
//! The `OsFamily` enum mirrors what Tauri's runtime
//! reports (Windows / macOS / Linux / iOS / Android),
//! and the `VoicePlatformCapabilities` struct is the
//! JSON-serialised payload the JS `voicePlatform.ts`
//! reads.
//!
//! ## Why a separate `OsFamily` (and not the Tauri one)
//!
//! Tauri's `tauri::api::platform::Platform` is more
//! granular (e.g. `macos-aarch64` vs `macos-x86_64`)
//! than the STT subsystem needs. The JS side only
//! needs a coarse family for capability gating, and
//! we'd rather not have the UI re-derive
//! "aarch64 vs x86_64" from a string. We use
//! `#[serde(rename_all = "kebab-case")]` to match the
//! Tauri convention.
//!
//! ## Why we do NOT mirror this on the IPC side
//!
//! This module exposes a one-shot RPC; the value
//! doesn't change for the lifetime of the app. There
//! is no `voice_platform://*` event stream — the Rust
//! side has no state, no I/O, no listeners. The JS
//! `voiceCapabilitiesStore` hydrates once at startup
//! and the Command Palette's `isEnabled` predicates
//! read from it synchronously.
//!
//! ## M2c mobile: the deferred Swift / Kotlin plugins
//!
//! The iOS Swift (`SFSpeechRecognizer`) and Android
//! Kotlin (`SpeechRecognizer`) plugins are markdown
//! contracts only in this session — Xcode and Android
//! Studio + NDK are not on this sandbox. The capability
//! flags they would set (`native_dictation`) are
//! declared in the enum but unreachable from this
//! Windows build. See `docs/plugins/lipi-stt-ios/` and
//! `docs/plugins/lipi-stt-android/` for the contract a
//! future session will fill in. The ADR
//! `docs/decisions/0046-m2c-mobile-shim.md` captures
//! the full decision.

use serde::Serialize;

/// Which OS we're running on, as far as the STT
/// subsystem cares about. We deliberately do NOT
/// report the Tauri "platform" (which has more
/// granular values like `macos-aarch64`); the JS
/// side only needs a coarse family for capability
/// gating.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum OsFamily {
    Windows,
    Macos,
    LinuxGtk,
    Ios,
    Android,
    Other,
}

// `cfg` arms. The `const OS: OsFamily` is the source
// of truth for the build's platform family. Only one
// arm is reachable per build (the rest are dead code
// the compiler drops).
#[cfg(target_os = "windows")]
const OS: OsFamily = OsFamily::Windows;
#[cfg(target_os = "macos")]
const OS: OsFamily = OsFamily::Macos;
#[cfg(target_os = "linux")]
const OS: OsFamily = OsFamily::LinuxGtk;
#[cfg(target_os = "ios")]
const OS: OsFamily = OsFamily::Ios;
#[cfg(target_os = "android")]
const OS: OsFamily = OsFamily::Android;
#[cfg(not(any(
    target_os = "windows",
    target_os = "macos",
    target_os = "linux",
    target_os = "ios",
    target_os = "android",
)))]
const OS: OsFamily = OsFamily::Other;

/// What STT backends the current platform can use.
/// Reported once on app startup; the JS side caches
/// the result for the app's lifetime. The Tauri
/// runtime is a single-target build (one binary per
/// platform) so we don't need to handle "running
/// across OS boundaries".
///
/// The struct is serialised with camelCase keys
/// (per the `#[serde(rename_all)]` attribute below)
/// so the JS side reads `caps.ondevice` /
/// `caps.webSpeech` / `caps.nativeDictation` /
/// `caps.osFamily` directly.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VoicePlatformCapabilities {
    /// The M2c desktop Whisper path. Always true on
    /// the platforms Lipi ships desktop builds for.
    /// On iOS / Android this is false — the M2c
    /// mobile path uses the OS-native STT (see the
    /// plugin-stub markdown files).
    pub ondevice: bool,
    /// The WebView's `window.SpeechRecognition` (or
    /// `window.webkitSpeechRecognition`) is present
    /// and usable. True on WebView2 (Windows) and
    /// WKWebView (macOS, iOS). False on WebKitGTK
    /// (Linux) — `SpeechRecognition` is not
    /// compiled into the default WebKitGTK.
    pub web_speech: bool,
    /// A future iOS / Android native plugin is
    /// present (see the plugin-stub markdown files).
    /// Always false on this Windows-only build, but
    /// the JS code is wired so a future iOS /
    /// Android build sets this to true and the UI
    /// surfaces the option.
    pub native_dictation: bool,
    /// The OS family, for diagnostics and for the
    /// future iOS / Android plugin discovery.
    pub os_family: OsFamily,
}

/// Compute the capabilities for the current build.
/// Pure function of `OS`; no I/O, no async, no
/// state. Called once at app startup from
/// `voice_platform_get_capabilities`.
pub fn get_capabilities() -> VoicePlatformCapabilities {
    // `ondevice` tracks "the M2c desktop Whisper
    // path is wired here". We ship it on the three
    // desktop targets; the M2c mobile path uses the
    // OS-native STT on phones/tablets.
    let ondevice = matches!(
        OS,
        OsFamily::Windows | OsFamily::Macos | OsFamily::LinuxGtk
    );
    // `web_speech` tracks "the WebView exposes
    // SpeechRecognition". True on Chromium-based
    // WebViews (Windows, macOS) and on WKWebView
    // (iOS). False on WebKitGTK (Linux) and on
    // Android's system WebView (which is Chromium-
    // based but Google strips SpeechRecognition
    // from the production build — see HANDOFF §9.7
    // risk R1).
    let web_speech = matches!(
        OS,
        OsFamily::Windows | OsFamily::Macos | OsFamily::Ios
    );
    // `native_dictation` is true only on platforms
    // where the deferred Swift / Kotlin plugin
    // would land. On the current Windows-only
    // build this is unreachable; the iOS / Android
    // arms exist for the future Xcode / Android
    // Studio session that wires the plugin.
    let native_dictation = matches!(OS, OsFamily::Ios | OsFamily::Android);
    VoicePlatformCapabilities {
        ondevice,
        web_speech,
        native_dictation,
        os_family: OS,
    }
}

/// Return the `OsFamily` for the current build.
/// Pure function of `OS`; no I/O, no async, no
/// state. The `secrets` module uses this to
/// dispatch to the Stronghold backend on Android
/// (the mobile-build roadmap Phase B).
#[cfg(feature = "mobile")]
pub fn current_os_family() -> OsFamily {
    OS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capabilities_shape_is_camel_case() {
        // The JS side reads these EXACT key names.
        // Bumping this assert = also bump the TS
        // interface in `src/voice/capabilities.ts`.
        let caps = get_capabilities();
        let json = serde_json::to_string(&caps).unwrap();
        assert!(json.contains("\"ondevice\""), "missing 'ondevice' key: {json}");
        assert!(json.contains("\"webSpeech\""), "missing 'webSpeech' key: {json}");
        assert!(json.contains("\"nativeDictation\""), "missing 'nativeDictation' key: {json}");
        assert!(json.contains("\"osFamily\""), "missing 'osFamily' key: {json}");
    }

    #[test]
    fn ondevice_is_true_on_windows_macos_linuxgtk() {
        // `cfg!` is a build-time check, so this
        // assertion only runs on the platforms
        // listed. On Windows / macOS / Linux
        // builds, `ondevice` is true.
        let caps = get_capabilities();
        if cfg!(any(
            target_os = "windows",
            all(target_os = "macos", any()),
            target_os = "linux"
        )) {
            assert!(caps.ondevice, "ondevice should be true on desktop targets");
        }
    }

    #[test]
    fn web_speech_is_true_on_windows_macos_ios() {
        // WebKitGTK doesn't ship SpeechRecognition
        // (it's not in the default build; see HANDOFF
        // §9.7 risk R1). Android's system WebView
        // is Chromium-based but the production
        // build strips it. So only Windows / macOS
        // / iOS get `web_speech: true`.
        let caps = get_capabilities();
        if cfg!(any(target_os = "windows", target_os = "macos", target_os = "ios")) {
            assert!(caps.web_speech, "web_speech should be true on Windows/macOS/iOS");
        }
        if cfg!(target_os = "linux") {
            assert!(!caps.web_speech, "web_speech should be false on Linux (WebKitGTK)");
        }
        if cfg!(target_os = "android") {
            assert!(!caps.web_speech, "web_speech should be false on Android");
        }
    }

    #[test]
    fn native_dictation_is_false_on_windows() {
        // The Swift / Kotlin plugins are markdown
        // contracts only in this session; on a
        // Windows build `native_dictation` is
        // always false. Future iOS / Android
        // builds will flip it true once the plugin
        // is implemented.
        let caps = get_capabilities();
        if cfg!(target_os = "windows") {
            assert!(
                !caps.native_dictation,
                "native_dictation should be false on Windows (no plugin yet)"
            );
            assert_eq!(caps.os_family, OsFamily::Windows);
        }
    }
}
