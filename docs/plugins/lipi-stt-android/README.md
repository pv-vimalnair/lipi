# lipi-stt-android — Android native STT plugin contract

**Status: Phase 0 contract only. No Kotlin code. This file describes the contract a future session on a Linux/Windows box with Android Studio Iguana or newer will fill in.**

## 1. Goal

Replace the WebView's `window.SpeechRecognition` (which the M2c mobile shim uses on every platform that exposes it) with Android's native `android.speech.SpeechRecognizer` (the Google one — `com.google.android.gms.location.LocationServices`-style API surface, NOT `android.speech.RecognizerIntent` the dialog-based one). Forward partial + final transcripts to the Lipi JS side over a Tauri `Channel<TranscriptEvent>` and gate the M2c mobile provider-picker on the platform capability flag.

The end-state: on Android the `useVoiceCapabilitiesStore` reports `webSpeech: false` and `nativeDictation: true`, and the Command Palette's "Use browser speech engine" entry is greyed out. Unlike iOS, Android's `SpeechRecognizer` IS the production API — it ships with the system since API 22 (Lollipop 5.1, 2015). There's no Safari-style "feature-incomplete Web Speech" trap.

## 2. Targets

- **minSdk**: 24 (Android 7.0). Tauri's current Android support floor.
- **targetSdk**: 35 (Android 15). Required by Play Store as of August 2025.
- **compileSdk**: 35.
- **Kotlin**: 2.0.x (matches Tauri's current Android Gradle plugin).
- **Gradle**: 8.7+, AGP 8.5+.
- **Tauri Android plugin API**: 2.x's `Channel<T>` for events emitted from native → JS (same shape as the iOS sibling, by design).
- **JDK**: 17 (LTS, required by AGP 8.5+).

## 3. Permission flow

The Android side needs three `AndroidManifest.xml` entries plus two runtime permission requests.

**Static (manifest):**

- `<uses-permission android:name="android.permission.RECORD_AUDIO" />` — the mic access. Required.
- `<uses-permission android:name="android.permission.INTERNET" />` — `SpeechRecognizer`'s default online recognizer needs network. The offline one (`EXTRA_PREFER_OFFLINE = true`) does NOT need internet but is opt-in.
- `<queries><intent>...com.google.android.voicesearch.VOICE_SEARCH_RESULTS</intent></queries>` — required so we can `packageManager.resolveActivity` to check the device has a `SpeechRecognizer` before the user tries to use it. (Android 11+ package visibility).

**Runtime (in code):**

1. `ActivityCompat.requestPermissions(RECORD_AUDIO, REQUEST_CODE)` — sync callback via `onRequestPermissionsResult`.
2. `SpeechRecognizer.createSpeechRecognizer(context)` — throws `ERROR_CLIENT` if the system service isn't present (some Fire tablets, some ChromeOS devices in tablet mode).
3. `SpeechRecognizer.checkRecognitionSupport` (API 31+) — returns the set of installed recognizers. If empty, surface `SttError.noInputDevice`.
4. If the runtime prompt was denied, surface `SttError.permissionDenied` and DO NOT re-prompt. The user goes to Android Settings → Apps → Lipi → Permissions → Microphone.

```kotlin
object SttPermissionBridge {
    const val REQUEST_CODE_RECORD_AUDIO = 71001

    fun ensurePermissions(activity: AppCompatActivity) {
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(
                activity, arrayOf(Manifest.permission.RECORD_AUDIO),
                REQUEST_CODE_RECORD_AUDIO
            )
        }
    }
}
```

The JS side does NOT need to do anything special — Tauri's `invoke('stt_start_listening', …)` returns a `Promise<string>` for the `sessionId`; the permission prompts happen synchronously inside that call.

## 4. Channel contract (Kotlin → JS)

The Kotlin side receives an opaque `Channel<TranscriptEvent>` from the JS-side `stt_start_listening` call. Tauri's 2.x Android bridge auto-encodes `@Serializable` data classes to JSON via `kotlinx.serialization` (we'll add the dep to `build.gradle.kts`). The shape mirrors the iOS plugin:

```kotlin
@Serializable
data class TranscriptEvent(
    val kind: String,          // "partial" | "final"
    val text: String,          // the partial or final transcript
    val sequence: UInt32,      // monotonic per session (we increment)
    val timestamp: UInt64,     // wall-clock ms since epoch
    val isUtteranceEnd: Boolean, // true on the last `final`
    val language: String?      // BCP-47, e.g. "en-US"
)
```

