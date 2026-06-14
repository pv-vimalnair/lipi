# Phase 3 — Subscription UX + offline-purchase flow (design)

**Date**: June 2026
**Phase**: 3 of the production-readiness roadmap (see HANDOFF §6 "Current phase")
**Status**: Design (accepted for implementation)
**Supersedes**: the Phase 2 "minimal activation screen" preview (which said "Phase 3 will add the full-screen gate, the title-bar trial badge, the expiry banner, the in-app paywall, the transfer flow, and the App Store / Microsoft Store IAP integration"). This doc makes those promises concrete.
**Deciders**: project lead (Vimal Nair)

## Goal

Build the **complete user-facing subscription flow** on top of the
Phase 2 offline-licensing primitives. After Phase 3 lands, a user
who downloads Lipi for the first time experiences:

1. **First launch** — auto-generated 14-day trial; the editor
   opens normally; a small "Trial — 14 days remaining" badge
   in the title bar.
2. **Day 8 of trial** — the badge changes to "Trial — 7 days
   remaining" (amber). No nag.
3. **Day 12 of trial** — the badge changes to "Trial — 2 days
   remaining" (red). An expiry banner appears at the top of the
   editor with an "Activate now" button.
4. **Day 14 of trial (expired)** — the editor is replaced by a
   full-screen "Your trial has expired" gate with two options:
   "Activate a license" (paste key) and "Get a license"
   (link to the pricing page).
5. **Day 14 + 1-7 days (grace period)** — the gate becomes a
   "Your trial expired 3 days ago" nag with a countdown of
   remaining grace days.
6. **Day 14 + 8+ days (expired)** — the gate is hard: the
   editor is inaccessible until the user activates a license
   or signs in with a valid one.
7. **Activation** — user pastes a key OR clicks a paywall link
   OR restores a past IAP purchase. The gate lifts, the editor
   reappears, the badge in the title bar changes to "Active
   — Yearly, 137 days remaining" (green).
8. **Mid-subscription, new machine** — user wants to use Lipi
   on a new laptop. They deactivate on the old machine
   (Settings → License → Deactivate), then on the new machine
   they paste the same key. The Rust side rejects it
   (`machine-mismatch`); the UI shows a "Transfer to this
   machine" flow that emails the project lead with both
   fingerprints; the project lead re-issues a new key for
   the new machine.

This is the **end-to-end paid-product UX**. Phase 2 shipped
the verification primitives; Phase 3 ships the user-facing
layer that turns those primitives into a coherent product
story.

## Non-goals (Phase 3 explicitly does not do)

- **No payment processing backend.** The "Get a license"
  paywall link opens the project website (Stripe checkout
  is wired by the project lead's existing setup; Phase 3
  just provides the link). The "Restore from App Store"
  flow is a future phase (Phase 4 IAP integration) — Phase
  3 ships the "paste a key" and "transfer to a new machine"
  flows only.
- **No receipt validation.** Phase 3 doesn't validate IAP
  receipts. The "Restore from App Store" button is a
  placeholder that explains "Coming soon" in the v1
  release; the actual receipt validation is Phase 4.
- **No team / volume / per-seat licensing.** Each user has
  their own license. The "5 seats for $200" pricing tier
  is a future feature that requires a v2 license format
  (multiple `sub` claims per signed payload).
- **No automatic license renewal.** When a paid license
  expires, the user has to manually activate a new one
  (or hit the "Renew" link in the paywall). Auto-renewal
  is a future feature that requires a server-side
  subscription state, which we don't have.
- **No real "App Store" wiring.** Phase 3 ships the
  `sign_license` CLI tool (a Rust binary that takes a
  `--plan`, `--machine`, and `--out` flag and emits a
  license key). The App Store wiring (signing the IAP
  receipt, converting it to a license, etc.) is Phase 4.
- **No macOS / Windows code signing in this phase.** Phase
  3 doesn't touch the Tauri updater, code signing, or
  the GitHub Actions release pipeline. That's Phase 5.
