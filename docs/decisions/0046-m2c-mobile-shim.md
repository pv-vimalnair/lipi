# ADR #46 — M2c mobile: Web Speech API shim + iOS/Android native plugin contracts

**Date**: June 2026
**Phase**: M2c mobile
**Status**: Accepted
**Supersedes**: n/a
**Deciders**: project lead (Vimal Nair), with `M2c-mobile` review

## Context

M2c mobile extends the desktop `useVoiceCapture` hook to a Web Speech API shim and lays the iOS / Android native plugin contracts. The desktop path is `onDevice` (Whisper). Mobile doesn't have Whisper; we have three platforms (Windows / macOS / iOS) where the WebView exposes `window.SpeechRecognition`, and two (Linux GTK / Android) where it does not. iOS Safari's `SpeechRecognition` is documented as not for production use; Android's system WebView strips it in production builds.

The four locked decisions the user already approved in advance of this ADR:

- **Q1.** Add `language?: string` to `useVoicePreferencesStore` and pass through the hook → orchestrator. Persisted.
- **Q2.** Rely on WebView's permission chrome. No custom consent dialog.
- **Q3.** Mirror On-device: hide the Web Speech provider behind an "Or use the browser's built-in speech engine" subsection in `SettingsProvider`. NOT a 3rd radio in the top section.
- **Q4.** Build a `useVoiceCapabilitiesStore` Zustand store, hydrated at app startup. Command Palette `isEnabled` predicates read from it synchronously.

## Decision

### D1. Shim, not an abstraction layer

The M2c mobile Web Speech API provider is a `transcribeViaWebSpeech()` function with the same shape as `transcribeViaOnDevice()`: a single async function that returns `Promise<string>`. We do NOT introduce a common `STTProvider` interface — the existing `useVoiceCapture` switch on `provider` is the polymorphism point, and there are only two arms in V1 (`ondevice` and `webSpeech`). When iOS / Android native plugins land (M3), they will be a third arm in the same switch, not a runtime-dispatched interface. This keeps the V1 type surface flat and avoids premature abstraction.

### D2. `language` is stored, not user-picked (Q1, V1 scope)

We persist `language: string` (default `'en-US'`) in `useVoicePreferencesStore` and thread it through the orchestrator — but the V1 settings UI does NOT expose a language picker. The `WebSpeechCard` is a single toggle. M3 will add the picker; for V1 the language is "what the user has in their OS language preferences" (the WebView picks it up automatically from `navigator.language`). This is a deliberate scope-cut: the V1 Web Speech shim works on a fresh install with zero config, the picker is a future-proofing field.

### D3. Mirrored subsection, not a third radio (Q3)

`SettingsProvider`'s Voice section has the same "Choose how Lipi captures your voice" top section it had in M2c (`OnDeviceCard` + `WisprCard`). We add a new `<h3>` "Or use the browser's built-in speech engine" below the two cards, then a `<WebSpeechCard>` that mirrors the `OnDeviceCard`'s header/badge/lede/toggle shape. The toggle calls `setProvider('webSpeech')` (or falls back to `setProvider('wispr')` on platforms where `capabilities.webSpeech === false`).

### D4. Capability store, hydrated at startup (Q4)

`useVoiceCapabilitiesStore` is a non-persisted Zustand store (capabilities are process-lifetime; they don't survive a relaunch and they shouldn't). It is hydrated from `voicePlatformGetCapabilities()` IPC inside `aiStore.ts`'s bootstrap, immediately after `setupVoicePreferencesPersistence()`. The Command Palette's `voice.provider.webspeech` and `voice.provider.ondevice` `isEnabled` predicates read from the store synchronously — they do NOT `await` the IPC.

### D5. Permission prompts: WebView's chrome (Q2)

The M2c mobile shim does not implement a custom consent dialog. The first `recognition.start()` on each session surfaces the WebView's built-in mic-permission prompt (and, on iOS, the speech recognition authorization prompt). We surface the typed `WebSpeechSttError('permission-denied')` to the hook, which renders a "Microphone access was blocked. Enable it in the [platform settings] → Lipi → Microphone" callout. This is the same shape the desktop On-device hook uses; we do not duplicate the in-app UX.

### D6. iOS / Android plugins are MARKDOWN CONTRACTS in V1

The user's working environment is Windows 10, no Xcode, no Android Studio + NDK. The Swift `SFSpeechRecognizer` plugin and Kotlin `SpeechRecognizer` plugin are **fully documented in `docs/plugins/lipi-stt-ios/README.md` and `docs/plugins/lipi-stt-android/README.md`** but the corresponding `.swift` and `.kt` files are not written. When a future session has Xcode 16+ / Android Studio Iguana+, it can fill in the contracts verbatim.

We do NOT stub the Rust `voice_platform.rs` `OsFamily::Ios` / `OsFamily::Android` arms with placeholder `web_speech: true` — they report `web_speech: false, native_dictation: true`, and the `WebSpeechCard` / Command Palette `voice.provider.webspeech` entry correctly greys out.

## Risks (carried from the architecture summary; not blockers)

