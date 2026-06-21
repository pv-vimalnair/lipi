# AGENTS.md — Project context for AI agents and IDEs

> If you are an AI agent (Cursor, Claude Code, Codex, Aider, etc.) or an
> IDE tool picking up the **Lipi** project at `C:\Users\Pv Vimal Nair\lipi\`,
> read this file first. It has the project context, build commands,
> architecture overview, and the rules you must follow.

## Project in one paragraph

**Lipi** is a cross-platform (Windows / macOS / Linux / iOS / Android)
Cursor-like IDE built with **Tauri 2 + React 18 + TypeScript + Vite +
Monaco**. It is a single-codebase app that wraps the React frontend in
a Rust shell, with an IPC bridge for FS / git / terminal / AI / voice /
IAP / licensing. The user's API keys are stored in the OS keychain (or
Stronghold on Android) — Lipi has **no backend**, the user is in full
control. The headline differentiator is **voice-to-code on mobile**
(speak, get code); the daily-driver STT on desktop is the **Web Speech
API** with a real **`cpal` + `whisper-rs`** on-device fallback that
shipped in Phase 6.3. BYO API key (OpenAI / Anthropic / OpenRouter).

## Workspace

```
C:\Users\Pv Vimal Nair\lipi\
```

**Sibling workspace:** `C:\Users\Pv Vimal Nair\lifeof\` (Flutter
LifeOf project) — **never touch, do not read, do not import from**.

## What's in this repo (high level)

| Path | What |
|---|---|
| `src/` | React + TypeScript frontend (Vite, port 1420) |
| `src/screens/EditorWorkspace/` | The main 3-pane IDE shell (Monaco + LSP + AI chat + git panel) |
| `src/screens/SettingsProvider/` | Settings (API key, model picker, voice, language servers) |
| `src/shared/` | Cross-screen primitives (Button, VoiceButton, useVoiceCapture, voice preferences) |
| `src/voice/` | Voice provider implementations (webSpeechSTT, onDeviceSTT, capabilities) |
| `src/ipc/` | Typed wrappers around the Tauri `invoke` calls (ai, fs, git, lsp, stt, ...) |
| `src-tauri/src/` | Rust core (Tauri 2) — IPC commands, plugins, business logic |
| `src-tauri/src/stt_capture.rs` | `cpal` mic capture + 16 kHz resample (Phase 6.3) |
| `src-tauri/src/stt_inference.rs` | `whisper-rs` inference, m2c-native-gated (Phase 6.3) |
| `src-tauri/src/secrets_stronghold.rs` | Stronghold facade for Android, mobile-gated (Phase mobile-build A) |
| `src-tauri/Cargo.toml` | Rust deps; `m2c-native` feature pulls in `whisper-rs`, `mobile` pulls in Stronghold |
| `docs/ENGINEERING.md` | The 7 engineering rules every PR must follow |
| `docs/RELEASING.md` | Release process (signing, auto-update, store uploads) |
| `docs/plans/mobile-build-roadmap.md` | Future Mac / Linux session's iOS / Android pickup doc |
| `docs/decisions/0046-…-0100-…md` | Per-decision writeups (numbered `#46`–`#189`) |
| `HANDOFF.md` | Phase-by-phase history (Section 9 is the index) |
| `CHANGELOG.md` | Per-phase changelog entries |
| `.cursorrules` | Auto-loaded by Cursor IDE with the 7-rule quick reference |

## Build / verify commands (default build)

```bash
# JS side
npm install                # one-time
npm run typecheck          # npx tsc -b, 0 errors expected
npm run lint               # npx eslint src/, 0 errors expected
npm test                   # npx vitest run, 1299/1299 pass
npm run build              # vite production build

# Rust side (default features, no m2c-native, no mobile)
cd src-tauri
cargo check                # 0 errors, 0 warnings
cargo test --lib           # 412 / 412 pass
cargo test --tests         # 24 / 24 pass

# Rust side (mobile build — Stronghold + secrets dispatch)
cargo check --features mobile

# Rust side (real Whisper on-device build — needs libclang + cmake)
cargo check --features m2c-native --lib

# Full Tauri build (signing, bundling, .nsis + .msi)
npm run build:tauri
```

