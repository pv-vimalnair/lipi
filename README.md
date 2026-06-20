# Lipi

> A voice-first, cross-platform IDE. BYO API key. No backend.

Lipi is a Cursor / Windsurf / VS Code competitor that ships to **Windows, macOS,
Linux, iOS, and Android** from a single codebase. The headline differentiator is
**voice-to-code on mobile**: speak, get code. The differentiator on desktop is the
same plus a deeply integrated terminal, file tree, git, and AI chat panel — all
with your own API keys, never a vendor lock-in.

## Why Lipi

- **No backend.** Your code, your keys, your machine. We never see a request.
- **BYO API key.** OpenAI, Anthropic, OpenRouter for the LLM. Web Speech API
  (with on-device Whisper fallback) for voice.
- **5 platforms, 1 codebase.** Tauri 2 + React 18 + TypeScript + Vite + Monaco.
- **Voice-first on mobile.** On-screen keyboards are why nobody codes on phones
  today. Lipi is built around the mic.
- **Free. MIT licensed.** No "Pro" tier, no freemium, no surprises.

## Current state (as of 2026-06-16)

**Production-ready foundation: SHIPPED on Windows desktop.** Daily-driver
features (Monaco editor + LSP intellisense + file tree + integrated terminal +
git + AI chat + voice) are all in. The iOS / Android build pipeline is
**scaffolded but not built** — the Swift `SFSpeechRecognizer` + Kotlin
`SpeechRecognizer` plugin source, the actual `.ipa` / `.aab` builds, and the
App Store / Play Store uploads are a future Mac / Linux session's work. The
desktop on-device STT (real `cpal` + `whisper-rs` inference) is wired and
compile-clean; it needs libclang + cmake + a C++ toolchain on the build
machine to link the `whisper-rs-sys` native crate.

**Most recent shipped phases:**

| Phase | What | Status |
|---|---|---|
| **6.3** | Real `cpal` + `whisper-rs` STT wiring (mic capture, 16 kHz mono resample, model cache, startup pre-load) | **SHIPPED** |
| **6.2** | `whisper-rs` 0.14 → 0.16 (fixed the m2c-native build break) | SHIPPED |
| **mobile-build A** | iOS / Android build pipeline seam (config + per-platform files + `tauri-plugin-stronghold` dispatch + icon set) | SHIPPED |
| **9.36** | LSP event-stream upgrade (`lsp://stdout` event + catch-up read) | SHIPPED |
| **8.1** | Inline-edit streaming preview | SHIPPED |
| **6.1** | MSI bundling regression fix (NSIS + MSI both default) | SHIPPED |
| **6** | Daily-driver hardening (release pipeline, signing key, auto-update server, error messages) | SHIPPED |
| **5** | Production release pipeline (`tauri build --bundles nsis,msi`, Authenticode-ready, dev-only CI) | SHIPPED |
| **4.1** | IAP v1.1 (refresh-license, MS OAuth flow, per-machine keypair) | SHIPPED |
| **4** | IAP receipt validation (Apple / Microsoft / Google routing) | SHIPPED |
| **3** | Subscription UX + offline-purchase flow (7-day grace, trial badges) | SHIPPED |
| **2** | Offline licensing (per-machine fingerprint, JWS-compact signed licenses) | SHIPPED |
| **1** | Tauri 2 shell + React 18 + Monaco + 5-platform bundle config | SHIPPED |
| **M3** | Unified `VoiceSession` API across all STT providers | SHIPPED |
| **M6c** | Per-tab cursor + file-tree scroll anchor (v5 export format) | SHIPPED |
| **9.47** | D-146: LSP provider re-registration on respawn | SHIPPED |
| **9.45** | D-145: single Monaco instance across tab switches | SHIPPED |
| **9.2** | Multi-server kind taxonomy (TS / rust-analyzer / pyright / unknown) | SHIPPED |

See [`HANDOFF.md`](./HANDOFF.md) for the full phase-by-phase history with
architectural decisions, file lists, and verification output.

## Next work (pickup points)

1. **iOS Swift `SFSpeechRecognizer` plugin** — Mac-only session.
   See `docs/plugins/lipi-stt-ios/README.md` for the contract.
2. **Android Kotlin `SpeechRecognizer` plugin** — Mac or Linux session.
   See `docs/plugins/lipi-stt-android/README.md` for the contract.
3. **Store uploads** — App Store + Play Store submission with the metadata
   templates in `docs/store-metadata/`.
4. **Project-lead non-code setup** — LLC, ToS, marketing site, support email,
   Authenticode signing certificate (the `lipi.exe` currently ships unsigned;
   release pipeline already honors `WINDOWS_CERT_FILE` + `WINDOWS_CERT_PASSWORD`).

## Run it

### Prereqs (already installed on the dev machine)

- **Node ≥ 20.19** (Vite 8 requirement; we test on 24.x)
- **Rust stable** (MSVC ABI on Windows) — `rustup-init.exe` from <https://rustup.rs>
- **Visual Studio Build Tools** with the *C++ build tools* workload + **Windows 11 SDK**
- **Tauri CLI 2.x** — `cargo install tauri-cli --version "^2.0" --locked`
- **CMake 3.20+** + **LLVM / libclang** (only needed for `cargo build --features m2c-native`,
  the real Whisper-on-device desktop build)
- Uses **npm** (not pnpm/yarn/bun)

### Commands