The JS side subscribes via Tauri's `listen('stt://transcript', ...)` — same event name as the iOS and desktop paths.

## 5. Lifecycle

```kotlin
class SttSession(
    val context: Context,
    val channel: Channel<TranscriptEvent>,
    private val recognizer: SpeechRecognizer,
    private val intent: Intent
) {
    fun start() {
        recognizer.startListening(intent)
    }

    fun stop() {
        recognizer.stopListening()
    }

    fun cancel() {
        recognizer.cancel()
    }
}

fun sttStartListening(
    activity: AppCompatActivity,
    args: ListenArgs,
    sessionId: String,
    channel: Channel<TranscriptEvent>
): Result<String> {
    // 1. Permission check (see §3).
    SttPermissionBridge.ensurePermissions(activity)

    // 2. Build the recognizer.
    val recognizer = SpeechRecognizer.createSpeechRecognizer(activity)
    if (recognizer == null) {
        return Result.failure(SttError.noInputDevice)
    }

    // 3. Build the listen intent. We request partials
    //    and prefer on-device recognition where
    //    available (API 31+).
    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(
            RecognizerIntent.EXTRA_LANGUAGE_MODEL,
            RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
        )
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, args.language ?: "en-US")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
        }
    }

    // 4. Wire the recognizer callback. Android's
    //    SpeechRecognizer fires on the main thread,
    //    so we can call channel.send directly.
    var seq: UInt32 = 0u
    recognizer.setRecognitionListener(object : RecognitionListener {
        override fun onPartialResults(partialResults: Bundle?) {
            val text = partialResults
                ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                ?.firstOrNull() ?: return
            val event = TranscriptEvent(
                kind = "partial",
                text = text,
                sequence = seq++,
                timestamp = System.currentTimeMillis(),
                isUtteranceEnd = false,
                language = args.language
            )
            scope.launch { channel.send(event) }
        }

        override fun onResults(results: Bundle?) {
            val text = results
                ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                ?.firstOrNull() ?: ""
            val event = TranscriptEvent(
                kind = "final",
                text = text,
                sequence = seq++,
                timestamp = System.currentTimeMillis(),
                isUtteranceEnd = true,
                language = args.language
            )
            scope.launch { channel.send(event) }
        }

        override fun onError(error: Int) {
            val kind = mapAndroidErrorToSttErrorKind(error)
            // 7 = ERROR_NO_MATCH, 9 = ERROR_INSUFFICIENT_PERMISSIONS
            // — the JS side handles the user-facing copy.
            try {
                app.emit("stt://error", SttErrorPayload(
                    kind = kind, message = "SpeechRecognizer error $error"
                ))
            } catch (e: Throwable) {
                // emit is best-effort
            }
        }

        override fun onEndOfSpeech() { /* no-op; final follows */ }
        override fun onReadyForSpeech(params: Bundle?) { /* no-op */ }
        override fun onBeginningOfSpeech() { /* no-op */ }
        override fun onRmsChanged(rmsdB: Float) { /* no-op */ }
        override fun onBufferReceived(buffer: ByteArray?) { /* no-op */ }
        override fun onEvent(eventType: Int, params: Bundle?) { /* no-op */ }
    })

    // 5. Stash the session. Return the sessionId.
    val session = SttSession(activity, channel, recognizer, intent)
    sessions[sessionId] = session
    session.start()
    return Result.success(sessionId)
}

fun sttStopListening(sessionId: String): Result<Unit> {
    val session = sessions.remove(sessionId) ?: return Result.success(Unit)
    session.stop()
    // Android's SpeechRecognizer is single-shot. We
    // must destroy() and rebuild for the next session.
    session.recognizer.destroy()
    return Result.success(Unit)
}
```

The 30s cap is enforced server-side (`stt_capture.rs` `DEFAULT_MAX_DURATION_MS`). The `maxDurationMs` override is forwarded via `args` in the IPC.

## 6. Capability flag

Once the plugin is implemented, update `src-tauri/src/voice_platform.rs` so the Android arm reports:

```rust
#[cfg(target_os = "android")]
const OS: OsFamily = OsFamily::Android;

impl VoicePlatformCapabilities {
    // In get_capabilities():
    ondevice: false,           // no Whisper on Android
    web_speech: false,         // Chromium build strips it in prod
    native_dictation: true,    // this plugin
    os_family: OsFamily::Android,
}
```

