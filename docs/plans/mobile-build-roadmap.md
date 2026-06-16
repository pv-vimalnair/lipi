# Mobile-Build Roadmap — Umbrella Plan for the Future Mac / Linux Sessions

> **For:** The project lead (or a future contributor) on
> a Mac with Xcode 16+ (iOS) and a Linux / Windows box
> with Android Studio Iguana+ (Android). This is the
> "you are here, do these 5 things, in this order,
> verify at each step" document.

## Status

The mobile-build roadmap Phase A is SHIPPED (see
`HANDOFF.md §9.48`). Phase A ships the **seam**:

- `tauri.conf.json` mobile block
- `tauri.android.conf.json` + `tauri.ios.conf.json`
- `tauri-plugin-stronghold` Cargo dep + per-platform
  secrets-backend pick
- The app icon set
- The store-metadata templates
- The CI toolchain smoke check

This document is the **plug** — the work items the
future Mac / Linux session fills in.

## Future-session checklist (iOS)

Order matters; do them top to bottom.

### Step 1: Open the project in Xcode 16+ on a Mac

```bash
git checkout main
cargo install tauri-cli --version "^2"
cd src-tauri
cargo tauri ios init
# This generates src-tauri/gen/apple/ with the
# Xcode project, Info.plist, asset catalog, etc.
```

Verify: `src-tauri/gen/apple/lipi.xcodeproj` exists
and opens in Xcode.

### Step 2: Add the iOS plugin

The `lipi-stt-ios` Swift plugin is documented in
`docs/plugins/lipi-stt-ios/README.md` (~210 lines,
9 sections). The implementation is a verbatim
fill-in of the contract:

1. Create `src-tauri/gen/apple/Sources/lipi-stt-ios/`.
2. Add the Swift files per README §5.
3. Add the `Package.swift` per README §8.
4. Register the plugin in the iOS `AppDelegate` per
   Tauri's iOS-plugin registration docs.

Verify: `cargo build --target aarch64-apple-ios`
compiles cleanly.

### Step 3: Add the iOS Info.plist permission keys

Tauri's default `Info.plist` (in
`src-tauri/gen/apple/`) needs:

- `NSSpeechRecognitionUsageDescription`
- `NSMicrophoneUsageDescription`

The values are documented in
`docs/plugins/lipi-stt-ios/README.md` §3.

Verify: open the `.xcodeproj` in Xcode, navigate to
`Info.plist`, confirm the keys are present.

### Step 4: Build the iOS .app

```bash
cd src-tauri
cargo tauri ios build
# Builds src-tauri/gen/ios/build/lipi.app
```

Verify: the `.app` bundle exists.

### Step 5: Smoke test on a real iOS device

1. Connect an iPhone running iOS 17+.
2. `cargo tauri ios dev` (or open the `.xcodeproj`
   in Xcode and Run on the device).
3. Open the Lipi app, grant the mic + speech
   recognition permissions.
4. Open a code file in the editor.
5. Tap the voice button, say "function foo open paren
   close paren".
6. Verify the transcript "function foo()" lands in
   the editor.

This is the integration test (HANDOFF §9.48
Verification). The M2c desktop test file
(`useVoiceCapture.ondevice.test.tsx`) is the
contract the Swift plugin must satisfy end-to-end.

### Step 6: Code signing + App Store submission

This step is the project-lead-only one. The
`release-ios` job in `.github/workflows/release.yml`
is commented out; the project lead:

1. Joins the Apple Developer Program ($99/year).
2. Creates an App Store Connect app record for
   `app.lipi.ide`.
3. Creates a Distribution certificate + an App
   Store distribution provisioning profile.
4. Adds the certificate + profile as base64-encoded
   CI secrets (`APPLE_CERTIFICATE` /
   `APPLE_PROVISIONING_PROFILE`).
5. Uncomments the `release-ios` job.
6. Pushes a `v*.*.*` tag; the workflow builds +
   uploads the `.ipa` to App Store Connect.

## Future-session checklist (Android)

Order matters; do them top to bottom.

### Step 1: Open the project in Android Studio Iguana+ on a Linux / Windows box

```bash
git checkout main
cargo install tauri-cli --version "^2"
cd src-tauri
cargo tauri android init
# This generates src-tauri/gen/android/ with the
# Android Studio project, AndroidManifest.xml, etc.
```

Verify: `src-tauri/gen/android/` exists and opens
in Android Studio.

### Step 2: Add the Android plugin

The `lipi-stt-android` Kotlin plugin is documented in
`docs/plugins/lipi-stt-android/README.md` (~250
lines, 9 sections). The implementation is a
verbatim fill-in of the contract:

1. Create
   `src-tauri/gen/android/app/src/main/kotlin/app/lipi/ide/stt/`.
