# Store-metadata templates

This directory contains the App Store Connect and
Google Play Console metadata templates for Lipi.

The templates pre-fill the non-obvious parts
(privacy nutrition label / data safety form) and
call out the project-lead-only fields (App Store
promotional text, Play Store full description)
with `[project lead: ...]` placeholders.

## How to use

1. **Before the first store submission**, the
   project lead reads both templates end-to-end.
2. Fill in the `[project lead: ...]` placeholders
   (or accept the pre-filled values).
3. Copy the filled values into App Store Connect
   (https://appstoreconnect.apple.com) and
   Google Play Console (https://play.google.com/console).
4. The screenshots spec lists the required
   dimensions per store; the suggested shots
   (5 of them) work for both stores.
5. The privacy-nutrition-label / data-safety-form
   answers are pre-filled with the exact data
   Lipi collects. Review the language carefully;
   the App Store / Play Store legal teams have
   rejected apps for vague privacy disclosures.

## When to update

- When Lipi collects new data (e.g. if we add
  analytics, the privacy-nutrition-label gets a
  new entry).
- When Lipi stops collecting data (e.g. if we
  remove the opt-in crash reports, the entry
  gets removed).
- When the App Store / Play Store policy changes
  (Google + Apple update their privacy disclosure
  requirements periodically).

## See also

- `app-store.md` — App Store Connect metadata
- `google-play.md` — Google Play Console metadata
- `../../HANDOFF.md §9.48` — the Phase A writeup
- `../../docs/plugins/lipi-stt-ios/README.md` —
  the iOS plugin contract
- `../../docs/plugins/lipi-stt-android/README.md` —
  the Android plugin contract