- **No Linux distribution.** The "trial" and "activate"
  flows work on all three desktop platforms (Win / Mac /
  Linux) because they all use the same Rust licensing
  primitives. The "Get a license" paywall link works on
  all three because it's a browser link. But the
  distribution channels (Snap, Flathub, AUR) are
  out-of-scope (Phase 4+).

## What this phase builds

### 1. The full-screen gate (`src/shared/components/LicenseGate/`)

A new top-level overlay that blocks the workspace when
the license is in a "must-block" state. The gate sits
between the `AppRoot` and the `ScreenRoot`; it intercepts
the screen router's `activeScreen` based on the license
status.

- **`unactivated`** — Gate is invisible (the user just
  installed; they go through the first-run flow).
- **`trial` (daysRemaining > 0)** — Gate is invisible.
- **`active` (any plan)** — Gate is invisible.
- **`gracePeriod`** — Gate is a soft nag modal at the
  top of the screen: "Your {plan} license expired N
  days ago. You have N days of grace period remaining.
  Renew now → / I'll do it later". The "later" button
  dismisses the modal until next session.
- **`expired`** — Gate is a hard full-screen block. The
  editor and Settings are inaccessible; only the
  License activation screen is reachable (so the user
  can paste a new key).
- **`invalid`** — Gate is a hard full-screen block with
  a "License invalid" message and a "Re-activate" link
  to the License activation screen.
- **`null` (still hydrating)** — Gate is invisible (the
  IPC hasn't resolved yet; we don't want to flash a
  gate on every launch).

The gate is implemented as a React portal at the
AppRoot level, so it overlays EVERY screen (Settings,
the activation screen, etc.) — not just the editor.

### 2. The title-bar trial badge (`src/shared/components/TrialBadge/`)

A small pill in the title bar that shows the current
license status. Only visible when the status is one
of:

- `trial` — "Trial — {N} days remaining" (red when
  N ≤ 3, amber when N ≤ 7, neutral otherwise).
- `gracePeriod` — "Grace — {N} days left" (red, links
  to the License activation screen).
- `active` (≤ 7 days remaining) — "{plan} — {N} days
  remaining" (amber).
- All other states — no badge (the gate handles them).

The badge is rendered in the `TitleBar` component's
right slot. It uses the same `useLicenseStore` that
the gate uses; the store is the single source of truth
for the status. The badge is a pure render + click
component (no IPC, no async work).

### 3. The expiry banner (`src/shared/components/ExpiryBanner/`)

A horizontal banner at the top of the editor (above
the file tree, below the title bar) that appears when
the trial is in its final 3 days OR the user is in
the grace period. The banner is dismissable per-session
("Got it" button hides it for the rest of the app
session, but it reappears on next launch).

- **Trial, daysRemaining ≤ 3** — red banner: "Your
  trial ends in N days. Activate now →".
- **Grace period** — red banner: "Your license expired
  N days ago. You have N grace days left. Activate
  now →".
- All other states — no banner.

The banner uses the same `useLicenseStore` as the gate
and the badge. It's a pure render + click component.

### 4. The transfer-to-another-machine flow (`src/screens/License/components/TransferFlow/`)

A new section on the License activation screen (and a
"Transfer" button on the LicenseCard in Settings) that
lets the user re-issue their license for a new machine.

The flow is:
1. User clicks "Transfer to a new machine".
2. The UI shows a confirmation: "This will deactivate
   your license on this machine. You'll need to email
   the project lead to get a new license for your new
   machine."
3. User confirms; the Rust side calls
   `license_deactivate`; the keychain entry is deleted.
4. The UI now shows the "Transfer" success state: "Your
   license has been deactivated on this machine. To
   re-activate on a new machine, email
   licensing@lipi.ide with both fingerprints and your
   original license key. The project lead will issue a
   new key for your new machine within one business day."
5. The UI also shows a "Copy both fingerprints"
   button that copies the old + new machine
   fingerprints to the clipboard, pre-formatted as
   the email body.

The flow is a multi-step wizard component (Step 1:
confirm, Step 2: result). It's pure TS (no new IPC
beyond `license_deactivate` which Phase 2 already
ships).

### 5. The in-app paywall (`src/screens/License/components/PricingCard/`)

