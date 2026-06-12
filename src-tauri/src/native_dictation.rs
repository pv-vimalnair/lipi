//! Native-dictation plugin facade (Phase NPS).
//!
//! This module defines the **contract** the iOS Swift and
//! Android Kotlin plugins must implement. The contract is
//! the same shape on both platforms — the JS side calls
//! Tauri's IPC by name and expects a `Channel<TranscriptEvent>`
//! back; the Swift / Kotlin code satisfies it on their
//! respective `SFSpeechRecognizer` / `SpeechRecognizer`
//! APIs.
//!
//! ## Why a Rust-side facade at all?
//!
//! Three reasons:
//!
//!   1. **Compile-time discoverability.** A future contributor
//!      can `rg "NativeDictationContract"` and find every
//!      IPC method the JS side is allowed to call. A typed
//!      Rust struct + `pub const` strings are far more
//!      discoverable than a markdown README.
//!   2. **Wire-shape testability.** The `get_contract` IPC
//!      returns the contract as a typed JSON value. A Rust
//!      unit test asserts every constant string matches the
//!      one the JS side expects. A drift between Rust and
//!      JS (a renamed method) fails the build instead of
//!      silently 404-ing at runtime.
//!   3. **`#[cfg]`-gated behaviour.** The `iOS` / `Android`
//!      arms return a real contract; every other target
//!      returns `ContractStatus::NotApplicable` so the JS
//!      side can render "This setting is only available on
//!      iOS / Android" instead of crashing. The desktop
//!      build stays clean.
//!
//! ## Why this doesn't ship the actual Swift / Kotlin
//!
//! The user's working environment is Windows 10. Xcode 16+
//! is macOS-only; Android Studio Iguana+ with the NDK is
//! the only realistic Kotlin target. Both are out of scope
//! for this sandbox. The contract is what ships; the
//! implementations are a future-session task (see
//! `docs/plugins/lipi-stt-ios/README.md` and
//! `docs/plugins/lipi-stt-android/README.md`).
//!
//! ## M3 connection
//!
//! The `nativeDictationSession.ts` factory stub (M3) throws
//! `VoiceSessionError('not-configured')` on `start()`. When
//! the Swift / Kotlin plugin lands, the same factory will
//! resolve to a real `VoiceSessionHandle` that calls the IPC
//! methods declared below. No JS-side changes are needed
//! once the plugin is implemented — the contract is the
//! stable seam.

use serde::Serialize;
use serde::Deserialize;

/// The single IPC method name the iOS / Android plugins
/// must implement to start a recognition session. The JS
/// side calls `invoke('plugin:native-dictation|start', …)`
/// which Tauri's iOS-bridge / Android-bridge routes to
/// the Swift / Kotlin plugin's `start` handler.
///
/// **Why a Tauri-prefixed name?** The plugin is a future
/// `tauri-plugin-native-dictation`-shaped crate. The
/// `plugin:NAME|CMD` convention is Tauri's stable
/// dispatch for plugin commands. Using a bare `stt_start`
/// would collide with the existing `stt.rs` command.
pub const PLUGIN_NAME: &str = "native-dictation";

/// The three IPC methods the plugin must implement.
/// Exported as `pub const` so the Rust tests can assert
/// the JS side uses the same strings.
pub const METHOD_START: &str = "start";
pub const METHOD_STOP: &str = "stop";
pub const METHOD_CANCEL: &str = "cancel";

/// Tauri Channel name (Swift / Kotlin → JS) for transcript
/// events. Mirrors the M2c desktop's `stt://transcript`
/// event so the JS-side `useVoiceCapture` hook can
/// subscribe to one name across all providers.
pub const TRANSCRIPT_EVENT: &str = "stt://transcript";

/// The error-payload event name. The Swift / Kotlin side
/// emits a `SttErrorPayload` (JSON shape: `{ kind: string,
/// message: string }`) on this channel when
/// `SFSpeechRecognizer` / `SpeechRecognizer` rejects.
pub const ERROR_EVENT: &str = "stt://error";

