# App Store Connect metadata — Lipi

> **Status:** Phase A template (mobile-build roadmap,
> HANDOFF §9.48, Decision #179). The project lead
> fills in the `[project lead: ...]` placeholders
> before the first App Store submission. The
> privacy-nutrition-label data + the
> data-safety-form answers are pre-filled because
> they're the non-obvious part; everything else is
> editorial.

## App information

| Field | Value |
|-------|-------|
| App name | Lipi |
| Subtitle | Voice-first cross-platform IDE |
| Promotional text | [project lead: 170 chars, shown above screenshots on the App Store; update per release] |
| Description | [project lead: up to 4000 chars] |
| Keywords | [project lead: comma-separated, up to 100 chars] |
| Category | Developer Tools |
| Secondary category | Productivity |
| Support URL | https://github.com/lipi-dev/lipi/issues |
| Marketing URL | https://lipi.dev |
| Privacy Policy URL | https://lipi.dev/privacy |

## Pricing and availability

| Field | Value |
|-------|-------|
| Price | Free |
| Availability | All territories |
| Pre-orders | No |
| Educational discount | No |

## App privacy (privacy nutrition label)

Lipi collects:

- **Voice audio (transient)** — for on-device
  speech-to-text (Apple's `SFSpeechRecognizer`
  on iOS, Google's `SpeechRecognizer` on
  Android, `whisper-rs` on desktop). Audio is
  processed on-device; we never transmit the
  audio to a server. The user can disable voice
  capture at any time.
  **Linked to user identity? No.**
  **Used for tracking? No.**

- **API keys (encrypted)** — for AI provider
  access (OpenAI, Anthropic, OpenRouter, Wispr).
  Stored in the OS keychain (`keyring` 3.x's
  `apple-native` feature on macOS / iOS,
  `tauri-plugin-stronghold` on Android,
  `keyring` 3.x's `windows-native` feature on
  Windows, `keyring` 3.x's `sync-secret-service`
  on Linux). **Not transmitted off-device.**
  **Linked to user identity? No.**
  **Used for tracking? No.**

- **Crash reports (opt-in)** — for app
  stability monitoring. [project lead: enable
  or disable; if enabled, configure the
  Crashlytics SDK or equivalent].
  **Linked to user identity? [project lead].**
  **Used for tracking? No.**

Lipi does NOT collect:

- Contact info
- Location
- Financial info
- Health & fitness
- Sensitive info
- Contacts
- User content (the editor content stays on
  the user's device)
- Browsing history
- Search history
- Identifiers
- Usage data (besides the opt-in crash reports)
- Diagnostics (besides the opt-in crash reports)
- Purchases (the app is free)
- Other data

## Screenshots

Required (per Apple's App Store Connect
screenshot spec):

- **6.7" iPhone 15 Pro Max** (1290×2796) — 3-10
  screenshots
- **6.1" iPhone 15** (1179×2556) — 3-10
  screenshots
- **12.9" iPad Pro** (2048×2732) — 3-10
  screenshots (only if the app supports iPad)

Suggested shots (in order):

1. The editor with a code file open
2. The voice capture in action
3. The file tree + editor + AI panel (the
   three-pane layout)
4. The Settings → Voice section (showing
   the on-device / Wispr / Web Speech cards)
5. The Settings → Privacy & data section
   (showing the v5 export/import)

## Age rating

Lipi is a developer tool with no objectionable
content. The age rating questionnaire answers
are:

- Cartoon or fantasy violence: **No**
- Realistic violence: **No**
- Sexual content or nudity: **No**
- Profanity or crude humour: **No**
- Mature, suggestive, or erotic themes: **No**
- Horror or fear themes: **No**
- Medical or treatment-focused content: **No**
- Gambling or simulated gambling: **No**
- User-generated content: **No**
- Advertising: **No**
- Tracking: **No**

Expected rating: **4+** (all ages).

## In-app purchases

Lipi has no in-app purchases. The app is free
and the AI provider API keys are user-supplied
(bring your own key, no Lipi-side billing).

## App Store review notes

- The app is a developer tool that requires
  the user to supply their own AI provider
  API key. Without a key, the AI features
  are disabled but the editor + voice + git
  + terminal features all work.
- The voice capture uses Apple's on-device
  `SFSpeechRecognizer`; no audio is transmitted
  off-device.
- The deep-link scheme `app://` is registered
  for `app.lipi.ide` so external links
  (e.g. `app://lipi.open?path=/Users/me/file.ts`)
  can open the user's workspace.

## How to use this template

1. Read this file end-to-end.
2. Fill in the `[project lead: ...]` placeholders
   (or accept the pre-filled values).
3. Copy the filled values into App Store Connect
   (https://appstoreconnect.apple.com).
4. The screenshots spec lists the required
   dimensions per device; the suggested shots
   (5 of them) work for all 3 device classes.
5. The privacy-nutrition-label data is
   pre-filled with the exact data Lipi collects.
   Review the language carefully; the App Store
   legal team has rejected apps for vague privacy
   disclosures.