A new section on the License activation screen that
shows the three pricing tiers (Trial / Monthly / Yearly)
and a "Subscribe" link to the project website.

The paywall is **NOT** a checkout — the user has to
go to the website to actually pay. The paywall is
just a marketing surface: "Here's what you get with
each plan, here's the price, click here to subscribe".

- **Trial (free, 14 days)** — "Free for 14 days, no
  credit card. After the trial, choose a plan or
  uninstall."
- **Monthly ($5/month)** — "All features, cancel
  anytime. Subscribe on our website."
- **Yearly ($50/year)** — "All features, save 17% vs
  monthly. Subscribe on our website."

The paywall is rendered above the activation form on
the License screen, so the user sees "here's what
you'd be paying for" before they paste a key. The
"Subscribe on our website" link opens the website
in the system browser (via Tauri's `openUrl` plugin,
which is already available — see Decision #26 for
the existing usage).

The prices ($5/mo, $50/yr) are placeholders; the
project lead updates them when the pricing page goes
live. The paywall is data-driven (the prices are in
a single TS const, not hardcoded in JSX).

### 6. The `sign_license` CLI (`src-tauri/src/bin/sign_license.rs`)

A new Rust binary that the project lead runs to issue
license keys from purchase emails. The CLI takes
three arguments:

```
sign_license --plan <monthly|yearly> --machine <fingerprint> --out <key.txt>
```

Where:

- `--plan` is `monthly` or `yearly` (trial is
  auto-generated, never manually issued).
- `--machine` is the 64-char hex fingerprint of the
  user's machine (they copy this from the License
  activation screen's "Show machine fingerprint"
  section).
- `--out` is the path to write the resulting key
  string (e.g. `licenses/2026-06-14-jane-blogger.txt`).

The CLI reads the production private key from the
`TAURI_PROD_LICENSE_KEY_HEX` environment variable
(32 hex bytes), constructs a `LicensePayload`, signs
it, and writes the `LIP1.…` key string to the output
file. The CLI is a thin wrapper around the
`licensing::sign_payload` function that Phase 2
already exposes publicly.

The CLI is the **only way to issue production
licenses**. There is no UI for it; the project lead
runs it from a terminal when they get a purchase
email.

### 7. The IAP receipt adapter (`src-tauri/src/iap.rs`)

A new Rust module (gated `#[cfg(not(mobile))]` for
desktop-only — mobile IAP is a separate phase) that
provides a `verify_iap_receipt` stub. The full IAP
implementation lands in Phase 4; Phase 3 ships the
**shape** of the IAP integration:

- A new `iap_redeem` Tauri command that takes a
  receipt string and a plan (`monthly` or `yearly`).
- The v1 command returns
  `Invalid { reason: "iap-not-yet-implemented" }` —
  the UI shows "IAP restoration is coming in a
  future update" with a "Paste a license key instead"
  link.

The reason for shipping a stub: the UI flow for
"Restore from App Store" is a 30-line component
that's much easier to design and test when the
IPC call exists (even as a stub) than when the
IPC call is missing. Phase 4 will fill in the
stub without touching the UI.

## Architecture overview

```
                  ┌─────────────────────────────────────────┐
                  │              AppRoot                     │
                  │                                          │
                  │  ┌─────────────────────────────────┐     │
                  │  │  LicenseGate (full-screen block)│     │
                  │  │  (renders when status is one of │     │
                  │  │   expired, invalid, or graceN>7) │     │
                  │  └─────────────────────────────────┘     │
                  │              │                           │
                  │              ▼                           │
                  │  ┌─────────────────────────────────┐     │
                  │  │           ScreenRoot            │     │
                  │  │                                 │     │
                  │  │  ┌─────────────────────────┐    │     │
                  │  │  │  TitleBar               │    │     │
                  │  │  │  + TrialBadge (right)   │    │     │
                  │  │  └─────────────────────────┘    │     │
                  │  │  ┌─────────────────────────┐    │     │
                  │  │  │  ExpiryBanner (below)   │    │     │
                  │  │  └─────────────────────────┘    │     │
                  │  │  ┌─────────────────────────┐    │     │
                  │  │  │  EditorWorkspace OR     │    │     │
                  │  │  │  Welcome OR Settings    │    │     │
                  │  │  │  OR License (activation)│    │     │
                  │  │  └─────────────────────────┘    │     │
                  │  └─────────────────────────────────┘     │
                  └─────────────────────────────────────────┘
                                  │
                                  ▼
                  ┌─────────────────────────────────────────┐
                  │           useLicenseStore                │
                  │   (Zustand; hydrate once on app start)  │
                  └─────────────────────────────────────────┘
                                  │
                                  ▼
                  ┌─────────────────────────────────────────┐
                  │       Rust licensing module              │
                  │   (Phase 2; Phase 3 adds 1 Tauri cmd:    │
                  │    iap_redeem stub)                      │
                  └─────────────────────────────────────────┘
```