/// `SttError` kinds the iOS / Android plugins may emit.
/// Mirrors the desktop `SttError` enum in
/// `src-tauri/src/stt_capture.rs` (Decision #44 — same
/// error surface, JS-side `useVoiceCapture` hook already
/// knows how to map them).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum NativeDictationErrorKind {
    /// iOS `AVAudioApplication.requestRecordPermission`
    /// returned false, or the user revoked mic access in
    /// iOS / Android Settings.
    PermissionDenied,
    /// `SFSpeechRecognizer.isAvailable` returned false, or
    /// Android's `SpeechRecognizer.isRecognitionAvailable`
    /// returned false.
    NoInputDevice,
    /// The `SFSpeechRecognizer` / `SpeechRecognizer`
    /// callback fired with a non-recoverable error
    /// (e.g. `kAFAssistantErrorDomain` code 203 — quota
    /// exceeded, or Android's `ERROR_TOO_MANY_REQUESTS`).
    Backend,
    /// The 30s `maxDurationMs` cap was hit (matches the
    /// desktop `DEFAULT_MAX_DURATION_MS`). The plugin
    /// stops gracefully; the JS side can re-start a new
    /// session.
    Timeout,
    /// Generic catch-all for anything not enumerated
    /// above. The `message` field carries the
    /// `error.localizedDescription` from iOS or the
    /// `getMessage()` from Android.
    Unknown,
}

/// One row of the contract — a single method the plugin
/// must implement, with its argument and return shape
/// described in the doc comment (so the JSON-returned
/// contract is self-documenting to anyone reading the
/// Settings UI).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ContractMethod {
    /// IPC method name (e.g. `"start"`).
    pub name: &'static str,
    /// One-line purpose, surfaced in the Settings UI as a
    /// tooltip on the contract-row.
    pub purpose: &'static str,
    /// Stable signature (for display only — not enforced
    /// at the IPC layer; Tauri types the args at compile
    /// time).
    pub signature: &'static str,
}

/// The full native-dictation plugin contract returned
/// by `get_native_dictation_contract`. `status`
/// distinguishes "this build *can* use the plugin"
/// (`Active` / `Inert`) from "this build target is not
/// mobile" (`NotApplicable`).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ContractStatus {
    /// Build target is iOS or Android and the plugin
    /// contract is available. The plugin itself may or
    /// may not be implemented in this build — the
    /// contract is the *interface*, not the *binding*.
    Active,
    /// Build target is iOS or Android but the plugin
    /// binding is not yet implemented. The contract is
    /// still returned so the Settings UI can show
    /// "Contract: ready, binding: pending".
    Inert,
    /// Build target is not mobile. The JS side renders
    /// "This setting is only available on iOS / Android".
    NotApplicable,
}

