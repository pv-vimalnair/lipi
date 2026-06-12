# lipi-stt-ios — iOS native STT plugin contract

**Status: Phase 0 contract only. No Swift code. This file describes the contract a future session on a Mac with Xcode 16+ will fill in.**

## 1. Goal

Replace the WebView's `window.SpeechRecognition` (which the M2c mobile shim uses on every platform that exposes it) with Apple's native `SFSpeechRecognizer` + `SFSpeechAudioBufferRecognitionRequest` on iOS. Forward partial + final transcripts to the Lipi JS side over a Tauri `Channel<TranscriptEvent>` and gate the M2c mobile provider-picker on the platform capability flag.

The end-state: on iOS the `useVoiceCapabilitiesStore` reports `webSpeech: false` and `nativeDictation: true`, and the Command Palette's "Use browser speech engine" entry is greyed out (it would re-introduce Apple's WebKit as a dependency, which we explicitly do NOT want on iOS — Safari's `SpeechRecognition` is feature-incomplete and Apple has documented it as not for production use).

## 2. Targets

- **iOS deployment target**: 17.0 (matches Tauri's current iOS support; also lets us use `AVAudioApplication.requestRecordPermission` — iOS 17 deprecated the older `AVAudioSession.requestRecordPermission`).
- **Bundle id**: `app.lipi.ide` (matches Tauri's `tauri.conf.json`).
- **Swift**: 5.10, `Package.swift` style plugin. No external Swift package manager deps; `Speech.framework` and `AVFoundation` are system frameworks.
- **Tauri iOS plugin API**: 2.x's `Channel<T>` for events emitted from native → JS.

## 3. Permission flow

iOS requires two `Info.plist` keys for any voice-capture use:

- `NSSpeechRecognitionUsageDescription` — a one-sentence string the user sees on the first `SFSpeechRecognizer.requestAuthorization` prompt. Suggested text: `"Lipi uses speech recognition to transcribe your voice into text."`
- `NSMicrophoneUsageDescription` — same shape, for the `AVAudioApplication.requestRecordPermission` prompt. Suggested text: `"Lipi needs the microphone to capture your voice for transcription."`

The permission flow on `stt_start_listening`:

1. `SFSpeechRecognizer.requestAuthorization { status in … }` — async callback with one of `.authorized / .denied / .restricted / .notDetermined`.
2. `AVAudioApplication.requestRecordPermission { granted in … }` — async callback with a `Bool`.
3. If either denies, surface a typed `SttError` with `kind: 'permission-denied'` to the JS side. The hook maps that to a `WebSpeechSttError('permission-denied')` analogue and renders "Microphone access was blocked. Enable it in the iOS Settings → Lipi → Microphone" (note: iOS surfaces denial in the OS Settings app, NOT in an in-app re-prompt).
4. If both grant, proceed with the capture loop below.

The JS side does NOT need to do anything special — Tauri's `invoke('stt_start_listening', …)` returns a `Promise<string>` for the `sessionId`; the permission prompts happen synchronously inside that call. The user sees a one-time modal, not a Tauri event sequence.

## 4. Channel contract (Swift → JS)

The Swift side receives an opaque `Channel<TranscriptEvent>` from the JS-side `stt_start_listening` call. The Tauri 2 iOS bridge auto-encodes `Codable` structs to JSON. The shape:

```swift
struct TranscriptEvent: Codable, Equatable {
    /// One of "partial" | "final". Apple emits partials
    /// when `shouldReportPartialResults = true`.
    let kind: String
    /// The partial or final transcript text.
    let text: String
    /// Monotonic sequence number within the current
    /// session. Apple does not provide this — we
    /// increment on each `append` callback.
    let sequence: UInt32
    /// Wall-clock timestamp in ms since epoch
    /// (Date().timeIntervalSince1970 * 1000).
    let timestamp: UInt64
    /// `true` for the last `final` of a session.
    /// Apple does not provide this directly — we
    /// flip it on `speechRecognitionTaskDidFinish`.
    let isUtteranceEnd: Bool
    /// BCP-47 language tag, e.g. "en-US". May be
    /// `nil` if the user hasn't set one and the
    /// recognizer picked a default.
    let language: String?
}
```

The JS side subscribes via Tauri's `listen('stt://transcript', ...)` — same event name as the desktop path. Demux is by `sessionId` once we add it to the event payload (M3 work; for V1 there's only ever one open session at a time, matching the M2c desktop pattern).

## 5. Lifecycle

```swift
// 1. Open the capture session.
func sttStartListening(
    app: AppHandle,
    opts: ListenArgs?,
    sessionId: String,
    channel: Channel<TranscriptEvent>
) -> Result<String, SttError> {
    // 1a. Permission prompts (see §3).
    // 1b. Configure AVAudioSession: category .record,
    //     mode .measurement, options .duckOthers.
    try AVAudioSession.sharedInstance().setCategory(
        .record, mode: .measurement, options: .duckOthers
    )
    try AVAudioSession.sharedInstance().setActive(true)

    // 1c. Build the recognizer.
    let locale = Locale(identifier: opts?.language ?? "en-US")
    guard let recognizer = SFSpeechRecognizer(locale: locale) else {
        return .failure(SttError.noInputDevice)
    }
    guard recognizer.isAvailable else {
        return .failure(SttError.noInputDevice)
    }
    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    request.requiresOnDeviceRecognition = true  // off-cloud by default
    if #available(iOS 17, *) {
        request.addsPunctuation = true
    }

    // 1d. Wire AVAudioEngine input → request.
    let audioEngine = AVAudioEngine()
    let inputNode = audioEngine.inputNode
    let recordingFormat = inputNode.outputFormat(forBus: 0)
    inputNode.installTap(
        onBus: 0, bufferSize: 1024, format: recordingFormat
    ) { buffer, _ in
        request.append(buffer)
    }
    audioEngine.prepare()
    try audioEngine.start()

    // 1e. Start the recognition task. The callback fires
    //     on a private queue — re-dispatch to MainActor
    //     before sending to Tauri's Channel (Tauri's
    //     iOS bridge assumes MainActor for UI-thread
    //     events).
    var seq: UInt32 = 0
    let task = recognizer.recognitionTask(with: request) { result, error in
        Task { @MainActor in
            if let result = result {
                let event = TranscriptEvent(
                    kind: result.isFinal ? "final" : "partial",
                    text: result.bestTranscription.formattedString,
                    sequence: seq,
                    timestamp: UInt64(Date().timeIntervalSince1970 * 1000),
                    isUtteranceEnd: result.isFinal,
                    language: locale.identifier
                )
                seq &+= 1
                try? await channel.send(event)
            }
            if let error = error {
                let kind = mapNsErrorToSttErrorKind(error)
                try? await app.emit("stt://error", SttErrorPayload(
                    kind: kind, message: error.localizedDescription
                ))
            }
        }
    }

    // 1f. Stash the (engine, request, task) tuple in the
    //     process-wide session registry. Return the
    //     sessionId.
    return .success(sessionId)
}

func sttStopListening(
    app: AppHandle,
    sessionId: String
) -> Result<(), SttError> {
    guard let session = sessions.removeValue(forKey: sessionId) else {
        return .success(())  // idempotent
    }
    session.audioEngine.stop()
    session.audioEngine.inputNode.removeTap(onBus: 0)
    session.request.endAudio()
    session.task.cancel()
    return .success(())
}
```

The 30s cap is enforced server-side (matches `stt_capture.rs`'s `DEFAULT_MAX_DURATION_MS`). The JS-side `maxDurationMs` override is forwarded via `opts` in the `start_listening` IPC arg shape (the desktop's `stt_listen_args_js::ListenArgs` is the source of truth).

## 6. Capability flag

Once the plugin is implemented, update `src-tauri/src/voice_platform.rs` so the iOS arm reports:

```rust
#[cfg(target_os = "ios")]
const OS: OsFamily = OsFamily::Ios;

impl VoicePlatformCapabilities {
    // In get_capabilities():
    ondevice: false,           // no Whisper on iOS
    web_speech: false,         // Apple's SpeechRecognition is incomplete
    native_dictation: true,    // this plugin
    os_family: OsFamily::Ios,
}
```

The JS `useVoiceCapabilitiesStore` then auto-picks up the new shape — no JS changes required. The Command Palette's "Use browser speech engine" entry greys out (Decision #46 Q1 already gates it on `capabilities.webSpeech === true`).

## 7. Test plan

Apple's `SFSpeechRecognizer` mocking API is private — there is no `SFSpeechRecognizerMock` to inject a canned response. The only practical tests are:

1. **Permission denial path** — set `AVAudioApplication.shared.recordPermission = .denied` in the test setup; assert `stt_start_listening` rejects with `SttError.permissionDenied`. Use a `Bundle.main.bundleIdentifier` test override to point at a fixture.
2. **Real-device smoke test** — record 5 seconds of speech, assert the final transcript lands in the AIPanel's textarea. This is the integration test; the M2c desktop test file (`useVoiceCapture.ondevice.test.tsx`) is the contract the Swift plugin must satisfy end-to-end.
3. **No-input-device path** — flip `SFSpeechRecognizer.supportsOnDeviceRecognition` to `false` in the unit test (mockable via `SFSpeechRecognizer` subclassing) and assert `stt_start_listening` rejects with `SttError.noInputDevice`.

The plugin has no unit-testable surface without hardware; the "real recording produces a real transcript" assertion is the verification.

## 8. Dependencies

- **No new Swift package manager deps.** `Speech.framework` and `AVFoundation` are system frameworks.
- **Tauri's iOS plugin SDK**: bundled in `tauri = "2"`. The plugin module imports `tauri::ipc::Channel` and `tauri::AppHandle` (the same shape the Rust side uses; Tauri's iOS-bridge code-generates a Swift wrapper for these).
- **No new Rust deps on the Lipi crate.** The Tauri command wrapper lives in `src-tauri/src/ios_stt_plugin.rs` and follows the same `#[tauri::command]` + `pub use` shape as `stt.rs` / `stt_capture.rs`.

## 9. Open questions

1. **Does the existing `tauri-plugin-stronghold` cover the iOS keychain for the `wisprApiKey` we don't need here?** No — Stronghold is for secrets we want to encrypt at rest in the app's data dir. We don't store the Wispr key on iOS in M2c mobile (we read it from the OS keychain via the `keyring` crate's `apple-native` feature, the same as macOS). The plugin does NOT need Stronghold.
2. **Do we need a separate iOS "main" thread policy for the AVAudioEngine tap?** Apple's docs say the input tap fires on a real-time audio thread, not the main thread. Tauri's `Channel.send` is `async` and we re-dispatch to `MainActor` inside the `recognitionTask` callback (the per-result callback, not the per-buffer one). The per-buffer `installTap` closure just calls `request.append(buffer)` — `SFSpeechAudioBufferRecognitionRequest.append` is thread-safe per Apple's docs.
3. **Does the user have to enable "Speech Recognition" in iOS Settings, or is the runtime prompt enough?** The runtime prompt (`SFSpeechRecognizer.requestAuthorization`) is enough. The user goes to iOS Settings → Lipi → Speech Recognition only if they denied at the prompt; we do NOT re-prompt programmatically (Apple's policy).

## 10. Estimated effort

~250 LoC Swift + ~50 LoC SwiftPM config + ~50 LoC unit tests + a one-day on-device smoke test on a Mac with Xcode 16+. One focused session.

---

*Last touched: M2c mobile (June 2026). See `docs/decisions/0046-m2c-mobile-shim.md` for the ADR; see `docs/plugins/lipi-stt-android/README.md` for the Android sibling.*