The store is the single source of truth. The gate,
badge, banner, and activation screen all read the
same `useLicenseStore` and re-render on any status
change. The Rust side is invoked exactly twice per
session:

1. `license_get_status` on app start (the
   `useLicenseStore.hydrate()` call).
2. `license_activate` or `license_deactivate` when
   the user clicks the corresponding button.

The `iap_redeem` command is the only new IPC call
in Phase 3. It's a stub that returns "not yet
implemented" in v1.

## Data model

No new types. Phase 3 uses the existing
`LicenseStatusPayload` (the `tag = "kind"`,
`camelCase` union from Phase 2) and the existing
`useLicenseStore` shape (status, machineFingerprint,
hydrate, refresh, activate, deactivate,
loadMachineFingerprint). The gate, badge, banner,
transfer flow, and paywall are all pure components
that read the store.

The only **new** types are the pricing-tier data
(pure TS const, no IPC) and the IAP receipt
adapter's error variants (a small `IapError` enum
in the Rust side, with the same `tag = "kind"`,
`camelCase` convention as the existing
`LicenseError`).

## File layout

New files:

```
src/shared/components/LicenseGate/                 # The full-screen block
  LicenseGate.tsx
  LicenseGate.module.css
  LicenseGate.test.ts
src/shared/components/TrialBadge/                  # The title-bar pill
  TrialBadge.tsx
  TrialBadge.module.css
  TrialBadge.test.ts
src/shared/components/ExpiryBanner/                # The editor-top banner
  ExpiryBanner.tsx
  ExpiryBanner.module.css
  ExpiryBanner.test.ts
src/screens/License/components/TransferFlow/        # The transfer wizard
  TransferFlow.tsx
  TransferFlow.module.css
  TransferFlow.test.ts
src/screens/License/components/PricingCard/         # The in-app paywall
  PricingCard.tsx
  PricingCard.module.css
  PricingCard.test.ts
src-tauri/src/bin/sign_license.rs                  # The CLI tool
src-tauri/src/iap.rs                              # The IAP stub
src-tauri/src/iap.test.rs                         # The IAP stub tests
src/ipc/iap.ts                                    # The TS IPC wrapper
```

Modified files:

```
src/main.tsx                                       # Wire LicenseGate + iap_redeem hydrate
src/screens/EditorWorkspace/components/TitleBar/TitleBar.tsx  # Render <TrialBadge />
src/screens/License/License.tsx                   # Add <TransferFlow /> and <PricingCard />
src/screens/SettingsProvider/components/LicenseCard.tsx       # Add "Transfer" button
src-tauri/src/lib.rs                               # Register LicenseGate + iap_redeem + sign_license binary
src-tauri/Cargo.toml                               # Add [[bin]] entry for sign_license
src/shared/commands/commands.ts                    # Add "license.transfer" Command Palette entry
CHANGELOG.md                                       # "Added (Phase 3 — subscription UX + offline-purchase flow)"
HANDOFF.md                                         # §6 "Current phase" + §9.25
docs/decisions/                                    # New ADRs #89-#93
```

The CLI is a single Rust file with no separate
module because it's a one-shot tool (~80 lines +
~30 lines of tests). The IAP stub is a single
Rust file with the same shape as the licensing
module (one file, ~200 lines + ~80 lines of tests).

## The trial-generation vs paid-license state machine