The JS `useVoiceCapabilitiesStore` auto-picks up the new shape — no JS changes required. The Command Palette's "Use browser speech engine" entry greys out.

## 7. Test plan

Android's `SpeechRecognizer` is a system service — there is no public `SpeechRecognizerMock`. The only practical tests are:

1. **Permission denial path** — use `Mockito` to mock `ActivityCompat.checkSelfPermission` returning `PERMISSION_DENIED`; assert `sttStartListening` rejects with `SttError.permissionDenied`.
2. **No-recognizer path** — mock `SpeechRecognizer.createSpeechRecognizer` to return `null`; assert `SttError.noInputDevice`.
3. **Real-device smoke test** — record 5 seconds of speech, assert the final transcript lands in the AIPanel's textarea. This is the integration test; the M2c desktop test file (`useVoiceCapture.ondevice.test.tsx`) is the contract the Kotlin plugin must satisfy end-to-end.
4. **Error code mapping** — verify `mapAndroidErrorToSttErrorKind` translates `ERROR_INSUFFICIENT_PERMISSIONS=9 → 'permission-denied'`, `ERROR_NO_MATCH=7 → 'no-match'`, `ERROR_NETWORK=2 → 'network'`, `ERROR_RECOGNIZER_BUSY=8 → 'busy'`, `ERROR_CLIENT=5 → 'client'`, `ERROR_SPEECH_TIMEOUT=6 → 'timeout'`, default → `'unknown'`.

The plugin has no unit-testable surface without hardware; the "real recording produces a real transcript" assertion is the verification.

## 8. Dependencies

- **No new Maven deps.** `android.speech.SpeechRecognizer` is a system service. `androidx.core:core-ktx` is already in Tauri's transitive set.
- **`kotlinx-serialization-json`**: 1.6.x — required for `@Serializable` on the `TranscriptEvent` data class. Tauri's existing Android Gradle plugin already pulls `kotlinx-serialization-core` for the bridge.
- **Tauri's Android plugin SDK**: bundled in `tauri = "2"`. The plugin module imports `tauri::ipc::Channel` and `tauri::AppHandle`.
- **No new Rust deps on the Lipi crate.** The Tauri command wrapper lives in `src-tauri/src/android_stt_plugin.rs` and follows the same `#[tauri::command]` + `pub use` shape as `stt.rs` / `stt_capture.rs`.

## 9. Open questions

1. **On-device vs. cloud recognizer?** Android's `SpeechRecognizer` is cloud by default. The `EXTRA_PREFER_OFFLINE` hint (API 31+) tells the system to prefer the on-device model IF the OEM shipped one (Pixel does, Samsung does, OnePlus does not). For M2c mobile V1 we set `EXTRA_PREFER_OFFLINE = true` and accept that the user might fall back to cloud if their OEM didn't ship the on-device model. The M2c desktop's privacy contract is "the user's voice never leaves the device" — we will revisit this and either ship the on-device model ourselves or make the privacy callout clearer in M3.
2. **Why not the dialog-based `RecognizerIntent`?** It's the Google "Voice Search" dialog. The user has to tap a "Speak now" card. That breaks the `useVoiceCapture` hook's "press spacebar → speak → release" model. We use the lower-level `SpeechRecognizer` API directly.
3. **WebView on Android vs. this plugin?** Android's system WebView (Chromium) DOES support `SpeechRecognition` in development, but the production Google Play build of Chromium strips it for privacy (since 2022). On an iOS-style "feature-incomplete Web Speech" trap, we already route around it in the shim. This plugin is the path that actually works on production ChromeOS-on-Android and production Android.
4. **Locale fallback chain?** `RecognizerIntent.EXTRA_LANGUAGE` accepts a single BCP-47 tag. If the user's system language isn't supported, the recognizer silently no-matches. The M2c mobile shim only supports `en-US` V1; we'll revisit locale chains in M3.

## 10. Estimated effort

~300 LoC Kotlin + ~30 LoC Gradle config + ~50 LoC unit tests + a one-day on-device smoke test on an Android 14/15 device or emulator. One focused session on a Linux box with Android Studio Iguana+.

---

*Last touched: M2c mobile (June 2026). See `docs/decisions/0046-m2c-mobile-shim.md` for the ADR; see `docs/plugins/lipi-stt-ios/README.md` for the iOS sibling.*
