# Google Play Console metadata — Lipi

> **Status:** Phase A template (mobile-build roadmap,
> HANDOFF §9.48, Decision #179). The project lead
> fills in the `[project lead: ...]` placeholders
> before the first Play Store submission. The
> data-safety-form answers are pre-filled because
> they're the non-obvious part.

## App details

| Field | Value |
|-------|-------|
| App name | Lipi |
| Short description (80 chars) | Voice-first cross-platform IDE. BYO API key. |
| Full description (4000 chars) | [project lead: see template below] |
| App icon (512×512) | [project lead: high-res PNG, not the placeholder] |
| Feature graphic (1024×500) | [project lead: PNG/JPG] |

### Full description template

> Lipi is a voice-first, cross-platform IDE for
> Windows, macOS, Linux, iOS, and Android.
>
> Bring your own OpenAI, Anthropic, or OpenRouter
> API key. No Lipi-side billing. No backend.
>
> Features:
> - **Voice capture** — on-device speech-to-text
>   (Apple's `SFSpeechRecognizer` on iOS, Google's
>   `SpeechRecognizer` on Android, `whisper-rs` on
>   desktop). Audio is processed on-device; we
>   never transmit the audio to a server.
> - **Editor** — Monaco-based, with LSP support
>   for TypeScript, Python, and Rust.
> - **File tree** — recursive, with rename / delete
>   / new-file right-click actions.
> - **Source control** — `gix`-backed git
>   integration.
> - **Terminal** — `portable-pty`-backed embedded
>   terminal.
> - **AI panel** — chat with OpenAI, Anthropic, or
>   OpenRouter, with streaming and cancellation.
> - **Settings** — export / import the full Lipi
>   state as a single JSON file (with a privacy
>   notice explaining exactly what's included).

## Categorisation

| Field | Value |
|-------|-------|
| Category | Productivity |
| Tags | Developer Tools, IDE, Code Editor |
| Content rating | Everyone (PEGI 3 / ESRB E) |
| Target audience | Developers, age 13+ |

## Data safety form

Lipi collects:

- **Voice audio (transient)** — for on-device
  speech-to-text. Audio is processed on-device;
  we never transmit the audio to a server. The
  user can disable voice capture at any time.
  **Is this data shared with third parties? No.**
  **Is this data stored on the user's device
  transiently? Yes.**
  **Can the user delete this data? N/A
  (transient).**

- **API keys (encrypted)** — for AI provider
  access. Stored in the OS keychain
  (`tauri-plugin-stronghold` on Android).
  **Is this data shared with third parties?
  [project lead: we don't transmit; mark "No"].**
  **Is this data stored on the user's device? Yes
  (encrypted).** **Can the user delete this
  data? Yes (Settings → Privacy & data → Clear).**

- **Crash reports (opt-in)** — for app
  stability monitoring. [project lead: enable
  or disable]. **Is this data shared with third
  parties? [project lead].** **Is this data
  stored on the user's device? No (sent to
  the crash reporting service).** **Can the
  user delete this data? [project lead].**

Lipi does NOT collect:

- Location
- Personal info (name, email, phone, address)
- Financial info
- Health & fitness
- Messages
- Photos / videos
- Audio files (only the transient audio
  buffer for STT; not stored)
- Files / docs (the editor content stays on
  the user's device)
- Calendar
- Contacts
- App activity (besides the opt-in crash reports)
- Web browsing
- App info & performance (besides the opt-in
  crash reports)
- Device or other IDs

## Screenshots

Required (per Google's Play Console spec):

- **Phone** (1080×1920 minimum) — 2-8
  screenshots
- **7-inch tablet** (1200×1920) — 1-8
  screenshots (only if the app supports tablets)
- **10-inch tablet** (1920×1200) — 1-8
  screenshots (only if the app supports tablets)
- **Chromebook** (1366×768 or 2560×1600) —
  1-8 screenshots (only if the app supports
  Chromebook)

Suggested shots: see `app-store.md` (the same
5 shots work for both stores).

## Pricing

Lipi is free. No in-app purchases. The AI
provider API keys are user-supplied.

## Target audience & content

- Primary: developers (age 18+)
- Secondary: students learning to code (age 13+)
- Content: developer tool, no objectionable content
- Ads: none
- Tracking: none

## How to use this template

1. Read this file end-to-end.
2. Fill in the `[project lead: ...]` placeholders
   (or accept the pre-filled values).
3. Copy the filled values into Google Play Console
   (https://play.google.com/console).
4. The screenshots spec lists the required
   dimensions per device class; the suggested
   shots (5 of them) work for all 4 device
   classes.
5. The data-safety-form answers are pre-filled
   with the exact data Lipi collects. Review
   the language carefully; the Play Store
   legal team has rejected apps for vague
   data-safety disclosures.