Phase 2 already has a 6-state `LicenseStatus` enum.
Phase 3 doesn't change it; it just adds the UI
surfaces that respond to each state. The mapping is:

| Status             | Gate | Badge | Banner | Settings card | Notes |
|--------------------|------|-------|--------|---------------|-------|
| `null` (hydrating) | hidden | hidden | hidden | "Loading…" | First ~10ms of every launch |
| `unactivated`      | hidden | hidden | hidden | "No license" | Only seen after a `license_deactivate` call |
| `trial`, days > 7  | hidden | neutral | hidden | "Trial — 13 days" | The default state for new users |
| `trial`, days ≤ 7  | hidden | amber | hidden | "Trial — 5 days" | The user is approaching expiry |
| `trial`, days ≤ 3  | hidden | red | shown | "Trial — 2 days" | The final-week red zone |
| `active`, days > 7 | hidden | hidden | hidden | "Active — Yearly, 137 days" | The steady state for paying users |
| `active`, days ≤ 7 | hidden | amber | hidden | "Active — 7 days left" | The renewal reminder |
| `gracePeriod`      | nag modal | red | shown | "Grace period — 2 days" | The 7-day post-expiry nag |
| `expired`          | HARD block | hidden | hidden | "Expired" | The full-screen block |
| `invalid`          | HARD block | hidden | hidden | "License invalid" | The full-screen block + reason |

The decision of which state triggers which surface
is captured in a single `licenseSurfaces` helper
module (pure, no React) so the test suite can pin
the mapping without rendering the components.

## The sign-license CLI

```
$ sign_license --plan yearly --machine aaaa...64-chars...aaaa --out licenses/2026-06-14-jane.txt
$ cat licenses/2026-06-14-jane.txt
LIP1.eyJmb3JtYXQiOiJsaXBpLWxpY2Vuc2UtdjEiLCJwbGFuIjoieWVhcmx5I...<truncated>..<signature>
```

The CLI's UX:

- The user (project lead) runs the command from
  their local checkout.
- The CLI reads the production private key from
  `TAURI_PROD_LICENSE_KEY_HEX` (32 hex chars).
- The CLI builds a `LicensePayload` (format:
  `lipi-license-v1`, plan: from `--plan`, iat:
  now, nbf: now, exp: now + plan duration, sub:
  from `--machine`, jti: random).
- The CLI signs the payload with the production
  private key and writes the `LIP1.…` key string
  to `--out`.
- The CLI prints a one-line success message:
  "Wrote license to licenses/2026-06-14-jane.txt
  (plan: yearly, machine: aaaa…, expires:
  2027-06-14)".
- The CLI returns 0 on success, non-zero on
  error (with a human-readable stderr message).

The CLI is **not** a long-running server. It's a
one-shot command. The project lead runs it once
per purchase email.

### The plan-duration table

The CLI hardcodes the plan duration table:

```rust
match plan.as_str() {
  "monthly" => 30 * 86_400,   // 30 days
  "yearly"  => 365 * 86_400,  // 365 days
  _ => bail!("unknown plan"),
}
```

The table is intentionally simple (30 / 365 days,
not "calendar month" / "calendar year"). The
monthly license expires 30 days after purchase
(not "1st of next month"); the yearly license
expires 365 days after purchase. This is the
same model as Sublime Text / BBEdit.