`npm run dev:tauri` is the canonical dev loop — Rust incremental
recompile + Vite HMR.

## Current state (last shipped phase: **10**)

| Phase | What | Status |
|---|---|---|
| **10** | Editor tab theme: 5 vintage scenes | **SHIPPED 2026-06-18** |
| **11** | Technical debt cleanup & codebase hardening | **SHIPPED 2026-06-21** |
| **6.3** | Real `cpal` + `whisper-rs` STT wiring | **SHIPPED 2026-06-16** |
| **6.2** | `whisper-rs` 0.14 → 0.16 (build break fix) | SHIPPED |
| **mobile-build A** | iOS / Android pipeline seam | SHIPPED |
| **9.36** | LSP event-stream upgrade | SHIPPED |
| **8.1** | Inline-edit streaming preview | SHIPPED |
| **M3** | Unified `VoiceSession` API | SHIPPED |
| **M6c** | Per-tab cursor + file-tree scroll anchor (v5 export) | SHIPPED |
| **9.47** | D-146: LSP provider re-registration on respawn | SHIPPED |
| **9.45** | D-145: single Monaco instance across tab switches | SHIPPED |
| **9.2** | Multi-server kind taxonomy | SHIPPED |
| **6 / 6.1** | Daily-driver hardening + MSI fix | SHIPPED |
| **5** | Production release pipeline | SHIPPED |
| **4 / 4.1** | IAP validation + v1.1 follow-ups | SHIPPED |
| **3** | Subscription UX + offline purchase | SHIPPED |
| **2** | Offline licensing (JWS-compact) | SHIPPED |
| **1** | Tauri 2 shell + Monaco + 5-platform bundle | SHIPPED |

See `HANDOFF.md` §9 for the full phase index with file lists and decisions.

## What is NOT done (pickup points)

1. **iOS Swift `SFSpeechRecognizer` plugin** — needs Mac + Xcode 16+.
   Contract in `docs/plugins/lipi-stt-ios/README.md`.
2. **Android Kotlin `SpeechRecognizer` plugin** — needs Android Studio
   Iguana+. Contract in `docs/plugins/lipi-stt-android/README.md`.
3. **Real `.ipa` / `.aab` builds** — `cargo tauri {ios,android} build`.
4. **App Store / Play Store uploads** — metadata templates in
   `docs/store-metadata/`.
5. **Code signing on Windows** — `lipi.exe` ships unsigned; release
   pipeline honors `WINDOWS_CERT_FILE` + `WINDOWS_CERT_PASSWORD` but no
   cert is set up yet.
6. **Auto-updater end-to-end** — works in principle, no GitHub release
   has been published yet.

## Architecture: the 3 rules of thumb

1. **Tauri commands are thin one-liners** that call into a public
   `pub use` re-export in `src-tauri/src/lib.rs`. The actual logic
   lives in a module under `src-tauri/src/<feature>.rs`. When you add
   a new IPC command, add a `pub fn` to the relevant module and
   re-export it from `lib.rs`, then add the command wrapper in the
   same `lib.rs` block, then add a typed JS wrapper in
   `src/ipc/<feature>.ts`.
2. **JS state lives in Zustand stores** under
   `src/screens/<Screen>/state/<feature>Store.ts` (or
   `src/shared/state/<feature>Store.ts` for cross-screen). No Redux,
   no Context-as-state, no `useState` for cross-component state.
3. **No new dependencies without owner confirmation.** The 7 rules
   in `docs/ENGINEERING.md` apply.

## Cargo features (matters for any Rust change)

| Feature | Pulls in | Gating |
|---|---|---|
| `default` | nothing extra | desktop build (no `m2c-native`, no `mobile`) |
| `m2c-native` | `dep:whisper-rs` | desktop real-Whisper build (needs libclang + cmake + C++ toolchain) |
| `metal` | `m2c-native` + `whisper-rs/metal` | macOS hardware acceleration |
| `cuda` | `m2c-native` + `whisper-rs/cuda` | Windows + NVIDIA hardware acceleration |
| `vulkan` | `m2c-native` + `whisper-rs/vulkan` | Linux + Windows hardware acceleration |
| `mobile` | `tauri-plugin-stronghold`, `iota_stronghold`, `zeroize` | Android secrets backend |
| `internal-tools` | (internal dev-only commands) | hidden behind `cargo build --features internal-tools` |

