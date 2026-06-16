# Mobile-Build Roadmap — Phase A (Windows-doable) (design)

**Date**: 2026-06-16
**Phase**: Mobile-Build Roadmap (Phase A)
**Status**: Design (accepted for implementation)
**Supersedes**: n/a — first phase of the mobile-build roadmap
**Closes**: the "mobile-build roadmap" item in the HANDOFF end-of-handoff queue (the M3 follow-up was closed in §9.47; the mobile-build roadmap is the umbrella for "actually shipping Lipi as a mobile app")

## Goal

Ship the **Windows-doable scaffolding** for the iOS and Android build pipelines, the per-platform config, the icon set, the App Store / Play Store metadata templates, and the CI extensions. The actual Swift `SFSpeechRecognizer` plugin, Kotlin `SpeechRecognizer` plugin, iOS `Info.plist` / Android `AndroidManifest.xml` permission keys, code signing, and App Store / Play Store uploads all require a Mac with Xcode 16+ and a Linux / Windows box with Android Studio Iguana+ to run. Phase A ships the **seam**; the Mac / Linux future session fills in the **plug** (the Swift / Kotlin source code + the actual store uploads).

This phase also adds `tauri-plugin-stronghold` as the Android-side keychain (the `keyring` 3.x crate Lipi uses on desktop does not support Android — this was explicitly noted in HANDOFF §9.4, Phase 5a, the AI keychain decision). The JS-side `secrets` module picks a backend at startup based on `osFamily` (already exposed via `voice_platform.rs`).

## Non-goals (Phase A explicitly does not do)

- **No Swift / Kotlin source code.** The M3 follow-up (§9.47) ships the contract; the implementation is a future Mac / Linux session.
- **No iOS / Android app-store uploads.** The release pipeline (`.github/workflows/release.yml`) gets commented-out placeholders for the `release-ios` and `release-android` jobs; the project lead uncomments + configures the signing secrets before the first real mobile release.
- **No real iOS / Android device testing.** Smoke tests are a future-session task; the CI matrix entries for `cargo tauri ios info` and `cargo tauri android info` validate the toolchain setup without running a real build.
- **No iOS / Android UI changes.** The mobile UI uses the same React shell as desktop; no per-platform React code.
- **No Tauri 2 version bump.** The mobile feature set in Tauri 2.x has been stable since 2.1; no upgrade forced by this phase.
- **No per-platform font / spacing / icon set tuning.** The mobile shell reuses the desktop CSS variables; layout reflows are handled by the existing `useViewport` hook + CSS media queries.

## What ships in Phase A

| # | Item | Type | Why now |
|---|------|------|---------|
| 1 | `tauri.conf.json` mobile block (`bundle.android` + `bundle.iOS`) | config | Tauri reads these on `cargo tauri android/ios build`. The blocks are inert on the desktop build. |
| 2 | `tauri.android.conf.json` + `tauri.ios.conf.json` per-platform override files | config | Tauri 2's per-platform config mechanism. Holds platform-specific icon paths, code signing identities, and the iOS / Android `Info.plist` / `AndroidManifest.xml` keys. |
| 3 | The `tauri-plugin-stronghold` Cargo dep + the per-platform secrets-backend pick (in `secrets.rs`) | Rust | `keyring` 3.x doesn't support Android; Stronghold is the Tauri ecosystem's standard answer. The `secrets` module picks the backend at startup based on `osFamily`. The actual `secrets_stronghold.rs` facade (the `get` / `set` functions) + the plugin init in `lib.rs` (the `Builder::new(password-hash)` call) are deferred to the future Mac / Linux session — they need a real Android password-flow design, which is project-lead-only. |
| 4 | The app icon set (`icons/ios/...` + `icons/android/...` + the source 1024×1024 PNG) | assets | Tauri requires platform-specific icon sets. The `cargo tauri icon` CLI generates them from a single source PNG; it runs on any platform. |
| 5 | `docs/store-metadata/app-store.md` + `docs/store-metadata/google-play.md` | docs | Store-metadata templates. The project lead fills in the placeholders before submitting. |
| 6 | CI additions to `.github/workflows/ci.yml` (mobile matrix entries) and `.github/workflows/release.yml` (commented-out `release-ios` + `release-android` jobs) | CI | The macos-latest + ubuntu-latest GitHub-hosted runners have the iOS / Android toolchains. The CI jobs are added as `cargo tauri {ios,android} info` smoke checks (no real build). |
| 7 | `docs/plans/mobile-build-roadmap.md` (the umbrella plan for the future Mac / Linux sessions) | docs | The future-session checklist: what the Mac session does, what the Linux session does, in what order, with what verification gates. |
| 8 | `HANDOFF.md §9.48` + `CHANGELOG.md` "Phase mobile-build roadmap — Phase A" entry | docs | Per the project's documentation convention (see §9.46, §9.47 for the pattern). |

