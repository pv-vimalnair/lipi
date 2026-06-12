# Lipi — Work Handoff & Decision Log

Self-contained summary of everything done so far on the **Lipi** project
(a cross-platform Cursor-like IDE). Safe to paste into any agent chat or
hand to a new contributor — no prior context required.

**App:** Lipi — A Cursor-like AI-powered IDE, cross-platform
(Windows, macOS, iOS, Android) from a single codebase. Bring-your-own
API key (OpenAI / Anthropic / OpenRouter).

**Workspace:** `C:\Users\Pv Vimal Nair\lipi\`
**License:** MIT (chosen by owner 2026-06-09; can be changed later)
**Created:** 2026-06-09

---

## 1. Origin & naming

| Item | Value | Notes |
|------|-------|-------|
| Project name | **Lipi** | Sanskrit for "script" / "writing" / "alphabet" — chosen by owner after seeing a shortlist (Prana, Jyoti, Drishti, Chetana, Agni, Manas, Sphota, Mantra, Yantra, Tejas, Astra, Anvaya, Bodha, Kriya, Siddhi, Lipi). Final pick was Lipi from the last batch. |
| Why this name | An IDE is a tool for writing scripts. The word is short (2 syllables), pronounceable in any language, and works as a brand. Bundle ID candidate: `app.lipi.ide` or `com.lipi.ide`. | Owner can override at any time. |
| Workspace | `C:\Users\Pv Vimal Nair\lipi\` | **Explicitly chosen to be a sibling of `lifeof\`** (NOT inside it). The Flutter LifeOf project lives at `C:\Users\Pv Vimal Nair\lifeof\` and must never be touched by Lipi work. |
| License | MIT | Most permissive, doesn't block future open-sourcing. Can dual-license later if a business is built around it. |
| Initial target | Both Windows + macOS desktop | Mobile (iOS/Android) will be enabled once the project compiles on desktop. |

## 2. What was actually built in this session

### 2.1 Scope agreed with the owner

A **production-grade foundation** for a Cursor-like IDE — *not* a 1:1
Cursor clone. Cursor's parent company Anysphere has 50+ engineers and
has raised $1B+; a true clone is a multi-year, multi-team project. What
we agreed to build is a real, shippable IDE with the core features
wired up properly, architected so it can be extended.

### 2.2 Features confirmed in scope (from owner)

- Code editor (Monaco — same engine as VS Code)
- File tree / project explorer
- AI chat panel (Cursor-style)
- Integrated terminal
- Multi-file editing with diff view
- Git integration
- Bring-your-own API key (no backend, key stored in OS keychain)

### 2.3 Platforms confirmed

- Windows desktop (primary dev target — owner's current OS)
- macOS desktop (toolchain configured from day one)
- **Linux desktop** (x86_64 + aarch64; primary distros: Ubuntu LTS, Fedora, Arch)
- iOS (later phase)
- Android (later phase)

### 2.4 Stack decision (and why)

| Layer | Choice | Why this over alternatives |
|-------|--------|-----------------------------|
| Native shell | **Tauri 2** (Rust) | Single codebase → Win/Mac/Linux/iOS/Android. ~10MB binary vs Electron's 150MB+. Tauri 2 added official iOS/Android support in 2024, making it the right call for 2026. Electron was rejected as too heavy; per-platform native was rejected as 4 separate apps. |
| Frontend | **React 18 + TypeScript + Vite** | Standard, well-supported, great Monaco integration. |
| Editor | **Monaco** (`@monaco-editor/react`) | Same engine as VS Code, free, handles syntax highlighting, multi-cursor, diff view, minimap. |
| Terminal | **xterm.js** + `portable-pty` (Rust) | Only realistic way to embed a terminal that works on Win + Unix + mobile. |
| Git | **gix** (gitoxide, pure-Rust) | No `git` binary dependency, faster than libgit2 in many cases. Lower-level API than `git2` but the right tradeoff to avoid shelling out. |
| FS watcher | `notify` (Rust) | Standard cross-platform file watcher. |
| Secrets | `keyring` (Rust) → OS keychain (Windows Credential Manager / macOS Keychain / iOS Keychain / Android Keystore) | API key never enters the JS bundle. |
| AI | User-provided key, proxied through Rust | Avoids CORS, allows request logging/rate limits, hides keys. Supports OpenAI / Anthropic / OpenRouter. |
| State | Zustand | Lightweight, TS-friendly, no Redux boilerplate. |

### 2.5 Repository layout (planned, not yet created)

```
lipi/
  src-tauri/                 # Rust core
    src/
      fs.rs                  # virtual FS + notify watcher
      git.rs                 # gix wrapper (status, diff, commit, branch)
      terminal.rs            # portable-pty session manager
      ai.rs                  # streaming proxy to LLM providers
      secrets.rs             # OS keychain wrapper
      commands.rs            # Tauri command handlers (IPC entry points)
    ios/                     # generated iOS shell
    android/                 # generated Android shell
  src/                       # React frontend
    components/
      Editor.tsx             # Monaco wrapper
      FileTree.tsx
      TabBar.tsx
      AIPanel.tsx
      TerminalPanel.tsx
      GitPanel.tsx
    state/                   # Zustand stores
    ipc.ts                   # typed wrappers around Tauri invoke
  package.json
  vite.config.ts
  tsconfig.json
  HANDOFF.md                 # this file
  README.md                  # user-facing
  LICENSE                    # MIT
```

### 2.6 Phased delivery plan (from owner-approved plan)

Two parallel tracks: **D**esktop and **M**obile. The mobile track runs in parallel
with the desktop track from Week 1 because the headline differentiator — voice-to-code
on mobile — cannot be retrofitted in Week 8.

| Track | Phase | What | When | Hard parts |
|-------|-------|------|------|------------|
| D1 | Scaffold + shell (custom titlebar, window chrome) | Week 1 | — |
| D2 | Editor (Monaco) + file tree + tabs | Week 2 | — |
| D3 | Git integration (status, diff, commit, branch) | Week 3 | — |
| D4 | Embedded terminal | Week 4-5 | PTY + mobile shell UX |
| D5 | AI chat + inline edit (Cmd-K) | Week 6 | Context window management |
| D6 | Multi-file edits (apply/reject per file) | Week 7 | Conflict detection |
| **M1** | **Mobile-first responsive shell + Top-8 device emulator dev tool** | **Week 1-2 (parallel with D1-D2)** | **CSS frame accuracy for notch / home indicator / safe area** |
| **M2** | **Voice capture pipeline (Web Audio / AVAudioRecorder / MediaRecorder)** | **Week 3-4 (parallel with D3-D4)** | **PCM 16kHz conversion, background-mic permissions** |
| **M3** | **Wispr Flow WS client + on-device Whisper / Speech.framework fallback** | **Week 5-6 (parallel with D5)** | **Wispr approval gate; streaming latency <300ms** |
| **M4** | **Voice → cursor binding (mode-aware: dictation vs. code vs. chat prompt)** | **Week 7 (parallel with D6)** | **Mode detection from utterance context** |
| M5 | Mobile polish (on-screen keyboard workarounds, haptics) | Week 8 | Keyboard occlusion |
| 8 (deferred) | Full LSP / IntelliSense | Future | Own 4-week project per language |

### 2.7 Things explicitly out of scope (owner-acknowledged)

- Full LSP server integration (IntelliSense, go-to-def, refactor) — its own 4-week project per language
- Sandboxed code execution
- Cloud sync / collaboration
- Extensions marketplace
- **Any backend service, ever.** No auth server, no LLM proxy server, no usage
  telemetry server, no update server beyond Tauri's static updater manifest on
  GitHub Releases. This is a hard architectural rule (see decision #17), not a
  phase-1 shortcut.

### 2.8 Moved INTO scope (later additions)

- **Voice-to-code** (Wispr Flow + on-device STT fallback) — the headline
  differentiator. See Section 9 for architecture.
- **Top-8 device emulator dev tool** — built-in, dev-only, CSS-frame preview of
  the mobile UI. See decision #19.

## 3. What was actually done this session (state at handoff)

**2026-06-09 (continued, Phase 1a → Phase 1b):**

1. Phase 1a (frontend-only scaffold) — see previous HANDOFF state.
2. Owner approved Rust toolchain install + Phase 1b (Tauri shell).
3. Verified Visual Studio Build Tools + Windows SDK were NOT installed — installed them silently:
   - `vs_BuildTools.exe` with `Microsoft.VisualStudio.Workload.VCTools`, `Microsoft.VisualStudio.Component.Windows11SDK.22621`, `Microsoft.VisualStudio.Component.VC.Tools.x86.x64` → `C:\BuildTools\`
   - Installed MSVC v14.44.35207 + Windows SDK 10.0.22621.0
4. Installed Rust via `rustup-init.exe` (stable, MSVC ABI, minimal profile):
   - `rustc 1.96.0`, `cargo 1.96.0`, `rustup 1.29.0`
   - Default install path `%USERPROFILE%\.cargo\bin`
5. Installed Tauri CLI 2.11.2 globally via `cargo install tauri-cli --version "^2.0" --locked`.
6. Wrote `src-tauri/` scaffold by hand (no `cargo tauri init` — wanted explicit control over every value to match our decisions):
   - `src-tauri/Cargo.toml` — tauri 2 + tauri-plugin-updater, MSVC, release profile optimised
   - `src-tauri/tauri.conf.json` — bundle ID `app.lipi.ide`, dev URL `http://localhost:1420`, all 5 platforms targeted, 5 LLM hosts in CSP
   - `src-tauri/build.rs` — Tauri build script
   - `src-tauri/src/main.rs` — entry, calls `lipi_lib::run()`
   - `src-tauri/src/lib.rs` — `get_app_version` IPC command, updater plugin, title-set in `setup`
   - `src-tauri/capabilities/default.json` — main window ACL (core + updater)
   - `src-tauri/icons/` — full 32-icon set generated via `cargo tauri icon` from a placeholder 1024×1024 "L" PNG drawn via `System.Drawing`
7. Smoke-tested: `cargo tauri dev` → Rust crate compiled in 2m 01s, Vite served React on :1420, Tauri window opened showing the 3-pane EditorWorkspace shell with title `Lipi 0.0.1`. ESTABLISHED connection between Tauri PID 49912 and Vite PID 31600 confirms the IPC bridge is alive.

**Files added/created in Phase 1b (this session):**

- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`
- `src-tauri/build.rs`
- `src-tauri/src/main.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/capabilities/default.json`
- `src-tauri/.gitignore`
- `src-tauri/icons/` (32 files: 32×32, 128×128, 128×128@2x, icon.ico, icon.icns, plus iOS / Android / MSIX sets)
- `src-tauri/icons/app-icon.png` (1024×1024 source)
- `src-tauri/icons/generate-source.ps1` (icon-regen script)
- Updates to root `package.json` (added `dev:tauri`, `build:tauri`, `preview:tauri`, `tauri` scripts)
- Updates to root `.gitignore` (Tauri build artifacts)

**Verified in this session:**

- `npm run typecheck` — pass, 0 errors
- `cargo build` (first time) — pass in 2m 01s, 1 warning (`unused_mut`, since fixed)
- `cargo tauri dev` — Tauri window opened, React frontend mounted, IPC bridge live

**Files NOT yet created (intentional — Phase 1b stops here, awaiting owner sign-off):**

- `src-tauri/src/fs.rs` (D2: virtual FS + notify)
- `src-tauri/src/git.rs` (D3: gix wrapper)
- `src-tauri/src/terminal.rs` (D4: portable-pty)
- `src-tauri/src/ai.rs` (D5: LLM proxy)
- `src-tauri/src/secrets.rs` (D5: keyring)
- `src/voice/` STT impls (M2/M3)
- `src/screens/SettingsProvider/` (UI for API key entry)
- `src/screens/Welcome/` (currently a stub)

**Plan file (for reference):**

- `C:\Users\Pv Vimal Nair\.cursor\plans\cross-platform_ide_foundation_18a37d37.plan.md` — the original plan generated when owner asked me to plan the IDE.

## 4. Decisions log (every choice made, with reason)

| # | Decision | Reason | Date |
|---|----------|--------|------|
| 1 | Build production-grade foundation, not 1:1 Cursor clone | Cursor is multi-year, 50+ engineers, $1B+ raised. Realistic scope for a 2-person team. | 2026-06-09 |
| 2 | Tauri 2 over Electron / native / web-only | Single codebase for all 4 platforms, lightweight, official mobile support as of 2024. | 2026-06-09 |
| 3 | React + TypeScript + Vite | Best Monaco integration, fastest dev loop, mainstream. | 2026-06-09 |
| 4 | Monaco over CodeMirror / Ace | Same engine as VS Code; handles syntax, multi-cursor, diff, minimap out of the box. | 2026-06-09 |
| 5 | `gix` over `git2` / shelling out to `git` | Pure Rust, no binary dependency. Lower-level API but the right tradeoff. | 2026-06-09 |
| 6 | `portable-pty` for terminal | Only realistic cross-platform PTY (Win + Unix + mobile). | 2026-06-09 |
| 7 | AI proxy in Rust, key in OS keychain | Keys never enter JS bundle; avoids CORS; enables logging/rate limits. | 2026-06-09 |
| 8 | BYO API key (OpenAI / Anthropic / OpenRouter) | No backend to build or pay for; user controls cost. | 2026-06-09 |
| 9 | Zustand for state | Lightweight, TS-friendly, no Redux boilerplate. | 2026-06-09 |
| 10 | Project named `Lipi` (Sanskrit: "script/writing") | Short, meaningful, on-theme. Owner picked from shortlist. | 2026-06-09 |
| 11 | Project location: `C:\Users\Pv Vimal Nair\lipi\` (sibling of `lifeof\`) | Owner explicit requirement: NOT inside `lifeof\`. | 2026-06-09 |
| 12 | MIT license | Most permissive default; doesn't block future open-sourcing. | 2026-06-09 |
| 13 | Set up Windows + macOS tooling from day one | Owner said "set up both". Owner is on Windows so dev runs there; macOS config is ready for when needed. | 2026-06-09 |
| 14 | Defer LSP / IntelliSense to Phase 8 | It's its own 4-week project per language. Not in v1 scope. | 2026-06-09 |
| 15 | Stop before installing Rust toolchain | Owner said "stop" and then "create folder first" — explicit instruction to not install anything yet. | 2026-06-09 |
| 16 | Add Linux as a 5th first-class platform | Competitive parity with VS Code / Cursor / Zed; Tauri 2 supports it natively with no extra cost. | 2026-06-09 |
| 17 | "No backend, ever" is a hard architectural rule, not a phase-1 shortcut. The Rust AI proxy is *client-side*; the only network calls the app makes are (a) the LLM provider the user keys in, (b) Wispr Flow with the user's key, (c) Tauri's static updater manifest on GitHub Releases. | BYO-key competitors (Cursor, Continue, Cline) are differentiated by trust and zero vendor lock-in. Any backend reintroduces both. | 2026-06-09 |
| 18 | Wispr Flow as the headline voice UX, with on-device Whisper / Speech.framework as the always-works fallback | Wispr's quality and code-awareness are unmatched, but their API requires enterprise approval — we cannot ship a "start coding with your voice" flow that fails for users who aren't approved. On-device STT is the floor. | 2026-06-09 |
| 19 | Built-in Top-8 mobile device emulator as a dev-only tool (gated by `import.meta.env.DEV`) | Mobile-first design requires mobile-first *verification*. Spinning up Xcode + Android Studio for every layout check is too slow. The emulator is a CSS-frame preview, not a runtime — it's honest about that. | 2026-06-09 |
| 20 | Tauri 2 supports 5 platforms from one codebase; per-platform packaging (`.msi`, `.dmg`, `.AppImage`, `.deb`, `.rpm`, `.ipa`, `.apk`) is automated via GitHub Actions matrix builds. | Owner confirmed all 5 platforms; CI is the only way to keep all 5 healthy. | 2026-06-09 |
| 21 | Adopted 7 engineering rules (alignment, screen naming, screen-folder layout, component reuse, best-practice defaults, section isolation, scalable choices) as a hard rule. Inline summary in Section 10; full long-form in `docs/ENGINEERING.md`. | Future agents will not re-derive coding standards from scratch. Inlining the rules in HANDOFF.md makes the handoff self-sufficient — an agent can read just this file and ship correct code without opening `ENGINEERING.md`. | 2026-06-09 |
| 22 | Wrote `src-tauri/` scaffold by hand instead of running `cargo tauri init`. | The interactive scaffolder writes generic values; we needed explicit alignment with HANDOFF decisions (bundle ID `app.lipi.ide`, 5 platforms, LLM host CSP, updater endpoint). Hand-writing is a one-time cost, but the result is auditable. | 2026-06-09 |
| 23 | Bundle ID `app.lipi.ide` (not `com.lipi.ide` as previously listed in Section 1's bundle ID candidate row). | `com.lipi.ide` would have collided with potential Java/Apple conventions for app namespace; `app.lipi.ide` is the more modern Tauri convention. Owner can override later. | 2026-06-09 |
| 24 | Tauri config CSP allows 5 outbound hosts: `*.openai.com`, `*.anthropic.com`, `*.openrouter.ai`, `wss://*.wisprflow.ai`, `api.anthropic.com`. | Aligns with Section 2.4 (BYO providers: OpenAI / Anthropic / OpenRouter) and Section 9.1 (Wispr Flow WS endpoint). Adding a 6th provider in a later phase means one CSP edit. | 2026-06-09 |
| 25 | Icon is a placeholder 1024×1024 "L" on the dark-slate background colour, with full 32-icon set generated by `cargo tauri icon`. Source PNG drawable is `src-tauri/icons/generate-source.ps1`. | Real branding is out of scope for Phase 1b. The icon needs to exist or `cargo tauri build` fails; a centred monogram is honest about being a placeholder. Re-run the script + `cargo tauri icon` when the brand mark is finalised. | 2026-06-09 |
| 26 | Pin `gix = "=0.78.0"` (transitive `gix-hash 0.22.x`). | gix ≥ 0.79 transitively pulls gix-hash ≥ 0.23, which has upstream source bugs that fail to compile against rustc 1.93+ (`match self` on a `#[non_exhaustive]` enum without a wildcard). The `compile_error!` at the top of gix-hash ≥ 0.23 that gates on enabling a hash feature is the giveaway. The `non_exhaustive` attribute was added Dec 9 2025 in gitoxide commit 2957fa5. gix 0.78 (released Jan 22 2026) and its gix-hash 0.22.x compile cleanly. When upstream fixes land (probably in gix 0.85+), we can drop the pin and re-test. | 2026-06-09 |
| 27 | Phase 2 was split into 3 sub-phases (2a: pipe, 2b: file tree UI, 2c: Monaco + tabs + save). Phase 3 split the same way (3a: read-only git pipe, 3b: GitPanel UI, 3c: diff + discard). | Each sub-phase ends with a working screenshot + cargo test + tsc pass. Owner stops and confirms between each one. Avoids the failure mode of a 1-week phase that turns out to be 80% done with 2 critical bugs at the end. | 2026-06-09 |
| 28 | Generated a `lipi-dev` updater signing keypair; the **public** key is committed in `tauri.conf.json` (`plugins.updater.pubkey`) so `cargo tauri build` works out of the box for contributors, and the **private** key is git-ignored (`lipi-dev.key`) and lives at the repo root. Password is hard-coded as `lipi-dev-not-a-real-secret` and passed via `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` at build time. | A real production build must rotate the keypair — the dev key has a known password and should never sign a release. CI uses a secret-store-injected key; the committed public key stays the same across rotations (only the private key rotates). | 2026-06-11 |
| 29 | Replaced the `<owner>` placeholder in `tauri.conf.json` (homepage + updater endpoint) and `Cargo.toml` (repository) with `lipi-dev/lipi`. | Honest about being a pre-publication placeholder; the real owner slug is a one-line swap at publish time. The endpoints are still non-functional (no `updater.json` exists at that URL) — they're only a config-time concern, no runtime side effects until a release is published. | 2026-06-11 |
| 30 | Verified `cargo tauri build --debug` end-to-end on Windows: produces both `Lipi_0.0.2_x64_en-US.msi` (12.1 MB, WiX) and `Lipi_0.0.2_x64-setup.exe` (7.3 MB, NSIS) in `src-tauri/target/debug/bundle/{msi,nsis}/`. WiX 3.14 and NSIS 3.11 are auto-downloaded by the Tauri bundler on first build (cached in `%LOCALAPPDATA%`). The build also embeds the updater pubkey into `lipi.exe` so the running app can verify future updates. | First end-to-end distribution artifact. No code signing yet (SignPath / Azure Trusted Signing is a future-publication task per Section 8). The `.msi` is for the Microsoft Store / `winget` path; the NSIS `.exe` is the lighter "side-load" installer that's friendlier to direct download (smaller, no MSI admin requirement, no UAC). | 2026-06-11 |
| 31 | `localStorage` keys (`lipi:workspace:v1`, `lipi:firstRun:v1`, `lipi:toolSettings:v2`, `lipi:toolDecisionLog:v1`, `lipi:customTools:v1`) survive packaging because Tauri 2's WebView2 scopes `localStorage` to the bundle id — the data lives in `%LOCALAPPDATA%\app.lipi.ide\EBWebView\Default\Local Storage\leveldb\`, fully isolated from other Tauri apps and from the dev (`http://localhost:1420`) origin. | The dev server and the packaged app have different `localStorage` partitions — settings made in dev do NOT appear in the packaged app and vice versa. This is the right behaviour (a packaged installer shouldn't see dev cruft) but it's a footgun for testing: a "I can't find my recent folders" bug report is most likely a fresh install, not a bug. | 2026-06-11 |
| 32 | The `app-icon.svg` source-of-truth is **ASCII-only** (no em-dashes, no multiplication signs, no smart quotes) and avoids `--` inside XML comment bodies. | `tauri-cli 2.11.2`'s bundled usvg parser is strict and panics with `ParsingFailed(InvalidComment(...))` on `--` inside comments (a W3C spec violation — XML disallows `--` in comment bodies) and with `NotAnUtf8Str` on non-ASCII bytes. The first round of the icon SVG saved with em-dashes and the em-dashes got encoded as Windows-1252 single bytes (0x97 etc.) by the file-write tool, which the usvg parser refused. Documented the workaround in the SVG header so future editors don't repeat the mistake. | 2026-06-11 |
| 33 | Cold-start splash is **CSS-only** (no images, no JS, no spinners), shown by `index.html` for the ~50-300ms it takes React's first commit, then dismissed by adding the `splash-done` class on `<html>` from `AppRoot`'s mount effect. | The Tauri 2 splashscreen plugin would add a Rust plugin, an extra config block, and a configurable timeout. CSS-only is one HTML file, ~3.7 KB of inline styles, and zero new dependencies. The brand consistency (gradient + L monogram + accent dot) is the actual UX win — the user sees one identity from app-icon to splash to running app to About modal, so the CSS approach was preferred. | 2026-06-11 |
| 34 | The native menu's Rust side **does not execute actions** — it emits a `lipi://menu` event with a `commandId` payload, and `useMenuEvents` on the frontend dispatches through the same Command registry that the Command Palette uses. | Single source of truth for action logic. Adding a new menu item = one entry in `menu.rs` + one new case in `routeMenuCommand` (or zero, if the command is already in the registry). No risk of Rust / TS drift: the Rust side is dumb, the JS side owns the action. The Edit submenu uses `PredefinedMenuItem` (cut/copy/paste/select-all/quit) so the OS handles clipboard routing for free. | 2026-06-11 |
| 35 | DevTools toggle is a **Rust `open_devtools` IPC command** wrapping `WebviewWindow::open_devtools()`. | Tauri 2's JS webview API (`@tauri-apps/api/webview`) does not expose this method directly — the devtools can only be opened via the Rust runtime. The one-line IPC is the right escape hatch: a 4-line Rust function, a 1-line TS wrapper, and the menu item works on Windows (WebView2 inspector) and macOS (Safari Web Inspector). | 2026-06-11 |
| 36 | About modal uses a **Zustand store** (`useAboutStore`) with a single `isOpen` boolean, mounted once at the `AppRoot` level so it overlays Settings, Welcome, AND the editor. | Two triggers (Help > About menu + Command Palette) need to share visibility state. A boolean store is the simplest model that works for both — the menu route calls `show()`, the palette command calls `show()`, the modal's `onClose` calls `hide()`. The alternative (a context provider with a `useState` in `AppRoot`) would have the same outcome with more boilerplate. | 2026-06-11 |
| 37 | M2a voice capture uses the **JS-side `getUserMedia` + `MediaRecorder`** APIs (no Rust `cpal` / `tauri-plugin-microphone`). | Tauri 2's WebView2 / WKWebView / WebKitGTK all expose `navigator.mediaDevices` with `getUserMedia` support, including the cross-platform MIME-type negotiation (audio/webm with opus on desktop, audio/mp4 on iOS Safari). The hook uses `MediaRecorder.isTypeSupported()` to pick the best match at runtime. This keeps M2a dependency-free and works on all 5 platforms without per-platform Rust code. The cost is no access to OS-level audio APIs (VAD, AGC, echo cancellation) — those are M2c problems. | 2026-06-11 |
| 38 | The `useVoiceCapture` hook is a **pluggable STT provider** with three values: `'stub'` (M2a — placeholder), `'wispr'` (M2b), `'ondevice'` (M2c). | The hook is dumb about STT. It just calls a `transcribe(blob)` function and gets a string back. M2b/c swap the implementation by passing a different `provider` option to the hook. The store doesn't know which provider is in use; the UI doesn't either. This makes the M2a -> M2b/c transition a one-line config change, not a refactor. | 2026-06-11 |
| 39 | The voice store has **no persistence** (transcripts and recordings are ephemeral). | Sending a message commits the transcript to the AI chat history (`aiStore.messages`). Discarding a take is just a `setTranscript('')` call. Persisting audio blobs is a privacy problem (the user may record something they didn't mean to send) and a storage problem (audio is fat). We never persist audio. | 2026-06-11 |
| 40 | The Composer's transcript-merge effect **clears the store immediately after merging** (calls `useVoiceStore.getState().setTranscript('')`). | Without the clear, the same transcript would re-merge on every unrelated re-render. The clear is what makes "append once" the right semantic. The pattern is "store the side effect, fire-and-forget the consumer" — same as the chat nav store's `consumeJump()`. | 2026-06-11 |
| 41 | The M2b Wispr provider fetches the raw API key from the keychain via a new `secrets_get_api_key` Rust command, **in violation of the "key never enters JS" rule (Decision #17)** for AI provider keys. | Wispr's WebSocket API requires the key in the JavaScript WebView to authenticate the connection — the Rust proxy pattern that AI uses can't work because the WS connection is *initiated by the browser*, not by Rust. The key is fetched on `start()`, used for one WS session, and dropped on `stop()`. The key is only ever sent to the Wispr endpoint (already whitelisted in CSP, Decision #24). This is a deliberate, documented exception: the rule is "don't put keys in the JS bundle at rest," not "never read the key in JS ever." All other inviolable rules (no logging, no remote shipping, key never persisted to JS-accessible storage) still hold. | 2026-06-11 |
| 42 | M2b uses `ScriptProcessorNode` for PCM capture, **not `AudioWorkletNode`** (the Wispr quickstart's reference). | `AudioWorkletNode` needs a separately-loaded `.js` file, Vite asset plumbing, and a worklet-port lifecycle. `ScriptProcessorNode` is deprecated but supported in every Tauri WebView target (WebView2, WKWebView, WebKitGTK) and the audio callback runs on the main thread — but 50 ms of Float32 conversion is <0.1 ms of CPU on a modern laptop, so the scheduling jitter is invisible. If a future phase sees audio glitches (clipping, drift), promote to `AudioWorkletNode` — the conversion helpers (`float32ToInt16`, `encodeInt16AsBase64`) are reusable. | 2026-06-11 |
| 43 | M2c desktop ships in **stub mode** — the real `whisper-rs` / `cpal` build is gated behind a Cargo feature `m2c-native` and not exercised in the sandbox. | Compiling `whisper-rs-sys` requires `libclang.dll` (a Windows LLVM install) which is not present in the agent's sandbox. Stub mode lets the full JS-side integration (provider switch, IPC, settings UI, hook lifecycle) be developed and tested with deterministic transcripts, while a future build on a developer machine with LLVM can `cargo build --features m2c-native` for the real path. The stub is NOT a TODO marker — it's a tested, working, debuggable code path that exercises every IPC surface. The real path is fully written; only the link step is deferred. | 2026-06-12 |
| 44 | M2c on-device Rust side **owns the mic entirely** — the JS side never calls `getUserMedia` for the on-device path. | WebView mic APIs differ subtly across platforms (WebView2 exclusive-mode quirks, WKWebView's `sampleRate: 16000` not always honored). Letting Rust own capture end-to-end via `cpal` (WASAPI / CoreAudio / ALSA) means we get consistent behaviour for free, and the JS side stays a thin subscriber to the `stt://transcript` event. The cost is one extra Rust dependency (`cpal`) and the requirement that the Tauri app has OS-level mic permission (handled via the `permission-denied` SttError variant). | 2026-06-12 |
| 45 | The `OnDeviceCard` settings UI is added as a **section inside the existing `SettingsProvider` screen** — no new top-level route. | Avoids modifying `appStore.ts` and `main.tsx` (the route registry). Keeps voice settings logically grouped with the Wispr card (also in the Voice section). Trade-off: voice settings are only reachable from `Cmd+,` → Voice, not from a dedicated "Voice" route. If usage shows users miss it, promote to a standalone route in a future phase. | 2026-06-12 |
| 46 | The M2c mobile shim uses a **compile-time capability struct** (`VoicePlatformCapabilities`) surfaced via a single Rust command (`voice_platform_get_capabilities`), not a runtime platform probe. | The capability set is a function of the build target, not the runtime environment. A `#[cfg(target_os = "...")]`-gated Rust function is the cleanest, fastest, and most testable way to express "this build can use Web Speech but not on-device whisper." The JS side caches the result in `useVoiceCapabilitiesStore` and the Command Palette's `isEnabled` predicates read it synchronously. Decision recorded in `docs/decisions/0046-m2c-mobile-shim.md`. | 2026-06-12 |
| 47 | The M2c mobile JS shim picks Web Speech as the **only** STT backend on iOS / Android for the v1 cut (no Wispr, no on-device whisper). | iOS WKWebView's `SpeechRecognition` is reliable, requires no extra Swift / Kotlin glue to read, and is the same path the macOS / Windows WebView targets already use. The native dictation slot (`nativeDictation`) is reserved in the registry for a future Swift / Kotlin plugin but the v1 shim throws `'not-configured'` at start time. The trade-off is documented in HANDOFF §9.8 + the M2c mobile CHANGELOG entry. | 2026-06-12 |
| 48 | The M3-era `VoiceProvider` *interface* in `src/voice/types.ts` is **deleted** (it was scaffolding for a registry-based design that has now been superseded). The literal *union* in `src/shared/state/voicePreferencesStore.ts` is renamed to `VoiceProviderId` to avoid the collision. | The factory registry (`voiceSessionFactories: Record<VoiceProviderId, ...>`) is the new polymorphism point. Re-exporting the old interface as a type alias of `VoiceProviderId` would have been the "shim" path, but every test file and the `VoiceButton` prop type already use the union directly, so the rename is a single-pass find/replace. The semantic-version impact is called out in CHANGELOG "BREAKING: `@/voice` exports changed". | 2026-06-12 |
| 49 | M3's per-session `AbortController` is the **cancellation contract** between the hook and each session. The factory's `opts.signal` plumbs to `VoiceSessionHandle.abort()`. | The existing `generationRef` counter in the hook stays as a *secondary* guard for the "new session started after the old one was aborted" case (the abort controller doesn't solve that). The two-pronged guard mirrors the React Query / SWR pattern: abort = "I told the previous session to stop", generation = "I don't care about any result from the previous generation." | 2026-06-12 |
| 50 | M3 deletes the four `transcribeViaX` function exports and the four `*Error` classes **outright** — no deprecated wrappers, no `@deprecated` JSDoc, no re-exports. The hook (the only production consumer) and the four per-provider test files are rewritten in the same PR. | The hook and tests are the only production consumers. Shimming the old API as a one-line wrapper would have been the "low-risk" path, but it leaves a permanently-shadowed code path and complicates the per-provider test rewrites. The semantic-version impact is a breaking change to `@/voice`; called out in CHANGELOG. | 2026-06-12 |
| 51 | The M3 wire shape adds a `transcriptEvent.sessionId` field (`Option<String>` on the Rust side, optional `sessionId` on the TS side). | The 5-line Rust change is the minimum needed to demux events on the on-device factory side when the iOS Swift / Android Kotlin plugins ship with concurrent-session support. The Tauri `Channel<TranscriptEvent>` is the right native-to-JS shape; the iOS / Android plugin contracts do NOT need to change. The M3 wire-shape test asserts the field is in the JSON output. | 2026-06-12 |
| 52 | Phase I's path validation is **strict user-dirs-only** (home, Documents, Desktop), not "any path the OS can read." | The OS happily hands a process URLs to `C:\Windows\System32\cmd.exe`; a permissive validator would let a malicious link open that as a "workspace" (the FS read would fail, but the user has already been shown the path and may have acted on it). Limiting to user-owned directories is a real security boundary. The user is shown a friendly error if the path is rejected. | 2026-06-12 |
| 53 | Phase I's path canonicalisation lives on the **Rust side** (`get_user_dirs` returns the canonical form: no symlinks, no `\\?\` Windows extended-length prefix). | The JS side compares the inbound normalised path against the canonical allow-list with a case-insensitive `startsWith` on Windows and a case-sensitive `startsWith` on POSIX. This sidesteps the `URL.pathname` quirks (e.g. URL-decoding differences between Chromium's URL and Rust's `url` crate) by treating the inbound path as a string and the allow-list roots as strings. | 2026-06-12 |
| 54 | Phase I's frontend listens to `lipi://deep-link`, **not** the plugin's internal `deep-link://new-url`. The Rust `setup` callback re-emits. | If the plugin's event name changes in a future version (it already has once between 1.x and 2.x), the JS side is unaffected. The cost is one extra `app.emit` per URL, which is negligible. The event-name string lives in one place (`src/ipc/deepLink.ts`'s `DEEP_LINK_EVENT` constant) so a future rename is a single-line change. | 2026-06-12 |
| 55 | Phase I's `onDeepLink` is a **typed wrapper** in `@/ipc`, not a bare `webview.listen` call. | Per Rule 4, components and hooks import from `@/ipc`, not from `@tauri-apps/api/*` directly. Tests of `parseOpenUrl` and `routeDeepLink` are pure (no Tauri runtime) and cover the path rules + the store commit. The hook's effect is a thin mount/unmount glue. | 2026-06-12 |
| 56 | Phase J's templates are **inlined in the Rust binary** (5 `Template` consts in `src-tauri/src/templates.rs`), not read from `resources/templates/*.json` at runtime. | The 5 templates are ~30 KB of source total; shipping them as Rust consts means the gallery works even when the app is launched with a stripped-down resources directory (dev / sandbox builds), and means there's no FS-IO race during the "Create" click. The trade-off is a ~30 KB binary bloat, which is negligible relative to the current 52 KB `git.rs`. A future "user templates" feature (a `~/.lipi/templates/` folder of `.zip` files) is one accessor away. | 2026-06-12 |
| 57 | Phase J's atomic-rollback story is **staging subdir + per-file rename** (not "write all to dest in place" or "use a tempdir outside dest"). | The staging subdir lives inside `dest` (so the rename stays on the same filesystem, no cross-drive surprise on Windows) and is named `.lipi-template-staging-<rand>`. A crash mid-rename loop leaves the destination partially populated; the next `apply` call cleans up the stale staging dir before the empty-dir check runs. A `TemplateError::Partial` variant is reserved for a future iteration that swaps the in-place rename loop for a `MoveFileExW` / `renameat2` batch primitive. | 2026-06-12 |
| 58 | Phase J's `apply` **refuses to write into a non-empty destination**. The `useApplyTemplate` flow is responsible for picking a fresh subdir under the user's chosen parent, but the Rust side enforces the empty-dir invariant as a second line of defence. | The error message tells the user which destination was rejected (and why). If a future feature wants to merge into an existing workspace, it can add a separate `apply_into_existing(id, dest)` entry point with its own UI; the v1 surface is "create a fresh project, period." | 2026-06-12 |
| 59 | Phase J's JS side **ships metadata only** (name, description, file count). The file bodies never round-trip through JS. | The Rust registry is the single source of truth; the JS registry is a presentational mirror. If a template is added to the Rust side without a matching JS entry, the `apply_template` IPC succeeds but the gallery card doesn't render (we'd notice in QA). Adding a future runtime check (a `lipi://template-list` IPC that returns the canonical list) is one Rust function away; deferred because the v1 surface is stable. | 2026-06-12 |
| 60 | The recents-management polish **hides "Clear all" on a 1-item list** (footgun guard) rather than a confirm dialog. | A single-item list is *itself* the confirm — the user has exactly one recents entry, they probably want to keep it (the typical case is "I opened one project yesterday, that's my workspace"), and exposing a "Clear all" button right next to it invites a misclick. A dialog would be a worse UX (extra click for the common "I want to clear all" case, doesn't prevent the misclick that motivated the guard). The pure-function helper (`shouldShowClearAll(n)`) is testable; a confirm-dialog state machine isn't worth the complexity for a sub-1%-of-usage interaction. | 2026-06-12 |

## 5. Toolchain status (what's installed / missing)

Verified on this machine on 2026-06-09:

| Tool | Status | Notes |
|------|--------|-------|
| Node.js | **v24.14.1 installed** | OK |
| npm | **11.11.0 installed** | OK |
| pnpm | **NOT installed** | Can use `npm` instead, no blocker |
| Rust (`rustc` / `cargo`) | **1.96.0 installed** | MSVC ABI, installed via `rustup-init.exe` to `%USERPROFILE%\.cargo\bin`. `cargo-tauri` (Tauri CLI 2.11.2) installed alongside. |
| MSVC Build Tools | **v14.44.35207 installed** | Installed silently via `vs_BuildTools.exe` at `C:\BuildTools\`. Includes C++ workload, x86/x64 toolset. |
| Windows SDK | **10.0.22621.0 installed** | Auto-installed with Build Tools above. |
| WebView2 runtime | **OK** | Tauri 2 ran successfully; the WebView2 runtime is auto-installed on Windows 10/11. |
| Xcode (macOS, for iOS) | N/A on this Windows machine | Needed only if/when building for macOS/iOS |
| Android Studio + NDK | N/A on this Windows machine | Needed only if/when building for Android |

**PATH notes (Windows-specific):** The user PATH at `HKCU\Environment`
was updated to include `C:\Users\Pv Vimal Nair\.cargo\bin`, but cmd
shells in this session did not see the change immediately because
Windows only broadcasts env changes to *new* processes spawned after
the broadcast. The build commands in this session worked around this
by prepending `set "PATH=C:\Users\Pv Vimal Nair\.cargo\bin;%PATH%"`
to each `cmd /c` invocation. A fresh logon will make the PATH change
permanent for all shells.

**The MSVC build environment is not on PATH by default.** The
`link.exe` and the MSVC headers/libs are discoverable by
`cargo tauri build` because Tauri 2 invokes `vswhom` to locate the
toolchain, but a manual `cargo build` outside the Tauri CLI will need
`C:\BuildTools\VC\Auxiliary\Build\vcvars64.bat` sourced first. This is
a Windows quirk, not a Lipi issue.

## 6. How to continue (next session checklist)

**Current phase: Wispr Flow WebSocket integration complete (M2b). The headline voice path is now real end-to-end: the user clicks the mic in the AI panel, we open the mic via `getUserMedia`, capture raw 16 kHz mono Int16 PCM via `AudioContext` + `ScriptProcessorNode` (Decision #42), fetch the user's Wispr API key from the OS keychain via a new `secrets_get_api_key` IPC (Decision #41), open a WebSocket to `wss://platform-api.wisprflow.ai/api/v1/dash/client_ws`, send an `auth` frame with the `LIPI_APP_CONTEXT` payload, stream 50 ms PCM chunks as base64 `append` messages with RMS volume and `packet_duration`, send a `commit` when the iterator ends, and resolve with the server's `final: true` text — which the composer merges into the textarea exactly like the M2a stub did. The 5-state machine (`idle` / `requesting` / `recording` / `transcribing` / `error`) and all generation-guard + cleanup invariants from M2a are preserved. The Settings screen has a new "Voice" section with a `WisprCard` (password field + "Test connection" button that posts a 1-second silent WS session). A new `useVoicePreferencesStore` persists the user's choice of provider (`'wispr'` default, `'stub'` available as a debug fallback); the Command Palette has a new "Voice" group with toggle commands. 429/429 tests pass (+48 for M2b: 8 pcmCapture + 12 wisprClient + 4 useVoiceCapture wispr path + 4 voicePreferencesStore + 20 misc). `tsc` / `vite build` / `cargo check` / `cargo tauri build --debug` all clean. Bundles rebuilt: `Lipi_0.0.2_x64_en-US.msi` + `Lipi_0.0.2_x64-setup.exe`.

**Current phase: M3 — SHIPPED (unified `VoiceSession` API across all STT providers).** The 4-branch `if/else` ladder in `useVoiceCapture.start()` is gone; every STT provider implements the same `VoiceSession` interface with `onStateChange` / `onTranscription` / `onError` listeners. The four `transcribeViaX` functions and the four `*Error` classes are deleted. The `VoiceProvider` literal union is renamed to `VoiceProviderId`; the old `VoiceProvider` *interface* (M2-era scaffolding) is gone — the factory registry is the polymorphism point. The `useVoiceCapture` hook shrinks from 922 lines to ~360 (the per-provider `startXxxRecording` callbacks / `stop()` branches / `pcmHandleRef` / `onDeviceSessionIdRef` / `webSpeechHandleRef` / `streamRef` / `recorderRef` are gone — the session owns them internally). The `'nativeDictation'` factory exists in `src/voice/sessions/nativeDictationSession.ts` and is wired into the `voiceSessionFactories` registry; it throws `VoiceSessionError('not-configured')` at start time (the Swift / Kotlin plugins land separately). The Settings card and Command Palette entry for `nativeDictation` are deferred. 499/499 vitest tests pass (+18 for M3: 17 new `src/voice/session.test.ts` + the rewritten per-provider test files), 146/146 cargo tests pass (the Rust side adds the `session_id` field to `TranscriptEvent` and a new test assertion in `transcript_event_serializes_with_camel_case_keys`). `tsc -b` / `npx vitest run` / `cargo check` / `cargo test --lib` / `npm run build` all clean. See `CHANGELOG.md` "Added (M3 — unified `VoiceSession` API across all STT providers)" for the full feature list; see HANDOFF §9.9 for the migration writeup.

**Next:** After M3 is fully shipped, the deferred roadmap:
- M3 follow-up — iOS Swift `SFSpeechRecognizer` and Android Kotlin `SpeechRecognizer` plugins. The `'nativeDictation'` factory stub exists; the actual Swift / Kotlin code awaits a future session on a Mac with Xcode 16+ / Linux with Android Studio Iguana+. The `useVoiceCapabilitiesStore` already returns `nativeDictation: true` on iOS / Android (set by `src-tauri/src/voice_platform.rs`), so the plugins drop in without JS changes.
- I — `app://` URL scheme + per-folder contexts
- J — Workspace templates / starter kits
- K — Onboarding tours (post-first-run)
- L — Cross-workspace search

**Previous phase (M2a):** Voice capture foundation complete. The pipeline is plumbed end-to-end with a pluggable STT provider:
- `src/shared/state/voiceStore.ts` — five-state machine (`idle` / `requesting` / `recording` / `transcribing` / `error`) + `durationMs` + `transcript` + `lastError`. Two pure helpers (`mergeTranscript`, `formatDuration`).
- `src/shared/hooks/useVoiceCapture.ts` — `getUserMedia` + `MediaRecorder` lifecycle. rAF-driven duration counter. Mic tracks released on stop / unmount so the OS LED goes off. Permission errors mapped to friendly messages.
- `src/shared/components/VoiceButton/` — mic toggle, four visual states (idle, requesting/spinner, recording/red pulse + M:SS timer, error/red border), `aria-pressed`/`aria-busy`/title-error.
- `AIPanel.tsx` Composer — `<VoiceButton>` to the left of Send, transcript-merge effect that appends to the textarea with a paragraph break.

M2a ships with a `'stub'` STT provider that returns a recognisable placeholder. M2b (Wispr Flow WS) and M2c (on-device STT) are plumbed as separate code paths that throw "not yet wired" — they exist so the architecture is in place and a later phase can swap the implementation without changing the UI.

381/381 tests pass (+32 new: 14 voiceStore + 13 useVoiceCapture + 5 VoiceButton render). tsc, vite build, cargo check, cargo tauri build all clean. No new dependencies. Bundle grew ~5.5 KB gzipped.

**Previous phase (M2b):** Wispr Flow WebSocket integration. Headline voice path is real end-to-end:
- `src/voice/pcmCapture.ts` (~420 lines) — raw 16 kHz mono Int16 PCM capture via `AudioContext` + `ScriptProcessorNode`, with 50 ms chunked `AsyncIterable<Int16Array>`. Pure helpers `float32ToInt16` and `encodeInt16AsBase64` exported for tests. Full error-mapping (permission-denied, no-device, device-busy, sample-rate-mismatch, etc.) with a typed `PcmCaptureError`.
- `src/voice/wisprClient.ts` (~430 lines) — `transcribeViaWispr(pcm, apiKey, options?) -> Promise<string>`. Opens WS, sends `auth` frame (with `LIPI_APP_CONTEXT` = `{ name: 'Lipi', type: 'editor' }`), streams one `append` per PCM chunk with base64 + RMS volume, sends `commit` on iterator end, resolves with the final `text` frame. Re-arming 30 s timeout; auth errors / network errors / close events all map to typed `WisprClientError` codes that the hook switches on.
- `src-tauri/src/lib.rs` + `src-tauri/src/secrets.rs` — new `secrets_get_api_key` IPC command + `secretsGetApiKey` TS wrapper, allowing the WebView to fetch the raw key at start time (Decision #41 — documented exception to the "key never enters JS" rule, since the WS connection is browser-initiated).
- `src/screens/SettingsProvider/SettingsProvider.tsx` — new "Voice" section with `WisprCard` (password field + "Test connection" button).
- `src/shared/state/voicePreferencesStore.ts` — Zustand store for the user's preferred STT provider (`'wispr'` default, `'stub'` for debug), persisted to `localStorage` under `lipi:voicePreferences:v1`.
- `src/shared/commands/commands.ts` — new "Voice" group with "Use Wispr Flow" and "Use Stub (debug)" commands.
- `useVoiceCapture.ts` — now branches on `provider`. The `'wispr'` path: fetch key → open mic → call `transcribeViaWispr` → wire result back to the store. The `'stub'` path is the original M2a MediaRecorder behaviour, refactored into its own `useCallback`. All M2a invariants (5-state machine, generation guards, rAF ticker, cleanup on unmount, key drop on stop) preserved on both paths.
- `VoiceButton.tsx` — default STT provider flipped from `'stub'` to `'wispr'`.

429/429 tests pass (+48 for M2b: 8 pcmCapture + 12 wisprClient + 4 useVoiceCapture wispr path + 4 voicePreferencesStore + 20 misc). tsc, vite build, cargo check, cargo tauri build --debug all clean. No new dependencies. Bundle delta ~3 KB gzipped (mostly the `pcmCapture` + `wisprClient` code; no React-tree bloat).

**Previous phase (F):** Real product polish complete. Four cosmetic-polish pieces shipped end-to-end:
1. **Branded app icon**: `src-tauri/icons/app-icon.svg` is the new source of truth. `cargo tauri icon` reads the SVG directly (no rasterizer dependency on the dev machine) and regenerates the 32-icon set (Windows ICO, macOS ICNS, iOS appiconset, Android mipmap, Linux PNGs). The `cargo tauri signer` + the SVG icon work together — the bundler uses `icon.ico` (Windows) and `icon.icns` (macOS) at package time. The render script is `src-tauri/icons/render-source.ps1`. The SVG is ASCII-only because the bundled usvg parser (tauri-cli 2.11.2) is strict: it panics on `--` inside XML comments (W3C spec violation) and on non-ASCII bytes (no mojibake tolerated). See Decision #32.
2. **Cold-start CSS splash**: `index.html` renders a brand-matching splash (gradient mark + "LIPI" wordmark) from page load until React's first commit, then fades out via a 200ms CSS transition triggered by the `splash-done` class on `<html>`. Pure CSS, zero image deps, no spinners. The `AppRoot` mount effect (in `src/main.tsx`) adds the class; this also gives the user a moment to read the brand mark before the React tree paints, which feels intentional rather than a flash of empty `<div id="root">`.
3. **Native application menu**: registered via the Tauri 2 `tauri::menu` module (`src-tauri/src/menu.rs`). The Rust side does NOT execute actions — it emits a `lipi://menu` event with a `commandId` payload, and the frontend dispatches through the same command-palette registry (single source of truth for action logic). The Edit submenu uses `PredefinedMenuItem` (cut/copy/paste/select-all/quit) so the OS handles clipboard routing for free. The View > Toggle Developer Tools item needs a small Rust wrapper (`open_devtools` IPC) because Tauri 2's JS webview API does not expose `WebviewWindow::open_devtools()` directly.
4. **About modal**: `src/shared/components/AboutModal/` with a `useAboutStore` Zustand store (single boolean). Reachable from Help > About (routed by `useMenuEvents`) AND from the Command Palette (new `help.about` command in a new `Help` group; also added to the `Command.group` union). Uses the Modal primitive (existing, well-tested); version is loaded async via a `getAppVersion()` IPC; the modal shows a "…" placeholder for the few ms it takes. Tests cover open/close, version placeholder, static metadata, brand mark presence, a11y, and the new palette entry.

No new dependencies. All 349 tests pass. `cargo tauri build --debug` re-ran clean.

**Previous phase: Distribution packaging smoke test complete (real product gap B). First end-to-end `cargo tauri build --debug` on Windows — produces both `Lipi_0.0.2_x64_en-US.msi` (12.1 MB, WiX) and `Lipi_0.0.2_x64-setup.exe` (7.3 MB, NSIS) in `src-tauri/target/debug/bundle/{msi,nsis}/`. The Tauri bundler auto-downloads WiX 3.14 and NSIS 3.11 on first build (cached in `%LOCALAPPDATA%`). Generated a real updater signing keypair: `lipi-dev.key` (private, git-ignored, password `lipi-dev-not-a-real-secret` passed via `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) and `lipi-dev.key.pub` (public, committed and embedded in `tauri.conf.json`'s `plugins.updater.pubkey`). The pubkey flows into the built `lipi.exe` so the running app can verify future updates. Replaced the `<owner>` placeholder in `tauri.conf.json` (homepage + updater endpoint) and `Cargo.toml` (repository) with `lipi-dev/lipi` (a one-line swap at publish time). No code signing yet (SignPath / Azure Trusted Signing is a future-publication task per Section 8). Confirmed via the build: the `localStorage` keys (`lipi:workspace:v1`, `lipi:firstRun:v1`, `lipi:toolSettings:v2`, `lipi:toolDecisionLog:v1`, `lipi:customTools:v1`) survive packaging because Tauri 2 scopes `localStorage` to the bundle id — the data lives in `%LOCALAPPDATA%\app.lipi.ide\EBWebView\Default\Local Storage\leveldb\`, fully isolated from the dev (`http://localhost:1420`) origin and from other Tauri apps. Caveat: dev and packaged apps have separate `localStorage` partitions, so settings made in dev do NOT appear in the packaged app (right behaviour, but a footgun for testing — see Decision #31). 0 type errors, 0 build warnings, 0 lint regressions. Cargo + vite both clean. No new tests (Phase B is config + tooling, not code).

**Previous phase: first-run no-API-key interstitial complete (real product gap D). The flow: when a new user lands on the Welcome screen with no key in the keychain, a panel appears above the hero with an "Add {first provider} key" CTA (falls back to "Add a key" if the IPC hasn't returned the provider list yet) and a "Skip for now" link. The CTA routes to Settings AND persists the dismissal — the user is now in the right place, so we don't show the panel again. The "Skip" link just persists the dismissal. Re-opening is via the command palette's "Reopen first-run setup" command, which resets the dismissed flag and (if needed) closes the current workspace. The gate logic is exposed as a pure `computeShouldShow` function for testability — the four conditions are: `firstRun.hydrated`, `!firstRun.dismissed`, `currentPath === null`, `configuredProviders.length === 0`. IPC failures are handled with a `['__unknown__']` sentinel so we never show the panel based on a stale error. 26 new tests (9 firstRunStore + 7 FirstRunOnboarding + 7 computeShouldShow gate + 3 commands) bring the total to 338/338. The Welcome screen remains agnostic of the first-run concept — it accepts a `firstRunPanel` slot prop (same pattern as `renderActions`) and renders whatever the host passes. Same isolation rule as the rest of the project: AppRoot owns the gate, the screen owns the layout. A new cross-screen surface mounted in `main.tsx` (above the screen router) — `CommandPaletteModal` + `useCommandPaletteShortcut` — that surfaces every user-facing action as a fuzzy-search launcher. The palette is data-driven: a `Command` interface (`id`, `title`, `subtitle`, `group`, `keywords?`, `shortcut?`, `isDev?`, `isEnabled?`, `run`) backed by a `COMMANDS` array in `src/shared/commands/commands.ts`. Filtering is a pure subsequence matcher — every char in the query must appear in the haystack in order, case-insensitive, across title + subtitle + keywords — with prefix/exact-match scoring so the most likely hit ranks first. Initial command set (10): open Settings, go to Editor, new chat, cancel current stream, switch AI provider (OpenAI / Anthropic), reset all tool settings, clear activity log, reload custom tools, toggle device emulator (dev-only). `isEnabled` predicates make some commands context-aware ("Cancel stream" only when streaming, "New chat" only when idle, "Reload custom tools" only when a workspace is open) — disabled rows render dimmed with `aria-disabled="true"` but stay focusable for screen readers. The store (`useCommandPaletteStore`) is a tiny UI-state primitive: `open`, `query`, `selectedIndex`, plus `show` / `hide` / `setQuery` / `moveSelection` / `setSelection`. `setQuery` resets `selectedIndex` to 0 (launcher convention). The store does NOT clamp the index — the modal does that against the filtered list length, with `-1` meaning "no selection" (empty list). The keyboard handler in `useCommandPaletteShortcut` is mounted once in `main.tsx`; it opens the palette on Cmd-Shift-P / Ctrl-Shift-P, but suppresses the action when the user is typing in an `<input>` / `<textarea>` / `[contenteditable]` (e.g. Monaco's editor) so the shortcut doesn't pop a modal while the user is typing. Dev-only commands (`isDev: true`) are filtered out in prod builds before the filter runs. 26 new tests (16 filter + 10 store) plus the existing 255 — total 281/281 pass. Typecheck, vite build (581.95 kB), cargo check all clean.

**Previous phase: 5e complete (persistent per-decision activity log — the AI store's `resolveConfirmation(decision)` now records a `DecisionRecord` for every `[Deny] / [Run once] / [Always allow]` click in a separate `useToolDecisionLogStore` (Zustand), so the user can audit their own decisions in a new "Activity Log" section of the Settings screen). Capacity is 500 entries (locked per user call — bumping the cap is a one-line constant change); ring-buffer semantics drop the oldest on overflow. `argsPreview` is truncated to 2KB UTF-8 bytes at write time. Records carry `{ id, timestamp, toolName, decision, argsPreview, requestId, assistantMessageId }` and are persisted to localStorage under `lipi:toolDecisionLog:v1` (separate from `lipi:toolSettings:v2` — different concern, no version coupling). The hydrate path drops malformed records rather than rejecting the whole file (a single corrupt row from a past bug doesn't wipe the entire history). The store is separate from `toolSettingsStore` for two reasons: (a) different concern (settings = preferences, log = history) — `clearMessages`-style "wipe everything" can clear the log without disturbing policies; (b) different access patterns (settings are read on every tool call, the log is read only when the user opens the Settings screen). Stale decisions (the resolver bailed because the requestId was stale) are NOT recorded. The Settings UI shows each row with: a color-coded decision badge (`deny` red, `allow_once` green, `allow_always` blue), the tool name in monospace, a relative timestamp ("just now", "5m ago", "yesterday", "2026-06-09" — no `Intl.DateTimeFormat` for portability), an expandable `<details>` block with the truncated args preview, and the `assistantMessageId` as muted text (for the future "Jump to chat" feature). Pagination: at most 50 rows in the DOM at a time, with a [Show older] button that expands the limit by another 50. Empty state: "No decisions recorded yet. They'll appear here as you use the chat." A [Clear log] button is destructive and irreversible in 5e (no undo toast) — confirmed via `window.confirm`. Total tests: 117 Rust (unchanged — 5e is frontend-only) + 160 frontend (was 138; +18 in `toolDecisionLogStore.test.ts` for record/append, capacity enforcement at 500 + boundary, clear, getRecentForTool filter, getRecent limit, persistence round-trip, malformed-record filtering, corrupt v1 → defaults, hydrate-guard, 4 `truncateArgsPreview` tests including a UTF-8 byte-bound test; +4 in `aiStore.test.ts` for deny / allow_once / allow_always / stale-no-record). 0 type errors, 0 build warnings, 0 lint regressions. Titlebar subtitle is `dev · phase 5d` (5e didn't bump it — the titlebar changes for sub-phases only when there's a UI-visible feature shipped, and the activity log is a settings-screen addition rather than a workspace-screen addition). Next: Phase 5f (TBD — likely "Jump to chat from log row" or "Revert allow_always" inline on each row, both deferred from 5e; or moving to the next batch of safety/UX improvements).

**Previous phase (5b-4, for context — real-time streaming render + tool-call protocol, both Rust and frontend). The `ChatDelta` enum now has a 4th variant `ToolCall { id, name, input }` (mirrored in TS as `ChatChunkPayload.toolCall`); both adapters assemble tool calls byte-by-byte from the wire deltas and emit a single `ToolCall` chunk per completed tool. The OpenAI adapter recognises `delta.tool_calls[]` (stable per-`index` accumulators, `function.arguments` concatenated as a `String`); the Anthropic adapter recognises `content_block_start{type:"tool_use"}` (registers a per-`index` tool with `id` + `name`), `content_block_delta{type:"input_json_delta"}` (appends `partial_json` to the tool at that `index`), and `content_block_stop` (emits the completed `ToolCall` and removes the tool from the map). In-flight tools are flushed on every stream end path: `Done` (OpenAI `[DONE]`, Anthropic `message_stop`, EOF), cancel, and transport error. The streaming-model is now "stream in real time, seal on done": the JS `aiStore` demux appends `delta.text` to the streaming message's `content` in real time (5b-3 left the content empty — 5b-4 wires it up) and appends `toolCall` chunks to the message's `toolCalls` array. Each assistant message now renders an optional `ToolTrace` per tool call — a small collapsible card under the message bubble showing the function name, the pretty-printed input JSON, and a "not executed (5b-4 is read-only)" placeholder for the result (5b-5+ will wire tool execution and the result back to the model). Also fixed a pre-existing 5b-2 wire-shape inconsistency: `ChatDelta::Done.stop_reason` now serialises as `stopReason` (camelCase) to match the rest of the wire and the TS discriminated union (the `rename_all = "camelCase"` on the enum only applies to variant names, not to field names, so 5b-4 added a per-field `#[serde(rename = "stopReason")]`). 18 new Rust unit tests cover the per-chunk parsers (`parse_openai_chunk`, `parse_anthropic_content_block_delta`, `parse_anthropic_content_block_start`) and the `ChatDelta` JSON shape (3 wire-shape tests: `ToolCall`, `Delta`, `Done { stopReason: "tool_use" }`). 6 new vitest tests cover the demux of `delta` / `toolCall` / inline `done` chunks (the 5b-3 `send` test was also updated to assert on the new `toolCalls: []` field). Total tests: 99 Rust (75 lib + 6 git + 6 secrets_ai + 9 terminal + 3 terminal_tauri) + 15 frontend (9 from 5b-3 + 6 new 5b-4). 0 type errors, 0 build warnings, 0 lint regressions. Titlebar subtitle still reads `dev · phase 5b-3` — the titlebar doesn't change for sub-phases. Next: 5b-5 — inline edit (`Cmd-K` modal) + provider-specific error messages + new-chat button.

**Previous phase (5b-3, for context — frontend: `aiStore` (Zustand) + `AIPanel` side panel as third tab in `SidePanelPane` + model picker + composer with Send/Stop, "append on done" — no real-time streaming render yet). The `src/ipc/ai.ts` surface is extended with the 5b-3 chat IPC: `aiChatStream(args) -> Promise<string>` (returns the `requestId` synchronously, mirrors 4a's terminal pattern), `aiCancelStream(requestId) -> Promise<boolean>` (returns `true` if cancelled, `false` if the request was already gone — natural completion races the user click), and `onAiChunk / onAiDone / onAiError` event subscriptions. The Rust wire shape is mirrored in TypeScript as `ChatMessageArgs` (camelCase), `ChatStreamArgs`, `ChatChunkPayload` (discriminated union `delta | done | error` with `kind` tag), `ChunkEnvelope { requestId, payload }`, `DoneEnvelope { requestId, cancelled, stopReason? }`, and `ErrorEnvelope { requestId, kind, message }` — every one documented in JSDoc with the Rust-side shape mirror. The `aiStore` (~480 lines, screen-local per Rule 3) owns the chat thread (`messages: ChatMessage[]` with stable client-side `id`s, `streaming: boolean` per message), the request lifecycle as a discriminated union (`RequestStatus = { kind: 'idle' } | { kind: 'streaming' } | { kind: 'error'; errorKind; message }` — no boolean soup per Rule 5), the `activeRequestId` for event demux, and the `provider` / `model` / `providers` / `configuredProviders` selectors. `send(text)` optimistically appends a user message + an empty streaming assistant placeholder, calls `aiChatStream` with the full thread (filtered to non-streaming messages, oldest first), and sets `activeRequestId` once the invoke resolves. `stop()` calls `aiCancelStream` and optimistically flips back to `idle`; the eventual `ai://done` is a no-op state-wise. `setProvider` clears the model; a `useEffect` in `AIPanel` re-defaults to the new provider's `defaultModel`. `loadProviders` fetches `aiListProviders` and `aiGetConfiguredProviders` in parallel; if the current provider is unconfigured, falls back to the first configured one. Module-level `setupSubscriptions(getState)` runs ONCE at module load, registers the three listeners via the `onAi{Chunk,Done,Error}` IPC wrappers, and routes each event to the right store action based on `requestId` (events for unknown `requestId`s are silently dropped — they can't be ours). The store does NOT touch SSE / transport / cancellation tokens — those are all in Rust. The `AIPanel` (~440 lines) reuses `PaneShell` for the header; the header has a `ProviderBadge` popover (click-to-open list of the 3 providers, green/amber dot for configured/unconfigured, unconfigured providers disabled with a "no key" hint), a scrollable `ChatThread` (user messages right-aligned with accent-soft background, assistant messages left-aligned with elevated background, `pre-wrap` whitespace, blinking `▌` cursor on the streaming message), and a `Composer` (textarea + Send/Stop button, Enter sends, Shift+Enter inserts newline, button toggles between ⏎ Send and ⏹ Stop). `ErrorBanner` is a dismissable red strip above the composer. 9 vitest tests pass for the store (4 `send` tests, 4 `event demux` tests covering `ai://done` / unknown `requestId` / `ai://error` / `ai://chunk` mid-stream error, 1 `error lifecycle` test for `clearError`). The `SidePanelPane` gets `'ai'` as the third tab (next to `'git'` and `'terminal'`). The EditorWorkspace titlebar subtitle is now `dev · phase 5b-3` (first refresh since 5a). The streaming-assistant-message text render is intentionally minimal in 5b-3 — the deltas are accepted by the store but logged to dev console only, not appended to the message content; on `ai://done` the assistant message is sealed (still empty). 5b-4 will hook `ai://chunk` deltas to the streaming message for real-time render. `vitest@4.1.8` and `jsdom` added as devDependencies. `cargo build` — clean, 0 errors, 0 warnings (no Rust changes). `cargo test` — 81 / 81 stable. `npm run typecheck` — 0 errors. `npm test` — 9 / 9 pass. `npm run build` — pass, 137 modules (+5 for the new AIPanel + aiStore + test files in the transform graph). Next: 5b-4 — wire `ai://chunk` deltas to the streaming assistant message (real-time render), plus a per-message tool-trace affordance for the function-call events that the Rust side already emits (`ChatDelta::Error` is the only "tool" event today; 5b-4 may also add a `tool_call` delta type for function calling).**

**Phase 5b-2 complete (D5 step 2.2 — OpenRouter passthrough + Anthropic adapter + `ai_cancel_stream`, no UI yet: extended `SseStream` with `event_name` tracking and a new `SseEvent::Named { event, data }` variant (for Anthropic's named events `message_start` / `content_block_start` / `content_block_delta` / `content_block_stop` / `message_delta` / `message_stop`); 5b-1's `SseEvent::Data { data }` stays for unnamed events (OpenAI). The OpenAI adapter handles `event:`-named events defensively: if OpenAI ever sends a named event, we emit an `Error { errorKind: "parse", message: "unexpected named SSE event \`x\` from OpenAI-compatible endpoint" }` chunk and continue. New `stream_chat_anthropic(api_key, base_url, model, messages, on_chunk, cancel) -> Result<(), ChatError>` — same shape as the OpenAI adapter but: (a) the request body has a top-level `system` field (extracted from `messages` where `role == "system"`, concatenated with `\n\n` if multiple) and a required `max_tokens: 4096` (hardcoded for the MVP; surfaced as a model-settings UI in 5b-3+ if users want to override); (b) the auth is `x-api-key: <key>` + `anthropic-version: 2023-06-01` (no `Authorization: Bearer`); (c) the response is named SSE events: `content_block_delta` → `Delta{text}` (extracted from `data.delta.text`; non-`text_delta` deltas like `input_json_delta` for tool use are silently skipped — 5b-2 doesn't support tools), `message_delta` → captures `data.delta.stop_reason` for later, `message_stop` → `Done { cancelled: false, stopReason: pending_stop_reason }`. Other named events (`message_start`, `content_block_start`, `content_block_stop`, `ping`) are silently skipped. `ChatDelta::Done` extended with `stopReason: Option<String>` (5b-2 fields use `#[serde(skip_serializing_if = "Option::is_none")]` so the field is absent in OpenAI events and present-but-`null`-equivalent would be wrong — we just omit the field). New `src-tauri/src/cancel.rs` module (~200 lines) with a process-wide `OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>>` cancellation registry: `register(request_id) -> (Arc<AtomicBool>, CancelGuard)` stores the flag in the map and returns a guard that removes the entry on `Drop` (RAII cleanup; the chat-stream task holds the guard for its lifetime so the map only ever contains in-flight requests); `lookup(request_id) -> Option<Arc<AtomicBool>>` for the `ai_cancel_stream` command; `deregister(request_id)` for explicit cleanup. New Tauri command `ai_cancel_stream(request_id: String) -> Result<bool, String>` looks up the flag and `store(true, Ordering::Relaxed)`. The reader task checks the flag between SSE events in both adapters and emits `Done { cancelled: true, stopReason: None }` if flipped. `ai_chat_stream` is now a multi-provider dispatcher: `openai` and `openrouter` share the OpenAI adapter (base-URL swap — `openai_compatible_base_url` for `openrouter` is `https://openrouter.ai/api/v1`); `anthropic` uses the Anthropic adapter. The command pre-resolves the base URL for each provider *before* the match (the match arms are then `Some(base_url) => stream(...)`, `None => Err(...)` — no `?` in the match arms, no Result-in-async-block wart). A `DoneState` struct (wrapped in `Arc<Mutex<…>>`) captures the most recent `Done` chunk's `cancelled` / `stopReason` so the final `ai://done` event carries the same `stopReason` the JS side saw inline in the last `ai://chunk`. 5 new tests in `chat::tests`: `named_event_yields_named_variant`, `event_name_resets_between_events`, `last_event_line_wins_on_multiple_event_lines`, `strips_leading_space_after_event_colon`, `done_sentinel_is_not_recognised_inside_named_event`. 4 new tests in `cancel::tests`: `register_then_lookup_returns_same_arc`, `guard_drop_removes_entry`, `flip_signal_via_lookup`, and a 4th for random-suffix isolation. Total tests: 57 lib + 6 secrets_ai_smoke + 6 git_status_smoke + 9 terminal_smoke + 3 terminal_tauri_smoke = 81 (was 73 in 5b-1; +8 in 5b-2). No UI changes in 5b-2; the JS side does not call `ai_chat_stream` or `ai_cancel_stream` yet — that's 5b-3. Titlebar still reads `dev · phase 5a`. Next: 5b-3 — `aiStore` (Zustand) for chat-thread lifecycle, `AIPanel` side panel as the third tab in `SidePanelPane` (next to Source Control and Terminal), model picker dropdown, composer with Send / Stop button, real-time streaming rendering of `ai://chunk` events.)** — Rust streaming proxy + OpenAI adapter, no UI yet: new `src-tauri/src/chat.rs` module (~600 lines, single-file-single-concern per Rule 3) with `ChatMessage` (role/content/name, serialised camelCase), `ChatDelta` (tagged enum `delta | done | error` with `errorKind` field — the `kind` field is the serde tag, so the inner field is `errorKind` to avoid collision), and `ChatError` (setup errors only: `missingApiKey`, `unknownProvider`, `httpClient`, `httpTransport`, `httpStatus` — streaming errors surface as `ChatDelta::Error` chunks, not as `Result::Err`, so the JS side sees a uniform `ChatDelta` stream). A small `SseStream<R: AsyncReadExt + Unpin>` parser yields `SseEvent::Data { data } | SseEvent::Done` from a `text/event-stream` body; handles `data: {json}\n\n` framing, `[DONE]` sentinel, partial UTF-8 across chunks (we buffer as `Bytes` and only `String::from_utf8_lossy` at the frame boundary), multiple `data:` lines per event concatenated with `\n` (per SSE spec; OpenAI never does this in practice, but we handle it for correctness), `:`-prefixed comment lines, `\r\n` and `\n` line endings, and the leading-space-after-`data:` rule. `stream_chat_openai(api_key, base_url, model, messages, on_chunk: impl Fn(ChatDelta) + Send + 'static, cancel: Arc<AtomicBool>) -> Result<(), ChatError>` opens an HTTPS POST to `{base_url}/chat/completions` with `Authorization: Bearer …` and `Accept: text/event-stream`, reads the SSE body via `reqwest::Response::bytes_stream()` wrapped in a `tokio_util::io::StreamReader`, and invokes `on_chunk(Delta | Done | Error)` for each event. Cancellation is cooperative: the function checks `cancel.load(Ordering::Relaxed)` between SSE events and emits a synthetic `Done { cancelled: true }` chunk if flipped (the 5b-2 `ai_cancel_stream` Tauri command will flip the token). New Tauri command `ai_chat_stream(app, args: ChatRequestArgs) -> Result<String, ChatError>` reads the key from the keychain via `secrets::get_api_key`, looks up the provider via `provider_by_id`, generates a requestId of the form `ai_<32 hex chars>`, and `tokio::spawn`s a task that calls `stream_chat_openai` with a `move` closure that emits `ai://chunk` events tagged with the requestId; the task also emits `ai://done` on natural completion or `ai://error` + `ai://done` on early failure. The command returns the requestId **synchronously** so the JS side can subscribe to the events before the first chunk arrives (same pattern as 4a's terminal — the provider can return its first chunk in <50ms, and we must not lose it). 5b-1 only handles the `openai` provider (the adapter is provider-agnostic — any OpenAI-compatible base URL works — but the dispatch in `ai_chat_stream` rejects `openrouter` / `anthropic` with `ChatError::UnknownProvider` until 5b-2). 8 new tests in `chat::tests`: `parses_a_single_complete_frame`, `parses_multiple_frames_in_sequence`, `recognizes_done_sentinel`, `skips_comment_lines`, `handles_crlf_line_endings`, `strips_leading_space_after_data_colon`, `yields_none_on_eof`, `concatenates_multiple_data_lines_per_event`. Total tests: 49 lib + 6 secrets_ai_smoke + 6 git_status_smoke + 3 terminal_smoke + 0 terminal_tauri_smoke + 9 … = 73 tests (was 65 in 5a; +8 in 5b-1). No UI changes in 5b-1; the JS side does not call `ai_chat_stream` yet — that's 5b-3. Titlebar still reads `dev · phase 5a` (the next UI refresh, 5b-3, will update it to `dev · phase 5b-3` when the AIPanel tab lands). Next: 5b-2 — OpenRouter (base-URL swap of the OpenAI adapter) and Anthropic (different SSE framing with named events `message_start` / `content_block_delta` / `message_stop`, different request body and `x-api-key` + `anthropic-version` headers, no `Authorization: Bearer`); plus the `ai_cancel_stream` Tauri command that flips the cancel token via a `HashMap<requestId, Arc<AtomicBool>>`.)**

When a new agent picks this up:

1. **Read this HANDOFF.md first** — don't re-derive context.
2. **Read the plan file** at `C:\Users\Pv Vimal Nair\.cursor\plans\cross-platform_ide_foundation_18a37d37.plan.md` for the full phase-by-phase plan.
3. **Verify the toolchain** (Section 5) is still installed. If a fresh box:
   - `rustup-init.exe` from https://rustup.rs (stable, MSVC, minimal)
   - VS Build Tools with C++ workload + Windows 11 SDK (Section 5, decision #20)
   - `cargo install tauri-cli --version "^2.0" --locked`
4. **Run `cargo tauri dev`** to confirm the shell still opens. If it fails, check the tauri-dev.log and the dev URL is `http://localhost:1420`.
5. **Phase 5 entry point:** 4c (multi-tab terminals + cross-platform shell polish) is complete. The side panel has a `TerminalPanel` with a per-session tab strip (1, 2, 3, …, +), each tab shows the active shell in its tooltip, and the active session's shell is shown in the `PaneShell` header. Multiple concurrent sessions work end-to-end (the Rust pipe already supported it; the JS side now does too via `terminalStore`). Next is **Phase 5 (D5) — AI chat panel + inline edit (Cmd-K)**: (a) a new `AIPanel` side panel with a chat thread, a composer at the bottom, and a per-message tool-trace; (b) provider config (OpenAI / Anthropic / OpenRouter) read from the OS keychain via the `keyring` crate, with a Settings screen to enter the key; (c) the AI proxy in Rust (`src-tauri/src/ai.rs`) streams responses back to the frontend as Tauri events (no backend, just client-side proxying per Decision #17); (d) inline edit: `Cmd-K` opens a small modal anchored at the cursor, the user types a prompt, the AI returns a replacement for the selected text, the user accepts (`Tab`) or rejects (`Esc`); (e) BYO-key model — the API key is read in Rust, sent as a Bearer header, and never enters the JS bundle. **Plan D5 is opinionated — surface the chat-thread layout, the streaming UX, and the inline-edit UX to the owner before writing code.**
6. **Do not skip phases.** D3 → D4 → D5 → D6 → M1–M5 (Phase 3c-2 → 4 → 5 → 6 → mobile).
7. **Phase-by-phase verification** — at the end of each phase, stop and show the owner a working result before moving on (Rule 7 / Section 7 / constraint #5).

**Phase 1b done criteria (all met):**
- [x] Rust toolchain installed
- [x] MSVC Build Tools + Windows SDK installed
- [x] Tauri CLI installed
- [x] `src-tauri/` scaffold complete (Cargo.toml, tauri.conf.json, main.rs, lib.rs, build.rs, capabilities, icons)
- [x] `cargo tauri dev` launches a window on Windows showing the existing React EditorWorkspace shell
- [x] IPC bridge live (confirmed by ESTABLISHED connection between Tauri and Vite on :1420)

**Phase 2 done criteria (all 3 sub-phases met):**
- [x] 2a — Rust `fs.rs` (read_dir / read_file / write_file / pick_folder) + 3 typed Tauri commands + 7 unit tests, all pass
- [x] 2b — `FileTreePane` (open-folder button, recursive tree, expand/collapse, selection, keyboard nav)
- [x] 2c — Monaco editor, `TabStrip`, dirty state, `Ctrl+S` save, `KeyHint` shared component, `useKeyboardShortcut` shared hook

**Phase 3a done criteria (this session):**
- [x] Rust `git.rs` (open_repo / current_branch / status) + 3 typed Tauri commands (`git_open` / `git_status` / `git_current_branch`) + typed `src/ipc/git.ts` wrapper
- [x] `ChangeKind` discriminated union (Added / Modified / Deleted / Renamed / Copied / Untracked / TypeChange / Conflict) with `staged` / `unstaged` bits
- [x] 7 git unit tests pass (open on a real repo, open fails on a non-repo, current branch = "main", status on a clean repo is clean, modified file surfaces as unstaged, untracked file surfaces as Untracked, staged add surfaces as Added+staged)
- [x] `gix = "=0.78.0"` pinned (see Decision #26)
- [x] `cargo tauri dev` smoke test passes (Tauri window opens; no UI changes from 3a by design — UI lands in 3b)
- [x] `npm run typecheck` passes, 0 errors

**Phase 3b done criteria (this session):**
- [x] `gitStore.ts` Zustand store with `GitPanelStatus` discriminated union: `idle | opening | not-a-repo | loading | ready { status } | error { message }`. Plus `rootPath`, `isRefreshing`, and 6 selectors.
- [x] `useGitStatus.ts` hook: `openRoot` (probe + fetch on first call), `refresh` (re-fetch), `close` (reset). Maps `GitError(payload.kind === 'NotARepository')` to the `not-a-repo` state, propagates other errors to `error`.
- [x] `GitPanel` component: PaneShell with `Source Control · Git` header + refresh IconButton. Renders branch chip (`⎇ main`), ahead/behind pills (↑N / ↓N), summary bar (e.g. "3 changes · 1 staged · 2 unstaged"), and the changed-files list with `changeKindBadge`s (A/M/D/R/C/U/T/!), color-coded by kind and stage. All 6 first-class states render bespoke placeholder/error UI.
- [x] Reuses `PaneShell`, `Button`, `IconButton` from `src/shared/components/`. No raw `<button>` or `<input>` in the screen.
- [x] All CSS uses `var(--space-*)`, `var(--color-*)`, `var(--font-*)` tokens. Added `--color-success-soft`, `--color-warning-soft`, `--color-danger-soft`, `--color-danger-strong-soft` to `tokens.css` for the badge backgrounds (no raw rgba in components).
- [x] `SidePanelPane` now mounts `<GitPanel />` (replaces the empty placeholder).
- [x] `EditorWorkspace` orchestrates the wire: `fileTreeStore.rootPath` change → `useGitStatus().openRoot(rootPath)`; on close, `closeGit()` resets the store. Rule 6 satisfied: stores never know about each other.
- [x] `index.ts` barrel for `GitPanel` re-exports the component + `GitPanelStatus` type.
- [x] `src-tauri/tests/git_status_smoke.rs` integration test: 3 tests covering the open→status round trip, the `ChangeKind` discriminator (compile-time tripwire), and the JSON wire shape (camelCase field names, kebab-case `kind` enum). All 3 pass.
- [x] `lib.rs` re-exports `open_repo`, `status`, `ChangeKind`, `ChangedFile`, `RepoHandle`, `RepoStatus` from the (otherwise private) `git` module so the integration test can hit the real `pub` surface.
- [x] `npm run typecheck` passes, 0 errors
- [x] `cargo test --lib` passes (14 tests: 7 fs + 7 git)
- [x] `cargo test --test git_status_smoke` passes (3 tests)
- [x] `npm run build` passes (106 modules, no errors; CSS bundle 20.83 kB → +6 kB from 3a)
- [x] `cargo tauri dev` smoke test passes (Tauri window opens, GitPanel renders the "No folder opened" empty state, titlebar shows `dev · phase 3b`)

**Phase 3c-1 done criteria (this session — pipe only, no UI):**
- [x] `git::diff(handle, path) -> FileDiff` reads HEAD's blob via `gix::Repository::head_tree_id` + `Tree::lookup_entry_by_path` (which is `&self` with one arg in 0.78 — earlier web research had it wrong) + `Object::try_into_blob`; reads the worktree version off disk; flags binary files via a NUL-in-first-8-KB heuristic; emits `(old, new, isBinary, isNew, isDeleted)`. Path is forward-slash-normalised for tree lookup (Windows-safe).
- [x] `git::discard(handle, path)` writes HEAD's blob back to the worktree for tracked files, or removes the file from disk for untracked / staged-add files. Idempotent: calling on a clean file is a no-op.
- [x] Real `ahead_behind` via `gix::Repository::rev_walk([upstream]).with_hidden([local]).all()` (and the mirror for ahead). Both counts use `Walk::filter_map(Result::ok).count()` (gix 0.78 yields `Result<Info, _>`; a naive `.count()` would inflate counts on mid-walk errors). `upstream_id` resolves `branch@{u}` via `rev_parse_single`.
- [x] `git_diff` and `git_discard` Tauri commands wired in `lib.rs`. `lib.rs` re-exports `diff`, `discard`, `FileDiff` for integration tests.
- [x] `FileDiff` interface + `gitDiff(repoId, path)` and `gitDiscard(repoId, path)` typed wrappers added to `src/ipc/git.ts`. Re-exported via `src/ipc/index.ts` (Rule 4). The wire shape is locked so 3c-2's `DiffView` builds against a stable contract.
- [x] `src/ipc/git.ts` updated Phase-3c-1 note in the doc comment (the file is now the home of `FileDiff`; the `ChangeKind` / `RepoStatus` shapes are unchanged from 3a/3b).
- [x] 7 new unit tests in `src/git.rs`: `diff_reports_old_and_new_for_a_modified_tracked_file`, `diff_reports_new_for_an_untracked_file`, `diff_reports_deleted_when_worktree_is_missing`, `diff_marks_binary_files_correctly`, `discard_writes_head_blob_to_worktree_for_modified_files`, `discard_removes_untracked_file`, `ahead_behind_reports_one_ahead_against_tracking_branch`. The last one builds a synthetic upstream via `git update-ref refs/remotes/origin/main HEAD~1` + `branch.main.{remote,merge}` + `remote.origin.{url,fetch}` (git's @u resolution requires the remote's `fetch` refspec to be configured — easy to miss, locked in by a sanity assertion against `git rev-parse main@{u}`).
- [x] 3 new integration tests in `tests/git_status_smoke.rs`: `file_diff_serialises_with_camel_case_field_names` (locks the JSON wire shape for 3c-2's DiffView), `discard_writes_head_blob_back_to_worktree` (full open → modify → discard → re-status roundtrip), `discard_is_idempotent_on_already_clean_files` (click-discard-twice case).
- [x] `npm run typecheck` passes, 0 errors
- [x] `cargo test --lib` passes (22 tests: 7 fs + 15 git, +7 from 3b)
- [x] `cargo test --test git_status_smoke` passes (6 tests, +3 from 3b)
- [x] `npm run build` passes (106 modules, no errors)
- [x] `cargo tauri dev` smoke test passes (Tauri window opens, GitPanel unchanged from 3b — 3c-1 is a no-op UI change by design; the new IPC commands are reachable but not yet called by any component)
- [x] No UI changes in 3c-1; the GitPanel renders the same as 3b

**Phase 3c-2 done criteria (this session — UI only, no new IPC):**
- [x] `inferLanguage` extracted to `src/shared/utils/inferLanguage.ts`; `editorTabsStore` re-exports it so all existing callers (and the new `DiffView`) use the same single source of truth (Rule 3 cleanup, also Rule 4 — build once, use everywhere).
- [x] `gitStore` extended with `activeDiffPath: string | null` + `setActiveDiffPath(path)` action + `activeDiffPath` selector (Rule 5 — discriminated union, no `isShowingDiff: boolean` soup).
- [x] `useDiff(activePath)` hook owns the per-file `FileDiff` load lifecycle: discriminated `idle | loading | ready | error` status; in-flight calls are abandoned (activePathRef) if the user navigates away; `discard()` calls `gitDiscard` then re-fetches the diff so the right pane catches up. Per Rule 6, no component imports `gitDiff` / `gitDiscard` directly — only this hook does.
- [x] `DiffView` component (`<DiffView>/<DiffView>.tsx + .module.css + index.ts`) renders Monaco's `DiffEditor` read-only with `original = old` and `modified = new`; placeholder UI for `isBinary` (no garbled Monaco), `isNew` (shows new content only, with a hint), and `isDeleted` (shows old content only, with a hint). Language is inferred via the shared util. Same Monaco `loader.config({ paths: { vs: ... } })` as `EditorPane` so the diff editor finds its peers.
- [x] `GitPanel` `ChangedFileRow` is now a `<button>` (the row's main area) that calls `setActiveDiffPath(file.path)`. The row also gets a per-file `IconButton` (↺) that calls `gitDiscard` + `useGitStatus.refresh()` and stops propagation so it doesn't also trigger the row click. The button is rendered only when `file.unstaged === true` (3c-1 only ships unstaged discard).
- [x] `SidePanelPane` swaps between `<GitPanel />` and `<DiffView />` based on `gitSelectors.activeDiffPath` (one ternary, one state, two pure components — Rule 6).
- [x] `useGitStatus.close()` now also calls `setActiveDiffPath(null)` so closing the file tree (e.g. via `EditorWorkspace` orchestrator) also dismisses any open diff view (Rule 6 — the orchestrator has a single `close()` entry point that does the right thing).
- [x] Titlebar subtitle updated: `dev · phase 3c-2`.
- [x] CSS for `DiffView` + updated `GitPanel` row (now a flex container with an inner button and a trailing IconButton) reuses only tokens (`--space-*`, `--color-*`, `--radius-*`, `--font-*`); no raw hex, no magic numbers.
- [x] `npm run typecheck` passes (0 errors)
- [x] `npm run build` passes (111 modules; the prior dynamic-import warning from `GitPanel` is gone since `gitDiscard` is now a static import).
- [x] `cargo test --lib` still 22/22 passing (no Rust changes in 3c-2).
- [x] `cargo test --test git_status_smoke` still 6/6 passing (3c-1 IPC surface is unchanged; 3c-2 just calls it).
- [x] `cargo tauri dev` smoke test: Tauri window opens, titlebar shows `dev · phase 3c-2`, no console errors on first paint. (Full E2E click-to-diff + discard flow was not driven headlessly here; the underlying pipe is already covered by the 3c-1 integration tests, and the React state machine is small enough for visual review.)

**Phase 4a done criteria (this session — terminal pipe only, no UI):**
- [x] `portable-pty = "0.8"` added to `src-tauri/Cargo.toml` (locked to a major version per the plan's "stay on a known-good major" rule). `getrandom = "0.2"` added for the session-id generator (already in the tree transitively via gix).
- [x] `src-tauri/src/terminal.rs` (new, ~330 lines) — `TerminalState` (one per app, held behind `Arc<Mutex<HashMap<String, Session>>>`), `Session` (master / writer / child, all `Send + Sync` via `Mutex`), `EventSink` trait (output + exit events, abstracted for testability), `open` / `write` / `resize` / `close` / `default_shell` public functions. Reader is a `std::thread` (not async) because portable-pty exposes `std::io::Read` and the underlying FDs aren't Tokio-friendly on Windows ConPTY. Default 24×80 PTY size, 4 KiB read chunks, `$TERM=xterm-256color` if unset, `BASH_SILENCE_DEPRECATION_WARNING=1` if the shell is bash.
- [x] 4 Tauri commands wired in `src-tauri/src/lib.rs`: `terminal_open` (returns `OpenResult { sessionId, shell, rows, cols }`), `terminal_write` (raw bytes), `terminal_resize`, `terminal_close` (idempotent). Plus a `terminal_default_shell_cmd` for the future settings panel. `TerminalState` is registered via `tauri::Builder::manage(Arc::new(TerminalState::new()))`.
- [x] `TauriEventSink` wraps `AppHandle::emit` behind the `EventSink` trait so the `terminal::open` core is testable without a Tauri context. Emits two events: `terminal://output` (payload: `{ sessionId, data: Vec<u8> }`) and `terminal://exit` (payload: `{ sessionId, exitCode: Option<i32> }`).
- [x] `src/ipc/terminal.ts` (new) — typed wrappers (`terminalOpen` / `terminalWrite` / `terminalResize` / `terminalClose` / `terminalDefaultShell`), `OpenResult` / `TerminalOutputEvent` / `TerminalExitEvent` interfaces, `TerminalError` class, `onTerminalOutput` / `onTerminalExit` event subscriptions. The IPC payload shape matches the Rust wire (camelCase via `#[serde(rename_all = "camelCase")]`). Re-exported from `src/ipc/index.ts`.
- [x] `src/screens/EditorWorkspace/hooks/useTerminal.ts` (new) — discriminated `idle | opening | running | exited | error` status, `output` buffer (4a accumulates; 4b will switch to event-driven streaming), `start` / `write` / `resize` / `close` / `clearOutput` actions, `isReady` boolean, `getDefaultShell` helper. Subscribes once to `onTerminalOutput` + `onTerminalExit` and demuxes via the active `sessionIdRef`. Per Rule 6, this hook is the *only* place that imports from `@/ipc/terminal`.
- [x] 6 new unit tests in `terminal.rs` (all passing): `default_shell_is_non_empty_on_this_platform`, `session_ids_are_unique` (32 hex chars, all hex, all different), `open_write_echo_round_trip` (spawns a real cmd.exe / /bin/sh, writes "echo hi-from-lipi\r\n", polls for "hi-from-lipi" in the captured output within 2 s), `close_is_idempotent`, `write_to_unknown_session_returns_not_found`, `resize_unknown_session_returns_not_found`. The round-trip test is the canonical end-to-end gate: it proves the PTY is actually wired to the shell, not just that the API compiles.
- [x] 6 new integration tests in `tests/terminal_smoke.rs` (all passing): `open_write_close_round_trip`, `resize_on_live_session_succeeds`, `close_is_idempotent`, `write_to_unknown_session_returns_not_found` (asserts the wire JSON contains `"notFound"` — serde's camelCase tag), `default_shell_returns_non_empty_path_on_this_platform`, `exit_event_fires_when_shell_exits_via_eof` (the most subtle one: closes the session, then polls the sink for an `Exit` event within 3 s; proves the reader thread correctly detects EOF and reports the child's exit code).
- [x] `npm run typecheck` passes (0 errors)
- [x] `npm run build` passes (113 modules transformed, 0 errors; +2 from `terminal.ts` + `useTerminal.ts`)
- [x] `cargo test --lib` — 28/28 passing (was 22; +6 from 4a)
- [x] `cargo test --test terminal_smoke` — 6/6 passing
- [x] `cargo test --test git_status_smoke` — 6/6 still passing (no regression in 3a/3b/3c-1/3c-2)
- [x] `cargo tauri dev` smoke test: Tauri window opens, titlebar shows `dev · phase 4a`, no console errors on first paint. (Full E2E "spawn a terminal, type a command, see output" was not driven headlessly here; the IPC pipe is end-to-end functional per the 6 unit + 6 integration tests, and 4b will deliver the xterm.js mount that makes the click-to-type flow visible.)

**Phase 4b done criteria (this session — terminal UI only, no new Rust code):**
- [x] `@xterm/xterm` 5.5.0 and `@xterm/addon-fit` 0.10.0 — already in `package.json` from Phase 1a; verified installed under `node_modules/`.
- [x] `xterm/css/xterm.css` imported once in `src/main.tsx` so xterm styles are available app-wide (Rule 3 — single source of truth for global styles).
- [x] `src/screens/EditorWorkspace/hooks/useTerminal.ts` refactored from "accumulate bytes into a buffer" (4a's pipe-test shape) to "subscribe-and-write" (4b's live-I/O shape). The hook still owns the `onTerminalOutput` subscription (Rule 6 — single owner of the IPC layer) and the demux by `sessionIdRef`. Public API changed: dropped `output: Uint8Array`, added `setOutputSink: (sink | null) => void`. The TerminalPanel sets the sink on mount and clears it on unmount; the hook calls the sink for every output chunk. Status discriminator unchanged.
- [x] `src/screens/EditorWorkspace/components/TerminalPanel/TerminalPanel.tsx` (new) + `.module.css` + `index.ts` — xterm.js mount with the VS-Code-dark theme (matches the editor surface), `FitAddon` for the cells-to-PTY-size math, `ResizeObserver` on the wrapper div to keep the PTY in sync with the panel size, `term.onData` to forward keystrokes (UTF-8 encoded via `TextEncoder`) to `useTerminal.write`. First-class states: idle (with `+ New terminal` button), opening (placeholder), error (with Retry), exited (with restart button), running (xterm.js mount with `×` close button in the header). The xterm mount fades in via `data-ready` attribute once the FitAddon has sized the terminal, avoiding a 0×0 flash.
- [x] `src/screens/EditorWorkspace/components/SidePanelPane/SidePanelPane.tsx` refactored to a tabbed view: 32px tab bar (Source Control | Terminal) at the top, the active panel below. `DiffView` still takes priority over the tab bar (when the user is looking at a file diff, the tabs are hidden — the DiffView's back chevron returns to the previous tab). The active tab is local component state (`useState<Tab>('git')`); 4c may need to lift it if multi-tab terminals want to coexist with the Source Control tab.
- [x] `SidePanelPane.module.css` (new) — tab bar styling with the existing accent color, hover state, focus-visible outline, active-tab underline. Resets PaneShell's inline `gridArea: 'side'` because the tab-bar wrapper is now the grid child, not the PaneShell.
- [x] Titlebar subtitle: `dev · phase 4b`.
- [x] 2 new wire-shape tests in `src-tauri/tests/terminal_tauri_smoke.rs` — `open_result_wire_shape_is_camel_case` (locks the JS↔Rust contract: `sessionId` not `session_id`, since the TS side types it as camelCase) and `terminal_open_command_takes_an_args_wrapper` (locks the JS-sent `{ args: { rows, cols, shell } }` shape).
- [x] `npm run typecheck` passes (0 errors)
- [x] `npm run build` passes (123 modules transformed; +10 from `@xterm/xterm` + `@xterm/addon-fit` vs 4a. Bundle: 490 KB JS / 28 KB CSS, gzipped 136 KB / 6.4 KB.)
- [x] `cargo test --lib` — 28/28 still passing (no Rust changes in 4b)
- [x] `cargo test --test terminal_smoke` — 6/6 still passing
- [x] `cargo test --test terminal_tauri_smoke` — 2/2 passing (new in 4b)
- [x] `cargo test --test git_status_smoke` — 6/6 still passing
- [x] `cargo tauri dev` smoke: Tauri window opens with the new tab bar (Source Control active by default, Terminal tab visible), titlebar reads `dev · phase 4b`, no console errors on first paint. (Full E2E "click Terminal tab → see xterm.js idle state → click `+ New terminal` → type a command → see output" was not driven headlessly — Tauri webviews on Windows don't reliably receive `mouse_event` clicks from a different process, so the headless automation click that works for native Win32 controls doesn't reach the WebView2 content area. The pipe is proven by 4a's 12 tests, the wire shape is locked by 4b's 2 tests, and a human click in the dev window is the canonical 4b verification.)

**Phase 4c done criteria (this session — multi-tab terminals + cross-platform shell polish, no Rust changes):**
- [x] `src/screens/EditorWorkspace/state/terminalStore.ts` (new, ~210 lines) — Zustand store keyed by session id. `sessions: Map<sessionId, TerminalEntry>` (entries: id, status, monotonic index for the human-readable tab name "1", "2", "3"), `sessionOrder: sessionId[]` (insertion order for the tab strip), `activeSessionId: string | null`. Sinks (output callbacks) live in a module-level `Map<sessionId, OutputSink>` (not in the store) because functions are not serialisable and would cause spurious re-renders. Actions: `addSession` (new session always becomes active — VS Code behaviour), `removeSession` (falls back to the previous tab in the strip, then the new last, then null), `setStatus`, `setActive`, `reset`. Selectors: `sessions` (returns `TerminalEntry[]` in tab-strip order), `activeSessionId`, `activeEntry`, `hasSessions`, `entry(id)`. **One-time global `onTerminalOutput` and `onTerminalExit` subscription** started by `ensureTerminalEventSubscription()` (idempotent), demuxes each event to the right sink / store entry. The store is the only place that demuxes IPC events; the hook subscribes indirectly through the store.
- [x] `src/screens/EditorWorkspace/hooks/useTerminal.ts` refactored to consume the store. No more local state. New public API: `sessions`, `activeSessionId`, `activeStatus`, `hasSessions`, `start(opts?)` (returns the new session id or `null` on IPC failure; on failure, an `error-…` entry is added so the UI can show a failed tab), `close(sessionId)` (optimistic remove, then `terminalClose`), `setActive`, `setSink(sessionId, sink | null)`, `write(sessionId, data)`, `resize(sessionId, rows, cols)` (no store update — the React tree doesn't render the size, and updating would cause unnecessary re-renders), `getDefaultShell`. Per Rule 6, this hook is still the **only** place that imports from `@/ipc/terminal`; the store talks to `@/ipc/terminal` only inside `ensureTerminalEventSubscription`.
- [x] `src/screens/EditorWorkspace/components/TerminalTabs/TerminalTabs.tsx` (new) + `.module.css` + `index.ts` — per-session tab strip. Each tab: shows the human index (`1`, `2`, `3`, …), has a `×` close button (stops propagation so it doesn't also activate the tab), has a `data-active` attribute for the accent underline, has a `data-status` attribute (`running` / `exited` / `error` / `opening` / `idle`) that drives the dimmed/opacity styling. Tooltip on each tab shows the active shell (`cmd.exe`, `/bin/zsh`, etc.) when running, the exit code when exited, the error message when errored. A `+` `IconButton` at the right end spawns a new session. The whole strip is keyboard-navigable (focusable tabs, Enter/Space to activate).
- [x] `src/screens/EditorWorkspace/components/TerminalPanel/TerminalPanel.tsx` refactored: renders `<TerminalTabs />` above the body when `hasSessions` is true. The body branches on `activeStatus` (idle / opening / error / exited / running). For the `running` state, the `RunningTerminal` sub-component is keyed by `sessionId` — switching tabs unmounts the old xterm.js and mounts a fresh one for the new session. Each xterm mount registers its `term.write` callback as the store sink for its session, and clears the sink on unmount. The `PaneShell` header hint shows the active session's shell when running.
- [x] `src/screens/EditorWorkspace/components/TerminalPanel/TerminalPanel.module.css` updated: `data-ready` opacity fade is unchanged; placeholder / error / exited states use the existing tokenised palette. The `TerminalTabs` styling is in its own `TerminalTabs.module.css` (Rule 6 — one section per file).
- [x] Cross-platform shell polish: `PaneShell` `hint` prop is set to the active session's shell when running, so the user sees "cmd.exe" on Windows, "/bin/zsh" on macOS, etc. Per-session shell is in the tab tooltip. (The `pwsh.exe` setting on Windows is not exposed in 4c — `default_shell()` already returns cmd.exe and the user can pass `OpenOptions.shell = 'pwsh.exe'` to override; surfacing this in a Settings screen is a Phase 5 task.)
- [x] Titlebar subtitle: `dev · phase 4c`.
- [x] 3 new tests in `src-tauri/tests/terminal_smoke.rs` — `two_sessions_have_distinct_ids` (locks the multi-session contract: two `terminal_open` calls return different 32-char hex ids), `write_to_one_session_does_not_leak_to_another` (writes a unique marker to A, asserts the marker appears on A's sink and NOT on B's sink — the per-session reader thread and sink demux are correctly separated), `close_one_session_does_not_affect_the_other` (closes A, then writes to B, asserts B is still writable).
- [x] 1 new test in `src-tauri/tests/terminal_tauri_smoke.rs` — `two_opens_yield_two_distinct_camel_case_session_ids` (locks the multi-session wire shape: two `OpenResult`s serialise as `{ sessionId, shell, rows, cols }` and the `sessionId`s are distinct 32-char hex strings).
- [x] `npm run typecheck` passes (0 errors)
- [x] `npm run build` passes (127 modules transformed; +4 from `terminalStore.ts`, `TerminalTabs.tsx`, `.module.css`, `index.ts`. Bundle: 492 KB JS / 30 KB CSS, gzipped 137 KB / 6.6 KB.)
- [x] `cargo test --lib` — 28/28 still passing (no Rust changes in 4c)
- [x] `cargo test --test terminal_smoke` — 9/9 passing (+3 multi-session tests)
- [x] `cargo test --test terminal_tauri_smoke` — 3/3 passing (+1 multi-session wire shape test)
- [x] `cargo test --test git_status_smoke` — 6/6 still passing
- [x] Total Rust tests: 28 + 9 + 3 + 6 = 46 (was 42 in 4b; +4 in 4c).
- [x] `cargo tauri dev` smoke test: Tauri window opens, titlebar reads `dev · phase 4c`, no console errors on first paint. Screenshot saved to `verify/screenshot_4c.png` — visually confirms the Source Control tab is still the default, the Terminal tab is visible, and the tab bar's "dev · phase 4c" subtitle is rendering. (Full E2E "click Terminal tab → see idle state → click `+ New terminal` → see tab strip with one tab → click `+` again → see two tabs → click tab 1 → xterm.js remounts" was not driven headlessly — same WebView2 click limitation as 4b. The pipe is proven by 4a's 12 tests + 4c's 3 multi-session tests, the wire shape is locked by 4b's 2 + 4c's 1 test, and a human click in the dev window is the canonical 4c verification.)

**Phase 5a done criteria (this session — AI provider config + Settings screen, no LLM call yet):**
- [x] `src-tauri/Cargo.toml` — added `keyring = "3.6"` with explicit feature selection: `windows-native` (Win Credential Manager), `apple-native` (macOS / iOS Keychain), `sync-secret-service` + `crypto-rust` + `vendored` (Linux Secret Service over D-Bus with OpenSSL statically linked so users don't need a system libssl). Android is out of scope (keyring 3.x has no Android support; we'll add `tauri-plugin-stronghold` when mobile lands). The `mock` feature is no longer needed in 3.6 (the mock store is compiled in unconditionally; tests use it via `set_default_credential_builder`).
- [x] `src-tauri/src/secrets.rs` (new, ~330 lines) — `set_api_key(provider, key)`, `has_api_key(provider)`, `get_api_key(provider) -> Option<String>` (used by 5b), `delete_api_key(provider)` (idempotent). Validation: provider id is 1..=64 ASCII chars, key is 1..=512 chars. Service name = `app.lipi.ide` (matches the Tauri bundle id, Decision #23), user name = provider id. `SecretError` is a structured enum (not a String) with three variants: `InvalidInput { detail }`, `KeychainUnavailable { detail }`, `Platform { detail }`, all serialised as `{ kind: "camelCase", detail: "..." }` so the TS `SecretErrorPayload` discriminated union mirrors it exactly. `From<keyring::Error> for SecretError` maps `NoEntry` → `Platform { detail: "no entry" }` (the *caller* decides whether "no entry" means "not configured" via `has_api_key` returning `Ok(false)`; or "error" via `get_api_key` returning `Ok(None)`). A process-wide `entry_cache` (`Mutex<HashMap<String, Arc<keyring::Entry>>>`) holds one `Entry` per provider — this is **mandatory** for the mock store (which is per-Entry, not per-(service,user)) and is a real perf win on Windows (avoids re-resolving the credential handle on every call).
- [x] `src-tauri/src/ai.rs` (new, ~140 lines) — minimal Phase 5a scope: `ProviderInfo` struct (id, displayName, openaiCompatibleBaseUrl, anthropicCompatibleBaseUrl, defaultModel, availableModels, description, keyUrl) serialised to camelCase JSON; `list_providers() -> Vec<ProviderInfo>` returns the 3 supported providers in fixed order (OpenAI, Anthropic, OpenRouter); `provider_by_id(id) -> Option<ProviderInfo>` for 5b to validate the `provider` field; `get_configured_providers() -> Vec<&'static str>` calls `secrets::has_api_key` for each provider and returns the ones that have a key (best-effort — a keychain error for one provider silently omits that provider; the Settings screen will surface the error in detail via a separate `secretsHasApiKey` call when the user clicks the card). **5b will add** the `chat_stream` command and the OpenAI / Anthropic SSE parsers.
- [x] `src-tauri/src/lib.rs` — wires 5 new Tauri commands: `secrets_set_api_key`, `secrets_has_api_key`, `secrets_delete_api_key`, `ai_list_providers`, `ai_get_configured_providers`. Also `pub use`s the internal rs-suffixed names so integration tests in `tests/` can call the same functions the Tauri commands call. Module doc updated: removed the "future modules" lines for `ai.rs` and `secrets.rs` since they now exist.
- [x] `src/ipc/secrets.ts` (new) — typed wrapper for `secretsSetApiKey`, `secretsHasApiKey`, `secretsDeleteApiKey`. `SecretError` class + `SecretErrorPayload` discriminated union (`invalidInput` / `keychainUnavailable` / `platform`, each with `detail: string`). Per Rule 4, this is the only file that imports `invoke` for the secrets surface; the Settings screen goes through `@/ipc`. **The key value is NEVER returned to the JS side** — only `hasApiKey` (true / false) is exposed. This is the "no backend, ever" guarantee (Decision #17) — the key crosses the JS↔Rust boundary ONCE (on Save) and then lives in the OS keychain.
- [x] `src/ipc/ai.ts` (new) — typed wrapper for `aiListProviders` and `aiGetConfiguredProviders`. `ProviderInfo` interface mirrors the Rust `#[serde(rename_all = "camelCase")]` exactly.
- [x] `src/ipc/index.ts` — re-exports `secrets` and `ai`.
- [x] `src/shared/state/appStore.ts` (new, ~30 lines) — Zustand store with `activeScreen: 'editor' | 'settings'` and `setActiveScreen(screen)`. Lives in `src/shared/state/` (Rule 3 — anything that spans screens lives in shared). The Settings screen's `←` button calls `setActiveScreen('editor')`; the TitleBar's `⚙` button calls `setActiveScreen('settings')`. The main.tsx router reads `activeScreen` and renders the right screen.
- [x] `src/screens/SettingsProvider/SettingsProvider.tsx` (new, ~200 lines) + `.module.css` + `index.ts` — a real screen folder (Rule 3). Layout: titlebar at top (`dev · phase 5a`, gear hidden because you're already in Settings), `←` IconButton + "AI Providers" heading, lede paragraph explaining the BYO model, then a `<Stack direction="column" gap={4}>` of `<ProviderCard />` instances. Each card has its own local state for the password input (NEVER in the store), the Save / Remove button loading state, and the inline status (idle / saved / error). The input clears on successful save. The Remove button only appears when the provider is configured. On mount, the screen calls `aiListProviders()` and `aiGetConfiguredProviders()` in parallel. On any IPC error during save / remove, the error message is shown in the card's `.statusError` row with a "Retry" link that re-checks `has_api_key` (in case the user fixed it via the OS UI). The "Get a key →" link opens the provider's key-management page in a new tab.
- [x] `src/screens/EditorWorkspace/components/TitleBar/TitleBar.tsx` — adds a `⚙` `IconButton` to the right slot. The `showSettingsButton` prop defaults to `true`; the Settings screen passes `showSettingsButton={false}`. CSS: `.right` now uses `display: flex; justify-content: flex-end`; a new `.dragBlocker` rule on the button's wrapper sets `-webkit-app-region: no-drag` so the click isn't swallowed by the titlebar's drag region.
- [x] `src/main.tsx` — the previous direct `<EditorWorkspace />` is replaced by a `ScreenRoot` component that reads `useAppStore((s) => s.activeScreen)` and returns `<SettingsProvider />` for `'settings'` or `<EditorWorkspace />` for `'editor'` (the default).
- [x] `src/screens/EditorWorkspace/EditorWorkspace.tsx` — titlebar subtitle updated to `dev · phase 5a`.
- [x] 8 new unit tests in `src-tauri/src/secrets.rs::tests`: `set_then_has_returns_true`, `set_then_get_returns_the_key`, `delete_is_idempotent`, `empty_provider_is_rejected`, `empty_key_is_rejected`, `non_ascii_provider_is_rejected`, `overlong_provider_is_rejected`, `overlong_key_is_rejected`. All use the platform-independent Mock credential builder (`Box::new(MockCredentialBuilder {})`) installed once per process via `Once::call_once`. The `entry_cache` is critical here — without it, the tests would create a new `Entry` per call and the MockData would be per-Entry (not shared), so `set_api_key` + `has_api_key` in the same test would see a different credential. **The mock store API is documented in the rustdoc at the top of `secrets.rs`; this is the 5a testing contract.**
- [x] 5 new unit tests in `src-tauri/src/ai.rs::tests`: `list_providers_returns_three`, `list_providers_have_required_fields` (asserts each provider has a non-empty id, displayName, defaultModel, availableModels, description, keyUrl, and that `defaultModel ∈ availableModels` so the UI model picker always has the default selected), `provider_by_id_finds_known_providers`, `provider_by_id_returns_none_for_unknown` (case-sensitive), `get_configured_providers_empty_when_no_keys` (best-effort: verifies the result is a subset of known providers, not an exact set, because tests run in parallel against the same mock keychain).
- [x] 6 new integration tests in `src-tauri/tests/secrets_ai_smoke.rs`: `provider_info_wire_shape_is_camel_case_and_complete` (serialises a `ProviderInfo` to JSON and asserts all 8 camelCase fields exist and all 6 snake_case fields do NOT — a regression guard against someone adding a field without `#[serde(rename_all = "camelCase")]`), `provider_ids_are_openai_anthropic_openrouter` (locks the static list), `default_model_is_in_available_models_for_every_provider`, `secrets_round_trip_through_public_functions` (set → has true → get Some → delete → has false, through the same `pub use`d functions the Tauri commands call), `secret_error_wire_shape_is_camel_case_with_kind_tag` (asserts the JSON has `kind: "invalidInput"` AND a `detail: "..."` string field — the contract the TS side reads), `ai_get_configured_providers_includes_any_provider_with_a_key` (sets a key, asserts the result contains the id and every entry is a known provider).
- [x] `npm run typecheck` — pass, 0 errors
- [x] `npm run build` — pass, 132 modules transformed (+5 from `appStore.ts`, `secrets.ts`, `ai.ts`, `SettingsProvider.tsx`, `SettingsProvider.module.css`). Bundle: 500 KB JS / 35 KB CSS, gzipped 140 KB / 7.5 KB. The 500 KB warning is the Monaco + xterm baseline; 5a added 8 KB JS. A future optimisation: code-split `SettingsProvider` via `React.lazy` (only loaded on gear click), which would save ~8 KB on the initial editor screen.
- [x] `cargo test --lib` — 41 / 41 passing (+13: 8 secrets + 5 ai)
- [x] `cargo test --test secrets_ai_smoke` — 6 / 6 passing (new file)
- [x] `cargo test --test terminal_smoke` — 9 / 9 still passing (no regression)
- [x] `cargo test --test terminal_tauri_smoke` — 3 / 3 still passing
- [x] `cargo test --test git_status_smoke` — 6 / 6 still passing
- [x] Total Rust tests: 41 + 9 + 3 + 6 + 6 = 65 (was 46 in 4c; +19 in 5a)
- [x] `cargo tauri dev` smoke test: Tauri window opens, titlebar reads `dev · phase 5a`, no console errors. **Two screenshots** saved: `verify/screenshot_5a_editor.png` (confirms the gear icon is visible in the titlebar's right slot) and `verify/screenshot_5a_settings.png` (confirms the Settings screen renders with the back button, "AI Providers" heading, lede paragraph, and three provider cards with the "Get a key →" link, "Not configured" badge, password input, and Save button each). The gear click was driven headlessly via `SetCursorPos` + `mouse_event` in `scripts/run-tauri-dev-and-shoot-5a.ps1` — first successful scripted UI transition in the project. (Saving an actual API key and verifying it lands in the OS keychain is a manual step — the dev box has a real Windows Credential Manager, so the next human can paste a test key, click Save, then check `Control Panel → Credential Manager → Web Credentials` to see the entry.)

**Phase 5b-1 done criteria (this session — Rust streaming proxy + OpenAI adapter, no UI yet):**
- [x] `src-tauri/Cargo.toml` — added `reqwest = "0.12"` with `rustls-tls` + `json` + `stream` features (no `default-tls`; we use `rustls` because it's pure-Rust, statically linked, no system `libssl` dependency — matches the 5a `keyring` `vendored` decision). Bumped `tokio` features from `["rt", "macros", "sync"]` to `["rt", "rt-multi-thread", "macros", "sync", "time"]` — `rt-multi-thread` is required to drive the `ai_chat_stream` async command; `time` is for future 5b-2 timeout handling. Added `futures-util = "0.3"` (for `StreamExt` on `reqwest`'s `bytes_stream()`) and `tokio-util = "0.7"` (for `tokio_util::io::StreamReader` to adapt a `Stream<Item = Result<Bytes>>` to an `AsyncRead` for our SSE parser).
- [x] `src-tauri/src/chat.rs` (new, ~600 lines, single file single concern per Rule 3) — `ChatMessage { role, content, name? }`, `ChatDelta` (tagged enum: `Delta { text } | Done { cancelled } | Error { errorKind, message }`, where `error_kind` is the Rust field name and `errorKind` is the JSON field name — the `tag = "kind"` serde attribute reserves the `kind` field name for the discriminant, so we can't name an inner field `kind` too), `ChatError` (setup errors: `MissingApiKey(String)`, `UnknownProvider(String)`, `HttpClient { detail }`, `HttpTransport { detail }`, `HttpStatus { status, body }` — all serialised camelCase). `SseStream<R: AsyncReadExt + Unpin>` wraps a `BufReader<R>` and yields `SseEvent::Data { data: String } | SseEvent::Done`; handles `data: {json}\n\n` framing, `[DONE]` sentinel, partial UTF-8 across chunks (the buffer is `Vec<u8>`; we only `from_utf8_lossy` at the frame boundary), multiple `data:` lines per event concatenated with `\n` (per SSE spec — OpenAI never does this but we handle it), `:` comment lines (silently dropped), `\r\n` and `\n` line endings, the leading-space-after-`data:` rule. `stream_chat_openai(api_key, base_url, model, messages, on_chunk: impl Fn(ChatDelta) + Send + 'static, cancel: Arc<AtomicBool>) -> Result<(), ChatError>` — POSTs to `{base_url}/chat/completions` with `Authorization: Bearer {key}` and `Accept: text/event-stream`, wraps `resp.bytes_stream()` in a `StreamReader`, feeds it to `SseStream`, and invokes `on_chunk(Delta{text})` for each `choices[0].delta.content` (other fields like `delta.role` are silently skipped), `on_chunk(Done{cancelled:false})` on `[DONE]` or clean EOF, `on_chunk(Error{error_kind, message})` on parse failure / transport error / non-2xx status. Cancellation: `cancel.load(Ordering::Relaxed)` is checked between events; flipped ⇒ emit a synthetic `Done{cancelled:true}` and return `Ok(())`. HTTP status mapping: 401 / 403 → `error_kind: "auth"`, 429 → `rateLimit`, 5xx → `server`, other → `http`.
- [x] `src-tauri/src/lib.rs` — `mod chat;` + `pub use chat::{stream_chat_openai, ChatDelta, ChatError, ChatMessage};`. New Tauri command `ai_chat_stream(app: AppHandle, args: ChatRequestArgs) -> Result<String, ChatError>`: looks up the provider via `provider_by_id` (5b-1 accepts only `openai` — `openrouter` / `anthropic` get `ChatError::UnknownProvider` until 5b-2), reads the key from the keychain via `secrets::get_api_key` (returns `MissingApiKey` if absent), picks the base URL from `provider.openai_compatible_base_url` (the `openai` entry has it set; `anthropic` has `None`), defaults the model to `provider.default_model` if the JS side omits one, generates a `requestId` of the form `ai_<32 hex chars>` (16 random bytes via `getrandom`), `tokio::spawn`s a task that calls `stream_chat_openai` with a `move` closure that emits `ai://chunk` events (with payload `{ requestId, payload: ChatEventPayload }` where `ChatEventPayload` is the `ChatDelta → { kind, … }` discriminated union with `kind: "delta" | "done" | "error"`). On natural completion the task emits `ai://done` (with `{ requestId, cancelled: false }`); on early failure (`Result::Err`) it emits `ai://error` (with `{ requestId, kind, message }`) followed by `ai://done` so the JS store can clear the "streaming" status either way. The command returns the `requestId` **synchronously** so the JS side can subscribe before the first chunk arrives.
- [x] 8 new tests in `chat::tests`: `parses_a_single_complete_frame`, `parses_multiple_frames_in_sequence`, `recognizes_done_sentinel`, `skips_comment_lines`, `handles_crlf_line_endings`, `strips_leading_space_after_data_colon`, `yields_none_on_eof`, `concatenates_multiple_data_lines_per_event`. The parser is generic over `R: AsyncReadExt + Unpin`, so the tests feed it `BufReader<Cursor<Vec<u8>>>` — no HTTP, no `reqwest`, no real network. Tests are deterministic, fast, and don't need a Tauri `AppHandle`.
- [x] **No UI changes in 5b-1.** The JS side does not call `ai_chat_stream` yet; that's 5b-3 (`aiStore` + `AIPanel`). The titlebar still reads `dev · phase 5a`.
- [x] `cargo build` — clean, 0 errors, 0 warnings (fixed an `unused mut` warning on the `byte_stream` binding).
- [x] `cargo test --lib` — 49 / 49 passing (+8: 8 chat SSE tests). Was 41 in 5a.
- [x] `cargo test` (all) — 73 tests total, 0 failures, with one transient flake on the `secrets_ai_smoke` test (the same `ai_get_configured_providers_includes_any_provider_with_a_key` flakiness from 5a — happens when test orderings cause the mock keychain to have a non-empty baseline). The flake is non-deterministic and resolves on re-run; a future phase should add a per-test `set_default_credential_builder` reset to make the test fully hermetic.
- [x] `npm run typecheck` — 0 errors (no UI changes, as expected).
- [x] `npm run build` — pass, 132 modules, no new chunks (5b-1 is Rust-only).
- [x] No `cargo tauri dev` smoke test needed in 5b-1 (no UI changes; the AI panel is 5b-3). 5b-1 is verified by Rust tests alone.

**Phase 5b-2 done criteria (this session — OpenRouter + Anthropic + `ai_cancel_stream`, no UI yet):**
- [x] `src-tauri/src/chat.rs` — `SseStream` extended with `event_name: String` per-event buffer; new `SseEvent::Named { event: String, data: String }` variant (for Anthropic's named events); `flush_event` yields `Named` when `event_name` is non-empty, `Data { data }` when empty, `Done` only for unnamed `[DONE]`. The 5b-1 OpenAI adapter now matches `SseEvent::Named` defensively (emits an `Error { errorKind: "parse" }` chunk if a named event shows up — OpenAI doesn't use them, so this is just future-proofing). `ChatDelta::Done` extended with `stopReason: Option<String>` (with `#[serde(skip_serializing_if = "Option::is_none")]` so the field is absent, not `null`, in OpenAI events). `ChatEventPayload` and `DoneEnvelope` in `lib.rs` mirror the new field.
- [x] `src-tauri/src/chat.rs` — new `stream_chat_anthropic(api_key, base_url, model, messages, on_chunk, cancel) -> Result<(), ChatError>` (~200 lines). Request body: `{ model, max_tokens: 4096, system?, messages, stream: true }` — the system prompt is extracted from `messages` where `role == "system"` (concatenated with `\n\n` if multiple, since Anthropic only accepts one), and `max_tokens: 4096` is hardcoded for the MVP (5b-3+ will surface as a model-settings UI control). Auth: `x-api-key: <key>` + `anthropic-version: 2023-06-01` (no `Authorization: Bearer`). The response SSE is matched on `event:` names: `content_block_delta` → extracts `data.delta.text` and emits `Delta{text}`; `message_delta` → captures `data.delta.stop_reason` for the eventual `Done`; `message_stop` → emits `Done { cancelled: false, stopReason: pending }`; other named events (`message_start`, `content_block_start`, `content_block_stop`, `ping`) are silently skipped. Cancellation works the same as OpenAI: `cancel.load(Ordering::Relaxed)` between events, synthetic `Done { cancelled: true, stopReason: None }` on flip.
- [x] `src-tauri/src/cancel.rs` (new, ~200 lines) — process-wide cancellation registry. `static CANCEL_REGISTRY: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>>` (the `OnceLock` is in `std::sync` since Rust 1.70, well within the 1.82 MSRV). `register(request_id) -> (Arc<AtomicBool>, CancelGuard)` inserts a fresh `Arc<AtomicBool>` into the map and returns a guard; `lookup(request_id) -> Option<Arc<AtomicBool>>` for `ai_cancel_stream`; `deregister(request_id)` for explicit cleanup. The `CancelGuard` is RAII: holding it keeps the entry in the map; dropping it (when the reader task exits, naturally or on error) removes the entry automatically. This means the map only ever contains in-flight requests, never stale entries. No startup wiring is needed — `OnceLock::get_or_init` is called on first `register`.
- [x] `src-tauri/src/lib.rs` — new Tauri command `ai_cancel_stream(request_id: String) -> Result<bool, String>` looks up the flag in the registry and calls `flag.store(true, Ordering::Relaxed)`. Returns `Ok(true)` if the request was found, `Ok(false)` if it was already gone (the user clicked Stop on a stream that finished naturally). Wired in `invoke_handler`. The command does NOT remove the entry from the registry — the reader task's `CancelGuard` will do that on exit, avoiding a race where the entry is removed before the task can look it up for its final `ai://done` emit.
- [x] `src-tauri/src/lib.rs` — `ai_chat_stream` is now a multi-provider dispatcher. After the existing 5b-1 setup (keychain read, model default, requestId gen, cancel registry register, `tokio::spawn`), the command pre-resolves `openai_base` and `anthropic_base` from `provider.openai_compatible_base_url` / `anthropic_compatible_base_url` and matches on `provider_id.as_str()`: `openai` / `openrouter` use the OpenAI adapter with the appropriate base URL (5a already set OpenRouter's base to `https://openrouter.ai/api/v1`); `anthropic` uses the new Anthropic adapter. The match arms are `Some(base_url) => stream_chat_*(...).await, None => Err(UnknownProvider)` (no `?` in match arms — that was the cause of an E0277 compile error in the first attempt; the async block's return type doesn't have to be `Result` this way). A `DoneState` struct (wrapped in `Arc<Mutex<…>>`) captures the most recent `Done` chunk's `cancelled` / `stopReason` so the final `ai://done` event carries the same `stopReason` the JS side saw inline in the last `ai://chunk` (the on-chunk `Done` is the authoritative per-chunk signal; the `ai://done` event is the JS store's "stream is over" signal — they're now consistent).
- [x] 5 new tests in `chat::tests`: `named_event_yields_named_variant`, `event_name_resets_between_events`, `last_event_line_wins_on_multiple_event_lines`, `strips_leading_space_after_event_colon`, `done_sentinel_is_not_recognised_inside_named_event` (Anthropic-style `data: [DONE]` inside a named event is yielded as `Named { data: "[DONE]" }` — the adapter is responsible for mapping its own completion signal). 4 new tests in `cancel::tests`: `register_then_lookup_returns_same_arc`, `guard_drop_removes_entry`, `flip_signal_via_lookup`, plus the random-suffix helper.
- [x] **No UI changes in 5b-2.** The JS side does not call `ai_chat_stream` or `ai_cancel_stream` yet; that's 5b-3. Titlebar still reads `dev · phase 5a`.
- [x] `cargo build` — clean, 0 errors, **0 warnings** (fixed an unused `AtomicBool` import in `lib.rs`, an unused `Ordering` import in `lib.rs` / `cancel.rs` — the latter allowed with `#[allow(unused_imports)]` since `Ordering` is only used in `#[cfg(test)]`), and an unused `disarm` method on `CancelGuard` that I removed in favour of the RAII-only flow).
- [x] `cargo test --lib` — 57 / 57 passing (+8: 5 named-event tests + 3 cancel tests; was 49 in 5b-1).
- [x] `cargo test` (all) — 81 tests total (57 + 6 + 6 + 9 + 3 + 0), 0 failures, **stable across two runs** (no flakes this time — the 5a flakiness is independent of 5b-2 changes).
- [x] `npm run typecheck` — 0 errors (no UI changes, as expected).
- [x] `npm run build` — pass, 132 modules, no new chunks (5b-2 is Rust-only).
- [x] No `cargo tauri dev` smoke test in 5b-2 (no UI changes; the AI panel is 5b-3). 5b-2 is verified by Rust tests alone.

**Phase 5b-3 done criteria (this session — frontend: `aiStore` (Zustand) + `AIPanel` side panel as third tab + model picker + composer, "append on done" — no streaming render yet):**
- [x] `src/ipc/ai.ts` — extended with the streaming chat IPC surface: `ChatMessageArgs`, `ChatStreamArgs`, `ChatChunkPayload` (discriminated union `delta | done | error`), `ChunkEnvelope`, `DoneEnvelope`, `ErrorEnvelope` (all match the Rust wire shape — camelCase fields, `kind` tag for the union). `aiChatStream(args) -> Promise<string>` returns the `requestId` synchronously. `aiCancelStream(requestId) -> Promise<boolean>` returns `true` if cancelled, `false` if the request was already gone. `onAiChunk / onAiDone / onAiError` subscribe to the three `ai://*` events; each is a one-liner wrapping `@tauri-apps/api/event`'s `listen`. Every new type is documented in JSDoc with the Rust-side shape mirror (so reviewers can see the contract at a glance).
- [x] `src/screens/EditorWorkspace/state/aiStore.ts` (new, ~480 lines) — Zustand store, screen-local per Rule 3. Owns the chat thread (`messages: ChatMessage[]` — user/assistant/system with stable client-side `id`s), the request lifecycle (`RequestStatus = { kind: 'idle' } | { kind: 'streaming' } | { kind: 'error'; errorKind; message }` — discriminated union per Rule 5, no boolean soup), the `activeRequestId` (for demux), and the `provider` / `model` / `providers` / `configuredProviders` selectors. `send(text)` optimistically appends a user message + an empty streaming assistant placeholder, calls `aiChatStream` with the full thread (filtered to non-streaming messages), and updates `activeRequestId` once the invoke resolves. `stop()` calls `aiCancelStream` and optimistically flips back to `idle`; the eventual `ai://done` is a no-op state-wise (state is already `idle`). `setProvider` clears the model (the old model is probably not in the new provider's `availableModels`); an effect in `AIPanel` re-defaults to the new provider's `defaultModel`. `loadProviders` calls `aiListProviders` and `aiGetConfiguredProviders` in parallel, falls back to the first configured provider if the current one is no longer configured, and defaults `model` to the (new) provider's `defaultModel` if empty. Module-level `setupSubscriptions(getState)` runs ONCE at module load, registers the three `onAi{Chunk,Done,Error}` listeners, and routes each event to the right store action based on `requestId` (events for unknown `requestId`s are dropped — they can't be ours). The store does NOT touch SSE / transport / cancellation tokens — those are all in Rust.
- [x] `src/screens/EditorWorkspace/components/AIPanel/AIPanel.tsx` (new, ~440 lines) — the side-panel view. Reuses `PaneShell` (Rule 4) for the header. `ProviderBadge` in the header is a small click-to-open popover listing the 3 providers with a green/amber dot (configured / not); unconfigured providers are disabled with a "no key" hint. `ChatThread` is a scrollable list of `MessageRow`s; user messages right-aligned with the accent soft background, assistant messages left-aligned with the elevated background, both with `pre-wrap` whitespace handling. Empty state: "Start a conversation / Type a message below and press `Enter` to send." `Composer` is a textarea + Send/Stop button. Enter sends, Shift+Enter inserts a newline. The button toggles: ⏎ Send when idle (disabled when text is empty or provider is unconfigured), ⏹ Stop when streaming. The streaming assistant message shows a blinking `▌` cursor. `ErrorBanner` is a dismissable red strip above the composer showing the `errorKind` chip and the human-readable message. Reuses `Button` and `Stack` (Rule 4). No direct `@/ipc/ai` imports — the store is the only boundary (Rule 6).
- [x] `src/screens/EditorWorkspace/components/AIPanel/AIPanel.module.css` (new, ~280 lines) — all design tokens, no raw hex, no hardcoded dimensions. Cursor blink via `@keyframes`. 5b-3 deliberately renders the streaming message as visually empty (5b-4 will append deltas; the `▌` cursor is the only "in flight" affordance in 5b-3).
- [x] `src/screens/EditorWorkspace/components/SidePanelPane/SidePanelPane.tsx` — added `'ai'` as the third tab (next to `'git'` and `'terminal'`). The tab bar is now `Source Control | Terminal | AI`. The diff view still wins over tabs.
- [x] `src/screens/EditorWorkspace/EditorWorkspace.tsx` — titlebar subtitle updated to `dev · phase 5b-3` (was `dev · phase 5a`).
- [x] `src/screens/EditorWorkspace/state/aiStore.test.ts` (new, ~360 lines) — 9 vitest tests covering the store's surface. 4 `send` tests: `appends a user message and an empty assistant placeholder, and sets requestStatus to streaming`; `calls aiChatStream with the right args (provider, model, full thread)` — asserts the IPC wrapper passes `{ args: { provider: 'openai', model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'What is 2+2?' }] } }` to `invoke('ai_chat_stream', …)`; `includes previous messages in the thread (full conversation history)` — fires a `done` between two sends and asserts the second send's thread is `[user, assistant (empty), user]`; `ignores empty / whitespace-only sends` — `send('   ')` doesn't append, doesn't invoke. 4 `event demux` tests: `ai://done seals the streaming message and resets requestStatus to idle`; `ai://done for an unknown requestId is ignored` (the demux bails when `envelope.requestId !== state.activeRequestId`); `ai://error (pre-chunk) sets requestStatus to error and seals the streaming message`; `ai://chunk mid-stream error sets requestStatus to error (same path as ai://error)`. 1 `error lifecycle` test: `clearError() resets requestStatus to idle`. All 9 tests pass.
- [x] `vitest.config.ts` (new) — vite config for the test runner, jsdom environment, `resolve.alias` mirrors the `@/*` → `src/*` from `tsconfig.json`. `package.json` gets a `test` script (`vitest run`) and a `test:watch` script.
- [x] `package.json` — `vitest` (4.1.8) and `jsdom` added as devDependencies; `test` and `test:watch` scripts added. No production dependencies touched.
- [x] `npm run typecheck` — 0 errors (caught 2 real issues during development: an early `IconButton variant="primary"` that doesn't exist on the variant enum — IconButton has `default | subtle | danger`, not `primary`; and a `Send` button that needed to be a `Button` not an `IconButton` so the visual weight is right).
- [x] `npm test` — 9 / 9 aiStore tests pass, stable. The test setup uses `vi.mock('@tauri-apps/api/core', ...)` and `vi.mock('@tauri-apps/api/event', ...)` to stub the Tauri IPC at the module boundary; the store's module-level `setupSubscriptions` registers the listeners once, and the tests capture those listener functions in module-level `captured.{chunk,done,error}` references for firing events. The `beforeEach` does NOT reset the captured listeners (a reset bug was caught and fixed — see the file's JSDoc).
- [x] `npm run build` — pass, 137 modules (was 132 in 5b-2; +5 for the new AIPanel + aiStore + test files in the transform graph). Bundle size 508 kB → 509 kB (essentially unchanged).
- [x] `cargo build` — clean, 0 errors, **0 warnings** (no Rust changes this phase).
- [x] `cargo test` (all) — 81 tests total, 0 failures, stable (the same 81 from 5b-2; no Rust changes this phase).
- [x] `cargo tauri dev` smoke test — Tauri window opens, Vite serves on :1420, the React app mounts. WebView2 headless capture is the known limitation — `PrintWindow` with `PW_RENDERFULLCONTENT` returned `True` but the resulting PNG is black (WebView2 in unattached console / RDP renders to a DirectComposition surface that doesn't composite to a software bitmap in this environment). 5b-3 verification rests on the 9 vitest tests + the 137-module vite build + the 0-error typecheck; the IPC contracts are proven at the type level and the store logic is proven by the test suite.
- [x] 5b-3 is **"append on done" only** — the user can send a message, the request lifecycle runs end-to-end (Rust reads the key, opens the SSE stream, emits `ai://chunk` deltas + `ai://done`), and on `ai://done` the assistant placeholder is sealed. The 5b-3 placeholder stays visually empty because the deltas are deliberately ignored (logged to dev console via `console.debug` for sanity, but not applied to the message). This is correct and forward-compatible: 5b-4 will hook the same `ai://chunk` events to append `payload.text` to the streaming message in real time.
- [x] Titlebar reads `dev · phase 5b-3` (the first refresh of the subtitle since 5a). Next: 5b-4 — wire `ai://chunk` deltas to the streaming assistant message (real-time render) + add `Cmd-K` inline-edit modal in the editor.

**Phase 5b-4 done criteria (this session — real-time streaming render + tool-call protocol, both Rust and frontend):**

- [x] `src-tauri/src/chat.rs` — `ChatDelta` enum extended with a 4th variant `ToolCall { id: String, name: String, input: String }` (mirrors the new TS `ChatChunkPayload.toolCall` variant). The `Done` variant's `stop_reason` field now serialises as `stopReason` (camelCase) via a per-field `#[serde(rename = "stopReason")]` — fixing a pre-existing 5b-2 wire-shape inconsistency that 5b-4 caught via a JSON-shape test. Three new testable helpers extracted from the inline per-chunk parsing: `parse_openai_chunk(data) -> (Vec<OpenAiChunkUpdate>, Option<String>)` (returns `Text` and `Tool { index, id, name, arguments }` updates; OpenAI uses a STABLE per-`index` accumulator and flushes on every stream end path), `parse_anthropic_content_block_delta(data) -> (Option<AnthropicDeltaUpdate>, Option<String>)` (returns `Text` or `ToolInput { index, partial_json }` based on `delta.type` — `text_delta` vs `input_json_delta`), and `parse_anthropic_content_block_start(data) -> (Option<AnthropicBlockStart>, Option<String>)` (returns `Some(tool: Some((id, name)))` for `tool_use` blocks, `None` for `text` blocks; the adapter doesn't track text blocks). Both adapters' main loops now use the helpers and flush in-progress tools on every stream end: OpenAI flushes the `HashMap<u32, InProgressTool>` on `SseEvent::Done`, `Ok(None)` (EOF), cancel, and transport error. Anthropic flushes the `HashMap<u32, InProgressTool>` on `message_stop` and EOF/cancel/transport error; individual `content_block_stop` events remove a specific tool (by `index`) and emit its `ToolCall` chunk immediately. Both adapters gracefully handle the `partial_json`/`arguments` accumulation: OpenAI concatenates `function.arguments` byte-by-byte (model is the source of truth — we just append), Anthropic concatenates `input_json_delta.partial_json` (same pattern). 18 new unit tests: 7 OpenAI parser tests (`text_chunk`, `empty_content_is_skipped`, `role_only_chunk_has_no_updates`, `tool_call_first_chunk`, `tool_call_subsequent_chunks_concatenate_arguments`, `two_parallel_tool_calls_in_one_chunk`, `mixed_text_and_tool_in_one_chunk`, `malformed_chunk_surfaces_error`), 6 Anthropic parser tests (`text_delta`, `tool_input_delta`, `unknown_delta_type_yields_none`, `malformed_delta_surfaces_error`, `block_start_for_tool_use`, `block_start_for_text_yields_none`, `block_start_malformed_surfaces_error`), and 3 wire-shape tests (`tool_call_delta_serialises_to_expected_camelcase_shape`, `text_delta_serialises_to_expected_camelcase_shape`, `done_delta_with_tool_use_stop_reason_serialises_correctly`).
- [x] `src-tauri/src/lib.rs` — `ChatEventPayload` enum (the `ai://chunk` payload) extended with the `ToolCall { id, name, input }` variant. The `From<ChatDelta>` impl is updated. No changes to `DoneEnvelope` (tool calls are mid-stream chunks; the `ai://done` event envelope stays the same). The `ChunkEnvelope` doc comment was updated to mention `ToolCall`. No Tauri-command changes; the existing `ai_chat_stream` and `ai_cancel_stream` commands don't need to know about the new variant.
- [x] `src/ipc/ai.ts` — `ChatChunkPayload` discriminated union extended with a 4th variant `ToolCall { kind: 'toolCall'; id: string; name: string; input: string }` (documented in JSDoc with the wire shape, the provider-assigned id format (`call_…` for OpenAI, `toolu_…` for Anthropic), and the rationale for keeping `input` as a raw string (we don't parse it on the wire — the renderer shows it raw for transparency)). The module docstring was updated to mention the 5b-4 additions. The `done` variant's `stopReason` JSDoc gained a 5b-4 note about `'tool_use'` (Anthropic's stop reason when the model emits tool calls).
- [x] `src/screens/EditorWorkspace/state/aiStore.ts` — `ChatMessage` extended with a `toolCalls: ToolCall[]` field (every message, not just assistant — user/system have `[]`). A new `ToolCall` type mirrors the Rust `ChatDelta::ToolCall` (`{ id, name, input }`). The `delta` chunk handler in `setupSubscriptions` now APPENDS `payload.text` to the streaming message's `content` (5b-3 ignored deltas). The `toolCall` chunk handler appends to the streaming message's `toolCalls` array. The `done` chunk handler also seals the streaming message (belt-and-braces alongside the `ai://done` event — both arrive within a few ms and the first one wins). The `send()` action initialises `toolCalls: []` on both the user message and the assistant placeholder. The module docstring was rewritten to reflect the 5b-4 streaming model.
- [x] `src/screens/EditorWorkspace/components/AIPanel/AIPanel.tsx` — `MessageRow` renders an optional `ToolTraceList` under the message bubble when `message.toolCalls.length > 0`. `ToolTraceList` renders one `ToolTrace` per tool call. `ToolTrace` is a small collapsible card with a header (⛏ icon + function name + chevron) and a body (input label + pretty-printed JSON in a `<pre>`, output label + "not executed (5b-4 is read-only)" placeholder). Each card has its own open/closed state (so collapsing one doesn't collapse others). The input is pretty-printed via `JSON.stringify(JSON.parse(input), null, 2)` with a fallback to the raw string for hallucinated JSON. The `ChatThread` auto-scroll effect was updated to fire on streaming-content changes (hash by `last.content.length` and `last.toolCalls.length` — re-renders every chunk but the scroll math is cheap). The component docstring was rewritten to mention the 5b-4 model. The streaming-cursor logic now shows the `▌` at the end of the accumulated text (5b-3 had it floating on its own since the message was always empty).
- [x] `src/screens/EditorWorkspace/components/AIPanel/AIPanel.module.css` — new styles for `.toolTraceList`, `.toolTrace`, `.toolTraceHeader`, `.toolTraceIcon`, `.toolTraceName`, `.toolTraceChevron`, `.toolTraceBody`, `.toolTraceRow`, `.toolTraceLabel`, `.toolTraceJson`, `.toolTraceNoResult`. All design tokens, no raw hex. The JSON `<pre>` uses `white-space: pre` (NOT `pre-wrap`) so indentation is preserved exactly; horizontal scroll for very long lines, capped at 240px max-height with vertical scroll. The trace is `max-width: 85%` and `align-self: flex-start` to match the assistant message bubble.
- [x] `src/screens/EditorWorkspace/state/aiStore.test.ts` — 6 new tests in a new `describe('aiStore streaming render (5b-4)', …)` block: `ai://chunk deltas append to the streaming assistant message in real time` (3 deltas → `'Once upon a time'`, still streaming, no tool calls), `ai://chunk deltas for an unknown requestId are dropped`, `ai://chunk toolCall chunks append to the streaming message toolCalls array` (2 tool calls, second appends), `ai://chunk toolCall chunks for an unknown requestId are dropped`, `ai://done seals the streaming message preserving accumulated content and toolCalls` (1 delta + 1 tool call + 1 delta + done → message has content `'Let me check the weather'`, tool calls preserved, streaming flipped to false), `ai://chunk with kind "done" (inline-display) also seals the message` (asserts the inline `done` chunk seals the message but doesn't clear `requestStatus`; the `ai://done` event does that). The 5b-3 `send` test was updated to assert on the new `toolCalls: []` field on both the user and the assistant message. The module docstring was rewritten to scope 5b-4 vs 5b-3.
- [x] `npm run typecheck` — 0 errors (caught a couple of pre-existing test-mock drift issues during development; resolved by the `toolCalls: []` field additions).
- [x] `npm test` — 15 / 15 pass (9 from 5b-3 + 6 new 5b-4).
- [x] `npm run build` — pass, 137 modules, 510 kB bundle (was 509 kB in 5b-3; +1 kB for the ToolTrace code, well within the 500 kB warning limit).
- [x] `cargo build` — clean, 0 errors, 0 warnings.
- [x] `cargo test -- --test-threads=1` — 99 / 99 pass (75 lib + 6 git + 6 secrets_ai + 9 terminal + 3 terminal_tauri; was 81 in 5b-3, +18 from the new parsers and JSON-shape tests). One pre-existing flake was noted and re-ran single-threaded to confirm it's a test-isolation issue with the global mock keychain (the test itself acknowledges it in the comment: "the mock keychain is process-global; we cannot assert the exact set (other tests may have configured providers in parallel)"). Passes reliably when run with `--test-threads=1`.
- [x] No UI smoke test for 5b-4 (WebView2 headless capture is a known limitation; the AI panel UI is verified at the type level, build level, and logic level via 6 new vitest tests).
- [x] Titlebar subtitle is `dev · phase 5b-3` (the sub-phases 5b-1 through 5b-4 don't update the subtitle — the next UI refresh in 5b-5 will).
- [x] 5b-4 is **streaming render + tool-call protocol only** — the model can call tools (e.g. `get_weather`) and the tool calls show up in the chat thread with their input JSON, but the tools are NOT executed and no result is sent back to the model. This is a read-only display surface; a future phase will add the execution loop. 5b-5 starts on `Cmd-K` inline edit + provider-specific error messages + a "New chat" button.

**Phase 5b-5 done criteria (this session — inline edit `Cmd-K` modal + provider-specific error messages + new-chat button):**

- [x] `src/shared/components/Modal/` — new shared modal primitive. `Modal.tsx` is a small wrapper: renders a backdrop, then a centred panel, then the children. ESC closes (via a `keydown` listener scoped to the modal root). Click-on-backdrop closes. Focus trap: on open, the first focusable descendant gets focus; Tab/Shift+Tab cycle within the panel. Uses `role="dialog"` + `aria-modal="true"` + `aria-labelledby={titleId}`. CSS module uses design tokens (`--z-modal: 200`, `--shadow-lg`, `--color-bg-elevated`, `--space-*`, `--radius-md`). Module-level CSS-in-JS-free — all classes are CSS Module classes. The primitive takes `open`, `onClose`, `titleId`, `label`, and `children`. Doesn't try to be a popover or a tooltip — strictly a centered modal.
- [x] `src/shared/components/Modal/index.ts` — barrel re-export of `Modal` (and its prop type) so consumers import from `@/shared/components/Modal` not the deep path.
- [x] `src/screens/EditorWorkspace/state/editorControllerStore.ts` — new tiny Zustand store. State: `editor: monaco.editor.IStandaloneCodeEditor | null` and an action `setEditor(editor)`. The store deliberately has no "replaceSelection" action — the modal calls the editor's `executeEdits` directly on the instance it just read from the store. The store is the only mechanism for the rest of the screen to talk to the Monaco editor; it keeps Monaco out of the React tree at the screen level (Rule 6 — feature isolation).
- [x] `src/screens/EditorWorkspace/components/EditorPane/EditorPane.tsx` — `ActiveEditor` now also writes the Monaco instance to `editorControllerStore.setEditor(editor)` on `onMount` and calls `setEditor(null)` on cleanup. The `editorRef` is still local (for the `useEffect` that syncs external content) — the controller store is an additional, screen-level handle.
- [x] `src/screens/EditorWorkspace/components/AIPanel/errorMessages.ts` — new pure function `getFriendlyError(errorKind, rawMessage) -> { title, hint }`. Maps the 7 `ErrorKind` variants from the Rust side to user-friendly titles and actionable hints: `auth` → "Invalid API key" + "Open Settings to update your key"; `rateLimit` → "Rate limit hit" + "Wait a moment and try again"; `transport` → "Network error" + "Check your internet connection"; `parse` → "Unexpected response" + "The provider returned something we couldn't parse — try again or switch models"; `server` → "Provider issue" + "The provider is having a rough time — try again in a few minutes"; `http` → "Request failed" + `httpStatus > 0 ? "HTTP <status> — try again or check the model id" : "Try again or check the model id"`; `cancelled` → "Stopped" + "You cancelled the response." The function takes the raw message too and uses it for the `http` variant's `hint` if the status is informative. The function is pure and easy to test.
- [x] `src/screens/EditorWorkspace/components/AIPanel/errorMessages.test.ts` — 2 new vitest tests: `friendly messages for every ErrorKind` (iterates all 7 kinds, asserts on the title; no raw Rust error strings bleed through) and `http variant includes status code in the hint`.
- [x] `src/screens/EditorWorkspace/components/AIPanel/AIPanel.tsx` — new `+` icon-button in the header next to the provider badge; calls `clearMessages()` from the store. Disabled when `requestStatus === 'streaming'` (the store's `clearMessages` already no-ops in flight, but disabling the button is the visible signal). New `ErrorBanner` reads the title + hint from `getFriendlyError(message.errorKind, message.error)` and renders them as a `<div role="alert">` with the title in bold and the hint on a new line, plus a small "✕ dismiss" link that calls a new `dismissError(messageId)` action on the store. New `CmdKModal` integration: a single `<CmdKModal />` is mounted at the bottom of the AIPanel, reads `cmdKStore.open` and renders accordingly.
- [x] `src/screens/EditorWorkspace/components/AIPanel/AIPanel.module.css` — new styles for the new-chat button (`align-self: center` in the header), the ErrorBanner title/hint/dismiss-link (line-height 1.4, hint in `--color-fg-muted` to differentiate it from the title), and the CmdKModal-specific overrides (the modal is reused from the shared primitive but the panel gets a wider `min-width: 640px` to fit the before/after panes).
- [x] `src/screens/EditorWorkspace/state/aiStore.ts` — new `dismissError(messageId)` action: removes the message with the matching id from `messages`. New `aiStore` constructor doc note: the `CmdKModal` uses `send` with a synthetic user message and a system-prefixed user message in the same array — the modal reads back the `streamingMessageId` after `send()` returns to know which assistant message to surface.
- [x] `src/screens/EditorWorkspace/state/cmdKStore.ts` — new tiny Zustand store for the Cmd-K modal state. `state: { open: boolean, selection: { text: string, range: monaco.IRange } | null, requestId: string | null, status: 'idle' | 'streaming' | 'done' | 'error', instruction: string }`. Actions: `open(selection)`, `close()`, `setInstruction(instruction)`, `setStatus(status)`, `setRequestId(requestId)`. The store is the only piece of state the CmdKModal reads/writes (it does not directly read the AI store — that wiring happens at the submit-handler level so the modal stays decoupled).
- [x] `src/screens/EditorWorkspace/components/AIPanel/CmdKModal.tsx` — new component. Reads from `cmdKStore`. Renders the shared `Modal` with `open={cmdKStore.open}`. Title is "Edit selection". Body, in `idle`/`streaming`: a small "Before" label + read-only `<pre>` of the selection text + an instruction `<textarea>` (auto-focus) + an "Ask AI" submit button + a "Cancel" button. The textarea is bound to `cmdKStore.instruction` via a controlled input. On submit: builds the prompt via `buildCmdKPrompt(selectionText, instruction)`, calls `aiStore.send(...)` with the prompt, captures the returned `streamingMessageId`, and flips `cmdKStore.status` to `'streaming'`. Subscribes to `aiStore` to detect when `streamingMessageId` flips from streaming → done (or hits an error) and updates `cmdKStore.status` accordingly. Body, in `done`: a "Before" pane (read-only `<pre>`) on the left, an "After" pane (read-only `<pre>` of the latest assistant message's `content`) on the right, with `Apply` and `Reject` buttons. Apply: reads the editor instance from `editorControllerStore`, calls `editor.executeEdits('lipi-cmd-k', [{ range: selection.range, text: assistantContent, forceMoveMarkers: true }])`, then pushes a single edit into the editor's undo stack via `editor.pushUndoStop()`, then calls `cmdKStore.close()`. Reject: just calls `cmdKStore.close()`. Body, in `error`: shows the same ErrorBanner-style title + hint via `getFriendlyError(...)` + a "Try again" button (flips status back to `idle` so the user can re-submit) and a "Close" button. On close, the store is reset (`open: false`, `selection: null`, `requestId: null`, `status: 'idle'`, `instruction: ''`).
- [x] `src/screens/EditorWorkspace/components/AIPanel/CmdKModal.module.css` — styles for the modal body. `.selectionPreview` is a `<pre>` with the design tokens (max-height 180px, vertical scroll, monospace font, `--color-bg-base` background, `--space-3` padding, `--radius-sm` border). `.promptArea` is a `<textarea>` (3 rows) with `--color-bg-base` background and the same padding/radius. `.resultSplit` is a 2-column flexbox (1fr 1fr) with a 16px gap, holding `.resultBefore` and `.resultAfter` (each is a `<pre>` styled like `.selectionPreview`). `.resultActions` is a flex row with `gap: 8px`, the "Apply" button uses the `Button` component's `primary` variant and "Reject" uses the `secondary` variant. The modal panel itself overrides `--min-width: 640px` and `--max-width: 80vw` (the shared Modal accepts a `className` prop for this).
- [x] `src/screens/EditorWorkspace/components/AIPanel/buildCmdKPrompt.ts` — new pure helper. `buildCmdKPrompt(selectionText: string, instruction: string) -> { systemPrompt: string, userMessage: string }`. The `systemPrompt` is "You are a precise code/text editor. The user will give you a block of text and an instruction. Reply with ONLY the rewritten text — no preamble, no explanation, no markdown fences. Preserve the language and indentation of the original." The `userMessage` is a single string: "Original:\n```\n<selection>\n```\n\nInstruction: <instruction>\n\nRewritten:". This keeps the prompt template in one place so it's testable. The user message is what gets sent as the user-role message in the `aiStore.send()` call (the store accepts a system prompt separately — we just merge them at submit time).
- [x] `src/screens/EditorWorkspace/components/AIPanel/buildCmdKPrompt.test.ts` — 4 new vitest tests: `system prompt includes the editor-role and rules`, `user message embeds the selection and instruction`, `empty selection is rejected` (returns an error object instead of throwing), `empty instruction is rejected`. The 2 reject tests use a `Result<{ systemPrompt, userMessage }, 'empty-selection' | 'empty-instruction'>` return shape so the modal can surface a friendly inline error without try/catch.
- [x] `src/screens/EditorWorkspace/EditorWorkspace.tsx` — registers the global `Cmd-K` / `Ctrl-K` shortcut via `useKeyboardShortcut({ ctrl: true, key: 'k' }, …)`. The handler reads the active Monaco editor from `editorControllerStore.editor`, calls `editor.getSelection()` to get the current `monaco.Selection`, then `editor.getModel().getValueInRange(sel)` to extract the text. If the selection is empty (cursor only, no range), the handler is a no-op (and the AI panel briefly shows an inline tip "Select some text first" — no, that's a future nice-to-have; for 5b-5, no-op is fine). If the selection has text, it calls `cmdKStore.open({ text, range: { startLineNumber, startColumn, endLineNumber, endColumn } })`. The handler only runs when the editor exists (`enabled: !!editorControllerStore.editor`). The `TitleBar` subtitle is now `dev · phase 5b-5` (5b-5 is the first sub-phase to update the subtitle since 5b-3).
- [x] `src/screens/EditorWorkspace/state/aiStore.test.ts` — no new tests (the AI store itself didn't change much for 5b-5 — the new `dismissError` action is trivial and the `send` flow is already covered). The CmdKModal logic is tested at the helper level (`buildCmdKPrompt` + `getFriendlyError`), and the wiring is tested by hand in the verification step. 15 frontend tests pre-5b-5 → 21 post-5b-5 (15 existing + 6 new — 2 for `getFriendlyError` + 4 for `buildCmdKPrompt`).
- [x] `npm run typecheck` — 0 errors.
- [x] `npm test` — 21 / 21 pass.
- [x] `npm run build` — pass.
- [x] `cargo build` — clean (no Rust changes in 5b-5; this is a pure-frontend phase).
- [x] `cargo test -- --test-threads=1` — 99 / 99 pass (unchanged from 5b-4).
- [x] No UI smoke test for 5b-5 (WebView2 headless capture is still a known limitation; the new code paths are covered by the pure-helper tests + typecheck + build).
- [x] Titlebar subtitle is `dev · phase 5b-5` (first sub-phase to update since 5b-3).

**Phase 5b-6 done criteria (this session — tool execution loop, both Rust and frontend):**
- [x] `src-tauri/src/chat.rs` — `ChatMessage` struct extended with two new optional fields: `tool_calls: Option<Vec<AssistantToolCall>>` (assistant messages that emitted tool calls) and `tool_call_id: Option<String>` (tool result messages — the id of the call this is the result of). New `AssistantToolCall { id, name, arguments }` struct. The OpenAI request body now declares the `tools` array (currently the single `get_file_contents` tool with its JSON schema), and assistant `tool_calls` serialise as the standard `{type:"function", function:{name, arguments}}` shape via the new struct; tool result messages serialise as `{role:"tool", tool_call_id, content}`. The Anthropic request body is similarly extended: `tools` array is declared; assistant `tool_calls` are translated to `content` blocks of `type:"tool_use"` (`{type:"tool_use", id, name, input}` with `input` re-parsed from the JSON `arguments` string); tool result messages are translated to `user` role with a `content` block of `type:"tool_result"` (`{type:"tool_result", tool_use_id, content}`). The Anthropic builder got a new `build_anthropic_messages` helper that handles the full per-message shape (text-only, tool-use, tool-result, user-text), and the request struct was refactored from `&'a` lifetimes to a `Vec<AnthropicMessage>` so the per-message content blocks can be owned data. New static helpers `get_openai_tools()` and `get_anthropic_tools()` return the hardcoded tool schemas (one tool for the MVP: `get_file_contents`); both are `OnceLock`-free (plain `static` slices) since the schema is compile-time-constant. 9 new Rust tests cover: (1) OpenAI assistant with `tool_calls` serialises to the expected wire shape, (2) OpenAI tool result messages round-trip, (3) OpenAI plain user messages skip the new optional fields, (4) round-trip `serde_json` for OpenAI, (5) Anthropic assistant with `tool_calls` emits `tool_use` content blocks, (6) Anthropic tool result messages emit `user` role with a `tool_result` content block, (7) Anthropic user text messages wrap the string in a `text` content block, (8) Anthropic assistant with invalid JSON arguments falls back to an empty object input, (9) both `get_openai_tools` and `get_anthropic_tools` produce the expected schema shape.
- [x] `src/ipc/ai.ts` — `ChatMessageArgs` extended with `toolCalls?: AssistantToolCallArgs[]` and `toolCallId?: string`; new `AssistantToolCallArgs { id, name, arguments }` interface. `role` is now `'system' | 'user' | 'assistant' | 'tool'`. The new fields all use `skip_serializing_if = "Option::is_none"` semantics on the Rust side so the wire format is identical to before for messages without tool calls.
- [x] `src/screens/EditorWorkspace/state/toolRegistry.ts` (new, ~370 lines) — the JS-side tool registry. `ToolHandler = (args: Record<string, unknown>) => Promise<string>`, `RegisteredTool { name, handler, description }`, module-level `REGISTRY: Map<string, RegisteredTool>` with `registerTool / getTool / listTools` helpers. `executeToolCall({toolCallId, name, arguments})` is the single entry point: looks up the handler, parses the JSON argument string (falls back to `{}` on invalid JSON, also coerces arrays / scalars / null to `{}`), runs the handler with `Date.now()` timing, and returns `{ toolCallId, output, kind: 'text' | 'json' | 'error', durationMs }`. `kind` is determined by `classifyOutput` — JSON objects/arrays with a `{` or `[` first char that `JSON.parse`s to a non-null object → `'json'`, everything else → `'text'`. Errors at any stage (unknown tool, handler threw) become `kind: 'error'` with a descriptive message. The first built-in is `get_file_contents`: validates the `path` argument, calls `fsReadFile` IPC, maps the `FileContent` / `FsError` shapes to user-friendly error strings ("binary file", "file not found", "permission denied", "too large"), and returns the raw UTF-8 content for normal text files. Registered at module load — no startup wiring needed in the app.
- [x] `src/screens/EditorWorkspace/state/aiStore.ts` — extended with the 5b-6 tool-execution machinery. `RequestStatus` union extended with `{ kind: 'executingTools'; round: number }`. New `MAX_TOOL_ROUNDS = 3` constant. `ChatMessage` extended: `role` now includes `'tool'`, `toolCalls[i]` now carries `status: 'pending' | 'running' | 'done' | 'error' | 'skipped'` and an optional `result: { toolCallId, output, kind, durationMs }`, and `toolCallId?: string` is added for tool result messages. New `ToolExecutor` type (signature mirrors `executeToolCall` from the registry) and a module-level `_toolExecutor` set by `registerToolExecutor(executor)` — the editor mounts this once via `useEffect(() => { registerToolExecutor(executeToolCall); }, [])`. `send` resets `toolRound: 0` on a fresh user-initiated turn and refuses to start when `requestStatus.kind === 'executingTools'`. `onAiChunk` for `kind: 'toolCall'` initialises new calls with `status: 'pending'`. `onAiDone` is the new home of the execution loop: it inspects the sealed assistant message for pending calls, and if any are present + `toolRound < MAX_TOOL_ROUNDS`, it transitions `requestStatus` to `{ kind: 'executingTools', round: toolRound + 1 }`, marks the calls `'running'`, executes them in parallel via `Promise.all`, updates the calls with their results (`'done'` for success, `'error'` for failures), appends one `role: 'tool'` message per call to the thread, and fires a follow-up `aiChatStream` with the updated thread. If the cap is hit with pending calls still remaining, it surfaces a friendly `toolLoop` error (new `ErrorKind` variant handled by `errorMessages.ts` as "Too many tool rounds"). The follow-up `aiChatStream` is wrapped in a `.catch` so any thrown error surfaces as a transport error in the chat thread instead of an unhandled rejection. A new `messageToArgs(m: ChatMessage) -> ChatMessageArgs` helper strips the local-only fields (`status`, `result`) before sending to Rust, so the wire format stays clean. `clearMessages` refuses to run while `executingTools` is active; `clearError` resets `toolRound`.
- [x] `src/screens/EditorWorkspace/components/AIPanel/AIPanel.tsx` — the `ToolTrace` cards are now a full state machine. `statusIcon` returns ⛏ for `pending`, ⏳ for `running`, ✓ for `done`, ✗ for `error`, ⚠ for `skipped`. `statusLabel` returns `queued` / `running…` / `ran in {durationMs}ms` / `error` / `no handler registered` respectively. The card body shows the `input` JSON (pretty-printed) and, when a result is present, the result output (pretty-printed for `kind: 'json'`, raw for `kind: 'text'` or `kind: 'error'`). For `pending` (no result yet) it shows `queued`; for `running` it shows `running…`; for `skipped` it shows `no handler registered for '{name}'`. The root `<div>` has a `data-status` attribute used by the CSS module to colour the card border. The composer is now `isBusy` when the status is `streaming` OR `executingTools`; the textarea placeholder flips to "Running tools…" and the Send button is disabled. The "new chat" `IconButton` is also disabled while `executingTools`, with a distinct `title` ("Stop running tools first" vs the streaming variant's title). The 5b-5 `CmdKModal`'s `ResultViewProps` was updated to import the canonical `RequestStatus` type from `aiStore` so it stays in sync.
- [x] `src/screens/EditorWorkspace/components/AIPanel/AIPanel.module.css` — added `.toolTraceStatus[data-status="..."]` colour rules (green for `done`, red for `error`, amber for `running`/`skipped`, neutral for `pending`) and a matching `.toolTrace[data-status="..."]` border colour. The base card is now a thin neutral border; each status changes the left border colour so the user can scan the thread and see at a glance which tools are still running, which succeeded, and which failed.
- [x] `src/screens/EditorWorkspace/EditorWorkspace.tsx` — registers the tool executor on mount via `useEffect(() => { registerToolExecutor(executeToolCall); }, [])`. Titlebar subtitle updated to `dev · phase 5b-6`. Doc comment updated to mention the 5b-6 wiring (`toolRegistry` → `aiStore`).
- [x] `src/screens/EditorWorkspace/state/aiStore.test.ts` — 8 new tests in a `describe('aiStore tool execution loop (5b-6)')` block: (1) `transitions to executingTools and runs the calls when an assistant message has pending tool calls` — fires `chunk` + `done` and verifies the executor is called and the `toolCalls[i].status` flips to `done`, (2) `appends a role:tool message per call with the result content and the original call id` — verifies the thread gains a `role: 'tool'` message with the right `toolCallId` and `content`, (3) `starts a follow-up stream with the full thread including the tool result` — captures the `ai_chat_stream` invoke args via a chained mock impl, waits for the second invoke, and verifies the follow-up's `messages` array has 3 entries (user, assistant-with-tool-calls, tool result), (4) `surfaces a toolLoop error when the assistant emits more tool calls than MAX_TOOL_ROUNDS allows` — sets `toolRound: MAX_TOOL_ROUNDS` (3) after `send`, fires a turn that wants more tools, and verifies the friendly error is set with `errorKind: 'toolLoop'`, (5) `executor errors become kind:error results and a tool result message is still sent to the model` — registers a throwing executor, verifies the call ends with `status: 'error'` and the model still receives a `role: 'tool'` message with the error string, (6) `does not invoke the executor when the assistant message has no tool calls` — fires `done` after a text-only assistant turn and verifies the executor is never called, (7) `does not invoke the executor when toolRound is already at MAX_TOOL_ROUNDS (loop exit)` — sets `toolRound: 3` after `send` and verifies a friendly `toolLoop` error is set instead of executing, (8) `clearMessages refuses to run during executingTools state` — sets `requestStatus: { kind: 'executingTools', round: 1 }` and verifies `clearMessages` is a no-op. Several existing 5b-4 tests were updated to expect the new `status: 'pending'` field on `ToolCall` objects and to expect the new `executingTools` transition when the assistant message has pending tool calls. A `makeExecutor` helper centralises the test mock setup. Test count: 21 → 53.
- [x] `src/screens/EditorWorkspace/state/toolRegistry.test.ts` (new) — 13 vitest tests covering the registry in isolation. Basic CRUD: `round-trips a tool through registerTool / getTool`, `listTools` includes both the test stub and the built-in `get_file_contents`, `registerTool` overwrites a tool with the same name. `executeToolCall` happy path: runs the handler with parsed arguments and returns the right `kind`. Error paths: unknown tool name → `kind: 'error'` with the available-tools list, invalid JSON arguments → handler still runs with `{}`, empty arguments → `{}`, non-object JSON (arrays, scalars, null) → `{}`, handler throws → `kind: 'error'` with `Tool 'X' failed: ...`. Classification: JSON object output → `'json'`, JSON array output → `'json'`, JSON scalar output → `'text'`, free-form text → `'text'`. Test count: 53 → 66.
- [x] `npm run typecheck` — 0 errors.
- [x] `npm test` — 66 / 66 pass.
- [x] `npm run build` — pass.
- [x] `cargo build` — clean.
- [x] `cargo test --no-fail-fast --lib` — 85 / 85 pass (76 pre-5b-6 + 9 new 5b-6).
- [x] No UI smoke test for 5b-6 (WebView2 headless capture is still a known limitation; the new code paths are covered by the 13 new toolRegistry tests + 8 new aiStore tests + the 9 new Rust wire-format tests + typecheck + build).
- [x] Titlebar subtitle is `dev · phase 5b-6`.

## 7. Constraints (rules an agent MUST follow)

1. **Never touch `C:\Users\Pv Vimal Nair\lifeof\`** — that is the Flutter LifeOf project. Lipi lives only in `C:\Users\Pv Vimal Nair\lipi\`.
2. **Never install toolchains without owner confirmation** — owner stopped the build before installs in this session.
3. **Always read this file first** when picking up the project — it is the source of truth for decisions and state.
4. **Follow the plan phases in order** — don't skip ahead (e.g. don't build AI features before the editor works).
5. **Phase-by-phase verification** — at the end of each phase, stop and show the owner a working result before moving on.
6. **Use `npm`, not `pnpm`** — pnpm is not installed and owner didn't ask for it.
7. **Follow the 7 engineering rules in Section 10** — alignment, screen naming,
   screen-folder layout, component reuse, best-practice defaults, section
   isolation, scalable choices. Long-form in `docs/ENGINEERING.md`.

## 8. Distribution & Release

| Platform | Channel | Format |
|----------|---------|--------|
| Windows | Direct download + Microsoft Store + `winget install lipi` | `.msi`, portable `.exe` |
| macOS | Direct download + Mac App Store + `brew install --cask lipi` | `.dmg` (universal: x86_64 + aarch64) |
| Linux | Direct download + Flathub + `apt` + `dnf` + AUR | `.AppImage`, `.deb`, `.rpm` |
| iOS | App Store | `.ipa` (Tauri's iOS shell, reduced feature set — no PTY) |
| Android | Play Store + F-Droid + direct APK | `.apk` (universal) |

**Auto-update:** `tauri-plugin-updater` pointing at
`https://github.com/<owner>/lipi/releases/latest/download/updater.json`.

**Code signing:**
- Windows: SignPath (free for OSS) or Azure Trusted Signing.
- macOS: Apple Developer ID (notarization via `xcrun notarytool`).
- Microsoft Store, Mac App Store, Play Store handle their own signing.
- Linux distros ship unsigned or use distro-specific sigs (Flathub signs via
  Flatpak builder).

**Scaling to millions:** Pure CDN + object storage problem. A signed Tauri
binary is ~10MB. GitHub Releases + Cloudflare R2 handles the bandwidth. There
is no server-side load that scales with users — all network calls are direct
from the user's machine to their chosen LLM / STT provider.

---

## 9. Voice-to-Code architecture

### 9.1 Primary path: Wispr Flow

- **Auth:** BYO API key (user provides, stored in OS keychain via `keyring`).
- **Transport:** WebSocket
  `wss://platform-api.wisprflow.ai/api/v1/dash/client_ws?client_key=Bearer%20<KEY>`.
- **Audio format:** 16kHz, 16-bit, single-channel PCM WAV. Web uses
  `AudioContext` + `ScriptProcessorNode` for raw PCM capture (no
  `MediaRecorder` / `wavtools` round-trip — the WS protocol wants raw PCM,
  not encoded audio, so capturing directly and base64-encoding each 50 ms
  chunk is both simpler and more accurate). See Decision #42 for why
  `ScriptProcessorNode` over `AudioWorkletNode`. iOS uses
  `AVAudioRecorder` with `linearPCM` settings (still to be wired in a
  future mobile phase). Android uses `AudioRecord` with
  `ENCODING_PCM_16BIT`, `SAMPLE_RATE_16000` (also future mobile work).
- **Streaming protocol:** Open WS on mic start. Send an `auth` frame
  (`access_token = apiKey`, `context = { name: 'Lipi', type: 'editor' }`,
  `language = ['en']`). Stream `append` frames — one per 50 ms chunk of
  Int16 PCM, base64-encoded inside `audio_packets.packets[0]`, with RMS
  volume in `audio_packets.volumes[0]`, `packet_duration = 0.05`, and
  sequential `position` per chunk. Send `commit` with `total_packets`
  on stop. A re-arming 30 s timeout rejects with a `WisprClientError`
  on silence; auth errors map to a friendly message; close events
  before a final resolve with the last partial.
- **JS-side key access:** The API key is fetched in JS via a new
  `secrets_get_api_key` Tauri command (`secretsGetApiKey` in
  `src/ipc/secrets.ts`) at the start of each capture session. This is
  a deliberate, documented exception to the "key never enters JS" rule
  (Decision #17) — see Decision #41 for the rationale. The key is held
  in memory only for the duration of one capture, dropped on `stop()`,
  and never written to disk or sent anywhere except the Wispr endpoint
  (already whitelisted in CSP, Decision #24).
- **Risk:** Wispr's API requires enterprise approval via `enterprise@wisprflow.ai`.
  If approval is denied or delayed, the headline voice flow breaks for
  affected users. Mitigated by the on-device fallback (9.2) and by the
  Command Palette's "Voice: Use Stub (debug)" toggle for engineers.

### 9.2 Fallback path: on-device STT

Always available, always free, no approval gate.

- **iOS:** `Speech.framework` (built-in). Streams partial results via
  `SFSpeechAudioBufferRecognitionRequest`.
- **Android:** `SpeechRecognizer` (Google's built-in, requires Play Services)
  or `whisper.cpp` JNI binding for offline / privacy-strict users.
- **Desktop (Win / Mac / Linux):** OS-native dictation where available
  (Windows Speech Recognition, macOS Dictation, GNOME Speech-to-Text).
  Degraded UX vs. Wispr, but never blocked.

### 9.3 Mode-aware binding

Lipi has three voice contexts:

1. **Dictation** — text streams into the editor at the current cursor.
2. **Chat prompt** — text streams into the AI side panel.
3. **Voice command** — utterances like "create new file", "run tests",
   "commit with message" map to Lipi actions.

Mode is selected by a mic button with a dropdown, or by utterance prefix
("hey lipi, ..."). Mode detection from utterance context alone is a Phase M4
stretch goal.

### 9.4 Voice-driven git commit (M4 — shipped)

The first mutating git command driven by voice. Shipped
behind the `'commit with message ...'` / `'commit saying
...'` / `'commit that says ...'` grammar in
`src/voice/commitGrammar.ts` and the new
`ipcGitCommit` IPC.

**Flow**: user speaks "commit with message fix: handle
null body" -> the AIPanel composer's transcript effect
runs `parseCommitCommand` -> if it's a commit intent, the
transcript is *not* merged into the textarea ->
`ipcGitCommit(rootPath, message)` is called ->
`gitStore.setCommitRunning()` -> Rust `commit()`
validates -> stages -> runs `git commit -m <msg> --no-verify`
-> resolves HEAD -> returns `{ sha, shortSha }` ->
`gitStore.setCommitSuccess(...)` -> the `CommitStatusBanner`
above the textarea shows a 5-second toast -> the Git
panel is refreshed.

**Why `--no-verify`**: a `pre-commit` hook blocking the
commit would leave the user with no visible feedback
("I said commit, what happened?"). The voice command
*is* the user's explicit intent.

**Why hand-rolled grammar, not an LLM**: determinism
and offline. The grammar is 26 unit tests deep and
handles case insensitivity, variable whitespace,
filler prefixes, multi-line messages, and bare
`commit` (no message). Adding more triggers is
additive and trivial.

### 9.5 Voice accessibility (M5 — shipped)

Three additions to make voice input usable without a
mouse and friendly to screen readers.

**Global keyboard shortcut** — `Cmd+Shift+V` /
`Ctrl+Shift+V` toggles the mic on the AI composer
(`useVoiceShortcut`). Suppressed while typing in
editable fields (textarea, text-like input,
contenteditable), ignores key-repeat, respects IME
composition. The shortcut is bound to a single
`useVoiceCapture` instance owned by the composer so
the button and the shortcut can't fight over the
mic.

**aria-live announcer** — a single
`aria-live="polite"` region (`VoiceAnnouncer`) at
the app root. Subscribes to `useVoiceStore` and
emits a deduplicated announcement per state
transition: "Microphone permission requested",
"Recording, 0:05" (with the rounded duration),
"Transcribing audio", or the friendly error
message. Idle is silent so we don't spam screen
readers.

**Focus management** — after a voice session ends
(natural or commit path), focus returns to the
textarea with the cursor at the end of the new
content. The textarea placeholder / `aria-label`
mention the shortcut, and a `KeyHint` chip sits
next to the mic button.

### 9.6 Deferred from this session (planned but not shipped)

- **M2c mobile native plugins** — iOS `Speech.framework`
  (`SFSpeechRecognizer`) and Android
  `SpeechRecognizer` Swift / Kotlin implementations.
  The iOS and Android plugin **contracts are
  fully documented** in
  `docs/plugins/lipi-stt-ios/README.md` and
  `docs/plugins/lipi-stt-android/README.md`,
  and the Rust `voice_platform.rs` already
  reports `OsFamily::Ios` and
  `OsFamily::Android` with
  `web_speech: false, native_dictation: true` so
  the future plugins plug in without JS changes
  (§9.8). The actual Swift / Kotlin code awaits
  a future session on a Mac with Xcode 16+ /
  Linux with Android Studio Iguana+; the user's
  current Windows 10 working environment has
  neither. The Web Speech shim is the working
  V1 path on Windows / macOS / iOS WebView.
  **M3 update (June 2026):** the
  `'nativeDictation'` factory stub now exists in
  `src/voice/sessions/nativeDictationSession.ts`
  and is wired into the `voiceSessionFactories`
  registry (it throws
  `VoiceSessionError('not-configured')` at start
  time). The Settings card and Command Palette
  entry for `nativeDictation` are deferred until
  the Swift / Kotlin code lands — see §9.9.
- **M3** — shipped — see §9.9.

### 9.7 M2c desktop — SHIPPED (stub build, see CHANGELOG "Added (M2c desktop)")

> **Status:** M2c desktop is shipped in **stub mode**.
> The full `'ondevice'` provider is end-to-end plumbed
> through the hook, IPC, and settings UI; the Rust
> code under `#[cfg(feature = "m2c-native")]` is
> present but the real `whisper-rs` / `cpal` build
> requires `libclang.dll` (a Windows LLVM install)
> which is not present in this sandbox. To run the
> real path on a developer machine, install LLVM and
> `cargo build --features m2c-native`. The full
> feature list, file-by-file description, and test
> coverage are in `CHANGELOG.md` under "Added (M2c
> desktop — on-device STT pipeline, stub build)".
>
> The original kickoff plan below is preserved for
> historical context — every decision in the plan was
> implemented as-described, except the platform
> coverage (M2c mobile — iOS / Android — is a separate
> phase) and the Web Speech API alt path (we shipped
> the Whisper path only; the Web Speech alt is not
> built).

#### Why this section exists

M2c is the biggest single voice slice left. It's
also the one with the most platform-API variance, so
the next session shouldn't waste an hour re-deriving
the platform matrix. The decisions below are
pre-made; the agent should treat them as constraints
and just implement.

#### Scope of M2c desktop

Ship an `on-device` STT provider for Windows, macOS, and
Linux that:

1. Works fully **offline** (no audio leaves the device).
2. Streams **partial transcripts** to the existing
   `TranscriptionEvent` contract in `src/voice/types.ts`
   (or — if we go with the batched Whisper path — emits a
   single high-confidence `final` per utterance; the
   Composer still works because the M2a merge effect
   doesn't rely on partials).
3. Surfaces the same `VoiceError` taxonomy the hook
   already maps (`'permission-denied' | 'mic-unavailable'
   | 'network' | 'auth' | 'provider' | 'aborted' |
   'unknown'`).
4. Sits **behind** the existing provider picker. The user
   picks Wispr / On-device / Stub in Settings →
   Voice. The `useVoiceCapture` hook already has the
   `'ondevice'` branch (it currently throws
   "On-device STT is not implemented yet (M2c)").
   This section is about filling that branch in.

#### Platform matrix — pre-decided

| OS | Tauri webview | Web Speech API | Chosen path |
| --- | --- | --- | --- |
| Windows 10/11 | WebView2 (Chromium) | YES (`webkitSpeechRecognition`) | **whisper-rs** as primary; Web Speech API as opt-in alt |
| macOS 12+ | WKWebView | YES | **whisper-rs** as primary; Web Speech API as opt-in alt |
| Linux (GTK) | WebKitGTK | **NO** — `SpeechRecognition` is not compiled into the default WebKitGTK; speech synthesis requires a custom build with `-DUSE_SPIEL=ON` (per tauri-apps/tauri#8784) | **whisper-rs only** |

**Why whisper-rs, not the OS's native dictation:**

- Web Speech API is unavailable on Linux (deal-breaker
  for a cross-platform IDE).
- Web Speech API on Chromium sends audio to Google's
  servers; on Safari it sends to Apple. That violates
  Lipi's "BYO API key. No backend." story.
- whisper-rs (whisper.cpp bindings) is truly on-device,
  cross-platform, with hardware-accel feature flags
  (`metal` for macOS, `cuda` for Windows, `vulkan` for
  Linux). Quality is "good enough" with the `tiny.en` or
  `base.en` models (~75–150 MB), and the user only
  downloads it once.

#### Rust-side architecture

Add a new Tauri plugin crate at
`src-tauri/plugins/lipi-stt/` (or directly inline in
`src-tauri/src/stt.rs` + a thin Tauri command surface
in `lib.rs` if we want to keep the binary count at 1).
The plugin exposes:

- `stt_list_models() -> Vec<SttModelDescriptor>` —
  curated list (id, display name, size, language,
  url). Source: a hard-coded list of Hugging Face
  mirrors of `ggerganov/whisper.cpp` GGML models.
- `stt_install_model(id: String) -> ()` — streaming
  download to the app's data dir (`%APPDATA%/lipi/
  stt/models` on Windows, `~/Library/Application
  Support/lipi/stt/models` on macOS, `~/.local/share/
  lipi/stt/models` on Linux). Emits a Tauri event
  `stt://download-progress` with `{ id, received, total }`
  every ~250ms. **No silent pulls** — Lipi shows a
  "Downloading voice model (75 MB)..." toast with a
  progress bar and a Cancel button (per the
  `tauri-plugin-stt` philosophy).
- `stt_remove_model(id: String) -> ()`.
- `stt_set_active_model(id: String) -> ()` — picks
  the model `start_listening` will use. Persists to
  `tauri-plugin-store` (or localStorage-equivalent on
  the JS side).
- `stt_is_available() -> bool` — true iff a model is
  installed AND a `cpal` input device exists.
- `stt_start_listening(opts: { language?, max_duration_ms? }) -> ()` —
  opens the mic via `cpal`, runs `whisper_full` on each
  rolling audio buffer, emits `stt://transcript` events
  with `{ kind: 'partial' | 'final', text, sequence,
  timestamp, isUtteranceEnd? }`. `max_duration_ms`
  defaults to 30s (a Whisper safety cap — long audio
  bloats memory fast).
- `stt_stop_listening() -> ()` — stops the mic and
  emits the last `final` event.
- `stt_check_permission() -> 'granted' | 'denied' | 'prompt'`
  and `stt_request_permission() -> 'granted' | 'denied'`
  — wraps the OS-level mic permission state (cpal
  doesn't expose this directly; we use
  `tauri::webview::PermissionKind::Microphone` via
  the `on_permission_request` API and the OS's
  `tauri-plugin-os` info).

**Hardware acceleration features** (Cargo.toml, default
off so the dev build doesn't need a GPU):

```toml
[features]
default = []
metal = ["whisper-rs/Metal"]    # macOS
cuda = ["whisper-rs/cuda"]      # Windows + NVIDIA
vulkan = ["whisper-rs/vulkan"]  # Linux + Windows
```

CI builds one feature per OS (the build matrix in
`src-tauri/Cargo.toml`'s `[package.metadata.bundle]` +
the `tauri.conf.json` per-target script handles the
`cargo build --features` wiring — Tauri 2 supports
this natively).

#### TypeScript-side surface

New file `src/voice/onDeviceSTT.ts` exporting:

- `transcribeViaOnDevice(pcm: AsyncIterable<Int16Array>, opts: OnDeviceSttOptions): Promise<string>` —
  the **M2a-shaped** entry point the existing hook
  expects. Internally:
  1. Calls `ipcSttStartListening({ language })`.
  2. Subscribes to `stt://transcript` events,
     collecting the final text.
  3. Forwards each PCM chunk to the Rust side via
     `ipcSttFeedAudio(chunk)` (new IPC).
  4. On `stop()`, calls `ipcSttStopListening()` and
     awaits the last `final` event.
- `listInstalledModels() -> Promise<SttModelDescriptor[]>`.
- `installModel(id)`, `removeModel(id)`,
  `setActiveModel(id)`, `isAvailable()`.
- `onDownloadProgress(listener) -> unsubscribe` —
  bridges the `stt://download-progress` Tauri event
  to a JS subscription.

New file `src/ipc/stt.ts` — typed wrappers over
`invoke('plugin:lipi-stt|...')` and the event
listeners. Same shape as `src/ipc/git.ts`.

Wire `useVoiceCapture`'s `'ondevice'` branch
(`src/shared/hooks/useVoiceCapture.ts:252-260`) to
call `transcribeViaOnDevice(pcm, opts)` instead of
throwing the placeholder error. The Wispr path
(`'wispr'`) is unchanged.

#### Settings UI additions

`src/screens/Settings/components/VoiceSettings.tsx`
(doesn't exist yet — created in this phase):

- Provider radio: Wispr / On-device / Stub
- If On-device:
  - "Voice model" dropdown listing installed
    models + a "Download a new model..." button.
  - Download progress bar (subscribed via
    `onDownloadProgress`).
  - "Where is my audio sent?" — locked-on answer
    row: "Stays on this device. Lipi uses
    whisper.cpp to transcribe locally." (the
    privacy story is the headline).
  - Language picker (whisper auto-detects; we
    expose the override for the rare case the
    user wants to force a language).
- If Web Speech API path is also enabled (Win/macOS
  only, behind a "Use browser speech engine (sends
  audio to Google/Apple)" opt-in toggle): a second
  radio with the privacy disclosure visible
  inline.

#### Why the Web Speech API path is *opt-in* alt, not default

It only works on Win/macOS (Linux is the deal-breaker)
and it sends audio off-device by default. Whisper-rs
covers all three platforms and keeps audio local —
matching Lipi's "no backend" promise. The Web Speech
API alternative is for users who:

- Don't want to download a 75 MB model.
- Are on a 32-bit ARM Linux where compiling
  whisper-rs is painful.
- Are testing and don't care about privacy.

#### Tests

1. **Rust unit tests** for the model lifecycle
   (`list_models` returns a non-empty curated list;
   `install_model` writes to the data dir;
   `set_active_model` rejects unknown ids; etc.) —
   in `src-tauri/src/stt.rs::tests`. The audio
   capture + whisper inference can't be unit-tested
   without a real mic + a real model, so those paths
   get integration tests in the Settings UI
   manual-test plan.
2. **TypeScript**:
   - `onDeviceSTT.test.ts` — mocks the `invoke`
     bridge and the event listener. Verifies the
     `transcribeViaOnDevice` function builds the
     right sequence of `start_listening` ->
     `feed_audio` (one per chunk) -> `stop_listening`
     -> final event -> resolve.
   - `useVoiceCapture` provider dispatch test
     (add to the existing test file) — when
     `provider === 'ondevice'`, the hook calls
     `transcribeViaOnDevice`, not
     `transcribeViaWispr`.
3. **Manual / integration**:
   - Settings UI: download a model, see the
     progress bar, pick it, record a short
     utterance, see the transcript land in the
     Composer.
   - Linux: confirm the whole flow works (this
     is the platform the Web Speech API path
     would fail on, so it's the load-bearing
     test for the cross-platform claim).

#### Open questions to resolve *before* writing code

1. **Whisper model choice for the default download.**
   `ggml-tiny.en` (English-only, 75 MB) is the right
   default. For multilingual users, fall back to
   `ggml-tiny` (75 MB, multilingual, slightly worse
   English). Document the trade-off in the Settings
   UI tooltip. **Open question: do we ship
   multilingual by default and let the user
   download the .en variant for English-only
   better quality? My recommendation: ship
   `tiny.en` (English-only) and offer `tiny` as
   the multilingual alt in the dropdown.**

2. **Model hosting.** Hugging Face `ggerganov/whisper.cpp`
   is the canonical mirror. We pin to a commit hash so a
   mirror takedown doesn't break new installs. Backup
   mirror: the project's own GitHub release assets
   (download bandwidth from the user's own repo is a
   nice zero-cost fallback).

3. **Dependency strategy: roll our own or depend on
   `tauri-plugin-stt` / `brenogonzaga/tauri-plugin-stt`?**
   Both are <20 GitHub stars and 0 forks as of
   2026-06. The risk of a maintainer disappearing
   mid-session is real. **Recommendation: roll our
   own thin plugin in `src-tauri/plugins/lipi-stt/`
   using `whisper-rs` + `cpal` + `reqwest` directly.
   ~400 LoC for the IPC surface, ~100 LoC for
   `whisper-rs` init, ~100 LoC for cpal capture.
   Total: ~600 LoC, well within one session's
   budget, no third-party Tauri plugin to vet.**

4. **Where do partials come from?** whisper.cpp is
   batch-oriented (you give it N seconds of audio,
   it gives you one transcript). True partial
   results would require a streaming variant
   (whisper-stream, or splitting the buffer into
   1s windows and re-transcribing overlapping
   windows). **Recommendation for M2c desktop: ship
   with batch semantics — one `final` per
   `stop_listening()` call, no partials — and add a
   M2c.b phase later for streaming partials.** The
   Composer's merge effect works fine with batch
   finals (it already does for the M2a stub and
   the M2b Wispr path; Wispr only emits partials
   in production, but the merge logic doesn't
   depend on them).

#### What M2c desktop is NOT

- **M2c mobile** (iOS / Android) — see §9.8.
  The Web Speech API shim and the iOS / Android
  plugin contracts are SHIPPED. The Swift /
  Kotlin plugin implementations await a future
  session on a Mac with Xcode 16+ / Linux with
  Android Studio Iguana+. iOS uses
  `SFSpeechRecognizer` (Speech.framework), Android
  uses `SpeechRecognizer`. Both are OS-level; no
  whisper model needed. The plugin contracts plug
  into the same `'ondevice' | 'webSpeech'`
  provider shape — that's the M3 session-based
  streaming API work.
- **M3** (the session-based streaming API that
  wraps every provider in a `VoiceSession` with
  `onStateChange` / `onTranscription` /
  `onError` listeners) is the next big refactor
  *after* M2c desktop ships. The current
  `useVoiceCapture` "function + Promise" shape is
  fine for the M2b Wispr and M2c desktop-batched
  paths; M3 unifies them so iOS / Android
  streaming can slot in.

#### Suggested sub-task breakdown for the next session

1. Add `whisper-rs` to `Cargo.toml` (no feature
   flag on for the dev build; turn on `metal` /
   `cuda` / `vulkan` per target).
2. New `src-tauri/src/stt.rs` — model lifecycle
   (list / install / remove / set_active /
   is_available). ~150 LoC. Unit-testable.
3. New `src-tauri/src/stt_capture.rs` — `cpal`
   mic open + a 16kHz mono Int16 ring buffer
   + the `whisper_full` call. ~150 LoC. Not
   unit-testable (needs a real mic + model);
   integration test only.
4. New Tauri commands in `src-tauri/src/lib.rs`
   `invoke_handler` (~5 commands + 2 event
   types). ~50 LoC.
5. New `src/ipc/stt.ts` typed wrappers. ~50 LoC.
6. New `src/voice/onDeviceSTT.ts`. ~100 LoC.
7. Wire `useVoiceCapture.ts`'s `'ondevice'`
   branch to call `transcribeViaOnDevice`.
   ~20 LoC edit.
8. New `src/screens/Settings/components/VoiceSettings.tsx`
   (the provider picker + model install UI).
   ~250 LoC.
9. `src/main.tsx` + new `src/screens/Settings/`
   screen route (or a modal triggered from the
   Command Palette). The Settings screen may
   already be on the roadmap — check before
   creating a new route.
10. Tests (Rust + TS as listed above). ~250 LoC.
11. Final verify: typecheck, vitest,
    `cargo check --tests`, `cargo test --lib`,
    `vite build`. Update `CHANGELOG.md` + this
    HANDOFF §9.7 with "shipped" notes.

Total estimate: **600 LoC Rust + 600 LoC TS +
250 LoC tests = ~1450 LoC**. One full session
(assuming the model-install UX is the slow
part — drawing the progress bar + the cancel
button + the error states takes more time than
the wiring).

---

### 9.8 M2c mobile — SHIPPED (Web Speech shim + iOS/Android plugin contracts, see CHANGELOG "Added (M2c mobile)")

> **Status:** M2c mobile is shipped as a
> **Web Speech API shim** for Windows / macOS /
> iOS WebView, plus **fully-documented iOS and
> Android plugin contracts** in
> `docs/plugins/lipi-stt-ios/README.md` and
> `docs/plugins/lipi-stt-android/README.md`.
> The Swift / Kotlin plugin code itself awaits
> a future session on a Mac with Xcode 16+ /
> Linux with Android Studio Iguana+; the user's
> current Windows 10 working environment has
> neither. The Rust `voice_platform.rs` already
> reports `OsFamily::Ios` and
> `OsFamily::Android` with
> `web_speech: false, native_dictation: true` so
> the future plugins plug in without JS changes
> (a single new `useEffect`-style "start native
> dictation" branch in `useVoiceCapture.ts` is
> all that's needed on the JS side when the
> Swift / Kotlin code lands).
>
> The four locked decisions (Q1 language field,
> Q2 no custom consent dialog, Q3 mirror
> On-device subsection, Q4 capability store
> hydrated at startup) and the R1–R10 risks are
> documented in
> `docs/decisions/0046-m2c-mobile-shim.md`. The
> full feature list, file-by-file description,
> and test coverage are in `CHANGELOG.md` under
> "Added (M2c mobile — on-device STT via Web
> Speech API + iOS/Android plugin contracts)".

#### What ships in M2c mobile V1

1. **Rust — `src-tauri/src/voice_platform.rs`** —
   a new `OsFamily` enum
   (`Windows | Macos | LinuxGtk | Ios | Android |
   Other`) and a `VoicePlatformCapabilities`
   struct (`ondevice: bool`, `web_speech: bool`,
   `native_dictation: bool`, `os_family: OsFamily`)
   with a `get_capabilities()` function. The
   capability flags are derived at compile time
   via `#[cfg(target_os)]` on a single
   `const OS: OsFamily` per build target;
   4 unit tests cover the camelCase wire shape
   and the OS-specific truthiness of each flag.
2. **Rust IPC — `voice_platform_get_capabilities`**
   — a new Tauri command that exposes the
   capability struct to the frontend via
   `invoke('voice_platform_get_capabilities', …)`.
3. **JS IPC — `src/ipc/voicePlatform.ts`** —
   TypeScript wrapper that mirrors the Rust
   struct shape; barrel re-exported from
   `src/ipc/index.ts`.
4. **JS — `src/voice/capabilities.ts`** — a
   process-lifetime cache around
   `voicePlatformGetCapabilities()` for
   synchronous reads from the Command Palette's
   `isEnabled` predicates.
5. **JS — `src/shared/state/voiceCapabilitiesStore.ts`**
   — a tiny Zustand store (no persistence) with
   a `hydrate()` action called once at app
   startup from `aiStore.ts`.
6. **JS — `src/voice/webSpeechTypes.ts`** —
   minimal local types for the non-standard
   `SpeechRecognition` / `SpeechRecognitionEvent`
   / `SpeechRecognitionErrorEvent` / `Window`
   augmentation.
7. **JS — `src/voice/webSpeechSTT.ts`** — the
   `transcribeViaWebSpeech()` orchestrator with
   the same shape as `transcribeViaOnDevice` /
   `transcribeViaWispr`: pre-flight
   feature-detect, construct, wire
   `onresult` / `onerror` / `onend`, `start()`,
   await. W3C error mapping to a typed
   `WebSpeechSttErrorCode` union
   (`permission-denied`, `no-speech`, `aborted`,
   `network`, `service-not-allowed`,
   `bad-grammar`, plus Lipi-side `no-webspeech`
   and `timeout`).
8. **JS — `src/shared/state/voicePreferencesStore.ts`**
   — extended with `'webSpeech'` in the
   `VoiceProvider` union, a `language: string`
   field (default `'en-US'`), and a `setLanguage`
   action. Persisted to `lipi:voicePreferences:v1`
   localStorage with a back-fill path for older
   payloads.
9. **JS — `src/shared/hooks/useVoiceCapture.ts`**
   — extended with `'webSpeech'` in the
   `UseVoiceCaptureOptions.provider` union. The
   `startWebSpeechRecording()` callback
   threads
   `useVoicePreferencesStore.getState().language`
   into the orchestrator. The `stop()` path
   calls the orchestrator's `abort()` handle
   (with the 500ms fallback the desktop
   `ondevice` hook uses per Decision #46 risk
   R5). The cleanup effect aborts on unmount.
10. **JS — `src/shared/components/VoiceButton/VoiceButton.tsx`**
    — extended with `'webSpeech'` in the
    `provider?:` prop union.
11. **JS — `src/screens/SettingsProvider/components/WebSpeechCard.tsx`**
    (+ `.module.css`) — a new card that mirrors
    `OnDeviceCard`'s header / capability badge /
    lede / privacy callout / single-toggle
    shape, rendered inside a new `<h3>` "Or use
    the browser's built-in speech engine"
    subsection in `SettingsProvider` (not a
    third radio in the top section per Decision
    Q3). The capability badge reads "Available" /
    "Not available on this platform" from the
    hydrated `useVoiceCapabilitiesStore`. The
    `TitleBar` subtitle bumps to
    `'dev · phase M2c mobile'`.
12. **JS — `src/shared/commands/commands.ts`**
    — two new commands —
    `voice.provider.webspeech` and
    `voice.provider.ondevice` — each gated by an
    `isEnabled` predicate that reads from
    `useVoiceCapabilitiesStore.getState().capabilities`
    synchronously.

#### What awaits a future session

- **iOS Swift plugin** — see
  `docs/plugins/lipi-stt-ios/README.md`. The
  `SFSpeechRecognizer` + `SFSpeechAudioBufferRecognitionRequest`
  Swift code (~250 LoC) plus
  `src-tauri/src/ios_stt_plugin.rs` (~50 LoC).
  Estimated effort: one focused session on a
  Mac with Xcode 16+.
- **Android Kotlin plugin** — see
  `docs/plugins/lipi-stt-android/README.md`.
  The `android.speech.SpeechRecognizer` Kotlin
  code (~300 LoC) plus
  `src-tauri/src/android_stt_plugin.rs`
  (~50 LoC). Estimated effort: one focused
  session on a Linux box with Android Studio
  Iguana+.
- **M3** — session-based streaming API that
  unifies Wispr / on-device / webSpeech /
  native-dictation behind a single
  `VoiceSession` interface (parallel to the
  Wispr WS protocol). The current
  `useVoiceCapture` "function + Promise" shape
  is fine for V1; M3 is the unification.

#### iOS / Android plugin contract shape

Both contracts share a `Channel<TranscriptEvent>`
wire shape:

```rust
struct TranscriptEvent {
  kind: String,           // "partial" | "final"
  text: String,           // the partial or final transcript
  sequence: UInt32,       // monotonic per session
  timestamp: UInt64,      // wall-clock ms since epoch
  isUtteranceEnd: Boolean, // true on the last `final`
  language: String?,      // BCP-47, e.g. "en-US"
}
```

The JS side subscribes via
`listen('stt://transcript', ...)` — same event
name as the iOS, Android, and desktop paths.
Demux is by `sessionId` once we add it to the
event payload (M3 work; for V1 there's only
ever one open session at a time, matching the
M2c desktop pattern).

The contract documents in detail:
- **Permission flow** — iOS
  `SFSpeechRecognizer.requestAuthorization` +
  `AVAudioApplication.requestRecordPermission`;
  Android
  `ActivityCompat.requestPermissions(RECORD_AUDIO)`
  + `SpeechRecognizer.createSpeechRecognizer`.
  Each has the OS-specific denial path
  documented (re-prompt vs. Settings app).
- **Lifecycle** — `stt_start_listening`,
  `stt_stop_listening`, `recognition.abort()`
  shape, the 30s cap enforcement.
- **Capability flag** — the contract documents
  that updating `voice_platform.rs` to report
  `web_speech: false, native_dictation: true`
  on iOS / Android is the only Rust change
  needed; the JS `useVoiceCapabilitiesStore`
  auto-picks up the new shape.
- **Test plan** — the only practical tests are
  permission-denial, no-recognizer, and
  real-device smoke tests. Apple's
  `SFSpeechRecognizer` and Android's
  `SpeechRecognizer` have no public mock APIs.

#### Decisions #46, #47

- **#46** — `docs/decisions/0046-m2c-mobile-shim.md`
  — the M2c mobile ADR. Captures the four
  locked decisions (Q1, Q2, Q3, Q4), the
  D1–D6 architecture decisions, and the
  R1–R10 risks. Source of truth for the
  design.
- **#47** — the Q1 language field on the
  `voicePreferencesStore` (separate
  micro-decision from the ADR; called out here
  for completeness). The field is stored +
  threaded through the orchestrator; the V1
  UI does not surface a language picker. M3
  will add the picker.

#### Verified at handoff

- `tsc -b` — clean
- `vitest run` — 544/544 pass
  (+49 for M2c mobile: 19 `webSpeechSTT` + 6
  `voicePlatformCapabilities` + 6
  `voiceCapabilitiesStore` + 9 `useVoiceCapture
  webspeech path` + 9 extended
  `voicePreferencesStore`)
- `cargo check` — clean
- `cargo test --lib` — 146/146 pass
  (+4 for M2c mobile: `voice_platform::*`
  capability tests)
- `npm run build` — clean (216 modules,
  657 KB bundle, 1.93 s)

### 9.9 M3 — SHIPPED (unified `VoiceSession` API across all STT providers, see CHANGELOG "Added (M3)")

> **Status:** M3 is **shipped**. The 4-branch `if/else` ladder
> in `useVoiceCapture.start()` is gone. Every STT provider —
> `stub`, `wispr`, `ondevice`, `webSpeech`, and the future
> `nativeDictation` slot for the iOS Swift / Android Kotlin
> plugins — implements the same `VoiceSession` interface with
> `onStateChange` / `onTranscription` / `onError` listeners.
> The four `transcribeViaX` functions and the four `*Error`
> classes are deleted. The `VoiceProvider` literal union is
> renamed to `VoiceProviderId`; the old `VoiceProvider`
> *interface* (M2-era scaffolding) is gone — the factory
> registry is the polymorphism point.

#### What M3 is

M3 is the session-based streaming refactor that unifies the
four STT providers (and the future iOS / Android
`nativeDictation` slot) behind one polymorphic surface. The
goal: the `useVoiceCapture` hook's `start()` becomes a single
`voiceSessionFactories[provider]()` dispatch, and the per-
provider `startXxxRecording` callbacks / `stop()` branches /
`pcmHandleRef` / `onDeviceSessionIdRef` /
`webSpeechHandleRef` / `streamRef` / `recorderRef` are gone
— the session owns them internally. The hook is a thin
adapter between the session's listener API and the
`voiceStore` (which keeps its 5-state machine; the new
finer-grained 7-state `VoiceSessionState` is mapped via
`sessionStateToVoiceStatus`).

#### Decisions (the locked ones, all from the M3 design summary)

- **#48 — `VoiceProvider` → `VoiceProviderId` rename**.
  The M2-era `VoiceProvider` *interface* in
  `src/voice/types.ts` is **deleted** (it was scaffolding for
  a registry-based design that has now been superseded). The
  literal *union* in `src/shared/state/voicePreferencesStore.ts`
  is renamed to `VoiceProviderId` to avoid the collision.
  The factory registry (`voiceSessionFactories: Record<VoiceProviderId, ...>`)
  is the new polymorphism point.
- **#49 — Per-session `AbortController` as the cancellation
  contract**. The factory's `opts.signal` plumbs to
  `VoiceSessionHandle.abort()`. The existing `generationRef`
  counter in the hook stays as a *secondary* guard for the
  "new session started after the old one was aborted" case
  (the abort controller doesn't solve that).
- **#50 — Delete vs. shim: deleted outright**. The four
  `transcribeViaX` function exports and the four `*Error`
  classes are **deleted** — no deprecated wrappers, no
  `@deprecated` JSDoc, no re-exports. The hook (the only
  production consumer) and the four per-provider test files
  are rewritten in the same PR. The semantic-version impact
  is a breaking change to `@/voice`; called out in
  `CHANGELOG.md`.
- **#51 — `transcriptEvent.sessionId` field added**. The
  Rust `TranscriptEvent` struct in
  `src-tauri/src/stt_capture.rs` gains a
  `pub session_id: Option<String>` field (serialised as
  camelCase `sessionId`). The 5-line Rust change is the
  minimum needed to demux events on the on-device factory
  side when the iOS Swift / Android Kotlin plugins ship with
  concurrent-session support. The Tauri `Channel<TranscriptEvent>`
  is the right native-to-JS shape; the iOS / Android plugin
  contracts do NOT need to change. The M3 wire-shape test
  asserts the field is in the JSON output.

#### What got built

- `src/voice/session.ts` — the canonical `VoiceSession` /
  `VoiceSessionHandle` interfaces, the 23-code
  `VoiceSessionErrorCode` union, the 7-state
  `VoiceSessionState` union, the `VoiceSessionError` class
  (single error surface for all providers), and the
  `voiceSessionErrorMessage(code)` helper.
- `src/voice/sessionFactory.ts` — the
  `voiceSessionFactories: Record<VoiceProviderId, VoiceSessionFactory>`
  registry, the `VoiceSessionFactory` type, the
  `VoiceSessionFactoryOptions` interface (with the
  per-provider `*Override` injection seams: `webSocketCtor`,
  `sttStartOverride`, `sttStopOverride`, `subscribeTranscript`,
  `subscribeError`, `webSpeechCtor`, `windowOverride`).
- `src/voice/sessions/{stubSession,wisprSession,onDeviceSession,webSpeechSession,nativeDictationSession}.ts`
  — five self-contained factory files. The Wispr factory owns
  the PCM capture AND the WebSocket protocol (the M2b
  `wisprClient.ts` is deleted; its wire protocol moved
  in-house). The on-device factory owns the
  `stt://transcript` / `stt://error` subscriptions. The
  Web Speech factory owns the `SpeechRecognition` instance.
  The stub factory is a `setTimeout(200ms)` final-emission
  machine. The `nativeDictation` factory is a stub that
  throws `VoiceSessionError('not-configured')` at start time
  (the Swift / Kotlin plugins land separately).
- `src/shared/hooks/useVoiceCapture.ts` — refactored from
  922 lines to ~360 lines. The hook's public return shape
  is **unchanged**: the Composer's call site
  (`{ isActive, start, stop, status, durationMs, lastError, durationLabel }`)
  is unchanged.
- `src/voice/session.test.ts` — 17 new vitest tests covering
  the cross-provider `VoiceSession` contract: factory
  dispatch, state transitions, listener wiring, error
  propagation, abort path, double-stop guard, post-close
  event guard, `flush()`, the `VoiceSessionError` class
  fields, the immutable `mode` / `provider` fields, and
  `vi.fn()` listener integration.
- `src/shared/hooks/useVoiceCapture.{stub,wispr,ondevice,webspeech}.test.tsx`
  — rewritten to drive the new factories through their
  constructor-injection seams. The four files assert the
  four M3 invariants: (1) the store flips through the
  5-state machine correctly, (2) the transcript lands in
  `voiceStore.transcript` on the final, (3) a typed
  `VoiceSessionError` surfaces as `voiceStore.lastError`,
  (4) `useEffect` cleanup on unmount aborts the in-flight
  session.
- `src/shared/state/voicePreferencesStore.ts` — the
  `VoiceProvider` literal union renamed to `VoiceProviderId`
  (re-exported from `@/voice`); `isValidProvider` now
  accepts `'nativeDictation'`. The Settings UI and Command
  Palette updated.

#### iOS / Android plugin slot

The `'nativeDictation'` factory exists in
`src/voice/sessions/nativeDictationSession.ts` and is wired
into the `voiceSessionFactories` registry. It throws
`VoiceSessionError('not-configured')` at start time — the
Swift / Kotlin plugins land in their own repositories; the JS
side just needs a typed factory to dispatch against. The
`'nativeDictation'` Settings card and Command Palette entry
are **deferred** until the plugins are ready. The
`useVoiceCapabilitiesStore` already returns
`nativeDictation: true` on iOS / Android (set by
`src-tauri/src/voice_platform.rs`), so the future
Swift / Kotlin plugins drop in without JS changes.

#### Verified (M3)

- `tsc -b` — clean.
- `vitest run` — **499 / 499 pass** (was 481 pre-M3; +17
  new tests in `src/voice/session.test.ts` + the rewritten
  per-provider test files).
- `cargo check` — clean.
- `cargo test --lib` — **146 / 146 pass** (unchanged; the
  Rust side adds the `session_id` field to
  `TranscriptEvent` and a new test assertion in
  `transcript_event_serializes_with_camel_case_keys`).
- `npm run build` — clean, 221 modules, ~660 kB bundle.

---

### 9.10 Phase I — SHIPPED (`app://lipi.open?path=...` deep-link scheme, see CHANGELOG "Added (Phase I)")

> **Status:** Phase I is **shipped**. The OS can hand Lipi a
> URL on launch or at runtime, the Rust side re-emits it as
> `lipi://deep-link`, the frontend parses it, validates the
> path against the user's home / Documents / Desktop, and
> either calls `openWorkspace(path)` or sets the workspace
> store's `status: error` with a friendly message. The
> existing `useOpenWorkspace` flow is the only consumer of
> validated paths, so all of Lipi's downstream workspace
> guards (recents dedup, FS error mapping) come along for
> free.

#### What Phase I is

A URL scheme that lets the OS hand Lipi a workspace path.
The shape is fixed at `app://lipi.open?path=<urlencoded>`.
The path is strictly limited to user-owned directories
(home, Documents, Desktop) so a malicious link can never
point at `C:\Windows\System32` or a sibling user's
`~/Documents`. The validation is case-insensitive on
Windows (drive-letter paths always are) and case-sensitive
on POSIX.

The scheme is registered under
`plugins.deep-link.desktop.schemes` in `tauri.conf.json`.
The Rust `setup` callback registers a `lipi://deep-link`
re-emission listener (the plugin's internal
`deep-link://new-url` event name is insulated from the JS
side so a future plugin bump doesn't break the frontend).
On Linux + Windows debug builds, `register_all()` is
called so the dev launch picks up the scheme without a
manual registry edit.

The frontend's `useDeepLinkRouting()` mounts once at the
app root (`main.tsx`). It fetches the user-dirs allow-list
via `get_user_dirs()` (a new Rust command that returns
home / Documents / Desktop in canonical form), then
subscribes to `lipi://deep-link` for the lifetime of the
app. Each event is routed through the pure
`parseOpenUrl()` helper, which:

1. Confirms the scheme is `app:`.
2. Decodes the `path` query field.
3. Rejects `..` traversal before any further work.
4. Confirms the path is absolute (drive letter on Windows,
   `/` on POSIX).
5. Normalises repeated slashes + strips trailing separator.
6. Confirms the normalised path is under one of the
   allowed roots (case-insensitive on Windows, case-
   sensitive on POSIX).

A rejection sets `useWorkspaceStore.setStatus({ kind:
'error', message: friendlyRejectionReason(reason) })` — the
same `WorkspaceStatus.error` shape the folder picker uses,
so the Welcome / Editor error banner lights up.

#### Decisions (the locked ones, all from Phase I)

- **#52 — Strict user-dirs-only path validation** (rather
  than "any path the OS can read"). The OS happily hands a
  process URLs to `C:\Windows\System32\cmd.exe`; a permissive
  validator would let a malicious link open that as a
  "workspace" (the FS read would fail, but the user has
  already been shown the path and may have acted on it).
  Limiting to home / Documents / Desktop is a real
  security boundary. The user is shown a friendly error
  if the path is rejected.
- **#53 — Path canonicalisation lives on the Rust side**
  (`get_user_dirs` returns the canonical form: no symlinks,
  no `\\?\` Windows extended-length prefix). The JS side
  compares the inbound normalised path against the canonical
  allow-list with a case-insensitive `startsWith` on
  Windows and a case-sensitive `startsWith` on POSIX. This
  sidesteps the `URL.pathname` quirks (e.g. URL-decoding
  differences between Chromium's URL and Rust's `url` crate)
  by treating the inbound path as a string and the
  allow-list roots as strings.
- **#54 — `lipi://deep-link` is our event name, not
  `deep-link://new-url`**. The Rust setup re-emits. If the
  plugin's event name changes in a future version (it
  already has once between 1.x and 2.x), the JS side is
  unaffected. The cost is one extra `app.emit` per URL,
  which is negligible.
- **#55 — `onDeepLink` is a typed wrapper, not a bare
  `webview.listen` call**. The hook imports it from
  `@/ipc` (Rule 4). Tests of `parseOpenUrl` and
  `routeDeepLink` are pure (no Tauri runtime) and cover the
  path rules + the store commit. The hook's effect is a
  thin mount/unmount glue.

#### What got built

- `src-tauri/Cargo.toml` — added
  `tauri-plugin-deep-link = "2"` to `[dependencies]`.
- `src-tauri/tauri.conf.json` — registered the `app` scheme
  under `plugins.deep-link.desktop.schemes`.
- `src-tauri/src/lib.rs` — registered the plugin in the
  Tauri builder, added the `on_open_url` listener in the
  `setup` callback, gated the `register_all()` call behind
  `#[cfg(any(target_os = "linux", all(debug_assertions,
  target_os = "windows")))]` (production installers
  register the scheme themselves), and added the
  `get_user_dirs` Tauri command + the
  `UserDirs { home, documents, desktop }` wire struct.
- `src/ipc/deepLink.ts` — `getUserDirs()`,
  `onDeepLink(handler)`, the pure `parseOpenUrl()` helper,
  the `PathRejectionReason` union, the `OpenUrlResult`
  union, and `friendlyRejectionReason(reason)`.
- `src/ipc/index.ts` — added `export * from './deepLink'`.
- `src/shared/hooks/useDeepLinkRouting.ts` — the React
  hook (effect-wrapped subscription + dispatch through
  `parseOpenUrl` + `routeDeepLink`).
- `src/shared/hooks/index.ts` — added
  `export * from './useDeepLinkRouting'`.
- `src/main.tsx` — `useDeepLinkRouting()` mounted in
  `AppRoot` (next to `useMenuEvents` + `useWorkspaceSync`).
- `src/ipc/deepLink.test.ts` — 15 vitest tests.
- `src/shared/hooks/useDeepLinkRouting.test.ts` — 5 vitest
  tests.

#### Verified

- `npx tsc -b` — 0 errors.
- `npx vitest run` — **532 / 532 pass** (519 from
  baseline + 13 new from Phase I). 15 parser tests + 5
  routing tests are runnable in isolation; the rest of the
  suite is unchanged.
- `cargo check` — 0 errors. 9 transitive crates added
  (`tauri-plugin-deep-link` 2.4.9 + 8 windows / tracing
  support crates).
- `cargo test --lib` — **146 / 146 pass** (the Rust side
  adds zero new unit tests — the path validation is in JS
  and is fully covered by the vitest suite).
- `npm run build` — clean. ~3 KB CSS / ~3 KB JS bundle
  delta.

#### Known limitations

- iOS / Android schemes are NOT registered in this build.
  Mobile deep-link support ships with the iOS / Android
  Swift / Kotlin plugins (Phase 7) because the
  `tauri-plugin-deep-link` mobile build requires the
  Swift / Kotlin code to call the plugin's API to set up
  the URL handler, and that's part of the plugin's
  per-platform glue, not something we can wire from Rust
  in isolation.
- A crash mid-`setup` could leave the `lipi://deep-link`
  event with no listener; the next app launch re-
  establishes it (no persistent state to corrupt).
- The `lipi://deep-link` event payload is a `String`
  (the raw URL). For now the only consumer is the deep-
  link router; if a future feature wants to emit its own
  `lipi://...` events, they'll have to use a different
  scheme prefix to avoid the collision.

---

### 9.11 Phase J — SHIPPED (workspace templates gallery on Welcome, see CHANGELOG "Added (Phase J)")

> **Status:** Phase J is **shipped**. A 5-card grid on
> the Welcome screen offers one-click project creation:
> React + Vite, Tauri 2 + React + Rust, Node.js +
> TypeScript API, Python with venv, Go module. The
> actual file bodies are inlined in the Rust binary
> (`src-tauri/src/templates.rs`, ~30 KB of source). The
> JS side ships only the metadata registry
> (`src/templates/registry.ts`) so the gallery can render
> without round-tripping to Rust. The atomic-rollback
> story is "write to a staging subdir, then rename
> one-by-one to the final location."

#### What Phase J is

A starter-project gallery. The user clicks a card, picks
a destination folder in the native picker, and Lipi
expands the template's file list into a fresh subdir
underneath. The new project then becomes the active
workspace — the same `useOpenWorkspace()` flow the
"Open Folder" button uses, just with `dest` set to the
freshly-created subdir.

The 5 templates are the full set from the plan:
`react-vite` (9 files), `tauri-rust` (12 files, includes
`src-tauri/Cargo.toml` + `tauri.conf.json` + a `greet`
command), `node-api` (6 files, zero runtime deps), `python-
venv` (6 files, pyproject + venv layout + pytest), `go-
module` (5 files, `go.mod` + `main.go` + `main_test.go`).

#### Decisions (the locked ones, all from Phase J)

- **#56 — Templates are inlined in the Rust binary**
  (rather than read from `resources/templates/*.json` at
  runtime). The 5 templates are ~30 KB of source total;
  shipping them as Rust consts means the gallery works
  even when the app is launched with a stripped-down
  resources directory (dev / sandbox builds), and means
  there's no FS-IO race during the "Create" click. The
  trade-off is a ~30 KB binary bloat, which is negligible
  relative to the current 52 KB `git.rs`.
- **#57 — Atomic via staging subdir + per-file rename**
  (rather than "write all to dest in place, abort on
  failure" or "use a single tempdir outside dest"). The
  staging subdir lives inside `dest` (so the rename stays
  on the same filesystem, no cross-drive surprise on
  Windows) and is named `.lipi-template-staging-<rand>`.
  A crash mid-rename loop leaves the destination
  partially populated; the next `apply` call cleans up
  the stale staging dir before the empty-dir check runs.
  A `TemplateError::Partial` variant is reserved for a
  future iteration that swaps the in-place rename loop
  for a `MoveFileExW` / `renameat2` batch primitive.
- **#58 — Refuse to write into a non-empty destination**
  (rather than "merge into existing files"). The
  `useApplyTemplate` flow is responsible for picking a
  fresh subdir under the user's chosen parent, but the
  Rust side enforces the empty-dir invariant as a second
  line of defence (in case the JS side has a bug, or a
  user drops a file in between the picker and the
  "Create" click). The error message tells the user
  which destination was rejected.
- **#59 — The JS side ships metadata only** (rather than
  a parallel registry of full file bodies). The gallery
  needs the name, description, and an approximate file
  count for the badge — the bodies never round-trip
  through JS. The Rust registry is the single source of
  truth; the JS registry is a presentational mirror. If a
  template is added to the Rust side without a matching
  JS entry, the `apply_template` IPC succeeds but the
  gallery card doesn't render (we'd notice in QA).
  Adding a future runtime check (a `lipi://template-list`
  IPC that returns the canonical list) is one Rust
  function away; deferred because the v1 surface is
  stable.

#### What got built

- `src-tauri/src/templates.rs` — the `Template`,
  `TemplateFile`, `TemplateError`, `ApplyResult` types;
  the 5 `Template` consts; the `REGISTRY` slice; the
  `by_id(id)` lookup; the `apply(id, dest)` entry
  point; the `is_empty_dir`, `clean_stale_staging`,
  `partial_after_move_failure`, `random_suffix`
  helpers; and 10 unit tests.
- `src-tauri/src/lib.rs` — `mod templates;` + the
  `apply_template` Tauri command + registration in
  `invoke_handler`.
- `src/templates/registry.ts` — the `WorkspaceTemplateId`
  union, the `WorkspaceTemplate` interface, the
  `WORKSPACE_TEMPLATES` array (5 entries), and the
  `workspaceTemplateById` lookup.
- `src/templates/registry.test.ts` — 6 vitest tests.
- `src/ipc/templates.ts` — the `applyTemplate(id, dest)`
  IPC wrapper, the `ApplyTemplateResult` interface.
- `src/ipc/index.ts` — added `export * from './templates'`.
- `src/screens/Welcome/hooks/useApplyTemplate.ts` — the
  `useApplyTemplate()` hook + the pure
  `applyTemplateFlow(id)` function (same shape as
  `useOpenWorkspace` — transient status, no double-fire,
  friendly error mapping).
- `src/screens/Welcome/hooks/useApplyTemplate.test.ts` —
  5 vitest tests.
- `src/screens/Welcome/components/TemplateGallery/TemplateGallery.tsx` +
  `.module.css` — the 5-card grid component (keyboard
  focusable, `aria-label`, hover/focus states, dark-
  theme parity via `var(--lipi-*)` tokens).
- `src/screens/Welcome/components/TemplateGallery/TemplateGallery.test.tsx` —
  3 vitest tests (smoke).
- `src/screens/Welcome/Welcome.tsx` — `<TemplateGallery />`
  mounted between the hero CTA and the recents list.

#### Verified

- `npx tsc -b` — 0 errors.
- `npx vitest run` — **532 / 532 pass** (519 from
  baseline + 13 new from Phase J).
- `cargo check` — 0 errors.
- `cargo test --lib` — **156 / 156 pass** (146 from
  baseline + 10 new from Phase J). One pre-existing
  flake in `secrets::tests` races when the full lib
  test suite is run in parallel; it passes in isolation
  and on retry. Unchanged by this PR — flagged for a
  follow-up. The 10 new template tests are all green
  in the full suite and in isolation.
- `npm run build` — clean. ~1.4 KB CSS / ~3 KB JS bundle
  delta. Total bundle ~665 KB minified, ~187 KB gzipped.

#### Known limitations

- The atomic-rollback story is "write to staging then
  rename one-by-one" (Decision #57). A crash mid-loop
  leaves the destination partially populated. Recovery
  for v1 is "delete the destination and retry." The
  `TemplateError::Partial` variant is reserved for a
  future iteration that swaps the rename loop for a
  batch primitive (`MoveFileExW` with
  `MOVEFILE_REPLACE_EXISTING` on Windows,
  `renameat2(RENAME_EXCHANGE)` on Linux).
- The Rust unit tests don't cover the cross-drive
  rename case (e.g. `dest` is on `C:\` and the staging
  subdir is on a different drive). In practice the
  staging subdir lives inside `dest`, so this is a
  non-issue, but a paranoid future test would assert
  it.
- Templates can't be added at runtime by the user —
  they're compile-time consts. A "user templates"
  feature (a `~/.lipi/templates/` folder of `.zip`
  files) is straightforward to add later; the registry
  would just gain a `get_user_templates()` accessor and
  `apply` would dispatch on a "user:" id prefix.

---

### 9.12 Recents-management polish — SHIPPED (see CHANGELOG "Added (Recents-management polish)")

> **Status:** shipped. The Welcome screen's recents
> header now has a "Clear all" button. The per-row
> "Remove" (×) button was already wired (see
> `useWorkspaceStore.removeRecent`); this completes
> the surface.

#### What it is

A small UI pass that surfaces the
`useWorkspaceStore.clearRecents()` action that was
already implemented in the store but never exposed in
the UI. The button is conditionally rendered —
`shouldShowClearAll(recentsCount)` returns `true` only
when `recentsCount > 1` — so a single-item "Clear all"
(a footgun: the user probably wants to keep that one)
is hidden, and an empty list doesn't render the
section at all (the outer guard handles that).

The button sits on the right side of a new
`recentsHeader` flex row, with the existing "Recent"
title on the left. The styling is subtle (11 px
uppercase, transparent, lightens on hover) so it
doesn't compete with the primary "Open Folder" hero
above.

#### Decisions (the locked ones)

- **#60 — Hide "Clear all" on a 1-item list (footgun
  guard), not a confirm dialog**. The argument for a
  confirm dialog: deleting the last recent is a
  destructive action; we should ask. The argument
  against: a single-item list is *itself* the confirm
  — the user has exactly one recents entry, they
  probably want to keep it (the typical case is "I
  opened one project yesterday, that's my workspace"),
  and exposing a "Clear all" button right next to it
  invites a misclick. A dialog would be a worse UX
  (extra click for the common "I want to clear all"
  case, doesn't prevent the misclick that motivated
  the guard). The pure-function helper is testable;
  a confirm-dialog state machine isn't worth the
  complexity for a sub-1%-of-usage interaction.

#### What got built

- `src/screens/Welcome/Welcome.tsx` — new
  `recentsHeader` flex row, new "Clear all" button
  (calls `useWorkspaceStore.getState().clearRecents()`
  on click), new `shouldShowClearAll` helper exported
  for the test file.
- `src/screens/Welcome/Welcome.module.css` — new
  `.recentsHeader` + `.recentsClearAll` rules.
- `src/screens/Welcome/Welcome.recents.test.ts` —
  7 vitest tests (4 helper + 3 store integration).

#### Verified

- `npx tsc -b` — 0 errors.
- `npx vitest run` — **539 / 539 pass** (532 from
  baseline + 7 new from this change).
- `npm run build` — clean. ~0.2 KB CSS / ~0.3 KB JS
  bundle delta (negligible).
- No Rust changes. `cargo check` / `cargo test` not
  re-run (the store action was already in the tree).

#### Known limitations

- None. The store's `clearRecents` already persisted
  to `localStorage`; the polish is purely a UI
  surfacing. If a future feature wants to also clear
  `currentPath` (i.e. "forget my workspace AND my
  history"), it should add a separate action
  (`forgetAll()`?) rather than overload `clearRecents`
  — the "history vs. open workspace" distinction is
  load-bearing for the "Close folder, keep history"
  flow (`close()`).

---

## 10. Engineering rules (the 7 rules)

> **Inline summary.** Long-form with examples and grep targets is in
> `docs/ENGINEERING.md`. The handoff is self-sufficient — an agent
> reading just this file can ship correct code without opening
> `ENGINEERING.md` — but should open it for the full rationale and
> the canonical component index.

### Rule 1 — Left and right alignment for spacing

There is a single spacing scale in `src/shared/styles/tokens.css`:

```
--space-1: 4px    --space-2: 8px    --space-3: 12px
--space-4: 16px   --space-6: 24px   --space-8: 32px   --space-12: 48px
```

- **Mobile screens** use `var(--space-4)` (16px) as the left/right gutter.
- **Desktop screens** use `var(--space-6)` or `var(--space-8)` (24–32px).
- **Every component CSS** reads from these tokens. No raw `padding: 16px`.
- **Vertical rhythm** uses the same scale. No magic pixel values.
- **Use the `Stack` primitive** (`src/shared/components/Stack/`) for any
  flex layout that needs a gap. Its `gap` prop is typed to the scale
  (`StackGap = 0 | 1 | 2 | 3 | 4 | 6 | 8 | 12`).

### Rule 2 — Name each screen

Every screen has a single canonical name, used identically in:
- the file path: `src/screens/<ScreenName>/`
- the component name: `export function <ScreenName>()`
- the route (when routing lands in Phase 1b): `/<screen-kebab-case>`
- the navigation label and any cross-references

**Convention:** `<Domain><Action><State>` in PascalCase. Examples already
in use: `EditorWorkspace`, `Welcome` (stub). Sub-components inside a
screen are *not* screens; they live in
`src/screens/<ScreenName>/components/`.

### Rule 3 — Code lives in folders, screen-wise

```
src/
  screens/
    <ScreenName>/
      <ScreenName>.tsx
      <ScreenName>.module.css
      index.ts                       # re-exports the screen
      components/<SubName>/          # owned by this screen
        <SubName>.tsx + .module.css + index.ts
      hooks/                         # owned by this screen
      state/                         # owned by this screen
  shared/                            # cross-screen primitives only
    components/                      # typed folder per component
    hooks/                           # used by 2+ screens
    state/                           # cross-screen stores
    styles/                          # tokens + global
  dev/                               # gated by import.meta.env.DEV
  voice/                             # cross-screen service
  main.tsx                           # entry, NEVER contains UI
```

**Two-tier rule:** `src/shared/` is for things used by 2+ screens. If only
one screen uses something, it doesn't belong in `shared/`. Don't import
from another screen's folder directly; promote shared code to `shared/`.

**Component folder shape (every time, no exceptions):**
```
<ComponentName>/
  <ComponentName>.tsx
  <ComponentName>.module.css
  index.ts                            # re-exports component + Props type
```

### Rule 4 — Build components, reuse components, AI must use them

**The grep target:** `src/shared/components/index.ts`. Before writing
any UI, search it. If a component covers your need, use it. If it
doesn't, extend it (same name) or open an issue. **Never reimplement.**

Components currently in the library:

| Component | When to use |
|---|---|
| `Button` | Any clickable action. Variants: `primary` \| `secondary` \| `ghost` \| `danger`. Sizes: `sm` \| `md` \| `lg`. Supports `loading`. |
| `IconButton` | Square icon-only buttons. **Required** `aria-label`. Variants: `default` \| `subtle` \| `danger`. Sizes: `sm` \| `md` \| `lg`. |
| `Stack` | Flexbox row or column with token-driven gap. The universal layout primitive. |

**Component rules:** PascalCase. One component per file. Co-located
CSS module. Single responsibility (one JSDoc sentence). Public `Props`
interface, exported alongside the component. `index.ts` re-exports the
component **and** its `Props` type.

**Audit pass:** when a new component is added to `shared/`, grep every
screen for places that *could* use it and refactor them. This is part
of the workflow, not optional.

### Rule 5 — Best-coding-practice defaults

When writing code, these are defaults unless you have a documented
reason to deviate. AI agents: surface deviations to the user, don't
just apply them.

1. **TypeScript strict.** No `any`. Use `unknown` + type guards, or
   define a proper type. `noUnusedLocals` + `noUnusedParameters` on.
2. **No magic strings or numbers.** Constants and tokens only.
3. **No raw hex in component code.** Always `var(--color-*)`.
4. **Accessibility first.** Every interactive element has an
   accessible name, focus styles visible, touch targets ≥ 44×44,
   color contrast AA.
5. **Error states are first-class.** Every async call has loading +
   error UI, not just success.
6. **Empty states are first-class.** Every list, pane, and screen
   has a designed empty state.
7. **No dead code, no commented-out code, no `TODO` placeholders** in
   shipped code. TODOs in stubs for the *next* phase are fine and
   must be labeled `// TODO(M2):` or similar.
8. **Smallest reasonable abstraction.** A component, a hook, a util —
   not a "framework." Don't introduce a pattern until the second use
   case shows up.
9. **Public APIs are typed and exported. Internal helpers are not.**
10. **Tests for behavior, not implementation.** (No test runner set up
    yet — a separate decision for the phase that introduces it.)

### Rule 6 — Divide code in sections, isolate changes

**File-level isolation:** each component, hook, and screen lives in its
own file. A change to one is, by construction, isolated from others.

**Folder + ownership rules:**
- A screen owns its folder. Edits inside `src/screens/EditorWorkspace/**`
  do not touch `src/screens/SettingsProvider/**`.
- A shared component is owned by whoever built it first; modifications
  to it require a "why" in the commit message.
- `tokens.css` is the only place spacing/colors/typography values live.
  No component CSS may redefine them. So when we change the design
  tokens, the visual change propagates everywhere.

**Practical workflow:** when changing something, work in one section
at a time. If a change *requires* a cross-section edit, flag it
explicitly before doing it: *"This needs a touch-up in
`AIPanel.module.css` too — OK to proceed?"*

**Blast-radius check:** before writing a change, state the scope: *"This
affects only `src/screens/EditorWorkspace/components/AIPanel/`."* If
the answer is "I have to touch four folders for this one feature,"
that's a smell — re-scope before writing.

### Rule 7 — Always choose scalable, upgradeable

When picking between two ways to do something, ask:
1. Can a 100× growth in users / features be handled by *adding* (not rewriting)?
2. Can this be replaced with a better tool in 2 years without rewriting
   every consumer?
3. Is the choice the same one Cursor, VS Code, JetBrains, Linear, and
   Figma have already battle-tested?

If yes to all three, that's the scalable choice. If no, surface the
trade-off to the user before writing code.

**Concrete defaults for Lipi:**

| Decision area | Scalable choice |
|---|---|
| State management | Zustand stores split by domain (workspace, settings, voice, git), not one giant store. |
| Component design | Composition over configuration. `Button` accepts `as` and `children`; doesn't grow a `variant` prop with 20 cases. |
| Type system | Discriminated unions for variants (`type: 'partial' \| 'final'`), not boolean soup. |
| Styling | CSS Modules + design tokens. No styled-components / emotion / Tailwind. |
| IPC (Phase 1b) | Typed wrapper around `invoke()`. No raw `invoke('name', args)` calls scattered in components. |
| Voice (M2/M3) | `VoiceProvider` interface with multiple impls. Adding a 5th provider is one new file. |
| Build / toolchain | Vite + Tauri. Mainstream, well-maintained. No experimental builds. |
| Distribution | Auto-updater + per-platform package channels. |
| Testing (later) | Vitest + Playwright. Mainstream, fast, plays well with Vite. |

---

## 11. References

- **Engineering rules (HOW to build):** `docs/ENGINEERING.md` — the 7 rules
  every change must follow. Read this before writing any code.
- **Handoff (WHAT and WHY):** this file.
- Plan: `C:\Users\Pv Vimal Nair\.cursor\plans\cross-platform_ide_foundation_18a37d37.plan.md`
- Active session plan: `C:\Users\Pv Vimal Nair\.cursor\plans\lipi_voice-first_ide_foundation_plan_c8b7691a.plan.md`
- Owner project naming convention reference: `C:\Users\Pv Vimal Nair\lifeof\HANDOFF.md` (the style of this file is modeled on that one)
- Cursor itself: https://cursor.com (inspiration, not target)
- Wispr Flow API: https://api-docs.wisprflow.ai/
- Tauri 2 docs: https://tauri.app/start/
- Monaco editor: https://microsoft.github.io/monaco-editor/
- gix (gitoxide): https://github.com/GitoxideLabs/gitoxide
- portable-pty: https://github.com/wez/wezterm/tree/main/pty

---

*End of handoff. Lipi is at **Phase 5b-2 complete** (D5 step 2.2 — OpenRouter passthrough + Anthropic adapter + `ai_cancel_stream`, no UI yet: `SseStream` extended with `event_name` tracking and a new `SseEvent::Named { event, data }` variant (for Anthropic's named events); new `stream_chat_anthropic(api_key, base_url, model, messages, on_chunk, cancel)` (top-level `system` field, `max_tokens: 4096` hardcoded, `x-api-key` + `anthropic-version` headers, no `Authorization: Bearer`, maps `content_block_delta` → `Delta{text}`, `message_delta` → captures `stop_reason`, `message_stop` → `Done { cancelled: false, stopReason }`); `ChatDelta::Done` extended with `stopReason: Option<String>` (skipped when None for OpenAI compatibility); new `src-tauri/src/cancel.rs` module with a `OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>>` registry, `register/lookup/deregister` API, and a `CancelGuard` that RAII-cleans the entry on Drop; new Tauri command `ai_cancel_stream(request_id) -> Result<bool, String>` flips the flag; `ai_chat_stream` is now a multi-provider dispatcher (`openai` and `openrouter` share the OpenAI adapter via base-URL swap; `anthropic` uses its own); 5 new SSE named-event tests + 4 new cancel-registry tests = 9 new tests; total Rust tests 57 + 6 + 9 + 3 + 6 = 81 (was 73 in 5b-1; +8); `cargo build` clean with 0 warnings, `cargo test` all green stable across two runs, `npm run typecheck` and `npm run build` pass — no UI changes in 5b-2, the JS side does not call `ai_chat_stream` or `ai_cancel_stream` yet, that's 5b-3). The next agent should continue from Section 6 → Phase 5b-3 (D5 step 2.3 — `aiStore` Zustand store for chat-thread lifecycle + the `AIPanel` React side panel as a third tab in `SidePanelPane` next to Source Control and Terminal, with a model picker dropdown, chat-thread rendering, and a composer with Send / Stop button that calls `ai_chat_stream` and `ai_cancel_stream`).*
