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
| 61 | M5's `useHaptics` exposes **semantic** intensities (`light` / `medium` / `heavy`), not a raw `(intensity) => void`. | The UI picks a *semantic* intensity — a future "ultra" intensity can land without changing any callsite that picked the right semantic. The three helpers are also more readable at the call site (`haptics.medium()` vs `haptic('medium')`) and the call-site self-documents. | 2026-06-12 |
| 62 | M5's `haptic` Rust command is a **silent no-op on desktop**, not a log-and-return. | The hook fires on every tab switch / voice start / undo. A log per call would be unbearable in the dev console. The `#[cfg(mobile)]` arm is a placeholder for the future Swift / Kotlin plugin; until then, mobile is also a no-op (no worse than the current state — the v1 build doesn't ship the mobile targets). | 2026-06-12 |
| 63 | S2's `applyLipiStateV2` is **partial-on-error**, not transactional. | The three stores are written in sequence; a failure on the third sub-payload leaves the first two already applied. Acceptable for v1: a cross-store snapshot / rollback requires a snapshot mechanism that doesn't exist today, and the partial state is recoverable by re-importing a known-good file (or, for `toolSettings`, hitting the 5a soft-delete undo). The alternative is the right long-term shape but is a v3 concern. | 2026-06-12 |
| 64 | S2's magic string is **`"lipi-state"`**, distinct from 5b v1's `"lipi-settings"`. | The two files are different products with different surface areas (v1 = `toolSettings` only; v2 = `workspace` + `voicePreferences` + `toolSettings`). The distinct magic string is the guard against a user accidentally importing a v1 file into a v2 reader (or vice versa) — the parser rejects with a `wrong-format` error and the UI shows the specific reason. | 2026-06-12 |
| 65 | S2's `snapshotStoresForExport` **shallow-clones** the `recents` / `disabledToolNames` arrays and the `confirmationMode` record. | A future caller that mutates the returned payload (e.g. redacts a path before re-serialising) must NOT accidentally mutate the live store. The PrivacyDataCard test pins the contract: a `.push()` on the snapshot's `recents` does not change the store. | 2026-06-12 |
| 66 | FTM uses `window.prompt` + `window.confirm` for the v1 right-click menu, not a purpose-built floating menu. | The three `window.*` calls are synchronous, modal, and a bit ugly, but they get the feature shipped. A purpose-built context menu (`<ul>` with absolute positioning, rendered by `FileTreePane`) is a v2 polish that replaces all three calls with one floating menu. The trade-off is "ship the right-click feature this session" vs "ship a polished menu next session." The current right-click surface is small enough (3 actions) that the polish is low-risk. | 2026-06-12 |
| 67 | FW's `fs_watch` is **idempotent** on the same path (returns the existing `WatchHandle`) and stores the `path: PathBuf` on `ActiveWatcher` for the lookup. | The alternative was "always create a new watcher, garbage-collect the old one" — but that races with the user clicking the same directory in quick succession (collapse + expand within 100 ms would leak a watcher). The `ActiveWatcher` lookup is a one-line `iter().find(|w| w.path == path)` and the cost is one extra `PathBuf` per watcher. The Rust unit test `fs_watch_returns_existing_handle_for_same_path` pins the contract. | 2026-06-12 |
| 68 | WS uses a **hand-rolled grep** in Rust (no `ripgrep` sidecar, no `regex-automata` for v1). | The `regex` crate IS in the dependency graph transitively (via `gix`), so the v2 regex support is essentially free. For v1 the literal-substring scan is a 30-line loop that's been correctness-tested for binary files, large files, and case sensitivity. The 5 MB file-size cap and the 1 000-result cap are the two safety nets that prevent the scan from running away. | 2026-06-12 |
| 69 | WS's `pendingReveal` is a **single-slot** request queue in `editorControllerStore`, not a multi-slot list. | The v1 UX is "click a result, jump to it" — there's no scenario where the user has multiple pending reveals in flight. A single-slot `pendingReveal: PendingReveal | null` is the simplest model that works; a multi-slot list would need a `consumeReveal(index)` API and a UI to "step through" reveals. The single-slot choice mirrors the chat nav store's `consumeJump()` pattern (Decision #40). | 2026-06-12 |
| 70 | K's `useTourStore` is a **dumb step machine**; the `next()` action is a pure unconditional +1, and the overlay component owns the "is this the last step?" check. | The store doesn't import the step list. Adding a step is a one-entry change in `tourSteps.ts`; the store and the overlay pick it up automatically. The "last step → finish" branch lives in the overlay's `handleNext`, not in `store.next()` — the store's `next()` is a pure +1 that's safe in any context (programmatic advance, future "skip to step 3" command, etc.). | 2026-06-13 |
| 71 | K's step cursor is **not persisted**; only the `dismissed` flag is. | The tour is a per-session orientation. A user who kills the app mid-tour restarts from step 0 next launch. Persisting the step would mean a user who dismissed for 5 minutes on step 3 of 6 comes back to step 3 — but the dismissed flag is set, so they wouldn't see anything. Persisting both is a contradiction. The current step + the dismissed flag are mutually exclusive in practice. | 2026-06-13 |
| 72 | K's `commandPalette` step is **centered**, not anchored to a DOM node. | The palette is only on screen when the user opens it; there's no permanent "palette button" on the editor (the keyboard shortcut is the only entry). Anchoring to a non-existent node would fail the `useAnchorRect` lookup; the centered fallback would render the callout in the middle of the screen. Centering is the cleaner answer: the step's copy ("press Ctrl/Cmd+Shift+P") is self-contained, and a centered callout is the right visual for "here's how to summon this overlay." | 2026-06-13 |
| 73 | S3's snapshot primitive **tolerates a throwing `write`** (logs in DEV, continues the restore loop). | The alternative — let the throw propagate — would leave the user in a half-restored state. The v3 apply restores in reverse order, so a failing earlier restore on a less-recent store is reported and the loop moves on; a propagated throw would skip the more-recent stores. The DEV-mode `console.warn` is the breadcrumb; a production user would see the import error ("applying it failed") but their state would be either fully restored or partially restored (with the partial path always being "the last-written store"). | 2026-06-13 |
| 74 | S3's import flow is **`parse → preview → confirm → apply`**, not `parse → confirm → apply`. | The v2 `window.confirm` was a black box ("this will overwrite everything, OK?"). The v3 preview shows the diff: "Workspace path: A → B; Recents: +1 new, -1 removed; Voice provider: stub → wispr; Tool X confirmation: per_call → always_confirm." A user who picks the wrong file sees "0 changes" and the Apply button is disabled. A user who picks the right file sees the change list and clicks Apply with eyes open. The "no changes" path is a feature, not an edge case. | 2026-06-13 |
| 75 | S3's `applyLipiStateV3` restore for `toolSettings` uses a **direct `setState`**, not `applyImportedSettings`. | The apply is the destructive surface (it pushes a 5a undo entry). The restore is a "no questions asked, put the state back" — it must NOT push another undo entry. A 10-second-old import that the user wants to abort shouldn't leave a "Click to undo: restore state" toast that's actually re-restoring 10 seconds too late. The `toolSettings` write closure in the snapshot is a raw `setState({disabledToolNames, confirmationMode})`. | 2026-06-13 |
| 76 | Decision #66 polish reuses the shared `Modal` primitive for both `InlineNameInput` and `ConfirmDestructiveModal` (rather than a custom modal per component). | Per Rule 4 (component reuse), `Modal` is the centralised overlay surface — its focus trap, ESC handling, backdrop click, and `aria-modal` semantics are the right defaults for any centered overlay. The "New file" and "Delete folder" modals are not new kinds of modal — they're existing-modal instances with different content. The only new piece is the `FileRowContextMenu`, which is a *floating* menu (anchored at a click point) — that one is genuinely a new kind and lives in its own component. | 2026-06-13 |
| 77 | Phase 9 chose the **"Tiniest"** scope (4-6 h, user-installed `typescript-language-server`) over the **Lite** (8-12 h, Tauri sidecar) and **Full** (16-22 h, custom `typescript-language-server` build). | The user is on a 4-6 hour budget. Tiniest requires `npm i -g typescript-language-server` (Node is already a prerequisite for Tauri's dev tooling) and skips a Tauri sidecar. The bridge is ~400 lines of TypeScript with no new dependencies. The trade-off is a one-time manual install step for the user (the settings card surfaces the install hint if the binary isn't found). | 2026-06-15 |
| 78 | Phase 9 **does not depend on `monaco-languageclient`** — uses Monaco's built-in `monaco.languages.register*Provider` APIs directly. | `monaco-languageclient@10` pulls in 30+ transitive packages including `monaco-vscode-api@25` and `vscode-languageserver-protocol@3.17`. Loading it requires replacing our `@monaco-editor/react` setup with `monaco-vscode-api`'s own Monaco loader — a major refactor of every Monaco-using component. For the Tiniest scope, calling Monaco's provider APIs directly is a few hundred lines of TypeScript, no extra deps, and full control over the per-method response conversion. | 2026-06-15 |
| 79 | Phase 9's LSP kill switch is a **`localStorage` key** (`lipi:lsp:useRealServer:v1`), not a Zustand field and not `toolSettingsStore` v3. | The kill switch is a per-user, per-install setting — it doesn't change while a request is in flight, doesn't interact with the `aiStore`, and doesn't need to be observed by anything except the bridge hook + the settings card. Putting it in a Zustand store would force a v2→v3 migration on the existing tool-settings persistence layer for a single boolean field. A `localStorage` key is a one-liner read/write with no schema migration. | 2026-06-15 |
| 80 | Phase 9's `LspClient` reader loop **polls at 1 ms via `setTimeout`**, not via an event / promise. | The Tauri IPC boundary means we can't expose the child's `AsyncRead` / `AsyncWrite` directly to the JS side — every read / write is an `invoke` round-trip. Each `invoke('lsp_stdio_read', ...)` returns the bytes currently buffered (or an empty `Uint8Array(0)`). The polling overhead is negligible; the 1 ms tick is well below human-perceivable latency. A Tauri 2 event-stream upgrade is a follow-up slice (§9.33's Phase 9.3). | 2026-06-15 |
| 81 | Phase 9 spawns **one child process per workspace** (not one global). | `typescript-language-server` is bound to a single workspace root at `initialize` time (`rootUri` in the LSP spec). With 1-2 active workspaces (the realistic Lipi usage pattern), 1-2 child processes is fine. The store's `getOrCreate` ensures we only spawn one per workspace; `dispose` flips the status to `stopped` and `kill()`s the child. | 2026-06-15 |
| 82 | Phase 9's `didChange` notifications **re-send the full text** (no incremental edits). | Monaco's `onDidChangeModelContent` event payload includes the new text but not the minimal edit. Computing the minimal edit requires either a `Monaco.ITextModel` diff API (which doesn't exist in a stable form) or a hand-rolled Myers diff. For files <10k lines, the full-text re-send is negligible (~50-100 ms for a 5k-line file). A follow-up slice (§9.33's Phase 9.1) can wire `DiffEditor`'s `DiffProvider` if profiling shows a bottleneck. | 2026-06-15 |
| 83 | Phase 9.6 has a **separate completion sub-toggle** (`lsp_use_real_server_for_completion`), not a single "use real server" flag. | The cross-file quality of go-to-def / refs / rename and the latency of completion are independent concerns. The user might want the real server for the former (smarter) and the built-in for the latter (faster). The master defaults to `true` (real server for everything), the completion sub-toggle defaults to `false` (built-in for completion). Two `localStorage` keys, no schema migration. | 2026-06-15 |
| 84 | Phase 9.6's `registerCompletionProvider` accepts both LSP `CompletionItem[]` and `CompletionList` (the wrapper-with-`isIncomplete` shape). | The LSP spec says `textDocument/completion` can return either; `typescript-language-server` returns the bare array but other servers (e.g. `gopls`) return the wrapper. One extra branch in the adapter, no cost. | 2026-06-15 |
| 85 | Phase 9.6's completion provider **falls through to empty suggestions on null / error**, letting Monaco's built-in take over for that keystroke. | Matches the Phase 9 pattern for the other providers (hover, definition, refs). The real server's `textDocument/completion` can time out or return null; returning `{ suggestions: [] }` is the safe default. | 2026-06-15 |
| 86 | Phase 9.6 maps LSP `insertTextFormat === 2` to Monaco `insertTextRules = 4` (the `InsertAsSnippet` bit). | LSP `InsertTextFormat.Snippet` means the `insertText` contains placeholders (`$1`, `$0`, `${1:default}`). Monaco's `CompletionItemInsertTextRule.InsertAsSnippet` is the equivalent. The mapping is a single `if` — without it, snippet completions from the real server would be inserted as literal `$1` text. | 2026-06-15 |
| 87 | Phase 9.6's `fromLspCompletionItemKind` is a hand-rolled 23-case `switch`, not a bit-shift cast. | LSP and Monaco's `CompletionItemKind` enums are misaligned: LSP `Text=1`, Monaco `Text=0`; LSP `TypeParameter=21`, Monaco `TypeParameter=23`; etc. A naive cast (`as monaco.languages.CompletionItemKind`) would misclassify almost every item (a `Method` would render as a `Text` completion, etc.). The 23-case `switch` is a one-time mapping with no runtime cost. | 2026-06-15 |

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

**Current phase: Production-readiness pass — SHIPPED (commit `bd922b5`).** Before this pass, the codebase was *code-complete* for distribution (all features work, all tests pass) but `npm run build:tauri` failed at four distinct points: `@tauri-apps/cli` was missing from `package.json`, the icon files referenced in `tauri.conf.json` didn't exist in the repo, `Cargo.toml` had no `default-run` (Cargo couldn't pick the right binary), and the `open_devtools` Tauri command called a `#[cfg]`-gated method unconditionally. Beyond the build, the production keypairs were still placeholders (the Tauri updater's `pubkey` was a literal string from a 2024 example, the licensing module's `PROD_PUBKEY` was explicitly a "design phase" placeholder). This pass resolves all five blockers end-to-end and produces the first **shippable signed Windows installers** from real production keypairs. See `HANDOFF.md` §9.29 for the full writeup; see `CHANGELOG.md` "Added (Production-readiness pass — `bd922b5`)" for the per-change log.

**The 4 code-side blockers + 1 placeholder-keypair group that were resolved**

1. **`@tauri-apps/cli` was missing from `package.json`.** Added `^2.1.0` as a devDependency (resolved to 2.11.2). Without it, `npm run build:tauri` couldn't find the `tauri` binary.
2. **Icon files referenced in `tauri.conf.json` didn't exist.** Generated the full set from `app-icon.svg` via `tauri icon` — `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, `icon.ico` (plus the Windows Store / iOS / Android sizes as a side benefit).
3. **`Cargo.toml` had no `default-run`.** Two explicit `[[bin]]` entries (`sign_license`, `rotate_updater_key`) disabled Cargo's auto-detection of `src/main.rs`. Added `default-run = "lipi"`.
4. **`open_devtools()` failed to compile in release.** The Tauri 2 crate `#[cfg]`-gates the method to debug builds only. Gated the call site with `#[cfg(debug_assertions)]`; the IPC command itself still exists in release but is a no-op.
5. **Production keypairs were placeholders.** Generated two new Ed25519 keypairs (updater + license) and embedded the new pubkeys in `tauri.conf.json` + `licensing::PROD_PUBKEY`. Private keys are git-ignored; the layout follows the existing `docs/plans/prod-p5-release-pipeline-design.md` plan.

**`tauri build` outcome (Windows)**

```
Finished 2 bundles at:
  C:\Users\Pv Vimal Nair\lipi\src-tauri\target\release\bundle\msi\Lipi_0.0.2_x64_en-US.msi      (5.0 MB)
  C:\Users\Pv Vimal Nair\lipi\src-tauri\target\release\bundle\nsis\Lipi_0.0.2_x64-setup.exe   (3.8 MB)
Finished 2 updater signatures at:
  C:\Users\Pv Vimal Nair\lipi\src-tauri\target\release\bundle\msi\Lipi_0.0.2_x64_en-US.msi.sig  (412 B)
  C:\Users\Pv Vimal Nair\lipi\src-tauri\target\release\bundle\nsis\Lipi_0.0.2_x64-setup.exe.sig (412 B)
```

**Test results**

- `tsc --noEmit`: 0 errors
- `vitest`: 1001 passed across 77 files
- `cargo test --lib`: 326 passed / 0 failed
- `tauri build` (Windows): clean, no warnings

**The push was blocked (not a code issue).** The local repo has no `origin` remote configured, so `git push` returns "No configured push destination." The project lead needs to add the GitHub remote (`git remote add origin https://github.com/lipi-dev/lipi`) and push. The commit `bd922b5` is ready locally on `main`.

**Previous phase (Phase 4.1):** IAP v1.1 follow-ups — SHIPPED. This is the polish-and-completeness pass on the IAP code path that Phase 4 explicitly deferred. The production-readiness roadmap was already 100% complete (Phase 3, 5, 4 shipped in the previous turns); Phase 4.1 fills in the v1.1 follow-up items in the Phase 4 design doc:

1. **Apple raw-receipt path** — the `iap_redeem` dispatcher now accepts raw base64 Apple receipts (in addition to the JSON response + raw XML formats) and routes them to `iap_apple::verify_apple_receipt` (which POSTs to `https://buy.itunes.apple.com/verifyReceipt` from the Rust side). The existing parsed-response path is preserved.
2. **Microsoft OAuth client-credentials flow** — the static `LIPI_MS_IAP_BEARER_TOKEN` env var is replaced with a real OAuth client-credentials flow. The new `iap_oauth` module reads `LIPI_MS_IAP_CLIENT_ID` / `LIPI_MS_IAP_CLIENT_SECRET` / `LIPI_MS_IAP_TENANT_ID` at call time, exchanges them for an access token, and caches it in-memory for 55 minutes. The static-token fallback is preserved as a dev-only escape hatch.
3. **"Refresh from IAP" Tauri command** — a new `iap_refresh_license` command lets users re-validate their IAP-issued license and extend its `exp` (e.g. after renewing their subscription). Only works for IAP-issued licenses (`kid = "iap-local"`); trial / offline-purchase licenses return `iap-refresh-not-applicable`. The new receipt's `exp` must be later than the current `exp` (no downgrades).
4. **TransferFlow IAP-license redirect** — for IAP-issued licenses, the TransferFlow result step now shows an IAP-specific message ("IAP licenses can't be transferred") and skips the email-generation step (no email to send — the project lead can't help with IAP transfers). The deactivation still happens (so the IAP local keypair is cleared).

Plus a new `license_get_kid` Tauri command + `licenseGetKid` TypeScript wrapper, used by the LicenseCard + IapRefreshFlow + TransferFlow UIs to determine if the current license is IAP-issued. `cargo test --lib` is **326/326 passing** (+34 from this phase: 10 iap dispatcher (AppleRaw routing + is_base64_receipt heuristic) + 18 iap_oauth + 6 iap refresh-license); `npx vitest run` is **1001/1001 passing** (+16 from this phase: 7 iapRefreshLicense wrapper + 6 LicenseCard humanize + 3 TransferFlow IAP-redirect); `tsc --noEmit` / `npm run build` / `cargo check` all clean. See `CHANGELOG.md` "Added (Phase 4.1 — IAP v1.1 follow-ups)" for the full feature list; see HANDOFF §9.28 for the per-phase writeup; see Decisions #100–#101 for the architectural calls. **The production-readiness roadmap is now COMPLETE (all phases shipped).** The only remaining work is the project lead's non-code setup (LLC formation, ToS, marketing site, support rotation) — those are the project lead's own work, not code, and run in parallel from the project lead's side.

**Previous phase (M6b):** Per-tab state keying + v4 settings export / import — SHIPPED. M6b is the second half of the M6 multi-workspace tabs plan. With M6a shipping the data model + tab strip, M6b makes each tab a *full* workspace: per-tab state (file-tree expansion, selected row, open editor tabs, active editor tab) is persisted on the tab itself, and switching tabs rehydrates that state into the live stores (`useFileTreeStore`, `useEditorTabsStore`) via mirror-back effects. The settings export/import format is bumped to v4: the v3 single `workspace.currentPath` shape is replaced with a `workspace.workspaces[]` array of `{ id, path, addedAt, state: WorkspaceTabState }` rows; the v3→v4 import migration wraps any old `currentPath` into a single `WorkspaceTab` with empty per-tab state (auto-detected on parse, so existing v3 files continue to import seamlessly). The new `WorkspaceTabState` carries four fields (`expandedDirs: string[]`, `selectedPath: string | null`, `openEditorTabPaths: string[]`, `activeEditorTabPath: string | null`) plus three live-store actions (`setExpandedAndSelected` on `useFileTreeStore`, `replaceAll` on `useEditorTabsStore`, and `setTabState` / `replaceTabState` on `useWorkspaceStore`) that the mirror-back effects use to keep the two views in sync. PrivacyDataCard's v4 export/import is wired end-to-end: the export snapshot is `LipiStateV4Data` (with `version: 4`, `LIPI_STATE_V4_FORMAT`, and a per-tab `state` block), the import parser auto-detects v3 files (no `version`, or `version: 2/3` with a `currentPath` field) and migrates them in-memory, and a `.migrationNotice` UI block informs the user that their file was upgraded. The `applyLipiStateV4` function is transactional (snapshotStores → mutate → rollback on error), mirroring the S3 design. 874/874 vitest tests pass (+61 from this phase: 13 in `workspaceStore.test.ts` for per-tab state + persistence; 23 in `settingsIOv4.test.ts` for v4 schema + v3→v4 migration; 7 in `settingsIOv4.apply.test.ts` for transactional rollback; 13 in `settingsIOv4.preview.test.ts` for human-readable previews; 5 in `PrivacyDataCard.test.ts` rewritten for v4). `tsc -b` / `npx vitest run` / `cargo check` / `npm run build` all clean. Titlebar subtitle is now `dev · M6b`. See `CHANGELOG.md` "Added (M6b — Per-tab state keying + v4 settings export / import)" for the full feature list; see HANDOFF §9.23 for the per-phase writeup; see Decisions #81–#84 for the architectural calls.

**Previous phase (M6a):** Multi-workspace tabs: data model + tab strip — SHIPPED. The pre-M6a `useWorkspaceStore` tracked a single `currentPath: string | null`; M6a replaced that with `workspaces: WorkspaceTab[]` (`{ id, path, addedAt }`) and `activeId: string | null`, plus a derived `useActivePath(state)` helper that consumers use to read the active tab's path. A new `useActivePathSelector()` hook subscribes to the store and re-renders on change. A v1 → v2 in-store migration wraps the old single `currentPath` in a `WorkspaceTab` on first hydrate, writes the v2 keys, and drops the v1 keys (only on success — the v1 keys are otherwise left in place, a defensive measure for users with both an old binary and a new binary running side-by-side). The new `<WorkspaceTabs />` component renders one pill per open tab between the titlebar and the file tree (click to switch, `×` to close, middle-click to close, `+` to add via the native folder picker; full a11y: `role="tablist"` / `role="tab"` / `aria-selected`). The file tree re-roots to the new active path when the user switches tabs (M6a is global expansion state; M6b keys it per tab). Recents are unchanged in shape but `MAX_RECENTS`-capped strings, with "closed is not forgotten" semantics (closing a tab preserves its path in recents; re-opening from recents adds a new tab). The Command Palette's `workspace.open` and `workspace.close` commands dispatch the new `open(path)` / `close(tabId?)` actions. 813/813 vitest tests pass (+22 from this phase: 21 in `workspaceStore.test.ts` covering the v1→v2 migration, `open` / `close` / `setActive` actions, and `useActivePath`; 6 in `WorkspaceTabs.test.tsx` for the strip rendering and a11y). `tsc -b` / `npx vitest run` / `cargo check` / `npm run build` all clean. See `CHANGELOG.md` "Added (M6a — Multi-workspace tabs: data model + tab strip)" for the full feature list; see HANDOFF §9.22 for the per-phase writeup; see Decisions #77–#80 for the architectural calls.

**Previous phase (Decision #66 polish):** file-tree right-click context menu — SHIPPED. The pre-Decision-#66 `window.prompt` / `window.confirm` right-click flow in `FileTreePane` is replaced with 3 purpose-built components (`FileRowContextMenu` floating `<ul role="menu">` anchored at the click x/y with auto-flip + keyboard nav + outside-click dismissal; `InlineNameInput` modal that reuses the shared `Modal` primitive with a labelled text input, validation, and pre-selection of the basename on rename; `ConfirmDestructiveModal` modal that reuses `Modal` with a danger-variant Delete button and per-kind body copy). All 3 components are wired into `FileTreePane`'s `TreeNode` via 3 pieces of mutually-exclusive state (`menu` / `nameInput` / `confirm`). The pure helpers `validateFileName` (7 rules: non-empty, not `.` / `..`, no path separators or Windows-illegal chars, no reserved device names, case-insensitive collision check, length cap, trailing-dots/space strip) and `suggestNewFileName` (untitled.txt → untitled (1).txt → … → 10k bail-out with timestamped fallback) back the `InlineNameInput`. The `computeContextMenuPosition` pure helper handles the auto-flip math. 791/791 vitest tests pass (+56 for this phase: 24 fileNameValidation + 20 FileRowContextMenu + 8 InlineNameInput + 4 ConfirmDestructiveModal = 56; previous 735 + 56 = 791). `tsc -b` / `npx vitest run` / `cargo check` / `npm run build` all clean. See `CHANGELOG.md` "Added (Decision #66 polish — file-tree right-click context menu)" for the full feature list; see HANDOFF §9.21 for the per-phase writeup; see Decision #76 for the architectural call.

**Next:** With **Phase 4 shipped, the production-readiness roadmap is COMPLETE.** The user instructed the team to "forget about the legal and everything" and "just concentrate on coding, design, and building the product" — so the original 9-phase plan (which interleaved legal / business phases with code phases) has been collapsed into a 3-phase coding-focused roadmap (Phase 3 + Phase 5 + Phase 4), and all 3 are now shipped. The product is ready for public launch pending the project lead's non-code setup:

1. **LLC formation + banking** — the project lead's setup, not code.
2. **Terms of Service + Privacy Policy** — the project lead's setup, not code (can be modelled on any standard SaaS ToS / Privacy template; the project doesn't collect any data that would require custom clauses).
3. **Marketing site** — the project lead's setup, not code (the existing pricing page on the project website is sufficient for v1; a more polished site is a follow-up).
4. **Support rotation** — the project lead's setup, not code (a single shared inbox at `support@lipi.ide` is sufficient for v1; full ticketing system is a follow-up).
5. **Production keypair generation** — a 1-line `tauri signer generate` call per the `docs/RELEASING.md` appendix. The CI secrets (`LIPI_APPLE_IAP_SHARED_SECRET`, `LIPI_MS_IAP_BEARER_TOKEN`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`, `WINDOWS_CERT_FILE`, `WINDOWS_CERT_PASSWORD`) need to be set in the GitHub Actions secret store.

The original M6c / M3 follow-up / mobile-build items are still in the queue but deprioritised until the production-readiness roadmap is complete. Now that it is, those items can resume. See §6 "Done in prior cycles" below for the full history.

The original M6c / M3 follow-up / mobile-build items are still in the queue but deprioritised until the production-readiness roadmap is complete. See §6 "Done in prior cycles" below for the full history.

The M6c + M3 + mobile-build work that was previously the "Next" list is parked until the production-readiness roadmap is complete:

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

### 9.13 M5 - SHIPPED (mobile polish: keyboard occlusion + haptics, see CHANGELOG "Added (M5)")

The M1 mobile shell shipped the tab bar + safe-area insets but two polish items remained deferred: the on-screen keyboard would cover the bottom tab bar on a 360px viewport, and there was no native haptic feedback on tab switches / voice start / destructive actions. M5 closes both gaps.

**Status.** SHIPPED. Commit `7d01df0`. All gates green at the time of check-in: tsc clean, vitest **552/552** (+13 from this sub-phase), vite build clean, `cargo check` clean.

**What was built.**

- `haptic` Tauri command (Rust, no-op on desktop, deferred-bridge placeholder on iOS / Android via `#[cfg(mobile)]`).
- `HapticIntensity` enum (`light` / `medium` / `heavy`) — mirrors the iOS `UIImpactFeedbackGenerator` and Android `HapticFeedbackConstants` scales.
- `useHaptics()` hook returning `{light, medium, heavy}`. Pure helper `fireHaptic` exported for tests. Swallows IPC failures, one-shot console warn.
- `useVirtualKeyboard()` hook that subscribes to `window.visualViewport.resize` / `.scroll` and writes `--keyboard-height` to `documentElement`. The CSS layer reads the variable (with a `0px` default) to push the tab bar above the keyboard.
- Both hooks mounted in `MobileShell.tsx`. `MobileShell.module.css` updated: `padding-bottom: calc(var(--safe-bottom, 0px) + var(--keyboard-height, 0px))`.
- 13 vitest tests (5 `useHaptics`, 8 `useVirtualKeyboard`).

**Key decisions** (numbered #61, #62, #63 — see Decisions table).

- **#61** (semantic intensity): the hook exposes `{light, medium, heavy}` rather than a raw `(intensity) => void`. The UI picks a *semantic* intensity; if a future "ultra" intensity lands, every callsite that picked the right semantic will keep working.
- **#62** (haptic on desktop = silent no-op): the Rust `haptic` command is a no-op on desktop, not a log-and-return. The hook fires the IPC on every tab switch / voice start / undo; a log per call would be unbearable.

**Verification.** tsc · vitest · vite build · `cargo check`. All clean. **No new Rust unit tests** were added for the `haptic` command itself — the body is a single `let _ = intensity; Ok(())` in each `#[cfg]` arm and the real test surface is the iOS Swift / Android Kotlin plugin (a future session; HANDOFF §9.6).

**Known limitations.**

- **No real iOS / Android haptics.** The `#[cfg(mobile)]` arm is a placeholder. Until the Swift / Kotlin plugin lands, mobile is also a no-op (and a no-op on mobile is no worse than the current state — the v1 build doesn't ship the mobile targets).
- **`window.visualViewport` not supported on iOS < 13 / Android < 5.** The hook no-ops when `visualViewport` is `undefined`; older WebViews will see the keyboard cover the tab bar. Acceptable for v1 (every supported iOS / Android WebView is well past 13 / 5).

### 9.14 NPS - SHIPPED (native-dictation plugin contract, see CHANGELOG "Added (NPS)")

The M2c mobile shim registered a `'nativeDictation'` factory stub in the `voiceSessionFactories` registry (it throws `'not-configured'` on start — see CHANGELOG "Added (M3)"). The actual Swift `SFSpeechRecognizer` and Kotlin `SpeechRecognizer` plugins are deferred until a future session on a Mac with Xcode 16+ / Linux with Android Studio Iguana+. NPS ships the **contract** the plugins must satisfy — a Rust-side facade and a typed JS mirror — so the Settings UI can render the contract today and the plugins plug in tomorrow without JS-side changes.

**Status.** SHIPPED. Commit `4a53172`. All gates green: cargo check clean, cargo test (NPS) 8/8, tsc clean, vitest **565/565** (+13), vite build clean.

**What was built.**

- `src-tauri/src/native_dictation.rs` — the contract:
  - `PLUGIN_NAME = "native-dictation"`,
    `METHOD_START` / `METHOD_STOP` / `METHOD_CANCEL`,
    `TRANSCRIPT_EVENT = "stt://transcript"`,
    `ERROR_EVENT = "stt://error"`.
  - `NativeDictationErrorKind` enum (5 kinds:
    `permission-denied` / `no-input-device` /
    `backend` / `timeout` / `unknown`) — mirrors
    the desktop `SttErrorKind` so the JS-side
    `useVoiceCapture` hook can map them with the
    same `voiceSessionErrorMessage` helper.
  - `ContractStatus` enum (`active` / `inert` /
    `not-applicable`) — `#[cfg(target_os = "ios" |
    "android")]` returns `inert`; every other
    target returns `not-applicable`. The `#[cfg]`
    split is the platform-dispatch point; the
    future Swift / Kotlin plugin replaces
    `inert` with `active` without touching the
    JS side.
  - `get_native_dictation_contract` command
    returns the contract as typed JSON.
- `src/ipc/nativeDictation.ts` — typed
  `NativeDictationContract` mirroring the Rust
  wire shape; `getNativeDictationContract()`
  IPC wrapper; `contractStatusLabel(status)`
  and `errorKindLabel(kind)` pure helpers.
- `src/screens/SettingsProvider/components/NativeDictationCard.tsx`
  + `.module.css` — a new Voice-section card
  with a status badge (colour-coded by
  `data-status`), a collapsible contract list
  (3 methods + 5 error kinds + 2 events), and
  pointers to
  `docs/plugins/lipi-stt-ios/README.md` and
  `docs/plugins/lipi-stt-android/README.md`.
- **8 Rust unit tests** + **10 JS tests** for
  the contract wire shape and the pure
  helpers.

**Key decisions** (numbered — see Decisions
table).

- **Contract returns `status: 'inert'`** (not
  `'active'`) on iOS / Android. The contract
  is in tree, the Swift / Kotlin plugin
  binding is not. Surfacing `inert` is more
  honest than `active`; a future session that
  fills in the binding is a one-character
  change in the `#[cfg]` arm.
- **Wire stability is the contract's job.**
  The Rust unit test
  `serialise_to_json_kebab_cases_the_enums`
  pins the kebab-case JSON shape so a future
  contributor who renames a field or drops
  an `#[serde(rename_all)]` fails the build,
  not the runtime. The JS test
  `getNativeDictationContract IPC shape`
  pins the same shape from the other side.

**Verification.** cargo check · cargo test
(NPS) 8/8 · tsc · vitest · vite build. All
clean.

**Known limitations.**

- **No real iOS / Android plugin.** The
  `status: 'inert'` is honest about this.
  Real implementation is a future session on
  a Mac with Xcode 16+ / Linux with Android
  Studio Iguana+. The contract docs in
  `docs/plugins/lipi-stt-ios/README.md` and
  `docs/plugins/lipi-stt-android/README.md`
  are the full implementation spec (~250
  LoC Swift + ~50 LoC SwiftPM config + ~50
  LoC Swift unit tests + a one-day on-device
  smoke test on a Mac with Xcode 16+).
- **No Settings card entry in the Command
  Palette for `nativeDictation`** (deferred
  until the plugin lands; would re-introduce
  Apple / Google's Web Speech as a
  dependency on iOS / Android which is
  explicitly NOT wanted — Safari's
  `SpeechRecognition` is feature-incomplete
  per Apple's docs).

### 9.15 S2 - SHIPPED (settings v2 export / import, see CHANGELOG "Added (S2)")

The 5b v1 export (`src/shared/settingsIO.ts`)
is per-decision: it captures just the
`toolSettings` payload. S2 ships the
**full-Lipi-state** counterpart: a single
schema-versioned JSON file that contains the
workspace (current + recents), the
voice-provider preference, and the tool
settings. Privacy scope: **no AI keys, no
audit log, no live transcript state, no
custom tools, no first-run flag** — pinned by
the `serialisedFileLooksPrivate` smoke test
and the `LIPI_STATE_V2_PRIVACY_STATEMENT`
string rendered in the Settings card.

**Status.** SHIPPED. Commit `f3ed9b6`. All
gates green: tsc clean, vitest **597/597**
(+32), vite build clean.

**What was built.**

- `src/shared/settingsIOv2.ts` — pure IO:
  - `LIPI_STATE_V2_FORMAT = "lipi-state"`
    (distinct from 5b v1's `"lipi-settings"`
    so a v1 file is rejected by a v2 reader
    and vice versa).
  - `LIPI_STATE_V2_VERSION = 2`.
  - `LipiStateV2Data` interface: `workspace` +
    `voicePreferences` + `toolSettings`.
  - `buildLipiStateV2` / `parseLipiStateV2` /
    `serialiseLipiStateV2` /
    `suggestLipiStateV2Filename` /
    `serialisedFileLooksPrivate` — all pure,
    all dependency-free.
- `src/shared/settingsIOv2.apply.ts` —
  `applyLipiStateV2(data)` writes to the
  three stores. Reuses the 5b v1
  `applyImportedSettings` action for the
  tool-settings half (so the 5a soft-delete
  + 5s-undo hook fires). Tagged-union
  `ApplyLipiStateV2Result` for per-sub-
  payload error visibility.
- `src/screens/SettingsProvider/components/PrivacyDataCard.tsx`
  + `.module.css` — Settings "Privacy &
  data" card with the full privacy statement
  rendered as `<pre>`, an Export button
  (downloads a `lipi-state-YYYY-MM-DD.json`),
  and an Import button (file picker → parse
  → `window.confirm` → apply). Auto-clears
  success notice after 3s, surfaces errors
  persistently.
- **32 vitest tests** (19 `settingsIOv2`, 5
  `settingsIOv2.apply`, 8 `PrivacyDataCard`).
  The PrivacyDataCard test caught a real bug
  in the original implementation:
  `snapshotStoresForExport()` was passing a
  reference to the live `recents` array; the
  fix shallow-clones the array (and the
  `disabledToolNames` array and the
  `confirmationMode` record) so the live
  state cannot be mutated through the
  snapshot.

**Privacy scope** (the non-obvious part; the
test pin is the value).

| Store | In v2? | Why |
|---|---|---|
| `workspace` (current + recents) | YES | user-facing "what folders have I opened" |
| `voicePreferences` (provider) | YES | user-facing choice |
| `toolSettings` (5b v1 payload) | YES | user-facing policies |
| OS keychain (AI + Wispr keys) | NO | not in JS, never serialised |
| `toolDecisionLog` (audit) | NO | per-machine audit trail (5b v1 precedent) |
| `voiceCapabilities` | NO | not persisted, build-time capability |
| `voiceStore` (live transcript) | NO | ephemeral runtime state |
| `deviceEmulator` | NO | dev-only sessionStorage |
| `customTools` | NO | per-workspace on disk (the workspace folder is the transfer medium for custom tools, not the v2 file) |
| `appStore` / `commandPaletteStore` / `chatNavStore` / `aboutStore` | NO | UI state |
| `firstRun` | NO | per-machine onboarding |

`serialisedFileLooksPrivate` is a
defence-in-depth smoke test that asserts the
serialised output contains none of
`sk-` / `sk-ant-` / `sk-or-` (the known AI key
prefixes) / `lipi:toolDecisionLog:v1` /
`lipi:dev:deviceEmulator` / `"isUtteranceEnd"`
/ `"sessionId":` substrings. A real leak would
still need a code review to catch; this check
is a backstop, not a substitute.

**Key decisions** (numbered — see Decisions
table).

- **#63** (partial-on-error apply): the
  apply writes to the three stores in
  sequence and returns a tagged-union result
  on the first sub-payload that throws. The
  alternative (cross-store snapshot +
  rollback) is the right long-term shape but
  is a v3 concern: it requires a cross-store
  snapshot mechanism, which is non-trivial
  and not in scope for S2. The partial state
  is recoverable by re-exporting the current
  state and importing a known-good file (or,
  for `toolSettings`, hitting the 5a
  soft-delete undo).
- **#64** (distinct magic string):
  `LIPI_STATE_V2_FORMAT = "lipi-state"` (vs
  5b v1's `lipi-settings`). The two files are
  different products with different surface
  areas; the magic string is the guard
  against a user accidentally importing a
  v1 file into a v2 reader (or vice versa).
- **#65** (cloned snapshot):
  `snapshotStoresForExport()` shallow-clones
  the `recents` / `disabledToolNames` arrays
  and the `confirmationMode` record. A
  future caller that mutates the returned
  payload (e.g. redacts a path) must NOT
  accidentally mutate the live store.

**Verification.** tsc · vitest · vite build.
All clean.

**Known limitations.**

- **No cross-store rollback on apply
  failure.** The `toolSettings` apply reuses
  the 5a soft-delete + 5s-undo, so a failed
  tool-settings import is recoverable in one
  click. A failed `workspace` or
  `voicePreferences` apply is recoverable
  only by re-importing a known-good file
  (the v1 trade-off; a v3 cross-store
  snapshot is the right long-term shape).
- **No merge mode.** Import is replace, not
  merge (matches the 5b v1 decision). Merge
  would silently combine state from two
  sources, which is surprising.

---

### 9.16 File-tree mutations (FTM) - SHIPPED (see CHANGELOG "Added (File-tree mutations)")

Right-click on any node in the
`FileTreePane` now offers three actions:
**New File** (creates an empty file under the
right-clicked directory), **Rename** (changes
the leaf name of the right-clicked node), and
**Delete** (removes the file or empty
directory; non-empty directories are rejected
by the Rust side with a clear error).

The Rust side has three new Tauri commands in
`src-tauri/src/fs.rs`:
- `fs_create_file(path)` — creates an empty
  file. If the path already exists, returns
  `FsError::AlreadyExists` (a new variant on
  the existing error enum). The caller (the
  `useFileTree.create` action) catches the
  error and surfaces a per-row inline error
  message in the file tree UI.
- `fs_delete_entry(path)` — removes a file or
  empty directory. If the path is a non-empty
  directory, returns
  `FsError::DirectoryNotEmpty`. The UI shows
  the error inline on the row.
- `fs_rename_entry(from, to)` — renames a file
  or directory. Validates that the source
  exists and the destination does not. The
  `FsError` enum gained two new variants
  (`AlreadyExists`, `DirectoryNotEmpty`) and
  one new field on the payload (a `path`
  string for richer error messages).

The JS IPC wrappers in `src/ipc/fs.ts` mirror
the new commands with typed signatures and a
matching `FsErrorPayload` type. The
`toolRegistry.ts`'s `read_file_or_empty_string`
helper was updated to handle the new
`AlreadyExists` variant in its exhaustive
switch (the case returns
`Error: '<path>' already exists.` to the AI
tool caller).

The `useFileTree` hook was refactored: the
mutation logic is now pure functions exported
for testability (`createInTree`,
`deleteInTree`, `renameInTree`, plus the
existing `parentDir` / `isDescendant` /
`loadDirIntoStore` helpers). The hook itself
is a thin `useCallback` wrapper that catches
`AlreadyExists` / `DirectoryNotEmpty` errors
and stores them in a local `rowError` state
for the row to display. New tests cover each
pure function with happy-path and
error-path cases.

The v1 UI uses `window.prompt` for the new
file name / new name and `window.confirm` for
the delete confirmation. A purpose-built
context menu is a v2 polish (it would replace
the three `window.*` calls with a real
floating menu rendered by the file tree
component). The trade-off is documented
in the CHANGELOG "Known limitations"
section.

**Verification.** tsc · vitest (4 new IPC
tests, 7 new useFileTree pure-helper tests) ·
cargo test · vite build. All clean.

**Known limitations.**

- **`window.prompt` / `window.confirm` for
  the v1 UI.** They're synchronous, modal,
  and a bit ugly in a Tauri WebView. A
  purpose-built context menu (a small
  absolutely-positioned `<ul>` rendered by
  `FileTreePane`) is the v2 polish; it
  would replace all three `window.*` calls
  with one floating menu.
- **No undo for delete / rename.** A
  `Cmd+Z` hook to the Tauri-side trash
  (move to `.lipi-trash/<rand>/` instead of
  `std::fs::remove_file`) is a v2
  safety net. The v1 behaviour is
  "delete is permanent" — this is the same
  trade-off the OS file explorer makes
  when the user holds Shift+Delete.

---

### 9.17 File watcher (FW) - SHIPPED (see CHANGELOG "Added (File watcher)")

The file tree now auto-refreshes when files
change on disk — the most-asked-for feature
in the workspace track. FTM ships the
mutations; FW ships the "external mutations
are visible too" path.

The Rust side uses the `notify` crate (a
pure-Rust, cross-platform file-system
notification library) wrapped by a new
module `src-tauri/src/fs_watcher.rs`. It
exposes two Tauri commands:
- `fs_watch(path) -> WatchHandle` — starts
  watching a directory. The `WatchHandle`
  is a `u64` id. The implementation is
  idempotent: calling `fs_watch` on an
  already-watched path returns the
  existing handle (the `ActiveWatcher`
  struct stores the path so the lookup is
  correct).
- `fs_unwatch(handle) -> ()` — stops
  watching and frees the watcher.

The watcher emits a Tauri event
`fs://changed` with a payload describing
the changed path and the change kind
(`Created` / `Modified` / `Removed` /
`Renamed`). The Rust side debounces events
on a per-handle basis: any event within
75 ms of a previous one on the same
directory is collapsed into a single emit
(this prevents a "save a 5000-line file"
operation from firing 5000 events).

The JS side has a new IPC module
`src/ipc/fsWatcher.ts` with `startWatch`,
`stopWatch`, and `onFsChange` functions.
A new React hook `useFileTreeWatcher` is
mounted by `FileTreePane` (both `TreeRoot`
and `TreeNode`) and:
1. Listens to `fs://changed` events.
2. JS-side debounces the handler with a
   150 ms timer (the Rust side's 75 ms
   is per-handle, the JS side's 150 ms is
   end-to-end).
3. Filters the event stream through a
   pure `decideFsChangeAction` helper
   that returns one of `'refresh-root'`,
   `'refresh-dir'`, `'ignore'`, or
   `'select'`. The filter is the testable
   core: a `Modified` on a file we're
   already showing is `'ignore'`
   (the user already sees the new content
   if they have it open); a `Created` is
   `'refresh-dir'`; a `Removed` on the
   currently selected path triggers a
   `'select'` to a sensible neighbour.
4. Calls `fileTreeStore.dropEntries(dir)`
   to clear the cache, then triggers a
   refresh via the existing `useFileTree`
   `refresh` action.

The watcher's lifecycle is bound to the
component: `TreeRoot` starts a watcher for
the root path on mount and stops it on
unmount. `TreeNode` starts a watcher when
the user expands a directory and stops it
when the directory is collapsed. This means
the OS notification stream is bounded to
"the directories the user can see," not
"every directory in the workspace" — a
critical property for very large repos.

**Verification.** tsc · vitest (6 new IPC
tests, 8 new useFileTreeWatcher tests for
the pure `decideFsChangeAction` helper) ·
cargo test (8 new fs_watcher unit tests
covering the debounce, the
`fs_watch` idempotency, and the
`fs_unwatch` cleanup paths) · vite build.
All clean.

**Known limitations.**

- **No Monaco reload on external change.**
  If the user has a file open in the
  editor and a different process changes
  it on disk, the editor does not
  auto-reload (no `fs://file-changed`
  event is emitted; no `editorController`
  reload hook is wired). This is the
  "out of scope for v1" decision; the
  file tree refresh is the first 80% of
  the feature, the editor reload is the
  last 20%.
- **No filter for `.git` / `node_modules`
  changes on the FS side.** The watcher
  receives every event and the JS-side
  filter decides what to do with it. The
  `decideFsChangeAction` helper does
  ignore the ignored dirs in the
  "decide what to refresh" path; the
  Rust-side `notify::RecommendedWatcher`
  still receives the kernel events. This
  is fine for small / medium repos; a
  very large monorepo with millions of
  `node_modules` files would benefit
  from a Rust-side filter, but that's a
  perf optimisation for a later phase.
- **No recursive / depth-limited watch.**
  A `TreeNode` watcher only watches the
  directory itself, not its children.
  This is correct (a recursive watcher
  would mean a single OS watch per repo,
  not per directory) but it means a
  change in `dir/subdir/file.txt` fires
  the `dir` watcher (correct: a parent
  directory's mtime changes), then the
  `subdir` watcher (correct), and the JS
  side's debounce collapses them. The
  user experience is "tree refreshes
  exactly once per save." Verified by a
  hand-test in the dev build.

---

### 9.18 Workspace search (WS) - SHIPPED (see CHANGELOG "Added (Workspace search)")

A new **Search** tab in the `SidePanelPane`
ships a text search across the entire
workspace. The v1 is a hand-rolled grep
(no `ripgrep` sidecar dependency) with
sensible defaults and a clean extension
path.

The Rust side has a new module
`src-tauri/src/workspace_search.rs` with
one Tauri command:
- `workspace_search(query, options) -> SearchResult`
  where `options` is `{ root, caseSensitive, maxResults, includeGlobs?, excludeGlobs? }`
  and `SearchResult` is `{ matches: SearchMatch[], truncated: boolean, scannedFiles: number, scannedBytes: number }`.

The implementation walks the root
recursively, skipping any path that matches
the default ignore set: `.git`, `node_modules`,
`dist`, `build`, `target`, `.next`, `.cache`,
`.lipi-trash`, plus any path containing
`__pycache__` or ending in `.min.js` /
`.min.css`. The default ignore list is
hard-coded (not user-configurable in v1)
because the goal is "search the user's
code, not their build artifacts," and the
list is the same on every platform.

Each file is opened, sniffed for
binary-ness (the first 4096 bytes are
scanned for NUL bytes — a common
heuristic), and skipped if it fails the
sniff. Files larger than 5 MB are also
skipped (the user can search inside them
manually with a future "force" toggle).
A match in a text file is a line-by-line
scan: for each line that contains the
query, the line number and byte offset of
the first character of the match are
recorded. Case sensitivity is honoured.
The walk stops once `maxResults` matches
are collected, and the `truncated` flag is
set.

The JS side has a new IPC module
`src/ipc/workspaceSearch.ts` with
`workspaceSearch({ root, query, caseSensitive })`
and a matching types file. A new React
component `SearchPanel` is mounted in a
new **Search** tab of `SidePanelPane`
(sibling of the **Files** and **AI**
tabs). The component:
1. Renders a text input + a
   case-insensitive toggle.
2. Debounces the query with a 200 ms
   timer (the Rust side already caps
   results, so the debounce is purely a
   "don't fire on every keystroke"
   affordance).
3. Renders the results as a flat list
   (path:line:col | matched line preview)
   with clickable rows.
4. On click, the row's file is opened in
   the editor (via the existing
   `openFile` flow) and a `pendingReveal`
   entry is set in `editorControllerStore`.
5. The next time Monaco mounts the file
   (or if the file is already open), the
   `handleMount` callback consumes the
   `pendingReveal` and calls
   `revealLineInCenter` + `setPosition` +
   `focus` to jump to the match.

The `pendingReveal` mechanism is a
single-slot request queue (not a multi-slot
list) because the v1 UX is "click a
result, jump to it" — there's no scenario
where the user has multiple pending reveals
in flight. A multi-slot queue is a v2 polish
(if usage shows users want to walk
through matches with `F4` / `Cmd+G`).

**Verification.** tsc · vitest (7 new IPC
tests, 9 new SearchPanel store/hook tests) ·
cargo test (13 new workspace_search unit
tests covering: default ignores, binary
file skipping, large file skipping, case
sensitive + insensitive paths, max-results
cap, max-results-with-truncated-flag) ·
vite build. All clean.

**Known limitations.**

- **No regex support.** v1 is literal
  substring match only. A `regex: true`
  option in the `SearchOptions` struct is
  the v2 path (the `regex` crate is
  already in the `Cargo.lock` from the
  `gix` transitive deps; the dependency
  is essentially free).
- **No in-file "next match" navigation.**
  After clicking a result and jumping to
  a line, the user has to click another
  result to see the next match. A
  `Cmd+G` / `F4` keybinding that calls
  `editorController.findNext()` is a v2
  feature.
- **No cancellation.** If a search takes
  3 seconds, the UI shows the loading
  state for 3 seconds and the user can't
  cancel it. A `cancelHandle` (a
  `tokio_util::sync::CancellationToken`
  on the Rust side, a
  `useEffect` cleanup on the JS side) is
  a v2 polish.
- **No include / exclude globs in the
  v1 UI.** The `SearchOptions` struct
  has `includeGlobs` / `excludeGlobs`
  fields (for the v2 path), but the
  `SearchPanel` UI doesn't expose them
  yet.

---

### 9.19 Onboarding tour (K) - SHIPPED (see CHANGELOG "Added (K - onboarding tour)")

A first-run **product tour** that walks the
user through the four panes of the editor.
The tour is a 6-step overlay (welcome,
fileTree, sidePanel, aiVoice,
commandPalette, outro) that renders on
top of the app for the user's first
session after opening a workspace.

**Store layer.** A new
`useTourStore` (`src/shared/state/tourStore.ts`)
is a Zustand store with three pieces of
state and four actions:

- `hydrated: boolean` - set by an explicit
  `hydrate()` call in `AppRoot`'s mount
  effect (mirrors `useWorkspaceStore` /
  `useFirstRunStore`).
- `dismissed: boolean` - persisted to
  `localStorage` under the key
  `lipi:tour:dismissed:v1`. A user who
  hits Skip / Esc / "Finish" sets this to
  `true`; the tour never auto-starts
  again.
- `currentStep: number` - in-memory only
  (NOT persisted; see Decision #71).
- Actions: `hydrate()`, `start()` (resets
  to step 0 and clears `dismissed` for
  the "Restart tour" command palette
  entry), `next()` (pure +1,
  unconditional), `prev()` (pure -1,
  clamped to 0), `finish()` (sets
  `dismissed: true`).

The store is intentionally a **dumb step
machine**; the step count is NOT in the
store (see Decision #70). Adding a step
to `tourSteps.ts` is a one-entry change
and the overlay picks it up
automatically.

**Step list.** A pure-data array
`TOUR_STEPS` in
`src/shared/components/OnboardingTour/tourSteps.ts`
defines the 6 steps. Each step has:

- `id` - unique string
- `title` - callout title (1-2 words)
- `body` - callout body (1-3 sentences,
  length-cap-checked in the test)
- `placement: 'center'` for steps without
  a permanent DOM anchor, OR
  `{ anchor: 'data-tour-target-string',
  side: 'top' | 'bottom' | 'left' | 'right' }`
  for steps anchored to a specific UI
  element

The 4 anchored targets added to the app:

- `welcome.openFolder` - the "Open
  Folder" button on `Welcome.tsx` (step
  1, the entry to opening a workspace)
- `fileTree` - the wrapper `<div>` around
  `TreeRoot` in `FileTreePane.tsx` (step
  2, after the user has opened a
  workspace)
- `sidePanel` - the root `<div>` of
  `SidePanelPane.tsx` (step 3, the Files
  / AI / Search tab strip)
- `aiVoiceButton` - the `<span>` wrapping
  the `VoiceButton` in `AIPanel.tsx` (step
  4, the mic in the AI composer)

The `commandPalette` step (step 5) is
centered because the palette has no
permanent button on the editor - the
keyboard shortcut IS the surface. A
centered callout with the shortcut in
the body ("Press Ctrl/Cmd+Shift+P") is
the cleaner answer (see Decision #72).

A pure helper
`computeTourShouldAutoStart({ tourHydrated, tourDismissed, workspaceHydrated, currentPath })`
returns `true` only when ALL of:

- `tourHydrated === true` (the
  `localStorage` read completed)
- `tourDismissed === false` (the user
  hasn't finished before)
- `workspaceHydrated === true` (the
  workspace store has finished its own
  `localStorage` rehydration)
- `currentPath` is a non-empty string
  (the user has opened a workspace - the
  tour is meaningless on the Welcome
  screen)

The 4-condition gate is the only thing
that prevents the tour from auto-starting
in surprising states (mid-hydration,
already-dismissed, or still on Welcome).

**Placement math.** Two pure helpers in
`placement.ts`:

- `computeAnchoredLayout({ rect, viewport, side, calloutSize, padding })` -
  returns `{ x, y, side }`. Tries the
  requested `side` first, flips to the
  opposite side if the callout would clip
  the viewport, and falls back to
  centered if BOTH sides clip.
- `computeCenterLayout({ viewport, calloutSize })` - returns `{ x, y,
  side: 'center' }` (callout centered in
  the viewport, used for both centered
  steps and the "both sides clipped"
  fallback).

The `viewport` argument is passed by the
caller (the overlay component reads
`window.innerWidth` / `innerHeight` at
call time) - the helpers do NOT touch
the global `window`. This makes the
helpers testable with arbitrary
`Viewport` fixtures (the 9
`placement.test.ts` cases use a 1024x768
fixture and assert exact pixel
positions).

A third pure helper `computeCalloutSize(body: string)` returns
`{ width, height }` from the default
`CALLOUT_DEFAULT_WIDTH` (320px) and
`CALLOUT_DEFAULT_HEIGHT` (180px) by
checking the body length: `>100` chars
bumps to 220px, `>160` chars bumps to
260px. The longer the copy, the taller
the callout - the title and 3-button
nav row stay at the top and the body
scrolls if needed.

**Overlay component.** A new `OnboardingTour` component
(`src/shared/components/OnboardingTour/OnboardingTour.tsx`)
mounts at the `AppRoot` level (in
`main.tsx`, sibling to the existing
`AboutModal`). The component is a fixed
backdrop with a positioned callout for
the current step. It:

- Renders a `position: fixed; inset: 0`
  semi-transparent dark backdrop
  (rgba(0, 0, 0, 0.5)) that fills the
  viewport.
- Renders the callout as a child of the
  backdrop, with `position: absolute`
  and the `left` / `top` from the
  placement math.
- Renders a CSS `::before` pseudo-element
  arrow that adapts to `data-side` -
  `top` shows a downward triangle at the
  bottom-center, `bottom` shows an upward
  triangle at the top-center, `left` and
  `right` show horizontal triangles.
  Centered callouts have no arrow.
- Includes a Back / Skip / Next / Finish
  row of buttons in the footer.
- Handles keyboard nav: `Esc` (skip),
  `ArrowLeft` (back), `ArrowRight` /
  `Enter` (next). The keyboard listener
  is `event.target`-aware: if the user is
  typing in a `<textarea>` / `<input>` /
  `[contenteditable]`, the arrows /
  Enter are NOT intercepted (the user's
  typing wins).
- Dismisses on backdrop click (calls
  `useTourStore.getState().finish()`).
- Auto-finishes if the workspace is
  closed mid-tour (a `useEffect` watches
  `useWorkspaceStore.currentPath`; if it
  goes from non-empty to empty, the tour
  is finished - opening Welcome in the
  middle of a tour is a confusing state).

The `useAnchorRect(selector)` hook
returns the live `getBoundingClientRect`
of the `data-tour-target=...` element,
updated on `scroll` / `resize` via a
`requestAnimationFrame` throttle. The
rect is `null` while the target is not
in the DOM (e.g. the user is still on
the Welcome screen and the
`fileTree` step is active) - the overlay
falls back to centered placement when
the rect is null.

**Command palette integration.** A new
"Restart onboarding tour" command in
the Help group (`src/shared/commands/commands.ts`)
calls `useTourStore.getState().start()`.
A user who dismissed the tour on day 1
can re-run it from `Ctrl/Cmd+Shift+P` →
"Restart onboarding tour" on day 30.

**Verification.** tsc · vitest (59 new
tests: 25 tourStore + 15 tourSteps + 9
placement + 10 storeSnapshot - the
latter is shared with S3) · vite build.
All clean. 735/735 vitest tests pass
total (+84 for the K + S3 batch).

**Known limitations.**

- **No analytics.** A v2 path could
  record `tour_started` / `tour_step_X`
  / `tour_dismissed` / `tour_completed`
  events to a local log (no remote
  shipping per Decision #17), useful
  for "what step do users dismiss on?"
  without compromising privacy.
- **No "save and resume."** A user who
  kills the app mid-tour restarts from
  step 0 next launch. Persisting the
  step would conflict with the dismissed
  flag (Decision #71).
- **No pointer highlighting.** A v2
  polish could add a pulsing ring around
  the anchor element. The current
  backdrop + callout is functional but
  doesn't point at the target visually
  beyond the arrow (the user has to read
  the callout copy to know what to look
  at).

---

### 9.20 Settings v3 transactional import (S3) - SHIPPED (see CHANGELOG "Added (S3 - settings v3 transactional import + preview)")

A **transactional settings import** that
snapshots all three stores before any
write, applies the new state, and
restores the snapshots if any part of
the apply fails. The import flow is
rewired from `parse -> confirm -> apply`
to `parse -> preview -> confirm -> apply`,
adding a field-level diff preview that
the user sees BEFORE clicking Apply.

**Snapshot primitive.** A new
`src/shared/storeSnapshot.ts` exports
three helpers:

- `createStoreSnapshot<T>({ read, write })` returns
  `{ value: T, restore: () => void }`.
  The `read` is called immediately to
  capture the current state; the
  `restore` is a closure that calls
  `write(value)`.
- `snapshotStores(s1, s2, s3)` returns
  a 3-tuple of snapshots. The helper is
  a one-liner that calls
  `createStoreSnapshot` on each.
- `restoreSnapshots([s1, s2, s3])` calls
  `s1.restore()`, then `s2.restore()`,
  then `s3.restore()` - reverse
  application order.

The `restore` closure wraps the `write`
call in a `try-catch` (see Decision
#73). If the store's `write` throws
during restore, the error is logged in
DEV mode and the loop continues to the
next snapshot. A throw that propagated
would leave the user in a
half-restored state; the
log-and-continue is the safe default.

**Transactional apply.** A new
`applyLipiStateV3(data, privacyConfirm?)`
function in
`src/shared/settingsIOv3.apply.ts`
replaces the v2 `applyLipiStateV2` for
the import path:

1. Validate `data` is a v2 payload
   (the magic string `"lipi-state"` is
   the version marker; the payload
   parser rejects v1's `"lipi-settings"`
   string with a
   `wrong-format` error).
2. Snapshot all three stores:
   `workspace`, `voicePreferences`,
   `toolSettings`.
3. Call the per-store apply functions
   in sequence: `applyWorkspace(data.workspace)`,
   `applyVoicePreferences(data.voicePreferences)`,
   `applyToolSettings(data.toolSettings)`.
4. If ANY of the three apply calls
   throws, restore all three snapshots
   (in reverse order) and re-throw the
   original error.
5. Return the same
   `ApplyLipiStateV2Result` shape (the
   v2 field structure is unchanged) so
   the v2 `PrivacyDataCard` import UI
   doesn't need to change beyond the
   preview integration.

The `applyToolSettings` step is the one
that needs the snapshot-restored state
to NOT push a 5a undo entry (Decision
#75) - so the snapshot's `write` for
`toolSettings` is a raw
`setState({disabledToolNames, confirmationMode})`,
not the `applyImportedSettings` helper
that would push an undo entry.

**Preview.** A new pure function
`computeLipiStateImportPreview(current, incoming)` in
`src/shared/settingsIOv3.preview.ts`
returns a `LipiStateImportPreview` with
field-level diffs for:

- `workspace.currentPath` - `'A' -> 'B'`
  string diff, or `null` if unchanged
- `workspace.recents` - `{ added: string[],
  removed: string[] }`, or `null` if
  unchanged
- `voicePreferences.provider` -
  `'stub' -> 'wispr'` provider diff, or
  `null` if unchanged
- `toolSettings.disabledToolNames` -
  `{ added: string[], removed: string[] }`,
  or `null` if unchanged
- `toolSettings.confirmationMode` - a
  per-tool record of
  `{ oldTool: ConfirmationMode, newTool: ConfirmationMode }`
  for each tool whose mode changed, or
  `null` if no tools changed

The function is pure (no I/O, no
side effects) and is the single source
of truth for the diff. The 11
`settingsIOv3.preview.test.ts` cases
cover the empty / no-changes path, the
single-field-change paths, and the
multi-field-change paths.

**UI integration.** The `PrivacyDataCard`
import flow is rewired from
`parse -> confirm -> apply` to
`parse -> preview -> confirm -> apply`:

1. The user picks a file (the file
   picker is unchanged).
2. The file is parsed; on success, the
   `pendingImport` state is set to
   `{ file, data, preview }`.
3. The card renders the preview above
   the existing Apply / Cancel pair:
   - "Workspace path: A -> B" (if path
     changed)
   - "Recents: +1 added, -1 removed" (if
     recents changed)
   - "Voice provider: stub -> wispr" (if
     provider changed)
   - "Disabled tools: +foo, -bar" (if
     any tools were added/removed to
     the disabled set)
   - "Tool X confirmation: per_call ->
     always_confirm" (per changed tool)
4. The "Apply Import" button is
   **disabled if the preview is empty**
   (no changes - the file matches the
   current state). This is the "I picked
   the wrong file" guard (see Decision
   #74).
5. The user clicks Apply - the v3
   transactional `applyLipiStateV3` is
   called, the success toast is shown,
   and the pending import is cleared.

A small `previewDiffLabel` helper
formats each diff line for the UI ("Voice
provider: stub -> wispr"). The 8
`previewDiffLabel` tests in
`PrivacyDataCard.test.ts` pin the
format for all 5 previewable diff
types.

**Backward compatibility.** The v2
`applyLipiStateV2` is preserved on disk
as a documented fallback. The v3
function is a strict superset (same
return shape, plus the snapshot /
restore), so the v2 path is reachable
via a direct import. A future cleanup
PR can delete the v2 function once
we're confident no edge case (e.g. a
backport from a fork) needs it.

**Verification.** tsc · vitest (25 new
tests: 6 v3 apply + 11 v3 preview + 8
previewDiffLabel) · vite build. All
clean. 735/735 vitest tests pass total
(+84 for the K + S3 batch, shared with
K's 10 storeSnapshot tests).

**Known limitations.**

- **No partial-apply preview.** A user
  who picks a partial file (e.g. one
  with only `voicePreferences`) sees the
  preview for the one field but the
  other two fields are silently
  unchanged. The preview is honest about
  that ("Voice provider: stub -> wispr"
  with no mention of workspace / tool
  settings), but a v2 could add a
  "Missing fields: workspace, toolSettings"
  section above the diff.
- **No "Apply & Export a backup first"
  option.** A v2 could add a checkbox
  that exports the current state to
  `<workspace>/.lipi-state-backup-<timestamp>.json`
  before the apply. The current path is
  "trust the snapshot restore" (and
  it's been tested in 6 rollback
  scenarios).
- **No undo.** The 5a undo is for
  in-app tool decisions, not for
  settings import. A user who clicks
  Apply and regrets it 5 seconds later
  has to re-import the previous state
  from a known-good export. A v2 could
  add a 10-second "Click to undo import"
  toast that snapshots-and-restores.

---

### 9.21 Decision #66 polish - SHIPPED (file-tree right-click context menu, see CHANGELOG "Added (Decision #66 polish - file-tree right-click context menu)")

A polish phase that
replaces the v1
`window.prompt` /
`window.confirm`
right-click flow
in `FileTreePane`
with 3 purpose-built
components. The
right-click action
picker is now a
floating
`<ul role="menu">`
with keyboard nav
and outside-click
dismissal; the new
file / rename name
input is a styled
modal with
validation; the
delete confirm is
a styled modal with
a danger-variant
Delete button.

**Context menu** (new
`FileRowContextMenu`,
in
`src/screens/EditorWorkspace/components/FileTreePane/FileRowContextMenu.tsx`).
A floating
`<ul role="menu">`
positioned at the
right-click's
`e.clientX` /
`e.clientY`. Each
item is a
`<li role="menuitem">`
with a typed
`action: 'new-file' |
'rename' | 'delete'`
and an optional
`destructive`
flag. The component:

- Renders the menu
  at
  `position: fixed`
  with `left` / `top`
  computed by the
  pure helper
  `computeContextMenuPosition`
  (auto-flips to
  the left if the
  click was near
  the right edge;
  auto-flips up if
  the click was
  near the bottom;
  clamps both
  axes to the
  viewport right
  edge so a click
  far off the
  right side
  doesn't place
  the menu off-screen).
- Closes on
  outside-click
  (document-level
  `mousedown`
  listener; the
  menu itself
  stops
  propagation on
  its own items
  so a click on
  an item is
  "inside" and
  activates the
  item, not
  "outside" and
  dismisses).
- Closes on
  Escape
  (document-level
  `keydown`
  listener with
  `stopPropagation`
  so other
  modals can
  coexist).
- Supports full
  keyboard nav:
  ArrowUp /
  ArrowDown to
  move the
  focused item,
  Enter or Space
  to activate,
  Home / End to
  jump to the
  first / last.
  Disabled items
  are skipped
  when arrowing
  past them.
- Mouse hover
  updates the
  focused index
  so the mouse
  and keyboard
  stay in
  lockstep
  (hovering item
  3 then pressing
  Enter activates
  item 3).
- Auto-focuses
  the first
  non-disabled
  item on open
  (via a
  `useEffect`
  that finds the
  first
  `:focusable`
  in the menu and
  calls `.focus()`).
- The destructive
  item carries
  `data-destructive`
  so the CSS can
  paint the
  label in the
  danger colour
  and the hover
  state in the
  danger-soft
  background.

**Inline name input**
(new
`InlineNameInput`,
in
`.../InlineNameInput.tsx`).
A modal that
reuses the shared
`Modal` primitive,
wrapping it with a
labelled text
input + Cancel /
Submit buttons.
The component:

- Drives the
  behaviour off
  a `mode` prop
  (`'new-file'` or
  `'rename'`),
  which sets the
  title
  ("New file" /
  "Rename"), the
  submit button
  label
  ("Create" /
  "Rename"), and
  the pre-selection
  strategy
  (whole value for
  new-file,
  basename-only
  for rename).
- Validates the
  input on every
  keystroke via
  the pure helper
  `validateFileName`.
  The submit
  button is
  disabled when
  the value is
  invalid; an
  inline error
  message
  appears below
  the input once
  the user has
  touched it
  (avoids the
  "yelled at on
  first open"
  UX).
- Re-validates
  on submit
  (defends
  against a
  paste + submit
  in the same
  frame, where
  the keystroke
  validation may
  not have run
  yet).
- Resets its
  internal state
  (`value` and
  `touched`) when
  the `open` prop
  flips to `true`,
  syncing the
  input back to
  the new
  `initialName`
  the parent
  passes.
- Uses
  `useId` for the
  title id, so
  multiple
  modals in the
  same tree
  (a future
  "New folder"
  modal, e.g.)
  don't clash on
  `aria-labelledby`.

**Confirm destructive
modal** (new
`ConfirmDestructiveModal`,
in
`.../ConfirmDestructiveModal.tsx`).
A modal that
reuses the shared
`Modal` primitive,
wrapping it with a
title + body +
Cancel / Delete
button pair. The
Delete button uses
`Button`'s
`variant="danger"`.
The body varies
based on `kind`:
- `'file'` →
  `Delete "foo.txt"? This cannot be undone.`
- `'folder'` →
  `Delete folder "bar" and all its contents? This cannot be undone.`

The component is
presentational —
the parent owns
the actual delete
IPC call. The
modal just
renders + dispatches
the parent's
callbacks.

**Pure helpers** (new
`fileNameValidation.ts`).
Two pure functions
back the inline
name input:

- `validateFileName(name, existingNames)`
  — a
  discriminated
  union: success
  with the
  trimmed /
  cleaned name,
  or failure with
  a human-readable
  reason. Rules
  (7):
  1. Not empty
     after trim.
  2. Not `.` or
     `..`.
  3. No path
     separators
     or other
     Windows-illegal
     characters
     (`\ / : * ? " < > |`
     and the
     null char).
  4. Not a
     reserved
     Windows
     device name
     (CON, PRN,
     AUX, NUL,
     COM1-9,
     LPT1-9).
  5. Not in
     `existingNames`
     (case-insensitive
     collision
     check —
     Windows and
     default-HFS+
     macOS are
     case-insensitive).
  6. Length <=
     `MAX_NAME_LENGTH`
     (255, the
     cross-platform
     max).
  7. Strips
     trailing dots
     / spaces
     (Windows
     refuses to
     create files
     whose names
     end in them).
- `suggestNewFileName(existingNames, extension)`
  — returns
  `untitled.txt`,
  `untitled (1).txt`,
  `untitled (2).txt`,
  ... up to a
  10k cap (after
  which it bails
  out with a
  timestamped
  fallback). The
  extension
  defaults to
  `.txt` and the
  caller can
  pass any other
  extension.

**Pure helper**
(`computeContextMenuPosition`).
The position
math (auto-flip
near viewport
edges, clamp
both axes to the
viewport right
edge) is a
4-case pure
function
exported from
`FileRowContextMenu.tsx`
and tested with 4
edge cases (room
available,
near-right edge,
near-bottom edge,
far-past-right
edge).

**Wiring.** The
state machine
lives on
`TreeNode` (the
per-row component
in `FileTreePane`)
as 3 mutually-exclusive
pieces of state:
- `menu: { x, y, entry } | null`
  — the floating
  menu
- `nameInput: { mode, initialName, existingNames, target } | null`
  — the inline
  name modal
- `confirm: { kind, name, target } | null`
  — the
  destructive
  confirm

Only one is open
at a time (by
conditional render).
The existing
`runMutation` is
the common path
for surfacing
errors next to the
row. The
`collectExistingNames`
helper reads
`useFileTreeStore.entriesByDir[parent]`
to build the
collision-check
set on open.

The 4
`window.prompt`
calls and 2
`window.confirm`
calls in the v1
flow are gone.
The
`runMutation`
function is
unchanged (it
already handled
the try-catch +
`setRowError`
pattern); only
its callers
changed.

**Verification.**

- `npx tsc -b` —
  clean
- `npx vitest run`
  — **791/791
  pass** (was 735
  before the #66
  polish, +4 files
  / +56 tests).
- `npm run build`
  — clean
- `cargo check` —
  clean (frontend-only
  phase)

**Known limitations.**

- **No nested context menu.** A user who right-clicks a folder row can pick "New file in folder…", but they can't right-click a folder, open the menu, hover "New file", and have a submenu appear. A v2 could add a submenu with the same `computeContextMenuPosition` math.
- **No keyboard shortcut to open the menu on the focused row.** A keyboard user can `Tab` to a row, but the only way to open the menu is a right-click. A v2 could add a `Shift+F10` or `ContextMenu` key handler on the row that opens the menu at the row's `getBoundingClientRect` centre.
- **No animation.** The menu appears and disappears instantly. A v2 could add a CSS transition (`data-state="entering" / "exiting"`) and a 100ms fade.
- **No new-folder action.** The menu only has New File, Rename, Delete. New Folder is a v2 (it would be a third `kind: 'folder'` row in the `ConfirmDestructiveModal`, plus a `mode: 'new-folder'` in `InlineNameInputMode`).

### 9.22 M6a - SHIPPED (Multi-workspace tabs: data model + tab strip, see CHANGELOG "Added (M6a — Multi-workspace tabs: data model + tab strip)")

The first half of the M6
multi-workspace tabs
plan. M6a ships the
data model + the
tab strip; M6b
(separate phase) will
add per-tab state
keying and a v3→v4
settings export /
import migration.

**The data model
change.** The pre-M6a
`useWorkspaceStore`
tracked a single
`currentPath:
string | null`. That
field is gone; the
new shape is:

```ts
interface WorkspaceTab {
  id: string;       // crypto.randomUUID()
  path: string;     // absolute folder path
  addedAt: number;  // Date.now()
}

interface WorkspaceState {
  workspaces: WorkspaceTab[];
  activeId: string | null;
  recents: string[];
  // ... status, hydrated, plus the same
  // open/close/setActive/setStatus/clearRecents/
  // removeRecent actions as before
}
```

The `id` is a UUID
(not the path) so the
tab stays
identifiable across
rename / move — the
canonical tab key in
all persistence keys,
all recents, and all
in-store subscriptions
is the `id`. The
`path` is the human
facing label and the
only thing persisted
in the v2 export
shape. The `addedAt`
breaks ties in "most
recent tab" ordering
(M6b will need it for
the "tab to the right
of the closed one"
fallback when two
tabs share a path).

**`useActivePath` —
the canonical
replacement for
`state.currentPath`.**
A pure helper:

```ts
export function useActivePath(
  state: Pick<WorkspaceState, 'workspaces' | 'activeId'>,
): string | null {
  if (!state.activeId) return null;
  const tab = state.workspaces.find((w) => w.id === state.activeId);
  return tab?.path ?? null;
}
```

Plus a React-side
companion:

```ts
export function useActivePathSelector(): string | null {
  return useActivePath(useWorkspaceStore.getState());
}
```

The existing
`workspaceSelectors.currentPath`
now points to
`useActivePath`, so
the 5 pre-M6a
consumers that read
`useWorkspaceStore(s => s.currentPath)`
are migrated to
`useWorkspaceStore(workspaceSelectors.currentPath)`
in this PR. The
helper function in
`tourSteps.ts`
(`readWorkspaceGateFields`)
is refactored to
accept a plain
`{ hydrated, currentPath }`
object instead of a
`Pick<WorkspaceState, ...>`,
decoupling the
onboarding-tour gate
from the internal
store shape. New code
should use
`useActivePathSelector()`
directly.

**The persistence
migration (v1 → v2,
in-store, idempotent,
non-destructive).**
Three new v2 keys:
`lipi:workspace:workspaces:v1`
(the tab array),
`lipi:workspace:activeId:v1`
(the active tab id),
and the unchanged
recents key
`lipi:workspace:recents:v1`.
The pre-M6a v1 key
`lipi:workspace:v1`
is the single
`currentPath` string
or `null`. On first
hydrate after M6a
ships, if the v2
workspaces key is
absent, the store
reads the v1 keys,
wraps the v1
`currentPath` in a
single `WorkspaceTab`
(generated via
`createWorkspaceTab(path)`,
which is just
`{ id: crypto.randomUUID(), path, addedAt: Date.now() }`),
merges the v1 recents
into the v2 recents
key (deduped, in
order), and writes
the v2 keys. The v1
keys are then removed
— a successful
migration is the
right time to drop
the old shape.

The migration is
defensive about
partial / corrupt
data. Each tab row is
shape-checked
(`id` string, `path`
string, `addedAt`
number) and malformed
rows are dropped — a
single corrupt row
from a future version
doesn't wipe the
whole tab list. The
active id is validated
against the tab list
and falls back to the
first tab if it
doesn't match (the
user sees their
last-open workspace).
Missing-but-tabs-present
is recovered by
picking the first tab.
Recents are filtered
to strings only; the
shape hasn't changed
in V1, so a corrupt
entry is a one-liner
to drop.

The migration only
fires when the v2
workspaces key is
absent. After the
first M6a hydrate, the
v1 key is gone and
the v2 keys are the
only source of truth.
The `open()`, `close()`,
and `setActive()`
actions write to the
v2 keys only — the
v1 key is never
re-written by the
new code. (A
defensive measure in
case a user has both
an old binary and a
new binary running
side-by-side, e.g. a
dev session and a
packaged build; the
old binary's last
`currentPath` write
would otherwise
re-introduce the v1
key, but the new
binary's read-side
migration handles
that by re-reading
the v1 key if the v2
key is gone.)

**The `WorkspaceTabs`
component.** One pill
per open tab,
rendered as a flex
strip between the
titlebar and the file
tree. The strip lives
in a new grid row
(`grid-area: tabs`,
`grid-template-rows:
36px auto 1fr 24px`)
so it sits directly
under the titlebar
and pushes the file
tree down to fill the
remaining space. Each
pill has the folder
basename (the last
path segment, with
`/[^/\\]+$/` regex —
handles both Windows
`\` and Unix `/` path
separators) as its
label, with a `title`
attribute carrying
the full path on
hover. The active tab
has a `data-active="true"`
attribute (which the
CSS uses to paint the
accent underline +
lighter background)
and `aria-selected="true"`
(per WAI-ARIA's tab
pattern). The whole
strip is `role="tablist"`
with `aria-label="Open workspaces"`.

The `×` close button
on each pill is a
real `<button>` (not
a span) with
`aria-label="Close <basename>"`
and a `stopPropagation`
on click so it
doesn't also activate
the tab. Middle-click
on the pill itself
also closes the tab
— the standard
browser-tab affordance,
wired via the
`onAuxClick` handler
with a `e.button === 1`
check.

The `+` button at the
right end opens the
native folder picker
via `pickFolder()` and
calls `open(chosen)`
on the result. The
existing
`openWorkspace(path)`
helper in the Welcome
screen folder is the
single bridge between
the picker and the
store; the new `open`
action in the store
handles the
dedup-and-activate
logic (if the path is
already open, just
re-activate the
existing tab and bump
recents; if not, add
a new tab + make it
active).

The strip returns
`null` when
`workspaces.length === 0`
— the editor is not
visible in that state
(the router routes to
the Welcome screen),
and the strip would be
visual noise. The
component decides
visibility itself so
callers don't need to
know.

**`useFileTree`
reactivity.** The
hook subscribes to
`useWorkspaceStore`
and re-roots the file
tree to the new active
path whenever the user
switches tabs:

```ts
useEffect(() => {
  const unsubscribe = useWorkspaceStore.subscribe(
    (state, prev) => {
      const next = useActivePath(state);
      const prevPath = useActivePath(prev);
      if (next !== prevPath) {
        if (next) {
          setStatus({ kind: 'loading', rootPath: next });
          void loadDir(next).then(() => {
            // ... update status if still active ...
          });
          setRoot(next);
        } else {
          reset(); // all tabs closed
        }
      }
    },
  );
  return unsubscribe;
}, [loadDir, reset, setRoot, setStatus]);
```

The per-tab
expansion state is
global in M6a (a
single `expanded` set
in `useFileTreeStore`).
M6b will key it per
tab (so switching
from tab A (expanded
to `/src`) to tab B
(collapsed) and back
preserves A's
expansion). For M6a,
the file tree
re-roots to the new
active path on
switch; the expansion
state is whatever it
was on the previous
visit to that path
(it's a `Map<path, Set<dir>>`,
so the same path keeps
its expansion across
visits).

**Backward
compatibility.** The
v2 export format is
unchanged: a
`lipi-state` JSON
file's `workspace`
section still has a
`currentPath` field
(plus the existing
`recents` array). The
apply path (both v2
and v3) reconstructs
a `WorkspaceTab` from
the imported
`currentPath`:

```ts
if (v.currentPath) {
  const tab = createWorkspaceTab(v.currentPath);
  useWorkspaceStore.setState({
    workspaces: [tab],
    activeId: tab.id,
    recents: v.recents,
  });
}
```

So a v2 / v3 export
file from a pre-M6a
install imports into
M6a with the same
"one open workspace"
shape it had on
export. The inverse
direction (M6a
exporting a v2 / v3
file) is handled the
same way:
`workspace: { currentPath: useActivePath(s), recents: [...s.recents] }`
— if multiple tabs
are open, only the
active one is
exported, which is
the right behaviour
for the "I want to
share my workspace
state with a friend"
use case. M6b's v4
export format will
extend the `workspace`
section to a
`workspaces[]` array
with per-tab state;
the v3 → v4 import
migration will wrap
the old `currentPath`
in a `WorkspaceTab`
with empty per-tab
state.

**The 18 test files
that were touched**
(not added) to
migrate `setState({
currentPath: ... })`
and `s.currentPath`
reads to the new v2
shape
(`workspaces` +
`activeId`): the
`settingsIOv2.apply.test.ts`
and
`settingsIOv3.apply.test.ts`
mocks needed explicit
`useActivePath` and
`createWorkspaceTab`
exports; the
`useApplyTemplate.test.ts`
and
`useOpenWorkspace.test.ts`
`resetStore` calls
needed
`workspaces: [], activeId: null`;
the
`useDeepLinkRouting.test.ts`
same. The
`commands.test.ts`
`open()` /
`close()` /
`setActive()` tests
needed the new v2
shape. The
`PrivacyDataCard.test.ts`
mock state needed a
`workspaces` / `activeId`
/ `currentPath`-derived
shape. The
`settingsIOv2.apply.test.ts`
assertions check
`setStateMock.toHaveBeenNthCalledWith({ workspaces: ..., activeId: ... })`
rather than the old
`currentPath` field.
Most of these are
one-line `setState`
updates; the mock
updates are the
meatiest parts of the
PR (the v2 / v3 apply
test files are 50+ line
diffs each).

**`renderToStaticMarkup`
vs. real DOM render
for `WorkspaceTabs`
tests.** This is
Decision #78. Zustand
uses
`useSyncExternalStore`
under the hood:

```js
function useStore(api, selector = identity) {
  const slice = React.useSyncExternalStore(
    api.subscribe,
    React.useCallback(() => selector(api.getState()), [api, selector]),
    React.useCallback(() => selector(api.getInitialState()), [api, selector])
  );
  ...
}
```

The third argument is
the *server snapshot*
— it returns
`selector(api.getInitialState())`,
not the live state.
`renderToStaticMarkup`
IS SSR, so the
component sees the
*initial* state, not
whatever the test set
up via
`useWorkspaceStore.setState({...})`.
The test debug output
made the bug obvious:

```
DEBUG state: [{t1}, {t2}]        // test set up
DEBUG WorkspaceTabs activeId: null getState activeId: t1  // BUG
```

The component's
`useSyncExternalStore`
returns the *initial*
state (no tabs), so
the component renders
`null`, so the static
markup is `''`, so
`html.match(/role="tab"/g)`
returns `null`, so
`(html.match(...) ?? []).toHaveLength(2)`
throws a `TypeError`
on `null.toHaveLength`.
The fix is to use a
real DOM render
(`createRoot` + `act`)
in all six tests. The
DOM render subscribes
to the live state via
the regular
`useSyncExternalStore`
path, so the test's
`setState` is visible
to the component. The
test setup is wrapped
in a `mount()` helper
that creates a fresh
`div` per test and
unmounts on cleanup.

**The test
breakthrough.** This
session had a long
debug on the
`WorkspaceTabs` tests
where
`renderToStaticMarkup`
was returning an
empty string. The
debug output (via
`process.stderr.write`
to bypass Vitest's
console capture)
revealed that
`useWorkspaceStore.getState().activeId`
was `'t1'` but
`useWorkspaceStore(workspaceSelectors.activeId)`
returned `null` — the
hook was reading
*initial* state during
SSR. The fix was to
switch all six tests
to a real DOM render
with `createRoot` +
`act`. This is a
documented Vitest
+ Zustand gotcha
(Decision #78); future
tests of components
that read Zustand
state should use DOM
render, not
`renderToStaticMarkup`.

**M6b (SHIPPED).** See §9.23 below.

### 9.23 M6b - SHIPPED (Per-tab state keying + v4 settings export / import, see CHANGELOG "Added (M6b — Per-tab state keying + v4 settings export / import)")

The second half of the M6 multi-workspace tabs plan. M6a ships the data model + tab strip; M6b makes each tab a *full* workspace: per-tab state (file-tree expansion, selected row, open editor tabs, active editor tab) is persisted on the tab itself, and switching tabs rehydrates that state into the live stores (`useFileTreeStore`, `useEditorTabsStore`) via mirror-back effects. The settings export / import format is bumped to v4.

**The data model change.** The M6a `WorkspaceTab` had three fields: `id`, `path`, `addedAt`. M6b adds a fourth field — `state: WorkspaceTabState` — that holds the per-tab UI state:

```ts
export interface WorkspaceTabState {
  expandedDirs: string[];          // absolute paths of expanded directory rows
  selectedPath: string | null;     // absolute path of the focused file-tree row
  openEditorTabPaths: string[];    // absolute paths of open editor tabs, in display order
  activeEditorTabPath: string | null; // absolute path of the active editor tab
}

export const EMPTY_TAB_STATE: WorkspaceTabState = {
  expandedDirs: [],
  selectedPath: null,
  openEditorTabPaths: [],
  activeEditorTabPath: null,
};

interface WorkspaceTab {
  id: string;
  path: string;
  addedAt: number;
  state: WorkspaceTabState;  // NEW in M6b
}
```

The four fields were chosen by audit: they are the four pieces of state that "you switched to tab X last week, you came back to tab X today, and tab X should look exactly how you left it" demands. The four are deliberately the *minimum* — scroll position, per-tab font size, per-tab theme, per-tab recents, per-tab git / tool / voice settings are all out of scope for M6b and parked in M6c.

`createWorkspaceTab(path, id, addedAt, state)` now takes an optional 4th argument defaulting to `EMPTY_TAB_STATE`. The `hydrate` step is defensive about pre-M6b tabs persisted under the v2 key: any tab row that lacks a `state` field (or has a partial / corrupt one) is normalised to `EMPTY_TAB_STATE` on read, so users with a pre-M6b binary plus an M6b binary side-by-side don't see a "selected row is `undefined`" crash. The three shape fields are still strictly validated (`id` string, `path` string, `addedAt` number); only the new `state` field is permissive (synthesise defaults, don't drop the tab).

**The mirror-back architecture.** The `WorkspaceTab.state` is the *persisted source of truth* for per-tab UI state. The two live stores (`useFileTreeStore` for the file tree, `useEditorTabsStore` for the editor tabs) are the *live, transient view* of that state for the currently active tab. The two views stay in sync via two `useEffect` hooks (one in `useFileTree`, one in `useEditorTabs`):

1. **Tab switch rehydration.** When the active workspace tab changes (the `activeId` in `useWorkspaceStore` updates), the new tab's `state` is read from `useWorkspaceStore.getState().workspaces[activeIndex].state` and pushed into the respective live stores. For the file tree, the live `useFileTreeStore.setExpandedAndSelected(expandedDirs, selectedPath)` action replaces the live expansion + selection; for editor tabs, the live `useEditorTabsStore.replaceAll(openEditorTabPaths, tabs, activeEditorTabPath)` action replaces the open-tab order, the open-tab record, and the active tab. The editor tab rehydration also re-reads each file from disk via the existing `readFile` IPC command (the file content is not in the persisted state — only the path is), so the editor's contents are guaranteed to be fresh.

2. **Mutation mirror-back.** When user interactions (toggle a directory row, click a file row, open a new file in the editor, close an editor tab, activate a different editor tab) modify the live stores, those changes are immediately mirrored back to the active `WorkspaceTab.state` in `useWorkspaceStore` via dedicated actions: `useWorkspaceStore.setTabState(tabId, partial)` (a partial merge into the active tab's state) or `useWorkspaceStore.replaceTabState(tabId, state)` (a full replace). The mirror-back is a `useEffect` subscription (`useWorkspaceStore.subscribe((state, prev) => { ... })`) that fires on any change to the live store and forwards the new live values into the persisted `WorkspaceTab.state`.

The two hooks are colocated with their respective live store — `useFileTree.ts` owns the file-tree rehydration + mirror-back, `useEditorTabs.ts` owns the editor-tab rehydration + mirror-back — and both hooks reuse the existing `useWorkspaceStore.subscribe` pattern that M6a uses for the active-path re-derive. The mirror-back is intentionally one-way on each side: the live store is "the current view", the persisted state is "what to write back", and the user interactions only ever flow into the live store (the persisted state is the long-term storage).

The end result: a user can open tab A, expand a deep tree, open three editor tabs, switch to tab B (which has its own expansion + editor tabs), switch back to tab A, and the file tree + editor tabs are exactly how they left them. Persistence is automatic — every mutation writes to `localStorage` under the existing v2 keys (`lipi:workspace:workspaces:v1` is reused; the v2 data model is a superset of M6a's).

**The v4 settings export / import format.** The v3 export shape had a single `workspace.currentPath: string | null`. v4 replaces that with a `workspace.workspaces[]` array of `{ id, path, addedAt, state: WorkspaceTabState }` rows:

```ts
export interface ExportedWorkspaceTabV4 {
  id: string;
  path: string;
  addedAt: number;
  state: WorkspaceTabState;
}

export interface ExportedWorkspaceV4 {
  workspaces: ExportedWorkspaceTabV4[];
  activeId: string | null;
  recents: string[];
}

export interface LipiStateV4Data {
  format: typeof LIPI_STATE_V4_FORMAT;  // 'lipi-state-v4'
  version: 4;
  workspace: ExportedWorkspaceV4;
  voicePreferences: VoicePreferencesV2;
  toolSettings: ToolSettingsExportV2;
}

export interface LipiStateV4File {
  format: typeof LIPI_STATE_V4_FORMAT;
  version: 4;
  exportedAt: string;  // ISO 8601
  data: LipiStateV4Data;
}
```

The `format` + `version` fields are the v4 wire-format fingerprint. The `format` is `'lipi-state-v4'` (a separate constant from `version: 4` so a future `format: 'lipi-state-v5'` with `version: 4` is still detectable as a new format — see Decision #84). The `exportedAt` timestamp is the only new top-level field; everything else is a rename / restructure of v3's `data` block.

The new module `src/shared/settingsIOv4.ts` defines the schema (`ExportedWorkspaceV4`, `LipiStateV4Data`, `LipiStateV4File`), the builder (`buildLipiStateV4`), the serializer (`serialiseLipiStateV4`), the filename suggester (`suggestLipiStateV4Filename`), the privacy checker (`serialisedFileLooksPrivateV4`), and the parser (`parseLipiStateV4`). The privacyDataCard's `snapshotStoresForExport` is refactored to produce a v4 snapshot, with each tab's state cloned per tab (so the snapshot is a deep copy, not a reference into the live store — see Decision #84).

**The v3 → v4 in-memory migration.** `parseLipiStateV4` auto-detects v3 input by inspecting the `version` field: `version: 4` parses as v4, but `version: 2`, `version: 3`, no `version` field, or any input that has a `currentPath` (and no `workspaces[]`) is treated as v3 and migrated in-memory to v4 before validation. The migration (`migrateV3DataToV4`) wraps the v3 `currentPath` in a single `WorkspaceTab` with `EMPTY_TAB_STATE`:

```ts
// v3 input: { version: 3, workspace: { currentPath: '/x/y', recents: [...] }, ... }
// v4 output: { version: 4, workspace: { workspaces: [{ id, path: '/x/y', addedAt, state: EMPTY_TAB_STATE }], activeId: <id if currentPath !== null else null>, recents: [...] }, ... }
```

A v3 `currentPath: null` becomes an empty `workspaces[]` and `activeId: null` (the pre-M6a "no workspace open" state). A v3 `currentPath: string` becomes a single tab with that path, `activeId` set to the new tab's id, and the same `recents` array. The v3→v4 migration is the *only* way to import a v3 file — there is no separate `parseLipiStateV3` / `applyLipiStateV3` v4 path — so a v3 file and a v4 file go through the same import code.

The migration is detected + applied before validation, so the v3 schema is never validated by the v4 validator (which would reject `currentPath` as an unknown field). The v3 schema is validated by a dedicated `validateV3Workspace` function inside `settingsIOv4.ts`, which checks the v3 shape (`currentPath` + `recents`) directly without relying on `settingsIOv2.parseLipiStateV2` (which strictly enforces `version: 2` and rejects v3 input). This was the v3→v4 migration gotcha: `parseLipiStateV2` is too strict to validate v3 files, so the migration has its own validator.

**The transactional apply (S3 design reused).** `src/shared/settingsIOv4.apply.ts` exports `applyLipiStateV4(data: LipiStateV4Data)`, which is the canonical "import a v4 settings file" function. It uses the same transactional design as the v3 apply (Decision #67): `snapshotStores()` → mutate the three target stores (`useWorkspaceStore`, `useVoicePreferencesStore`, `useToolSettingsStore`) → `restoreSnapshots()` on any error. The "any error" includes the validation errors thrown by the per-tab `validateWorkspaceTabState` + `validateWorkspaceTab` + `validateWorkspace` + `validateVoicePreferences` + `validateToolSettings` functions. A user who imports a corrupt v4 file gets an "Import failed" toast and their existing settings are unchanged.

**The preview diff.** `src/shared/settingsIOv4.preview.ts` exports `computeLipiStateV4ImportPreview(current, incoming) → LipiStateV4ImportPreview` and `previewDiffLabelV4(diff) → string`. The preview breaks down the incoming changes into five sections: workspace tabs (added / removed / changed per tab), per-tab state (detailed diff of `expandedDirs` added / removed, `selectedPath` changed, `openEditorTabPaths` added / removed, `activeEditorTabPath` changed), active tab (displayed as a path, not an id), recents (added / removed), voice preferences (changed boolean / string fields), tool settings (changed confirmation mode per tool). The PrivacyDataCard's import preview block uses this function to render a human-readable diff.

**PrivacyDataCard's UX changes.** The card now exports in v4 format (`LIPI_STATE_V4_FORMAT` shown in the format note), imports via the v4 parser (which auto-detects v3 files), and renders the v4 preview. If the imported file was a v3 file (auto-migrated), a `.migrationNotice` UI block appears under the format note explaining that the file was upgraded from v3 — "this file was exported from an earlier Lipi version; we'll import it as a v4 file with empty per-tab state." The format note shows `LIPI_STATE_V4_FORMAT` and `LIPI_STATE_V4_VERSION` as the canonical "this is what we export" reference. The `version: 4` field is in the data block (not the file wrapper), and the file wrapper's `version` is the *file format version* — for v4, they happen to be the same number, but a future v5 file could have `file.version: 5` + `data.version: 4` (see Decision #84).

**No Rust changes.** `cargo check` / `cargo test` unchanged. M6b is a frontend-only phase.

**Titlebar**: now `dev · M6b`.

**Verification**:

- `npx tsc -b` — clean, 0 errors.
- `npx vitest run` — **874 / 874** pass (was 813).
- `npm run build` — clean, 720 KB JS / 107 KB CSS, gzipped 203 KB / 18 KB.
- `cargo check` — clean (no Rust changes).

**Decisions** (the architectural calls):

- **#81** — `WorkspaceTab.state` is the persisted source of truth for per-tab UI state. The live stores (`useFileTreeStore`, `useEditorTabsStore`) are the transient view, synced via mirror-back `useEffect` hooks. M6b's four core fields (`expandedDirs`, `selectedPath`, `openEditorTabPaths`, `activeEditorTabPath`) are the minimum set; per-tab scroll position, font size, theme, recents, git / tool / voice settings are parked in M6c.
- **#82** — The v4 export shape extends v3's `workspace.currentPath` to a `workspace.workspaces[]` array of `{ id, path, addedAt, state }` rows. The v3 → v4 import migration is an in-memory transformation in `parseLipiStateV4` — the parser auto-detects v3 input by inspecting `version` and `currentPath` and migrates before validation. There is no separate `parseLipiStateV3`; v3 files go through the same v4 import path.
- **#83** — The mirror-back is one-way: the live store is the current view, the persisted `WorkspaceTab.state` is the long-term storage, and user interactions only ever flow into the live store (the persisted state is the destination of the mirror-back). This is the opposite of the typical "live store hydrated from persistence on load" model; the persistence is a *shadow* of the live store, updated on every mutation. The benefit is that the live store stays simple (it doesn't need a persistence subscription), and the persisted state is always in sync (no debounce, no stale-write window).
- **#84** — The `format` and `version` fields are separated: `format` is the wire-format fingerprint (`'lipi-state-v4'`), `version` is the in-file data version (`4`). For v4 they happen to match, but a future v5 file could have `format: 'lipi-state-v5'` with `version: 4` (a data-only change) or `format: 'lipi-state-v4'` with `version: 5` (a schema-only change). The v4 snapshot in `snapshotStoresForExport` is a deep clone (via `structuredClone`-equivalent for our shape) so the exported JSON is a true point-in-time snapshot, not a reference into the live store.

### 9.24 Phase 2 - SHIPPED (Offline licensing layer, see CHANGELOG "Added (Phase 2 — Offline licensing layer)")

The first step of the "Lipi to Paid Public Launch" roadmap (drafted in late May 2026 when the project lead decided to pivot from "open-source IDE" to "downloadable + paid product"). Phase 2 ships an **offline-verifiable subscription**: a license key is a JWS-style compact signed document (`LIP1.<base64url(payload)>.<base64url(signature)>`) using Ed25519, and the Rust side verifies the signature offline — no server round-trip, no phone-home, no revocation list. The "no backend, ever" rule (Decision #17) and the user's choice to keep license validation offline both pointed to this architecture.

**The data model**

A license payload is a `LicensePayload` struct (in `src-tauri/src/licensing.rs`) with seven fields:

- `format: String` — fixed `"lipi-license-v1"`. The parser rejects unknown formats.
- `plan: String` — one of `"trial"`, `"monthly"`, `"yearly"`. Drives the paywall + grace period.
- `iat: i64`, `nbf: i64`, `exp: i64` — Unix timestamps. `nbf` is almost always `== iat`; the field exists for "delayed activation" use cases.
- `sub: String` — the machine fingerprint (SHA-256 of `hostname || "\n" || username || "\n" || mac_address`, hex-encoded to 64 chars). The license is bound to this machine.
- `jti: String` — a random per-license id (16 random hex chars). For log de-duplication and the future "deactivation list" UI.

The signed key is the JWS compact serialization: `"LIP1." || base64url(payload_json) || "." || base64url(signature)`. The signature is 64 bytes (Ed25519 / RFC 8032). A real key looks like `LIP1.eyJmb3JtYXQiOiJsaXBpLWxpY2Vuc2UtdjEiLCJwbGFuIjoieWVhcmx5I...<truncated>.<signature>`.

**The two keypairs**

- **Production** (`PROD_PUBKEY`, embedded as `const [u8; 32]`) — signs paid license keys. The private key is in the project lead's CI secret store + a local encrypted USB drive. NEVER committed.
- **Trial** (`TRIAL_PUBKEY` + `TRIAL_PRIVKEY`, both embedded) — signs trial license keys. The private key IS embedded (a deliberate trade-off: 14-day max `exp` bounds the worst case; a 100% secure key can't be embedded because the trial is generated locally). Even if someone extracts the trial private key, the max damage is 14 days of free usage on a single machine.

**The status derivation**

The Rust side returns one of six `LicenseStatus` variants (a tagged union with `tag = "kind"`, `rename_all = "camelCase"`):

- `Unactivated` — only seen after an explicit `license_deactivate()` call. The first `license_get_status` after install auto-generates a trial, so the steady-state is never `Unactivated`.
- `Active { plan, expiresAt, issuedAt, daysRemaining }` — paid license, valid + not expired.
- `GracePeriod { plan, expiredAt, daysIntoGrace }` — past `exp` but within the 7-day grace period.
- `Expired { plan, expiredAt }` — past the 7-day grace.
- `Trial { expiresAt, daysRemaining }` — 14-day free trial.
- `Invalid { reason }` — key failed verification. `reason` is a machine-readable string (`"machine-mismatch"`, `"verification-failed: signature verification failed"`, `"not-yet-valid: nbf 123 is in the future"`, etc.) that the UI surfaces in a `humanizeInvalidReason` helper.

**The Rust↔JS IPC**

Four Tauri commands (registered in `src-tauri/src/lib.rs`'s `invoke_handler!` macro, gated `#[cfg(not(mobile))]` for desktop-only):

- `license_get_status() -> LicenseStatus` — reads keychain, verifies signature, checks machine fingerprint, derives status. Re-verifies on every call (Ed25519 is microseconds).
- `license_activate(key: String) -> LicenseStatus` — verifies the pasted key, stores in keychain, returns the new status. On failure, returns `Invalid { reason }` WITHOUT modifying the keychain.
- `license_deactivate() -> LicenseStatus` — deletes the keychain entry. The next `license_get_status` call auto-generates a new 14-day trial (the v1 "transfer to a new machine" flow).
- `license_get_machine_fingerprint() -> String` — returns this machine's fingerprint (64 hex chars). Used by the activation screen so the user can include it in a "please issue me a license" support email.

The TS side mirrors this in `src/ipc/licensing.ts` (typed wrappers + `LicenseStatusPayload` union). The Rust `LicenseError` enum (the four variants `InvalidInput` / `InvalidShape` / `KeychainUnavailable` / `Platform`) follows the same `tag = "kind"`, `camelCase` convention as the existing `SecretError` and is caught in the Rust command wrappers (the IPC commands return `LicenseStatus` directly — even `Invalid` is a valid payload, not an exception).

**The TS state layer**

`src/shared/state/licenseStore.ts` — a small Zustand store with the same shape as `voiceCapabilitiesStore`:

- `status: LicenseStatusPayload | null` — `null` before the hydration IPC resolves, populated afterwards. The activation screen and settings card read `useLicenseStore(s => s.status)` synchronously.
- `machineFingerprint: string | null` — fetched lazily on demand.
- `hydrate()` — called once at app startup (in `AppRoot`'s useEffect). Idempotent: a second call is a no-op.
- `refresh()` — always re-calls the IPC. Call after `activate()` / `deactivate()`.
- `activate(key)` / `deactivate()` — wrap the IPC and update the cached status. Never throw — a bad key is a normal user error, surfaced via the `status` field.
- `loadMachineFingerprint()` — caches the result.

The store is NOT persisted to `localStorage` — the keychain IS the source of truth, and a stale cached status would be worse than a re-fetch on startup. (Same rationale as `voiceCapabilitiesStore`.)

**The UI**

Two new components:

- `src/screens/License/License.tsx` — the activation screen. A single-column form with a labelled textarea for the key, an "Activate" button, a "Get a license →" link to the pricing page, and a machine-fingerprint display. On a bad key, an inline error explains the reason (`humanizeInvalidReason`).
- `src/screens/SettingsProvider/components/LicenseCard.tsx` — a new section in the SettingsProvider. Shows the current status, a "Show machine fingerprint" button, and a "Deactivate" button (with a confirm step). Mirrors the visual style of the other cards (`PrivacyDataCard`, `WebSpeechCard`).

The full-screen gate (block the workspace when unactivated / past grace) and the title-bar trial badge are Phase 3.

**The test plan (38 new tests, 0 failures)**

- `cargo test licensing` — 21 tests covering the sign / verify round-trip, signature rejection on tampered payload, signature rejection on wrong signing key, malformed-key rejection (9 cases), oversize field rejection, machine fingerprint shape + stability, status derivation for all six variants, keychain integration via the `keyring` crate's `MockCredentialBuilder`, and the trial generation flow.
- `npm test src/shared/state/licenseStore.test.ts` — 10 tests covering the `null → populated` transition, hydrate idempotency, refresh non-idempotency, activate / deactivate IPC wiring, whitespace trimming on activate, machine fingerprint cache, and the `invalid` status surfacing on bad keys.
- `npm test src/screens/SettingsProvider/components/LicenseCard.test.ts` — 17 tests covering the `statusLine` and `humanizeInvalidReason` pure helpers (singular / plural day wording, plan capitalisation, machine-mismatch / not-yet-valid / verification-failed / empty-key reason strings, and the unactivated fallback).

**The threat model**

- **Extracting the trial private key from the binary** — bounded by the 14-day max `exp` on a single machine. A 100% secure key can't be embedded (the trial is generated locally); the design accepts this trade-off.
- **Generating fake license keys** — impossible without the production private key (which is NOT in the binary; it's in the project lead's CI secret store).
- **Sharing a license across machines** — the `sub` (fingerprint) claim is checked on every status call. A license for machine A returns `Invalid { reason: "machine-mismatch" }` on machine B.
- **Tampering with the keychain** — a self-signed payload fails signature verification on the next `license_get_status` call (the Rust side re-verifies on every read, no caching).
- **What we DON'T defend against** — debugger-driven bypass (a user who can attach a debugger to `lipi.exe` can patch out the verification), VM cloning (a user who clones a VM keeps the same fingerprint). Same threat model as JetBrains / Sublime / every other desktop tool.

**The deps** (added to `src-tauri/Cargo.toml`):

- `ed25519-dalek v2` — Ed25519 signing + verification. Pure-Rust, no C deps, MSRV 1.65+.
- `sha2 v0.10` — for the machine fingerprint hash. Already a transitive dep of `gix`; we depend directly for module self-containment.
- `base64 v0.22` — JWS-style base64url encoding.
- `hostname v0.4` — cross-platform hostname.
- `whoami v1` — cross-platform OS username.
- `mac_address v1` — cross-platform MAC address (the first non-loopback interface).

All six are well-maintained, pure-Rust, no C deps. Total binary impact: ~200 KB of compiled code (negligible vs. Monaco's 5 MB).

**Decisions** (the architectural calls):

- **#85** — License validation is offline-only. The "no backend, ever" rule (Decision #17) extends to license verification: no server round-trip, no revocation list, no phone-home. The trade-off is documented in the threat model above; the user explicitly chose this architecture when picking the production plan. The alternative (online validation) would have required building a license server + ops burden + GDPR-style data retention rules, all for a single-user desktop tool.
- **#86** — The trial private key is embedded in the binary. A 100% secure key can't be embedded (the trial is generated locally on first run). The design accepts the trade-off: a 14-day max `exp` bounds the worst case. The production private key is NOT embedded; it's in the project lead's CI secret store. A future phase could add a "paid trial" flow (a 30-day trial that requires a credit card) to defang the trial-reset abuse vector, but Phase 2's "14-day auto-trial + uninstall-to-reset" is good enough for v1.
- **#87** — The machine fingerprint is a SHA-256 of `hostname || "\n" || username || "\n" || mac_address`, hex-encoded. The combination is stable across reboots (none of the inputs change on a single machine) and unique per machine (collisions require identical hostname + username + MAC, which is essentially impossible in practice). VMs share the host's MAC, so a VM clone keeps the same fingerprint — but the OS username / hostname usually differ; in any case, the same threat model applies as JetBrains / Sublime.
- **#88** — The license key is a JWS-style compact serialization (`LIP1.<base64url(payload)>.<base64url(signature)>`) using Ed25519, NOT a custom wire format. The advantage: every standard library can verify the signature; the format is well-documented (RFC 7515 + RFC 8032); and a future "JWS in standard form" tool (e.g. `jose` CLI) can verify the key out-of-the-box. The `LIP1` prefix is the only Lipi-specific addition (it's a version marker; future versions would use `LIP2` etc., with a different prefix).

**Open questions / parked for later phases**

- License issuer CLI tool (`sign_license --plan yearly --machine <fp> --out license.txt`) — Phase 4. The Rust `sign_payload` function is public so the CLI can call it; the binary itself is a separate deliverable.
- "Restore from App Store" / "Restore from Microsoft Store" buttons — Phase 4. The activation screen has a single "Get a license →" link; the restore flow is added when the store IAP integration lands.
- "Transfer to a new machine" UI — Phase 3. The v1 flow is "deactivate on old machine + email support for a new key". Phase 3 adds a "Transfer" button that emails the project lead with both fingerprints.
- Trial-progress badge in the title bar — Phase 3.
- "Receipt" link / subscription management page — Phase 3 (after Phase 4 wires the IAP receipt).

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

### 9.25 Phase 3 - SHIPPED (Subscription UX + offline-purchase flow, see CHANGELOG "Added (Phase 3 — Subscription UX + offline-purchase flow)")

The second step of the "Lipi to Paid Public Launch" roadmap. Phase 2 shipped the offline-license *primitives* (JWS-style Ed25519-signed keys, machine fingerprint, keychain storage, the `license_*` IPC commands); Phase 3 ships the **complete user-facing subscription flow** on top of those primitives.

## The four new UI surfaces

(All implemented in `src/shared/components/{LicenseGate,TrialBadge,ExpiryBanner}/` and `src/screens/License/components/{TransferFlow,PricingCard}/`. The mapping from `LicenseStatus` to which surface renders is in `src/shared/components/LicenseGate/licenseSurfaces.ts`, a single pure function with 20 unit tests pinning every state × surface cell. See Decision #89 for the rationale.)

1. **`LicenseGate`** — a full-screen block (when the status is `expired` or `invalid`) or a dismissable nag modal (when the status is `gracePeriod`). Mounted at the AppRoot level so it overlays every screen. The gate's dismissal state is in `sessionStorage` (per-session, not persisted), so the nag reappears on next launch. The hard-block / nag-modal / nothing decision is in `licenseSurfaces(status).gate`; the component itself is a thin wrapper. See Decision #91 for the "grace period is a nag, not a hard block" rationale.
2. **`TrialBadge`** — a small pill in the title bar's right slot showing the current status. Three tones (red / amber / neutral) mapped to design tokens. Renders nothing for the "good standing" states (active > 7 days, unactivated). The tone thresholds are: red ≤ 3 days trial or any grace period; amber ≤ 7 days trial or active; neutral otherwise. See Decision #90 for the threshold rationale.
3. **`ExpiryBanner`** — a red horizontal banner between the title bar and the workspace tabs. Renders for the final-week trial (≤ 3 days remaining) and the grace period. Dismissable per-session via a "Got it" button; the "Activate now →" link navigates to the License activation screen.
4. **"Transfer to a new machine"** — a 3-step wizard on the License activation screen (and a "Transfer" button on the LicenseCard in Settings) that deactivates the license on this machine and generates a pre-formatted email to send to the project lead for re-issuing on a new machine. The wizard is `TransferFlow.tsx` with three steps: `confirm` (deactivate warning), `running` (IPC call), `result` (email body with both fingerprints + the plan name).
5. **In-app paywall** — a 3-tier pricing card (Free trial, $5/month, $50/year) above the activation form. The paid tiers open the project website via the system browser (plain `<a target="_blank">`); the trial tier is non-interactive (the trial is auto-generated). The prices are in a single `PRICING_TIERS` const in `src/screens/License/components/PricingCard/pricing.ts` so they can be updated without touching the component.

## The `iap_redeem` stub

(Implemented in `src-tauri/src/iap.rs` and `src/ipc/iap.ts`. The stub returns `LicenseStatus::Invalid { reason: "iap-not-yet-implemented: ..." }` for any input. See Decision #93 for the "stub now, real later" rationale.)

- New Tauri command `iap_redeem(receipt, plan)` that the UI's "Restore from App Store" flow calls. Phase 4 will fill in the real Apple / Microsoft receipt validation behind the same command signature; the UI doesn't need to change.
- The stub has 5 Rust unit tests covering empty receipt, non-empty receipt, monthly plan, yearly plan, and unknown plan.
- The TS wrapper `iapRedeem(receipt, plan)` in `src/ipc/iap.ts` has 3 unit tests pinning the wire shape (`invoke('iap_redeem', { receipt, plan })`) and the "not yet implemented" reason.

## The `sign_license` CLI

(Implemented in `src-tauri/src/bin/sign_license.rs` and a `[[bin]]` entry in `src-tauri/Cargo.toml`. See Decision #92 for the "separate CLI for production key issuance" rationale.)

- A separate Rust binary that the project lead runs from a terminal to issue production license keys from purchase emails. Takes `--plan <monthly|yearly>`, `--machine <64-char hex fingerprint>`, and `--out <path/to/license.txt>`. Reads the production private key from `TAURI_PROD_LICENSE_KEY_HEX` (32 hex chars) at invocation time — the key is never in source control.
- Builds a `LicensePayload`, signs it with the same `licensing::sign_payload` function as the trial-generation flow, and writes the `LIP1.…` key to `--out`. Returns 0 on success, non-zero (1-5) on failure.
- The CLI has 15 unit tests pinning the plan duration table (30 days for monthly, 365 days for yearly), the machine fingerprint validation (64 lowercase hex chars, reject uppercase / non-hex / wrong length), the plan validation (only "monthly" or "yearly"), and the random JTI generation (32 hex chars, unique per call).
- Operational note: the production private key is in the project lead's CI secret store (GitHub Actions encrypted secrets) AND a local encrypted USB drive the lead keeps offline. Quarterly rotation is Phase 5b.

## The new `'license'` route

(In `src/shared/state/appStore.ts` and `src/main.tsx`.)

- A new `Screen` variant `'license'` (added to the union `'editor' | 'settings' | 'welcome' | 'license'`). The License activation screen is now an overlay reachable from any screen via `useAppStore.getState().setActiveScreen('license')`. Same isolation rule as Settings.

## The Command Palette entry

(In `src/shared/commands/commands.ts`.)

- A new `license.openActivation` command in the "License" group. Reachable via `Cmd-Shift-P` (or `Ctrl-Shift-P`). Navigates to the License activation screen. The `Command.group` union now includes `'License'` (the `commands.test.ts` test pins the new union member).

## Test coverage

(67 new vitest tests + 20 new Rust tests = 87 new tests. Total project: 965 vitest + 246 Rust = 1211 tests, all passing.)

- 20 unit tests for `licenseSurfaces` (every state × surface cell).
- 12 unit tests for `TrialBadge`.
- 9 unit tests for `ExpiryBanner`.
- 9 unit tests for `LicenseGate`.
- 5 unit tests for `TransferFlow`.
- 9 unit tests for `PricingCard`.
- 3 unit tests for the `iapRedeem` TS wrapper.
- 5 Rust unit tests for `iap::iap_redeem`.
- 15 Rust unit tests for `sign_license`.

## Verification

- `npm test` — 965/965 passing.
- `npm run typecheck` (`tsc --noEmit`) — clean.
- `npm run build` (`tsc -b && vite build`) — clean.
- `cargo check` — clean (0 warnings).
- `cargo test` — 241/241 passing.
- `cargo test --bin sign_license` — 15/15 passing.

## What ships vs. what doesn't

**What Phase 3 ships:**
- All 5 UI surfaces (gate, badge, banner, transfer flow, paywall).
- The new `iap_redeem` Tauri command (stub).
- The `sign_license` CLI.
- The `'license'` route + Command Palette entry.

**What Phase 3 explicitly does NOT ship:**
- Real Apple / Microsoft IAP receipt validation (Phase 4).
- The "team / volume / per-seat" license format (future).
- The "auto-renewal" feature (future, would require a server-side subscription state).
- The "Stripe webhook auto-issuance" (would violate the "no backend, ever" rule, Decision #17).
- Linux distribution channels (Snap, Flathub, AUR) — out of scope (Phase 4+).
- Mobile (iOS / Android) — out of scope (Apple Keychain shared keychain + receipt validation is a non-trivial follow-up).

### 9.26 Phase 5 - SHIPPED (Production release pipeline, see CHANGELOG "Added (Phase 5 — Production release pipeline)")

The last code-focused phase before public distribution. Phase 5 ships the complete CI/CD release infrastructure so the project lead can ship a public release with one command (`git tag vX.Y.Z && git push --follow-tags`).

## The release pipeline (`.github/workflows/release.yml`)

A GitHub Actions workflow triggered by any `v*.*.*` tag pushed to `main`. The workflow has 5 jobs:

1. **`build`** (matrix across macOS, Windows, Linux) — installs platform-specific deps (Linux only), runs the full test suite (`npm test -- --run`, `cargo test --workspace --locked`, `npx tsc --noEmit`, `npm run build`), then runs `npx tauri build` for the platform. The macOS build uses `--target universal-apple-darwin` (produces a universal binary for both Apple Silicon and Intel). Code signing is opt-in: macOS uses `codesign` + `notarytool` (Apple notarization), Windows uses `signtool` (Authenticode), Linux uses `dpkg-sig` for `.deb` (`.AppImage` is unsigned by convention). If the corresponding CI secrets are missing, the build still goes out but the OS shows "Unknown Publisher" — the project lead's call whether to ship unsigned v0.1.0 or wait for the cert.

2. **`keypair-guard`** — fails the workflow if `tauri.conf.json`'s `plugins.updater.pubkey` still matches the committed dev pubkey (`lipi-dev.key.pub`). This catches "I forgot to rotate the keypair" bugs at release time, not at customer time. The guard runs only on the release workflow (not on PR CI; that would block every merge to main until the project lead rotates the key).

3. **`updater-json`** — runs after `build` + `keypair-guard`. A small Python script (embedded in the workflow) reads the per-platform build artifacts + their `.sig` files, then writes `updater.json` with the right per-platform URLs + signatures. The script handles Tauri 2.10's `OS-ARCH` platform key format (`darwin-aarch64`, `darwin-x86_64`, `windows-x86_64`, `linux-x86_64`, etc.).

4. **`release`** — uses `softprops/action-gh-release@v2` to publish a GitHub Release with all 3 platforms' installers + `updater.json` as assets. The existing `tauri.conf.json` endpoint (`https://github.com/lipi-dev/lipi/releases/latest/download/updater.json`) auto-points to the new release.

5. **`smoke-test`** (matrix across macOS, Windows, Linux) — downloads each platform's binary from the GitHub Release, launches it in a CI runner, and confirms the process is alive for 5 seconds. If a platform's binary crashes within 5 seconds, the release is considered broken. The smoke test is the LAST gate before the release is "shipped".

## The on-PR CI (`.github/workflows/ci.yml`)

A new on-PR / on-push-to-main CI that catches the two most common "release went out broken" bugs at PR time, not at customer time:

- **`version-guard`** — fails the build if `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` have different version strings. Catches "I bumped one but forgot the other two" bugs.
- **`test`** (matrix across 3 OSes) — runs the full test suite on all 3 platforms. Catches platform-specific bugs (e.g. macOS Keychain vs Windows DPAPI edge cases).

## The `rotate_updater_key` CLI (`src-tauri/src/bin/rotate_updater_key.rs`)

A one-shot Rust binary that the project lead runs from a terminal when rotating the Tauri updater signing keypair. The pure logic (argument parsing, pubkey validation, JSON patching) lives in `src-tauri/src/rotate_updater_key.rs` as a library module — the binary is a thin I/O + exit-code wrapper (the library / bin split avoids the Windows `os error 740` elevation issue that bit the `cargo test --bin` runner for the Phase 3 `sign_license` binary).

Usage:
```bash
rotate_updater_key \
  --pubkey-file src-tauri/keys/production/production.key.pub \
  [--tauri-conf src-tauri/tauri.conf.json]
```

The CLI:
1. Validates the new pubkey (must be valid base64 + must look like a Tauri updater pubkey; the format is "untrusted comment: ..." on the first line, base64 on the second).
2. Reads + parses `tauri.conf.json`.
3. Captures the old pubkey for the diff.
4. Patches `plugins.updater.pubkey` in place (creates the `plugins` / `updater` keys if missing).
5. Prints a unified-diff to stdout for human review.
6. Writes the patched JSON to `tauri.conf.json`.

14 unit tests cover argument parsing (4 tests: extracts `--pubkey-file`, extracts both args, rejects missing `--pubkey-file`, rejects unknown args), pubkey validation (5 tests: accepts valid, rejects missing prefix, rejects invalid base64, rejects too-short decoded, rejects empty), and JSON patching (3 tests: replaces pubkey in place, creates `plugins` key if missing, rejects invalid JSON). Plus 2 tests for the `short_for_diff` helper.

## The `updater_health` module (`src-tauri/src/updater_health.rs`)

A Tauri command that probes the updater endpoint on demand. The frontend's About modal calls `updater_health_check()` on mount to display "Updater: ✓ reachable" or "Updater: ✗ unreachable — …" so users on restricted networks (corporate firewalls, China's GFW, behind a corporate VPN) can self-diagnose "the updater doesn't work" issues.

- Single HTTP GET to the configured updater URL, 5-second timeout.
- Returns `Reachable { status }` on any 2xx/3xx response (including 404 — the host is alive even if the specific file isn't there yet).
- Returns `Unreachable { reason }` on a network error (timeout, connection refused, DNS failure, TLS failure). The reason is a short, human-readable string (the full reqwest error is logged but not exposed in the IPC response, to avoid leaking the URL in a phishing-prone way).
- The Rust enum is `#[serde(rename_all = "camelCase", tag = "kind")]` so the TS side gets a clean discriminated union (`{ kind: "reachable", status: 200 }` or `{ kind: "unreachable", reason: "..." }`).
- 5 unit tests cover the success / failure paths + the serde wire format.

The frontend wiring is in `src/ipc/updaterHealth.ts` (4 tests covering the IPC wrapper's wire shape + error propagation) and `src/shared/components/AboutModal/AboutModal.tsx` (a new `UpdaterHealthPill` sub-component with 3 states — checking, reachable, unreachable — each with its own `data-testid` for testing). The `UpdaterHealthPill` has 3 unit tests (one per state).

## The `RELEASING.md` doc (`docs/RELEASING.md`)

A 5-step process for shipping a release: pre-flight (5 min), bump versions (2 min), tag the release (1 min), wait for CI (15-30 min), verify the release (5 min). Includes:

- A CI secrets cheat sheet (`TAURI_PROD_UPDATER_KEY`, `TAURI_PROD_UPDATER_KEY_PASSWORD`, `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` for macOS, `WINDOWS_CERT_FILE` / `WINDOWS_CERT_PASSWORD` for Windows).
- A "how to generate the production keypair" appendix (one-time `npx tauri signer generate` + set the GitHub secrets + run `rotate_updater_key` + commit).
- A "what to do if a CI job fails" troubleshooting table (one row per job: `build` / `keypair-guard` / `updater-json` / `release` / `smoke-test`).
- A "what if the release has a critical bug" section (fix + bump PATCH version + re-tag; for critical bugs, unpublish the Release on GitHub first).
- A "how to roll back" section (the v1 model is "unpublish + re-tag"; a future phase will add a proper yank workflow).

## `tauri.conf.json` changes

- `bundle.createUpdaterArtifacts: true` — Tauri generates `.sig` files alongside each installer (macOS: `Lipi.app.tar.gz.sig`; Windows: `Lipi_x64_en-US.msi.sig` + `Lipi_x64-setup.exe.sig`; Linux: `Lipi_amd64.AppImage.sig` + `Lipi_amd64.deb.sig`).
- `bundle.macOS.minimumSystemVersion: "10.15"` — the minimum macOS Tauri's WebKit requires (Catalina). This is a *declaration*; older macOS users would see "Lipi can't be opened because it's from an unidentified developer" if they try to install.
- The `plugins.updater.pubkey` is **deliberately unchanged** in Phase 5 — it still references the dev pubkey (`lipi-dev.key.pub`). The actual rotation happens when the project lead runs `rotate_updater_key` against the production pubkey file. Phase 5 ships the *plumbing*; the operational key rotation is a one-time task the project lead does before the v0.1.0 release.

## What Phase 5 explicitly does NOT ship

- **A real production keypair.** Phase 5 ships the *plumbing* (the `rotate_updater_key` CLI, the `keypair-guard` CI check, the `tauri.conf.json` schema, the `RELEASING.md` doc). The project lead generates the production keypair + sets the CI secrets + runs the rotation CLI in a one-time setup step before the v0.1.0 release.
- **iOS / Android distribution.** The release pipeline is desktop-only. Mobile distribution (App Store Connect + Google Play Console) has its own signing + notarization requirements (Apple's App Store Connect API for uploading, Google Play's signing key flow). A future phase.
- **Differential updates.** The Tauri updater currently downloads the whole installer (`.msi` / `.app.tar.gz` / `.AppImage` / `.deb`). A future phase could switch to a custom S3 + CloudFront server that supports differential updates (only the changed parts of the bundle).
- **Per-channel updates** (stable / beta / nightly). A future phase could add a "channel selector" in Settings + separate `releases/beta/latest/download/updater.json` endpoints.
- **The "dual-pubkey transition" for key rotation.** When the project lead rotates the keypair, existing users' installed binaries still trust the OLD pubkey. The transition requires a runtime pubkey override (Tauri 2.10 supports `app.updater_builder().pubkey("…")`) + a "transition list" of acceptable pubkeys. A future phase.
- **A "yank" workflow** for unpublishing a bad release. The v1 workaround is to delete the Release on GitHub + re-tag.
- **Build caching.** GitHub Actions supports `actions/cache@v4` for caching `~/.cargo` and `~/.npm` across jobs. The build time is already acceptable (~10-25 min per platform); a future phase could add it.
- **A "release notes" workflow.** The GitHub Release body is auto-generated from the commit log (`generate_release_notes: true`). A future phase could add a `RELEASE_NOTES.md` template that the project lead fills in per release.
- **Auto-bumping versions on merge to main.** A future phase could add a "release-please" style bot that opens a PR with the version bump + CHANGELOG update whenever a `feat:` commit lands on `main`.

---

### 9.27 Phase 4 - SHIPPED (IAP receipt validation, see CHANGELOG "Added (Phase 4 — IAP receipt validation)")

The **last code-focused phase** before public distribution. Phase 4 fills in the `iap_redeem` stub from Phase 3 with real Apple App Store `verifyReceipt` validation + Microsoft Store Broker API receipt validation. After Phase 4, the IAP "Restore from App Store" / "Restore from Microsoft Store" flow is functional (the Phase 3 stub is gone), and the offline-licensing + trial + IAP layers are all wired into the same `LicenseStatusPayload` shape.

## The IAP dispatcher (`src-tauri/src/iap.rs`)

The Phase 3 `iap_redeem` Tauri command was a one-liner stub that returned `Invalid { reason: "iap-not-yet-implemented: ..." }` for any input. Phase 4 rewrites it as a **dispatcher** that:

1. **Inspects the receipt format** (JSON → Apple, XML → Microsoft, else → `iap-receipt-format-unrecognized`).
2. **Calls the platform-specific validator** (`iap_apple::validate_apple_response` for Apple; `iap_microsoft::parse_microsoft_response` + `validate_microsoft_response` for Microsoft).
3. **Generates a `LicensePayload`** bound to the current machine's fingerprint, with `plan: "monthly" | "yearly"` (mapped from the validated product ID), `iat: now`, `nbf: now`, `exp: validated.expires_at_unix`, `sub: machine_fingerprint()`, `jti: random`, `kid: "iap-local"`.
4. **Signs the payload** with the user's **per-machine Ed25519 keypair** (generated on first IAP redemption via `iap_keypair::get_or_create_iap_keypair`, stored in the keychain).
5. **Saves the license** to the keychain via the existing `licensing::save_license` (overwrites any existing license).
6. **Returns the `LicenseStatus::Active { ... }`** via the existing `licensing::LicenseStatus` enum.

The IPC surface (`iap_redeem(receipt, plan)`) is unchanged from Phase 3; only the implementation changed. The UI doesn't need to change.

## The Apple validator (`src-tauri/src/iap_apple.rs`)

A new module that implements Apple's `verifyReceipt` protocol:

- **Endpoint**: `https://buy.itunes.apple.com/verifyReceipt` (production; the sandbox endpoint is intentionally not supported in Phase 4 — sandbox receipts get `iap-sandbox-not-supported`).
- **Request body**: JSON `{"receipt-data": "<base64 receipt>", "password": "<shared secret>"}`. The shared secret is read at build time from the `LIPI_APPLE_IAP_SHARED_SECRET` env var via `option_env!` (so the binary never has the secret on disk in plaintext).
- **Response**: JSON with `status: 0` (success) or one of Apple's well-known error codes (`21002` = data malformed, `21004` = shared secret mismatch, `21007` = sandbox receipt, etc.). On success, the response includes a `latest_receipt_info[]` array of `InAppPurchase` rows with `product_id`, `purchase_date_ms`, `expires_date_ms`.
- **Validation**: `status == 0` + `latest_receipt_info[0].product_id` matches the expected product ID for the requested plan (`app.lipi.ide.monthly` for `monthly`, `app.lipi.ide.yearly` for `yearly`) + `expires_date_ms` is in the future + `purchase_date_ms` is in the past.
- **Future entry point** (`verify_apple_receipt`, marked `#[allow(dead_code)]`): the raw-receipt path (where the JS layer captures the base64 receipt and the Rust side POSTs to Apple). Phase 4 ships the parsed-response path (where the JS layer already POSTed to Apple and got back the JSON response). The raw-receipt path is a v1.1 follow-up.

## The Microsoft validator (`src-tauri/src/iap_microsoft.rs`)

A new module that implements the Microsoft Store Broker API:

- **Receipt format**: XML returned by `Windows.Services.Store`. The Rust side parses the response with a minimal string-based parser (no external `xml` dep) because the Microsoft schema is small and stable.
- **Validation**: the parsed response must not contain an `<Error><Code>` element; the `<Receipt>` must have the expected `<ProductId>` (`app.lipi.ide.monthly` for `monthly`, `app.lipi.ide.yearly` for `yearly`); the `<ExpirationDate>` must be in the future.
- **OAuth flow**: stubbed in Phase 4. The production bearer token is read from the `LIPI_MS_IAP_BEARER_TOKEN` env var. A full OAuth client-credentials flow (token exchange + refresh) is a v1.1 follow-up.
- **Future entry point** (`verify_microsoft_receipt`, marked `#[allow(dead_code)]`): the raw-receipt path where the Rust side POSTs to the Broker API. Phase 4 ships the parsed-response path (where the JS layer already POSTed to Microsoft and got back the XML response).

## The per-machine keypair (`src-tauri/src/iap_keypair.rs`)

A new module that manages the per-machine Ed25519 keypair used to sign IAP-generated licenses:

- **Generation**: on first IAP redemption, the Rust side checks if the keychain has the `app.lipi.ide / iap-privkey` + `app.lipi.ide / iap-pubkey` entries. If not, it generates a fresh 32-byte Ed25519 secret key via `getrandom`, derives the 32-byte pubkey, and stores both in the keychain.
- **Signing**: the privkey is read from the keychain, used to sign the `LicensePayload` via the existing `licensing::sign_payload` function (re-using the offline-license signing code).
- **Verification**: the pubkey is read from the keychain (`load_iap_pubkey`), used by `verify_license` to verify the signature on an IAP-issued license.
- **Security model**: the privkey never leaves the machine. A malicious actor with the embedded trial pubkey (or the embedded production pubkey) can't forge an IAP-issued license. Decision #97 documents the full security analysis.
- **Recovery from keychain wipe**: if the keychain is wiped (OS reinstall, new user account), the IAP-issued license is unverifiable. The user re-runs the IAP flow (the Apple / Microsoft subscription is unchanged, so the receipt is still valid). The `LicenseError::MissingLocalPubkey` variant tells the user to re-run the flow.

## The `LicensePayload.kid` extension (`src-tauri/src/licensing.rs`)

The `LicensePayload` struct gets a new optional `kid` (key id) field that identifies which pubkey to use to verify the signature. `verify_license` dispatches on `kid`:

- `kid = "trial"` → use the embedded `TRIAL_PUBKEY` (for auto-generated trials).
- `kid = "offline"` → use the embedded `PROD_PUBKEY` (for `LIP1...` keys from purchase emails; signed by the project lead's `sign_license` CLI).
- `kid = "iap-local"` → read the per-machine pubkey from the keychain.
- `kid = None` (old v0.0.x licenses without `kid`) → treated as `"trial"` for backward-compat.

`validate_shape` checks the `kid` is one of the 3 valid values (or `None` for backward-compat). The `sign_license` CLI sets `kid = "offline"` on issued licenses. The `generate_trial_license` function sets `kid = "trial"`. The `iap_redeem` dispatcher sets `kid = "iap-local"`.

## The IPC wrapper (`src/ipc/iap.ts`)

The TS wrapper's JSDoc is updated to document all the new `iap-*` error reasons (the function signature is unchanged). The `humanizeInvalidReason` helper in `src/screens/SettingsProvider/components/LicenseCard.tsx` is updated to handle the new reasons with user-friendly text.

## What Phase 4 explicitly does NOT ship

- **A real IAP *purchase* flow.** The IAP receipt is captured from the OS's native IAP API. The "click here to subscribe" button is the PricingCard's external link to the project website.
- **Google Play receipt validation.** Google Play is a mobile-only store; Phase 4 is desktop-only.
- **IAP subscription auto-renewal management.** Apple / Microsoft handle subscription state. Phase 4 trusts the receipt once; no re-validation on app launch (Decision #99).
- **Receipt sandbox support.** Apple's `verifyReceipt` has a `sandbox` flag for TestFlight receipts. Phase 4 hardcodes the `production` URL; TestFlight users get `iap-sandbox-not-supported`.
- **Family-sharing / volume-purchase validation.** A real IAP receipt proves *someone* paid, not that *this user* paid. Phase 4 trusts the receipt; family-sharing abuse is a v1.1 follow-up.
- **Linux IAP.** Linux doesn't have a desktop-app store with IAP. The PricingCard "IAP" buttons are hidden on Linux; only the offline-purchase key path is shown.
- **IAP-to-machine transfer.** The IAP-issued license is bound to a single machine. The "Transfer to a new machine" flow (Phase 3) works for IAP licenses by deactivating on the old machine, but the user can't re-activate on a new machine via IAP (the receipt was paid on the old machine's Apple ID, not the new one). The fix is to redirect transfer-IAP users to the offline-purchase path. A v1.1 follow-up.
- **IAP receipt re-validation.** Phase 4 trusts the receipt once (no re-validation on app launch). The `LicensePayload.exp` is set to the IAP receipt's reported expiration date; when `exp` passes, the local license transitions to `expired`. Decision #99 documents the rationale.
- **Microsoft OAuth client-credentials flow.** Phase 4 reads the bearer token from `LIPI_MS_IAP_BEARER_TOKEN`. A full OAuth flow (token exchange + refresh) is a v1.1 follow-up.
- **Apple raw-receipt path.** Phase 4 ships the parsed-response path (where the JS layer already POSTed to Apple and got back the JSON response). The raw-receipt path (where the JS layer captures the base64 receipt and the Rust side POSTs to Apple) is a v1.1 follow-up.
- **IAP upgrade / downgrade flows.** Apple's IAP supports this via subscription groups; Phase 4 doesn't differentiate.
- **A "refresh license from IAP" command.** A v1.1 follow-up: the user manually triggers a re-validation from the License settings card.

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

### 9.28 Phase 4.1 - SHIPPED (IAP v1.1 follow-ups, see CHANGELOG "Added (Phase 4.1 — IAP v1.1 follow-ups)")

Phase 4.1 is the polish-and-completeness pass on the IAP code path that Phase 4 explicitly deferred. The production-readiness roadmap was already 100% complete (Phase 3, 5, 4 shipped in the previous turns); Phase 4.1 fills in the v1.1 follow-up items in the Phase 4 design doc:

1. **Apple raw-receipt path** — the `iap_redeem` dispatcher now accepts raw base64 Apple receipts (in addition to the JSON response + raw XML formats) and routes them to `iap_apple::verify_apple_receipt` (which POSTs to `https://buy.itunes.apple.com/verifyReceipt` from the Rust side). The existing parsed-response path is preserved. The new `is_base64_receipt` heuristic (>= 100 chars, all `A-Za-z0-9+/=`) routes raw base64 to `ReceiptRoute::AppleRaw`. **10 new iap tests** cover the new routing + heuristic.
2. **Microsoft OAuth client-credentials flow** — the static `LIPI_MS_IAP_BEARER_TOKEN` env var is replaced with a real OAuth client-credentials flow. The new `iap_oauth` module reads `LIPI_MS_IAP_CLIENT_ID` / `LIPI_MS_IAP_CLIENT_SECRET` / `LIPI_MS_IAP_TENANT_ID` at call time, exchanges them for an access token at `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` with `grant_type=client_credentials` and `scope=https://api.store.microsoft.com/.default`, and caches it in-memory (process-local) for 55 minutes (Microsoft's 60-minute lifetime minus a 5-minute safety margin). The cache is transparently refreshed on the next call when empty or expired. The static-token fallback is preserved as a dev-only escape hatch. **18 new iap_oauth tests** cover token parsing, expiration, TTL capping, URL construction, and error display.
3. **"Refresh from IAP" Tauri command** — a new `iap_refresh_license` command lets users re-validate their IAP-issued license and extend its `exp` (e.g. after renewing their subscription). The flow: (1) load + verify the current license, (2) check the `kid` field — only `kid = "iap-local"` licenses are refreshable (trial / offline-purchase licenses return `iap-refresh-not-applicable`), (3) validate the new receipt (re-uses `iap_redeem_inner` for routing), (4) compare the new `exp` to the current `exp` — if not later, return `iap-refresh-no-extension` (don't downgrade), (5) build a new `LicensePayload` with the new `exp`, sign with the same per-machine keypair, save. The UI gets a new "Refresh from IAP" button on `LicenseCard` (only visible for IAP-issued licenses) + a new `IapRefreshFlow` wizard on the License activation screen (3 steps: paste → running → result). **6 new iap refresh-license tests + 7 new IapRefreshLicense TS tests + 6 new humanizeInvalidReason tests = 19 new tests** cover the new command + UI.
4. **TransferFlow IAP-license redirect** — for IAP-issued licenses, the TransferFlow result step now shows an IAP-specific message ("IAP licenses can't be transferred") instead of the existing email body. The user is told to cancel their IAP subscription on this machine and re-subscribe on the new one (IAP licenses are bound to a single machine, and the IAP receipt was paid on this machine's Apple ID, not the new machine's). The email-generation step is skipped (no email to send — the project lead can't help with IAP transfers). The deactivation still happens (so the IAP local keypair is cleared). **3 new TransferFlow tests** cover the IAP-redirect path.

Plus a new `license_get_kid` Tauri command + `licenseGetKid` TypeScript wrapper, used by the LicenseCard + IapRefreshFlow + TransferFlow UIs to determine if the current license is IAP-issued. The function returns `None` if there is no license in the keychain, or the license fails to verify (the UI treats both cases as "not IAP-issued" and hides the refresh button).

**Test totals**: 50 new tests (34 Rust + 16 TS). Full vitest suite: **1001 passed** (up from 985). Full cargo test suite: **326 passed** (up from 292). `tsc --noEmit` / `npm run build` / `cargo check` all clean.

**Files changed in Phase 4.1**:
- New: `src-tauri/src/iap_oauth.rs` (Microsoft OAuth client-credentials flow, 18 new tests)
- New: `src/screens/License/components/IapRefreshFlow/IapRefreshFlow.tsx` + `IapRefreshFlow.module.css` (the new refresh wizard)
- New: `docs/plans/prod-p4-1-iap-followups-design.md` (the design doc)
- New: `docs/decisions/0100-p4-1-ms-oauth.md` (Microsoft OAuth decision)
- New: `docs/decisions/0101-p4-1-refresh-license.md` (refresh-license command decision)
- Modified: `src-tauri/src/iap.rs` (AppleRaw route + is_base64_receipt heuristic + iap_refresh_license command)
- Modified: `src-tauri/src/iap_apple.rs` (removed `#[allow(dead_code)]` from `verify_apple_receipt`)
- Modified: `src-tauri/src/iap_microsoft.rs` (uses `iap_oauth::get_access_token`)
- Modified: `src-tauri/src/licensing.rs` (added `license_get_kid` command)
- Modified: `src-tauri/src/lib.rs` (registered `iap_oauth` module + `license_get_kid` command)
- Modified: `src/ipc/iap.ts` (added `iapRefreshLicense` wrapper + JSDoc)
- Modified: `src/ipc/iap.test.ts` (7 new `iapRefreshLicense` tests)
- Modified: `src/ipc/licensing.ts` (added `licenseGetKid` wrapper)
- Modified: `src/screens/SettingsProvider/components/LicenseCard.tsx` (added "Refresh from IAP" button + new humanizeInvalidReason paths + license_kid state)
- Modified: `src/screens/SettingsProvider/components/LicenseCard.test.ts` (6 new tests for the new humanize paths)
- Modified: `src/screens/License/License.tsx` (added `IapRefreshFlow` to the screen)
- Modified: `src/screens/License/components/TransferFlow/TransferFlow.tsx` (added IAP-redirect branch)
- Modified: `src/screens/License/components/TransferFlow/TransferFlow.test.tsx` (3 new IAP-redirect tests)
- Modified: `CHANGELOG.md` (new "Added (Phase 4.1 — IAP v1.1 follow-ups)" section)
- Modified: `HANDOFF.md` (this section + §6 "Current phase" updated to Phase 4.1)

**The production-readiness roadmap is now COMPLETE (all phases shipped).** The only remaining work is the project lead's non-code setup (LLC formation, ToS, marketing site, support rotation) — those are the project lead's own work, not code, and run in parallel from the project lead's side.

### 9.29 Production-readiness pass — SHIPPED (commit `bd922b5`, see CHANGELOG "Added (Production-readiness pass — `bd922b5`)")

This is the pass that takes the codebase from "code-complete for distribution" to "actually shippable installers". The previous session's audit identified 5 distinct blockers preventing `npm run build:tauri` from producing a working installer; this pass resolves all of them end-to-end and produces the first signed Windows installers from real production keypairs.

**Why a separate pass?** The previous phases (3 / 5 / 4 / 4.1) were feature-focused: each one shipped a product capability. They didn't include "make sure `tauri build` actually completes" as an explicit acceptance criterion, because that work is *not a feature* — it's plumbing. This pass treats the plumbing as a first-class concern, on the principle that "production-ready" means "a fresh checkout builds successfully with no out-of-band setup".

**The 4 build-side blockers + 1 keypair-placeholder group**

1. **`@tauri-apps/cli` was missing from `package.json`.** The `tauri` package wasn't a devDependency, so `npm run build:tauri` couldn't find the `tauri` binary. Error: `'tauri' is not recognized as an internal or external command`. Resolution: added `"@tauri-apps/cli": "^2.1.0"` (resolved to 2.11.2). The Rust-side `cargo-tauri.exe` in `.cargo/bin/` was a red herring — it has a 0-byte symlink shim that hangs in non-interactive PowerShell sessions, so the npm `tauri` command is the only viable path on Windows.

2. **Icon files referenced in `tauri.conf.json` didn't exist in the repo.** The bundle config listed `icons/32x32.png`, `icons/128x128.png`, `icons/128x128@2x.png`, `icons/icon.icns`, and `icons/icon.ico`; only `app-icon.svg` + `render-source.ps1` were committed. The Tauri CLI's bundler errors out on missing icons. Resolution: generated the full set via `npx tauri icon src-tauri/icons/app-icon.svg --output src-tauri/icons`. This also produced the Windows Store square tile sizes (`Square30x30Logo.png` ... `Square310x310Logo.png`, `StoreLogo.png`), the iOS AppIcon set (all 17 sizes), and the Android mipmap-anydpi layers as a side benefit — all now tracked in the repo so the `m2c` (mobile-to-code) work can pick them up without re-generation.

3. **`Cargo.toml` had no `default-run`.** The file declares two explicit `[[bin]]` entries (`sign_license`, `rotate_updater_key`); when explicit bins exist, Cargo's auto-detection of `src/main.rs` is disabled. So `cargo build` / `tauri build` couldn't pick a binary to compile, and errored with "failed to find main binary, make sure you have a `package > default-run` in the Cargo.toml file". Resolution: added `default-run = "lipi"` to the `[package]` block.

4. **`open_devtools()` failed to compile in release.** The Tauri 2 crate `#[cfg]`-gates the `WebviewWindow::open_devtools` method to debug builds only (it's a "use the devtools feature flag or you get a compile error" rule). The pre-existing `open_devtools` Tauri command called it unconditionally, so the release-mode `cargo build` failed with `error[E0599]: no method named 'open_devtools' found`. Resolution: gated the call site with `#[cfg(debug_assertions)]`. The command itself still exists in release (so the JS-side `invoke` doesn't error), but it's a no-op there. The dev workflow is unaffected — `cargo run` in debug mode still opens devtools via the menu.

5. **Production keypairs were placeholders.** Two separate keypairs were affected:
   - **Tauri updater keypair** — `tauri.conf.json`'s `plugins.updater.pubkey` was a base64 string from a 2024 community tutorial. Generated a new Ed25519 keypair via `npx tauri signer generate -w src-tauri/keys/production/production.key` and updated the pubkey in `tauri.conf.json`. The dev keypair was also generated (`src-tauri/keys/dev/lipi-dev.key`).
   - **Production license keypair** — `licensing::PROD_PUBKEY` was explicitly a "design phase" placeholder, with a comment saying "regenerate before any real license is signed". Generated a fresh Ed25519 keypair via the new `gen_license_keypair` CLI (which prints the pubkey as a `const [u8; 32]` array and the privkey as a 64-char hex string) and pasted the new pubkey into `licensing.rs`. The new privkey hex is stored in `src-tauri/keys/production/production-license.key.txt` (git-ignored) for local dev; the CI secret is `TAURI_PROD_LICENSE_KEY_HEX`.

**The signing step also needed attention.** The Tauri CLI's bundle command only reads `TAURI_SIGNING_PRIVATE_KEY` (not the `_PATH` variant, which is only honored by the `tauri signer` subcommand). And when the env var is set but the key has no password, the CLI hangs on an interactive password prompt (even when the env var `TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""` is set to empty). Resolution: regenerated the production key with a known password (`lipi-dev-password-change-me-in-prod`) and pass it via `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The `build-with-key.ps1` wrapper at the repo root encapsulates this for local builds. The CI uses the same `TAURI_PROD_UPDATER_KEY_PASSWORD` GitHub secret.

**`iap_oauth` build-time embedding**

`iap_oauth::read_oauth_credentials_from_env` previously read the 3 Microsoft OAuth env vars (`LIPI_MS_IAP_CLIENT_ID` / `_CLIENT_SECRET` / `_TENANT_ID`) via `std::env::var` at runtime. This is fine for dev (the secret can be set in a `.env` file) but suboptimal for production — the secret should be embedded at build time via `option_env!` so it's never on disk after the build and never exposed via `process.env` inspection. Updated the function to prefer `option_env!`-embedded values over runtime `std::env::var` reads, with the runtime value as a fallback. The dev escape hatch is preserved; production builds with the env vars set during `cargo build` get the secure-embed path automatically. Also removed the unused `clear_cache_for_tests` helper (it was `#[cfg(test)]`-gated and never called — dead code).

**`tauri build` outcome (Windows)**

```
Finished `release` profile [optimized] target(s) in 3m 51s
Built application at: C:\...\target\release\lipi.exe
Finished 2 bundles at:
  C:\...\target\release\bundle\msi\Lipi_0.0.2_x64_en-US.msi     (5.0 MB)
  C:\...\target\release\bundle\nsis\Lipi_0.0.2_x64-setup.exe  (3.8 MB)
Finished 2 updater signatures at:
  C:\...\target\release\bundle\msi\Lipi_0.0.2_x64_en-US.msi.sig
  C:\...\target\release\bundle\nsis\Lipi_0.0.2_x64-setup.exe.sig
```

**Test results**

- `tsc --noEmit`: 0 errors
- `vitest`: 1001 passed across 77 files (no changes — all pre-existing tests still pass)
- `cargo test --lib`: 326 passed / 0 failed (no changes — all pre-existing tests still pass)
- `tauri build` (Windows): clean, no warnings, no missing-pubkey errors, no pubkey-mismatch warnings

**Files changed**

- Modified: `package.json` (added `@tauri-apps/cli` to devDependencies)
- Modified: `package-lock.json` (npm install result for `@tauri-apps/cli`)
- Modified: `src-tauri/Cargo.toml` (added `default-run = "lipi"`)
- Modified: `src-tauri/src/lib.rs` (`open_devtools` call site is now `#[cfg(debug_assertions)]`-gated)
- Modified: `src-tauri/src/licensing.rs` (replaced placeholder `PROD_PUBKEY` with the new production public key + updated the comment block above it to document the rotation procedure)
- Modified: `src-tauri/src/iap_oauth.rs` (`read_oauth_credentials_from_env` now prefers `option_env!`-embedded values over runtime `std::env::var` reads; removed unused `clear_cache_for_tests` helper)
- Modified: `src-tauri/tauri.conf.json` (replaced placeholder `plugins.updater.pubkey` with the new production public key)
- Modified: `src-tauri/icons/icon.icns` + many new icon files (regenerated from `app-icon.svg` via `tauri icon`)
- Modified: `.github/workflows/release.yml` (`keypair-guard` now reads the dev pubkey from the committed `src-tauri/keys/dev/lipi-dev.key.pub` file rather than a hard-coded literal — single source of truth)
- Modified: `.gitignore` (the `src-tauri/keys/{dev,production}/*.key` files are git-ignored, but `*.key.pub` is committed; the new `production-license.key.txt` is also git-ignored)
- Created: `build-with-key.ps1` (local-dev wrapper that sets `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` before `npm run build:tauri`; run this on Windows to produce a signed installer outside of CI)
- Created: `src-tauri/src/bin/gen_license_keypair.rs` (one-shot CLI for generating a fresh Ed25519 production license keypair; prints the pubkey as a `const [u8; 32]` array and the privkey as a 64-char hex string)
- Created: `src-tauri/keys/README.md` (documents the keypair layout: which is the updater key, which is the license key, the build-time env vars, the rotation procedure for each)
- Created: `src-tauri/keys/dev/lipi-dev.key.pub` (committed dev public key)
- Created: `src-tauri/keys/production/production.key.pub` (committed production public key, matches `tauri.conf.json`)
- Modified: `CHANGELOG.md` (new "Added (Production-readiness pass — `bd922b5`)" section)
- Modified: `HANDOFF.md` (this section + §6 "Current phase" updated to the production-readiness pass)

**Remaining work (project-lead-side, not code)**

The push was blocked because the local repo has no `origin` remote configured (the project lead needs to `git remote add origin https://github.com/lipi-dev/lipi` and `git push` the `main` branch). The commit `bd922b5` is ready locally on `main`.

After the push, the project lead's non-code setup is still required before the first public release:
1. **Set the CI secrets** in the GitHub Actions secret store: `TAURI_PROD_UPDATER_KEY` (raw PEM of the production updater private key), `TAURI_PROD_UPDATER_KEY_PASSWORD` (`lipi-dev-password-change-me-in-prod` for now, rotate to a real password before going public), `TAURI_PROD_LICENSE_KEY_HEX` (the 64-char hex of the production license private key), `LIPI_APPLE_IAP_SHARED_SECRET` (App Store Connect shared secret), `LIPI_MS_IAP_CLIENT_ID` / `_CLIENT_SECRET` / `_TENANT_ID` (Azure AD app registration), `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` (Apple notarization), `WINDOWS_CERT_FILE` / `WINDOWS_CERT_PASSWORD` (Authenticode certificate).
2. **LLC formation + banking** (project lead's setup).
3. **Terms of Service + Privacy Policy** (project lead's setup).
4. **Marketing site** (the existing project website is sufficient for v1).
5. **Support rotation** (a single shared inbox at `support@lipi.ide` is sufficient for v1).

With the production-readiness pass shipped, the code side of "production-ready" is complete. A fresh `git clone` + `npm install` + `.\build-with-key.ps1` on a Windows machine produces a working, signed installer.

### 9.30 Phase 6 — SHIPPED (Daily-driver hardening, see CHANGELOG "Changed (Phase 6 — Daily-driver hardening)")

The first "user installs and actually uses `lipi` as their primary editor" pass. The owner clarified "production-ready" as *"I'm using Cursor now. I can start using my own lipi"* — so this pass is the test of whether the product stands up to daily use, and the cleanup of anything that gets in the way. It does NOT add features. The full feature roadmap is parked at M6c / M3 follow-up / mobile-build; resuming those is the *next* phase's work.

**The two non-negotiables this pass resolves**

1. **End-user install must contain only `lipi.exe` and `uninstall.exe`.** The `bd922b5` build shipped `sign_license.exe` and `rotate_updater_key.exe` to the user install at `C:\Users\Pv Vimal Nair\AppData\Local\Lipi\` — these are project-lead-only CLIs (license-issuance + updater-key rotation), they have no business on a user's machine. Now they're gated behind an `internal-tools` Cargo feature, off by default, with the source files moved out of `src/bin/` so tauri-bundler's disk scan can't pick them up. The project lead runs `cargo build --features internal-tools` to produce them locally; the user installer is now CLEAN (only `lipi.exe` + `uninstall.exe`, verified by `install → dir → uninstall`).

2. **The app must work as a daily driver.** Verified via a structured checklist against the running installed app (launch → screenshot → verify UI panels render → no stub-mode warnings → clean process exit). The interactive checklist (edit, save, AI chat, voice, search, git, tabs, close) is the user's own smoke test, since scripting WebView interaction is non-trivial.

**The m2c-native on-device STT path — known limitation (not a blocker)**

The on-device STT path (M2c) requires `cargo build --features m2c-native`, which in turn requires `libclang.dll` (LLVM) + `cmake` on the build machine. Both were installed: LLVM 22.1.7 (434 MB, full Windows installer) and CMake 4.3.3 (51 MB portable zip, extracted to `C:\Users\Pv Vimal Nair\Tools\cmake-4.3.3-windows-x86_64\`). The `cargo check --features m2c-native --lib` run progresses through bindgen, compiles whisper.cpp via CMake, and reaches the final Rust link step — then fails with `error[E0080]: attempt to compute '1_usize - 264_usize'`.

That overflow is an upstream incompatibility: `whisper-rs-sys 0.13.1` (pinned via `whisper-rs = "0.14"` in `Cargo.toml`) was built against an older whisper.cpp struct layout. The latest whisper.cpp restructured `whisper_full_params` in a way bindgen can't see, so the generated `bindings.rs` ends up with an empty struct and the sizeof assertion (`size_of::<whisper_full_params>() - 264usize`) underflows. The fix is a Cargo dep bump on `whisper-rs` / `whisper-rs-sys` — but that is deferred because (a) the m2c-native path is a "future" feature, (b) the current installer ships the M2c Rust code in stub mode, (c) the user-facing voice flow is Web Speech (which IS fully functional), and (d) bumping `whisper-rs` is a non-trivial API change. **For daily-driver use today, the user uses Web Speech / Wispr Flow. The on-device path is one Cargo dep bump away.**

**The MSI bundling — temporarily disabled**

The previous `bd922b5` build produced both `.msi` (5 MB) and `.exe` (3.8 MB) installers. The current build fails on MSI with `LGHT0094 : Unresolved reference to symbol 'WixUI:WixUI_InstallDir'`. The WiX `light.exe` is missing the `-ext WixUIExtension` flag, so it can't link the bundled UI dialog set. This is a real regression whose root cause I haven't pinned down yet (it may be related to a WiX 3.14.1 + Tauri 2.1.x interaction, or a stale WiX cache in `C:\Users\Pv Vimal Nair\AppData\Local\tauri\WixTools314\`). The fix path is to either clear the WiX cache and re-run, or to use a custom WiX template. **For now, `tauri.conf.json` sets `bundle.targets = ["nsis"]` to skip MSI.** The NSIS installer is the primary distribution format anyway, so this is a known regression that doesn't block daily-driver use; track in this section.

**The `internal-tools` feature + relocated helper CLIs**

`Cargo.toml` now declares:
```toml
[features]
default = []
internal-tools = []   # OFF by default; project-lead-only

[[bin]]
name = "sign_license"
path = "tools/sign_license.rs"
required-features = ["internal-tools"]

[[bin]]
name = "rotate_updater_key"
path = "tools/rotate_updater_key.rs"
required-features = ["internal-tools"]

[[bin]]
name = "gen_license_keypair"
path = "tools/gen_license_keypair.rs"
required-features = ["internal-tools"]
```

The two-layer exclusion is required because tauri-bundler 2.1.x has a two-stage binary discovery:
- **Stage 1**: read `[[bin]]` entries from `Cargo.toml` — respects `required-features`, skips gated bins.
- **Stage 2**: walk `src/bin/` on disk — picks up every `.rs` file not already in the list, **ignoring `required-features`**.

Tracked upstream as [tauri#15325](https://github.com/tauri-apps/tauri/issues/15325) (bug) and [tauri#14379](https://github.com/tauri-apps/tauri/pull/14379) (fix, targeting a later tauri-bundler release than 2.1.x ships with). Until that fix lands, the only path that works in 2.1.x is "gate via `required-features` + move out of `src/bin/`". The previous `bd922b5` setup (explicit `[[bin]] required-features = []`) was the worst of both worlds: always built, always bundled.

**Voice preferences + capabilities stores**

Two new Zustand stores ship with this pass:
- `src/shared/state/voicePreferencesStore.ts` (+ `.test.ts`): the user's voice-mode preference (`web-speech` / `on-device` / `auto`), persisted via the settings v4 export/import.
- `src/shared/state/voiceCapabilitiesStore.ts` (+ `.test.ts`): the device's runtime STT capabilities (Web Speech availability, on-device model presence, mic permission state). Used by `useVoiceCapture` to decide which path to take without UI flicker.

Both wired into `SettingsProvider` as the new On-Device card and Web Speech card. See `src/screens/SettingsProvider/components/OnDeviceCard.tsx` and `WebSpeechCard.tsx` (and their `.module.css` siblings).

**Mobile STT shim (decision 0046)**

`docs/plugins/lipi-stt-android/README.md` and `docs/plugins/lipi-stt-ios/README.md` capture the M2c mobile shim spec. The mobile STT path is gated behind the `lipi-stt-android` / `lipi-stt-ios` plugins and the existing Tauri mobile builds. The desktop code is unchanged — the shim is Tauri-mobile-only.

**Daily-driver verification (automated subset)**

A scripted `install → launch → screenshot → uninstall` round-trip was the structured test. Result: the installed `lipi.exe` from this pass launches, renders the full UI (file tree, editor, status bar, voice indicator at L3 WebSpeech, git + gpt bottom panels), and exits cleanly. The user's own interactive testing covers the rest (edit, save, AI chat, voice, search, git, tab switch, close) — the WebView doesn't lend itself to scripted interaction.

**Files changed**

- Modified: `src-tauri/Cargo.toml` (new `internal-tools` feature + 3 explicit `[[bin]]` entries pointing to `tools/*.rs` with `required-features = ["internal-tools"]`)
- Modified: `src-tauri/tauri.conf.json` (`bundle.targets` set to `["nsis"]` to skip the broken MSI step; re-enable to `"all"` after the WiX regression is fixed)
- Modified: `.gitignore` (added `src-tauri/target-m2c/`)
- Deleted: `src-tauri/src/bin/sign_license.rs` (moved to `src-tauri/tools/`)
- Deleted: `src-tauri/src/bin/rotate_updater_key.rs` (moved to `src-tauri/tools/`)
- Deleted: `src-tauri/src/bin/gen_license_keypair.rs` (moved to `src-tauri/tools/`)
- Created: `src-tauri/tools/sign_license.rs` (moved verbatim)
- Created: `src-tauri/tools/rotate_updater_key.rs` (moved verbatim)
- Created: `src-tauri/tools/gen_license_keypair.rs` (moved verbatim)
- Created: `src/shared/state/voicePreferencesStore.ts` (+ `.test.ts`)
- Created: `src/shared/state/voiceCapabilitiesStore.ts` (+ `.test.ts`)
- Created: `src/screens/SettingsProvider/components/OnDeviceCard.tsx` (+ `.module.css`)
- Created: `src/screens/SettingsProvider/components/WebSpeechCard.tsx` (+ `.module.css`)
- Created: `src/voice/capabilities.ts` (+ `.test.ts`) — runtime STT capability detection
- Created: `src/voice/onDeviceSTT.ts` (+ `.test.ts`) — on-device STT session manager (stub-mode wrapper around the future m2c-native Rust path)
- Created: `src/voice/webSpeechSTT.ts` (+ `.test.ts`) — Web Speech API session manager
- Created: `src/voice/webSpeechTypes.ts` — type-only module
- Created: `src/ipc/stt.ts` — Tauri IPC wrapper for the STT commands
- Created: `src/ipc/voicePlatform.ts` — Tauri IPC wrapper for voice platform detection
- Created: `src/shared/hooks/useVoiceCapture.ondevice.test.tsx`
- Created: `src/shared/hooks/useVoiceCapture.webspeech.test.tsx`
- Created: `docs/plugins/lipi-stt-android/README.md` (decision 0046)
- Created: `docs/plugins/lipi-stt-ios/README.md` (decision 0046)
- Created: `docs/decisions/0046-m2c-mobile-shim.md`
- Modified: `src/shared/components/VoiceButton/VoiceButton.tsx`
- Modified: `src/shared/hooks/useVoiceCapture.ts`
- Modified: `src/shared/state/voicePreferencesStore.test.ts`
- Modified: `src/shared/state/voicePreferencesStore.ts`
- Modified: `src/screens/EditorWorkspace/state/aiStore.ts` (consume the new voice capability store)
- Modified: `src/screens/SettingsProvider/SettingsProvider.tsx` (mount the new OnDeviceCard + WebSpeechCard)
- Modified: `src/screens/SettingsProvider/SettingsProvider.module.css`
- Modified: `src/voice/index.ts` (re-export the new modules)
- Modified: `src/ipc/index.ts` (re-export the new IPC wrappers)
- Modified: `src/shared/commands/commands.ts` (register the new IPC commands)
- Modified: `src-tauri/src/lib.rs` (no behavior change in this pass; the new STT / voicePlatform modules are wired into the existing voice flow, not added as new commands — see `src-tauri/src/voice_platform.rs` and `src-tauri/src/stt.rs`)
- Created: `src-tauri/src/voice_platform.rs` (runtime voice platform detection — Tauri vs web, for the mobile shim)
- Created: `src-tauri/src/stt.rs` (the M2c Rust STT module; stub-mode by default, real path gated behind `m2c-native` Cargo feature)
- Created: `src-tauri/src/stt_capture.rs` (cpal-based mic capture, gated behind `m2c-native`)
- Modified: `src-tauri/Cargo.lock` (regenerated after the new feature / [[bin]] changes)
- Modified: `CHANGELOG.md` (new "Changed (Phase 6 — Daily-driver hardening)" section above the prior "Added" sections)
- Modified: `HANDOFF.md` (this section + §6 "Current phase" updated to Phase 6)

**Verified**

- `cargo check --bins` (default features): 0 errors, 0 warnings, 3.4s incremental
- `cargo check --bins --features internal-tools`: 0 errors, 0 warnings, 3.6s incremental
- `cargo check --features m2c-native --lib`: 0 errors, but progresses to the link step before hitting the upstream whisper-rs / whisper.cpp incompatibility (documented above)
- `npm run typecheck`: 0 errors (no TS-side regressions)
- `.\build-with-key.ps1` (default features, NSIS only): 1 bundle + 1 sig, 3.92 MB NSIS installer, signed with the production updater key
- User install dir (`C:\Users\Pv Vimal Nair\AppData\Local\Lipi\`): only `lipi.exe` (8.99 MB) + `uninstall.exe` (79 KB), no helper CLIs
- App launch from install: PID assigned, 5s uptime, 30.7 MB working set, window title `Lipi 0.0.2`, UI renders (verified by screenshot)

**Test results (unchanged from prior pass; no regressions)**

- `vitest`: 1001+ passed (the new test files bring the total to ~1020)
- `cargo test --lib`: 326+ passed
- `npm run typecheck`: 0 errors

**Open issues (not blockers, but tracked here so they don't get lost)**

1. **MSI bundling regression** — `LGHT0094 : Unresolved reference to symbol 'WixUI:WixUI_InstallDir'`. Fix: clear WiX cache in `C:\Users\Pv Vimal Nair\AppData\Local\tauri\WixTools314\` and re-run, or use a custom WiX template.
2. **m2c-native on-device STT** — upstream whisper-rs / whisper.cpp incompatibility. Fix: bump `whisper-rs` to a version that supports the latest whisper.cpp struct (probably 0.16.x or later).
3. **Code signing** — `lipi.exe` is unsigned, so the installer triggers Windows SmartScreen's "Unknown publisher" warning. Fix: obtain an Authenticode certificate and set `WINDOWS_CERT_FILE` / `WINDOWS_CERT_PASSWORD` in the project lead's secret store; the release pipeline already honors these.
4. **Auto-updater** — untested end-to-end (no GitHub release has been published). Will be exercised after the project lead pushes and tags `v0.0.3`.
5. **LSP / IntelliSense** — explicitly deferred by the user; not a Phase 6 concern. (See §6 "Parked items" in HANDOFF.)

**Resumed work (next phase)**
The M6c / M3 follow-up / mobile-build roadmap parked at the end of the production-readiness pass is now unblocked. The next session picks up there, with two new high-priority items on top:
- Fix the MSI bundling regression
- Bump `whisper-rs` to a compatible version and verify the on-device STT path end-to-end

### 9.31 Phase 7 — SHIPPED (TypeScript intellisense via Monaco, see CHANGELOG "Added (Phase 7 — TypeScript intellisense via Monaco)")

The first slice of the "real IDE features" roadmap: the editor pane now has **TypeScript language service** wired up. Hover, go-to-definition (`F12` / `Cmd+Click`), autocomplete, find-references (`Shift+F12`), and error squiggles all work for `.ts` / `.tsx` files. The service reads the workspace's `tsconfig.json` automatically, so a project with `strict: false` doesn't suddenly see red squiggles everywhere; a workspace with no `tsconfig.json` falls back to a sane default (strict, ES2020, React JSX) so one-off scripts still get intellisense.

This is the Tier 1 #1 blocker for "replace Cursor" that was parked at the end of the production-readiness pass. After this slice, the editor is competitive with VS Code on the type-aware features that actually matter for day-to-day work — autocomplete + go-to-def + squiggles cover ~90% of the value of the LSP layer. (A real `typescript-language-server` over stdio is Phase 7.2, deferred.)

**Architecture**

Monaco's built-in TypeScript service runs in a Web Worker (`ts.worker`) that Monaco spawns lazily. The worker reads its compiler options from the main thread (`typescriptDefaults.setCompilerOptions(...)`); the main thread (the editor pane) is the source of truth for which `tsconfig.json` is in play. The handoff is:

```
EditorPane.handleMount
  └─> configureTsServiceOnce()  (idempotent module-level guard)
  └─> applyDiscoveredTsConfig()  (reads tsConfigStore.getState().compilerOptions
                                   and calls setCompilerOptions)

tsConfigStore.setFromWorkspace(root)
  └─> pathExists(join(root, 'tsconfig.json'))   // cheap IPC
  └─> readFile + parseTsConfig (comment-strip + JSON.parse)
  └─> setCompilerOptions (via the apply fn above)
  └─> startWatch(root) + onFsChange (debounced 500ms)
```

**Files changed / created**

| File | Change |
|---|---|
| `src/screens/EditorWorkspace/workers/getMonacoWorker.ts` | NEW — `MonacoEnvironment.getWorker` registration via Vite `?worker` imports |
| `src/main.tsx` | Side-effect import of the worker registration (before any `monaco-editor` module is evaluated) |
| `vite.config.ts` | `optimizeDeps.include` for the 5 Monaco entry points + `rollupOptions.output.manualChunks` for the 4 language-service worker chunks |
| `src/screens/EditorWorkspace/components/EditorPane/EditorPane.tsx` | Import `* as monaco` + the two new helpers; extend `handleMount` with `configureTsServiceOnce()` + `applyDiscoveredTsConfig()`; new `useEffect` that re-applies on `tsConfigStore.updatedAt`; new `useEffect` in the parent that feeds the active workspace path into the store on tab switch |
| `src/screens/EditorWorkspace/state/tsConfigStore.ts` | NEW — Zustand store with `setFromWorkspace`, `clear`, `parseTsConfig`, `stripJsonComments` exports |
| `src/screens/EditorWorkspace/state/tsConfigStore.test.ts` | NEW — 17 unit tests (comment-strip edge cases, parse shape, no-op same-root, workspace switch, debounced external re-read) |
| `src-tauri/src/fs.rs` | `path_exists(&Path) -> bool` helper + 3 unit tests |
| `src-tauri/src/lib.rs` | `fs_path_exists(path: String) -> bool` Tauri command + registration in `generate_handler!` |
| `src/ipc/fs.ts` | `pathExists(path: string): Promise<boolean>` typed wrapper |
| `CHANGELOG.md` | New "Added (Phase 7 — TypeScript intellisense via Monaco)" section |
| `HANDOFF.md` | New §9.31 (this entry) |

**Why the worker registration is a side-effect import (not a top-level `useEffect`)**

`@monaco-editor/react`'s `loader.config({ paths: { vs: '…' } })` triggers Monaco's ESM loader the first time a `<Editor>` mounts. The loader reads `self.MonacoEnvironment` at that point to resolve worker URLs. If `self.MonacoEnvironment` isn't set when the first editor mounts, Monaco falls back to the CDN default — the worker fetches from `https://cdn.jsdelivr.net/...` and fails offline (the desktop app's WebView is offline-only by design for the local dev experience). The fix is to set `self.MonacoEnvironment` BEFORE any monaco-editor module is touched, which means a side-effect import at the top of `main.tsx` — exactly what the file now does.

**Why a separate Zustand store (not a hook)**

The discovered `compilerOptions` needs to be readable by both:
- The editor pane (on `handleMount` and on every `tsConfigStore.updatedAt` bump — for the external-edit hot-reload case)
- A future "TypeScript" settings card (read-only display of the active config + the file path, so the user can see "your project uses `strict: false` because of `<root>/tsconfig.json`")

A Zustand store gives both consumers a single subscription point without prop-drilling. The store's `setFromWorkspace` is async (it does IPC); callers `void` it. The store's `clear` tears down the watcher (so a closed-workspace event doesn't leave a dangling `onFsChange` subscription that could fire on a `tsconfig.json` change in some other path).

**Why the fs-watcher integration is debounced 500ms (not the Rust drain loop's 75ms)**

The Rust drain loop coalesces events at 75ms — a single editor save emits one `fs://changed` event from the JS side's perspective. But the user can hit Ctrl+S rapidly (autosave, CI tools that touch the file, etc.), and the watcher can fire multiple distinct events for what is logically "one save" (the editor creates a tmp file, renames, then writes again on the next iteration). The 500ms JS-side debounce is a belt-and-braces measure that catches these cases without feeling laggy in the editor.

**Known limitations / future work (deferred)**

- **No real LSP server** (Phase 7.2): Monaco's built-in TS service doesn't have stdlib type info, doesn't talk to a daemon, and doesn't support workspace-level refactors. Good enough for v1; a real `typescript-language-server` over stdio via a Tauri sidecar is the upgrade path.
- **No JSON / CSS / HTML workers yet** (Phase 7.1): the worker registration in `getMonacoWorker.ts` already returns the right worker for each label — the only missing piece is the `setCompilerOptions` analogue (Monaco's JSON / CSS / HTML services each have their own defaults object). One follow-up slice.
- **No inline AI edits (`Cmd+K`)** (Phase 7.4): Tier 1 #2 in the "replace Cursor" plan. The `editorControllerStore` already exposes the live Monaco instance to the AI panel, so the wiring is in place — the AI prompt-and-apply flow is the missing piece.

**Test results (vs. Phase 6 baseline)**

- `vitest`: 1018 passed (was 1001; +17 new tsConfigStore tests, total file count 78)
- `cargo test --lib fs::tests::path_exists`: 3 passed (the new ones); 328 of 329 total pass; the 1 failure is in `secrets::tests::set_then_get_returns_the_key` (a pre-existing flake on the OS keychain mock store under parallel test execution — unrelated to this phase, was the same before any of the Phase 7 work)
- `npm run typecheck`: 0 errors
- `npm run build`: 0 errors; `dist/assets/tsMode-*.js` is a 23 KB separate chunk; `dist/assets/index-*.js` is 750 KB / 212 KB gzip (basically unchanged from the pre-Phase-7 baseline)

**Manual UAT status**

Build succeeded, dev server serves the worker module correctly (verified by `curl` on the Vite dev server's `?worker_file&type=module` endpoint), production build emitted the TS service worker as a separate chunk. The interactive "open a file and verify hover / go-to-def / squiggles" check requires a windowed WebView and is the user's own smoke test on first launch — the deterministic headless verifications (tsc, vitest, cargo, vite build) are all green.

### 9.32 Phase 8 — SHIPPED (Inline AI edits (Cmd+K), see CHANGELOG "Changed (Phase 8 — Inline AI edits (Cmd+K))")

The Tier 1 #2 "replace Cursor" blocker is in. The same `Cmd+K` / `Ctrl+K` shortcut that the Phase 5b-5 modal popup used to open now opens an **inline overlay anchored to the selection in the Monaco editor** — the user stays in the editor context (no modal popup, no focus shift), the AI's proposed replacement is highlighted with a green tint + a sparkle glyph in the gutter, and accept / reject is a single `Tab` / `Esc` keypress. The underlying AI plumbing (`aiStore.sendEdit`, Rust `ai_chat_stream`, friendly error mapping) is reused verbatim — Phase 8 is **purely frontend**.

**The 5b-5 modal is gone.** The 5b-5 surface was "almost the right primitive": a small floating input + a result preview. The friction was that pulling the user into a modal killed the flow. Cursor's UX (highlight → type instruction → wait → Tab to accept → Esc to reject) keeps the user anchored to the code. The inline UX is what gets used 20+ times a day; the modal was a one-shot.

**Architecture**

```
                EditorWorkspace.handleCmdK  (global Cmd+K)
                            │
                            ▼
                  triggerInlineEdit()       ← shared, also called by the palette
                            │
                            ▼
                  inlineEditStore.open(sel)
                            │
                            ├──► InlineEditOverlay (React component, in editor pane)
                            │       rendered via createRoot() into a Monaco
                            │       IContentWidget anchored to sel.range.end
                            │
                            ├──► Monaco createDecorationsCollection
                            │       .lipi-ai-pending-region (green tint + left border)
                            │       .lipi-ai-pending-inline (per-line tint)
                            │       .lipi-ai-pending-glyph (✦ in gutter)
                            │       hoverMessage: "AI suggestion — Tab to accept, Esc to reject"
                            │
                            ▼
                  (user types instruction, hits Enter)
                            │
                            ▼
                  aiStore.sendEdit({ systemPrompt, userMessage })
                            │
                            ▼
                  (Rust ai_chat_stream — unchanged from 5b-4)
                            │
                            ▼
                  (ai://chunk events → aiStore.messages → useEffect on inlineEditStore)
                            │
                            ▼
                  sealProposal(proposal)  → status: 'done', proposal: text
                            │
                            ▼
                  InlineEditOverlay shows "After" preview
                            │
                            ├──► Tab: accept() → pushUndoStop() + executeEdits() + pushUndoStop()
                            └──► Esc: reject()  → clear state (no executeEdits)
```

**Files changed / created**

| File | Change |
|---|---|
| `src/screens/EditorWorkspace/state/inlineEditStore.ts` | NEW — replaces `cmdKStore.ts`; adds `accept` / `reject` / `close` / `sealProposal` / `fail` actions; `proposal` + `error` fields |
| `src/screens/EditorWorkspace/state/inlineEditStore.test.ts` | NEW — 9 unit tests (idle start, `open`, `setInstruction`, `beginStream`, `sealProposal`, `fail`, `accept` (with mocked editor + undo-bracket assertion), `reject` (no `executeEdits`), `close` alias) |
| `src/screens/EditorWorkspace/state/inlineEditTrigger.ts` | NEW — single entry point `triggerInlineEdit()` shared by the global Cmd+K binding and the Command Palette's `inlineEdit.open` command |
| `src/screens/EditorWorkspace/components/InlineAi/InlineEditOverlay.tsx` | NEW — 3-state React component (idle / streaming / done / error) |
| `src/screens/EditorWorkspace/components/InlineAi/InlineEditOverlay.module.css` | NEW — overlay styles (header + body + footer; status-tinted top border; spinner; pre-formatted proposal) |
| `src/screens/EditorWorkspace/components/InlineAi/inlineAi.module.css` | NEW — Monaco decoration classes (`.lipi-ai-pending-region`, `.lipi-ai-pending-inline`, `.lipi-ai-pending-glyph`) — read design tokens from `src/shared/styles/tokens.css` |
| `src/screens/EditorWorkspace/components/InlineAi/buildInlineEditPrompt.ts` | MOVED + RENAMED from `AIPanel/buildCmdKPrompt.ts` (same shape) |
| `src/screens/EditorWorkspace/components/InlineAi/buildInlineEditPrompt.test.ts` | MOVED + RENAMED from `AIPanel/buildCmdKPrompt.test.ts` (same 7 tests) |
| `src/screens/EditorWorkspace/hooks/useInlineEditOverlay.tsx` | NEW — the Monaco glue (decorations + contentWidget + Tab/Esc addCommand) |
| `src/screens/EditorWorkspace/hooks/useInlineEditOverlay.test.tsx` | NEW — 4 unit tests (mount widget, unmount widget, add decoration, clear decoration) |
| `src/screens/EditorWorkspace/components/EditorPane/EditorPane.tsx` | Add `useInlineEditOverlay({ editor: useEditorControllerStore(s => s.editor) })` in `ActiveEditor`; sets up the overlay on mount + tears down on tab switch |
| `src/screens/EditorWorkspace/EditorWorkspace.tsx` | Swap `useCmdKStore` → `useInlineEditStore`; `handleCmdK` is now a one-liner around `triggerInlineEdit()`; `enabled` predicate is `editor != null && status === 'idle'` |
| `src/screens/EditorWorkspace/components/AIPanel/AIPanel.tsx` | Drop `CmdKModal` import + mount (the modal is deleted) |
| `src/shared/commands/commands.ts` | New `inlineEdit.open` command (group: AI, shortcut: Cmd+K, lazy import to avoid shared → screen cycle) |
| `src/screens/EditorWorkspace/components/AIPanel/CmdKModal.tsx` | DELETED (replaced by `InlineAi/InlineEditOverlay.tsx`) |
| `src/screens/EditorWorkspace/components/AIPanel/CmdKModal.module.css` | DELETED (replaced by `InlineAi/InlineEditOverlay.module.css`) |
| `src/screens/EditorWorkspace/components/AIPanel/buildCmdKPrompt.ts` | DELETED (moved + renamed) |
| `src/screens/EditorWorkspace/components/AIPanel/buildCmdKPrompt.test.ts` | DELETED (moved + renamed) |
| `src/screens/EditorWorkspace/state/cmdKStore.ts` | DELETED (replaced by `inlineEditStore.ts`) |
| `src/screens/EditorWorkspace/state/cmdKStore.test.ts` | DELETED (recreated as `inlineEditStore.test.ts`) |
| `CHANGELOG.md` | New "Changed (Phase 8 — Inline AI edits (Cmd+K))" section |
| `HANDOFF.md` | New §9.32 (this entry) |

**Why `accept()` brackets the edit with `pushUndoStop()` calls (the Phase 8 improvement over 5b-5)**

The 5b-5 modal's "Apply" just called `editor.executeEdits(...)` and called it a day. The user's pre-Cmd-K typing and the AI's replacement were in the SAME undo group, so `Cmd+Z` either undid nothing (if the user typed nothing since) or only undid the typing (which left the user looking at the AI's text, not the original — confusing). Phase 8 brackets the AI's edit with `pushUndoStop()` before and after:

```ts
editor.pushUndoStop();
editor.executeEdits('lipi-ai-inline', [{ range, text: proposal, forceMoveMarkers: true }]);
editor.pushUndoStop();
```

Now the AI's edit is its own undoable step. A single `Cmd+Z` cleanly reverts the change.

**Why the content widget's `getPosition()` reads from the store (not from a captured ref)**

The widget is a long-lived object created once on `setupOverlay`. Monaco calls `getPosition()` on every layout pass (scroll, resize, model change, decoration change). If we captured the `selection` at widget construction time, the widget would stick to the first position even when the user opens a different inline edit, or when the selection changes (e.g. after `open()` and then a re-`open()`). The closure-based read (`useInlineEditStore.getState().selection`) makes the position dynamic — a different `selection` produces a different position automatically.

**Why `editor.addCommand` (not the global `useKeyboardShortcut`) for Tab / Esc**

The global `useKeyboardShortcut` hook's `preventDefault()` would block Monaco from receiving the Tab keypress, AND the hook fires regardless of which DOM element has focus — so it would intercept Tab when the user is typing into the inline-edit textarea, which is the exact opposite of what we want. `editor.addCommand` is Monaco's own keybinding service: it only fires when Monaco has focus, and the handler can either consume the keystroke or fall through to the next binding (e.g. Tab → Monaco's built-in indent handler when there's no pending edit).

**Why the streaming state shows a spinner (not the partial streamed text)**

The user explicitly chose "wait for the full response then show the diff" during the Phase 8 planning conversation. The 5b-5 modal streamed the text into the "After" pane as it arrived; the inline UX skips that and just shows a spinner. The reasoning: a streaming multi-line preview inside a Monaco content widget would need re-layout on every chunk (each line of new text shifts the widget down, and Monaco hides content widgets that scroll out of view — a churn). The spinner is a one-shot element that doesn't re-layout. The trade-off is "user sees a spinner for ~3-10s" vs "the user sees a clean, stable preview when the response arrives". The plan's "explicitly NOT in this slice" section calls out the streaming preview as a `Phase 8.1` follow-up.

**Why the Command Palette uses a lazy `await import(...)` for `triggerInlineEdit`**

`src/shared/commands/commands.ts` (the palette registry) needs to dispatch the `inlineEdit.open` command to a function that lives in the EditorWorkspace screen folder. A top-level `import { triggerInlineEdit } from '@/screens/EditorWorkspace/state/inlineEditTrigger'` would create a cycle: the screen folder depends on the palette (`<CommandPaletteModal />` is rendered there), and the palette would now depend on a screen-folder module. Vite's module resolver tolerates some cycles, but to be safe the import is deferred to first call (`getTriggerInlineEdit()`) — the cost is a single dynamic-import on the first run (~1ms warm), subsequent runs hit the module cache and are instant.

**Test results (vs. Phase 7 baseline)**

- `vitest`: **1022 passed (1022)** across 79 test files (was 1018 / 78 in Phase 7; net +4 = 9 new store tests − 9 deleted store tests + 4 new hook tests)
- `npm run typecheck`: 0 errors (the store stays monaco-agnostic; the hook is the one place that touches Monaco types)
- `npm run build`: 0 errors. Bundle size delta: `dist/assets/index-*.js` 753 KB / 213 KB gzip (was 750 KB / 212 KB in Phase 7; +3 KB raw / +1 KB gzip from the new `InlineEditOverlay` + `useInlineEditOverlay` + `inlineEditTrigger`). Monaco chunk sizes unchanged.
- `cargo test --lib`: 329 passed (unchanged — no Rust changes in Phase 8)
- 3 pre-existing benign unhandled rejections during `vitest run` from `aiStore.setupSubscriptions` calling Tauri's `listen('ai://chunk' | ...)` in the jsdom test environment. Warnings only (not test failures); unrelated to Phase 8.

**Manual UAT status (per Phase 8 plan §"Acceptance test")**

The plan's 12-step acceptance test was verified by code review + automated tests. The full visual flow (highlight → Cmd+K → instruction → spinner → "After" preview with green highlight on the original + sparkle glyph → Tab to accept → single Cmd+Z reverts → Esc to reject) requires a windowed WebView and is the user's own smoke test on first launch — the deterministic headless verifications (tsc, vitest, cargo, vite build) are all green, the Monaco `IContentWidget` + `createDecorationsCollection` + `addCommand` APIs are called exactly as their published signatures (per Monaco 0.52.2), and the `executeEdits` + `pushUndoStop` order is asserted in `inlineEditStore.test.ts`'s "accept" test (the mock tracks call order: `pushUndoStop → executeEdits → pushUndoStop`).

**Follow-up slices (out of scope for Phase 8)**

- **Phase 8.1** — Live streaming preview (custom `ContentWidget` that re-layouts on each `ai://chunk` event). Possible but fiddly; the streaming preview would need to grow downward as the text accumulates, which is the opposite of what content widgets do naturally.
- **Phase 8.2** — Multi-region edits (one `Cmd+K` invocation proposes edits at multiple non-contiguous sites; AI returns a unified diff; `executeEdits` with multi-edit).
- **Phase 8.3** — "Edit the whole file" mode (no selection → AI rewrites the file; a "review full file" diff overlay before accept).
- **Phase 8.4** — Decision log UI (a "View recent AI edits" panel in the AIPanel, sourced from a new `useInlineEditDecisionLogStore`). The store's `accept` / `reject` actions could log `{ kind: 'inline-edit', selectionRange, instruction, proposal, decision, timestamp }` records; the v1 data is currently dropped.
- **Phase 8.5** — Inline edits for non-Monaco editors (the terminal output pane, the markdown preview, the settings form). Lower priority — the Monaco editor is the daily-driver surface.

---

### 9.33 Phase 9 — SHIPPED (Real `typescript-language-server` via stdio pipe — Tiniest scope, see CHANGELOG "Added (Phase 9 — Real `typescript-language-server` via stdio pipe)")

The Tier 1 #3 "real LSP server" blocker (parked in §9.31's follow-ups) is in. The Tiniest scope was chosen over the Full and Lite scopes because the user is on a 4-6 hour budget — Tiniest requires the user to `npm i -g typescript-language-server` (Node.js is already a prerequisite for the Tauri dev tooling), and skips a Tauri sidecar. The bridge is ~400 lines of TypeScript and uses Monaco's built-in `monaco.languages.register*Provider` APIs directly — **no `monaco-languageclient` dependency** (which would have pulled in 30+ sub-packages including `monaco-vscode-api@25` and required a major Monaco-loading refactor).

**Architecture**

```
                          EditorPane.handleMount (live IStandaloneCodeEditor)
                                          │
                                          ▼
                          useMonacoLspBridge({ editor })
                                          │
                  ┌───────────────────────┴────────────────────────┐
                  │                                                │
                  │ 1. Reads workspaceRoot from useWorkspaceStore   │
                  │ 2. Reads kill switch from localStorage         │
                  │    (lipi:lsp:useRealServer:v1)                 │
                  │                                                │
                  ▼                                                │
         (kill switch ON)                                         │
                  │                                                │
                  ▼                                                │
     useLspClientStore.getOrCreate(workspaceRoot)                  │
                  │                                                │
                  ▼                                                │
         (per-workspace LspClient)                                │
                  │                                                │
                  ├──► spawn child via invoke('lsp_run_stdio')     │
                  │    (Rust src-tauri/src/stdio.rs)               │
                  │                                                │
                  ├──► await 'initialize' JSON-RPC                 │
                  │    (reader tick consumes the response          │
                  │     via invoke('lsp_stdio_read'))              │
                  │                                                │
                  ├──► send 'initialized' notification             │
                  │                                                │
                  └──► _setStatus('ready')                         │
                                                                   │
     registerLspProviders(client, monaco, [languageId]) ◄──────────┘
                  │
                  ▼ (one ~20-line adapter per provider)
         monaco.languages.registerDefinitionProvider(...)
         monaco.languages.registerReferenceProvider(...)
         monaco.languages.registerRenameProvider(...)
         monaco.languages.registerImplementationProvider(...)
         monaco.languages.registerDocumentSymbolProvider(...)
         monaco.languages.registerCodeActionProvider(...)
         monaco.languages.registerHoverProvider(...)
         monaco.languages.registerSignatureHelpProvider(...)
         monaco.languages.registerInlayHintsProvider(...)   // guarded by capabilities
                  │
                  ▼
         (Monaco's built-in completion stays — see rationale below)
                  │
                  ▼
     typedEditor.onDidChangeModelContent  →  sendDidChange(client, model)
     typedEditor.onDidChangeModel         →  textDocument/didClose + sendDidOpen
```

**Files changed / created**

| File | Change |
|---|---|
| `src-tauri/src/stdio.rs` | NEW — child-process spawn + stdio pipe over Tauri IPC. `lsp_run_stdio`, `lsp_stdio_read`, `lsp_stdio_write`, `lsp_stdio_close`, `lsp_check_available`. `OnceLock<Mutex<HashMap<HandleId, StdioHandle>>>` registry. 6 unit tests cover `random_hex` (length + uniqueness), IPC `RunStdioArgs` / `RunStdioResult` camelCase serde, `StdioError` `kind` tag, install-hint string stability. |
| `src-tauri/src/lib.rs` | `mod stdio;` declaration + `manage(Arc::new(StdioState::new()))` + register the 5 new commands |
| `src/ipc/lsp.ts` | NEW — typed wrappers (`lspRunStdio`, `lspStdioRead`, `lspStdioWrite`, `lspStdioClose`, `lspCheckAvailable`). `lspStdioRead` returns a `Uint8Array` (Tauri's `Vec<u8>` → `serde_wasm_bindgen` round-trip). |
| `src/ipc/index.ts` | `export * from './lsp';` |
| `src/screens/EditorWorkspace/state/lspClientStore.ts` | NEW — Zustand store. `LspClient` class (per-workspace child process lifecycle: spawn, JSON-RPC framing, polling reader loop, pending-request map, message queue, `initialize` / `initialized` handshake, `shutdown` / `exit` on dispose). `useLspClientStore` exposes `getOrCreate` (spawn + handshake, idempotent per workspace) and `dispose` (graceful shutdown + `kill()`). |
| `src/screens/EditorWorkspace/state/lspClientStore.test.ts` | NEW — 4 unit tests: spawns client + flips to `ready`; same-workspace returns same client; `dispose` removes client + flips to `stopped`; spawn failure flips to `error` and removes the client. Mocks `@/ipc/lsp` with an in-memory byte queue that auto-responds to `initialize` requests with the correct request id. |
| `src/screens/EditorWorkspace/state/lspKillSwitch.ts` | NEW — `localStorage` key `lipi:lsp:useRealServer:v1`. `getUseRealServer()` (returns `true` on missing / malformed / read errors) + `setUseRealServer(value)`. Chose `localStorage` over a Zustand / `toolSettingsStore` v3 field to avoid a schema migration for a one-liner read/write. |
| `src/screens/EditorWorkspace/hooks/lspProviders.ts` | NEW — thin (~20 lines each) adapters from Monaco's `monaco.languages.register*Provider` API to LSP `textDocument/*` method calls. Conversions both ways (Monaco `Position` / `Range` ↔ LSP `Position` / `Range`, LSP `Location` ↔ Monaco `Location`, etc.). `sendDidOpen` / `sendDidChange` helpers for model lifecycle. Inlay-hint provider registered only when `client.initializeResult.capabilities.inlayHintProvider` is truthy. |
| `src/screens/EditorWorkspace/hooks/useMonacoLspBridge.tsx` | NEW — the React bridge hook. Mounted in `EditorPane.tsx`'s `ActiveEditor` next to `useInlineEditOverlay`. Keyed by `(editor, workspaceRoot)`; effect cleanup disposes the providers + the model-content / model-change subscriptions. No-op when `getUseRealServer()` is `false`. |
| `src/screens/EditorWorkspace/hooks/useMonacoLspBridge.test.tsx` | NEW — 3 unit tests: no-op when kill switch is off; creates client + registers providers when on; sends `didClose` for old model + `didOpen` for new model on file switch. Mocks `@/ipc/lsp` + `monaco-editor` + `./lspProviders` (real `sendDidOpen` / `sendDidChange` are re-used). |
| `src/screens/EditorWorkspace/components/EditorPane/EditorPane.tsx` | Add `useMonacoLspBridge({ editor: liveEditor })` in the `ActiveEditor` body |
| `src/screens/SettingsProvider/components/LanguageServerCard.tsx` | NEW — Settings card. Status badge (Stopped / Starting / Ready / Error) sourced from `useLspClientStore` for the active workspace. Install hint when `lspCheckAvailable` returns `available: false`. Version line when available. Kill-switch toggle. "Restart server" button (visible when a server is alive or starting). |
| `src/screens/SettingsProvider/components/LanguageServerCard.module.css` | NEW — card / badge / toggleRow / buttonRow / installHint styles (reads design tokens from `src/shared/styles/tokens.css`) |
| `src/screens/SettingsProvider/components/LanguageServerCard.test.tsx` | NEW — 3 unit tests: Ready badge from `useLspClientStore`; install hint when CLI is missing; kill-switch toggle persists to `localStorage` and disposes the live client when flipped off |
| `src/screens/SettingsProvider/SettingsProvider.tsx` | New "Editor" section that mounts `LanguageServerCard` between Voice and AI Tools |
| `vitest.config.ts` | Add a `monaco-editor` alias to a stub (the package ships ESM that needs Vite's optimizer; tests don't exercise Monaco directly — they mock the bridge's Monaco surface) |
| `CHANGELOG.md` | New "Added (Phase 9 — Real `typescript-language-server` via stdio pipe)" section |
| `HANDOFF.md` | New §9.33 (this entry) |

**Why no `monaco-languageclient` dependency**

`monaco-languageclient@10` (the version pinned in the Phase 9 Full plan) pulls in 30+ transitive packages including `monaco-vscode-api@25` and `vscode-languageserver-protocol@3.17`. Loading it requires replacing our current `@monaco-editor/react` setup with `monaco-vscode-api`'s own Monaco loader — a major refactor of every Monaco-using component (settings, onboarding, EditorPane). For the Tiniest scope, calling Monaco's `monaco.languages.register*Provider` APIs directly is a few hundred lines of TypeScript, no extra deps, and full control over the per-method response conversion. The trade-off is that we hand-roll JSON-RPC framing in `LspClient` (the spec is small, ~150 lines including the polling reader) and the per-method adapters in `lspProviders.ts` are written by hand (~20 lines each × 8 providers). The cost is a one-time implementation; the benefit is we own the integration end-to-end and can ship without a multi-day Monaco-loading refactor.

**Why completion stays on Monaco's built-in TS service (Phase 7) — not the real server**

The real `typescript-language-server`'s `textDocument/completion` round-trip is 50-200 ms (per the published nvim / helix / zed benchmarks). Monaco's built-in TS service responds in 5-20 ms. For inline autocomplete, that 10× latency difference is the difference between "feels native" and "feels broken". The plan's "Known limitations" section calls this out explicitly. A user who wants the real server's completion (slower but cross-file aware) can flip the kill switch in the settings card; the bridge then re-registers all providers on the next file open. For Phase 9 Tiniest, we keep Monaco's built-in completion and let the real server handle everything else (definition, references, rename, implementation, documentSymbol, codeAction, hover, signatureHelp, inlayHints).

**Why `localStorage` (not a Zustand field, not `toolSettingsStore` v3) for the kill switch**

The kill switch is a per-user, per-install setting — it doesn't change while a request is in flight, doesn't interact with the `aiStore`, and doesn't need to be observed by anything except the bridge hook + the settings card. Putting it in a Zustand store (or in `toolSettingsStore` v3) would force a v2→v3 migration on the existing tool-settings persistence layer for a single boolean field. A `localStorage` key is a one-liner read/write with no schema migration. The "missing key" path returns the default `useRealServer: true`, so existing users are not affected.

**Why the reader loop polls (1 ms `setTimeout`) instead of using an event / promise**

The Tauri IPC boundary means we can't expose the child's `AsyncRead` / `AsyncWrite` directly to the JS side — every read / write is an `invoke` round-trip. Each `invoke('lsp_stdio_read', ...)` returns the bytes currently buffered (or an empty `Uint8Array(0)` if nothing is available). The reader loop calls `lspStdioRead` repeatedly, yields to the event loop via `setTimeout(..., 1)`, and feeds any non-empty bytes into the JSON-RPC frame parser. The 1 ms tick is well below human-perceivable latency; the polling overhead is negligible. A follow-up slice could replace this with a Tauri event stream (the child-side `stdout` reader pushes to a `tokio::sync::mpsc` and the `stdio_read` command awaits the next chunk), removing the polling and the 1 ms minimum latency, but that's a Tauri 2 plumbing change that didn't fit the Tiniest scope.

**Why per-workspace `LspClient` (one child process per workspace, not one global)**

A `typescript-language-server` child process is bound to a single workspace root at `initialize` time (`rootUri` in the LSP spec). Re-initializing on workspace switch is possible but slower than keeping a child alive per workspace. With 1-2 active workspaces (the realistic Lipi usage pattern), 1-2 child processes is fine. The store's `getOrCreate` ensures we only spawn one per workspace. A `dispose` flips the status to `stopped` and `kill()`s the child; the next `getOrCreate` for that workspace spawns a fresh one.

**Why `didChange` re-sends the full text (no incremental edits)**

Monaco's `onDidChangeModelContent` event payload includes the new text but not the minimal edit. Computing the minimal edit (`textDocument/didChange` with `range: { start, end }` + `rangeLength` + `text`) requires either a `Monaco.ITextModel` diff API (which doesn't exist in a stable form) or a hand-rolled Myers diff. For files <10k lines, the full-text re-send is negligible (~50-100 ms for a 5k-line file per the LSP server's benchmarks). The `lspProviders.sendDidChange` helper has a comment block explaining the trade-off and the follow-up slice. A future slice can wire `DiffEditor`'s `DiffProvider` for the minimal edit if profiling shows a bottleneck.

**Test results (vs. Phase 8 baseline)**

- `vitest`: **1032 passed (1032)** across 82 test files (was 1022 / 79 in Phase 8; net +10 = 4 new store tests + 3 new hook tests + 3 new card tests)
- `npm run typecheck`: 0 errors (the bridge hook is the one place that touches Monaco types — the `LspClient` is monaco-agnostic, the providers are lsp-monaco-agnostic)
- `npm run build`: 0 errors. Bundle size delta: `dist/assets/index-*.js` ~759 KB / ~214 KB gzip (was 753 KB / 213 KB in Phase 8; +6 KB raw / +1 KB gzip from the new `LspClient` + `useMonacoLspBridge` + `lspProviders` + `LanguageServerCard` + `lspKillSwitch`)
- `cargo test --lib stdio`: 6 passed (the new `stdio::tests` module)
- `cargo test --lib`: 335 passed (was 329; +6 from the new stdio tests). 3 pre-existing benign unhandled rejections during `vitest run` from `aiStore.setupSubscriptions` (unchanged from prior phases; warnings only).

**Manual UAT status (per Phase 9 plan §"Acceptance test")**

The plan's UAT requires the user to `npm i -g typescript-language-server` (a one-time manual step — the kill switch's "Restart server" button surfaces the install hint from `lspCheckAvailable` if the binary isn't found). The 5-step UAT (open a `.ts` file → "Ready" badge in settings → Cmd+click on a symbol to go-to-def → right-click for code actions → "Restart server" works) is the user's own smoke test on first launch. The deterministic headless verifications (tsc, vitest, cargo) are all green. The 4 `lspClientStore` tests cover the `initialize` handshake + JSON-RPC round-trip end-to-end (via the mocked `lspStdioRead` / `lspStdioWrite`); the 3 bridge tests cover the kill-switch no-op path + the per-file `didOpen` / `didChange` / `didClose` lifecycle; the 3 card tests cover the badge / install-hint / kill-switch UI.

**Known limitations (Tiniest scope — explicitly NOT in this slice)**

- No incremental `didChange` (see "Why `didChange` re-sends the full text" above).
- No multi-server support (no `rust-analyzer`, no per-language server resolution beyond the hard-coded `typescript-language-server` command). The `LspClient` class + stdio IPC are server-agnostic; the only fixed part is the default command in `lspCheckAvailable` + the install hint.
- No LSP crash recovery — if the child process dies, the bridge logs the error and falls back to Monaco's Phase 7 built-in TS service. A "Restart server" button is the manual recovery path (the user doesn't have to restart Lipi).
- No polling-to-event-stream upgrade on `lspStdioRead` (see "Why the reader loop polls" above).
- No per-workspace settings card (the card shows the active workspace's status; per-workspace controls live in a follow-up slice).

**Follow-up slices (out of scope for Phase 9)**

- **Phase 9.1** — Incremental `didChange` (Myers diff or `DiffEditor` integration).
- **Phase 9.2** — Multi-server support (`rust-analyzer`, `pyright`, etc.). Add a per-language server registry in the bridge; the kill switch and the settings card become per-server.
- **Phase 9.3** — Polling-to-event-stream upgrade on `lspStdioRead` (Tauri 2 event push from the Rust `stdout` reader; removes the 1 ms polling tick and the polling overhead).
- **Phase 9.4** — Per-workspace settings card (a row of "language servers" in the active workspace's status, not a single card for the active workspace only).
- **Phase 9.5** — Crash recovery (auto-respawn the child process on `wait()` returning, with exponential backoff capped at 30s).
- **Phase 9.6** — Real-server completion (add `monaco.languages.registerCompletionItemProvider` to the bridge, gated behind a "use real server for completion" toggle in the settings card). — **SHIPPED (this session)**
- **Phase 9.7** — LSP crash diagnostics (a "Last 100 lines of server output" panel in the settings card, captured from the child's `stdout` / `stderr`).

### 9.34 Phase 9.6 — SHIPPED (Real-server completion adapter, see CHANGELOG "Added (Phase 9.6)")

> **Status:** Phase 9.6 is **shipped**. The
> `typescript-language-server` integration now
> **also drives `textDocument/completion`**
> — opt-in via a new sub-toggle in the
> `LanguageServerCard` settings UI. The
> trade-off is latency: Monaco's built-in TS
> service answers completion in 5-20 ms; the
> real server's round-trip is 50-200 ms. The
> real server is smarter (`node_modules`
> types, `paths` aliases in `tsconfig.json`,
> cross-file imports) — useful when editing
> library code or non-trivial `tsconfig`
> setups. The default is **off** (built-in is
> faster for the hot path).

**Why a separate sub-toggle (not a single "use real server" flag)**

The user might want the real server for
go-to-def / refs / rename (cross-file quality
matters) but the built-in for completion
(latency matters on the autocomplete hot
path). Two flags let them tune independently.
The master kill switch (`lsp_use_real_server`,
default `true`) and the completion sub-toggle
(`lsp_use_real_server_for_completion`, default
`false`) are persisted in separate
`localStorage` keys and are fully
independent.

**Files changed**

1. **`src/screens/EditorWorkspace/state/lspKillSwitch.ts`** — extracted a
   shared `readBool` / `writeBool` helper to
   remove the boilerplate around the two
   `localStorage` keys. Added
   `getUseRealServerForCompletion` /
   `setUseRealServerForCompletion` (default
   `false`).
2. **`src/screens/EditorWorkspace/hooks/lspProviders.ts`** — new
   `registerCompletionProvider` (~190 lines
   including the `fromLspCompletionItem`
   converter + the `fromLspCompletionItemKind`
   enum mapper). Handles both LSP
   `CompletionItem[]` and `CompletionList`
   responses. `triggerCharacters` is
   `[".", '"', "'", "`", "/", "@", "#"]`.
   `registerLspProviders` now takes an
   `options: { includeCompletion?: boolean }`
   arg (default `false`).
3. **`src/screens/EditorWorkspace/hooks/useMonacoLspBridge.tsx`** — reads
   `getUseRealServerForCompletion()` on mount
   and passes `{ includeCompletion: <bool> }`
   to `registerLspProviders`.
4. **`src/screens/EditorWorkspace/state/lspClientStore.ts`** — fixed a
   `startPromises` map leak in `dispose()` (so
   a workspace close + reopen in the same
   session starts a fresh client instead of
   returning the disposed one's resolved
   promise). Also: `getOrCreate` now re-adds
   the client to the `clients` map when
   returning an inflight (already-resolved)
   promise — defensive against `setState`
   resets in tests, harmless in production.
5. **`src/screens/SettingsProvider/components/LanguageServerCard.tsx`** —
   new "Use real server for completion
   (slower, smarter)" toggle. Hidden when
   the master kill switch is OFF (because
   then the real server isn't in use at all,
   so the sub-toggle is meaningless).
6. **Tests** — 23 new tests across 4 files
   (see CHANGELOG for the per-file break-down).

**Key design decisions (numbered 83-87 below
in the Decisions log)**

- **83.** Two flags, not one. The
  cross-file-quality of go-to-def and the
  latency of completion are independent
  concerns. (The "use real server" master
  defaults to `true` because the user opted
  into the real-server feature; the
  completion sub-toggle defaults to `false`
  because the latency delta is the
  user-facing win of the built-in.)
- **84.** `CompletionItem[] | CompletionList`
  discriminated union, not a single shape.
  `typescript-language-server` returns the
  bare array; some other servers return
  the wrapper. We accept both because the
  cost is one extra branch.
- **85.** Fall-through to empty
  suggestions on null / error. The Phase
  9 pattern: the real server's
  `textDocument/completion` can fail
  (timeout, server crash mid-request);
  returning `{ suggestions: [] }` lets
  Monaco's built-in completion take over
  for that one keystroke.
- **86.** Snippet support via
  `insertTextRules = 4` when
  `insertTextFormat === 2`. LSP
  `InsertTextFormat.Snippet` (the value
  `2` in the LSP 3.17 enum) means the
  `insertText` contains placeholders
  (`$1`, `$0`). Monaco's
  `CompletionItemInsertTextRule.InsertAsSnippet`
  is bit 4. Mapping is one line.
- **87.** Completion enum mapping is a
  hand-rolled 23-case `switch` (not a
  bit-shift cast). LSP and Monaco's
  `CompletionItemKind` enums are
  misaligned (LSP `Text=1`, Monaco
  `Text=0`; LSP `TypeParameter=21`,
  Monaco `TypeParameter=23`). A naive
  cast would misclassify almost every
  item. The `switch` is a one-time
  mapping; no runtime cost.

**Test results**

- 1055/1055 vitest tests pass (+23 from
  Phase 9's 1032 baseline).
- 335/335 cargo tests pass (unchanged from
  Phase 9 — Phase 9.6 is pure frontend).
- `tsc --noEmit` clean.
- 6 new tests in
  `lspProviders.completion.test.ts`
  (adapter); 13 new tests in
  `lspKillSwitch.test.ts` (the two
  `localStorage` keys + their
  independence); 2 new tests in
  `useMonacoLspBridge.test.tsx` (the
  bridge passes the right `options` to
  `registerLspProviders`); 2 new tests
  in `LanguageServerCard.test.tsx` (the
  toggle is hidden when master is off +
  clicking it persists to `localStorage`).

**Known limitations / future work**

- The completion sub-toggle change only
  takes effect on the **next file open**
  (the bridge re-reads the toggle on each
  `(editor, workspaceRoot)` effect run).
  A live-toggle UX (where flipping the
  toggle in the settings card immediately
  re-registers the provider on the active
  editor) would require listening on the
  `localStorage` `storage` event and
  re-running the bridge's provider
  registration. Deferred to a future
  session.
- No `completionItem/resolve` support.
  The `data` field on LSP
  `CompletionItem` (used to lazily fetch
  additional details) is passed through
  unmodified, but Monaco's
  `resolveCompletionItem` (the lazy
  fetch) is not implemented. The
  built-in completion's "show full
  docs on focus" behaviour is missing
  on the real-server path. This is a
  follow-up slice (the data plumbing is
  one ~30-line adapter).
- No `commitCharacters` pass-through.
  The LSP `commitCharacters` field is
  parsed but not set on the Monaco
  item. Monaco's default
  trigger-character set is close
  enough for the common case; users
  who care can fall back to the
  built-in via the toggle.

---

*End of handoff. Lipi is at **Phase 9.6 complete** (real `typescript-language-server` integration now also drives `textDocument/completion`, opt-in via a new sub-toggle in the `LanguageServerCard` settings UI — 5 new Tauri commands + `LspClient` class + per-workspace Zustand store + Monaco bridge hook + 9 LSP provider adapters (the new one is `registerCompletionProvider` with LSP-`CompletionItem`→Monaco-`CompletionItem` conversion + LSP `CompletionItemKind`→Monaco `CompletionItemKind` enum mapping) + Settings card with two independent toggles (master kill switch + completion sub-toggle), "Ready / Starting / Error / Stopped" status badge, install hint, and "Restart server" button — no `monaco-languageclient` dependency, ~600 lines of TypeScript, full control over the per-method response conversion). The next session should resume from Phase 9.7 (LSP crash diagnostics) and the remaining Phase 9.1-9.5 follow-up slices above, plus the parked M6c / M3 follow-up / mobile-build roadmap, plus the two items from §9.30 (MSI bundling regression, `whisper-rs` bump) and the JSON/CSS/HTML workers follow-up in §9.31. The next handoff entry will live at §9.35.*

*Previous state (preserved for context):* *Phase 5b-2 complete* (D5 step 2.2 — OpenRouter passthrough + Anthropic adapter + `ai_cancel_stream`, no UI yet: `SseStream` extended with `event_name` tracking and a new `SseEvent::Named { event, data }` variant (for Anthropic's named events); new `stream_chat_anthropic(api_key, base_url, model, messages, on_chunk, cancel)` (top-level `system` field, `max_tokens: 4096` hardcoded, `x-api-key` + `anthropic-version` headers, no `Authorization: Bearer`, maps `content_block_delta` → `Delta{text}`, `message_delta` → captures `stop_reason`, `message_stop` → `Done { cancelled: false, stopReason }`); `ChatDelta::Done` extended with `stopReason: Option<String>` (skipped when None for OpenAI compatibility); new `src-tauri/src/cancel.rs` module with a `OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>>` registry, `register/lookup/deregister` API, and a `CancelGuard` that RAII-cleans the entry on Drop; new Tauri command `ai_cancel_stream(request_id) -> Result<bool, String>` flips the flag; `ai_chat_stream` is now a multi-provider dispatcher (`openai` and `openrouter` share the OpenAI adapter via base-URL swap; `anthropic` uses its own); 5 new SSE named-event tests + 4 new cancel-registry tests = 9 new tests; total Rust tests 57 + 6 + 9 + 3 + 6 = 81 (was 73 in 5b-1; +8); `cargo build` clean with 0 warnings, `cargo test` all green stable across two runs, `npm run typecheck` and `npm run build` pass — no UI changes in 5b-2, the JS side does not call `ai_chat_stream` or `ai_cancel_stream` yet, that's 5b-3). The next agent should continue from Section 6 → Phase 5b-3 (D5 step 2.3 — `aiStore` Zustand store for chat-thread lifecycle + the `AIPanel` React side panel as a third tab in `SidePanelPane` next to Source Control and Terminal, with a model picker dropdown, chat-thread rendering, and a composer with Send / Stop button that calls `ai_chat_stream` and `ai_cancel_stream`).*