## Decisions

| # | Decision | Why | Risks / follow-ups |
|---|----------|-----|---------------------|
| 176 | Phase A ships the **seam** (config + scaffolding + docs) and the Mac / Linux future session fills in the **plug** (Swift / Kotlin source + signing + store uploads). | The seam is the surface the plug plugs into; closing the seam is what this codebase can do. The plug is one focused session per platform. | The future Mac / Linux session needs the iOS Developer Program + Apple ID + a real iOS device for the on-device smoke test; the Linux session needs the Google Play Developer Console + a real Android device. |
| 177 | Android uses `tauri-plugin-stronghold` for the API key storage; iOS uses the existing `keyring` 3.x with the `apple-native` feature (which already covers iOS Keychain); desktop is unchanged. | `keyring` 3.x explicitly does not support Android. Stronghold is the Tauri-maintained cross-platform encrypted store. The iOS path doesn't need to change because `keyring` 3.x's `apple-native` feature already supports iOS Keychain. | Stronghold's API is `async`; the existing `secrets` IPC is sync. We add a small `tauri::async_runtime::spawn_blocking` wrapper in the Rust command. The JS-side `secretsGetApiKey` stays sync. |
| 178 | The mobile icons are generated by `cargo tauri icon` from a single 1024×1024 source PNG. The source is a placeholder (a simple "L" on a brand-color background); the project lead replaces it with the real logo before the first store submission. | The Tauri CLI's icon generator is platform-agnostic (Rust + image crate), so we can ship the icon set without a Mac. The placeholder is documented as such; the icon *artwork* is a design decision the project lead makes. | The placeholder is intentionally not "production ready" — the App Store / Play Store will reject it if submitted as-is. The doc explicitly calls this out. |
| 179 | The store-metadata templates pre-fill the easy fields (app name, description, category) and call out the project-lead-only fields (App Store promotional text, Play Store data safety form). | App Store Connect + Play Console metadata are mostly editorial; the project lead owns the wording. The templates provide the structure + the privacy-nutrition-label / data-safety-form answer scaffolding (which is the non-obvious part). | The privacy-nutrition-label data changes when Lipi's feature set changes (e.g. if we add analytics). The templates are versioned with Lipi; a future release updates them. |
| 180 | The CI matrix gets a new `mobile-toolchain` job that runs `cargo tauri ios info` (macos-latest) and `cargo tauri android info` (ubuntu-latest) as smoke checks. No real builds. | A real `cargo tauri ios build` requires a code-signing identity + a real device or simulator; a real `cargo tauri android build` requires a keystore + a real device or emulator. The `info` commands validate the toolchain is set up (Xcode CLI tools + iOS SDK on macOS, Android SDK + JDK 17 on Linux) without the signing / device constraints. | A real `cargo tauri {ios,android} build` smoke test is a follow-up slice after the project lead configures the signing secrets. |
| 181 | The release pipeline gets commented-out `release-ios` + `release-android` jobs. The project lead uncomments them + configures the Apple / Google signing secrets before the first real mobile release. | The signing secrets are project-lead-only (Apple Developer Distribution certificate + App Store Connect API key for iOS; Play App Signing key + service-account JSON for Android). The commented-out placeholder documents the full shape without committing the secrets. | The first real mobile release is a future work item; the placeholder jobs are inert until uncommented. |
| 182 | The `tauri-plugin-stronghold` Cargo entry is **off by default** (`default-features = false` + `optional = true` + the `mobile` feature flag enables it). | The desktop build doesn't need Stronghold (it has `keyring`). The mobile build enables the `mobile` feature, which pulls in Stronghold. This keeps the desktop binary size unchanged. | The `secrets` module's per-platform backend pick needs a runtime check on `osFamily`; we add a small `pick_secrets_backend(os_family: OsFamily) -> SecretsBackend` helper in `src-tauri/src/secrets.rs` and the JS-side `secrets.ts` reads the result once at startup. |
| 183 | The mobile icons use Tauri's default iOS / Android app icon set (the placeholders the Tauri scaffold generates). The project lead replaces them with the real Lipi logo before the first store submission. | Same rationale as #178 — the icon artwork is a design decision. The Tauri scaffold icons are clearly placeholders (a flat "T" on a generic gradient). | The placeholder icons are committed to the repo so the macOS / Linux future session sees a working build immediately on the first `cargo tauri {ios,android} build`. |
| 184 | The `tauri-plugin-stronghold` integration is a **thin facade** in `src-tauri/src/stronghold_secrets.rs` that exposes the same `SecretsBackend` trait the desktop `keyring` uses. The JS-side `secrets` module picks the backend at startup. | The facade keeps the JS-side API stable. The `secretsGetApiKey` / `secretsSetApiKey` IPC commands stay the same shape; only the Rust implementation changes per platform. | The facade needs `async` (Stronghold is async); the desktop `keyring` is sync. The facade normalises this with `spawn_blocking` so the JS-side stays sync. |
| 185 | The `tauri.conf.json` mobile block is **minimal** — only the `bundle.android.minSdkVersion` + `bundle.iOS.minimumSystemVersion` keys. All other mobile config (icon paths, code signing identities) lives in the per-platform files. | Tauri reads the main `tauri.conf.json` for ALL platforms; mobile-specific keys there are inert on the desktop build. The per-platform files are merged on `cargo tauri {ios,android} build` only. This keeps the desktop build 100% unchanged. | None — the Tauri 2 per-platform config merge is stable. |
| 186 | The `docs/plans/mobile-build-roadmap.md` plan is the umbrella for the future Mac / Linux sessions. It enumerates the work items, the order, the verification gates, and the "what to do if the iOS / Android build fails" troubleshooting guide. | The future session's contributor is a different person (the project lead on a Mac) and may not have the full context. The plan is the "you are here, do these 5 things, in this order, verify at each step" document. | The plan is a living document; future phases update it. |