2. Add the Kotlin files per README §5.
3. Register the plugin in the Android
   `MainApplication` per Tauri's Android-plugin
   registration docs.

Verify: `cargo build --target aarch64-linux-android`
compiles cleanly.

### Step 3: Add the AndroidManifest.xml permission keys

Tauri's default `AndroidManifest.xml` (in
`src-tauri/gen/android/`) needs:

- `<uses-permission android:name="android.permission.RECORD_AUDIO" />`
- `<uses-permission android:name="android.permission.INTERNET" />`
- `<queries><intent>...com.google.android.voicesearch.VOICE_SEARCH_RESULTS</intent></queries>`

The values are documented in
`docs/plugins/lipi-stt-android/README.md` §3.

Verify: open the project in Android Studio, navigate
to `AndroidManifest.xml`, confirm the keys are
present.

### Step 4: Build the Android .aab

```bash
cd src-tauri
cargo tauri android build --apk false --aab true
# Builds src-tauri/gen/android/app/build/outputs/bundle/release/app-release.aab
```

Verify: the `.aab` exists.

### Step 5: Smoke test on a real Android device

1. Connect an Android phone running Android 7.0+
   with USB debugging enabled.
2. `cargo tauri android dev` (or open the project
   in Android Studio and Run on the device).
3. Open the Lipi app, grant the mic + speech
   recognition permissions.
4. Open a code file in the editor.
5. Tap the voice button, say "function foo open
   paren close paren".
6. Verify the transcript "function foo()" lands in
   the editor.

This is the integration test (HANDOFF §9.48
Verification). Same as the iOS smoke test; the
test surface is identical because the JS-side
`useVoiceCapture` hook is unchanged.

### Step 6: Code signing + Play Store submission

This step is the project-lead-only one. The
`release-android` job in
`.github/workflows/release.yml` is commented out;
the project lead:

1. Creates a Google Play Developer account ($25
   one-time).
2. Creates a Google Cloud project with the Play
   Android Developer API enabled.
3. Creates a service account with the "Play
   Android Developer" role; downloads the
   service-account JSON.
4. Creates an Android keystore
   (`keytool -genkey -v -keystore lipi.keystore ...`);
   uploads the public key to Google Play App
   Signing.
5. Adds the keystore + service-account JSON as
   CI secrets (`ANDROID_KEYSTORE_FILE` /
   `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`).
6. Uncomments the `release-android` job.
7. Pushes a `v*.*.*` tag; the workflow builds
   + uploads the `.aab` to Google Play.

## Troubleshooting

### "Tauri iOS build fails on the codesign step"

The Apple Distribution certificate isn't in the
keychain. Re-import the certificate per
`release.yml`'s commented-out `release-ios` job
(the `security import` + `security
set-key-partition-list` steps).

### "Tauri Android build fails on the apk-signer step"

The keystore password is wrong. The
`keytool -list -keystore lipi.keystore -storepass
$YOUR_PASSWORD` command verifies the password
without modifying the keystore.

### "The Swift plugin crashes on `SFSpeechRecognizer.requestAuthorization`"

iOS 17+ requires the
`NSMicrophoneUsageDescription` Info.plist key.
Without it, the app crashes with
`This app has crashed because it attempted to access
privacy-sensitive data without a usage description`.
The fix is to add the key to the `Info.plist` (see
Step 3 of the iOS checklist).

### "The Kotlin plugin crashes on `SpeechRecognizer.createSpeechRecognizer`"

The Android device doesn't have the Google speech
recognition service installed. The fix is to either
(a) install the Google app (which ships the
service) on the test device, or (b) use a different
recognizer implementation (e.g. the offline Vosk
recognizer, which is a much bigger lift).

### "The voice transcript doesn't land in the editor"

The `tauri-plugin-stronghold` Cargo dep isn't
enabled. The fix is to build with
`cargo tauri {ios,android} build --features mobile`
(the `mobile` feature gates the Stronghold dep).

The actual wiring of the Stronghold facade into
the IPC commands is also a future-session task
(see HANDOFF §9.48 "What does NOT ship in
Phase A"). The dispatch helpers
(`pick_secrets_backend` + `map_stronghold_error`)
are in place and tested; the facade itself
(`secrets_stronghold.rs` with the
`Stronghold::create_client` calls) is not.

## See also

- `HANDOFF.md §9.48` — Phase A writeup
- `docs/superpowers/specs/2026-06-16-mobile-build-roadmap-design.md` —
  the Phase A design spec
- `docs/plugins/lipi-stt-ios/README.md` — the iOS
  plugin contract
- `docs/plugins/lipi-stt-android/README.md` — the
  Android plugin contract
- `docs/store-metadata/app-store.md` — App Store
  Connect metadata
- `docs/store-metadata/google-play.md` — Google Play
  Console metadata