#[derive(Debug, Clone, Serialize)]
pub struct NativeDictationContract {
    /// `native-dictation` — matches `PLUGIN_NAME`.
    pub plugin_name: &'static str,
    /// The status of the contract on this build.
    pub status: ContractStatus,
    /// The transcript / error event names the JS side
    /// will listen to.
    pub events: ContractEvents,
    /// The IPC methods the plugin must implement.
    pub methods: Vec<ContractMethod>,
    /// The `SttError` kinds the plugin may emit. Listed
    /// in the contract so the JS side can assert it
    /// handles all of them.
    pub error_kinds: Vec<NativeDictationErrorKind>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ContractEvents {
    pub transcript: &'static str,
    pub error: &'static str,
}

/// Pure: build the canonical contract for the given
/// status. Exposed (not inlined in the command) so the
/// tests can call it directly and assert shape without
/// the IPC layer.
pub fn contract_for(status: ContractStatus) -> NativeDictationContract {
    NativeDictationContract {
        plugin_name: PLUGIN_NAME,
        status,
        events: ContractEvents {
            transcript: TRANSCRIPT_EVENT,
            error: ERROR_EVENT,
        },
        methods: vec![
            ContractMethod {
                name: METHOD_START,
                purpose: "Open a recognition session and start streaming TranscriptEvent.",
                signature:
                    "start(opts: ListenArgs | null, sessionId: string) -> Result<string, NativeDictationError>",
            },
            ContractMethod {
                name: METHOD_STOP,
                purpose:
                    "Stop the active session cleanly (flushes the in-flight utterance).",
                signature: "stop(sessionId: string) -> Result<(), NativeDictationError>",
            },
            ContractMethod {
                name: METHOD_CANCEL,
                purpose:
                    "Abort the session without flushing (M3's AbortController hook).",
                signature: "cancel(sessionId: string) -> Result<(), NativeDictationError>",
            },
        ],
        // Listed in the order the plugin docs declare
        // them (see the §3 permission flow in the iOS
        // README); the JS side maps by string, not by
        // array position, so reordering is safe.
        error_kinds: vec![
            NativeDictationErrorKind::PermissionDenied,
            NativeDictationErrorKind::NoInputDevice,
            NativeDictationErrorKind::Backend,
            NativeDictationErrorKind::Timeout,
            NativeDictationErrorKind::Unknown,
        ],
    }
}

/// The Tauri command the JS side calls once on
/// Settings-mount to render the contract. The return
/// type is a `NativeDictationContract`; Tauri
/// auto-serialises it to JSON with the kebab-case
/// `#[serde(rename_all)]` rules.
#[tauri::command]
pub fn get_native_dictation_contract() -> NativeDictationContract {
    #[cfg(target_os = "ios")]
    let status = ContractStatus::Inert;
    #[cfg(target_os = "android")]
    let status = ContractStatus::Inert;
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    let status = ContractStatus::NotApplicable;
    contract_for(status)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contract_strings_match_the_plugin_name() {
        let c = contract_for(ContractStatus::Active);
        assert_eq!(c.plugin_name, "native-dictation");
    }

    #[test]
    fn contract_lists_three_methods() {
        let c = contract_for(ContractStatus::Active);
        assert_eq!(c.methods.len(), 3);
        let names: Vec<&'static str> =
            c.methods.iter().map(|m| m.name).collect();
        assert_eq!(names, vec!["start", "stop", "cancel"]);
    }

    #[test]
    fn contract_lists_five_error_kinds() {
        let c = contract_for(ContractStatus::Active);
        assert_eq!(c.error_kinds.len(), 5);
    }

    #[test]
    fn contract_events_match_the_constants() {
        let c = contract_for(ContractStatus::Active);
        assert_eq!(c.events.transcript, "stt://transcript");
        assert_eq!(c.events.error, "stt://error");
    }

    #[test]
    fn not_applicable_status_round_trips() {
        let c = contract_for(ContractStatus::NotApplicable);
        assert_eq!(c.status, ContractStatus::NotApplicable);
    }

    #[test]
    fn serialise_to_json_kebab_cases_the_enums() {
        // The JS side reads the JSON and pattern-matches
        // on the status string; a kebab-case mismatch
        // would be a silent runtime null. Assert the
        // serialised shape directly.
        //
        // NOTE: `#[serde(rename_all = "kebab-case")]`
        // applies to struct FIELDS, not to the top-level
        // struct name (which serialises to the Rust
        // struct's snake_case name by default). The JS
        // side wraps the payload in a named container,
        // so the top-level field is `status` (kebab from
        // the `#[serde(rename_all)]` on the enum), and
        // `plugin_name` (snake from the field name).
        let c = contract_for(ContractStatus::Active);
        let s = serde_json::to_string(&c).unwrap();
        assert!(s.contains("\"status\":\"active\""), "got: {s}");
        assert!(s.contains("\"plugin_name\":\"native-dictation\""), "got: {s}");
        assert!(s.contains("\"transcript\":\"stt://transcript\""), "got: {s}");
        // Error kinds are kebab-cased too.
        assert!(s.contains("\"permission-denied\""), "got: {s}");
        assert!(s.contains("\"no-input-device\""), "got: {s}");
    }

    #[test]
    fn error_kind_deserialise_round_trip() {
        // The plugin's `stt://error` payload deserialises
        // to a `NativeDictationErrorKind` value. Assert
        // the round-trip stays kebab-case end-to-end.
        for kind in [
            NativeDictationErrorKind::PermissionDenied,
            NativeDictationErrorKind::NoInputDevice,
            NativeDictationErrorKind::Backend,
            NativeDictationErrorKind::Timeout,
            NativeDictationErrorKind::Unknown,
        ] {
            let s = serde_json::to_string(&kind).unwrap();
            let back: NativeDictationErrorKind =
                serde_json::from_str(&s).unwrap();
            assert_eq!(back, kind, "round-trip failed for {s}");
        }
    }
}