The mobile build is mutually exclusive with the desktop features
(no need to combine `mobile` and `m2c-native`).

## Voice architecture (the M2a / M2b / M2c / M3 unified model)

- **Daily-driver desktop STT:** Web Speech API (`webkitSpeechRecognition` in
  WKWebView / WebView2) via `src/voice/webSpeechSTT.ts`. Works out of the
  box on Windows / macOS / iOS, no build-time cost.
- **On-device desktop STT (Phase 6.3):** `cpal` mic capture
  (`src-tauri/src/stt_capture.rs`) → 16 kHz Float32 mono resample
  (`LinearMonoResampler`) → `whisper-rs` inference
  (`src-tauri/src/stt_inference.rs`, `m2c-native` gated) → transcript
  emitted on `stt://transcript` event.
- **On-device mobile STT (future, Phase mobile-build B):** Swift
  `SFSpeechRecognizer` on iOS, Kotlin `SpeechRecognizer` on Android,
  contracted via the `lipi-stt-{ios,android}` plugin READMEs.
- **Unified JS-side hook:** `src/shared/hooks/useVoiceCapture.ts`
  abstracts all three providers behind a single `VoiceProvider` enum
  (`'webSpeech' | 'onDevice' | 'nativeDictation'`).
- **Settings UI:** `src/screens/SettingsProvider/components/{OnDeviceCard,
  WebSpeechCard, NativeDictationCard}.tsx` — one card per provider, all
  three always rendered for consistency, with `'inert'` / `'not-applicable'`
  status badges when a provider isn't available on the current platform.

## The 7 rules (must follow — see `docs/ENGINEERING.md` for full)

1. **Left and right alignment for spacing** — use the `tokens.css`
   spacing scale (`--space-1` through `--space-12`), never hardcode
   px values.
2. **No new tokens without a phase plan.** The design system lives in
   `src/shared/styles/tokens.css`.
3. **No new components without owner confirmation.** Reuse
   `src/shared/components/Button.tsx`, `IconButton.tsx`, `Stack.tsx`,
   `VoiceButton.tsx`. The grep target is `src/shared/components/`.
4. **No new dependencies without owner confirmation.** The Rust
   `Cargo.toml` is the same rule for the Rust side.
5. **Tests for every new feature.** Vitest for JS (1293 tests
  currently), `#[cfg(test)] mod tests` for Rust (413 tests
   currently).
6. **State in Zustand, not Context, not `useState` for cross-component.**
7. **HANDOFF + CHANGELOG updated for every phase.** Decisions get
   numbered (#46–#189 are taken; new ones go in the next slot). The
   full decision table is in `HANDOFF.md` §9.

## Quick commands an agent might want to run

```bash
# Check if Rust changed anything
cd 'C:\Users\Pv Vimal Nair\lipi\src-tauri' && cargo check 2>&1 | tail -20

# Check if JS changed anything
cd 'C:\Users\Pv Vimal Nair\lipi' && npx tsc -b --pretty false 2>&1 | tail -20

# Run the full test suite
cd 'C:\Users\Pv Vimal Nair\lipi' && npx vitest run 2>&1 | tail -10

# Find the latest decision number used in HANDOFF.md
grep -E '^\| [0-9]+ \|' 'C:\Users\Pv Vimal Nair\lipi\HANDOFF.md' | awk -F'|' '{print $2}' | sort -n | tail -1
```

## "Do not" list

- Do **not** touch `C:\Users\Pv Vimal Nair\lifeof\` (Flutter project,
  sibling workspace, separate codebase).
- Do **not** add new npm / cargo deps without owner confirmation.
- Do **not** run `cargo install` of new toolchains without owner
  confirmation.
- Do **not** change `whisper-rs` version (it's pinned to `0.16` for
  a reason — Decision #164 in `HANDOFF.md` §9.30b).
- Do **not** change the `tauri.conf.json` mobile block (`minSdkVersion:
  24` / `minimumSystemVersion: "17.0"`) — those are pinned for
  Decision #185.
- Do **not** skip the HANDOFF / CHANGELOG update for any phase work.
- Do **not** make any commit without explicit owner approval.