A future v2 license format could add calendar-
based durations (e.g. "expires at end of
calendar month"), but Phase 3 doesn't.

## The pricing data

The pricing tiers are a single TS const in
`src/screens/License/components/PricingCard/pricing.ts`:

```ts
export const PRICING_TIERS = [
  {
    id: 'trial',
    name: 'Free trial',
    priceLabel: 'Free',
    durationLabel: '14 days',
    description: 'Full features for 14 days. No credit card.',
    ctaLabel: 'Start free trial',
    ctaHref: null,  // No external link; the trial is auto-generated
  },
  {
    id: 'monthly',
    name: 'Monthly',
    priceLabel: '$5',
    durationLabel: 'per month',
    description: 'All features. Cancel anytime.',
    ctaLabel: 'Subscribe monthly',
    ctaHref: 'https://lipi.ide/pricing?plan=monthly',
  },
  {
    id: 'yearly',
    name: 'Yearly',
    priceLabel: '$50',
    durationLabel: 'per year',
    description: 'All features. Save 17% vs monthly.',
    ctaLabel: 'Subscribe yearly',
    ctaHref: 'https://lipi.ide/pricing?plan=yearly',
  },
] as const;
```

The prices ($5/mo, $50/yr) are placeholders; the
project lead updates them when the pricing page
goes live. The `ctaHref` is `https://lipi.ide/...`
(placeholder; the real URL is set when the
project website launches). The paywall is a
**read-only** surface — it doesn't take payments
in-app (the user has to go to the website).

The `ctaHref` is opened via Tauri's `openUrl` plugin
(`@tauri-apps/plugin-opener` or `@tauri-apps/api/shell`
— the existing pattern in the codebase).

## Cross-platform notes

- **macOS / Windows / Linux** — the gate, badge,
  banner, transfer flow, and paywall are all pure
  frontend. The `sign_license` CLI is a Rust
  binary that runs on all three platforms (the
  project lead can run it from any dev machine).
  The `iap.rs` module is gated `#[cfg(not(mobile))]`
  for desktop-only.

- **Linux without a Secret Service** — the gate
  shows a "Your keychain is not running" message
  and a link to the Secret Service setup docs.
  This is rare (most Linux desktops have a
  Secret Service running) but possible (a
  minimal Linux install without GNOME Keyring
  or KWallet).

- **No mobile** in Phase 3. The licensing layer
  is desktop-only. The iOS / Android licensing is
  a future phase (Apple's receipt validation
  needs a Swift shim; Android's needs Kotlin).

## The IAP receipt adapter (stub)

The `iap_redeem` command takes a receipt string
and a plan, and returns a `LicenseStatus`. The
v1 stub returns:

```rust
#[tauri::command]
pub fn iap_redeem(receipt: String, plan: String) -> LicenseStatus {
  LicenseStatus::Invalid {
    reason: "iap-not-yet-implemented: Mac App Store and Microsoft Store IAP integration is coming in a future update. For now, please paste a license key (or email licensing@lipi.ide to get one).".to_string(),
  }
}
```

The UI for "Restore from App Store" (a button on
the License activation screen) calls this command
and shows the result. Phase 4 will fill in the
real implementation without changing the UI.

The reason for shipping a stub: the UI flow is
much easier to design and test when the IPC call
exists (even as a stub) than when it's missing.
The stub also documents the contract — the v1
return type (`LicenseStatus`) tells Phase 4 exactly
what the real implementation should return.

## Test plan

### Rust unit tests (`src-tauri/src/iap.rs`)

1. `iap_redeem_with_empty_receipt_returns_invalid`.
2. `iap_redeem_with_non_empty_receipt_returns_invalid_with_iap_not_yet_implemented_reason`.
3. `iap_redeem_with_monthly_plan_returns_invalid`.
4. `iap_redeem_with_yearly_plan_returns_invalid`.
5. `iap_redeem_with_unknown_plan_returns_invalid`.

### Rust CLI tests (`src-tauri/src/bin/sign_license.rs`)

1. `sign_payload_with_monthly_plan_produces_valid_key`.
2. `sign_payload_with_yearly_plan_produces_valid_key`.
3. `sign_payload_with_empty_machine_fingerprint_fails`.
4. `sign_payload_with_overlong_machine_fingerprint_fails`.
5. `sign_payload_with_non_hex_machine_fingerprint_fails`.
6. `sign_payload_with_unknown_plan_fails`.
7. `signed_key_verifies_with_production_pubkey`.
8. `signed_key_fails_verification_with_trial_pubkey` (sanity check).
9. `exp_date_for_monthly_is_30_days_from_now`.
10. `exp_date_for_yearly_is_365_days_from_now`.

### TS unit tests (`src/shared/components/LicenseGate/`)

1. `renders_nothing_for_null_status`.
2. `renders_nothing_for_active_status`.
3. `renders_nothing_for_trial_with_more_than_7_days`.
4. `renders_nag_modal_for_grace_period`.
5. `renders_full_screen_block_for_expired`.
6. `renders_full_screen_block_for_invalid`.
7. `renders_full_screen_block_for_unactivated` (rare; only after `license_deactivate`).
8. `nag_modal_can_be_dismissed`.
9. `dismiss_state_resets_on_reload`.

### TS unit tests (`src/shared/components/TrialBadge/`)

1. `renders_nothing_for_null_status`.
2. `renders_trial_badge_for_trial_status`.
3. `trial_badge_is_amber_when_days_remaining_is_7_or_less`.
4. `trial_badge_is_red_when_days_remaining_is_3_or_less`.
5. `renders_active_badge_for_active_status_with_7_or_fewer_days`.
6. `renders_grace_badge_for_grace_period_status`.
7. `renders_nothing_for_active_status_with_more_than_7_days`.
8. `clicking_badge_opens_license_activation_screen` (mocked router).

### TS unit tests (`src/shared/components/ExpiryBanner/`)

1. `renders_nothing_for_null_status`.
2. `renders_nothing_for_trial_with_more_than_3_days`.
3. `renders_red_banner_for_trial_with_3_or_fewer_days`.
4. `renders_red_banner_for_grace_period`.
5. `renders_nothing_for_active_status`.
6. `banner_can_be_dismissed_via_got_it_button`.
7. `dismiss_state_persists_for_session_only`.

### TS unit tests (`src/screens/License/components/TransferFlow/`)

1. `renders_initial_state_with_transfer_button`.
2. `clicking_transfer_shows_confirmation_step`.
3. `confirming_transfer_calls_deactivate_ipc`.
4. `after_deactivate_shows_success_step_with_email_template`.
5. `clicking_copy_clipboard_writes_email_body_to_clipboard` (mocked `navigator.clipboard`).
6. `cancel_button_returns_to_initial_state`.

### TS unit tests (`src/screens/License/components/PricingCard/`)

1. `renders_three_pricing_tiers`.
2. `trial_tier_has_no_cta_link`.
3. `monthly_tier_has_correct_price_label`.
4. `yearly_tier_has_correct_price_label`.
5. `clicking_subscribe_link_opens_in_system_browser` (mocked `openUrl`).

### TS unit tests (`src/shared/components/LicenseGate/LicenseGate.helpers.test.ts`)

(The pure `licenseSurfaces` helper test.)

1. `surfaces_for_null_status_returns_no_gate_no_badge_no_banner`.
2. `surfaces_for_trial_7_days_returns_neutral_badge_no_banner`.
3. `surfaces_for_trial_3_days_returns_red_badge_and_banner`.
4. `surfaces_for_active_30_days_returns_no_badge_no_banner`.
5. `surfaces_for_active_5_days_returns_amber_badge_no_banner`.
6. `surfaces_for_grace_period_returns_red_badge_and_banner_and_nag`.
7. `surfaces_for_expired_returns_hard_block_no_badge_no_banner`.
8. `surfaces_for_invalid_returns_hard_block_no_badge_no_banner`.

Total: **~50 new tests** (5 Rust IAP + 10 Rust CLI + 8 LicenseGate
+ 8 TrialBadge + 7 ExpiryBanner + 6 TransferFlow + 5 PricingCard
+ 8 surface mapping).

## Open questions / future work

1. **Should the trial badge show a countdown (e.g. "13d 4h
   22m") or a day count (e.g. "13 days remaining")?**
   Phase 3 uses day counts (matches the existing
   `statusLine` wording). A future phase could add
   a more granular countdown if user feedback
   suggests it.

2. **Should the gate have a "Skip" button that
   dismisses it for the session (like the nag
   modal does)?** No — the gate is a hard
   block. The user can still see the License
   activation screen (which is the only way to
   "skip" the gate by activating a key).

3. **Should the transfer flow be a separate screen
   or a wizard on the activation screen?**
   Phase 3 uses a wizard on the activation
   screen (3 steps: confirm → result). A
   future phase could add a dedicated
   `/transfer` route for deep-linking from
   the support email.

4. **Should the paywall be visible when the user
   is in a paid state?** No — the paywall is
   only visible on the License activation
   screen, which is only reachable when the
   user is unactivated / past grace / invalid.
   A paying user never sees the paywall (they
   see the editor, not the activation screen).

5. **Should the sign-license CLI support
   batch-issuing from a CSV?**
   Phase 3 ships the single-key version.
   A future phase could add
   `sign_license --batch purchases.csv` that
   takes a CSV of `plan,machine,email` rows
   and emits one key per row.

## Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| User dismisses the gate nag and never sees the activation screen | Low | Low | The gate is a HARD block when `expired`; the nag is only for `gracePeriod` |
| User's machine fingerprint changes (e.g. USB WiFi adapter swap) | Low | Medium | The "Transfer" flow + `license_deactivate` + a new key from the project lead |
| The sign-license CLI is used by a malicious user to issue fake keys | Low | High | The CLI requires the production private key from an env var, which is only in the project lead's CI secret store + a local encrypted USB drive |
| The IAP stub returns "not yet implemented" and users complain | Medium | Low | The "Restore from App Store" button is a placeholder with a clear "coming soon" message; the "paste a license key" path is always available |
| The pricing data is hardcoded in TS and out of sync with the website | Medium | Low | The `PRICING_TIERS` const is in a single file; a future phase could fetch it from a config endpoint, but for v1 the TS const is the source of truth |
| The transfer flow's email template is wrong (wrong field, wrong format) | Low | Low | The template is a single string; tests pin the wording |

The risks are bounded. The gate, badge, banner, transfer
flow, and paywall are all pure frontend (no new IPC
beyond the IAP stub, no new Rust beyond the IAP stub and
the sign-license CLI). The new IPC surface is tiny (one
stubbed command, returning a single `Invalid` status).

## What this design does NOT cover

- **No real App Store IAP.** The "Restore from App Store"
  flow is a stub. Phase 4 wires the real receipt
  validation.
- **No payment processing.** The "Subscribe" button
  opens the project website, which has the real
  Stripe checkout. Phase 4 doesn't change this
  (Stripe checkout is on the website, not in
  the app).
- **No analytics / telemetry.** The user never
  sees a "you've been using Lipi for 14 days,
  please rate us" nag. The "no backend, ever"
  rule still applies.
- **No team / volume licensing.** Each user has
  their own license. A future pricing tier
  ("5 seats for $200") would require a v2
  license format with multiple `sub` claims.

## References

- `HANDOFF.md §6 "Current phase: Phase 3 — SHIPPED"` (post-Phase-3)
- `HANDOFF.md §6 "Next: Phase 4 — App Store IAP + sign-license CLI"`
- `HANDOFF.md §9.25` — the per-phase writeup of Phase 3
- `docs/plans/prod-p2-licensing-design.md` — the Phase 2 design
  (Phase 3 builds on Phase 2's primitives)
- `docs/decisions/0085-p2-offline-license-validation.md` — the
  offline-only verification decision (Phase 3 inherits this)
- `docs/decisions/0086-p2-trial-privkey-embedded.md` — the trial
  private key decision (Phase 3's trial-generation uses the same
  key)
- `docs/decisions/0087-p2-machine-fingerprint-sha256.md` — the
  machine fingerprint (Phase 3's transfer flow uses the same
  fingerprint)
- `docs/decisions/0088-p2-jws-compact-serialization.md` — the
  JWS-style serialization (Phase 3's sign-license CLI emits the
  same format)
- `src-tauri/src/licensing.rs` — the Phase 2 Rust module
  (Phase 3's `sign_license` CLI and `iap.rs` build on the same
  `sign_payload` function)
- `src/shared/state/licenseStore.ts` — the Phase 2 Zustand store
  (Phase 3's gate, badge, banner, transfer flow, and paywall all
  read this store)
- `src/screens/License/License.tsx` — the Phase 2 activation
  screen (Phase 3's transfer flow and paywall are added here)
- `src/screens/SettingsProvider/components/LicenseCard.tsx` —
  the Phase 2 settings card (Phase 3's "Transfer" button is
  added here)

---

*This is a design doc. Implementation will follow in Phase 3b
of the production-readiness todo list.*