## Architecture

### Config layout

```
src-tauri/
├── tauri.conf.json          # Main config. Gets the mobile block (§1).
├── tauri.android.conf.json  # New. Per-platform Android overrides.
├── tauri.ios.conf.json      # New. Per-platform iOS overrides.
├── Info.plist               # New. iOS Info.plist (overrides Tauri's default).
├── Cargo.toml               # Gets the `mobile` feature + the `tauri-plugin-stronghold` optional dep.
├── icons/
│   ├── (existing desktop icons: 32x32.png, 128x128.png, 128x128@2x.png, icon.icns, icon.ico)
│   ├── lipi-icon-1024.png   # New. The source 1024×1024 (placeholder).
│   ├── ios/                 # New. Generated by `cargo tauri icon`.
│   │   ├── AppIcon-20x20@1x.png
│   │   ├── ... (~20 files for iOS 17+ icon set)
│   │   └── Splash/LaunchScreen.storyboard
│   └── android/             # New. Generated by `cargo tauri icon`.
│       ├── mipmap-mdpi/ic_launcher.png
│       ├── mipmap-hdpi/ic_launcher.png
│       ├── mipmap-xhdpi/ic_launcher.png
│       ├── mipmap-xxhdpi/ic_launcher.png
│       ├── mipmap-xxxhdpi/ic_launcher.png
│       └── values/colors.xml
```

**Tauri 2's icon model.** Tauri 2 has a single `bundle.icon: string[]` array (not a per-platform icon key). The `cargo tauri icon <source.png>` CLI takes the source 1024×1024 PNG and generates the **entire** set — desktop (`.ico` / `.icns` / PNG sizes), iOS (the `AppIcon-*` set + `LaunchScreen.storyboard`), and Android (the `mipmap-*/ic_launcher.png` set + `values/colors.xml`). The generated files are placed under `src-tauri/icons/` and the `bundle.icon` array in `tauri.conf.json` is auto-extended to point at them. So we do NOT need a per-platform icon config — the `cargo tauri icon` output IS the per-platform config.

### Rust crate additions

```toml
# src-tauri/Cargo.toml
[dependencies]
# ... existing ...
# M2c-mobile: tauri-plugin-stronghold for Android (keyring 3.x
# does not support Android). Off by default; the `mobile` feature
# enables it. iOS uses keyring 3.x's `apple-native` feature
# (already wired) — no change needed on the iOS path.
tauri-plugin-stronghold = { version = "2", optional = true }

[features]
# ... existing ...
mobile = ["dep:tauri-plugin-stronghold"]
```