- **R1.** WebKitGTK (Linux) does not ship `SpeechRecognition` in the default build. Capability reports `web_speech: false` on Linux; the `WebSpeechCard` greys out.
- **R2.** iOS Safari's `SpeechRecognition` is documented as not for production use. We do not gate on it; the iOS arm reports `web_speech: false` and the Swift plugin is the production path.
- **R3.** Android system WebView strips `SpeechRecognition` in the production Google Play build. Same shape: capability reports `web_speech: false`, Kotlin plugin is the production path.
- **R4.** Web Speech API is **not in `lib.dom.d.ts`**. We add a minimal local type definition in `src/voice/webSpeechTypes.ts` and import it from `webSpeechSTT.ts`. The `window.SpeechRecognition ?? window.webkitSpeechRecognition` feature-detect is the runtime check.
- **R5.** The Web Speech API has no native "stop" signal — calling `recognition.stop()` flushes whatever is buffered, but some browsers (notably Firefox via `mozilla-speech` or older Chrome) leave the recognition object in a `STARTED` state for up to 500ms. The hook calls `recognition.stop()` first, then `recognition.abort()` after a 500ms timeout if `onend` has not fired. This matches the desktop On-device hook's `stop()` branch.
- **R6.** The Web Speech API has no native "max duration" / "max silence" cap. The hook's existing `maxDurationMs` cap (30s default) is enforced on the JS side via a `setTimeout` that fires `recognition.abort()` at the deadline.
- **R7.** Chromium-based browsers log a console warning when `SpeechRecognition` is used on an insecure origin (anything other than `localhost`, `127.0.0.1`, or `https://`). Tauri's dev server uses `localhost` and the production build is a `tauri://` origin, which the WebView treats as secure. The console warning is a no-op but a noisy one; we do not silence it.
- **R8.** Web Speech is single-session per page — calling `recognition.start()` while a previous `recognition.start()` is in flight throws `InvalidStateError`. The hook guards on `isListening` and bails out (returns the in-flight `AbortController.signal` promise, unchanged).
- **R9.** Chromium's `recognition.onresult` is the only signal we get for partials. We do not retry on `onerror`; we surface the typed `WebSpeechSttError` and let the hook's error UI render.
- **R10.** The iOS / Android native plugin contracts assume the future session will land on the iOS 17 / Android API 24+ floors. If the floor changes, the contracts are still valid; only the `setup` block of each plugin needs an `#available` guard.

## Consequences

### Positive

- V1 works on Windows / macOS / iOS WebView with zero plugin work — the Web Speech API shim is the production path for those three platforms.
- The iOS / Android plugin contracts are concrete enough that a future session can land them in a single focused PR.
- The capability store pattern (`useVoiceCapabilitiesStore`, `getVoicePlatformCapabilities()` cached wrapper) is reusable for M3 (camera, microphone device enumeration, etc.).
- The shim is constructor-injected (`webSpeechCtor` for tests, `windowOverride` for the test setup), so the V1 test file (`webSpeechSTT.test.ts`) covers 100% of the orchestrator branches without hardware.

### Negative

- V1 is "Web Speech API on the platforms that have it, plugin contracts on the platforms that don't." On Linux GTK and Android, the `webSpeech` provider is greyed out until the native plugins land.
- The user has to know that the language picker is coming. We are not advertising the V1 limitation; the store field is a quiet future-proofing.
- The iOS / Android plugin markdown contracts are not executable. A future session's first task is to verify the contracts are still current (Tauri 2 / iOS 17 / Android 14+ API levels).
- The capability store is hydrated asynchronously at app startup. For the first ~50ms after launch, `useVoiceCapabilitiesStore.getState().capabilities` is `null` and the Command Palette entries' `isEnabled` predicates return `false`. This is acceptable; the entries are dimmed for the first paint.

## Implementation notes

- The `src-tauri/src/voice_platform.rs` `OsFamily::LinuxGtk` arm is the one named for WebKitGTK's actual capability surface (no `SpeechRecognition` by default), not a "Linux with the `gtk` Cargo feature" gate. There is no `gtk` Cargo feature in this crate.
- The `useVoiceCapture` hook's `webSpeech` branch mirrors the `ondevice` branch's `startXxxRecording(generation)` + `webSpeechHandleRef` pattern. The `stop()` branch calls `webSpeechHandleRef.current?.abort()` with the same 500ms fallback the desktop `ondevice` hook uses.
- The `WebSpeechCard.module.css` reuses the existing class vocabulary from `OnDeviceCard.module.css` — the cards look like siblings, not strangers.
- The `voice.provider.webspeech` Command Palette entry is the only entry in M2c mobile that is *capability-gated* — every other M2c command is unconditional. The `isEnabled` predicate is the only place the `useVoiceCapabilitiesStore` is read synchronously outside of the Settings UI.

## References

- `docs/plugins/lipi-stt-ios/README.md` — Swift `SFSpeechRecognizer` contract
- `docs/plugins/lipi-stt-android/README.md` — Kotlin `SpeechRecognizer` contract
- `src/voice/webSpeechSTT.ts` — the shim
- `src/shared/state/voiceCapabilitiesStore.ts` — the capability store
- `src/screens/SettingsProvider/components/WebSpeechCard.tsx` — the settings card
- `src/shared/commands/commands.ts` — the Command Palette entries
- `src-tauri/src/voice_platform.rs` — the Rust capability function
- `HANDOFF.md §9.8` — "M2c mobile — SHIPPED" callout

---

*Last touched: M2c mobile (June 2026). See `CHANGELOG.md` "Unreleased" for the user-facing summary.*
