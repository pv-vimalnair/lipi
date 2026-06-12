# Lipi

> A voice-first, cross-platform IDE. BYO API key. No backend.

Lipi is a Cursor / Windsurf / VS Code competitor that ships to **Windows, macOS,
Linux, iOS, and Android** from a single codebase. The headline differentiator is
**voice-to-code on mobile**: speak, get code. The differentiator on desktop is the
same plus a deeply integrated terminal, file tree, git, and AI chat panel — all
with your own API keys, never a vendor lock-in.

## Why Lipi

- **No backend.** Your code, your keys, your machine. We never see a request.
- **BYO API key.** OpenAI, Anthropic, OpenRouter for the LLM. Wispr Flow
  (with on-device fallback) for voice.
- **5 platforms, 1 codebase.** Tauri 2 + React 18 + TypeScript + Vite + Monaco.
- **Voice-first on mobile.** On-screen keyboards are why nobody codes on phones
  today. Lipi is built around the mic.
- **Free. MIT licensed.** No "Pro" tier, no freemium, no surprises.

## Current phase

**Phase 1b complete — Tauri shell on Windows.** The Rust shell wraps the
existing React frontend, the IPC bridge is live, the updater plugin is
registered, and the 5-platform bundle config is in place. Next is
**Phase 2 (D2) — Editor + file tree + tabs** wired to a real
filesystem via `src-tauri/src/fs.rs`.

What's **not** here yet: real file I/O, real git, real terminal, AI
streaming, voice capture, or mobile packaging. Those are Phases
D2–D6 and M1–M5, in that order.

## Run it

### Prereqs (already installed on the dev machine)

- **Node ≥ 20** (we test on 24.x)
- **Rust stable** (MSVC ABI on Windows) — `rustup-init.exe` from <https://rustup.rs>
- **Visual Studio Build Tools** with the *C++ build tools* workload + **Windows 11 SDK**
- **Tauri CLI 2.x** — `cargo install tauri-cli --version "^2.0" --locked`
- Uses **npm** (not pnpm/yarn/bun)

### Commands

```bash
npm install              # one-time
npm run typecheck        # strict TS, no emit
npm run dev              # frontend only on http://localhost:1420/
npm run dev:tauri        # full Tauri shell (compiles Rust first time, ~2 min)
npm run build            # production frontend build to dist/
npm run build:tauri      # full Tauri build with bundling (.msi, .exe, etc.)
```

`npm run dev:tauri` is the canonical way to develop Lipi. The Rust crate
recompiles incrementally on save; the React frontend hot-reloads via Vite.

## Project layout

```
lipi/
  src/                            React + TypeScript frontend
    main.tsx                      React root
    screens/                      One folder per screen
      EditorWorkspace/            Main 3-pane IDE shell
        components/               TitleBar, StatusBar, FileTree, Editor, SidePanel, MobileShell
        hooks/                    useViewport
        EditorWorkspace.tsx       Screen entry, switches desktop/mobile by viewport
      Welcome/                    Stub
    shared/                       Cross-screen primitives
      components/                 Button, IconButton, Stack
      styles/                     tokens.css, global.css
    dev/                          Top-8 device emulator (DEV-only, tree-shaken in prod)
    voice/                        Voice provider interfaces + Wispr client stub
  src-tauri/                      Rust core (Tauri 2)
    Cargo.toml
    tauri.conf.json
    src/
      main.rs                     Windows entry, calls lipi_lib::run()
      lib.rs                      App setup, IPC commands, plugins
    capabilities/                 ACL files (Tauri 2 permissions)
    icons/                        32-icon set for all 5 platforms
  index.html
  package.json
  vite.config.ts                  Port 1420, Tauri-friendly envPrefix
  tsconfig.json
  HANDOFF.md                      Source of truth for decisions, state, and phases
  docs/ENGINEERING.md             The 7 engineering rules every change must follow
```

## Contributing

Read [`HANDOFF.md`](./HANDOFF.md) first for the *what* and *why*,
then read [`docs/ENGINEERING.md`](./docs/ENGINEERING.md) for the *how*
(the 7 engineering rules every change must follow).

Don't install toolchains without owner confirmation — that's a hard rule.

## License

[MIT](./LICENSE). Copyright 2026.