The `src-tauri/src/secrets.rs` module gets a new `pick_secrets_backend(os_family: OsFamily) -> SecretsBackend` helper. The `secretsGetApiKey` / `secretsSetApiKey` IPC commands dispatch to the picked backend. The desktop path is unchanged; the iOS path uses `keyring` (already wired); the Android path uses Stronghold (new).

### CI matrix

```yaml
# .github/workflows/ci.yml
jobs:
  # ... existing version-guard, test ...

  mobile-toolchain:
    name: Mobile toolchain check (${{ matrix.os }})
    needs: [version-guard]
    strategy:
      fail-fast: false
      matrix:
        # macOS has the iOS toolchain (Xcode CLI tools + iOS SDK).
        # Ubuntu has the Android toolchain (Android SDK + JDK 17).
        os: [macos-latest, ubuntu-22.04]
    runs-on: ${{ matrix.os }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Install Node.js 20
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install Rust toolchain
        uses: dtolnay/rust-toolchain@stable
        with:
          toolchain: '1.82'

      - name: Install Linux Android deps
        if: runner.os == 'Linux'
        run: |
          # The Tauri Rust deps (libwebkit2gtk, libgtk-3, etc.) plus
          # JDK 17 (required by Android Gradle Plugin 8.5+).
          # The Android SDK + platform-tools are installed by the
          # `android-actions/setup-android` action below.
          sudo apt-get update
          sudo apt-get install -y \
            libwebkit2gtk-4.1-dev libgtk-3-dev \
            libayatana-appindicator3-dev librsvg2-dev patchelf \
            openjdk-17-jdk

      - name: Setup Android SDK
        if: runner.os == 'Linux'
        uses: android-actions/setup-android@v3
        with:
          java-version: '17'
          sdk-version: '34'
          build-tools-version: '34.0.0'
          platforms: 'android-35'

      - name: Install npm deps
        run: npm ci

      - name: Check tauri.conf.json mobile block
        run: |
          # Verify the mobile block is present in tauri.conf.json.
          # (Catches "I forgot to add it" bugs at PR time.)
          node -e "const c = require('./src-tauri/tauri.conf.json'); \
                   if (!c.bundle.android || !c.bundle.iOS) { \
                     console.error('Missing bundle.android or bundle.iOS'); \
                     process.exit(1); \
                   }"

      - name: Check per-platform config files
        run: |
          test -f src-tauri/tauri.android.conf.json || \
            (echo "Missing tauri.android.conf.json" && exit 1)
          test -f src-tauri/tauri.ios.conf.json || \
            (echo "Missing tauri.ios.conf.json" && exit 1)

      - name: Check icon sets
        run: |
          test -f src-tauri/icons/lipi-icon-1024.png || \
            (echo "Missing lipi-icon-1024.png" && exit 1)
          test -d src-tauri/icons/ios || \
            (echo "Missing icons/ios/" && exit 1)
          test -d src-tauri/icons/android || \
            (echo "Missing icons/android/" && exit 1)

      - name: iOS toolchain smoke check (macOS only)
        if: runner.os == 'macOS'
        run: cd src-tauri && cargo tauri ios info

      - name: Android toolchain smoke check (Linux only)
        if: runner.os == 'Linux'
        run: cd src-tauri && cargo tauri android info
```

The release pipeline gets the commented-out `release-ios` + `release-android` jobs at the bottom of `.github/workflows/release.yml`.

### Store-metadata layout

```
docs/
├── store-metadata/
│   ├── app-store.md       # App Store Connect metadata template.
│   ├── google-play.md     # Google Play Console metadata template.
│   └── README.md          # How to use the templates.
```

## Data flow

This phase is primarily **config + scaffolding**, not runtime data flow. The one new runtime flow is the Stronghold-backed secrets on Android:

```
JS:  secretsGetApiKey('openai')
  → invoke('secrets_get_api_key', { provider: 'openai' })
Rust (lib.rs command):
  let backend = pick_secrets_backend(voice_platform::get_capabilities().os_family);
  match backend {
    SecretsBackend::Keyring => keyring::Entry::new(...).get_password(),
    SecretsBackend::Stronghold => stronghold_get(...),
  }
  → returns the API key
```

The desktop + iOS paths use the `Keyring` variant (unchanged from 5a). The Android path uses the `Stronghold` variant (new). The JS side is unchanged.

## Error handling