```bash
npm install              # one-time
npm run typecheck        # strict TS, no emit
npm run lint             # same strict TS check, CI-friendly script
npm test                 # vitest, 1293 tests across 99 files
npm run dev              # frontend only on http://localhost:1420/
npm run dev:tauri        # full Tauri shell (compiles Rust first time, ~2 min)
npm run build            # production frontend build to dist/
npm run build:tauri      # full Tauri build with bundling (.nsis + .msi)

# Rust side
cd src-tauri
cargo check                                  # default build
cargo test --lib                             # 413 unit tests
cargo test --tests                           # 24 integration tests
cargo check --features mobile                # mobile build (Stronghold + secrets)
cargo check --features m2c-native --lib      # desktop Whisper inference (needs libclang)
```

`npm run dev:tauri` is the canonical way to develop Lipi. The Rust crate
recompiles incrementally on save; the React frontend hot-reloads via Vite.

### Daily-driver STT (no build-time cost)

The default build ships with **Web Speech API** as the daily-driver STT. It
just works on Windows, macOS, and iOS (via `webkitSpeechRecognition` in
WKWebView / WebView2). Linux GTK WebKit doesn't ship `SpeechRecognition`, so
Linux users get the on-device Whisper path (the `m2c-native` build, when
built on a machine with libclang + cmake).

## Project layout

```
lipi/
  src/                            React + TypeScript frontend
    main.tsx                      React root
    screens/                      One folder per screen
      EditorWorkspace/            Main 3-pane IDE shell (Monaco + LSP + AI chat)
        components/               TitleBar, StatusBar, FileTree, Editor, SidePanel, MobileShell
        hooks/                    useViewport, useMonacoLspBridge, useInlineEditOverlay
        state/                    aiStore, lspClientStore, tsConfigStore, ...
        workers/                  Monaco language-service worker registration
      Welcome/                    Welcome screen
      SettingsProvider/           Settings screen (incl. voice / model picker)
    shared/                       Cross-screen primitives
      components/                 Button, IconButton, Stack, VoiceButton
      hooks/                      useVoiceCapture (the unified voice hook)
      state/                      voicePreferencesStore, voiceCapabilitiesStore
      styles/                     tokens.css, global.css
    voice/                        Voice provider implementations
      webSpeechSTT.ts             Web Speech API session manager
      onDeviceSTT.ts              On-device Whisper session manager (JS-side stub)
      capabilities.ts             Runtime STT capability detection
    dev/                          Top-8 device emulator (DEV-only, tree-shaken in prod)
  src-tauri/                      Rust core (Tauri 2)
    Cargo.toml
    tauri.conf.json               desktop config
    tauri.android.conf.json       per-platform Android overrides
    tauri.ios.conf.json           per-platform iOS overrides
    src/
      main.rs                     Windows entry, calls lipi_lib::run()
      lib.rs                      App setup, IPC commands, plugins
      stt.rs                      STT model management (download / install / list)
      stt_capture.rs              cpal mic capture + 16 kHz resample (desktop)
      stt_inference.rs            whisper-rs inference (m2c-native gated)
      voice_platform.rs           Runtime capability detection
      secrets.rs                  OS keychain + Stronghold dispatch
      secrets_stronghold.rs       Stronghold facade (mobile-gated)
      chat.rs                     OpenAI / Anthropic / OpenRouter streaming
      lsp.rs                      Language-server process management (TS / rust / pyright)
      fs.rs                       File system IPC
      git.rs                      git2-based git operations
      terminal.rs                 Portable-pty terminal sessions
      iap.rs                      IAP receipt routing
      licensing.rs                Offline license validation
      updater_health.rs           Auto-update health checks
      http.rs / command.rs / stdio.rs / fs_watcher.rs / ...   (more)
    capabilities/                 Tauri 2 ACL files
    icons/                        32-icon set for all 5 platforms
  docs/
    ENGINEERING.md                The 7 engineering rules every change must follow
    RELEASING.md                  Release process (signing, auto-update, store uploads)
    plans/                        Future-session work items
      mobile-build-roadmap.md     The iOS / Android pickup doc
    decisions/                    Per-decision writeups (#46–#180)
    store-metadata/               App Store + Google Play submission templates
    plugins/                      Mobile plugin contracts
      lipi-stt-ios/README.md      Swift SFSpeechRecognizer contract
      lipi-stt-android/README.md  Kotlin SpeechRecognizer contract
  AGENTS.md                       THIS-FILE-FOR-AI-AGENTS (project context for any agent)
  HANDOFF.md                      Phase-by-phase history + decisions
  CHANGELOG.md                    Per-phase changelog entries
  index.html
  package.json
  tsconfig.json
  vite.config.ts                  Port 1420, Tauri-friendly envPrefix
```

## AI agent / IDE pickup

If you are an AI agent (Claude, Codex, Cursor, etc.) or an IDE tool picking
up this codebase:

1. **Read [`AGENTS.md`](./AGENTS.md) first.** It has the project context,
   the build commands, the architecture overview, and the "do not" list.
2. **Then read [`HANDOFF.md`](./HANDOFF.md) for the phase history.**
   Section 9 is the phase index; each phase has its own subsection with
   file lists and decisions.
3. **Before any UI change, read [`docs/ENGINEERING.md`](./docs/ENGINEERING.md).**
   The 7 rules in that file are the PR check. Spacing scale, color tokens,
   component reuse — everything is pinned there.
4. **For mobile work, read [`docs/plans/mobile-build-roadmap.md`](./docs/plans/mobile-build-roadmap.md).**
   It is the "you are here, do these 6 things" document for the future
   Mac / Linux session.
5. **For the 7 rules quick-reference, see the `.cursorrules` file at the
   project root** (auto-loaded by Cursor IDE).

## Contributing

Read [`HANDOFF.md`](./HANDOFF.md) first for the *what* and *why*,
then read [`docs/ENGINEERING.md`](./docs/ENGINEERING.md) for the *how*.

Don't install toolchains without owner confirmation — that's a hard rule.

## License

[MIT](./LICENSE). Copyright 2026.