The new `Stronghold` backend needs an error-mapping layer. Stronghold's `StrongholdError` enum has 6 variants; we map them to the existing `SecretError` enum (which has 3 public variants: `InvalidInput`, `KeychainUnavailable`, `Platform`). We deliberately do NOT add new variants to `SecretError` — that would be a breaking change to the JS-side `SecretErrorPayload` tagged union (`src/ipc/secrets.ts`). Instead, the new dispatch collapses Stronghold's variants into the 3 existing ones:

| Stronghold variant | Maps to | Why |
|---|---|---|
| `ClientNotFound` / `VaultNotFound` / `RecordNotFound` | `Platform { detail: "no entry" }` | The API key for this provider isn't stored. Same shape as the existing `keyring::Error::NoEntry` → `Platform { detail: "no entry" }` mapping. The JS-side `secretsGetApiKey` already returns `null` for the "no entry" case (the Rust function maps `Platform` → `null` before serialising). |
| `AccessDenied` | `KeychainUnavailable { detail: "access denied" }` | The OS-level credential store rejected the read. |
| `EncryptionFail` | `KeychainUnavailable { detail: "encryption failure" }` | The credential store's encryption layer rejected the read. |
| Everything else | `Platform { detail: <stronghold::Error display> }` | Catch-all for "something went wrong"; the user-facing message is generic. |

The JS-side `secretsGetApiKey` already handles `Platform { detail: "no entry" }` by returning `null` (so the UI can show the "Set up your API key" callout — this is the desktop `keyring` path's existing behaviour; the new `Stronghold` path inherits it). The `KeychainUnavailable` and `Platform` paths surface a user-facing error toast via the existing `SecretError` handling.

## Testing

Phase A is config + scaffolding. The test surface is:

- **5 new Rust unit tests** in `src-tauri/src/secrets.rs`:
  - `pick_secrets_backend_returns_keyring_for_windows_macos_linux_gtk_ios`
  - `pick_secrets_backend_returns_stronghold_for_android`
  - `stronghold_error_maps_to_secrets_error_correctly` (6 cases for the 6 Stronghold variants)
  - `secrets_get_api_key_falls_through_to_stronghold_on_android` (mock the Stronghold client)
  - `secrets_set_api_key_writes_to_stronghold_on_android` (mock the Stronghold client)

- **2 new JSON schema tests** (in a new `src-tauri/tauri_config.test.rs`):
  - `tauri_conf_json_mobile_block_parses` (asserts `bundle.android.minSdkVersion === 24` and `bundle.iOS.minimumSystemVersion === "17.0"`)
  - `per_platform_conf_files_parse` (asserts `tauri.android.conf.json` + `tauri.ios.conf.json` parse as valid Tauri config)

- **CI smoke checks** (the `mobile-toolchain` job above).

No new JS-side tests — the JS-side `secrets` module is unchanged; the per-platform backend pick is on the Rust side.

## Out of scope (deferred to future phases)

- **Swift / Kotlin source code** for the `nativeDictation` plugin. The M3 follow-up (§9.47) closed the contract; the implementation is a future Mac / Linux session.
- **Real iOS / Android app builds.** Phase A ships the config + toolchain smoke check; a real build requires the signing identities + a real device, which is a follow-up slice.
- **App Store / Play Store uploads.** The release pipeline gets commented-out placeholders; the project lead uncomments + configures the secrets before the first real mobile release.
- **iOS / Android-specific UI changes** (e.g. a mobile-only file-tree layout). The current React shell uses `useViewport` + CSS media queries; mobile-specific UX is a future phase.
- **Per-platform font / spacing tuning.** Same as above.
- **Tauri 2 → 3 migration** (when Tauri 3 lands). Not on the roadmap; the mobile feature set has been stable since Tauri 2.1.
- **iOS 17 / Android 15 floor bumps.** Phase A uses the contract README floors (iOS 17.0, Android 24+). Future OS bumps are a one-line config change in the per-platform files.

## Verification (Phase A)

- `npx tsc -b` — 0 errors.
- `npx vitest run` — pass rate unchanged (no new JS tests; the JS-side is unchanged).
- `npm run build` — clean.
- `cargo check --features m2c-native --lib` — clean (the new `mobile` feature is off by default; desktop build is unchanged).
- `cargo check --features mobile --lib` — clean (the Stronghold dep compiles on Windows for the cross-platform check).
- `cargo test --lib` (default) — all existing 358 tests pass + 5 new secrets tests + 2 new config tests = 365 total.
- `cargo tauri ios info` (macOS, future session) — Xcode CLI tools + iOS SDK present.
- `cargo tauri android info` (Linux, future session) — Android SDK + JDK 17 + Gradle 8.7+ present.
